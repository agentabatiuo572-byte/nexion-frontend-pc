import { cookies } from "next/headers";
import { localMockResponse } from "@/lib/admin/local-mock-backend";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

async function proxyDevicesCollection(request: Request) {
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  // 本地预览模式:设备裸 collection(端点8)→ 本地 mock 分页。
  const localMock = localMockResponse("devices", request.method, [], new URL(request.url).searchParams);
  if (localMock) {
    return Response.json(localMock, { headers: { "Cache-Control": "no-store" } });
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
