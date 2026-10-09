import { cookies } from "next/headers";
import { ADMIN_TOKEN_COOKIE, requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";
import { boundedUpload } from "@/lib/admin/support-image-proxy";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
const DEFAULT_UPLOAD_TRANSPORT_MAX_BYTES = 32 * 1024 * 1024;

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
  const allowedHeads = new Set([
    "conversations",
    "tickets",
    "knowledge",
    "session-templates",
    "support-agents",
    "support-workbench",
    "templates",
    "nova",
    "copy-ab",
    "campaigns",
    "trust-disclosure",
    "i18n-learning",
    "how-it-works",
    "privacy-policy",
  ]);
  if (!allowedHeads.has(parts[0])) return null;
  if (parts.some((part) => !isSafePart(part))) return null;
  return `/api/admin/content/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  if (path.some((part) => part.toLowerCase().includes("acceptance") || part.toLowerCase().includes("sandbox"))) {
    return jsonError(410, "SANDBOX_RETIRED");
  }
  const targetPath = backendPath(path);
  if (!targetPath) return jsonError(404, "CONTENT_ROUTE_NOT_FOUND");
  const attachmentUpload = request.method === "POST"
    && (path.length === 2 && path[0] === "conversations" && path[1] === "attachments"
      || path.length === 3 && path[0] === "support-workbench" && path[1] === "bulk" && path[2] === "attachments");
  const publicLeaderboardAvatar = request.method === "GET" && path.length === 4 && path[0] === "support-workbench"
    && path[1] === "leaderboard" && /^[1-9]\d*$/.test(path[2]) && path[3] === "avatar";
  const avatarContent = request.method === "GET" && (path.length === 3 && path[0] === "support-agents" && path[2] === "avatar"
    || path.length === 4 && path[0] === "support-workbench" && path[1] === "customers" && path[3] === "avatar"
    || publicLeaderboardAvatar);
  const attachmentContent = request.method === "GET"
    && (path.length === 4 && path[0] === "conversations" && path[1] === "attachments" && path[3] === "content"
      || avatarContent);

  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");

  const sourceUrl = new URL(request.url);
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  if (attachmentContent) {
    const range = request.headers.get("Range");
    if (range) headers.set("Range", range);
  }

  let uploadBody: ArrayBuffer | undefined;
  if (attachmentUpload) {
    // Transport safety ceiling; the backend attachment policy is the product limit.
    const maxBytes = process.env.NEXION_SUPPORT_ATTACHMENT_PROXY_MAX_BYTES === undefined
      ? DEFAULT_UPLOAD_TRANSPORT_MAX_BYTES : Number(process.env.NEXION_SUPPORT_ATTACHMENT_PROXY_MAX_BYTES);
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return jsonError(503, "CONTENT_ATTACHMENT_LIMIT_UNCONFIGURED");
    const declaredSize = Number(request.headers.get("Content-Length"));
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) return jsonError(413, "CONTENT_ATTACHMENT_TOO_LARGE");
    const read = await boundedUpload(request, maxBytes).catch(() => undefined);
    if (read === undefined) return jsonError(503, "CONTENT_ATTACHMENT_UPLOAD_INTERRUPTED");
    if (!read) return jsonError(413, "CONTENT_ATTACHMENT_TOO_LARGE");
    uploadBody = read;
  }

  try {
    request.signal.throwIfAborted();
    const upstream = await fetch(`${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD"
        ? undefined : attachmentUpload ? uploadBody : await request.text(),
      cache: "no-store",
      redirect: "manual",
      signal: attachmentContent || attachmentUpload ? AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]) : request.signal,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      return jsonError(502, "CONTENT_BACKEND_REDIRECT_BLOCKED");
    }
    const upstreamType = upstream.headers.get("Content-Type") || "application/json";
    if (!attachmentContent && upstreamType.includes("text/event-stream") && upstream.body) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstreamType,
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    if (attachmentContent) {
      if (!upstream.ok) return jsonError(upstream.status, "CONTENT_ATTACHMENT_READ_FAILED");
      if (!upstream.body) return jsonError(502, "CONTENT_ATTACHMENT_EMPTY");
      if (!["image/jpeg", "image/png", "image/webp"].includes(upstreamType.split(";")[0].toLowerCase())) {
        return jsonError(502, "CONTENT_ATTACHMENT_TYPE_INVALID");
      }
      if (avatarContent) {
        const limit = Number(process.env.NEXION_SUPPORT_ATTACHMENT_PROXY_MAX_BYTES ?? DEFAULT_UPLOAD_TRANSPORT_MAX_BYTES);
        if (!Number.isSafeInteger(limit) || limit <= 0) return jsonError(503, "CONTENT_ATTACHMENT_LIMIT_UNCONFIGURED");
        if (!(path[0]==="support-workbench" && !publicLeaderboardAvatar?["image/jpeg","image/png","image/webp"]:["image/jpeg","image/png"]).includes(upstreamType.split(";")[0].toLowerCase())) return jsonError(502, "CONTENT_ATTACHMENT_TYPE_INVALID");
        const bytes = await boundedUpload(upstream, limit);
        if (!bytes || !bytes.byteLength) return jsonError(502, "CONTENT_ATTACHMENT_EMPTY");
        return new Response(bytes, { status: upstream.status, headers: { "Content-Type": upstreamType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
      }
      const reader = upstream.body.getReader();
      let first = await reader.read();
      while (!first.done && first.value.byteLength === 0) first = await reader.read();
      if (first.done) return jsonError(502, "CONTENT_ATTACHMENT_EMPTY");
      const imageBody = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(first.value); },
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) controller.close(); else controller.enqueue(chunk.value);
          } catch (error) { controller.error(error); }
        },
        cancel(reason) { return reader.cancel(reason); },
      });
      const responseHeaders = new Headers({
        "Content-Type": upstreamType,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      for (const name of ["Content-Range", "Accept-Ranges", "Content-Disposition"]) {
        const value = upstream.headers.get(name);
        if (value) responseHeaders.set(name, value);
      }
      return new Response(imageBody, { status: upstream.status, headers: responseHeaders });
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstreamType,
        "Cache-Control": "no-store",
        ...(upstream.headers.get("X-Nexion-Upstream-Outcome") ? { "X-Nexion-Upstream-Outcome": upstream.headers.get("X-Nexion-Upstream-Outcome")! } : {}),
      },
    });
  } catch {
    return jsonError(503, "CONTENT_BACKEND_UNAVAILABLE");
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

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
