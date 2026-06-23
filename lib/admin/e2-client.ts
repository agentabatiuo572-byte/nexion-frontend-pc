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
  taskClass?: string | null;
  model?: string | null;
  minReward?: number | string | null;
  maxReward?: number | string | null;
  minVram?: string | null;
  killInit?: string | null;
}

interface BackendPhoneTier {
  tier: number;
  name: string;
  note?: string | null;
  dailyUsdt?: number | string | null;
  dailyNex?: number | string | null;
  status?: string | null;
}

export interface E2PhoneTier {
  tier: number;
  name: string;
  note: string;
  dailyUsdt: number;
  dailyNex: number;
  status: string;
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
    taskClass: task.taskClass || "llm-inference",
    model: task.model || "",
    minReward: toNumber(task.minReward),
    maxReward: toNumber(task.maxReward),
    minVRAM: task.minVram || "",
    killInit: task.killInit || "派发中",
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
    taskClass: task.taskClass || "llm-inference",
    model: task.model || "",
    minReward: task.minReward ?? 0,
    maxReward: task.maxReward ?? 0,
    minVram: task.minVRAM || "",
    killInit: task.killInit || "派发中",
    reason,
    operator,
  };
}

function fromPhoneTier(tier: BackendPhoneTier): E2PhoneTier {
  return {
    tier: tier.tier,
    name: tier.name,
    note: tier.note || "",
    dailyUsdt: toNumber(tier.dailyUsdt),
    dailyNex: toNumber(tier.dailyNex),
    status: tier.status || "active",
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

export async function fetchE2PhoneTiers() {
  const tiers = await e2Request<BackendPhoneTier[]>("/phone-tiers");
  return (tiers ?? []).map(fromPhoneTier);
}

export async function updateE2PhoneTier(
  tier: number,
  patch: Partial<Pick<E2PhoneTier, "dailyUsdt" | "dailyNex">>,
  reason: string,
  operator: string,
) {
  const saved = await e2Request<BackendPhoneTier>(`/phone-tiers/${encodeURIComponent(String(tier))}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, reason, operator }),
    idempotencyPrefix: "e2-phone-tier",
  });
  return fromPhoneTier(saved);
}
