import { cookies } from "next/headers";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function targetPath(parts: string[]) {
  if (parts.some((part) => !part || part.includes("..") || part.includes("/") || part.includes("\\"))) return null;
  if (parts.length === 1 && new Set(["overview", "jump"]).has(parts[0])) {
    return `/api/admin/phase/${encodeURIComponent(parts[0])}`;
  }
  if (parts.length === 2 && parts[0] === "distribution" && parts[1] === "export") {
    return "/api/admin/phase/distribution/export";
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const upstreamPath = targetPath(path);
  if (!upstreamPath) return jsonError(404, "B4_ROUTE_NOT_FOUND");

  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const sourceUrl = new URL(request.url);
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}${upstreamPath}${sourceUrl.search}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) responseHeaders.set("Content-Disposition", disposition);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  } catch {
    return jsonError(503, "B4_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}
