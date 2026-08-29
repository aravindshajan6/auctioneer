/**
 * Auctioneer — Postgres schema (Drizzle ORM).
 *
 * Money is ALWAYS stored as integer minor units (cents) in bigint columns.
 * Never floats: a float `currentPrice` is how auction platforms lose money.
 */
import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const userRoleEnum = pgEnum("user_role", ["bidder", "seller", "admin"]);

export const auctionTypeEnum = pgEnum("auction_type", ["timed", "live"]);

/**
 * Auction lifecycle.
 *  draft      -> seller is still editing, invisible to buyers
 *  scheduled  -> published, countdown to `startsAt`
 *  live       -> accepting bids
 *  ending     -> inside the soft-close window (UI shows the "going once" state)
 *  sold       -> closed with a winner at or above reserve
 *  passed     -> closed with no winner (no bids, or reserve not met)
 *  cancelled  -> withdrawn by seller/admin
 */
export const auctionStatusEnum = pgEnum("auction_status", [
  "draft",
  "scheduled",
  "live",
  "ending",
  "sold",
  "passed",
  "cancelled",
]);

export const bidTypeEnum = pgEnum("bid_type", ["manual", "proxy", "buy_now"]);

export const bidStatusEnum = pgEnum("bid_status", [
  "winning",
  "outbid",
  "losing",
  "retracted",
]);

export const conditionEnum = pgEnum("item_condition", [
  "mint",
  "excellent",
  "good",
  "fair",
  "restoration",
]);

/** Double-entry ledger movement kinds. */
export const ledgerKindEnum = pgEnum("ledger_kind", [
  "deposit",
  "withdrawal",
  "hold_place",
  "hold_release",
  "hold_capture",
  "sale_proceeds",
  "platform_fee",
  "refund",
]);

export const holdStatusEnum = pgEnum("hold_status", [
  "held",
  "released",
  "captured",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "awaiting_payment",
  "paid",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);

export const saleStatusEnum = pgEnum("sale_status", [
  "scheduled",
  "live",
  "paused",
  "ended",
]);

/* -------------------------------------------------------------------------- */
/* Auth (Better Auth core tables + our extensions)                             */
/* -------------------------------------------------------------------------- */

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

    // --- Auctioneer extensions ---
    role: userRoleEnum("role").notNull().default("bidder"),
    handle: text("handle").unique(),
    bio: text("bio"),
    location: text("location"),
    /** Seller reputation, denormalised for cheap listing reads. */
    ratingAvg: integer("rating_avg").notNull().default(0), // 0..500 (stars * 100)
    ratingCount: integer("rating_count").notNull().default(0),
    sellerVerified: boolean("seller_verified").notNull().default(false),
    bannedAt: timestamp("banned_at", { withTimezone: true }),
  },
  (t) => [index("user_handle_idx").on(t.handle)],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    /** Required by Better Auth 1.7+ to disambiguate multi-tenant providers. */
    issuer: text("issuer").notNull().default("credential"),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

export const categories = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    /** Tailwind-friendly accent used by the UI to theme category surfaces. */
    accent: text("accent").notNull().default("#c8a24a"),
    icon: text("icon"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("categories_sort_idx").on(t.sortOrder)],
);

/**
 * A curated LIVE sale event: an auctioneer works a numbered run of lots in
 * real time. Timed auctions do not need a sale and leave `saleId` null.
 */
export const sales = pgTable(
  "sales",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    hostId: text("host_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: saleStatusEnum("status").notNull().default("scheduled"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** The lot currently on the block. Drives the live room for every viewer. */
    currentAuctionId: text("current_auction_id"),
    coverImage: text("cover_image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sales_status_idx").on(t.status, t.scheduledFor)],
);

/* -------------------------------------------------------------------------- */
/* Auctions                                                                    */
/* -------------------------------------------------------------------------- */

export const auctions = pgTable(
  "auctions",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    sellerId: text("seller_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    saleId: text("sale_id").references(() => sales.id, { onDelete: "set null" }),
    /** Position within a live sale's run of lots. */
    lotNumber: integer("lot_number"),

    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    provenance: text("provenance"),
    condition: conditionEnum("condition").notNull().default("excellent"),

    /**
     * Where the catalogue record came from, when it describes a real object.
     *
     * Lots seeded from museum open-access collections carry the institution,
     * a link to its record, and the licence the data was released under. CC0
     * asks for nothing, but a catalogue that cannot say where its facts came
     * from is not a catalogue — and some fields (AIC descriptions) are CC-BY,
     * which does require the credit.
     */
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    sourceLicense: text("source_license"),
    /** Ordered image URLs; first is the hero. */
    images: jsonb("images").$type<string[]>().notNull().default(sql`'[]'::jsonb`),

    type: auctionTypeEnum("type").notNull().default("timed"),
    status: auctionStatusEnum("status").notNull().default("draft"),

    // --- Money (integer cents) ---
    startingPriceCents: bigint("starting_price_cents", { mode: "number" }).notNull(),
    /** Hidden floor. Null = no reserve. Never exposed to bidders as a number. */
    reservePriceCents: bigint("reserve_price_cents", { mode: "number" }),
    buyNowPriceCents: bigint("buy_now_price_cents", { mode: "number" }),
    /** Live "ask": what the next bid must meet or beat is derived from this. */
    currentPriceCents: bigint("current_price_cents", { mode: "number" }).notNull().default(0),
    buyersPremiumBps: integer("buyers_premium_bps").notNull().default(1000),

    // --- Timing ---
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Preserved across soft-close extensions so we can show "extended from". */
    originalEndsAt: timestamp("original_ends_at", { withTimezone: true }).notNull(),
    extensionCount: integer("extension_count").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),

    // --- Outcome ---
    winnerId: text("winner_id").references(() => user.id, { onDelete: "set null" }),
    winningBidId: text("winning_bid_id"),
    reserveMet: boolean("reserve_met").notNull().default(false),

    // --- Denormalised counters (kept in step inside the bid transaction) ---
    bidCount: integer("bid_count").notNull().default(0),
    bidderCount: integer("bidder_count").notNull().default(0),
    viewCount: integer("view_count").notNull().default(0),
    watchCount: integer("watch_count").notNull().default(0),

    /**
     * Optimistic-concurrency guard. Every mutation that changes price bumps it,
     * so a stale writer's UPDATE matches zero rows instead of clobbering.
     */
    version: integer("version").notNull().default(0),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("auctions_status_ends_idx").on(t.status, t.endsAt),
    index("auctions_seller_idx").on(t.sellerId),
    index("auctions_category_idx").on(t.categoryId),
    index("auctions_sale_idx").on(t.saleId, t.lotNumber),
    // Drives the "closing soon" rail and the sweeper that closes due auctions.
    index("auctions_live_ends_idx").on(t.endsAt).where(sql`${t.status} in ('live','ending')`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Bids                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One row per accepted bid. `amountCents` is the public, visible bid.
 * `maxAmountCents` is the bidder's private proxy ceiling (>= amountCents);
 * the engine bids on their behalf up to it. This is the eBay model.
 */
export const bids = pgTable(
  "bids",
  {
    id: text("id").primaryKey(),
    auctionId: text("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    bidderId: text("bidder_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    maxAmountCents: bigint("max_amount_cents", { mode: "number" }).notNull(),
    type: bidTypeEnum("type").notNull().default("manual"),
    status: bidStatusEnum("status").notNull().default("winning"),
    /**
     * Client-supplied key making bid submission safe to retry. A dropped
     * response must never turn into a second bid.
     */
    idempotencyKey: text("idempotency_key"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("bids_auction_amount_idx").on(t.auctionId, t.amountCents),
    index("bids_auction_created_idx").on(t.auctionId, t.createdAt),
    index("bids_bidder_idx").on(t.bidderId),
    uniqueIndex("bids_idempotency_idx")
      .on(t.auctionId, t.bidderId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

/**
 * Append-only activity log per auction. Powers the live feed, the audit trail,
 * and dispute resolution. Never mutated after insert.
 */
export const auctionEvents = pgTable(
  "auction_events",
  {
    id: text("id").primaryKey(),
    auctionId: text("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auction_events_auction_idx").on(t.auctionId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Engagement                                                                  */
/* -------------------------------------------------------------------------- */

export const watchlist = pgTable(
  "watchlist",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    auctionId: text("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("watchlist_pk").on(t.userId, t.auctionId),
    index("watchlist_auction_idx").on(t.auctionId),
  ],
);

/** Ephemeral chat in a live sale room. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    auctionId: text("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_auction_idx").on(t.auctionId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Money: wallet, double-entry ledger, bid deposits                            */
/* -------------------------------------------------------------------------- */

/**
 * Cached balances. The ledger is the source of truth; these columns are a
 * materialised view of it, updated in the same transaction as every entry.
 *   available = spendable now
 *   held      = committed to active bid deposits, not spendable
 */
export const wallets = pgTable("wallets", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  availableCents: bigint("available_cents", { mode: "number" }).notNull().default(0),
  heldCents: bigint("held_cents", { mode: "number" }).notNull().default(0),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only double-entry log. `amountCents` is signed relative to the
 * wallet's spendable balance; `balanceAfter` snapshots the running total so
 * statements reconcile without replaying history.
 */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: text("id").primaryKey(),
    walletId: text("wallet_id")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    kind: ledgerKindEnum("kind").notNull(),
    /** Signed: credits positive, debits negative. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    availableAfterCents: bigint("available_after_cents", { mode: "number" }).notNull(),
    heldAfterCents: bigint("held_after_cents", { mode: "number" }).notNull(),
    memo: text("memo"),
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ledger_wallet_idx").on(t.walletId, t.createdAt),
    index("ledger_ref_idx").on(t.refType, t.refId),
  ],
);

/**
 * A refundable good-faith hold taken when a bidder commits to a lot. Released
 * when outbid or when the lot passes; captured toward the order when they win.
 */
export const bidDeposits = pgTable(
  "bid_deposits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    auctionId: text("auction_id")
      .notNull()
      .references(() => auctions.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    status: holdStatusEnum("status").notNull().default("held"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bid_deposits_active_idx")
      .on(t.userId, t.auctionId)
      .where(sql`${t.status} = 'held'`),
    index("bid_deposits_auction_idx").on(t.auctionId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Settlement                                                                  */
/* -------------------------------------------------------------------------- */

export const orders = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    auctionId: text("auction_id")
      .notNull()
      .unique()
      .references(() => auctions.id, { onDelete: "cascade" }),
    buyerId: text("buyer_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sellerId: text("seller_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    hammerPriceCents: bigint("hammer_price_cents", { mode: "number" }).notNull(),
    buyersPremiumCents: bigint("buyers_premium_cents", { mode: "number" }).notNull(),
    shippingCents: bigint("shipping_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    status: orderStatusEnum("status").notNull().default("awaiting_payment"),
    shippingAddress: jsonb("shipping_address").$type<Record<string, string>>(),
    trackingNumber: text("tracking_number"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_buyer_idx").on(t.buyerId, t.createdAt),
    index("orders_seller_idx").on(t.sellerId, t.createdAt),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    subjectId: text("subject_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(),
    body: text("body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_subject_idx").on(t.subjectId)],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const userRelations = relations(user, ({ many, one }) => ({
  auctions: many(auctions),
  bids: many(bids),
  wallet: one(wallets, { fields: [user.id], references: [wallets.userId] }),
  watchlist: many(watchlist),
  notifications: many(notifications),
}));

export const auctionRelations = relations(auctions, ({ one, many }) => ({
  seller: one(user, { fields: [auctions.sellerId], references: [user.id] }),
  winner: one(user, { fields: [auctions.winnerId], references: [user.id] }),
  category: one(categories, { fields: [auctions.categoryId], references: [categories.id] }),
  sale: one(sales, { fields: [auctions.saleId], references: [sales.id] }),
  bids: many(bids),
  events: many(auctionEvents),
  watchers: many(watchlist),
}));

export const bidRelations = relations(bids, ({ one }) => ({
  auction: one(auctions, { fields: [bids.auctionId], references: [auctions.id] }),
  bidder: one(user, { fields: [bids.bidderId], references: [user.id] }),
}));

export const saleRelations = relations(sales, ({ one, many }) => ({
  host: one(user, { fields: [sales.hostId], references: [user.id] }),
  lots: many(auctions),
}));

export const walletRelations = relations(wallets, ({ one, many }) => ({
  owner: one(user, { fields: [wallets.userId], references: [user.id] }),
  entries: many(ledgerEntries),
}));

export const orderRelations = relations(orders, ({ one }) => ({
  auction: one(auctions, { fields: [orders.auctionId], references: [auctions.id] }),
  buyer: one(user, { fields: [orders.buyerId], references: [user.id] }),
  seller: one(user, { fields: [orders.sellerId], references: [user.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                              */
/* -------------------------------------------------------------------------- */

export type User = typeof user.$inferSelect;
export type Auction = typeof auctions.$inferSelect;
export type NewAuction = typeof auctions.$inferInsert;
export type Bid = typeof bids.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type Wallet = typeof wallets.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type AuctionEvent = typeof auctionEvents.$inferSelect;
