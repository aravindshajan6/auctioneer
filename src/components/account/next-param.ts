/**
 * Where to land somebody after they authenticate.
 *
 * `?next=` is attacker-controllable, so it is treated as untrusted input: only
 * a single-slash, same-origin path survives. Without the `//` and `\\` checks
 * an open redirect turns our sign-in page into a convincing launchpad for a
 * phishing site.
 */
export function safeNext(
  raw: string | string[] | undefined,
  fallback = "/explore",
): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
