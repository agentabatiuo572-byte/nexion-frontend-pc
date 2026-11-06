import { cookies } from "next/headers";
import { ADMIN_TOKEN_COOKIE, requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const UPSTREAM_TIMEOUT_MS = Math.min(30_000, Math.max(1_000, Number(process.env.NEXION_BACKEND_TIMEOUT_MS) || 10_000));

function jsonError(status: number, message: string, unknown = false) {
  return Response.json({ code: status, message, data: null }, {
    status, headers: { "Cache-Control": "no-store", ...(unknown ? { "X-Nexion-Upstream-Outcome": "unknown" } : {}) },
  });
}

export async function POST(request: Request) {
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_AUTH_REQUIRED");
  if (new URL(request.url).search) return jsonError(422, "B0_EXPORT_REQUEST_INVALID");
  const commandKey = request.headers.get("Idempotency-Key")?.trim();
  if (!commandKey || commandKey.length > 128) return jsonError(422, "IDEMPOTENCY_KEY_INVALID");
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1
      || !("reason" in body) || typeof body.reason !== "string") return jsonError(422, "B0_EXPORT_REQUEST_INVALID");
  try {
    request.signal.throwIfAborted();
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/ops-dashboard/exports`, {
      method: "POST", cache: "no-store", redirect: "manual",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": commandKey },
      body: JSON.stringify({ reason: body.reason }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });
    if (upstream.status >= 300 && upstream.status < 400) return jsonError(502, "B0_EXPORT_BACKEND_REDIRECT_BLOCKED", true);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json", "Cache-Control": "no-store",
        ...(upstream.status >= 500 || upstream.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
          ? { "X-Nexion-Upstream-Outcome": "unknown" } : {}),
      },
    });
  } catch { return jsonError(503, "B0_EXPORT_BACKEND_UNAVAILABLE", true); }
}
