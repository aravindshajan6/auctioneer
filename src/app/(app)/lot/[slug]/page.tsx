import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, ChevronRight, Eye, Gavel, Scroll, Star, Users } from "lucide-react";
import { getLot } from "@/lib/queries";
import { getSession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { formatCents } from "@/lib/auction/money";
import { BidHistory, type BidHistoryEntry } from "@/components/auction/bid-history";
import { BidPanel } from "@/components/auction/bid-panel";
import { toPanelLot, toSeedBids, toSeedState } from "@/components/auction/lot-adapters";
import {
  CONDITION_LABELS,
  CONDITION_NOTES,
  DEFAULT_ACCENT,
  formatBps,
  type LotCondition,
} from "@/components/auction/format";
import { LotGallery } from "@/components/auction/lot-gallery";
import { LotLiveSync } from "@/components/auction/lot-live-sync";
import { MobileBidBar } from "@/components/auction/mobile-bid-bar";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata({ params }: PageProps<"/lot/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const lot = await getLot(slug);
  if (!lot) return { title: "Lot not found" };

  // The price is the news, so it belongs in the share card, not just the title.
  const summary =
    lot.description.trim().slice(0, 180) ||
    `${lot.category?.name ?? "A lot"} consigned to Auctioneer.`;
  const priceLine =
    lot.bidCount > 0
      ? `Current bid ${formatCents(lot.currentPriceCents)}`
      : `Bidding opens at ${formatCents(lot.startingPriceCents)}`;

  return {
    title: lot.title,
    description: `${priceLine}. ${summary}`,
    alternates: { canonical: `/lot/${lot.slug}` },
    openGraph: {
      type: "website",
      title: `${lot.title} — ${priceLine}`,
      description: summary,
      url: `/lot/${lot.slug}`,
      images: lot.images[0] ? [{ url: lot.images[0], alt: lot.title }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: `${lot.title} — ${priceLine}`,
      description: summary,
    },
  };
}

export default async function LotPage({ params }: PageProps<"/lot/[slug]">) {
  const { slug } = await params;
  const session = await getSession();
  const viewerId = session?.user.id ?? null;
  const lot = await getLot(slug, viewerId ?? undefined);
  if (!lot) notFound();

  const accent = lot.category?.accent ?? DEFAULT_ACCENT;
  const isSeller = viewerId === lot.sellerId;

  const seedBids = toSeedBids(lot);
  const seedState = toSeedState(lot);
  const panelLot = toPanelLot(lot);

  const historyEntries: BidHistoryEntry[] = seedBids;
  const condition: LotCondition = lot.condition;

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-32 pt-6 sm:px-8 lg:pb-24">
      <LotLiveSync auctionId={lot.id} state={seedState} bids={seedBids} />

      <nav aria-label="Breadcrumb" className="mb-6">
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-ash">
          <li>
            <Link href="/explore" className="transition-colors hover:text-linen">
              Catalogue
            </Link>
          </li>
          {lot.category?.slug && (
            <>
              <ChevronRight className="size-3" aria-hidden />
              <li>
                <Link
                  href={`/explore?category=${lot.category.slug}`}
                  className="transition-colors hover:text-linen"
                >
                  {lot.category.name}
                </Link>
              </li>
            </>
          )}
          <ChevronRight className="size-3" aria-hidden />
          <li aria-current="page" className="max-w-[16rem] truncate text-fog">
            {lot.title}
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)] lg:gap-10">
        {/* -- Plate ---------------------------------------------------------- */}
        <div className="lg:col-start-1 lg:row-start-1">
          <div className="mb-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {lot.category?.name && (
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] uppercase tracking-[0.12em]"
                  style={{
                    color: accent,
                    background: `color-mix(in oklab, ${accent} 12%, transparent)`,
                    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 30%, transparent)`,
                  }}
                >
                  {lot.category.name}
                </span>
              )}
              <Badge tone="neutral">{CONDITION_LABELS[condition]}</Badge>
              {lot.type === "live" && <Badge tone="gild">Saleroom lot</Badge>}
            </div>
            <h1 className="font-display text-3xl leading-tight font-semibold tracking-tight text-linen sm:text-4xl">
              {lot.title}
            </h1>
          </div>

          <LotGallery
            images={lot.images}
            title={lot.title}
            accent={accent}
            lotNumber={lot.lotNumber}
          />

          <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
            <Stat icon={<Eye className="size-3.5" aria-hidden />} label="Views" value={lot.viewCount} />
            <Stat icon={<Users className="size-3.5" aria-hidden />} label="Bidders" value={lot.bidderCount} />
            <Stat icon={<Gavel className="size-3.5" aria-hidden />} label="Bids" value={lot.bidCount} />
          </dl>
        </div>

        {/* -- Bidding -------------------------------------------------------- */}
        <div className="space-y-5 lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-start lg:sticky lg:top-24">
          <BidPanel
            lot={panelLot}
            viewerId={viewerId}
            viewerName={session?.user.name ?? null}
            isSeller={isSeller}
            antiSnipeWindowSeconds={env().ANTISNIPE_WINDOW_SECONDS}
          />

          <section
            aria-labelledby="seller-heading"
            className="rounded-2xl border border-pewter/45 bg-obsidian/60 p-5"
          >
            <h2
              id="seller-heading"
              className="mb-4 text-[11px] uppercase tracking-[0.14em] text-ash"
            >
              Consigned by
            </h2>
            <div className="flex items-start gap-3">
              <Avatar name={lot.seller.name} size={44} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 font-medium text-linen">
                  <span className="truncate">{lot.seller.name}</span>
                  {lot.seller.sellerVerified && (
                    <BadgeCheck className="size-4 shrink-0 text-gild-300" aria-label="Verified seller" />
                  )}
                </p>
                {lot.seller.handle && (
                  <p className="truncate text-xs text-ash">@{lot.seller.handle}</p>
                )}
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fog">
                  <Star className="size-3.5 fill-gild-400 text-gild-400" aria-hidden />
                  <span className="tabular">
                    {lot.seller.ratingCount > 0
                      ? `${(lot.seller.ratingAvg / 100).toFixed(1)} from ${lot.seller.ratingCount} ${
                          lot.seller.ratingCount === 1 ? "sale" : "sales"
                        }`
                      : "No completed sales yet"}
                  </span>
                </p>
              </div>
            </div>
            <p className="mt-4 border-t border-pewter/35 pt-3.5 text-[11px] leading-relaxed text-ash">
              Every consignment is checked against the house register before it is catalogued.
              Payment is held by Auctioneer until the lot is delivered.
            </p>
          </section>
        </div>

        {/* -- The written catalogue ------------------------------------------ */}
        <div className="space-y-10 lg:col-start-1 lg:row-start-2">
          <section aria-labelledby="description-heading">
            <SectionHeading id="description-heading">Catalogue note</SectionHeading>
            {lot.description ? (
              <div className="space-y-4 text-[15px] leading-relaxed text-fog">
                {lot.description.split(/\n{2,}/).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ash">
                No catalogue note was supplied for this lot. Condition and dimensions are available
                on request before the sale closes.
              </p>
            )}
          </section>

          {lot.provenance && (
            <section aria-labelledby="provenance-heading">
              <SectionHeading id="provenance-heading">Provenance</SectionHeading>
              <div className="rounded-2xl border border-pewter/45 bg-obsidian/50 p-5">
                <div className="flex gap-3">
                  <Scroll className="mt-0.5 size-4 shrink-0 text-gild-400" aria-hidden />
                  <div className="space-y-2.5 text-sm leading-relaxed text-fog">
                    {lot.provenance.split(/\n+/).map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          )}

          <section aria-labelledby="condition-heading">
            <SectionHeading id="condition-heading">Condition</SectionHeading>
            <div className="rounded-2xl border border-pewter/45 bg-obsidian/50 p-5">
              <p className="font-display text-lg text-linen">{CONDITION_LABELS[condition]}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-fog">{CONDITION_NOTES[condition]}</p>
              <p className="mt-4 border-t border-pewter/35 pt-3.5 text-xs leading-relaxed text-ash">
                Condition reports are the house&rsquo;s opinion, offered in good faith. Lots are sold
                as viewed; the absence of a remark does not imply the absence of a fault.
              </p>
            </div>
          </section>

          <section aria-labelledby="history-heading">
            <SectionHeading id="history-heading">
              Bidding history
              <span className="ml-2 text-xs font-normal normal-case tracking-normal text-ash">
                {lot.bidCount} {lot.bidCount === 1 ? "bid" : "bids"} from {lot.bidderCount}{" "}
                {lot.bidderCount === 1 ? "bidder" : "bidders"}
              </span>
            </SectionHeading>
            <div className="rounded-2xl border border-pewter/45 bg-obsidian/50 px-5 py-2">
              <BidHistory
                lotId={lot.id}
                initial={historyEntries}
                viewerId={viewerId}
                leaderId={lot.leaderId}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ash">
              Bidders are shown by initial, as they would be by paddle in the room. Bids marked
              &ldquo;automatic&rdquo; were placed by the house on a bidder&rsquo;s behalf, against a
              maximum only they can see.
            </p>
          </section>

          <section aria-labelledby="terms-heading">
            <SectionHeading id="terms-heading">Terms of sale</SectionHeading>
            <dl className="grid gap-px overflow-hidden rounded-2xl border border-pewter/45 bg-pewter/25 sm:grid-cols-2">
              <Term label="Buyer's premium">
                {formatBps(lot.buyersPremiumBps)} of the hammer price, added to your invoice.
              </Term>
              <Term label="Reserve">
                {lot.hasReserve
                  ? "This lot carries a confidential reserve. It will not sell below it."
                  : "Offered without reserve — it sells to the highest bidder."}
              </Term>
              <Term label="Anti-snipe">
                A bid in the closing moments extends the clock so the room can answer.
              </Term>
              <Term label="Settlement">
                Funds are held on deposit while you lead, and released the moment you are outbid.
              </Term>
            </dl>
          </section>

          {/*
            Where the object's catalogue record actually came from.
            Most of these collections are CC0 and ask for nothing, but a
            catalogue that cannot cite its own facts is not a catalogue — and
            some of the descriptive text is CC-BY, where the credit is a
            condition of use rather than a courtesy.
          */}
          {lot.sourceName && (
            <section aria-labelledby="source-heading">
              <SectionHeading id="source-heading">Catalogue record</SectionHeading>
              <div className="rounded-2xl border border-pewter/45 bg-obsidian/60 px-5 py-4">
                <p className="text-sm leading-relaxed text-fog">
                  This lot describes a real object held by{" "}
                  <span className="text-linen">{lot.sourceName}</span>, whose collection data is
                  published for open access. The object is not for sale; it stands in here so the
                  saleroom can be demonstrated against genuine catalogue records rather than
                  invented ones.
                </p>
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ash">
                  {lot.sourceUrl && (
                    <a
                      href={lot.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-gild-300 underline-offset-4 hover:underline"
                    >
                      View the museum record
                    </a>
                  )}
                  {lot.sourceLicense && <span>Licence: {lot.sourceLicense}</span>}
                </p>
              </div>
            </section>
          )}
        </div>
      </div>

      <MobileBidBar
        lotId={lot.id}
        currentPriceCents={lot.currentPriceCents}
        endsAt={lot.endsAt.toISOString()}
        status={lot.status}
      />
    </div>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="mb-4 text-[11px] uppercase tracking-[0.16em] text-ash after:mt-3 after:block after:h-px after:w-full after:bg-pewter/40"
    >
      {children}
    </h2>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-pewter/40 bg-obsidian/40 py-3">
      <dt className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-ash">
        {icon}
        {label}
      </dt>
      <dd className="tabular mt-1 font-display text-lg text-linen">{value.toLocaleString("en-US")}</dd>
    </div>
  );
}

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-obsidian/70 p-5">
      <dt className="text-[11px] uppercase tracking-[0.12em] text-ash">{label}</dt>
      <dd className="mt-1.5 text-sm leading-relaxed text-fog">{children}</dd>
    </div>
  );
}
