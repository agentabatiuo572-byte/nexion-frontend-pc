"use client";

/**
 * G 域五页共用的「原操作」提醒：结果未知、待审批、过期的原操作逐条列出。
 * 每条写改的是什么、从多少到多少、什么时候提交的、现在什么状态，按钮是「查询原结果」「按原请求重试」。
 * 只负责排版：行由页面用本机保存的原记录拼好传进来，按钮调用页面已有的查询和重试，不在这里发请求。
 * 概览读取中、读取失败也要显示：页面在三个分支里都放它。
 */
import type { ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass } from "lucide-react";
import { Explain, Notice, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";

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

/** 结果未知：直接生效的写操作和走审批的申请各一句。 */
export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会重复执行。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会建第二张。"}>结果未知</StatusTag>;
}

export function pendingTag(note = "批准前参数不变；这一项被审批锁住，调高调低都改不了。") {
  return <StatusTag tone="warn" icon={Clock3} explain={`等另一位超级管理员在「操作记录与审批」批准。${note}`}>待审批</StatusTag>;
}

export function expiredTag(kind: "direct" | "approval") {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "direct"
    ? "原请求超过 24 小时，不能再重试，只能查询。查询读到的是现在的值，不能据此认定原操作成没成，记录继续保留。"
    : "原请求超过 24 小时，不能再重试，只能查询原审批单。查不到也不能据此认定没提交。"}>已过期</StatusTag>;
}

export function resolvedTag(status: "approved" | "rejected" | "withdrawn") {
  const label = { approved: "已批准", rejected: "已驳回", withdrawn: "已撤回" }[status];
  return <StatusTag tone="done" explain="原审批单已有结论。点「查询原结果」读回当前值后，这条记录会清掉。">{label}</StatusTag>;
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
