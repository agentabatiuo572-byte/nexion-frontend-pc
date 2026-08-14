import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { currentAdminOperator } from "@/lib/admin/current-operator";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type H1RhythmParamKey = "totalMonths" | "currentMonth" | "phaseProgressPct";

export interface H1RhythmOverview {
  totalMonths: number;
  currentMonth: number;
  currentPhase: string;
  phaseProgressPct: number;
  options: number[];
  sources: string[];
}

let requestSeq = 0;

/** crypto.randomUUID 只在 secure context 存在;局域网 http 演示下会是 undefined。仓内统一兜底写法。 */
function randomSuffix() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

function nextIdempotencyKey(prefix: string) {
  requestSeq += 1;
  // 随机段:H8 命令号被持久化 24h,而 sessionStorage 是 per-tab 的 —— 两个标签页同毫秒首次提交时
  // 时间戳与各自从 0 起的序号都相同,撞号会让后端静默吞掉第二个人的操作。
  return `${prefix}-${Date.now()}-${requestSeq}-${randomSuffix()}`;
}

export function createH8CommandKey(prefix: "h8-param" | "h8-settle") {
  return nextIdempotencyKey(prefix);
}

/** H8 提交「结果未知」:命令号已随请求出手,调用方必须保留原号供原样重试,后端按号去重。 */
export class H8OutcomeUncertainError extends Error {
  constructor(message: string, readonly commandKey: string) {
    super(message);
    this.name = "H8OutcomeUncertainError";
  }
}

export function isH8OutcomeUncertainError(error: unknown): error is H8OutcomeUncertainError {
  if (error instanceof H8OutcomeUncertainError) return true;
  return error instanceof Error
    && error.name === "H8OutcomeUncertainError"
    && typeof (error as Error & { commandKey?: unknown }).commandKey === "string";
}

function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requiredNumber(value: unknown, field: string) {
  const n = numberValue(value);
  if (n == null) throw new Error(`H1_RESPONSE_INVALID:${field}`);
  return n;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeRhythm(raw?: Record<string, unknown> | null): H1RhythmOverview {
  if (!raw) throw new Error("H1_RESPONSE_INVALID:rhythm");
  const rawOptions = Array.isArray(raw?.options) ? raw.options : [];
  const options = rawOptions.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  const totalMonths = Math.max(1, Math.round(requiredNumber(raw.totalMonths, "totalMonths")));
  const rawCurrentMonth = requiredNumber(raw.currentMonth, "currentMonth");
  const rawPhaseProgress = requiredNumber(raw.phaseProgressPct, "phaseProgressPct");
  const currentPhase = typeof raw.currentPhase === "string" && raw.currentPhase.trim()
    ? raw.currentPhase.trim()
    : null;
  if (!currentPhase) throw new Error("H1_RESPONSE_INVALID:currentPhase");
  return {
    totalMonths,
    currentMonth: clampInt(rawCurrentMonth, 1, totalMonths),
    currentPhase,
    phaseProgressPct: rawPhaseProgress == null ? 0 : clampInt(rawPhaseProgress, 0, 100),
    options,
    sources: Array.isArray(raw?.sources) ? raw.sources.map(String) : [],
  };
}

export async function growthRequest<T>(path: string, init?: RequestInit, idempotencyPrefix?: string): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (idempotencyPrefix && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", nextIdempotencyKey(idempotencyPrefix));
  }

  const response = await guardedFetch(`/api/admin/growth${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  // 与兄弟 client(e1/f1/a4…)同款:2xx 但响应体不是 JSON(网关 HTML 错误页)时
  // 原写法会抛英文 SyntaxError,绕过下面这条已备中文的归因分支。
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    const error = new Error(formatAdminApiError(result?.message, `GROWTH_REQUEST_FAILED_${response.status}`));
    // 带上 HTTP 状态码 + 回执是否读得出:H8 的稳定命令号靠它们区分「后端明确拒绝(4xx)」与
    // 「结果未知(5xx / 回执读不出)」。growth proxy 后端不可达时返回的是**带 JSON body 的 503**,
    // 只认解析异常会把它误判成确定性失败。网络层异常已由 guardedFetch 接管(抛出的 Error 没有 status)。
    Object.assign(error, { status: response.status, bodyUnreadable: result === null });
    throw error;
  }
  return result.data as T;
}

function commandBody(
  key: string,
  value: string | number | boolean,
  reason: string,
  operator = currentAdminOperator(),
  expectedValue?: string | number | boolean,
) {
  return JSON.stringify({
    key,
    value: String(value),
    reason,
    operator: operator || currentAdminOperator(),
    ...(expectedValue === undefined ? {} : { expectedValue: String(expectedValue) }),
  });
}

export async function fetchH1Rhythm(): Promise<H1RhythmOverview> {
  return normalizeRhythm(await growthRequest<Record<string, unknown>>("/rhythm"));
}

export async function fetchH1Phases(): Promise<Record<string, any>> {
  const data = await growthRequest<Record<string, any>>("/phases");
  return { ...data, rhythm: normalizeRhythm(data.rhythm) };
}

export async function updateH1RhythmParam(
  key: H1RhythmParamKey,
  value: string | number,
  reason: string,
  operator = currentAdminOperator(),
): Promise<H1RhythmOverview> {
  return normalizeRhythm(
    await growthRequest<Record<string, unknown>>(
      `/rhythm/${key}`,
      { method: "PATCH", body: commandBody(key, value, reason, operator) },
      "h1-rhythm",
    ),
  );
}

export async function updateH1MonthDial(month: number, key: string, value: string | number, reason: string) {
  return fetchH1PhaseMutation(`/phases/months/${month}/dials/${encodeURIComponent(key)}`, key, value, reason, "h1-month-dial");
}

export async function updateH1Control(key: string, value: string, reason: string) {
  return fetchH1PhaseMutation(`/phases/controls/${encodeURIComponent(key)}`, key, value, reason, "h1-control");
}

export async function updateH1Override(id: string, disabled: boolean, reason: string) {
  return fetchH1PhaseMutation(`/phases/overrides/${encodeURIComponent(id)}`, "disabled", disabled, reason, "h1-override");
}

async function fetchH1PhaseMutation(path: string, key: string, value: string | number | boolean, reason: string, idempotency: string) {
  const data = await growthRequest<Record<string, any>>(
    path,
    { method: "PATCH", body: commandBody(key, value, reason) },
    idempotency,
  );
  return { ...data, rhythm: normalizeRhythm(data.rhythm) };
}

export async function fetchH2Trials(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/trials");
}

export async function updateH2TrialParam(key: string, value: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/trials/params/${encodeURIComponent(key)}`,
    { method: "PATCH", body: commandBody(key, value, reason) },
    "h2-param",
  );
}

export async function cancelH2TrialSession(sessionId: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/trials/sessions/${encodeURIComponent(sessionId)}/cancel`,
    { method: "POST", body: commandBody("cancel", "cancelled", reason) },
    "h2-cancel",
  );
}

export async function chargeH2TrialSession(sessionId: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/trials/sessions/${encodeURIComponent(sessionId)}/charge`,
    { method: "POST", body: commandBody("charge", "redeemed", reason) },
    "h2-charge",
  );
}

export async function killH2AutoPush(reason: string) {
  return growthRequest<Record<string, any>>(
    "/trials/auto-push/kill",
    { method: "POST", body: commandBody("autoPushKilled", "true", reason) },
    "h2-auto-push",
  );
}

export async function fetchH3QuestEvents(section: "tasks" | "events" = "tasks"): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>(section === "events" ? "/quest-events/events-overview" : "/quest-events/tasks");
}

export async function updateH3QuestConfig(key: string, value: string, reason: string, expectedValue: string) {
  return growthRequest<Record<string, any>>(
    `/quest-events/config/${encodeURIComponent(key)}`,
    { method: "PATCH", body: commandBody(key, value, reason, currentAdminOperator(), expectedValue) },
    "h3-config",
  );
}

export async function updateH4EventReward(eventId: string, value: string, expectedValue: string, reason: string) {
  return h4EventMutation(eventId, "reward", value, expectedValue, reason);
}

export async function updateH4EventStatus(eventId: string, value: string, expectedValue: string, reason: string) {
  return h4EventMutation(eventId, "status", value, expectedValue, reason);
}

export async function updateH4EventFeatured(eventId: string, value: boolean, expectedValue: boolean, reason: string) {
  return h4EventMutation(eventId, "featured", value, expectedValue, reason);
}

async function h4EventMutation(
  eventId: string,
  field: string,
  value: string | boolean,
  expectedValue: string | boolean,
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/quest-events/events/${encodeURIComponent(eventId)}/${field}`,
    { method: "PATCH", body: commandBody(field, value, reason, currentAdminOperator(), expectedValue) },
    `h4-${field}`,
  );
}

export async function fetchH5CheckIn(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/check-in");
}

export async function updateH5CheckInRule(key: string, value: string, expectedValue: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/check-in/rules/${encodeURIComponent(key)}`,
    { method: "PATCH", body: commandBody(key, value, reason, currentAdminOperator(), expectedValue) },
    "h5-rule",
  );
}

export async function updateH5StreakMilestone(id: number, value: string, expectedValue: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/check-in/streak-milestones/${id}`,
    { method: "PATCH", body: commandBody("reward", value, reason, currentAdminOperator(), expectedValue) },
    "h5-streak",
  );
}

export async function updateH5PowerUp(
  id: number,
  day: string | number,
  note: string,
  expectedDay: string | number,
  expectedNote: string,
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/check-in/power-ups/${id}/config`,
    {
      method: "PATCH",
      body: JSON.stringify({
        day: Number(day),
        note,
        expectedDay: Number(expectedDay),
        expectedNote,
        reason,
        operator: currentAdminOperator(),
      }),
    },
    "h5-power",
  );
}

export async function updateH5EarnMilestone(key: string, thresholdUsd: string | number, rewardNex: string | number, reason: string) {
  return growthRequest<Record<string, any>>(
    `/earn-milestones/${encodeURIComponent(key)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ thresholdUsd: Number(thresholdUsd), rewardNex: Number(rewardNex), reason, operator: currentAdminOperator() }),
    },
    "h5-earn",
  );
}

export async function updateH5EarnTickInterval(value: string | number, reason: string) {
  return growthRequest<Record<string, any>>(
    "/earn-milestones/tick-interval",
    { method: "PATCH", body: commandBody("tick", value, reason) },
    "h5-earn-tick",
  );
}

export async function fetchH7Vouchers(): Promise<Record<string, any>> {
  return growthRequest<Record<string, any>>("/vouchers");
}

export async function createH7Voucher(voucher: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/vouchers",
    { method: "POST", body: JSON.stringify({ ...voucher, reason, operator: currentAdminOperator() }) },
    "h7-create",
  );
}

export async function updateH7Voucher(
  id: string,
  voucher: Record<string, any>,
  reason: string,
  expectedVersion: number,
) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ ...voucher, id, expectedVersion, reason, operator: currentAdminOperator() }) },
    "h7-update",
  );
}

export async function updateH7VoucherStatus(
  id: string,
  status: "active" | "paused",
  reason: string,
  expectedVersion: number,
) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}/status`,
    { method: "PATCH", body: commandBody("status", status, reason, currentAdminOperator(), expectedVersion) },
    "h7-status",
  );
}

export async function deleteH7Voucher(id: string, reason: string, expectedVersion: number) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}`,
    { method: "DELETE", body: commandBody("delete", "delete", reason, currentAdminOperator(), expectedVersion) },
    "h7-delete",
  );
}

export async function revokeH7VoucherAvailableGrants(id: string, reason: string, expectedVersion: number) {
  return growthRequest<Record<string, any>>(
    `/vouchers/${encodeURIComponent(id)}/grants/revoke-available`,
    { method: "PATCH", body: commandBody("grants", "revoke-available", reason, currentAdminOperator(), expectedVersion) },
    "h7-revoke-available",
  );
}

export interface H8SettlementRow {
  settlementNo?: string;
  invitedUserId?: number;
  inviterUserId?: number;
  newcomerUsdt?: number | string;
  newcomerNex?: number | string;
  inviterNex?: number | string;
  status?: string;
  createdAt?: string;
}

export interface H8ReferralRewardOverview {
  version: number;
  rewardSnapshotHash: string;
  effectiveAt: string;
  params: Record<string, number | string>;
  effectiveRewards: Record<string, number | string>;
  rhythmMonth: number;
  newcomerMultiplier: number | string;
  inviterMultiplier: number | string;
  pending: number;
  settled: number;
  blockedByK2: number;
  recentSettlements: H8SettlementRow[];
  source: string;
  sourceEnvironment?: "SANDBOX";
  sourceType?: "MOCK_REFERRAL";
  settlementMode: string;
  runId?: string;
  fixtureCandidates?: Array<{ invitedUserId: number; inviterUserId: number }>;
}

export function h8AcceptanceRunId(): string | null {
  // This browser value is an expectation only. The acceptance controller owns
  // the RunID from its process environment and rejects another valid RunID.
  const value = process.env.NEXT_PUBLIC_NEXION_H8_ACCEPTANCE_RUN_ID?.trim() ?? "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(value) ? value : null;
}

function h8Invalid(field: string): never {
  throw new Error(`H8_RESPONSE_INVALID:${field}`);
}

function h8Record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) h8Invalid(field);
  return value as Record<string, unknown>;
}

function h8NonNegativeCount(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) h8Invalid(field);
  return parsed;
}

function h8PositiveCount(value: unknown, field: string): number {
  const parsed = h8NonNegativeCount(value, field);
  if (parsed < 1) h8Invalid(field);
  return parsed;
}

function h8Decimal(value: unknown, field: string): number | string {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) h8Invalid(field);
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999_999) h8Invalid(field);
  return typeof value === "string" ? text : parsed;
}

function h8PositiveDecimal(value: unknown, field: string): number | string {
  const parsed = h8Decimal(value, field);
  if (Number(parsed) <= 0) h8Invalid(field);
  return parsed;
}

function h8String(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) h8Invalid(field);
  return value.trim();
}

function h8IsoInstant(value: unknown, field: string): string {
  const text = h8String(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
      || Number.isNaN(Date.parse(text))) {
    h8Invalid(field);
  }
  return text;
}

export function parseH8ReferralRewardOverview(value: unknown): H8ReferralRewardOverview {
  const root = h8Record(value, "root");
  const params = h8Record(root.params, "params");
  const effective = h8Record(root.effectiveRewards, "effectiveRewards");
  const expectedParams = ["newcomer.usdt", "newcomer.nex", "newcomer.lockMode", "inviter.nex"];
  if (expectedParams.some((key) => !(key in params))) h8Invalid("params.keys");
  const lockMode = h8String(params["newcomer.lockMode"], "params.newcomer.lockMode");
  if (lockMode !== "risk_bucket" && lockMode !== "direct") h8Invalid("params.newcomer.lockMode");
  const rows = Array.isArray(root.recentSettlements)
    ? root.recentSettlements.map((value, index): H8SettlementRow => {
        const row = h8Record(value, `recentSettlements.${index}`);
        const status = h8String(row.status, `recentSettlements.${index}.status`);
        if (status !== "SETTLED") h8Invalid(`recentSettlements.${index}.status`);
        return {
          settlementNo: h8String(row.settlementNo, `recentSettlements.${index}.settlementNo`),
          invitedUserId: h8PositiveCount(row.invitedUserId, `recentSettlements.${index}.invitedUserId`),
          inviterUserId: h8PositiveCount(row.inviterUserId, `recentSettlements.${index}.inviterUserId`),
          newcomerUsdt: h8Decimal(row.newcomerUsdt, `recentSettlements.${index}.newcomerUsdt`),
          newcomerNex: h8Decimal(row.newcomerNex, `recentSettlements.${index}.newcomerNex`),
          inviterNex: h8Decimal(row.inviterNex, `recentSettlements.${index}.inviterNex`),
          status,
          createdAt: row.createdAt == null ? undefined : h8String(row.createdAt, `recentSettlements.${index}.createdAt`),
        };
      })
    : h8Invalid("recentSettlements");
  const source = h8String(root.source, "source");
  const settlementMode = h8String(root.settlementMode, "settlementMode");
  const sandbox = source === "mock";
  const sourceEnvironment = root.sourceEnvironment == null ? undefined : h8String(root.sourceEnvironment, "sourceEnvironment");
  const sourceType = root.sourceType == null ? undefined : h8String(root.sourceType, "sourceType");
  const runId = root.runId == null ? undefined : h8String(root.runId, "runId");
  if (sandbox) {
    if (sourceEnvironment !== "SANDBOX" || sourceType !== "MOCK_REFERRAL" || !runId || settlementMode !== "SANDBOX") {
      h8Invalid("sandbox.provenance");
    }
  } else if (source !== "nx_user.sponsor_user_id" || settlementMode !== "REAL_WALLET_LEDGER") {
    h8Invalid("production.provenance");
  }
  const fixtureCandidates = sandbox
    ? (Array.isArray(root.fixtureCandidates) ? root.fixtureCandidates.map((value, index) => {
        const row = h8Record(value, `fixtureCandidates.${index}`);
        return {
          invitedUserId: h8PositiveCount(row.invitedUserId, `fixtureCandidates.${index}.invitedUserId`),
          inviterUserId: h8PositiveCount(row.inviterUserId, `fixtureCandidates.${index}.inviterUserId`),
        };
      }) : h8Invalid("fixtureCandidates"))
    : undefined;
  return {
    version: h8PositiveCount(root.version, "version"),
    rewardSnapshotHash: (() => {
      const value = h8String(root.rewardSnapshotHash, "rewardSnapshotHash");
      if (!/^[a-f0-9]{64}$/i.test(value)) h8Invalid("rewardSnapshotHash");
      return value.toLowerCase();
    })(),
    effectiveAt: h8IsoInstant(root.effectiveAt, "effectiveAt"),
    params: {
      "newcomer.usdt": h8Decimal(params["newcomer.usdt"], "params.newcomer.usdt"),
      "newcomer.nex": h8Decimal(params["newcomer.nex"], "params.newcomer.nex"),
      "newcomer.lockMode": lockMode,
      "inviter.nex": h8Decimal(params["inviter.nex"], "params.inviter.nex"),
    },
    effectiveRewards: {
      "newcomer.usdt": h8Decimal(effective["newcomer.usdt"], "effectiveRewards.newcomer.usdt"),
      "newcomer.nex": h8Decimal(effective["newcomer.nex"], "effectiveRewards.newcomer.nex"),
      "inviter.nex": h8Decimal(effective["inviter.nex"], "effectiveRewards.inviter.nex"),
    },
    rhythmMonth: h8PositiveCount(root.rhythmMonth, "rhythmMonth"),
    newcomerMultiplier: h8PositiveDecimal(root.newcomerMultiplier, "newcomerMultiplier"),
    inviterMultiplier: h8PositiveDecimal(root.inviterMultiplier, "inviterMultiplier"),
    pending: h8NonNegativeCount(root.pending, "pending"),
    settled: h8NonNegativeCount(root.settled, "settled"),
    blockedByK2: h8NonNegativeCount(root.blockedByK2, "blockedByK2"),
    recentSettlements: rows,
    source,
    sourceEnvironment: sandbox ? "SANDBOX" : undefined,
    sourceType: sandbox ? "MOCK_REFERRAL" : undefined,
    settlementMode,
    runId,
    fixtureCandidates,
  };
}

export async function fetchH8ReferralRewards(): Promise<H8ReferralRewardOverview> {
  const runId = h8AcceptanceRunId();
  if (runId) {
    return fetchH8AcceptanceSandboxOverview(runId);
  }
  return parseH8ReferralRewardOverview(await growthRequest<unknown>("/referral-rewards"));
}

/** RunID is part of the authoritative acceptance projection identity, never a UI filter. */
export async function fetchH8AcceptanceSandboxOverview(runId: string): Promise<H8ReferralRewardOverview> {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(runId)) {
    throw new Error("H8_ACCEPTANCE_RUN_ID_INVALID");
  }
  const overview = parseH8ReferralRewardOverview(await growthRequest<unknown>(
    `/referral-rewards/acceptance/overview?runId=${encodeURIComponent(runId)}`,
  ));
  if (overview.runId !== runId) throw new Error("H8_ACCEPTANCE_RUN_ID_MISMATCH");
  return overview;
}

/** The POST API's `data` is the settlement map itself, not an extra wrapper. */
export interface H8AcceptanceSandboxSettlementResult {
  runId: string;
  source: "mock";
  sourceEnvironment: "SANDBOX";
  sourceType: "MOCK_REFERRAL";
  settled: number;
  skipped: number;
  limit: number;
}

function parseH8AcceptanceSandboxSettlement(value: unknown): H8AcceptanceSandboxSettlementResult {
  const root = h8Record(value, "sandboxSettlement.root");
  const runId = h8String(root.runId, "sandboxSettlement.runId");
  const source = h8String(root.source, "sandboxSettlement.source");
  const sourceEnvironment = h8String(root.sourceEnvironment, "sandboxSettlement.sourceEnvironment");
  const sourceType = h8String(root.sourceType, "sandboxSettlement.sourceType");
  if (source !== "mock" || sourceEnvironment !== "SANDBOX" || sourceType !== "MOCK_REFERRAL") {
    h8Invalid("sandboxSettlement.provenance");
  }
  return {
    runId,
    source: "mock",
    sourceEnvironment: "SANDBOX",
    sourceType: "MOCK_REFERRAL",
    settled: h8NonNegativeCount(root.settled, "sandboxSettlement.settled"),
    skipped: h8NonNegativeCount(root.skipped, "sandboxSettlement.skipped"),
    limit: h8PositiveCount(root.limit, "sandboxSettlement.limit"),
  };
}

export async function runH8AcceptanceSandboxSettlement(
  runId: string,
  invitedUserId: number,
  reason: string,
  idempotencyKey: string,
) {
  try {
    const result = await growthRequest<unknown>("/referral-rewards/acceptance/sandbox-settlements", {
      method: "POST",
      body: JSON.stringify({ runId, invitedUserId, reason, operator: currentAdminOperator() }),
      headers: { "Idempotency-Key": idempotencyKey },
    });
    const settlement = parseH8AcceptanceSandboxSettlement(result);
    if (settlement.runId !== runId) throw new Error("H8_ACCEPTANCE_RUN_ID_MISMATCH");
    return settlement;
  } catch (error) {
    const { status, bodyUnreadable } = error as Error & { status?: number; bodyUnreadable?: boolean };
    if (typeof status !== "number" || bodyUnreadable || outcomeStaysUnknown(status)) {
      throw new H8OutcomeUncertainError(
        (error instanceof Error && error.message) || "H8_ACCEPTANCE_SETTLEMENT_OUTCOME_UNKNOWN",
        idempotencyKey,
      );
    }
    throw error;
  }
}

export async function updateH8ReferralRewardParam(
  key: string,
  value: string,
  reason: string,
  expectedVersion: number,
  idempotencyKey: string,
) {
  try {
    return await growthRequest<Record<string, unknown>>(
      `/referral-rewards/params/${encodeURIComponent(key)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          key,
          value,
          expectedVersion,
          reason,
          operator: currentAdminOperator(),
        }),
        headers: { "Idempotency-Key": idempotencyKey },
      },
    );
  } catch (error) {
    // 三类「结果未知」,后端都可能已执行,必须保留命令号供原样重试:
    //   ① 没有 HTTP 状态码 = 网络层异常(guardedFetch 已转中文抛出),请求可能已到达后端;
    //   ② 回执读不出(网关 HTML 错误页);③ 5xx(growth proxy 后端不可达就是带 JSON body 的 503)。
    // 4xx 与「200 但业务码非 0」= 后端明确拒绝,确定性失败弃号。口径与 f1-client 同款。
    const { status, bodyUnreadable } = error as Error & { status?: number; bodyUnreadable?: boolean };
    if (typeof status !== "number" || bodyUnreadable || outcomeStaysUnknown(status)) {
      throw new H8OutcomeUncertainError(
        (error instanceof Error && error.message) || "H8_REQUEST_OUTCOME_UNKNOWN",
        idempotencyKey,
      );
    }
    throw error;
  }
}


// ===== H3/H4 业务实体创建(后端 POST /growth/quest-events/*) =====

export async function createH3Mission(mission: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/missions",
    { method: "POST", body: JSON.stringify({ ...mission, reason, operator: currentAdminOperator() }) },
    "h3-mission-create",
  );
}

export async function createH3MonthlyMission(mission: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/monthly-missions",
    { method: "POST", body: JSON.stringify({ ...mission, reason, operator: currentAdminOperator() }) },
    "h3-monthly-create",
  );
}

export type H3MissionKind = "MISSION" | "MONTHLY";

export async function editH3Mission(
  taskCode: string,
  taskKind: H3MissionKind,
  name: string,
  expectedName: string,
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/quest-events/tasks/${encodeURIComponent(taskCode)}`,
    { method: "PATCH", body: JSON.stringify({ taskKind, name, expectedName, reason, operator: currentAdminOperator() }) },
    "h3-mission-edit",
  );
}

export async function transitionH3Mission(
  taskCode: string,
  taskKind: H3MissionKind,
  targetStatus: "active" | "paused",
  expectedStatus: "active" | "paused",
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/quest-events/tasks/${encodeURIComponent(taskCode)}/status`,
    { method: "PATCH", body: JSON.stringify({ taskKind, targetStatus, expectedStatus, reason, operator: currentAdminOperator() }) },
    "h3-mission-status",
  );
}

export async function archiveH3Mission(
  taskCode: string,
  taskKind: H3MissionKind,
  expectedStatus: "active" | "paused",
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/quest-events/tasks/${encodeURIComponent(taskCode)}/archive`,
    { method: "POST", body: JSON.stringify({ taskKind, targetStatus: "archived", expectedStatus, reason, operator: currentAdminOperator() }) },
    "h3-mission-archive",
  );
}

export async function deleteH3Mission(taskCode: string, taskKind: H3MissionKind, reason: string) {
  return growthRequest<Record<string, any>>(
    `/quest-events/tasks/${encodeURIComponent(taskCode)}`,
    { method: "DELETE", body: JSON.stringify({ taskKind, targetStatus: "deleted", expectedStatus: "archived", reason, operator: currentAdminOperator() }) },
    "h3-mission-delete",
  );
}

export async function createH4QuestEvent(event: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/events",
    { method: "POST", body: JSON.stringify({ ...event, reason, operator: currentAdminOperator() }) },
    "h4-event-create",
  );
}

export async function createH4WheelTier(tier: Record<string, any>, expectedSignature: string, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/wheel-tiers",
    { method: "POST", body: JSON.stringify({ ...tier, expectedSignature, reason, operator: currentAdminOperator() }) },
    "h4-tier-create",
  );
}

export async function updateH4WheelProbabilities(
  probabilities: Record<string, number>,
  expectedSignature: string,
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    "/quest-events/wheel-tiers/probabilities",
    { method: "PATCH", body: JSON.stringify({ probabilities, expectedSignature, reason, operator: currentAdminOperator() }) },
    "h4-tier-probabilities",
  );
}

export async function updateH4WheelTier(
  tierName: string,
  tier: Record<string, any>,
  expectedSignature: string,
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/quest-events/wheel-tiers/${encodeURIComponent(tierName)}`,
    { method: "PATCH", body: JSON.stringify({ ...tier, expectedSignature, reason, operator: currentAdminOperator() }) },
    "h4-tier-update",
  );
}

export async function deleteH4WheelTier(tierName: string, expectedSignature: string, reason: string) {
  return growthRequest<Record<string, any>>(
    `/quest-events/wheel-tiers/${encodeURIComponent(tierName)}`,
    {
      method: "DELETE",
      body: commandBody("delete", "delete", reason, currentAdminOperator(), expectedSignature),
    },
    "h4-tier-delete",
  );
}

export async function createH4WheelGuard(guard: Record<string, any>, reason: string) {
  return growthRequest<Record<string, any>>(
    "/quest-events/wheel-guards",
    { method: "POST", body: JSON.stringify({ ...guard, reason, operator: currentAdminOperator() }) },
    "h4-guard-create",
  );
}

export async function updateH4WheelGuard(
  guardKey: string,
  value: string,
  expectedValue: string,
  reason: string,
) {
  return growthRequest<Record<string, any>>(
    `/quest-events/wheel-guards/${encodeURIComponent(guardKey)}`,
    {
      method: "PATCH",
      body: commandBody(guardKey, value, reason, currentAdminOperator(), expectedValue),
    },
    "h4-guard-update",
  );
}
