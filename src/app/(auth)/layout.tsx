import Link from "next/link";
import { Logo } from "@/components/chrome/logo";

/**
 * The saleroom door.
 *
 * Deliberately outside the app chrome: no header, no footer, nothing to click
 * except the thing we want clicked. The editorial half exists to answer the
 * only question a stranger has on this page — "what is this, and why would I
 * hand it an email address?" — so it states the three house rules that make
 * bidding here different rather than showing decorative filler.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <EditorialPanel />

      <div className="flex flex-col px-5 py-8 sm:px-10 lg:px-14 lg:py-12">
        <Link href="/" className="mb-10 inline-flex w-fit lg:mb-14" aria-label="Auctioneer home">
          <Logo />
        </Link>
        <div className="flex w-full flex-1 items-start lg:items-center">
          <div className="mx-auto w-full max-w-[26rem]">{children}</div>
        </div>
        <p className="mt-10 text-[11px] leading-relaxed text-ash lg:mt-14">
          Auctioneer is a demonstration house. Balances are simulated and no card is ever
          charged — but the ledger, the proxy engine and the clock behave exactly as the
          real thing.
        </p>
      </div>
    </div>
  );
}

const HOUSE_RULES = [
  {
    n: "01",
    title: "Bid your true maximum",
    body:
      "You name a ceiling and never say it out loud. The house raises you one increment at a time and stops the moment you are ahead — so a $9,000 ceiling can win at $4,250.",
  },
  {
    n: "02",
    title: "The reserve is sealed",
    body:
      "Sellers set a floor you cannot see. You will be told whether it has been met, never what it is. Under it, the lot simply does not sell.",
  },
  {
    n: "03",
    title: "The clock defends itself",
    body:
      "A bid inside the last two minutes pushes the close back two minutes. Sniping stops working, and the lot goes to whoever actually values it most.",
  },
] as const;

function EditorialPanel() {
  return (
    <aside className="relative hidden overflow-hidden border-r border-pewter/40 bg-obsidian lg:flex lg:flex-col lg:justify-between">
      {/* Layered light, not imagery: a picture light over the rostrum, plus a
          faint engine-turned pattern borrowed from the share certificates the
          rest of the catalogue art references. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(48rem 34rem at 18% -8%, color-mix(in oklab, var(--color-gild-500) 26%, transparent), transparent 68%)," +
            "radial-gradient(38rem 30rem at 108% 82%, color-mix(in oklab, var(--color-amethyst-500) 22%, transparent), transparent 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -bottom-52 size-[46rem] rounded-full opacity-[0.16]"
        style={{
          background:
            "repeating-conic-gradient(from 0deg at 50% 50%, var(--color-gild-200) 0deg 0.35deg, transparent 0.35deg 2.6deg)",
          maskImage: "radial-gradient(closest-side, #000 42%, transparent 78%)",
        }}
      />

      <div className="relative z-10 p-14">
        <p className="text-[11px] font-medium uppercase tracking-[0.32em] text-gild-300">
          Est. this evening
        </p>
        <h1 className="mt-7 max-w-[13ch] font-display text-[3.4rem] leading-[0.94] font-semibold tracking-[-0.03em] text-linen xl:text-[4.1rem]">
          The room is <span className="gild-text">still warm.</span>
        </h1>
        <p className="mt-7 max-w-[42ch] text-[15px] leading-relaxed text-fog">
          Nine hundred lots a week cross this rostrum — cased instruments, cold-war optics,
          studio ceramics, things whose owners finally admit they will never restore them.
          Bidding is free. Winning is not.
        </p>
      </div>

      <div className="relative z-10 p-14 pt-0">
        <div className="h-px w-full hairline" aria-hidden />
        <ul className="mt-9 space-y-7">
          {HOUSE_RULES.map((rule) => (
            <li key={rule.n} className="flex gap-5">
              <span className="tabular mt-0.5 shrink-0 font-mono text-[11px] tracking-[0.14em] text-gild-500">
                {rule.n}
              </span>
              <div>
                <h2 className="font-display text-[15px] font-semibold tracking-tight text-linen">
                  {rule.title}
                </h2>
                <p className="mt-1.5 max-w-[46ch] text-[13px] leading-relaxed text-ash">
                  {rule.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <Link
          href="/how-it-works"
          className="mt-9 inline-block text-[13px] text-fog underline decoration-gild-600/60 underline-offset-4 transition-colors hover:text-gild-200"
        >
          Read the full house rules
        </Link>
      </div>
    </aside>
  );
}
