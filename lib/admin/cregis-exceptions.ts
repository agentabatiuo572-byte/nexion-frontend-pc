import { financeAdminRequest } from "./d-client";

export type ExceptionRecord = Record<string, unknown>;
export type ExceptionPage = { records: ExceptionRecord[]; hasMore: boolean; nextBeforeId: string | null };
export type ExceptionRequestScope = { authEpoch: number; assertOwner: () => void };

export function exceptionChallengeId(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw new Error("签名证明编号无效，请重新生成原文");
  return value;
}

export function exceptionId(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value)
      || BigInt(value) > BigInt("9223372036854775807")) throw new Error("记录编号无效，请刷新后重试");
  return value;
}

export function exceptionObject(value: unknown): ExceptionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("异常资金响应无效");
  return value as ExceptionRecord;
}

export function exceptionPage(value: unknown): ExceptionPage {
  const row = exceptionObject(value);
  if (!Array.isArray(row.records) || typeof row.hasMore !== "boolean"
      || !(row.nextBeforeId === null || typeof row.nextBeforeId === "string")) throw new Error("异常资金列表响应无效");
  const records = row.records.map(exceptionObject);
  records.forEach(record => exceptionId(record.id));
  if (row.hasMore && (records.length === 0 || exceptionId(row.nextBeforeId) !== records.at(-1)?.id))
    throw new Error("异常资金分页响应无效");
  return { records, hasMore: row.hasMore, nextBeforeId: row.nextBeforeId as string | null };
}

export function exceptionVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("工单版本无效，请刷新");
  return value;
}

export function exceptionFee(mode: string, fee: string): string {
  if (!["PLATFORM_PAYS", "FIXED_USDT", "UNCONFIGURED"].includes(mode)) throw new Error("请选择退款费用规则");
  if (mode !== "FIXED_USDT") return "0";
  if (!/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(fee)) throw new Error("固定扣费须为非负 USDT，最多六位小数");
  return fee;
}

export async function exceptionRead(path: string, scope?: ExceptionRequestScope): Promise<ExceptionRecord> {
  scope?.assertOwner();
  const response = await financeAdminRequest<unknown>(`/cregis${path}`, { bankManualAuthEpoch: scope?.authEpoch });
  scope?.assertOwner();
  return exceptionObject(response);
}

export async function exceptionList(path: string, beforeId?: string, scope?: ExceptionRequestScope): Promise<ExceptionPage> {
  scope?.assertOwner();
  const response = await financeAdminRequest<unknown>(`/cregis${path}?limit=20&beforeId=${beforeId ? exceptionId(beforeId) : "0"}`, { bankManualAuthEpoch: scope?.authEpoch });
  scope?.assertOwner();
  return exceptionPage(response);
}

/** The existing financial client persists the same command key for unknown outcomes and reloads. */
export async function exceptionCommand(path: string, body: ExceptionRecord, scope?: ExceptionRequestScope): Promise<ExceptionRecord> {
  scope?.assertOwner();
  const response = await financeAdminRequest<unknown>(`/cregis${path}`, {
    method: "POST", body: JSON.stringify(body), idempotencyPrefix: "cregis-exception", bankManualAuthEpoch: scope?.authEpoch,
  });
  scope?.assertOwner();
  return exceptionObject(response);
}
