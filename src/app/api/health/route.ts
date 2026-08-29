import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * Liveness and readiness in one cheap endpoint.
 *
 * The container HEALTHCHECK hits this, so it has to be honest about the two
 * things that make the app useless when they are down — Postgres and Redis —
 * without being expensive enough that polling it every 30s costs anything.
 * No auth: it reveals only whether dependencies answer.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, "ok" | "down"> = {};

  try {
    await db.execute(sql`select 1`);
    checks.postgres = "ok";
  } catch {
    checks.postgres = "down";
  }

  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await client.connect();
    await client.ping();
    await client.quit();
    checks.redis = "ok";
  } catch {
    checks.redis = "down";
  }

  const healthy = Object.values(checks).every((v) => v === "ok");
  return Response.json(
    { status: healthy ? "ok" : "degraded", checks, at: new Date().toISOString() },
    { status: healthy ? 200 : 503 },
  );
}
