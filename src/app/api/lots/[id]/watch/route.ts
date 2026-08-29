import { toggleWatch } from "@/lib/auction/engine";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, handleRouteError } from "@/lib/api";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in to follow lots.", 401);
    const { id } = await ctx.params;
    const result = await toggleWatch(session.user.id, id);
    return apiOk(result);
  } catch (error) {
    return handleRouteError(error);
  }
}
