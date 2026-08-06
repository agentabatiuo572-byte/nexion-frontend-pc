import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

// SSE 流式透传路由:GET /api/admin/content/conversations/stream
// 静态路径优先于 content/[...path] catch-all,仅服务这一条流。
// 关键:不 await upstream.text()(那会把 SseEmitter 30 分钟的流攒到超时),
// 而是直接把 upstream.body(ReadableStream)交给 Response,后端每个 chunk 立即透传给浏览器。
const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

// SSE 必须动态渲染,禁用 Next 静态化/缓存。
export const dynamic = "force-dynamic";

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

export async function GET(request: Request) {
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}/api/admin/content/conversations/stream${sourceUrl.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
      cache: "no-store",
    });
  } catch {
    return jsonError(503, "CONTENT_BACKEND_UNAVAILABLE");
  }

  // 非 200 或无流体:按普通响应回传错误体,不伪装成 event-stream。
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.body ? await upstream.text() : null, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  }

  // 流式透传:后端 SseEmitter 的每个事件帧立即下发给浏览器,不在本层缓冲。
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // 防反向代理(nginx 等)缓冲 SSE
    },
  });
}
