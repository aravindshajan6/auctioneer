import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { incrementFor, minimumNextBid } from "./increments";
import { resolveProxyBid } from "./proxy";

const $ = (dollars: number) => Math.round(dollars * 100);

const base = {
  startingPriceCents: $(100),
  currentPriceCents: $(100),
  reservePriceCents: null as number | null,
};

describe("increment ladder", () => {
  it("scales the raise with the price", () => {
    assert.equal(incrementFor($(50)), $(5));
    assert.equal(incrementFor($(250)), $(10));
    assert.equal(incrementFor($(750)), $(25));
    assert.equal(incrementFor($(1_500)), $(50));
    assert.equal(incrementFor($(150_000)), $(5_000));
  });

  it("lets the opening bid equal the starting price", () => {
    assert.equal(
      minimumNextBid({ currentPriceCents: $(100), startingPriceCents: $(100), hasBids: false }),
      $(100),
    );
  });

  it("requires a full increment once bidding has started", () => {
    assert.equal(
      minimumNextBid({ currentPriceCents: $(100), startingPriceCents: $(100), hasBids: true }),
      $(110),
    );
  });
});

describe("opening bid", () => {
  it("prices the opener at the starting price, not their ceiling", () => {
    const r = resolveProxyBid({
      ...base,
      leader: null,
      challenger: { bidderId: "ana", maxAmountCents: $(900) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.newPriceCents, $(100));
    assert.equal(r.leaderId, "ana");
    assert.equal(r.leaderMaxCents, $(900));
  });

  it("rejects an opener below the starting price", () => {
    const r = resolveProxyBid({
      ...base,
      leader: null,
      challenger: { bidderId: "ana", maxAmountCents: $(75) },
    });
    assert.equal(r.accepted, false);
    if (r.accepted) return;
    assert.equal(r.reason, "below_minimum");
    assert.equal(r.minimumCents, $(100));
  });
});

describe("contested bidding", () => {
  it("a higher ceiling wins and pays one increment over the beaten max", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(100),
      leader: { bidderId: "ana", maxAmountCents: $(200) },
      challenger: { bidderId: "ben", maxAmountCents: $(500) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.leaderId, "ben");
    // beaten max $200 + increment at $200 ($10) = $210
    assert.equal(r.newPriceCents, $(210));
    assert.equal(r.outcome, "leader_changed");
    assert.equal(r.outbidBidderId, "ana");
  });

  it("never charges the winner more than their own ceiling", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(100),
      leader: { bidderId: "ana", maxAmountCents: $(200) },
      challenger: { bidderId: "ben", maxAmountCents: $(205) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    // one increment would be $210, but Ben's ceiling caps it at $205
    assert.equal(r.newPriceCents, $(205));
    assert.equal(r.leaderId, "ben");
  });

  it("a standing proxy answers a lower ceiling instantly", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(100),
      leader: { bidderId: "ana", maxAmountCents: $(500) },
      challenger: { bidderId: "ben", maxAmountCents: $(300) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.outcome, "leader_held");
    assert.equal(r.leaderId, "ana");
    assert.equal(r.outbidBidderId, "ben");
    // Ben's $300 + increment at $300 ($10) = $310, under Ana's $500 ceiling
    assert.equal(r.newPriceCents, $(310));
  });

  it("breaks an exact tie in favour of the earlier bid", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(100),
      leader: { bidderId: "ana", maxAmountCents: $(500) },
      challenger: { bidderId: "ben", maxAmountCents: $(500) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.leaderId, "ana", "the earlier bid holds the lot");
    assert.equal(r.newPriceCents, $(500));
    assert.equal(r.outbidBidderId, "ben");
  });

  it("rejects a challenge that does not clear the current ask", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(300),
      leader: { bidderId: "ana", maxAmountCents: $(500) },
      challenger: { bidderId: "ben", maxAmountCents: $(305) },
    });
    assert.equal(r.accepted, false);
    if (r.accepted) return;
    assert.equal(r.reason, "below_minimum");
    assert.equal(r.minimumCents, $(310));
  });
});

describe("raising your own ceiling", () => {
  it("does not bid you against yourself", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(210),
      leader: { bidderId: "ana", maxAmountCents: $(500) },
      challenger: { bidderId: "ana", maxAmountCents: $(900) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.outcome, "max_raised");
    assert.equal(r.newPriceCents, $(210), "price must not move");
    assert.equal(r.leaderMaxCents, $(900));
    assert.deepEqual(r.ledger, [], "a private ceiling change is not public history");
  });

  it("refuses to lower an existing ceiling", () => {
    const r = resolveProxyBid({
      ...base,
      currentPriceCents: $(210),
      leader: { bidderId: "ana", maxAmountCents: $(500) },
      challenger: { bidderId: "ana", maxAmountCents: $(400) },
    });
    assert.equal(r.accepted, false);
    if (r.accepted) return;
    assert.equal(r.reason, "not_a_raise");
  });
});

describe("reserve price", () => {
  it("keeps the lot unsold while the reserve is unmet", () => {
    const r = resolveProxyBid({
      ...base,
      reservePriceCents: $(1_000),
      leader: null,
      challenger: { bidderId: "ana", maxAmountCents: $(400) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.reserveMet, false);
    assert.equal(r.newPriceCents, $(100));
  });

  it("jumps the ask to the reserve once a ceiling covers it", () => {
    const r = resolveProxyBid({
      ...base,
      reservePriceCents: $(1_000),
      leader: null,
      challenger: { bidderId: "ana", maxAmountCents: $(2_500) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.reserveMet, true);
    assert.equal(r.newPriceCents, $(1_000), "price advances straight to the reserve");
  });

  it("treats a null reserve as always met", () => {
    const r = resolveProxyBid({
      ...base,
      reservePriceCents: null,
      leader: null,
      challenger: { bidderId: "ana", maxAmountCents: $(100) },
    });
    assert.equal(r.accepted, true);
    if (!r.accepted) return;
    assert.equal(r.reserveMet, true);
  });
});

describe("invariants hold across random contests", () => {
  it("price never exceeds the winning ceiling, and the higher ceiling always wins", () => {
    let seed = 1337;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const leaderMax = $(100 + rand(50_000));
      const challengerMax = $(100 + rand(50_000));
      const currentPrice = Math.min(leaderMax, $(100 + rand(5_000)));
      const r = resolveProxyBid({
        startingPriceCents: $(100),
        currentPriceCents: currentPrice,
        reservePriceCents: null,
        leader: { bidderId: "ana", maxAmountCents: leaderMax },
        challenger: { bidderId: "ben", maxAmountCents: challengerMax },
      });
      if (!r.accepted) continue;
      const winnerMax = r.leaderId === "ana" ? leaderMax : challengerMax;
      assert.ok(
        r.newPriceCents <= winnerMax,
        `price ${r.newPriceCents} exceeded winner ceiling ${winnerMax}`,
      );
      assert.ok(
        r.newPriceCents >= currentPrice,
        `price went backwards: ${currentPrice} -> ${r.newPriceCents}`,
      );
      const expectedWinner = challengerMax > leaderMax ? "ben" : "ana";
      assert.equal(r.leaderId, expectedWinner, "the higher ceiling must win");
    }
  });
});
