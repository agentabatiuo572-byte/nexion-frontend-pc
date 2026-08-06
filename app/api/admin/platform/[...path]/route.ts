import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const UPSTREAM_TIMEOUT_MS = Math.min(30_000, Math.max(1_000, Number(process.env.NEXION_BACKEND_TIMEOUT_MS) || 10_000));

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ code: status, message, data: null }, { status, headers });
}

function isNonEmpty(value: string | undefined) {
  return !!value && value.trim().length > 0;
}

function backendPath(parts: string[]) {
  if (parts.length === 2 && parts[0] === "ops-dashboard" && parts[1] === "summary") {
    return "/api/admin/ops-dashboard/summary";
  }
  if (parts.length === 2 && parts[0] === "config" && parts[1] === "overview") {
    return "/api/admin/platform/config/overview";
  }
  if (parts.length === 1 && parts[0] === "params-registry") {
    return "/api/admin/platform/params-registry";
  }
  if (parts.length === 1 && parts[0] === "config") {
    return "/api/admin/platform/config";
  }
  if (parts.length === 2 && parts[0] === "flags" && parts[1] === "runtime") {
    return "/api/admin/platform/flags/runtime";
  }
  if (parts.length === 2 && parts[0] === "events" && parts[1] === "overview") {
    return "/api/admin/platform/events/overview";
  }
  if (parts.length === 3 && parts[0] === "events" && parts[1] === "params" && isNonEmpty(parts[2])) {
    return `/api/admin/platform/events/params/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 2 && parts[0] === "events" && (parts[1] === "schema-registrations" || parts[1] === "domain-extension-batches")) {
    return `/api/admin/platform/events/${parts[1]}`;
  }
  if (parts.length === 2 && parts[0] === "accounts" && parts[1] === "overview") {
    return "/api/admin/platform/accounts/overview";
  }
  if (parts.length === 1 && parts[0] === "accounts") {
    return "/api/admin/platform/accounts";
  }
  if (parts.length === 2 && parts[0] === "accounts" && isNonEmpty(parts[1])) {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}`;
  }
  if (parts.length === 3 && parts[0] === "accounts" && isNonEmpty(parts[1]) && (parts[2] === "role" || parts[2] === "status")) {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/${parts[2]}`;
  }
  if (parts.length === 3 && parts[0] === "accounts" && isNonEmpty(parts[1]) && parts[2] === "profile") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/profile`;
  }
  if (parts.length === 3 && parts[0] === "accounts" && isNonEmpty(parts[1]) && parts[2] === "reset-2fa") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/reset-2fa`;
  }
  if (parts.length === 4 && parts[0] === "accounts" && isNonEmpty(parts[1]) && parts[2] === "password" && parts[3] === "reset") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/password/reset`;
  }
  if (parts.length === 4 && parts[0] === "accounts" && isNonEmpty(parts[1]) && parts[2] === "sessions" && parts[3] === "revoke") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/sessions/revoke`;
  }
  if (parts.length === 5
      && parts[0] === "accounts"
      && isNonEmpty(parts[1])
      && parts[2] === "sessions"
      && isNonEmpty(parts[3])
      && parts[4] === "revoke") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/sessions/${encodeURIComponent(parts[3])}/revoke`;
  }
  if (parts.length === 3 && parts[0] === "accounts" && parts[1] === "security-baselines" && isNonEmpty(parts[2])) {
    return `/api/admin/platform/accounts/security-baselines/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 4 && parts[0] === "rbac" && parts[1] === "actions" && isNonEmpty(parts[2]) && parts[3] === "grants") {
    return `/api/admin/platform/rbac/actions/${encodeURIComponent(parts[2])}/grants`;
  }
  if (parts.length === 2 && parts[0] === "rbac" && parts[1] === "actions") {
    return "/api/admin/platform/rbac/actions";
  }
  if (parts.length >= 1 && parts[0] === "audit") {
    if (parts.length === 2 && (parts[1] === "overview" || parts[1] === "logs" || parts[1] === "exports")) {
      return `/api/admin/platform/audit/${parts[1]}`;
    }
    if (parts.length === 2 && parts[1] === "operations") {
      return "/api/admin/platform/audit/operations";
    }
    if (parts.length === 4 && parts[1] === "logs" && parts[2] === "trace" && isNonEmpty(parts[3])) {
      return `/api/admin/platform/audit/logs/trace/${encodeURIComponent(parts[3])}`;
    }
    if (parts.length === 4 && parts[1] === "operations" && isNonEmpty(parts[2]) && (parts[3] === "approve" || parts[3] === "reject")) {
      return `/api/admin/platform/audit/operations/${encodeURIComponent(parts[2])}/${parts[3]}`;
    }
    if (parts.length === 3 && parts[1] === "mechanism-params" && isNonEmpty(parts[2])) {
      return `/api/admin/platform/audit/mechanism-params/${encodeURIComponent(parts[2])}`;
    }
    if (parts.length === 3 && parts[1] === "stats" && ["summary", "actions", "services", "users"].includes(parts[2])) {
      return `/api/admin/platform/audit/stats/${parts[2]}`;
    }
  }
  if (parts.length === 2 && parts[0] === "roles" && parts[1] === "overview") {
    return "/api/admin/platform/roles/overview";
  }
  if (parts.length === 1 && parts[0] === "roles") {
    return "/api/admin/platform/roles";
  }
  if (parts.length === 2 && parts[0] === "roles" && isNonEmpty(parts[1])) {
    return `/api/admin/platform/roles/${encodeURIComponent(parts[1])}`;
  }
  if (parts.length === 3 && parts[0] === "roles" && isNonEmpty(parts[1]) && parts[2] === "grants") {
    return `/api/admin/platform/roles/${encodeURIComponent(parts[1])}/grants`;
  }
  if (parts.length === 2 && parts[0] === "menus" && parts[1] === "overview") {
    return "/api/admin/platform/menus/overview";
  }
  if (parts.length === 1 && parts[0] === "menus") {
    return "/api/admin/platform/menus";
  }
  if (parts.length === 2 && parts[0] === "menus" && isNonEmpty(parts[1])) {
    return `/api/admin/platform/menus/${encodeURIComponent(parts[1])}`;
  }
  if (parts.length === 1 && parts[0] === "permissions") {
    return "/api/admin/platform/permissions";
  }
  if (parts.length === 2 && parts[0] === "permissions" && isNonEmpty(parts[1])) {
    return `/api/admin/platform/permissions/${encodeURIComponent(parts[1])}`;
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "PLATFORM_ROUTE_NOT_FOUND");
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
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (idempotencyKey) {
    headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    // 回抄上游的「结果未知」标记(finance / risk / users / janus 四个 proxy 同款)。
    // 不回抄时,后端用「200 或 4xx + 该头」表达未知的场景在客户端恒判成确定性失败 → 弃命令号
    // → 重试铸新号 → 同一笔资金动作两张待确认票。A2 全域(E 28 处 + H8 结算 + i3/i4/k1/k2)走这条 proxy。
    const upstreamOutcome = upstream.headers.get("X-Nexion-Upstream-Outcome");
    if (upstreamOutcome) {
      responseHeaders.set("X-Nexion-Upstream-Outcome", upstreamOutcome);
    }
    const contentDisposition = upstream.headers.get("Content-Disposition");
    const contentLength = upstream.headers.get("Content-Length");
    if (contentDisposition) {
      responseHeaders.set("Content-Disposition", contentDisposition);
    }
    if (contentLength) {
      responseHeaders.set("Content-Length", contentLength);
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return jsonError(503, timedOut ? "PLATFORM_BACKEND_TIMEOUT" : "PLATFORM_BACKEND_UNAVAILABLE",
      hasBody ? { "X-Nexion-Upstream-Outcome": "unknown" } : undefined);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
