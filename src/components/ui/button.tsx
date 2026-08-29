"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium " +
    "transition-[transform,background,box-shadow,border-color] duration-200 ease-[var(--ease-out-expo)] " +
    "disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] select-none",
  {
    variants: {
      variant: {
        /* The house action: bidding, buying, committing money. */
        gild:
          "bg-linear-to-b from-gild-300 to-gild-500 text-obsidian shadow-[0_1px_0_0_rgba(255,255,255,0.35)_inset,0_8px_24px_-8px_rgba(217,171,62,0.6)] " +
          "hover:from-gild-200 hover:to-gild-400 hover:shadow-[0_1px_0_0_rgba(255,255,255,0.45)_inset,0_12px_32px_-8px_rgba(217,171,62,0.75)]",
        solid: "bg-linen text-obsidian hover:bg-parchment",
        outline:
          "border border-pewter/70 bg-white/[0.02] text-linen hover:border-gild-500/70 hover:bg-gild-500/[0.06]",
        ghost: "text-fog hover:bg-white/[0.05] hover:text-linen",
        danger: "bg-ember-500/90 text-white hover:bg-ember-500",
        live:
          "bg-signal-500/15 text-signal-300 border border-signal-500/40 hover:bg-signal-500/25",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        md: "h-10 px-5 text-sm",
        lg: "h-12 px-7 text-[15px]",
        xl: "h-14 px-9 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export { button as buttonVariants };
