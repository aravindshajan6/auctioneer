"use client";

import { create } from "zustand";
import type {
  ChatMessagePayload,
  LotBidPayload,
  LotClosedPayload,
  LotStatePayload,
} from "./events";

/**
 * Live auction state, held OUTSIDE the React tree.
 *
 * Bids arrive several times a second on a busy lot. Threading that through
 * component state would re-render every subscriber — including the WebGL
 * canvas, which must never re-render for a price change. Components subscribe
 * to the exact slice they draw.
 */
interface LotLiveState {
  state: LotStatePayload | null;
  bids: LotBidPayload["bid"][];
  chat: ChatMessagePayload[];
  viewers: number;
  closed: LotClosedPayload | null;
  /** Bumped on every accepted bid so views can flash without diffing prices. */
  pulse: number;
}

interface RealtimeStore {
  lots: Record<string, LotLiveState>;
  connected: boolean;
  serverTimeOffset: number;

  setConnected: (connected: boolean) => void;
  setServerTime: (now: number) => void;
  seedLot: (auctionId: string, state: LotStatePayload, bids: LotBidPayload["bid"][]) => void;
  applyState: (p: LotStatePayload) => void;
  applyBid: (p: LotBidPayload) => void;
  applyClosed: (p: LotClosedPayload) => void;
  applyChat: (p: ChatMessagePayload) => void;
  setViewers: (auctionId: string, count: number) => void;
}

const emptyLot = (): LotLiveState => ({
  state: null,
  bids: [],
  chat: [],
  viewers: 0,
  closed: null,
  pulse: 0,
});

/**
 * The single shared value returned for a lot nobody has published state for.
 *
 * This MUST be a stable reference. Zustand compares selector results with
 * `Object.is`, so a selector that builds a fresh object every call reports a
 * change on every render and React re-renders until it throws "Maximum update
 * depth exceeded". A catalogue page mounts two dozen of these before any
 * socket data arrives, so allocating here took the whole page down.
 */
const EMPTY_LOT: LotLiveState = Object.freeze({
  state: null,
  bids: [],
  chat: [],
  viewers: 0,
  closed: null,
  pulse: 0,
});

export const useRealtimeStore = create<RealtimeStore>((set) => ({
  lots: {},
  connected: false,
  serverTimeOffset: 0,

  setConnected: (connected) => set({ connected }),
  setServerTime: (now) => set({ serverTimeOffset: now - Date.now() }),

  seedLot: (auctionId, state, bids) =>
    set((s) => ({
      lots: {
        ...s.lots,
        [auctionId]: { ...emptyLot(), ...s.lots[auctionId], state, bids },
      },
    })),

  applyState: (p) =>
    set((s) => {
      const current = s.lots[p.auctionId] ?? emptyLot();
      // Messages can arrive out of order after a reconnect; the engine's
      // monotonic version is the tiebreak, never arrival time.
      if (current.state && p.version < current.state.version) return s;
      return { lots: { ...s.lots, [p.auctionId]: { ...current, state: p } } };
    }),

  applyBid: (p) =>
    set((s) => {
      const current = s.lots[p.auctionId] ?? emptyLot();
      if (current.bids.some((b) => b.id === p.bid.id)) return s;
      return {
        lots: {
          ...s.lots,
          [p.auctionId]: {
            ...current,
            // Newest first, and bounded so a long sale cannot grow forever.
            bids: [p.bid, ...current.bids].slice(0, 80),
            pulse: current.pulse + 1,
          },
        },
      };
    }),

  applyClosed: (p) =>
    set((s) => {
      const current = s.lots[p.auctionId] ?? emptyLot();
      return { lots: { ...s.lots, [p.auctionId]: { ...current, closed: p } } };
    }),

  applyChat: (p) =>
    set((s) => {
      const current = s.lots[p.auctionId] ?? emptyLot();
      if (current.chat.some((c) => c.id === p.id)) return s;
      return {
        lots: { ...s.lots, [p.auctionId]: { ...current, chat: [...current.chat, p].slice(-120) } },
      };
    }),

  setViewers: (auctionId, count) =>
    set((s) => {
      const current = s.lots[auctionId] ?? emptyLot();
      return { lots: { ...s.lots, [auctionId]: { ...current, viewers: count } } };
    }),
}));

/** Subscribe to a single lot's live slice. */
export function useLotLive(auctionId: string | null): LotLiveState {
  return useRealtimeStore((s) => (auctionId ? (s.lots[auctionId] ?? EMPTY_LOT) : EMPTY_LOT));
}
