import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, Gavel } from "lucide-react";
import { getActiveSale, getLot, closingSoon } from "@/lib/queries";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { DEFAULT_ACCENT } from "@/components/auction/format";
import { LiveRoom, type LiveRoomCurrentLot } from "@/components/auction/live-room";
import { LotCard } from "@/components/auction/lot-card";
import { LotFilmstrip, type FilmstripLot } from "@/components/auction/lot-filmstrip";
import { SaleCountdown } from "@/components/auction/sale-countdown";
import { toPanelLot, toSeedBids, toSeedState } from "@/components/auction/lot-adapters";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "The live saleroom",
  description:
    "Follow the sale as the auctioneer works the run: the lot on the block, the bids as they land, and the room's chatter — all in real time.",
};

const dateFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export default async function LivePage() {
  const [sale, session] = await Promise.all([getActiveSale(), getSession()]);
  const viewerId = session?.user.id ?? null;

  if (!sale) {
    const upcoming = await closingSoon(4);
    return (
      <NoSaleScheduled>
        {upcoming.length > 0 && (
          <ul className="mt-12 grid grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
            {upcoming.map((lot) => (
              <li key={lot.id}>
                <LotCard lot={lot} signedIn={Boolean(viewerId)} />
              </li>
            ))}
          </ul>
        )}
      </NoSaleScheduled>
    );
  }

  const strip: FilmstripLot[] = sale.lots.map((lot) => ({
    id: lot.id,
    slug: lot.slug,
    title: lot.title,
    images: lot.images,
    lotNumber: lot.lotNumber,
    status: lot.status,
    currentPriceCents: lot.currentPriceCents,
    startingPriceCents: lot.startingPriceCents,
    bidCount: lot.bidCount,
  }));

  /* -- A sale that has not been called yet is a poster, not a room. ------- */
  if (sale.status !== "live" && sale.status !== "paused") {
    return (
      <div className="mx-auto w-full max-w-7xl px-5 pb-24 pt-10 sm:px-8">
        <section className="overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/60 p-7 sm:p-10">
          <p className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-gild-400">
            <CalendarClock className="size-3.5" aria-hidden />
            Next sale
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-linen sm:text-5xl">
            {sale.title}
          </h1>
          {sale.description && (
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fog sm:text-base">
              {sale.description}
            </p>
          )}

          <div className="mt-8 h-px w-full hairline" aria-hidden />

          <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-ash">
                The auctioneer opens
              </p>
              <SaleCountdown target={sale.scheduledFor.toISOString()} />
              <p className="mt-3 text-sm text-fog">{dateFormat.format(sale.scheduledFor)}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/explore?status=scheduled">
                <Button variant="gild" size="md">
                  Preview the catalogue
                </Button>
              </Link>
              <Link href="/explore?status=live">
                <Button variant="outline" size="md">
                  Bid on timed lots
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {strip.length > 0 && (
          <div className="mt-10">
            <LotFilmstrip lots={strip} currentId={null} />
          </div>
        )}
      </div>
    );
  }

  /* -- Which lot is on the block? ---------------------------------------- */
  // The sale row is authoritative, but a scheduler tick can lag; fall back to
  // whatever is actually open so the room is never pointed at a closed lot.
  const summary =
    sale.lots.find((lot) => lot.id === sale.currentAuctionId) ??
    sale.lots.find((lot) => lot.status === "live" || lot.status === "ending") ??
    sale.lots[0] ??
    null;

  const detail = summary ? await getLot(summary.slug, viewerId ?? undefined) : null;

  const current: LiveRoomCurrentLot | null = detail
    ? {
        panel: toPanelLot(detail),
        state: toSeedState(detail),
        bids: toSeedBids(detail),
        images: detail.images,
        accent: detail.category?.accent ?? DEFAULT_ACCENT,
        isSeller: viewerId === detail.sellerId,
      }
    : null;

  return (
    <LiveRoom
      saleTitle={sale.title}
      saleStatus={sale.status}
      lots={strip}
      current={current}
      viewerId={viewerId}
      viewerName={session?.user.name ?? null}
      antiSnipeWindowSeconds={env().ANTISNIPE_WINDOW_SECONDS}
    />
  );
}

function NoSaleScheduled({ children }: { children?: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-24 pt-16 sm:px-8">
      <div className="mx-auto max-w-2xl text-center">
        <span className="mb-6 inline-flex size-16 items-center justify-center rounded-full border border-gild-600/40 bg-gild-500/[0.07] text-gild-300">
          <Gavel className="size-7" aria-hidden />
        </span>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-linen sm:text-5xl">
          The rostrum is empty
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-fog sm:text-base">
          No live sale is being called right now. Our specialists are cataloguing the next one — in
          the meantime, timed lots are open for bidding around the clock, and every price on them
          updates here live.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/explore?status=live">
            <Button variant="gild" size="lg">
              Bid on open lots
            </Button>
          </Link>
          <Link href="/explore?status=scheduled">
            <Button variant="outline" size="lg">
              See what is coming
            </Button>
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}
