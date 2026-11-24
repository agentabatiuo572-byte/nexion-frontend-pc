"use client";

/**
 * F2 团队奖励的七层和参数：每层分多少（主图）、谁能拿到、总量和冷却、合作伙伴权益、旧档位和旧参数。
 * 每个写入口打开本页确认框，提交仍调外壳原来的写函数，键、值和顺序照旧。
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Clock3, Gauge, Layers, Lock, PauseCircle, PowerOff, ShieldCheck, Users } from "lucide-react";
import {
  BlockState, Button, Cell, ConfigList, KeepText, ConfigRow, Explain, Figure, Notice, Panel, RatioBar, ScaleBar, StatusTag, Table, TableMessage, Td, Th,
} from "@/app/components/rd";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { F2_DEPTH_GATE_RANKS, f2EnumGateSpec, parseF2DepthGateLayer, parseF2DepthGateRank } from "@/lib/admin/f2-depth-gate";
import {
  Change, Fact, Facts, LAYERS, LAYER_WHO, LayerCompare, SAMPLE_ORDER, configuredValue, f2Ranked, layerRate, num, pctAdd, pctSample, rangeText, rankedRange, rateMeaning, sampleUsdt, totalFacts,
  type F2Confirm, type Layer,
} from "./f2-shared";
import { F2Bootstrap, f2BootstrapFormShown, type F2BootstrapDraft } from "./f2-bootstrap";
import { f2DecimalTimes } from "./f2-bootstrap-ticket";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import type { FViewCtx } from "./types";

const F2_VISIBLE_PARAM_KEYS = new Set([
  "F.cooldown", "F.unilevel.depthGate", "F.unilevel.depthGateRank",
  "F.influence.clampMin", "F.influence.clampMax", "F.promo.weekMultiplier", "F.unilevel.mergeExitMaxPct",
]);
export const F2_HISTORICAL_PARAM_NAMES: Record<string, string> = {
  "F.unilevel.depth": "最大计算范围（L1–Ln）",
  "F.unilevel.depthGate": "等级解锁起点（L1–L7）",
  "F.unilevel.depthGateRank": "解锁等级",
  "F.influence.clampMin": "影响分下限",
  "F.influence.clampMax": "影响分上限",
  "F.promo.weekMultiplier": "活动周倍率",
  "F.unilevel.mergeExitMaxPct": "奖励总额上限（占订单）",
  "F.peer.rate": "同级奖励比例",
  "F.royalty.minPayout": "购买奖励支付阈值",
  "F.unilevel.nexCap": "UVT 日封顶（已停用）",
  "F.unilevel.backfill": "回溯时段（已停用）",
};

/** 结算时没配或配坏的兜底（后端 prepareBudget 的默认值），只写在说明里，不当成已配置。 */
const SETTLEMENT_FALLBACK: Record<string, string> = {
  "F.influence.clampMin": "没配时，结算按下限 1 算",
  "F.influence.clampMax": "没配时，结算按上限 5 算",
  "F.promo.weekMultiplier": "没配时，结算按 1 倍算",
  "F.unilevel.mergeExitMaxPct": "没配或读不出数时，结算按 25% 算",
  "F.cooldown": "没配或读不出数时，结算按 30 天算",
  "F.unilevel.depthGate": "没配或不是 L1–L7 时，结算会停",
  "F.unilevel.depthGateRank": "没配或不是 V0–V8 时，结算会停",
};

const pendingFor = (ctx: FViewCtx, key: string) => ctx.f2PendingFor(key);

const PARTNER_TIERS = [
  { key: "standard", name: "基础", perk: "基础权益" },
  { key: "verified", name: "认证", perk: "优先客服支持" },
  { key: "premium", name: "高级", perk: "新品优先" },
  { key: "diamond", name: "钻石", perk: "专属问答与贵宾服务" },
] as const;

type Open = (spec: F2Confirm) => void;

function useF2Model(ctx: FViewCtx) {
  const canRoyaltyRate = ctx.can("network_f2_royalty_rate");
  const canPolicyAmplify = ctx.can("network_f2_policy_amplify");
  const l1NexReadonly = !ctx.f2DirectPolicy || !!ctx.f2DirectPolicyError || ctx.f2DirectPolicyLoading || (ctx.f2DirectPolicy.sevenLayerEnabled && ctx.f2DirectPolicy.purchaseSplit.enabled);
  const l1NexStatus = ctx.f2DirectPolicyLoading ? "好友奖励政策读取中，暂不能改"
    : ctx.f2DirectPolicyError ? "好友奖励政策没读到，暂不能改"
      : !ctx.f2DirectPolicy ? "好友奖励政策还没确认，暂不能改"
        : "已停用：好友购买奖励改用币种拆分";
  const value = (key: string) => {
    const raw = configuredValue(ctx.f2ConfigValues[key] ?? ctx.f2Params.find((row) => row.key === key)?.value);
    // This config is always percentage points; backend parseDecimal also accepts
    // an explicit percent suffix. Never apply unilevel percentRatio guessing.
    return key === "F.unilevel.mergeExitMaxPct" ? raw.replace(/%$/, "").replace(/,/g, "").trim() : raw;
  };
  const paused = (level: Layer) => configuredValue(ctx.f2ConfigValues[`F.unilevel.${level}.paused`]);
  const gateRaw = value("F.unilevel.depthGate");
  const rankRaw = value("F.unilevel.depthGateRank");
  const gate = gateRaw ? parseF2DepthGateLayer(gateRaw) : null;
  const rank = rankRaw ? parseF2DepthGateRank(rankRaw) : null;
  const capRaw = value("F.unilevel.mergeExitMaxPct");
  const cap = capRaw !== "" && Number.isFinite(Number(capRaw)) ? Number(capRaw) : null;
  return { canRoyaltyRate, canPolicyAmplify, l1NexReadonly, l1NexStatus, value, paused, gate, rank, gateRaw, rankRaw, cap };
}

const approvalCopy = (perm: string) => `批准人要是另一位管理员，需有审批批准权限和「${perm}」权限；批准前按原设置执行。`;
const effectTag = <StatusTag tone="progress" filled explain="另一位管理员在「操作记录与审批」批准后才生效；只影响之后新算的订单，已经算好的不重算。">批准后生效</StatusTag>;
const COVERAGE_CHECK = "批准时检查兑付覆盖率，低于红线不会执行。";

/* ───────────── 每层分多少 ───────────── */

export function F2Layers({ ctx, openConfirm }: { ctx: FViewCtx; openConfirm: Open }) {
  const m = useF2Model(ctx);
  const rates = ctx.f2Unilevel;
  // 首次配置填到一半时点刷新，草稿留着。
  const [bootDraft, setBootDraft] = useState<F2BootstrapDraft | null>(null);
  const canOpenF1 = useAdminAuth((state) => !!state.session && canAccessResolvedPath(resolveVisibleDomains(state.session), "/network/v-rank"));
  if (ctx.f2Loading) return <Panel title="每层分多少" icon={Layers} tone="role-4"><BlockState state="loading" title="七层比例读取中" /></Panel>;
  if (ctx.f2Error) return <Panel title="每层分多少" icon={Layers} tone="role-4"><BlockState state="error" title="七层比例没读到，这部分没有判断" detail={ctx.f2Error} onRetry={() => void ctx.refreshF2()} /></Panel>;
  const gateLayer = m.gate?.legal ? LAYERS.indexOf(m.gate.normalized as Layer) : -1;
  const pausedLayers = LAYERS.filter((level) => m.paused(level) === "on");
  const complete = LAYERS.every(level => rates.some(row => row.l === level && row.usdt !== null && row.usdt <= 100));
  const activeSum = rates.filter((row) => m.paused(row.l as Layer) !== "on").reduce((sum, row) => sum + (row.usdt ?? 0), 0);
  const pausedSum = rates.filter((row) => m.paused(row.l as Layer) === "on").reduce((sum, row) => sum + (row.usdt ?? 0), 0);
  const barMax = Math.max(...rates.map((row) => row.usdt ?? 0), 0);
  const promo = m.value("F.promo.weekMultiplier");
  const missing = LAYERS.filter((level) => !layerRate(rates, level));
  const partValues = LAYERS.some((level) => { const row = layerRate(rates, level); return !!row && (row.usdt === null || row.usdt > 100 || row.nex === null); });
  const booting = rates.length === 0 && f2BootstrapFormShown(ctx, bootDraft);
  // 第 1、2 层按受益人等级时（F2-RANK-WIRE），这两层没有单一比例：合计是一段，第 1、2 层取九级最低、最高，第 3 层起照存的比例。
  const ranked = f2Ranked(ctx);
  const sourceUnknown = ctx.f2PurchaseBaseRateSource === null;
  const sourcesUseFirstTwo = ranked || sourceUnknown;
  const noRateSource = (level: Layer) => sourceUnknown && (level === "L1" || level === "L2");
  const rankedLevel = (level: Layer) => ranked && (level === "L1" || level === "L2");
  const othersSum = rates.filter((row) => m.paused(row.l as Layer) !== "on" && !rankedLevel(row.l as Layer)).reduce((sum, row) => pctAdd(sum, row.usdtText ?? "0"), "0");
  const sumRange = ranked && ctx.f2RankPurchaseRange ? (["L1", "L2"] as const).filter((level) => m.paused(level) !== "on")
    .reduce((sum, level) => ({ low: pctAdd(sum.low, rankedRange(ctx, level)!.min), high: pctAdd(sum.high, rankedRange(ctx, level)!.max) }), { low: othersSum, high: othersSum }) : null;
  const sumHigh = sourceUnknown ? null : ranked ? (sumRange ? Number(sumRange.high) : null) : activeSum;
  const rankedExplain = "第 1、2 层按受益人自己的等级取比例，九级比例在团队等级晋升设置；这里显示九级里最低到最高。";
  const axisMax = Math.max(30, Math.ceil(Math.max(ranked ? Number(sumRange?.high ?? 0) : activeSum, m.cap ?? 0) / 10) * 10);
  // 单层调整和首次配置是两件事：单层只改已有的行。
  const missingRuleCopy = `批准时只更新已有的规则，没有规则的层会执行失败。${rates.length === 0 ? "七层都没有规则时，请用「首次配置」。" : "缺整层规则后台补不了，需要技术同事处理。"}`;

  const openRate = (level: Layer) => {
    const rate = layerRate(rates, level);
    const current = rate?.usdtText ?? "";
    // 这一层在按层暂停里停着：改比例批准后也仍不发，说清楚要发放还得去恢复（D5）。
    const layerPaused = m.paused(level) === "on";
    openConfirm({
      slot: `f-config:F.unilevel.${level}`,
      action: `调整 ${level} USDT 奖励比例`, title: `调整 ${level}（${LAYER_WHO[level]}）的 USDT 比例`, briefKind: "config", amplify: true, dialogClassName: "f2-confirm",
      effect: effectTag,
      edit: { kind: "number", current, min: 0, unit: "%", amplifiesWhen: "increase",
        validate: (next) => (next.trim().split(".")[1]?.replace(/0+$/, "").length ?? 0) > 4 ? "最多 4 位小数（末尾的 0 不算），多了不能提交" : undefined,
        hint: "填百分数：0.5 就是 0.5%，最多 4 位小数",
        preview: (next) => <>
          {layerPaused && <p className="f2-edit-note">{`要发放，到「按层暂停」恢复 ${level}。`}</p>}
          {rates.length ? <LayerCompare rates={sourcesUseFirstTwo ? rates.filter(row => !rankedLevel(row.l as Layer) && !noRateSource(row.l as Layer)) : rates} level={level} next={next || current ? Number(next || current) : null} field="usdt" ranked={ranked} /> : null}
        </> },
      facts: (next) => {
        const total = totalFacts(rates, level, next === undefined ? undefined : Number(next));
        // 按受益人等级时合计是一段（含暂停层）：第 1、2 层取九级最低、最高，第 3 层起照存的比例，这一层换成新值。
        const othersAll = (value?: string) => rates.filter((row) => !rankedLevel(row.l as Layer)).reduce((sum, row) => pctAdd(sum, row.l === level && value !== undefined ? value : row.usdtText ?? "0"), "0");
        const span = (base: string) => ctx.f2RankPurchaseRange ? { low: pctAdd(pctAdd(base, ctx.f2RankPurchaseRange.l1.min), ctx.f2RankPurchaseRange.l2.min), high: pctAdd(pctAdd(base, ctx.f2RankPurchaseRange.l1.max), ctx.f2RankPurchaseRange.l2.max) } : null;
        const rankedBefore = ranked ? span(othersAll()) : null, rankedAfter = ranked && next !== undefined && next.trim() ? span(othersAll(next.trim())) : rankedBefore;
        const anyPaused = LAYERS.some((item) => m.paused(item) === "on");
        const lower = next !== undefined && !!current && Number(next) < Number(current);
        return <Facts>
          {lower && <Fact k="这次">调低，平台每笔订单少付</Fact>}
          {layerPaused ? <Fact k="批准后的比例">{next === undefined || !rateMeaning(next) ? (current ? `现在是 ${num(current)}%` : "未配置") : `${num(next)}%，恢复这一层后每 100 USDT 订单发 ${num(next)} USDT`}</Fact>
            : <Fact k="批准后实际执行">{next === undefined ? (current ? `现在是 ${rateMeaning(current)}` : "未配置") : rateMeaning(next) ?? "—"}</Fact>}
          {layerPaused ? <Fact k="示例订单里这一层">{`0 USDT（暂停中；恢复后 ${num(sampleUsdt(next !== undefined && next.trim() ? Number(next) : rate?.usdt ?? null))} USDT）`}</Fact>
            : <Fact k="示例订单里这一层">{rate ? <Change from={`${num(sampleUsdt(rate.usdt))} USDT`} to={next === undefined ? `${num(sampleUsdt(rate.usdt))} USDT` : `${num(sampleUsdt(Number(next)))} USDT`} /> : "这一层还没有规则"}</Fact>}
          {ranked ? rankedBefore && rankedAfter && <Fact k={anyPaused ? "合计含暂停层" : "七层合计占订单"}><Change from={rangeText(rankedBefore.low, rankedBefore.high)} to={rangeText(rankedAfter.low, rankedAfter.high)} /></Fact>
            : !sourceUnknown && total.before !== null && <Fact k={anyPaused ? "合计含暂停层" : "七层合计占订单"}><Change from={`${num(total.before)}%`} to={`${num(total.after)}%`} /></Fact>}
        </Facts>;
      },
      content: rate ? undefined : <Notice tone="warn" title="这一层还没有规则"><KeepText text={missingRuleCopy} /></Notice>,
      statedBrief: { impact: `另一位管理员批准后，之后新算的订单这一层按新比例算；批准前仍按 ${current ? `${num(current)}%` : "现在的设置"}，已经算好的订单不重算。`, check: COVERAGE_CHECK },
      detail: `${level} USDT 奖励比例 · 现在 ${current ? `${current}%` : "未配置"}。只影响之后的结算。`,
      completionCopy: approvalCopy("团队奖励比例"), coverageCheck: COVERAGE_CHECK, coverageLead: layerPaused ? "恢复这一层后，平台每笔订单多付钱" : "调高这一层，平台每笔订单多付钱",
      submit: async (reason, next) => { if (!next) throw new Error("请填写新值"); await ctx.updateF2Config(`F.unilevel.${level}`, next, reason); },
      done: `调整 ${level} USDT 奖励比例 已提交审批，等另一位管理员批准`,
    });
  };
  const openNex = (level: Layer) => {
    const rate = layerRate(rates, level);
    const current = rate?.nexText ?? "";
    openConfirm({
      slot: `f-config:F.unilevel.nex.${level}`,
      action: `调整 ${level} UVT 奖励系数`, title: `调整 ${level}（${LAYER_WHO[level]}）的 UVT 系数`, briefKind: "config", amplify: true, dialogClassName: "f2-confirm",
      effect: effectTag,
      edit: { kind: "number", current, min: 0, unit: "UVT / 1 USDT", amplifiesWhen: "increase",
        hint: "这一层每发 1 USDT 奖励，另发多少 UVT",
        preview: (next) => rates.length ? <LayerCompare rates={sourcesUseFirstTwo ? rates.filter(row => !rankedLevel(row.l as Layer) && !noRateSource(row.l as Layer)) : rates} level={level} next={next || current ? Number(next || current) : null} field="nex" ranked={ranked} /> : null },
      facts: (next) => <Facts>
        {next !== undefined && current && Number(next) < Number(current) && <Fact k="这次">调低，平台每笔订单少发 UVT</Fact>}
        {rankedLevel(level) ? (() => {
          const rng = rankedRange(ctx, level);
          const uvt = (factor: string) => rng && factor.trim() ? rangeText(f2DecimalTimes(pctSample(rng.min), factor.trim()), f2DecimalTimes(pctSample(rng.max), factor.trim()), "USDT").replace(/ USDT$/, " UVT") : "—";
          return <>
            <Fact k="这一层另发 UVT"><Change from={uvt(current)} to={uvt(next ?? current)} /></Fact>
            <Fact k="示例订单里这一层">{rng ? `${rangeText(pctSample(rng.min), pctSample(rng.max), "USDT")}，按受益人等级` : "—"}</Fact>
          </>;
        })() : noRateSource(level) ? <Fact k="这一层另发 UVT">—</Fact> : <Fact k="这一层另发 UVT">{rate ? <Change from={`${num(rate.usdt === null || rate.nex === null ? null : sampleUsdt(rate.usdt)! * rate.nex)} UVT`} to={`${num(rate.usdt === null || !(next ?? current).trim() ? null : sampleUsdt(rate.usdt)! * Number(next ?? current))} UVT`} /> : "这一层还没有规则"}</Fact>}
      </Facts>,
      content: rate ? undefined : <Notice tone="warn" title="这一层还没有规则"><KeepText text={missingRuleCopy} /></Notice>,
      statedBrief: { impact: "批准后，之后新算的订单这一层按新系数另发 UVT；已经算好的不重算。", check: COVERAGE_CHECK },
      detail: `${level} 每发 1 USDT 奖励，另发多少 UVT · 现在 ${current || "未配置"}。只影响之后的结算。`,
      completionCopy: approvalCopy("团队奖励比例"), coverageCheck: COVERAGE_CHECK, coverageLead: "调高这一层，平台每笔订单多发 UVT",
      submit: async (reason, next) => { if (!next) throw new Error("请填写新值"); await ctx.updateF2Config(`F.unilevel.nex.${level}`, next, reason); },
      done: `调整 ${level} UVT 奖励系数 已提交审批，等另一位管理员批准`,
    });
  };
  const openPause = () => openConfirm({
    slot: "f-config-batch:F2",
    action: "按 L1–L7 分别暂停", title: "按层暂停或恢复发放", briefKind: "config", amplify: false,
    effect: effectTag,
    businessForm: {
      kind: "multi-field",
      fields: LAYERS.map((level) => {
        const raw = m.paused(level);
        return { key: level, label: `${level} ${LAYER_WHO[level]}`, current: raw === "on" || raw === "off" ? raw : "", showDiff: true,
          inputKind: "select" as const, options: ["", "on", "off"], optionLabels: { "": "请选择", on: "暂停", off: "发放" } };
      }),
    },
    statedBrief: { impact: "七层一起提交，批准后一起生效。暂停的层，之后新算的订单这一层记 0、不补发；已经算好的不变。不影响好友设备收益奖励，也不是整体结算暂停。", check: "整组一次写入，有一项失败整组都不改。" },
    detail: "L1–L7 一起提交审批，批准后只影响之后的购买奖励，不影响好友设备收益奖励。",
    completionCopy: approvalCopy("团队奖励规则"), coverageCheck: COVERAGE_CHECK,
    submit: async (reason, _next, values) => {
      if (!values || LAYERS.some((level) => values[level] !== "on" && values[level] !== "off")) throw new Error("请选择 L1–L7 全部的暂停状态");
      await ctx.updateFConfigBatch("F2", LAYERS.map((level) => ({ key: `F.unilevel.${level}.paused`, value: values[level] })), reason);
      ctx.toast("L1–L7 暂停设置已提交审批，另一位管理员批准后生效");
    },
  });

  return (
    <Panel title="每层分多少" icon={Layers} tone="role-4" sub={`示例订单 ${num(SAMPLE_ORDER)} USDT`}
      explain={ranked ? "第 1 到 7 层的人买设备时，按层给上面的人发 USDT 奖励，另按系数加发 UVT。第 1、2 层的比例按受益人等级，在团队等级晋升设置。示例只按比例和系数算，不是真实订单。"
        : "好友（第 1 层）和好友的好友（第 2 层）……一直到第 7 层买设备时，按层给上面的人发 USDT 奖励，另按系数加发 UVT。示例金额只按比例和系数算，没算影响分、活动倍率、等级门槛和奖励总额上限，不是真实订单。"}>
      {ctx.f2DirectPolicyError && <Notice tone="warn" title="购买奖励比例来源没读到"
        action={<Button size="sm" onClick={() => void ctx.refreshF2DirectPolicy()}>重试</Button>}>{ctx.f2DirectPolicyError}</Notice>}
      {ctx.f2RankRangeError && <Notice tone="warn" title="九级购买奖励比例没读到"
        action={<Button size="sm" loading={ctx.f2RankRangeLoading} onClick={() => void ctx.refreshF2RankRange()}>重试</Button>}>{ctx.f2RankRangeError}</Notice>}
      {rates.length === 0 ? <F2Bootstrap ctx={ctx} openConfirm={openConfirm} draft={bootDraft} setDraft={setBootDraft} cap={m.cap} />
        : !complete ? <Notice tone="warn" title="七层规则不完整">{missing.length > 0 && `缺 ${missing.join("、")} 的整层规则，后台补不了，需要技术同事处理。`}{partValues && "已有的层缺比例或系数，在下表点这一层的按钮补上。"}配齐前不能启用整体结算。</Notice> : sourceUnknown ? null : (
        <Figure width={420} stack="wide" graphic={
          <div className="f2-sum-graphic">
            {ranked ? <ScaleBar label="七层合计占订单" max={axisMax} range={sumRange ? { low: Number(sumRange.low), high: Number(sumRange.high) } : undefined} target={m.cap ?? undefined} tone="role-4"
              ticks={[{ value: 0, text: "0%" }, ...(m.cap !== null && m.cap <= axisMax ? [{ value: m.cap, text: `上限 ${num(m.cap)}%` }] : []), { value: axisMax, text: `${axisMax}%` }]}
              valueText={sumRange ? `发放中的层合计按受益人等级 ${rangeText(sumRange.low, sumRange.high)}${m.cap !== null ? `，总额上限 ${num(m.cap)}%` : "，总额上限未配置"}` : "第 1、2 层的九级比例没读到，合计这次没有算"} />
              : <ScaleBar label="七层合计占订单" max={axisMax} value={activeSum} fill target={m.cap ?? undefined} tone="role-4"
                ticks={[{ value: 0, text: "0%" }, ...(m.cap !== null && m.cap <= axisMax ? [{ value: m.cap, text: `上限 ${num(m.cap)}%` }] : []), { value: axisMax, text: `${axisMax}%` }]}
                valueText={`发放中的层合计 ${num(activeSum)}%${m.cap !== null ? `，总额上限 ${num(m.cap)}%` : "，总额上限未配置"}`} />}
            <p className="f2-sum-cap">{m.cap === null ? "总额上限未配置" : `上限 ${num(m.cap)}%：${num(SAMPLE_ORDER)} USDT 订单最多分 ${num(sampleUsdt(m.cap))} USDT`}<Explain label="总额上限怎么用" content="一笔订单七层 USDT 奖励最多占订单金额的这个比例。超出时从 L1 往下分，分完为止，后面的层少发或不发；旧 UVT 系数另发的 UVT 不算在内。" /></p>
          </div>}>
          <dl className="f2-sum">
            <div><dt>{ranked && ctx.f2DirectPolicy && !ctx.f2DirectPolicy.sevenLayerEnabled ? "启用后的合计" : "发放中的层合计"}</dt>{ranked
              ? <dd data-empty={sumRange ? undefined : ""}>{sumRange ? <><strong>{rangeText(pctSample(sumRange.low), pctSample(sumRange.high), "USDT").replace(/ USDT$/, "")}</strong> USDT<span>占订单 {rangeText(sumRange.low, sumRange.high)}，按受益人等级</span>
                <Explain label="合计为什么是一段" content={`第 1、2 层按受益人等级取比例：各级比例里最低一档合计 ${num(sumRange.low)}%，最高一档合计 ${num(sumRange.high)}%。${pausedLayers.length ? `${pausedLayers.join("、")} 现在暂停，不算在内。` : ""}`} /></> : "—"}</dd>
              : <dd><strong>{num(sampleUsdt(activeSum))}</strong> USDT<span>占订单 {num(activeSum)}%</span></dd>}</div>
          </dl>
        </Figure>
      )}
      {complete && m.cap !== null && sumHigh !== null && sumHigh > m.cap && <Notice tone="warn" title={ranked ? `按比例合计最高 ${num(sumRange!.high)}%，超过总额上限 ${num(m.cap)}%` : `按比例合计 ${num(activeSum)}%，超过总额上限 ${num(m.cap)}%`}>结算时从 L1 往下分，分完 {num(sampleUsdt(m.cap))} USDT（示例）为止，后面的层少发或不发。</Notice>}
      {!booting && <Table label="团队购买奖励比例" className="f2-layer-table">
        <thead><tr>
          <Th>哪一层</Th>
          <Th align="right">USDT 比例</Th>
          <Th align="right">示例订单分到</Th>
          <Th align="right">UVT 系数</Th>
          <Th>发放</Th>
          <Th align="right">操作</Th>
        </tr></thead>
        <tbody>
          {LAYERS.map((level, index) => {
            const rate = layerRate(rates, level);
            const pausedRaw = m.paused(level);
            const direct = level === "L1";
            const gated = gateLayer >= 0 && index >= gateLayer;
            const usdtPending = pendingFor(ctx, `F.unilevel.${level}`);
            const nexPending = pendingFor(ctx, `F.unilevel.nex.${level}`);
            const nexLocked = direct && m.l1NexReadonly;
            const byRank = rankedLevel(level);
            const rng = byRank ? rankedRange(ctx, level) : null;
            return (
              <tr key={level} data-paused={pausedRaw === "on" ? "" : undefined}>
                <Td><span className="f2-layer"><span className="f2-layer-chip" data-direct={direct ? "" : undefined}>{level}</span>{LAYER_WHO[level]}</span></Td>
                <Td align="right">{noRateSource(level) ? <span className="f2-muted">—</span> : byRank ? <span className="f2-ranked"><strong>{rng ? rangeText(rng.min, rng.max) : "—"}</strong>
                  <span className="f2-ranked-sub">按受益人等级<Explain label={`${level} 比例为什么按等级`} content={rng ? rankedExplain : `${rankedExplain}九级比例这次没读到。`} /></span></span>
                  : rate?.usdt != null ? <span className="f2-rate">
                  <RatioBar compact quiet label={`${level} 比例`} value={rate.usdt ?? 0} total={barMax || 1} valueText={`${num(rate.usdtText)}%`} tone={pausedRaw === "on" ? "role-other" : "role-4"} />
                  <strong>{rate.usdt === null ? "未配置" : `${num(rate.usdtText)}%`}</strong>
                </span> : <span className="f2-muted">未配置</span>}</Td>
                <Td align="right">{noRateSource(level) ? <span className="f2-muted">—</span> : byRank ? rng ? <Cell num main={rangeText(pctSample(rng.min), pctSample(rng.max), "USDT")} /> : <span className="f2-muted">—</span>
                  : rate?.usdt != null ? <Cell num main={`${num(sampleUsdt(rate.usdt))} USDT`} sub={direct && ctx.f2DirectPolicy?.sevenLayerEnabled && ctx.f2DirectPolicy.purchaseSplit.enabled ? "按好友政策拆分" : undefined} /> : <span className="f2-muted">—</span>}</Td>
                <Td align="right">{rate?.nex != null ? <Cell num main={nexLocked ? <span className="f2-muted">{num(rate.nexText)}</span> : num(rate.nexText)} sub={nexLocked ? (ctx.f2DirectPolicy && !ctx.f2DirectPolicyError && !ctx.f2DirectPolicyLoading ? "已停用，改用拆分" : "暂不能改")
                  : noRateSource(level) ? "另发 — UVT" : byRank ? rng && rate.nexText !== null ? `另发 ${rangeText(f2DecimalTimes(pctSample(rng.min), rate.nexText), f2DecimalTimes(pctSample(rng.max), rate.nexText), "USDT").replace(/ USDT$/, "")} UVT` : "另发 — UVT"
                  : `另发 ${num(rate.usdt === null || rate.nex === null ? null : sampleUsdt(rate.usdt)! * rate.nex)} UVT`} /> : <span className="f2-muted">{rate ? "未配置" : "—"}</span>}</Td>
                <Td><span className="f2-tags">
                  {byRank && ctx.f2DirectPolicy && !ctx.f2DirectPolicy.sevenLayerEnabled ? <StatusTag tone="neutral" icon={PowerOff} explain="整体结算启用后，这一层按受益人等级发放。">未启用</StatusTag>
                    : !rate ? <StatusTag tone="neutral" explain={`这一层还没有规则，没有规则时这一层不发。${rates.length === 0 ? "七层都没有时，用上面的「首次配置」。" : "后台补不了，需要技术同事处理。"}`}>没有规则</StatusTag>
                    : rate.usdt === null || rate.nex === null ? <StatusTag tone="warn" explain={`这一层的 ${rate.usdt === null ? "USDT 比例" : "UVT 系数"} 没配置，这页看不出这一层会怎么发。${(rate.usdt === null ? direct : nexLocked) ? "这一项后台不能改，需要技术同事处理。" : `点「${rate.usdt === null ? "改比例" : "改系数"}」补上，批准后生效。`}`}>规则不完整</StatusTag>
                    : pausedRaw === "on" ? <StatusTag tone="warn" icon={PauseCircle} explain="之后新算的订单这一层记 0，不补发；已经算好的不变。">已暂停</StatusTag>
                    : pausedRaw === "off" ? <StatusTag tone="neutral" icon={ShieldCheck}>发放中</StatusTag>
                      : pausedRaw ? <StatusTag tone="danger" explain={`存的是「${pausedRaw}」，不是暂停或发放。按层暂停里重新选一次。`}>配置无效</StatusTag>
                        : <StatusTag tone="neutral" explain="暂停开关没配。按层暂停里七层都选一次。">未配置</StatusTag>}
                  {rate && gated && m.rank?.legal && <StatusTag tone="neutral" icon={Lock} explain={`上级要到 ${m.rank.normalized} 及以上才拿得到这一层；等级不够这一层记 0。`}>需 {m.rank.normalized}+</StatusTag>}
                  {(usdtPending || nexPending) && <StatusTag tone="warn" icon={Clock3} explain="等另一位管理员批准；批准前这一层不变，也不能再提交。">待审批</StatusTag>}
                </span></Td>
                <Td align="right"><span className="f2-row-actions">
                  {noRateSource(level) && direct ? <span className="f2-fixed">—</span> : byRank ? canOpenF1 ? <Link className="rd-link" href="/network/v-rank" prefetch={false}>去团队等级晋升 →</Link> : <span className="f2-fixed">在团队等级晋升设置</span>
                    : direct ? <span className="f2-fixed">比例固定<Explain label="第 1 层比例为什么改不了" content="第 1 层 USDT 比例固定 10%，后台不能改；启用整体结算时要求它是 10%。" /></span>
                    : m.canRoyaltyRate && <Button size="sm" aria-label={`调整 ${level} USDT 比例`} disabledReason={usdtPending ? "等另一位管理员批准" : ctx.f2WriteBlocked(`f-config:F.unilevel.${level}`)} onClick={() => openRate(level)}>{rate ? "改比例" : "设置比例"}</Button>}
                  {m.canRoyaltyRate && (!nexLocked ? <Button size="sm" aria-label={`调整 ${level} UVT 系数`} disabledReason={nexPending ? "等另一位管理员批准" : ctx.f2WriteBlocked(`f-config:F.unilevel.nex.${level}`)} onClick={() => openNex(level)}>改系数</Button>
                    : <Button size="sm" aria-label={`调整 ${level} UVT 系数`} disabledReason={m.l1NexStatus}>改系数</Button>)}
                  {!m.canRoyaltyRate && !direct && <span className="f2-fixed">只能查看</span>}
                </span></Td>
              </tr>
            );
          })}
          {rates.length === 0 && <TableMessage columns={6}>七层都还没有规则，不按默认比例补。</TableMessage>}
        </tbody>
      </Table>}
      <ConfigList label="对七层一起起作用的设置">
        <ConfigRow name="按层暂停" what="把某几层的团队奖励停发，其余层照常" when="批准后，对之后新算的订单生效"
          effect="暂停的层记 0、不补发；不影响好友设备收益奖励，也不是整体结算暂停" note="七层一张审批单，每层按单独修改的权限核；缺哪层的权限，「设置」上会写明。"
          value={LAYERS.every((level) => m.paused(level) === "") ? "未配置" : pausedLayers.length ? `${pausedLayers.join("、")} 已暂停` : "七层都在发放"}
          sub={pendingFor(ctx, "f-config-batch:F2") ? <StatusTag tone="warn" icon={Clock3}>待审批</StatusTag> : pausedLayers.length ? `其余 ${7 - pausedLayers.length} 层发放` : undefined}
          action={m.canPolicyAmplify ? <Button size="sm" aria-label="按 L1–L7 暂停" disabledReason={pendingFor(ctx, "f-config-batch:F2") ? "等另一位管理员批准" : ctx.f2WriteBlocked("f-config-batch:F2")} onClick={openPause}>设置</Button> : undefined} />
        <ParamRow ctx={ctx} m={m} paramKey="F.promo.weekMultiplier" openConfirm={openConfirm}
          shown={promo ? `${num(promo)} 倍` : undefined} />
      </ConfigList>
    </Panel>
  );
}

/* ───────────── 单项参数行（谁能拿到、总量和冷却共用） ───────────── */

const PARAM_HELP: Record<string, { what: string; effect: string; hint?: string; note?: string; perm: string; unit?: string }> = {
  "F.unilevel.depthGate": { what: "从哪一层起要看上级的等级", effect: "比如选 L3：L3–L7 的上级要到解锁等级才拿得到；可以选 L1", perm: "团队奖励规则" },
  "F.unilevel.depthGateRank": { what: "解锁起点及以后各层，上级至少要到的 V 等级", effect: "等级不够的上级这一层记 0", perm: "团队奖励规则" },
  "F.influence.clampMin": { what: "L2–L7 影响分的最小值", effect: "影响分按上级团队月业绩算，乘进 L2–L7 的奖励；L1 不受影响。保存时不检查下限是否不大于上限", perm: "团队奖励规则" },
  "F.influence.clampMax": { what: "L2–L7 影响分的最大值", effect: "影响分按上级团队月业绩算，乘进 L2–L7 的奖励；L1 不受影响。保存时不检查下限是否不大于上限", perm: "团队奖励规则" },
  "F.promo.weekMultiplier": { what: "活动周每层奖励再乘的倍数，含 L1", effect: "调高平台多付钱", hint: "1–3 倍", perm: "团队奖励比例", unit: "倍" },
  "F.unilevel.mergeExitMaxPct": { what: "一笔订单七层 USDT 奖励最多占订单的比例", effect: "超出时从 L1 往下分完为止；旧 UVT 系数另发的 UVT 不算在内", hint: "0–100%", perm: "团队奖励规则", unit: "%" },
};

function ParamRow({ ctx, m, paramKey, openConfirm, shown }: { ctx: FViewCtx; m: ReturnType<typeof useF2Model>; paramKey: string; openConfirm: Open; shown?: ReactNode }) {
  const help = PARAM_HELP[paramKey];
  const param = ctx.f2Params.find((row) => row.key === paramKey);
  const value = m.value(paramKey);
  const name = F2_HISTORICAL_PARAM_NAMES[paramKey];
  const enumSpec = f2EnumGateSpec(paramKey);
  const parsed = !value ? null : paramKey === "F.unilevel.depthGate" ? parseF2DepthGateLayer(value)
    : paramKey === "F.unilevel.depthGateRank" ? parseF2DepthGateRank(value) : null;
  const promo = paramKey === "F.promo.weekMultiplier";
  const merge = paramKey === "F.unilevel.mergeExitMaxPct";
  const allowed = promo ? m.canRoyaltyRate : m.canPolicyAmplify;
  const pending = pendingFor(ctx, paramKey);
  const display = parsed && !parsed.legal ? null : shown ?? (value ? `${num(value)}${help.unit === "%" ? "%" : help.unit ? ` ${help.unit}` : ""}` : null);
  const open = () => openConfirm({
    slot: `f-config:${paramKey}`,
    action: `${name}调整`, title: `调整${name.replace(/（.*）/, "")}`, briefKind: "config", amplify: promo,
    effect: effectTag,
    edit: enumSpec ? { kind: "select", current: parsed?.normalized ?? value, options: enumSpec.options, unit: enumSpec.unit }
      : { kind: "number", current: value, ...(promo ? { min: 1, max: 3, unit: "倍", amplifiesWhen: "increase" as const } : merge ? { min: 0, max: 100, unit: "%" } : {}), hint: help.hint },
    facts: parsed && !parsed.legal ? <Facts><Fact k="现在存的值" tone="danger">{value}（不是有效值）</Fact></Facts>
      : !value ? <Facts><Fact k="现在">未配置</Fact><Fact k="没配时">{SETTLEMENT_FALLBACK[paramKey].replace(/^没配[^，]*时，/, "")}</Fact></Facts> : undefined,
    statedBrief: { impact: `${help.what}。${help.effect}。批准后对之后新算的订单生效，已经算好的不重算。`, check: promo ? COVERAGE_CHECK : "核对新值；保存时不检查上下限的大小关系。" },
    detail: `${name} · 现在 ${value || "未配置"}。只影响之后的购买奖励结算。`,
    completionCopy: approvalCopy(help.perm), coverageCheck: COVERAGE_CHECK, coverageLead: "调高倍率，每层都多付钱",
    submit: async (reason, next) => { if (!next) throw new Error("请填写新值"); await ctx.updateF2Config(paramKey, next, reason); },
    done: `${name}调整 已提交审批，等另一位管理员批准`,
  });
  return (
    <ConfigRow name={name.replace(/（L1–L7）|（占订单）/, "")} what={help.what} effect={help.effect} when="批准后，对之后新算的订单生效"
      note={[parsed && !parsed.legal ? enumSpec?.illegalCopy : null, !value ? SETTLEMENT_FALLBACK[paramKey] : null, help.note].filter(Boolean).join("；") || undefined}
      value={parsed && !parsed.legal ? <span className="f2-bad"><StatusTag tone="danger" icon={Ban}>配置无效</StatusTag>{value}</span>
        : display ?? "未配置"}
      sub={pending ? <StatusTag tone="warn" icon={Clock3} explain="等另一位管理员批准；批准前按原设置执行。">待审批</StatusTag> : param?.vcls === "warn" && promo && value && Number(value) > 1 ? "活动中" : undefined}
      action={allowed ? <Button size="sm" aria-label={`调整${name}`} disabledReason={pending ? "等另一位管理员批准" : ctx.f2WriteBlocked(`f-config:${paramKey}`)} onClick={open}>{value ? "调整" : "配置"}</Button> : undefined} />
  );
}

/* ───────────── 谁能拿到 ───────────── */

export function F2Who({ ctx, openConfirm }: { ctx: FViewCtx; openConfirm: Open }) {
  const m = useF2Model(ctx);
  if (ctx.f2Loading || ctx.f2Error) return <Panel title="谁能拿到" icon={Users} tone="role-3">{ctx.f2Loading ? <BlockState state="loading" title="读取中" /> : <BlockState state="error" title="没读到，这部分没有判断" onRetry={() => void ctx.refreshF2()} />}</Panel>;
  const gateIndex = m.gate?.legal ? LAYERS.indexOf(m.gate.normalized as Layer) : -1;
  const gatedLayers = gateIndex >= 0 ? LAYERS.slice(gateIndex) : [];
  return (
    <Panel title="谁能拿到" icon={Users} tone="role-3" explain="上级拿不拿得到某一层，看等级门槛；L2–L7 拿多少还要乘影响分。">
      <div className="f2-gate">
        <ol className="f2-gate-strip" aria-label="要看等级的层">
          {LAYERS.map((level) => <li key={level} data-gated={gatedLayers.includes(level as Layer) ? "" : undefined}>
            {gatedLayers.includes(level as Layer) && <Lock size={12} aria-hidden />}{level}<span className="rd-sr-only">{gatedLayers.includes(level as Layer) ? "，要看等级" : "，不看等级"}</span>
          </li>)}
        </ol>
        <p className="f2-gate-text">{m.gate && !m.gate.legal || m.rank && !m.rank.legal ? "等级门槛配置无效，结算会停，请重新选择"
          : !m.gate || !m.rank ? "等级门槛没配齐，结算会停"
            : gateIndex === 0 ? `七层的上级都要到 ${m.rank.normalized} 及以上`
              : `${gatedLayers[0]}–L7 的上级要到 ${m.rank.normalized} 及以上；${LAYERS.slice(0, gateIndex).join("、")} 不看等级`}</p>
      </div>
      <ConfigList label="谁能拿到">
        <ParamRow ctx={ctx} m={m} paramKey="F.unilevel.depthGate" openConfirm={openConfirm} />
        <ParamRow ctx={ctx} m={m} paramKey="F.unilevel.depthGateRank" openConfirm={openConfirm} />
        <ParamRow ctx={ctx} m={m} paramKey="F.influence.clampMin" openConfirm={openConfirm} />
        <ParamRow ctx={ctx} m={m} paramKey="F.influence.clampMax" openConfirm={openConfirm} />
      </ConfigList>
    </Panel>
  );
}

/* ───────────── 总量和冷却 ───────────── */

export function F2Limits({ ctx, openConfirm }: { ctx: FViewCtx; openConfirm: Open }) {
  const m = useF2Model(ctx);
  if (ctx.f2Loading || ctx.f2Error) return <Panel title="总量和冷却" icon={Gauge} tone="role-1">{ctx.f2Loading ? <BlockState state="loading" title="读取中" /> : <BlockState state="error" title="没读到，这部分没有判断" onRetry={() => void ctx.refreshF2()} />}</Panel>;
  const coolingRaw = configuredValue(ctx.f2ConfigValues["F.cooldown"]);
  const coolingDays = /^[+-]?\d+$/.test(coolingRaw) && Number(coolingRaw) >= 0 && Number(coolingRaw) <= 90
    ? String(Number(coolingRaw)) : "";
  const coolingParam = ctx.f2Params.find((p) => p.key === "F.cooldown");
  const coolingState = coolingDays !== "" ? `${coolingDays} 天` : coolingRaw ? "配置无效，请重新配置" : "未配置";
  const pending = pendingFor(ctx, "F.cooldown");
  const deviceCooling = ctx.f2DirectPolicy?.configured ? `${ctx.f2DirectPolicy.deviceEarning.coolingDays} 天` : null;
  const openCooling = () => openConfirm({
    slot: "f-config:F.cooldown",
    action: "购买与其他奖励冷却期调整", title: "调整购买与其他奖励的冷却期", briefKind: "config", amplify: true,
    effect: effectTag,
    edit: { kind: "number", current: coolingDays, unit: "天", min: 0, max: 90, step: 1, hint: "0–90 的整数",
      ...(coolingDays !== "" ? { amplifiesWhen: "decrease" as const } : {}) },
    facts: coolingRaw && coolingDays === "" ? <Facts><Fact k="现在存的值" tone="danger">{coolingRaw}（不是 0–90 的整数）</Fact></Facts>
      : !coolingRaw ? <Facts><Fact k="现在">未配置</Fact><Fact k="没配时">{SETTLEMENT_FALLBACK["F.cooldown"].replace(/^没配[^，]*时，/, "")}</Fact></Facts> : undefined,
    statedBrief: { impact: "批准后，之后新算的购买奖励和其他团队奖励按新天数冷却；已经在冷却中的到期日不变。缩短会让钱更早能提。不影响好友设备收益奖励的冷却。", check: COVERAGE_CHECK },
    detail: `购买与其他奖励冷却期 · ${coolingState}。缩短前先看兑付覆盖率；不影响好友设备收益奖励的冷却期。`,
    completionCopy: approvalCopy("团队奖励规则"), coverageCheck: COVERAGE_CHECK, coverageLead: "缩短冷却，钱更早能提",
    submit: async (reason, next) => { if (!next) throw new Error("请填写新值"); await ctx.updateF2Config("F.cooldown", next, reason); },
    done: "购买与其他奖励冷却期调整 已提交审批，等另一位管理员批准",
  });
  return (
    <Panel title="总量和冷却" icon={Gauge} tone="role-1" explain="一笔订单最多分出多少，奖励记入后多久能提。">
      <ConfigList label="总量和冷却">
        <ParamRow ctx={ctx} m={m} paramKey="F.unilevel.mergeExitMaxPct" openConfirm={openConfirm} />
        <ConfigRow name="购买与其他奖励冷却" what="购买奖励和其他团队奖励记入后，要等几天才能提" when="批准后，对之后新算的奖励生效；已在冷却中的不重算"
          effect="缩短让钱更早能提；到期后还有冻结、风控等检查，不保证到点一定能提"
          note={[coolingRaw && coolingDays === "" ? `现在存的是「${coolingRaw}」，不是 0–90 的整数` : null, coolingDays === "" ? SETTLEMENT_FALLBACK["F.cooldown"] : null, "好友设备收益奖励的冷却单独设置，在「好友奖励政策」里改"].filter(Boolean).join("；")}
          value={coolingDays !== "" ? `${coolingDays} 天` : coolingRaw ? <span className="f2-bad"><StatusTag tone="danger" icon={Ban}>配置无效</StatusTag>{coolingRaw}</span> : "未配置"}
          sub={pending ? <StatusTag tone="warn" icon={Clock3}>待审批</StatusTag> : undefined}
          action={m.canPolicyAmplify ? <Button size="sm" aria-label="调整购买与其他奖励冷却" disabledReason={pending ? "等另一位管理员批准" : ctx.f2WriteBlocked("f-config:F.cooldown")} onClick={openCooling}>{coolingDays === "" ? "配置" : "调整"}</Button> : undefined} />
        <ConfigRow name="好友设备收益冷却" what="好友设备收益奖励记入后要等几天才能提" when="随好友奖励政策一起批准生效"
          note="这里只读，和好友奖励政策一起改"
          value={deviceCooling ?? (ctx.f2DirectPolicy ? "未配置" : "—")}
          sub={<StatusTag tone="neutral" icon={Clock3}>只读</StatusTag>}
          action={<a className="rd-link f2-nowrap" href="#f2-friend">去好友奖励政策</a>} />
      </ConfigList>
    </Panel>
  );
}

/* ───────────── 合作伙伴权益 ───────────── */

export function F2Partner({ ctx, openConfirm }: { ctx: FViewCtx; openConfirm: Open }) {
  const m = useF2Model(ctx);
  const [showTierDetails, setShowTierDetails] = useState(false);
  if (ctx.f2Loading || ctx.f2Error) return <Panel title="合作伙伴权益" icon={ShieldCheck} tone="role-3">{ctx.f2Loading ? <BlockState state="loading" title="读取中" /> : <BlockState state="error" title="没读到，这部分没有判断" onRetry={() => void ctx.refreshF2()} />}</Panel>;
  // 兼容读取旧 bronze/silver/gold，提交时只写当前 standard/verified/premium/diamond。
  const partnerTiersRaw = configuredValue(ctx.f2ConfigValues["F.partner.tiers"]);
  let thresholds = ["", "", "", ""];
  if (partnerTiersRaw) {
    try {
      const parsed = JSON.parse(partnerTiersRaw);
      const values = [parsed.standard ?? parsed.bronze, parsed.verified ?? parsed.silver, parsed.premium ?? parsed.gold, parsed.diamond];
      if (values.every((value, index) => typeof value === "number" && Number.isFinite(value) && value >= 0 && (!index || value >= values[index - 1]))) {
        thresholds = values.map(String);
      }
    } catch { /* 无效快照明确显示未配置，不补业务默认值。 */ }
  }
  const [ptStandard, ptVerified, ptPremium, ptDiamond] = thresholds;
  const partnerConfigured = thresholds.every((value) => value !== "");
  const partnerState = partnerConfigured ? `现在 ${thresholds.map((value) => `${num(value)} USD`).join(" / ")}` : partnerTiersRaw ? "配置无效，请重新配置" : "未配置";
  const pending = pendingFor(ctx, "F.partner.tiers");
  const open = () => openConfirm({
    slot: "f-config:F.partner.tiers",
    action: "调整合作伙伴权益门槛", title: "调整合作伙伴权益门槛", briefKind: "config", amplify: false,
    effect: effectTag,
    businessForm: {
      kind: "multi-field",
      hint: "从基础到钻石，门槛要逐档不降低。",
      fields: [
        { key: "standard", label: "基础档门槛(USD)", current: ptStandard, inputKind: "number", min: 0, showDiff: true },
        { key: "verified", label: "认证档门槛(USD)", current: ptVerified, inputKind: "number", min: 0, showDiff: true },
        { key: "premium", label: "高级档门槛(USD)", current: ptPremium, inputKind: "number", min: 0, showDiff: true },
        { key: "diamond", label: "钻石档门槛(USD)", current: ptDiamond, inputKind: "number", min: 0, showDiff: true },
      ],
    },
    statedBrief: { impact: "批准后保存新的四档门槛；目前只保存门槛，不会自动开通权益，也不影响任何奖励。", check: "系统检查四个都是数字且逐档不降低。" },
    detail: `合作伙伴权益门槛 · ${partnerState} · 不影响任何奖励。`,
    completionCopy: approvalCopy("团队奖励规则"), coverageCheck: COVERAGE_CHECK,
    submit: async (reason, _next, bv) => {
      if (!bv || [bv.standard, bv.verified, bv.premium, bv.diamond].some((value) => !value?.trim())) throw new Error("请填写全部 4 档");
      const standard = Number(bv.standard);
      const verified = Number(bv.verified);
      const premium = Number(bv.premium);
      const diamond = Number(bv.diamond);
      if (![standard, verified, premium, diamond].every(Number.isFinite) || [standard, verified, premium, diamond].some((n) => n < 0)) {
        throw new Error("门槛要填 0 或正数");
      }
      if (standard > verified || verified > premium || premium > diamond) {
        throw new Error("门槛要逐档不降低（基础 ≤ 认证 ≤ 高级 ≤ 钻石）");
      }
      await ctx.updateF2Config("F.partner.tiers", JSON.stringify({ standard, verified, premium, diamond }), reason);
      ctx.toast(`已提交审批，等另一位管理员批准 · 合作伙伴门槛 ${standard} / ${verified} / ${premium} / ${diamond} USD`);
    },
  });
  return (
    <Panel title="合作伙伴权益" icon={ShieldCheck} tone="role-3" sub="四档门槛 · USD"
      explain="四档门槛不改任何奖励比例。目前只保存门槛，不会自动开通权益。"
      actions={m.canPolicyAmplify ? <Button size="sm" disabledReason={pending ? "等另一位管理员批准" : ctx.f2WriteBlocked("f-config:F.partner.tiers")} onClick={open}>{partnerConfigured ? "调整权益门槛" : "配置权益门槛"}</Button> : undefined}>
      <div className="f2-stack">
      <Notice tone="warn" title="目前只保存门槛，不会自动开通权益">权益说明里的名称只是规划，不代表已经开通。</Notice>
      {partnerConfigured ? <ol className="f2-tiers" aria-label="合作伙伴四档门槛">
        {PARTNER_TIERS.map((tier, index) => <li key={tier.key}>
          <span className="f2-tier-name"><span className="f2-tier-step" data-step={index + 1} aria-hidden />{tier.name}</span>
          <span className="f2-tier-value"><strong>{num(thresholds[index])}</strong> USD</span>
        </li>)}
      </ol>
        : <BlockState state="empty" title={partnerTiersRaw ? "门槛配置无效" : "门槛未配置"} detail={partnerTiersRaw ? "存的内容读不出四个逐档不降低的数，请重新配置。" : "四档门槛都还没设置。"} />}
      {pending && <p className="f2-inline-tag"><StatusTag tone="warn" icon={Clock3}>待审批</StatusTag>等另一位管理员批准</p>}
      <div className="f2-perk-toggle">
        <Button size="sm" variant="ghost" aria-expanded={showTierDetails} aria-controls="royalty-partner-details" onClick={() => setShowTierDetails(!showTierDetails)}>{showTierDetails ? "收起权益说明" : "查看权益说明"}</Button>
      </div>
      {showTierDetails && <ul className="f2-perks" id="royalty-partner-details" aria-label="四档规划的权益">
        {PARTNER_TIERS.map((tier, index) => <li key={tier.key}><span className="f2-perk-tier">{tier.name}</span><span>{tier.perk}</span><span className="f2-muted">{thresholds[index] === "" ? "未配置" : `${num(thresholds[index])} USD 起`}</span></li>)}
      </ul>}
      </div>
    </Panel>
  );
}

/* ───────────── 旧档位和旧参数（只读） ───────────── */

export function F2Legacy({ ctx }: { ctx: FViewCtx }) {
  const legacyParams = ctx.f2Params.filter((param) => Object.hasOwn(F2_HISTORICAL_PARAM_NAMES, param.key) && !F2_VISIBLE_PARAM_KEYS.has(param.key));
  return (
    <div className="f2-legacy">
      {ctx.f2RateTiers.length > 0 && <>
        <p className="f2-legacy-title">旧档位</p>
        <ul className="f2-legacy-list" aria-label="旧档位">
          {ctx.f2RateTiers.map((tier) => <li key={operatorCopyText(tier.nm)}>
            <span>{operatorCopyText(tier.nm)}</span><span className="f2-muted">{operatorCopyText(tier.req)}</span><span>{tier.rate}</span><span className="f2-muted">{operatorCopyText(tier.dist)}</span>
          </li>)}
        </ul>
      </>}
      <p className="f2-legacy-title">旧参数</p>
      {legacyParams.length ? <ul className="f2-legacy-list" aria-label="旧参数">
        {legacyParams.map((param) => {
          const value = configuredValue(ctx.f2ConfigValues[param.key] ?? param.value);
          return <li key={param.id}><span>{F2_HISTORICAL_PARAM_NAMES[param.key]}</span><span>{value || <span className="f2-muted">未配置</span>}</span><StatusTag tone="done" icon={Ban}>已不生效</StatusTag></li>;
        })}
      </ul> : <p className="f2-muted">没有旧参数。</p>}
    </div>
  );
}

