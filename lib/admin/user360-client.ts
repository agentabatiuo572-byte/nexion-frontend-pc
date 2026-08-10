import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { normalizeAuthoritativePage } from "@/lib/admin/authoritative-page-contract";
import { normalizeC3Adjustment } from "@/lib/admin/c3-adjustment-contract";
import { parseStrictFiniteNumber } from "@/lib/admin/strict-number";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export type JsonRecord = Record<string, unknown>;

interface PageResult<T> {
  total?: number | string | null;
  pageNum?: number | string | null;
  pageSize?: number | string | null;
  records?: T[] | null;
}

export interface UserPage<T> {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
}

export interface UserProfileQuery {
  keyword?: string;
  status?: string;
  riskMin?: number;
  userId?: number | string;
  phoneHash?: string;
  phoneMasked?: string;
  tier?: string;
  vRank?: string;
  referralCode?: string;
  depositMin?: number;
  depositMax?: number;
  usdtMin?: number;
  usdtMax?: number;
  nexMin?: number;
  nexMax?: number;
  riskBand?: string;
  joinedFrom?: string;
  joinedTo?: string;
  pageNum?: number;
  pageSize?: number;
}

export interface User360Profile extends JsonRecord {
  id?: number | string | null;
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  phoneMasked?: string | null;
  countryCode?: string | null;
  status?: string | null;
  userLevel?: string | null;
  vRank?: string | null;
  twoFactorEnabled?: boolean | null;
  walletUsdt?: number | string | null;
  walletNex?: number | string | null;
  riskScore?: number | string | null;
  riskBand?: string | null;
  deviceCount?: number | string | null;
  activeDeviceCount?: number | string | null;
  registeredAt?: string | null;
  lastLoginAt?: string | null;
}

export type UserStatus = "ACTIVE" | "FROZEN" | "BANNED" | "RESTRICTED";

export interface UserSession extends JsonRecord {
  userId?: number | string | null;
  refreshTokenId?: string | null;
  deviceName?: string | null;
  clientIpMasked?: string | null;
  status?: string | null;
  issuedAt?: string | null;
  lastActiveAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
}

export interface UserCredentialParam extends JsonRecord {
  key?: string | null;
  name?: string | null;
  value?: string | null;
  unit?: string | null;
  min?: number | string | null;
  max?: number | string | null;
  readOnly?: boolean | null;
  note?: string | null;
  configKey?: string | null;
  version?: number | string | null;
}

export interface UserSecurityStats extends JsonRecord {
  activeSessions?: number | string | null;
  twoFactorRatePct?: number | string | null;
  lockedShort?: number | string | null;
  lockedLong?: number | string | null;
  tokenReuseToday?: number | string | null;
}

export interface UserSecurityUserRow extends JsonRecord {
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  twoFactorEnabled?: boolean | null;
  loginFailCount?: number | string | null;
  locked?: boolean | null;
  passwordResetRequired?: boolean | null;
  lockKind?: string | null;
  lockLabel?: string | null;
  lockReason?: string | null;
  lockLeft?: string | null;
}

export interface UserSecurityStatus extends JsonRecord {
  userId?: number | string | null;
  twoFactorEnabled?: boolean | null;
  loginFailCount?: number | string | null;
  locked?: boolean | null;
  passwordResetRequired?: boolean | null;
  lockThreshold?: number | string | null;
  lockDurationMinutes?: number | string | null;
}

export interface UserSecurityOverview extends JsonRecord {
  stats?: UserSecurityStats | null;
  credentialParams?: UserCredentialParam[] | null;
  selectedUser?: UserSecurityUserRow | null;
  sessions?: UserPage<UserSession> | null;
  selectedActiveSessionCount?: number | string | null;
  lockedUsers?: UserSecurityUserRow[] | null;
  sources?: string[] | null;
  redlines?: string[] | null;
}

export interface UserRegistrationRiskStats extends JsonRecord {
  otpToday?: number | string | null;
  captchaTriggeredToday?: number | string | null;
  lockedShort?: number | string | null;
  lockedLong?: number | string | null;
  locked?: number | string | null;
  stuffingClusters7d?: number | string | null;
  captchaTemporarilyDisabled?: boolean | null;
  captchaRestoreAt?: string | null;
  captchaRemainingSeconds?: number | string | null;
}

export interface UserRegistrationRiskParam extends JsonRecord {
  group?: string | null;
  key?: string | null;
  name?: string | null;
  sub?: string | null;
  value?: string | null;
  unit?: string | null;
  min?: number | string | null;
  max?: number | string | null;
  secondaryMin?: number | string | null;
  secondaryMax?: number | string | null;
  secondaryUnit?: string | null;
  version?: number | string | null;
  readOnly?: boolean | null;
  note?: string | null;
  configKey?: string | null;
}

export interface UserRegistrationRiskK1Guard extends JsonRecord {
  name?: string | null;
  k1Key?: string | null;
  rejectCode?: string | null;
  suggestedPath?: string | null;
}

export interface UserRegistrationRiskOverview extends JsonRecord {
  stats?: UserRegistrationRiskStats | null;
  params?: UserRegistrationRiskParam[] | null;
  k1Guards?: UserRegistrationRiskK1Guard[] | null;
  configVersion?: number | string | null;
  k1RejectCode?: string | null;
  k1Path?: string | null;
  sources?: string[] | null;
  redlines?: string[] | null;
}

export interface UserSecurityQuery {
  userKey?: string;
  userId?: number | string;
  pageNum?: number;
  pageSize?: number;
}

export interface UserSecurityActionEvidence {
  operatorConfirmed: boolean;
  lockKind?: "SHORT" | "LONG" | null;
}

export interface UserAccountListEntry extends JsonRecord {
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  kind?: string | null;
  reason?: string | null;
  status?: string | null;
  expiresAt?: string | null;
  createdBy?: string | null;
  createdAt?: string | null;
  releasedBy?: string | null;
  releaseReason?: string | null;
  releasedAt?: string | null;
}

export interface UserImpersonationSession extends JsonRecord {
  sessionNo?: string | null;
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  status?: string | null;
  ttlMinutes?: number | string | null;
  operator?: string | null;
  reason?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
  endedAt?: string | null;
  endedBy?: string | null;
  endReason?: string | null;
  leftMinutes?: number | string | null;
}

export interface UserAccountControlFact extends JsonRecord {
  userId?: number | string | null;
  freezeSource?: string | null;
  freezeSourceRef?: string | null;
  freezeReason?: string | null;
  freezeOperator?: string | null;
  frozenAt?: string | null;
  d2FrozenWithdrawalCount?: number | string | null;
}

export interface UserAccountActionOverview extends JsonRecord {
  accounts?: User360Profile[] | null;
  accountLists?: UserAccountListEntry[] | null;
  sessions?: UserSession[] | null;
  impersonations?: UserImpersonationSession[] | null;
  controlFacts?: UserAccountControlFact[] | null;
  frozenUsers?: number | string | null;
  activeSessions?: number | string | null;
  trustListCount?: number | string | null;
  blockedListCount?: number | string | null;
  activeImpersonations?: number | string | null;
  totalAccounts?: number | string | null;
  totalAccountLists?: number | string | null;
  totalSessions?: number | string | null;
  totalImpersonations?: number | string | null;
  sources?: string[] | null;
  redlines?: string[] | null;
}

export interface UserAccountActionContext extends JsonRecord {
  account?: User360Profile | null;
  accountList?: UserAccountListEntry | null;
  sessions?: UserSession[] | null;
  impersonations?: UserImpersonationSession[] | null;
  controlFact?: UserAccountControlFact | null;
  totalSessions?: number | string | null;
  activeSessions?: number | string | null;
  totalImpersonations?: number | string | null;
  sessionsTruncated?: boolean | null;
  impersonationsTruncated?: boolean | null;
}

export interface UserAssetAdjustment extends JsonRecord {
  adjustmentNo?: string | null;
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  asset?: string | null;
  direction?: string | null;
  amount?: number | string | null;
  amountUsd?: number | string | null;
  amountLabel?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  evidenceRef?: string | null;
  idempotencyKey?: string | null;
  reversalOf?: string | null;
  reversedBy?: string | null;
  maker?: string | null;
  checker?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  credit?: boolean | null;
  escalated?: boolean | null;
  ledgerId?: number | string | null;
  balanceAfter?: number | string | null;
  sink?: string | null;
  reviewReason?: string | null;
  reviewedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface UserAssetAdjustmentOverview extends JsonRecord {
  coverage?: JsonRecord | null;
  pending?: number | string | null;
  approved?: number | string | null;
  rejected?: number | string | null;
  suspended?: number | string | null;
  redline?: boolean | null;
  singleCreditReviewCapUsd?: number | string | null;
  maxAdjustmentAmount?: number | string | null;
  nexUsdRate?: number | string | null;
  sources?: string[] | null;
  sunsetCompatibility?: string[] | null;
}

export interface UserAssetAdjustmentDetail extends JsonRecord {
  adjustment?: UserAssetAdjustment | null;
  user?: User360Profile | null;
  coverage?: JsonRecord | null;
  reviewTrail?: string[] | null;
  redlines?: string[] | null;
  sources?: string[] | null;
}

export interface UserAssetAdjustmentQuery {
  status?: string;
  asset?: string;
  userId?: number | string;
  keyword?: string;
  pageNum?: number;
  pageSize?: number;
  historyOnly?: boolean;
}

export interface User360Summary extends JsonRecord {
  userId?: number | string | null;
  userNo?: string | null;
  status?: string | null;
  walletUsdt?: number | string | null;
  walletNex?: number | string | null;
  twoFactorEnabled?: boolean | null;
  locked?: boolean | null;
  passwordResetRequired?: boolean | null;
  activeSessionCount?: number | string | null;
  depositedUsd?: number | string | null;
  withdrawnUsd?: number | string | null;
  withdrawRequestedUsd?: number | string | null;
  deviceCount?: number | string | null;
  activeDeviceCount?: number | string | null;
  onlineDeviceCount?: number | string | null;
  dailyUsdt?: number | string | null;
  teamSize?: number | string | null;
  riskScore?: number | string | null;
  riskBand?: string | null;
}

/**
 * 360 页各分区的统一形状。
 *
 * 🔴 **不要给它加回 `extends JsonRecord`**(2026-08-07 事故教训):
 * 索引签名会让**任意字段名**都通过类型检查 —— 实测因此凭空造出 4 个后端根本不返回的
 * 字段名(`checkinStreakDays` 等),全仓只在那一处渲染点出现、无契约无 fixture,
 * 而 tsc 一声不吭。名字对不上的后果是页面永远显示「—」,且**没有任何东西会报错**。
 * 现在字段逐个显式声明:写错名字 = 编译期就红。
 *
 * 新增字段的正确姿势:先确认后端真的返回它(客户端类型 / contract / fixture 三者取证),
 * 再加到这里 —— 而不是在页面里直接点出来。
 */
export interface User360Section {
  // —— 通用分区骨架 ——
  total?: number | string | null;
  records?: JsonRecord[] | null;
  sourceStatus?: string | null;
  // —— 各分区自带的汇总标量(逐个来自实际渲染点,新增前先取证)——
  activeCount?: number | string | null;
  activeOrderCount?: number | string | null;
  cases?: JsonRecord[] | null;
  completedUsd?: number | string | null;
  confirmedUsd?: number | string | null;
  currentRank?: number | string | null;
  dailyNex?: number | string | null;
  dailyUsdt?: number | string | null;
  deviceDailyNex?: number | string | null;
  deviceDailyUsdt?: number | string | null;
  directCount?: number | string | null;
  // risk 分区携带 K 域评分(k-client.ts:410/422 有显式声明,非本页臆造)
  effectiveScore?: number | string | null;
  bandLabel?: string | null;
  exchangeRows?: JsonRecord[] | null;
  failedPushCount?: number | string | null;
  flags?: JsonRecord[] | null;
  members?: JsonRecord[] | null;
  onlineCount?: number | string | null;
  openCaseCount?: number | string | null;
  orders?: JsonRecord[] | null;
  pendingPushCount?: number | string | null;
  requestedUsd?: number | string | null;
  stakingLedgerRows?: JsonRecord[] | null;
  teamSize?: number | string | null;
  teamVolumeUsd?: number | string | null;
  totalNex?: number | string | null;
  totalUsdt?: number | string | null;
  unreadCount?: number | string | null;
  userLevel?: number | string | null;
  wallet?: JsonRecord | null;
}

export interface User360Detail extends JsonRecord {
  profile?: User360Profile | null;
  security?: JsonRecord | null;
  sessions?: JsonRecord[] | null;
  deposits?: User360Section | null;
  withdrawals?: User360Section | null;
  devices?: User360Section | null;
  orders?: User360Section | null;
  risk?: User360Section | null;
  team?: User360Section | null;
  notifications?: User360Section | null;
  earnings?: User360Section | null;
  referral?: User360Section | null;
  vrank?: User360Section | null;
  financial?: User360Section | null;
  engagement?: User360Section | null;
  commerce?: User360Section | null;
  account?: User360Section | null;
  audit?: JsonRecord[] | null;
  summary?: User360Summary | null;
  sources?: string[] | null;
  redlines?: string[] | null;
}

let requestSeq = 0;
/** 命令号跨刷新存活:五类高敏动作(状态变更 / 两种 impersonate / 两种账户清单)共用本表,
 *  靠 fingerprint = `${method}|${path}|${body}` 分命名空间 —— path 或 body 必带目标 id。 */
const pendingUserMutations = createPendingMutationStore({
  storageKey: "nexion-admin-users-uncertain-commands-v1",
});

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

export interface UserAssetAdjustmentContext extends JsonRecord {
  account?: User360Profile | null;
  pendingWithdraw?: number | string | null;
  coverage?: JsonRecord | null;
  nexUsdRate?: number | string | null;
  largeThresholdUsd?: number | string | null;
  maxAdjustmentAmount?: number | string | null;
}

export interface CreateUserAssetAdjustmentInput {
  asset: "USDT" | "NEX";
  direction: "CREDIT" | "DEBIT";
  amount: string;
  reasonCode: string;
  reason: string;
  evidenceRef: string;
  operator: string;
  idempotencyKey: string;
}

export interface UserPaymentMethod extends JsonRecord {
  id: number;
  userId: number;
  brand: string;
  last4: string;
  expiryLabel?: string | null;
  provider: string;
  isDefault: boolean;
  status: string;
  trialGuard: boolean;
  trialRefId?: string | null;
  version: number;
  unboundAt?: string | null;
  pspRevokeStatus?: string | null;
}

export interface UserPaymentMethodPage {
  items: UserPaymentMethod[];
  page: number;
  pageSize: number;
  total: number;
}

function requireNumber(value: number | string | null | undefined, field: string) {
  const parsed = toNumber(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    throw new Error(`USER360_FIELD_REQUIRED:${field}`);
  }
  return parsed;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queryString(query: Record<string, string | number | boolean | null | undefined>) {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") return;
    params.set(key, String(value));
  });
  const raw = params.toString();
  return raw ? `?${raw}` : "";
}

function normalizePage<T>(page: PageResult<T>, fallbackPageNum: number, fallbackPageSize: number): UserPage<T> {
  return normalizeAuthoritativePage<T>(page, fallbackPageNum, fallbackPageSize);
}

export class UsersRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "UsersRequestError";
  }
}

function c3ResponseInvalid(): never {
  throw new Error(formatAdminApiError("C3_RESPONSE_INVALID", "C3_RESPONSE_INVALID"));
}

function c3Numeric(value: unknown) {
  return parseStrictFiniteNumber(value) !== null;
}

function requireC3Adjustment(value: unknown, expectedStatus?: string): UserAssetAdjustment {
  try {
    return normalizeC3Adjustment(value, expectedStatus) as UserAssetAdjustment;
  } catch {
    return c3ResponseInvalid();
  }
}

function requireC3Overview(value: unknown): UserAssetAdjustmentOverview {
  if (!isJsonRecord(value)
    || !isJsonRecord(value.coverage)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.sunsetCompatibility)) return c3ResponseInvalid();
  for (const field of ["pending", "approved", "rejected", "suspended", "singleCreditReviewCapUsd", "maxAdjustmentAmount", "nexUsdRate"] as const) {
    if (!c3Numeric(value[field])) return c3ResponseInvalid();
  }
  if (typeof value.redline !== "boolean"
    || typeof value.coverage.reliable !== "boolean"
    || !c3Numeric(value.coverage.coverageRatio)
    || !c3Numeric(value.coverage.redlinePct)
    || !c3Numeric(value.coverage.reserveUsd)
    || !c3Numeric(value.coverage.liabilitiesUsd)) return c3ResponseInvalid();
  return value as UserAssetAdjustmentOverview;
}

function requireC3Context(value: unknown): UserAssetAdjustmentContext {
  if (!isJsonRecord(value)
    || !isJsonRecord(value.account)
    || !isJsonRecord(value.coverage)
    || (typeof value.account.userId !== "number" && typeof value.account.userId !== "string")
    || typeof value.coverage.reliable !== "boolean"
    || !c3Numeric(value.coverage.coverageRatio)
    || !c3Numeric(value.coverage.redlinePct)
    || !c3Numeric(value.nexUsdRate)
    || !c3Numeric(value.largeThresholdUsd)
    || !c3Numeric(value.maxAdjustmentAmount)) return c3ResponseInvalid();
  return value as UserAssetAdjustmentContext;
}

function requireC3Detail(value: unknown): UserAssetAdjustmentDetail {
  if (!isJsonRecord(value)
    || !isJsonRecord(value.adjustment)
    || !isJsonRecord(value.user)
    || !isJsonRecord(value.coverage)
    || !Array.isArray(value.reviewTrail)
    || !Array.isArray(value.redlines)
    || !Array.isArray(value.sources)) return c3ResponseInvalid();
  requireC3Adjustment(value.adjustment);
  return value as UserAssetAdjustmentDetail;
}

export class UsersOutcomeUnknownError extends Error {
  constructor(public readonly commandKey: string) {
    super(`本次操作结果未知，可能已经生效。请先刷新核对；如需重试，请保持当前表单并使用同一操作重试。请求号：${commandKey}`);
    this.name = "UsersOutcomeUnknownError";
  }
}

export function isUsersRequestNotFound(error: unknown) {
  return error instanceof UsersRequestError && error.status === 404;
}

async function usersRequest<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string; idempotencyKey?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const method = (init?.method ?? "GET").toUpperCase();
  const mutationFingerprint = init?.idempotencyPrefix && method !== "GET"
    ? `${method}|${path}|${typeof init.body === "string" ? init.body : ""}`
    : null;
  const pendingKeyBeforeRequest = mutationFingerprint
    ? pendingUserMutations.get(mutationFingerprint)
    : undefined;
  if (init?.idempotencyKey) {
    headers.set("Idempotency-Key", init.idempotencyKey);
  } else if (init?.idempotencyPrefix) {
    const commandKey = pendingKeyBeforeRequest ?? idempotencyKey(init.idempotencyPrefix);
    headers.set("Idempotency-Key", commandKey);
    if (mutationFingerprint) pendingUserMutations.remember(mutationFingerprint, commandKey);
  }

  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/users${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch (error) {
    const commandKey = headers.get("Idempotency-Key");
    if (commandKey && method !== "GET") {
      throw new UsersOutcomeUnknownError(commandKey);
    }
    throw error;
  }
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    const commandKey = headers.get("Idempotency-Key");
    // 话术与命令号去留同口径:5xx 保住了号,提示也必须说「结果未知」而不是「失败」,
    // 否则运营会换个入口重做一遍(第三轮验收 P1-6)。
    if (commandKey && (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown"
      || outcomeStaysUnknown(response.status, result?.code))) {
      throw new UsersOutcomeUnknownError(commandKey);
    }
    // A deterministic error can close a brand-new attempt, but it cannot prove that an earlier
    // unknown attempt reached a terminal state. Keep the command capsule so auth failures and
    // in-progress replies never force the operator to mint a second command key.(与 d-client 同口径)
    // 🔴 2026-08-06 补:同 d-client —— 这道保护只覆盖重试链,**首次**撞 5xx 仍会弃号。
    if (mutationFingerprint && !pendingKeyBeforeRequest
      && !outcomeStaysUnknown(response.status, result?.code)) {
      pendingUserMutations.forget(mutationFingerprint);
    }
    // classification-ok:这里的 5xx 判定只挑**错误文案**(不把后端原始消息透给运营),
    // 不参与「命令号要不要丢」的归类 —— 归类在上面一条,走共享谓词。
    const serverMessage = response.status >= 500 ? "INTERNAL_SERVER_ERROR" : result?.message;
    throw new UsersRequestError(
      response.status,
      serverMessage,
      formatAdminApiError(serverMessage, `USERS_REQUEST_FAILED_${response.status}`),
    );
  }

  if (mutationFingerprint) pendingUserMutations.forget(mutationFingerprint);
  return result.data as T;
}

export async function fetchUser360(userKey: string) {
  return usersRequest<User360Detail>(`/profiles/${encodeURIComponent(userKey)}/360`);
}

export async function fetchC1Overview() {
  const value = await usersRequest<unknown>("/overview");
  if (!isJsonRecord(value)) throw new Error("USER360_RESPONSE_INVALID:c1Overview");
  return {
    totalUsers: requireNumber(value.totalUsers as number | string | null | undefined, "c1Overview.totalUsers"),
    frozen: requireNumber(value.frozenUsers as number | string | null | undefined, "c1Overview.frozenUsers"),
    riskAuthorityAvailable: value.riskAuthorityAvailable === true,
    highRisk: value.highRiskUsers == null
      ? null
      : requireNumber(value.highRiskUsers as number | string, "c1Overview.highRiskUsers"),
    highRiskThreshold: value.highRiskThreshold == null
      ? null
      : requireNumber(value.highRiskThreshold as number | string, "c1Overview.highRiskThreshold"),
  };
}

export async function fetchUserPaymentMethods(userId: number | string, includeUnbound = false, page = 1, pageSize = 20) {
  const value = await usersRequest<unknown>(`/profiles/${encodeURIComponent(String(userId))}/payment-methods${queryString({ includeUnbound, page, pageSize })}`);
  if (!isJsonRecord(value) || !Array.isArray(value.items)) {
    throw new Error("USER360_RESPONSE_INVALID:paymentMethods.items");
  }
  return {
    items: value.items as UserPaymentMethod[],
    page: requireNumber(value.page as number | string | null | undefined, "paymentMethods.page"),
    pageSize: requireNumber(value.pageSize as number | string | null | undefined, "paymentMethods.pageSize"),
    total: requireNumber(value.total as number | string | null | undefined, "paymentMethods.total"),
  };
}

export async function unbindUserPaymentMethod(
  userId: number | string,
  methodId: number,
  expectedVersion: number,
  reason: string,
  operator = currentAdminOperator(),
  commandKey = idempotencyKey("c1-payment-method-unbind"),
) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/payment-methods/${methodId}/unbind`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason, operator }),
    idempotencyKey: commandKey,
  });
}

export async function notifyUserPaymentMethodRebind(
  userId: number | string,
  methodId: number,
  expectedVersion: number,
  reason: string,
  operator = currentAdminOperator(),
  commandKey = idempotencyKey("c1-payment-method-rebind-notice"),
) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/payment-methods/${methodId}/rebind-notification`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason, operator }),
    idempotencyKey: commandKey,
  });
}

export async function resetUserNickname(
  userId: number | string,
  expectedNickname: string,
  reason: string,
  operator = currentAdminOperator(),
  commandKey = idempotencyKey("c1-nickname-reset"),
) {
  return usersRequest<{ userId: number; nickname: string; status: string }>(`/profiles/${encodeURIComponent(String(userId))}/nickname/reset`, {
    method: "POST",
    body: JSON.stringify({ reason, expectedValue: expectedNickname, operator }),
    idempotencyKey: commandKey,
  });
}

function c2ResponseInvalid(): never {
  throw new Error(formatAdminApiError("C2_RESPONSE_INVALID", "C2_RESPONSE_INVALID"));
}

function requireC2Overview(value: unknown): UserAccountActionOverview {
  if (!isJsonRecord(value)
    || !Array.isArray(value.accounts)
    || !Array.isArray(value.accountLists)
    || !Array.isArray(value.sessions)
    || !Array.isArray(value.impersonations)
    || !Array.isArray(value.controlFacts)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.redlines)) return c2ResponseInvalid();

  for (const key of [
    "frozenUsers",
    "activeSessions",
    "trustListCount",
    "blockedListCount",
    "activeImpersonations",
    "totalAccounts",
    "totalAccountLists",
    "totalSessions",
    "totalImpersonations",
  ]) {
    if (!c3Numeric(value[key])) return c2ResponseInvalid();
  }
  if (value.sources.some((source) => typeof source !== "string" || !source.trim())
    || value.redlines.some((redline) => typeof redline !== "string" || !redline.trim())
    || value.accounts.some((account) => !isJsonRecord(account)
      || (typeof account.id !== "number" && typeof account.id !== "string")
      || typeof account.userNo !== "string"
      || typeof account.status !== "string")
    || value.accountLists.some((entry) => !isJsonRecord(entry)
      || (typeof entry.userId !== "number" && typeof entry.userId !== "string")
      || typeof entry.kind !== "string"
      || typeof entry.status !== "string")
    || value.sessions.some((session) => !isJsonRecord(session)
      || (typeof session.userId !== "number" && typeof session.userId !== "string")
      || typeof session.refreshTokenId !== "string"
      || typeof session.status !== "string")
    || value.impersonations.some((session) => !isJsonRecord(session)
      || typeof session.sessionNo !== "string"
      || typeof session.status !== "string")
    || value.controlFacts.some((fact) => !isJsonRecord(fact)
      || (typeof fact.userId !== "number" && typeof fact.userId !== "string"))) {
    return c2ResponseInvalid();
  }
  return value as UserAccountActionOverview;
}

export async function fetchUserAccountActionOverview() {
  return requireC2Overview(await usersRequest<unknown>("/account-actions/overview"));
}

export async function fetchUserAccountActionAccount(userKey: string) {
  return usersRequest<User360Profile>(`/account-actions/accounts/${encodeURIComponent(userKey)}`);
}

export async function fetchUserAccountActionContext(userKey: string) {
  return usersRequest<UserAccountActionContext>(`/account-actions/accounts/${encodeURIComponent(userKey)}/context`);
}

export async function fetchUserProfilesPage(query: UserProfileQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 50;
  const { usdtMin, usdtMax, nexMin, nexMax, ...rest } = query;
  const page = await usersRequest<PageResult<User360Profile>>(`/profiles${queryString({
    ...rest,
    walletUsdtMin: usdtMin,
    walletUsdtMax: usdtMax,
    walletNexMin: nexMin,
    walletNexMax: nexMax,
    pageNum,
    pageSize,
  })}`);
  return normalizePage(page, pageNum, pageSize);
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

export async function exportUserProfilesCsv(
  query: UserProfileQuery = {},
  exportKey: string,
  reason: string,
  operator = currentAdminOperator(),
) {
  const { usdtMin, usdtMax, nexMin, nexMax, ...rest } = query;
  const response = await guardedFetch("/api/admin/users/profiles/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": exportKey,
    },
    body: JSON.stringify({
      ...rest,
      walletUsdtMin: usdtMin,
      walletUsdtMax: usdtMax,
      walletNexMin: nexMin,
      walletNexMax: nexMax,
      reason: reason.trim(),
      operator,
    }),
    cache: "no-store",
  });

  const contentType = response.headers.get("Content-Type") || "";
  if (!response.ok || contentType.includes("application/json")) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new Error(formatAdminApiError(result?.message, `USERS_EXPORT_FAILED_${response.status}`));
  }

  return {
    blob: await response.blob(),
    fileName: filenameFromDisposition(
      response.headers.get("Content-Disposition"),
      `c1-masked-users-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}.csv`,
    ),
  };
}

export async function fetchUserAssetAdjustmentOverview() {
  return requireC3Overview(await usersRequest<unknown>("/asset-adjustments/overview"));
}

export async function fetchUserAssetAdjustments(query: UserAssetAdjustmentQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  const page = await usersRequest<PageResult<UserAssetAdjustment>>(`/asset-adjustments${queryString({ ...query, pageNum, pageSize })}`);
  const normalized = normalizePage(page, pageNum, pageSize);
  normalized.records.forEach((record) => requireC3Adjustment(record, query.status));
  return normalized;
}

export async function fetchUserAssetAdjustmentDetail(adjustmentNo: string) {
  return requireC3Detail(await usersRequest<unknown>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}`));
}

export async function fetchUserAssetAdjustmentAccounts(keyword?: string) {
  const page = await usersRequest<PageResult<User360Profile>>(
    `/asset-adjustments/accounts${queryString({ keyword, pageNum: 1, pageSize: 8 })}`,
  );
  return normalizePage(page, 1, 8);
}

export async function fetchUserAssetAdjustmentContext(userId: number | string) {
  return requireC3Context(await usersRequest<unknown>(
    `/profiles/${encodeURIComponent(String(userId))}/asset-adjustment-context`,
  ));
}

export async function fetchUserSecurityOverview(query: UserSecurityQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  const result = await usersRequest<unknown>(`/security/overview${queryString({ ...query, pageNum, pageSize })}`);
  return requireC5Overview(result);
}

function c5ResponseInvalid(): never {
  throw new Error(formatAdminApiError("C5_RESPONSE_INVALID", "C5_RESPONSE_INVALID"));
}

function requireC5Overview(value: unknown): UserSecurityOverview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return c5ResponseInvalid();
  const overview = value as UserSecurityOverview;
  if (!overview.stats || typeof overview.stats !== "object"
    || !Array.isArray(overview.credentialParams)
    || !Array.isArray(overview.lockedUsers)
    || !overview.sessions || typeof overview.sessions !== "object"
    || !Array.isArray(overview.sessions.records)) {
    return c5ResponseInvalid();
  }
  const numeric = (candidate: unknown) => c3Numeric(candidate);
  for (const field of ["activeSessions", "twoFactorRatePct", "lockedShort", "lockedLong", "tokenReuseToday"] as const) {
    if (!numeric(overview.stats?.[field])) return c5ResponseInvalid();
  }
  const validUser = (candidate: unknown) => isJsonRecord(candidate)
    && (typeof candidate.userId === "number" || typeof candidate.userId === "string")
    && typeof candidate.userNo === "string"
    && typeof candidate.nickname === "string"
    && typeof candidate.twoFactorEnabled === "boolean"
    && numeric(candidate.loginFailCount)
    && typeof candidate.locked === "boolean"
    && typeof candidate.passwordResetRequired === "boolean";
  if (overview.selectedUser !== null && overview.selectedUser !== undefined && !validUser(overview.selectedUser)) {
    return c5ResponseInvalid();
  }
  if (!overview.credentialParams.every((param) => isJsonRecord(param)
    && typeof param.key === "string"
    && typeof param.name === "string"
    && typeof param.value === "string"
    && typeof param.unit === "string"
    && numeric(param.min)
    && numeric(param.max)
    && typeof param.readOnly === "boolean"
    && typeof param.note === "string"
    && typeof param.configKey === "string"
    && numeric(param.version))) return c5ResponseInvalid();
  if (!overview.sessions.records.every((session) => isJsonRecord(session)
    && typeof session.refreshTokenId === "string"
    && typeof session.deviceName === "string"
    && typeof session.status === "string"
    && ["ACTIVE", "REVOKED", "EXPIRED"].includes(session.status.toUpperCase())
    && typeof session.issuedAt === "string"
    && typeof session.expiresAt === "string")) return c5ResponseInvalid();
  if (!numeric(overview.sessions.total)
    || !numeric(overview.sessions.pageNum)
    || !numeric(overview.sessions.pageSize)
    || !overview.lockedUsers.every(validUser)
    || !Array.isArray(overview.sources)
    || !Array.isArray(overview.redlines)) return c5ResponseInvalid();
  return overview;
}

function c6ResponseInvalid(): never {
  throw new Error(formatAdminApiError("C6_RESPONSE_INVALID", "C6_RESPONSE_INVALID"));
}

function c6Numeric(value: unknown) {
  return (typeof value === "number" && Number.isFinite(value))
    || (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)));
}

function requireC6Overview(value: unknown): UserRegistrationRiskOverview {
  if (!isJsonRecord(value)
    || !isJsonRecord(value.stats)
    || !Array.isArray(value.params)
    || !Array.isArray(value.k1Guards)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.redlines)
    || !c6Numeric(value.configVersion)) return c6ResponseInvalid();
  const stats = value.stats;
  for (const key of ["otpToday", "captchaTriggeredToday", "lockedShort", "lockedLong", "locked", "stuffingClusters7d", "captchaRemainingSeconds"]) {
    if (!c6Numeric(stats[key])) return c6ResponseInvalid();
  }
  if (typeof stats.captchaTemporarilyDisabled !== "boolean" || typeof stats.captchaRestoreAt !== "string") {
    return c6ResponseInvalid();
  }
  if (!value.params.every((param) => isJsonRecord(param)
    && typeof param.group === "string"
    && typeof param.key === "string"
    && typeof param.name === "string"
    && typeof param.value === "string"
    && c6Numeric(param.min)
    && c6Numeric(param.max)
    && c6Numeric(param.secondaryMin)
    && c6Numeric(param.secondaryMax)
    && c6Numeric(param.version)
    && typeof param.readOnly === "boolean")) return c6ResponseInvalid();
  if (!value.k1Guards.every((guard) => isJsonRecord(guard)
    && typeof guard.name === "string"
    && typeof guard.k1Key === "string"
    && typeof guard.rejectCode === "string"
    && typeof guard.suggestedPath === "string")) return c6ResponseInvalid();
  const paramKeys = value.params.map((param) => String((param as JsonRecord).key));
  const guardKeys = value.k1Guards.map((guard) => String((guard as JsonRecord).k1Key));
  const requiredParamKeys = ["otpTtl", "otpCooldown", "otpMax24h", "lockShort", "lockLong"];
  const requiredGuardKeys = ["maxSignupPerIp24h", "maxAccountsPerDevice", "maxAccountsPerPaymentInstrument"];
  if (new Set(paramKeys).size !== requiredParamKeys.length
    || !requiredParamKeys.every((key) => paramKeys.includes(key))
    || new Set(guardKeys).size !== requiredGuardKeys.length
    || !requiredGuardKeys.every((key) => guardKeys.includes(key))
    || value.sources.length < 5
    || value.redlines.length < 3
    || value.sources.some((source) => typeof source !== "string" || !source.trim())
    || value.redlines.some((redline) => typeof redline !== "string" || !redline.trim())) return c6ResponseInvalid();
  return value as UserRegistrationRiskOverview;
}

export async function fetchUserRegistrationRiskOverview() {
  const result = await usersRequest<unknown>("/registration-risk/overview");
  return requireC6Overview(result);
}

export async function updateUserRegistrationRiskParam(
  paramKey: string,
  value: string,
  reason: string,
  operator: string,
  expectedVersion: number,
  commandKey?: string,
) {
  const stableIdempotencyKey = commandKey ?? idempotencyKey("c6-registration-risk-param");
  return usersRequest<UserRegistrationRiskParam>(`/registration-risk/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator, expectedVersion }),
    idempotencyKey: stableIdempotencyKey,
  });
}

export async function updateUserCredentialParam(
  paramKey: string,
  value: string,
  reason: string,
  operator: string,
  expectedVersion: number,
  commandKey = idempotencyKey("c5-credential-param"),
) {
  return usersRequest<UserCredentialParam>(`/security/credential-params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator, expectedVersion }),
    idempotencyKey: commandKey,
  });
}

export async function revokeUserSession(refreshTokenId: string, reason: string, operator: string, commandKey?: string) {
  return usersRequest<UserSession>(`/sessions/${encodeURIComponent(refreshTokenId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyKey: commandKey ?? idempotencyKey("c5-user-session-revoke"),
  });
}

export async function disableUserTwoFactor(
  userId: number | string,
  reason: string,
  operator: string,
  evidence: UserSecurityActionEvidence,
  commandKey?: string,
) {
  return usersRequest<UserSecurityStatus>(`/profiles/${encodeURIComponent(String(userId))}/security/disable-2fa`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, ...evidence, lockKind: null }),
    idempotencyKey: commandKey ?? idempotencyKey("c5-user-disable-2fa"),
  });
}

export async function unlockUserSecurity(
  userId: number | string,
  reason: string,
  operator: string,
  evidence: UserSecurityActionEvidence,
  commandKey?: string,
) {
  return usersRequest<UserSecurityStatus>(`/profiles/${encodeURIComponent(String(userId))}/security/unlock`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, ...evidence }),
    idempotencyKey: commandKey ?? idempotencyKey("c5-user-unlock"),
  });
}

export async function createUserAssetAdjustment(
  userId: number | string,
  input: CreateUserAssetAdjustmentInput,
) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/asset-adjustments`, {
    method: "POST",
    body: JSON.stringify({
      asset: input.asset,
      direction: input.direction,
      amount: input.amount,
      reasonCode: input.reasonCode,
      reason: input.reason,
      evidenceRef: input.evidenceRef,
      operator: input.operator,
    }),
    idempotencyKey: input.idempotencyKey,
  });
}

export async function requestLargeUserAssetAdjustment(
  userId: number | string,
  input: CreateUserAssetAdjustmentInput,
) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/asset-adjustment-requests`, {
    method: "POST",
    body: JSON.stringify({
      asset: input.asset,
      direction: input.direction,
      amount: input.amount,
      reasonCode: input.reasonCode,
      reason: input.reason,
      evidenceRef: input.evidenceRef,
      operator: input.operator,
    }),
    idempotencyKey: input.idempotencyKey,
  });
}

export async function reverseUserAssetAdjustment(
  adjustmentNo: string,
  reason: string,
  operator: string,
  idempotencyKey: string,
) {
  return usersRequest<JsonRecord>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}/reverse`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyKey,
  });
}

export async function approveUserAssetAdjustment(
  adjustmentNo: string,
  reason: string,
  operator: string,
  commandKey = idempotencyKey("c3-asset-adjustment-approve"),
) {
  return usersRequest<UserAssetAdjustmentDetail>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyKey: commandKey,
  });
}

export async function rejectUserAssetAdjustment(
  adjustmentNo: string,
  reason: string,
  operator: string,
  commandKey = idempotencyKey("c3-asset-adjustment-reject"),
) {
  return usersRequest<UserAssetAdjustmentDetail>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyKey: commandKey,
  });
}

export async function updateUserStatus(userId: number | string, status: UserStatus, reasonCode: string | null, reason: string, operator: string) {
  return usersRequest<User360Profile>(`/profiles/${encodeURIComponent(String(userId))}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reasonCode, reason, operator }),
    idempotencyPrefix: "c2-user-status",
  });
}

export async function revokeUserSessions(userId: number | string, reason: string, operator: string, commandKey?: string) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/security/sessions/revoke-all`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyKey: commandKey ?? idempotencyKey("c5-user-revoke-sessions"),
  });
}

export async function startUserImpersonation(userId: number | string, reasonCode: string, reason: string, operator: string, ttlMinutes = 15) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/impersonations`, {
    method: "POST",
    body: JSON.stringify({ ttlMinutes, reasonCode, reason, operator }),
    idempotencyPrefix: "c2-user-impersonation-start",
  });
}

export async function fetchImpersonationReadonlyView(accessToken: string, page = "HOME") {
  const response = await guardedFetch(`/api/impersonation/view?page=${encodeURIComponent(page)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<JsonRecord> | null;
  if (!response.ok || !result || result.code !== 0 || !result.data) {
    throw new Error(formatAdminApiError(result?.message, `IMPERSONATION_VIEW_FAILED_${response.status}`));
  }
  return result.data as JsonRecord;
}

export async function terminateUserImpersonation(sessionNo: string, reason: string, operator: string) {
  return usersRequest<UserImpersonationSession>(`/impersonations/${encodeURIComponent(sessionNo)}/terminate`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c2-user-impersonation-end",
  });
}

export async function upsertUserAccountList(userId: number | string, kind: "ALLOW" | "BLOCK", reason: string, operator: string, expiresAt?: string | null) {
  return usersRequest<UserAccountListEntry>("/account-lists", {
    method: "POST",
    body: JSON.stringify({ userId, kind, reason, operator, expiresAt: expiresAt ?? null }),
    idempotencyPrefix: "c2-account-list-upsert",
  });
}

export async function removeUserAccountList(userId: number | string, reason: string, operator: string) {
  return usersRequest<UserAccountListEntry>(`/account-lists/${encodeURIComponent(String(userId))}/remove`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c2-account-list-remove",
  });
}

export async function requestUserPasswordReset(
  userId: number | string,
  reason: string,
  operator: string,
  evidence: UserSecurityActionEvidence,
  commandKey?: string,
) {
  return usersRequest<UserSecurityStatus>(`/profiles/${encodeURIComponent(String(userId))}/security/password-reset`, {
    method: "POST",
    body: JSON.stringify({ reason, operator, ...evidence, lockKind: null }),
    idempotencyKey: commandKey ?? idempotencyKey("c5-user-password-reset"),
  });
}
