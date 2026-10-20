import { cookies } from "next/headers";
import { ADMIN_TOKEN_COOKIE, requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";
import { phoneOperationRoute } from "@/lib/admin/phone-replacement-routes";

export async function GET(request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const target = phoneOperationRoute((await context.params).path ?? []);
  if (!target) return Response.json({ code: 404, message: "ROUTE_NOT_FOUND", data: null }, { status: 404 });
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const jar = await cookies();
  const token = jar.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ code: 401, message: "ADMIN_AUTH_REQUIRED", data: null }, { status: 401 });
  try {
    const response = await fetch(`${process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110"}${target}${new URL(request.url).search}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    return new Response(await response.arrayBuffer(), { status: response.status, headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store",
    } });
  } catch {
    return Response.json({ code: 503, message: "PHONE_QUERY_UNAVAILABLE", data: null }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
