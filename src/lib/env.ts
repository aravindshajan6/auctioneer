/**
 * Validated environment. Importing this module fails fast and loudly at boot
 * rather than surfacing as an undefined-URL error deep inside a request.
 */
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6380"),
  BETTER_AUTH_SECRET: z.string().min(16),
  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("auctioneer-media"),
  S3_ACCESS_KEY_ID: z.string().default("auctioneer"),
  S3_SECRET_ACCESS_KEY: z.string().default("auctioneer-secret"),
  S3_PUBLIC_URL: z.string().default("http://localhost:9000/auctioneer-media"),
  ANTISNIPE_WINDOW_SECONDS: z.coerce.number().int().positive().default(120),
  ANTISNIPE_EXTENSION_SECONDS: z.coerce.number().int().positive().default(120),
  /** Ceiling on total soft-close overtime, so a lot cannot run forever. */
  ANTISNIPE_MAX_EXTENSIONS: z.coerce.number().int().positive().default(30),
  BUYERS_PREMIUM_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
});

/**
 * The subset that carries no secrets and has a safe default for every field.
 *
 * Kept separate because a BUILD must never require runtime secrets. The
 * house-rules page is statically prerendered and needs only the auction
 * tuning values; if it read the full schema, `next build` would demand
 * BETTER_AUTH_SECRET and DATABASE_URL — which would mean handing production
 * credentials to CI just to compile a page of prose.
 */
const settingsSchema = schema.pick({
  ANTISNIPE_WINDOW_SECONDS: true,
  ANTISNIPE_EXTENSION_SECONDS: true,
  ANTISNIPE_MAX_EXTENSIONS: true,
  BUYERS_PREMIUM_BPS: true,
});

let cachedSettings: z.infer<typeof settingsSchema> | null = null;

/** Auction tuning only. Safe to call at build time. */
export function settings(): z.infer<typeof settingsSchema> {
  if (!cachedSettings) cachedSettings = settingsSchema.parse(process.env);
  return cachedSettings;
}

/**
 * Parsed lazily so that importing a module that touches `env` from a client
 * bundle does not explode — only server code ever reads these.
 */
let cached: z.infer<typeof schema> | null = null;

export function env(): z.infer<typeof schema> {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nDid you copy .env.example to .env?`,
    );
  }
  cached = parsed.data;
  return cached;
}
