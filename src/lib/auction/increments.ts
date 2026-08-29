/**
 * Bid increment ladder.
 *
 * Real auction houses scale the minimum raise with the price so that a lot at
 * $50,000 is not advanced in $5 steps. Each tier is [inclusiveFloorCents,
 * incrementCents]; the last matching tier wins.
 */
const TIERS: ReadonlyArray<readonly [floor: number, increment: number]> = [
  [0, 500], //           < $100      -> $5
  [10_000, 1_000], //    < $500      -> $10
  [50_000, 2_500], //    < $1,000    -> $25
  [100_000, 5_000], //   < $2,500    -> $50
  [250_000, 10_000], //  < $5,000    -> $100
  [500_000, 25_000], //  < $10,000   -> $250
  [1_000_000, 50_000], // < $25,000  -> $500
  [2_500_000, 100_000], // < $50,000 -> $1,000
  [5_000_000, 250_000], // < $100,000-> $2,500
  [10_000_000, 500_000], // >= $100,000 -> $5,000
] as const;

/** The minimum raise applicable at a given current price. */
export function incrementFor(currentCents: number): number {
  let increment = TIERS[0][1];
  for (const [floor, step] of TIERS) {
    if (currentCents >= floor) increment = step;
    else break;
  }
  return increment;
}

/**
 * The lowest bid the house will accept next.
 *
 * Before any bid is placed the starting price itself is acceptable — a bidder
 * should not have to beat a price nobody has offered yet.
 */
export function minimumNextBid(args: {
  currentPriceCents: number;
  startingPriceCents: number;
  hasBids: boolean;
}): number {
  const { currentPriceCents, startingPriceCents, hasBids } = args;
  if (!hasBids) return startingPriceCents;
  return currentPriceCents + incrementFor(currentPriceCents);
}

/** Suggested one-tap raise amounts shown next to the bid box. */
export function quickBidLadder(currentCents: number, hasBids: boolean, startingCents: number): number[] {
  const base = minimumNextBid({
    currentPriceCents: currentCents,
    startingPriceCents: startingCents,
    hasBids,
  });
  const step = incrementFor(base);
  return [base, base + step * 2, base + step * 5];
}

export const INCREMENT_TIERS = TIERS;
