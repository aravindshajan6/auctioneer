"use client";

import { cn } from "@/lib/utils";
import type { TickerItem } from "./activity";

const TONE: Record<TickerItem["tone"], string> = {
  gild: "text-gild-300",
  ember: "text-ember-300",
  amethyst: "text-amethyst-300",
  muted: "text-ash",
};

function Run({ items, clone }: { items: TickerItem[]; clone?: boolean }) {
  return (
    <ul className="flex shrink-0 items-center" aria-hidden={clone || undefined}>
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 whitespace-nowrap px-6">
          <span
            className={cn(
              "text-[11px] font-medium uppercase tracking-[0.16em]",
              TONE[item.tone],
            )}
          >
            {item.kind}
          </span>
          {item.amount && (
            <span className="tabular text-[13px] font-medium text-linen">{item.amount}</span>
          )}
          <span className="text-[13px] text-ash">{item.lot}</span>
          <span className="text-pewter" aria-hidden>
            ·
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The house wire. Real events, in the order they happened.
 *
 * The run is duplicated because the `marquee` keyframe translates the track by
 * exactly -50%: with two identical copies the seam lands back at the start and
 * the loop is invisible. Hover and keyboard focus both stop it, because a
 * price that slides away mid-read is a price nobody read.
 */
export function LiveTicker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Recent saleroom activity"
      className="group relative border-y border-pewter/40 bg-obsidian/60"
    >
      <div className="relative flex overflow-hidden py-3.5">
        <div className="flex w-max animate-marquee group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] motion-reduce:animate-none">
          <Run items={items} />
          <Run items={items} clone />
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-linear-to-r from-void to-transparent sm:w-28"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-linear-to-l from-void to-transparent sm:w-28"
        aria-hidden
      />
    </section>
  );
}
