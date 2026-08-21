import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";
const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
type RouteContext = { params: Promise<{ path?: string[] }> };
function error(status: number, message: string) { return Response.json({ code: status, message, data: null }, { status }); }
function target(parts: string[]) {
  if (!parts.length || parts.some((p) => !p.trim() || p.includes("..") || p.includes("/") || p.includes("\\"))) return null;
  if (parts[0] === "list") return "/api/admin/content/legal-terms";
  return `/api/admin/content/legal-terms/${parts.map(encodeURIComponent).join("/")}`;
}
async function proxy(request: Request, context: RouteContext) {
  const path = (await context.params).path ?? []; const upstreamPath = target(path); if (!upstreamPath) return error(404, "LEGAL_TERMS_ROUTE_NOT_FOUND");
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies()); if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get("nexion_admin_token")?.value; if (!token) return error(401, "ADMIN_AUTH_REQUIRED");
  const headers = new Headers({ Authorization: `Bearer ${token}` }); const contentType = request.headers.get("Content-Type"); if (contentType) headers.set("Content-Type", contentType);
  try { const url = new URL(request.url); const upstream = await fetch(`${BACKEND_BASE_URL}${upstreamPath}${url.search}`, { method: request.method, headers, body: request.method === "GET" ? undefined : await request.text(), cache: "no-store" }); return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" } }); }
  catch { return error(503, "LEGAL_TERMS_BACKEND_UNAVAILABLE"); }
}
export const GET = proxy; export const POST = proxy; export const PUT = proxy;
