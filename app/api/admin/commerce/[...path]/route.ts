type RouteContext = { params: Promise<{ path?: string[] }> };

function retired() {
  return Response.json(
    { code: 410, message: "SANDBOX_RUNTIME_RETIRED", data: null },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(_request: Request, _context: RouteContext) {
  return retired();
}

export async function POST(_request: Request, _context: RouteContext) {
  return retired();
}
