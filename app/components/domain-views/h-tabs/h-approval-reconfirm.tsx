"use client";

/**
 * 直接保存被后端以「要走审批」拒绝后的再确认（决定「H-改走审批」，H3、H4、H5、H8 共用）。
 * 刚才没有保存；值和理由是刚才提交的那一份，原样锁定，运营再点一次「提交审批」才建审批单（调 error.confirm）。
 */
import type { ReactNode } from "react";
import { Fact, Facts, StatusTag } from "@/app/components/rd";
import type { HApprovalRequired } from "@/lib/admin/h-approval-required";
import type { ConfirmReq } from "./types";

export type HApprovalChange = {
  key: string; label: string; before: string | null; after: string | null;
  beforeUnit?: string; afterUnit?: string;
};
export type HApprovalReconfirmReq = ConfirmReq & { approvalChanges?: HApprovalChange[] };

let opened = 0;

export function hApprovalReconfirm(error: HApprovalRequired, look: {
  action: ReactNode; title?: ReactNode; change?: ReactNode; reason: string;
  /** 谁来批，按后端真实要求写（另一位超级管理员 / 另一位管理员）。 */
  approver: string; rights?: string;
  /** 批准前什么不变，比如「奖励」「这一项」。 */
  holds: string;
  extra?: ReactNode;
  /** 改动写不成一行「从多少到多少」时，原确认框的事实块整块放在这里。 */
  context?: ReactNode;
  completed?: (result: unknown) => Promise<void>;
  /** Exact business-form facts for the visual confirmation handoff. */
  changes?: HApprovalChange[];
}): HApprovalReconfirmReq {
  return {
    formKey: ++opened,
    approvalChanges: look.changes,
    briefKind: "config",
    action: look.action,
    title: look.title,
    effect: <StatusTag tone="progress" filled explain={`${look.approver}批准后才生效，提交人不能批自己的；批准前${look.holds}不变。`}>批准后生效</StatusTag>,
    detail: "直接保存被后端拒绝：这次修改要走审批。确认后用同样的值和理由提交审批。",
    statedBrief: { impact: "刚才没有保存：后端判定这次修改要走审批。", check: "核对改动；值和理由沿用刚才填的，不能再改。" },
    content: <>{look.context}<Facts>
      {look.change && <Fact k="改动">{look.change}</Fact>}
      <Fact k="什么时候生效" tone="warn">{`提交审批，${look.approver}批准后才生效；批准前${look.holds}不变`}</Fact>
      <Fact k="谁来批">{`${look.approver}，不能是提交人`}</Fact>
      <Fact k="需有权限">{look.rights ?? "审批批准权限"}</Fact>
      {look.extra}
    </Facts></>,
    reason: true,
    freezePendingInput: true,
    initialReason: look.reason,
    getPendingReason: () => look.reason,
    okLabel: "提交审批",
    run: async () => { const result = await error.confirm(); await look.completed?.(result); },
  };
}
