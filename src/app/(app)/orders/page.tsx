import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getMyOrders } from "@/lib/queries";
import { formatCents } from "@/lib/auction/money";
import { EmptyState } from "@/components/account/empty-state";
import { LotThumb } from "@/components/account/lot-thumb";
import { OrderStatusPill } from "@/components/account/status-pill";
import { Tabs } from "@/components/account/tabs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Orders",
  description: "Lots you have won and lots you have sold, with their settlement state.",
};

export const dynamic = "force-dynamic";

type OrderRow = Awaited<ReturnType<typeof getMyOrders>>[number];

const ORDER_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function OrdersPage() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in?next=/orders");
  const userId = session.user.id;

  const orders = await getMyOrders(userId);
  const purchases = orders.filter((o) => o.buyerId === userId);
  const sales = orders.filter((o) => o.sellerId === userId);
  const owing = purchases.filter((o) => o.status === "awaiting_payment");

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="max-w-2xl">
        <p className="text-[11px] font-medium tracking-[0.2em] text-gild-400 uppercase">
          Settlement
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-linen sm:text-4xl">
          Orders
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-fog">
          Every hammer creates one order, seen from both sides. Yours are marked{" "}
          <span className="text-gild-200">purchase</span> or{" "}
          <span className="text-amethyst-300">sale</span> so there is never a question of who owes
          whom.
        </p>
      </header>

      {owing.length > 0 && (
        <p className="mt-6 rounded-xl border border-gild-600/50 bg-gild-500/[0.08] px-4 py-3 text-[13px] text-gild-200">
          <span className="tabular font-semibold">{owing.length}</span>{" "}
          {owing.length === 1 ? "lot is" : "lots are"} awaiting payment, totalling{" "}
          <span className="tabular font-semibold">
            {formatCents(owing.reduce((sum, o) => sum + o.totalCents, 0))}
          </span>
          .
        </p>
      )}

      <div className="mt-8">
        <Tabs
          tabs={[
            {
              id: "all",
              label: "Everything",
              count: orders.length,
              panel: <OrderList rows={orders} userId={userId} />,
            },
            {
              id: "purchases",
              label: "Purchases",
              count: purchases.length,
              panel: <OrderList rows={purchases} userId={userId} kind="purchase" />,
            },
            {
              id: "sales",
              label: "Sales",
              count: sales.length,
              panel: <OrderList rows={sales} userId={userId} kind="sale" />,
            },
          ]}
        />
      </div>
    </div>
  );
}

function OrderList({
  rows,
  userId,
  kind,
}: {
  rows: OrderRow[];
  userId: string;
  kind?: "purchase" | "sale";
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={
          kind === "sale"
            ? "You have not sold anything yet"
            : kind === "purchase"
              ? "You have not won a lot yet"
              : "No orders yet"
        }
        body={
          kind === "sale"
            ? "When one of your consignments is knocked down, the invoice and the buyer's details appear here."
            : "Win a lot and its invoice lands here the moment the hammer falls — hammer price, buyer's premium and shipping, itemised."
        }
        action={
          kind === "sale"
            ? { label: "Consign a lot", href: "/sell" }
            : { label: "Browse the catalogue", href: "/explore" }
        }
      />
    );
  }

  return (
    <ul className="space-y-2.5">
      {rows.map((order) => {
        const isPurchase = order.buyerId === userId;
        return (
          <li key={order.id}>
            <Link
              href={`/orders/${order.id}`}
              className="flex flex-wrap items-center gap-4 rounded-2xl border border-pewter/45 bg-obsidian/60 p-4 transition-colors hover:border-gild-500/55"
            >
              <LotThumb src={order.lot.images[0]} alt={order.lot.title} className="size-14" />

              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-[0.09em] uppercase",
                      isPurchase
                        ? "border-gild-500/45 bg-gild-500/12 text-gild-200"
                        : "border-amethyst-500/45 bg-amethyst-500/12 text-amethyst-300",
                    )}
                  >
                    {isPurchase ? (
                      <ArrowDownLeft className="size-3" aria-hidden />
                    ) : (
                      <ArrowUpRight className="size-3" aria-hidden />
                    )}
                    {isPurchase ? "Purchase" : "Sale"}
                  </span>
                  <OrderStatusPill status={order.status} />
                </div>
                <p className="mt-1.5 truncate font-display text-[15px] font-medium text-linen">
                  {order.lot.title}
                </p>
                <p className="tabular mt-0.5 text-[12px] text-ash">
                  {ORDER_DATE.format(new Date(order.createdAt))} · hammer{" "}
                  {formatCents(order.hammerPriceCents)}
                </p>
              </div>

              <div className="text-right">
                <p className="text-[10.5px] tracking-[0.12em] text-ash uppercase">
                  {isPurchase ? "You pay" : "Buyer pays"}
                </p>
                <p className="tabular mt-1 font-display text-lg font-semibold text-linen">
                  {formatCents(order.totalCents)}
                </p>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
