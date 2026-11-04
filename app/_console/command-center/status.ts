/**
 * 状态句的取句规则（B0 重构说明 5.3）。不新增算法，只从现有结果里挑最严重的一条，再带上待处理行数。
 * 从上到下取第一条命中的。没有读权限的条件传 false，不算读取失败。
 */
import type { B2WaterLevel } from "@/lib/admin/b2-client";

/** 资金三档，覆盖率和水位等级取更差的一个（决定 4）。 */
export type FundLevel = "ok" | "warn" | "danger";

export function fundLevel(coverage: { ratio: number; redline: number; healthy: number } | null, tier: B2WaterLevel["tier"] | null): FundLevel {
  if ((coverage && coverage.ratio < coverage.redline) || tier === "DANGER") return "danger";
  if ((coverage && coverage.ratio < coverage.healthy) || tier === "WARNING") return "warn";
  return "ok";
}

export type StatusSentence = {
  state: "ok" | "neutral" | "warn" | "danger" | "unknown";
  strong?: boolean;
  text: string;
  hint?: string;
  /** 这句话说的是业务开关，页面给去开关页的入口。 */
  aboutSwitch?: boolean;
};

export function statusSentence(input: {
  belowRedline: boolean;
  tier: B2WaterLevel["tier"] | null;
  /** p0 风险条目和已逾期的紧急开关补录，这些行本身就在待处理里。 */
  urgentRows: number;
  fundFailed: boolean;
  withdrawClosed: boolean;
  withdrawUnset: boolean;
  /** 待处理里说的就是这个开关的行，「另有」不算它。 */
  withdrawRows: number;
  belowHealthy: boolean;
  /** 待处理行数，不含读取失败的行。 */
  pendingRows: number;
  /** 资金结论读到了而且是正常，第 7 句才写「资金安全」，提现关着时才能说不是钱的问题。 */
  fundSafe: boolean;
  /** 其他块读取失败时的名字，不能再说「一切正常」。 */
  failed: readonly string[];
  loading: boolean;
}): StatusSentence {
  const { pendingRows } = input;
  const also = (count: number) => (count > 0 ? `。另有 ${count} 件事要处理` : "");
  if (input.belowRedline) return { state: "danger", strong: true, text: `资金告警：覆盖率跌破红线，先处理资金${also(pendingRows)}` };
  if (input.tier === "DANGER") return { state: "danger", strong: true, text: `资金告警：储备只够付不到 7 天，先处理资金${also(pendingRows)}` };
  if (input.urgentRows > 0) return { state: "danger", text: `有紧急风险，先看待处理${also(pendingRows - input.urgentRows)}` };
  // 上面三句是告警，读到就说。下面的要等这一屏读完，不说半句，也不先说没事（F07）。
  if (input.loading) return { state: "unknown", text: "正在读取今天的状况…" };
  if (input.fundFailed) return { state: "warn", text: `资金数据读取失败，状态不确定${also(pendingRows)}` };
  if (input.withdrawClosed) {
    const notMoney = input.fundSafe ? "这是业务开关没开，不是钱不够。" : "";
    return input.withdrawUnset
      ? { state: "warn", aboutSwitch: true, text: `提现开关未设置，用户现在不能提现${also(pendingRows - input.withdrawRows)}`, hint: `这个开关还没人设置过，系统按关闭处理。${notMoney}` }
      : { state: "warn", aboutSwitch: true, text: `提现已关停${also(pendingRows - input.withdrawRows)}`, hint: `用户现在不能提现。${notMoney}` };
  }
  if (input.belowHealthy || input.tier === "WARNING") return { state: "warn", text: `资金需要注意${also(pendingRows)}` };
  if (pendingRows > 0) return { state: "neutral", text: `有 ${pendingRows} 件事要处理${input.fundSafe ? "，资金安全" : ""}` };
  if (input.failed.length === 1) return { state: "unknown", text: `${input.failed[0]}读取失败，状态不确定` };
  if (input.failed.length > 1) return { state: "unknown", text: "部分数据读取失败，状态不确定" };
  return { state: "ok", text: "一切正常，没有要你处理的事" };
}
