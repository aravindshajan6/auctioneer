"use client";

import { useEffect } from "react";
import type { LotBidPayload, LotStatePayload } from "@/lib/realtime/events";
import { useRealtimeStore } from "@/lib/realtime/store";
import { useLotRoom } from "@/lib/realtime/use-socket";

/**
 * Joins the lot's room and seeds the store with the server's truth.
 *
 * Seeding is version-guarded rather than unconditional: a bid can commit
 * between the server rendering this page and the browser mounting it, and the
 * newer socket state must not be overwritten by the page it raced. Bids are
 * merged for the same reason.
 */
export function LotLiveSync({
  auctionId,
  state,
  bids,
  join = true,
}: {
  auctionId: string;
  state: LotStatePayload;
  bids: LotBidPayload["bid"][];
  /** Set false when an ancestor already holds the room open for this lot. */
  join?: boolean;
}) {
  useLotRoom(join ? auctionId : null);

  useEffect(() => {
    const store = useRealtimeStore.getState();
    const existing = store.lots[auctionId];
    if (existing?.state && existing.state.version >= state.version) return;

    const merged = [...bids];
    for (const bid of existing?.bids ?? []) {
      if (!merged.some((b) => b.id === bid.id)) merged.push(bid);
    }
    merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    store.seedLot(auctionId, state, merged.slice(0, 80));
  }, [auctionId, state, bids]);

  return null;
}
