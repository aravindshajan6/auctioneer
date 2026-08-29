import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Consistent JSON error envelope so the client can branch on `code`. */
export function apiError(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return NextResponse.json({ ok: false, code, message, ...extra }, { status });
}

export function apiOk<T extends Record<string, unknown>>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

/** Turn any thrown value into a safe response, without leaking internals. */
export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return apiError("invalid_request", "Your request was not valid.", 422, {
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return apiError("unauthorized", "You must be signed in.", 401);
  }
  console.error("[api] unhandled error", error);
  return apiError("server_error", "Something went wrong on our end.", 500);
}

/** Best-effort client IP for bid audit trails behind a proxy. */
export function clientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? undefined;
}
