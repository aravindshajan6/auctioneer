import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ArrowLeft, Check, Package, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { auctions, orders, user } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { getWallet } from "@/lib/queries";
import { formatCents } from "@/lib/auction/money";
import { Avatar } from "@/components/ui/avatar";
import { LotThumb } from "@/components/account/lot-thumb";
import { PayButton } from "@/components/account/pay-button";
import { ORDER_LABEL, OrderStatusPill } from "@/components/account/status-pill";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Order" };

export const dynamic = "force-dynamic";

const buyerUser = alias(user, "buyer_user");
const sellerUser = alias(user, "seller_user");

const STAMP = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/**
 * Read one order in full.
 *
 * `getMyOrders` deliberately returns only what a list needs; an invoice needs
 * shipping, tracking and both counterparties, so the detail view asks for them
 * directly rather than fattening the list query for every caller.
 */
async function loadOrder(orderId: string) {
  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      hammerPriceCents: orders.hammerPriceCents,
      buyersPremiumCents: orders.buyersPremiumCents,
      shippingCents: orders.shippingCents,
      totalCents: orders.totalCents,
      trackingNumber: orders.trackingNumber,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      updatedAt: orders.updatedAt,
      buyerId: orders.buyerId,
      sellerId: orders.sellerId,
      buyerName: buyerUser.name,
      sellerName: sellerUser.name,
      lotSlug: auctions.slug,
      lotTitle: auctions.title,
      lotImages: auctions.images,
      lotCondition: auctions.condition,
      buyersPremiumBps: auctions.buyersPremiumBps,
      closedAt: auctions.closedAt,
    })
    .from(orders)
    .innerJoin(auctions, eq(orders.auctionId, auctions.id))
    .innerJoin(buyerUser, eq(orders.buyerId, buyerUser.id))
    .innerJoin(sellerUser, eq(orders.sellerId, sellerUser.id))
    .where(eq(orders.id, orderId))
    .limit(1);
  return row ?? null;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getSession();
  if (!session?.user) redirect(`/sign-in?next=/orders/${id}`);
  const userId = session.user.id;

  const order = await loadOrder(id);
  // An order is private to its two parties. A stranger gets a 404, not a 403 —
  // confirming the id exists would leak that somebody bought something.
  if (!order || (order.buyerId !== userId && order.sellerId !== userId)) notFound();

  const isBuyer = order.buyerId === userId;
  const counterparty = isBuyer ? order.sellerName : order.buyerName;
  const premiumPercent = (order.buyersPremiumBps / 100).toFixed(
    order.buyersPremiumBps % 100 === 0 ? 0 : 2,
  );

  // Only the buyer needs a balance, and only to decide whether to top up.
  const wallet = isBuyer ? await getWallet(userId) : null;
  const payable = isBuyer && order.status === "awaiting_payment";

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-[13px] text-ash transition-colors hover:text-linen"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        All orders
      </Link>

      <header className="mt-5 flex flex-wrap items-start gap-5">
        <LotThumb src={order.lotImages[0]} alt={order.lotTitle} className="size-20 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-[0.09em] uppercase",
                isBuyer
                  ? "border-gild-500/45 bg-gild-500/12 text-gild-200"
                  : "border-amethyst-500/45 bg-amethyst-500/12 text-amethyst-300",
              )}
            >
              {isBuyer ? "Your purchase" : "Your sale"}
            </span>
            <OrderStatusPill status={order.status} />
          </div>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-linen sm:text-3xl">
            {order.lotTitle}
          </h1>
          <p className="mt-1.5 text-[13px] text-ash">
            <Link href={`/lot/${order.lotSlug}`} className="underline underline-offset-4 hover:text-fog">
              View the lot
            </Link>{" "}
            · Order <span className="font-mono text-[12px]">{order.id}</span>
          </p>
        </div>
      </header>

      <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          {/* -- Invoice -------------------------------------------------- */}
          <section className="rounded-2xl border border-pewter/45 bg-obsidian/60">
            <h2 className="border-b border-pewter/35 px-5 py-3.5 font-display text-[15px] font-semibold text-linen">
              Invoice
            </h2>
            <dl className="px-5 py-4">
              <InvoiceRow label="Hammer price" value={formatCents(order.hammerPriceCents)} />
              <InvoiceRow
                label={`Buyer's premium (${premiumPercent}%)`}
                value={formatCents(order.buyersPremiumCents)}
                note="Charged to the buyer on top of the hammer price. It is how the house is paid."
              />
              <InvoiceRow
                label="Shipping"
                value={
                  order.shippingCents === 0 ? "To be arranged" : formatCents(order.shippingCents)
                }
                note={
                  order.shippingCents === 0
                    ? "Agreed directly with the seller once the lot is paid for."
                    : undefined
                }
              />
              <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-pewter/40 pt-4">
                <dt className="font-display text-[15px] font-semibold text-linen">Total</dt>
                <dd className="tabular font-display text-2xl font-semibold text-gild-200">
                  {formatCents(order.totalCents)}
                </dd>
              </div>
            </dl>
          </section>

          {/* -- Timeline ------------------------------------------------- */}
          <section className="rounded-2xl border border-pewter/45 bg-obsidian/60">
            <h2 className="border-b border-pewter/35 px-5 py-3.5 font-display text-[15px] font-semibold text-linen">
              Progress
            </h2>
            <div className="px-5 py-5">
              <Timeline
                status={order.status}
                stamps={{
                  awaiting_payment: order.closedAt ?? order.createdAt,
                  paid: order.paidAt,
                  shipped: order.status === "shipped" || order.status === "delivered" ? order.updatedAt : null,
                  delivered: order.status === "delivered" ? order.updatedAt : null,
                }}
              />
              {order.trackingNumber && (
                <p className="mt-5 flex items-center gap-2 rounded-xl border border-pewter/45 px-3.5 py-2.5 text-[13px] text-fog">
                  <Truck className="size-4 text-ash" aria-hidden />
                  Tracking <span className="font-mono text-linen">{order.trackingNumber}</span>
                </p>
              )}
            </div>
          </section>
        </div>

        {/* -- Actions and parties ----------------------------------------- */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {payable && (
            <div className="rounded-2xl border border-gild-600/50 bg-gild-500/[0.07] px-5 py-5">
              <h2 className="font-display text-[15px] font-semibold text-gild-100">
                Settlement due
              </h2>
              <p className="mt-1.5 mb-4 text-[12.5px] leading-relaxed text-gild-200/85">
                Paying moves {formatCents(order.totalCents)} out of your available balance and
                credits the seller. Your bid deposit on this lot was already applied when the
                hammer fell.
              </p>
              <PayButton
                orderId={order.id}
                totalCents={order.totalCents}
                availableCents={wallet?.availableCents ?? 0}
              />
            </div>
          )}

          {!payable && isBuyer && order.status === "paid" && (
            <p className="rounded-2xl border border-signal-500/40 bg-signal-500/[0.07] px-5 py-4 text-[13px] leading-relaxed text-signal-300">
              <Check className="mb-1.5 size-4" aria-hidden />
              <span className="block">
                Paid{order.paidAt ? ` on ${STAMP.format(new Date(order.paidAt))}` : ""}. The seller
                has been told to ship.
              </span>
            </p>
          )}

          {!isBuyer && (
            <p className="rounded-2xl border border-pewter/45 bg-white/[0.02] px-5 py-4 text-[13px] leading-relaxed text-ash">
              <Package className="mb-1.5 size-4" aria-hidden />
              <span className="block">
                {order.status === "awaiting_payment"
                  ? "Do not ship until this reads Paid. Proceeds land in your wallet the moment the buyer settles."
                  : `${formatCents(order.hammerPriceCents)} has been credited to your wallet as sale proceeds.`}
              </span>
            </p>
          )}

          <div className="rounded-2xl border border-pewter/45 bg-obsidian/60 px-5 py-4">
            <h2 className="text-[10.5px] font-medium tracking-[0.13em] text-ash uppercase">
              {isBuyer ? "Seller" : "Buyer"}
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <Avatar name={counterparty} size={36} />
              <p className="truncate text-sm text-linen">{counterparty}</p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function InvoiceRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-fog">
        {label}
        {note && <span className="mt-0.5 block max-w-[38ch] text-[12px] leading-snug text-ash">{note}</span>}
      </dt>
      <dd className="tabular shrink-0 text-sm text-linen">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

const FLOW = ["awaiting_payment", "paid", "shipped", "delivered"] as const;
type FlowStep = (typeof FLOW)[number];

const FLOW_NOTE: Record<FlowStep, string> = {
  awaiting_payment: "The lot was knocked down to you and the invoice was raised.",
  paid: "Funds moved from the buyer's wallet to the seller's.",
  shipped: "The seller has dispatched the lot.",
  delivered: "Received and closed.",
};

function Timeline({
  status,
  stamps,
}: {
  status: string;
  stamps: Partial<Record<FlowStep, Date | string | null>>;
}) {
  // Cancelled and refunded orders leave the happy path, so showing them as a
  // partly-complete pipeline would be a lie.
  if (status === "cancelled" || status === "refunded") {
    return (
      <p className="text-sm text-ash">
        This order was {ORDER_LABEL[status as "cancelled" | "refunded"].toLowerCase()} and is no
        longer progressing.
      </p>
    );
  }

  const currentIndex = FLOW.indexOf(status as FlowStep);

  return (
    <ol className="space-y-0">
      {FLOW.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex;
        const stamp = stamps[step];
        return (
          <li key={step} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
                  done && "border-signal-500/50 bg-signal-500/20 text-signal-300",
                  current && "border-gild-400/70 bg-gild-500/20 text-gild-100",
                  !done && !current && "border-pewter/50 text-ash",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : index + 1}
              </span>
              {index < FLOW.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "my-1 w-px flex-1",
                    index < currentIndex ? "bg-signal-500/40" : "bg-pewter/40",
                  )}
                />
              )}
            </div>
            <div className={cn("pb-6", index === FLOW.length - 1 && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-medium",
                  current ? "text-linen" : done ? "text-fog" : "text-ash",
                )}
              >
                {ORDER_LABEL[step]}
                {current && (
                  <span className="ml-2 text-[11px] tracking-[0.1em] text-gild-300 uppercase">
                    Now
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-ash">{FLOW_NOTE[step]}</p>
              {stamp && (done || current) && (
                <p className="tabular mt-1 text-[12px] text-ash">
                  {STAMP.format(new Date(stamp))}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
