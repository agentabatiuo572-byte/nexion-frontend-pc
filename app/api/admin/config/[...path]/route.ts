import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const ROUTE_METHODS: readonly (readonly [string, readonly string[]])[] = [
  ["task-pricing", ["GET", "HEAD", "PUT"]],
  ["phone-tiers", ["GET", "HEAD", "PUT"]],
  ["phone-tiers/comparison", ["GET", "HEAD", "PUT"]],
  ["phone-calibration", ["GET"]],
  ["phone-calibration/preview", ["POST"]],
];

type RouteContext = { params: Promise<{ path?: string[] }> };

function jsonError(status: number, message: string, headers?: Record<string, string>) {
  return Response.json({ code: status, message, data: null }, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const route = path.join("/");
  const allowedMethods = ROUTE_METHODS.find(([path]) => path === route)?.[1];
  if (!allowedMethods) {
    return jsonError(404, "E2_CONFIG_ROUTE_NOT_FOUND");
  }
  if (!allowedMethods.includes(request.method)) {
    return jsonError(405, "E2_CONFIG_METHOD_NOT_ALLOWED", { Allow: allowedMethods.join(", ") });
  }
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/config/${route}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return jsonError(503, "E2_CONFIG_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) { return proxy(request, context); }
export async function PUT(request: Request, context: RouteContext) { return proxy(request, context); }
export async function POST(request: Request, context: RouteContext) { return proxy(request, context); }
