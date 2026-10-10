import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ADMIN_TOKEN_COOKIE, ADMIN_TOKEN_MAX_AGE_SECONDS, requirePasswordChangeCleared, sessionRequiresPasswordChange } from "@/lib/admin/require-password-change-cleared";
import { ADMIN_AUTH_UPSTREAM_TIMEOUT_MS, fetchAdminAuthBffResponse } from "@/lib/admin/auth-deadline";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";

interface BackendActivityResult {
  code: number;
  message?: string;
  data?: { accessToken?: unknown; tokenType?: unknown; session?: { adminId?: unknown } };
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ code: status, message, data: null }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return jsonError(401, "ADMIN_SESSION_MISSING");
  const body = await request.json().catch(() => null);
  const expectedAdminId = body?.expectedAdminId;
  if (!Number.isSafeInteger(expectedAdminId) || expectedAdminId <= 0) return jsonError(422, "ADMIN_ACTIVITY_ID_REQUIRED");

  const upstreamResult = await fetchAdminAuthBffResponse(`${BACKEND_BASE_URL}/api/admin/auth/activity`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expectedAdminId }),
    cache: "no-store",
  }, (response) => response.text(), { timeoutMs: ADMIN_AUTH_UPSTREAM_TIMEOUT_MS });
  if (!upstreamResult.ok) return upstreamResult.response;
  const { response: upstream, value: text } = upstreamResult;
  if (upstream.status === 401) return jsonError(401, "ADMIN_AUTH_REQUIRED");
  let parsed: BackendActivityResult;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isInteger((value as BackendActivityResult).code)) {
      return jsonError(503, "ADMIN_SESSION_UNAVAILABLE");
    }
    parsed = value as BackendActivityResult;
  }
  catch { return jsonError(503, "ADMIN_SESSION_UNAVAILABLE"); }
  if (!upstream.ok || parsed.code !== 0) {
    return NextResponse.json({ code: parsed.code, message: parsed.message, data: null }, {
      status: upstream.status, headers: { "Cache-Control": "no-store" },
    });
  }
  const accessToken = typeof parsed.data?.accessToken === "string" ? parsed.data.accessToken : "";
  const session = parsed.data?.session;
  if (!accessToken || !session || sessionRequiresPasswordChange(session)) return jsonError(503, "ADMIN_SESSION_INVALID");
  if (session.adminId !== expectedAdminId) return jsonError(409, "ADMIN_ACTIVITY_IDENTITY_MISMATCH");

  const response = NextResponse.json({ code: 0, message: parsed.message || "success", data: {
    tokenType: typeof parsed.data?.tokenType === "string" ? parsed.data.tokenType : "Bearer", session,
  } });
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  response.cookies.set(ADMIN_TOKEN_COOKIE, accessToken, {
    httpOnly: true, sameSite: "strict", path: "/",
    secure: forwarded ? forwarded === "https" : new URL(request.url).protocol === "https:",
    maxAge: ADMIN_TOKEN_MAX_AGE_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
