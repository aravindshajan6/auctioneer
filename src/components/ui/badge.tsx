import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badge = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.09em]",
  {
    variants: {
      tone: {
        neutral: "border-pewter/60 bg-white/[0.03] text-fog",
        live: "border-signal-500/45 bg-signal-500/12 text-signal-300",
        ending: "border-ember-500/45 bg-ember-500/12 text-ember-300",
        gild: "border-gild-500/45 bg-gild-500/12 text-gild-200",
        sold: "border-amethyst-500/45 bg-amethyst-500/12 text-amethyst-300",
        muted: "border-transparent bg-white/[0.04] text-ash",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}

/** A live badge with a breathing dot — the one place the signal colour moves. */
export function LiveBadge({ label = "Live", className }: { label?: string; className?: string }) {
  return (
    <Badge tone="live" className={className}>
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-[pulse-ring_2s_var(--ease-out-expo)_infinite] rounded-full bg-signal-400" />
        <span className="relative inline-flex size-1.5 rounded-full bg-signal-400" />
      </span>
      {label}
    </Badge>
  );
}
