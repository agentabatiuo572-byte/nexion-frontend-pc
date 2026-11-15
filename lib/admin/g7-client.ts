import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { assertG7OrderPageContract, assertG7OverviewContract } from "@/lib/admin/g-overview-contract";
import { executeG7DirectCommand, listG7DirectCommands, requireG7DirectReader, type G7DirectCommand } from "@/lib/admin/g7-direct-command";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

type RawNumber = number | string | null | undefined;

interface BackendStats {
  ordersMonth?: RawNumber;
  principalUsd?: RawNumber;
  matureUsd?: RawNumber;
  ticketsMonth?: RawNumber;
  reinvestRate?: RawNumber;
  reinvestRateAvailable?: boolean | string | null;
  lockDays?: RawNumber;
}

interface BackendParam {
  key?: string | null;
  configKey?: string | null;
  name?: string | null;
  sub?: string | null;
  value?: RawNumber;
  displayValue?: string | null;
  note?: string | null;
  newOnly?: boolean | string | null;
  b1RedlineTriggered?: boolean | string | null;
  valueType?: string | null;
}

interface BackendPhaseGate {
  key?: string | null;
  label?: string | null;
  value?: string | null;
  linkedDomain?: string | null;
  readonly?: boolean | string | null;
}

interface BackendStatus {
  status?: string | null;
  label?: string | null;
  count?: RawNumber;
  principalUsd?: RawNumber;
  principalDisplay?: string | null;
  tone?: string | null;
}

interface BackendCoverage {
  coverageRatio?: RawNumber;
  redlinePct?: RawNumber;
  redlineBreached?: boolean | string | null;
  precheck?: string | null;
}

interface BackendOverview {
  domain?: string | null;
  product?: string | null;
  asset?: string | null;
  currentNexPrice?: RawNumber;
  stats?: BackendStats | null;
  params?: BackendParam[] | null;
  phaseGate?: BackendPhaseGate | null;
  stateMachine?: string[] | null;
  statusBreakdown?: BackendStatus[] | null;
  amountDistribution?: string | null;
  coverage?: BackendCoverage | null;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
  g4Capacity?: { monthlyCapacity?: RawNumber; ticketsIssuedThisMonth?: RawNumber; source?: string | null } | null;
}

interface BackendOrder {
  orderNo?: string | null;
  userId?: RawNumber;
  userNo?: string | null;
  nickname?: string | null;
  amountUsdt?: RawNumber;
  apyPct?: RawNumber;
  lockDays?: RawNumber;
  lockedAt?: string | null;
  unlockAt?: string | null;
  estimatedInterestUsdt?: RawNumber;
  status?: string | null;
  billCorrelationPrefix?: string | null;
}

interface BackendOrderPage {
  orders?: BackendOrder[] | null;
  nextCursor?: RawNumber;
  hasMore?: boolean | string | null;
  serverCanonical?: boolean | null;
}

export interface G7Stats {
  ordersMonth: number;
  principalUsd: string;
  matureUsd: string;
  ticketsMonth: number;
  reinvestRate: number;
  reinvestRateAvailable: boolean;
  lockDays: number;
}

export interface G7Param {
  key: string;
  configKey: string;
  name: string;
  sub: string;
  value: string;
  displayValue: string;
  note: string;
  newOnly: boolean;
  b1RedlineTriggered: boolean;
  valueType: string;
}

export interface G7PhaseGate {
  key: string;
  label: string;
  value: string;
  linkedDomain: string;
  readonly: boolean;
}

export interface G7Status {
  status: string;
  label: string;
  count: number;
  principalUsd: string;
  principalDisplay: string;
  tone: string;
}

export interface G7Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

export interface G7Overview {
  currentNexPrice: number;
  stats: G7Stats;
  params: G7Param[];
  phaseGate: G7PhaseGate;
  stateMachine: string[];
  statusBreakdown: G7Status[];
  amountDistribution: string;
  coverage: G7Coverage;
  serverCanonical: boolean;
  sources: string[];
  g4Capacity: { monthlyCapacity: number; ticketsIssuedThisMonth: number; source: string };
}

export interface G7Order {
  orderNo: string;
  userId: number;
  userNo: string;
  nickname: string;
  amountUsdt: string;
  apyPct: number;
  lockDays: number;
  lockedAt: string;
  unlockAt: string;
  estimatedInterestUsdt: string;
  status: string;
  billCorrelationPrefix: string;
}

export interface G7OrderPage {
  orders: G7Order[];
  nextCursor: number | null;
  hasMore: boolean;
  serverCanonical: boolean;
}

function toNumber(value: RawNumber, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%±,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toBool(value: boolean | string | null | undefined, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  return fallback;
}

function asText(value: unknown, fallback = "-") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOverview(data: BackendOverview | null | undefined): G7Overview {
  assertG7OverviewContract(data);
  const stats = data?.stats ?? {};
  const phaseGate = data?.phaseGate ?? {};
  const coverage = data?.coverage ?? {};
  return {
    currentNexPrice: toNumber(data?.currentNexPrice),
    stats: {
      ordersMonth: toNumber(stats.ordersMonth),
      principalUsd: g7Money(stats.principalUsd),
      matureUsd: g7Money(stats.matureUsd),
      ticketsMonth: toNumber(stats.ticketsMonth),
      reinvestRate: toNumber(stats.reinvestRate),
      reinvestRateAvailable: toBool(stats.reinvestRateAvailable, false),
      lockDays: toNumber(stats.lockDays),
    },
    params: (data?.params ?? []).map((param) => ({
      key: asText(param.key, "unknown"),
      configKey: asText(param.configKey),
      name: asText(param.name, asText(param.key, "参数")),
      sub: asText(param.sub),
      value: String(param.value ?? ""),
      displayValue: asText(param.displayValue, String(param.value ?? "")),
      note: asText(param.note),
      newOnly: toBool(param.newOnly, false),
      b1RedlineTriggered: toBool(param.b1RedlineTriggered, false),
      valueType: asText(param.valueType, "STRING"),
    })),
    phaseGate: {
      key: asText(phaseGate.key, ""),
      label: asText(phaseGate.label, ""),
      value: asText(phaseGate.value, ""),
      linkedDomain: asText(phaseGate.linkedDomain, ""),
      readonly: toBool(phaseGate.readonly, false),
    },
    stateMachine: data?.stateMachine ?? ["pending_lock", "active", "mature_unclaimed", "claimed", "early_withdrawn"],
    statusBreakdown: (data?.statusBreakdown ?? []).map((status) => ({
      status: asText(status.status, "unknown"),
      label: asText(status.label, asText(status.status, "状态")),
      count: toNumber(status.count),
      principalUsd: g7Money(status.principalUsd),
      principalDisplay: asText(status.principalDisplay),
      tone: asText(status.tone, "dim"),
    })),
    amountDistribution: asText(data?.amountDistribution),
    coverage: {
      coverageRatio: toNumber(coverage.coverageRatio),
      redlinePct: toNumber(coverage.redlinePct),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck),
    },
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
    g4Capacity: {
      monthlyCapacity: toNumber(data?.g4Capacity?.monthlyCapacity),
      ticketsIssuedThisMonth: toNumber(data?.g4Capacity?.ticketsIssuedThisMonth),
      source: asText(data?.g4Capacity?.source),
    },
  };
}

async function g7Request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await guardedFetch(`/api/admin/market${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  // As in E6, preserve the server's decimal lexemes before JSON.parse can turn
  // them into binary floating point. Counts and ratios keep their numeric types.
  const result = (await response.text().then(text => JSON.parse(text.replace(
    /("(?:principalUsd|matureUsd|amountUsdt|estimatedInterestUsdt)"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g,
    '$1"$2"',
  ))).catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw Object.assign(new Error(formatAdminApiError(result?.message, `G7_REQUEST_FAILED_${response.status}`)), {
      status: response.ok && result && result.code >= 400 && result.code < 500 ? result.code : response.status,
      backendMessage: result?.message,
      unknownOutcome: response.headers.get("X-Nexion-Upstream-Outcome") === "unknown",
    });
  }

  return result.data as T;
}

export async function fetchG7RepurchaseOverview() {
  return normalizeOverview(await g7Request<BackendOverview>("/nex/repurchase"));
}

export async function fetchG7RepurchaseOrders(status = "", cursor: number | null = null) {
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (cursor !== null) query.set("cursor", String(cursor));
  const data = await g7Request<BackendOrderPage>(`/nex/repurchase/orders${query.size ? `?${query.toString()}` : ""}`);
  assertG7OrderPageContract(data);
  return {
    orders: (data?.orders ?? []).map((order) => ({
      orderNo: asText(order.orderNo),
      userId: toNumber(order.userId),
      userNo: asText(order.userNo),
      nickname: asText(order.nickname),
      amountUsdt: g7Money(order.amountUsdt),
      apyPct: toNumber(order.apyPct),
      lockDays: toNumber(order.lockDays),
      lockedAt: asText(order.lockedAt),
      unlockAt: asText(order.unlockAt),
      estimatedInterestUsdt: g7Money(order.estimatedInterestUsdt),
      status: asText(order.status, "UNKNOWN"),
      billCorrelationPrefix: asText(order.billCorrelationPrefix),
    })),
    nextCursor: data?.nextCursor == null ? null : toNumber(data.nextCursor),
    hasMore: toBool(data?.hasMore, false),
    serverCanonical: data?.serverCanonical === true,
  } satisfies G7OrderPage;
}

// OpsRepurchaseAdminService.normalizeValue: numeric values strip trailing zeros;
// shortcut amounts round HALF_UP to cents, then deduplicate and sort.
function g7Decimal(value: string) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!match) throw new Error("G7_RESPONSE_INVALID:updated.newValue");
  const fraction = match[3] ?? match[4] ?? "";
  const digits = (match[2] ?? "0") + fraction;
  const scale = fraction.length - Number(match[5] ?? 0);
  const padded = scale < 0 ? digits + "0".repeat(-scale) : digits.padStart(scale + 1, "0");
  const whole = BigInt(scale > 0 ? padded.slice(0, -scale) : padded).toString();
  const tail = scale > 0 ? padded.slice(-scale).replace(/0+$/, "") : "";
  return `${match[1] === "-" && (whole !== "0" || tail) ? "-" : ""}${whole}${tail ? `.${tail}` : ""}`;
}

function g7Money(value: RawNumber) {
  const decimal = g7Decimal(String(value));
  if (!/^\d+(?:\.\d{1,6})?$/.test(decimal)) throw new Error("G7_RESPONSE_INVALID:money");
  return decimal;
}

function canonicalG7Value(key: string, value: string) {
  if (key === "presets") {
    const cents = value.replace(/[$,]/g, "").split(/[/;|]/).map(v => v.trim()).filter(Boolean).map(v => {
      const match = /^(\d+)(?:\.(\d*))?$/.exec(g7Decimal(v));
      if (!match) throw new Error("G7_RESPONSE_INVALID:updated.newValue");
      const fraction = match[2] ?? "";
      return BigInt(match[1] + fraction.slice(0, 2).padEnd(2, "0")) + (Number(fraction[2] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
    });
    return [...new Set(cents)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(v => `${v / BigInt(100)}.${String(v % BigInt(100)).padStart(2, "0")}`.replace(/\.?0+$/, "")).join(" / ");
  }
  return g7Decimal(value);
}

async function sendG7DirectCommand(original: G7DirectCommand) {
  const data = await g7Request<BackendOverview & { updated?: Record<string, unknown> }>(original.path, {
    method: original.method, headers: { "Idempotency-Key": original.commandKey }, body: original.body,
  });
  const overview = normalizeOverview(data);
  const ack = data.updated;
  // updateInternal:139–142 returns key/newValue (not obj/value/commandKey).
  if (!ack || ack.key !== original.paramKey || typeof ack.oldValue !== "string"
    || ack.newValue !== canonicalG7Value(original.paramKey, original.input.value)
    || typeof ack.receiptId !== "string" || !ack.receiptId.trim()
    || !["coverageAtSubmit", "g4Capacity", "g4TicketsIssued"].every(key => (typeof ack[key] === "number" || typeof ack[key] === "string" && ack[key].trim() !== "") && Number.isFinite(Number(ack[key])))) {
    throw new Error("G7_RESPONSE_INVALID:updated");
  }
  return overview;
}

export async function updateG7RepurchaseParam(paramKey: string, value: string, reason: string, operator: string, g4Ref = "", currentValue?: string, g4Capacity?: G7DirectCommand["g4Capacity"]) {
  return executeG7DirectCommand(paramKey, { value, reason, operator, g4Ref }, sendG7DirectCommand, undefined, currentValue, g4Capacity);
}

export async function retryG7DirectCommand(adminId: number, commandKey: string) {
  const original = listG7DirectCommands(adminId).find(record => record.commandKey === commandKey);
  if (!original) throw new Error("原操作已结束，请重新读取当前状态。");
  // This response may be the historical overview. The page must GET current
  // state before allowing another edit; callers must not install this as current.
  return executeG7DirectCommand(original.paramKey, original.input, sendG7DirectCommand, original);
}

export async function queryG7DirectCommand(adminId: number, commandKey: string) {
  const epoch = requireG7DirectReader(adminId);
  if (!listG7DirectCommands(adminId).some(record => record.commandKey === commandKey)) throw new Error("原操作已结束，请重新读取当前状态。");
  const overview = await fetchG7RepurchaseOverview();
  if (requireG7DirectReader(adminId) !== epoch) throw new Error("登录身份已变化，请重新核对原操作。");
  // There is no G7 direct receipt lookup endpoint. A current value is not proof
  // of what happened to the saved command; never clear evidence on this GET.
  return { overview, confirmed: false as const, message: `已读到现在的锁定计划配置，但不能据此确认原操作的结果。原记录继续保留，可以到「操作记录与审批」核对。` };
}
