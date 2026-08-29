/**
 * Applies the SQL migrations in ./drizzle.
 *
 * This exists so that `drizzle-kit` — 31MB of tooling that drags in a
 * vulnerable esbuild — can stay a devDependency. Generating migrations is a
 * development act; applying them is a runtime one, and only the latter needs to
 * happen inside the container. The migrator itself ships with drizzle-orm.
 *
 * Safe to re-run: drizzle records every applied hash in __drizzle_migrations
 * and skips what it has already run.
 *
 * Baselining an existing database (one whose schema was created by an earlier
 * `drizzle-kit push`) is handled by BASELINE=1, which marks the migrations as
 * applied without executing them.
 */
import "dotenv/config";
import path from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const folder = path.join(process.cwd(), "drizzle");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function baseline() {
  // Drizzle keys applied migrations by the SHA-256 of the raw SQL file.
  await db.execute(sql`create schema if not exists drizzle`);
  await db.execute(sql`
    create table if not exists drizzle."__drizzle_migrations" (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
  const files = readdirSync(folder).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const body = readFileSync(path.join(folder, file), "utf8");
    const hash = createHash("sha256").update(body).digest("hex");
    await db.execute(sql`
      insert into drizzle."__drizzle_migrations" (hash, created_at)
      select ${hash}, ${Date.now()}
      where not exists (
        select 1 from drizzle."__drizzle_migrations" where hash = ${hash}
      )
    `);
    console.log(`  baselined ${file}`);
  }
}

async function main() {
  if (process.env.BASELINE === "1") {
    console.log("Baselining an already-provisioned database (no SQL executed):");
    await baseline();
  } else {
    await migrate(db, { migrationsFolder: folder });
    console.log("Migrations applied.");
  }
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
