import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Every section on this page opens the same way: a gilded eyebrow, a serif
 * line, and at most one sentence of explanation. The repetition is what makes
 * a long page read as one catalogue rather than a stack of adverts.
 */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  action,
  className,
  align = "start",
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: string;
  action?: { label: string; href: string };
  className?: string;
  align?: "start" | "center";
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between",
        align === "center" && "sm:flex-col sm:items-center sm:text-center",
        className,
      )}
    >
      <div className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-gild-300/85">
          {eyebrow}
        </p>
        <h2 className="mt-3 font-display text-3xl leading-[1.08] tracking-[-0.02em] text-linen text-balance sm:text-4xl lg:text-[2.75rem]">
          {title}
        </h2>
        {lead && <p className="mt-4 text-[15px] leading-relaxed text-fog text-pretty">{lead}</p>}
      </div>

      {action && (
        <Link
          href={action.href}
          className="group inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-pewter/60 px-4 py-2 text-sm text-fog transition-colors hover:border-gild-500/60 hover:text-linen sm:self-auto"
        >
          {action.label}
          <ArrowUpRight
            className="size-4 transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      )}
    </div>
  );
}

/** A full-bleed gilded rule. Used to separate acts, never as decoration. */
export function Hairline({ className }: { className?: string }) {
  return <div className={cn("hairline h-px w-full", className)} aria-hidden />;
}
