import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
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

const E2_TASK_CLASSES = ["IG", "VG", "LL", "FT", "EM", "SP"] as const;
const E2_TEASER_DEVICE_CLASSES = ["cloud-share", "phone", "S1", "Pro", "Rack"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pricingProtocol(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(`E2_TASK_PRICING_PROTOCOL_INVALID:${detail}`);
}

function isFiniteValue(value: unknown): boolean {
  return typeof value === "number" ? Number.isFinite(value)
    : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value));
}

function finiteValue(value: unknown): number | null {
  return isFiniteValue(value) ? Number(value) : null;
}

function assertE2TaskPricingSnapshot(raw: unknown): asserts raw is E2TaskPricingSnapshot {
  pricingProtocol(isRecord(raw), "taskPricing protocol requires a data object");
  pricingProtocol(Array.isArray(raw.taskClasses), "taskClasses must be an array");
  pricingProtocol(Array.isArray(raw.teaser), "teaser must be an array");
  const queueSaturation = finiteValue(raw.queueSaturation);
  pricingProtocol(queueSaturation != null && queueSaturation >= 0 && queueSaturation <= 1, "queueSaturation must be between 0 and 1");
  pricingProtocol(raw.taskClasses.length === E2_TASK_CLASSES.length, "taskClasses must contain the exact six canonical classes");
  pricingProtocol(raw.teaser.length === E2_TEASER_DEVICE_CLASSES.length, "teaser must contain the exact five device classes");

  const taskClasses = new Set<string>();
  for (const row of raw.taskClasses) {
    pricingProtocol(isRecord(row), "taskClasses row must be an object");
    pricingProtocol(typeof row.taskId === "string" && row.taskId.trim() !== "", "taskClasses row requires taskId");
    pricingProtocol(typeof row.taskClass === "string" && E2_TASK_CLASSES.includes(row.taskClass as typeof E2_TASK_CLASSES[number]), "taskClasses row has an unknown taskClass");
    pricingProtocol(typeof row.taskName === "string" && row.taskName.trim() !== "", "taskClasses row requires taskName");
    pricingProtocol(Array.isArray(row.models) && row.models.every((model) => typeof model === "string"), "taskClasses row requires models");
    pricingProtocol(typeof row.enabled === "boolean", "taskClasses row requires enabled");
    for (const field of ["minReward", "maxReward", "minVRAM", "activeAssignments", "avgSec", "dailyPotential"]) {
      pricingProtocol(isFiniteValue(row[field]), `taskClasses row requires finite ${field}`);
    }
    const minReward = finiteValue(row.minReward);
    const maxReward = finiteValue(row.maxReward);
    pricingProtocol(minReward != null && maxReward != null && minReward >= 0 && maxReward >= minReward, "taskClasses row minReward and maxReward must be non-negative and ordered");
    for (const field of ["minVRAM", "activeAssignments", "avgSec", "dailyPotential"]) {
      const value = finiteValue(row[field]);
      pricingProtocol(value != null && value >= 0, "taskClasses row requires non-negative minVRAM, activeAssignments, avgSec, and dailyPotential");
    }
    taskClasses.add(row.taskClass);
  }
  pricingProtocol(taskClasses.size === E2_TASK_CLASSES.length && E2_TASK_CLASSES.every((taskClass) => taskClasses.has(taskClass)), "taskClasses must not omit or duplicate canonical classes");

  const deviceClasses = new Set<string>();
  for (const row of raw.teaser) {
    pricingProtocol(isRecord(row), "teaser row must be an object");
    pricingProtocol(typeof row.deviceClass === "string" && E2_TEASER_DEVICE_CLASSES.includes(row.deviceClass as typeof E2_TEASER_DEVICE_CLASSES[number]), "teaser row has an unknown deviceClass");
    const vram = finiteValue(row.vram);
    const dailyPotential = finiteValue(row.dailyPotential);
    pricingProtocol(vram != null && vram >= 0 && dailyPotential != null && dailyPotential >= 0, "teaser row requires non-negative numeric values");
    pricingProtocol(Array.isArray(row.lockedTasks) && row.lockedTasks.every((task) => typeof task === "string"), "teaser row requires lockedTasks");
    deviceClasses.add(row.deviceClass);
  }
  pricingProtocol(deviceClasses.size === E2_TEASER_DEVICE_CLASSES.length && E2_TEASER_DEVICE_CLASSES.every((deviceClass) => deviceClasses.has(deviceClass)), "teaser must not omit or duplicate device classes");
}

async function e2Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await guardedFetch(`/api/admin/devices${path}`, {
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
  const response = await guardedFetch(`/api/admin/config/${path}`, { ...init, headers, cache: "no-store" });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    throw new Error(formatAdminApiError(result?.message, `E2_CONFIG_REQUEST_FAILED_${response.status}`));
  }
  return result.data as T;
}

export async function fetchE2TaskPricing(): Promise<E2TaskPricingSnapshot> {
  const raw = await e2ConfigRequest<unknown>("task-pricing");
  assertE2TaskPricingSnapshot(raw);
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
