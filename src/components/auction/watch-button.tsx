"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Follow / unfollow a lot.
 *
 * Optimistic on purpose: watching is a cheap, reversible signal and waiting a
 * round trip to fill a heart feels broken. The server's answer is authoritative
 * on the way back — the endpoint toggles, so its response also silently
 * corrects a card that rendered from a list query with no watch state.
 */
export function WatchButton({
  lotId,
  initialWatching = false,
  signedIn,
  size = "md",
  withLabel = false,
  className,
}: {
  lotId: string;
  initialWatching?: boolean;
  signedIn: boolean;
  size?: "sm" | "md";
  withLabel?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initialWatching);
  const [pending, startTransition] = useTransition();
  const [inFlight, setInFlight] = useState(false);

  async function toggle(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (!signedIn) {
      toast.info("Sign in to follow this lot", {
        description: "We will alert you before it closes.",
        action: { label: "Sign in", onClick: () => router.push("/sign-in") },
      });
      return;
    }
    if (inFlight) return;

    const next = !watching;
    setWatching(next);
    setInFlight(true);
    try {
      const response = await fetch(`/api/lots/${lotId}/watch`, { method: "POST" });
      const data = (await response.json()) as { ok: boolean; watching?: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setWatching(!next);
        toast.error(data.message ?? "Could not update your watchlist.");
        return;
      }
      setWatching(Boolean(data.watching));
      startTransition(() => router.refresh());
    } catch {
      setWatching(!next);
      toast.error("You appear to be offline. Your watchlist was not changed.");
    } finally {
      setInFlight(false);
    }
  }

  const iconSize = size === "sm" ? "size-4" : "size-[18px]";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={watching}
      aria-label={watching ? "Stop following this lot" : "Follow this lot"}
      data-pending={pending || inFlight ? "" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-pewter/60 bg-void/70 px-2.5 backdrop-blur-md",
        "text-fog transition-[color,border-color,background,transform] duration-200 ease-[var(--ease-out-expo)]",
        "hover:border-ember-500/50 hover:text-ember-300 active:scale-95",
        watching && "border-ember-500/60 text-ember-300",
        size === "sm" ? "h-8" : "h-9",
        withLabel ? "px-3.5 text-[13px]" : "aspect-square px-0 justify-center",
        className,
      )}
    >
      <Heart className={cn(iconSize, watching && "fill-current")} aria-hidden />
      {withLabel && <span>{watching ? "Following" : "Follow lot"}</span>}
    </button>
  );
}
