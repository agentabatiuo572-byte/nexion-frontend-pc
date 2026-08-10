import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type RouteContext = { params: Promise<{ path?: string[] }> };

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function safe(value: string | undefined) {
  return !!value && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

function target(parts: string[], method: string) {
  if (!parts.length || parts.some((part) => !safe(part))) return null;
  const joined = parts.join("/");
  const readOnly = new Set([
    "metadata", "dashboard", "devices", "strategies", "health", "audit",
    "remote-targets", "remote-targets/origins",
  ]);
  if (method === "GET") {
    if (readOnly.has(joined)) return joined;
    if (/^(devices|strategies)\/[A-Za-z0-9_.:-]{1,128}$/.test(joined)) return joined;
    if (/^devices\/[A-Za-z0-9_.:-]{1,128}\/takeover\/applied$/.test(joined)) return joined;
    return null;
  }
  if (method === "POST") {
    if (joined === "strategies" || joined === "exports" || joined === "remote-targets") return joined;
    if (/^devices\/[A-Za-z0-9_.:-]{1,128}\/status$/.test(joined)) return joined;
    if (/^devices\/[A-Za-z0-9_.:-]{1,128}\/takeover\/(revoke|revoke:resend|target|retry)$/.test(joined)) return joined;
    if (/^devices\/[A-Za-z0-9_.:-]{1,128}\/takeover\/applied:refresh$/.test(joined)) return joined;
    if (/^strategies\/[A-Za-z0-9_.:-]{1,128}\/(dry-run|publish|pause|archive|rollback)$/.test(joined)) return joined;
    if (/^remote-targets\/[A-Za-z0-9_.:-]{1,128}\/\d+\/disable$/.test(joined)) return joined;
    return null;
  }
  if (method === "PUT" && /^strategies\/[A-Za-z0-9_.:-]{1,128}$/.test(joined)) return joined;
  if (method === "DELETE" && /^strategies\/[A-Za-z0-9_.:-]{1,128}$/.test(joined)) return joined;
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = target(path, request.method);
  if (!targetPath) return jsonError(404, "JANUS_ROUTE_NOT_FOUND");
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const sourceUrl = new URL(request.url);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);

  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/janus/${targetPath}${sourceUrl.search}`, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
    });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const upstreamOutcome = upstream.headers.get("X-Nexion-Upstream-Outcome");
    if (upstreamOutcome) responseHeaders.set("X-Nexion-Upstream-Outcome", upstreamOutcome);
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) responseHeaders.set("Content-Disposition", disposition);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
  } catch {
    if (!["GET", "HEAD"].includes(request.method)) {
      return Response.json(
        { code: 503, message: "JANUS_BACKEND_UNAVAILABLE", data: null },
        { status: 503, headers: { "X-Nexion-Upstream-Outcome": "unknown" } },
      );
    }
    return jsonError(503, "JANUS_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) { return proxy(request, context); }
export async function POST(request: Request, context: RouteContext) { return proxy(request, context); }
export async function PUT(request: Request, context: RouteContext) { return proxy(request, context); }
export async function DELETE(request: Request, context: RouteContext) { return proxy(request, context); }
