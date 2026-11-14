"use client";

/**
 * F4 奖励池、名额与排行榜（改版）三块共用的写法：金额、人数、时间、业务时区、「结果未知」逐条提醒。
 * 只管显示，不算业务口径：金额按接口原值写（千分位、去掉补的末尾 0、至少两位小数、不舍入），空值写「—」。
 */
import type { ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { Explain, Notice, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

/** 接口给的 USDT 金额：千分位，最多 6 位小数（后端精度），至少两位，不舍入、不缩写。 */
export function usdt(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** 后端存的十进制文本（预算、认可金额）：整数部分加千分位，小数原样保留，至少两位。 */
export function decimalText(value: number | string | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) return String(value);
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

/** 人数、台数、票数：千分位。编号不用它。 */
export function count(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toLocaleString("en-US");
}

/** 「2026-11-14 10:20」，读不到写「—」。时区由区块标一次。 */
export function stamp(value: string | null | undefined) {
  return formatBusinessTimeCompact(value ?? "", "—");
}

/** 区块标一次的时区说明，比如「北京时间（UTC+8）」。 */
export function zoneNote() {
  const zone = businessZone();
  return `${zone.label}（${zone.offset}）`;
}

export type F4RecoveryRow = {
  key: string;
  /** 改的是什么。 */
  name: string;
  /** 从多少到多少，或这次提交的内容。 */
  change: ReactNode;
  submittedAt?: number;
  tag: ReactNode;
  actions?: ReactNode;
};

/** 结果未知：提交时没收到确定结果。直接记录的写操作和走审批的申请各一句。 */
export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经记录。24 小时内可以按原请求重试，后端认得出是同一次提交，不会记两次。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原结果；按原请求重试不会建第二张。"}>结果未知</StatusTag>;
}

/**
 * 页面最上方的「结果未知」逐条提醒（全站-结果未知叫法）：改的是什么、改成什么、什么时候提交的、现在什么状态、按钮。
 * 行由页面用本机保存的原记录拼好传进来；按钮调用已有的恢复入口，不在这里发请求。没有行时不显示。
 */
export function F4RecoveryNotice({ rows }: { rows: F4RecoveryRow[] }) {
  if (!rows.length) return null;
  return (
    <Notice tone="warn" title={<>有 {rows.length} 项操作结果未知<Explain label="结果未知怎么处理" content="原请求和理由都保留在这台电脑上。按原请求重试只会用原内容，不能改；明确被拒绝后这一项才会清掉。" /></>}>
      <ul className="f4-recovery" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="f4-recovery-name">{row.name}</span>
            <span className="f4-recovery-change">{row.change}</span>
            <span className="f4-recovery-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="f4-recovery-state">{row.tag}</span>
            <span className="f4-recovery-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="f4-recovery-zone">提交时间为{zoneNote()}</p>
    </Notice>
  );
}
