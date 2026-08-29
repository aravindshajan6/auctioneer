"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  Gavel,
  Info,
  Lock,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { applyBps, formatCents, parseToCents } from "@/lib/auction/money";
import {
  incrementFor,
  minimumNextBid,
  quickBidLadder,
} from "@/lib/auction/increments";
import { formatCountdown } from "@/lib/hooks/use-countdown";
import type { LotStatePayload } from "@/lib/realtime/events";
import { useLotLive, useRealtimeStore } from "@/lib/realtime/store";
import { Badge, LiveBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { formatBps, isBiddable, statusMeta, type LotStatus } from "./format";
import { usePriceFlash } from "./use-price-flash";
import { useServerCountdown } from "./use-server-clock";
import { WatchButton } from "./watch-button";

export interface BidPanelLot {
  id: string;
  slug: string;
  title: string;
  status: LotStatus;
  startingPriceCents: number;
  currentPriceCents: number;
  minimumNextBidCents: number;
  buyNowPriceCents: number | null;
  buyersPremiumBps: number;
  bidCount: number;
  bidderCount: number;
  hasReserve: boolean;
  reserveMet: boolean;
  /** ISO strings — dates do not survive the server/client boundary intact. */
  startsAt: string;
  endsAt: string;
  extensionCount: number;
  leaderId: string | null;
  yourMaxCents: number | null;
  watching: boolean;
  version: number;
}

interface BidResponseOk {
  ok: true;
  currentPriceCents: number;
  minimumNextBidCents: number;
  leaderId: string;
  bidCount: number;
  reserveMet: boolean;
  endsAt: string;
  extended: boolean;
  youWereOutbid: boolean;
  version: number;
}

interface BidResponseError {
  ok: false;
  code: string;
  message: string;
  minimumNextBidCents?: number;
  requiredCents?: number;
  availableCents?: number;
}

/**
 * A UUID per bid intent.
 *
 * `crypto.randomUUID` is unavailable in insecure contexts (a bare-IP dev host,
 * for instance) and a missing key would silently disable replay protection —
 * so we degrade to a random-plus-time key rather than to no key at all.
 */
function newIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `bid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function BidPanel({
  lot,
  viewerId,
  viewerName,
  isSeller,
  antiSnipeWindowSeconds = 120,
  className,
}: {
  lot: BidPanelLot;
  viewerId: string | null;
  viewerName: string | null;
  isSeller: boolean;
  /** The house's soft-close window, so the explainer states the real rule. */
  antiSnipeWindowSeconds?: number;
  className?: string;
}) {
  const router = useRouter();
  const live = useLotLive(lot.id);

  /* -- Live truth beats the render we were built from. -------------------- */
  const status = live.state?.status ?? lot.status;
  const priceCents = live.state?.currentPriceCents ?? lot.currentPriceCents;
  const bidCount = live.state?.bidCount ?? lot.bidCount;
  const bidderCount = live.state?.bidderCount ?? lot.bidderCount;
  const reserveMet = live.state?.reserveMet ?? lot.reserveMet;
  const leaderId = live.state?.leaderId ?? lot.leaderId;
  const endsAt = live.state?.endsAt ?? lot.endsAt;

  const minNextCents =
    live.state?.minimumNextBidCents ??
    minimumNextBid({
      currentPriceCents: priceCents,
      startingPriceCents: lot.startingPriceCents,
      hasBids: bidCount > 0,
    });

  const countdown = useServerCountdown(
    status === "scheduled" ? lot.startsAt : endsAt,
  );
  const priceRef = usePriceFlash<HTMLSpanElement>(priceCents);

  const open = isBiddable(status) && !countdown.expired;
  const closed =
    status === "sold" || status === "passed" || status === "cancelled";
  const leading = Boolean(viewerId) && leaderId === viewerId;
  const [yourMaxCents, setYourMaxCents] = useState<number | null>(
    lot.yourMaxCents,
  );
  const hasBidHere = yourMaxCents !== null;
  const outbid = hasBidHere && !leading && !closed;

  /* -- Anti-snipe: count the clock jumping forward, whoever caused it. ----- */
  const [extensions, setExtensions] = useState(lot.extensionCount);
  const lastEndsAt = useRef(endsAt);
  useEffect(() => {
    const previous = Date.parse(lastEndsAt.current);
    const next = Date.parse(endsAt);
    lastEndsAt.current = endsAt;
    if (
      Number.isFinite(previous) &&
      Number.isFinite(next) &&
      next > previous + 1000
    ) {
      setExtensions((n) => n + 1);
    }
  }, [endsAt]);

  /* -- Tell a bidder the moment the room takes the lot off them. ---------- */
  const wasLeading = useRef(leading);
  useEffect(() => {
    if (wasLeading.current && !leading && hasBidHere && !closed) {
      toast.error("You have been outbid", {
        description: `${lot.title} is now at ${formatCents(priceCents)}.`,
      });
    }
    wasLeading.current = leading;
  }, [leading, hasBidHere, closed, lot.title, priceCents]);

  /* -- Bid form ----------------------------------------------------------- */
  const ladder = useMemo(
    () => quickBidLadder(priceCents, bidCount > 0, lot.startingPriceCents),
    [priceCents, bidCount, lot.startingPriceCents],
  );
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [confirmBuyNow, setConfirmBuyNow] = useState(false);
  const [buying, setBuying] = useState(false);

  const amountCents = amount.trim() ? parseToCents(amount) : null;
  const selectedCents = amountCents ?? ladder[0] ?? minNextCents;

  // One key per (amount) intent. A double-click, a flaky network retry and a
  // dropped response all resubmit the SAME key, and the engine replays the
  // original outcome instead of bidding twice.
  const intent = useRef<{ amountCents: number; key: string } | null>(null);
  function idempotencyKeyFor(cents: number): string {
    if (intent.current?.amountCents === cents) return intent.current.key;
    const key = newIdempotencyKey();
    intent.current = { amountCents: cents, key };
    return key;
  }

  function chooseQuickBid(cents: number) {
    // Quick amounts arm the box rather than firing: one tap on a ladder button
    // is easy to do by accident, and this is money.
    setAmount((cents / 100).toFixed(0));
    setFormError(null);
  }

  async function submitBid(event?: React.FormEvent) {
    event?.preventDefault();
    if (submitting || !viewerId) return;

    const cents = amountCents;
    if (cents === null || cents <= 0) {
      setFormError("Enter the maximum you are willing to pay.");
      return;
    }
    if (cents < minNextCents) {
      setFormError(`The next accepted bid is ${formatCents(minNextCents)}.`);
      return;
    }

    setFormError(null);
    setSubmitting(true);
    const idempotencyKey = idempotencyKeyFor(cents);

    try {
      const response = await fetch(`/api/lots/${lot.id}/bid`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: cents, idempotencyKey }),
      });
      const data = (await response.json()) as BidResponseOk | BidResponseError;

      if (!data.ok) {
        handleRejection(data);
        return;
      }

      // The response is authoritative; push it into the store so the panel
      // updates now rather than when the socket echo arrives.
      const next: LotStatePayload = {
        auctionId: lot.id,
        slug: lot.slug,
        status:
          data.currentPriceCents > 0 && status === "scheduled"
            ? "live"
            : status,
        currentPriceCents: data.currentPriceCents,
        minimumNextBidCents: data.minimumNextBidCents,
        bidCount: data.bidCount,
        bidderCount: hasBidHere ? bidderCount : bidderCount + 1,
        leaderId: data.leaderId,
        leaderName:
          data.leaderId === viewerId
            ? viewerName
            : (live.state?.leaderName ?? null),
        reserveMet: data.reserveMet,
        endsAt: data.endsAt,
        version: data.version,
      };
      useRealtimeStore.getState().applyState(next);

      setYourMaxCents((current) => Math.max(current ?? 0, cents));
      setAmount("");
      intent.current = null;

      if (data.youWereOutbid) {
        toast.warning("Beaten by a standing maximum", {
          description: `Another bidder's ceiling is above ${formatCents(cents)}. Raise yours to take the lot.`,
        });
      } else {
        toast.success("You are the highest bidder", {
          description: `${lot.title} at ${formatCents(data.currentPriceCents)}${
            cents > data.currentPriceCents
              ? ` — your maximum of ${formatCents(cents)} is held privately.`
              : "."
          }`,
        });
      }
      if (data.extended) {
        toast.info("Bidding extended", {
          description:
            "Your bid landed in the final seconds, so the clock was extended.",
        });
      }
      router.refresh();
    } catch {
      // The key survives, so pressing the button again cannot double-bid.
      setFormError(
        "We could not reach the saleroom. Your bid was not placed — try again.",
      );
      toast.error("Connection lost", {
        description: "Your bid was not placed. Retry when ready.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleRejection(error: BidResponseError) {
    switch (error.code) {
      case "below_minimum": {
        const required = error.minimumNextBidCents ?? minNextCents;
        setFormError(`Bid at least ${formatCents(required)}.`);
        setAmount((required / 100).toFixed(0));
        toast.error("Below the asking price", {
          description: `The next accepted bid on this lot is ${formatCents(required)}.`,
        });
        break;
      }
      case "not_a_raise":
        setFormError(
          "Your new maximum must be higher than the one you already hold.",
        );
        toast.error("That is not a raise", {
          description: yourMaxCents
            ? `You already hold a maximum of ${formatCents(yourMaxCents)}.`
            : "Enter a higher maximum to improve your position.",
        });
        break;
      case "insufficient_funds": {
        const shortfall = Math.max(
          0,
          (error.requiredCents ?? 0) - (error.availableCents ?? 0),
        );
        setFormError(
          shortfall > 0
            ? `You need a further ${formatCents(shortfall)} on deposit to back this bid.`
            : "Your available balance does not cover the deposit for this bid.",
        );
        toast.error("Deposit short", {
          description:
            shortfall > 0
              ? `Add ${formatCents(shortfall)} to bid at this level.`
              : "Top up your wallet to keep bidding.",
          action: { label: "Wallet", onClick: () => router.push("/wallet") },
        });
        break;
      }
      case "seller_cannot_bid":
        setFormError("You are the consignor of this lot.");
        toast.error("You cannot bid on your own lot.");
        break;
      case "already_ended":
      case "not_open":
        setFormError("Bidding on this lot has closed.");
        toast.error("The lot has closed", {
          description: "The hammer has already fallen.",
        });
        router.refresh();
        break;
      case "not_started":
        setFormError("Bidding has not opened on this lot yet.");
        toast.error("Not open yet", {
          description: "This lot has not come up for bidding.",
        });
        break;
      case "unauthorized":
        toast.error("Sign in to bid", {
          action: { label: "Sign in", onClick: () => router.push(signInHref) },
        });
        break;
      case "auction_not_found":
        toast.error("That lot is no longer in the catalogue.");
        router.refresh();
        break;
      default:
        setFormError(error.message || "Your bid was not accepted.");
        toast.error(error.message || "Your bid was not accepted.");
    }
  }

  async function doBuyNow() {
    if (buying) return;
    setBuying(true);
    try {
      const response = await fetch(`/api/lots/${lot.id}/buy-now`, {
        method: "POST",
      });
      const data = (await response.json()) as
        | { ok: true; orderId: string; totalCents: number }
        | { ok: false; code: string; message: string };
      if (!data.ok) {
        toast.error(data.message);
        setConfirmBuyNow(false);
        router.refresh();
        return;
      }
      toast.success("The lot is yours", {
        description: `Settle ${formatCents(data.totalCents)} to arrange collection.`,
      });
      router.push(`/orders/${data.orderId}`);
    } catch {
      toast.error("Connection lost", {
        description: "The purchase was not completed.",
      });
    } finally {
      setBuying(false);
    }
  }

  const signInHref = `/sign-in?next=${encodeURIComponent(`/lot/${lot.slug}`)}`;
  const meta = statusMeta(status);
  const premiumCents = applyBps(priceCents, lot.buyersPremiumBps);
  // Buy Now is off the table the instant the room touches the lot — see the
  // engine's `buyNow`, which rejects it for the same reason.
  const buyNowAvailable =
    lot.buyNowPriceCents !== null && bidCount === 0 && !closed && !isSeller;
  const priceLabel = closed
    ? status === "sold"
      ? "Hammer price"
      : "Final bid"
    : bidCount > 0
      ? "Current bid"
      : "Starting bid";

  return (
    <section
      id="bid-panel"
      aria-labelledby="bid-panel-heading"
      className={cn("surface overflow-hidden rounded-2xl", className)}
    >
      <h2 id="bid-panel-heading" className="sr-only">
        Bidding on {lot.title}
      </h2>

      {/* -- Price ---------------------------------------------------------- */}
      <div className="border-b border-pewter/35 px-5 py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          {status === "live" ? (
            <LiveBadge />
          ) : (
            <Badge tone={meta.tone}>{meta.label}</Badge>
          )}
          <WatchButton
            lotId={lot.id}
            initialWatching={lot.watching}
            signedIn={Boolean(viewerId)}
            size="sm"
            withLabel
          />
        </div>

        <p className="text-[11px] uppercase tracking-[0.12em] text-ash">
          {priceLabel}
        </p>
        <span
          ref={priceRef}
          aria-live="polite"
          aria-atomic="true"
          className="tabular mt-1 block font-display text-[40px] leading-none font-semibold text-gild-200 sm:text-[46px]"
        >
          {formatCents(priceCents)}
        </span>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ash">
          <span className="tabular">
            {bidCount} {bidCount === 1 ? "bid" : "bids"}
          </span>
          {bidderCount > 0 && (
            <span className="tabular">
              {bidderCount} {bidderCount === 1 ? "bidder" : "bidders"}
            </span>
          )}
          {lot.hasReserve && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                reserveMet ? "text-signal-300" : "text-ember-300",
              )}
            >
              {reserveMet ? (
                <ShieldCheck className="size-3.5" aria-hidden />
              ) : (
                <Lock className="size-3.5" aria-hidden />
              )}
              {reserveMet ? "Reserve met" : "Reserve not met"}
            </span>
          )}
        </div>
      </div>

      {/* -- Clock ---------------------------------------------------------- */}
      <div
        className={cn(
          "flex items-center justify-between gap-3 border-b border-pewter/35 px-5 py-3.5",
          countdown.urgent && open && "bg-ember-500/10",
        )}
      >
        <span className="flex items-center gap-2 text-xs uppercase tracking-[0.11em] text-ash">
          <Timer className="size-3.5" aria-hidden />
          {closed
            ? "Closed"
            : status === "scheduled"
              ? "Opens in"
              : "Closes in"}
        </span>
        <span
          aria-live={countdown.urgent ? "assertive" : "off"}
          className={cn(
            "tabular font-display text-2xl font-semibold",
            closed
              ? "text-ash"
              : countdown.urgent
                ? "text-ember-300"
                : countdown.soon
                  ? "text-ember-300"
                  : "text-linen",
          )}
          suppressHydrationWarning /* clock-derived: the second can tick between SSR and hydration */
        >
          {closed ? "—" : formatCountdown(countdown)}
        </span>
      </div>

      {extensions > 0 && !closed && (
        <p className="flex items-start gap-2 border-b border-pewter/35 bg-gild-500/[0.07] px-5 py-3 text-xs text-gild-200">
          <Zap className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-medium">Extended</strong> — closing extended
            by anti-snipe {extensions === 1 ? "once" : `${extensions} times`}. A
            bid in the final seconds always gives the room time to answer.
          </span>
        </p>
      )}

      {/* -- Where the viewer stands --------------------------------------- */}
      {viewerId && !isSeller && (leading || outbid) && (
        <p
          aria-live="polite"
          className={cn(
            "flex items-center gap-2 border-b border-pewter/35 px-5 py-3 text-sm",
            leading
              ? "bg-signal-500/10 text-signal-300"
              : "bg-ember-500/10 text-ember-300",
          )}
        >
          {leading ? (
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          ) : (
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
          )}
          <span className="font-medium">
            {leading ? "You are the highest bidder" : "You have been outbid"}
          </span>
        </p>
      )}

      {/* -- The action ----------------------------------------------------- */}
      <div className="space-y-4 px-5 py-5">
        {isSeller ? (
          <div className="space-y-2">
            <p className="text-sm text-linen">
              You are the consignor of this lot.
            </p>
            <p className="text-xs text-ash">
              The house does not permit sellers to bid on their own property.
              Follow the sale from your dashboard.
            </p>
            <Link href="/dashboard" className="inline-block pt-1">
              <Button variant="outline" size="sm">
                Seller dashboard
                <ArrowUpRight className="size-3.5" aria-hidden />
              </Button>
            </Link>
          </div>
        ) : closed ? (
          <div className="space-y-2">
            <p className="text-sm text-linen">
              {status === "sold"
                ? leading
                  ? "The hammer fell to you."
                  : "This lot has been sold."
                : "This lot was passed — it did not meet its reserve."}
            </p>
            {status === "sold" && leading && (
              <Link href="/orders" className="inline-block pt-1">
                <Button variant="gild" size="sm">
                  Settle your invoice
                </Button>
              </Link>
            )}
            <Link
              href="/explore"
              className="block pt-1 text-xs text-gild-300 hover:text-gild-200"
            >
              Browse comparable lots →
            </Link>
          </div>
        ) : status === "scheduled" ? (
          <div className="space-y-3">
            <p className="text-sm text-linen">
              Bidding has not opened on this lot yet.
            </p>
            <p className="text-xs text-ash">
              Follow the lot and we will alert you the moment it comes up. The
              opening bid will be{" "}
              <span className="tabular text-linen">
                {formatCents(lot.startingPriceCents)}
              </span>
              .
            </p>
            {buyNowAvailable && lot.buyNowPriceCents !== null && (
              <BuyNowBlock
                priceCents={lot.buyNowPriceCents}
                premiumBps={lot.buyersPremiumBps}
                signedIn={Boolean(viewerId)}
                signInHref={signInHref}
                confirming={confirmBuyNow}
                busy={buying}
                onArm={() => setConfirmBuyNow(true)}
                onCancel={() => setConfirmBuyNow(false)}
                onConfirm={doBuyNow}
              />
            )}
          </div>
        ) : !open ? (
          <p className="text-sm text-ash">
            The clock has run out on this lot. The house is settling it now —
            refresh in a moment for the result.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="bid-amount" className="mb-0">
                Your maximum bid
              </Label>
              <span className="tabular text-xs text-ash">
                Min {formatCents(minNextCents)}
              </span>
            </div>

            {/* Quick amounts: the ask, and two rungs above it. */}
            <div className="grid grid-cols-3 gap-2">
              {ladder.map((cents, index) => {
                const active = selectedCents === cents;
                return (
                  <button
                    key={cents}
                    type="button"
                    onClick={() => chooseQuickBid(cents)}
                    aria-pressed={active}
                    className={cn(
                      "tabular rounded-xl border px-2 py-2.5 text-center text-sm transition-colors duration-200",
                      active
                        ? "border-gild-400/70 bg-gild-500/15 text-gild-100"
                        : "border-pewter/60 bg-white/[0.02] text-linen hover:border-gild-500/50 hover:bg-gild-500/[0.06]",
                    )}
                  >
                    <span className="block font-medium">
                      {formatCents(cents, { compact: true })}
                    </span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-[0.1em] text-ash">
                      {index === 0
                        ? "Ask"
                        : `+${formatCents(cents - (ladder[0] ?? cents), { compact: true })}`}
                    </span>
                  </button>
                );
              })}
            </div>

            <form onSubmit={submitBid} className="space-y-3">
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ash"
                  aria-hidden
                >
                  $
                </span>
                <Input
                  id="bid-amount"
                  name="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={(minNextCents / 100).toFixed(0)}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setFormError(null);
                  }}
                  aria-describedby="bid-help"
                  aria-invalid={formError ? true : undefined}
                  className="tabular h-12 pl-7 text-base"
                />
              </div>

              {formError && (
                <p role="alert" className="text-xs text-ember-300">
                  {formError}
                </p>
              )}

              {viewerId ? (
                <Button
                  type="submit"
                  variant="gild"
                  size="lg"
                  loading={submitting}
                  className="w-full"
                >
                  <Gavel className="size-4" aria-hidden />
                  {submitting
                    ? "Placing bid…"
                    : amountCents && amountCents >= minNextCents
                      ? `Bid up to ${formatCents(amountCents)}`
                      : "Place bid"}
                </Button>
              ) : (
                <Link href={signInHref} className="block">
                  <Button
                    variant="gild"
                    size="lg"
                    className="w-full"
                    type="button"
                  >
                    <Gavel className="size-4" aria-hidden />
                    Sign in to bid
                  </Button>
                </Link>
              )}
            </form>

            {/* -- The proxy explainer. This is the platform's core promise. -- */}
            <div className="rounded-xl border border-pewter/50 bg-white/[0.02]">
              <button
                type="button"
                onClick={() => setExplainerOpen((v) => !v)}
                aria-expanded={explainerOpen}
                aria-controls="proxy-explainer"
                className="flex w-full items-center gap-2 px-3.5 py-3 text-left text-[13px] text-linen"
              >
                <Info className="size-4 shrink-0 text-gild-300" aria-hidden />
                <span className="flex-1">
                  We bid for you, up to your maximum
                </span>
                <ChevronDown
                  className={cn(
                    "size-4 shrink-0 text-ash transition-transform duration-200",
                    explainerOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </button>
              <div
                id="proxy-explainer"
                hidden={!explainerOpen}
                className="space-y-2.5 border-t border-pewter/40 px-3.5 py-3 text-xs leading-relaxed text-fog"
              >
                <p>
                  Your maximum is confidential. The house never bids it in one
                  go — it raises you by a single increment at a time, only as
                  far as it must to keep you in front.
                </p>
                <p>
                  Bid{" "}
                  <span className="tabular text-linen">
                    {formatCents(minNextCents + incrementFor(minNextCents) * 4)}
                  </span>{" "}
                  on a lot standing at{" "}
                  <span className="tabular text-linen">
                    {formatCents(priceCents)}
                  </span>{" "}
                  and the lot moves to{" "}
                  <span className="tabular text-linen">
                    {formatCents(minNextCents)}
                  </span>{" "}
                  — not to your ceiling. You pay your maximum only if someone
                  pushes you there.
                </p>
                <p>
                  A bid inside the last {describeWindow(antiSnipeWindowSeconds)}{" "}
                  extends the clock, so nobody wins a lot simply by arriving one
                  second before the end.
                </p>
              </div>
            </div>

            {yourMaxCents !== null && (
              <p className="flex items-center justify-between gap-3 rounded-xl border border-gild-600/35 bg-gild-500/[0.07] px-3.5 py-2.5 text-xs">
                <span className="text-gild-200">Your standing maximum</span>
                <span className="tabular font-medium text-gild-100">
                  {formatCents(yourMaxCents)}
                </span>
              </p>
            )}

            {buyNowAvailable && lot.buyNowPriceCents !== null && (
              <BuyNowBlock
                priceCents={lot.buyNowPriceCents}
                premiumBps={lot.buyersPremiumBps}
                signedIn={Boolean(viewerId)}
                signInHref={signInHref}
                confirming={confirmBuyNow}
                busy={buying}
                onArm={() => setConfirmBuyNow(true)}
                onCancel={() => setConfirmBuyNow(false)}
                onConfirm={doBuyNow}
              />
            )}
          </>
        )}

        {/* -- What the winner actually pays. -------------------------------- */}
        <p className="border-t border-pewter/35 pt-3.5 text-[11px] leading-relaxed text-ash">
          A buyer&rsquo;s premium of {formatBps(lot.buyersPremiumBps)} applies
          to the hammer price. At {formatCents(priceCents)} that is{" "}
          {formatCents(premiumCents)}, for a total of{" "}
          <span className="tabular text-fog">
            {formatCents(priceCents + premiumCents)}
          </span>{" "}
          excluding shipping and any applicable tax.
        </p>
      </div>
    </section>
  );
}

/** The soft-close window in words the room would use, not raw seconds. */
function describeWindow(seconds: number): string {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

function BuyNowBlock({
  priceCents,
  premiumBps,
  signedIn,
  signInHref,
  confirming,
  busy,
  onArm,
  onCancel,
  onConfirm,
}: {
  priceCents: number;
  premiumBps: number;
  signedIn: boolean;
  signInHref: string;
  confirming: boolean;
  busy: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const totalCents = priceCents + applyBps(priceCents, premiumBps);

  if (!signedIn) {
    return (
      <Link href={signInHref} className="block">
        <Button variant="outline" size="md" className="w-full" type="button">
          Buy now for {formatCents(priceCents)}
        </Button>
      </Link>
    );
  }

  if (!confirming) {
    return (
      <div className="space-y-1.5">
        <Button
          variant="outline"
          size="md"
          className="w-full"
          onClick={onArm}
          type="button"
        >
          Buy now for {formatCents(priceCents)}
        </Button>
        <p className="text-center text-[11px] text-ash">
          Available until the first bid is placed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-xl border border-gild-600/40 bg-gild-500/[0.07] p-3.5">
      <p className="text-xs text-gild-100">
        Take the lot off the market now for{" "}
        <span className="tabular font-medium">{formatCents(totalCents)}</span>{" "}
        including the buyer&rsquo;s premium. This is binding and closes the lot
        immediately.
      </p>
      <div className="flex gap-2">
        <Button
          variant="gild"
          size="sm"
          className="flex-1"
          loading={busy}
          onClick={onConfirm}
          type="button"
        >
          Confirm purchase
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
          type="button"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
