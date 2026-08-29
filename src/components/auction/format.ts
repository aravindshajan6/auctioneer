/**
 * Presentation rules shared by every bidding surface.
 *
 * These are deliberately not in `lib/` — they encode how the *house* speaks,
 * not how the auction works, and the two should be free to diverge.
 */
import type { LotStatePayload } from "@/lib/realtime/events";

export type LotStatus = LotStatePayload["status"];
export type LotCondition = "mint" | "excellent" | "good" | "fair" | "restoration";

/** The house metal, used whenever a lot has no category of its own. */
export const DEFAULT_ACCENT = "#c8912a";

/**
 * Saleroom anonymity.
 *
 * A room announces bidders by paddle, not by name — but the person bidding
 * always knows it is them, so their own name is never obscured. The mask is a
 * fixed three dots regardless of length: leaking "how long is their surname"
 * is still leaking.
 */
export function maskBidderName(name: string, isViewer = false): string {
  if (isViewer) return name;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Bidder";
  const first = `${parts[0]![0]!.toUpperCase()}•••`;
  if (parts.length === 1) return first;
  return `${first} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

export interface StatusMeta {
  label: string;
  tone: "neutral" | "live" | "ending" | "gild" | "sold" | "muted";
}

export function statusMeta(status: LotStatus): StatusMeta {
  switch (status) {
    case "live":
      return { label: "Live", tone: "live" };
    case "ending":
      return { label: "Closing", tone: "ending" };
    case "scheduled":
      return { label: "Upcoming", tone: "gild" };
    case "sold":
      return { label: "Sold", tone: "sold" };
    case "passed":
      return { label: "Passed", tone: "muted" };
    case "cancelled":
      return { label: "Withdrawn", tone: "muted" };
    default:
      return { label: "Draft", tone: "muted" };
  }
}

/** Whether the house will take a bid on this lot right now. */
export function isBiddable(status: LotStatus): boolean {
  return status === "live" || status === "ending";
}

export const CONDITION_LABELS: Record<LotCondition, string> = {
  mint: "Mint",
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  restoration: "Restoration required",
};

export const CONDITION_NOTES: Record<LotCondition, string> = {
  mint: "As issued. No signs of handling or display wear.",
  excellent: "Minor handling wear consistent with age; no material faults.",
  good: "Honest wear throughout. Structurally sound and complete.",
  fair: "Visible wear or old repair. Inspect the condition report before bidding.",
  restoration: "Sold as found. Conservation work is required.",
};

/** A tinted ground that stands in for artwork that has not loaded (or exists). */
export function accentGradient(accent: string | null | undefined): string {
  const tint = accent || DEFAULT_ACCENT;
  return (
    `radial-gradient(120% 90% at 30% 15%, color-mix(in oklab, ${tint} 30%, transparent), transparent 70%),` +
    `linear-gradient(155deg, color-mix(in oklab, ${tint} 12%, #0a0c13), #05060a 78%)`
  );
}

/** "10% buyer's premium" — bps are the storage unit, percent is the human one. */
export function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2)}%`;
}
