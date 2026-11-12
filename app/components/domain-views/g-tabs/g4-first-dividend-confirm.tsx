"use client";

import { fetchG4GenesisOverview, type G4Overview } from "@/lib/admin/g4-client";
import { configApprovalOriginalInput, pendingConfigApproval, submitConfigApproval } from "@/lib/admin/withdrawal-config-approval";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { Fact, Facts, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";

export function G4FirstDividendConfirm({ session, epoch, expectedRevision, readActive, canStartNew, onError, onClose, onDone }: {
  session: AdminSession;
  epoch: number;
  expectedRevision: string;
  readActive: typeof fetchG4GenesisOverview;
  canStartNew: () => boolean;
  onError: (error: unknown) => void;
  onClose: () => void;
  onDone: (active: G4Overview, acknowledgement: string) => void;
}) {
  const pending = pendingConfigApproval("G4", session.adminId);
  const original = pending ? configApprovalOriginalInput("G4", pending.input) : undefined;

  function requireCurrentMaker(write: boolean) {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch
      || write && !auth.session.authorities.includes("finprod_g4_dividend_rate_write")) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
  }

  async function submit(mode: boolean | "retry-original", reason = "", value = "", decisionRef = "") {
    requireCurrentMaker(mode !== true);
    if (mode === false && !pendingConfigApproval("G4", session.adminId) && !canStartNew()) {
      onClose();
      throw new Error("当前创世参数暂不能修改，请重新读取当前状态后操作。");
    }
    const recovering = !!pendingConfigApproval("G4", session.adminId);
    let result;
    try {
      result = await submitConfigApproval("G4", session, mode === false ? {
        paramKey: "dividend", value: value.trim(), decisionRef: decisionRef.trim(), expectedRevision,
      } : null, reason, readActive, mode);
    } catch (error) {
      if (recovering && isExplicitRejection(error) && !pendingConfigApproval("G4", session.adminId)) { onError(error); onClose(); }
      throw error;
    }
    requireCurrentMaker(false);
    if (!result) return false;
    onDone(result.active, result.ticket.status === "pending"
      ? `审批单 ${result.ticket.id} · 等待另一位有权超管批准，尚未生效`
      : result.acknowledgement);
    return true;
  }

  return <OperationConfirmModal
    action="首次配置每日收益比例"
    title={pending ? "每日收益比例首次配置的原申请" : "首次配置每日收益比例"}
    effect={<StatusTag tone="progress" filled explain="首次把 0% 改成正数要另一位有日分红权限和审批批准权的在职超级管理员批准；批准前仍是 0%，不发分红。">批准后生效</StatusTag>}
    facts={<Facts>
      <Fact k="现在">0%，未配置，不发分红；批准前不变</Fact>
      <Fact k="谁来批">另一位在职超级管理员，要有审批批准权和每日收益比例权限；你自己不能批</Fact>
      <Fact k="批准后">后端再核对一次比例版本和兑付覆盖率，通过后写入新比例；之后新建的分红批次按它算</Fact>
      <Fact k="付不付钱">批准本身不付钱；之后每天发分红时才付 USDT</Fact>
    </Facts>}
    detail="当前每日收益比例为 0%。"
    briefKind="config"
    reasonMin={8}
    reasonMax={200}
    edit={{ kind: "number", label: "目标每日收益比例（%）", current: "0", unit: "%",
      min: 0.000001, max: 5, step: 0.000001, initialValue: original?.[0].value, submitEditValue: true, hint: "0.000001–5，单位 %/日" }}
    businessForm={{ kind: "multi-field", fields: [{
      key: "decisionRef", label: "产品或财务决策编号", inputKind: "text",
      current: original?.[0].decisionRef ?? "", minLength: 3, maxLength: 128, required: true, help: "3–128 字，写产品或财务决议的编号",
    }] }}
    getPendingReason={() => {
      const record = pendingConfigApproval("G4", session.adminId);
      return record ? configApprovalOriginalInput("G4", record.input)[1] : undefined;
    }}
    inlineApproval={{
      pending: !!pending,
      expired: !!pending && (Date.now() < pending.createdAt || Date.now() >= pending.expiresAt),
      resolve: () => ({
        heading: "首次配置需另一位有权超管批准",
        completionCopy: "待审期间每日收益比例仍为 0%。提交审批时和批准时后端各检查一次比例版本和兑付覆盖率。",
      }),
      recover: () => submit(true),
      retry: () => submit("retry-original").then(() => undefined),
    }}
    onClose={onClose}
    onConfirm={(reason, value, businessValue) => submit(false, reason, value, businessValue?.decisionRef).then(() => undefined)}
  />;
}
