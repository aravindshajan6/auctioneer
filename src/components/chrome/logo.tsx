import { cn } from "@/lib/utils";

/**
 * The house mark: a gavel head reduced to two strokes over a rostrum line.
 * Drawn rather than imported so it inherits currentColor and scales cleanly.
 */
export function Logo({ className, showWordmark = true }: { className?: string; showWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden fill="none">
        <defs>
          <linearGradient id="logo-gild" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-gild-200)" />
            <stop offset="55%" stopColor="var(--color-gild-400)" />
            <stop offset="100%" stopColor="var(--color-gild-600)" />
          </linearGradient>
        </defs>
        <rect
          x="4.5" y="6.5" width="13" height="7" rx="2"
          transform="rotate(-38 11 10)"
          stroke="url(#logo-gild)" strokeWidth="2"
        />
        <path d="M14 13.5 L23.5 23" stroke="url(#logo-gild)" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M7 27.5 H25" stroke="url(#logo-gild)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
      {showWordmark && (
        <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-linen">
          Auctioneer
        </span>
      )}
    </span>
  );
}
