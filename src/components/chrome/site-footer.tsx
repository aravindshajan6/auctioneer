import Link from "next/link";
import { Logo } from "./logo";

const COLUMNS = [
  {
    title: "Saleroom",
    links: [
      { label: "Explore lots", href: "/explore" },
      { label: "Live sale", href: "/live" },
      { label: "Closing soon", href: "/explore?status=live&sort=ending" },
      { label: "Results", href: "/explore?status=sold" },
    ],
  },
  {
    title: "Selling",
    links: [
      { label: "Consign a lot", href: "/sell" },
      { label: "Seller dashboard", href: "/dashboard" },
      { label: "How bidding works", href: "/how-it-works" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Your bids", href: "/dashboard" },
      { label: "Wallet", href: "/wallet" },
      { label: "Orders", href: "/orders" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-pewter/40 bg-obsidian/40">
      <div className="mx-auto w-full max-w-7xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ash">
              A live saleroom on the web. Sealed reserves, proxy bidding and
              anti-snipe protection on objects worth staying up for.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-labelledby={`f-${col.title}`}>
              <h3
                id={`f-${col.title}`}
                className="text-[11px] font-medium uppercase tracking-[0.12em] text-gild-300/80"
              >
                {col.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-fog transition-colors hover:text-linen"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex flex-col gap-3 border-t border-pewter/30 pt-6 text-xs text-ash sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Auctioneer. A demonstration platform.</p>
          <p className="tabular">
            All balances are simulated. No real funds move through this system.
          </p>
        </div>
      </div>
    </footer>
  );
}
