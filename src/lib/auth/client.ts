"use client";

import { createAuthClient } from "better-auth/react";

/**
 * No `baseURL`: the client talks to whatever origin the page was served from.
 *
 * Pinning it to NEXT_PUBLIC_APP_URL makes every session request cross-origin
 * the moment the app is reached by any other host — a LAN address while
 * testing on a phone, 127.0.0.1 instead of localhost, a preview deployment —
 * and Better Auth answers those without CORS headers, so the browser blocks
 * them and the user appears signed out. Same-origin is always correct here.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
