import type { Metadata } from "next";
import Link from "next/link";
import { INCREMENT_TIERS, incrementFor } from "@/lib/auction/increments";
import { applyBps, formatCents } from "@/lib/auction/money";
import { DEPOSIT_RATE_BPS, MIN_DEPOSIT_CENTS, requiredDepositFor } from "@/lib/wallet/ledger";
import { settings } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "House rules",
  description:
    "Proxy bidding, the increment ladder, sealed reserves, anti-snipe soft close, bid deposits and the buyer's premium — what each one actually does.",
};

const SECTIONS = [
  { id: "proxy", label: "Maximum bidding" },
  { id: "ladder", label: "The increment ladder" },
  { id: "ties", label: "Ties" },
  { id: "reserve", label: "Sealed reserves" },
  { id: "soft-close", label: "Anti-snipe soft close" },
  { id: "deposits", label: "Deposits and held funds" },
  { id: "premium", label: "The buyer's premium" },
] as const;

export default function HowItWorksPage() {
  const cfg = settings();
  const premiumPercent = cfg.BUYERS_PREMIUM_BPS / 100;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
      <header className="max-w-3xl">
        <p className="text-[11px] font-medium tracking-[0.2em] text-gild-400 uppercase">
          House rules
        </p>
        <h1 className="mt-3 font-display text-4xl leading-[1.05] font-semibold tracking-[-0.02em] text-linen sm:text-5xl">
          Six mechanisms, and why each one exists
        </h1>
        <p className="mt-5 text-[16px] leading-relaxed text-fog">
          An auction is a machine for discovering what something is worth to the person who wants
          it most. Most of the machinery below exists to stop that discovery being corrupted — by
          bluffing, by pocket-change bidding, by a rival who waits until you are asleep. These are
          the rules this platform actually runs; the numbers are read from the same modules the
          bid engine uses.
        </p>
      </header>

      <div className="mt-14 grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-[10.5px] font-medium tracking-[0.14em] text-ash uppercase">
            On this page
          </h2>
          <ol className="mt-3 space-y-1.5">
            {SECTIONS.map((s, i) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="group flex gap-2.5 text-[13px] text-ash transition-colors hover:text-linen"
                >
                  <span className="tabular font-mono text-[11px] text-gild-600 group-hover:text-gild-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="max-w-2xl space-y-16">
          {/* ---------------------------------------------------------------- */}
          <Section n="01" id="proxy" title="Maximum bidding, and why honesty is safe">
            <p>
              You never bid a price here. You name a <strong className="text-linen">maximum</strong>{" "}
              — the most you would pay rather than lose the lot — and the house bids on your behalf
              up to it, one increment at a time, and stops the instant you are ahead. Your maximum
              is never shown to anyone, including the seller.
            </p>
            <p>
              The consequence is the part people do not believe until they see it: the price is set
              by the <em>second</em>-highest maximum, not the highest. Bidding your true ceiling
              cannot make you pay more than one increment above your closest rival. It can only
              stop you losing to somebody who valued it less than you did.
            </p>

            <WorkedExample />

            <p>
              Charlotte was willing to go to $1,200 and paid $925. Her honesty cost her nothing and
              won her the lot. Had she bid $700 to &quot;test the water&quot;, Ana&apos;s standing
              proxy would have answered instantly and Charlotte would have lost an object she
              valued at $1,200 to somebody who valued it at $900.
            </p>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section n="02" id="ladder" title="The increment ladder">
            <p>
              A raise has to be meaningful. If a $50,000 lot could be advanced by a dollar, the
              close would be a typing contest. So the minimum raise scales with the price, exactly
              as it does in a real room where the auctioneer calls the next figure.
            </p>
            <IncrementTable />
            <p>
              One exception, and it matters: <strong className="text-linen">the opening bid is
              the starting price itself</strong>. Nobody should have to beat a price no one has
              offered yet. Every bid after that must clear the current ask plus the step above.
            </p>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section n="03" id="ties" title="What happens on an exact tie">
            <p>
              Two bidders can name the same maximum. When that happens{" "}
              <strong className="text-linen">the earlier bid wins</strong>. The bidder who was
              already leading keeps the lot, and the newcomer is outbid before the page repaints —
              a matching ceiling is not a better one.
            </p>
            <Callout>
              If Ana holds the lot with a $900 maximum and Charlotte arrives with a $900 maximum,
              Ana keeps it. Charlotte must go to $925 — the next rung of the ladder — to take it.
            </Callout>
            <p>
              This is the only rule here that rewards being early rather than being right, and it
              exists because the alternatives are worse: a coin flip is arbitrary, and letting the
              latecomer win would let anyone displace a standing bid for free.
            </p>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section n="04" id="reserve" title="Sealed reserves">
            <p>
              A reserve is the lowest price at which a seller is willing to part with the lot. It
              is <strong className="text-linen">sealed</strong>: you are told whether it has been
              met, never what it is.
            </p>
            <p>
              A reserve does not block bidding — it blocks <em>selling</em>. Bidding proceeds
              normally underneath it, and if the clock runs out with the highest maximum still
              below the reserve, the lot is marked unsold, no order is created, and every deposit
              goes back. Nobody pays anything.
            </p>
            <p>
              The moment somebody&apos;s maximum does cover the reserve, the ask jumps straight to
              it. That is why a lot can move from $400 to $1,000 on a single bid — the seller&apos;s
              floor has been reached, and the house advances the price to it rather than creeping
              up in $25 steps to a number everyone can now afford.
            </p>
            <Callout>
              Sealing the number is what makes it useful. A published reserve becomes the opening
              price in every bidder&apos;s head, and the discovery the auction exists to perform
              never happens.
            </Callout>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section n="05" id="soft-close" title="Anti-snipe soft close">
            <p>
              Sniping — placing a bid in the last two seconds so nobody can answer — wins auctions
              by denying rivals a response, not by valuing the lot more highly. It converts an
              auction into a reflex test.
            </p>
            <p>
              So the clock defends itself. On a timed lot, a bid inside the final{" "}
              <strong className="text-linen">{describeSeconds(cfg.ANTISNIPE_WINDOW_SECONDS)}</strong>{" "}
              pushes the close out by another{" "}
              <strong className="text-linen">
                {describeSeconds(cfg.ANTISNIPE_EXTENSION_SECONDS)}
              </strong>
              , and it keeps doing so until a full window passes with nobody raising. The lot ends
              when the bidding ends, which is what &quot;going, going, gone&quot; always meant.
              Total overtime is capped so a lot cannot be kept alive indefinitely.
            </p>
            <p>
              Lots in a <Link href="/live" className="underline decoration-gild-600/60 underline-offset-4 hover:text-gild-100">live sale</Link>{" "}
              work differently: an auctioneer closes them from the rostrum, so the clock there is a
              schedule rather than a deadline.
            </p>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section n="06" id="deposits" title="Deposits, and the held/available split">
            <p>
              A bid is a commitment before it is a payment, so leading a lot requires money on
              deposit. When you take the lead, {(DEPOSIT_RATE_BPS / 100).toFixed(0)}% of the current
              price — with a floor of {formatCents(MIN_DEPOSIT_CENTS)} — moves out of your{" "}
              <strong className="text-linen">available</strong> balance and into{" "}
              <strong className="text-linen">held</strong>.
            </p>
            <DepositTable />
            <p>
              Held money is not spent and not lost. It returns to available automatically the
              moment you are outbid or the lot passes. If you win, it is applied to your invoice
              rather than refunded — you never regain the ability to spend it, because you have
              bought something with it.
            </p>
            <p>
              Raising your own maximum tops the existing hold up to the new requirement instead of
              stacking a second one, so a lot you chase for a week never holds more than one
              deposit at a time. Every one of these movements is a line in your{" "}
              <Link href="/wallet" className="underline decoration-gild-600/60 underline-offset-4 hover:text-gild-100">
                wallet statement
              </Link>
              , with the running available and held balance beside it.
            </p>
          </Section>

          {/* ---------------------------------------------------------------- */}
          <Section n="07" id="premium" title="The buyer's premium">
            <p>
              The winning bid is the <em>hammer price</em>. On top of it the buyer pays a{" "}
              <strong className="text-linen">{premiumPercent}% buyer&apos;s premium</strong>, which
              is how the house is paid. It does not come out of the seller&apos;s proceeds.
            </p>
            <PremiumTable bps={cfg.BUYERS_PREMIUM_BPS} />
            <p>
              Set your maximum with the premium in mind: a $1,000 ceiling is really a{" "}
              {formatCents(100_000 + applyBps(100_000, cfg.BUYERS_PREMIUM_BPS))} commitment. Every
              invoice on this platform itemises hammer, premium and shipping separately, so the
              arithmetic is always visible.
            </p>
          </Section>

          <div className="rounded-2xl border border-gild-600/45 bg-gild-500/[0.06] px-6 py-6">
            <h2 className="font-display text-xl font-semibold text-linen">
              That is the whole machine
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-fog">
              Name your true maximum, keep enough in available to back it, and let the clock do the
              rest.
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link
                href="/explore"
                className="inline-flex h-10 items-center rounded-full bg-linear-to-b from-gild-300 to-gild-500 px-5 text-sm font-medium text-obsidian transition-colors hover:from-gild-200 hover:to-gild-400"
              >
                Browse the catalogue
              </Link>
              <Link
                href="/sell"
                className="inline-flex h-10 items-center rounded-full border border-pewter/60 px-5 text-sm text-fog transition-colors hover:border-gild-500/60 hover:text-linen"
              >
                Consign a lot
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout pieces                                                               */
/* -------------------------------------------------------------------------- */

function Section({
  n,
  id,
  title,
  children,
}: {
  n: string;
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-baseline gap-3">
        <span className="tabular font-mono text-[11px] tracking-[0.14em] text-gild-500">{n}</span>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-linen sm:text-[1.75rem]">
          {title}
        </h2>
      </div>
      <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-fog [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-l-2 border-gild-500/60 bg-gild-500/[0.05] py-3 pr-4 pl-4 text-[14px] leading-relaxed text-gild-100/90">
      {children}
    </p>
  );
}

/* -------------------------------------------------------------------------- */
/* Worked example                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every figure below is what `resolveProxyBid` actually produces for this
 * sequence — including the $25 step at $900, which comes from the ladder.
 * Keeping the example honest is the whole point of printing it.
 */
const EXAMPLE = [
  {
    who: "Ana",
    action: "Sets a maximum of $900",
    price: 40_000,
    leader: "Ana",
    note: "Opening bid, so she pays the starting price — nobody has pushed her yet. Her $900 stays private.",
  },
  {
    who: "Ben",
    action: "Sets a maximum of $650",
    price: 67_500,
    leader: "Ana",
    note: "Ana's standing proxy answers automatically: it climbs one step past Ben's ceiling and stops. Ben is outbid before the page repaints.",
  },
  {
    who: "Charlotte",
    action: "Sets a maximum of $1,200",
    price: 92_500,
    leader: "Charlotte",
    note: "She beats Ana's $900 by one $25 step — not by $300. The remaining $275 of her ceiling is never spent.",
  },
] as const;

function WorkedExample() {
  return (
    <figure className="not-prose overflow-hidden rounded-2xl border border-pewter/45 bg-obsidian/60">
      <figcaption className="border-b border-pewter/35 px-5 py-3">
        <p className="font-display text-[15px] font-semibold text-linen">
          A worked example: a lot opening at $400, no reserve
        </p>
      </figcaption>
      <ol>
        {EXAMPLE.map((row, i) => (
          <li
            key={row.who}
            className={cn("px-5 py-4", i > 0 && "border-t border-pewter/30")}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-linen">
                <span className="font-medium">{row.who}</span>{" "}
                <span className="text-fog">— {row.action}</span>
              </p>
              <p className="tabular text-sm">
                <span className="text-ash">ask </span>
                <span className="font-display text-lg font-semibold text-gild-200">
                  {formatCents(row.price)}
                </span>
              </p>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ash">{row.note}</p>
            <p className="mt-1.5 text-[12px] tracking-[0.06em] text-ash uppercase">
              Leading: <span className="text-fog">{row.leader}</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="border-t border-pewter/35 bg-white/[0.02] px-5 py-3.5 text-[13px] leading-relaxed text-fog">
        Charlotte wins at <span className="tabular font-semibold text-gild-200">$925</span> holding
        a $1,200 ceiling — <span className="tabular">$275</span> of headroom she never had to
        spend, because the price was set by Ana&apos;s $900, not by her own maximum.
      </p>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/** Rendered from `INCREMENT_TIERS` so the page cannot drift from the engine. */
function IncrementTable() {
  const rows = INCREMENT_TIERS.map(([floor, step], i) => {
    const nextFloor = INCREMENT_TIERS[i + 1]?.[0];
    return {
      band:
        nextFloor === undefined
          ? `${formatCents(floor)} and above`
          : `${formatCents(floor)} – ${formatCents(nextFloor - 1)}`,
      step: formatCents(step),
    };
  });

  return (
    <div className="not-prose overflow-x-auto rounded-2xl border border-pewter/45 bg-obsidian/60">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Minimum raise by current price band.</caption>
        <thead>
          <tr className="border-b border-pewter/35 text-[10.5px] tracking-[0.12em] text-ash uppercase">
            <th scope="col" className="px-5 py-2.5 font-medium">Current price</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Minimum raise</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.band} className={cn(i > 0 && "border-t border-pewter/25")}>
              <td className="tabular px-5 py-2 text-fog">{row.band}</td>
              <td className="tabular px-5 py-2 text-right font-medium text-linen">{row.step}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Deposit requirements at a few real prices, straight from the ledger rule. */
const DEPOSIT_SAMPLES = [5_000, 50_000, 250_000, 2_000_000];

function DepositTable() {
  return (
    <div className="not-prose overflow-x-auto rounded-2xl border border-pewter/45 bg-obsidian/60">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Held deposit required at sample lead prices.</caption>
        <thead>
          <tr className="border-b border-pewter/35 text-[10.5px] tracking-[0.12em] text-ash uppercase">
            <th scope="col" className="px-5 py-2.5 font-medium">Leading at</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Held deposit</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Next raise costs</th>
          </tr>
        </thead>
        <tbody>
          {DEPOSIT_SAMPLES.map((price, i) => {
            const next = price + incrementFor(price);
            const extra = requiredDepositFor(next) - requiredDepositFor(price);
            return (
              <tr key={price} className={cn(i > 0 && "border-t border-pewter/25")}>
                <td className="tabular px-5 py-2 text-fog">{formatCents(price)}</td>
                <td className="tabular px-5 py-2 text-right font-medium text-linen">
                  {formatCents(requiredDepositFor(price))}
                </td>
                <td className="tabular px-5 py-2 text-right text-ash">
                  {/* Under the $25 floor the percentage has not caught up yet,
                      so a raise costs nothing extra to back. */}
                  {extra === 0 ? "nothing extra" : `${formatCents(extra)} more`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const PREMIUM_SAMPLES = [50_000, 250_000, 1_500_000];

function PremiumTable({ bps }: { bps: number }) {
  return (
    <div className="not-prose overflow-x-auto rounded-2xl border border-pewter/45 bg-obsidian/60">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Hammer price, premium and total payable.</caption>
        <thead>
          <tr className="border-b border-pewter/35 text-[10.5px] tracking-[0.12em] text-ash uppercase">
            <th scope="col" className="px-5 py-2.5 font-medium">Hammer</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">Premium</th>
            <th scope="col" className="px-5 py-2.5 text-right font-medium">You pay</th>
          </tr>
        </thead>
        <tbody>
          {PREMIUM_SAMPLES.map((hammer, i) => {
            const premium = applyBps(hammer, bps);
            return (
              <tr key={hammer} className={cn(i > 0 && "border-t border-pewter/25")}>
                <td className="tabular px-5 py-2 text-fog">{formatCents(hammer)}</td>
                <td className="tabular px-5 py-2 text-right text-ash">{formatCents(premium)}</td>
                <td className="tabular px-5 py-2 text-right font-medium text-gild-200">
                  {formatCents(hammer + premium)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function describeSeconds(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} seconds`;
}
