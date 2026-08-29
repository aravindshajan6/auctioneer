"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, Radio } from "lucide-react";
import { formatCents } from "@/lib/auction/money";
import { formatCountdown, type Countdown } from "@/lib/hooks/use-countdown";
import type { LotBidPayload, LotStatePayload } from "@/lib/realtime/events";
import { useLotLive } from "@/lib/realtime/store";
import { useLotRoom } from "@/lib/realtime/use-socket";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { BidHistory, type BidHistoryEntry } from "./bid-history";
import { BidPanel, type BidPanelLot } from "./bid-panel";
import { ChatPanel } from "./chat-panel";
import { statusMeta, type LotStatus } from "./format";
import { LotFilmstrip, type FilmstripLot } from "./lot-filmstrip";
import { LotLiveSync } from "./lot-live-sync";
import { LotMedia } from "./lot-media";
import { usePriceFlash } from "./use-price-flash";
import { useServerCountdown } from "./use-server-clock";

export interface LiveRoomCurrentLot {
  panel: BidPanelLot;
  state: LotStatePayload;
  bids: LotBidPayload["bid"][];
  images: string[];
  accent: string | null;
  isSeller: boolean;
}

/**
 * The saleroom.
 *
 * One lot is on the block at a time and everything on this page is oriented
 * around it: the room joins that lot's socket channel, the feed and the chat
 * are that lot's, and the clock is the one the auctioneer is working to.
 */
export function LiveRoom({
  saleTitle,
  saleStatus,
  lots,
  current,
  viewerId,
  viewerName,
  antiSnipeWindowSeconds,
}: {
  saleTitle: string;
  saleStatus: "scheduled" | "live" | "paused" | "ended";
  lots: FilmstripLot[];
  current: LiveRoomCurrentLot | null;
  viewerId: string | null;
  viewerName: string | null;
  antiSnipeWindowSeconds: number;
}) {
  // The room membership is held here, at the top, for as long as this lot is
  // the one on the block; the sync component below only seeds and merges.
  const currentId = current?.panel.id ?? null;
  useLotRoom(currentId);

  const [tab, setTab] = useState<"feed" | "chat">("feed");
  const live = useLotLive(currentId);

  const status: LotStatus =
    live.state?.status ?? current?.panel.status ?? "scheduled";
  const priceCents =
    live.state?.currentPriceCents ?? current?.panel.currentPriceCents ?? 0;
  const bidCount = live.state?.bidCount ?? current?.panel.bidCount ?? 0;
  const endsAt = live.state?.endsAt ?? current?.panel.endsAt ?? null;

  const countdown = useServerCountdown(endsAt);
  const priceRef = usePriceFlash<HTMLSpanElement>(priceCents);
  const call = auctioneerCall(status, countdown);
  const signInHref = `/sign-in?next=${encodeURIComponent("/live")}`;

  const historyEntries: BidHistoryEntry[] = current?.bids ?? [];
  const currentIndex = currentId
    ? lots.findIndex((l) => l.id === currentId)
    : -1;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-24 pt-6 sm:px-8">
      {current && (
        <LotLiveSync
          auctionId={current.panel.id}
          state={current.state}
          bids={current.bids}
          join={false}
        />
      )}

      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            {saleStatus === "live" ? (
              <LiveBadge label="On the block" />
            ) : (
              <Badge tone="gild">
                {saleStatus === "paused" ? "Paused" : "Sale room"}
              </Badge>
            )}
            {currentIndex >= 0 && (
              <span className="tabular text-xs text-ash">
                Lot {currentIndex + 1} of {lots.length}
              </span>
            )}
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-linen sm:text-3xl">
            {saleTitle}
          </h1>
        </div>

        <p className="flex items-center gap-2 rounded-full border border-pewter/55 px-3.5 py-1.5 text-xs text-fog">
          <Eye className="size-3.5" aria-hidden />
          <span className="tabular" aria-live="polite">
            {live.viewers > 0 ? live.viewers : 1}
          </span>
          <span>in the room</span>
        </p>
      </header>

      {!current ? (
        <div className="rounded-2xl border border-dashed border-pewter/50 px-6 py-20 text-center">
          <h2 className="font-display text-2xl text-linen">Between lots</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-fog">
            The auctioneer is settling the previous lot. The next one will
            appear here as soon as it comes up.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
          {/* -- The block ---------------------------------------------------- */}
          <div className="space-y-6">
            <div className="relative overflow-hidden rounded-2xl border border-pewter/45">
              <LotMedia
                src={current.images[0]}
                alt={current.panel.title}
                accent={current.accent}
                loading="eager"
                sizes="(min-width: 1024px) 62vw, 100vw"
                className="aspect-[16/10] w-full"
                imgClassName="object-cover"
              />
              <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-void via-void/55 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] backdrop-blur-md",
                      call.tone === "live" &&
                        "bg-signal-500/15 text-signal-300 ring-1 ring-signal-500/45",
                      call.tone === "ending" &&
                        "bg-ember-500/18 text-ember-300 ring-1 ring-ember-500/50",
                      call.tone === "closed" &&
                        "bg-white/[0.06] text-fog ring-1 ring-pewter/60",
                    )}
                    aria-live="polite"
                  >
                    <Radio className="size-3" aria-hidden />
                    {call.label}
                  </span>
                  {current.panel.hasReserve &&
                    !(live.state?.reserveMet ?? current.panel.reserveMet) && (
                      <Badge tone="ending" className="backdrop-blur-md">
                        Reserve not met
                      </Badge>
                    )}
                </div>

                <h2 className="font-display text-2xl font-semibold text-linen sm:text-4xl">
                  <Link
                    href={`/lot/${current.panel.slug}`}
                    className="hover:text-parchment"
                  >
                    {current.panel.title}
                  </Link>
                </h2>

                <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-ash">
                      {bidCount > 0 ? "Current bid" : "Opening at"}
                    </p>
                    <span
                      ref={priceRef}
                      aria-live="polite"
                      aria-atomic="true"
                      className="tabular font-display text-3xl font-semibold text-gild-200 sm:text-5xl"
                    >
                      {formatCents(priceCents)}
                    </span>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-ash">
                      {countdown.expired ? "Closed" : "Closes in"}
                    </p>
                    <span
                      className={cn(
                        "tabular font-display text-2xl font-semibold sm:text-3xl",
                        countdown.urgent || countdown.soon
                          ? "text-ember-300"
                          : "text-linen",
                      )}
                      suppressHydrationWarning /* clock-derived: the second can tick between SSR and hydration */
                    >
                      {countdown.expired ? "—" : formatCountdown(countdown)}
                    </span>
                  </div>
                  <p className="tabular pb-1 text-xs text-fog">
                    {bidCount} {bidCount === 1 ? "bid" : "bids"}
                  </p>
                </div>
              </div>
            </div>

            <LotFilmstrip
              lots={lots}
              currentId={currentId}
              accent={current.accent}
            />
          </div>

          {/* -- Rail --------------------------------------------------------- */}
          <div className="space-y-5">
            <BidPanel
              lot={current.panel}
              viewerId={viewerId}
              viewerName={viewerName}
              isSeller={current.isSeller}
              antiSnipeWindowSeconds={antiSnipeWindowSeconds}
            />

            <div className="flex h-[26rem] flex-col overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/60">
              <div
                role="tablist"
                aria-label="Saleroom activity"
                className="flex border-b border-pewter/40"
                onKeyDown={(event) => {
                  // Arrow keys move between tabs; the tab key belongs to the
                  // panel below, per the WAI-ARIA tabs pattern.
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  setTab((t) => (t === "feed" ? "chat" : "feed"));
                }}
              >
                <RoomTab
                  id="feed"
                  active={tab === "feed"}
                  onSelect={() => setTab("feed")}
                >
                  Bid feed
                </RoomTab>
                <RoomTab
                  id="chat"
                  active={tab === "chat"}
                  onSelect={() => setTab("chat")}
                >
                  Chat
                </RoomTab>
              </div>

              <div
                role="tabpanel"
                id="panel-feed"
                aria-labelledby="tab-feed"
                hidden={tab !== "feed"}
                className="min-h-0 flex-1 overflow-y-auto px-4"
              >
                <BidHistory
                  lotId={current.panel.id}
                  initial={historyEntries}
                  viewerId={viewerId}
                  leaderId={live.state?.leaderId ?? current.panel.leaderId}
                  limit={40}
                />
              </div>

              <div
                role="tabpanel"
                id="panel-chat"
                aria-labelledby="tab-chat"
                hidden={tab !== "chat"}
                className="min-h-0 flex-1"
              >
                <ChatPanel
                  auctionId={current.panel.id}
                  viewerId={viewerId}
                  signInHref={signInHref}
                  className="h-full"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomTab({
  id,
  active,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={active}
      aria-controls={`panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      className={cn(
        "flex-1 px-4 py-3 text-sm transition-colors duration-200",
        active
          ? "border-b-2 border-gild-400 text-linen"
          : "text-ash hover:text-fog",
      )}
    >
      {children}
    </button>
  );
}

interface AuctioneerCall {
  label: string;
  tone: "live" | "ending" | "closed";
}

/**
 * What the rostrum would be saying.
 *
 * Derived rather than pushed: the auctioneer's call is a function of the lot's
 * state and its clock, and inventing a separate channel for it would only give
 * the room two truths to disagree about.
 */
function auctioneerCall(
  status: LotStatus,
  countdown: Countdown,
): AuctioneerCall {
  if (status === "sold") return { label: "Sold", tone: "closed" };
  if (status === "passed") return { label: "Passed", tone: "closed" };
  if (status === "cancelled") return { label: "Withdrawn", tone: "closed" };
  if (status === "scheduled")
    return { label: statusMeta(status).label, tone: "closed" };
  if (countdown.expired) return { label: "Hammer falling", tone: "ending" };
  if (countdown.totalMs <= 15_000)
    return { label: "Going twice", tone: "ending" };
  if (countdown.totalMs <= 60_000)
    return { label: "Going once", tone: "ending" };
  if (status === "ending") return { label: "Fair warning", tone: "ending" };
  return { label: "Bidding open", tone: "live" };
}
