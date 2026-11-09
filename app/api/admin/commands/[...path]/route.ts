import { cookies } from "next/headers";
import { ADMIN_TOKEN_COOKIE, requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

type RouteContext = { params: Promise<{ path?: string[] }> };

function error(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const original = path.length === 1 && path[0] === "investigations";
  const discovery = path.length === 2 && path[0] === "investigations" && path[1] === "by-command-key";
  if (!original && !discovery) return error(404, "COMMAND_ROUTE_NOT_FOUND");
  if (request.method !== "GET" && !(original && request.method === "POST")) {
    return error(405, "COMMAND_METHOD_NOT_ALLOWED");
  }
  const jar = await cookies();
  const passwordChangeBlocked = requirePasswordChangeCleared(jar);
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = jar.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return error(401, "ADMIN_AUTH_REQUIRED");

  const write = request.method === "POST";
  const suffix = discovery ? "/by-command-key" : "";
  const target = `${process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110"}/api/admin/commands/investigations${suffix}${new URL(request.url).search}`;
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: write ? await request.arrayBuffer() : undefined,
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    const headers = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const outcome = upstream.headers.get("X-Nexion-Upstream-Outcome");
    if (outcome) headers.set("X-Nexion-Upstream-Outcome", outcome);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch {
    const response = error(503, "COMMAND_BACKEND_UNAVAILABLE");
    if (write) response.headers.set("X-Nexion-Upstream-Outcome", "unknown");
    return response;
  }
}

export async function GET(request: Request, context: RouteContext) { return proxy(request, context); }
export async function POST(request: Request, context: RouteContext) { return proxy(request, context); }
