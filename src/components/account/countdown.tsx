"use client";

import { formatCountdown, useCountdown } from "@/lib/hooks/use-countdown";
import { cn } from "@/lib/utils";

/**
 * A ticking time-to-close.
 *
 * `suppressHydrationWarning` is deliberate: the server renders the remaining
 * time as of the response, the client re-renders it as of paint, and those are
 * legitimately different numbers. Suppressing here is honest; freezing the
 * clock to avoid the warning would not be.
 */
export function Countdown({
  endsAt,
  className,
  prefix,
}: {
  endsAt: string;
  className?: string;
  prefix?: string;
}) {
  const c = useCountdown(endsAt);
  return (
    <span
      suppressHydrationWarning
      className={cn(
        "tabular text-[13px] font-medium",
        c.expired ? "text-ash" : c.urgent ? "text-ember-300" : c.soon ? "text-ember-400/90" : "text-fog",
        className,
      )}
    >
      {prefix && !c.expired ? `${prefix} ` : ""}
      {formatCountdown(c)}
    </span>
  );
}
