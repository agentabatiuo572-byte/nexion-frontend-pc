/**
 * 状态句的取句规则（B0 重构说明 5.3）。不新增算法，只从现有结果里挑最严重的一条。
 * 从上到下取第一条命中的。没有读权限的条件传 false，不算读取失败。
 * 一屏只有一条结论横幅（VS-23）：资金告警和资金注意把可覆盖天数写进这句话，建议写在第二行，待处理件数不进横幅，待处理列表就在下面。
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
  /** 第二行：建议、该做什么。 */
  hint?: string;
  /** 这句话怎么算、为什么：收进句尾的提示图标（DP-06）。 */
  explain?: string;
  /** 这句话说的是业务开关，页面给去开关页的入口。 */
  aboutSwitch?: boolean;
  /** 这句话说的是资金，页面给去资金总览的入口。 */
  aboutFund?: boolean;
  /** 这句话说的是提现压力，页面给展开「风险与开关」的入口。 */
  aboutRisk?: boolean;
  /** 这句话说的是资金数据读取失败：页面只在这里写一次，给重试，别处不再写（VS-107）。 */
  fundFailed?: boolean;
};

export function statusSentence(input: {
  belowRedline: boolean;
  tier: B2WaterLevel["tier"] | null;
  /** 「可覆盖 5 天」这种话，读到了才有。 */
  days: string | null;
  /** 资金告警和资金注意时的建议，写在第二行。 */
  advice: string | null;
  /** p0 风险条目和已逾期的紧急开关补录，这些行本身就在待处理里。 */
  urgentRows: number;
  fundFailed: boolean;
  /** 近 24 小时提现申请和待提现总额占储备，到黄线或红线（现有阈值）。 */
  pressure: "ok" | "warn" | "danger";
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
  const { pendingRows, days, advice } = input;
  const also = (count: number) => (count > 0 ? `。另有 ${count} 件事要处理` : "");
  const withDays = (text: string) => (days ? `${text}，${days}` : text);
  if (input.belowRedline) return { state: "danger", strong: true, aboutFund: true, text: withDays("资金告警：覆盖率跌破红线"), hint: advice ?? undefined };
  if (input.tier === "DANGER") return { state: "danger", strong: true, aboutFund: true, text: days ? `资金告警：储备只够付${days.replace("可覆盖 ", "")}` : "资金告警：储备只够付不到 7 天", hint: advice ?? undefined };
  if (input.urgentRows > 0) return { state: "danger", text: `有紧急风险，先看待处理${also(pendingRows - input.urgentRows)}` };
  // 上面三句是告警，读到就说。下面的要等这一屏读完，不说半句，也不先说没事（F07）。
  if (input.loading) return { state: "unknown", text: "正在读取今天的状况…" };
  if (input.fundFailed) return { state: "warn", fundFailed: true, text: `资金数据读取失败，状态不确定${also(pendingRows)}` };
  if (input.pressure === "danger") return { state: "danger", aboutRisk: true, text: "提现压力到红线，先看风险与开关", explain: "近 24 小时提现申请或待提现总额占储备的比例到了红线。" };
  if (input.withdrawClosed) {
    const notMoney = input.fundSafe ? "这是业务开关没开，不是钱不够。" : "";
    const why = input.withdrawUnset ? "这个开关当前没有有效配置，系统按关闭处理。" : "";
    return { state: "warn", aboutSwitch: true, text: `提现已关停${also(pendingRows - input.withdrawRows)}`, hint: "用户现在不能提现。", explain: `${why}${notMoney}` || undefined };
  }
  if (input.belowHealthy) return { state: "warn", aboutFund: true, text: withDays("资金需要注意：覆盖率低于健康线"), hint: advice ?? undefined };
  if (input.tier === "WARNING") return { state: "warn", aboutFund: true, text: days ? `资金需要注意：储备只够付${days.replace("可覆盖 ", "")}` : "资金需要注意", hint: advice ?? undefined };
  if (input.pressure === "warn") return { state: "warn", aboutRisk: true, text: "提现压力到黄线，看一下风险与开关", explain: "近 24 小时提现申请或待提现总额占储备的比例到了黄线。" };
  if (pendingRows > 0) return { state: "neutral", text: `有 ${pendingRows} 件事要处理${input.fundSafe ? "，资金安全" : ""}` };
  if (input.failed.length === 1) return { state: "unknown", text: `${input.failed[0]}读取失败，状态不确定` };
  if (input.failed.length > 1) return { state: "unknown", text: "部分数据读取失败，状态不确定" };
  return { state: "ok", text: "一切正常，没有要你处理的事" };
}
