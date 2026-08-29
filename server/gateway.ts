/**
 * The realtime gateway.
 *
 * Responsibilities, deliberately narrow:
 *   1. authenticate a socket from the session cookie at handshake time
 *   2. let clients subscribe to lot rooms and receive fan-out
 *   3. relay messages the web tier publishes on Redis
 *   4. maintain live viewer counts
 *
 * It never writes to the auction tables. Every state change enters through the
 * HTTP path and arrives here as an already-committed fact.
 */
import type { Server as HttpServer } from "node:http";
import { Server as IOServer, type Socket } from "socket.io";
import { fromNodeHeaders } from "better-auth/node";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { nanoid } from "nanoid";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { chatMessages } from "../src/lib/db/schema";
import {
  REALTIME_CHANNEL,
  lotRoom,
  userRoom,
  type ClientToServerEvents,
  type RealtimeMessage,
  type ServerToClientEvents,
} from "../src/lib/realtime/events";

interface SocketData {
  userId: string | null;
  userName: string | null;
  rooms: Set<string>;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/** Simple sliding-window limiter so one client cannot flood a room. */
class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  allow(key: string): boolean {
    const now = Date.now();
    const times = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (times.length >= this.limit) {
      this.hits.set(key, times);
      return false;
    }
    times.push(now);
    this.hits.set(key, times);
    return true;
  }
}

export function attachGateway(httpServer: HttpServer, redisUrl: string) {
  const io = new IOServer<ClientToServerEvents, ServerToClientEvents, never, SocketData>(
    httpServer,
    {
      // Deliberately NOT under /api: Next's upgrade handler terminates any
      // upgrade whose path matches a route it can serve, so a gateway path
      // that collides with an App Router route silently kills every socket.
      path: "/ws",
      serveClient: false,
      // Poll first, then upgrade: works behind proxies that buffer WebSockets.
      transports: ["polling", "websocket"],
      pingInterval: 25_000,
      pingTimeout: 20_000,
      // engine.io otherwise destroys any upgrade it does not recognise after
      // ~1s — which kills Next's own HMR socket during a slow cold compile.
      destroyUpgrade: false,
      connectionStateRecovery: {
        maxDisconnectionDuration: 120_000,
        // Default is `true`, which would let a signed-out or banned user
        // resume their previous identity without re-authenticating.
        skipMiddlewares: false,
      },
      // Browsers do not apply CORS to same-origin requests, which is how the
      // app itself connects. Reflecting the origin in development keeps the
      // gateway reachable from a LAN address or 127.0.0.1 while still
      // restricting it to the configured origin in production.
      cors: {
        origin:
          process.env.NODE_ENV === "production"
            ? (process.env.NEXT_PUBLIC_APP_URL ?? false)
            : true,
        credentials: true,
      },
    },
  );

  /* -- Horizontal scale: rooms span every gateway process. --------------- */
  const pubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  /* -- Handshake auth. --------------------------------------------------- */
  // Anonymous sockets are allowed: browsing a live lot should not require an
  // account. Identity only gates chat and user-scoped notifications.
  io.use(async (socket, next) => {
    socket.data.rooms = new Set();
    socket.data.userId = null;
    socket.data.userName = null;
    try {
      if (socket.handshake.headers.cookie) {
        const session = await auth.api.getSession({
          headers: fromNodeHeaders(socket.handshake.headers),
        });
        if (session?.user) {
          socket.data.userId = session.user.id;
          socket.data.userName = session.user.name;
        }
      }
    } catch (err) {
      // A bad cookie downgrades you to anonymous; it does not drop the socket.
      console.warn("[gateway] session lookup failed:", (err as Error).message);
    }
    next();
  });

  const chatLimiter = new RateLimiter(5, 10_000);
  const joinLimiter = new RateLimiter(60, 60_000);

  async function broadcastViewers(auctionId: string) {
    const room = lotRoom(auctionId);
    const count = (await io.in(room).fetchSockets()).length;
    io.to(room).emit("lot:viewers", { auctionId, count });
  }

  io.on("connection", (socket: AppSocket) => {
    if (socket.data.userId) socket.join(userRoom(socket.data.userId));
    socket.emit("server:time", { now: Date.now() });

    socket.on("ping", (cb) => {
      if (typeof cb === "function") cb(Date.now());
    });

    socket.on("lot:join", async (auctionId) => {
      if (typeof auctionId !== "string" || auctionId.length > 64) return;
      if (!joinLimiter.allow(socket.id)) return;
      socket.join(lotRoom(auctionId));
      socket.data.rooms.add(auctionId);
      await broadcastViewers(auctionId);
    });

    socket.on("lot:leave", async (auctionId) => {
      if (typeof auctionId !== "string") return;
      socket.leave(lotRoom(auctionId));
      socket.data.rooms.delete(auctionId);
      await broadcastViewers(auctionId);
    });

    socket.on("chat:send", async ({ auctionId, body }) => {
      if (!socket.data.userId || !socket.data.userName) return;
      if (typeof body !== "string") return;
      const text = body.trim().slice(0, 280);
      if (!text) return;
      if (!chatLimiter.allow(socket.data.userId)) return;

      const message = {
        id: `msg_${nanoid(16)}`,
        auctionId,
        userId: socket.data.userId,
        body: text,
      };
      try {
        await db.insert(chatMessages).values(message);
      } catch (err) {
        console.error("[gateway] chat persist failed", (err as Error).message);
        return;
      }
      io.to(lotRoom(auctionId)).emit("chat:message", {
        ...message,
        userName: socket.data.userName,
        createdAt: new Date().toISOString(),
      });
    });

    socket.on("disconnecting", () => {
      for (const auctionId of socket.data.rooms) {
        // Fire after the socket actually leaves so the count excludes it.
        setTimeout(() => void broadcastViewers(auctionId), 0);
      }
    });
  });

  /* -- Relay: web tier -> Redis -> every gateway -> browsers. ------------- */
  const relay = new Redis(redisUrl, { maxRetriesPerRequest: null });
  relay.subscribe(REALTIME_CHANNEL, (err) => {
    if (err) console.error("[gateway] failed to subscribe:", err.message);
    else console.log(`[gateway] relaying ${REALTIME_CHANNEL}`);
  });
  relay.on("message", (_channel, raw) => {
    try {
      const message = JSON.parse(raw) as RealtimeMessage;
      io.to(message.room).emit(message.event, message.payload as never);
    } catch (err) {
      console.error("[gateway] bad relay payload", (err as Error).message);
    }
  });

  // Keeps client countdowns anchored to server time rather than device clocks.
  const clock = setInterval(() => io.emit("server:time", { now: Date.now() }), 30_000);

  async function shutdown() {
    clearInterval(clock);
    await Promise.allSettled([
      io.close(),
      relay.quit(),
      pubClient.quit(),
      subClient.quit(),
    ]);
  }

  return { io, shutdown };
}
