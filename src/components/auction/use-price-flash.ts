"use client";

import { useEffect, useRef } from "react";

/**
 * Flash an element when the number inside it moves.
 *
 * Driven by class swapping rather than React state: a busy lot changes price
 * several times a second, and re-rendering the whole card to restart a
 * keyframe would be far more work than the animation itself. Forcing a reflow
 * between remove and add is what makes a repeat flash actually replay.
 */
export function usePriceFlash<T extends HTMLElement>(value: number) {
  const ref = useRef<T | null>(null);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    const el = ref.current;
    if (!el) return;
    el.classList.remove("animate-count-flash");
    void el.offsetWidth;
    el.classList.add("animate-count-flash");
  }, [value]);

  return ref;
}
