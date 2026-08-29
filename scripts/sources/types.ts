/**
 * One catalogue record, normalised across every open-access collection we
 * draw from. Each museum models its data differently; the seed should not
 * have to care which one an object came from.
 */
export interface SourceObject {
  /** Stable id within the source, used to de-duplicate across runs. */
  externalId: string;
  title: string;
  /** Maker, artist, house — whoever the catalogue would credit. */
  maker: string | null;
  /** Display date as the institution words it ("ca. 1963", "1889"). */
  dateText: string | null;
  medium: string | null;
  dimensions: string | null;
  /** Ownership history, where the institution publishes one. */
  provenance: string | null;
  /** The institution's own acquisition credit. */
  creditLine: string | null;
  /** Ordered image URLs, largest first. */
  images: string[];
  sourceName: string;
  sourceUrl: string;
  sourceLicense: string;
}

/** A department in our catalogue, and how to fill it from the open collections. */
export type DepartmentSlug =
  | "timepieces"
  | "fine-art"
  | "jewellery-gems"
  | "automobilia"
  | "antiquities"
  | "modern-design"
  | "rare-books"
  | "wine-spirits";
