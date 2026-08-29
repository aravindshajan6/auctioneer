import type { LotDetail } from "@/lib/queries";
import type { LotBidPayload, LotStatePayload } from "@/lib/realtime/events";
import type { BidPanelLot } from "./bid-panel";

/**
 * The server/client boundary for a lot.
 *
 * Two pages hand the same lot to the same panel, and both must serialise it
 * identically — dates as ISO strings, money untouched as integer cents. Doing
 * it in one place means a field added to the panel cannot be forgotten on one
 * of the routes.
 */

/** Retracted bids are struck from the record the room sees. */
export function visibleHistory(lot: LotDetail) {
  return lot.history.filter((bid) => bid.status !== "retracted");
}

export function toSeedBids(lot: LotDetail): LotBidPayload["bid"][] {
  return visibleHistory(lot).map((bid) => ({
    id: bid.id,
    bidderId: bid.bidderId,
    bidderName: bid.bidderName,
    amountCents: bid.amountCents,
    type: bid.type,
    createdAt: bid.createdAt.toISOString(),
  }));
}

export function toSeedState(lot: LotDetail): LotStatePayload {
  return {
    auctionId: lot.id,
    slug: lot.slug,
    status: lot.status,
    currentPriceCents: lot.currentPriceCents,
    minimumNextBidCents: lot.minimumNextBidCents,
    bidCount: lot.bidCount,
    bidderCount: lot.bidderCount,
    leaderId: lot.leaderId,
    leaderName:
      visibleHistory(lot).find((bid) => bid.bidderId === lot.leaderId)?.bidderName ?? null,
    reserveMet: lot.reserveMet,
    endsAt: lot.endsAt.toISOString(),
    version: lot.version,
  };
}

export function toPanelLot(lot: LotDetail): BidPanelLot {
  return {
    id: lot.id,
    slug: lot.slug,
    title: lot.title,
    status: lot.status,
    startingPriceCents: lot.startingPriceCents,
    currentPriceCents: lot.currentPriceCents,
    minimumNextBidCents: lot.minimumNextBidCents,
    buyNowPriceCents: lot.buyNowPriceCents,
    buyersPremiumBps: lot.buyersPremiumBps,
    bidCount: lot.bidCount,
    bidderCount: lot.bidderCount,
    hasReserve: lot.hasReserve,
    reserveMet: lot.reserveMet,
    startsAt: lot.startsAt.toISOString(),
    endsAt: lot.endsAt.toISOString(),
    extensionCount: lot.extensionCount,
    leaderId: lot.leaderId,
    yourMaxCents: lot.yourMaxCents,
    watching: lot.watching,
    version: lot.version,
  };
}
