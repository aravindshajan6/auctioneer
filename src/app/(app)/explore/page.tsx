import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { listCategories, listLots } from "@/lib/queries";
import { getSession } from "@/lib/auth/session";
import { LotCard } from "@/components/auction/lot-card";
import { DEFAULT_ACCENT } from "@/components/auction/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LotSearch, SortSelect } from "./explore-controls";
import {
  exploreHref,
  hasActiveFilters,
  pageWindow,
  parseExploreQuery,
  STATUS_TABS,
  toFilters,
} from "./query";

const PER_PAGE = 24;

export const metadata: Metadata = {
  title: "The catalogue",
  description:
    "Every lot currently with the house — live, upcoming and recently sold. Filter by category, follow what interests you, and bid when it comes up.",
};

export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const query = parseExploreQuery(await searchParams);

  const [session, categories, result] = await Promise.all([
    getSession(),
    listCategories(),
    listLots(toFilters(query, PER_PAGE)),
  ]);

  const { lots, total, page, pages } = result;
  const signedIn = Boolean(session?.user);
  const activeCategory = categories.find((c) => c.slug === query.category);
  const from = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const to = Math.min(page * PER_PAGE, total);

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-24 pt-10 sm:px-8">
      <header className="mb-8">
        <p className="text-[11px] uppercase tracking-[0.22em] text-gild-400">The catalogue</p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-linen sm:text-5xl">
          {activeCategory ? activeCategory.name : "Everything on offer"}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog">
          {activeCategory?.description ??
            "Lots are catalogued as they are consigned and stay on view until the hammer falls. Prices update live — nothing here needs refreshing."}
        </p>
        <div className="mt-6 h-px w-full hairline" aria-hidden />
      </header>

      {/* -- Filter rail ------------------------------------------------------ */}
      <div className="mb-8 space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <LotSearch query={query} />
          <div className="sm:w-56">
            <SortSelect query={query} />
          </div>
        </div>

        <nav aria-label="Filter by sale status">
          <ul className="flex flex-wrap gap-1.5">
            {STATUS_TABS.map((tab) => {
              const active = query.status === tab.key;
              return (
                <li key={tab.key}>
                  <Link
                    href={exploreHref(query, { status: tab.key })}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full px-4 text-[13px] transition-colors duration-200",
                      active
                        ? "bg-linen text-obsidian"
                        : "border border-pewter/55 text-fog hover:border-gild-500/50 hover:text-linen",
                    )}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <nav aria-label="Filter by category">
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link
                href={exploreHref(query, { category: "" })}
                aria-current={query.category === "" ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center rounded-full px-3.5 text-xs uppercase tracking-[0.1em] transition-colors duration-200",
                  query.category === ""
                    ? "bg-gild-500/18 text-gild-100 ring-1 ring-gild-500/50"
                    : "text-ash ring-1 ring-pewter/50 hover:text-linen",
                )}
              >
                All departments
              </Link>
            </li>
            {categories.map((category) => {
              const accent = category.accent || DEFAULT_ACCENT;
              const active = query.category === category.slug;
              return (
                <li key={category.id}>
                  <Link
                    href={exploreHref(query, { category: active ? "" : category.slug })}
                    aria-current={active ? "page" : undefined}
                    className="inline-flex h-8 items-center rounded-full px-3.5 text-xs uppercase tracking-[0.1em] transition-[background,box-shadow,color] duration-200"
                    style={{
                      color: active ? "#f6f3ec" : accent,
                      background: active
                        ? `color-mix(in oklab, ${accent} 32%, transparent)`
                        : `color-mix(in oklab, ${accent} 9%, transparent)`,
                      boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} ${active ? 70 : 28}%, transparent)`,
                    }}
                  >
                    {category.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* -- Results ---------------------------------------------------------- */}
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm text-ash">
          {total === 0 ? (
            "No lots"
          ) : (
            <>
              <span className="tabular text-linen">{from}</span>–
              <span className="tabular text-linen">{to}</span> of{" "}
              <span className="tabular text-linen">{total}</span>{" "}
              {total === 1 ? "lot" : "lots"}
              {query.q && (
                <>
                  {" "}
                  for <span className="text-linen">&ldquo;{query.q}&rdquo;</span>
                </>
              )}
            </>
          )}
        </p>
        {hasActiveFilters(query) && (
          <Link href="/explore" className="text-sm text-gild-300 underline-offset-4 hover:underline">
            Clear all filters
          </Link>
        )}
      </div>

      {lots.length === 0 ? (
        <EmptyState hasFilters={hasActiveFilters(query)} term={query.q} />
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {lots.map((lot, index) => (
            <li key={lot.id}>
              <LotCard lot={lot} signedIn={signedIn} priority={index < 4} />
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && <Pagination query={query} page={page} pages={pages} />}
    </div>
  );
}

function EmptyState({ hasFilters, term }: { hasFilters: boolean; term: string }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-pewter/50 px-6 py-20 text-center">
      <span className="mb-5 inline-flex size-14 items-center justify-center rounded-full bg-white/[0.03] text-ash">
        <SearchX className="size-6" aria-hidden />
      </span>
      <h2 className="font-display text-2xl font-semibold text-linen">
        {term ? `Nothing catalogued under “${term}”` : "No lots match those filters"}
      </h2>
      <p className="mt-2.5 max-w-md text-sm leading-relaxed text-fog">
        The house catalogues new consignments daily. Widen the search, or follow a department and
        we will write to you when something comes in.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {hasFilters && (
          <Link href="/explore">
            <Button variant="gild" size="md">
              Clear filters
            </Button>
          </Link>
        )}
        <Link href="/explore?status=live">
          <Button variant="outline" size="md">
            See what is live now
          </Button>
        </Link>
      </div>
    </div>
  );
}

function Pagination({
  query,
  page,
  pages,
}: {
  query: ReturnType<typeof parseExploreQuery>;
  page: number;
  pages: number;
}) {
  const window = pageWindow(page, pages);

  return (
    <nav aria-label="Catalogue pages" className="mt-12 flex items-center justify-center gap-1.5">
      <PageLink
        href={exploreHref(query, { page: page - 1 })}
        disabled={page <= 1}
        label="Previous page"
      >
        <ChevronLeft className="size-4" aria-hidden />
        <span className="hidden sm:inline">Previous</span>
      </PageLink>

      <ol className="flex items-center gap-1.5">
        {window.map((entry, index) =>
          entry === null ? (
            <li key={`gap-${index}`} className="px-1 text-ash" aria-hidden>
              …
            </li>
          ) : (
            <li key={entry}>
              <Link
                href={exploreHref(query, { page: entry })}
                aria-label={`Page ${entry}`}
                aria-current={entry === page ? "page" : undefined}
                className={cn(
                  "tabular inline-flex size-9 items-center justify-center rounded-full text-sm transition-colors duration-200",
                  entry === page
                    ? "bg-linen text-obsidian"
                    : "border border-pewter/55 text-fog hover:border-gild-500/50 hover:text-linen",
                )}
              >
                {entry}
              </Link>
            </li>
          ),
        )}
      </ol>

      <PageLink
        href={exploreHref(query, { page: page + 1 })}
        disabled={page >= pages}
        label="Next page"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRight className="size-4" aria-hidden />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const className =
    "inline-flex h-9 items-center gap-1.5 rounded-full border border-pewter/55 px-3 text-sm text-fog transition-colors duration-200 hover:border-gild-500/50 hover:text-linen";
  if (disabled) {
    return (
      <span aria-disabled className={cn(className, "pointer-events-none opacity-40")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={className}>
      {children}
    </Link>
  );
}
