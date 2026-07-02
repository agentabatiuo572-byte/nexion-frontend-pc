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

function backendPath(parts: string[]) {
  const isOverview = parts[0] === "overview" && parts.length === 1;
  const isSkuCollection = parts[0] === "skus" && parts.length === 1;
  const isSku = parts[0] === "skus" && parts.length === 2 && !!parts[1];
  const isSkuStatus = parts[0] === "skus" && parts.length === 3 && !!parts[1] && parts[2] === "status";
  const isReviewCollection = parts[0] === "reviews" && parts.length === 1;
  const isReview = parts[0] === "reviews" && parts.length === 2 && !!parts[1];
  const isReviewStatus = parts[0] === "reviews" && parts.length === 3 && !!parts[1] && parts[2] === "status";
  const isGenerationGateCollection = parts[0] === "generation-gates" && parts.length === 1;
  const isGenerationGate = parts[0] === "generation-gates" && parts.length === 2 && !!parts[1];
  const isTaskCollection = parts[0] === "tasks" && parts.length === 1;
  const isTask = parts[0] === "tasks" && parts.length === 2 && !!parts[1];
  const isTaskAction = parts[0] === "tasks" && parts.length === 3 && !!parts[1] && (parts[2] === "price" || parts[2] === "status");
  const isPhoneTierCollection = parts[0] === "phone-tiers" && parts.length === 1;
  const isPhoneTier = parts[0] === "phone-tiers" && parts.length === 2 && !!parts[1];
  const isOrderCollection = parts[0] === "orders" && parts.length === 1;
  const isOrderAction = parts[0] === "orders" && parts.length === 3 && !!parts[1] && (parts[2] === "refund" || parts[2] === "cancel" || parts[2] === "terminal" || parts[2] === "state");
  const isE3Overview = parts[0] === "e3" && parts[1] === "overview" && parts.length === 2;
  const isE3Config = parts[0] === "e3" && parts[1] === "config" && parts.length === 2;
  const isE3TradeinOverview = parts[0] === "e3" && parts[1] === "tradein" && parts[2] === "overview" && parts.length === 3;
  const isE3TradeinAction = parts[0] === "e3" && parts[1] === "tradein" && parts.length === 3 && ["recycle", "replace", "deactivate"].includes(parts[2]);
  const isDeviceRestore = parts.length === 2 && /^[1-9]\d*$/.test(parts[0]) && parts[1] === "restore";
  const isDatacenterCollection = parts[0] === "datacenters" && parts.length === 1;
  const isDatacenterItem = parts[0] === "datacenters" && parts.length === 2 && !!parts[1];
  const isDatacenterAction = parts[0] === "datacenters" && parts.length === 3 && !!parts[1] && (parts[2] === "pause" || parts[2] === "resume");
  if (
    !isOverview
    && !isSkuCollection
    && !isSku
    && !isSkuStatus
    && !isReviewCollection
    && !isReview
    && !isReviewStatus
    && !isGenerationGateCollection
    && !isGenerationGate
    && !isTaskCollection
    && !isTask
    && !isTaskAction
    && !isPhoneTierCollection
    && !isPhoneTier
    && !isOrderCollection
    && !isOrderAction
    && !isE3Overview
    && !isE3Config
    && !isE3TradeinOverview
    && !isE3TradeinAction
    && !isDeviceRestore
    && !isDatacenterCollection
    && !isDatacenterItem
    && !isDatacenterAction
  ) {
    return null;
  }
  const encodedPath = parts.map(encodeURIComponent).join("/");
  if (parts[0] === "generation-gates") {
    return `/api/admin/devices/e1/${encodedPath}`;
  }
  return `/api/admin/devices/${encodedPath}`;
}

async function proxy(request: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const targetPath = backendPath(path);

  if (!targetPath) {
    return jsonError(404, "DEVICES_ROUTE_NOT_FOUND");
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
    return jsonError(503, "DEVICES_BACKEND_UNAVAILABLE");
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxy(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxy(request, context);
}
