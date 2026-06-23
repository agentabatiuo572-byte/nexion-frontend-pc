import type { OpsTask } from "@/lib/store/admin/platform-config-store";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface PageResult<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
}

interface BackendTask {
  taskId: string;
  name: string;
  price?: number | string | null;
  unit?: string | null;
  requirement?: string | null;
  saturation?: number | string | null;
  status?: string | null;
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

function toSat(value: number | string | null | undefined) {
  const parsed = toNumber(value, 0);
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

async function e2Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
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
    throw new Error(result?.message || `E2_REQUEST_FAILED_${response.status}`);
  }

  return result.data as T;
}

function fromTask(task: BackendTask): OpsTask {
  return {
    id: task.taskId,
    n: task.name,
    price: toNumber(task.price),
    unit: task.unit || "/job",
    req: task.requirement || "S1+",
    sat: toSat(task.saturation),
  };
}

function toTaskPayload(task: OpsTask, reason: string, operator: string) {
  return {
    name: task.n,
    price: task.price,
    unit: task.unit,
    requirement: task.req,
    saturation: task.sat,
    status: "active",
    reason,
    operator,
  };
}

export async function fetchE2Tasks() {
  const page = await e2Request<PageResult<BackendTask>>("/tasks?pageNum=1&pageSize=100");
  return (page.records ?? []).map(fromTask);
}

export async function createE2Task(task: OpsTask, reason: string, operator: string) {
  const saved = await e2Request<BackendTask>("/tasks", {
    method: "POST",
    body: JSON.stringify(toTaskPayload(task, reason, operator)),
    idempotencyPrefix: "e2-task-create",
  });
  return fromTask(saved);
}

export async function updateE2Task(task: OpsTask, reason: string, operator: string) {
  const saved = await e2Request<BackendTask>(`/tasks/${encodeURIComponent(task.id)}`, {
    method: "PUT",
    body: JSON.stringify(toTaskPayload(task, reason, operator)),
    idempotencyPrefix: "e2-task-update",
  });
  return fromTask(saved);
}

export async function updateE2TaskPrice(taskId: string, price: number, reason: string, operator: string) {
  const saved = await e2Request<BackendTask>(`/tasks/${encodeURIComponent(taskId)}/price`, {
    method: "PATCH",
    body: JSON.stringify({ price, reason, operator }),
    idempotencyPrefix: "e2-task-price",
  });
  return fromTask(saved);
}

export async function deleteE2Task(taskId: string, reason: string, operator: string) {
  await e2Request<{ deleted: boolean }>(`/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
    body: JSON.stringify({ status: "inactive", reason, operator }),
    idempotencyPrefix: "e2-task-delete",
  });
}
