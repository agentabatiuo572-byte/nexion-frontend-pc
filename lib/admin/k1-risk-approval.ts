import { A2OutcomeUncertainError, type A2OperationRow, type createA2OperationProposal } from "./a2-client";

export type K1ApprovalRequest = Parameters<typeof createA2OperationProposal>[0];
export type K1ApprovalState = {
  request: K1ApprovalRequest;
  /** A successful POST is historical evidence, never the current ticket status. */
  acknowledged?: boolean;
  pendingTicketId?: string;
  /** Readable net amount/source only, never the server's trusted approval snapshot. */
  observedEntry?: { amount: string | number; asset: string; sourceType: string; sourceRef: string; bucket: string };
  /** The server's ticket summary, retained even if a later status read fails. */
  ticketBefore?: string;
};

export { parseK1ReleaseTicketBefore } from "./k1-release-ticket";

export function k1ReleaseParamProposal(key: string, value: string, expectedVersion: number, reason: string, operator: string, operatorRole: string): K1ApprovalRequest {
  return {
    action: "放宽收益审核规则", obj: key, beforeValue: "", afterValue: "", operator, operatorRole,
    type: "fund", amplifies: true, sos: false, roleGate: "超管", reason, sourceDomain: "K1",
    command: { domain: "K", op: "k1_release_param", params: { values: { key, value, expectedVersion } } },
    target: { domain: "K", type: "release_param", id: key },
  };
}

export function k1EarningsReleaseProposal(entryNo: string, reason: string, operator: string, operatorRole: string): K1ApprovalRequest {
  return {
    action: "人工放行收益", obj: entryNo, beforeValue: "", afterValue: "", operator, operatorRole,
    type: "fund", amplifies: true, sos: false, roleGate: "超管", reason, sourceDomain: "K1",
    command: { domain: "K", op: "k1_earnings_release", params: { values: { entryNo } } },
    target: { domain: "K", type: "earnings_release", id: entryNo },
  };
}

/** The session journal is the unknown-input boundary. Originals are never rebuilt for replay. */
export function isK1ApprovalState(value: unknown, original: { kind?: string; target?: string; value?: string; version?: number; reason?: string; operator?: string }): value is K1ApprovalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<K1ApprovalState>;
  const request = state.request;
  if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.operatorRole !== "string"
    || state.acknowledged !== undefined && typeof state.acknowledged !== "boolean"
    || state.ticketBefore !== undefined && (original.kind !== "entry" || typeof state.ticketBefore !== "string" || state.acknowledged !== true)
    || state.pendingTicketId !== undefined && (typeof state.pendingTicketId !== "string" || !state.pendingTicketId || state.acknowledged !== true)) return false;
  if (original.kind === "entry") {
    const observed = state.observedEntry;
    if (typeof original.target !== "string" || !original.target || original.target !== original.target.trim() || original.target.length > 64
      || !observed || typeof observed !== "object" || Array.isArray(observed)
      || !(typeof observed.amount === "string"
        ? /^(?=[\d.]*[1-9])(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(observed.amount)
        : Number.isFinite(observed.amount) && observed.amount > 0)
      || ![observed.asset, observed.sourceType, observed.sourceRef].every(field => typeof field === "string" && field.length > 0)
      || !["pending_review", "bonus_locked"].includes(observed.bucket)) return false;
    return JSON.stringify(request) === JSON.stringify(k1EarningsReleaseProposal(original.target, original.reason!, original.operator!, request.operatorRole));
  }
  if (original.kind !== "release-param" || !["duplicateAccountPendingFrom", "duplicateAccountFreezeFrom"].includes(original.target!)
    || typeof original.value !== "string" || !Number.isSafeInteger(original.version) || original.version! < 0) return false;
  return JSON.stringify(request) === JSON.stringify(k1ReleaseParamProposal(original.target!, original.value, original.version!, original.reason!, original.operator!, request.operatorRole));
}

export function checkK1ApprovalTicket(request: K1ApprovalRequest, ticket: A2OperationRow, commandKey: string) {
  if (!ticket.mine || ticket.operationCode !== request.command.op || ticket.obj !== request.obj || ticket.action !== request.action
    || ticket.rawStatus !== ticket.status || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(ticket.status)
    || ticket.type !== "fund" || !ticket.amplifies || ticket.sos || ticket.before === "—" || ticket.after === "—") {
    throw new A2OutcomeUncertainError("K1_PROPOSAL_RECEIPT_INVALID", commandKey);
  }
}
