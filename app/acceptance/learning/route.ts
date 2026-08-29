import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { code: 410, message: "SANDBOX_RUNTIME_RETIRED", data: null },
    { status: 410 },
  );
}
