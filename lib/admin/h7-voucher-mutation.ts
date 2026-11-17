import { createA2CommandKey } from "./a2-client";
import { growthRequest, parseH7Voucher, validateH7VoucherWrite, type H7Voucher } from "./h-client";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, isRetryExpired, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";

type Form = Record<string, string>;
export type H7DirectContext = { skuLabels: Record<string, string> } & (
  | { kind: "create"; values: Form }
  | { kind: "update"; voucher: H7Voucher; before: Form; values: Form }
  | { kind: "status"; voucher: H7Voucher }
);
export interface H7DirectMutation extends PendingMutationRecord {
  adminId: number; voucherId: string; voucherName: string; reason: string;
  action: string; success: string; context: H7DirectContext;
  request: { path: string; method: "POST" | "PATCH"; body: string };
}

// This is the sole instance for H7's direct commands, including reads after refresh.
const commands = createPendingMutationStore<H7DirectMutation>({
  storageKey: "nexion-admin-h7-voucher-commands-v1", retainExpiredRecords: true,
  isValidRecord: record => {
    try {
      if (!Number.isSafeInteger(record.adminId) || typeof record.voucherId !== "string" || !record.voucherId
        || record.fingerprint !== `${record.adminId}:${record.voucherId}`
        || ![record.voucherName, record.reason, record.action, record.success].every(v => typeof v === "string")) return false;
      const c = record.context, request = record.request;
      if (!c || !c.skuLabels || Object.values(c.skuLabels).some(v => typeof v !== "string") || !request || typeof request.body !== "string") return false;
      const form = (value: Form) => !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(v => typeof v === "string");
      if (c.kind === "create" ? !form(c.values) : c.kind === "update" ? !form(c.before) || !form(c.values) : c.kind !== "status") return false;
      if (c.kind !== "create" && parseH7Voucher(c.voucher).id !== record.voucherId) return false;
      const path = c.kind === "create" ? "/vouchers" : `/vouchers/${encodeURIComponent(record.voucherId)}${c.kind === "status" ? "/status" : ""}`;
      if (request.path !== path || request.method !== (c.kind === "create" ? "POST" : "PATCH")) return false;
      const body = JSON.parse(request.body);
      return !!body && body.reason === record.reason && typeof body.operator === "string"
        && (c.kind === "status" ? body.key === "status" && ["active", "paused"].includes(body.value)
          && body.expectedValue === String(c.voucher.version) : body.id === record.voucherId);
    } catch { return false; }
  },
});

export const pendingH7VoucherMutations = (adminId: number) => commands.list().filter(r => r.adminId === adminId);

export function requireH7Actor(adminId: number, write: boolean): AdminSession {
  const auth = useAdminAuth.getState(), actor = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || !actor || actor.adminId !== adminId) throw new Error("ADMIN_AUTH_REQUIRED");
  if (write && !actor.authorities.includes("growth_h7_write")) throw new Error("H7_MAKER_FORBIDDEN");
  return actor;
}

export function createH7VoucherMutation(session: AdminSession, context: H7DirectContext, voucher: H7Voucher, reason: string): H7DirectMutation {
  if (context.kind !== "status") validateH7VoucherWrite(voucher);
  const status = context.kind === "status" ? context.voucher.status === "active" ? "paused" : "active" : undefined;
  const label = context.kind === "create" ? "新增" : context.kind === "update" ? "编辑" : status === "active" ? "投放" : "暂停";
  const operator = session.operator || session.username;
  const body = context.kind === "status"
    ? { key: "status", value: status, reason, operator, expectedValue: String(context.voucher.version) }
    : { ...voucher, ...(context.kind === "update" ? { expectedVersion: context.voucher.version } : {}), reason, operator };
  const now = Date.now();
  return {
    fingerprint: `${session.adminId}:${voucher.id}`, commandKey: createA2CommandKey(`h7-${context.kind}`),
    createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS, adminId: session.adminId,
    voucherId: voucher.id, voucherName: voucher.name, reason, context,
    action: `${label}代金券`, success: context.kind === "status" ? `${voucher.name} 已${label}` : `代金券「${voucher.name}」已${context.kind === "create" ? "新增" : "更新"}`,
    request: { path: context.kind === "create" ? "/vouchers" : `/vouchers/${encodeURIComponent(voucher.id)}${context.kind === "status" ? "/status" : ""}`,
      method: context.kind === "create" ? "POST" : "PATCH", body: JSON.stringify(body) },
  };
}

export async function sendH7VoucherMutation(record: H7DirectMutation, recovering: boolean) {
  requireH7Actor(record.adminId, true);
  if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
  if (recovering && !commands.list().some(r => r.commandKey === record.commandKey)) throw new Error("H7_ORIGINAL_RESOLVED");
  commands.remember(record.fingerprint, record.commandKey, record);
  if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) {
    if (!recovering) commands.forget(record.fingerprint, record.commandKey);
    throw new Error(recovering ? "H7_REQUEST_RETRY_STORAGE_UNAVAILABLE" : "H7_REQUEST_STORAGE_UNAVAILABLE");
  }
  try {
    const payload = await growthRequest<Record<string, unknown>>(record.request.path, {
      method: record.request.method, body: record.request.body, headers: { "Idempotency-Key": record.commandKey },
    }, undefined, true);
    const updated = payload?.updated as Record<string, unknown> | undefined;
    const expectedStatus = record.context.kind === "status" ? record.context.voucher.status === "active" ? "paused" : "active" : undefined;
    if (payload?.domain !== "H7" || !updated || updated.voucherId !== record.voucherId
      || (expectedStatus ? updated.status !== expectedStatus : updated.action !== (record.context.kind === "create" ? "created" : "updated"))) {
      throw new OutcomeUnknownError("H7_VOUCHER_RESPONSE_INVALID");
    }
  } catch (error) {
    const e = error as { status?: number; apiCode?: number; reasonCode?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean };
    // Growth can wrap business 4xx in an HTTP 200 envelope.
    const verdict = e.status && e.status >= 200 && e.status < 300 && e.apiCode && e.apiCode >= 400 && e.apiCode < 500
      ? Object.assign(error as object, { status: e.apiCode }) : error;
    const rejected = !isOutcomeUnknownError(error) && !e.unknownOutcome && !e.bodyUnreadable && !(e.apiCode && e.apiCode >= 500)
      && !(e.reasonCode ?? "").startsWith("IDEMPOTENCY_")
      && (recovering ? isExplicitRejection(verdict) : isDeterministicRejection(e.status ?? 0, e.apiCode));
    if (rejected) { commands.forget(record.fingerprint, record.commandKey); throw error; }
    throw new OutcomeUnknownError(error instanceof Error ? error.message : "H7_RESULT_UNKNOWN");
  }
  commands.forget(record.fingerprint, record.commandKey);
  // A replayed receipt is historical; the caller must GET before enabling new writes.
}
