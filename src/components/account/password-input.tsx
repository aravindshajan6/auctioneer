"use client";

import { Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A password field you can actually check before submitting.
 *
 * Masked entry is the single largest source of failed sign-ins, and on a
 * platform where the alternative to "try again" is "lose the lot", the toggle
 * earns its place. It is a real <button> with an `aria-pressed` state rather
 * than an icon with a click handler, so it is operable and announced correctly
 * by keyboard and screen reader alike.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">
>(function PasswordInput({ className, ...props }, ref) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className={cn(
          "h-11 w-full rounded-xl border border-pewter/60 bg-obsidian/70 px-3.5 pr-11 text-sm text-linen",
          "placeholder:text-ash transition-colors duration-200",
          "hover:border-pewter focus:border-gild-500/70",
          "aria-[invalid=true]:border-ember-500/70",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-0 right-0 flex h-11 w-11 items-center justify-center rounded-r-xl text-ash transition-colors hover:text-linen"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
});
