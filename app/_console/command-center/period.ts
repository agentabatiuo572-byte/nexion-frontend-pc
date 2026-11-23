import type { B0SummaryPeriod } from "@/lib/admin/b0-client";
import { amountDisplay } from "@/lib/format";

/** 经营数据的四个时段。对比是上一期从头到同一时刻（B36），不是上一期全段。 */
export const PERIODS: readonly { value: B0SummaryPeriod; label: string; previous: string | null; word: string }[] = [
  { value: "today", label: "今日", previous: "昨日同时段", word: "今日" },
  { value: "week", label: "本周", previous: "上周同时段", word: "本周" },
  { value: "month", label: "本月", previous: "上月同时段", word: "本月" },
  { value: "all", label: "全部", previous: null, word: "统计以来" },
];

/** 后端给的十进制原文，按全站金额写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点，不舍入。认不出的原样写。 */
export function moneyText(value: string) {
  return amountDisplay(value);
}

export const usdtText = (value: string | null | undefined) => value == null ? "—" : `${moneyText(value)} USDT`;
