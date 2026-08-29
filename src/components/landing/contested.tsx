import Link from "next/link";
import { formatCents } from "@/lib/auction/money";
import { LotImage } from "./lot-image";

export interface ContestedLot {
  id: string;
  slug: string;
  title: string;
  images: string[];
  currentPriceCents: number;
  bidCount: number;
  categoryName: string | null;
}

/**
 * The leaderboard, ranked by how hard a lot is being fought over.
 *
 * Bid count is scaled against the top lot rather than an absolute maximum, so
 * the bar chart stays legible on a quiet night as well as a busy one.
 */
export function ContestedList({ lots }: { lots: ContestedLot[] }) {
  const busiest = Math.max(...lots.map((lot) => lot.bidCount), 1);

  return (
    <ol className="divide-y divide-pewter/30 overflow-hidden rounded-2xl border border-pewter/40 bg-obsidian/60">
      {lots.map((lot, index) => (
        <li key={lot.id}>
          <Link
            href={`/lot/${lot.slug}`}
            className="group flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-white/[0.025] sm:px-6 sm:py-4"
          >
            <span className="tabular w-6 shrink-0 font-display text-sm font-semibold text-gild-500">
              {String(index + 1).padStart(2, "0")}
            </span>

            <LotImage
              src={lot.images[0]}
              alt={lot.title}
              seed={lot.slug}
              className="size-11 shrink-0 rounded-lg border border-pewter/40 sm:size-12"
            />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-linen transition-colors group-hover:text-parchment">
                {lot.title}
              </p>
              <div className="mt-1.5 flex items-center gap-2.5">
                <span
                  className="h-1 rounded-full bg-linear-to-r from-gild-600 to-gild-300"
                  style={{ width: `${Math.max(8, (lot.bidCount / busiest) * 100)}%`, maxWidth: "9rem" }}
                  aria-hidden
                />
                <span className="tabular shrink-0 text-[12px] text-ash">
                  {lot.bidCount} {lot.bidCount === 1 ? "bid" : "bids"}
                  {lot.categoryName ? ` · ${lot.categoryName}` : ""}
                </span>
              </div>
            </div>

            <span className="tabular shrink-0 font-display text-[15px] font-semibold text-gild-200 sm:text-base">
              {formatCents(lot.currentPriceCents, { compact: true, showCents: false })}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
