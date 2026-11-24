"use client";
/**
 * 客服业绩额（客户入金 − 客户提现，只算 USDT）的显示形状和小件。
 * 显示件只认「有哪些东西、什么状态」，不认后端字段名：接线（perf-wiring.ts）把后端合同映射成这里的形状；
 * 后端新合同（B80）交付前，新数据只有开发夹具（perf-fixture.ts）给。
 */
import { amountDisplay } from "@/lib/format";

/** 一个业绩金额：核完了写数；没核完写已核小计和缺什么；读不到、不可用写「—」和原因。 */
export type PerfValue =
  | { state: "complete"; value: string }
  | { state: "partial"; observed: string | null; missing: string }
  | { state: "unavailable"; reason: string };
/** 一个人数，状态同上。 */
export type PerfCount =
  | { state: "complete"; value: number }
  | { state: "partial"; observed: number | null; missing: string }
  | { state: "unavailable"; reason: string };

/** 新口径还没有能用的数据时（接线前、后端回滚、还没发布新的一版）写这一句，不拿旧的「净贡献」顶替。 */
export const PERF_UNAVAILABLE = "业绩数据暂不可用";
export const PERF_UNAVAILABLE_VALUE: PerfValue = { state: "unavailable", reason: PERF_UNAVAILABLE };

/** 公开榜和各处汇总共用的三项：业绩额、入金合计、提现合计。 */
export type PerfTotals = { amount: PerfValue; inflow: PerfValue; withdrawal: PerfValue };

export function perfText(value: PerfValue): string {
  return value.state === "complete" ? amountDisplay(value.value) : "—";
}
export function perfCountText(value: PerfCount): string {
  return value.state === "complete" ? value.value.toLocaleString("en-US") : "—";
}
/** 没核完时第二行写的已核小计；没有已核小计时只写缺什么。 */
export function perfObservedText(value: PerfValue, unit = ""): string | undefined {
  if (value.state !== "partial") return undefined;
  return value.observed === null ? value.missing : `已核 ${amountDisplay(value.observed)}${unit} · ${value.missing}`;
}
/** 表格金额格第二行：入金和提现合计；没核完写已核小计；不可用写原因。 */
export function perfFlowText(totals: PerfTotals): string {
  const { amount, inflow, withdrawal } = totals;
  if (amount.state === "unavailable") return "暂不可用";
  if (amount.state === "partial") return amount.observed === null ? amount.missing : `已核 ${amountDisplay(amount.observed)} · ${amount.missing}`;
  return `入金 ${perfText(inflow)} · 提现 ${perfText(withdrawal)}`;
}
/** 读屏和悬停用的完整说法。 */
export function perfNote(value: PerfValue): string | undefined {
  return value.state === "complete" ? undefined : value.state === "partial" ? perfObservedText(value) : value.reason;
}

/* ---------------- 客服工作台 ---------------- */

/** 期间业绩里的一行入金渠道；sub 是缩进、弱字的「其中本期更正」。 */
export type PerfChannel = { label: string; value: PerfValue; sub?: boolean };
/** 期间业绩里的一行提现网络。 */
export type PerfWithdrawal = { label: string; walletDebited: PerfValue; fee: PerfValue; received: PerfValue };
/** 所选月份本人（或所选范围）的期间业绩。 */
export type PeriodPerf = {
  totals: PerfTotals;
  first: PerfCount;
  /** 期间首充里充值、购机各几位。 */
  firstSplit?: { deposits: number; purchases: number };
  inflow: PerfChannel[];
  withdrawals: PerfWithdrawal[];
};
/** 业绩额明细里的一笔。业务金额带它自己的币种；原币不是 USDT 的写 null，类别第二行写清去导出里看。 */
export type PerfEvent = { id: string; at: string; customer: string; customerNo: string; kind: string; detail: string; business: string | null; delta: string };
/** 业绩额明细：合计、现在名下能看的、已转走只给小计。 */
export type PerfEvents = {
  from: string; to: string;
  total: { amount: PerfValue; count: number; customers: number };
  visible: { amount: PerfValue; count: number; customers: number };
  restricted: { amount: PerfValue; count: number; customers: number };
  rows: PerfEvent[];
};
/** 客服工作台一次读取里各处要用的业绩额。缺哪项写哪项的不可用，不拿旧的「净贡献」顶替。 */
export type AnalyticsPerf = {
  /** 我的数据：期间业绩。 */
  period: PeriodPerf | { unavailable: string };
  /** 我的数据：业绩额明细。 */
  events?: PerfEvents;
  /** 客户表：这位客户自起算点以来的累计业绩额（跟着客户走）。 */
  customers: Record<string, PerfValue>;
  /** 客服表：这位客服现在的客户的累计业绩额。 */
  agents: Record<string, PerfValue>;
  /** 组卡：这个月按发生时所在组算的业绩额，和组里现在的客户的累计。 */
  groups: Record<string, { period: PerfValue; current: PerfValue }>;
  /** 经营概况：所选范围这个月的三项合计和现在的客户的累计。 */
  scope: { period: PerfTotals; current: PerfValue };
  /** 只有超级管理员才有：不在负责组里的业绩。 */
  attribution?: { unassigned: PerfValue; unknown: PerfValue };
};
