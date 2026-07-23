import { cookies } from "next/headers";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type RouteContext = { params: Promise<{ path?: string[] }> };

function targetPath(parts: string[]) {
  return parts.length === 1 && parts[0] === "limits" ? "/api/admin/withdraw/limits" : null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const target = targetPath(path);
  if (!target) return Response.json({ code: "WITHDRAW_ROUTE_NOT_FOUND", message: "WITHDRAW_ROUTE_NOT_FOUND" }, { status: 404 });
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ code: "ADMIN_AUTH_REQUIRED", message: "ADMIN_AUTH_REQUIRED" }, { status: 401 });
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}${target}`, {
      method: request.method,
      headers,
      body: request.method === "PUT" ? await request.text() : undefined,
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ code: "WITHDRAW_BACKEND_UNAVAILABLE", message: "WITHDRAW_BACKEND_UNAVAILABLE" }, { status: 503 });
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}
