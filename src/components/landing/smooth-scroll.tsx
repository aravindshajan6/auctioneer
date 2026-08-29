"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

/**
 * Inertial scrolling for the landing page only.
 *
 * Lenis drives the real scroll position rather than a transformed wrapper, so
 * anime.js scroll observers, anchor links and the header's scroll listener all
 * keep working untouched. It is torn down on navigation because the app pages
 * behind the sign-in wall want native, predictable scrolling.
 */
export function SmoothScroll() {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({ lerp: 0.1, wheelMultiplier: 1, touchMultiplier: 1.6 });
    let frame = requestAnimationFrame(function raf(time: number) {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    });
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, [reduced]);

  return null;
}
