import { A2OutcomeUncertainError, fetchA2ProposalByKey, type A2OperationRow } from "./a2-client";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import { guardedFetch, formatAdminApiError } from "./error-messages";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen } from "./outcome-classification";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { E5Device } from "./e5-client";
import type { LegacyUnknownCandidate } from "./legacy-unknown-resolution";
import { discoverECommand, investigateECommand, eCommandSettled, type ECommandEvidence } from "./e-command-investigation";

export type E5Intent = "activate" | "deactivate" | "pause" | "resume" | "force-activate" | "unbind" | "legacy";
export interface E5Command extends PendingMutationRecord {
  actorId: string;
  authEpoch: number;
  intent: E5Intent;
  label: string;
  device: E5Device;
  reason: string;
  path: string;
  method: "POST";
  body: string;
  proof?: LegacyUnknownCandidate;
  retryRejection?: string;
  receivedTicketId?: string;
  proposalAbsent?: boolean;
  proposalStatus?: A2OperationRow["status"];
}
export const e5Commands = createPendingMutationStore<E5Command>({
  storageKey: "nexion-admin-e5-full-commands-v1", retainExpiredRecords: true,
  isValidRecord: row => (row.receivedTicketId === undefined || typeof row.receivedTicketId === "string")
    && (row.proposalAbsent === undefined || typeof row.proposalAbsent === "boolean")
    && (row.proposalStatus === undefined || ["pending", "approved", "rejected", "withdrawn", "expired"].includes(row.proposalStatus))
    && (row.retryRejection === undefined || typeof row.retryRejection === "string")
    && typeof row.actorId === "string" && !!row.actorId && Number.isInteger(row.authEpoch)
    && ["activate", "deactivate", "pause", "resume", "force-activate", "unbind", "legacy"].includes(row.intent)
    && typeof row.label === "string" && typeof row.reason === "string" && typeof row.body === "string"
    && row.method === "POST" && /^\/api\/admin\/(devices\/|platform\/audit\/operations$)/.test(row.path)
    && !!row.device && Number.isSafeInteger(row.device.deviceId) && typeof row.device.userId === "string",
});

/** Read the two old tables without pruning evidence or touching E1/E4 records. */
export function e5LegacyCommands(): { commandKey: string; fingerprint: string }[] {
  if (typeof window === "undefined") return [];
  const rows: { commandKey: string; fingerprint: string }[] = [];
  for (const key of ["nexion-admin-e5-device-commands-v1", "nexion-admin-e-domain-commands-v1"]) {
    const raw = sessionStorage.getItem(key);
    if (!raw) continue;
    const table: unknown = JSON.parse(raw);
    if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("旧操作记录无法读取，请保留本标签页并联系值班人员。");
    for (const value of Object.values(table)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      if (typeof row.commandKey === "string" && typeof row.fingerprint === "string"
        && (key.includes("e5-device") || /e5_device_|device-activate|device-deactivate|device-batch/.test(row.fingerprint)))
        rows.push({ commandKey: row.commandKey, fingerprint: row.fingerprint });
    }
  }
  return rows;
}

export function e5CommandBlocks(record: E5Command, device: E5Device, intent?: E5Intent) {
  return record.device.deviceId === device.deviceId
    || record.device.userId === device.userId && (["pause", "resume"].includes(record.intent) || intent === "pause" || intent === "resume");
}

export class E5CommandError extends Error {
  constructor(message: string, readonly status?: number, readonly backendMessage = "", readonly unknownOutcome = false, readonly httpStatus?: number, readonly apiCode?: number) { super(message); }
}

export async function checkE5Command(record: E5Command, evidence?: ECommandEvidence) {
  if (!["activate", "deactivate", "pause", "resume"].includes(record.intent)) return null;
  const locator = { commandKey: record.commandKey, originalMethod: record.method, originalPath: record.path, originalAdminId: record.actorId };
  const receipt = evidence ? await investigateECommand(record, locator, evidence) : await discoverECommand(locator);
  if (eCommandSettled(receipt)) e5Commands.forget(record.fingerprint, record.commandKey);
  return receipt;
}

/** The POST receipt is creation evidence; only this lookup establishes current approval status. */
export async function queryE5Proposal(record: E5Command) {
  if (String(useAdminAuth.getState().session?.adminId ?? "") !== record.actorId
      || !["force-activate", "unbind", "legacy"].includes(record.intent)) throw new Error("管理员会话已变化，请重新进入设备页面。");
  e5Commands.remember(record.fingerprint, record.commandKey, { ...record, proposalAbsent: false });
  const ticket = await fetchA2ProposalByKey(record.commandKey, true, true);
  if (!ticket) {
    if (record.receivedTicketId) throw new A2OutcomeUncertainError("提案缺少有效票号", record.commandKey);
    e5Commands.remember(record.fingerprint, record.commandKey, { ...record, proposalAbsent: true });
    return null;
  }
  if (!ticket.mine || ticket.obj !== String(record.device.deviceId) || record.receivedTicketId && record.receivedTicketId !== ticket.id)
    throw new A2OutcomeUncertainError("提案缺少有效票号", record.commandKey);
  if (ticket.status === "pending") e5Commands.remember(record.fingerprint, record.commandKey, { ...record, receivedTicketId: ticket.id, proposalStatus: ticket.status, proposalAbsent: false });
  else e5Commands.forget(record.fingerprint, record.commandKey);
  return ticket;
}

/** Visual handoff: invoke only after the original operator confirms release. Direct writes never qualify. */
export async function releaseMissingE5Proposal(record: E5Command) {
  if (!isRetryExpired(record) || record.receivedTicketId || record.proposalStatus)
    throw new Error("已超过 24 小时，只能读回核对，原操作仍保留。");
  const ticket = await queryE5Proposal(record);
  if (!ticket) e5Commands.forget(record.fingerprint, record.commandKey);
  return ticket;
}

/** Only this saved envelope is sent, including on retries after a refresh. */
export async function sendE5Command(record: E5Command, retry: boolean) {
  const auth = useAdminAuth.getState();
  if (String(auth.session?.adminId ?? "") !== record.actorId || !retry && auth.authEpoch !== record.authEpoch) throw new Error("管理员会话已变化，请重新进入设备页面。");
  if (retry && record.receivedTicketId) {
    const ticket = await queryE5Proposal(record);
    if (!ticket) throw new A2OutcomeUncertainError("提案缺少有效票号", record.commandKey);
    return { ...ticket } as Record<string, unknown>;
  }
  if (isRetryExpired(record)) throw new Error("已超过 24 小时，只能读回核对，原操作仍保留。");
  e5Commands.remember(record.fingerprint, record.commandKey, { ...record, retryRejection: undefined });
  if (!e5Commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("原操作无法保存，暂不能提交。");
  let data: Record<string, unknown>;
  try {
    const response = await guardedFetch(record.path, {
      method: record.method, body: record.body, cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": record.commandKey },
    });
    const raw: unknown = await response.json();
    if (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown") throw new E5CommandError("原操作结果未确认", undefined, "", true);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new E5CommandError("原操作回执无法读取", undefined, "", true);
    const result = raw as { code?: unknown; message?: unknown; data?: unknown };
    if (!response.ok || result.code !== 0) {
      const status = response.ok && typeof result.code === "number" && result.code >= 400 && result.code < 500 ? result.code : response.status;
      const code = typeof result.message === "string" ? result.message : "";
      throw new E5CommandError(formatAdminApiError(code, "原操作结果未确认，请核查"), status, code,
        status >= 500 || !code || result.code == null || isIdempotencyOutcomeOpen(code) || retry && record.intent === "legacy" && code.startsWith("LEGACY_UNKNOWN_"),
        response.status, typeof result.code === "number" ? result.code : undefined);
    }
    if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new E5CommandError("原操作缺少有效回执", undefined, "", true);
    data = result.data as Record<string, unknown>;
    if (["force-activate", "unbind", "legacy"].includes(record.intent)) {
      if (typeof data.id !== "string" || !data.id.trim()) throw new E5CommandError("提案缺少有效票号", undefined, "", true);
    } else if (["pause", "resume"].includes(record.intent)) {
      if (!Number.isSafeInteger(data.changedCount) || Number(data.changedCount) < 0 || String(data.userId) !== record.device.userId || data.paused !== (record.intent === "pause"))
        throw new E5CommandError("用户设备操作回执不完整", undefined, "", true);
    } else if (String(data.id) !== String(record.device.deviceId) || (record.intent === "deactivate" && typeof data.pendingDeactivate !== "boolean" && data.pendingDeactivate !== 0 && data.pendingDeactivate !== 1)) {
      throw new E5CommandError("设备操作回执不完整", undefined, "", true);
    }
  } catch (cause) {
    if (!retry && cause instanceof E5CommandError && !cause.unknownOutcome && cause.httpStatus !== undefined
        && isDeterministicRejection(cause.httpStatus, cause.apiCode)) e5Commands.forget(record.fingerprint, record.commandKey);
    else if (retry && isExplicitRejection(cause)) e5Commands.remember(record.fingerprint, record.commandKey, {
      ...record, retryRejection: cause instanceof Error ? cause.message : String(cause),
    });
    throw cause;
  }
  if (["force-activate", "unbind", "legacy"].includes(record.intent) && retry) {
    record = { ...record, receivedTicketId: String(data.id), retryRejection: undefined };
    e5Commands.remember(record.fingerprint, record.commandKey, record);
    const ticket = await queryE5Proposal(record);
    if (!ticket) throw new A2OutcomeUncertainError("提案缺少有效票号", record.commandKey);
    return { ...ticket } as Record<string, unknown>;
  }
  e5Commands.forget(record.fingerprint, record.commandKey);
  return data;
}
