"use client";

import { useRef } from "react";
import { animate, createScope, stagger, utils, type Scope } from "animejs";
import {
  useIsomorphicLayoutEffect,
  onInView,
  prefersReducedMotion,
} from "./anim";
import { createDrawable } from "animejs/svg";

interface Step {
  index: string;
  title: string;
  body: string;
  /** Line art drawn on scroll. Every path is stroked, never filled. */
  paths: string[];
  caption: string;
}

/**
 * The mechanics, told honestly.
 *
 * These four are the actual behaviour of the bid engine — the increment
 * ladder, the sealed reserve, the 120-second soft close and the wallet hold —
 * not a marketing paraphrase of them. If the copy and the engine ever
 * disagree, the copy is the bug.
 */
const STEPS: Step[] = [
  {
    index: "01",
    title: "Leave a ceiling, not a bid",
    body: "Tell the house the most you would pay. It bids for you in the smallest legal increment and stops the moment someone passes you. Your ceiling is never shown — not to the seller, not to the room.",
    caption: "Proxy bidding",
    paths: ["M10 16 H110", "M10 62 H30 V52 H50 V43 H72 V34 H94 V27"],
  },
  {
    index: "02",
    title: "The reserve stays sealed",
    body: "A seller's floor is a number, not a signal. You are told whether the reserve has been met and nothing more, so nobody can map it out by probing with small bids.",
    caption: "Sealed reserve",
    paths: [
      "M16 18 H88 L104 38 L88 58 H16 Z",
      "M16 18 L52 42 L88 18",
      "M88 32 a6 6 0 1 1 -0.01 0",
    ],
  },
  {
    index: "03",
    title: "The clock will not reward a snipe",
    body: "A bid inside the final two minutes pushes the close out by two more. The lot ends when the bidding ends, not when the fastest connection fires at 0.4 seconds — and overtime is capped so it cannot run forever.",
    caption: "Anti-snipe soft close",
    paths: [
      "M52 38 m-22 0 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0",
      "M52 24 V38 H63",
      "M80 20 A28 28 0 0 1 92 44",
      "M85 39 L92 45 L98 40",
    ],
  },
  {
    index: "04",
    title: "Every bid on the board is funded",
    body: "Bidding places a hold on your wallet, so the price you are chasing is real money. When the hammer falls the hold is captured, the buyer's premium is applied, and every losing deposit is released in the same transaction.",
    caption: "Escrowed settlement",
    paths: [
      "M10 24 H46 V52 H10 Z",
      "M74 24 H110 V52 H74 Z",
      "M50 38 H68",
      "M62 33 L68 38 L62 43",
      "M56 30 a4 4 0 0 1 8 0 V34 H56 Z",
    ],
  },
];

export function HowItWorks() {
  const root = useRef<HTMLOListElement>(null);
  const scope = useRef<Scope | null>(null);

  useIsomorphicLayoutEffect(() => {
    const container = root.current;
    if (!container || prefersReducedMotion()) return;

    // The animation is CONSTRUCTED inside the observer, not merely played
    // there: `opacity: [0, 1]` applies its from-value at creation time, so
    // building it up front would hide the section whether or not the reveal
    // ever runs. The markup ships fully drawn and visible.
    const stop = onInView(container, () => {
      scope.current = createScope({ root }).add(() => {
        const strokes = createDrawable(".hiw-line");
        utils.set("[data-step]", { opacity: 0, y: 26 });
        utils.set(strokes, { draw: "0 0" });

        animate("[data-step]", {
          opacity: [0, 1],
          y: [26, 0],
          duration: 800,
          ease: "out(3)",
          delay: stagger(110),
        });

        animate(strokes, {
          draw: ["0 0", "0 1"],
          duration: 900,
          ease: "inOut(2)",
          delay: stagger(70, { start: 260 }),
        });
      });
    });

    return () => {
      stop();
      scope.current?.revert();
      scope.current = null;
    };
  }, []);

  return (
    <ol
      ref={root}
      className="grid gap-px overflow-hidden rounded-2xl border border-pewter/40 bg-pewter/25 sm:grid-cols-2 xl:grid-cols-4"
    >
      {STEPS.map((step) => (
        <li
          key={step.index}
          data-step
          className="group flex flex-col bg-obsidian/85 p-6 transition-colors duration-500 hover:bg-onyx/90 sm:p-7"
        >
          <div className="flex items-center justify-between">
            <span className="tabular font-display text-sm font-semibold text-gild-400">
              {step.index}
            </span>
            <span className="text-[10.5px] font-medium uppercase tracking-[0.16em] text-ash">
              {step.caption}
            </span>
          </div>

          <svg
            viewBox="0 0 120 72"
            className="mt-6 h-[72px] w-full text-gild-400/80"
            fill="none"
            aria-hidden
          >
            {step.paths.map((d) => (
              <path
                key={d}
                d={d}
                className="hiw-line"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>

          <h3 className="mt-6 font-display text-lg leading-snug font-semibold text-linen text-balance">
            {step.title}
          </h3>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-fog text-pretty">
            {step.body}
          </p>
        </li>
      ))}
    </ol>
  );
}
