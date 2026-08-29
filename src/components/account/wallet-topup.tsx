"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/field";
import { formatCents, parseToCents } from "@/lib/auction/money";
import { cn } from "@/lib/utils";

/** Mirrors the bounds enforced by /api/wallet/topup. */
const MIN_TOPUP_CENTS = 1_000;
const MAX_TOPUP_CENTS = 100_000_000;

const PRESETS = [25_000, 100_000, 500_000, 2_500_000];

interface TopUpResponse {
  ok: boolean;
  message?: string;
  availableCents?: number;
}

export function WalletTopUp() {
  const router = useRouter();
  const [custom, setCustom] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<number | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  async function topUp(amountCents: number) {
    setError(null);
    setPending(amountCents);
    try {
      const response = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents }),
      });
      const payload = (await response.json()) as TopUpResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.message ?? "That top-up did not go through.");
        return;
      }
      setCustom("");
      toast.success(`${formatCents(amountCents)} added.`, {
        description: "Simulated funds — no card was charged.",
      });
      // The balances and the statement are server-rendered; re-fetch them
      // rather than patching a second copy of the truth into client state.
      router.refresh();
    } catch {
      setError("We could not reach the wallet service. Try again.");
    } finally {
      setPending(null);
    }
  }

  function submitCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseToCents(custom);
    if (cents === null || cents < MIN_TOPUP_CENTS) {
      setError(`Top up at least ${formatCents(MIN_TOPUP_CENTS)}.`);
      inputRef.current?.focus();
      return;
    }
    if (cents > MAX_TOPUP_CENTS) {
      setError(`The most we will add at once is ${formatCents(MAX_TOPUP_CENTS)}.`);
      inputRef.current?.focus();
      return;
    }
    void topUp(cents);
  }

  return (
    <div>
      <h3 className="text-[11px] font-medium tracking-[0.12em] text-ash uppercase">
        Add funds
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map((amount) => (
          <Button
            key={amount}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void topUp(amount)}
            loading={pending === amount}
            disabled={pending !== null && pending !== amount}
            className="tabular"
          >
            <Plus className="size-3.5" aria-hidden />
            {formatCents(amount, { compact: true })}
          </Button>
        ))}
      </div>

      <form onSubmit={submitCustom} noValidate className="mt-4 max-w-xs">
        <Label htmlFor="topup-custom">Another amount</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span
              className="pointer-events-none absolute top-0 left-3.5 flex h-11 items-center text-sm text-ash"
              aria-hidden
            >
              $
            </span>
            <Input
              id="topup-custom"
              ref={inputRef}
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setError(null);
              }}
              placeholder="1,000"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "topup-error" : undefined}
              className={cn("tabular pl-7", error && "border-ember-500/70")}
            />
          </div>
          <Button type="submit" variant="gild" loading={pending !== null && !PRESETS.includes(pending)}>
            Add
          </Button>
        </div>
        <span id="topup-error">
          <FieldError>{error}</FieldError>
        </span>
      </form>
    </div>
  );
}
