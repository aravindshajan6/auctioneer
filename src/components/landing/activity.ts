import { formatCents } from "@/lib/auction/money";

export interface TickerItem {
  id: string;
  /** Short uppercase verb: BID, HAMMER, EXTENDED. */
  kind: string;
  amount: string | null;
  lot: string;
  tone: "gild" | "ember" | "amethyst" | "muted";
}

/** The append-only event log stores amounts under a per-type key. */
function cents(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return formatCents(value, { compact: true, showCents: false });
    }
  }
  return null;
}

export interface ActivityRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  lotTitle: string;
}

/**
 * Turns the raw auction event log into ticker copy.
 *
 * Unknown event types are dropped rather than rendered as their database
 * identifier — a strip reading "reserve_recalculated" is worse than a shorter
 * strip.
 */
export function toTickerItems(rows: ActivityRow[]): TickerItem[] {
  const items: TickerItem[] = [];
  for (const row of rows) {
    switch (row.type) {
      case "bid_placed":
        items.push({ id: row.id, kind: "Bid", amount: cents(row.payload, "priceCents"), lot: row.lotTitle, tone: "gild" });
        break;
      case "max_raised":
        items.push({ id: row.id, kind: "Proxy raise", amount: cents(row.payload, "priceCents"), lot: row.lotTitle, tone: "gild" });
        break;
      case "lot_sold":
        items.push({ id: row.id, kind: "Hammer", amount: cents(row.payload, "hammerPriceCents", "totalCents"), lot: row.lotTitle, tone: "amethyst" });
        break;
      case "buy_now":
        items.push({ id: row.id, kind: "Bought now", amount: cents(row.payload, "totalCents"), lot: row.lotTitle, tone: "amethyst" });
        break;
      case "time_extended":
        items.push({ id: row.id, kind: "Soft close", amount: null, lot: row.lotTitle, tone: "ember" });
        break;
      case "lot_passed":
        items.push({ id: row.id, kind: "Passed", amount: null, lot: row.lotTitle, tone: "muted" });
        break;
      case "payment_received":
        items.push({ id: row.id, kind: "Settled", amount: cents(row.payload, "totalCents"), lot: row.lotTitle, tone: "muted" });
        break;
      default:
        break;
    }
  }
  return items;
}

/**
 * Fallback strip built from the catalogue itself. A saleroom between bids is
 * still a saleroom with lots in it, so the ticker shows current asks rather
 * than going blank.
 */
export function toAskItems(
  lots: { id: string; title: string; currentPriceCents: number; bidCount: number }[],
): TickerItem[] {
  return lots.map((lot) => ({
    id: `ask_${lot.id}`,
    kind: lot.bidCount > 0 ? "Current ask" : "Opening",
    amount: formatCents(lot.currentPriceCents, { compact: true, showCents: false }),
    lot: lot.title,
    tone: "gild" as const,
  }));
}
