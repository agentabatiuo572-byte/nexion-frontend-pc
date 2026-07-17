import { NextResponse } from "next/server";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const ADMIN_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8;

interface BackendVerifyResult {
  code?: number;
  message?: string;
  data?: { accessToken?: unknown; tokenType?: unknown; session?: unknown };
}

function isSecureRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded ? forwarded === "https" : new URL(request.url).protocol === "https:";
}

function sessionMetadataHeaders(request: Request) {
  const headers: Record<string, string> = {};
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 512);
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim().slice(0, 64) ||
    request.headers.get("x-real-ip")?.trim().slice(0, 64);
  if (userAgent) headers["User-Agent"] = userAgent;
  if (clientIp) headers["X-Nexion-Client-IP"] = clientIp;
  return headers;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!challengeId || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ code: 422, message: "ADMIN_MFA_CODE_REQUIRED", data: null }, { status: 422 });
  }
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/auth/mfa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionMetadataHeaders(request) },
      body: JSON.stringify({ challengeId, code }),
      cache: "no-store",
    });
    const text = await upstream.text();
    const parsed = JSON.parse(text) as BackendVerifyResult;
    const accessToken = typeof parsed.data?.accessToken === "string" ? parsed.data.accessToken : "";
    if (!upstream.ok || parsed.code !== 0 || !accessToken || !parsed.data?.session) {
      return new Response(text, {
        status: upstream.status,
        headers: { "Content-Type": upstream.headers.get("Content-Type") || "application/json", "Cache-Control": "no-store" },
      });
    }
    const response = NextResponse.json({
      code: 0,
      message: parsed.message,
      data: { tokenType: typeof parsed.data.tokenType === "string" ? parsed.data.tokenType : "Bearer", session: parsed.data.session },
    });
    response.cookies.set(ADMIN_TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: ADMIN_TOKEN_MAX_AGE_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.json({ code: 503, message: "ADMIN_AUTH_UNAVAILABLE", data: null }, { status: 503 });
  }
}
