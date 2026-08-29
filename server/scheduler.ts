/**
 * Auction scheduler.
 *
 * A lot ends at a wall-clock time, so something must notice. The naive fix is
 * an in-process `setTimeout` per lot — which loses every pending close on
 * restart, on deploy, or on crash. Instead the database is the schedule: a
 * tick asks "what is due?" and settles it. Restart-safe by construction, and a
 * lot whose end time passed while the process was down is settled by the very
 * next tick.
 *
 * Soft-close extensions need no special handling: they move `ends_at`, and the
 * next tick simply does not select the row.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { auctions, bids, user } from "../src/lib/db/schema";
import { closeAuction, openDueAuctions, sweepDueAuctions } from "../src/lib/auction/engine";
import { publishRealtime } from "../src/lib/realtime/publish";
import { lotRoom, userRoom } from "../src/lib/realtime/events";

const TICK_MS = 1_000;

export function startScheduler() {
  let running = false;
  let stopped = false;

  async function tick() {
    // Ticks never overlap: a slow sweep must not stack a second sweep behind
    // it and double the load at exactly the worst moment.
    if (running || stopped) return;
    running = true;
    try {
      const opened = await openDueAuctions();
      for (const id of opened) await announceState(id);

      // SKIP LOCKED lets several app instances sweep concurrently: each takes
      // a disjoint slice instead of all of them blocking on the same rows.
      const due = await db
        .select({ id: auctions.id })
        .from(auctions)
        .where(
          and(
            sql`${auctions.status} in ('live','ending')`,
            sql`${auctions.endsAt} <= now()`,
          ),
        )
        .orderBy(auctions.endsAt)
        .for("update", { skipLocked: true })
        .limit(50);

      for (const row of due) {
        const result = await closeAuction(row.id);
        if (result.outcome === "sold" || result.outcome === "passed") {
          await announceClose(row.id, result);
        }
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  }

  const handle = setInterval(tick, TICK_MS);
  // Catch up on anything that ended while the process was down.
  void sweepDueAuctions().then((r) => {
    const settled = r.filter((x) => x.outcome === "sold" || x.outcome === "passed");
    if (settled.length) console.log(`[scheduler] caught up ${settled.length} overdue lot(s)`);
  });

  console.log(`[scheduler] ticking every ${TICK_MS}ms`);

  return () => {
    stopped = true;
    clearInterval(handle);
  };
}

async function announceState(auctionId: string) {
  const [lot] = await db.select().from(auctions).where(eq(auctions.id, auctionId)).limit(1);
  if (!lot) return;
  publishRealtime({
    room: lotRoom(auctionId),
    event: "lot:state",
    payload: {
      auctionId,
      slug: lot.slug,
      status: lot.status,
      currentPriceCents: lot.currentPriceCents,
      minimumNextBidCents: lot.currentPriceCents,
      bidCount: lot.bidCount,
      bidderCount: lot.bidderCount,
      leaderId: null,
      leaderName: null,
      reserveMet: lot.reserveMet,
      endsAt: lot.endsAt.toISOString(),
      version: lot.version,
    },
  });
}

async function announceClose(
  auctionId: string,
  result: { outcome: string; winnerId?: string; hammerPriceCents?: number; orderId?: string },
) {
  const [lot] = await db.select().from(auctions).where(eq(auctions.id, auctionId)).limit(1);
  if (!lot) return;

  let winnerName: string | null = null;
  if (result.winnerId) {
    const [w] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, result.winnerId))
      .limit(1);
    winnerName = w?.name ?? null;
  }

  publishRealtime({
    room: lotRoom(auctionId),
    event: "lot:closed",
    payload: {
      auctionId,
      outcome: result.outcome === "sold" ? "sold" : "passed",
      winnerId: result.winnerId ?? null,
      winnerName,
      hammerPriceCents: result.hammerPriceCents ?? lot.currentPriceCents,
      orderId: result.orderId,
    },
  });

  // Nudge the two people who care most, wherever they are in the app.
  for (const uid of [result.winnerId, lot.sellerId].filter(Boolean) as string[]) {
    publishRealtime({
      room: userRoom(uid),
      event: "notify",
      payload: {
        id: `live_${auctionId}_${uid}`,
        type: result.outcome === "sold" ? (uid === result.winnerId ? "won" : "sold") : "passed",
        title:
          result.outcome !== "sold"
            ? "Lot passed"
            : uid === result.winnerId
              ? "You won the lot"
              : "Your lot sold",
        body: lot.title,
        href: result.orderId ? `/orders/${result.orderId}` : `/lot/${lot.slug}`,
        createdAt: new Date().toISOString(),
      },
    });
  }
}
