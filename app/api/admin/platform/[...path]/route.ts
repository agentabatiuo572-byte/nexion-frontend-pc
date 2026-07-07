import { cookies } from "next/headers";
import { localMockResponse } from "@/lib/admin/local-mock-backend";

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
  if (parts.length === 2 && parts[0] === "accounts" && parts[1] === "overview") {
    return "/api/admin/platform/accounts/overview";
  }
  if (parts.length === 1 && parts[0] === "accounts") {
    return "/api/admin/platform/accounts";
  }
  if (parts.length === 3 && parts[0] === "accounts" && isNonEmpty(parts[1]) && (parts[2] === "role" || parts[2] === "status")) {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/${parts[2]}`;
  }
  if (parts.length === 3 && parts[0] === "accounts" && isNonEmpty(parts[1]) && parts[2] === "reset-2fa") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/reset-2fa`;
  }
  if (parts.length === 4 && parts[0] === "accounts" && isNonEmpty(parts[1]) && parts[2] === "sessions" && parts[3] === "revoke") {
    return `/api/admin/platform/accounts/${encodeURIComponent(parts[1])}/sessions/revoke`;
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
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "PLATFORM_ROUTE_NOT_FOUND");
  }

  // 本地预览模式:平台域短路返回本地 mock(accounts/overview = A1 账户总览)。
  const localMock = localMockResponse("platform", request.method, path, new URL(request.url).searchParams);
  if (localMock) {
    return Response.json(localMock, { headers: { "Cache-Control": "no-store" } });
  }

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
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError(503, "PLATFORM_BACKEND_UNAVAILABLE");
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
