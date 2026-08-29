import { LotCardSkeleton } from "@/components/auction/lot-card";

export default function ExploreLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-24 pt-10 sm:px-8">
      <div className="mb-8">
        <div className="h-3 w-28 animate-pulse rounded-full bg-slate-deep" />
        <div className="mt-4 h-10 w-80 max-w-full animate-pulse rounded-lg bg-slate-deep" />
        <div className="mt-4 h-4 w-full max-w-2xl animate-pulse rounded bg-slate-deep" />
        <div className="mt-6 h-px w-full hairline" aria-hidden />
      </div>

      <div className="mb-8 space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="h-11 animate-pulse rounded-xl bg-slate-deep" />
          <div className="h-11 animate-pulse rounded-xl bg-slate-deep sm:w-56" />
        </div>
        <div className="flex gap-1.5">
          {[72, 60, 92, 68].map((width) => (
            <div key={width} className="h-9 animate-pulse rounded-full bg-slate-deep" style={{ width }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {[110, 88, 124, 96, 140, 80].map((width) => (
            <div key={width} className="h-8 animate-pulse rounded-full bg-slate-deep" style={{ width }} />
          ))}
        </div>
      </div>

      <div className="mb-5 h-4 w-40 animate-pulse rounded bg-slate-deep" />

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <LotCardSkeleton />
          </li>
        ))}
      </ul>
      <span className="sr-only" role="status">
        Loading the catalogue…
      </span>
    </div>
  );
}
