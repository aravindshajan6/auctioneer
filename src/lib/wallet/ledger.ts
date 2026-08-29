/**
 * Double-entry wallet ledger.
 *
 * `ledger_entries` is append-only and authoritative; `wallets.availableCents`
 * and `wallets.heldCents` are a cache updated in the SAME transaction as the
 * entry that justifies them. If the two ever disagree, the ledger is right —
 * see `reconcileWallet`.
 *
 * Two balances, because a bid is a commitment before it is a payment:
 *   available — spendable right now
 *   held      — earmarked against a live bid, untouchable until released
 *
 * `ledger_entries.amountCents` is the signed change in the wallet's TOTAL
 * claim (available + held), not the change in `available`. Placing or
 * releasing a hold shuffles money between the two buckets without changing
 * what the user owns, so those entries carry 0; only real inflows and
 * outflows carry a value. The bucket movement is never lost — every row
 * snapshots `availableAfterCents` and `heldAfterCents`.
 *
 * The invariant, asserted by scripts/lifecycle-check.ts:
 *   sum(amountCents) == availableCents + heldCents
 */
import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Executor, Tx } from "../db/tx";
import { bidDeposits, ledgerEntries, wallets } from "../db/schema";

export class InsufficientFundsError extends Error {
  constructor(
    readonly requiredCents: number,
    readonly availableCents: number,
  ) {
    super("Insufficient available balance");
    this.name = "InsufficientFundsError";
  }
}

/** Fetch or lazily create a user's wallet. Safe against concurrent creation. */
export async function ensureWallet(exec: Executor, userId: string) {
  const [existing] = await exec.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (existing) return existing;

  const [created] = await exec
    .insert(wallets)
    .values({ id: `wal_${nanoid(16)}`, userId })
    .onConflictDoNothing({ target: wallets.userId })
    .returning();
  if (created) return created;

  // Lost the race — another request created it first.
  const [raced] = await exec.select().from(wallets).where(eq(wallets.userId, userId)).limit(1);
  if (!raced) throw new Error(`Unable to create wallet for user ${userId}`);
  return raced;
}

/**
 * Lock a wallet row for the rest of the transaction. Every balance mutation
 * goes through here so concurrent holds on the same wallet serialise instead
 * of both reading the same stale `availableCents`.
 */
async function lockWallet(tx: Tx, userId: string) {
  await ensureWallet(tx, userId);
  const [row] = await tx
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .for("update")
    .limit(1);
  if (!row) throw new Error(`Wallet vanished for user ${userId}`);
  return row;
}

interface MovementRef {
  kind: (typeof ledgerEntries.$inferInsert)["kind"];
  memo?: string;
  refType?: string;
  refId?: string;
}

/** Write the balance cache and the ledger line that explains it, atomically. */
async function record(
  tx: Tx,
  walletId: string,
  next: { availableCents: number; heldCents: number },
  delta: number,
  ref: MovementRef,
) {
  await tx
    .update(wallets)
    .set({
      availableCents: next.availableCents,
      heldCents: next.heldCents,
      version: sql`${wallets.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(wallets.id, walletId));

  await tx.insert(ledgerEntries).values({
    id: `led_${nanoid(18)}`,
    walletId,
    kind: ref.kind,
    amountCents: delta,
    availableAfterCents: next.availableCents,
    heldAfterCents: next.heldCents,
    memo: ref.memo,
    refType: ref.refType,
    refId: ref.refId,
  });
}

/** Add spendable funds (a top-up, a refund, or sale proceeds). */
export async function credit(
  tx: Tx,
  userId: string,
  amountCents: number,
  ref: MovementRef,
) {
  if (amountCents <= 0) throw new Error("credit requires a positive amount");
  const wallet = await lockWallet(tx, userId);
  const next = {
    availableCents: wallet.availableCents + amountCents,
    heldCents: wallet.heldCents,
  };
  await record(tx, wallet.id, next, amountCents, ref);
  return next;
}

/** Remove spendable funds outright (a withdrawal or a fee). */
export async function debit(
  tx: Tx,
  userId: string,
  amountCents: number,
  ref: MovementRef,
) {
  if (amountCents <= 0) throw new Error("debit requires a positive amount");
  const wallet = await lockWallet(tx, userId);
  if (wallet.availableCents < amountCents) {
    throw new InsufficientFundsError(amountCents, wallet.availableCents);
  }
  const next = {
    availableCents: wallet.availableCents - amountCents,
    heldCents: wallet.heldCents,
  };
  await record(tx, wallet.id, next, -amountCents, ref);
  return next;
}

/**
 * Move funds from available into held against a specific lot.
 *
 * A bidder holds at most one deposit per auction: raising a bid tops the
 * existing hold up to the new requirement rather than stacking a second one.
 */
export async function holdForBid(
  tx: Tx,
  userId: string,
  auctionId: string,
  requiredCents: number,
) {
  const wallet = await lockWallet(tx, userId);

  const [existing] = await tx
    .select()
    .from(bidDeposits)
    .where(
      and(
        eq(bidDeposits.userId, userId),
        eq(bidDeposits.auctionId, auctionId),
        eq(bidDeposits.status, "held"),
      ),
    )
    .for("update")
    .limit(1);

  const alreadyHeld = existing?.amountCents ?? 0;
  const topUp = requiredCents - alreadyHeld;
  if (topUp <= 0) return { wallet, depositId: existing!.id, movedCents: 0 };

  if (wallet.availableCents < topUp) {
    throw new InsufficientFundsError(topUp, wallet.availableCents);
  }

  const next = {
    availableCents: wallet.availableCents - topUp,
    heldCents: wallet.heldCents + topUp,
  };
  // 0: the bidder still owns this money, it is merely no longer spendable.
  await record(tx, wallet.id, next, 0, {
    kind: "hold_place",
    memo: `Bid deposit for lot ${auctionId}`,
    refType: "auction",
    refId: auctionId,
  });

  let depositId: string;
  if (existing) {
    depositId = existing.id;
    await tx
      .update(bidDeposits)
      .set({ amountCents: requiredCents })
      .where(eq(bidDeposits.id, existing.id));
  } else {
    depositId = `dep_${nanoid(16)}`;
    await tx.insert(bidDeposits).values({
      id: depositId,
      userId,
      auctionId,
      amountCents: requiredCents,
      status: "held",
    });
  }

  return { wallet: next, depositId, movedCents: topUp };
}

/** Return a hold to spendable funds — the bidder was outbid or the lot passed. */
export async function releaseHold(tx: Tx, userId: string, auctionId: string) {
  const [deposit] = await tx
    .select()
    .from(bidDeposits)
    .where(
      and(
        eq(bidDeposits.userId, userId),
        eq(bidDeposits.auctionId, auctionId),
        eq(bidDeposits.status, "held"),
      ),
    )
    .for("update")
    .limit(1);
  if (!deposit) return null;

  const wallet = await lockWallet(tx, userId);
  const next = {
    availableCents: wallet.availableCents + deposit.amountCents,
    heldCents: Math.max(0, wallet.heldCents - deposit.amountCents),
  };
  // 0: releasing returns the money to `available` without creating any.
  await record(tx, wallet.id, next, 0, {
    kind: "hold_release",
    memo: `Deposit released for lot ${auctionId}`,
    refType: "auction",
    refId: auctionId,
  });
  await tx
    .update(bidDeposits)
    .set({ status: "released", releasedAt: new Date() })
    .where(eq(bidDeposits.id, deposit.id));
  return deposit;
}

/**
 * Consume a hold — the bidder won and the deposit is applied to their order.
 * Held funds leave the wallet entirely; they do not pass back through
 * available, because the bidder never regains the ability to spend them.
 */
export async function captureHold(tx: Tx, userId: string, auctionId: string) {
  const [deposit] = await tx
    .select()
    .from(bidDeposits)
    .where(
      and(
        eq(bidDeposits.userId, userId),
        eq(bidDeposits.auctionId, auctionId),
        eq(bidDeposits.status, "held"),
      ),
    )
    .for("update")
    .limit(1);
  if (!deposit) return null;

  const wallet = await lockWallet(tx, userId);
  const next = {
    availableCents: wallet.availableCents,
    heldCents: Math.max(0, wallet.heldCents - deposit.amountCents),
  };
  // A real outflow: the deposit leaves the wallet for the seller's order.
  await record(tx, wallet.id, next, -deposit.amountCents, {
    kind: "hold_capture",
    memo: `Deposit applied to winning lot ${auctionId}`,
    refType: "auction",
    refId: auctionId,
  });
  await tx
    .update(bidDeposits)
    .set({ status: "captured", releasedAt: new Date() })
    .where(eq(bidDeposits.id, deposit.id));
  return deposit;
}

/**
 * Replay the ledger to get the wallet's true total claim, and compare it with
 * the cached buckets. The ledger is the source of truth, so a non-zero `drift`
 * means the cache is wrong and this is the signal to repair it.
 */
export async function reconcileWallet(exec: Executor, walletId: string) {
  const [totals] = await exec
    .select({
      ledgerTotal: sql<string>`coalesce(sum(${ledgerEntries.amountCents}), 0)`,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.walletId, walletId));

  const [wallet] = await exec.select().from(wallets).where(eq(wallets.id, walletId)).limit(1);
  const ledgerTotal = Number(totals?.ledgerTotal ?? 0);
  const cachedTotal = (wallet?.availableCents ?? 0) + (wallet?.heldCents ?? 0);

  return { ledgerTotal, cachedTotal, drift: cachedTotal - ledgerTotal };
}

/** How much a bidder must have on deposit to hold a lot at a given price. */
export const DEPOSIT_RATE_BPS = 1_000; // 10%
export const MIN_DEPOSIT_CENTS = 2_500; // $25 floor so cheap lots still commit

export function requiredDepositFor(priceCents: number): number {
  return Math.max(MIN_DEPOSIT_CENTS, Math.round((priceCents * DEPOSIT_RATE_BPS) / 10_000));
}
