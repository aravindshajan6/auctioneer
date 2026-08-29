import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auctions, bids, user } from "@/lib/db/schema";
import { placeBid } from "@/lib/auction/engine";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, clientIp, handleRouteError } from "@/lib/api";
import { publishRealtime } from "@/lib/realtime/publish";
import { lotRoom, userRoom } from "@/lib/realtime/events";
import { parseToCents } from "@/lib/auction/money";

const BodySchema = z.object({
  /** Accepts cents directly, or a human string like "1,250.00". */
  amountCents: z.number().int().positive().optional(),
  amount: z.string().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

/** Maps an engine rejection onto an HTTP status the client can act on. */
const STATUS: Record<string, number> = {
  auction_not_found: 404,
  not_open: 409,
  not_started: 409,
  already_ended: 409,
  seller_cannot_bid: 403,
  below_minimum: 422,
  not_a_raise: 422,
  insufficient_funds: 402,
  account_suspended: 403,
};

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in to bid.", 401);

    const { id } = await ctx.params;
    const parsed = BodySchema.parse(await request.json());

    const maxAmountCents =
      parsed.amountCents ?? (parsed.amount ? parseToCents(parsed.amount) : null);
    if (!maxAmountCents || maxAmountCents <= 0) {
      return apiError("invalid_request", "Enter a bid amount.", 422);
    }

    const result = await placeBid({
      auctionId: id,
      bidderId: session.user.id,
      maxAmountCents,
      idempotencyKey: parsed.idempotencyKey,
      ipAddress: clientIp(request),
    });

    if (!result.ok) {
      return apiError(result.reason, result.message, STATUS[result.reason] ?? 400, {
        minimumNextBidCents: result.minimumNextBidCents,
        requiredCents: result.requiredCents,
        availableCents: result.availableCents,
      });
    }

    // Broadcast the committed outcome. Everything below is best-effort: the
    // bidder already has the authoritative answer in this response.
    await fanOutBid(id, result);

    return apiOk({ ...result, endsAt: result.endsAt.toISOString() });
  } catch (error) {
    return handleRouteError(error);
  }
}

async function fanOutBid(
  auctionId: string,
  result: Extract<Awaited<ReturnType<typeof placeBid>>, { ok: true }>,
) {
  const [lot] = await db.select().from(auctions).where(eq(auctions.id, auctionId)).limit(1);
  if (!lot) return;

  const [leader] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, result.leaderId))
    .limit(1);

  publishRealtime({
    room: lotRoom(auctionId),
    event: "lot:state",
    payload: {
      auctionId,
      slug: lot.slug,
      status: lot.status,
      currentPriceCents: result.currentPriceCents,
      minimumNextBidCents: result.minimumNextBidCents,
      bidCount: result.bidCount,
      bidderCount: lot.bidderCount,
      leaderId: result.leaderId,
      leaderName: leader?.name ?? null,
      reserveMet: result.reserveMet,
      endsAt: result.endsAt.toISOString(),
      version: result.version,
    },
  });

  // Replay the newest visible bids so late joiners and the activity feed agree.
  const recent = await db
    .select({
      id: bids.id,
      bidderId: bids.bidderId,
      amountCents: bids.amountCents,
      type: bids.type,
      createdAt: bids.createdAt,
      bidderName: user.name,
    })
    .from(bids)
    .innerJoin(user, eq(bids.bidderId, user.id))
    .where(eq(bids.auctionId, auctionId))
    .orderBy(bids.createdAt)
    .limit(200);

  const newest = recent[recent.length - 1];
  if (newest) {
    publishRealtime({
      room: lotRoom(auctionId),
      event: "lot:bid",
      payload: {
        auctionId,
        bid: {
          id: newest.id,
          bidderId: newest.bidderId,
          bidderName: newest.bidderName,
          amountCents: newest.amountCents,
          type: newest.type,
          createdAt: newest.createdAt.toISOString(),
        },
        outbidBidderId: result.outbidBidderId,
      },
    });
  }

  if (result.extended) {
    publishRealtime({
      room: lotRoom(auctionId),
      event: "lot:extended",
      payload: {
        auctionId,
        endsAt: result.endsAt.toISOString(),
        extensionCount: lot.extensionCount,
        reason: "anti_snipe",
      },
    });
  }

  if (result.outbidBidderId) {
    publishRealtime({
      room: userRoom(result.outbidBidderId),
      event: "notify",
      payload: {
        id: `outbid_${auctionId}_${Date.now()}`,
        type: "outbid",
        title: "You have been outbid",
        body: lot.title,
        href: `/lot/${lot.slug}`,
        createdAt: new Date().toISOString(),
      },
    });
  }
}
