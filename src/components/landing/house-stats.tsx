"use client";

import { useMemo, useRef } from "react";
import { animate, createScope, type Scope } from "animejs";
import { formatCents } from "@/lib/auction/money";
import {
  useIsomorphicLayoutEffect,
  onInView,
  prefersReducedMotion,
} from "./anim";

export interface HouseStats {
  liveLots: number;
  lotsSold: number;
  totalHammerCents: number;
  members: number;
  bidsPlaced: number;
}

interface Stat {
  key: string;
  label: string;
  value: number;
  note: string;
  format: (value: number) => string;
}

/**
 * Compact currency, computed rather than localised.
 *
 * `Intl.NumberFormat(..., { notation: "compact" })` is not stable across
 * runtimes: Node's ICU renders 4,000,000 as "$4.0M" while Chrome renders
 * "$4M". Server and client therefore disagree on the same number, React
 * discards the tree as a hydration mismatch, and the figure visibly reflows.
 * Doing the arithmetic ourselves makes both sides produce the same string.
 */
function compactUsd(cents: number): string {
  const units = Math.round(cents) / 100;
  const abs = Math.abs(units);
  const [suffix, divisor] =
    abs >= 1_000_000_000
      ? (["B", 1_000_000_000] as const)
      : abs >= 1_000_000
        ? (["M", 1_000_000] as const)
        : abs >= 1_000
          ? (["K", 1_000] as const)
          : (["", 1] as const);
  const scaled = units / divisor;
  // One decimal below 100, none above. Rounded through an integer rather than
  // `toFixed`, which inherits binary-float error — (4.05).toFixed(1) is "4.0",
  // not "4.1". `String` then drops a trailing ".0" for free.
  const text = scaled >= 100 ? String(Math.round(scaled)) : String(Math.round(scaled * 10) / 10);
  return `$${text}${suffix}`;
}

export function HouseStatsRow({ stats }: { stats: HouseStats }) {
  const root = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);

  const items = useMemo<Stat[]>(() => {
    const whole = (value: number) => Math.round(value).toLocaleString("en-US");
    // Notation is decided once from the final figure. Letting `formatCents`
    // flip to compact mid-count makes the number visibly jump width.
    const bigMoney = stats.totalHammerCents / 100 >= 10_000;

    return [
      {
        key: "live",
        label: "Lots on the block",
        value: stats.liveLots,
        note: "Open for bidding this minute",
        format: whole,
      },
      {
        key: "hammer",
        label: "Hammered to date",
        value: stats.totalHammerCents,
        note: `Across ${stats.lotsSold.toLocaleString("en-US")} sold lots`,
        format: (value) =>
          bigMoney
            ? compactUsd(value)
            : formatCents(Math.round(value), { showCents: false }),
      },
      {
        key: "bids",
        label: "Bids placed",
        value: stats.bidsPlaced,
        note: "Manual and proxy, every one logged",
        format: whole,
      },
      {
        key: "members",
        label: "Registered bidders",
        value: stats.members,
        note: "Paddle numbers issued",
        format: whole,
      },
    ];
  }, [stats]);

  /* Counting up from zero is a claim about momentum, so it only fires when the
     row is actually looked at — and never for a visitor who asked for less
     motion, who gets the finished figure that is already in the markup. */
  useIsomorphicLayoutEffect(() => {
    const container = root.current;
    if (!container || prefersReducedMotion()) return;

    const stop = onInView(container, () => {
      scope.current = createScope({ root }).add(() => {
        const cells = Array.from(
          container.querySelectorAll<HTMLElement>("[data-stat-value]"),
        );
        cells.forEach((cell, index) => {
          const stat = items[index];
          if (!stat || stat.value <= 0) return;
          const counter = { value: 0 };
          animate(counter, {
            value: stat.value,
            duration: 1700,
            delay: index * 110,
            ease: "out(4)",
            // Zero the cell only once the count is actually running. Doing it
            // eagerly means a trigger that never fires — an observer that does
            // not resolve, a visitor who never scrolls this far — leaves the
            // real figure replaced by a permanent "0", which is worse than
            // showing no animation at all.
            onBegin: () => {
              cell.textContent = stat.format(0);
            },
            onUpdate: () => {
              cell.textContent = stat.format(counter.value);
            },
            onComplete: () => {
              cell.textContent = stat.format(stat.value);
            },
          });
        });
      });
    });

    return () => {
      stop();
      scope.current?.revert();
      scope.current = null;
    };
  }, [items]);

  return (
    <div
      ref={root}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-pewter/40 bg-pewter/25 lg:grid-cols-4"
    >
      {items.map((stat) => (
        <div
          key={stat.key}
          className="bg-obsidian/85 px-5 py-7 sm:px-7 sm:py-9"
        >
          <p
            data-stat-value
            className="gild-text tabular font-display text-[clamp(1.9rem,5vw,3rem)] leading-none font-semibold"
          >
            {stat.format(stat.value)}
          </p>
          <p className="mt-3 text-sm font-medium text-linen">{stat.label}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ash">
            {stat.note}
          </p>
        </div>
      ))}
    </div>
  );
}
