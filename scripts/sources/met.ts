import { getJson } from "./http";
import type { SourceObject } from "./types";

/**
 * The Metropolitan Museum of Art — Open Access.
 * No key; the documentation asks for no more than 80 requests a second.
 * Data is CC0; images are only reusable where `isPublicDomain` is true, which
 * is why every object is filtered on that flag rather than on having an image.
 */
const BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

interface MetSearch {
  total: number;
  objectIDs: number[] | null;
}

interface MetObject {
  objectID: number;
  title: string;
  artistDisplayName: string;
  objectDate: string;
  medium: string;
  dimensions: string;
  creditLine: string;
  isPublicDomain: boolean;
  primaryImage: string;
  primaryImageSmall: string;
  additionalImages: string[];
  objectURL: string;
  classification: string;
}

/** The Met's derivative path for an image served from `/original/`. */
function webLarge(url: string): string {
  return url.replace("/original/", "/web-large/");
}

export async function fetchMet(
  opts: { departmentId: number; query?: string; want: number },
): Promise<SourceObject[]> {
  const q = opts.query ? encodeURIComponent(opts.query) : "*";
  const search = await getJson<MetSearch>(
    `${BASE}/search?departmentId=${opts.departmentId}&hasImages=true&q=${q}`,
  );
  const ids = search.objectIDs ?? [];
  const out: SourceObject[] = [];

  // Walk the result list until enough public-domain records are collected;
  // `hasImages` does not imply the image is free to reuse.
  for (const id of ids) {
    if (out.length >= opts.want) break;
    let obj: MetObject;
    try {
      obj = await getJson<MetObject>(`${BASE}/objects/${id}`);
    } catch {
      continue;
    }
    if (!obj.isPublicDomain || !obj.primaryImage || !obj.title) continue;

    out.push({
      externalId: `met-${obj.objectID}`,
      title: obj.title.trim(),
      maker: obj.artistDisplayName?.trim() || null,
      dateText: obj.objectDate?.trim() || null,
      medium: obj.medium?.trim() || null,
      dimensions: obj.dimensions?.trim() || null,
      provenance: null, // The Met does not publish provenance through this API.
      creditLine: obj.creditLine?.trim() || null,
      // Web-sized, never the master file. The Met serves `primaryImage` as the
      // full archival scan — 8 MB for a single painting — while the web-large
      // derivative of the same image is ~265 KB and indistinguishable at the
      // sizes a catalogue renders. `additionalImages` only ever gives the
      // original, so it is rewritten onto the same derivative path.
      images: [
        obj.primaryImageSmall || webLarge(obj.primaryImage),
        ...(obj.additionalImages ?? []).map(webLarge),
      ]
        .filter(Boolean)
        .slice(0, 3),
      sourceName: "The Metropolitan Museum of Art",
      sourceUrl: obj.objectURL,
      sourceLicense: "CC0 1.0",
    });
  }
  return out;
}
