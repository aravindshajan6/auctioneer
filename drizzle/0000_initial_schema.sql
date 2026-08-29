CREATE TYPE "public"."auction_status" AS ENUM('draft', 'scheduled', 'live', 'ending', 'sold', 'passed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."auction_type" AS ENUM('timed', 'live');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('winning', 'outbid', 'losing', 'retracted');--> statement-breakpoint
CREATE TYPE "public"."bid_type" AS ENUM('manual', 'proxy', 'buy_now');--> statement-breakpoint
CREATE TYPE "public"."item_condition" AS ENUM('mint', 'excellent', 'good', 'fair', 'restoration');--> statement-breakpoint
CREATE TYPE "public"."hold_status" AS ENUM('held', 'released', 'captured');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('deposit', 'withdrawal', 'hold_place', 'hold_release', 'hold_capture', 'sale_proceeds', 'platform_fee', 'refund');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('awaiting_payment', 'paid', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('scheduled', 'live', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('bidder', 'seller', 'admin');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text DEFAULT 'credential' NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auction_events" (
	"id" text PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"seller_id" text NOT NULL,
	"category_id" text,
	"sale_id" text,
	"lot_number" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"provenance" text,
	"condition" "item_condition" DEFAULT 'excellent' NOT NULL,
	"source_name" text,
	"source_url" text,
	"source_license" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"type" "auction_type" DEFAULT 'timed' NOT NULL,
	"status" "auction_status" DEFAULT 'draft' NOT NULL,
	"starting_price_cents" bigint NOT NULL,
	"reserve_price_cents" bigint,
	"buy_now_price_cents" bigint,
	"current_price_cents" bigint DEFAULT 0 NOT NULL,
	"buyers_premium_bps" integer DEFAULT 1000 NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"original_ends_at" timestamp with time zone NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"winner_id" text,
	"winning_bid_id" text,
	"reserve_met" boolean DEFAULT false NOT NULL,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"bidder_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"watch_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auctions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bid_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"auction_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"status" "hold_status" DEFAULT 'held' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" text PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"bidder_id" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"max_amount_cents" bigint NOT NULL,
	"type" "bid_type" DEFAULT 'manual' NOT NULL,
	"status" "bid_status" DEFAULT 'winning' NOT NULL,
	"idempotency_key" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"accent" text DEFAULT '#c8a24a' NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet_id" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount_cents" bigint NOT NULL,
	"available_after_cents" bigint NOT NULL,
	"held_after_cents" bigint NOT NULL,
	"memo" text,
	"ref_type" text,
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"auction_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"hammer_price_cents" bigint NOT NULL,
	"buyers_premium_cents" bigint NOT NULL,
	"shipping_cents" bigint DEFAULT 0 NOT NULL,
	"total_cents" bigint NOT NULL,
	"status" "order_status" DEFAULT 'awaiting_payment' NOT NULL,
	"shipping_address" jsonb,
	"tracking_number" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_auction_id_unique" UNIQUE("auction_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"author_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"stars" integer NOT NULL,
	"body" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"host_id" text NOT NULL,
	"status" "sale_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"current_auction_id" text,
	"cover_image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" "user_role" DEFAULT 'bidder' NOT NULL,
	"handle" text,
	"bio" text,
	"location" text,
	"rating_avg" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"seller_verified" boolean DEFAULT false NOT NULL,
	"banned_at" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"available_cents" bigint DEFAULT 0 NOT NULL,
	"held_cents" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"user_id" text NOT NULL,
	"auction_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_events" ADD CONSTRAINT "auction_events_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_events" ADD CONSTRAINT "auction_events_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_winner_id_user_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_deposits" ADD CONSTRAINT "bid_deposits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bid_deposits" ADD CONSTRAINT "bid_deposits_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_user_id_fk" FOREIGN KEY ("bidder_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_user_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_id_user_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_user_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auction_events_auction_idx" ON "auction_events" USING btree ("auction_id","created_at");--> statement-breakpoint
CREATE INDEX "auctions_status_ends_idx" ON "auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "auctions_seller_idx" ON "auctions" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "auctions_category_idx" ON "auctions" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "auctions_sale_idx" ON "auctions" USING btree ("sale_id","lot_number");--> statement-breakpoint
CREATE INDEX "auctions_live_ends_idx" ON "auctions" USING btree ("ends_at") WHERE "auctions"."status" in ('live','ending');--> statement-breakpoint
CREATE UNIQUE INDEX "bid_deposits_active_idx" ON "bid_deposits" USING btree ("user_id","auction_id") WHERE "bid_deposits"."status" = 'held';--> statement-breakpoint
CREATE INDEX "bid_deposits_auction_idx" ON "bid_deposits" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "bids_auction_amount_idx" ON "bids" USING btree ("auction_id","amount_cents");--> statement-breakpoint
CREATE INDEX "bids_auction_created_idx" ON "bids" USING btree ("auction_id","created_at");--> statement-breakpoint
CREATE INDEX "bids_bidder_idx" ON "bids" USING btree ("bidder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_idempotency_idx" ON "bids" USING btree ("auction_id","bidder_id","idempotency_key") WHERE "bids"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "categories_sort_idx" ON "categories" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "chat_auction_idx" ON "chat_messages" USING btree ("auction_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_wallet_idx" ON "ledger_entries" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_ref_idx" ON "ledger_entries" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_seller_idx" ON "orders" USING btree ("seller_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_subject_idx" ON "reviews" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "sales_status_idx" ON "sales" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_handle_idx" ON "user" USING btree ("handle");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_pk" ON "watchlist" USING btree ("user_id","auction_id");--> statement-breakpoint
CREATE INDEX "watchlist_auction_idx" ON "watchlist" USING btree ("auction_id");