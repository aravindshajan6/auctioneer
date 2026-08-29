/**
 * The realtime contract shared by the browser and the gateway.
 *
 * Writes never travel over the socket. A bid is an HTTP POST — it needs
 * authentication, idempotency and a transaction — and the socket exists only
 * to fan the *result* out to everyone watching. That split keeps the
 * authoritative path auditable and lets the gateway scale independently.
 */

export interface LotStatePayload {
  auctionId: string;
  slug: string;
  status: "scheduled" | "live" | "ending" | "sold" | "passed" | "cancelled" | "draft";
  currentPriceCents: number;
  minimumNextBidCents: number;
  bidCount: number;
  bidderCount: number;
  leaderId: string | null;
  leaderName: string | null;
  reserveMet: boolean;
  endsAt: string;
  version: number;
}

export interface LotBidPayload {
  auctionId: string;
  bid: {
    id: string;
    bidderId: string;
    bidderName: string;
    amountCents: number;
    type: "manual" | "proxy" | "buy_now";
    createdAt: string;
  };
  /** Present when this bid displaced someone, so their client can react. */
  outbidBidderId: string | null;
}

export interface LotExtendedPayload {
  auctionId: string;
  endsAt: string;
  extensionCount: number;
  reason: "anti_snipe";
}

export interface LotClosedPayload {
  auctionId: string;
  outcome: "sold" | "passed";
  winnerId: string | null;
  winnerName: string | null;
  hammerPriceCents: number;
  orderId?: string;
}

export interface ViewersPayload {
  auctionId: string;
  count: number;
}

export interface ChatMessagePayload {
  auctionId: string;
  id: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
}

/** Events the gateway pushes to browsers. */
export interface ServerToClientEvents {
  "lot:state": (p: LotStatePayload) => void;
  "lot:bid": (p: LotBidPayload) => void;
  "lot:extended": (p: LotExtendedPayload) => void;
  "lot:closed": (p: LotClosedPayload) => void;
  "lot:viewers": (p: ViewersPayload) => void;
  "chat:message": (p: ChatMessagePayload) => void;
  notify: (p: NotificationPayload) => void;
  /** Server clock, so countdowns do not drift with the client's system time. */
  "server:time": (p: { now: number }) => void;
}

/** Events browsers send to the gateway. Read-only subscriptions and chat. */
export interface ClientToServerEvents {
  "lot:join": (auctionId: string) => void;
  "lot:leave": (auctionId: string) => void;
  "chat:send": (p: { auctionId: string; body: string }) => void;
  ping: (cb: (now: number) => void) => void;
}

export const lotRoom = (auctionId: string) => `lot:${auctionId}`;
export const userRoom = (userId: string) => `user:${userId}`;

/** Redis channel the app publishes to and the gateway relays from. */
export const REALTIME_CHANNEL = "auctioneer:realtime";

/** Envelope carried over Redis pub/sub between the app and the gateway. */
export type RealtimeMessage =
  | { room: string; event: "lot:state"; payload: LotStatePayload }
  | { room: string; event: "lot:bid"; payload: LotBidPayload }
  | { room: string; event: "lot:extended"; payload: LotExtendedPayload }
  | { room: string; event: "lot:closed"; payload: LotClosedPayload }
  | { room: string; event: "chat:message"; payload: ChatMessagePayload }
  | { room: string; event: "notify"; payload: NotificationPayload };
