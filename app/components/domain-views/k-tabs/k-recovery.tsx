"use client";

/**
 * K 域的「原操作」提醒：结果未知、待审批、过期的原操作逐条列出（同 G 域的写法）。
 * 每条写改的是什么、从多少到多少、什么时候提交的、现在什么状态，按钮是「查询原结果」「按原请求重试」。
 * 只负责排版：行由页面用本机保存的原记录拼好传进来，按钮调用页面已有的查询、读取和重新打开，不在这里发请求。
 * 概览读取中、读取失败也要显示：页面在每个分支里都放它。
 */
import type { ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass } from "lucide-react";
import { Explain, Notice, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";

export type KRecoveryRow = {
  key: string;
  /** 改的是什么：动作名或参数名。 */
  name: string;
  /** 对象和从多少到多少，写人话，不写原始请求。 */
  change: ReactNode;
  /** 本机保存原请求的时间（毫秒）。 */
  submittedAt?: number;
  tag: ReactNode;
  actions: ReactNode;
  state?: string;
};

/** 结果未知：直接生效的写操作和走审批的申请各一句。noRetry 用于不提供原样重试的操作（标为已读）。 */
export function unknownTag(kind: "direct" | "approval" | "noRetry") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会重复执行。"
    : kind === "approval"
      ? "提交时没收到确定结果，申请可能已经提交。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会建第二张审批单。"
      : "提交时没收到确定结果。这个操作不提供原样重试，点「查询原结果」读回后端记下的状态。"}>结果未知</StatusTag>;
}

/** 申请确实建好了，但这次读取还没查到它现在的审批状态：只能查询，对象先锁着。 */
export function submittedTag() {
  return <StatusTag tone="warn" icon={CircleHelp} explain="申请已经提交，但还没查到它现在的审批状态。原记录保留，对应的按钮先锁住；点「查询原结果」查原审批单，查到还在等批准就标「待审批」。">结果未知</StatusTag>;
}

/** 本人提交、查询确认还在等批准的申请。approver 按后端要求写「另一位管理员」或「另一位超级管理员」。 */
export function pendingTag(approver: string, note: string) {
  return <StatusTag tone="warn" icon={Clock3} explain={`等${approver}在「操作记录与审批」批准。${note}`}>待审批</StatusTag>;
}

export function expiredTag(kind: "direct" | "approval") {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "direct"
    ? "原请求超过 24 小时，不能再重试，只能查询。查询读到的是现在的值，不能据此认定原操作成没成，记录继续保留。"
    : "原请求超过 24 小时，不能再重试，只能查询原审批单。查不到也不能据此认定没提交。"}>已过期</StatusTag>;
}

export function KRecoveryNotice({ title, explain, lead, rows, label = "原操作" }: {
  title: ReactNode;
  explain?: ReactNode;
  lead?: ReactNode;
  rows: KRecoveryRow[];
  label?: string;
}) {
  if (rows.length === 0) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  return (
    <Notice tone="warn" title={<>{title}{explain && <Explain label="原操作怎么处理" content={explain} />}</>}>
      {lead && <p>{lead}</p>}
      <ul className="krec" aria-label={label}>
        {rows.map((row) => (
          <li key={row.key} data-recovery-state={row.state}>
            <span className="krec-name">{row.name}</span>
            <span className="krec-change">{row.change}</span>
            <span className="krec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="krec-state">{row.tag}</span>
            <span className="krec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {timed && <p className="krec-zone">提交时间为{businessZone().label}</p>}
    </Notice>
  );
}

/** 长编号中间省略：前段随宽度收起，尾段（能区分的后缀）始终留着；完整的放在悬停和详情里。K2、K4 共用。 */
export function MidId({ value }: { value: string }) {
  const tail = value.length > 30 ? 8 : 6;
  if (value.length <= tail + 6) return <>{value}</>;
  return <span className="k-id"><span className="k-id-head">{value.slice(0, -tail)}</span><span className="k-id-tail">{value.slice(-tail)}</span></span>;
}
