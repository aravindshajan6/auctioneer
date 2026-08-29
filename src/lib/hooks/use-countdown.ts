"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Countdown {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Under a minute — the UI should switch to a per-second, urgent treatment. */
  urgent: boolean;
  /** Under ten minutes. */
  soon: boolean;
  expired: boolean;
}

/**
 * A countdown anchored to SERVER time.
 *
 * Device clocks are routinely minutes out. In an auction that is the
 * difference between "you have time to bid" and a lot that closed while the
 * page still showed 0:47. `serverNow` lets the caller feed the authoritative
 * clock from the socket; we track the offset and apply it to every tick.
 */
export function useCountdown(target: Date | string | null, serverNow?: number): Countdown {
  const offsetRef = useRef(0);
  if (serverNow) {
    // Positive when the server is ahead of this device.
    offsetRef.current = serverNow - Date.now();
  }

  const targetMs = useMemo(() => {
    if (!target) return null;
    return (typeof target === "string" ? new Date(target) : target).getTime();
  }, [target]);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (targetMs === null) return;
    // Tick every 250ms so the final seconds feel exact without burning a rAF.
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [targetMs]);

  return useMemo(() => {
    if (targetMs === null) {
      return { totalMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0, urgent: false, soon: false, expired: true };
    }
    const totalMs = Math.max(0, targetMs - (now + offsetRef.current));
    const totalSeconds = Math.floor(totalMs / 1000);
    return {
      totalMs,
      days: Math.floor(totalSeconds / 86_400),
      hours: Math.floor((totalSeconds % 86_400) / 3600),
      minutes: Math.floor((totalSeconds % 3600) / 60),
      seconds: totalSeconds % 60,
      urgent: totalMs > 0 && totalMs <= 60_000,
      soon: totalMs > 0 && totalMs <= 600_000,
      expired: totalMs <= 0,
    };
  }, [targetMs, now]);
}

/** Zero-padded mm:ss / h:mm:ss for display. */
export function formatCountdown(c: Countdown): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (c.expired) return "Closed";
  if (c.days > 0) return `${c.days}d ${pad(c.hours)}h ${pad(c.minutes)}m`;
  if (c.hours > 0) return `${c.hours}:${pad(c.minutes)}:${pad(c.seconds)}`;
  return `${pad(c.minutes)}:${pad(c.seconds)}`;
}
