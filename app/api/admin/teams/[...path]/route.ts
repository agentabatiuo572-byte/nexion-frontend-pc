import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function isNonEmpty(value: string | undefined) {
  return !!value && value.trim().length > 0;
}

function backendPath(parts: string[]) {
  if (parts.length === 1 && parts[0] === "rank-policy") {
    return "/api/admin/teams/rank-policy";
  }
  if (parts.length === 1 && parts[0] === "ranks") {
    return "/api/admin/teams/ranks";
  }
  if (parts.length === 1 && parts[0] === "rates") {
    return "/api/admin/teams/rates";
  }
  if (parts.length === 1 && parts[0] === "binary") {
    return "/api/admin/teams/binary";
  }
  if (
    parts.length === 2
    && parts[0] === "binary"
    && (parts[1] === "assignments" || parts[1] === "settlements")
  ) {
    return `/api/admin/teams/binary/${parts[1]}`;
  }
  if (parts.length === 1 && parts[0] === "leadership-pool") {
    return "/api/admin/teams/leadership-pool";
  }
  if (parts.length === 2 && parts[0] === "leadership-pool" && parts[1] === "settle") {
    return "/api/admin/teams/leadership-pool/settle";
  }
  if (parts.length === 1 && parts[0] === "commissions") {
    return "/api/admin/commissions";
  }
  if (
    parts.length === 2
    && parts[0] === "commissions"
    && (parts[1] === "anomalies" || parts[1] === "reissue" || parts[1] === "anomaly-config" || parts[1] === "export")
  ) {
    // canonical F5: /commissions/reissue and the read/config companion routes.
    return `/api/admin/commissions/${parts[1]}`;
  }
  if (
    parts.length === 3
    && parts[0] === "commissions"
    && isNonEmpty(parts[1])
    && parts[2] === "reverse"
  ) {
    return `/api/admin/commissions/${encodeURIComponent(parts[1])}/reverse`;
  }
  if (
    parts.length === 4
    && parts[0] === "commissions"
    && parts[1] === "users"
    && /^\d+$/.test(parts[2])
    && parts[3] === "suspend"
  ) {
    // canonical backend suffix: /users/{userId}/commission/suspend
    return `/api/admin/users/${parts[2]}/commission/suspend`;
  }
  if (parts.length === 1 && parts[0] === "promotion-log") {
    return "/api/admin/teams/promotion-log";
  }
  if (parts.length === 1 && parts[0] === "reward-payouts") {
    return "/api/admin/teams/reward-payouts";
  }
  if (
    parts.length === 4 &&
    parts[0] === "users" &&
    /^\d+$/.test(parts[1]) &&
    parts[2] === "vrank" &&
    parts[3] === "override"
  ) {
    return `/api/admin/teams/users/${parts[1]}/vrank/override`;
  }
  if (
    parts.length === 3 &&
    parts[0] === "reward-payouts" &&
    isNonEmpty(parts[1]) &&
    (parts[2] === "reissue" || parts[2] === "reverse")
  ) {
    return `/api/admin/teams/reward-payouts/${encodeURIComponent(parts[1])}/${parts[2]}`;
  }
  if (
    parts.length === 3 &&
    parts[0] === "commissions" &&
    parts[1] === "config" &&
    isNonEmpty(parts[2])
  ) {
    return `/api/admin/teams/commissions/config/${encodeURIComponent(parts[2])}`;
  }
  if (
    parts.length === 4 &&
    parts[0] === "ranks" &&
    isNonEmpty(parts[1]) &&
    parts[2] === "thresholds" &&
    isNonEmpty(parts[3])
  ) {
    return `/api/admin/teams/ranks/${encodeURIComponent(parts[1])}/thresholds/${encodeURIComponent(parts[3])}`;
  }
  if (
    parts.length === 3 &&
    parts[0] === "ranks" &&
    isNonEmpty(parts[1]) &&
    parts[2] === "rewards"
  ) {
    return `/api/admin/teams/ranks/${encodeURIComponent(parts[1])}/rewards`;
  }
  if (
    parts.length === 4 &&
    parts[0] === "ranks" &&
    isNonEmpty(parts[1]) &&
    parts[2] === "rewards" &&
    isNonEmpty(parts[3])
  ) {
    return `/api/admin/teams/ranks/${encodeURIComponent(parts[1])}/rewards/${encodeURIComponent(parts[3])}`;
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "TEAMS_ROUTE_NOT_FOUND");
  }

  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`;
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });
    if (path.length === 2 && path[0] === "commissions" && path[1] === "export" && upstream.ok) {
      const responseHeaders = new Headers({
        "Content-Type": upstream.headers.get("Content-Type") || "text/csv;charset=UTF-8",
        "Cache-Control": "no-store",
      });
      for (const name of [
        "Content-Disposition", "X-Export-Id", "X-Export-Row-Count", "X-Export-Byte-Size",
        "X-Export-Sha256", "X-Export-Redacted",
      ]) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: responseHeaders,
      });
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError(503, "TEAMS_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
