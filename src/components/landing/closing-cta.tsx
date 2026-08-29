"use client";

import Link from "next/link";
import { ArrowRight, Gavel } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function ClosingCta({ liveLots }: { liveLots: number }) {
  return (
    <section
      aria-labelledby="cta-title"
      className="relative overflow-hidden rounded-3xl border border-gild-700/45 bg-obsidian/80 px-6 py-14 text-center sm:px-12 sm:py-20"
    >
      {/* One warm source, top centre — the same picture light as the hero, so
          the page closes where it opened. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_75%_at_50%_-10%,color-mix(in_oklab,var(--color-gild-600)_28%,transparent),transparent_70%)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-10 top-0 h-px hairline" aria-hidden />

      <div className="relative mx-auto max-w-2xl">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-gild-300/85">
          Register to bid
        </p>
        <h2
          id="cta-title"
          className="mt-4 font-display text-3xl leading-[1.06] tracking-[-0.02em] text-linen text-balance sm:text-[2.75rem]"
        >
          The next lot closes whether{" "}
          <span className="gild-text animate-shimmer">you are watching or not.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-fog text-pretty">
          A paddle takes a minute. Leave your ceiling, and the house will hold your
          place in the room{liveLots > 0 ? ` on any of the ${liveLots} lots open tonight` : ""} —
          through every increment, every extension, and the fall of the hammer.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/sign-up" className={buttonVariants({ variant: "gild", size: "xl" })}>
            <Gavel className="size-4" aria-hidden />
            Claim your paddle
          </Link>
          <Link href="/explore" className={buttonVariants({ variant: "outline", size: "xl" })}>
            Browse the catalogue
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <p className="mt-6 text-[12.5px] text-ash">
          Free to register. Bidding places a hold on your wallet — never a charge
          until the hammer falls.
        </p>
      </div>
    </section>
  );
}
