"use client";

import { formatCountdown } from "@/lib/hooks/use-countdown";
import { cn } from "@/lib/utils";
import { useServerCountdown } from "./use-server-clock";

/** A large clock for a sale that has not opened yet. */
export function SaleCountdown({
  target,
  className,
}: {
  target: string;
  className?: string;
}) {
  const countdown = useServerCountdown(target);

  return (
    <div className={cn("flex items-baseline gap-3", className)}>
      <span
        className="tabular font-display text-4xl font-semibold text-gild-200 sm:text-6xl"
        aria-live="polite"
        suppressHydrationWarning /* clock-derived: the second can tick between SSR and hydration */
      >
        {countdown.expired ? "Opening" : formatCountdown(countdown)}
      </span>
      {!countdown.expired && (
        <span className="text-[11px] uppercase tracking-[0.16em] text-ash">
          {countdown.days > 0 ? "until the sale" : "to go"}
        </span>
      )}
    </div>
  );
}
