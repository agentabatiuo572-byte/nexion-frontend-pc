import { cookies } from "next/headers";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function isNonEmpty(value: string | undefined) {
  return !!value && value.trim().length > 0;
}

function backendPath(parts: string[]) {
  if (parts.length === 1 && parts[0] === "staking") {
    return "/api/admin/market/staking";
  }
  if (parts.length === 1 && parts[0] === "exchange") {
    return "/api/admin/market/exchange";
  }
  if (parts.length === 2 && parts[0] === "nex" && parts[1] === "curve") {
    return "/api/admin/market/nex/curve";
  }
  if (parts.length === 3 && parts[0] === "nex" && parts[1] === "curve" && parts[2] === "history") {
    return "/api/admin/market/nex/curve/history";
  }
  if (parts.length === 2 && parts[0] === "nex" && parts[1] === "repurchase") {
    return "/api/admin/market/nex/repurchase";
  }
  if (
    parts.length === 4 &&
    parts[0] === "nex" &&
    parts[1] === "repurchase" &&
    parts[2] === "params" &&
    isNonEmpty(parts[3])
  ) {
    return `/api/admin/market/nex/repurchase/params/${encodeURIComponent(parts[3])}`;
  }
  if (parts.length === 2 && parts[0] === "nex" && parts[1] === "genesis") {
    return "/api/admin/market/nex/genesis";
  }
  if (parts.length === 3 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "operations") {
    return "/api/admin/market/nex/genesis/operations";
  }
  if (
    parts.length === 5 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "operations" &&
    parts[3] === "config" && isNonEmpty(parts[4])
  ) {
    return `/api/admin/market/nex/genesis/operations/config/${encodeURIComponent(parts[4])}`;
  }
  if (parts.length === 4 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "operations" && parts[3] === "simulations") {
    return "/api/admin/market/nex/genesis/operations/simulations";
  }
  if (
    parts.length === 5 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "operations" &&
    parts[3] === "simulations" && isNonEmpty(parts[4])
  ) {
    return `/api/admin/market/nex/genesis/operations/simulations/${encodeURIComponent(parts[4])}`;
  }
  if (
    parts.length === 4 &&
    parts[0] === "nex" &&
    parts[1] === "genesis" &&
    parts[2] === "params" &&
    isNonEmpty(parts[3])
  ) {
    return `/api/admin/market/nex/genesis/params/${encodeURIComponent(parts[3])}`;
  }
  if (parts.length === 3 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "market-status") {
    return "/api/admin/market/nex/genesis/market-status";
  }
  if (
    parts.length === 5 &&
    parts[0] === "nex" &&
    parts[1] === "genesis" &&
    parts[2] === "dividend-batches" &&
    isNonEmpty(parts[3]) &&
    parts[4] === "rerun"
  ) {
    return `/api/admin/market/nex/genesis/dividend-batches/${encodeURIComponent(parts[3])}/rerun`;
  }
  if (parts.length === 3 && parts[0] === "nex" && parts[1] === "overrides" && isNonEmpty(parts[2])) {
    return `/api/admin/market/nex/overrides/${encodeURIComponent(parts[2])}`;
  }
  if (
    parts.length === 4 &&
    parts[0] === "nex" &&
    parts[1] === "curve" &&
    parts[2] === "controls" &&
    isNonEmpty(parts[3])
  ) {
    return `/api/admin/market/nex/curve/controls/${encodeURIComponent(parts[3])}`;
  }
  if (parts.length === 3 && parts[0] === "nex" && parts[1] === "curve" && parts[2] === "advance") {
    return "/api/admin/market/nex/curve/advance";
  }
  if (
    parts.length === 5 &&
    parts[0] === "staking" &&
    parts[1] === "pools" &&
    isNonEmpty(parts[2]) &&
    parts[3] === "params" &&
    isNonEmpty(parts[4])
  ) {
    return `/api/admin/market/staking/pools/${encodeURIComponent(parts[2])}/params/${encodeURIComponent(parts[4])}`;
  }
  if (
    parts.length === 4 &&
    parts[0] === "staking" &&
    parts[1] === "pools" &&
    isNonEmpty(parts[2]) &&
    (parts[3] === "sale-status" || parts[3] === "kill-status")
  ) {
    return `/api/admin/market/staking/pools/${encodeURIComponent(parts[2])}/${parts[3]}`;
  }
  if (
    parts.length === 3 &&
    parts[0] === "exchange" &&
    parts[1] === "orders" &&
    isNonEmpty(parts[2])
  ) {
    return `/api/admin/market/exchange/orders/${encodeURIComponent(parts[2])}`;
  }
  if (
    parts.length === 3 &&
    parts[0] === "exchange" &&
    parts[1] === "params" &&
    isNonEmpty(parts[2])
  ) {
    return `/api/admin/market/exchange/params/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 2 && parts[0] === "exchange" && parts[1] === "swap") {
    return "/api/admin/market/exchange/swap";
  }
  if (
    parts.length === 4 &&
    parts[0] === "exchange" &&
    parts[1] === "queue" &&
    isNonEmpty(parts[2]) &&
    (parts[3] === "cancel" || parts[3] === "kyc-review")
  ) {
    return `/api/admin/market/exchange/queue/${encodeURIComponent(parts[2])}/${parts[3]}`;
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "MARKET_ROUTE_NOT_FOUND");
  }

  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`;
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  if (idempotencyKey) {
    headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);
  }

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: "no-store",
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return jsonError(503, "MARKET_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
