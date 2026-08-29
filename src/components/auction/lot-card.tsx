"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Gavel, Lock } from "lucide-react";
import type { LotCard as LotCardData } from "@/lib/queries";
import { formatCents } from "@/lib/auction/money";
import { formatCountdown } from "@/lib/hooks/use-countdown";
import { useLotLive } from "@/lib/realtime/store";
import { useLotRoom } from "@/lib/realtime/use-socket";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DEFAULT_ACCENT, isBiddable, statusMeta } from "./format";
import { LotMedia } from "./lot-media";
import { usePriceFlash } from "./use-price-flash";
import { useServerCountdown } from "./use-server-clock";
import { WatchButton } from "./watch-button";

/**
 * The catalogue plate.
 *
 * Every surface in the app leans on this, so it has to hold two truths at
 * once: the server-rendered price it was built with, and whatever the socket
 * has said since. Live always wins when present — a stale price on a card is
 * worse than no card at all.
 */
export function LotCard({
  lot,
  signedIn = false,
  watching = false,
  priority = false,
  subscribe = true,
  className,
}: {
  lot: LotCardData;
  signedIn?: boolean;
  watching?: boolean;
  /** Eager-load the plate — reserve this for above-the-fold cards. */
  priority?: boolean;
  /** Join the lot's socket room while the card is on screen. */
  subscribe?: boolean;
  className?: string;
}) {
  const live = useLotLive(lot.id);
  const cardRef = useRef<HTMLElement | null>(null);
  const [seen, setSeen] = useState(false);

  // Rooms are joined lazily — a grid does not open 24 subscriptions before a
  // single card is looked at — but the flag latches. Leaving and rejoining on
  // every scroll would churn the gateway's join limiter for no benefit; the
  // room costs nothing once open and the socket is shared for the whole tab.
  useEffect(() => {
    const el = cardRef.current;
    if (!el || !subscribe || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setSeen(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [subscribe, seen]);

  const serverStatus = lot.status;
  const status = live.state?.status ?? serverStatus;
  const biddable = isBiddable(status);
  useLotRoom(subscribe && seen && biddable ? lot.id : null);

  const priceCents = live.state?.currentPriceCents ?? lot.currentPriceCents;
  const bidCount = live.state?.bidCount ?? lot.bidCount;
  const reserveMet = live.state?.reserveMet ?? lot.reserveMet;
  const endsAt = live.state?.endsAt ?? lot.endsAt;

  const countdown = useServerCountdown(
    status === "scheduled" ? lot.startsAt : endsAt,
  );
  const priceRef = usePriceFlash<HTMLSpanElement>(priceCents);

  const accent = lot.category?.accent ?? DEFAULT_ACCENT;
  const meta = statusMeta(status);
  const closed =
    status === "sold" || status === "passed" || status === "cancelled";
  const hasBids = bidCount > 0;
  const priceLabel = closed
    ? status === "sold"
      ? "Hammer price"
      : "Final bid"
    : hasBids
      ? "Current bid"
      : "Starting bid";

  return (
    <article
      ref={cardRef}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/60",
        "transition-[transform,border-color,box-shadow] duration-300 ease-[var(--ease-out-expo)]",
        "hover:-translate-y-1 hover:border-gild-500/45 hover:shadow-[0_28px_60px_-30px_rgba(0,0,0,0.9)]",
        "has-[a:focus-visible]:-translate-y-1 has-[a:focus-visible]:border-gild-400",
        className,
      )}
    >
      <div className="relative aspect-[4/5] overflow-hidden">
        <LotMedia
          src={lot.images[0]}
          alt={lot.title}
          accent={accent}
          loading={priority ? "eager" : "lazy"}
          sizes="(min-width: 1280px) 22vw, (min-width: 768px) 33vw, (min-width: 640px) 50vw, 92vw"
          className="size-full"
          imgClassName="transition-transform duration-700 ease-[var(--ease-out-expo)] group-hover:scale-[1.05]"
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-void/95 via-void/50 to-transparent" />

        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {status === "live" ? (
            <LiveBadge />
          ) : (
            <Badge tone={meta.tone}>{meta.label}</Badge>
          )}
          <WatchButton
            lotId={lot.id}
            initialWatching={watching}
            signedIn={signedIn}
            size="sm"
            className="relative z-20"
          />
        </div>

        {/* The clock lives on the plate so it reads at a glance down a column. */}
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
          <span
            className={cn(
              "tabular rounded-full px-2.5 py-1 text-xs font-medium backdrop-blur-md",
              closed
                ? "bg-void/70 text-ash"
                : countdown.urgent
                  ? "animate-pulse bg-ember-500/20 text-ember-300 ring-1 ring-ember-500/50"
                  : countdown.soon
                    ? "bg-void/70 text-ember-300"
                    : "bg-void/70 text-fog",
            )}
            suppressHydrationWarning /* clock-derived: the second can tick between SSR and hydration */
          >
            {closed
              ? status === "sold"
                ? "Sold"
                : "Closed"
              : status === "scheduled"
                ? `Opens in ${formatCountdown(countdown)}`
                : formatCountdown(countdown)}
          </span>
          {lot.type === "live" && (
            <Badge tone="gild" className="backdrop-blur-md">
              Saleroom
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        {lot.category?.name && (
          <span
            className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em]"
            style={{
              color: accent,
              background: `color-mix(in oklab, ${accent} 14%, transparent)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 30%, transparent)`,
            }}
          >
            {lot.category.name}
          </span>
        )}

        <h3 className="font-display text-[17px] leading-snug font-semibold text-linen line-clamp-2">
          {lot.title}
        </h3>

        <div className="mt-auto flex items-end justify-between gap-3 pt-1">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.11em] text-ash">
              {priceLabel}
            </p>
            <span
              ref={priceRef}
              aria-live="polite"
              className="tabular block font-display text-xl font-semibold text-gild-200"
            >
              {formatCents(priceCents)}
            </span>
          </div>
          <p className="flex shrink-0 items-center gap-1.5 pb-0.5 text-xs text-ash">
            <Gavel className="size-3.5" aria-hidden />
            <span className="tabular">{bidCount}</span>
            <span>{bidCount === 1 ? "bid" : "bids"}</span>
          </p>
        </div>

        {/* Never the number — only whether the seller's floor has been cleared. */}
        {lot.hasReserve && !reserveMet && !closed && (
          <p className="flex items-center gap-1.5 text-[11px] text-ember-300/90">
            <Lock className="size-3" aria-hidden />
            Reserve not met
          </p>
        )}
      </div>

      {/* The whole plate is one link; the heart above sits over it at z-20. */}
      <Link
        href={`/lot/${lot.slug}`}
        className="absolute inset-0 z-10 rounded-2xl"
        aria-label={`${lot.title} — ${priceLabel.toLowerCase()} ${formatCents(priceCents)}`}
      >
        <span className="sr-only">View lot</span>
      </Link>
    </article>
  );
}

/** Grid placeholder used by explore's loading state. */
export function LotCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-pewter/40 bg-obsidian/50">
      <div className="aspect-[4/5] animate-pulse bg-linear-to-br from-slate-deep via-onyx to-slate-deep" />
      <div className="space-y-3 p-4">
        <div className="h-3 w-20 animate-pulse rounded-full bg-slate-deep" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-deep" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-slate-deep" />
        <div className="h-6 w-28 animate-pulse rounded bg-slate-deep" />
      </div>
    </div>
  );
}
