/**
 * The bid engine — the only place in the codebase allowed to move an auction's
 * price.
 *
 * Correctness model: every mutation of a lot opens a transaction and takes a
 * `SELECT ... FOR UPDATE` on the auction row FIRST. That row is the lot's
 * mutex, so two bids arriving in the same millisecond queue behind each other
 * instead of both reading the same stale price and both "winning". Everything
 * downstream — proxy resolution, deposits, soft-close, counters — happens
 * inside that lock and commits together or not at all.
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../db";
import type { Tx } from "../db/tx";
import {
  auctionEvents,
  auctions,
  bids,
  notifications,
  orders,
  watchlist,
} from "../db/schema";
import { env } from "../env";
import { applyBps } from "./money";
import { minimumNextBid } from "./increments";
import { resolveProxyBid } from "./proxy";
import {
  InsufficientFundsError,
  captureHold,
  credit,
  ensureWallet,
  holdForBid,
  releaseHold,
  requiredDepositFor,
} from "../wallet/ledger";

export type BidRejection =
  | "auction_not_found"
  | "not_open"
  | "not_started"
  | "already_ended"
  | "seller_cannot_bid"
  | "below_minimum"
  | "not_a_raise"
  | "insufficient_funds"
  | "account_suspended";

export interface PlaceBidInput {
  auctionId: string;
  bidderId: string;
  /** The bidder's private ceiling. A "simple" bid passes the ask itself. */
  maxAmountCents: number;
  idempotencyKey?: string;
  ipAddress?: string;
}

export interface PlaceBidSuccess {
  ok: true;
  auctionId: string;
  currentPriceCents: number;
  minimumNextBidCents: number;
  leaderId: string;
  bidCount: number;
  reserveMet: boolean;
  endsAt: Date;
  extended: boolean;
  /** True when the caller placed the bid but a standing proxy instantly beat it. */
  youWereOutbid: boolean;
  outbidBidderId: string | null;
  version: number;
}

export interface PlaceBidFailure {
  ok: false;
  reason: BidRejection;
  message: string;
  minimumNextBidCents?: number;
  requiredCents?: number;
  availableCents?: number;
}

export type PlaceBidResult = PlaceBidSuccess | PlaceBidFailure;

const fail = (reason: BidRejection, message: string, extra: Partial<PlaceBidFailure> = {}): PlaceBidFailure => ({
  ok: false,
  reason,
  message,
  ...extra,
});

/**
 * Place (or raise) a proxy bid.
 *
 * Safe to retry: pass a stable `idempotencyKey` and a duplicate submission
 * replays the original outcome instead of bidding twice.
 */
export async function placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
  const { auctionId, bidderId, maxAmountCents, idempotencyKey, ipAddress } = input;
  const cfg = env();

  return db.transaction(async (tx) => {
    /* -- 1. Take the lot's mutex. ---------------------------------------- */
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .for("update")
      .limit(1);

    if (!auction) return fail("auction_not_found", "That lot no longer exists.");
    if (auction.sellerId === bidderId) {
      return fail("seller_cannot_bid", "You cannot bid on your own lot.");
    }

    const now = new Date();

    /* -- 2. Replay a duplicate submission rather than double-bidding. ----- */
    if (idempotencyKey) {
      const [prior] = await tx
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.auctionId, auctionId),
            eq(bids.bidderId, bidderId),
            eq(bids.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (prior) {
        return {
          ok: true,
          auctionId,
          currentPriceCents: auction.currentPriceCents,
          minimumNextBidCents: minimumNextBid({
            currentPriceCents: auction.currentPriceCents,
            startingPriceCents: auction.startingPriceCents,
            hasBids: auction.bidCount > 0,
          }),
          leaderId: auction.winnerId ?? bidderId,
          bidCount: auction.bidCount,
          reserveMet: auction.reserveMet,
          endsAt: auction.endsAt,
          extended: false,
          youWereOutbid: prior.status === "outbid",
          outbidBidderId: null,
          version: auction.version,
        } satisfies PlaceBidSuccess;
      }
    }

    /* -- 3. Is this lot actually open? ----------------------------------- */
    if (auction.status === "scheduled" && auction.startsAt <= now) {
      // Lazily promote a lot whose start time has passed but whose scheduler
      // tick has not landed yet, so an eager bidder is not turned away.
      await tx
        .update(auctions)
        .set({ status: "live", updatedAt: now })
        .where(eq(auctions.id, auctionId));
      auction.status = "live";
    }
    if (auction.status === "scheduled") {
      return fail("not_started", "Bidding on this lot has not opened yet.");
    }
    if (auction.status !== "live" && auction.status !== "ending") {
      return fail("not_open", "This lot is closed to bidding.");
    }
    if (auction.endsAt <= now) {
      return fail("already_ended", "Bidding on this lot has closed.");
    }

    /* -- 4. Who currently holds the lot, and at what ceiling? ------------- */
    const [leadingBid] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.auctionId, auctionId), ne(bids.status, "retracted")))
      .orderBy(desc(bids.maxAmountCents), bids.createdAt)
      .limit(1);

    const leader = leadingBid
      ? { bidderId: leadingBid.bidderId, maxAmountCents: leadingBid.maxAmountCents }
      : null;

    /* -- 5. Can the bidder actually back this bid? ------------------------ */
    // Checked before resolution so a bidder cannot move the price with money
    // they do not have, even if they are about to be outbid anyway.
    const wallet = await ensureWallet(tx, bidderId);
    const requiredDeposit = requiredDepositFor(maxAmountCents);
    const heldOnThisLot = leader?.bidderId === bidderId
      ? requiredDepositFor(auction.currentPriceCents)
      : 0;
    if (wallet.availableCents + heldOnThisLot < requiredDeposit) {
      return fail(
        "insufficient_funds",
        "Your available balance does not cover the deposit for this bid.",
        { requiredCents: requiredDeposit, availableCents: wallet.availableCents },
      );
    }

    /* -- 6. Resolve the contest. ----------------------------------------- */
    const resolution = resolveProxyBid({
      startingPriceCents: auction.startingPriceCents,
      currentPriceCents: auction.currentPriceCents,
      reservePriceCents: auction.reservePriceCents,
      leader,
      challenger: { bidderId, maxAmountCents },
    });

    if (!resolution.accepted) {
      return fail(
        resolution.reason === "not_a_raise" ? "not_a_raise" : "below_minimum",
        resolution.reason === "not_a_raise"
          ? "Your new maximum must be higher than your current one."
          : "That bid is below the current asking price.",
        { minimumNextBidCents: resolution.minimumCents },
      );
    }

    /* -- 7. Soft close: a bid in the dying seconds buys everyone time. ---- */
    // Sniping wins auctions by denying rivals the chance to respond, not by
    // valuing the lot higher. Extending the clock restores that chance.
    const msLeft = auction.endsAt.getTime() - now.getTime();
    const inSnipeWindow = msLeft <= cfg.ANTISNIPE_WINDOW_SECONDS * 1000;

    // Only a bid the ROOM can see justifies more time. Quietly raising your
    // own ceiling moves no price and displaces nobody, so letting it extend
    // would hand one bidder an unlimited stall — bid, extend, repeat, alone.
    const movedTheRoom =
      resolution.outcome !== "max_raised" ||
      resolution.newPriceCents !== auction.currentPriceCents;

    // And overtime is capped, or two determined bidders can keep a lot open
    // indefinitely and nobody can ever plan around a closing time.
    const capReached = auction.extensionCount >= cfg.ANTISNIPE_MAX_EXTENSIONS;

    const extended =
      inSnipeWindow && auction.type === "timed" && movedTheRoom && !capReached;
    const nextEndsAt = extended
      ? new Date(now.getTime() + cfg.ANTISNIPE_EXTENSION_SECONDS * 1000)
      : auction.endsAt;

    /* -- 8. Write bid history. ------------------------------------------- */
    if (resolution.ledger.length > 0) {
      // Everything standing is superseded by this round's outcome.
      await tx
        .update(bids)
        .set({ status: "outbid" })
        .where(and(eq(bids.auctionId, auctionId), eq(bids.status, "winning")));

      let index = 0;
      for (const entry of resolution.ledger) {
        await tx.insert(bids).values({
          id: `bid_${nanoid(18)}`,
          auctionId,
          bidderId: entry.bidderId,
          amountCents: entry.amountCents,
          maxAmountCents: entry.maxAmountCents,
          type: entry.type,
          status: entry.status,
          // Only the bidder's own submission carries their idempotency key;
          // the proxy answer it triggered is a distinct row.
          idempotencyKey:
            entry.bidderId === bidderId && entry.type === "manual" ? idempotencyKey : null,
          ipAddress: entry.bidderId === bidderId ? ipAddress : null,
          // Preserve intended ordering when rows land in the same millisecond.
          createdAt: new Date(now.getTime() + index),
        });
        index += 1;
      }
    } else if (resolution.outcome === "max_raised" && leadingBid) {
      // A private ceiling change: update it in place, publish nothing.
      await tx
        .update(bids)
        .set({ maxAmountCents: resolution.leaderMaxCents })
        .where(eq(bids.id, leadingBid.id));
    }

    /* -- 9. Move the deposits to follow the leadership. ------------------- */
    const leadershipChanged = leader?.bidderId !== resolution.leaderId;
    try {
      await holdForBid(
        tx,
        resolution.leaderId,
        auctionId,
        requiredDepositFor(resolution.newPriceCents),
      );
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        // The standing leader can no longer back the price this bid pushed
        // them to. Roll the whole round back rather than seat a leader whose
        // deposit does not exist.
        throw error;
      }
      throw error;
    }
    if (leadershipChanged && leader) {
      await releaseHold(tx, leader.bidderId, auctionId);
    }

    /* -- 10. Update the lot. --------------------------------------------- */
    /* A lot's price only ever goes up. `resolveProxyBid` derives the new ask
       from the standing bids, so if that history is ever thinner than the
       recorded price — bids removed, an account erased, a bad restore — the
       resolved figure can land BELOW where the room already stands, and the
       lot would visibly rewind while telling a bidder they had won it. Clamp
       to the standing price: a bid must never lower an ask. */
    const nextPriceCents = Math.max(resolution.newPriceCents, auction.currentPriceCents);
    const bidderCountRow = await tx
      .select({ count: sql<number>`count(distinct ${bids.bidderId})::int` })
      .from(bids)
      .where(eq(bids.auctionId, auctionId));

    const [updated] = await tx
      .update(auctions)
      .set({
        currentPriceCents: nextPriceCents,
        reserveMet: resolution.reserveMet,
        bidCount: sql`${auctions.bidCount} + ${resolution.ledger.length || 1}`,
        bidderCount: bidderCountRow[0]?.count ?? 1,
        endsAt: nextEndsAt,
        extensionCount: extended ? auction.extensionCount + 1 : auction.extensionCount,
        status: inSnipeWindow && auction.type === "timed" ? "ending" : auction.status,
        version: sql`${auctions.version} + 1`,
        updatedAt: now,
      })
      .where(eq(auctions.id, auctionId))
      .returning();

    /* -- 11. Tell the room what happened. -------------------------------- */
    await tx.insert(auctionEvents).values({
      id: `evt_${nanoid(18)}`,
      auctionId,
      type: resolution.outcome === "max_raised" ? "max_raised" : "bid_placed",
      actorId: bidderId,
      payload: {
        priceCents: nextPriceCents,
        leaderId: resolution.leaderId,
        outcome: resolution.outcome,
        reserveMet: resolution.reserveMet,
      },
    });

    if (extended) {
      await tx.insert(auctionEvents).values({
        id: `evt_${nanoid(18)}`,
        auctionId,
        type: "time_extended",
        actorId: null,
        payload: {
          endsAt: nextEndsAt.toISOString(),
          reason: "anti_snipe",
          extensionCount: auction.extensionCount + 1,
        },
      });
    }

    if (resolution.outbidBidderId && resolution.outbidBidderId !== bidderId) {
      await tx.insert(notifications).values({
        id: `ntf_${nanoid(18)}`,
        userId: resolution.outbidBidderId,
        type: "outbid",
        title: "You have been outbid",
        body: `${auction.title} is now at ${(nextPriceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
        href: `/lot/${auction.slug}`,
        payload: { auctionId, priceCents: nextPriceCents },
      });
    }

    return {
      ok: true,
      auctionId,
      currentPriceCents: nextPriceCents,
      minimumNextBidCents: minimumNextBid({
        currentPriceCents: nextPriceCents,
        startingPriceCents: auction.startingPriceCents,
        hasBids: true,
      }),
      leaderId: resolution.leaderId,
      bidCount: updated?.bidCount ?? auction.bidCount + 1,
      reserveMet: resolution.reserveMet,
      endsAt: nextEndsAt,
      extended,
      youWereOutbid: resolution.leaderId !== bidderId,
      outbidBidderId: resolution.outbidBidderId,
      version: updated?.version ?? auction.version + 1,
    } satisfies PlaceBidSuccess;
  });
}

/* ========================================================================== */
/* Closing                                                                    */
/* ========================================================================== */

export interface CloseResult {
  auctionId: string;
  outcome: "sold" | "passed" | "already_closed" | "not_due";
  winnerId?: string;
  hammerPriceCents?: number;
  orderId?: string;
}

/**
 * Settle a lot whose clock has run out.
 *
 * Idempotent by construction: it re-locks the row and bails if the status is
 * already terminal, so a retried job, a duplicate timer and the catch-up
 * sweeper can all race and only one of them will settle the lot.
 */
export async function closeAuction(auctionId: string, opts: { force?: boolean } = {}): Promise<CloseResult> {
  return db.transaction(async (tx) => {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .for("update")
      .limit(1);

    if (!auction) return { auctionId, outcome: "already_closed" };
    if (auction.status !== "live" && auction.status !== "ending") {
      return { auctionId, outcome: "already_closed" };
    }

    const now = new Date();
    // A soft-close extension may have moved the finish line after this job was
    // scheduled; respect the row, not the timer that woke us.
    if (!opts.force && auction.endsAt > now) {
      return { auctionId, outcome: "not_due" };
    }

    const [leadingBid] = await tx
      .select()
      .from(bids)
      .where(and(eq(bids.auctionId, auctionId), ne(bids.status, "retracted")))
      .orderBy(desc(bids.maxAmountCents), bids.createdAt)
      .limit(1);

    const sold =
      Boolean(leadingBid) &&
      (auction.reservePriceCents === null ||
        leadingBid!.maxAmountCents >= auction.reservePriceCents);

    /* -- No winner: give everyone their money back. ---------------------- */
    if (!sold) {
      if (leadingBid) await releaseHold(tx, leadingBid.bidderId, auctionId);
      await tx
        .update(auctions)
        .set({
          status: "passed",
          closedAt: now,
          version: sql`${auctions.version} + 1`,
          updatedAt: now,
        })
        .where(eq(auctions.id, auctionId));

      await tx.insert(auctionEvents).values({
        id: `evt_${nanoid(18)}`,
        auctionId,
        type: "lot_passed",
        actorId: null,
        payload: {
          reason: leadingBid ? "reserve_not_met" : "no_bids",
          finalPriceCents: auction.currentPriceCents,
        },
      });

      await tx.insert(notifications).values({
        id: `ntf_${nanoid(18)}`,
        userId: auction.sellerId,
        type: "lot_passed",
        title: "Your lot did not sell",
        body: leadingBid
          ? `${auction.title} closed below its reserve.`
          : `${auction.title} closed with no bids.`,
        href: `/lot/${auction.slug}`,
        payload: { auctionId },
      });

      return { auctionId, outcome: "passed" };
    }

    /* -- Sold: hammer down. ---------------------------------------------- */
    const hammerPriceCents = auction.currentPriceCents;
    const buyersPremiumCents = applyBps(hammerPriceCents, auction.buyersPremiumBps);
    const totalCents = hammerPriceCents + buyersPremiumCents;
    const winnerId = leadingBid!.bidderId;

    await tx
      .update(auctions)
      .set({
        status: "sold",
        winnerId,
        winningBidId: leadingBid!.id,
        reserveMet: true,
        closedAt: now,
        version: sql`${auctions.version} + 1`,
        updatedAt: now,
      })
      .where(eq(auctions.id, auctionId));

    await tx
      .update(bids)
      .set({ status: "winning" })
      .where(eq(bids.id, leadingBid!.id));

    // The winner's deposit is consumed by the purchase rather than refunded.
    await captureHold(tx, winnerId, auctionId);

    const orderId = `ord_${nanoid(16)}`;
    await tx.insert(orders).values({
      id: orderId,
      auctionId,
      buyerId: winnerId,
      sellerId: auction.sellerId,
      hammerPriceCents,
      buyersPremiumCents,
      totalCents,
      status: "awaiting_payment",
    });

    await tx.insert(auctionEvents).values({
      id: `evt_${nanoid(18)}`,
      auctionId,
      type: "lot_sold",
      actorId: null,
      payload: { winnerId, hammerPriceCents, totalCents, orderId },
    });

    await tx.insert(notifications).values([
      {
        id: `ntf_${nanoid(18)}`,
        userId: winnerId,
        type: "won",
        title: "You won the lot",
        body: `${auction.title} is yours at ${(hammerPriceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
        href: `/orders/${orderId}`,
        payload: { auctionId, orderId },
      },
      {
        id: `ntf_${nanoid(18)}`,
        userId: auction.sellerId,
        type: "sold",
        title: "Your lot sold",
        body: `${auction.title} hammered at ${(hammerPriceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}.`,
        href: `/orders/${orderId}`,
        payload: { auctionId, orderId },
      },
    ]);

    // Everyone who chased the lot and lost gets their deposit back.
    await releaseLosingDeposits(tx, auctionId, winnerId);

    return { auctionId, outcome: "sold", winnerId, hammerPriceCents, orderId };
  });
}

/** Return holds to every bidder on a lot except the winner. */
async function releaseLosingDeposits(tx: Tx, auctionId: string, winnerId: string) {
  const losers = await tx
    .selectDistinct({ bidderId: bids.bidderId })
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId), ne(bids.bidderId, winnerId)));
  for (const loser of losers) {
    await releaseHold(tx, loser.bidderId, auctionId);
  }
}

/**
 * Close every lot whose time has passed.
 *
 * This is the safety net, not the primary path: if the worker was down when a
 * lot should have ended, the next sweep settles it. Because `closeAuction` is
 * idempotent, running this alongside the scheduler is harmless.
 */
export async function sweepDueAuctions(limit = 100): Promise<CloseResult[]> {
  const due = await db
    .select({ id: auctions.id })
    .from(auctions)
    .where(
      and(
        sql`${auctions.status} in ('live','ending')`,
        sql`${auctions.endsAt} <= now()`,
      ),
    )
    .limit(limit);

  const results: CloseResult[] = [];
  for (const row of due) {
    try {
      results.push(await closeAuction(row.id));
    } catch (error) {
      results.push({ auctionId: row.id, outcome: "not_due" });
      console.error(`[sweep] failed to close ${row.id}`, error);
    }
  }
  return results;
}

/** Promote scheduled lots whose start time has arrived. */
export async function openDueAuctions(): Promise<string[]> {
  const opened = await db
    .update(auctions)
    .set({ status: "live", updatedAt: new Date() })
    .where(and(eq(auctions.status, "scheduled"), sql`${auctions.startsAt} <= now()`))
    .returning({ id: auctions.id });
  return opened.map((r) => r.id);
}

/* ========================================================================== */
/* Buy It Now                                                                 */
/* ========================================================================== */

/**
 * Take the lot off the market at the seller's fixed price.
 *
 * Offered only while the lot is untouched: once the room has started bidding,
 * the price belongs to the room, and letting someone jump the queue would make
 * every standing proxy bid meaningless.
 */
export async function buyNow(input: {
  auctionId: string;
  buyerId: string;
}): Promise<
  | { ok: true; orderId: string; totalCents: number }
  | { ok: false; reason: string; message: string }
> {
  const { auctionId, buyerId } = input;

  return db.transaction(async (tx) => {
    const [auction] = await tx
      .select()
      .from(auctions)
      .where(eq(auctions.id, auctionId))
      .for("update")
      .limit(1);

    if (!auction) return { ok: false as const, reason: "not_found", message: "Lot not found." };
    if (auction.sellerId === buyerId) {
      return { ok: false as const, reason: "seller", message: "You cannot buy your own lot." };
    }
    if (!auction.buyNowPriceCents) {
      return { ok: false as const, reason: "unavailable", message: "This lot has no Buy Now price." };
    }
    if (auction.status !== "live" && auction.status !== "scheduled") {
      return { ok: false as const, reason: "not_open", message: "This lot is closed." };
    }
    if (auction.bidCount > 0) {
      return {
        ok: false as const,
        reason: "bidding_started",
        message: "Buy Now is no longer available — bidding has started on this lot.",
      };
    }

    const hammerPriceCents = auction.buyNowPriceCents;
    const buyersPremiumCents = applyBps(hammerPriceCents, auction.buyersPremiumBps);
    const totalCents = hammerPriceCents + buyersPremiumCents;

    const wallet = await ensureWallet(tx, buyerId);
    if (wallet.availableCents < totalCents) {
      return {
        ok: false as const,
        reason: "insufficient_funds",
        message: "Your balance does not cover this purchase.",
      };
    }

    const now = new Date();
    await tx
      .update(auctions)
      .set({
        status: "sold",
        winnerId: buyerId,
        currentPriceCents: hammerPriceCents,
        reserveMet: true,
        closedAt: now,
        version: sql`${auctions.version} + 1`,
        updatedAt: now,
      })
      .where(eq(auctions.id, auctionId));

    const orderId = `ord_${nanoid(16)}`;
    await tx.insert(orders).values({
      id: orderId,
      auctionId,
      buyerId,
      sellerId: auction.sellerId,
      hammerPriceCents,
      buyersPremiumCents,
      totalCents,
      status: "awaiting_payment",
    });

    await tx.insert(auctionEvents).values({
      id: `evt_${nanoid(18)}`,
      auctionId,
      type: "buy_now",
      actorId: buyerId,
      payload: { totalCents, orderId },
    });

    return { ok: true as const, orderId, totalCents };
  });
}

/* ========================================================================== */
/* Settlement                                                                 */
/* ========================================================================== */

/** Pay for a won lot: buyer's wallet -> seller's wallet, minus platform fee. */
export async function payOrder(orderId: string, payerId: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for("update")
      .limit(1);

    if (!order) return { ok: false as const, message: "Order not found." };
    if (order.buyerId !== payerId) return { ok: false as const, message: "Not your order." };
    if (order.status !== "awaiting_payment") {
      return { ok: false as const, message: "This order has already been paid." };
    }

    // The deposit was captured at hammer time, so only the remainder is due.
    const { debit } = await import("../wallet/ledger");
    const dueCents = order.totalCents;

    try {
      await debit(tx, payerId, dueCents, {
        kind: "withdrawal",
        memo: `Payment for order ${orderId}`,
        refType: "order",
        refId: orderId,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return { ok: false as const, message: "Insufficient balance to settle this order." };
      }
      throw error;
    }

    await credit(tx, order.sellerId, order.hammerPriceCents, {
      kind: "sale_proceeds",
      memo: `Proceeds from order ${orderId}`,
      refType: "order",
      refId: orderId,
    });

    await tx
      .update(orders)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, orderId));

    await tx.insert(notifications).values({
      id: `ntf_${nanoid(18)}`,
      userId: order.sellerId,
      type: "payment_received",
      title: "Payment received",
      body: "Your buyer has settled. Time to ship.",
      href: `/orders/${orderId}`,
      payload: { orderId },
    });

    return { ok: true as const, orderId };
  });
}

/** Watch / unwatch a lot, returning the new state. */
export async function toggleWatch(userId: string, auctionId: string) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(watchlist)
      .where(and(eq(watchlist.userId, userId), eq(watchlist.auctionId, auctionId)))
      .limit(1);

    if (existing) {
      await tx
        .delete(watchlist)
        .where(and(eq(watchlist.userId, userId), eq(watchlist.auctionId, auctionId)));
      await tx
        .update(auctions)
        .set({ watchCount: sql`greatest(0, ${auctions.watchCount} - 1)` })
        .where(eq(auctions.id, auctionId));
      return { watching: false };
    }

    await tx.insert(watchlist).values({ userId, auctionId }).onConflictDoNothing();
    await tx
      .update(auctions)
      .set({ watchCount: sql`${auctions.watchCount} + 1` })
      .where(eq(auctions.id, auctionId));
    return { watching: true };
  });
}
