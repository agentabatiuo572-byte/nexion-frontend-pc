export const paymentPolicyFields = ["maxAttempts", "windowMinutes", "lockMinutes"] as const;
export type PaymentPolicyField = typeof paymentPolicyFields[number];
export type PaymentPolicyValues = Record<PaymentPolicyField, number>;
export type PaymentPolicy = {
  version: number;
  values: PaymentPolicyValues;
  constraints: Record<PaymentPolicyField, { min: number; max: number }> | null;
  effectDescription: string | null;
  editable: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};
export type PaymentPasswordStatus = { userId: string; state: "UNSET" | "SET" | "LOCKED"; updatedAt: string | null; lockedUntil: string | null; observedAt: string };
export type PaymentPasswordAttempt = { id: string; occurredAt: string; purpose: "PAYMENT" | "CHANGE"; result: "SUCCEEDED" | "INCORRECT" | "LOCKED" | "BUSINESS_REJECTED"; channel: "APP" | "H5"; clientIpMasked: string | null };
export type PaymentPasswordAttempts = { userId: string; records: PaymentPasswordAttempt[]; total: number; pageNum: number; pageSize: number };
export type PaymentPolicyReceipt = { commandKey: string; status: "APPLIED" | "REJECTED" | "PENDING"; auditId: string | null; changedAt: string | null; changedBy: string | null; reason: string; oldValues: PaymentPolicyValues; newValues: PaymentPolicyValues; effectDescription: string | null };

const invalid = () => new Error("支付密码信息不完整，请重新加载；当前信息尚未确认。");
export const isPaymentRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const optionalTime = (value: unknown) => value === null || timestamp(value);
const optionalText = (value: unknown) => value === null || typeof value === "string" && value.trim().length > 0;
export function parsePaymentValues(raw: unknown): PaymentPolicyValues {
  if (!isPaymentRecord(raw) || !paymentPolicyFields.every(key => integer(raw[key]) && Number(raw[key]) > 0)) throw invalid();
  return { maxAttempts: Number(raw.maxAttempts), windowMinutes: Number(raw.windowMinutes), lockMinutes: Number(raw.lockMinutes) };
}
export function parsePaymentPolicy(raw: unknown): PaymentPolicy {
  if (!isPaymentRecord(raw) || !integer(raw.version) || typeof raw.editable !== "boolean" || !optionalText(raw.effectDescription) || !optionalTime(raw.updatedAt) || !optionalText(raw.updatedBy)) throw invalid();
  const values = parsePaymentValues(raw.values);
  let constraints: PaymentPolicy["constraints"] = null;
  if (raw.constraints !== null) {
    if (!isPaymentRecord(raw.constraints)) throw invalid();
    constraints = {} as NonNullable<PaymentPolicy["constraints"]>;
    for (const key of paymentPolicyFields) {
      const bounds = raw.constraints[key];
      if (!isPaymentRecord(bounds) || !integer(bounds.min) || !integer(bounds.max) || bounds.min < 1 || bounds.max < bounds.min || values[key] < bounds.min || values[key] > bounds.max) throw invalid();
      constraints[key] = { min: bounds.min, max: bounds.max };
    }
  }
  return { version: raw.version, values, constraints, editable: raw.editable, effectDescription: raw.effectDescription as string | null, updatedAt: raw.updatedAt as string | null, updatedBy: raw.updatedBy as string | null };
}
export function parsePaymentStatus(raw: unknown, userId: string): PaymentPasswordStatus {
  if (!isPaymentRecord(raw) || raw.userId !== userId || !["UNSET", "SET", "LOCKED"].includes(String(raw.state)) || !optionalTime(raw.updatedAt) || !optionalTime(raw.lockedUntil) || !timestamp(raw.observedAt) || raw.state === "LOCKED" && !timestamp(raw.lockedUntil)) throw invalid();
  return { userId, state: raw.state as PaymentPasswordStatus["state"], updatedAt: raw.updatedAt as string | null, lockedUntil: raw.lockedUntil as string | null, observedAt: raw.observedAt };
}
export function parsePaymentAttempts(raw: unknown, userId: string): PaymentPasswordAttempts {
  if (!isPaymentRecord(raw) || raw.userId !== userId || !Array.isArray(raw.records) || !integer(raw.total) || !integer(raw.pageNum) || raw.pageNum < 1 || !integer(raw.pageSize) || raw.pageSize < 1 || raw.records.length > raw.pageSize || raw.records.length > raw.total) throw invalid();
  const records = raw.records.map(row => {
    if (!isPaymentRecord(row) || typeof row.id !== "string" || !row.id || !timestamp(row.occurredAt) || !["PAYMENT", "CHANGE"].includes(String(row.purpose)) || !["SUCCEEDED", "INCORRECT", "LOCKED", "BUSINESS_REJECTED"].includes(String(row.result)) || !["APP", "H5"].includes(String(row.channel)) || !(row.clientIpMasked === null || typeof row.clientIpMasked === "string" && /^[0-9a-fA-F.*:]+$/.test(row.clientIpMasked) && row.clientIpMasked.includes("*"))) throw invalid();
    return { id: row.id, occurredAt: row.occurredAt, purpose: row.purpose, result: row.result, channel: row.channel, clientIpMasked: row.clientIpMasked } as PaymentPasswordAttempt;
  });
  return { userId, records, total: raw.total, pageNum: raw.pageNum, pageSize: raw.pageSize };
}
export function parsePaymentReceipt(raw: unknown, commandKey: string): PaymentPolicyReceipt {
  if (!isPaymentRecord(raw) || raw.commandKey !== commandKey || !["APPLIED", "REJECTED", "PENDING"].includes(String(raw.status)) || !optionalText(raw.auditId) || !optionalTime(raw.changedAt) || !optionalText(raw.changedBy) || typeof raw.reason !== "string" || raw.reason.trim().length < 8 || !optionalText(raw.effectDescription) || raw.status === "APPLIED" && (!raw.auditId || !raw.changedAt || !raw.changedBy || !raw.effectDescription)) throw invalid();
  return { commandKey, status: raw.status as PaymentPolicyReceipt["status"], auditId: raw.auditId as string | null, changedAt: raw.changedAt as string | null, changedBy: raw.changedBy as string | null, reason: raw.reason, oldValues: parsePaymentValues(raw.oldValues), newValues: parsePaymentValues(raw.newValues), effectDescription: raw.effectDescription as string | null };
}

export type PaymentSecurityType = "PAYMENT_PASSWORD_LOCK" | "PAYMENT_PASSWORD_EXCEPTION" | "UNSUPPORTED";
export type PaymentSecurityState = "ACTIVE" | "RELEASED" | "EXPIRED" | "UNKNOWN";
export type PaymentSecurityRecord = {
  id: string; userId: string; userLabel: string; version: number | null; type: PaymentSecurityType; state: PaymentSecurityState;
  reason: string; startedAt: string; lockedUntil: string | null; failedAttempts: number | null; windowMinutes: number | null;
  capabilities: { releaseAllowed: boolean; disabledReason: string | null; effectDescription: string | null };
};
export type PaymentSecuritySummary = { userId: string; observedAt: string; record: PaymentSecurityRecord | null };
export type PaymentSecurityPage = { records: PaymentSecurityRecord[]; total: number; pageNum: number; pageSize: number };
export type PaymentSecurityAudit = { id: string; occurredAt: string; operator: string; action: string; reason: string };
export type PaymentSecurityDetail = { record: PaymentSecurityRecord; attempts: PaymentPasswordAttempts; audit: PaymentSecurityAudit[] };
export type PaymentReleaseReceipt = { commandKey: string; status: "APPLIED" | "REJECTED" | "PENDING" | "NOT_FOUND"; userId: string; recordId: string; operation: "RELEASE_LOCK" | "CLEAR_EXCEPTION"; auditId: string | null; changedAt: string | null; changedBy: string | null; reason: string | null; record: PaymentSecurityRecord | null };
const stableId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const presentText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export function parsePaymentSecurityRecord(raw: unknown, userId?: string): PaymentSecurityRecord {
  if (!isPaymentRecord(raw) || !stableId(raw.id) || !presentText(raw.userId) || userId !== undefined && raw.userId !== userId || !presentText(raw.userLabel) || !presentText(raw.reason) || !timestamp(raw.startedAt) || !optionalTime(raw.lockedUntil) || !(raw.failedAttempts === null || integer(raw.failedAttempts)) || !(raw.windowMinutes === null || integer(raw.windowMinutes) && raw.windowMinutes > 0)) throw invalid();
  const type: PaymentSecurityType = raw.type === "PAYMENT_PASSWORD_LOCK" || raw.type === "PAYMENT_PASSWORD_EXCEPTION" ? raw.type : "UNSUPPORTED";
  const state: PaymentSecurityState = raw.state === "ACTIVE" || raw.state === "RELEASED" || raw.state === "EXPIRED" ? raw.state : "UNKNOWN";
  const version = integer(raw.version) ? raw.version : null;
  const capability = raw.capabilities;
  const effectDescription = isPaymentRecord(capability) && presentText(capability.effectDescription) ? capability.effectDescription : null;
  const releaseAllowed = isPaymentRecord(capability) && capability.releaseAllowed === true && !!effectDescription && version !== null && type !== "UNSUPPORTED" && state === "ACTIVE";
  const disabledReason = releaseAllowed ? null : isPaymentRecord(capability) && presentText(capability.disabledReason) ? capability.disabledReason : state === "RELEASED" || state === "EXPIRED" ? "本条异常已结束，历史记录继续保留。" : "处置条件尚未确认，请重新加载或联系有权限的管理员。";
  return { id: raw.id, userId: raw.userId, userLabel: raw.userLabel, version, type, state, reason: raw.reason, startedAt: raw.startedAt, lockedUntil: raw.lockedUntil as string | null, failedAttempts: raw.failedAttempts as number | null, windowMinutes: raw.windowMinutes as number | null, capabilities: { releaseAllowed, disabledReason, effectDescription } };
}
export function parsePaymentSecuritySummary(raw: unknown, userId: string): PaymentSecuritySummary {
  if (!isPaymentRecord(raw) || raw.userId !== userId || !timestamp(raw.observedAt) || !(raw.record === null || isPaymentRecord(raw.record))) throw invalid();
  return { userId, observedAt: raw.observedAt, record: raw.record === null ? null : parsePaymentSecurityRecord(raw.record, userId) };
}
export function parsePaymentSecurityPage(raw: unknown): PaymentSecurityPage {
  if (!isPaymentRecord(raw) || !Array.isArray(raw.records) || !integer(raw.total) || !integer(raw.pageNum) || raw.pageNum < 1 || !integer(raw.pageSize) || ![10, 20, 50].includes(raw.pageSize) || raw.records.length > raw.pageSize || raw.records.length > raw.total) throw invalid();
  return { records: raw.records.map(row => parsePaymentSecurityRecord(row)), total: raw.total, pageNum: raw.pageNum, pageSize: Number(raw.pageSize) };
}
export function parsePaymentSecurityDetail(raw: unknown, userId: string, recordId: string): PaymentSecurityDetail {
  if (!isPaymentRecord(raw) || !Array.isArray(raw.audit)) throw invalid();
  const record = parsePaymentSecurityRecord(raw.record, userId);
  if (record.id !== recordId) throw invalid();
  const audit = raw.audit.map(row => {
    if (!isPaymentRecord(row) || !stableId(row.id) || !timestamp(row.occurredAt) || !presentText(row.operator) || !presentText(row.action) || !presentText(row.reason)) throw invalid();
    return { id: row.id, occurredAt: row.occurredAt, operator: row.operator, action: row.action, reason: row.reason };
  });
  return { record, attempts: parsePaymentAttempts(raw.attempts, userId), audit };
}
export function parsePaymentReleaseReceipt(raw: unknown, expected: { commandKey: string; userId: string; recordId: string; operation: PaymentReleaseReceipt["operation"] }): PaymentReleaseReceipt {
  if (!isPaymentRecord(raw) || raw.commandKey !== expected.commandKey || raw.userId !== expected.userId || raw.recordId !== expected.recordId || raw.operation !== expected.operation || !["APPLIED", "REJECTED", "PENDING", "NOT_FOUND"].includes(String(raw.status)) || !optionalText(raw.auditId) || !optionalTime(raw.changedAt) || !optionalText(raw.changedBy) || !optionalText(raw.reason)) throw invalid();
  const record = raw.record === null ? null : parsePaymentSecurityRecord(raw.record, expected.userId);
  if (record && (record.id !== expected.recordId || record.type !== (expected.operation === "RELEASE_LOCK" ? "PAYMENT_PASSWORD_LOCK" : "PAYMENT_PASSWORD_EXCEPTION")) || raw.status === "APPLIED" && (!raw.auditId || !raw.changedAt || !raw.changedBy || !presentText(raw.reason) || raw.reason.trim().length < 8 || !record || record.state !== "RELEASED")) throw invalid();
  return { commandKey: expected.commandKey, userId: expected.userId, recordId: expected.recordId, operation: expected.operation, status: raw.status as PaymentReleaseReceipt["status"], auditId: raw.auditId as string | null, changedAt: raw.changedAt as string | null, changedBy: raw.changedBy as string | null, reason: raw.reason as string | null, record };
}
