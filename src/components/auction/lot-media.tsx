"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { accentGradient } from "./format";

/**
 * Lot artwork with a guaranteed floor.
 *
 * Catalogue images are produced asynchronously and a lot can go live before
 * its plate exists. A missing file must never collapse the grid, so the tinted
 * ground is always painted and the image sits on top of it — if the file
 * 404s we simply stop drawing the image and the ground stands in for it.
 *
 * Deliberately a plain <img> rather than next/image: these are SVG plates the
 * optimiser refuses to touch, and we need the `onError` fallback.
 */
export function LotMedia({
  src,
  alt,
  accent,
  className,
  imgClassName,
  loading = "lazy",
  sizes,
}: {
  src: string | null | undefined;
  alt: string;
  accent?: string | null;
  className?: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return (
    <div
      className={cn("relative overflow-hidden bg-obsidian", className)}
      style={{ backgroundImage: accentGradient(accent) }}
    >
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={alt}
          sizes={sizes}
          loading={loading}
          decoding="async"
          onError={() => setFailed(true)}
          className={cn("size-full object-cover", imgClassName)}
        />
      )}
    </div>
  );
}
