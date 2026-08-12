import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

type RouteContext = { params: Promise<{ path?: string[] }> };

function error(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  if (!(path.length === 4 && path[0] === "acceptance" && path[1] === "sandbox-orders"
      && path[2].trim().length > 0 && path[3] === "callbacks")) {
    return error(404, "COMMERCE_ACCEPTANCE_ROUTE_NOT_FOUND");
  }
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return error(401, "ADMIN_AUTH_REQUIRED");
  const orderNo = path[2];
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/commerce/acceptance/sandbox-orders/${encodeURIComponent(orderNo)}/callbacks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": request.headers.get("Content-Type") || "application/json" },
      body: await request.text(),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return error(503, "COMMERCE_ACCEPTANCE_BACKEND_UNAVAILABLE");
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  if (!(path.length === 2 && path[0] === "acceptance" && path[1] === "sandbox-orders")) return error(404, "COMMERCE_ACCEPTANCE_ROUTE_NOT_FOUND");
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return error(401, "ADMIN_AUTH_REQUIRED");
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/commerce/acceptance/sandbox-orders`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
    return new Response(await upstream.text(), { status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } });
  } catch { return error(503, "COMMERCE_ACCEPTANCE_BACKEND_UNAVAILABLE"); }
}
