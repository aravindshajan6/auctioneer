"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { animate, stagger } from "animejs";
import { Bot, Gavel } from "lucide-react";
import { formatCents } from "@/lib/auction/money";
import { useLotLive } from "@/lib/realtime/store";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { Avatar } from "@/components/ui/avatar";
import { cn, relativeTime } from "@/lib/utils";
import { maskBidderName } from "./format";

export interface BidHistoryEntry {
  id: string;
  bidderId: string;
  bidderName: string;
  amountCents: number;
  type: "manual" | "proxy" | "buy_now";
  /** ISO string. */
  createdAt: string;
}

/**
 * The book, as the room sees it.
 *
 * Names are masked to initials the way a saleroom announces paddle numbers —
 * the price is public, the identity is not. The viewer's own bids are never
 * masked: hiding a bidder from themselves is confusing, not private.
 */
export function BidHistory({
  lotId,
  initial,
  viewerId,
  leaderId,
  limit,
  className,
}: {
  lotId: string;
  initial: BidHistoryEntry[];
  viewerId: string | null;
  leaderId: string | null;
  limit?: number;
  className?: string;
}) {
  const live = useLotLive(lotId);
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLOListElement | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  // Once the socket has delivered anything, it is the fuller record: the store
  // is seeded from this same server history on mount.
  const rows = useMemo(() => {
    const source = live.bids.length > 0 ? live.bids : initial;
    return limit ? source.slice(0, limit) : source;
  }, [live.bids, initial, limit]);

  // Re-render occasionally so "3m ago" does not freeze on a quiet lot.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    const fresh = rows.filter((row) => !seen.current.has(row.id));
    for (const row of rows) seen.current.add(row.id);

    // The first paint is history, not news — it should not fly in.
    if (!primed.current) {
      primed.current = true;
      return;
    }
    if (fresh.length === 0 || reduced) return;

    const elements = fresh
      .map((row) => container.querySelector<HTMLElement>(`[data-bid-id="${row.id}"]`))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    animate(elements, {
      opacity: [0, 1],
      translateY: [-12, 0],
      duration: 480,
      delay: stagger(45),
      ease: "out(3)",
    });
  }, [rows, reduced]);

  if (rows.length === 0) {
    return (
      <p className={cn("py-8 text-center text-sm text-ash", className)}>
        No bids yet. The book opens with the first offer.
      </p>
    );
  }

  return (
    <ol ref={listRef} className={cn("divide-y divide-pewter/25", className)}>
      {rows.map((bid, index) => {
        const isViewer = viewerId !== null && bid.bidderId === viewerId;
        const isLeader = index === 0 && bid.bidderId === leaderId;
        const display = maskBidderName(bid.bidderName, isViewer);

        return (
          <li
            key={bid.id}
            data-bid-id={bid.id}
            className={cn(
              "flex items-center gap-3 px-1 py-2.5",
              isViewer && "-mx-1 rounded-lg bg-gild-500/[0.06] px-2",
            )}
          >
            <Avatar name={bid.bidderName} size={30} />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                <span className={cn("truncate", isViewer ? "text-gild-200" : "text-linen")}>
                  {isViewer ? `${display} (you)` : display}
                </span>
                {isLeader && (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-signal-300">
                    Leading
                  </span>
                )}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-ash">
                {bid.type === "proxy" ? (
                  <>
                    <Bot className="size-3" aria-hidden />
                    <span>Automatic bid</span>
                  </>
                ) : bid.type === "buy_now" ? (
                  <>
                    <Gavel className="size-3" aria-hidden />
                    <span>Bought now</span>
                  </>
                ) : (
                  <span>Bid</span>
                )}
                <span aria-hidden>·</span>
                <time dateTime={bid.createdAt} suppressHydrationWarning>
                  {relativeTime(bid.createdAt)}
                </time>
              </p>
            </div>

            <span
              className={cn(
                "tabular shrink-0 text-sm font-medium",
                isLeader ? "text-gild-200" : "text-fog",
              )}
            >
              {formatCents(bid.amountCents)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
