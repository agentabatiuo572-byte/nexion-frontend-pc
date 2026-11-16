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
import { ColumnChart, Fact, Facts, Change } from "@/app/components/rd";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue, type EditSpec, type OperatorBriefKind } from "../design-kit";
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

/** 示例订单里这一层按比例分到多少 USDT。 */
export const sampleUsdt = (pct: number | null) => pct === null ? null : SAMPLE_ORDER * pct / 100;

export function layerRate(rates: F2UnilevelRate[], level: Layer) {
  return rates.find((row) => row.l === level) ?? null;
}

/** 七层按比例的对比柱图：确认框里看「现在」和「改后」每层各占订单多少。 */
export function LayerCompare({ rates, level, next, field }: { rates: F2UnilevelRate[]; level: Layer; next: number | null; field: "usdt" | "nex" }) {
  const data = LAYERS.flatMap((layer) => {
    const row = layerRate(rates, layer);
    const before = row ? (field === "usdt" ? row.usdt : row.usdt === null || row.nex === null ? null : sampleUsdt(row.usdt)! * row.nex) : null;
    const after = layer === level && row ? (field === "usdt" ? next : row.usdt === null || next === null ? null : sampleUsdt(row.usdt)! * next) : before;
    return before === null || after === null ? [] : [{ key: layer, tick: layer, values: [before, after] }];
  });
  const unit = field === "usdt" ? "%" : " UVT";
  return (
    <div className="f2-compare">
      <p className="f2-compare-title">{field === "usdt" ? "每层占订单的比例" : `示例 ${num(SAMPLE_ORDER)} USDT 订单每层另发的 UVT`}</p>
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
  completionCopy: string;
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
  /** 原来的提交路径：外壳的写函数，原样调用。 */
  submit: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => Promise<void>;
  /** 提交成功后的提示；不传就不提示（提交函数自己提示了）。 */
  done?: string;
};

/** 本页确认框。提交走 submit，失败交还给框（框里留着输入、显示原因或结果未知）。 */
export function F2ConfirmModal({ spec, ctx, coverage, onClose, toast }: { spec: F2Confirm; ctx: FViewCtx; coverage?: { coverageRatio: number; redlinePct: number }; onClose: () => void; toast: (message: string) => void }) {
  return (
    <OperationConfirmModal briefKind={spec.briefKind} action={spec.action} title={spec.title} detail={spec.detail}
      amplifies={spec.amplify} coverage={coverage} edit={spec.edit} businessForm={spec.businessForm}
      facts={spec.facts} content={spec.content} statedBrief={spec.statedBrief} effect={spec.effect}
      completionCopy={spec.completionCopy} coverageCheck={spec.coverageCheck} coverageLead={spec.coverageLead}
      confirmTone={spec.confirmTone} confirmLabel={spec.confirmLabel ?? "提交审批"} reasonPlaceholder="例如：工单号、调整依据"
      getPendingReason={() => {
        const original = ctx.f2ProposalRecord(spec.slot);
        return original && !original.ticket ? original.spec.reason : undefined;
      }}
      blockedReason={(() => {
        const original = ctx.f2ProposalRecord(spec.slot);
        return original && !original.ticket ? original.canRetry ? undefined : "上一次申请结果未知，先按原请求重试或去核对" : ctx.f2WriteBlocked(spec.slot);
      })()}
      onClose={onClose}
      onConfirm={async (reason, newValue, businessValue) => {
        const original = ctx.f2ProposalRecord(spec.slot);
        try {
          if (original && !original.ticket) await ctx.retryF2Proposal(spec.slot);
          else await spec.submit(reason, newValue, businessValue);
        } catch (error) {
          if (isA2OutcomeUncertainError(error)) throw new Error(displayAdminError("F2_PROPOSAL_OUTCOME_UNKNOWN"));
          // Keep the reviewed input and the actual rejection on this F2 surface.
          if (isPermissionDenied(error)) throw new Error(`提交失败：${displayAdminError(error)}`);
          throw error;
        }
        if (!original && spec.done) toast(spec.done);
        onClose();
      }} />
  );
}

/** 确认框事实块里常用的一行：现在 → 改后。 */
export function ChangeFact({ k, from, to }: { k: string; from: ReactNode; to?: ReactNode }) {
  return <Fact k={k}>{to === undefined ? from : <Change from={from} to={to} />}</Fact>;
}

export { Facts, Fact, Change };
