import { cookies } from "next/headers";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const OPERATION_REASON_HEADER = "X-Operation-Reason";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function isSafePart(value: string | undefined) {
  return !!value && value.trim().length > 0 && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

function backendPath(parts: string[]) {
  if (!parts.length) return null;
  const allowedHeads = new Set(["overview", "kpi", "funnel", "retention", "finance", "operations", "devices", "tasks", "network", "phase-effect", "export", "behavior", "behavior-heatmap", "reports", "regulatory", "exports"]);
  if (!allowedHeads.has(parts[0])) return null;
  if (parts.some((part) => !isSafePart(part))) return null;
  return `/api/admin/bi/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);
  if (!targetPath) return jsonError(404, "BI_ROUTE_NOT_FOUND");

  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const sourceUrl = new URL(request.url);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  const operationReason = request.headers.get(OPERATION_REASON_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  if (operationReason) headers.set(OPERATION_REASON_HEADER, operationReason);

  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
    });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const disposition = upstream.headers.get("Content-Disposition");
    if (disposition) responseHeaders.set("Content-Disposition", disposition);
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    return jsonError(503, "BI_BACKEND_UNAVAILABLE");
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
