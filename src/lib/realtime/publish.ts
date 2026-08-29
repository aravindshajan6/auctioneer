// Deliberately NOT marked `server-only`: the gateway and scheduler import this
// directly, outside Next's bundler, where the `server-only` guard resolves to
// its client build and throws at require time. Server-only-ness is enforced
// instead by this module never being reachable from a "use client" boundary.
import Redis from "ioredis";
import { REALTIME_CHANNEL, type RealtimeMessage } from "./events";

/**
 * Publishes realtime messages onto Redis for the gateway to fan out.
 *
 * Route handlers run inside Next and have no handle on the Socket.IO server,
 * so the two talk over Redis. That indirection is also what lets the web tier
 * and the gateway scale to separate processes without changing this call site.
 */
const globalForRedis = globalThis as unknown as { __auctioneerPub?: Redis };

function publisher(): Redis {
  if (!globalForRedis.__auctioneerPub) {
    globalForRedis.__auctioneerPub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6380", {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    globalForRedis.__auctioneerPub.on("error", (err) => {
      console.error("[realtime] redis publisher error", err.message);
    });
  }
  return globalForRedis.__auctioneerPub;
}

/**
 * Fire-and-forget: a failed broadcast must never fail the bid that caused it.
 * The database is already committed and the client gets the authoritative
 * result in the HTTP response; the socket is an accelerator, not the contract.
 */
export function publishRealtime(message: RealtimeMessage): void {
  try {
    publisher()
      .publish(REALTIME_CHANNEL, JSON.stringify(message))
      .catch((err) => console.error("[realtime] publish failed", err?.message));
  } catch (err) {
    console.error("[realtime] publish threw", (err as Error).message);
  }
}
