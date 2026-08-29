import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A headline number. The label sits above the figure so the eye lands on the
 * number first when scanning a row of these — the label is only read once.
 */
export function StatTile({
  label,
  value,
  hint,
  href,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
  tone?: "neutral" | "gild" | "live" | "ember";
}) {
  const toneRing = {
    neutral: "border-pewter/45",
    gild: "border-gild-600/45 bg-gild-500/[0.05]",
    live: "border-signal-500/40 bg-signal-500/[0.05]",
    ember: "border-ember-500/45 bg-ember-500/[0.06]",
  }[tone];

  const toneValue = {
    neutral: "text-linen",
    gild: "text-gild-200",
    live: "text-signal-300",
    ember: "text-ember-300",
  }[tone];

  const body = (
    <>
      <p className="text-[10.5px] font-medium tracking-[0.13em] text-ash uppercase">{label}</p>
      <p className={cn("tabular mt-2 font-display text-[1.75rem] leading-none font-semibold", toneValue)}>
        {value}
      </p>
      {hint && <p className="mt-2 text-[12px] leading-snug text-ash">{hint}</p>}
    </>
  );

  const className = cn(
    "block rounded-2xl border bg-obsidian/60 px-4 py-4 backdrop-blur-xl transition-colors",
    toneRing,
    href && "hover:border-gild-500/60",
  );

  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
