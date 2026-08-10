import { cookies } from "next/headers";
import { requirePasswordChangeCleared } from "@/lib/admin/require-password-change-cleared";

const BACKEND_BASE_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function jsonError(status: number, message: string) {
  return Response.json({ code: status, message, data: null }, { status });
}

function isText(value: string | undefined) {
  return !!value && value.trim().length > 0;
}

function backendPath(parts: string[]) {
  if (parts.length === 2 && parts[0] === "vietqr" && ["overview", "accounts", "config"].includes(parts[1])) {
    return `/api/admin/finance/vietqr/${parts[1]}`;
  }
  if (parts.length === 3 && parts[0] === "vietqr" && parts[1] === "accounts" && /^\d+$/.test(parts[2])) {
    return `/api/admin/finance/vietqr/accounts/${parts[2]}`;
  }
  if (parts.length === 5 && parts[0] === "vietqr" && parts[1] === "reconciliations"
      && /^\d+$/.test(parts[2]) && parts[3] === "actions"
      && ["match-credit", "write-off", "return"].includes(parts[4])) {
    return `/api/admin/finance/vietqr/reconciliations/${parts[2]}/actions/${parts[4]}`;
  }
  if (parts.length === 1 && parts[0] === "fx-quote") {
    return "/api/admin/finance/fx-quote";
  }
  if (parts.length === 2 && parts[0] === "payout-vnd" && ["config", "channel"].includes(parts[1])) {
    return `/api/admin/finance/payout-vnd/${parts[1]}`;
  }
  if (parts.length === 2 && parts[0] === "topup" && ["overview", "flows"].includes(parts[1])) {
    return `/api/admin/finance/topup/${parts[1]}`;
  }
  if (parts.length === 4 && parts[0] === "topup" && parts[1] === "channels" && isText(parts[2]) && ["enabled", "fee", "min-amount", "max-amount"].includes(parts[3])) {
    return `/api/admin/finance/topup/channels/${encodeURIComponent(parts[2])}/${parts[3]}`;
  }
  if (parts.length === 3 && parts[0] === "topup" && parts[1] === "psp" && parts[2] === "primary") {
    return "/api/admin/finance/topup/psp/primary";
  }
  if (parts.length === 3 && parts[0] === "topup" && parts[1] === "card-risk" && isText(parts[2])) {
    return `/api/admin/finance/topup/card-risk/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 4 && parts[0] === "topup" && parts[1] === "reconciliation" && isText(parts[2]) && parts[3] === "writeoff") {
    return `/api/admin/finance/topup/reconciliation/${encodeURIComponent(parts[2])}/writeoff`;
  }
  if (parts.length === 2 && parts[0] === "topup" && parts[1] === "bin-locks") {
    return "/api/admin/finance/topup/bin-locks";
  }
  if (parts.length === 3 && parts[0] === "topup" && parts[1] === "bin-locks" && isText(parts[2])) {
    return `/api/admin/finance/topup/bin-locks/${encodeURIComponent(parts[2])}`;
  }
  if (parts.length === 4 && parts[0] === "topup" && parts[1] === "chargebacks" && isText(parts[2]) && parts[3] === "refund") {
    return `/api/admin/finance/topup/chargebacks/${encodeURIComponent(parts[2])}/refund`;
  }
  if (parts.length === 1 && parts[0] === "withdrawal-params") {
    return "/api/admin/finance/withdrawal-params";
  }
  if (parts.length === 1 && parts[0] === "withdrawals") {
    return "/api/admin/finance/withdrawals";
  }
  if (parts.length === 2 && parts[0] === "withdrawals" && isText(parts[1])) {
    return `/api/admin/finance/withdrawals/${encodeURIComponent(parts[1])}`;
  }
  if (parts.length === 3 && parts[0] === "withdrawals" && isText(parts[1]) && parts[2] === "review") {
    return `/api/admin/finance/withdrawals/${encodeURIComponent(parts[1])}/review`;
  }
  return null;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "FINANCE_ROUTE_NOT_FOUND");
  }

  const passwordChangeBlocked = requirePasswordChangeCleared(await cookies());
  if (passwordChangeBlocked) return passwordChangeBlocked;
  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) {
    return jsonError(401, "ADMIN_AUTH_REQUIRED");
  }

  const sourceUrl = new URL(request.url);
  const targetUrl = `${BACKEND_BASE_URL}${targetPath}${sourceUrl.search}`;
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  const contentType = request.headers.get("Content-Type");
  const idempotencyKey = request.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (contentType) headers.set("Content-Type", contentType);
  if (idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, idempotencyKey);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  try {
    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const responseHeaders = new Headers({
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store",
    });
    const outcome = upstream.headers.get("X-Nexion-Upstream-Outcome");
    if (outcome) responseHeaders.set("X-Nexion-Upstream-Outcome", outcome);
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch {
    const response = jsonError(503, "FINANCE_BACKEND_UNAVAILABLE");
    if (hasBody) response.headers.set("X-Nexion-Upstream-Outcome", "unknown");
    return response;
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}
