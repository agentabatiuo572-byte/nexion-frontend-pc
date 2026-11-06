"use client";

import { fetchG4GenesisOverview, type G4Overview } from "@/lib/admin/g4-client";
import { configApprovalOriginalInput, pendingConfigApproval, submitConfigApproval } from "@/lib/admin/withdrawal-config-approval";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { OperationConfirmModal } from "../design-kit";

export function G4FirstDividendConfirm({ session, epoch, expectedRevision, readActive, onClose, onDone }: {
  session: AdminSession;
  epoch: number;
  expectedRevision: string;
  readActive: typeof fetchG4GenesisOverview;
  onClose: () => void;
  onDone: (active: G4Overview, acknowledgement: string) => void;
}) {
  const pending = pendingConfigApproval("G4", session.adminId);
  const original = pending ? configApprovalOriginalInput("G4", pending.input) : undefined;

  function requireCurrentMaker() {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch
      || !auth.session.authorities.includes("finprod_g4_dividend_rate_write")) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
  }

  async function submit(mode: boolean | "retry-original", reason = "", value = "", decisionRef = "") {
    requireCurrentMaker();
    const result = await submitConfigApproval("G4", session, mode === false ? {
      paramKey: "dividend", value: value.trim(), decisionRef: decisionRef.trim(), expectedRevision,
    } : null, reason, readActive, mode);
    requireCurrentMaker();
    if (!result) return false;
    onDone(result.active, result.ticket.status === "pending"
      ? `审批单 ${result.ticket.id} · 等待另一位有权超管批准，尚未生效`
      : result.acknowledgement);
    return true;
  }

  return <OperationConfirmModal
    action="首次配置每日收益比例"
    detail="当前每日收益比例为 0%。"
    briefKind="config"
    reasonMin={8}
    reasonMax={200}
    edit={{ kind: "number", label: "目标每日收益比例（%）", current: "0", unit: "%",
      min: 0.000001, max: 5, step: 0.000001, initialValue: original?.[0].value, submitEditValue: true }}
    businessForm={{ kind: "multi-field", fields: [{
      key: "decisionRef", label: "产品或财务决策编号", inputKind: "text",
      current: original?.[0].decisionRef ?? "", minLength: 3, maxLength: 128, required: true,
    }] }}
    getPendingReason={() => {
      const record = pendingConfigApproval("G4", session.adminId);
      return record ? configApprovalOriginalInput("G4", record.input)[1] : undefined;
    }}
    inlineApproval={{
      pending: !!pending,
      expired: !!pending && Date.now() >= pending.expiresAt,
      resolve: () => ({
        heading: "首次配置需另一位有权超管批准",
        completionCopy: "待审期间每日收益比例仍为 0%。提交和批准时均检查兑付覆盖率。",
      }),
      recover: () => submit(true),
      retry: () => submit("retry-original").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, value, businessValue) => submit(false, reason, value, businessValue?.decisionRef).then(() => undefined)}
  />;
}
