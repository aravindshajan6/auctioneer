"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { CheckCheck, Gavel, PackageCheck, Trophy, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./empty-state";
import { cn } from "@/lib/utils";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  /** Pre-formatted on the server so both renders agree on the string. */
  time: string;
  unread: boolean;
}

export interface NotificationDay {
  /** "Today", "Yesterday", or a date — computed server-side. */
  label: string;
  items: NotificationItem[];
}

/** The notification `type` strings the engine actually emits. */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  outbid: TriangleAlert,
  won: Trophy,
  sold: Trophy,
  lot_passed: Gavel,
  payment_received: Wallet,
  shipped: PackageCheck,
};

export function NotificationsPanel({
  days,
  unreadCount,
}: {
  days: NotificationDay[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [busy, setBusy] = React.useState(false);

  async function markAllRead() {
    setBusy(true);
    try {
      const response = await fetch("/api/notifications", { method: "POST" });
      if (!response.ok) throw new Error("request failed");
      // The server component owns this list, so re-render it rather than
      // guessing at the new state locally.
      startTransition(() => router.refresh());
      toast.success("All caught up.");
    } catch {
      toast.error("Could not mark those as read. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (days.length === 0) {
    return (
      <EmptyState
        title="Nothing to report"
        body="Outbid alerts, hammer results and payment confirmations land here the moment they happen."
        action={{ label: "Browse the catalogue", href: "/explore" }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-4">
        <p className="text-sm text-ash">
          {unreadCount > 0 ? (
            <>
              <span className="tabular font-medium text-linen">{unreadCount}</span> unread
            </>
          ) : (
            "Everything here has been read."
          )}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void markAllRead()}
          loading={busy || pending}
          disabled={unreadCount === 0}
        >
          <CheckCheck className="size-3.5" aria-hidden />
          Mark all read
        </Button>
      </div>

      <div className="space-y-7">
        {days.map((day) => (
          <section key={day.label}>
            <h3 className="mb-2.5 text-[10.5px] font-medium tracking-[0.14em] text-ash uppercase">
              {day.label}
            </h3>
            <ul className="space-y-1.5">
              {day.items.map((item) => {
                const Icon = ICONS[item.type] ?? Gavel;
                const inner = (
                  <div
                    className={cn(
                      "flex gap-3.5 rounded-xl border px-4 py-3.5 transition-colors",
                      item.unread
                        ? "border-gild-600/45 bg-gild-500/[0.07]"
                        : "border-pewter/35 bg-white/[0.015]",
                      item.href && "hover:border-gild-500/60",
                    )}
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        item.unread ? "text-gild-300" : "text-ash",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            item.unread ? "text-linen" : "text-fog",
                          )}
                        >
                          {item.title}
                        </p>
                        <span className="tabular shrink-0 text-[11px] text-ash">{item.time}</span>
                      </div>
                      {item.body && (
                        <p className="mt-1 text-[13px] leading-snug text-ash">{item.body}</p>
                      )}
                    </div>
                    {item.unread && (
                      <span
                        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gild-400"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link href={item.href} className="block">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
