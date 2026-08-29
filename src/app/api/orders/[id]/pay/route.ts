import { payOrder } from "@/lib/auction/engine";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, handleRouteError } from "@/lib/api";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in to pay.", 401);
    const { id } = await ctx.params;
    const result = await payOrder(id, session.user.id);
    if (!result.ok) return apiError("payment_failed", result.message, 409);
    return apiOk({ orderId: result.orderId });
  } catch (error) {
    return handleRouteError(error);
  }
}
