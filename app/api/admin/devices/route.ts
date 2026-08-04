import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

async function proxyDevicesCollection(request: Request) {
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}/api/admin/devices${sourceUrl.search}`;
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${token}`,
      },
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
    return jsonError(503, "DEVICES_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request) {
  return proxyDevicesCollection(request);
}
