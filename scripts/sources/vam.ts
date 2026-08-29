import { getJson } from "./http";
import type { SourceObject } from "./types";

/**
 * The Victoria and Albert Museum.
 * No key. This is the only source that covers the departments the fine-art
 * museums do not — wristwatches, jewellery, silver, furniture, ceramics —
 * which is precisely where our catalogue would otherwise be thin.
 */
const BASE = "https://api.vam.ac.uk/v2";

interface VamSearch {
  records: Array<{
    systemNumber: string;
    _primaryTitle: string;
    objectType: string;
    _primaryDate: string | null;
    _primaryMaker: { name: string | null } | null;
    _primaryImageId: string | null;
    _images?: { _iiif_image_base_url?: string };
  }>;
}

interface VamRecord {
  record?: {
    systemNumber: string;
    titles?: Array<{ title: string }>;
    objectType?: string;
    materialsAndTechniques?: string;
    dimensions?: Array<{ dimension: string; value: string; unit: string }>;
    summaryDescription?: string;
    creditLine?: string;
  };
}

export async function fetchVam(opts: { query: string; want: number }): Promise<SourceObject[]> {
  const search = await getJson<VamSearch>(
    `${BASE}/objects/search?q=${encodeURIComponent(opts.query)}&images_exist=1&page_size=${Math.min(
      opts.want * 2,
      50,
    )}`,
  );

  const out: SourceObject[] = [];
  for (const r of search.records) {
    if (out.length >= opts.want) break;
    const iiif = r._images?._iiif_image_base_url;
    if (!iiif || !(r._primaryTitle || r.objectType)) continue;

    // The search payload omits materials and dimensions; one detail call per
    // kept record fills them in, which is what makes the copy read like a
    // catalogue note rather than a label.
    let detail: VamRecord["record"] | undefined;
    try {
      detail = (await getJson<VamRecord>(`${BASE}/museumobject/${r.systemNumber}`)).record;
    } catch {
      detail = undefined;
    }

    const dims = detail?.dimensions
      ?.slice(0, 3)
      .map((d) => `${d.dimension} ${d.value}${d.unit}`)
      .join(", ");

    out.push({
      externalId: `vam-${r.systemNumber}`,
      title: (r._primaryTitle || r.objectType || "").trim(),
      maker: r._primaryMaker?.name?.trim() || null,
      dateText: r._primaryDate?.trim() || null,
      medium: detail?.materialsAndTechniques?.trim() || r.objectType?.trim() || null,
      dimensions: dims || null,
      provenance: null,
      creditLine: detail?.creditLine?.trim() || null,
      images: [`${iiif}full/1200,/0/default.jpg`, `${iiif}full/843,/0/default.jpg`],
      sourceName: "Victoria and Albert Museum",
      sourceUrl: `https://collections.vam.ac.uk/item/${r.systemNumber}/`,
      sourceLicense: "V&A open access",
    });
  }
  return out;
}
