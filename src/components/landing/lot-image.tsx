"use client";

import { useState } from "react";
import { cn, hueFrom } from "@/lib/utils";

/**
 * Lot artwork with a dignified failure mode.
 *
 * Catalogue images are generated assets on disk; a lot photographed after this
 * page was built, or a generator that has not run yet, must not punch a hole
 * in the rail. The fallback is a deterministic tint derived from the title, so
 * the same lot always fails to the same colour and the grid stays stable.
 */
export function LotImage({
  src,
  alt,
  seed,
  className,
}: {
  src: string | undefined;
  alt: string;
  seed: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    const hue = hueFrom(seed);
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn("bg-onyx", className)}
        style={{
          backgroundImage: `radial-gradient(120% 90% at 30% 10%, hsl(${hue} 34% 22% / 0.85), transparent 60%), linear-gradient(160deg, var(--color-slate-deep), var(--color-obsidian))`,
        }}
      />
    );
  }

  return (
    // A plain <img> on purpose: next/image adds nothing for a local generated
    // SVG, and its loader throws on a file that is not on disk yet, which is
    // exactly the case this component exists to survive.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={cn("object-cover", className)}
    />
  );
}
