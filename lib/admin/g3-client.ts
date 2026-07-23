import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

type RawNumber = number | string | null | undefined;

interface BackendFrame {
  dayIndex?: RawNumber;
  targetPrice?: RawNumber;
  pumpProbability?: RawNumber;
  volatilityPct?: RawNumber;
}

interface BackendControl {
  key?: string | null;
  name?: string | null;
  description?: string | null;
  value?: string | null;
  rawValue?: string | null;
  cronExpression?: string | null;
  zone?: string | null;
  fallback?: boolean | string | null;
}

interface BackendCoverage {
  coverageRatio?: RawNumber;
  redlinePct?: RawNumber;
  redlineBreached?: boolean | string | null;
  precheck?: string | null;
}

interface BackendOverrides {
  currentPrice?: RawNumber;
  volatilityPct?: RawNumber;
  oracle?: string | null;
  deviationPct?: RawNumber;
  costBasis?: RawNumber;
  paused?: boolean | string | null;
}

interface BackendOverview {
  currentPrice?: RawNumber;
  activeDayIndex?: RawNumber;
  activeFrame?: BackendFrame | null;
  weekPeakPrice?: RawNumber;
  frames?: BackendFrame[] | null;
  controls?: BackendControl[] | null;
  overrides?: BackendOverrides | null;
  coverage?: BackendCoverage | null;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
}

interface BackendHistoryPoint {
  sampledAt?: string | null;
  price?: RawNumber;
  deltaPct?: RawNumber;
}

interface BackendHistory {
  points?: BackendHistoryPoint[] | null;
  intervalMinutes?: RawNumber;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
}

export type G3CurveField = "targetPrice" | "pumpProbability" | "volatilityPct";
export type G3OverrideKey = "currentPrice" | "volatilityPct" | "oracle" | "deviationPct" | "costBasis" | "paused";

export interface G3CurveFrame {
  dayIndex: number;
  targetPrice: number;
  pumpProbability: number;
  volatilityPct: number;
}

export interface G3Control {
  key: string;
  name: string;
  description: string;
  value: string;
  rawValue?: string;
  cronExpression?: string;
  zone?: string;
  fallback?: boolean;
}

export interface G3Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

export interface G3Overrides {
  currentPrice: number;
  volatilityPct: number;
  oracle: string;
  deviationPct: number | null;
  costBasis: number | null;
  paused: boolean;
}

export interface G3Overview {
  currentPrice: number;
  activeDayIndex: number;
  activeFrame: G3CurveFrame;
  weekPeakPrice: number;
  frames: G3CurveFrame[];
  controls: G3Control[];
  overrides: G3Overrides;
  coverage: G3Coverage;
  serverCanonical: boolean;
  sources: string[];
}

export interface G3HistoryPoint {
  sampledAt: string;
  price: number;
  deltaPct: number;
}

export interface G3History {
  points: G3HistoryPoint[];
  intervalMinutes: number;
  serverCanonical: boolean;
  sources: string[];
}

let requestSeq = 0;
const pendingMutationKeys = new Map<string, string>();

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

function parseNumber(value: RawNumber) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%±\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function requireNumber(value: RawNumber, field: string) {
  const parsed = parseNumber(value);
  if (parsed == null) {
    throw new Error(`G3 后端数据缺少字段:${field}`);
  }
  return parsed;
}

function toBool(value: boolean | string | null | undefined, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "paused"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "running"].includes(normalized)) return false;
  }
  return fallback;
}

function asText(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requireText(value: unknown, field: string) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`G3 后端数据缺少字段:${field}`);
}

function normalizeFrame(frame: BackendFrame | null | undefined, index: number): G3CurveFrame {
  if (!frame) throw new Error(`G3 后端数据缺少字段:frames[${index}]`);
  return {
    dayIndex: requireNumber(frame.dayIndex, `frames[${index}].dayIndex`),
    targetPrice: requireNumber(frame.targetPrice, `frames[${index}].targetPrice`),
    pumpProbability: requireNumber(frame.pumpProbability, `frames[${index}].pumpProbability`),
    volatilityPct: requireNumber(frame.volatilityPct, `frames[${index}].volatilityPct`),
  };
}

function normalizeOverview(data: BackendOverview | null | undefined): G3Overview {
  if (!data) throw new Error("G3 后端未返回行情总览数据");
  const frames = (data?.frames ?? []).map(normalizeFrame);
  const activeDayIndex = Math.max(0, requireNumber(data.activeDayIndex, "activeDayIndex"));
  const activeFrame = data?.activeFrame
    ? normalizeFrame(data.activeFrame, activeDayIndex)
    : frames.find((frame) => frame.dayIndex === activeDayIndex);
  if (!activeFrame) throw new Error("G3 后端数据缺少字段:activeFrame");
  if (!data.coverage) throw new Error("G3 后端数据缺少字段:coverage");
  if (!data.overrides) throw new Error("G3 后端数据缺少字段:overrides");
  const coverage = data.coverage;
  const overrides = data.overrides;
  return {
    currentPrice: requireNumber(data.currentPrice, "currentPrice"),
    activeDayIndex,
    activeFrame,
    weekPeakPrice: requireNumber(data.weekPeakPrice, "weekPeakPrice"),
    frames,
    controls: (data?.controls ?? []).map((control) => ({
      key: requireText(control.key, "controls.key"),
      name: requireText(control.name, "controls.name"),
      description: asText(control.description),
      value: requireText(control.value, "controls.value"),
      rawValue: typeof control.rawValue === "string" ? control.rawValue : undefined,
      cronExpression: typeof control.cronExpression === "string" ? control.cronExpression : undefined,
      zone: typeof control.zone === "string" ? control.zone : undefined,
      fallback: typeof control.fallback === "undefined" ? undefined : toBool(control.fallback, false),
    })),
    overrides: {
      currentPrice: requireNumber(overrides.currentPrice, "overrides.currentPrice"),
      volatilityPct: requireNumber(overrides.volatilityPct, "overrides.volatilityPct"),
      oracle: asText(overrides.oracle),
      deviationPct: parseNumber(overrides.deviationPct),
      costBasis: parseNumber(overrides.costBasis),
      paused: toBool(overrides.paused, false),
    },
    coverage: {
      coverageRatio: requireNumber(coverage.coverageRatio, "coverage.coverageRatio"),
      redlinePct: requireNumber(coverage.redlinePct, "coverage.redlinePct"),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck),
    },
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

function normalizeHistory(data: BackendHistory | null | undefined): G3History {
  if (!data) throw new Error("G3 后端未返回行情历史数据");
  return {
    points: (data.points ?? []).map((point, index) => ({
      sampledAt: asText(point.sampledAt, ""),
      price: requireNumber(point.price, `points[${index}].price`),
      deltaPct: requireNumber(point.deltaPct, `points[${index}].deltaPct`),
    })),
    intervalMinutes: requireNumber(data.intervalMinutes, "intervalMinutes"),
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

async function g3Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  const intent = init?.idempotencyPrefix ? `${init.idempotencyPrefix}:${String(init.body ?? "")}` : null;
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    const key = pendingMutationKeys.get(intent!) ?? idempotencyKey(init.idempotencyPrefix);
    pendingMutationKeys.set(intent!, key);
    headers.set("Idempotency-Key", key);
  }

  const response = await fetch(`/api/admin/market${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `G3_REQUEST_FAILED_${response.status}`));
  }

  if (intent) pendingMutationKeys.delete(intent);

  return result.data as T;
}

function serializeFrames(frames: G3CurveFrame[]) {
  return frames.map((frame) => ({
    dayIndex: frame.dayIndex,
    targetPrice: String(frame.targetPrice),
    pumpProbability: String(frame.pumpProbability),
    volatilityPct: String(frame.volatilityPct),
  }));
}

export async function fetchG3MarketOverview() {
  return normalizeOverview(await g3Request<BackendOverview>("/nex/curve"));
}

export async function fetchG3MarketHistory() {
  return normalizeHistory(await g3Request<BackendHistory>("/nex/curve/history"));
}

export async function updateG3CurveFrame(
  overview: G3Overview,
  dayIndex: number,
  field: G3CurveField,
  value: string,
  reason: string,
  operator: string,
) {
  const frames = serializeFrames(overview.frames);
  const target = frames.find((frame) => frame.dayIndex === dayIndex);
  if (!target) throw new Error("G3 曲线日不存在,请刷新页面后重试。");
  target[field] = value;
  return normalizeOverview(await g3Request<BackendOverview>("/nex/curve", {
    method: "PUT",
    body: JSON.stringify({ frames, reason, operator }),
    idempotencyPrefix: `g3-curve-d${dayIndex + 1}-${field}`,
  }));
}

export async function updateG3Control(controlKey: string, value: string, reason: string, operator: string) {
  return normalizeOverview(await g3Request<BackendOverview>(`/nex/curve/controls/${encodeURIComponent(controlKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `g3-control-${controlKey}`,
  }));
}

export async function updateG3Override(overrideKey: G3OverrideKey, value: string, reason: string, operator: string) {
  return normalizeOverview(await g3Request<BackendOverview>(`/nex/overrides/${encodeURIComponent(overrideKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: `g3-override-${overrideKey}`,
  }));
}

export async function advanceG3CurrentFrame(reason: string, operator: string) {
  return normalizeOverview(await g3Request<BackendOverview>("/nex/curve/advance", {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "g3-advance",
  }));
}
