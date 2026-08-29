import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * An empty list should still tell you what would fill it and how to start.
 * "Nothing here" is a dead end; a route out of it is not.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-pewter/50 px-6 py-12 text-center",
        className,
      )}
    >
      <h3 className="font-display text-lg font-semibold text-linen">{title}</h3>
      <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-relaxed text-ash">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex h-10 items-center rounded-full border border-gild-600/60 bg-gild-500/10 px-5 text-sm text-gild-200 transition-colors hover:bg-gild-500/20"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
