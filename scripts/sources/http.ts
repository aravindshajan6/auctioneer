/**
 * A shared, polite HTTP client for the museum APIs.
 *
 * Each institution publishes a different limit — the Met allows 80 requests a
 * second, the Art Institute only 60 a minute — so the seed throttles per host
 * rather than globally, and identifies itself where the institution asks.
 * Going faster than a museum's published limit to populate a demo catalogue
 * would be rude and would get the IP blocked for everyone on it.
 */
const MIN_INTERVAL_MS: Record<string, number> = {
  "api.artic.edu": 1_100, // 60/min documented -> ~1 request/second, with headroom
  "collectionapi.metmuseum.org": 60, // 80/sec documented -> far below it
  "api.vam.ac.uk": 250,
  "openlibrary.org": 350,
  default: 300,
};

const lastCall = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pace(host: string) {
  const gap = MIN_INTERVAL_MS[host] ?? MIN_INTERVAL_MS.default;
  const previous = lastCall.get(host) ?? 0;
  const wait = previous + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(host, Date.now());
}

export class SourceUnavailableError extends Error {}

/**
 * Fetch JSON with pacing, a timeout, and one retry on a transient failure.
 * Throws `SourceUnavailableError` so the seed can fall back to generated
 * content instead of dying when a museum is down or the machine is offline.
 */
export async function getJson<T>(url: string, attempt = 0): Promise<T> {
  const host = new URL(url).host;
  await pace(host);
  try {
    const res = await fetch(url, {
      headers: {
        // The Art Institute asks for this as a courtesy so they can identify
        // heavy clients; harmless everywhere else.
        "AIC-User-Agent": "auctioneer-demo (seed script)",
        "User-Agent": "auctioneer-demo/1.0 (open-access catalogue seed)",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 || res.status >= 500) {
      throw new SourceUnavailableError(`${host} responded ${res.status}`);
    }
    if (!res.ok) throw new SourceUnavailableError(`${host} responded ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (attempt < 1) {
      await sleep(1_500);
      return getJson<T>(url, attempt + 1);
    }
    throw new SourceUnavailableError(`${url} failed: ${(err as Error).message}`);
  }
}

/** Download a binary asset. Returns null rather than throwing on failure. */
export async function getBytes(url: string): Promise<Uint8Array | null> {
  try {
    await pace(new URL(url).host);
    const res = await fetch(url, {
      headers: { "User-Agent": "auctioneer-demo/1.0 (open-access catalogue seed)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}
