import type { B0SummaryPeriod } from "@/lib/admin/b0-client";

/** 经营数据的四个时段。对比是上一期从头到同一时刻（B36），不是上一期全段。 */
export const PERIODS: readonly { value: B0SummaryPeriod; label: string; previous: string | null; word: string }[] = [
  { value: "today", label: "今日", previous: "昨日同时段", word: "今日" },
  { value: "week", label: "本周", previous: "上周同时段", word: "本周" },
  { value: "month", label: "本月", previous: "上月同时段", word: "本月" },
  { value: "all", label: "全部", previous: null, word: "统计以来" },
];

/** 后端给的十进制原文：加千分位、去掉多余的末尾 0、最少两位，不舍入。认不出的原样写。 */
export function moneyText(value: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

export const usdtText = (value: string | null | undefined) => value == null ? "—" : `${moneyText(value)} USDT`;
