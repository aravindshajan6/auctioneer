/**
 * Adversarial concurrency check against a real Postgres.
 *
 * Fires many simultaneous bids at one lot and asserts the invariants that a
 * naive read-modify-write implementation would violate: a single leader, a
 * monotonically rising price never exceeding the winner's ceiling, and a bid
 * count that matches what was actually accepted.
 *
 *   npx tsx scripts/concurrency-check.ts
 */
import "dotenv/config";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, pool } from "../src/lib/db";
import { auctions, bids, user, wallets, ledgerEntries, bidDeposits } from "../src/lib/db/schema";
import { placeBid } from "../src/lib/auction/engine";
import { credit } from "../src/lib/wallet/ledger";

const $ = (d: number) => Math.round(d * 100);
let failures = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures += 1;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m ${detail}`);
  }
}

async function main() {
  const run = nanoid(6);
  console.log(`\n\x1b[1mConcurrency check (run ${run})\x1b[0m\n`);

  /* -- Fixtures ------------------------------------------------------- */
  const sellerId = `u_seller_${run}`;
  await db.insert(user).values({
    id: sellerId,
    name: "Seller",
    email: `seller-${run}@test.local`,
    role: "seller",
  });

  const BIDDERS = 24;
  const bidderIds: string[] = [];
  for (let i = 0; i < BIDDERS; i++) {
    const id = `u_bidder_${run}_${i}`;
    bidderIds.push(id);
    await db.insert(user).values({
      id,
      name: `Bidder ${i}`,
      email: `bidder-${run}-${i}@test.local`,
      role: "bidder",
    });
    await db.transaction(async (tx) => {
      await credit(tx, id, $(1_000_000), { kind: "deposit", memo: "test float" });
    });
  }

  const auctionId = `a_${run}`;
  const now = new Date();
  await db.insert(auctions).values({
    id: auctionId,
    slug: `test-lot-${run}`,
    sellerId,
    title: "Concurrency Test Lot",
    type: "timed",
    status: "live",
    startingPriceCents: $(100),
    reservePriceCents: null,
    currentPriceCents: $(100),
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 3_600_000),
    originalEndsAt: new Date(now.getTime() + 3_600_000),
  });

  /* -- Storm 1: everyone bids a distinct ceiling, all at once ---------- */
  console.log("Storm 1 — 24 bidders, distinct ceilings, fired simultaneously");
  const ceilings = bidderIds.map((_, i) => $(200 + i * 137));
  const results = await Promise.all(
    bidderIds.map((id, i) =>
      placeBid({ auctionId, bidderId: id, maxAmountCents: ceilings[i] }).catch((e) => ({
        ok: false as const,
        reason: "threw" as const,
        message: String(e?.message ?? e),
      })),
    ),
  );

  const accepted = results.filter((r) => r.ok);
  const rejected = results.filter((r) => !r.ok);
  const threw = rejected.filter((r) => "reason" in r && r.reason === "threw");
  console.log(`  accepted=${accepted.length} rejected=${rejected.length} threw=${threw.length}`);
  if (threw.length) console.log(`    first throw: ${(threw[0] as any).message}`);

  check("no bid crashed with an unhandled error", threw.length === 0);
  check("at least one bid was accepted", accepted.length > 0);

  /* -- Invariants ------------------------------------------------------ */
  const [lot] = await db.select().from(auctions).where(eq(auctions.id, auctionId));
  const [top] = await db
    .select()
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId), ne(bids.status, "retracted")))
    .orderBy(desc(bids.maxAmountCents), bids.createdAt)
    .limit(1);

  const highestCeiling = Math.max(...ceilings);
  const expectedWinner = bidderIds[ceilings.indexOf(highestCeiling)];

  check(
    "the highest ceiling holds the lot",
    top?.bidderId === expectedWinner,
    `expected ${expectedWinner}, got ${top?.bidderId}`,
  );
  check(
    "price never exceeds the winning ceiling",
    lot.currentPriceCents <= highestCeiling,
    `price=${lot.currentPriceCents} ceiling=${highestCeiling}`,
  );
  check(
    "price is at least the starting price",
    lot.currentPriceCents >= $(100),
    `price=${lot.currentPriceCents}`,
  );

  const winningRows = await db
    .select()
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId), eq(bids.status, "winning")));
  check(
    "exactly one bid row is marked winning",
    winningRows.length === 1,
    `found ${winningRows.length}`,
  );

  const allBids = await db.select().from(bids).where(eq(bids.auctionId, auctionId));
  check(
    "bid_count matches persisted bid rows",
    lot.bidCount === allBids.length,
    `counter=${lot.bidCount} rows=${allBids.length}`,
  );

  const distinctBidders = new Set(allBids.map((b) => b.bidderId)).size;
  check(
    "bidder_count matches distinct bidders",
    lot.bidderCount === distinctBidders,
    `counter=${lot.bidderCount} actual=${distinctBidders}`,
  );

  check(
    "version was bumped once per accepted round",
    lot.version === accepted.length,
    `version=${lot.version} accepted=${accepted.length}`,
  );

  /* -- Deposit integrity ----------------------------------------------- */
  const heldDeposits = await db
    .select()
    .from(bidDeposits)
    .where(and(eq(bidDeposits.auctionId, auctionId), eq(bidDeposits.status, "held")));
  check(
    "only the leader still holds a deposit",
    heldDeposits.length === 1 && heldDeposits[0].userId === expectedWinner,
    `held=${heldDeposits.length} by=${heldDeposits.map((d) => d.userId).join(",")}`,
  );

  /* -- Ledger integrity: cache must equal replayed ledger --------------- */
  let ledgerMismatches = 0;
  for (const id of bidderIds) {
    const [w] = await db.select().from(wallets).where(eq(wallets.userId, id));
    const [sum] = await db
      .select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountCents}),0)` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.walletId, w.id));
    // The signed ledger tracks total claim (available + held), not available.
    if (Number(sum.total) !== w.availableCents + w.heldCents) ledgerMismatches += 1;
  }
  check(
    "every wallet's cached balances equal its replayed ledger",
    ledgerMismatches === 0,
    `${ledgerMismatches} wallets drifted`,
  );

  /* -- Storm 2: idempotency under retry --------------------------------- */
  console.log("\nStorm 2 — the same bid submitted 10x with one idempotency key");
  const key = `idem_${run}`;
  const retryBidder = bidderIds[0];
  const before = (await db.select().from(bids).where(eq(bids.auctionId, auctionId))).length;
  const retries = await Promise.all(
    Array.from({ length: 10 }, () =>
      placeBid({
        auctionId,
        bidderId: retryBidder,
        maxAmountCents: highestCeiling + $(5_000),
        idempotencyKey: key,
      }).catch((e) => ({ ok: false as const, message: String(e?.message ?? e) })),
    ),
  );
  const after = (await db.select().from(bids).where(eq(bids.auctionId, auctionId))).length;
  const keyed = await db
    .select()
    .from(bids)
    .where(and(eq(bids.auctionId, auctionId), eq(bids.idempotencyKey, key)));

  console.log(`  bid rows: ${before} -> ${after}; rows carrying the key: ${keyed.length}`);
  check("a retried bid is recorded at most once", keyed.length <= 1, `found ${keyed.length}`);
  check("all retries returned a result", retries.every((r) => "ok" in r));

  /* -- Cleanup ---------------------------------------------------------- */
  await db.delete(auctions).where(eq(auctions.id, auctionId));
  for (const id of [...bidderIds, sellerId]) {
    await db.delete(user).where(eq(user.id, id));
  }

  console.log(
    failures === 0
      ? "\n\x1b[32m\x1b[1mAll concurrency invariants held.\x1b[0m\n"
      : `\n\x1b[31m\x1b[1m${failures} invariant(s) violated.\x1b[0m\n`,
  );
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
