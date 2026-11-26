"use client";

import { B5OutcomeUnknownError, B5RequestError, fetchB5Inbox, fetchB5Radar, fetchB5Signal, fetchB5Subscription, normalizeB5Radar, normalizeB5Subscription, sendB5StoredWrite, type B5InboxItem, type B5Radar, type B5Subscription } from "./b5-client";
import { isBCommandRejection } from "./b-command-rejection";
import { createPendingMutationStore, createPendingRecovery, hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord, type SlotAttemptRecord } from "./pending-mutation-store";

import { explicitRejectionCode } from "./explicit-rejection";
import { currentRecoveryActor } from "./abe-recovery-access";

export type B5ThresholdFacts = Pick<B5Radar["bankrun"], "yellowPct" | "redPct" | "version" | "ratio24h" | "light">;
export type B5Signal = B5Radar["recentAlerts"][number];
type Original = PendingMutationRecord & { adminId: string; path: string; body: string };
export type B5PendingWrite = Original & (
  { kind: "threshold"; method: "PUT"; facts: B5ThresholdFacts }
  | { kind: "subscription"; method: "PUT"; facts: B5Subscription }
  | { kind: "signal"; method: "PATCH"; facts: B5Signal }
  | { kind: "ack"; method: "POST"; facts: Pick<B5InboxItem, "id" | "signalNo"> }
);
type Saved = B5PendingWrite | SlotAttemptRecord;
export type B5CommandInput = B5PendingWrite extends infer T ? T extends B5PendingWrite ? Omit<T, keyof PendingMutationRecord | "adminId"> : never : never;
export const isB5Original = (record: Saved): record is B5PendingWrite => "kind" in record;

// This replaces the page's slot store, using the same key and a single instance.
// Legacy evidence without the original operator/body remains query-only.
export const b5Commands = createPendingMutationStore<Saved>({
  storageKey: "nexion-admin-b5-risk-radar-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (record) => {
    if (!isB5Original(record)) return typeof record.inputFingerprint === "string";
    if (typeof record.adminId !== "string" || !record.adminId || typeof record.body !== "string"
      || !record.facts || typeof record.facts !== "object") return false;
    try {
      const input = record.body ? JSON.parse(record.body) : null;
      const version = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
      const reason = (value: unknown) => typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 200;
      // 阈值理由由提交表单和服务端按可见字数校验。恢复时保留原请求，不用现行政策筛掉旧记录。
      if (record.kind === "threshold") return record.method === "PUT" && record.path === "/api/admin/risk/bankrun-thresholds"
        && typeof input?.operator === "string" && typeof input.reason === "string" && input.reason.trim() !== "" && version(input.expectedVersion)
        && typeof input.yellowPct === "number" && input.yellowPct >= 5 && input.yellowPct <= 50
        && typeof input.redPct === "number" && input.redPct >= 10 && input.redPct <= 80 && input.redPct > input.yellowPct
        && version(record.facts.version) && input.expectedVersion === record.facts.version && Number.isFinite(record.facts.yellowPct) && Number.isFinite(record.facts.redPct)
        && (record.facts.ratio24h === null || Number.isFinite(record.facts.ratio24h)) && ["red", "yellow", "green", "unavailable"].includes(record.facts.light);
      if (record.kind === "subscription") return record.method === "PUT" && record.path === "/api/admin/risk/alert-subscription"
        && typeof input?.operator === "string" && version(input.expectedVersion)
        && [input.inApp, input.email, input.webhook].every(value => typeof value === "boolean") && typeof input.webhookUrl === "string"
        && typeof record.facts.subscriber === "string"
        && (record.facts.subscriberDisplayName == null || typeof record.facts.subscriberDisplayName === "string")
        && version(record.facts.version) && input.expectedVersion === record.facts.version
        && [record.facts.inApp, record.facts.email, record.facts.webhook].every(value => typeof value === "boolean")
        && [record.facts.webhookUrl, record.facts.emailMode, record.facts.webhookMode, record.facts.sharedWith].every(value => typeof value === "string");
      if (record.kind === "signal") return record.method === "PATCH"
        && typeof record.facts.signalNo === "string" && record.path === `/api/admin/risk/radar/signals/${encodeURIComponent(record.facts.signalNo)}/status`
        && typeof input?.operator === "string" && reason(input.reason) && version(input.expectedVersion)
        && input.expectedVersion === record.facts.handlingVersion && input.expectedStatus === record.facts.handlingStatus
        && (input.expectedStatus === "open" && input.targetStatus === "handled" || input.expectedStatus === "handled" && input.targetStatus === "resolved")
        && ["P0", "P1", "P2", "P3"].includes(record.facts.level) && Number.isSafeInteger(record.facts.userId) && record.facts.userId > 0
        && typeof record.facts.message === "string" && typeof record.facts.createdAt === "string"
        && record.facts.handlingStatusAvailable === true && typeof record.facts.target === "string" && typeof record.facts.deliveryStatus === "string";
      return record.kind === "ack" && record.method === "POST" && record.body === "" && version(record.facts.id) && record.facts.id > 0
        && typeof record.facts.signalNo === "string" && record.path === `/api/admin/risk/radar/inbox/${record.facts.id}/acknowledge`;
    } catch { return false; } // Persisted unknown input is parsed once at this boundary.
  },
});

export const b5Recovery = createPendingRecovery(b5Commands, {
  capability: record => isB5Original(record) ? "replay" : "readback",
  explicitRejectionCode,
  canReplay: record => {
    if (!isB5Original(record)) return false;
    const rights = currentRecoveryActor(record.adminId)?.authorities ?? [];
    const write = record.kind === "threshold" ? "overview_b5_threshold_write"
      : record.kind === "subscription" ? "overview_b5_subscribe" : "overview_b5_triage";
    return rights.includes("overview_b5_read") && rights.includes(write);
  },
});

export function pendingB5Commands(adminId: string) {
  return b5Commands.list().filter(record => isB5Original(record) ? record.adminId === adminId
    : !record.fingerprint.startsWith("triage|") && hasPersistedPendingCommandOwner(adminId));
}

export function rememberB5Command(adminId: string, slot: string, prefix: string, input: B5CommandInput): B5PendingWrite {
  if (pendingB5Commands(adminId).some(record => record.fingerprint === slot)) {
    throw new Error("原操作的结果还没有确认，请先核对原操作。");
  }
  const key = `${prefix}-${crypto.randomUUID()}`;
  b5Commands.remember(slot, key, { ...input, adminId });
  if (!b5Commands.isDurablyStored(slot, key)) {
    b5Commands.forget(slot, key);
    throw new Error("浏览器无法保存这次操作的记录，没有提交。请允许浏览器存储后重试。");
  }
  return b5Commands.list().find(record => record.commandKey === key) as B5PendingWrite;
}

/** Only matching receipts resolve an original write. A replay is never current data. */
async function sendOriginal(record: B5PendingWrite, retry: boolean) {
  if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
  if (!b5Commands.isDurablyStored(record.fingerprint, record.commandKey)) {
    throw new Error("浏览器无法保存这次操作的记录，没有提交。请允许浏览器存储后重试。");
  }
  try {
    const value = await sendB5StoredWrite(record.path, record.method, record.body, record.commandKey);
    const input = record.body ? JSON.parse(record.body) : null;
    let matches = false;
    if (record.kind === "threshold") {
      // The real receipt is a complete radar. A broken post-write projection is unknown.
      try {
        const next = normalizeB5Radar(value);
        matches = next.bankrun.yellowPct === input.yellowPct && next.bankrun.redPct === input.redPct && next.bankrun.version === input.expectedVersion + 1;
      } catch { throw new B5OutcomeUnknownError(record.commandKey); }
    } else if (record.kind === "subscription") {
      try {
        const next = normalizeB5Subscription(value);
        matches = next.inApp === input.inApp && next.email === input.email && next.webhook === input.webhook
          && next.webhookUrl === (input.webhook ? input.webhookUrl.trim() : "") && next.version === input.expectedVersion + 1;
      } catch { throw new B5OutcomeUnknownError(record.commandKey); }
    } else if (value && typeof value === "object") {
      const receipt = value as Record<string, unknown>;
      matches = record.kind === "signal" ? receipt.signalNo === record.facts.signalNo
        && receipt.handlingStatus === input.targetStatus && receipt.handlingVersion === input.expectedVersion + 1
        : receipt.deliveryId === record.facts.id && receipt.acknowledged === true;
    }
    if (!matches) throw new B5OutcomeUnknownError(record.commandKey);
    b5Recovery.settleAcknowledged(record);
  } catch (error) {
    if (isBCommandRejection(error, retry)) { if (!retry) b5Commands.forget(record.fingerprint, record.commandKey); }
    else if (error instanceof B5RequestError) throw new B5OutcomeUnknownError(record.commandKey, error.message);
    throw error;
  }
}

/** Read-back is available after expiry too; equal values do not prove the original command succeeded. */
export async function inspectB5Command(record: B5PendingWrite) {
  return record.kind === "subscription" ? { kind: "subscription" as const, data: await fetchB5Subscription() }
    : record.kind === "ack" ? { kind: "ack" as const, data: await fetchB5Inbox() }
      : record.kind === "signal" ? { kind: "signal" as const, data: await fetchB5Signal(record.facts.signalNo) }
        : { kind: "radar" as const, data: await fetchB5Radar() };
}

export function executeB5Command(record: B5PendingWrite, retry = true) {
  return retry ? b5Recovery.replay(record, original => {
    if (!isB5Original(original)) throw new Error("PENDING_REPLAY_BLOCKED");
    return sendOriginal(original, true);
  }) : sendOriginal(record, false);
}
