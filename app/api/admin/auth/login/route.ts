import { NextResponse } from "next/server";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const ADMIN_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 12;

interface BackendLoginResult {
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

// 本地预览模式统一开关(与 E1/数据 route handler 共用):=1 时不调真后端,全走本地 mock。
const LOCAL_PREVIEW = process.env.NEXT_PUBLIC_ADMIN_AUTH_BYPASS === "1";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  // 本地预览模式:不调真后端(8110),任意账号密码(含空)直接种本地 superadmin session + token cookie。
  // 协作者真登录代码保持不动(下方 try 块);仅 LOCAL_PREVIEW=1 时短路。
  if (LOCAL_PREVIEW) {
    const response = NextResponse.json(
      {
        code: 0,
        message: "OK (local preview)",
        data: {
          tokenType: "Bearer",
          session: {
            adminId: 1,
            username: username || "local",
            operator: "本地预览",
            role: "superadmin",
            authorities: [],
          },
        },
      },
      { status: 200 },
    );
    response.cookies.set(ADMIN_TOKEN_COOKIE, "local-preview-token", {
      httpOnly: true,
      sameSite: "strict",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: ADMIN_TOKEN_MAX_AGE_SECONDS,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  if (!username || !password) {
    return jsonError(401, "ADMIN_CREDENTIAL_INVALID");
  }

  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    const text = await upstream.text();
    let parsed: BackendLoginResult;
    try {
      parsed = JSON.parse(text) as BackendLoginResult;
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
