"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Input, Select } from "@/components/ui/field";
import { exploreHref, SORT_OPTIONS, type ExploreQuery, type SortValue } from "./query";

/**
 * The two controls that cannot be a link.
 *
 * Typing replaces rather than pushes: a search box that stacks a history entry
 * per keystroke turns the back button into a spelling exercise. Committing
 * with Enter pushes, so a search a bidder meant to keep is one they can return
 * to.
 */
export function LotSearch({ query }: { query: ExploreQuery }) {
  const router = useRouter();
  const [value, setValue] = useState(query.q);
  const [urlTerm, setUrlTerm] = useState(query.q);

  // The URL can change underneath the box — the back button, a category chip,
  // "clear filters". Adjusting during render (rather than in an effect) keeps
  // the input in step without a second paint, and without remounting it and
  // stealing focus mid-keystroke.
  if (urlTerm !== query.q) {
    setUrlTerm(query.q);
    setValue(query.q);
  }

  useEffect(() => {
    if (value === urlTerm) return;
    const id = setTimeout(() => {
      router.replace(exploreHref(query, { q: value }), { scroll: false });
    }, 350);
    return () => clearTimeout(id);
  }, [value, urlTerm, query, router]);

  return (
    <form
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(exploreHref(query, { q: value }));
      }}
      className="relative"
    >
      <label htmlFor="lot-search" className="sr-only">
        Search the catalogue
      </label>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ash"
        aria-hidden
      />
      <Input
        id="lot-search"
        name="q"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search makers, titles, materials…"
        autoComplete="off"
        className="pl-10 pr-10"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ash transition-colors hover:text-linen"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </form>
  );
}

export function SortSelect({ query }: { query: ExploreQuery }) {
  const router = useRouter();
  return (
    <div>
      <label htmlFor="lot-sort" className="sr-only">
        Sort lots
      </label>
      <Select
        id="lot-sort"
        value={query.sort}
        onChange={(event) => router.push(exploreHref(query, { sort: event.target.value as SortValue }))}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
