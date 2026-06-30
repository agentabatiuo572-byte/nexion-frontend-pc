import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

interface BackendSessionResult {
  code?: number;
  message?: string;
  data?: unknown;
}

function jsonError(status: number, message: string) {
  return NextResponse.json({ code: status, message, data: null }, { status });
}

export async function GET() {
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_SESSION_MISSING");
  }

  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const text = await upstream.text();
    let parsed: BackendSessionResult;
    try {
      parsed = JSON.parse(text) as BackendSessionResult;
    } catch {
      return new Response(text, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
          "Cache-Control": "no-store",
        },
      });
    }

    if (!upstream.ok || parsed.code !== 0 || !parsed.data) {
      return NextResponse.json(parsed, { status: upstream.status });
    }

    const response = NextResponse.json({
      code: 0,
      message: parsed.message || "success",
      data: {
        tokenType: "Bearer",
        session: parsed.data,
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return jsonError(503, "ADMIN_SESSION_UNAVAILABLE");
  }
}
