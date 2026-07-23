import { cookies } from "next/headers";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type RouteContext = { params: Promise<{ path?: string[] }> };

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function safePart(value: string | undefined) {
  return !!value && value.trim().length > 0 && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  if (path.some((part) => !safePart(part)) || !["options", "report"].includes(path[0] || "")) {
    return jsonError(404, "REGULATORY_ROUTE_NOT_FOUND");
  }
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  try {
    const upstream = await fetch(
      `${BACKEND_BASE_URL}/api/admin/regulatory/${path.map(encodeURIComponent).join("/")}`,
      {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
        cache: "no-store",
      },
    );
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError(503, "REGULATORY_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

