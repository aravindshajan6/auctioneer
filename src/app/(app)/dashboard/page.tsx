import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Eye, Gavel, Plus, TriangleAlert, Users } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import {
  getMyBidding,
  getMyLots,
  getMyOrders,
  getMyWatchlist,
  getNotifications,
  getWallet,
} from "@/lib/queries";
import { formatCents } from "@/lib/auction/money";
import { minimumNextBid } from "@/lib/auction/increments";
import { Countdown } from "@/components/account/countdown";
import { EmptyState } from "@/components/account/empty-state";
import { LotThumb } from "@/components/account/lot-thumb";
import {
  NotificationsPanel,
  type NotificationDay,
} from "@/components/account/notifications-panel";
import { LotStatusPill } from "@/components/account/status-pill";
import { StatTile } from "@/components/account/stat-tile";
import { Tabs } from "@/components/account/tabs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Your dashboard",
  description: "Everything you are bidding on, watching, selling and owed.",
};

/** Live prices and countdowns must never be served from a cache. */
export const dynamic = "force-dynamic";

type BiddingRow = Awaited<ReturnType<typeof getMyBidding>>[number];
type WatchRow = Awaited<ReturnType<typeof getMyWatchlist>>[number];
type SellerRow = Awaited<ReturnType<typeof getMyLots>>[number];

const OPEN_STATUSES = new Set(["live", "ending"]);

export default async function DashboardPage() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in?next=/dashboard");
  const userId = session.user.id;

  const [bidding, watchlist, lots, notifications, wallet, orders] = await Promise.all([
    getMyBidding(userId),
    getMyWatchlist(userId),
    getMyLots(userId),
    getNotifications(userId),
    getWallet(userId),
    getMyOrders(userId),
  ]);

  const openBids = bidding.filter((row) => OPEN_STATUSES.has(row.status));
  const leadingCount = openBids.filter((row) => row.leading).length;
  const outbidCount = openBids.length - leadingCount;
  const unreadCount = notifications.filter((n) => n.readAt === null).length;
  const dueOrders = orders.filter(
    (o) => o.buyerId === userId && o.status === "awaiting_payment",
  ).length;

  const days = groupByDay(notifications);

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium tracking-[0.2em] text-gild-400 uppercase">
            The paddle of
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-linen sm:text-4xl">
            {session.user.name}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/explore"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-pewter/60 px-4 text-sm text-fog transition-colors hover:border-gild-500/60 hover:text-linen"
          >
            Browse lots
          </Link>
          <Link
            href="/sell"
            className="inline-flex h-10 items-center gap-2 rounded-full bg-linear-to-b from-gild-300 to-gild-500 px-4 text-sm font-medium text-obsidian transition-colors hover:from-gild-200 hover:to-gild-400"
          >
            <Plus className="size-4" aria-hidden />
            Consign a lot
          </Link>
        </div>
      </header>

      {outbidCount > 0 && (
        <Link
          href="#panel-bidding"
          className="mt-7 flex items-center gap-3 rounded-2xl border border-ember-500/50 bg-ember-500/10 px-4 py-3.5 transition-colors hover:bg-ember-500/15"
        >
          <TriangleAlert className="size-4 shrink-0 text-ember-300" aria-hidden />
          <p className="text-sm text-ember-300">
            You have been outbid on{" "}
            <span className="tabular font-semibold">{outbidCount}</span>{" "}
            {outbidCount === 1 ? "lot that is" : "lots that are"} still open.
          </p>
          <ArrowUpRight className="ml-auto size-4 shrink-0 text-ember-300/70" aria-hidden />
        </Link>
      )}

      <section className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Active bids"
          value={String(openBids.length)}
          hint={`${bidding.length} lots chased in total`}
        />
        <StatTile
          label="Leading"
          value={String(leadingCount)}
          tone={leadingCount > 0 ? "gild" : "neutral"}
          hint="Highest maximum on the lot"
        />
        <StatTile
          label="Outbid"
          value={String(outbidCount)}
          tone={outbidCount > 0 ? "ember" : "neutral"}
          hint={outbidCount > 0 ? "Raise your ceiling to retake" : "Nothing to answer"}
        />
        <StatTile
          label="Watching"
          value={String(watchlist.length)}
          hint="Saved, not yet bid on"
        />
        <StatTile
          label="Wallet available"
          value={wallet ? formatCents(wallet.availableCents, { compact: true }) : "—"}
          href="/wallet"
          tone="gild"
          hint={
            wallet && wallet.heldCents > 0
              ? `${formatCents(wallet.heldCents, { compact: true })} held against live bids`
              : "Spendable right now"
          }
        />
      </section>

      {dueOrders > 0 && (
        <Link
          href="/orders"
          className="mt-3 flex items-center gap-3 rounded-2xl border border-gild-600/50 bg-gild-500/[0.07] px-4 py-3.5 transition-colors hover:bg-gild-500/[0.12]"
        >
          <Gavel className="size-4 shrink-0 text-gild-300" aria-hidden />
          <p className="text-sm text-gild-200">
            {dueOrders === 1 ? "One lot you won is" : `${dueOrders} lots you won are`} awaiting
            payment.
          </p>
          <ArrowUpRight className="ml-auto size-4 shrink-0 text-gild-300/70" aria-hidden />
        </Link>
      )}

      <div className="mt-10">
        <Tabs
          tabs={[
            {
              id: "bidding",
              label: "Bidding on",
              count: bidding.length,
              panel: <BiddingList rows={bidding} />,
            },
            {
              id: "watchlist",
              label: "Watchlist",
              count: watchlist.length,
              panel: <WatchList rows={watchlist} />,
            },
            {
              id: "selling",
              label: "Your lots",
              count: lots.length,
              panel: <SellerList rows={lots} />,
            },
            {
              id: "notifications",
              label: "Notifications",
              count: unreadCount,
              panel: <NotificationsPanel days={days} unreadCount={unreadCount} />,
            },
          ]}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bidding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The single most important list on the platform, so it is ordered by what
 * needs a decision rather than by time: lots you are losing and can still win,
 * then lots you are holding, then everything already settled.
 */
function biddingRank(row: BiddingRow): number {
  const open = OPEN_STATUSES.has(row.status);
  if (open && !row.leading) return 0;
  if (open) return 1;
  return 2;
}

function BiddingList({ rows }: { rows: BiddingRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="You have not bid on anything yet"
        body="Name a maximum on any open lot and the house bids for you — one increment at a time, never more than it needs to."
        action={{ label: "Find something worth chasing", href: "/explore" }}
      />
    );
  }

  const sorted = [...rows].sort(
    (a, b) =>
      biddingRank(a) - biddingRank(b) ||
      new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime(),
  );

  return (
    <ul className="space-y-2.5">
      {sorted.map((row) => {
        const open = OPEN_STATUSES.has(row.status);
        const leading = row.leading;
        const nextBid = minimumNextBid({
          currentPriceCents: row.currentPriceCents,
          startingPriceCents: row.currentPriceCents,
          hasBids: true,
        });
        return (
          <li key={row.id}>
            <div
              className={cn(
                "relative overflow-hidden rounded-2xl border bg-obsidian/60 backdrop-blur-xl",
                open && leading && "border-gild-600/55",
                open && !leading && "border-ember-500/55",
                !open && "border-pewter/40",
              )}
            >
              {/* A full-height edge in the state colour: legible from across
                  the room, and it survives being scanned at speed. */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-0 left-0 w-1",
                  open && leading && "bg-linear-to-b from-gild-300 to-gild-600",
                  open && !leading && "bg-linear-to-b from-ember-300 to-ember-600",
                  !open && "bg-pewter/60",
                )}
              />
              <div className="flex flex-wrap items-center gap-4 py-4 pr-4 pl-5 sm:flex-nowrap">
                <LotThumb
                  src={row.images[0]}
                  alt={row.title}
                  className="size-14 sm:size-16"
                />

                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <div className="flex flex-wrap items-center gap-2">
                    {open ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.09em] uppercase",
                          leading
                            ? "border-gild-400/60 bg-gild-500/20 text-gild-100"
                            : "border-ember-400/60 bg-ember-500/20 text-ember-300",
                        )}
                      >
                        {leading ? "You are leading" : "Outbid"}
                      </span>
                    ) : (
                      <LotStatusPill status={row.status} />
                    )}
                    <Countdown endsAt={new Date(row.endsAt).toISOString()} prefix="closes in" />
                  </div>
                  <Link
                    href={`/lot/${row.slug}`}
                    className="mt-1.5 block truncate font-display text-[15px] font-medium text-linen transition-colors hover:text-gild-200"
                  >
                    {row.title}
                  </Link>
                  <p className="tabular mt-0.5 text-[12px] text-ash">
                    {row.bidCount} {row.bidCount === 1 ? "bid" : "bids"}
                  </p>
                </div>

                <dl className="flex basis-full gap-6 sm:basis-auto sm:justify-end">
                  <div>
                    <dt className="text-[10.5px] tracking-[0.12em] text-ash uppercase">
                      Current
                    </dt>
                    <dd className="tabular mt-1 font-display text-lg font-semibold text-linen">
                      {formatCents(row.currentPriceCents)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10.5px] tracking-[0.12em] text-ash uppercase">
                      Your maximum
                    </dt>
                    <dd
                      className={cn(
                        "tabular mt-1 font-display text-lg font-semibold",
                        leading ? "text-gild-200" : "text-ember-300",
                      )}
                    >
                      {formatCents(row.yourMaxCents)}
                    </dd>
                  </div>
                </dl>

                {open && (
                  <Link
                    href={`/lot/${row.slug}`}
                    className={cn(
                      "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors",
                      leading
                        ? "border border-pewter/60 text-fog hover:border-gild-500/60 hover:text-linen"
                        : "bg-linear-to-b from-gild-300 to-gild-500 text-obsidian hover:from-gild-200 hover:to-gild-400",
                    )}
                  >
                    {leading ? "View lot" : `Raise to ${formatCents(nextBid, { compact: true })}`}
                  </Link>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Watchlist                                                                   */
/* -------------------------------------------------------------------------- */

function WatchList({ rows }: { rows: WatchRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Your watchlist is empty"
        body="Watching a lot keeps it here and puts its closing time in front of you. It costs nothing and commits nothing."
        action={{ label: "Browse the catalogue", href: "/explore" }}
      />
    );
  }
  return (
    <ul className="grid gap-2.5 sm:grid-cols-2">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/lot/${row.slug}`}
            className="flex items-center gap-4 rounded-2xl border border-pewter/40 bg-obsidian/60 p-3.5 transition-colors hover:border-gild-500/55"
          >
            <LotThumb src={row.images[0]} alt={row.title} className="size-14" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <LotStatusPill status={row.status} />
                <Countdown endsAt={new Date(row.endsAt).toISOString()} />
              </div>
              <p className="mt-1.5 truncate font-display text-[15px] font-medium text-linen">
                {row.title}
              </p>
              <p className="tabular mt-0.5 text-[12px] text-ash">
                {formatCents(row.currentPriceCents)} · {row.bidCount}{" "}
                {row.bidCount === 1 ? "bid" : "bids"}
              </p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Selling                                                                     */
/* -------------------------------------------------------------------------- */

function SellerList({ rows }: { rows: SellerRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing consigned yet"
        body="Listing is five steps: the object, its photographs, what it should open at, when it runs, and a last look before it goes on the block."
        action={{ label: "Consign your first lot", href: "/sell" }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-ash">
          {rows.length} {rows.length === 1 ? "consignment" : "consignments"}
        </p>
        <Link
          href="/sell"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gild-600/60 bg-gild-500/10 px-4 text-[13px] text-gild-200 transition-colors hover:bg-gild-500/20"
        >
          <Plus className="size-3.5" aria-hidden />
          New listing
        </Link>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-separate border-spacing-y-2 text-left">
          <thead>
            <tr className="text-[10.5px] tracking-[0.12em] text-ash uppercase">
              <th scope="col" className="px-4 pb-1 font-medium">Lot</th>
              <th scope="col" className="px-4 pb-1 font-medium">Status</th>
              <th scope="col" className="px-4 pb-1 text-right font-medium">Current</th>
              <th scope="col" className="px-4 pb-1 text-right font-medium">Bids</th>
              <th scope="col" className="px-4 pb-1 text-right font-medium">Watchers</th>
              <th scope="col" className="px-4 pb-1 text-right font-medium">Views</th>
              <th scope="col" className="px-4 pb-1 text-right font-medium">Closes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="bg-obsidian/60">
                <td className="rounded-l-xl border-y border-l border-pewter/40 px-4 py-3">
                  <Link href={`/lot/${row.slug}`} className="flex items-center gap-3">
                    <LotThumb src={row.images[0]} alt={row.title} className="size-10" />
                    <span className="max-w-[18rem] truncate font-display text-sm font-medium text-linen">
                      {row.title}
                    </span>
                  </Link>
                </td>
                <td className="border-y border-pewter/40 px-4 py-3">
                  <LotStatusPill status={row.status} />
                </td>
                <td className="tabular border-y border-pewter/40 px-4 py-3 text-right text-sm text-linen">
                  {formatCents(row.currentPriceCents)}
                  <span className="block text-[11px] text-ash">
                    from {formatCents(row.startingPriceCents, { compact: true })}
                  </span>
                </td>
                <td className="tabular border-y border-pewter/40 px-4 py-3 text-right text-sm text-fog">
                  {row.bidCount}
                </td>
                <td className="border-y border-pewter/40 px-4 py-3 text-right text-sm text-fog">
                  <span className="tabular inline-flex items-center gap-1.5">
                    <Users className="size-3.5 text-ash" aria-hidden />
                    {row.watchCount}
                  </span>
                </td>
                <td className="border-y border-pewter/40 px-4 py-3 text-right text-sm text-fog">
                  <span className="tabular inline-flex items-center gap-1.5">
                    <Eye className="size-3.5 text-ash" aria-hidden />
                    {row.viewCount}
                  </span>
                </td>
                <td className="rounded-r-xl border-y border-r border-pewter/40 px-4 py-3 text-right">
                  <Countdown endsAt={new Date(row.endsAt).toISOString()} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/**
 * Grouped and formatted on the SERVER. Dates rendered on both sides of the
 * hydration boundary are a classic mismatch; formatting once and shipping the
 * finished string removes the class of bug entirely.
 */
function groupByDay(
  rows: Awaited<ReturnType<typeof getNotifications>>,
): NotificationDay[] {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const groups = new Map<string, NotificationDay>();

  for (const row of rows) {
    const created = new Date(row.createdAt);
    const startOfRow = new Date(
      created.getFullYear(),
      created.getMonth(),
      created.getDate(),
    ).getTime();
    const daysAgo = Math.round((startOfToday - startOfRow) / 86_400_000);
    const label =
      daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : DAY_FORMAT.format(created);

    const group = groups.get(label) ?? { label, items: [] };
    group.items.push({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      href: row.href,
      time: TIME_FORMAT.format(created),
      unread: row.readAt === null,
    });
    groups.set(label, group);
  }

  return [...groups.values()];
}
