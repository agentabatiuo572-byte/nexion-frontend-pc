import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const UNKNOWN_OUTCOME_HEADER = "X-Nexion-Upstream-Outcome";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function targetPath(parts: string[]) {
  if (parts.some((part) => !part || part.includes("..") || part.includes("/") || part.includes("\\"))) return null;
  if (parts.length === 0) return "/api/admin/funnel";
  if (parts.length !== 1 || !new Set(["aux-metrics", "cohort-trend", "export", "view"]).has(parts[0])) return null;
  return `/api/admin/funnel/${encodeURIComponent(parts[0])}`;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const upstreamPath = targetPath(path);
  if (!upstreamPath) return jsonError(404, "B3_ROUTE_NOT_FOUND");

  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const sourceUrl = new URL(request.url);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}${upstreamPath}${sourceUrl.search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      signal: AbortSignal.timeout(20_000),
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
    const response = jsonError(503, "B3_BACKEND_UNAVAILABLE");
    if (hasBody && idempotencyKey) {
      response.headers.set(UNKNOWN_OUTCOME_HEADER, "unknown");
    }
    return response;
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}
