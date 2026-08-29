"use client";

import { useEffect, useState } from "react";
import { Gavel } from "lucide-react";
import { formatCents } from "@/lib/auction/money";
import { formatCountdown } from "@/lib/hooks/use-countdown";
import { useLotLive } from "@/lib/realtime/store";
import { cn } from "@/lib/utils";
import { isBiddable, type LotStatus } from "./format";
import { usePriceFlash } from "./use-price-flash";
import { useServerCountdown } from "./use-server-clock";

/**
 * The bid box, follow-you edition.
 *
 * On a phone the panel is a screen or two above the provenance and history a
 * bidder is reading, and a lot can close while they scroll. This bar appears
 * only once the real panel has left the viewport, and its button is a plain
 * fragment link — the browser scrolls to the amount field and focuses it,
 * which is more reliable than anything we would write.
 */
export function MobileBidBar({
  lotId,
  currentPriceCents,
  endsAt,
  status,
}: {
  lotId: string;
  currentPriceCents: number;
  endsAt: string;
  status: LotStatus;
}) {
  const live = useLotLive(lotId);
  const [panelVisible, setPanelVisible] = useState(true);

  useEffect(() => {
    const panel = document.getElementById("bid-panel");
    if (!panel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPanelVisible(Boolean(entry?.isIntersecting)),
      { threshold: 0.1 },
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  const liveStatus = live.state?.status ?? status;
  const price = live.state?.currentPriceCents ?? currentPriceCents;
  const ends = live.state?.endsAt ?? endsAt;
  const countdown = useServerCountdown(ends);
  const priceRef = usePriceFlash<HTMLSpanElement>(price);

  if (!isBiddable(liveStatus) || countdown.expired) return null;

  return (
    <div
      aria-hidden={panelVisible}
      inert={panelVisible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-pewter/50 bg-void/95 px-4 py-3 backdrop-blur-xl lg:hidden",
        "transition-transform duration-300 ease-[var(--ease-out-expo)]",
        panelVisible ? "pointer-events-none translate-y-full" : "translate-y-0",
      )}
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-ash">
            Current bid
          </p>
          <span
            ref={priceRef}
            className="tabular block font-display text-lg font-semibold text-gild-200"
          >
            {formatCents(price)}
          </span>
        </div>
        <span
          className={cn(
            "tabular text-sm",
            countdown.urgent
              ? "text-ember-300"
              : countdown.soon
                ? "text-ember-300"
                : "text-fog",
          )}
          suppressHydrationWarning /* clock-derived: the second can tick between SSR and hydration */
        >
          {formatCountdown(countdown)}
        </span>
        <a
          href="#bid-amount"
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-linear-to-b from-gild-300 to-gild-500 px-5 text-sm font-medium text-obsidian"
        >
          <Gavel className="size-4" aria-hidden />
          Bid
        </a>
      </div>
    </div>
  );
}
