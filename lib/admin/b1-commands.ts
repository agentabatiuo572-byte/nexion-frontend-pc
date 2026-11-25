"use client";

import type { BLedger } from "./b-client";
import { isAdminAuthFailure, resetAdminSession } from "./auth-session";
import { DOutcomeUnknownError, DRequestError } from "./d-client";
import { formatAdminApiError, guardedFetch } from "./error-messages";
import { isBCommandRejection } from "./b-command-rejection";
import { createPendingMutationStore, createPendingRecovery, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";

import { explicitRejectionCode } from "./explicit-rejection";
import { currentRecoveryActor } from "./abe-recovery-access";
import { fetchDirectCommandReceiptDetails } from "./direct-command-receipt";

export type B1CommandFacts = Pick<BLedger, "reserveUsd" | "valuationReliable" | "redlineBreached" | "coverageRatio" | "redlinePct" | "healthyPct" | "thresholdVersion"> & { generatedAt?: string };
export interface B1PendingWrite extends PendingMutationRecord {
  adminId: string;
  kind: "threshold" | "injection" | "ack";
  body: string;
  form: Record<string, string>;
  facts: B1CommandFacts;
}

// One store for the page's three business mutations. Audited exports are exempt
// from R1 (B4-PD02); proposals keep using withdrawal-config-approval's store.
export const b1Commands = createPendingMutationStore<B1PendingWrite>({
  storageKey: "nexion-admin-b1-commands",
  retainExpiredRecords: true,
  isValidRecord: (record) => {
    if (typeof record.adminId !== "string" || !["threshold", "injection", "ack"].includes(record.kind)
      || typeof record.body !== "string" || !record.form || typeof record.form !== "object"
      || !Object.values(record.form).every(value => typeof value === "string")
      || !record.facts || typeof record.facts.valuationReliable !== "boolean" || typeof record.facts.redlineBreached !== "boolean"
      || ![record.facts.reserveUsd, record.facts.coverageRatio, record.facts.redlinePct, record.facts.healthyPct].every(Number.isFinite)
      || record.facts.thresholdVersion !== null && !Number.isSafeInteger(record.facts.thresholdVersion)) return false;
    try {
      const body = JSON.parse(record.body);
      return body && typeof body.reason === "string" && typeof body.operator === "string"
        && (record.kind === "threshold" ? ["redlinePct", "healthyPct"].some(key => typeof body[key] === "string")
          && [body.redlinePct, body.healthyPct].every(value => value === undefined || typeof value === "string")
          && (body.expectedVersion === undefined || Number.isSafeInteger(body.expectedVersion))
          : record.kind === "injection" ? typeof body.amount === "string" && typeof body.voucherNo === "string" : true);
    } catch { return false; } // Unreadable persisted evidence cannot become a request.
  },
});

export const b1Recovery = createPendingRecovery(b1Commands, {
  capability: record => record.kind === "injection" ? "readback" : "replay",
  explicitRejectionCode,
  canReplay: record => {
    const rights = currentRecoveryActor(record.adminId)?.authorities ?? [];
    if (record.kind === "injection") return false;
    const write = record.kind === "threshold" ? "overview_b1_redline_write" : "overview_b1_write";
    return rights.includes("overview_b1_read") && rights.includes(write);
  },
});

/** Sends the persisted bytes, never a new form draft or a replayed overview. */
async function sendOriginal(record: B1PendingWrite, retry: boolean) {
  if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
  if (!b1Commands.isDurablyStored(record.fingerprint, record.commandKey)) {
    throw new Error("浏览器无法保存这次操作的记录，没有提交。请允许浏览器存储后重试。");
  }
  const path = record.kind === "threshold" ? "/dual-ledger/thresholds"
    : "/b-domain/alerts/coverage-redline/ack";
  try {
    const response = await guardedFetch(`/api/admin/treasury${path}`, {
      method: record.kind === "threshold" ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": record.commandKey },
      body: record.body,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    }).catch(() => { throw new DOutcomeUnknownError(record.commandKey); });
    const result = await response.json().catch(() => null);
    const message = typeof result?.message === "string" ? result.message : undefined;
    if (isAdminAuthFailure(response.status, message)) resetAdminSession();
    if (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown" || !result || typeof result.code !== "number") {
      throw new DOutcomeUnknownError(record.commandKey);
    }
    if (!response.ok || result.code !== 0) {
      // Treasury controllers can return a coded ApiResult with HTTP 200. Keep
      // that business status so isExplicitRejection sees the real verdict.
      throw new DRequestError(formatAdminApiError(message, "B1_WRITE_FAILED"), response.ok ? result.code : response.status, result.code, message);
    }
    const data = result.data;
    const input = JSON.parse(record.body);
    const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
    if (record.kind === "threshold"
      ? !data?.snapshot || !finite(data.snapshot.redlinePct) || !finite(data.snapshot.healthyPct)
        || !Number.isSafeInteger(data.snapshot.thresholdVersion) || data.snapshot.thresholdVersion < 0 || !data.thresholdUpdate
        || ["redlinePct", "healthyPct"].some(key => input[key] !== undefined && data.thresholdUpdate[key] !== data.snapshot[key])
      : data?.alertAck?.alertId !== "coverage-redline" || data.alertAck.acknowledged !== true) {
      throw new DOutcomeUnknownError(record.commandKey);
    }
    b1Recovery.settleAcknowledged(record);
  } catch (error) {
    if (!retry && isBCommandRejection(error, false)) b1Commands.forget(record.fingerprint, record.commandKey);
    throw error;
  }
}

export function executeB1Command(record: B1PendingWrite, retry = true) {
  if (record.kind === "injection") throw new Error("储备注入请到资金储备与应付款核对。");
  return retry ? b1Recovery.replay(record, original => sendOriginal(original, true)) : sendOriginal(record, false);
}

export async function queryB1InjectionReceipt(record: B1PendingWrite) {
  const actor = currentRecoveryActor(record.adminId);
  if (record.kind !== "injection" || !actor?.authorities.includes("finance_d3_read")
    || !b1Commands.list().some(saved => saved.commandKey === record.commandKey && saved.kind === "injection")) {
    throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
  }
  const receipt = await fetchDirectCommandReceiptDetails("D3_RESERVE_INJECTION", record.commandKey, actor.adminId);
  // 查到明确结论才结案：已登记，或后台明确拒绝、核查确认没有执行。
  if (receipt.state === "SUCCEEDED" || receipt.state === "REJECTED" || receipt.state === "NOT_EXECUTED") b1Recovery.settleAcknowledged(record);
  return receipt;
}
