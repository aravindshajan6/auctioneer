import { useEffect, useLayoutEffect } from "react";

/**
 * `useLayoutEffect` that does not warn during server rendering.
 *
 * Entrance animations must set their hidden start state before the browser
 * paints, or the visitor sees the finished hero for a frame and then watches
 * it rebuild itself. Choosing the hook at module scope keeps the server on
 * `useEffect` (where layout effects never run anyway) and the client on the
 * pre-paint one.
 */
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** True when the visitor has asked for less motion, read outside of render. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Run `start` once, the first time `el` is near the viewport.
 *
 * Entrance animations must not own an element's visibility. anime's `onScroll`
 * applies a from-value (`opacity: [0, 1]`) the moment the animation is
 * *created*, not when it plays — so a trigger that never fires leaves the
 * content permanently invisible. Building the animation inside the observer
 * instead means the worst case is no animation, never a blank section.
 *
 * Returns a teardown for the caller's effect cleanup.
 */
export function onInView(
  el: Element,
  start: () => void,
  rootMargin = "0px 0px -12% 0px",
) {
  if (typeof IntersectionObserver === "undefined") {
    // No observer: show the finished state rather than gambling on a reveal.
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      start();
    },
    { rootMargin },
  );
  io.observe(el);
  return () => io.disconnect();
}
