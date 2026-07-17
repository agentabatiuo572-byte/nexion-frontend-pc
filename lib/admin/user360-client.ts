import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { formatAdminApiError } from "@/lib/admin/error-messages";

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
  kycStatus?: string;
  riskMin?: number;
  pageNum?: number;
  pageSize?: number;
}

export interface User360Profile extends JsonRecord {
  id?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  phoneMasked?: string | null;
  countryCode?: string | null;
  status?: string | null;
  kycStatus?: string | null;
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
  captchaRestoreWindow?: string | null;
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

export interface UserAccountActionOverview extends JsonRecord {
  accounts?: User360Profile[] | null;
  accountLists?: UserAccountListEntry[] | null;
  sessions?: UserSession[] | null;
  impersonations?: UserImpersonationSession[] | null;
  frozenUsers?: number | string | null;
  activeSessions?: number | string | null;
  trustListCount?: number | string | null;
  blockedListCount?: number | string | null;
  activeImpersonations?: number | string | null;
  sources?: string[] | null;
  redlines?: string[] | null;
}

export interface UserAssetAdjustment extends JsonRecord {
  adjustmentNo?: string | null;
  userId?: number | string | null;
  userNo?: string | null;
  nickname?: string | null;
  asset?: string | null;
  direction?: string | null;
  amount?: number | string | null;
  amountLabel?: string | null;
  reasonCode?: string | null;
  reason?: string | null;
  maker?: string | null;
  checker?: string | null;
  status?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  credit?: boolean | null;
  escalated?: boolean | null;
  ledgerId?: number | string | null;
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

export interface UserKycKeyValue extends JsonRecord {
  key?: string | null;
  value?: string | null;
}

export interface UserKycLedgerRow extends JsonRecord {
  userId?: number | string | null;
  displayId?: string | null;
  nickname?: string | null;
  phoneMasked?: string | null;
  countryCode?: string | null;
  status?: string | null;
  backendStatus?: string | null;
  statusLabel?: string | null;
  statusTone?: string | null;
  pairedAddressMasked?: string | null;
  network?: string | null;
  pairedAt?: string | null;
  triggerSource?: string | null;
  info?: UserKycKeyValue[] | null;
  history?: string[] | null;
}

export interface UserKycStats extends JsonRecord {
  total?: number | string | null;
  verified?: number | string | null;
  unverified?: number | string | null;
  inReview?: number | string | null;
  rejected?: number | string | null;
  verifiedPct?: number | string | null;
  feeUsd?: number | string | null;
}

export interface UserKycOverview extends JsonRecord {
  stats?: UserKycStats | null;
  networkWhitelist?: string | null;
  rows?: UserKycLedgerRow[] | null;
  sources?: string[] | null;
  redlines?: string[] | null;
}

export interface UserKycQuery {
  status?: string;
  pageNum?: number;
  pageSize?: number;
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
  kycStatus?: string | null;
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

export interface User360Section extends JsonRecord {
  total?: number | string | null;
  records?: JsonRecord[] | null;
  sourceStatus?: string | null;
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
  return {
    total: requireNumber(page.total, "page.total"),
    pageNum: toNumber(page.pageNum, fallbackPageNum),
    pageSize: toNumber(page.pageSize, fallbackPageSize),
    records: page.records ?? [],
  };
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

export function isUsersRequestNotFound(error: unknown) {
  return error instanceof UsersRequestError && error.status === 404;
}

async function usersRequest<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/users${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    if (isAdminAuthFailure(response.status, result?.message)) {
      resetAdminSession();
    }
    throw new UsersRequestError(
      response.status,
      result?.message,
      formatAdminApiError(result?.message, `USERS_REQUEST_FAILED_${response.status}`),
    );
  }

  return result.data as T;
}

export async function fetchUser360(userKey: string) {
  return usersRequest<User360Detail>(`/profiles/${encodeURIComponent(userKey)}/360`);
}

export async function fetchUserPaymentMethods(userId: number | string, includeUnbound = false, page = 1, pageSize = 20) {
  return usersRequest<UserPaymentMethodPage>(`/profiles/${encodeURIComponent(String(userId))}/payment-methods${queryString({ includeUnbound, page, pageSize })}`);
}

export async function unbindUserPaymentMethod(userId: number | string, methodId: number, expectedVersion: number, reason: string, operator = currentAdminOperator()) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/payment-methods/${methodId}/unbind`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason, operator }),
    idempotencyPrefix: "c1-payment-method-unbind",
  });
}

export async function notifyUserPaymentMethodRebind(userId: number | string, methodId: number, expectedVersion: number, reason: string, operator = currentAdminOperator()) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/payment-methods/${methodId}/rebind-notification`, {
    method: "POST",
    body: JSON.stringify({ expectedVersion, reason, operator }),
    idempotencyPrefix: "c1-payment-method-rebind-notice",
  });
}

export async function resetUserNickname(userId: number | string, reason: string, operator = currentAdminOperator()) {
  return usersRequest<{ userId: number; nickname: string; status: string }>(`/profiles/${encodeURIComponent(String(userId))}/nickname/reset`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c1-nickname-reset",
  });
}

export async function fetchUserAccountActionOverview() {
  return usersRequest<UserAccountActionOverview>("/account-actions/overview");
}

export async function fetchUserAccountActionAccount(userKey: string) {
  return usersRequest<User360Profile>(`/account-actions/accounts/${encodeURIComponent(userKey)}`);
}

export async function fetchUserProfilesPage(query: UserProfileQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  const page = await usersRequest<PageResult<User360Profile>>(`/profiles${queryString({ ...query, pageNum, pageSize })}`);
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

export async function exportUserProfilesExcel(
  reason: string,
  query: UserProfileQuery = {},
  operator = currentAdminOperator(),
) {
  const response = await fetch("/api/admin/users/profiles/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey("c1-user-profile-export"),
    },
    body: JSON.stringify({
      keyword: query.keyword,
      status: query.status,
      kycStatus: query.kycStatus,
      riskMin: query.riskMin,
      reason,
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
      `c1-masked-users-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-")}.xls`,
    ),
  };
}

export async function fetchUserAssetAdjustmentOverview() {
  return usersRequest<UserAssetAdjustmentOverview>("/asset-adjustments/overview");
}

export async function fetchUserAssetAdjustments(query: UserAssetAdjustmentQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  const page = await usersRequest<PageResult<UserAssetAdjustment>>(`/asset-adjustments${queryString({ ...query, pageNum, pageSize })}`);
  return normalizePage(page, pageNum, pageSize);
}

export async function fetchUserAssetAdjustmentDetail(adjustmentNo: string) {
  return usersRequest<UserAssetAdjustmentDetail>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}`);
}

export async function fetchUserKycOverview(query: UserKycQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  return usersRequest<UserKycOverview>(`/kyc/overview${queryString({ ...query, pageNum, pageSize })}`);
}

export async function fetchUserSecurityOverview(query: UserSecurityQuery = {}) {
  const pageNum = query.pageNum ?? 1;
  const pageSize = query.pageSize ?? 10;
  return usersRequest<UserSecurityOverview>(`/security/overview${queryString({ ...query, pageNum, pageSize })}`);
}

export async function fetchUserRegistrationRiskOverview() {
  return usersRequest<UserRegistrationRiskOverview>("/registration-risk/overview");
}

export async function updateUserRegistrationRiskParam(paramKey: string, value: string, reason: string, operator: string) {
  return usersRequest<UserRegistrationRiskParam>(`/registration-risk/params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "c6-registration-risk-param",
  });
}

export async function updateUserCredentialParam(paramKey: string, value: string, reason: string, operator: string) {
  return usersRequest<UserCredentialParam>(`/security/credential-params/${encodeURIComponent(paramKey)}`, {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "c5-credential-param",
  });
}

export async function revokeUserSession(refreshTokenId: string, reason: string, operator: string) {
  return usersRequest<UserSession>(`/sessions/${encodeURIComponent(refreshTokenId)}/revoke`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c5-user-session-revoke",
  });
}

export async function disableUserTwoFactor(userId: number | string, reason: string, operator: string) {
  return usersRequest<UserSecurityStatus>(`/profiles/${encodeURIComponent(String(userId))}/security/disable-2fa`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c5-user-disable-2fa",
  });
}

export async function unlockUserSecurity(userId: number | string, reason: string, operator: string) {
  return usersRequest<UserSecurityStatus>(`/profiles/${encodeURIComponent(String(userId))}/security/unlock`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c5-user-unlock",
  });
}

export async function updateUserKycStatus(userId: number | string, status: string, reason: string, operator: string) {
  return usersRequest<UserKycLedgerRow>(`/kyc/users/${encodeURIComponent(String(userId))}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator }),
    idempotencyPrefix: "c4-kyc-status",
  });
}

export async function updateUserKycNetworkWhitelist(value: string, reason: string, operator: string) {
  return usersRequest<JsonRecord>("/kyc/network-whitelist", {
    method: "PATCH",
    body: JSON.stringify({ value, reason, operator }),
    idempotencyPrefix: "c4-kyc-network",
  });
}

export async function createUserKycExport(scope: string, reason: string, operator: string) {
  return usersRequest<JsonRecord>("/kyc/exports", {
    method: "POST",
    body: JSON.stringify({ scope, reason, operator }),
    idempotencyPrefix: "c4-kyc-export",
  });
}

export async function createUserAssetAdjustment(
  userId: number | string,
  asset: string,
  direction: "CREDIT" | "DEBIT",
  amount: string,
  reason: string,
  operator: string,
) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/asset-adjustments`, {
    method: "POST",
    body: JSON.stringify({ asset, direction, amount, reason, operator }),
    idempotencyPrefix: "c3-asset-adjustment-create",
  });
}

export async function approveUserAssetAdjustment(adjustmentNo: string, reason: string, operator: string) {
  return usersRequest<UserAssetAdjustmentDetail>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}/approve`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c3-asset-adjustment-approve",
  });
}

export async function rejectUserAssetAdjustment(adjustmentNo: string, reason: string, operator: string) {
  return usersRequest<UserAssetAdjustmentDetail>(`/asset-adjustments/${encodeURIComponent(adjustmentNo)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c3-asset-adjustment-reject",
  });
}

export async function updateUserStatus(userId: number | string, status: UserStatus, reason: string, operator: string) {
  return usersRequest<User360Profile>(`/profiles/${encodeURIComponent(String(userId))}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason, operator }),
    idempotencyPrefix: "c2-user-status",
  });
}

export async function revokeUserSessions(userId: number | string, reason: string, operator: string) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/sessions/revoke-all`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c2-user-revoke-sessions",
  });
}

export async function startUserImpersonation(userId: number | string, reason: string, operator: string, ttlMinutes = 15) {
  return usersRequest<JsonRecord>(`/profiles/${encodeURIComponent(String(userId))}/impersonations`, {
    method: "POST",
    body: JSON.stringify({ ttlMinutes, reason, operator }),
    idempotencyPrefix: "c2-user-impersonation-start",
  });
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

export async function requestUserPasswordReset(userId: number | string, reason: string, operator: string) {
  return usersRequest<UserSecurityStatus>(`/profiles/${encodeURIComponent(String(userId))}/security/password-reset`, {
    method: "POST",
    body: JSON.stringify({ reason, operator }),
    idempotencyPrefix: "c5-user-password-reset",
  });
}
