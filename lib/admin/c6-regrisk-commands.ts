import { createA2CommandKey } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "./pending-mutation-store";
import { updateUserRegistrationRiskParam, UsersOutcomeUnknownError, UsersRequestError } from "./user360-client";

export type C6Original = {
  owner: number;
  target: "lockShort" | "lockLong" | "captchaOff";
  kind: "lock" | "captcha-disable" | "captcha-restore";
  path: string;
  method: "PATCH";
  body: string;
  value: string;
  reason: string;
  operator: string;
  version: number;
  label: string;
  successMessage: string;
};
export type C6Pending = PendingMutationRecord & Partial<C6Original>;

// One instance also retains the old key-only records; those can only be read back.
const commands = createPendingMutationStore<C6Pending>({ storageKey: "nexion-admin-c6-regrisk-commands-v1", retainExpiredRecords: true });
export function pendingC6Commands(owner: number) {
  return commands.list().filter(row => row.owner === owner || row.owner === undefined && hasPersistedPendingCommandOwner(String(owner)));
}
export function isCompleteC6Command(row: C6Pending): row is C6Pending & C6Original {
  return Number.isSafeInteger(row.owner) && Number.isSafeInteger(row.version) && row.version! >= 0
    && ["lockShort", "lockLong", "captchaOff"].includes(row.target ?? "")
    && (row.kind === "lock" && row.target !== "captchaOff" || row.kind === "captcha-disable" && row.target === "captchaOff" && row.value !== "" || row.kind === "captcha-restore" && row.target === "captchaOff" && row.value === "")
    && row.method === "PATCH" && row.path === `/api/admin/users/registration-risk/params/${row.target}`
    && typeof row.value === "string" && typeof row.reason === "string" && typeof row.operator === "string"
    && typeof row.label === "string" && typeof row.successMessage === "string"
    && row.body === JSON.stringify({ value: row.value, reason: row.reason, operator: row.operator, expectedVersion: row.version });
}
export function prepareC6Command(original: C6Original) {
  const scope = `param|${original.target}`;
  if (pendingC6Commands(original.owner).some(row => !isCompleteC6Command(row) || row.target === original.target)) throw new Error("这一项有一次提交结果未知，先在页面上方核对。");
  const key = createA2CommandKey("c6-command");
  commands.remember(scope, key, original);
  if (!commands.isDurablyStored(scope, key)) {
    commands.forget(scope, key);
    throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
  }
  return commands.list().find(row => row.commandKey === key)!;
}
export function forgetC6Command(row: C6Pending) { commands.forget(row.fingerprint, row.commandKey); }

// In backend 66ecdb47 ApiResultHttpStatusAdvice maps nonzero ApiResult.code
// to HTTP status; the users proxy preserves it (C6 version conflict is HTTP 409).
// The HTTP-200 branch below is defensive compatibility only, not a backend
// response contract or an acceptance fixture for these business verdicts.
const BUSINESS_REJECTIONS: Record<string, number> = {
  REGISTRATION_RISK_PARAM_REQUIRED: 422, MULTI_ACCOUNT_PARAM_BELONGS_TO_K1: 422, OTP_CONFIG_BELONGS_TO_K2: 422,
  C6_EXPECTED_VERSION_REQUIRED: 422, REGISTRATION_RISK_PARAM_NOT_FOUND: 404, C6_CONFIG_VERSION_CONFLICT: 409,
  REGISTRATION_RISK_PARAM_VALUE_REQUIRED: 422, REGISTRATION_RISK_PARAM_VALUE_INVALID: 422,
  REGISTRATION_RISK_PARAM_VALUE_OUT_OF_RANGE: 422, C6_LONG_THRESHOLD_MUST_EXCEED_SHORT_THRESHOLD: 422,
  CAPTCHA_RESTORE_WINDOW_REJECTED: 422, IDEMPOTENCY_KEY_REQUIRED: 422, REASON_REQUIRED: 422,
};
export function isC6ExplicitRejection(failure: unknown) {
  if (isExplicitRejection(failure)) return true;
  return failure instanceof UsersRequestError && failure.status === 200
    && BUSINESS_REJECTIONS[failure.code ?? ""] === failure.businessStatus
    && isExplicitRejection({ status: failure.businessStatus, reasonCode: failure.code });
}

export async function submitC6Command(row: C6Pending) {
  if (!isCompleteC6Command(row) || row.expiresAt <= Date.now()) throw new Error("原请求已超过 24 小时或没有保存完整，不能再重试，只能查询原结果。");
  const result = await updateUserRegistrationRiskParam(row.target, row.value, row.reason, row.operator, row.version, row.commandKey);
  // 66ecdb47 OpsUserService.registrationRiskParamView / updateCaptchaOffWindow:
  // lock values echo the normalized request; disabling returns an ISO deadline,
  // restoring returns "". A replay contains the original version + 1, not today's.
  if (!result || result.key !== row.target || result.group !== (row.kind === "lock" ? "lock" : "captcha")
    || result.version !== row.version + 1
    || (row.kind === "captcha-disable"
      ? typeof result.value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result.value) || !Number.isFinite(Date.parse(result.value))
      : result.value !== row.value)) throw new UsersOutcomeUnknownError(row.commandKey);
}
