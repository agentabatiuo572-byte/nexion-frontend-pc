const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

async function proxy(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonError(401, "IMPERSONATION_TOKEN_REQUIRED");
  }
  try {
    const requestedPage = new URL(request.url).searchParams.get("page") || "HOME";
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/impersonation/view?page=${encodeURIComponent(requestedPage)}`, {
      method: request.method,
      headers: { Authorization: authorization },
      cache: "no-store",
    });
    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError(503, "IMPERSONATION_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request) {
  return proxy(request);
}

export async function POST(request: Request) {
  return proxy(request);
}
