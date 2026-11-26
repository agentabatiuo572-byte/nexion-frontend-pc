"use client";

/**
 * G 域五页共用的「原操作」提醒：结果未知、待审批、过期的原操作逐条列出。
 * 每条写改的是什么、从多少到多少、什么时候提交的、现在什么状态，按钮是「查询原操作」「按原操作重试」。
 * 只负责排版：行由页面用本机保存的原记录拼好传进来，按钮调用页面已有的查询和重试，不在这里发请求。
 * 概览读取中、读取失败也要显示：页面在三个分支里都放它。
 */
import type { ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass } from "lucide-react";
import { Explain, Notice, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import type { PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { replayRejectionText } from "@/lib/admin/retry-rejected";
import { TechInfo } from "../recovery-panel";
import { useVerifiedRelease, VerifiedReleaseButton } from "../verified-release";

export type GRecoveryRow = {
  key: string;
  /** 改的是什么：参数名或动作名。 */
  name: string;
  /** 从多少到多少，写人话（「0% → 5%」），不写原始请求。 */
  change: ReactNode;
  /** 本机保存原请求的时间（毫秒）。 */
  submittedAt?: number;
  tag: ReactNode;
  ticket?: string;
  actions: ReactNode;
  state?: string;
};

export function GReplayRejectionNote({ record }: { record: PendingMutationRecord }) {
  return <span className="rd-note"> · {replayRejectionText(record)} <TechInfo commandKey={record.commandKey} /></span>;
}

export function GRejectedRelease({ record, name, target, disabled, toast, getSnapshot, release }: {
  record: PendingMutationRecord;
  name: ReactNode;
  target: ReactNode;
  disabled: boolean;
  toast: (message: string) => void;
  getSnapshot: () => string | undefined;
  release: () => boolean;
}) {
  const verified = useVerifiedRelease(toast);
  return <>
    <VerifiedReleaseButton disabled={disabled} onClick={() => verified.ask({
      operation: name, target, targetLabel: "改动", createdAt: record.createdAt, getSnapshot, release,
    })} />
    {verified.dialog}
  </>;
}

/** 结果未知：直接生效的写操作和走审批的申请各一句。 */
export function unknownTag(kind: "direct" | "approval", approvalHint = "可以查询原操作；24 小时内也可以按原操作重试，不会建第二张。") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可以用这一行的按钮核对；24 小时内也可以按原操作重试，不会重复执行。"
    : `提交时没收到确定结果，可能已经建了审批单。${approvalHint}`}>结果未知</StatusTag>;
}

export function pendingTag(note = "批准前参数不变；这一项被审批锁住，调高调低都改不了。") {
  return <StatusTag tone="warn" icon={Clock3} explain={`等另一位超级管理员在「操作记录与审批」批准。${note}`}>待审批</StatusTag>;
}

export function expiredTag(kind: "direct" | "approval") {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "direct"
    ? "已超过 24 小时，不能再重试，只能查询。查到的是现在的值，说明不了原操作成没成，记录继续保留。"
    : "已超过 24 小时，不能再重试，只能查询原审批单。查不到也说明不了没提交。"}>已过期</StatusTag>;
}

export function resolvedTag(status: "approved" | "rejected" | "withdrawn" | "expired") {
  // 审批单本身过期叫「审批单已过期」，和本地 24 小时重试到期的「已过期」分开。
  const label = { approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "审批单已过期" }[status];
  return <StatusTag tone="done" explain="原审批单已有结论。点「查询原操作」，读到现在的值后这条记录会清掉。">{label}</StatusTag>;
}

export function GRecoveryNotice({ title, explain, lead, rows, label = "原操作" }: {
  title: ReactNode;
  explain?: ReactNode;
  lead?: ReactNode;
  rows: GRecoveryRow[];
  label?: string;
}) {
  if (rows.length === 0) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  return (
    <Notice tone="warn" title={<>{title}{explain && <Explain label="原操作怎么处理" content={explain} />}</>}>
      {lead && <p>{lead}</p>}
      <ul className="grec" aria-label={label}>
        {rows.map((row) => (
          <li key={row.key} data-recovery-state={row.state}>
            <span className="grec-name">{row.name}</span>
            <span className="grec-change">{row.change}</span>
            <span className="grec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="grec-state">
              {row.tag}
              {row.ticket && <span className="grec-ticket">审批单 <span data-mono>{row.ticket}</span></span>}
            </span>
            <span className="grec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {timed && <p className="grec-zone">提交时间为{businessZone().label}</p>}
    </Notice>
  );
}
