import {
  A2OutcomeUncertainError,
  createA2CommandKey,
  createA2OperationProposal,
  fetchA2ProposalByKey,
  isA2OutcomeUncertainError,
} from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

export const H7_VOUCHER_ACTIONS = {
  h7_voucher_delete: "删除代金券",
  h7_voucher_revoke_available: "作废未使用的代金券",
} as const;

export type H7VoucherApprovalInput = {
  op: keyof typeof H7_VOUCHER_ACTIONS;
  voucherId: string;
  voucherName: string;
  expectedVersion: number;
};

export type H7VoucherApprovalMode = "submit" | "lookup" | "retry";
type Attempt = PendingMutationRecord & H7VoucherApprovalInput & { reason: string };

export function isH7VoucherApproval(op: string | undefined): op is H7VoucherApprovalInput["op"] {
  return op !== undefined && Object.hasOwn(H7_VOUCHER_ACTIONS, op);
}

const attempts = createPendingMutationStore<Attempt>({
  storageKey: "nexion-admin-h7-voucher-proposals",
  retainExpiredRecords: true,
  isValidRecord: (record) => isH7VoucherApproval(record.op)
    && typeof record.voucherId === "string" && typeof record.voucherName === "string"
    && Number.isSafeInteger(record.expectedVersion) && record.expectedVersion > 0
    && typeof record.reason === "string",
});

export function pendingH7VoucherApprovals(adminId: number) {
  return attempts.list().filter((record) => record.fingerprint === `${adminId}:${record.voucherId}`);
}

export async function submitH7VoucherApproval(
  session: AdminSession,
  input: H7VoucherApprovalInput,
  reason: string,
  mode: H7VoucherApprovalMode = "submit",
) {
  const slot = `${session.adminId}:${input.voucherId}`;
  const previous = pendingH7VoucherApprovals(session.adminId).find((record) => record.fingerprint === slot);
  if (mode === "lookup" && !previous) return null;
  if (mode === "retry" && !previous) throw new Error("原审批命令已处理，请刷新后核对结果。");
  const original = previous ?? { ...input, reason };
  const key = previous?.commandKey ?? createA2CommandKey(original.op);
  if (!previous) {
    attempts.remember(slot, key, original);
    if (!attempts.isDurablyStored(slot, key)) {
      attempts.forget(slot, key);
      throw new Error("浏览器无法保存本次审批命令号，请允许会话存储后重试。");
    }
  }

  let ticket;
  if (previous) {
    try {
      ticket = await fetchA2ProposalByKey(key);
    } catch {
      throw new A2OutcomeUncertainError("暂时无法查询原审批单，请稍后再查。", key);
    }
    if (!ticket && mode === "lookup") return null;
    if (!ticket && previous.expiresAt <= Date.now()) {
      throw new A2OutcomeUncertainError("原命令已过期，暂未查到审批单。请继续核对原操作。", key);
    }
  }
  try {
    ticket ??= await createA2OperationProposal({
      action: H7_VOUCHER_ACTIONS[original.op],
      obj: original.voucherId,
      beforeValue: "—",
      afterValue: "—",
      operator: session.operator || session.username,
      operatorRole: roleLabel(session.role),
      type: "param",
      amplifies: false,
      sos: false,
      roleGate: "门槛者",
      reason: original.reason,
      sourceDomain: "H7",
      command: { domain: "H", op: original.op, params: {
        voucherId: original.voucherId, expectedVersion: original.expectedVersion,
      } },
      target: { domain: "H", type: "voucher", id: original.voucherId },
    }, key, true);
  } catch (error) {
    if (error instanceof Error && "backendMessage" in error
        && ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(String(error.backendMessage))) {
      throw new A2OutcomeUncertainError("原审批命令仍待确认，请查询原操作。", key);
    }
    if (!isA2OutcomeUncertainError(error)
        && (!previous || !(error instanceof Error && "status" in error && [401, 403, 404].includes(Number(error.status))))) {
      attempts.forget(slot, key);
    }
    throw error;
  }
  if (!ticket.mine || ticket.obj !== original.voucherId || ticket.operationCode !== original.op) {
    throw new A2OutcomeUncertainError("审批回执与原操作不符，请到操作记录核对。", key);
  }
  attempts.forget(slot, key);
  return ticket;
}
