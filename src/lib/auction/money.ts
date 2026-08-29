/**
 * Money helpers. Everything in the auction domain is integer minor units
 * (cents). These helpers are the only place that formats or parses.
 */

export const CENTS_PER_UNIT = 100;

export function formatCents(
  cents: number,
  opts: { currency?: string; compact?: boolean; showCents?: boolean } = {},
): string {
  const { currency = "USD", compact = false, showCents } = opts;
  const units = cents / CENTS_PER_UNIT;
  // Auction prices are usually whole; only show decimals when they matter.
  const fractionDigits = showCents ?? !Number.isInteger(units) ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact && Math.abs(units) >= 10_000 ? "compact" : "standard",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(units);
}

/** Parse a user-typed amount ("1,250" / "$1250.50") into cents. */
export function parseToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * CENTS_PER_UNIT);
}

/** Basis points of an amount, rounded half-up. 1000 bps = 10%. */
export function applyBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}
