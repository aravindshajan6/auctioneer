import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "./db";
import {
  auctionEvents,
  auctions,
  bids,
  categories,
  notifications,
  orders,
  sales,
  user,
  watchlist,
} from "./db/schema";
import { minimumNextBid } from "./auction/increments";

/** Columns safe to expose for a seller/bidder. Never selects `*` off `user`. */
const publicUser = {
  id: user.id,
  name: user.name,
  handle: user.handle,
  image: user.image,
  ratingAvg: user.ratingAvg,
  ratingCount: user.ratingCount,
  sellerVerified: user.sellerVerified,
};

export type LotCard = Awaited<ReturnType<typeof listLots>>["lots"][number];

export interface LotFilters {
  q?: string;
  category?: string;
  status?: "live" | "scheduled" | "sold" | "passed" | "ending";
  sort?: "ending" | "newest" | "price_desc" | "price_asc" | "most_bids";
  minCents?: number;
  maxCents?: number;
  page?: number;
  perPage?: number;
}

export async function listLots(filters: LotFilters = {}) {
  const {
    q,
    category,
    status,
    sort = "ending",
    minCents,
    maxCents,
    page = 1,
    perPage = 24,
  } = filters;

  const conditions = [ne(auctions.status, "draft")];

  if (status === "live") {
    // "Live" in the UI means biddable, which spans the soft-close state too.
    conditions.push(inArray(auctions.status, ["live", "ending"]));
  } else if (status) {
    conditions.push(eq(auctions.status, status));
  }
  if (category) conditions.push(eq(categories.slug, category));
  if (q) {
    conditions.push(
      or(
        ilike(auctions.title, `%${q}%`),
        ilike(auctions.description, `%${q}%`),
      )!,
    );
  }
  if (minCents !== undefined)
    conditions.push(gte(auctions.currentPriceCents, minCents));
  if (maxCents !== undefined)
    conditions.push(lt(auctions.currentPriceCents, maxCents));

  const orderBy = {
    ending: asc(auctions.endsAt),
    newest: desc(auctions.createdAt),
    price_desc: desc(auctions.currentPriceCents),
    price_asc: asc(auctions.currentPriceCents),
    most_bids: desc(auctions.bidCount),
  }[sort];

  const where = and(...conditions);

  const rows = await db
    .select({
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      images: auctions.images,
      type: auctions.type,
      status: auctions.status,
      condition: auctions.condition,
      startingPriceCents: auctions.startingPriceCents,
      currentPriceCents: auctions.currentPriceCents,
      buyNowPriceCents: auctions.buyNowPriceCents,
      reserveMet: auctions.reserveMet,
      hasReserve: sql<boolean>`${auctions.reservePriceCents} is not null`,
      bidCount: auctions.bidCount,
      watchCount: auctions.watchCount,
      startsAt: auctions.startsAt,
      endsAt: auctions.endsAt,
      seller: publicUser,
      category: {
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        accent: categories.accent,
        icon: categories.icon,
      },
    })
    .from(auctions)
    .innerJoin(user, eq(auctions.sellerId, user.id))
    .leftJoin(categories, eq(auctions.categoryId, categories.id))
    .where(where)
    .orderBy(orderBy)
    .limit(perPage)
    .offset((page - 1) * perPage);

  const [{ total }] = await db
    .select({ total: count() })
    .from(auctions)
    .leftJoin(categories, eq(auctions.categoryId, categories.id))
    .where(where);

  return {
    lots: rows,
    total,
    page,
    perPage,
    pages: Math.ceil(total / perPage),
  };
}

/** Full detail for a lot page, including the visible bid history. */
export async function getLot(slug: string, viewerId?: string) {
  const [lot] = await db
    .select({
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      description: auctions.description,
      provenance: auctions.provenance,
      images: auctions.images,
      condition: auctions.condition,
      type: auctions.type,
      status: auctions.status,
      startingPriceCents: auctions.startingPriceCents,
      currentPriceCents: auctions.currentPriceCents,
      buyNowPriceCents: auctions.buyNowPriceCents,
      buyersPremiumBps: auctions.buyersPremiumBps,
      reserveMet: auctions.reserveMet,
      hasReserve: sql<boolean>`${auctions.reservePriceCents} is not null`,
      bidCount: auctions.bidCount,
      bidderCount: auctions.bidderCount,
      watchCount: auctions.watchCount,
      viewCount: auctions.viewCount,
      extensionCount: auctions.extensionCount,
      startsAt: auctions.startsAt,
      endsAt: auctions.endsAt,
      originalEndsAt: auctions.originalEndsAt,
      closedAt: auctions.closedAt,
      winnerId: auctions.winnerId,
      version: auctions.version,
      sellerId: auctions.sellerId,
      sourceName: auctions.sourceName,
      sourceUrl: auctions.sourceUrl,
      sourceLicense: auctions.sourceLicense,
      saleId: auctions.saleId,
      lotNumber: auctions.lotNumber,
      seller: publicUser,
      category: {
        id: categories.id,
        slug: categories.slug,
        name: categories.name,
        accent: categories.accent,
        icon: categories.icon,
      },
    })
    .from(auctions)
    .innerJoin(user, eq(auctions.sellerId, user.id))
    .leftJoin(categories, eq(auctions.categoryId, categories.id))
    .where(eq(auctions.slug, slug))
    .limit(1);

  if (!lot) return null;

  const history = await db
    .select({
      id: bids.id,
      bidderId: bids.bidderId,
      amountCents: bids.amountCents,
      type: bids.type,
      status: bids.status,
      createdAt: bids.createdAt,
      bidderName: user.name,
    })
    .from(bids)
    .innerJoin(user, eq(bids.bidderId, user.id))
    .where(eq(bids.auctionId, lot.id))
    .orderBy(desc(bids.createdAt))
    .limit(60);

  // The viewer's own standing ceiling is private to them, but they are
  // entitled to see it — it is the only way to know if a raise is needed.
  let yourMaxCents: number | null = null;
  let watching = false;
  if (viewerId) {
    const [own] = await db
      .select({ maxAmountCents: bids.maxAmountCents })
      .from(bids)
      .where(and(eq(bids.auctionId, lot.id), eq(bids.bidderId, viewerId)))
      .orderBy(desc(bids.maxAmountCents))
      .limit(1);
    yourMaxCents = own?.maxAmountCents ?? null;

    const [w] = await db
      .select({ userId: watchlist.userId })
      .from(watchlist)
      .where(
        and(eq(watchlist.auctionId, lot.id), eq(watchlist.userId, viewerId)),
      )
      .limit(1);
    watching = Boolean(w);
  }

  const leaderId =
    history.find((b) => b.status === "winning")?.bidderId ?? null;

  return {
    ...lot,
    history,
    leaderId,
    yourMaxCents,
    watching,
    minimumNextBidCents: minimumNextBid({
      currentPriceCents: lot.currentPriceCents,
      startingPriceCents: lot.startingPriceCents,
      hasBids: lot.bidCount > 0,
    }),
  };
}

export type LotDetail = NonNullable<Awaited<ReturnType<typeof getLot>>>;

export async function listCategories() {
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

/** Lots closing soonest — the homepage urgency rail. */
export async function closingSoon(limit = 8) {
  const { lots } = await listLots({
    status: "live",
    sort: "ending",
    perPage: limit,
  });
  return lots;
}

export async function featuredLots(limit = 6) {
  const { lots } = await listLots({
    status: "live",
    sort: "most_bids",
    perPage: limit,
  });
  return lots;
}

/** The curated live sale currently on the block, with its run of lots. */
export async function getActiveSale() {
  const [sale] = await db
    .select()
    .from(sales)
    .where(inArray(sales.status, ["live", "scheduled"]))
    .orderBy(asc(sales.scheduledFor))
    .limit(1);
  if (!sale) return null;

  const lots = await db
    .select({
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      images: auctions.images,
      lotNumber: auctions.lotNumber,
      status: auctions.status,
      currentPriceCents: auctions.currentPriceCents,
      startingPriceCents: auctions.startingPriceCents,
      bidCount: auctions.bidCount,
      endsAt: auctions.endsAt,
    })
    .from(auctions)
    .where(eq(auctions.saleId, sale.id))
    .orderBy(asc(auctions.lotNumber));

  return { ...sale, lots };
}

export async function getWallet(userId: string) {
  const { wallets, ledgerEntries } = await import("./db/schema");
  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  if (!wallet) return null;
  const entries = await db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.walletId, wallet.id))
    .orderBy(desc(ledgerEntries.createdAt))
    .limit(60);
  return { ...wallet, entries };
}

/** Everything the signed-in user is currently chasing. */
export async function getMyBidding(userId: string) {
  const rows = await db
    .selectDistinctOn([auctions.id], {
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      images: auctions.images,
      status: auctions.status,
      currentPriceCents: auctions.currentPriceCents,
      endsAt: auctions.endsAt,
      bidCount: auctions.bidCount,
      yourMaxCents: bids.maxAmountCents,
      leading: sql<boolean>`${bids.status} = 'winning'`,
    })
    .from(bids)
    .innerJoin(auctions, eq(bids.auctionId, auctions.id))
    .where(eq(bids.bidderId, userId))
    .orderBy(auctions.id, desc(bids.maxAmountCents));
  return rows;
}

export async function getMyLots(userId: string) {
  return db
    .select({
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      images: auctions.images,
      status: auctions.status,
      type: auctions.type,
      currentPriceCents: auctions.currentPriceCents,
      startingPriceCents: auctions.startingPriceCents,
      bidCount: auctions.bidCount,
      watchCount: auctions.watchCount,
      viewCount: auctions.viewCount,
      startsAt: auctions.startsAt,
      endsAt: auctions.endsAt,
    })
    .from(auctions)
    .where(eq(auctions.sellerId, userId))
    .orderBy(desc(auctions.createdAt));
}

export async function getMyWatchlist(userId: string) {
  return db
    .select({
      id: auctions.id,
      slug: auctions.slug,
      title: auctions.title,
      images: auctions.images,
      status: auctions.status,
      currentPriceCents: auctions.currentPriceCents,
      endsAt: auctions.endsAt,
      bidCount: auctions.bidCount,
    })
    .from(watchlist)
    .innerJoin(auctions, eq(watchlist.auctionId, auctions.id))
    .where(eq(watchlist.userId, userId))
    .orderBy(asc(auctions.endsAt));
}

export async function getMyOrders(userId: string) {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      hammerPriceCents: orders.hammerPriceCents,
      buyersPremiumCents: orders.buyersPremiumCents,
      totalCents: orders.totalCents,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      buyerId: orders.buyerId,
      sellerId: orders.sellerId,
      lot: {
        slug: auctions.slug,
        title: auctions.title,
        images: auctions.images,
      },
    })
    .from(orders)
    .innerJoin(auctions, eq(orders.auctionId, auctions.id))
    .where(or(eq(orders.buyerId, userId), eq(orders.sellerId, userId)))
    .orderBy(desc(orders.createdAt));
}

export async function getNotifications(userId: string, limit = 30) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/** Headline numbers for the marketing page. Real data, not decoration. */
export async function getHouseStats() {
  const [live] = await db
    .select({ n: count() })
    .from(auctions)
    .where(inArray(auctions.status, ["live", "ending"]));
  const [sold] = await db
    .select({
      n: count(),
      total: sql<string>`coalesce(sum(${auctions.currentPriceCents}),0)`,
    })
    .from(auctions)
    .where(eq(auctions.status, "sold"));
  const [bidders] = await db.select({ n: count() }).from(user);
  const [allBids] = await db.select({ n: count() }).from(bids);

  return {
    liveLots: live?.n ?? 0,
    lotsSold: sold?.n ?? 0,
    totalHammerCents: Number(sold?.total ?? 0),
    members: bidders?.n ?? 0,
    bidsPlaced: allBids?.n ?? 0,
  };
}

/**
 * Lots for the hero carousel: one per department, photographed only.
 *
 * Generated SVG plates are deliberately excluded. On a flat card they read as
 * intentional artwork, but framed and turning on a rack beside real
 * photographs they read as missing images — and the point of the rack is to
 * show the room what is actually in the sale.
 */
export async function heroShowcase(limit = 8) {
  const rows = await db
    .selectDistinctOn([auctions.categoryId], {
      src: sql<string>`${auctions.images}->>0`,
      title: auctions.title,
      categoryId: auctions.categoryId,
      bidCount: auctions.bidCount,
    })
    .from(auctions)
    .where(
      and(
        ne(auctions.status, "draft"),
        sql`${auctions.images}->>0 like '%.jpg'`,
      ),
    )
    .orderBy(auctions.categoryId, desc(auctions.bidCount));

  // Busiest departments first, so a short rack still shows the strongest lots.
  return rows
    .sort((a, b) => b.bidCount - a.bidCount)
    .slice(0, limit)
    .map(({ src, title }) => ({ src, title }));
}

/** Recent activity across the house — powers the live ticker. */
export async function recentActivity(limit = 12) {
  return db
    .select({
      id: auctionEvents.id,
      type: auctionEvents.type,
      payload: auctionEvents.payload,
      createdAt: auctionEvents.createdAt,
      lotTitle: auctions.title,
      lotSlug: auctions.slug,
      actorName: user.name,
    })
    .from(auctionEvents)
    .innerJoin(auctions, eq(auctionEvents.auctionId, auctions.id))
    .leftJoin(user, eq(auctionEvents.actorId, user.id))
    .orderBy(desc(auctionEvents.createdAt))
    .limit(limit);
}
