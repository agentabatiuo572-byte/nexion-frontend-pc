"use client";

/**
 * F3 团队平衡奖励的两张图：规则流程图和 A、B 两组对比条。
 * 只按页面给的数画，不发请求、不算业务口径；数字的写法由页面给。
 */
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Change } from "@/app/components/rd";

/** 结算周期怎么算每期上限、哪天结算（BinaryCommissionSettlementService.isSettlementDue、periodDays）。 */
export const PERIOD_TEXT: Record<string, { when: string; short: string; cap: string }> = {
  每日: { when: "每天结算一次", short: "每天结算", cap: "每日上限 × 1 天" },
  每周: { when: "每周日结算一次", short: "每周日结算", cap: "每日上限 × 7 天" },
  每月: { when: "每月最后一天结算一次", short: "每月末结算", cap: "每日上限 × 当月天数" },
};

/** 没匹配上的订单额怎么处理（BinaryCommissionSettlementService.volumeWindow）。显示名「每次匹配后清零」，存的值是「每次对碰清零」。 */
export const RESIDUAL_TEXT: Record<string, { label: string; short: string; what: string; more?: boolean }> = {
  每月清零: { label: "每月清零", short: "只算本月订单额，上月没匹配上的不再算", what: "只算本月的订单额，本月已匹配的扣掉；上个月没匹配上的，到月初就不再算。" },
  每次对碰清零: { label: "每次匹配后清零", short: "每次结算成功后，只算之后的新订单", what: "每次结算成功后，之前的订单额都不再算，下一次只算之后的新订单。" },
  转结: { label: "转结", short: "一直留着继续匹配，之后可能多付奖励", what: "没匹配上的订单额一直留着，之后继续参与匹配；不限月份，之后可能多付奖励。", more: true },
};

export const residualLabel = (value: string) => RESIDUAL_TEXT[value]?.label ?? value;

export type F3Rule = {
  /** 门槛，已写成「1,000 USDT」这类文字；没读到传 null。 */
  threshold: string | null;
  /** 比例，已写成「10%」；读不懂传 null。 */
  rate: string | null;
  /** 每日上限，已写成「1,000 USDT」；没读到传 null。 */
  cap: string | null;
  /** 全平台封顶比例，已写成「2%」；没读到（旧接口或读取失败）传 null。 */
  platformCap: string | null;
  period: string;
  residual: string;
};

type Step = { key: keyof F3Rule | "legs" | "pay"; title: string; value: ReactNode; sub: ReactNode };

/**
 * 规则流程图：A、B 两组订单额 → 两组都过门槛 → 取较小一组 × 比例 → 不超过每期上限 → 不超过全平台封顶 → 记给邀请人。
 * 看它能判断：现在的门槛、比例、上限、全平台封顶、周期合在一起，一位邀请人这一期最多能拿多少、卡在哪一步。
 * 传 next 时（确认框里）改的那一步写「现在 → 改后」并加描边。
 */
export function F3RuleFlow({ rule, next, changed, capAction, compact }: {
  rule: F3Rule;
  /** 确认框里用：一步一行，只写名字和值，不写说明。 */
  compact?: boolean;
  next?: Partial<F3Rule>;
  changed?: (keyof F3Rule)[];
  /** 每期上限那一步下面的入口，比如「去运营阶段设置」。 */
  capAction?: ReactNode;
}) {
  const shown = (key: keyof F3Rule, text: (value: string) => ReactNode, missing: string) => {
    const before = rule[key];
    const after = next?.[key];
    const now = before === null ? <span className="f3-flow-missing">{missing}</span> : text(before);
    if (after === undefined || after === before) return now;
    return <Change from={now} to={after === null ? missing : text(after)} />;
  };
  const period = next?.period ?? rule.period;
  const steps: Step[] = [
    { key: "legs", title: "A 组、B 组订单额", value: "各算各的", sub: "范围看残额怎么处理" },
    { key: "threshold", title: "两组都过门槛", value: shown("threshold", (value) => `≥ ${value}`, "门槛没读到"), sub: "一组没到就不发" },
    { key: "rate", title: "取较小一组 × 比例", value: shown("rate", (value) => `× ${value}`, "比例读不懂"), sub: "先扣掉已匹配的" },
    { key: "cap", title: "不超过每期上限", value: shown("cap", (value) => `每日 ${value}`, "上限没读到"), sub: <>{PERIOD_TEXT[period]?.cap ?? "按结算周期算天数"}{capAction && <span className="f3-flow-action">{capAction}</span>}</> },
    { key: "platformCap", title: "不超过全平台封顶", value: shown("platformCap", (value) => `已付款订单额 × ${value}`, "封顶比例没读到"), sub: "超出时按比例缩减" },
    { key: "pay", title: "记给邀请人", value: shown("period", (value) => PERIOD_TEXT[value]?.short ?? value, "周期没读到"), sub: "冷却期满才能提现" },
  ];
  return (
    <div className="f3-flow" data-compact={compact ? "" : undefined}>
      <ol className="f3-flow-steps" aria-label="团队平衡奖励的计算步骤">
        {steps.map((step, index) => (
          <li key={step.key} className="f3-flow-step" data-changed={step.key !== "legs" && step.key !== "pay" && changed?.includes(step.key) || step.key === "pay" && changed?.includes("period") ? "" : undefined}>
            <span className="f3-flow-no" aria-hidden>{index + 1}</span>
            <span className="f3-flow-title">{step.title}</span>
            <span className="f3-flow-value">{step.value}</span>
            {!compact && <span className="f3-flow-sub">{step.sub}</span>}
            {index < steps.length - 1 && <ArrowRight className="f3-flow-arrow" size={16} aria-hidden />}
          </li>
        ))}
      </ol>
      <div className="f3-flow-residual" data-changed={changed?.includes("residual") ? "" : undefined}>
        <span className="f3-flow-residual-k">没匹配上的订单额</span>
        <span className="f3-flow-residual-v">{shown("residual", residualLabel, "没读到")}</span>
        {!compact && <span className="f3-flow-residual-what">{RESIDUAL_TEXT[next?.residual ?? rule.residual]?.short ?? "这个值无效，结算会被拦下"}</span>}
      </div>
    </div>
  );
}

/**
 * A、B 两组对比条：A 从中线往左，B 往右，同一个刻度；较小一组实色，较大一组超出较小一组的部分是浅色，
 * 就是这一期没匹配上的；门槛画成两边的刻线。看它能判断：哪边小、差多少、两组过没过门槛。
 */
export function F3PairBar({ a, b, max, threshold, label }: { a: number; b: number; max: number; threshold: number | null; label: string }) {
  const scale = Math.max(max, a, b, threshold ?? 0, 1);
  const matched = Math.min(a, b);
  const pct = (value: number) => Math.min(100, (value / scale) * 100);
  // A 从右边（中线）往左画，B 从左边（中线）往右画；用 SVG 的百分比坐标，不写内联样式。
  const side = (value: number, leg: "a" | "b") => {
    const at = (width: number) => `${leg === "a" ? 100 - width : 0}%`;
    const tick = threshold !== null && threshold > 0 ? pct(threshold) : null;
    return (
      <svg className="f3-pair-track" data-leg={leg} aria-hidden focusable="false">
        {value > 0 && <rect className="f3-pair-fill" x={at(pct(value))} y="4" width={`${pct(value)}%`} height="8" rx="2" />}
        {matched > 0 && <rect className="f3-pair-match" x={at(pct(matched))} y="4" width={`${pct(matched)}%`} height="8" rx="2" />}
        {tick !== null && <rect className="f3-pair-tick" x={`${leg === "a" ? 100 - tick : tick}%`} y="1" width="2" height="14" />}
      </svg>
    );
  };
  return (
    <span className="f3-pair" role="img" aria-label={label} title={label}>
      {side(a, "a")}
      <span className="f3-pair-axis" aria-hidden />
      {side(b, "b")}
    </span>
  );
}
