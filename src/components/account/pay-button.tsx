"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { AlertCircle, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/auction/money";

interface PayResponse {
  ok: boolean;
  message?: string;
  orderId?: string;
}

/**
 * Settle a won lot from the wallet.
 *
 * The only failure a buyer can actually act on is "not enough money", so that
 * one gets a route out of it rather than a red sentence.
 */
export function PayButton({
  orderId,
  totalCents,
  availableCents,
}: {
  orderId: string;
  totalCents: number;
  availableCents: number;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shortfall, setShortfall] = React.useState(false);

  const shortBy = totalCents - availableCents;

  async function pay() {
    setError(null);
    setShortfall(false);
    setPending(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/pay`, { method: "POST" });
      const payload = (await response.json()) as PayResponse;
      if (!response.ok || !payload.ok) {
        const message = payload.message ?? "The payment did not go through.";
        setError(message);
        setShortfall(/insufficient/i.test(message));
        return;
      }
      toast.success("Paid.", { description: "The seller has been notified to ship." });
      router.refresh();
    } catch {
      setError("We could not reach the settlement service. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        variant="gild"
        size="lg"
        className="w-full"
        loading={pending}
        onClick={() => void pay()}
      >
        <CreditCard className="size-4" aria-hidden />
        Pay {formatCents(totalCents)}
      </Button>

      <p className="tabular mt-2 text-center text-[12px] text-ash">
        {formatCents(availableCents)} available in your wallet
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-ember-500/45 bg-ember-500/10 px-3.5 py-3 text-[13px] text-ember-300"
        >
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-px size-4 shrink-0" aria-hidden />
            {error}
          </p>
          {shortfall && (
            <Link
              href="/wallet"
              className="mt-2.5 inline-flex h-9 items-center rounded-full border border-ember-400/50 bg-ember-500/15 px-4 text-[13px] font-medium text-ember-300 transition-colors hover:bg-ember-500/25"
            >
              Add {formatCents(Math.max(shortBy, 0))} to your wallet
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
