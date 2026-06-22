import { NextResponse } from "next/server";

const ADMIN_TOKEN_COOKIE = "nexion_admin_token";

export async function POST() {
  const response = NextResponse.json({ code: 0, message: "OK", data: null });
  response.cookies.set(ADMIN_TOKEN_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
