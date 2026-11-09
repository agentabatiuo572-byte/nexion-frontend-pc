import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { TASK_CLASSES } from "@/lib/admin/task-classes";

export type TaskClass = typeof TASK_CLASSES[number];
export interface PoolProduct { productKey: string; productName: string; state: "PUBLISHED" | "DRAFT" | "DELISTED_WITH_DEVICES" }
export interface TaskPool {
  code: string; kind: "DEVICE" | "PHONE"; level: number | null; name: string; sortOrder: number;
  taskCount: number; enabledCount: number; avgDurationMinutes: string | null; estTasksPerDevicePerDay: string | null;
  referencedBy: PoolProduct[];
}
export interface PoolTask {
  taskTypeId: string; name: string; taskClass: TaskClass; durationMinutes: number;
  enabled: boolean; version: number; effectiveAt: string;
}
export interface PhonePoolTask extends PoolTask { baseReward: string; asset: "USDT" | "UVT" }
export interface PoolTaskPage<T = PoolTask> { records: T[]; total: number }
export interface DisableImpact { productsLosingAllTasks: Pick<PoolProduct, "productKey" | "productName">[]; devicesAffected: number }
export interface RandomTaskInput { count: number; taskClasses?: TaskClass[]; idempotencyKey: string; reason: string }
export interface TaskStatusInput { taskTypeIds: string[]; enabled: boolean; idempotencyKey: string; reason: string }
export interface RandomTaskResult { created: PoolTask[]; pool: TaskPool }
export interface TaskStatusResult { updated: number; pool: TaskPool }
export interface PoolLimitErrorData { limit: number; enabled?: number; total?: number; requested: number }
export type TaskPoolErrorCode = "TASK_POOL_FORMAT_RETIRED" | "TASK_POOL_HAS_TASKS" | "TASK_POOL_IN_USE" | "TASK_POOL_KIND_FORBIDDEN" | "TASK_POOL_ENABLED_LIMIT" | "TASK_POOL_TOTAL_LIMIT" | "TASK_POOL_IDEMPOTENCY_CONFLICT" | "TASK_TYPE_NOT_IN_POOL";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("任务池数据格式不完整，请刷新重试。");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("任务池文字数据不完整，请刷新重试。");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("任务池数量数据不完整，请刷新重试。");
  return value;
}
function decimal(value: unknown): string {
  const result = string(value);
  if (!/^\d+(?:\.\d+)?$/.test(result)) throw new Error("任务池金额或时长数据不完整，请刷新重试。");
  return result;
}
function product(value: unknown): PoolProduct {
  const row = record(value);
  if (!["PUBLISHED", "DRAFT", "DELISTED_WITH_DEVICES"].includes(String(row.state))) throw new Error("商品引用状态无效，请刷新重试。");
  return { productKey: string(row.productKey), productName: string(row.productName), state: row.state as PoolProduct["state"] };
}
export function parseTaskPool(value: unknown): TaskPool {
  const row = record(value);
  if (row.kind !== "DEVICE" && row.kind !== "PHONE" || !Array.isArray(row.referencedBy)) throw new Error("任务等级数据不完整，请刷新重试。");
  return { code: string(row.code), kind: row.kind, level: row.kind === "PHONE" && row.level === null ? null : integer(row.level), name: string(row.name), sortOrder: integer(row.sortOrder),
    taskCount: integer(row.taskCount), enabledCount: integer(row.enabledCount),
    avgDurationMinutes: row.avgDurationMinutes === null ? null : decimal(row.avgDurationMinutes),
    estTasksPerDevicePerDay: row.estTasksPerDevicePerDay === null ? null : decimal(row.estTasksPerDevicePerDay), referencedBy: row.referencedBy.map(product) };
}
function task(value: unknown): PoolTask {
  const row = record(value);
  if (!TASK_CLASSES.includes(row.taskClass as TaskClass) || typeof row.enabled !== "boolean") throw new Error("任务类型或状态无效，请刷新重试。");
  return { taskTypeId: string(row.taskTypeId), name: string(row.name), taskClass: row.taskClass as TaskClass, durationMinutes: integer(row.durationMinutes),
    enabled: row.enabled, version: integer(row.version), effectiveAt: string(row.effectiveAt) };
}

async function request(path: string, method = "GET", body?: object): Promise<unknown> {
  const response = await guardedFetch(`/api/admin/devices${path}`, { method, cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  const envelope = record(result);
  if (!response.ok || envelope.code !== 0) {
    const code = String(envelope.message ?? "");
    let message = formatAdminApiError(code, "任务池操作失败，请稍后重试。");
    if (code === "TASK_POOL_ENABLED_LIMIT" || code === "TASK_POOL_TOTAL_LIMIT") {
      const data = record(envelope.data);
      const limit = integer(data.limit); const requested = integer(data.requested);
      const currentValue = code === "TASK_POOL_ENABLED_LIMIT" ? data.enabled : data.total;
      const current = currentValue == null ? null : integer(currentValue);
      message = `${code === "TASK_POOL_ENABLED_LIMIT" ? "启用任务" : "任务总数"}上限为 ${limit} 个${current == null ? "" : `，当前 ${current} 个`}，本次 ${requested} 个。请减少数量${code === "TASK_POOL_ENABLED_LIMIT" ? "或先停用部分任务" : ""}。`;
    } else if (code === "TASK_POOL_IN_USE" && envelope.data) {
      const data = record(envelope.data);
      if (Array.isArray(data.referencedBy)) message = `不能删除：仍被商品 ${data.referencedBy.map(product).map(row => row.productName).join("、")} 引用（含草稿和下架商品）。`;
    }
    throw new Error(message);
  }
  return envelope.data;
}
export async function fetchTaskPools(kind: TaskPool["kind"] = "DEVICE"): Promise<TaskPool[]> {
  const raw = await request(`/task-pools?kind=${kind}`);
  if (!Array.isArray(raw)) throw new Error("任务池列表不完整，请刷新重试。");
  return raw.map(parseTaskPool);
}
export interface PoolTaskQuery { taskClass?: string; enabled?: string; pageNum?: number; pageSize?: number }
export function fetchPoolTasks(code: "PHONE", query?: PoolTaskQuery): Promise<PoolTaskPage<PhonePoolTask>>;
export function fetchPoolTasks(code: string, query?: PoolTaskQuery): Promise<PoolTaskPage>;
export async function fetchPoolTasks(code: string, query: PoolTaskQuery = {}): Promise<PoolTaskPage> {
  const params = new URLSearchParams({ pageNum: String(query.pageNum ?? 1), pageSize: String(query.pageSize ?? 20) });
  if (query.taskClass) params.set("taskClass", query.taskClass);
  if (query.enabled) params.set("enabled", query.enabled);
  const raw = record(await request(`/task-pools/${encodeURIComponent(code)}/tasks?${params}`));
  if (!Array.isArray(raw.records)) throw new Error("任务列表不完整，请刷新重试。");
  const records = raw.records.map(value => {
    const parsed = task(value);
    if (code !== "PHONE") return parsed;
    const row = record(value);
    if (row.asset !== "USDT" && row.asset !== "UVT") throw new Error("手机任务奖励资产无效，请刷新重试。");
    return { ...parsed, baseReward: decimal(row.baseReward), asset: row.asset };
  });
  return { total: integer(raw.total), records };
}
export async function saveTaskPool(code: string | null, name: string, reason: string): Promise<void> {
  await request(`/task-pools${code ? `/${encodeURIComponent(code)}` : ""}`, code ? "PATCH" : "POST", { name, reason });
}
export async function deleteTaskPool(code: string, reason: string): Promise<void> {
  await request(`/task-pools/${encodeURIComponent(code)}`, "DELETE", { reason });
}
export async function randomPoolTasks(code: string, input: RandomTaskInput): Promise<RandomTaskResult> {
  const raw = record(await request(`/task-pools/${encodeURIComponent(code)}/random-tasks`, "POST", input));
  if (!Array.isArray(raw.created)) throw new Error("新增任务结果不完整，请保持弹窗并重试，避免重复添加。");
  return { created: raw.created.map(task), pool: parseTaskPool(raw.pool) };
}
export async function fetchDisableImpact(code: string, ids: string[]): Promise<DisableImpact> {
  const raw = record(await request(`/task-pools/${encodeURIComponent(code)}/disable-impact?${new URLSearchParams({ taskTypeIds: ids.join(",") })}`));
  if (!Array.isArray(raw.productsLosingAllTasks)) throw new Error("停用影响暂不可用，请重试。");
  return { productsLosingAllTasks: raw.productsLosingAllTasks.map(value => {
    const row = record(value); return { productKey: string(row.productKey), productName: string(row.productName) };
  }), devicesAffected: integer(raw.devicesAffected) };
}
export async function setPoolTaskStatus(code: string, input: TaskStatusInput): Promise<TaskStatusResult> {
  const raw = record(await request(`/task-pools/${encodeURIComponent(code)}/tasks/status`, "POST", input));
  return { updated: integer(raw.updated), pool: parseTaskPool(raw.pool) };
}
export async function fetchSkuDatacenterLabels(): Promise<string[]> {
  const raw = await request("/sku-datacenter-labels");
  if (!Array.isArray(raw)) throw new Error("托管机房建议加载失败。");
  return raw.map(string);
}
