import { guardedFetch, formatAdminApiError } from "@/lib/admin/error-messages";
import { adminAuthLifecycleEpoch, AdminAuthEpochChangedError } from "@/lib/admin/auth-lifecycle";
import { isAdminAuthFailure } from "@/lib/admin/auth-session";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { parsePurchasePaymentPolicy, parsePurchasePaymentPage, parsePurchasePaymentRecord, type PurchasePaymentChannelInput } from "@/lib/admin/purchase-payment-contract";

const base = "/api/admin/finance";
export class PurchasePaymentApiError extends Error { constructor(message: string, readonly status: number, readonly unknownOutcome = false) { super(message); } }
export class PurchasePaymentOutcomeUnknownError extends PurchasePaymentApiError { constructor(message: string, status: number) { super(message, status, true); } }
async function request(path: string, method = "GET", body?: unknown, key?: string): Promise<unknown> {
  const epoch = adminAuthLifecycleEpoch();
  let response: Response;
  try { response = await guardedFetch(`${base}${path}`, { method, cache: "no-store", signal: AbortSignal.timeout(25_000), ...(body === undefined ? {} : { headers: { "Content-Type": "application/json", "Idempotency-Key": key! }, body: JSON.stringify(body) }) }); }
  catch { throw new PurchasePaymentApiError(body === undefined ? "订单付款服务暂时无法连接，请重新加载。" : "操作结果未确认，请保留原请求并核对，不能重新提交。", 0, body !== undefined); }
  if (epoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
  const raw = await response.json().catch(() => null);
  if (epoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
  if (isAdminAuthFailure(response.status, raw?.message)) useAdminAuth.getState().signOut();
  if (!response.ok || raw?.code !== 0 || raw?.data == null) {
    const unknown = body !== undefined && (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || outcomeStaysUnknown(response.status, raw?.code));
    if (unknown) throw new PurchasePaymentOutcomeUnknownError("操作结果未确认，请保留原请求并核对，不能重新提交。", response.status);
    throw new PurchasePaymentApiError(formatAdminApiError(raw?.message, "订单付款请求未完成，请重新加载后核对。"), response.status);
  }
  return raw.data;
}
export const fetchPurchasePaymentPolicy = async () => parsePurchasePaymentPolicy(await request("/purchase-payment-policy"));
export const fetchPurchasePaymentRecord = async (intentNo: string) => parsePurchasePaymentRecord(await request(`/purchase-payment-records/${encodeURIComponent(intentNo)}`), intentNo);
export async function fetchPurchasePaymentRecords(query: { status: string; paymentMethod: string; pageNum: number; pageSize: number }) { return parsePurchasePaymentPage(await request(`/purchase-payment-records?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`)); }
export type PendingPurchasePayment = PendingMutationRecord & { owner: number; scope: string; path: string; method: "PATCH" | "POST"; body: Record<string, unknown> };
const commands = createPendingMutationStore<PendingPurchasePayment>({ storageKey: "nexion-admin-purchase-payment-commands-v1", retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.owner) && typeof row.scope === "string" && typeof row.path === "string" && ["PATCH", "POST"].includes(row.method) && !!row.body });
export const pendingPurchasePayments = (owner: number) => commands.list().filter(row => row.owner === owner);
export function canRetryPurchasePayment(row: PendingPurchasePayment) { return Date.now() >= row.createdAt && Date.now() < Math.min(row.expiresAt, row.createdAt + 600_000); }
async function execute(row: PendingPurchasePayment, retry: boolean) {
  const session = useAdminAuth.getState().session;
  const authority = row.scope === "policy" ? "finance_d1_fx_manage" : "finance_d1_bank_reconcile";
  if (session?.adminId !== row.owner || !session.authorities.includes(authority) && !["superadmin", "super"].includes(session.role)) throw new Error("登录身份或处置权限已变化，请重新打开页面。");
  if (retry && !canRetryPurchasePayment(row)) throw new Error("原请求已超过重试时间，请通过操作记录继续核实，不能创建新请求。");
  try {
    const raw = await request(row.path, row.method, row.body, row.commandKey);
    const result = row.scope === "policy" ? parsePurchasePaymentPolicy(raw) : parsePurchasePaymentRecord(raw, row.scope);
    commands.forget(row.fingerprint, row.commandKey);
    return result;
  } catch (failure) {
    if (!retry && failure instanceof PurchasePaymentApiError && !failure.unknownOutcome) commands.forget(row.fingerprint, row.commandKey);
    throw failure;
  }
}
async function submit(owner: number, scope: string, path: string, method: "PATCH" | "POST", body: Record<string, unknown>) {
  const session = useAdminAuth.getState().session, authority = scope === "policy" ? "finance_d1_fx_manage" : "finance_d1_bank_reconcile";
  if (session?.adminId !== owner || !session.authorities.includes(authority) && !["superadmin", "super"].includes(session.role)) throw new Error("登录身份或处置权限已变化，请重新打开页面。");
  if (pendingPurchasePayments(owner).some(row => row.scope === scope)) throw new Error("请先核对上一笔原请求，不能重新提交。");
  const key = createA2CommandKey("purchase-payment"), fingerprint = `${owner}|${scope}`;
  commands.remember(fingerprint, key, { owner, scope, path, method, body });
  if (!commands.isDurablyStored(fingerprint, key)) { commands.forget(fingerprint, key); throw new Error("浏览器无法保存恢复记录，未提交。请允许会话存储后重试。"); }
  return execute(commands.list().find(row => row.commandKey === key)!, false);
}
export const updatePurchasePaymentPolicy = (owner: number, expectedVersion: number, channels: PurchasePaymentChannelInput[], reason: string) => submit(owner, "policy", "/purchase-payment-policy", "PATCH", { expectedVersion, channels, reason });
export const revalidatePurchasePayment = (owner: number, intentNo: string, expectedVersion: number, reason: string) => submit(owner, intentNo, `/purchase-payment-records/${encodeURIComponent(intentNo)}/revalidate-deliver`, "POST", { expectedVersion, reason });
export const retryPurchasePayment = (row: PendingPurchasePayment) => execute(row, true);
