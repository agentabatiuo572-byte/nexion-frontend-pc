import { isDeterministicRejection, outcomeStaysUnknown } from "./outcome-classification.ts";
import { guardedFetch } from "./error-messages.ts";

type ApiResult<T> = { code?: number; message?: string; data?: T };
type CommandOutcome = "success" | "deterministic-rejection" | "outcome-unknown";
type RequestOutcome = { sandbox: G2AcceptanceSandbox | null; outcome: CommandOutcome };

export type G2AcceptanceSandboxOrder = {
  exchangeNo: string;
  status: "QUEUED" | "COMPLETED" | "SKIPPED";
  reasonCode: string;
  reason: string;
  amountUsdt: number;
  sandboxLedgerEntries: number;
};

export type G2AcceptanceSandbox = {
  source: "mock";
  sourceEnvironment: "SANDBOX";
  evidenceComplete: true;
  batch: { batchNo: string; status: string; replayed: boolean } | null;
  orders: G2AcceptanceSandboxOrder[];
  ledgerSummary: {
    completedLedgerEntries: number;
    skippedLedgerEntries: number;
    productionWalletTouched: false;
    productionLedgerTouched: false;
  };
  batchResult?: {
    completed: { exchangeNo: string; status: string; reason: string }[];
    skipped: { exchangeNo: string; status: string; reason: string }[];
    replayed: boolean;
  } | null;
};

let requestSeq = 0;
let replayCommandKey: string | null = null;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function fail(): never {
  throw new Error("G2_ACCEPTANCE_SANDBOX_RESPONSE_INVALID");
}

/**
 * G2 acceptance sandbox 也必须服从后台唯一的高敏写结果归类:
 * 只有服务端明确拒绝才能结束该命令号；断网、5xx 和无法确认的 200 都可能已落库。
 */
export function classifyCommandOutcome(status: number, apiCode?: number | null): CommandOutcome {
  if (status >= 200 && status < 300 && apiCode === 0) return "success";
  if (isDeterministicRejection(status, apiCode)) return "deterministic-rejection";
  if (outcomeStaysUnknown(status, apiCode)) return "outcome-unknown";
  return "outcome-unknown";
}

export function assertG2AcceptanceSandboxContract(value: unknown): G2AcceptanceSandbox {
  if (!record(value) || value.source !== "mock" || value.sourceEnvironment !== "SANDBOX" || value.evidenceComplete !== true
    || !Array.isArray(value.orders) || !record(value.ledgerSummary)
    || value.ledgerSummary.productionWalletTouched !== false || value.ledgerSummary.productionLedgerTouched !== false
    || number(value.ledgerSummary.completedLedgerEntries) === null || number(value.ledgerSummary.skippedLedgerEntries) === null) fail();
  const batch = value.batch === null ? null : record(value.batch) && text(value.batch.batchNo) && text(value.batch.status)
    && typeof value.batch.replayed === "boolean"
    ? { batchNo: text(value.batch.batchNo)!, status: text(value.batch.status)!, replayed: value.batch.replayed } : fail();
  const orders = value.orders.map((row): G2AcceptanceSandboxOrder => {
    if (!record(row) || !text(row.exchangeNo) || !["QUEUED", "COMPLETED", "SKIPPED"].includes(String(row.status))
      || stringValue(row.reason) === null || stringValue(row.reasonCode) === null || number(row.amountUsdt) === null || number(row.sandboxLedgerEntries) === null) fail();
    return { exchangeNo: text(row.exchangeNo)!, status: row.status as G2AcceptanceSandboxOrder["status"],
      reasonCode: stringValue(row.reasonCode)!, reason: stringValue(row.reason)!, amountUsdt: number(row.amountUsdt)!, sandboxLedgerEntries: number(row.sandboxLedgerEntries)! };
  });
  const rawResult = value.batchResult;
  const batchResult = rawResult == null ? null : record(rawResult) && Array.isArray(rawResult.completed) && Array.isArray(rawResult.skipped)
    && typeof rawResult.replayed === "boolean" ? {
      completed: rawResult.completed.map((row) => record(row) && text(row.exchangeNo) && text(row.status) && stringValue(row.reason) !== null
        ? { exchangeNo: text(row.exchangeNo)!, status: text(row.status)!, reason: stringValue(row.reason)! } : fail()),
      skipped: rawResult.skipped.map((row) => record(row) && text(row.exchangeNo) && text(row.status) && stringValue(row.reason) !== null
        ? { exchangeNo: text(row.exchangeNo)!, status: text(row.status)!, reason: stringValue(row.reason)! } : fail()),
      replayed: rawResult.replayed,
    } : fail();
  return { source: "mock", sourceEnvironment: "SANDBOX", evidenceComplete: true, batch, orders,
    ledgerSummary: { completedLedgerEntries: number(value.ledgerSummary.completedLedgerEntries)!, skippedLedgerEntries: number(value.ledgerSummary.skippedLedgerEntries)!,
      productionWalletTouched: false, productionLedgerTouched: false }, batchResult };
}

async function request(path: string, init?: RequestInit): Promise<RequestOutcome> {
  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/market${path}`, { ...init, cache: "no-store" });
  } catch {
    return { sandbox: null, outcome: "outcome-unknown" };
  }
  const result = await response.json().catch(() => null) as ApiResult<unknown> | null;
  const outcome = classifyCommandOutcome(response.status, result?.code);
  if (outcome !== "success") return { sandbox: null, outcome };
  try {
    return { sandbox: assertG2AcceptanceSandboxContract(result!.data), outcome };
  } catch {
    return { sandbox: null, outcome: "outcome-unknown" };
  }
}

function commandKey() {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `nexion-g2-acceptance-sandbox-${Date.now()}-${requestSeq}`;
}

export async function fetchG2AcceptanceSandbox() {
  return (await request("/exchange/acceptance")).sandbox;
}

export async function generateG2AcceptanceSandboxBatch() {
  replayCommandKey = null;
  return (await request("/exchange/acceptance/batches", { method: "POST" })).sandbox;
}

export async function processG2AcceptanceSandboxBatch(batchNo: string) {
  replayCommandKey ??= commandKey();
  const result = await request(`/exchange/acceptance/batches/${encodeURIComponent(batchNo)}/process`, {
    method: "POST", headers: { "Idempotency-Key": replayCommandKey },
  });
  if (result.outcome === "deterministic-rejection") {
    replayCommandKey = null;
  }
  return result.sandbox;
}

export async function cleanupG2AcceptanceSandboxBatch(batchNo: string) {
  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/market/exchange/acceptance/batches/${encodeURIComponent(batchNo)}`, { method: "DELETE", cache: "no-store" });
  } catch {
    return false;
  }
  replayCommandKey = null;
  return response.ok;
}
