import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isPaymentRecord, paymentPolicyFields, parsePaymentPolicy, parsePaymentStatus, parsePaymentAttempts, parsePaymentReceipt, type PaymentPolicyValues } from "@/lib/admin/payment-password-contract";
import { parsePaymentSecuritySummary, parsePaymentSecurityDetail, parsePaymentSecurityPage, parsePaymentReleaseReceipt, type PaymentSecuritySummary, type PaymentSecurityDetail, type PaymentSecurityRecord, type PaymentReleaseReceipt } from "@/lib/admin/payment-password-contract";

const base = "/api/admin/users/security/payment-password-policy";
export class PaymentPasswordApiError extends Error { constructor(message: string, readonly status: number, readonly unknownOutcome = false, readonly backendMessage?: string) { super(message); } }
class PaymentPasswordOutcomeUnknownError extends PaymentPasswordApiError {
  constructor(status: number, backendMessage?: string) { super("处理结果暂未确认，请查询原操作结果，不要重复提交。", status, true, backendMessage); }
}
async function request(path: string, body?: unknown, key?: string, originalBody?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await guardedFetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(20_000), ...(body === undefined ? {} : { headers: { "Content-Type": "application/json", "Idempotency-Key": key! }, body: originalBody ?? JSON.stringify(body) }) });
  } catch {
    throw new PaymentPasswordApiError(body === undefined ? "支付密码服务暂时无法连接，请稍后重新加载。" : "处理结果暂未确认，请查询原操作结果，不要重复提交。", 0, body !== undefined);
  }
  const raw: unknown = await response.json().catch(() => null);
  const backendMessage = isPaymentRecord(raw) && typeof raw.message === "string" ? raw.message : undefined;
  if (isAdminAuthFailure(response.status, backendMessage)) {
    resetAdminSession();
    if (body !== undefined && response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") throw new PaymentPasswordOutcomeUnknownError(401, backendMessage);
    throw new PaymentPasswordApiError("登录已失效，请重新登录后查询。", 401, false, backendMessage);
  }
  if (!response.ok || !isPaymentRecord(raw) || raw.code !== 0 || raw.data == null) {
    const code = isPaymentRecord(raw) && typeof raw.code === "number" ? raw.code : undefined;
    if (body !== undefined && (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || outcomeStaysUnknown(response.status, code))) throw new PaymentPasswordOutcomeUnknownError(response.status, backendMessage);
    throw new PaymentPasswordApiError(response.status === 403 ? "当前没有读取或处理这项支付安全信息的权限。" : response.status === 404 || response.status === 501 ? "支付密码服务尚未提供这项信息，请稍后重新加载。" : body === undefined ? "支付密码信息读取失败，请重新加载。" : "本次操作结果需要核对，请查询原操作。", response.status, false, backendMessage);
  }
  return raw.data;
}
export async function fetchPaymentPolicy() { return parsePaymentPolicy(await request(base)); }
export async function fetchPaymentStatus(userId: string) { return parsePaymentStatus(await request(`/api/admin/users/profiles/${encodeURIComponent(userId)}/security/payment-password`), userId); }
export async function fetchPaymentAttempts(userId: string, page: number, pageSize: number) { return parsePaymentAttempts(await request(`/api/admin/users/profiles/${encodeURIComponent(userId)}/security/payment-password/attempts?pageNum=${page}&pageSize=${pageSize}`), userId); }
type PaymentPolicyOriginal = { oldValues: PaymentPolicyValues; values: PaymentPolicyValues; expectedVersion: number; reason: string; confirmed: true; body: string; operator: string };
export interface PendingPaymentPolicy extends PendingMutationRecord, Partial<PaymentPolicyOriginal> { owner: number; rejection?: string }
const pending = createPendingMutationStore<PendingPaymentPolicy>({ storageKey: "nexion-admin-payment-policy-commands-v1", retainExpiredRecords: true, isValidRecord: row => Number.isSafeInteger(row.owner) });
export function pendingPaymentPolicy(owner: number) { return pending.list().find(row => row.owner === owner) ?? null; }
/** Old incomplete records remain query-only; never fill their original request from current policy. */
export function isCompletePaymentPolicy(row: PendingPaymentPolicy): row is PendingPaymentPolicy & PaymentPolicyOriginal {
  return !!row.oldValues && !!row.values && paymentPolicyFields.every(key => Number.isSafeInteger(row.oldValues![key]) && row.oldValues![key] > 0 && Number.isSafeInteger(row.values![key]) && row.values![key] > 0)
    && Number.isSafeInteger(row.expectedVersion) && row.expectedVersion! >= 0 && typeof row.reason === "string" && row.reason.trim().length >= 8 && row.reason.trim().length <= 200
    && row.confirmed === true && typeof row.operator === "string" && row.operator.length > 0
    && row.body === JSON.stringify({ values: row.values, expectedVersion: row.expectedVersion, reason: row.reason, confirmed: true });
}
export async function submitPaymentPolicy(owner: number, values: PaymentPolicyValues, expectedVersion: number, reason: string, oldValues?: PaymentPolicyValues) {
  if (pendingPaymentPolicy(owner)) throw new Error("请先查询上一笔调整结果。");
  if (!oldValues) {
    const policy = await fetchPaymentPolicy();
    if (policy.version !== expectedVersion) throw new Error("规则已变化，请重新读取后核对。");
    oldValues = policy.values;
  }
  const original = { values: { ...values }, expectedVersion, reason, confirmed: true as const };
  const body = JSON.stringify(original);
  const commandKey = createA2CommandKey("payment-policy");
  const fingerprint = `payment-policy|${owner}|${commandKey}`;
  pending.remember(fingerprint, commandKey, { owner, ...original, oldValues: { ...oldValues }, body, operator: currentAdminOperator(`admin:${owner}`) });
  if (!pending.isDurablyStored(fingerprint, commandKey)) { pending.forget(fingerprint, commandKey); throw new Error("浏览器无法保存查询记录，请允许会话存储后重试。"); }
  try {
    await request(base, original, commandKey, body);
  } catch (failure) {
    if (isExplicitRejection(failure)) pending.forget(fingerprint, commandKey);
    throw failure;
  }
  return queryPaymentPolicy(owner);
}
export async function retryPaymentPolicy(owner: number) {
  const row = pendingPaymentPolicy(owner);
  if (!row || !isCompletePaymentPolicy(row) || row.rejection || row.expiresAt <= Date.now()) throw new Error("此原调整只能查询，不能重发。");
  if (!pending.isDurablyStored(row.fingerprint, row.commandKey)) throw new Error("浏览器无法保存原操作，不能重发，请先查询结果。");
  try { await request(base, {}, row.commandKey, row.body); }
  catch (failure) {
    if (isExplicitRejection(failure)) pending.remember(row.fingerprint, row.commandKey, { ...row, rejection: failure instanceof PaymentPasswordApiError ? formatAdminApiError(failure.backendMessage, failure.message) : "原调整已被明确拒绝" });
    throw failure;
  }
  return queryPaymentPolicy(owner);
}
export function releaseRejectedPaymentPolicy(owner: number, commandKey: string) {
  const row = pendingPaymentPolicy(owner);
  if (!row || row.commandKey !== commandKey || !row.rejection) throw new Error("原调整尚未被明确拒绝，不能解除待确认。");
  pending.forget(row.fingerprint, row.commandKey);
}
export async function queryPaymentPolicy(owner: number) {
  const row = pendingPaymentPolicy(owner);
  if (!row) throw new Error("没有待查询的调整记录。");
  const receipt = parsePaymentReceipt(await request(`${base}/commands/${encodeURIComponent(row.commandKey)}`), row.commandKey);
  if (receipt.status !== "PENDING") pending.forget(row.fingerprint, row.commandKey);
  return receipt;
}

export interface PaymentSecurityPort {
  readonly key: string; readonly surface: "global" | "support"; readonly userId: string;
  summary(): Promise<PaymentSecuritySummary>;
  detail(recordId: string): Promise<PaymentSecurityDetail>;
  attempts(recordId: string, page: number, pageSize: number): ReturnType<typeof fetchPaymentAttempts>;
  release(record: PaymentSecurityRecord, reason: string, commandKey: string): Promise<unknown>;
  receipt(commandKey: string): Promise<unknown>;
}
const recordBase = "/api/admin/users/security/payment-password-records";
const paymentRecordsPath = (surface: "global" | "support", userId: string) => surface === "global" ? recordBase : `/api/admin/content/support-workbench/customers/${encodeURIComponent(userId)}/payment-password/records`;
const releaseBody = (userId: string, recordId: string, operation: PaymentReleaseReceipt["operation"], expectedVersion: number | null, reason: string) => JSON.stringify({ userId, recordId, operation, expectedVersion, reason, confirmed: true });
function securityPort(surface: "global" | "support", userId: string): PaymentSecurityPort {
  const valid = /^[1-9]\d*$/.test(userId);
  const scoped = `/api/admin/content/support-workbench/customers/${encodeURIComponent(userId)}/payment-password`;
  const records = paymentRecordsPath(surface, userId);
  const identity = () => { if (!valid) throw new Error("客户身份尚未确认，请重新打开客户资料。"); };
  return {
    key: `${surface}:${userId}`, surface, userId,
    async summary() { identity(); return parsePaymentSecuritySummary(await request(surface === "global" ? `/api/admin/users/profiles/${userId}/security/payment-password/summary` : `${scoped}/summary`), userId); },
    async detail(recordId) { identity(); return parsePaymentSecurityDetail(await request(`${records}/${encodeURIComponent(recordId)}`), userId, recordId); },
    async attempts(recordId, page, pageSize) { identity(); return parsePaymentAttempts(await request(`${records}/${encodeURIComponent(recordId)}/attempts?pageNum=${page}&pageSize=${pageSize}`), userId); },
    async release(record, reason, commandKey) { identity(); return request(`${records}/${encodeURIComponent(record.id)}/release`, {}, commandKey, releaseBody(userId, record.id, record.type === "PAYMENT_PASSWORD_LOCK" ? "RELEASE_LOCK" : "CLEAR_EXCEPTION", record.version, reason)); },
    async receipt(commandKey) { identity(); return request(`${records}/commands/${encodeURIComponent(commandKey)}`); },
  };
}
export const paymentSecurityPorts = { global: (userId: string) => securityPort("global", userId), support: (customerId: string) => securityPort("support", customerId) };
export async function fetchPaymentSecurityRecords(query: { keyword: string; state: string; from: string; to: string; pageNum: number; pageSize: number }) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return parsePaymentSecurityPage(await request(`${recordBase}?${params}`));
}
type PaymentReleaseOriginal = { reason: string; expectedVersion: number; confirmed: true; body: string; path: string; operator: string };
export interface PendingPaymentRelease extends PendingMutationRecord, Partial<PaymentReleaseOriginal> { owner: number; portKey: string; userId: string; recordId: string; operation: PaymentReleaseReceipt["operation"]; rejection?: string }
const releases = createPendingMutationStore<PendingPaymentRelease>({ storageKey: "nexion-admin-payment-release-commands-v1", retainExpiredRecords: true, isValidRecord: row => Number.isSafeInteger(row.owner) && typeof row.portKey === "string" && typeof row.userId === "string" && typeof row.recordId === "string" && (row.operation === "RELEASE_LOCK" || row.operation === "CLEAR_EXCEPTION") });
export function pendingPaymentReleases(owner: number) { return releases.list().filter(row => row.owner === owner); }
export function pendingPaymentRelease(owner: number, userId: string) { return releases.list().find(row => row.owner === owner && row.userId === userId) ?? null; }
export function isCompletePaymentRelease(row: PendingPaymentRelease): row is PendingPaymentRelease & PaymentReleaseOriginal {
  return ["global:" + row.userId, "support:" + row.userId].includes(row.portKey) && /^[1-9]\d*$/.test(row.userId)
    && Number.isSafeInteger(row.expectedVersion) && row.expectedVersion! >= 0 && typeof row.reason === "string" && row.reason.trim().length >= 8 && row.reason.trim().length <= 200
    && row.confirmed === true && typeof row.operator === "string" && row.operator.length > 0
    && row.path === `${paymentRecordsPath(row.portKey.startsWith("support:") ? "support" : "global", row.userId)}/${encodeURIComponent(row.recordId)}/release`
    && row.body === releaseBody(row.userId, row.recordId, row.operation, row.expectedVersion!, row.reason);
}
export async function submitPaymentRelease(owner: number, port: PaymentSecurityPort, record: PaymentSecurityRecord, reason: string) {
  if (!Number.isSafeInteger(owner) || owner < 1 || record.userId !== port.userId || !record.capabilities.releaseAllowed || record.version === null || record.type === "UNSUPPORTED" || record.state !== "ACTIVE" || reason.trim().length < 8 || reason.trim().length > 200) throw new Error("当前处置条件或原因不符合要求，请重新核对详情。");
  if (pendingPaymentRelease(owner, port.userId)) throw new Error("请先查询该用户上一笔解除结果，不能重复提交。");
  const commandKey = createA2CommandKey("payment-release"), fingerprint = `payment-release|${owner}|${port.userId}`;
  releases.remember(fingerprint, commandKey, { owner, portKey: port.key, userId: port.userId, recordId: record.id, operation: record.type === "PAYMENT_PASSWORD_LOCK" ? "RELEASE_LOCK" : "CLEAR_EXCEPTION", expectedVersion: record.version, reason: reason.trim(), confirmed: true, body: releaseBody(port.userId, record.id, record.type === "PAYMENT_PASSWORD_LOCK" ? "RELEASE_LOCK" : "CLEAR_EXCEPTION", record.version, reason.trim()), path: `${paymentRecordsPath(port.surface, port.userId)}/${encodeURIComponent(record.id)}/release`, operator: currentAdminOperator(`admin:${owner}`) });
  if (!releases.isDurablyStored(fingerprint, commandKey)) { releases.forget(fingerprint, commandKey); throw new Error("浏览器无法保存查询记录，未提交解除。请允许会话存储后重试。"); }
  try { await port.release(record, reason.trim(), commandKey); }
  catch (failure) { if (isExplicitRejection(failure)) releases.forget(fingerprint, commandKey); throw failure; }
  return queryPaymentRelease(owner, port);
}
export async function retryPaymentRelease(owner: number, port: PaymentSecurityPort) {
  const row = pendingPaymentRelease(owner, port.userId);
  if (!row || row.portKey !== port.key || !isCompletePaymentRelease(row) || row.rejection || row.expiresAt <= Date.now()) throw new Error("此原解除只能从原入口查询，不能重发。");
  if (!releases.isDurablyStored(row.fingerprint, row.commandKey)) throw new Error("浏览器无法保存原操作，不能重发，请先查询结果。");
  try { await request(row.path, {}, row.commandKey, row.body); }
  catch (failure) {
    if (isExplicitRejection(failure)) releases.remember(row.fingerprint, row.commandKey, { ...row, rejection: failure instanceof PaymentPasswordApiError ? formatAdminApiError(failure.backendMessage, failure.message) : "原解除已被明确拒绝" });
    throw failure;
  }
  return queryPaymentRelease(owner, port);
}
export function releaseRejectedPaymentRelease(owner: number, port: PaymentSecurityPort, commandKey: string) {
  const row = pendingPaymentRelease(owner, port.userId);
  if (!row || row.portKey !== port.key || row.commandKey !== commandKey || !row.rejection) throw new Error("原解除尚未被明确拒绝，不能解除待确认。");
  releases.forget(row.fingerprint, row.commandKey);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nexion-payment-security-updated"));
}
export async function queryPaymentRelease(owner: number, port: PaymentSecurityPort) {
  const row = pendingPaymentRelease(owner, port.userId);
  if (!row) throw new Error("没有待查询的解除记录。");
  if (row.portKey !== port.key) throw new Error("该用户在其他入口有待确认的操作，请回原入口查询，期间不能重复解除。");
  const receipt = parsePaymentReleaseReceipt(await port.receipt(row.commandKey), row);
  if (receipt.status === "APPLIED" || receipt.status === "REJECTED") {
    await port.detail(row.recordId);
    releases.forget(row.fingerprint, row.commandKey);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("nexion-payment-security-updated"));
  }
  return receipt;
}
