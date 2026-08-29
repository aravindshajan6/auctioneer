"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TabSpec {
  id: string;
  label: string;
  count?: number;
  panel: React.ReactNode;
}

/**
 * A real ARIA tablist: arrow keys move between tabs, Home/End jump to the
 * ends, and only the selected tab is a tab stop, so a keyboard user tabs past
 * the whole strip in one press instead of five.
 *
 * Every panel is rendered and the inactive ones hidden, because the panels are
 * server-rendered content handed down as props — re-mounting them on switch
 * would throw away work already paid for.
 */
export function Tabs({ tabs, initial }: { tabs: TabSpec[]; initial?: string }) {
  const [active, setActive] = React.useState(() => initial ?? tabs[0]?.id ?? "");
  const refs = React.useRef(new Map<string, HTMLButtonElement | null>());

  const focusTab = (id: string) => {
    setActive(id);
    refs.current.get(id)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === active);
    if (index < 0) return;
    const last = tabs.length - 1;
    const move = { ArrowRight: 1, ArrowLeft: -1 } as const;
    if (event.key in move) {
      event.preventDefault();
      const delta = move[event.key as keyof typeof move];
      focusTab(tabs[(index + delta + tabs.length) % tabs.length]!.id);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusTab(tabs[0]!.id);
    } else if (event.key === "End") {
      event.preventDefault();
      focusTab(tabs[last]!.id);
    }
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label="Dashboard sections"
        onKeyDown={onKeyDown}
        className="-mx-5 flex gap-1 overflow-x-auto border-b border-pewter/40 px-5 sm:mx-0 sm:px-0"
      >
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                refs.current.set(tab.id, node);
              }}
              id={`tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={cn(
                "relative shrink-0 px-3.5 py-3 text-sm whitespace-nowrap transition-colors",
                selected ? "text-linen" : "text-ash hover:text-fog",
              )}
            >
              {tab.label}
              {tab.count !== undefined && (
                <span
                  className={cn(
                    "tabular ml-2 rounded-full px-1.5 py-0.5 text-[11px]",
                    selected ? "bg-gild-500/15 text-gild-200" : "bg-white/[0.05] text-ash",
                  )}
                >
                  {tab.count}
                </span>
              )}
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-linear-to-r from-gild-500/0 via-gild-400 to-gild-500/0"
                />
              )}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          tabIndex={0}
          hidden={tab.id !== active}
          className="pt-6 focus-visible:outline-none"
        >
          {tab.panel}
        </div>
      ))}
    </div>
  );
}
