import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { sendH1StoredPatch, type H1Phases } from "./h-client";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";

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
  ticket?: { id: string; status: A2OperationRow["status"] };
};

export const h1Pending = createPendingMutationStore<H1Pending>({
  storageKey: "nexion-admin-h1-phase-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (row) => Number.isSafeInteger(row.actorId) && row.actorId > 0
    && [row.scope, row.label, row.before, row.after, row.reason, row.operator].every((value) => typeof value === "string" && value.length > 0)
    && ["unknown", "rejected", "approval"].includes(row.state)
    && Array.isArray(row.requests) && row.requests.length > 0 && row.requests.every((request) =>
      ["patch", "proposal"].includes(request.kind) && typeof request.path === "string"
      && typeof request.body === "string" && typeof request.commandKey === "string" && typeof request.acknowledged === "boolean"),
});

export function rememberH1(row: H1Pending) {
  h1Pending.remember(row.fingerprint, row.commandKey, row);
  if (!h1Pending.isDurablyStored(row.fingerprint, row.commandKey)) throw new Error("无法保存原操作记录，尚未继续提交，请检查浏览器存储设置");
}

export function beginH1(input: Omit<H1Pending, keyof PendingMutationRecord | "state">): H1Pending {
  const fingerprint = `${input.actorId}|${input.scope}`;
  if (h1Pending.get(fingerprint)) throw new Error("这个对象有待核对或待审批的提交，请先处理页面上方的原操作");
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
      else rememberH1({ ...current, state: explicit ? "rejected" : "unknown", retryRejected: retry && explicit });
      if (request.kind === "proposal" && isA2OutcomeUncertainError(error)) {
        error.message = "申请提交结果待核对，可能已生成审批单；批准前参数不变。原内容与理由已保留，请查询原操作。";
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
