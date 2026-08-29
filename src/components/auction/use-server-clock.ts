"use client";

import { useMemo } from "react";
import { useCountdown, type Countdown } from "@/lib/hooks/use-countdown";
import { useRealtimeStore } from "@/lib/realtime/store";

/**
 * A countdown anchored to the rostrum's clock, not the device's.
 *
 * Rather than feeding `useCountdown` a "server now" — which would mean reading
 * the wall clock during render — we shift the *target* by the gateway's offset.
 * The arithmetic is identical (target - (now + offset) === (target - offset) -
 * now) and the hook stays pure, so React is free to re-render it whenever it
 * likes without the timer jumping.
 */
export function useServerCountdown(target: Date | string | null): Countdown {
  const offset = useRealtimeStore((s) => s.serverTimeOffset);

  const anchored = useMemo(() => {
    if (!target) return null;
    const ms = (typeof target === "string" ? new Date(target) : target).getTime();
    if (!Number.isFinite(ms)) return null;
    return offset === 0 ? new Date(ms) : new Date(ms - offset);
  }, [target, offset]);

  return useCountdown(anchored);
}
