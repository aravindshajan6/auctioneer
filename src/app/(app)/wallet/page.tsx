import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Info, Lock, Wallet as WalletIcon } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { getWallet } from "@/lib/queries";
import { formatCents } from "@/lib/auction/money";
import { WalletTopUp } from "@/components/account/wallet-topup";
import { EmptyState } from "@/components/account/empty-state";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Wallet",
  description: "Available and held balances, and the full ledger behind them.",
};

export const dynamic = "force-dynamic";

type LedgerKind =
  | "deposit"
  | "withdrawal"
  | "hold_place"
  | "hold_release"
  | "hold_capture"
  | "sale_proceeds"
  | "platform_fee"
  | "refund";

/**
 * The `ledger_kind` enum in a bidder's language. The second line matters more
 * than the first: a statement that says "hold_place" explains nothing about
 * why the spendable number just fell.
 */
const KIND: Record<LedgerKind, { label: string; note: string }> = {
  deposit: { label: "Top-up", note: "Funds added to your available balance." },
  withdrawal: { label: "Payment", note: "Paid out of available funds." },
  hold_place: { label: "Bid deposit held", note: "Moved from available into held against a lot." },
  hold_release: { label: "Deposit released", note: "Outbid or the lot passed — back to available." },
  hold_capture: { label: "Deposit applied", note: "You won: the hold left the wallet toward your invoice." },
  sale_proceeds: { label: "Sale proceeds", note: "A lot of yours was paid for." },
  platform_fee: { label: "Platform fee", note: "The house's commission." },
  refund: { label: "Refund", note: "Money returned to you." },
};

const STATEMENT_DATE = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});

export default async function WalletPage() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in?next=/wallet");

  const wallet = await getWallet(session.user.id);
  const available = wallet?.availableCents ?? 0;
  const held = wallet?.heldCents ?? 0;
  const total = available + held;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <header className="max-w-2xl">
        <p className="text-[11px] font-medium tracking-[0.2em] text-gild-400 uppercase">
          Account
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-linen sm:text-4xl">
          Wallet
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-fog">
          Bidding here is backed by money, not by promises. Every bid places a refundable deposit,
          and every movement of it is written to a double-entry ledger you can read below.
        </p>
      </header>

      <p className="mt-6 flex items-start gap-2.5 rounded-xl border border-amethyst-500/40 bg-amethyst-500/[0.08] px-4 py-3 text-[13px] leading-relaxed text-amethyst-300">
        <Info className="mt-px size-4 shrink-0" aria-hidden />
        <span>
          <strong className="font-semibold">These balances are simulated.</strong> No card is
          charged and nothing can be withdrawn to a bank. The bookkeeping is real — the funding
          source is not.
        </span>
      </p>

      {/* Two figures, deliberately not summed into one headline: a bidder who
          reads "total" as spendable will place a bid they cannot back. */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <BalanceCard
          tone="gild"
          icon={<WalletIcon className="size-4" aria-hidden />}
          label="Available"
          amount={available}
          body="Spendable right now — this is what a new bid deposit comes out of."
        />
        <BalanceCard
          tone="held"
          icon={<Lock className="size-4" aria-hidden />}
          label="Held"
          amount={held}
          body="Committed to bids you are currently leading. You cannot spend it, but you have not lost it: it returns to available the moment you are outbid or the lot passes."
        />
      </section>

      <p className="tabular mt-3 text-[13px] text-ash">
        Total on account: <span className="text-fog">{formatCents(total)}</span> — of which{" "}
        <span className="text-fog">{formatCents(available)}</span> can be spent.
      </p>

      <section className="mt-9 rounded-2xl border border-pewter/45 bg-obsidian/60 px-5 py-5">
        <WalletTopUp />
      </section>

      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-linen">Statement</h2>
          <p className="text-[12.5px] text-ash">
            Most recent first · balances shown are the totals immediately after each movement
          </p>
        </div>

        {!wallet || wallet.entries.length === 0 ? (
          <EmptyState
            className="mt-4"
            title="No movements yet"
            body="Add funds above and the first line of your ledger appears here. Every bid, release and settlement writes another."
            action={{ label: "Find a lot to bid on", href: "/explore" }}
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-separate border-spacing-y-1.5 text-left">
              <caption className="sr-only">
                Wallet ledger: date, movement, signed amount, and the available and held balances
                after each entry.
              </caption>
              <thead>
                <tr className="text-[10.5px] tracking-[0.12em] text-ash uppercase">
                  <th scope="col" className="px-4 pb-1 font-medium">Date</th>
                  <th scope="col" className="px-4 pb-1 font-medium">Movement</th>
                  <th scope="col" className="px-4 pb-1 text-right font-medium">Amount</th>
                  <th scope="col" className="px-4 pb-1 text-right font-medium">Available</th>
                  <th scope="col" className="px-4 pb-1 text-right font-medium">Held</th>
                </tr>
              </thead>
              <tbody>
                {wallet.entries.map((entry) => {
                  const kind = KIND[entry.kind as LedgerKind];
                  const positive = entry.amountCents > 0;
                  return (
                    <tr key={entry.id} className="bg-white/[0.015]">
                      <td className="tabular rounded-l-xl border-y border-l border-pewter/40 px-4 py-3 text-[13px] whitespace-nowrap text-ash">
                        {STATEMENT_DATE.format(new Date(entry.createdAt))}
                      </td>
                      <td className="border-y border-pewter/40 px-4 py-3">
                        <p className="text-sm font-medium text-linen">{kind.label}</p>
                        <p className="mt-0.5 text-[12px] leading-snug text-ash">
                          {entry.memo ?? kind.note}
                        </p>
                      </td>
                      <td
                        className={cn(
                          "tabular border-y border-pewter/40 px-4 py-3 text-right text-sm font-medium whitespace-nowrap",
                          positive ? "text-signal-300" : "text-ember-300",
                        )}
                      >
                        {positive ? "+" : "−"}
                        {formatCents(Math.abs(entry.amountCents), { showCents: true })}
                      </td>
                      <td className="tabular border-y border-pewter/40 px-4 py-3 text-right text-sm whitespace-nowrap text-fog">
                        {formatCents(entry.availableAfterCents, { showCents: true })}
                      </td>
                      <td className="tabular rounded-r-xl border-y border-r border-pewter/40 px-4 py-3 text-right text-sm whitespace-nowrap text-fog">
                        {formatCents(entry.heldAfterCents, { showCents: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-[12.5px] leading-relaxed text-ash">
          A held deposit is 10% of the price you are leading at, with a $25 floor. Raising your
          maximum tops the existing hold up rather than stacking a second one, so you are never
          charged twice for the same lot.{" "}
          <Link
            href="/how-it-works"
            className="text-gild-200 underline decoration-gild-600/60 underline-offset-4 hover:text-gild-100"
          >
            How deposits work
          </Link>
        </p>
      </section>
    </div>
  );
}

function BalanceCard({
  tone,
  icon,
  label,
  amount,
  body,
}: {
  tone: "gild" | "held";
  icon: React.ReactNode;
  label: string;
  amount: number;
  body: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-5 py-5",
        tone === "gild"
          ? "border-gild-600/50 bg-gild-500/[0.07]"
          : "border-pewter/50 bg-white/[0.02]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] font-medium tracking-[0.13em] uppercase",
          tone === "gild" ? "text-gild-200" : "text-fog",
        )}
      >
        {icon}
        {label}
      </div>
      <p
        className={cn(
          "tabular mt-3 font-display text-[2.4rem] leading-none font-semibold",
          tone === "gild" ? "text-gild-100" : "text-linen",
        )}
      >
        {formatCents(amount, { showCents: true })}
      </p>
      <p className="mt-3 text-[13px] leading-relaxed text-ash">{body}</p>
    </div>
  );
}
