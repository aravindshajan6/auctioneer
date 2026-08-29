/**
 * Proxy ("automatic") bid resolution — the eBay model.
 *
 * A bidder submits the MAXIMUM they are willing to pay. The house never
 * reveals it and never charges it outright: it bids on their behalf only as
 * far as needed to stay ahead. The visible price is therefore driven by the
 * SECOND-highest maximum plus one increment, capped by the highest maximum.
 *
 * This module is deliberately pure — no database, no clock, no I/O — so that
 * every edge case below is exercised by unit tests rather than by production.
 */
import { incrementFor, minimumNextBid } from "./increments";

export interface ProxyParticipant {
  bidderId: string;
  maxAmountCents: number;
}

export interface ResolveProxyInput {
  startingPriceCents: number;
  currentPriceCents: number;
  /** Hidden floor; null when the lot sells regardless of price. */
  reservePriceCents: number | null;
  /** Current leading bidder and their private ceiling, or null before any bid. */
  leader: ProxyParticipant | null;
  challenger: ProxyParticipant;
}

export type RejectReason =
  | "below_minimum"
  | "below_current_max"
  | "not_a_raise";

/** One publicly visible line of bid history produced by a resolution. */
export interface BidLedgerEntry {
  bidderId: string;
  amountCents: number;
  maxAmountCents: number;
  type: "manual" | "proxy";
  status: "winning" | "outbid";
}

export type ResolveProxyResult =
  | {
      accepted: false;
      reason: RejectReason;
      /** What the bidder would have had to offer. */
      minimumCents: number;
    }
  | {
      accepted: true;
      /** How the leadership changed, for the activity feed and notifications. */
      outcome: "first_bid" | "leader_changed" | "leader_held" | "max_raised";
      newPriceCents: number;
      leaderId: string;
      leaderMaxCents: number;
      /** Set when the incoming bid was beaten instantly by a standing proxy. */
      outbidBidderId: string | null;
      reserveMet: boolean;
      /**
       * Public amounts to record in bid history. Ordered oldest-to-newest so
       * the feed reads like the room sounded.
       */
      ledger: BidLedgerEntry[];
    };

export function resolveProxyBid(input: ResolveProxyInput): ResolveProxyResult {
  const {
    startingPriceCents,
    currentPriceCents,
    reservePriceCents,
    leader,
    challenger,
  } = input;

  const hasBids = leader !== null;
  const minimum = minimumNextBid({
    currentPriceCents,
    startingPriceCents,
    hasBids,
  });

  /* ---------------------------------------------------------------- */
  /* Case A — the opening bid.                                         */
  /* ---------------------------------------------------------------- */
  if (!leader) {
    if (challenger.maxAmountCents < minimum) {
      return { accepted: false, reason: "below_minimum", minimumCents: minimum };
    }
    // The opener pays the ask, not their ceiling: nobody has pushed them yet.
    const priced = applyReserve(startingPriceCents, challenger.maxAmountCents, reservePriceCents);
    return {
      accepted: true,
      outcome: "first_bid",
      newPriceCents: priced.priceCents,
      leaderId: challenger.bidderId,
      leaderMaxCents: challenger.maxAmountCents,
      outbidBidderId: null,
      reserveMet: priced.reserveMet,
      ledger: [
        {
          bidderId: challenger.bidderId,
          amountCents: priced.priceCents,
          maxAmountCents: challenger.maxAmountCents,
          type: "manual",
          status: "winning",
        },
      ],
    };
  }

  /* ---------------------------------------------------------------- */
  /* Case B — the leader raises their own ceiling.                     */
  /* You never bid against yourself, so the visible price holds.       */
  /* ---------------------------------------------------------------- */
  if (leader.bidderId === challenger.bidderId) {
    if (challenger.maxAmountCents <= leader.maxAmountCents) {
      return {
        accepted: false,
        reason: "not_a_raise",
        minimumCents: leader.maxAmountCents + incrementFor(leader.maxAmountCents),
      };
    }
    // A higher ceiling can newly satisfy a reserve, which does move the price.
    const priced = applyReserve(currentPriceCents, challenger.maxAmountCents, reservePriceCents);
    return {
      accepted: true,
      outcome: "max_raised",
      newPriceCents: priced.priceCents,
      leaderId: leader.bidderId,
      leaderMaxCents: challenger.maxAmountCents,
      outbidBidderId: null,
      reserveMet: priced.reserveMet,
      ledger: [],
    };
  }

  /* ---------------------------------------------------------------- */
  /* Case C — a genuine contest between two ceilings.                  */
  /* ---------------------------------------------------------------- */
  if (challenger.maxAmountCents < minimum) {
    return { accepted: false, reason: "below_minimum", minimumCents: minimum };
  }

  if (challenger.maxAmountCents > leader.maxAmountCents) {
    // Challenger takes the lot. They pay one increment over the beaten
    // ceiling — or their own max, if that is lower than a full increment away.
    const contested = Math.min(
      challenger.maxAmountCents,
      leader.maxAmountCents + incrementFor(leader.maxAmountCents),
    );
    const priced = applyReserve(contested, challenger.maxAmountCents, reservePriceCents);
    const ledger: BidLedgerEntry[] = [];

    // Show the deposed leader being driven up to their ceiling, so the history
    // explains the jump instead of appearing to skip bids.
    if (leader.maxAmountCents > currentPriceCents) {
      ledger.push({
        bidderId: leader.bidderId,
        amountCents: leader.maxAmountCents,
        maxAmountCents: leader.maxAmountCents,
        type: "proxy",
        status: "outbid",
      });
    }
    ledger.push({
      bidderId: challenger.bidderId,
      amountCents: priced.priceCents,
      maxAmountCents: challenger.maxAmountCents,
      type: "manual",
      status: "winning",
    });

    return {
      accepted: true,
      outcome: "leader_changed",
      newPriceCents: priced.priceCents,
      leaderId: challenger.bidderId,
      leaderMaxCents: challenger.maxAmountCents,
      outbidBidderId: leader.bidderId,
      reserveMet: priced.reserveMet,
      ledger,
    };
  }

  // Challenger's ceiling is at or below the leader's. The standing proxy
  // answers automatically and the challenger is outbid before the page repaints.
  // An exact tie goes to the earlier bid — the leader — which is why this
  // branch covers `<=` rather than `<`.
  const answered = Math.min(
    leader.maxAmountCents,
    challenger.maxAmountCents + incrementFor(challenger.maxAmountCents),
  );
  const priced = applyReserve(answered, leader.maxAmountCents, reservePriceCents);

  return {
    accepted: true,
    outcome: "leader_held",
    newPriceCents: priced.priceCents,
    leaderId: leader.bidderId,
    leaderMaxCents: leader.maxAmountCents,
    outbidBidderId: challenger.bidderId,
    reserveMet: priced.reserveMet,
    ledger: [
      {
        bidderId: challenger.bidderId,
        amountCents: challenger.maxAmountCents,
        maxAmountCents: challenger.maxAmountCents,
        type: "manual",
        status: "outbid",
      },
      {
        bidderId: leader.bidderId,
        amountCents: priced.priceCents,
        maxAmountCents: leader.maxAmountCents,
        type: "proxy",
        status: "winning",
      },
    ],
  };
}

/**
 * A reserve does not block bidding; it blocks *selling*. Once the leading
 * ceiling covers the reserve the house advances the ask straight to it, which
 * is why a lot can jump from $400 to a $1,000 reserve on a single bid.
 */
function applyReserve(
  priceCents: number,
  leadingMaxCents: number,
  reservePriceCents: number | null,
): { priceCents: number; reserveMet: boolean } {
  if (reservePriceCents === null) {
    return { priceCents, reserveMet: true };
  }
  const reserveMet = leadingMaxCents >= reservePriceCents;
  if (reserveMet && priceCents < reservePriceCents) {
    return { priceCents: reservePriceCents, reserveMet: true };
  }
  return { priceCents, reserveMet };
}
