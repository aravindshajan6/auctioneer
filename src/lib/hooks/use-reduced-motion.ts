"use client";

import { useEffect, useState } from "react";

/**
 * Whether the visitor has asked for less motion.
 *
 * Initialised to `false` rather than reading `matchMedia` during render: the
 * server cannot know the answer, so reading it eagerly guarantees a hydration
 * mismatch. The real value lands on the first effect.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return reduced;
}
