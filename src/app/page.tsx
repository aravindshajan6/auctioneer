import { SiteFooter } from "@/components/chrome/site-footer";
import { SiteHeader } from "@/components/chrome/site-header";
import { toAskItems, toTickerItems } from "@/components/landing/activity";
import {
  CategoryGrid,
  type CategoryTile,
} from "@/components/landing/categories";
import { ClosingCta } from "@/components/landing/closing-cta";
import {
  ClosingSoonRail,
  type RailLot,
} from "@/components/landing/closing-soon";
import {
  ContestedList,
  type ContestedLot,
} from "@/components/landing/contested";
import { Hero } from "@/components/landing/hero";
import {
  HouseStatsRow,
  type HouseStats,
} from "@/components/landing/house-stats";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LiveTicker } from "@/components/landing/live-ticker";
import { SectionHeading } from "@/components/landing/section";
import { SmoothScroll } from "@/components/landing/smooth-scroll";
import {
  closingSoon,
  featuredLots,
  getHouseStats,
  heroShowcase,
  listCategories,
  recentActivity,
} from "@/lib/queries";

/**
 * Rendered per request. The page's whole claim is that these are the real
 * numbers right now — a cached "current bid" would make it a liar, and it
 * also keeps the build from needing a reachable database.
 */
export const dynamic = "force-dynamic";

const EMPTY_STATS: HouseStats = {
  liveLots: 0,
  lotsSold: 0,
  totalHammerCents: 0,
  members: 0,
  bidsPlaced: 0,
};

/**
 * A marketing page is the one page that must render when the database does
 * not. Each query degrades to an empty section rather than a 500 — the hero,
 * the mechanics and the sign-up path do not depend on Postgres being up.
 */
async function safely<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch {
    return fallback;
  }
}

export default async function LandingPage() {
  const [stats, closing, featured, categories, activity] = await Promise.all([
    safely(() => getHouseStats(), EMPTY_STATS),
    safely(() => closingSoon(10), []),
    safely(() => featuredLots(6), []),
    safely(() => listCategories(), []),
    safely(() => recentActivity(14), []),
  ]);

  // The rack is decoration: if the query fails the hero simply renders without
  // a canvas rather than taking the page down with it.
  const showcase = await safely(
    () => heroShowcase(8),
    [] as Array<{ src: string; title: string }>,
  );

  const rail: RailLot[] = (closing.length > 0 ? closing : featured).map(
    (lot) => ({
      id: lot.id,
      slug: lot.slug,
      title: lot.title,
      images: lot.images,
      status: lot.status,
      currentPriceCents: lot.currentPriceCents,
      bidCount: lot.bidCount,
      watchCount: lot.watchCount,
      hasReserve: lot.hasReserve,
      reserveMet: lot.reserveMet,
      endsAt: lot.endsAt,
      categoryName: lot.category?.name ?? null,
      categoryAccent: lot.category?.accent ?? null,
    }),
  );

  const contested: ContestedLot[] = featured
    .filter((lot) => lot.bidCount > 0)
    .slice(0, 5)
    .map((lot) => ({
      id: lot.id,
      slug: lot.slug,
      title: lot.title,
      images: lot.images,
      currentPriceCents: lot.currentPriceCents,
      bidCount: lot.bidCount,
      categoryName: lot.category?.name ?? null,
    }));

  const tiles: CategoryTile[] = categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    accent: category.accent,
    icon: category.icon,
  }));

  // The wire prefers real events; with none logged yet it falls back to the
  // current asks, which are just as true and never leaves an empty strip.
  const ticker = toTickerItems(activity);
  const tickerItems =
    ticker.length >= 4 ? ticker : [...ticker, ...toAskItems(featured)];

  return (
    <>
      <SmoothScroll />
      <SiteHeader overlay />

      <main id="main" className="flex-1">
        <Hero
          liveLots={stats.liveLots}
          bidsPlaced={stats.bidsPlaced}
          totalHammerCents={stats.totalHammerCents}
          lots={showcase}
        />

        <LiveTicker items={tickerItems} />

        <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
          <section aria-labelledby="numbers-title" className="py-20 sm:py-28">
            <SectionHeading
              eyebrow="The house"
              title={
                <span id="numbers-title">
                  Everything on this page is a real number.
                </span>
              }
              lead="No stock imagery, no invented volume. These figures come straight out of the same tables the bid engine writes to."
            />
            <div className="mt-10">
              <HouseStatsRow stats={stats} />
            </div>
          </section>

          <section aria-labelledby="closing-title" className="pb-20 sm:pb-28">
            <SectionHeading
              eyebrow="Closing soon"
              title={
                <span id="closing-title">
                  On the block, and running out of clock.
                </span>
              }
              lead="Ordered by the time left, not by what the house would like you to see. A bid in the last two minutes puts time back."
              action={{
                label: "All live lots",
                href: "/explore?status=live&sort=ending",
              }}
            />
            <div className="mt-10">
              <ClosingSoonRail lots={rail} />
            </div>
          </section>

          {contested.length > 0 && (
            <section
              aria-labelledby="contested-title"
              className="pb-20 sm:pb-28"
            >
              <SectionHeading
                eyebrow="Most contested"
                title={
                  <span id="contested-title">
                    The lots people refuse to lose.
                  </span>
                }
                lead="Ranked by the number of bids placed, which is a better measure of desire than price."
                action={{
                  label: "Sort by bids",
                  href: "/explore?status=live&sort=most_bids",
                }}
              />
              <div className="mt-10">
                <ContestedList lots={contested} />
              </div>
            </section>
          )}

          <section aria-labelledby="mechanics-title" className="pb-20 sm:pb-28">
            <SectionHeading
              eyebrow="How the room works"
              title={
                <span id="mechanics-title">
                  Four rules that decide who wins.
                </span>
              }
              lead="Auction mechanics are usually hidden because they are unflattering. Ours are worth reading before you place a bid."
              action={{ label: "Full rules", href: "/how-it-works" }}
            />
            <div className="mt-10">
              <HowItWorks />
            </div>
          </section>

          {tiles.length > 0 && (
            <section
              aria-labelledby="departments-title"
              className="pb-20 sm:pb-28"
            >
              <SectionHeading
                eyebrow="Departments"
                title={
                  <span id="departments-title">
                    Specialists, not a search bar.
                  </span>
                }
                lead="Each department sets its own increments, condition language and buyer's premium. Start where you already know what good looks like."
                action={{ label: "Everything", href: "/explore" }}
              />
              <div className="mt-10">
                <CategoryGrid categories={tiles} />
              </div>
            </section>
          )}

          <div className="pb-24 sm:pb-32">
            <ClosingCta liveLots={stats.liveLots} />
          </div>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
