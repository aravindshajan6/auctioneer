"use client";

import Link from "next/link";
import { useRef, type PointerEvent } from "react";
import { Timer, TrendingUp } from "lucide-react";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { formatCents } from "@/lib/auction/money";
import { formatCountdown, useCountdown } from "@/lib/hooks/use-countdown";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";
import { LotImage } from "./lot-image";

export interface RailLot {
  id: string;
  slug: string;
  title: string;
  images: string[];
  status: string;
  currentPriceCents: number;
  bidCount: number;
  watchCount: number;
  hasReserve: boolean;
  reserveMet: boolean;
  endsAt: string | Date;
  categoryName: string | null;
  categoryAccent: string | null;
}

function Countdown({ endsAt }: { endsAt: string | Date }) {
  const countdown = useCountdown(endsAt);
  return (
    <span
      // The first client tick will not match the server's; that is expected
      // for a clock, not a hydration bug.
      suppressHydrationWarning
      className={cn(
        "tabular inline-flex items-center gap-1.5 text-[13px] font-medium",
        countdown.urgent
          ? "text-ember-400"
          : countdown.soon
            ? "text-ember-300"
            : "text-fog",
      )}
    >
      <Timer className="size-3.5" aria-hidden />
      <span className="sr-only">Closes in </span>
      {formatCountdown(countdown)}
    </span>
  );
}

function LotCard({ lot, reduced }: { lot: RailLot; reduced: boolean }) {
  const card = useRef<HTMLAnchorElement>(null);

  /* Tilt is written straight to custom properties rather than through React
     state: a pointer move that re-renders a rail of cards is a dropped frame. */
  const tilt = (event: PointerEvent<HTMLAnchorElement>) => {
    const node = card.current;
    if (!node || reduced) return;
    const box = node.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    node.style.setProperty("--rx", `${(-y * 7).toFixed(2)}deg`);
    node.style.setProperty("--ry", `${(x * 9).toFixed(2)}deg`);
  };

  const reset = () => {
    const node = card.current;
    if (!node) return;
    node.style.setProperty("--rx", "0deg");
    node.style.setProperty("--ry", "0deg");
  };

  const live = lot.status === "live" || lot.status === "ending";

  return (
    <Link
      ref={card}
      href={`/lot/${lot.slug}`}
      onPointerMove={tilt}
      onPointerLeave={reset}
      onBlur={reset}
      className="group relative flex w-[78vw] max-w-[330px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/70 backdrop-blur-xl transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-out-expo)] hover:border-gild-500/50 hover:shadow-[0_28px_60px_-30px_rgba(217,171,62,0.45)] sm:w-[300px] lg:w-[320px]"
      style={{
        transform:
          "perspective(1000px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateZ(0)",
      }}
    >
      <div className="relative aspect-4/3 overflow-hidden bg-onyx">
        <LotImage
          src={lot.images[0]}
          alt={lot.title}
          seed={lot.slug}
          className="size-full transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.05]"
        />
        <div
          className="absolute inset-0 bg-linear-to-t from-obsidian via-obsidian/10 to-transparent"
          aria-hidden
        />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {live ? <LiveBadge /> : <Badge tone="neutral">{lot.status}</Badge>}
          {lot.hasReserve && !lot.reserveMet && <Badge tone="ending">Reserve</Badge>}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {lot.categoryName && (
          <p
            className="text-[11px] font-medium uppercase tracking-[0.14em]"
            style={{ color: lot.categoryAccent ?? "var(--color-gild-300)" }}
          >
            {lot.categoryName}
          </p>
        )}
        <h3 className="mt-1.5 line-clamp-2 font-display text-[17px] leading-snug font-semibold text-linen">
          {lot.title}
        </h3>

        <div className="mt-auto pt-5">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-ash">
                {lot.bidCount > 0 ? "Current bid" : "Opening"}
              </p>
              <p className="tabular mt-0.5 font-display text-xl font-semibold text-gild-200">
                {formatCents(lot.currentPriceCents)}
              </p>
            </div>
            <Countdown endsAt={lot.endsAt} />
          </div>

          <div className="mt-3 flex items-center gap-3 border-t border-pewter/30 pt-3 text-[12px] text-ash">
            <span className="tabular inline-flex items-center gap-1.5">
              <TrendingUp className="size-3.5" aria-hidden />
              {lot.bidCount} {lot.bidCount === 1 ? "bid" : "bids"}
            </span>
            {lot.watchCount > 0 && (
              <span className="tabular">{lot.watchCount} watching</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ClosingSoonRail({ lots }: { lots: RailLot[] }) {
  const reduced = useReducedMotion();

  if (lots.length === 0) {
    return (
      <div className="surface rounded-2xl px-6 py-12 text-center">
        <p className="font-display text-lg text-linen">Nothing is on the block this minute.</p>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ash">
          The next consignments are being catalogued and condition-reported.
          Register now and the house will tell you the moment they open.
        </p>
        <Link
          href="/explore"
          className="mt-5 inline-flex items-center gap-1.5 text-sm text-gild-300 underline-offset-4 hover:underline"
        >
          Browse the full catalogue
        </Link>
      </div>
    );
  }

  return (
    <div
      // Focusable so the rail can be panned with the arrow keys, which is the
      // only way a keyboard reaches the cards past the fold.
      tabIndex={0}
      role="group"
      aria-label="Lots closing soon"
      className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
    >
      {lots.map((lot) => (
        <LotCard key={lot.id} lot={lot} reduced={reduced} />
      ))}
      <div className="w-px shrink-0" aria-hidden />
    </div>
  );
}
