import { formatAdminApiError } from "@/lib/admin/error-messages";
import type { OpsTask } from "@/lib/admin/platform-types";

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
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
}

export interface E2TaskPricingClass {
  taskId: string;
  taskClass: "IG" | "VG" | "LL" | "FT" | "EM" | "SP";
  taskName: string;
  models: string[];
  minReward: number;
  maxReward: number;
  minVRAM: number;
  enabled: boolean;
  activeAssignments: number;
  avgSec: number;
  dailyPotential: number;
}

export interface E2TeaserRow {
  deviceClass: "cloud-share" | "phone" | "S1" | "Pro" | "Rack";
  vram: number;
  lockedTasks: string[];
  dailyPotential: number;
}

export interface E2TaskPricingSnapshot {
  taskClasses: E2TaskPricingClass[];
  queueSaturation: number;
  teaser: E2TeaserRow[];
  effectiveAt?: string;
}

function text(value: string | null | undefined) {
  return value == null ? "" : String(value).trim();
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
    throw new Error(formatAdminApiError(result?.message, `E2_REQUEST_FAILED_${response.status}`));
  }

  return result.data as T;
}

function fromTask(task: BackendTask): OpsTask {
  return {
    id: task.taskId,
    n: task.name,
    price: toNumber(task.price),
    unit: text(task.unit),
    req: text(task.requirement),
    sat: toSat(task.saturation),
    taskClass: text(task.taskClass),
    model: text(task.model),
    minReward: toNumber(task.minReward),
    maxReward: toNumber(task.maxReward),
    minVRAM: text(task.minVram),
    killInit: text(task.killInit),
  };
}

async function e2ConfigRequest<T>(path: "task-pricing" | "phone-tiers", init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");
  if (init?.idempotencyPrefix) headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  const response = await fetch(`/api/admin/config/${path}`, { ...init, headers, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(formatAdminApiError(result?.message, `E2_CONFIG_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

export async function fetchE2TaskPricing(): Promise<E2TaskPricingSnapshot> {
  const raw = await e2ConfigRequest<E2TaskPricingSnapshot>("task-pricing");
  return {
    ...raw,
    queueSaturation: toNumber(raw.queueSaturation, 0.35),
    taskClasses: (raw.taskClasses ?? []).map((row) => ({
      ...row,
      minReward: toNumber(row.minReward),
      maxReward: toNumber(row.maxReward),
      minVRAM: toNumber(row.minVRAM),
      avgSec: toNumber(row.avgSec),
      dailyPotential: toNumber(row.dailyPotential),
    })),
    teaser: (raw.teaser ?? []).map((row) => ({ ...row, vram: toNumber(row.vram), dailyPotential: toNumber(row.dailyPotential) })),
  };
}

export async function updateE2TaskPricing(
  patch: Partial<Pick<E2TaskPricingClass, "taskClass" | "minReward" | "maxReward" | "minVRAM" | "enabled">> & { queueSaturation?: number },
  reason: string,
  operator: string,
) {
  return e2ConfigRequest<{ effectiveAt: string; taskPricing: E2TaskPricingSnapshot }>("task-pricing", {
    method: "PUT",
    body: JSON.stringify({ ...patch, minVram: patch.minVRAM, minVRAM: undefined, reason, operator }),
    idempotencyPrefix: "e2-task-pricing",
  });
}

function toTaskPayload(task: OpsTask, reason: string, operator: string) {
  return {
    name: task.n,
    price: task.price,
    unit: task.unit,
    requirement: task.req,
    saturation: task.sat,
    status: "active",
    taskClass: task.taskClass,
    model: task.model || "",
    minReward: task.minReward ?? 0,
    maxReward: task.maxReward ?? 0,
    minVram: task.minVRAM || "",
    killInit: task.killInit || "",
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
  const pageSize = 100;
  let pageNum = 1;
  let total = Number.POSITIVE_INFINITY;
  const records: BackendTask[] = [];
  while (records.length < total) {
    const page = await e2Request<PageResult<BackendTask>>(`/tasks?pageNum=${pageNum}&pageSize=${pageSize}`);
    const current = page.records ?? [];
    records.push(...current);
    total = Math.max(0, Number(page.total ?? records.length));
    if (current.length === 0 || current.length < pageSize) break;
    pageNum += 1;
  }
  return records.map(fromTask);
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
