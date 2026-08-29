import { z } from "zod";
import { db } from "@/lib/db";
import { credit } from "@/lib/wallet/ledger";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, handleRouteError } from "@/lib/api";

const BodySchema = z.object({
  amountCents: z.number().int().min(1_000).max(100_000_000),
});

/**
 * Simulated funding. The ledger is real double-entry bookkeeping; only the
 * funding source is fictional, so swapping in a payment provider later means
 * replacing this handler and nothing else.
 */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in first.", 401);
    const { amountCents } = BodySchema.parse(await request.json());

    const balance = await db.transaction((tx) =>
      credit(tx, session.user.id, amountCents, {
        kind: "deposit",
        memo: "Wallet top-up",
      }),
    );
    return apiOk({ ...balance });
  } catch (error) {
    return handleRouteError(error);
  }
}
