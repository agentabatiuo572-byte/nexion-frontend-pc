import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const ADMIN_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 8;

interface BackendPasswordChangeResult {
  code?: number;
  message?: string;
  data?: {
    accessToken?: unknown;
    tokenType?: unknown;
    session?: unknown;
  };
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ code: status, message, data: null }, { status });
}

function upstreamResponse(text: string, upstream: Response) {
  return new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isSecureRequest(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }
  return new URL(request.url).protocol === "https:";
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
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const body = await request.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) {
    return jsonError(422, "ADMIN_PASSWORD_REQUIRED");
  }

  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/auth/password/change`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...sessionMetadataHeaders(request),
      },
      body: JSON.stringify({ currentPassword, newPassword }),
      cache: "no-store",
    });
    const text = await upstream.text();
    let parsed: BackendPasswordChangeResult;
    try {
      parsed = JSON.parse(text) as BackendPasswordChangeResult;
    } catch {
      return upstreamResponse(text, upstream);
    }

    const accessToken = typeof parsed.data?.accessToken === "string" ? parsed.data.accessToken : "";
    if (!upstream.ok || parsed.code !== 0 || !accessToken || !parsed.data?.session) {
      return upstreamResponse(text, upstream);
    }

    const response = NextResponse.json(
      {
        code: parsed.code,
        message: parsed.message,
        data: {
          tokenType: typeof parsed.data.tokenType === "string" ? parsed.data.tokenType : "Bearer",
          session: parsed.data.session,
        },
      },
      { status: upstream.status },
    );
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
    return jsonError(503, "ADMIN_AUTH_UNAVAILABLE");
  }
}
