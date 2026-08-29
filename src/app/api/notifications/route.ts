import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { apiError, apiOk, handleRouteError } from "@/lib/api";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in first.", 401);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, session.user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    return apiOk({
      notifications: rows,
      unread: rows.filter((r) => r.readAt === null).length,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Mark everything read. */
export async function POST() {
  try {
    const session = await getSession();
    if (!session?.user) return apiError("unauthorized", "Sign in first.", 401);
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, session.user.id), isNull(notifications.readAt)),
      );
    return apiOk({ read: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
