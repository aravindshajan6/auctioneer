import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./index";

/**
 * The signed-in user for the current request, or null.
 *
 * Wrapped in `cache` so that a layout, a page and three server components can
 * each ask for the session and only one lookup happens per request.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function requireUser() {
  const session = await getSession();
  if (!session?.user) throw new Error("UNAUTHORIZED");
  return session.user;
}
