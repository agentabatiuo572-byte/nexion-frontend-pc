import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { displayAdminError } from "./error-messages";
import { sendH1StoredPatch, type H1Phases } from "./h-client";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { discoverECommand, eCommandCanConcludeRejected, eCommandResult, eCommandSettled, investigateECommand, type ECommandEvidence, type ECommandInvestigation, type ECommandLocator } from "./e-command-investigation";

export type H1Request = {
  kind: "patch" | "proposal";
  path: string;
  method: "PATCH" | "POST";
  body: string;
  commandKey: string;
  label: string;
  acknowledged: boolean;
};

export type H1Pending = PendingMutationRecord & {
  actorId: number;
  operator: string;
  scope: string;
  label: string;
  before: string;
  after: string;
  reason: string;
  requests: H1Request[];
  state: "unknown" | "rejected" | "approval";
  retryRejected?: boolean;
  rejectionReason?: string;
  ticket?: { id: string; status: A2OperationRow["status"] };
};

export const h1Pending = createPendingMutationStore<H1Pending>({
  storageKey: "nexion-admin-h1-phase-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (row) => Number.isSafeInteger(row.actorId) && row.actorId > 0
    && [row.scope, row.label, row.before, row.after, row.reason, row.operator].every((value) => typeof value === "string" && value.length > 0)
    && ["unknown", "rejected", "approval"].includes(row.state)
    && (row.rejectionReason === undefined || typeof row.rejectionReason === "string")
    && Array.isArray(row.requests) && row.requests.length > 0 && row.requests.every((request) =>
      ["patch", "proposal"].includes(request.kind) && typeof request.path === "string"
      && typeof request.body === "string" && typeof request.commandKey === "string" && typeof request.acknowledged === "boolean"),
});

export function rememberH1(row: H1Pending) {
  h1Pending.remember(row.fingerprint, row.commandKey, row);
  if (!h1Pending.isDurablyStored(row.fingerprint, row.commandKey)) throw new Error("浏览器存不下这次的记录，没有提交；请检查浏览器的存储设置");
}

export function beginH1(input: Omit<H1Pending, keyof PendingMutationRecord | "state">): H1Pending {
  const fingerprint = `${input.actorId}|${input.scope}`;
  if (h1Pending.get(fingerprint)) throw new Error("这项有一次提交结果未知或在等审批，先到页面上方处理");
  const commandKey = input.requests[0].commandKey;
  const now = Date.now();
  const row: H1Pending = { ...input, fingerprint, commandKey, createdAt: now, expiresAt: now + 86400000, state: "unknown" };
  rememberH1(row);
  return row;
}

export function h1Request(kind: H1Request["kind"], path: string, body: object, label: string): H1Request {
  return { kind, path, method: kind === "patch" ? "PATCH" : "POST", body: JSON.stringify(body),
    commandKey: createA2CommandKey("h1-phase"), label, acknowledged: false };
}

/** Each acknowledged calibration step is persisted before the next request. Recovery skips it. */
export async function executeH1(row: H1Pending, onReceipt: (receipt: Partial<H1Phases> & Pick<H1Phases, "rhythm">) => void, retry = false): Promise<H1Pending | null> {
  if (isRetryExpired(row)) throw new Error(RETRY_EXPIRED_TEXT);
  let current = row;
  for (let index = 0; index < current.requests.length; index += 1) {
    const request = current.requests[index];
    if (request.acknowledged) continue;
    rememberH1(current);
    try {
      if (request.kind === "proposal") {
        const input = JSON.parse(request.body) as Parameters<typeof createA2OperationProposal>[0];
        const ticket = await createA2OperationProposal(input, request.commandKey, true);
        current = { ...current, state: "approval", ticket: { id: ticket.id, status: ticket.status },
          requests: current.requests.map((item, at) => at === index ? { ...item, acknowledged: true } : item) };
        rememberH1(current);
        return current;
      }
      onReceipt(await sendH1StoredPatch(request.path, request.body, request.commandKey));
      current = { ...current, requests: current.requests.map((item, at) => at === index ? { ...item, acknowledged: true } : item) };
      rememberH1(current);
    } catch (error) {
      const explicit = isExplicitRejection(error);
      if (!retry && explicit && !current.requests.some((item) => item.acknowledged)) h1Pending.forget(current.fingerprint, current.commandKey);
      else rememberH1({ ...current, state: explicit ? "rejected" : "unknown", retryRejected: retry && explicit,
        rejectionReason: explicit ? displayAdminError(error) : undefined });
      if (request.kind === "proposal" && isA2OutcomeUncertainError(error)) {
        error.message = "提交结果未知，可能已经建了审批单，批准前参数不变。原内容和理由已保留，请查询原结果。";
      }
      if (error instanceof Error && request.kind === "patch") {
        if (!explicit) error.message = `${request.label}结果未知。原内容和理由已保留，可以按原请求重试，不会重复执行。`;
        else if (retry) error.message = `${request.label}重试被拒绝。${error.message}`;
        const saved = current.requests.filter((item) => item.acknowledged).map((item) => `${item.label}已保存`).join("，");
        if (saved) error.message = explicit && !retry ? `${saved}；${request.label}未保存。${error.message}` : `${saved}；${error.message}`;
      }
      throw error;
    }
  }
  h1Pending.forget(current.fingerprint, current.commandKey);
  return null;
}

export async function lookupH1(row: H1Pending) {
  const request = row.requests.find((item) => item.kind === "proposal");
  if (!request) return null;
  const ticket = await fetchA2ProposalByKey(request.commandKey, true);
  if (!ticket) return null;
  if (ticket.status === "pending") rememberH1({ ...row, state: "approval", ticket: { id: ticket.id, status: ticket.status } });
  else h1Pending.forget(row.fingerprint, row.commandKey);
  return ticket;
}

/** The proxy encodes each decoded route segment; local UI scopes are not backend command scopes. */
export function h1CommandLocator(row: H1Pending, request: H1Request): ECommandLocator {
  if (request.kind !== "patch" || request.method !== "PATCH") throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const path = request.path.split("/").map(part => encodeURIComponent(decodeURIComponent(part))).join("/");
  return { commandKey: request.commandKey, originalMethod: "PATCH", originalPath: `/api/admin/growth${path}`, originalAdminId: String(row.actorId) };
}

/** H1 has success audit evidence, but no localConfiguration nonexecution proof. */
export function h1ClosureConclusions(receipt: ECommandInvestigation | null | undefined, expired: boolean): ECommandEvidence["conclusion"][] {
  if (!receipt || !/^GROWTH:H1:(?:RHYTHM_PARAM_UPDATE|PHASE_DIAL_UPDATE|PHASE_MONTH_DIAL_UPDATE|PHASE_CONTROL_UPDATE|PHASE_OVERRIDE_UPDATE):.+$/.test(receipt.scope)
    || !expired && receipt.originalStatus !== "UNKNOWN") return [];
  if (receipt.originalStatus === "UNKNOWN") return ["SUCCEEDED", "STILL_UNKNOWN"];
  if (eCommandCanConcludeRejected(receipt)) return ["REJECTED"];
  if (receipt.originalStatus === "FAILED" || receipt.originalStatus === "SUCCEEDED" && (receipt.businessCode === 0 || receipt.businessCode === null || receipt.businessState === undefined)) return ["SUCCEEDED"];
  return [];
}

export async function investigateH1Request(row: H1Pending, request: H1Request, evidence: ECommandEvidence) {
  const locator = h1CommandLocator(row, request);
  const receipt = await discoverECommand(locator);
  if (!h1ClosureConclusions(receipt, isRetryExpired(row)).includes(evidence.conclusion)) throw new Error("INVESTIGATION_KNOWN_RESULT_CONFLICT");
  return investigateECommand(row, locator, evidence, "growth_h1_read");
}

/** Query each original step; success never authorizes sending the next unconfirmed step. */
export async function lookupH1Direct(row: H1Pending) {
  let current = row;
  const outcomes: Array<{ request: H1Request; receipt: ECommandInvestigation | null }> = [];
  for (let index = 0; index < current.requests.length; index += 1) {
    const request = current.requests[index];
    if (request.acknowledged) continue;
    const receipt = await discoverECommand(h1CommandLocator(current, request));
    outcomes.push({ request, receipt });
    if (eCommandResult(receipt) === "SUCCEEDED") {
      current = { ...current, requests: current.requests.map((item, at) => at === index ? { ...item, acknowledged: true } : item) };
      rememberH1(current);
    }
  }
  // A governed refusal is settled, not an acknowledged successful step. Do not mislabel it.
  const settled = current.requests.every(request => request.acknowledged
    || outcomes.some(outcome => outcome.request.commandKey === request.commandKey && eCommandSettled(outcome.receipt)));
  if (settled) h1Pending.forget(current.fingerprint, current.commandKey);
  return { settled, outcomes };
}
