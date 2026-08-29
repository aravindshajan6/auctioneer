import { cn, hueFrom, initials } from "@/lib/utils";

/**
 * Deterministic identity chip. Derives its colour from the name so the same
 * bidder is always the same colour across the bid feed and the live room.
 */
export function Avatar({
  name,
  size = 32,
  className,
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  const hue = hueFrom(name);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white/90 ring-1 ring-white/10",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(140deg, hsl(${hue} 45% 32%), hsl(${(hue + 48) % 360} 40% 18%))`,
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}
