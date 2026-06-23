export interface E4Order {
  id: string;
  user: string;
  sku: string;
  amt: number;
  state: string;
  dc: string;
  age: string;
}

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface PageResult<T> {
  total?: number | string | null;
  pageNum?: number | string | null;
  pageSize?: number | string | null;
  records?: T[] | null;
}

interface BackendOrder {
  orderNo: string;
  userNo: string;
  skuId?: string | null;
  skuName?: string | null;
  amount?: number | string | null;
  state?: string | null;
  dcLocation?: string | null;
  ageText?: string | null;
  orderedAt?: string | null;
  updatedAt?: string | null;
}

export interface E4OrderQuery {
  state?: string;
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface E4OrderPage {
  total: number;
  pageNum: number;
  pageSize: number;
  records: E4Order[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeState(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "created";
}

async function e4Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/devices${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `E4_REQUEST_FAILED_${response.status}`);
  }

  return result.data as T;
}

function queryString(query: E4OrderQuery) {
  const params = new URLSearchParams();
  if (query.state && query.state !== "all") params.set("state", query.state);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  params.set("pageNum", String(query.pageNum ?? 1));
  params.set("pageSize", String(query.pageSize ?? 10));
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

function fromOrder(order: BackendOrder): E4Order {
  return {
    id: order.orderNo,
    user: order.userNo,
    sku: order.skuName || order.skuId || "未知 SKU",
    amt: toNumber(order.amount),
    state: normalizeState(order.state),
    dc: order.dcLocation?.trim() || "—",
    age: order.ageText?.trim() || "—",
  };
}

export async function fetchE4OrderPage(query: E4OrderQuery = {}): Promise<E4OrderPage> {
  const page = await e4Request<PageResult<BackendOrder>>(`/orders${queryString(query)}`);
  return {
    total: toNumber(page.total),
    pageNum: toNumber(page.pageNum, query.pageNum ?? 1),
    pageSize: toNumber(page.pageSize, query.pageSize ?? 10),
    records: (page.records ?? []).map(fromOrder),
  };
}

export async function fetchE4Orders(query: E4OrderQuery = {}) {
  const page = await fetchE4OrderPage(query);
  return page.records;
}

export async function refundE4Order(orderId: string, reason: string, operator: string) {
  const saved = await e4Request<BackendOrder>(`/orders/${encodeURIComponent(orderId)}/refund`, {
    method: "PATCH",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e4-order-refund",
  });
  return fromOrder(saved);
}

export async function cancelE4Order(orderId: string, reason: string, operator: string) {
  const saved = await e4Request<BackendOrder>(`/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "PATCH",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "e4-order-cancel",
  });
  return fromOrder(saved);
}

export async function terminalE4Order(orderId: string, terminalState: string, reason: string, operator: string) {
  const saved = await e4Request<BackendOrder>(`/orders/${encodeURIComponent(orderId)}/terminal`, {
    method: "PATCH",
    body: JSON.stringify({ terminalState, reason, operator }),
    idempotencyPrefix: "e4-order-terminal",
  });
  return fromOrder(saved);
}

export async function updateE4OrderState(orderId: string, state: string, reason: string, operator: string) {
  const saved = await e4Request<BackendOrder>(`/orders/${encodeURIComponent(orderId)}/state`, {
    method: "PATCH",
    body: JSON.stringify({ state, reason, operator }),
    idempotencyPrefix: "e4-order-state",
  });
  return fromOrder(saved);
}
