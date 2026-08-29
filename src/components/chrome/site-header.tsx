"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell, Gavel, LogOut, Menu, Search, Wallet, X } from "lucide-react";
import { authClient, useSession } from "@/lib/auth/client";
import { useRealtimeStore } from "@/lib/realtime/store";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

const NAV = [
  { label: "Explore", href: "/explore" },
  { label: "Live sale", href: "/live" },
  { label: "Sell", href: "/sell" },
];

export function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const connected = useRealtimeStore((s) => s.connected);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet on navigation, or it hangs over the new page.
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "z-50 w-full transition-[background,border-color,box-shadow,backdrop-filter] duration-300",
        overlay ? "fixed top-0 left-0" : "sticky top-0",
        // The bar needs a ground LIGHTER than the page. `void` is the body
        // colour, so a `bg-void` header is invisible — the links appear to
        // float on the page with no rostrum under them. `onyx` sits a step up
        // and reads as its own plane, with a gilded hairline to close it off.
        scrolled || !overlay
          ? "border-b border-gild-500/25 bg-onyx/95 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.95)] backdrop-blur-xl"
          // Over the hero, a scrim rather than a hard edge — but built from
          // `onyx`, not `void`. A scrim in the page's own colour is invisible
          // by definition; a lighter one still reads as a bar while fading
          // out instead of cutting a line across the artwork.
          : "border-b border-gild-500/15 bg-linear-to-b from-onyx/95 via-onyx/70 to-transparent backdrop-blur-md",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-5 sm:px-8">
        <Link href="/" className="shrink-0" aria-label="Auctioneer home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative rounded-full px-3.5 py-2 text-sm transition-colors",
                  active ? "text-linen" : "text-fog/90 hover:text-linen",
                )}
              >
                {item.label}
                {active && (
                  <span className="absolute inset-x-3.5 -bottom-px h-px hairline" aria-hidden />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/explore"
            className="hidden h-9 items-center gap-2 rounded-full border border-pewter/60 px-3.5 text-sm text-ash transition-colors hover:border-gild-500/50 hover:text-linen sm:flex"
          >
            <Search className="size-3.5" aria-hidden />
            <span>Search lots</span>
          </Link>

          {/* Connection state is load-bearing here: a bidder needs to know if
              the prices they are looking at are still arriving. */}
          <span
            className="hidden items-center gap-1.5 rounded-full border border-pewter/50 px-2.5 py-1 text-[11px] text-ash lg:flex"
            title={connected ? "Live prices connected" : "Reconnecting to the saleroom"}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "bg-signal-400" : "animate-pulse bg-ember-400",
              )}
            />
            {connected ? "Live" : "Offline"}
          </span>

          {isPending ? (
            <div className="size-9 animate-pulse rounded-full bg-slate-deep" />
          ) : session?.user ? (
            <>
              <Link
                href="/wallet"
                className="hidden size-9 items-center justify-center rounded-full text-fog transition-colors hover:bg-white/5 hover:text-linen sm:flex"
                aria-label="Wallet"
              >
                <Wallet className="size-[18px]" />
              </Link>
              <Link
                href="/dashboard"
                className="relative flex size-9 items-center justify-center rounded-full text-fog transition-colors hover:bg-white/5 hover:text-linen"
                aria-label="Notifications"
              >
                <Bell className="size-[18px]" />
              </Link>
              <Link href="/dashboard" aria-label="Your dashboard">
                <Avatar name={session.user.name} size={34} />
              </Link>
              <button
                onClick={() => authClient.signOut().then(() => window.location.assign("/"))}
                className="hidden size-9 items-center justify-center rounded-full text-ash transition-colors hover:bg-white/5 hover:text-ember-300 md:flex"
                aria-label="Sign out"
              >
                <LogOut className="size-[17px]" />
              </button>
            </>
          ) : (
            <>
              <Link href="/sign-in">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/sign-up" className="hidden sm:block">
                <Button variant="gild" size="sm">
                  <Gavel className="size-3.5" aria-hidden />
                  Start bidding
                </Button>
              </Link>
            </>
          )}

          <button
            className="flex size-9 items-center justify-center rounded-full text-fog md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="border-t border-pewter/40 bg-void/95 px-5 py-4 backdrop-blur-xl md:hidden">
          <ul className="space-y-1">
            {[...NAV, { label: "Wallet", href: "/wallet" }, { label: "Dashboard", href: "/dashboard" }].map(
              (item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="block rounded-lg px-3 py-2.5 text-sm text-fog transition-colors hover:bg-white/5 hover:text-linen"
                  >
                    {item.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
      )}
    </header>
  );
}
