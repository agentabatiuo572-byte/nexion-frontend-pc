"use client";

/**
 * F3 自己开的配置确认框（门槛、比例、自动分组、归零说明、周期和残额、暂停、恢复）。
 * 只多了标题、生效标签、事实块和执行摘要这些样子；提交调用 ctx 上和旧页面相同的函数、相同的参数，
 * 成功、失败、结果未知的提示照 F 域外壳的写法。人工结算仍走外壳的确认框（它带原申请的查询和重试）。
 */
import type { ReactNode } from "react";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue, type EditSpec, type OperatorBriefKind } from "../design-kit";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { operationConfirmErrorMessage } from "@/lib/admin/operation-confirm-error";
import type { FViewCtx } from "./types";

/** 审批人叫法照「全站-审批人叫法」：F3 单项配置批准要另一位有这项业务权限和审批批准权限的管理员，不要求超级管理员。 */
export const CONFIG_APPROVER = "另一位管理员";
/** 人工结算批准要求有效的超级管理员（TeamFundApproval.validateChecker）。 */
export const SETTLE_APPROVER = "另一位超级管理员";

export type F3Confirm = {
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
      coverage={ctx.f3Coverage}
      coverageLead={confirm.coverageLead}
      coverageCheck={confirm.coverageCheck}
      confirmTone={confirm.confirmTone}
      confirmLabel="提交审批"
      edit={confirm.edit}
      businessForm={confirm.businessForm}
      onClose={onClose}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          await confirm.submit(reason, businessValue, newValue);
          if (confirm.done) ctx.toast(confirm.done);
          onClose();
        } catch (error) {
          // 和 F 域外壳一致：结果未知不算失败，审批单可能已经建了，冠以失败会让人换个办法重做。
          const message = error instanceof Error && error.name.endsWith("OutcomeUncertainError") ? operationConfirmErrorMessage(error) : displayAdminError(error);
          ctx.toast(isA2OutcomeUncertainError(error) ? message : "提交失败 · " + message);
          // 确认框自己管重试和错误样子，要把错误交回去。
          throw error;
        }
      }}
    />
  );
}
