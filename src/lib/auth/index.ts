import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "../db";
import * as schema from "../db/schema";

/**
 * Server-side auth instance. Also consumed by the realtime gateway, which
 * validates the session cookie on the socket handshake — see
 * `server/realtime.ts`.
 */
export const auth = betterAuth({
  appName: "Auctioneer",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),

  /**
   * Better Auth rejects cross-origin auth requests outright. Without this, the
   * app works on the exact BETTER_AUTH_URL and 403s everywhere else — a
   * different port, a LAN address, a preview deploy — with a bare 403 that
   * looks like a credentials failure rather than a config one.
   */
  trustedOrigins: [
    process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    ...(process.env.NODE_ENV !== "production"
      ? ["http://localhost:3000", "http://localhost:3100", "http://127.0.0.1:3000"]
      : []),
  ].filter((v, i, a) => a.indexOf(v) === i),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // No mail server in local development; verification is opt-in per deploy.
    requireEmailVerification: false,
  },

  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "bidder", input: false },
      handle: { type: "string", required: false, input: true },
      bio: { type: "string", required: false, input: true },
      location: { type: "string", required: false, input: true },
      sellerVerified: { type: "boolean", required: false, defaultValue: false, input: false },
      ratingAvg: { type: "number", required: false, defaultValue: 0, input: false },
      ratingCount: { type: "number", required: false, defaultValue: 0, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh the cookie at most daily
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  // Must stay last: it lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
export type AuthUser = Session["user"];
