import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional classes, letting later Tailwind utilities win. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "in 2h 14m" / "3 days ago" — short, human, no dependency on locale data. */
export function relativeTime(target: Date | string, from: Date = new Date()): string {
  const t = typeof target === "string" ? new Date(target) : target;
  const diff = t.getTime() - from.getTime();
  const abs = Math.abs(diff);
  const units: Array<[label: string, ms: number]> = [
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1000],
  ];
  for (const [label, ms] of units) {
    if (abs >= ms) {
      const value = Math.floor(abs / ms);
      return diff > 0 ? `in ${value}${label}` : `${value}${label} ago`;
    }
  }
  return diff > 0 ? "in a moment" : "just now";
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Deterministic hue from a string, for avatar and category tinting. */
export function hueFrom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}
