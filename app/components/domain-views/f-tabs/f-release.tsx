"use client";

import { useState, type ReactNode } from "react";
import { Button, ReleaseModal } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";

export const RELEASE_EXPLAIN = "原请求重试已被拒绝。请先核实原操作结果。解除只清本标签页的记录，不发送请求，也不进入操作记录。";

export function FReleaseButton({ label, onRelease, toast }: { label: ReactNode; onRelease: () => Promise<unknown>; toast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>解除原操作记录</Button>
    {open && <ReleaseModal label={label} explain={RELEASE_EXPLAIN} onCancel={() => setOpen(false)} onConfirm={() => {
      setOpen(false);
      void onRelease().then(() => toast("已解除原操作记录"), (error) => toast(displayAdminError(error)));
    }} />}
  </>;
}

/** 查询原操作查到的审批单已经结束：轻提示写状态和后果（和设备域原申请同一组说法）。 */
export function fProposalEndText(status: "approved" | "rejected" | "withdrawn" | "expired") {
  return {
    approved: "原审批单已批准：批准后按原内容执行；结果以重新读取的当前值为准。",
    rejected: "原审批单已驳回：原内容没有生效；需要时重新提交。",
    withdrawn: "原审批单已撤回：原内容没有生效。",
    expired: "原审批单已过期：过期没人处理，原内容没有生效；需要时重新提交。",
  }[status];
}

/** 直接保存的原操作查到可结案的回执、记录解除后的一句（和资金页解除提示同一组说法）。 */
export function fDirectSettledText(status: string) {
  return status === "CONFIRMED_REJECTED" ? "核查确认是后台拒绝，记录已解除；不等于没有执行，要重做请按现在的状态重新发起。"
    : status === "CONFIRMED_NOT_EXECUTED" ? "核查确认没有执行，记录已解除，可以重新发起。"
      : status === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。" : "原操作已执行，记录已解除，不要再做一次。";
}

/** 审批单建过、这次没查到进度。 */
export const F_PROPOSAL_CREATED_LINE = "审批单已建，进度没查到；只查询，不会再建。";
