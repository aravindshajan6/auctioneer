/**
 * Custom Next.js server.
 *
 * Next is mounted as the request handler on a plain Node HTTP server so that
 * Socket.IO can share the same port and the same origin — which means the
 * session cookie is sent on the socket handshake with no CORS or token
 * plumbing. The auction scheduler runs in this process too.
 */
import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { attachGateway } from "./gateway";
import { startScheduler } from "./scheduler";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "localhost";
const port = Number(process.env.PORT ?? 3000);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

async function main() {
  const app = next({ dev, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();

  const httpServer = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[http] request failed", err);
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  });

  // Socket.IO must be attached AFTER the request listener exists: engine.io's
  // attach() calls removeAllListeners("request") and re-dispatches only to the
  // listeners it captured at that moment.
  const gateway = attachGateway(httpServer, redisUrl);

  // Next owns its own upgrades (HMR in dev). engine.io ignores paths that are
  // not /ws, and Next ignores paths it cannot match, so the two coexist.
  // Note: Next 16 serves HMR from /_next/hmr, not the old /_next/webpack-hmr.
  const nextUpgrade = app.getUpgradeHandler();
  httpServer.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (pathname.startsWith("/_next")) void nextUpgrade(req, socket, head);
  });
  const stopScheduler = startScheduler();

  // A failed listen must kill the process. Without this it surfaces as an
  // uncaughtException and leaves a half-alive server: schedulers ticking and
  // Redis subscribed, but nothing serving — which reads as "it started fine".
  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n[server] port ${port} is already in use. Stop the other process or set PORT.\n`);
    } else {
      console.error("[server] fatal listen error", err);
    }
    process.exit(1);
  });

  httpServer.listen(port, () => {
    console.log(`\n  ▲ Auctioneer ready on http://${hostname}:${port}`);
    console.log(`  ◆ realtime gateway on /ws`);
    console.log(`  ◷ scheduler running\n`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    // A second Ctrl-C should kill immediately rather than restart the dance.
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log(`\n[server] ${signal} received, shutting down`);

    // The hard deadline is armed FIRST and deliberately not unref'd: if any
    // step below hangs, the process still dies. An orphan holding the port is
    // worse than an ungraceful exit.
    const deadline = setTimeout(() => {
      console.error("[server] shutdown timed out, forcing exit");
      process.exit(1);
    }, 8_000);

    try {
      stopScheduler();
      httpServer.close();
      // Keep-alive and WebSocket connections keep `close()` pending forever,
      // so drop them explicitly instead of waiting on idle clients.
      httpServer.closeAllConnections();
      await gateway.shutdown();
    } catch (err) {
      console.error("[server] error during shutdown", err);
    } finally {
      clearTimeout(deadline);
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
