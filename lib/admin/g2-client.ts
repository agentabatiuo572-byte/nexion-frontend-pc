import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { assertG2OverviewContract } from "@/lib/admin/g-overview-contract";
import { classifyStableMutationFailure, createStableMutationExecutor, StableMutationFailure, stableMutationFingerprint, stableMutationHttpFailure } from "@/lib/admin/stable-mutation";
import { normalizeG2BatchResult } from "@/lib/admin/g2-batch-result";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

interface BackendStats {
  todayUsd?: number | string | null;
  poolPct?: number | string | null;
  queueDepth?: number | string | null;
  gateUser?: number | string | null;
  gatePlatform?: number | string | null;
  gateGeo?: number | string | null;
}

interface BackendCap {
  key?: string | null;
  name?: string | null;
  sub?: string | null;
  value?: unknown;
  displayValue?: string | null;
  note?: string | null;
  loosen?: boolean | string | null;
  meterPct?: number | string | null;
}

interface BackendOrder {
  id?: number | string | null;
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  countryCode?: string | null;
  exchangeNo?: string | null;
  fromAsset?: string | null;
  toAsset?: string | null;
  fromAmount?: number | string | null;
  toAmount?: number | string | null;
  rate?: number | string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  directionLabel?: string | null;
  amountUsdt?: number | string | null;
  gateType?: string | null;
  gateReason?: string | null;
  etaLabel?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface BackendGateDetail {
  key?: string | null;
  title?: string | null;
  note?: string | null;
  count?: number | string | null;
  rows?: BackendOrder[] | null;
}

interface BackendCoverage {
  coverageRatio?: number | string | null;
  redlinePct?: number | string | null;
  redlineBreached?: boolean | string | null;
  precheck?: string | null;
}

interface BackendSwap {
  enabled?: boolean | string | null;
  status?: string | null;
  configKey?: string | null;
  linkedDomain?: string | null;
}

interface BackendGeoBlocked {
  cc?: string | null;
  name?: string | null;
  status?: string | null;
  reason?: string | null;
}

interface BackendOverview {
  domain?: string | null;
  asset?: string | null;
  currency?: string | null;
  currentPrice?: number | string | null;
  stats?: BackendStats | null;
  caps?: BackendCap[] | null;
  queue?: BackendOrder[] | null;
  gateDetails?: Record<string, BackendGateDetail | null> | null;
  swap?: BackendSwap | null;
  geoBlocked?: BackendGeoBlocked[] | null;
  coverage?: BackendCoverage | null;
  serverCanonical?: boolean | null;
  sources?: string[] | null;
  batch?: unknown;
}

export interface G2Stats {
  todayUsd: number;
  poolPct: number;
  queueDepth: number;
  gateUser: number;
  gatePlatform: number;
  gateGeo: number;
}

export interface G2Cap {
  key: string;
  name: string;
  sub: string;
  value: string;
  displayValue: string;
  note: string;
  loosen: boolean;
  meterPct?: number;
}

export interface G2ExchangeOrder {
  id: string;
  userId: number;
  userNo: string;
  nickname: string;
  countryCode: string;
  exchangeNo: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: number;
  toAmount: number;
  rate: number;
  status: string;
  statusLabel: string;
  statusTone: string;
  directionLabel: string;
  amountUsdt: number;
  amountUsdtDisplay: string;
  exchangeAmountDisplay: string;
  gateType: string;
  gateReason: string;
  etaLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface G2GateDetail {
  key: string;
  title: string;
  note: string;
  count: number;
  rows: G2ExchangeOrder[];
}

export interface G2Coverage {
  coverageRatio: number;
  redlinePct: number;
  redlineBreached: boolean;
  precheck: string;
}

export interface G2Swap {
  enabled: boolean;
  status: string;
  configKey: string;
  linkedDomain: string;
}

export interface G2GeoBlocked {
  cc: string;
  name: string;
  status: string;
  reason: string;
}

export interface G2Overview {
  stats: G2Stats;
  caps: G2Cap[];
  queue: G2ExchangeOrder[];
  gateDetails: Record<string, G2GateDetail>;
  swap: G2Swap;
  geoBlocked: G2GeoBlocked[];
  coverage: G2Coverage;
  serverCanonical: boolean;
  sources: string[];
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

const BATCH_PATH = "/exchange/queue/process";
const BATCH_PREFIX = "g2-queue-batch";
const BATCH_INTENT = `${BATCH_PREFIX}:${stableMutationFingerprint("POST", BATCH_PATH, "")}`;
const pendingCommands = createPendingMutationStore<PendingMutationRecord & { adminId?: number }>({
  storageKey: "nexion-admin-g2-exchange-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (record) => record.fingerprint.startsWith(BATCH_INTENT) || record.expiresAt > Date.now(),
});
const executeG2Mutation = createStableMutationExecutor(idempotencyKey, pendingCommands);

export interface G2PendingBatch extends PendingMutationRecord {
  adminId: number;
  limit: number;
  reason: string;
  body: string;
}

export class G2BatchReceiptNotFound extends Error {
  constructor() {
    super("暂未找到可核对的原回执。请先查看操作记录。");
  }
}

export function pendingG2QueueBatch(adminId: number): G2PendingBatch | undefined {
  if (!Number.isSafeInteger(adminId) || adminId < 1) return;
  for (const record of pendingCommands.list()) {
    if (!record.fingerprint.startsWith(BATCH_INTENT) || !/^g2-queue-batch-\d+-\d+$/.test(record.commandKey)) continue;
    if (record.adminId === undefined ? !hasPersistedPendingCommandOwner(String(adminId)) : record.adminId !== adminId) continue;
    const body = record.fingerprint.slice(BATCH_INTENT.length);
    try {
      const draft = JSON.parse(body) as { limit: number; reason: string; operator: string } | null;
      if (draft && Number.isSafeInteger(draft.limit) && draft.limit >= 1 && draft.limit <= 100
          && typeof draft.reason === "string" && draft.reason.trim() && typeof draft.operator === "string") {
        return { ...record, adminId, limit: draft.limit, reason: draft.reason, body };
      }
    } catch { /* An incomplete legacy record cannot be submitted or queried. */ }
  }
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
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

function asText(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function fmtNumber(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtUsd(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function normalizeOrder(row: BackendOrder): G2ExchangeOrder {
  const fromAsset = asText(row.fromAsset, "UVT");
  const toAsset = asText(row.toAsset, "USDT");
  const fromAmount = toNumber(row.fromAmount);
  const toAmount = toNumber(row.toAmount);
  const amountUsdt = toNumber(row.amountUsdt, toAsset.toUpperCase() === "USDT" ? toAmount : fromAmount);
  return {
    id: String(row.id ?? ""),
    userId: toNumber(row.userId),
    userNo: asText(row.userNo),
    nickname: asText(row.nickname),
    countryCode: asText(row.countryCode, "--"),
    exchangeNo: asText(row.exchangeNo),
    fromAsset,
    toAsset,
    fromAmount,
    toAmount,
    rate: toNumber(row.rate),
    status: asText(row.status, "UNKNOWN"),
    statusLabel: asText(row.statusLabel, asText(row.status, "UNKNOWN")),
    statusTone: asText(row.statusTone, "dim"),
    directionLabel: asText(row.directionLabel, `${fromAsset}->${toAsset}`),
    amountUsdt,
    amountUsdtDisplay: fmtUsd(amountUsdt),
    exchangeAmountDisplay: `${fmtNumber(fromAmount)} ${fromAsset} -> ${fmtNumber(toAmount)} ${toAsset}`,
    gateType: asText(row.gateType, ""),
    gateReason: asText(row.gateReason),
    etaLabel: asText(row.etaLabel),
    createdAt: asText(row.createdAt, ""),
    updatedAt: asText(row.updatedAt, ""),
  };
}

function normalizeCap(row: BackendCap): G2Cap {
  const key = asText(row.key, "unknown");
  const value = row.value == null ? "" : String(row.value);
  return {
    key,
    name: asText(row.name, key),
    sub: asText(row.sub),
    value,
    displayValue: asText(row.displayValue, value || "—"),
    note: asText(row.note),
    loosen: toBool(row.loosen, false),
    meterPct: row.meterPct == null ? undefined : toNumber(row.meterPct),
  };
}

function normalizeGate(key: string, detail: BackendGateDetail | null | undefined): G2GateDetail {
  const rows = (detail?.rows ?? []).map(normalizeOrder);
  return {
    key: asText(detail?.key, key),
    title: asText(detail?.title, key),
    note: asText(detail?.note),
    count: toNumber(detail?.count, rows.length),
    rows,
  };
}

function normalizeOverview(data: BackendOverview | null | undefined): G2Overview {
  assertG2OverviewContract(data);
  const stats = data?.stats ?? {};
  const coverage = data?.coverage ?? {};
  const swap = data?.swap ?? {};
  const gateDetails = data?.gateDetails ?? {};
  return {
    stats: {
      todayUsd: toNumber(stats.todayUsd),
      poolPct: toNumber(stats.poolPct),
      queueDepth: toNumber(stats.queueDepth),
      gateUser: toNumber(stats.gateUser),
      gatePlatform: toNumber(stats.gatePlatform),
      gateGeo: toNumber(stats.gateGeo),
    },
    caps: (data?.caps ?? []).map(normalizeCap),
    queue: (data?.queue ?? []).map(normalizeOrder),
    gateDetails: {
      user: normalizeGate("user", gateDetails.user),
      platform: normalizeGate("platform", gateDetails.platform),
      geo: normalizeGate("geo", gateDetails.geo),
    },
    swap: {
      enabled: toBool(swap.enabled, true),
      status: asText(swap.status, "enabled"),
      configKey: asText(swap.configKey, "killswitch.exchange"),
      linkedDomain: asText(swap.linkedDomain, "J1"),
    },
    geoBlocked: (data?.geoBlocked ?? []).map((row) => ({
      cc: asText(row.cc),
      name: asText(row.name),
      status: asText(row.status),
      reason: asText(row.reason),
    })),
    coverage: {
      coverageRatio: toNumber(coverage.coverageRatio),
      redlinePct: toNumber(coverage.redlinePct),
      redlineBreached: toBool(coverage.redlineBreached, false),
      precheck: asText(coverage.precheck, "loosening exchange outflow requires B1 coverage redline check"),
    },
    serverCanonical: data?.serverCanonical === true,
    sources: data?.sources ?? [],
  };
}

async function g2Request<T>(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await guardedFetch(`/api/admin/market${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    if (path === BATCH_PATH && init?.method === "GET" && response.status === 404
        && result?.message === "G2_BATCH_RECEIPT_NOT_FOUND") {
      throw new G2BatchReceiptNotFound();
    }
    const batchStillUnknown = path === BATCH_PATH && init?.method === "POST" && response.status === 409
      && result?.message?.startsWith("IDEMPOTENCY_");
    throw stableMutationHttpFailure(
      formatAdminApiError(result?.message, `G2_REQUEST_FAILED_${response.status}`),
      batchStillUnknown ? 0 : response.status,
      result?.code,
    );
  }

  return result.data as T;
}

function g2OverviewMutation(
  path: string,
  method: "PATCH" | "POST",
  body: Record<string, unknown>,
  prefix: string,
) {
  const serialized = JSON.stringify(body);
  // 指纹带 path:exchangeNo 只在 path 里,不带就会让「不同兑换单、同理由」的取消/复核共用命令号。
  return executeG2Mutation(
    prefix,
    stableMutationFingerprint(method, path, serialized),
    (commandKey) => g2Request<BackendOverview>(path, {
      method,
      headers: { "Idempotency-Key": commandKey },
      body: serialized,
    }),
    normalizeOverview,
  );
}

export async function fetchG2ExchangeOverview() {
  return normalizeOverview(await g2Request<BackendOverview>("/exchange"));
}

export async function updateG2ExchangeParam(paramKey: string, value: string, reason: string, operator: string) {
  return g2OverviewMutation(
    `/exchange/params/${encodeURIComponent(paramKey)}`,
    "PATCH",
    { value, reason, operator },
    `g2-param-${paramKey}`,
  );
}

export async function updateG2ExchangeSwapStatus(
  enabled: boolean,
  reason: string,
  operator: string,
  context: { geoBlock?: string[]; triggerBasis?: string } = {},
) {
  return g2OverviewMutation(
    "/exchange/swap",
    "PATCH",
    { enabled, reason, operator, geoBlock: context.geoBlock ?? [], triggerBasis: context.triggerBasis ?? "OTHER" },
    "g2-swap",
  );
}

async function confirmG2Batch(response: BackendOverview, fingerprint: string, commandKey: string) {
  const batch = normalizeG2BatchResult(response?.batch);
  // Keep the original command until both the receipt and the current queue can be shown.
  let overview: G2Overview;
  try { overview = await fetchG2ExchangeOverview(); }
  catch (error) { throw stableMutationHttpFailure(displayAdminError(error), 0); }
  pendingCommands.forget(fingerprint, commandKey);
  return { overview, batch };
}

export async function processG2ExchangeQueue(adminId: number, limit: number, reason: string, operator: string) {
  const body = JSON.stringify({ limit, reason, operator });
  const original = pendingG2QueueBatch(adminId);
  const now = Date.now();
  if (original && (original.body !== body || now < original.createdAt || now >= original.expiresAt)) {
    throw new StableMutationFailure("outcome-unknown", "原处理结果尚未确认，请先核对原处理。");
  }
  const fingerprint = BATCH_INTENT + body;
  const commandKey = original?.commandKey ?? idempotencyKey(BATCH_PREFIX);
  if (!original) {
    pendingCommands.remember(fingerprint, commandKey, { adminId });
    if (!pendingCommands.isDurablyStored(fingerprint, commandKey)) {
      pendingCommands.forget(fingerprint, commandKey);
      throw new StableMutationFailure("deterministic", "无法保存原命令，请允许浏览器会话存储后再提交。");
    }
  }
  try {
    const response = await g2Request<BackendOverview>(BATCH_PATH, {
      method: "POST", headers: { "Idempotency-Key": commandKey }, body,
    });
    return await confirmG2Batch(response, fingerprint, commandKey);
  } catch (error) {
    if (!original && classifyStableMutationFailure(error) === "deterministic") {
      pendingCommands.forget(fingerprint, commandKey);
    }
    throw error;
  }
}

function requirePendingG2QueueBatch(adminId: number, commandKey: string) {
  const original = pendingG2QueueBatch(adminId);
  if (!original || original.commandKey !== commandKey) throw new Error("原处理记录已变化，请重新打开核对入口。");
  return original;
}

export async function recoverG2ExchangeQueue(adminId: number, commandKey: string) {
  const original = requirePendingG2QueueBatch(adminId, commandKey);
  const response = await g2Request<BackendOverview>(BATCH_PATH, {
    method: "GET", headers: { "Idempotency-Key": original.commandKey },
  });
  return confirmG2Batch(response, original.fingerprint, original.commandKey);
}

export function finishLocalG2QueueBatchReview(adminId: number, commandKey: string) {
  const original = requirePendingG2QueueBatch(adminId, commandKey);
  pendingCommands.forget(original.fingerprint, original.commandKey);
  if (pendingCommands.isDurablyStored(original.fingerprint, original.commandKey)) {
    throw new Error("暂时无法清除本机核对记录，请允许浏览器会话存储后再试。");
  }
}

export async function cancelG2ExchangeQueueOrder(exchangeNo: string, reason: string, operator: string) {
  return g2OverviewMutation(
    `/exchange/queue/${encodeURIComponent(exchangeNo)}/cancel`,
    "POST",
    { reason, operator },
    "g2-cancel-queue",
  );
}
