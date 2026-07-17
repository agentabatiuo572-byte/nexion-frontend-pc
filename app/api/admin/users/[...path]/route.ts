import { cookies } from "next/headers";

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
  if (parts.length === 2 && parts[0] === "account-actions" && parts[1] === "overview") {
    return "/api/admin/users/account-actions/overview";
  }
  if (parts.length === 3 && parts[0] === "account-actions" && parts[1] === "accounts" && isNonEmpty(parts[2])) {
    return `/api/admin/users/account-actions/accounts/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 2 && parts[0] === "kyc" && parts[1] === "overview") {
    return "/api/admin/users/kyc/overview";
  }
  if (parts.length === 2 && parts[0] === "security" && parts[1] === "overview") {
    return "/api/admin/users/security/overview";
  }
  if (parts.length === 2 && parts[0] === "security" && parts[1] === "credential-params") {
    return "/api/admin/users/security/credential-params";
  }
  if (parts.length === 3 && parts[0] === "security" && parts[1] === "credential-params" && isNonEmpty(parts[2])) {
    return `/api/admin/users/security/credential-params/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 2 && parts[0] === "registration-risk" && parts[1] === "overview") {
    return "/api/admin/users/registration-risk/overview";
  }
  if (parts.length === 3 && parts[0] === "registration-risk" && parts[1] === "params" && isNonEmpty(parts[2])) {
    return `/api/admin/users/registration-risk/params/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 2 && parts[0] === "kyc" && parts[1] === "network-whitelist") {
    return "/api/admin/users/kyc/network-whitelist";
  }
  if (parts.length === 2 && parts[0] === "kyc" && parts[1] === "exports") {
    return "/api/admin/users/kyc/exports";
  }
  if (parts.length === 4 && parts[0] === "kyc" && parts[1] === "users" && isNonEmpty(parts[2]) && parts[3] === "status") {
    return `/api/admin/users/kyc/users/${encodeURIComponent(parts[2])}/status`;
  }
  if (parts.length === 1 && parts[0] === "account-lists") {
    return "/api/admin/users/account-lists";
  }
  if (parts.length === 1 && parts[0] === "profiles") {
    return "/api/admin/users/profiles";
  }
  if (parts.length === 2 && parts[0] === "profiles" && parts[1] === "export") {
    return "/api/admin/users/profiles/export";
  }
  if (parts.length === 1 && parts[0] === "sessions") {
    return "/api/admin/users/sessions";
  }
  if (parts.length === 1 && parts[0] === "asset-adjustments") {
    return "/api/admin/users/asset-adjustments";
  }
  if (parts.length === 2 && parts[0] === "asset-adjustments" && parts[1] === "overview") {
    return "/api/admin/users/asset-adjustments/overview";
  }
  if (parts.length === 2 && parts[0] === "asset-adjustments" && isNonEmpty(parts[1])) {
    return `/api/admin/users/asset-adjustments/${encodeURIComponent(parts[1])}`;
  }
  if (parts.length === 3 && parts[0] === "asset-adjustments" && isNonEmpty(parts[1]) && (parts[2] === "approve" || parts[2] === "reject")) {
    return `/api/admin/users/asset-adjustments/${encodeURIComponent(parts[1])}/${parts[2]}`;
  }
  if (parts.length === 3 && parts[0] === "account-lists" && isNonEmpty(parts[1]) && parts[2] === "remove") {
    return `/api/admin/users/account-lists/${encodeURIComponent(parts[1])}/remove`;
  }
  if (parts.length === 3 && parts[0] === "impersonations" && isNonEmpty(parts[1]) && parts[2] === "terminate") {
    return `/api/admin/users/impersonations/${encodeURIComponent(parts[1])}/terminate`;
  }
  if (parts.length === 3 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "360") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/360`;
  }
  if (parts.length === 3 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "security") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/security`;
  }
  if (parts.length === 3 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "status") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/status`;
  }
  if (parts.length === 3 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "impersonations") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/impersonations`;
  }
  if (parts.length === 3 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "asset-adjustments") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/asset-adjustments`;
  }
  if (parts.length === 4 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "sessions" && parts[3] === "revoke-all") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/sessions/revoke-all`;
  }
  if (parts.length === 4 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "security" && parts[3] === "password-reset") {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/security/password-reset`;
  }
  if (parts.length === 4 && parts[0] === "profiles" && isNonEmpty(parts[1]) && parts[2] === "security" && (parts[3] === "disable-2fa" || parts[3] === "unlock")) {
    return `/api/admin/users/profiles/${encodeURIComponent(parts[1])}/security/${parts[3]}`;
  }
  if (parts.length === 3 && parts[0] === "sessions" && isNonEmpty(parts[1]) && parts[2] === "revoke") {
    return `/api/admin/users/sessions/${encodeURIComponent(parts[1])}/revoke`;
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "USERS_ROUTE_NOT_FOUND");
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
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) {
      responseHeaders.set("Content-Disposition", disposition);
    }
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(503, "USERS_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}
