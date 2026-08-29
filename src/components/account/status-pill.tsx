import { Badge, LiveBadge } from "@/components/ui/badge";

type AuctionStatus =
  | "draft"
  | "scheduled"
  | "live"
  | "ending"
  | "sold"
  | "passed"
  | "cancelled";

/** Plain-English labels for the `auction_status` enum. */
const AUCTION_LABEL: Record<AuctionStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  live: "Live",
  ending: "Going once",
  sold: "Sold",
  passed: "Unsold",
  cancelled: "Withdrawn",
};

export function LotStatusPill({ status }: { status: AuctionStatus }) {
  if (status === "live") return <LiveBadge />;
  if (status === "ending") return <LiveBadge label="Going once" />;
  const tone =
    status === "sold" ? "sold" : status === "scheduled" ? "gild" : ("muted" as const);
  return <Badge tone={tone}>{AUCTION_LABEL[status]}</Badge>;
}

type OrderStatus =
  | "awaiting_payment"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/** Plain-English labels for the `order_status` enum. */
export const ORDER_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  refunded: "Refunded",
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  const tone = {
    awaiting_payment: "ending",
    paid: "live",
    shipped: "gild",
    delivered: "sold",
    cancelled: "muted",
    refunded: "muted",
  }[status] as "ending" | "live" | "gild" | "sold" | "muted";
  return <Badge tone={tone}>{ORDER_LABEL[status]}</Badge>;
}
