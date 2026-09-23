import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const MEDIA_ORIGIN = process.env.NEXION_MEDIA_INTERNAL_ORIGIN || "http://127.0.0.1:9000";
const MEDIA_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "video/mp4", "video/webm", "video/quicktime",
]);

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function backendPath(parts: string[]) {
  if (parts.length === 1 && parts[0] === "uploads") {
    return "/api/admin/media/uploads";
  }
  if (parts.length === 3 && parts[0] === "uploads" && parts[2] === "preview-url") {
    return `/api/admin/media/uploads/${encodeURIComponent(parts[1])}/preview-url`;
  }
  return null;
}

function publicAssetResponse(result: { code?: number; data?: { assetId?: string; previewUrl?: string } }) {
  const assetId = result.data?.assetId;
  if (result.code !== 0 || typeof assetId !== "string" || !assetId) {
    return jsonError(502, "MEDIA_RESPONSE_INVALID");
  }
  return Response.json({
    ...result,
    data: { ...result.data, previewUrl: `/api/admin/media/uploads/${encodeURIComponent(assetId)}/content` },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const contentRequest = path.length === 3 && path[0] === "uploads" && path[2] === "content";
  const targetPath = backendPath(contentRequest ? ["uploads", path[1], "preview-url"] : path);

  if (!targetPath) {
    return jsonError(404, "MEDIA_ROUTE_NOT_FOUND");
  }
  if (contentRequest && request.method !== "GET") return jsonError(405, "MEDIA_METHOD_NOT_ALLOWED");

  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`;
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (idempotencyKey) {
    headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: "no-store",
    });
    if (contentRequest) {
      if (!upstream.ok) return jsonError(upstream.status, "MEDIA_PREVIEW_UNAVAILABLE");
      const result = await upstream.json() as { code?: number; data?: { objectKey?: string; previewUrl?: string } };
      if (result.code !== 0 || !result.data?.previewUrl) return jsonError(502, "MEDIA_PREVIEW_UNAVAILABLE");
      if (!/^admin\/e\/sku-(?:image|video)\//.test(result.data.objectKey || "")) {
        return jsonError(403, "MEDIA_PREVIEW_SCOPE_DENIED");
      }

      const mediaUrl = new URL(result.data.previewUrl);
      if (mediaUrl.origin !== new URL(MEDIA_ORIGIN).origin || mediaUrl.username || mediaUrl.password) {
        return jsonError(502, "MEDIA_PREVIEW_ORIGIN_INVALID");
      }
      const range = request.headers.get("Range");
      const media = await fetch(mediaUrl, {
        headers: range ? { Range: range } : undefined,
        cache: "no-store",
        redirect: "error",
      });
      if (media.status === 416) {
        return new Response(null, { status: 416, headers: {
          "Content-Range": media.headers.get("Content-Range") || "bytes */*",
          "Cache-Control": "private, no-store",
        } });
      }
      if (media.status !== 200 && media.status !== 206) return jsonError(502, "MEDIA_STORAGE_UNAVAILABLE");
      const contentType = media.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
      if (!contentType || !MEDIA_TYPES.has(contentType)) return jsonError(502, "MEDIA_CONTENT_TYPE_INVALID");
      const responseHeaders = new Headers({
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      });
      for (const header of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
        const value = media.headers.get(header);
        if (value) responseHeaders.set(header, value);
      }
      return new Response(media.body, { status: media.status, headers: responseHeaders });
    }
    if (upstream.ok) {
      const result = await upstream.json() as { code?: number; data?: { assetId?: string; previewUrl?: string } };
      return publicAssetResponse(result);
    }
    return jsonError(upstream.status, "MEDIA_REQUEST_FAILED");
  } catch {
    return jsonError(503, "MEDIA_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}
