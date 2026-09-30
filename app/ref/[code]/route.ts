type RouteContext = { params: Promise<{ code: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { code } = await params;
  return new Response(null, {
    status: 307,
    headers: { Location: `/app/#/pages/ref/code?code=${encodeURIComponent(code)}` },
  });
}
