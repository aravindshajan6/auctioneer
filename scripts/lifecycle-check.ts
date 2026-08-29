/**
 * End-to-end lifecycle check against a real Postgres.
 *
 * Covers the paths the unit tests cannot: soft-close extension, settlement,
 * reserve-not-met, deposit release/capture, order creation, and the idempotency
 * of closing a lot twice.
 *
 *   npx tsx scripts/lifecycle-check.ts
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, pool } from "../src/lib/db";
import {
  auctions,
  bidDeposits,
  bids,
  ledgerEntries,
  notifications,
  orders,
  user,
  wallets,
} from "../src/lib/db/schema";
import { buyNow, closeAuction, placeBid } from "../src/lib/auction/engine";
import { credit } from "../src/lib/wallet/ledger";

const $ = (d: number) => Math.round(d * 100);
let failures = 0;
const made: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  else {
    failures++;
    console.log(`  \x1b[31m✗ ${label}\x1b[0m ${detail}`);
  }
}

async function mkUser(tag: string, fundCents: number) {
  const id = `u_${tag}_${nanoid(6)}`;
  await db.insert(user).values({ id, name: tag, email: `${id}@test.local` });
  if (fundCents > 0) {
    await db.transaction((tx) => credit(tx, id, fundCents, { kind: "deposit", memo: "test" }));
  }
  made.push(id);
  return id;
}

async function mkLot(sellerId: string, opts: Partial<typeof auctions.$inferInsert> = {}) {
  const id = `a_${nanoid(10)}`;
  const now = new Date();
  await db.insert(auctions).values({
    id,
    slug: `lifecycle-${nanoid(8)}`,
    sellerId,
    title: "Lifecycle Test Lot",
    type: "timed",
    status: "live",
    startingPriceCents: $(100),
    currentPriceCents: $(100),
    startsAt: new Date(now.getTime() - 60_000),
    endsAt: new Date(now.getTime() + 3_600_000),
    originalEndsAt: new Date(now.getTime() + 3_600_000),
    ...opts,
  });
  return id;
}

async function main() {
  console.log("\n\x1b[1mAuction lifecycle check\x1b[0m\n");

  /* ================= 1. Sale, settlement, deposits ================= */
  console.log("1 — A lot that sells");
  {
    const seller = await mkUser("seller", 0);
    const alice = await mkUser("alice", $(50_000));
    const bob = await mkUser("bob", $(50_000));
    const lot = await mkLot(seller);

    await placeBid({ auctionId: lot, bidderId: alice, maxAmountCents: $(500) });
    await placeBid({ auctionId: lot, bidderId: bob, maxAmountCents: $(1_200) });

    const heldBefore = await db
      .select()
      .from(bidDeposits)
      .where(and(eq(bidDeposits.auctionId, lot), eq(bidDeposits.status, "held")));
    check("only the leader holds a deposit while live", heldBefore.length === 1 && heldBefore[0].userId === bob,
      `held by ${heldBefore.map((h) => h.userId).join(",")}`);

    // Force the clock past the end and settle.
    await db.update(auctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(auctions.id, lot));
    const result = await closeAuction(lot);

    check("lot closes as sold", result.outcome === "sold", JSON.stringify(result));
    check("the highest ceiling wins", result.winnerId === bob, `winner=${result.winnerId}`);

    const [order] = await db.select().from(orders).where(eq(orders.auctionId, lot));
    check("an order is raised for the winner", Boolean(order) && order.buyerId === bob);
    if (order) {
      const expectedPremium = Math.round((order.hammerPriceCents * 1000) / 10_000);
      check("buyer's premium is 10% of hammer",
        order.buyersPremiumCents === expectedPremium,
        `${order.buyersPremiumCents} vs ${expectedPremium}`);
      check("total = hammer + premium",
        order.totalCents === order.hammerPriceCents + order.buyersPremiumCents);
    }

    const deposits = await db.select().from(bidDeposits).where(eq(bidDeposits.auctionId, lot));
    const winnerDep = deposits.find((d) => d.userId === bob);
    const loserDep = deposits.find((d) => d.userId === alice);
    check("winner's deposit is captured", winnerDep?.status === "captured", `${winnerDep?.status}`);
    check("loser's deposit is released", !loserDep || loserDep.status === "released", `${loserDep?.status}`);

    const notes = await db.select().from(notifications).where(eq(notifications.userId, bob));
    check("winner is notified", notes.some((n) => n.type === "won"));

    // Closing twice must not raise a second order.
    const again = await closeAuction(lot);
    const orderCount = await db.select().from(orders).where(eq(orders.auctionId, lot));
    check("closing an already-closed lot is a no-op",
      again.outcome === "already_closed" && orderCount.length === 1,
      `${again.outcome}, orders=${orderCount.length}`);
  }

  /* ================= 2. Reserve not met ================= */
  console.log("\n2 — A lot that fails its reserve");
  {
    const seller = await mkUser("seller2", 0);
    const carol = await mkUser("carol", $(50_000));
    const lot = await mkLot(seller, { reservePriceCents: $(5_000) });

    await placeBid({ auctionId: lot, bidderId: carol, maxAmountCents: $(800) });
    await db.update(auctions).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(auctions.id, lot));
    const result = await closeAuction(lot);

    check("lot passes when the reserve is unmet", result.outcome === "passed", JSON.stringify(result));
    const ord = await db.select().from(orders).where(eq(orders.auctionId, lot));
    check("no order is raised for a passed lot", ord.length === 0);
    const deps = await db.select().from(bidDeposits).where(eq(bidDeposits.auctionId, lot));
    check("the underbidder's deposit is returned",
      deps.every((d) => d.status === "released"), deps.map((d) => d.status).join(","));

    const [w] = await db.select().from(wallets).where(eq(wallets.userId, carol));
    check("their balance is whole again", w.availableCents === $(50_000) && w.heldCents === 0,
      `available=${w.availableCents} held=${w.heldCents}`);
  }

  /* ================= 3. Reserve met mid-auction ================= */
  console.log("\n3 — A reserve met by a proxy ceiling");
  {
    const seller = await mkUser("seller3", 0);
    const dave = await mkUser("dave", $(500_000));
    const lot = await mkLot(seller, { reservePriceCents: $(1_000) });

    const r = await placeBid({ auctionId: lot, bidderId: dave, maxAmountCents: $(3_000) });
    check("reserve is reported met", r.ok && r.reserveMet, JSON.stringify(r));
    check("the ask jumps to the reserve", r.ok && r.currentPriceCents === $(1_000),
      r.ok ? `price=${r.currentPriceCents}` : "");
  }

  /* ================= 4. Anti-snipe soft close ================= */
  console.log("\n4 — Anti-snipe soft close");
  {
    const seller = await mkUser("seller4", 0);
    const eve = await mkUser("eve", $(50_000));
    const frank = await mkUser("frank", $(50_000));
    // 30 seconds left: inside the default 120s window.
    const lot = await mkLot(seller, { endsAt: new Date(Date.now() + 30_000) });

    const before = (await db.select().from(auctions).where(eq(auctions.id, lot)))[0];
    await placeBid({ auctionId: lot, bidderId: eve, maxAmountCents: $(400) });
    const r = await placeBid({ auctionId: lot, bidderId: frank, maxAmountCents: $(900) });
    const after = (await db.select().from(auctions).where(eq(auctions.id, lot)))[0];

    check("a late bid extends the clock", r.ok && r.extended === true, JSON.stringify(r));
    check("ends_at actually moved", after.endsAt.getTime() > before.endsAt.getTime(),
      `${before.endsAt.toISOString()} -> ${after.endsAt.toISOString()}`);
    check("the extension is recorded", after.extensionCount > 0, `count=${after.extensionCount}`);
    check("original end time is preserved for display",
      after.originalEndsAt.getTime() === before.originalEndsAt.getTime());
    check("status reflects the closing window", after.status === "ending", after.status);

    // A lot mid-extension must NOT be closed by a stale timer.
    const premature = await closeAuction(lot);
    check("a stale close is refused while time remains", premature.outcome === "not_due", premature.outcome);

    /* -- The stall exploit: raising your own ceiling must not buy time. --- */
    const beforeRaise = (await db.select().from(auctions).where(eq(auctions.id, lot)))[0];
    await placeBid({ auctionId: lot, bidderId: frank, maxAmountCents: $(50_000) });
    const afterRaise = (await db.select().from(auctions).where(eq(auctions.id, lot)))[0];
    check(
      "the leader raising their own maximum does not extend the clock",
      afterRaise.endsAt.getTime() === beforeRaise.endsAt.getTime(),
      `${beforeRaise.endsAt.toISOString()} -> ${afterRaise.endsAt.toISOString()}`,
    );

    /* -- Overtime is bounded. --------------------------------------------- */
    const seller4b = await mkUser("seller4b", 0);
    const cappedLot = await mkLot(seller4b, {
      endsAt: new Date(Date.now() + 10_000),
      // Already at the ceiling configured by ANTISNIPE_MAX_EXTENSIONS.
      extensionCount: 30,
    });
    const judy = await mkUser("judy", $(50_000));
    const atCap = await placeBid({ auctionId: cappedLot, bidderId: judy, maxAmountCents: $(900) });
    const cappedAfter = (await db.select().from(auctions).where(eq(auctions.id, cappedLot)))[0];
    check(
      "overtime stops once the extension cap is reached",
      atCap.ok && atCap.extended === false && cappedAfter.extensionCount === 30,
      JSON.stringify(atCap),
    );
  }

  /* ================= 5. Guards ================= */
  console.log("\n5 — Guards");
  {
    const seller = await mkUser("seller5", $(50_000));
    const grace = await mkUser("grace", $(10));
    const lot = await mkLot(seller);

    const own = await placeBid({ auctionId: lot, bidderId: seller, maxAmountCents: $(500) });
    check("a seller cannot bid on their own lot",
      !own.ok && own.reason === "seller_cannot_bid", JSON.stringify(own));

    const broke = await placeBid({ auctionId: lot, bidderId: grace, maxAmountCents: $(10_000) });
    check("a bid beyond the bidder's balance is refused",
      !broke.ok && broke.reason === "insufficient_funds", JSON.stringify(broke));

    // Solvency is checked before proxy resolution, so this bidder needs enough
    // to cover the deposit or we would be re-testing insufficient_funds.
    const solvent = await mkUser("solvent", $(5_000));
    const low = await placeBid({ auctionId: lot, bidderId: solvent, maxAmountCents: $(1) });
    check("a bid below the starting price is refused",
      !low.ok && low.reason === "below_minimum", JSON.stringify(low));

    await db.update(auctions).set({ status: "sold" }).where(eq(auctions.id, lot));
    const closed = await placeBid({ auctionId: lot, bidderId: grace, maxAmountCents: $(5_000) });
    check("a closed lot refuses bids", !closed.ok && closed.reason === "not_open", JSON.stringify(closed));
  }

  /* ================= 5b. A price never goes backwards ================= */
  console.log("\n5b — A bid can never lower the ask");
  {
    const seller = await mkUser("seller5b", 0);
    const kate = await mkUser("kate", $(500_000));
    const liam = await mkUser("liam", $(500_000));
    const lot = await mkLot(seller);

    await placeBid({ auctionId: lot, bidderId: kate, maxAmountCents: $(1_000) });
    await placeBid({ auctionId: lot, bidderId: liam, maxAmountCents: $(9_000) });

    /* Simulate a bid history thinner than the recorded price — the shape left
       behind when bids vanish under a live lot (a purged account, a partial
       restore). Before the clamp, the next bid resolved from the surviving
       ladder and the ask visibly fell while telling the bidder they had won. */
    await db
      .update(auctions)
      .set({ currentPriceCents: $(50_000) })
      .where(eq(auctions.id, lot));

    const r = await placeBid({ auctionId: lot, bidderId: kate, maxAmountCents: $(60_000) });
    const [after] = await db.select().from(auctions).where(eq(auctions.id, lot));
    check(
      "a bid resolved from a thinner ladder cannot lower the ask",
      after.currentPriceCents >= $(50_000),
      `ask fell to ${after.currentPriceCents / 100}`,
    );
    check("the bid is still accepted", r.ok, JSON.stringify(r));
  }

  /* ================= 6. Buy Now ================= */
  console.log("\n6 — Buy It Now");
  {
    const seller = await mkUser("seller6", 0);
    const heidi = await mkUser("heidi", $(50_000));
    const ivan = await mkUser("ivan", $(50_000));
    const lot = await mkLot(seller, { buyNowPriceCents: $(2_000) });

    const bought = await buyNow({ auctionId: lot, buyerId: heidi });
    check("buy now succeeds on an untouched lot", bought.ok, JSON.stringify(bought));
    const [l] = await db.select().from(auctions).where(eq(auctions.id, lot));
    check("the lot is marked sold", l.status === "sold" && l.winnerId === heidi);

    // And it must be unavailable once bidding has begun.
    const lot2 = await mkLot(seller, { buyNowPriceCents: $(2_000) });
    await placeBid({ auctionId: lot2, bidderId: ivan, maxAmountCents: $(300) });
    const late = await buyNow({ auctionId: lot2, buyerId: heidi });
    check("buy now closes once the room has started bidding",
      !late.ok && late.reason === "bidding_started", JSON.stringify(late));
  }

  /* ================= 7. Ledger integrity ================= */
  console.log("\n7 — Ledger integrity across every account touched");
  {
    let drift = 0;
    for (const id of made) {
      const [w] = await db.select().from(wallets).where(eq(wallets.userId, id));
      if (!w) continue;
      const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.walletId, w.id));
      // amountCents tracks the wallet's TOTAL claim, so the cache to compare
      // against is available + held, not available alone.
      const sum = entries.reduce((acc, e) => acc + e.amountCents, 0);
      const cached = w.availableCents + w.heldCents;
      if (sum !== cached) {
        drift++;
        console.log(`     drift on ${id}: cache=${cached} ledger=${sum}`);
      }
      if (w.availableCents < 0 || w.heldCents < 0) {
        drift++;
        console.log(`     negative balance on ${id}`);
      }
    }
    check("every wallet reconciles against its ledger and stays non-negative", drift === 0);
  }

  /* -- Cleanup -- */
  for (const id of made) await db.delete(user).where(eq(user.id, id));

  console.log(
    failures === 0
      ? "\n\x1b[32m\x1b[1mLifecycle intact — all checks passed.\x1b[0m\n"
      : `\n\x1b[31m\x1b[1m${failures} check(s) failed.\x1b[0m\n`,
  );
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
