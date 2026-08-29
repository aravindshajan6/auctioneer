import { getJson } from "./http";
import type { SourceObject } from "./types";

/**
 * Open Library — the Rare Books & Manuscripts department.
 * No key. Gives author, publisher, first-publication year and a cover scan,
 * which is enough to write a plausible bibliographic lot note.
 */
interface OlSearch {
  docs: Array<{
    key: string;
    title: string;
    author_name?: string[];
    first_publish_year?: number;
    publisher?: string[];
    number_of_pages_median?: number;
    cover_i?: number;
  }>;
}

export async function fetchOpenLibrary(opts: {
  query: string;
  want: number;
}): Promise<SourceObject[]> {
  const res = await getJson<OlSearch>(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(opts.query)}` +
      `&limit=${opts.want * 3}&fields=key,title,author_name,first_publish_year,publisher,number_of_pages_median,cover_i`,
  );

  return res.docs
    .filter((d) => d.cover_i && d.title && d.first_publish_year)
    .slice(0, opts.want)
    .map((d) => ({
      externalId: `ol-${d.key.replace(/\W+/g, "")}`,
      title: d.title.trim(),
      maker: d.author_name?.[0]?.trim() || null,
      dateText: d.first_publish_year ? String(d.first_publish_year) : null,
      medium: d.publisher?.[0] ? `Published by ${d.publisher[0]}` : "Printed book",
      dimensions: d.number_of_pages_median ? `${d.number_of_pages_median} pp.` : null,
      provenance: null,
      creditLine: null,
      images: [`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`],
      sourceName: "Open Library",
      sourceUrl: `https://openlibrary.org${d.key}`,
      sourceLicense: "Open Library / Internet Archive",
    }));
}
