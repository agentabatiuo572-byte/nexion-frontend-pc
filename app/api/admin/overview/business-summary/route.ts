import { cookies } from "next/headers";
import { ADMIN_TOKEN_COOKIE, requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";

export async function GET(request: Request) {
  const jar = await cookies();
  const blocked = requirePasswordChangeCleared(jar);
  if (blocked) return blocked;
  const token = jar.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return Response.json({ code: 401, message: "ADMIN_AUTH_REQUIRED", data: null }, { status: 401 });
  try {
    const upstream = await fetch(`${BACKEND_BASE_URL}/api/admin/overview/business-summary${new URL(request.url).search}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "manual", signal: request.signal,
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: 503, message: "B0_LOAD_FAILED_503", data: null }, { status: 503 });
  }
}
