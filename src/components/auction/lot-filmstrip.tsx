import Link from "next/link";
import { formatCents } from "@/lib/auction/money";
import { cn } from "@/lib/utils";
import { isBiddable, type LotStatus } from "./format";
import { LotMedia } from "./lot-media";

export interface FilmstripLot {
  id: string;
  slug: string;
  title: string;
  images: string[];
  lotNumber: number | null;
  status: LotStatus;
  currentPriceCents: number;
  startingPriceCents: number;
  bidCount: number;
}

/**
 * The run of the sale.
 *
 * A saleroom's rhythm comes from knowing what is coming, so the strip shows
 * the whole run in lot order rather than only what is left — sold lots stay
 * visible, dimmed, the way a printed catalogue keeps its pages.
 */
export function LotFilmstrip({
  lots,
  currentId,
  accent,
}: {
  lots: FilmstripLot[];
  currentId: string | null;
  accent?: string | null;
}) {
  if (lots.length === 0) return null;

  return (
    <div>
      <h2 className="mb-3 text-[11px] uppercase tracking-[0.16em] text-ash">
        The run — {lots.length} {lots.length === 1 ? "lot" : "lots"}
      </h2>
      <ol className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {lots.map((lot) => {
          const current = lot.id === currentId;
          const closed = lot.status === "sold" || lot.status === "passed";
          return (
            <li key={lot.id} className="w-36 shrink-0 snap-start sm:w-40">
              <Link
                href={`/lot/${lot.slug}`}
                aria-current={current ? "true" : undefined}
                className={cn(
                  "group block overflow-hidden rounded-xl border transition-colors duration-200",
                  current
                    ? "border-gild-400/80 bg-gild-500/[0.08]"
                    : "border-pewter/45 hover:border-gild-500/50",
                  closed && !current && "opacity-55",
                )}
              >
                <LotMedia
                  src={lot.images[0]}
                  alt={lot.title}
                  accent={accent}
                  className="aspect-square w-full"
                  imgClassName="transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:scale-105"
                />
                <div className="space-y-1 p-2.5">
                  <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-ash">
                    {lot.lotNumber !== null && <span className="tabular">Lot {lot.lotNumber}</span>}
                    {isBiddable(lot.status) && (
                      <span className="size-1.5 rounded-full bg-signal-400" aria-label="Open" />
                    )}
                  </p>
                  <p className="line-clamp-2 text-xs leading-snug text-linen">{lot.title}</p>
                  <p className="tabular text-xs text-gild-200">
                    {formatCents(
                      lot.bidCount > 0 ? lot.currentPriceCents : lot.startingPriceCents,
                      { compact: true },
                    )}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
