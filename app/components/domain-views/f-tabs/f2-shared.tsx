"use client";

/**
 * F2 团队奖励设置的共用小件：层名、取值、示例金额、七层对比图、本页确认框。
 * 只排界面：读的数和提交函数都来自外壳 ctx，请求内容和判断照旧。
 */
import type { ReactNode } from "react";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { FViewCtx } from "./types";
import { ColumnChart, Explain, Fact, Facts, Change } from "@/app/components/rd";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue, type EditSpec, type IconName, type OperatorBriefKind } from "../design-kit";
import { F2_DEPTH_GATE_LAYERS } from "@/lib/admin/f2-depth-gate";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import type { F2UnilevelRate } from "@/lib/admin/f1-client";

export const LAYERS = F2_DEPTH_GATE_LAYERS;
export type Layer = (typeof LAYERS)[number];

/** 示例订单金额，只做演示，不是真实数据。 */
export const SAMPLE_ORDER = 1000;

/** 每一层是谁：运营看得懂的叫法，全页和确认框一致。 */
export const LAYER_WHO: Record<Layer, string> = {
  L1: "好友",
  L2: "好友的好友",
  L3: "第 3 层",
  L4: "第 4 层",
  L5: "第 5 层",
  L6: "第 6 层",
  L7: "第 7 层",
};

/** 时间写到分钟（TX-25），后面标一次时区；空值不显示。 */
export function stamp(value: string | null | undefined) {
  const text = formatBusinessTimeCompact(value, "");
  return text ? `${text}（${businessZone().label}）` : "—";
}

/** 后端的「未配置」占位和空串都按没配。 */
export function configuredValue(raw: string | undefined) {
  const value = raw?.trim() ?? "";
  return value === "__UNCONFIGURED__" ? "" : value;
}

/** 去掉末尾补的 0，不舍入真实小数位；千分位只加在整数部分。 */
export function num(value: number | string | null, minDecimals = 0) {
  if (value === null) return "—";
  const text = typeof value === "number" ? String(value) : value.trim();
  const [int, dec = ""] = text.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const decimals = dec.padEnd(minDecimals, "0");
  return decimals ? `${grouped}.${decimals}` : grouped;
}

/** 第 1、2 层是不是按受益人等级取比例（F2-RANK-WIRE：判定由逻辑项按回包设）。 */
export const f2Ranked = (ctx: FViewCtx) => ctx.f2PurchaseBaseRateSource === "BENEFICIARY_RANK";

/** 两个百分数字符串相加（按 4 位小数算，不出浮点尾巴）。 */
export function pctAdd(a: string, b: string) {
  const units = (value: string) => { const [whole, fraction = ""] = value.split("."); return Number(whole) * 10000 + Number(fraction.padEnd(4, "0").slice(0, 4)); };
  const total = units(a) + units(b);
  const whole = Math.floor(total / 10000), fraction = String(total % 10000).padStart(4, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
/** 百分数乘示例订单（1,000 USDT）分到多少 USDT：小数点右移一位，不走浮点。 */
export function pctSample(pct: string) {
  const [whole, fraction = ""] = pctAdd(pct, "0").split(".");
  const shifted = `${whole}${fraction[0] ?? "0"}`.replace(/^0+(?=\d)/, "");
  const rest = fraction.slice(1);
  return rest ? `${shifted}.${rest}` : shifted;
}

/** 第 1、2 层按等级时：这一层的一段比例（九级最低到最高）；读不到时 null。 */
export function rankedRange(ctx: FViewCtx, level: Layer) {
  const range = ctx.f2RankPurchaseRange;
  if (!range || (level !== "L1" && level !== "L2")) return null;
  return level === "L1" ? range.l1 : range.l2;
}
/** 一段数：百分比写「4%–8%」，金额写「40–80 USDT」；两头一样只写一个。 */
export const rangeText = (low: string, high: string, unit: "%" | "USDT" = "%") => low === high ? (unit === "%" ? `${num(low)}%` : `${num(low)} USDT`)
  : unit === "%" ? `${num(low)}%–${num(high)}%` : `${num(low)}–${num(high)} USDT`;

/** 示例订单里这一层按比例分到多少 USDT。 */
export const sampleUsdt = (pct: number | null) => pct === null ? null : SAMPLE_ORDER * pct / 100;

export function layerRate(rates: F2UnilevelRate[], level: Layer) {
  return rates.find((row) => row.l === level) ?? null;
}

/** 七层按比例的对比柱图：确认框里看「现在」和「改后」每层各占订单多少。 */
export function LayerCompare({ rates, level, next, field, ranked }: { rates: F2UnilevelRate[]; level: Layer; next: number | null; field: "usdt" | "nex"; ranked?: boolean }) {
  const data = LAYERS.flatMap((layer) => {
    const row = layerRate(rates, layer);
    const before = row ? (field === "usdt" ? row.usdt : row.usdt === null || row.nex === null ? null : sampleUsdt(row.usdt)! * row.nex) : null;
    const after = layer === level && row ? (field === "usdt" ? next : row.usdt === null || next === null ? null : sampleUsdt(row.usdt)! * next) : before;
    return before === null || after === null ? [] : [{ key: layer, tick: layer, values: [before, after] }];
  });
  const unit = field === "usdt" ? "%" : " UVT";
  return (
    <div className="f2-compare">
      <p className="f2-compare-title">{field === "usdt" ? ranked ? "第 3–7 层占订单的比例" : "每层占订单的比例" : ranked ? "第 3–7 层另发的 UVT（示例订单）" : `示例 ${num(SAMPLE_ORDER)} USDT 订单每层另发的 UVT`}
        {ranked && <Explain label="图里有哪几层" content="第 1、2 层按受益人等级取比例，不在图里。" />}</p>
      <ColumnChart label={field === "usdt" ? "七层比例：现在和改后" : "七层另发 UVT：现在和改后"} height={120}
        series={[{ label: "现在", slot: "other" }, { label: "改后", slot: 4 }]}
        format={(value) => `${num(value)}${unit}`} data={data} />
    </div>
  );
}

/** 「你填的」和「批准后实际执行」写在一起，看得出差 100 倍这种错（BUG-428）。 */
export function rateMeaning(value: string) {
  const pct = Number(value);
  if (!value.trim() || !Number.isFinite(pct)) return null;
  return `${num(value)}%，每 100 USDT 订单发 ${num(value)} USDT`;
}

export function totalFacts(rates: F2UnilevelRate[], level: Layer, next?: number) {
  const complete = LAYERS.every(layer => rates.some(row => row.l === layer && row.usdt !== null));
  const before = complete ? rates.reduce((sum, row) => sum + row.usdt!, 0) : null;
  const after = complete && next !== undefined ? rates.reduce((sum, row) => sum + (row.l === level ? next : row.usdt!), 0) : before;
  return { before, after };
}

export type F2Confirm = {
  slot: string;
  /** 记进操作记录的动作名，和旧页面一致。 */
  action: string;
  title: ReactNode;
  briefKind: OperatorBriefKind;
  amplify: boolean;
  detail: ReactNode;
  completionCopy?: string;
  coverageCheck: string;
  coverageLead?: ReactNode;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  facts?: ReactNode | ((value?: string) => ReactNode);
  content?: ReactNode;
  statedBrief?: { impact: string; check: string };
  confirmTone?: "primary" | "danger";
  confirmLabel?: string;
  effect?: ReactNode;
  /** 标题前的图标；不传时照共用确认框的默认（VS-101）。 */
  icon?: IconName;
  /** 弹窗外层类名：f2-confirm 时事实块两项一行（DT-27）。 */
  dialogClassName?: string;
  /** 原来的提交路径：外壳的写函数，原样调用。 */
  submit: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => Promise<void>;
  /** 提交成功后的提示；不传就不提示（提交函数自己提示了）。 */
  done?: string;
};

/** 本页确认框。提交走 submit，失败交还给框（框里留着输入、显示原因或结果未知）。 */
export function F2ConfirmModal({ spec, ctx, coverage, onClose, toast }: { spec: F2Confirm; ctx: FViewCtx; coverage?: { coverageRatio: number; redlinePct: number }; onClose: () => void; toast: (message: string) => void }) {
  const original = ctx.f2ProposalRecord(spec.slot);
  const recovering = !!original && !original.ticket;
  return (
    <OperationConfirmModal briefKind={spec.briefKind} action={spec.action} title={spec.title} detail={spec.detail}
      amplifies={spec.amplify} coverage={coverage} edit={spec.edit} businessForm={spec.businessForm}
      facts={spec.facts} content={spec.content} statedBrief={spec.statedBrief} effect={spec.effect} icon={spec.icon} className={spec.dialogClassName}
      completionCopy={spec.completionCopy} coverageCheck={spec.coverageCheck} coverageLead={spec.coverageLead}
      confirmTone={spec.confirmTone} confirmLabel={spec.confirmLabel ?? "提交审批"} reasonPlaceholder="例如：工单号、调整依据"
      getPendingReason={() => {
        const original = ctx.f2ProposalRecord(spec.slot);
        return original && !original.ticket ? original.spec.reason : undefined;
      }}
      blockedReason={recovering ? undefined : ctx.f2WriteBlocked(spec.slot)}
      inlineApproval={{
        resolve: () => undefined,
        pending: recovering,
        initialRecovery: original?.canRetry ? "retry" : "lookup",
        queryOnly: recovering && !original.canRetry,
        expired: recovering && original.expiresAt <= Date.now(),
        expiredRequestRecovery: recovering && original.expiresAt <= Date.now() ? "query" : undefined,
        recover: async () => {
          if (!ctx.f2ProposalRecord(spec.slot)?.canQuery) throw new Error("当前账号没有查询原结果的权限。");
          const ticket = await ctx.queryF2Proposal(spec.slot);
          if (ticket) onClose();
          return !!ticket;
        },
        retry: async () => { await ctx.retryF2Proposal(spec.slot); onClose(); },
      }}
      onClose={onClose}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          await spec.submit(reason, newValue, businessValue);
        } catch (error) {
          if (isA2OutcomeUncertainError(error)) throw new Error("申请结果未知，请先查询原结果。");
          // Keep the reviewed input and the actual rejection on this F2 surface.
          if (isPermissionDenied(error)) throw new Error(`提交失败：${displayAdminError(error)}`);
          throw error;
        }
        if (spec.done) toast(spec.done);
        onClose();
      }} />
  );
}

/** 确认框事实块里常用的一行：现在 → 改后。 */
export function ChangeFact({ k, from, to }: { k: string; from: ReactNode; to?: ReactNode }) {
  return <Fact k={k}>{to === undefined ? from : <Change from={from} to={to} />}</Fact>;
}

export { Facts, Fact, Change };
