import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { TASK_CLASSES } from "@/lib/admin/task-classes";
import { appVisibleTextError } from "@/lib/admin/content-language-rules";

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
  /** 旧 DEVICE 列表使用 null；旧随机回执和旧待确认快照可能省略。 */
  baseReward?: string | null;
  asset?: "USDT" | "UVT";
}
export interface DevicePoolTask extends PoolTask { baseReward: string; asset: "USDT" }
type DevicePoolListTask = DevicePoolTask | (PoolTask & { baseReward: null; asset?: undefined });
export interface PhonePoolTask extends PoolTask { baseReward: string; asset: "USDT" | "UVT" }
export interface PoolTaskPage<T = PoolTask> { records: T[]; total: number }
export interface DisableImpact { productsLosingAllTasks: Pick<PoolProduct, "productKey" | "productName">[]; devicesAffected: number }
export interface RandomTaskInput { count: number; taskClasses?: TaskClass[]; idempotencyKey: string; reason: string }
export interface TaskStatusInput { taskTypeIds: string[]; enabled: boolean; idempotencyKey: string; reason: string }
export interface RandomTaskResult { created: PoolTask[]; pool: TaskPool }
export interface TaskStatusResult { updated: number; pool: TaskPool }
export interface TaskEditFields { name: string; taskClass: TaskClass; durationMinutes: number; baseReward: string }
export interface CreateTaskInput extends TaskEditFields { enabled: boolean; idempotencyKey: string; reason: string }
export interface UpdateTaskInput extends TaskEditFields { expectedVersion: number; idempotencyKey: string; reason: string }
export interface TaskEditResult { task: DevicePoolTask; pool: TaskPool }
export type TaskPoolEditCommand = { kind: "create"; method: "POST"; path: string; body: CreateTaskInput }
  | { kind: "update"; method: "POST"; path: string; body: UpdateTaskInput; previousEnabled: boolean };
export type TaskPoolCommand = { kind: "random"; method: "POST"; path: string; body: RandomTaskInput }
  | { kind: "status"; method: "POST"; path: string; body: TaskStatusInput }
  | TaskPoolEditCommand;
export interface PoolLimitErrorData { limit: number; enabled?: number; total?: number; requested: number }
export type TaskPoolErrorCode = "TASK_POOL_FORMAT_RETIRED" | "TASK_POOL_KIND_FORBIDDEN" | "TASK_POOL_ENABLED_LIMIT" | "TASK_POOL_TOTAL_LIMIT" | "TASK_POOL_IDEMPOTENCY_CONFLICT" | "TASK_TYPE_NOT_IN_POOL";

/** Preserve the wire verdict: translated copy never decides whether a command can be released. */
export class TaskPoolApiError extends Error {
  constructor(message: string, readonly status?: number, readonly httpStatus?: number,
    readonly reasonCode = "", readonly data?: unknown, readonly unknownOutcome = true) { super(message); }
}

const POOL_ERRORS: Record<string, string> = {
  MONTHLY_TARGET_POOL_INELIGIBLE: "任务池含不符合月收益规则的启用任务，整批未修改。请联系设备负责人核对任务配置。",
  PAGE_INVALID: "页码或每页条数无效，请重新选择后读取。",
  TASK_CLASS_INVALID: "任务类型无效，请从六种类型中重新选择。",
  TASK_NAME_INVALID: "任务名称要填 1–128 个字符。",
  APP_TEXT_CHINESE_NOT_ALLOWED: "任务名称不能包含中文，请改成英文。",
  TASK_NAME_DUPLICATE: "这个等级已有同名任务，请换个名称。",
  TASK_DURATION_INVALID: "时长要填 5–120 分钟，且是 5 的倍数。",
  TASK_WEIGHT_INVALID: "权重要大于 0，整数最多 12 位，小数最多 6 位。",
  TASK_TYPE_VERSION_REQUIRED: "请关闭后重新加载任务，再编辑。",
  TASK_TYPE_VERSION_CONFLICT: "这条任务刚被别人改过，请加载最新内容。",
  TASK_TYPE_NOT_IN_POOL: "这个等级没有这条任务，请刷新后核对。",
  TASK_POOL_KIND_FORBIDDEN: "请从对应的设备或手机任务页面操作。",
  REASON_LENGTH_INVALID: "请填写 8–200 字的操作理由。",
  IDEMPOTENCY_KEY_REQUIRED: "这次操作无法核对，请保留原记录并联系值班人员。",
  IDEMPOTENCY_KEY_INVALID: "这次操作无法核对，请保留原记录并联系值班人员。",
  TASK_POOL_COUNT_INVALID: "任务数量要填 1–50 的整数。",
  TASK_POOL_KIND_INVALID: "任务池类别无效，请刷新任务池页面后重试。",
  TASK_POOL_NOT_FOUND: "这个任务等级不存在，请刷新后重新选择。",
  TASK_TYPE_IDS_REQUIRED: "没有有效的任务选择，请重新勾选当前页任务。",
  TASK_POOL_STATUS_REQUIRED: "缺少要设置的任务状态，请保留当前选择并重新核对操作。",
  REQUEST_BODY_INVALID: "提交内容格式不正确，请保留当前内容，联系值班人员核对。",
  REQUEST_PARAMETER_INVALID: "查询条件格式不正确，请重新选择后读取。",
  REQUEST_HEADER_REQUIRED: "请求缺少必要信息，请保留原记录并联系值班人员核对。",
  RESOURCE_NOT_FOUND: "这个接口或资源不存在，请联系值班人员核对。",
  METHOD_NOT_ALLOWED: "这个请求方式不受支持，请联系值班人员核对。",
  UNSUPPORTED_MEDIA_TYPE: "提交格式不受支持，请保留内容并联系值班人员核对。",
  IDEMPOTENCY_RESPONSE_DESERIALIZE_FAILED: "原请求的结果暂时读不到，请保留原记录，不要重新发起。",
  IDEMPOTENCY_RESPONSE_SERIALIZE_FAILED: "原请求的结果暂时无法确认，请保留原记录，不要重新发起。",
  IDEMPOTENCY_SCOPE_REQUIRED: "缺少操作标识，请保留原记录并联系值班人员核对。",
  IDEMPOTENCY_KEY_CONFLICT: "原请求和这次的内容对不上，请先查询原结果，不要另发一批。",
  TASK_POOL_IDEMPOTENCY_CONFLICT: "这次的内容和原请求不一致，请先查询原结果，不要重新发起。",
};

export function validTaskWeight(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,12}(?:\.\d{1,6})?$/.test(value) && /[1-9]/.test(value);
}

export function taskWeightMicros(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(6, "0"));
}

export function validTaskEditFields(body: TaskEditFields): boolean {
  return typeof body.name === "string" && body.name === body.name.trim() && body.name.length > 0
    && Array.from(body.name).length <= 128 && !appVisibleTextError(body.name, "任务名称")
    && TASK_CLASSES.includes(body.taskClass) && Number.isInteger(body.durationMinutes)
    && body.durationMinutes >= 5 && body.durationMinutes <= 120 && body.durationMinutes % 5 === 0
    && validTaskWeight(body.baseReward);
}

export function taskPoolTaskPath(code: string, taskTypeId?: string): string {
  const collection = `/task-pools/${encodeURIComponent(code)}/tasks`;
  return taskTypeId === undefined ? collection : `${collection}/${encodeURIComponent(taskTypeId)}`;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("任务池数据格式不完整，请刷新重试。");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("任务池文字数据不完整，请刷新重试。");
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
  const parsed: TaskPool = { code: string(row.code), kind: row.kind, level: row.kind === "PHONE" && row.level === null ? null : integer(row.level), name: string(row.name), sortOrder: integer(row.sortOrder),
    taskCount: integer(row.taskCount), enabledCount: integer(row.enabledCount),
    avgDurationMinutes: row.avgDurationMinutes === null ? null : decimal(row.avgDurationMinutes),
    estTasksPerDevicePerDay: row.estTasksPerDevicePerDay === null ? null : decimal(row.estTasksPerDevicePerDay), referencedBy: row.referencedBy.map(product) };
  if (parsed.kind === "DEVICE" && (parsed.enabledCount > parsed.taskCount || parsed.taskCount > 300 || parsed.enabledCount > 200
    || ![1, 2, 3, 4].includes(parsed.level!) || parsed.code !== `L${parsed.level}`
    || (parsed.enabledCount === 0
      ? parsed.avgDurationMinutes !== null || parsed.estTasksPerDevicePerDay !== null
      : parsed.avgDurationMinutes === null || Number(parsed.avgDurationMinutes) <= 0 || Number(parsed.avgDurationMinutes) > 120
        || parsed.estTasksPerDevicePerDay === null || Number(parsed.estTasksPerDevicePerDay) <= 0)
    || new Set(parsed.referencedBy.map(item => item.productKey)).size !== parsed.referencedBy.length)) {
    throw new Error("任务等级数据不完整，请刷新；仍不行请联系值班人员核对配置。");
  }
  return parsed;
}
function task(value: unknown): Omit<PoolTask, "baseReward" | "asset"> {
  const row = record(value);
  if (!TASK_CLASSES.includes(row.taskClass as TaskClass) || typeof row.enabled !== "boolean") throw new Error("任务类型或状态无效，请刷新重试。");
  return { taskTypeId: string(row.taskTypeId), name: string(row.name), taskClass: row.taskClass as TaskClass, durationMinutes: integer(row.durationMinutes),
    enabled: row.enabled, version: integer(row.version), effectiveAt: string(row.effectiveAt) };
}
function deviceTaskFields(value: unknown): ReturnType<typeof task> {
  const parsed = task(value);
  if (parsed.durationMinutes <= 0 || parsed.durationMinutes > 120 || parsed.version < 1) {
    throw new Error("任务数据不完整，请刷新重试。");
  }
  return parsed;
}

function deviceTask(value: unknown): DevicePoolTask {
  const parsed = deviceTaskFields(value);
  const { baseReward, asset } = record(value);
  if (!validTaskWeight(baseReward) || !/\.\d{6}$/.test(baseReward) || asset !== "USDT") {
    throw new Error("任务数据不完整，请刷新重试。");
  }
  return { ...parsed, baseReward, asset };
}

function deviceListTask(value: unknown): DevicePoolListTask {
  const row = record(value);
  return row.baseReward === undefined && row.asset === undefined
    ? { ...deviceTaskFields(row), baseReward: null }
    : deviceTask(row);
}

function randomTask(value: unknown): PoolTask {
  const row = record(value);
  // Retained success replies from before B85 may omit the weight projection.
  return row.baseReward === undefined && row.asset === undefined ? task(row) : deviceTask(row);
}

async function request(path: string, method = "GET", body?: object): Promise<unknown> {
  const response = await guardedFetch(`/api/admin/devices${path}`, { method, cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  let result: unknown;
  try { result = await response.json(); }
  catch { throw new TaskPoolApiError("任务池返回的内容暂时读不懂，请保留原操作核对。", undefined, response.status); }
  let envelope: Record<string, unknown>;
  try { envelope = record(result); }
  catch { throw new TaskPoolApiError("任务池返回的内容不完整，请保留原操作核对。", undefined, response.status); }
  if (!response.ok || envelope.code !== 0) {
    const code = typeof envelope.message === "string" ? envelope.message : "";
    const businessStatus = typeof envelope.code === "number" && envelope.code >= 400 ? envelope.code : undefined;
    const status = response.status >= 500 ? response.status : businessStatus && businessStatus >= 500 ? businessStatus : !response.ok ? response.status : businessStatus;
    let message = POOL_ERRORS[code] ?? formatAdminApiError(code, "任务池操作结果暂时无法确认，请保留原操作核对。");
    if (code === "TASK_POOL_ENABLED_LIMIT" || code === "TASK_POOL_TOTAL_LIMIT") {
      try {
        const data = record(envelope.data);
        const limit = integer(data.limit); const requested = integer(data.requested);
        const currentValue = code === "TASK_POOL_ENABLED_LIMIT" ? data.enabled : data.total;
        const current = currentValue == null ? null : integer(currentValue);
        message = `${code === "TASK_POOL_ENABLED_LIMIT" ? "启用任务" : "任务总数"}上限为 ${limit} 个${current == null ? "" : `，当前 ${current} 个`}，本次 ${requested} 个。${code === "TASK_POOL_ENABLED_LIMIT" ? "请减少数量或先停用部分任务。" : "请减少数量；总量已满时请联系任务池负责人。"}`;
      } catch { throw new TaskPoolApiError("任务池返回的错误说明不完整，请保留原操作核对。", status, response.status, code, envelope.data); }
    }
    const unknown = response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown"
      || !status || status < 400 || status >= 500 || [401, 403, 408, 425, 429].includes(status)
      || !code || code.startsWith("IDEMPOTENCY_") || code === "TASK_POOL_IDEMPOTENCY_CONFLICT";
    throw new TaskPoolApiError(message, status, response.status, code, envelope.data, unknown);
  }
  return envelope.data;
}
export async function fetchTaskPools(kind: TaskPool["kind"] = "DEVICE"): Promise<TaskPool[]> {
  const raw = await request(`/task-pools?kind=${kind}`);
  if (!Array.isArray(raw)) throw new Error("任务池列表不完整，请刷新重试。");
  const pools = raw.map(parseTaskPool);
  if (kind === "DEVICE" && (pools.length !== 4 || new Set(pools.map(pool => pool.code)).size !== 4 || pools.some(pool => pool.kind !== "DEVICE"))) {
    throw new Error("固定任务等级还没读到，请刷新；仍不行请联系值班人员核对配置。");
  }
  return pools.sort((a, b) => a.sortOrder - b.sortOrder);
}
export interface PoolTaskQuery { taskClass?: string; enabled?: string; pageNum?: number; pageSize?: number }
export function fetchPoolTasks(code: "PHONE", query?: PoolTaskQuery): Promise<PoolTaskPage<PhonePoolTask>>;
export function fetchPoolTasks(code: "L1" | "L2" | "L3" | "L4", query?: PoolTaskQuery): Promise<PoolTaskPage<DevicePoolListTask>>;
export function fetchPoolTasks(code: string, query?: PoolTaskQuery): Promise<PoolTaskPage>;
export async function fetchPoolTasks(code: string, query: PoolTaskQuery = {}): Promise<PoolTaskPage> {
  const params = new URLSearchParams({ pageNum: String(query.pageNum ?? 1), pageSize: String(query.pageSize ?? 20) });
  if (query.taskClass) params.set("taskClass", query.taskClass);
  if (query.enabled) params.set("enabled", query.enabled);
  const raw = record(await request(`/task-pools/${encodeURIComponent(code)}/tasks?${params}`));
  if (!Array.isArray(raw.records)) throw new Error("任务列表不完整，请刷新重试。");
  const records = raw.records.map<PoolTask>(value => {
    if (code !== "PHONE") return deviceListTask(value);
    const parsed = task(value);
    const row = record(value);
    if (row.asset !== "USDT" && row.asset !== "UVT") throw new Error("手机任务奖励资产无效，请刷新重试。");
    return { ...parsed, baseReward: decimal(row.baseReward), asset: row.asset };
  });
  return { total: integer(raw.total), records };
}
export async function randomPoolTasks(code: string, input: RandomTaskInput): Promise<RandomTaskResult> {
  return sendTaskPoolCommand({ kind: "random", path: `/task-pools/${encodeURIComponent(code)}/random-tasks`, method: "POST", body: input }) as Promise<RandomTaskResult>;
}
export async function createPoolTask(code: string, input: CreateTaskInput): Promise<TaskEditResult> {
  return sendTaskPoolCommand({ kind: "create", path: taskPoolTaskPath(code), method: "POST", body: input });
}
export async function updatePoolTask(code: string, taskTypeId: string, input: UpdateTaskInput, previousEnabled: boolean): Promise<TaskEditResult> {
  return sendTaskPoolCommand({ kind: "update", path: taskPoolTaskPath(code, taskTypeId), method: "POST", body: input, previousEnabled });
}
/** E2 recovery passes the durable original method, path and body, including omitted fields. */
export function sendTaskPoolCommand(command: TaskPoolEditCommand): Promise<TaskEditResult>;
export function sendTaskPoolCommand(command: TaskPoolCommand): Promise<RandomTaskResult | TaskStatusResult | TaskEditResult>;
export async function sendTaskPoolCommand(command: TaskPoolCommand): Promise<RandomTaskResult | TaskStatusResult | TaskEditResult> {
  const response = await request(command.path, command.method, command.body);
  try {
    const raw = record(response);
    const pool = parseTaskPool(raw.pool);
    if (pool.kind !== "DEVICE") throw new Error("任务结果不完整。");
    if (command.kind === "create" || command.kind === "update") {
      const saved = deviceTask(raw.task);
      const { name, taskClass, durationMinutes, baseReward } = command.body;
      const matches = command.kind === "create"
        ? command.path === taskPoolTaskPath(pool.code) && saved.taskTypeId.startsWith("DT-") && saved.version === 1 && saved.enabled === command.body.enabled
        : command.path === taskPoolTaskPath(pool.code, saved.taskTypeId) && saved.version === command.body.expectedVersion + 1 && saved.enabled === command.previousEnabled;
      if (!matches || saved.name !== name || saved.taskClass !== taskClass || saved.durationMinutes !== durationMinutes
        || !validTaskWeight(baseReward) || taskWeightMicros(saved.baseReward) !== taskWeightMicros(baseReward)) {
        throw new Error("任务结果不完整。");
      }
      return { task: saved, pool };
    }
    if (command.path !== `/task-pools/${encodeURIComponent(pool.code)}/${command.kind === "random" ? "random-tasks" : "tasks/status"}`) throw new Error("任务结果不完整。");
    if (command.kind === "status") {
      const updated = integer(raw.updated);
      if (updated > command.body.taskTypeIds.length) throw new Error("任务状态结果不完整。");
      return { updated, pool };
    }
    if (!Array.isArray(raw.created) || raw.created.length !== command.body.count) throw new Error("新增任务结果不完整。");
    const created = raw.created.map(randomTask);
    if (new Set(created.map(row => row.taskTypeId)).size !== created.length
      || created.some(row => !row.enabled || row.durationMinutes <= 0 || row.durationMinutes > 120)) throw new Error("新增任务结果不完整。");
    return { created, pool };
  } catch { throw new TaskPoolApiError("任务操作的结果没读全，原操作已保留，请先查询原结果。"); }
}
export async function fetchDisableImpact(code: string, ids: string[]): Promise<DisableImpact> {
  const raw = record(await request(`/task-pools/${encodeURIComponent(code)}/disable-impact?${new URLSearchParams({ taskTypeIds: ids.join(",") })}`));
  if (!Array.isArray(raw.productsLosingAllTasks)) throw new Error("停用影响暂不可用，请重试。");
  return { productsLosingAllTasks: raw.productsLosingAllTasks.map(value => {
    const row = record(value); return { productKey: string(row.productKey), productName: string(row.productName) };
  }), devicesAffected: integer(raw.devicesAffected) };
}
export async function setPoolTaskStatus(code: string, input: TaskStatusInput): Promise<TaskStatusResult> {
  return sendTaskPoolCommand({ kind: "status", path: `/task-pools/${encodeURIComponent(code)}/tasks/status`, method: "POST", body: input }) as Promise<TaskStatusResult>;
}
export async function fetchSkuDatacenterLabels(): Promise<string[]> {
  const raw = await request("/sku-datacenter-labels");
  if (!Array.isArray(raw)) throw new Error("托管机房建议加载失败。");
  return raw.map(string);
}
