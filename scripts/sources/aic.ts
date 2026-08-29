import { getJson } from "./http";
import type { SourceObject } from "./types";

/**
 * The Art Institute of Chicago.
 * No key; 60 requests a minute for anonymous clients. Most fields are CC0,
 * but artwork *descriptions* are CC-BY, so the credit is not optional here.
 *
 * Uniquely among the sources, AIC publishes real provenance chains, which is
 * the one field an auction catalogue cannot convincingly invent.
 */
const BASE = "https://api.artic.edu/api/v1";

const FIELDS = [
  "id",
  "title",
  "artist_display",
  "date_display",
  "medium_display",
  "dimensions",
  "provenance_text",
  "credit_line",
  "image_id",
  "is_public_domain",
].join(",");

interface AicResponse {
  data: Array<{
    id: number;
    title: string;
    artist_display: string | null;
    date_display: string | null;
    medium_display: string | null;
    dimensions: string | null;
    provenance_text: string | null;
    credit_line: string | null;
    image_id: string | null;
    is_public_domain: boolean;
  }>;
  config: { iiif_url: string };
}

export async function fetchAic(opts: { query: string; want: number }): Promise<SourceObject[]> {
  // One request for the whole page: the tight rate limit makes per-object
  // lookups expensive, and the search endpoint can return every field we need.
  const url =
    `${BASE}/artworks/search?q=${encodeURIComponent(opts.query)}` +
    `&query[term][is_public_domain]=true&limit=${Math.min(opts.want * 3, 100)}&fields=${FIELDS}`;
  const res = await getJson<AicResponse>(url);
  const iiif = res.config?.iiif_url ?? "https://www.artic.edu/iiif/2";

  return res.data
    .filter((a) => a.is_public_domain && a.image_id && a.title)
    .slice(0, opts.want)
    .map((a) => ({
      externalId: `aic-${a.id}`,
      title: a.title.trim(),
      // "James McNeill Whistler\nAmerican, 1834-1903" -> just the name.
      maker: a.artist_display?.split("\n")[0]?.trim() || null,
      dateText: a.date_display?.trim() || null,
      medium: a.medium_display?.trim() || null,
      dimensions: a.dimensions?.trim() || null,
      provenance: a.provenance_text?.trim() || null,
      creditLine: a.credit_line?.trim() || null,
      // IIIF lets one URL serve both the card and the detail view.
      images: [
        `${iiif}/${a.image_id}/full/1200,/0/default.jpg`,
        `${iiif}/${a.image_id}/full/843,/0/default.jpg`,
      ],
      sourceName: "The Art Institute of Chicago",
      sourceUrl: `https://www.artic.edu/artworks/${a.id}`,
      sourceLicense: "CC0 1.0 (descriptions CC-BY 4.0)",
    }));
}
