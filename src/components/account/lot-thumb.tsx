import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Lot artwork at list size.
 *
 * A plain <img> rather than next/image: sell-flow previews point at addresses
 * the seller just typed, which are by definition outside `remotePatterns`, and
 * an optimiser that 400s on half the previews is worse than an unoptimised
 * 96px thumbnail. Centralised here so the trade-off is made once.
 */
export function LotThumb({
  src,
  alt,
  className,
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const base = "shrink-0 overflow-hidden rounded-lg bg-slate-deep ring-1 ring-pewter/40";
  if (!src) {
    return (
      <div className={cn(base, "flex items-center justify-center", className)} aria-hidden>
        <ImageOff className="size-4 text-ash" />
      </div>
    );
  }
  return (
    <div className={cn(base, className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
    </div>
  );
}
