"use client";

/**
 * F3 自己开的配置确认框（门槛、比例、自动分组、归零说明、周期和残额、暂停、恢复）。
 * 只多了标题、生效标签、事实块和执行摘要这些样子；提交调用 ctx 上和旧页面相同的函数、相同的参数，
 * 成功、失败、结果未知的提示照 F 域外壳的写法。人工结算仍走外壳的确认框（它带原申请的查询和重试）。
 */
import { type ReactNode } from "react";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue, type EditSpec, type OperatorBriefKind } from "../design-kit";
import type { FViewCtx } from "./types";
import { f3ProposalRecovery, listF3Proposals } from "@/lib/admin/f3-approval";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import { fConfirmRecovery } from "./f-recovery-state";
import { useAdminAuth } from "@/lib/store/admin-auth";

/** 审批人叫法照 02 OP-67：A2 票只有超级管理员有批准权，F3 单项配置也由另一位超级管理员批（还要有这项业务权限和审批批准权限）。 */
export const CONFIG_APPROVER = "另一位超级管理员";
/** 人工结算批准要求有效的超级管理员（TeamFundApproval.validateChecker）。 */
export const SETTLE_APPROVER = "另一位超级管理员";

export type F3Confirm = {
  slot?: string;
  original?: FDomainAttempt;
  draft?: FDomainAttempt;
  initial?: BusinessFormValue;
  /** 记进操作记录的名字，和旧页面一样。 */
  action: string;
  title: ReactNode;
  briefKind: OperatorBriefKind;
  detail: ReactNode;
  effect?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  content?: ReactNode;
  statedBrief?: { impact: string; check: string } | ((value: BusinessFormValue) => { impact: string; check: string });
  amplify?: boolean;
  confirmTone?: "primary" | "danger";
  coverageLead?: ReactNode;
  coverageCheck?: string;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  submit: (reason: string, businessValue?: BusinessFormValue, newValue?: string) => Promise<void>;
  done?: string;
};

export function F3ConfirmHost({ confirm, ctx, onClose }: { confirm: F3Confirm; ctx: FViewCtx; onClose: () => void }) {
  const owner = useAdminAuth(state => state.session?.adminId);
  const saved = () => owner === undefined ? undefined : listF3Proposals(owner).find(row => confirm.original ? row.commandKey === confirm.original.commandKey : row.fingerprint === confirm.slot);
  const original = saved() ?? confirm.original;
  const fields = original?.spec?.command.params.changes as Array<{ key: string; value: string }> | undefined;
  const businessValue = fields ? { period: fields.find(row => row.key === "F.binary.settlePeriod")?.value ?? "",
    residual: fields.find(row => row.key === "F.binary.residualPolicy")?.value ?? "" } : confirm.initial;
  const edit = confirm.edit && original?.spec ? { ...confirm.edit, initialValue: String(original.spec.command.params.value ?? "") } : confirm.edit;
  return (
    <OperationConfirmModal
      briefKind={confirm.briefKind}
      action={confirm.action}
      title={confirm.title}
      detail={confirm.detail}
      effect={confirm.effect}
      facts={confirm.facts}
      content={confirm.content}
      statedBrief={confirm.statedBrief}
      amplifies={!!confirm.amplify}
      coverage={original ? original.f3Snapshot?.coverage : ctx.f3Coverage}
      coverageLead={confirm.coverageLead}
      coverageCheck={confirm.coverageCheck}
      confirmTone={confirm.confirmTone}
      confirmLabel="提交审批"
      edit={edit}
      businessForm={confirm.businessForm}
      initialReason={original?.spec?.reason}
      getPendingReason={() => saved()?.spec?.reason}
      getPendingBusinessValue={() => businessValue}
      getPendingRecovery={() => {
        const record = saved();
        return record && fConfirmRecovery(f3ProposalRecovery, record, async () => {
          const ticket = await ctx.recoverF3(record);
          if (!ticket) return;
          onClose();
        });
      }}
      onClose={onClose}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          const record = saved();
          if (record) {
            await ctx.recoverF3(record, "retry");
            onClose();
            return;
          }
          if (confirm.original) { onClose(); return; }
          const issue = newValue !== undefined && confirm.edit?.validate?.(newValue);
          if (issue) throw new Error(issue);
          await ctx.runFContinuation(confirm.draft?.commandKey, () => confirm.submit(reason, businessValue, newValue));
          if (confirm.done) ctx.toast(confirm.done);
          onClose();
        } catch (error) {
          // 错误交回确认框，由框里显示（没权限时框关掉、外壳提示），不再另弹轻提示，免得同一句同屏两次。
          throw error;
        }
      }}
    />
  );
}
