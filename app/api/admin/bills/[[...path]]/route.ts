import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

type RouteContext = { params: Promise<{ path?: string[] }> };

function targetPath(parts: string[]) {
  if (parts.length === 0) return "/api/admin/bills";
  if (parts.length === 1 && ["running-balance", "export"].includes(parts[0])) {
    return `/api/admin/bills/${parts[0]}`;
  }
  if (parts.length === 2 && parts[0] === "users" && /^\d+$/.test(parts[1])) {
    return `/api/admin/bills/users/${encodeURIComponent(parts[1])}`;
  }
  return null;
}

export async function GET(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const target = targetPath(path);
  if (!target) return Response.json({ code: 404, message: "BILLS_ROUTE_NOT_FOUND", data: null }, { status: 404 });
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ code: 401, message: "ADMIN_AUTH_REQUIRED", data: null }, { status: 401 });
  const sourceUrl = new URL(request.url);
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}${target}${sourceUrl.search}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch {
    return Response.json({ code: 503, message: "BILLS_BACKEND_UNAVAILABLE", data: null }, { status: 503 });
  }
}
