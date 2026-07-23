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

function isText(value: string | undefined) {
  return !!value && value.trim().length > 0;
}

function backendPath(parts: string[]) {
  if (parts.length === 1 && [
    "overview",
    "dual-ledger",
    "coverage",
    "injections",
    "b-domain",
    "reserve",
    "liabilities",
    "maturity-forecast",
    "net-exposure",
    "forecast-config",
    "reserve-injection",
  ].includes(parts[0])) {
    return `/api/admin/treasury/${parts[0]}`;
  }
  if (parts.length === 2 && ["reconciliation", "liabilities"].includes(parts[0]) && parts[1] === "export") {
    return `/api/admin/treasury/${parts[0]}/export`;
  }
  if (parts.length === 4 && parts[0] === "b-domain" && parts[1] === "alerts" && isText(parts[2]) && parts[3] === "ack") {
    return `/api/admin/treasury/b-domain/alerts/${encodeURIComponent(parts[2])}/ack`;
  }
  if (parts.length === 2 && parts[0] === "b-domain" && parts[1] === "bankrun-thresholds") {
    return "/api/admin/treasury/b-domain/bankrun-thresholds";
  }
  if (parts.length === 2 && parts[0] === "dual-ledger" && ["scope", "thresholds"].includes(parts[1])) {
    return `/api/admin/treasury/dual-ledger/${parts[1]}`;
  }
  if (parts.length === 2 && parts[0] === "ledger" && parts[1] === "bills") {
    return "/api/admin/treasury/ledger/bills";
  }
  if (parts.length === 3 && parts[0] === "ledger" && parts[1] === "users" && isText(parts[2])) {
    return `/api/admin/treasury/ledger/users/${encodeURIComponent(parts[2])}`;
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "TREASURY_ROUTE_NOT_FOUND");
  }

  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`;
  const headers = new Headers({ Authorization: `Bearer ${token}` });
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
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const contentDisposition = upstream.headers.get("Content-Disposition");
    if (contentDisposition) responseHeaders.set("Content-Disposition", contentDisposition);
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(503, "TREASURY_BACKEND_UNAVAILABLE");
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

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}
