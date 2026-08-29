import { buyNow } from "@/lib/auction/engine";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, handleRouteError } from "@/lib/api";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in to buy.", 401);
    const { id } = await ctx.params;
    const result = await buyNow({ auctionId: id, buyerId: session.user.id });
    if (!result.ok) return apiError(result.reason, result.message, 409);
    return apiOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
