"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, Gavel } from "lucide-react";
import {
  createScope,
  createTimeline,
  stagger,
  utils,
  type Scope,
} from "animejs";
import { buttonVariants } from "@/components/ui/button";
import { LiveBadge } from "@/components/ui/badge";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { formatCents } from "@/lib/auction/money";
import { SceneLoader } from "@/components/three/scene-loader";
import { subscribeStage, type HeroStage } from "@/components/three/stage";
import type { HeroLot } from "@/components/three/hero-scene";
import { useIsomorphicLayoutEffect, prefersReducedMotion } from "./anim";

/** How long the DOM will wait for WebGL before it animates in without it. */
/**
 * How long the words will wait for the canvas.
 *
 * Long enough for the catalogue plates to decode on a local connection, so the
 * rack and the sentence arrive together; short enough that a visitor without
 * WebGL is not left looking at an empty hero. Past this the copy plays alone
 * and the scene reveals itself.
 */
const STAGE_DEADLINE_MS = 1100;

const MARKS = [
  "Sealed reserves",
  "Proxy bidding to your ceiling",
  "Two-minute soft close",
] as const;

export function Hero({
  liveLots,
  bidsPlaced,
  totalHammerCents,
  lots,
}: {
  liveLots: number;
  bidsPlaced: number;
  totalHammerCents: number;
  /** Catalogue plates to turn on the rack behind the headline. */
  lots: readonly HeroLot[];
}) {
  const root = useRef<HTMLElement>(null);
  const scope = useRef<Scope | null>(null);
  const reduced = useReducedMotion();

  /* The pre-entrance pose is set before paint so the hero never shows its
     finished state and then rewinds. Nothing here runs on the server, so the
     markup that ships is fully visible if JavaScript never arrives. */
  useIsomorphicLayoutEffect(() => {
    if (!root.current || prefersReducedMotion()) return;
    scope.current = createScope({ root }).add(() => {
      utils.set("[data-word]", { opacity: 0, y: "145%" });
      utils.set(
        "[data-hero-eyebrow], [data-hero-sub], [data-hero-cta] > *, [data-hero-marks] > *",
        { opacity: 0, y: 16 },
      );
      utils.set("[data-hero-cue]", { opacity: 0 });
    });
    return () => {
      scope.current?.revert();
      scope.current = null;
    };
  }, []);

  /* The entrance itself. One timeline drives the carousel, the gold dust, the
     backdrop shader and the words, so the lots and the sentence arrive as a
     single gesture instead of three that happen to overlap. */
  useEffect(() => {
    if (reduced || !scope.current) return;

    let started = false;
    const play = (stage: HeroStage | null) => {
      if (started || prefersReducedMotion()) return;
      started = true;

      scope.current?.add(() => {
        const tl = createTimeline({
          defaults: { ease: "out(3)", duration: 900 },
          onComplete: () => stage?.startIdle(),
        });

        if (stage) {
          tl.add(
            stage.reveal,
            { value: [0, 1], duration: 1500, ease: "out(2)" },
            0,
          )
            // The rack swings into place while the lots arrive on it one at a
            // time — a rostrum being loaded, not a slideshow starting.
            .add(
              stage.carousel,
              { rotateY: [-38, 0], duration: 2200, ease: "out(4)" },
              0,
            )
            .add(
              stage.frames,
              {
                scale: [0, 1],
                duration: 950,
                ease: "out(4)",
                delay: stagger(85),
              },
              200,
            )
            .add(
              stage.dust,
              {
                scale: [0, 1],
                duration: 900,
                delay: stagger(5, { from: "center" }),
              },
              320,
            );
        }

        tl.add(
          "[data-hero-eyebrow]",
          { opacity: [0, 1], y: [16, 0], duration: 700 },
          260,
        )
          .add(
            "[data-word]",
            {
              opacity: [0, 1],
              y: ["145%", "0%"],
              duration: 1150,
              delay: stagger(70),
            },
            "<<+=120",
          )
          .add("[data-hero-sub]", { opacity: [0, 1], y: [16, 0] }, "<-=620")
          .add(
            "[data-hero-cta] > *",
            {
              opacity: [0, 1],
              y: [16, 0],
              scale: [0.96, 1],
              delay: stagger(90),
            },
            "<-=680",
          )
          .add(
            "[data-hero-marks] > *",
            { opacity: [0, 1], y: [16, 0], duration: 620, delay: stagger(80) },
            "<-=520",
          )
          .add("[data-hero-cue]", { opacity: [0, 1], duration: 700 }, "<-=300");

        // The cue keeps breathing after the timeline is done with it.
        tl.then(() => {
          scope.current?.add(() => {
            utils.set("[data-hero-cue-dot]", { y: 0 });
            createTimeline({ loop: true }).add("[data-hero-cue-dot]", {
              y: [0, 20],
              opacity: [1, 0],
              duration: 1500,
              ease: "inOut(2)",
            });
          });
        });
      });
    };

    const unsubscribe = subscribeStage(play);
    // WebGL may be slow, throttled, or simply absent. The words are the
    // product; they do not get to be held hostage by a canvas.
    const deadline = window.setTimeout(() => play(null), STAGE_DEADLINE_MS);

    return () => {
      unsubscribe();
      window.clearTimeout(deadline);
    };
  }, [reduced]);

  const hammer =
    totalHammerCents > 0
      ? formatCents(totalHammerCents, { compact: true, showCents: false })
      : null;

  return (
    <section
      ref={root}
      id="hero"
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden"
    >
      <div className="absolute inset-0 -z-20" aria-hidden>
        <SceneLoader lots={lots} />
      </div>

      {/* Two scrims: one that pools under the copy so the headline holds its
          contrast over the gem, one that dissolves the canvas into the page. */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(75%_60%_at_18%_45%,color-mix(in_oklab,var(--color-void)_82%,transparent),transparent_70%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-72 bg-linear-to-b from-transparent via-void/70 to-void"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-5 pt-28 pb-36 sm:px-8 sm:pt-36 sm:pb-28">
        <div className="max-w-3xl">
          <div
            data-hero-eyebrow
            className="flex flex-wrap items-center gap-x-3 gap-y-2"
          >
            <LiveBadge label="Saleroom open" />
            <p className="text-[13px] text-fog tabular">
              {liveLots > 0
                ? `${liveLots} ${liveLots === 1 ? "lot" : "lots"} on the block right now`
                : "The next sale is being catalogued"}
            </p>
          </div>

          <h1
            id="hero-title"
            className="mt-7 font-display text-[clamp(2.75rem,10.5vw,6.75rem)] font-semibold leading-[0.94] tracking-[-0.035em] text-linen"
          >
            {/* Each LINE is the mask, not each word: a per-word clip box would
                have to be as tall as the glyphs, which at this leading means
                shaving the descenders off "staying". The padding opens the
                clip box and the matching negative margin gives the space back,
                so the mask is invisible but the ascenders and tails are not. */}
            <span className="-mt-[0.14em] -mb-[0.26em] block overflow-hidden pt-[0.14em] pb-[0.26em]">
              {["Objects", "worth"].map((word) => (
                <span
                  key={word}
                  data-word
                  className="mr-[0.22em] inline-block will-change-transform"
                >
                  {word}
                </span>
              ))}
            </span>
            <span className="-mt-[0.14em] -mb-[0.26em] block overflow-hidden pt-[0.14em] pb-[0.26em]">
              <span
                data-word
                className="gild-text inline-block will-change-transform"
              >
                staying up for.
              </span>
            </span>
          </h1>

          <p
            data-hero-sub
            className="mt-7 max-w-xl text-[16px] leading-relaxed text-fog text-pretty sm:text-[17px]"
          >
            A live saleroom that runs after midnight. Leave a ceiling and the
            house bids for you, one increment at a time. Reserves stay sealed
            until they are met, and a late bid pushes the clock out instead of
            stealing the lot.
          </p>

          {/* Links wearing the button styles rather than buttons wrapped in
              links: nesting the two gives a keyboard user two stops for one
              destination, and the inner control announces as a button that
              does nothing. */}
          <div data-hero-cta className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/explore"
              className={buttonVariants({ variant: "gild", size: "lg" })}
            >
              <Gavel className="size-4" aria-hidden />
              Enter the saleroom
            </Link>
            <Link
              href="/sell"
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              Consign a lot
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>

          <ul
            data-hero-marks
            className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ash"
          >
            {MARKS.map((mark) => (
              <li key={mark} className="flex items-center gap-2">
                <span className="size-1 rounded-full bg-gild-500" aria-hidden />
                {mark}
              </li>
            ))}
            {hammer && (
              <li className="flex items-center gap-2 tabular">
                <span className="size-1 rounded-full bg-gild-500" aria-hidden />
                {hammer} hammered across {bidsPlaced.toLocaleString("en-US")}{" "}
                bids
              </li>
            )}
          </ul>
        </div>
      </div>

      <div
        data-hero-cue
        className="pointer-events-none absolute inset-x-0 bottom-7 flex flex-col items-center gap-2.5"
        aria-hidden
      >
        <span className="text-[10px] font-medium uppercase tracking-[0.32em] text-ash">
          The catalogue
        </span>
        <span className="relative block h-8 w-px overflow-hidden bg-pewter/50">
          <span
            data-hero-cue-dot
            className="absolute inset-x-0 top-0 block h-3 bg-gild-400"
          />
        </span>
      </div>
    </section>
  );
}
