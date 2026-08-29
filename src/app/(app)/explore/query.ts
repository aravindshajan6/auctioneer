import type { LotFilters } from "@/lib/queries";

/**
 * Explore's state lives in the URL, not in React.
 *
 * A filtered catalogue is something people send each other and step back
 * through. Keeping every control as a plain link over a serialised query
 * makes sharing, the back button and no-JS all work without extra effort.
 */
export const STATUS_TABS = [
  { key: "all", label: "All lots", filter: undefined },
  { key: "live", label: "Live", filter: "live" },
  { key: "scheduled", label: "Upcoming", filter: "scheduled" },
  { key: "sold", label: "Sold", filter: "sold" },
] as const;

export const SORT_OPTIONS = [
  { value: "ending", label: "Closing soonest" },
  { value: "newest", label: "Newly catalogued" },
  { value: "most_bids", label: "Most contested" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "price_asc", label: "Price: low to high" },
] as const;

export type SortValue = (typeof SORT_OPTIONS)[number]["value"];
export type StatusKey = (typeof STATUS_TABS)[number]["key"];

export interface ExploreQuery {
  q: string;
  category: string;
  status: StatusKey;
  sort: SortValue;
  page: number;
}

export const DEFAULT_QUERY: ExploreQuery = {
  q: "",
  category: "",
  status: "all",
  sort: "ending",
  page: 1,
};

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function parseExploreQuery(
  params: Record<string, string | string[] | undefined>,
): ExploreQuery {
  const statusRaw = first(params.status);
  const sortRaw = first(params.sort);
  const pageRaw = Number.parseInt(first(params.page), 10);

  return {
    q: first(params.q).slice(0, 120),
    category: first(params.category).slice(0, 80),
    status: STATUS_TABS.some((t) => t.key === statusRaw) ? (statusRaw as StatusKey) : "all",
    sort: SORT_OPTIONS.some((s) => s.value === sortRaw) ? (sortRaw as SortValue) : "ending",
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.min(pageRaw, 500) : 1,
  };
}

/** Translate the URL into the shape `listLots` speaks. */
export function toFilters(query: ExploreQuery, perPage: number): LotFilters {
  const tab = STATUS_TABS.find((t) => t.key === query.status);
  return {
    q: query.q || undefined,
    category: query.category || undefined,
    status: tab?.filter,
    sort: query.sort,
    page: query.page,
    perPage,
  };
}

/**
 * A link to the same catalogue with one thing changed. Any change other than
 * paging returns to page one — nobody wants page 7 of a different search.
 */
export function exploreHref(current: ExploreQuery, patch: Partial<ExploreQuery>): string {
  const next: ExploreQuery = { ...current, ...patch };
  if (patch.page === undefined) next.page = 1;

  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.category) params.set("category", next.category);
  if (next.status !== "all") params.set("status", next.status);
  if (next.sort !== DEFAULT_QUERY.sort) params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));

  const search = params.toString();
  return search ? `/explore?${search}` : "/explore";
}

export function hasActiveFilters(query: ExploreQuery): boolean {
  return Boolean(query.q) || Boolean(query.category) || query.status !== "all";
}

/** Page numbers around the current one, with gaps marked as null. */
export function pageWindow(page: number, pages: number): Array<number | null> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | null> = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push(null);
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push(null);
  out.push(pages);
  return out;
}
