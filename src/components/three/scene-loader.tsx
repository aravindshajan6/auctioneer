"use client";

import dynamic from "next/dynamic";
import type { HeroLot } from "./hero-scene";

/**
 * `ssr: false` is only legal inside a Client Component in Next 16, so the
 * boundary lives here and `page.tsx` stays a Server Component. Everything
 * else — WebGL detection, quality tiers, reduced motion — is decided inside
 * the scene, where there is no server render to disagree with.
 */
const HeroScene = dynamic(() => import("./hero-scene"), {
  ssr: false,
  // The hero reserves its own height, so the placeholder only has to avoid
  // painting: no flash, no layout shift.
  loading: () => null,
});

export function SceneLoader({ lots }: { lots: readonly HeroLot[] }) {
  // Nothing to turn on the rack means nothing worth spinning up a WebGL
  // context for; the hero's CSS treatment stands on its own.
  if (lots.length === 0) return null;
  return (
    <div className="absolute inset-0" aria-hidden>
      <HeroScene lots={lots} />
    </div>
  );
}

export default SceneLoader;
