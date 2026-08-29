import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * A single long-lived pool. Next dev-mode hot reloads re-evaluate modules, so
 * the pool is stashed on globalThis to avoid leaking a connection pool per
 * reload until Postgres refuses new clients.
 */
const globalForDb = globalThis as unknown as { __auctioneerPool?: Pool };

export const pool =
  globalForDb.__auctioneerPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__auctioneerPool = pool;

export const db = drizzle(pool, { schema });

export type Database = typeof db;
export { schema };
