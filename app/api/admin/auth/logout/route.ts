import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_PASSWORD_CHANGE_COOKIE, readAdminAccessToken } from "@/lib/admin/require-password-change-cleared";

const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";

function isSecureRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  return new URL(request.url).protocol === "https:";
}

export async function POST(request: Request) {
  // 受限态(强制改密未完成)也要能干净登出并吊销服务端会话。
  const token = readAdminAccessToken(await cookies());
  if (token) {
    try {
      const backendResponse = await fetch(`${BACKEND_BASE_URL}/api/admin/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!backendResponse.ok && backendResponse.status !== 401) {
        const unavailable = NextResponse.json(
          { code: 503, message: "ADMIN_LOGOUT_UNAVAILABLE", data: null },
          { status: 503 },
        );
        unavailable.headers.set("Cache-Control", "no-store");
        return unavailable;
      }
    } catch {
      const unavailable = NextResponse.json(
        { code: 503, message: "ADMIN_LOGOUT_UNAVAILABLE", data: null },
        { status: 503 },
      );
      unavailable.headers.set("Cache-Control", "no-store");
      return unavailable;
    }
  }
  const response = NextResponse.json({ code: 0, message: "OK", data: null });
  const secure = isSecureRequest(request);
  response.cookies.set(ADMIN_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.cookies.set(ADMIN_PASSWORD_CHANGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
