import { guardedFetch } from "@/lib/admin/error-messages";
import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isPaymentRecord, parsePaymentPolicy, parsePaymentStatus, parsePaymentAttempts, parsePaymentReceipt, type PaymentPolicyValues } from "@/lib/admin/payment-password-contract";
import { parsePaymentSecuritySummary, parsePaymentSecurityDetail, parsePaymentSecurityPage, parsePaymentReleaseReceipt, type PaymentSecuritySummary, type PaymentSecurityDetail, type PaymentSecurityRecord, type PaymentReleaseReceipt } from "@/lib/admin/payment-password-contract";

const base = "/api/admin/users/security/payment-password-policy";
export class PaymentPasswordApiError extends Error { constructor(message: string, readonly status: number, readonly unknownOutcome = false) { super(message); } }
class PaymentPasswordOutcomeUnknownError extends PaymentPasswordApiError {
  constructor(status: number) { super("处理结果暂未确认，请查询原操作结果，不要重复提交。", status, true); }
}
async function request(path: string, body?: unknown, key?: string): Promise<unknown> {
  let response: Response;
  try {
    response = await guardedFetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: AbortSignal.timeout(20_000), ...(body === undefined ? {} : { headers: { "Content-Type": "application/json", "Idempotency-Key": key! }, body: JSON.stringify(body) }) });
  } catch {
    throw new PaymentPasswordApiError(body === undefined ? "支付密码服务暂时无法连接，请稍后重新加载。" : "处理结果暂未确认，请查询原操作结果，不要重复提交。", 0, body !== undefined);
  }
  const raw: unknown = await response.json().catch(() => null);
  if (isAdminAuthFailure(response.status, isPaymentRecord(raw) && typeof raw.message === "string" ? raw.message : undefined)) {
    resetAdminSession();
    if (body !== undefined && response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") throw new PaymentPasswordOutcomeUnknownError(401);
    throw new PaymentPasswordApiError("登录已失效，请重新登录后查询。", 401);
  }
  if (!response.ok || !isPaymentRecord(raw) || raw.code !== 0 || raw.data == null) {
    const code = isPaymentRecord(raw) && typeof raw.code === "number" ? raw.code : undefined;
    if (body !== undefined && (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || outcomeStaysUnknown(response.status, code))) throw new PaymentPasswordOutcomeUnknownError(response.status);
    throw new PaymentPasswordApiError(response.status === 403 ? "当前没有读取或处理这项支付安全信息的权限。" : response.status === 404 || response.status === 501 ? "支付密码服务尚未提供这项信息，请稍后重新加载。" : body === undefined ? "支付密码信息读取失败，请重新加载。" : "本次操作未执行，请重新加载后核对。", response.status);
  }
  return raw.data;
}
export async function fetchPaymentPolicy() { return parsePaymentPolicy(await request(base)); }
export async function fetchPaymentStatus(userId: string) { return parsePaymentStatus(await request(`/api/admin/users/profiles/${encodeURIComponent(userId)}/security/payment-password`), userId); }
export async function fetchPaymentAttempts(userId: string, page: number, pageSize: number) { return parsePaymentAttempts(await request(`/api/admin/users/profiles/${encodeURIComponent(userId)}/security/payment-password/attempts?pageNum=${page}&pageSize=${pageSize}`), userId); }
export interface PendingPaymentPolicy extends PendingMutationRecord { owner: number }
const pending = createPendingMutationStore<PendingPaymentPolicy>({ storageKey: "nexion-admin-payment-policy-commands-v1", retainExpiredRecords: true, isValidRecord: row => Number.isSafeInteger(row.owner) });
export function pendingPaymentPolicy(owner: number) { return pending.list().find(row => row.owner === owner) ?? null; }
export async function submitPaymentPolicy(owner: number, values: PaymentPolicyValues, expectedVersion: number, reason: string) {
  if (pendingPaymentPolicy(owner)) throw new Error("请先查询上一笔调整结果。");
  const commandKey = createA2CommandKey("payment-policy");
  const fingerprint = `payment-policy|${owner}|${commandKey}`;
  pending.remember(fingerprint, commandKey, { owner });
  if (!pending.isDurablyStored(fingerprint, commandKey)) { pending.forget(fingerprint, commandKey); throw new Error("浏览器无法保存查询记录，请允许会话存储后重试。"); }
  try {
    await request(base, { values, expectedVersion, reason, confirmed: true }, commandKey);
  } catch (failure) {
    if (failure instanceof PaymentPasswordApiError && !failure.unknownOutcome) pending.forget(fingerprint, commandKey);
    throw failure;
  }
  return queryPaymentPolicy(owner);
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
function securityPort(surface: "global" | "support", userId: string): PaymentSecurityPort {
  const valid = /^[1-9]\d*$/.test(userId);
  const scoped = `/api/admin/content/support-workbench/customers/${encodeURIComponent(userId)}/payment-password`;
  const records = surface === "global" ? recordBase : `${scoped}/records`;
  const identity = () => { if (!valid) throw new Error("客户身份尚未确认，请重新打开客户资料。"); };
  return {
    key: `${surface}:${userId}`, surface, userId,
    async summary() { identity(); return parsePaymentSecuritySummary(await request(surface === "global" ? `/api/admin/users/profiles/${userId}/security/payment-password/summary` : `${scoped}/summary`), userId); },
    async detail(recordId) { identity(); return parsePaymentSecurityDetail(await request(`${records}/${encodeURIComponent(recordId)}`), userId, recordId); },
    async attempts(recordId, page, pageSize) { identity(); return parsePaymentAttempts(await request(`${records}/${encodeURIComponent(recordId)}/attempts?pageNum=${page}&pageSize=${pageSize}`), userId); },
    async release(record, reason, commandKey) { identity(); return request(`${records}/${encodeURIComponent(record.id)}/release`, { userId, recordId: record.id, operation: record.type === "PAYMENT_PASSWORD_LOCK" ? "RELEASE_LOCK" : "CLEAR_EXCEPTION", expectedVersion: record.version, reason, confirmed: true }, commandKey); },
    async receipt(commandKey) { identity(); return request(`${records}/commands/${encodeURIComponent(commandKey)}`); },
  };
}
export const paymentSecurityPorts = { global: (userId: string) => securityPort("global", userId), support: (customerId: string) => securityPort("support", customerId) };
export async function fetchPaymentSecurityRecords(query: { keyword: string; state: string; from: string; to: string; pageNum: number; pageSize: number }) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  return parsePaymentSecurityPage(await request(`${recordBase}?${params}`));
}
export interface PendingPaymentRelease extends PendingMutationRecord { owner: number; portKey: string; userId: string; recordId: string; operation: PaymentReleaseReceipt["operation"] }
const releases = createPendingMutationStore<PendingPaymentRelease>({ storageKey: "nexion-admin-payment-release-commands-v1", retainExpiredRecords: true, isValidRecord: row => Number.isSafeInteger(row.owner) && typeof row.portKey === "string" && typeof row.userId === "string" && typeof row.recordId === "string" && (row.operation === "RELEASE_LOCK" || row.operation === "CLEAR_EXCEPTION") });
export function pendingPaymentRelease(owner: number, userId: string) { return releases.list().find(row => row.owner === owner && row.userId === userId) ?? null; }
export async function submitPaymentRelease(owner: number, port: PaymentSecurityPort, record: PaymentSecurityRecord, reason: string) {
  if (!Number.isSafeInteger(owner) || owner < 1 || record.userId !== port.userId || !record.capabilities.releaseAllowed || record.version === null || record.type === "UNSUPPORTED" || record.state !== "ACTIVE" || reason.trim().length < 8 || reason.trim().length > 200) throw new Error("当前处置条件或原因不符合要求，请重新核对详情。");
  if (pendingPaymentRelease(owner, port.userId)) throw new Error("请先查询该用户上一笔解除结果，不能重复提交。");
  const commandKey = createA2CommandKey("payment-release"), fingerprint = `payment-release|${owner}|${port.userId}`;
  releases.remember(fingerprint, commandKey, { owner, portKey: port.key, userId: port.userId, recordId: record.id, operation: record.type === "PAYMENT_PASSWORD_LOCK" ? "RELEASE_LOCK" : "CLEAR_EXCEPTION" });
  if (!releases.isDurablyStored(fingerprint, commandKey)) { releases.forget(fingerprint, commandKey); throw new Error("浏览器无法保存查询记录，未提交解除。请允许会话存储后重试。"); }
  try { await port.release(record, reason.trim(), commandKey); }
  catch (failure) { if (failure instanceof PaymentPasswordApiError && !failure.unknownOutcome) releases.forget(fingerprint, commandKey); throw failure; }
  return queryPaymentRelease(owner, port);
}
export async function queryPaymentRelease(owner: number, port: PaymentSecurityPort) {
  const row = pendingPaymentRelease(owner, port.userId);
  if (!row) throw new Error("没有待查询的解除记录。");
  if (row.portKey !== port.key) throw new Error("该用户在其他入口有待确认的操作，请回原入口查询，期间不能重复解除。");
  const receipt = parsePaymentReleaseReceipt(await port.receipt(row.commandKey), row);
  if (receipt.status === "APPLIED" || receipt.status === "REJECTED") {
    releases.forget(row.fingerprint, row.commandKey);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("nexion-payment-security-updated"));
  }
  return receipt;
}
