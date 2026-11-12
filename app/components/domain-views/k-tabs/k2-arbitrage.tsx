"use client";

import { useReach } from "@/lib/nav/use-reach";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Eye, Flag, Gift, ListChecks, RefreshCw, Repeat, RotateCcw, ShieldAlert, SlidersHorizontal, TrendingUp, type LucideIcon } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, InlineRetry, IrreversibleTag, JudgmentPoints,
  Notice, PageHeader, Panel, RatioBar, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import { K1OutcomeUncertainError, newK1CommandKey, type K2Row, type K2ViewGroup, type KRiskParam } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { fetchE3Snapshot } from "@/lib/admin/e3-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { KCtx } from "./types";
import "./k2-arbitrage.css";

/** K2 标记 / 拦礼 / 看板 / 调参 / 联动冻结共用一张表,调用点 scope 已带动作类型前缀 + 目标行号 + 版本
 *  (`k2-flag:行号:版本`、`k2-param:参数键:版本:当前值`),刷新后仍能用同一命令号重试。 */
const commandAttempt = createPendingMutationStore({
  storageKey: "nexion-admin-k2-arbitrage-commands-v1",
});

function errorText(error: unknown) {
  return displayAdminError(error);
}

export function K2HeaderActions() {
  return null;
}

type TrialThreshold = { kind: "trial"; operator: string; count: string; days: string };
type GiftThreshold = { kind: "gift"; operator: string; count: string; scope: string };
type BoardThreshold = { kind: "board"; operator: string; multiplier: string; baseline: string };
type K2Threshold = TrialThreshold | GiftThreshold | BoardThreshold;
// 阈值文本里的四个基线词都是后端正则接受的存储值，检测时一律按本期全体（未标记）用户增长中位数比较，
// 所以页面只显示这一种比较方式，保存时沿用已存的基线词。
const BOARD_COMPARISON = "全体增长中位数";
const boardBaselineText = (value: string) => value.replace(/基线|上周期|7日均值|同层级均值/g, BOARD_COMPARISON);

/** 三项检测阈值：页面上的名字和气泡里的说明（后端 W05–W07 的真实口径）。 */
const K2_PARAM_HELP: Record<string, { label: string; what: string; effect: string; note?: string }> = {
  trialCycleThreshold: {
    label: "反复领试用检测线",
    what: "统计周期内，同一账户组或账户在服务器上开始试用的次数达到多少算异常。只数开始试用的次数，不要求取消或绑定邀请人。",
    effect: "调低会多出命中；调高后不再达到的未处置命中会消失。比较符选「超过」时，次数要多 1 次才算。",
  },
  welcomeGiftAnomalyThreshold: {
    label: "批量领新人礼检测线",
    what: "同一账户组里已结算的新人礼达到多少笔算异常。统计全部已结算记录，没有时间窗。",
    effect: "调低会多出命中；调高后不再达到的未处置命中会消失。",
    note: "目前只按账户组检测：选同一人或组织、手机号、设备也按账户组算，后端还没有接上这三种。",
  },
  leaderboardVelocityMultiplier: {
    label: "刷榜增速倍数",
    what: "本周佣金在最近两次快照之间的增长，超过全体正增长中位数多少倍算刷榜。已标记刷榜的账户不参与算中位数。",
    effect: "调低会多出命中；调高后不再达到的未处置命中会消失。",
  },
};

const GIFT_SCOPE_LABELS: Record<string, string> = { "实体": "同一人或组织", "账户簇": "账户组", "手机号": "手机号", "设备": "设备" };

const K2_DISPOSITION_LABELS: Record<string, string> = {
  account_flagged: "已标记套利",
  gift_blocked: "新人礼已拦截",
  leaderboard_flagged: "已标记刷榜",
  cluster_frozen: "已冻结关联账户",
};

/** 账户组状态和「多账户风险排查」同一套叫法。 */
const CLUSTER_STATUS_LABELS: Record<string, string> = { detected: "待判定", flagged: "可疑", frozen: "已冻结", released: "已解除", cleared: "正常" };

type ExtraParamDef = { key: string; label: string; unit: string; min?: number; max?: number; step?: number; options?: string[]; what: string; effect: string; hint?: string };

const SCENE_LABELS: Record<string, string> = { register: "注册", login: "登录", reset: "找回密码" };
const sceneText = (value: string) => value.split(",").map((item) => SCENE_LABELS[item.trim()] ?? item.trim()).filter(Boolean).join("、");

const OTP_GATE_PARAMS: ExtraParamDef[] = [
  { key: "otpGate.resendSeconds", label: "验证码重发冷却", unit: "秒", min: 30, max: 300, step: 1,
    what: "同一手机号两次发验证码至少隔多久。", effect: "之后的发送按新冷却判断；用户已打开的页面不会刷新倒计时。", hint: "30–300 的整数" },
  { key: "otpGate.dayLimit", label: "验证码 24h 发送上限", unit: "次/24h", min: 5, max: 50, step: 1,
    what: "同一手机号 24 小时内最多发几次验证码，注册、登录、找回密码合计。", effect: "之后的发送按新上限判断，已发的次数照算、不清零；另有短时和 IP 限制，不保证能发满。", hint: "5–50 的整数" },
  { key: "otpGate.otpTtlSeconds", label: "验证码有效期", unit: "秒", min: 60, max: 900, step: 60,
    what: "验证码签发后多久内能用。", effect: "只影响之后签发的验证码，已发出的按原有效期失效。", hint: "60–900 秒，按整分钟" },
  { key: "otpGate.maxVerifyAttempts", label: "最多输错次数", unit: "次", min: 1, max: 10, step: 1,
    what: "一条验证码最多能输错几次，超过就失效。", effect: "马上用于所有验证，包括已经发出、还没用掉的验证码：调低后，已输错次数达到新上限的验证码立即失效。", hint: "1–10 的整数" },
  {
    key: "captchaGate.alwaysScenes",
    label: "每次都要求滑块的场景",
    unit: "场景",
    options: ["register", "login", "reset", "register,login", "register,reset", "login,reset", "register,login,reset"],
    what: "在这些场景里，每次发验证码前都要先过滑块。", effect: "之后的发送按新场景判断；累计发送次数和 H5 注册的强制滑块另外照算。",
  },
  { key: "captchaGate.afterSends", label: "累计发送后要求滑块", unit: "次/24h", min: 0, max: 50, step: 1,
    what: "同一场景、同一手机号 24 小时内成功发送达到这个次数后，再发要先过滑块。", effect: "之后的发送按新次数判断，已发的次数照算。填 0 表示从第一次发送起就要滑块，不是关闭滑块。", hint: "0–50 的整数，0 表示每次都要" },
];

const OTP_UNIT_TEXT: Record<string, string> = { "秒": "秒", "次/24h": "次 / 24 小时", "次": "次", "场景": "" };

/**
 * 六项验证码设置的首次配置状态（W14）。后端在 overview.otpInitializationRequired 里逐项给出，
 * 首次生效要另一位超级管理员批准；现有读取（normalizeK2）还没带出这个字段，提交仍走普通调整。
 * 待代码 worker：接入首次配置字段和审批单状态，"required" 时改走审批提案，"pending" 时锁住入口。
 */
const OTP_FIRST_CONFIG: Partial<Record<string, "required" | "pending">> = {};

function parseK2Threshold(key: string, value: string): K2Threshold | null {
  const text = value.trim().replace(/X/g, "x");
  if (key === "trialCycleThreshold") {
    const match = text.match(/^(>=|>)\s*(\d+)\s*次\s*\/\s*(\d+)\s*天$/);
    return match ? { kind: "trial", operator: match[1], count: match[2], days: match[3] } : null;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const match = text.match(/^(>=|>)\s*(\d+)\s*笔\s*\/\s*(实体|账户簇|手机号|设备)$/);
    return match ? { kind: "gift", operator: match[1], count: match[2], scope: match[3] } : null;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const match = text.match(/^(>=|>)\s*(\d+)x\s*(基线|上周期|7日均值|同层级均值)$/);
    return match ? { kind: "board", operator: match[1], multiplier: match[2], baseline: match[3] } : null;
  }
  return null;
}

function defaultK2Threshold(key: string): K2Threshold | null {
  if (key === "trialCycleThreshold") return { kind: "trial", operator: ">=", count: "3", days: "30" };
  if (key === "welcomeGiftAnomalyThreshold") return { kind: "gift", operator: ">=", count: "2", scope: "实体" };
  if (key === "leaderboardVelocityMultiplier") return { kind: "board", operator: ">", multiplier: "5", baseline: "基线" };
  return null;
}

const OPERATOR_LABELS: Record<string, string> = { ">=": "达到（≥）", ">": "超过（>）" };
const opSign = (operator: string) => (operator === ">=" ? "≥" : operator);

function k2ParamBusinessForm(p: KRiskParam): BusinessFormSpec | null {
  const current = parseK2Threshold(p.key, p.value) ?? defaultK2Threshold(p.key);
  if (!current) return null;
  if (current.kind === "trial") {
    return {
      kind: "multi-field",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"], optionLabels: OPERATOR_LABELS },
        { key: "count", label: "开始试用次数", current: current.count, inputKind: "number", min: 2, max: 10, step: 1, help: "2–10 的整数" },
        // 后端接受 7–60 天的任意整数（K2-试用周期决定），不只四档。
        { key: "days", label: "统计周期（天）", current: current.days, inputKind: "number", min: 7, max: 60, step: 1, help: "7–60 的整数" },
      ],
    };
  }
  if (current.kind === "gift") {
    return {
      kind: "multi-field",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"], optionLabels: OPERATOR_LABELS },
        { key: "count", label: "已结算笔数", current: current.count, inputKind: "number", min: 1, max: 5, step: 1, help: "1–5 的整数" },
        { key: "scope", label: "检测范围", current: current.scope, inputKind: "select", options: ["实体", "账户簇", "手机号", "设备"], optionLabels: GIFT_SCOPE_LABELS,
          help: "目前只按账户组检测，选哪一项都按账户组算",
          explain: "后端能保存这四种范围，但检测时只按账户组统计；按同一人或组织、手机号、设备检测还没有接上。" },
      ],
    };
  }
  return {
    kind: "multi-field",
    fields: [
      { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">", ">="], optionLabels: OPERATOR_LABELS },
      { key: "multiplier", label: `增速倍数（对比${BOARD_COMPARISON}）`, current: current.multiplier, inputKind: "number", min: 2, max: 20, step: 1, help: "2–20 的整数" },
    ],
  };
}

function intValue(value: string | undefined, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function buildK2ThresholdValue(param: KRiskParam, value?: BusinessFormValue): string | null {
  const key = param.key;
  if (!value) return null;
  const operator = value.operator === ">" ? ">" : ">=";
  if (key === "trialCycleThreshold") {
    const count = intValue(value.count, 2, 10);
    const days = intValue(value.days, 7, 60);
    return count && days ? `${operator} ${count} 次 / ${days} 天` : null;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const count = intValue(value.count, 1, 5);
    const scope = ["实体", "账户簇", "手机号", "设备"].includes(value.scope ?? "") ? value.scope : null;
    return count && scope ? `${operator} ${count} 笔 / ${scope}` : null;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const multiplier = intValue(value.multiplier, 2, 20);
    const current = parseK2Threshold(key, param.value) ?? defaultK2Threshold(key);
    return multiplier && current?.kind === "board" ? `${operator} ${multiplier}x ${current.baseline}` : null;
  }
  return null;
}

/** 阈值的白话写法：「30 天内开始试用 ≥ 3 次」。读不懂的原样写。 */
function thresholdText(key: string, value: string): string {
  const parts = parseK2Threshold(key, value);
  if (!parts) return boardBaselineText(value);
  if (parts.kind === "trial") return `${parts.days} 天内开始试用 ${opSign(parts.operator)} ${parts.count} 次`;
  if (parts.kind === "gift") return `账户组已结算 ${opSign(parts.operator)} ${parts.count} 笔`;
  return `增速 ${opSign(parts.operator)} ${parts.multiplier} 倍${BOARD_COMPARISON}`;
}

function otpValueText(definition: ExtraParamDef, value: string | undefined): string {
  if (value === undefined) return "—";
  if (definition.options) return sceneText(value) || "无";
  const unit = OTP_UNIT_TEXT[definition.unit] ?? definition.unit;
  const seconds = Number(value);
  if (definition.unit === "秒" && Number.isInteger(seconds) && seconds >= 60 && seconds % 60 === 0) return `${value} 秒（${seconds / 60} 分钟）`;
  return `${value} ${unit}`;
}

// ── 四类命中：名字、列、等级怎么来（后端投影的真实口径） ──────────────────────────
type Column = { label: string; main: number; sub?: number; num?: boolean; explain?: string };
type ViewUi = { name: string; icon: LucideIcon; subject: string; objectSub?: { label: string; index: number }; what: string; levelRule: string; measure: string; columns: Column[] };

const VIEW_UI: Record<string, ViewUi> = {
  trial: {
    name: "反复领试用", icon: RotateCcw, subject: "账户组 / 账户", objectSub: { label: "关联账户", index: 2 },
    what: "统计周期内，同一账户组（没有账户组时按单个账户）在服务器上开始试用的次数达到检测线。只数开始试用的次数，不要求取消或绑定邀请人。",
    levelRule: "等于统计周期内的开始试用次数，最低 2 级、最高 5 级。",
    measure: "这一类没有金额，涉及多少按开始试用的次数算。",
    columns: [{ label: "开始试用次数", main: 1, explain: "服务器记录的开始试用次数和统计周期，不是收益金额。" }],
  },
  tradein: {
    name: "置换套利", icon: Repeat, subject: "账户",
    what: "近 30 天内同一账户完成 3 次及以上升级置换，并且同期拿到过返佣或礼金。",
    levelRule: "这一类固定为 3 级。",
    measure: "这一类没有金额，涉及多少按置换次数和返佣、礼金笔数算。",
    columns: [
      { label: "置换次数", main: 1, sub: 2 },
      { label: "返佣 / 礼金", main: 4, explain: "近 30 天里拿到的返佣和入账礼金笔数，不是金额。" },
    ],
  },
  gift: {
    name: "批量领新人礼", icon: Gift, subject: "账户组", objectSub: { label: "关联账户", index: 1 },
    what: "同一账户组里已结算的新人礼笔数达到检测线。目前只按账户组统计，统计全部已结算记录，没有时间窗。",
    levelRule: "已结算 4 笔及以上 5 级，3 笔 4 级，其余 3 级。",
    measure: "涉及金额是这组已结算新人礼的合计，USDT 和 UVT 各自四舍五入到 2 位小数。",
    columns: [
      { label: "涉及金额", main: 3, sub: 4, num: true, explain: "这组已结算新人礼的合计。后端已四舍五入到 2 位小数，页面拿不到原值。" },
      { label: "已发 / 已拦", main: 2, explain: "「已拦」目前固定写 0，不是真实的拦截笔数；拦截后也不会变。" },
    ],
  },
  board: {
    name: "排行榜刷榜", icon: TrendingUp, subject: "账户", objectSub: { label: "账户组", index: 4 },
    what: "本周佣金在最近两次快照（每 5 分钟一次）之间的增长，超过全体正增长中位数的检测倍数。",
    levelRule: "增长超过中位数 10 倍为 4 级，否则 3 级。",
    measure: "本周累计佣金和增速倍数都由后端四舍五入到 2 位小数。",
    columns: [
      { label: "本周累计佣金", main: 1, num: true, explain: "本周有效佣金的累计，后端已四舍五入到 2 位小数。" },
      { label: "增速", main: 2, sub: 3, explain: "最近一次增长是全体正增长中位数的多少倍，后端已四舍五入到 2 位小数。" },
    ],
  },
};
const VIEW_ORDER = ["trial", "tradein", "gift", "board"];
const viewUi = (view: K2ViewGroup): ViewUi => VIEW_UI[view.key] ?? { name: view.label, icon: ListChecks, subject: "对象", what: view.note, levelRule: "", measure: "", columns: [] };
const cell = (row: K2Row, index: number) => row.cells[index] ?? "—";
/** 长账户组号中间省略，留住能区分的尾段；完整的在悬停和详情里。 */
const shortId = (value: string) => (value.length > 30 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value);

/** 风险等级 0–5：2 级可疑，3 级判定异常，4、5 级高危。已处置的退成灰色，颜色留给要处理的行。 */
function levelInfo(level: number): { text: string; word: string; tone: "danger" | "warn" | "neutral"; icon: LucideIcon } {
  const word = level >= 4 ? "高危" : level === 3 ? "判定异常" : level === 2 ? "可疑" : "观察";
  const tone = level >= 3 ? "danger" : level === 2 ? "warn" : "neutral";
  return { text: `${level} 级 · ${word}`, word, tone, icon: level >= 3 ? ShieldAlert : level === 2 ? AlertTriangle : Eye };
}
/** 窄表格里只留「N 级」，等级的含义在列头的提示图标里。 */
function LevelTag({ level, settled }: { level: number; settled?: boolean }) {
  const info = levelInfo(level);
  return <StatusTag tone={settled ? "done" : info.tone} icon={info.icon}>{level} 级<span className="k2-level-word"> · {info.word}</span></StatusTag>;
}

/** 待处置的排前面，同样待处置时等级高的在前，其余保持后端顺序。 */
function byUrgency(rows: readonly K2Row[]): K2Row[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) =>
    Number(Boolean(a.row.disposition)) - Number(Boolean(b.row.disposition))
    || (a.row.disposition ? 0 : b.row.level - a.row.level)
    || a.index - b.index).map((item) => item.row);
}

const ACTION_LABELS: Record<string, string> = { flag: "标记套利", blockgift: "拦截新人礼", boardflag: "标记刷榜", freeze: "冻结关联账户", param: "调整" };

const IMMEDIATE = <StatusTag tone="progress" filled>立即生效</StatusTag>;

export function K2Arbitrage({ ctx }: { ctx: KCtx }) {
  const reach = useReach();
  const propose = usePropose();
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const hasAuthority = (authority: string) => authorities.includes(authority);
  const canWrite = hasAuthority("risk_k2_write");
  const canFlag = hasAuthority("risk_k2_row_flag");
  const canFreeze = hasAuthority("risk_k2_row_freeze");
  const canBlockGift = hasAuthority("risk_k2_row_blockgift");
  const canBoardFlag = hasAuthority("risk_k2_row_boardflag");
  const overview = ctx.risk.arbitrage;
  const views = useMemo(() => [...(overview?.views ?? [])].sort((a, b) => VIEW_ORDER.indexOf(a.key) - VIEW_ORDER.indexOf(b.key)), [overview]);
  const tabIds = useTabIds();
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  useEffect(() => { if (overview) setReadAt(Date.now()); }, [overview]);
  const allParams = overview?.params ?? [];
  const detectionParams = allParams.filter((param) => K2_PARAM_HELP[param.key]);
  const [ladderReference, setLadderReference] = useState<
    { status: "loading" } | { status: "ready"; value: string | null } | { status: "error"; message: string }
  >({ status: "loading" });
  const [ladderReferenceAttempt, setLadderReferenceAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLadderReference({ status: "loading" });
    void fetchE3Snapshot()
      .then((snapshot) => {
        const value = snapshot.params["E.tradein.ladder.credit1"];
        if (active) setLadderReference({ status: "ready", value: value && value !== "—" ? value : null });
      })
      .catch((error) => { if (active) setLadderReference({ status: "error", message: errorText(error) }); });
    return () => { active = false; };
  }, [ladderReferenceAttempt]);

  const runAction = async (scope: string, work: (commandKey: string) => Promise<void>, ok: string) => {
    const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
    commandAttempt.remember(scope, commandKey);
    setInFlight(scope);
    try {
      await work(commandKey);
      commandAttempt.forget(scope);
    } catch (error) {
      if (error instanceof K1OutcomeUncertainError) {
        ctx.toast(`结果暂未确认 · 请保留弹窗直接重试 · 命令号 ${error.commandKey}`);
      } else {
        commandAttempt.forget(scope);
        ctx.toast(`操作失败，没有生效，已填写的内容还在 · ${errorText(error)}`);
      }
      throw error;
    } finally {
      setInFlight(null);
    }
    try {
      await ctx.reloadKRisk();
      ctx.toast(ok);
    } catch {
      ctx.toast(`${ok}，但页面刷新失败；请点「重新加载」核对`);
    }
  };

  const proposeK2Freeze = async (r: K2Row, reason: string) => {
    const scope = `k2-freeze:${r.rowId}:${r.version}:${r.clusterVersion ?? -1}`;
    const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
    commandAttempt.remember(scope, commandKey);
    const def = findHighOp("k2_row_freeze")!;
    setInFlight(scope);
    try {
      const result = await propose(ctx.toast, {
        action: `冻结关联账户 · ${r.cells[0]}`,
        obj: r.rowId,
        before: "已标记可疑",
        after: "冻结关联账户",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "K2",
        commandKey,
        command: def.buildCommand({
          rowId: r.rowId,
          expectedVersion: r.version,
          clusterExpectedVersion: r.clusterVersion,
        }),
        target: def.buildTarget({ rowId: r.rowId }),
      });
      commandAttempt.forget(scope);
      return result;
    } catch (error) {
      if (!isA2OutcomeUncertainError(error)) commandAttempt.forget(scope);
      throw error;
    } finally {
      setInFlight(null);
    }
  };

  /** 确认框里的事实：是谁、凭什么、涉及多少。四个行操作共用。 */
  const rowFacts = (r: K2Row) => {
    const view = views.find((item) => item.key === r.viewKey);
    const ui = view ? viewUi(view) : undefined;
    const evidence = ui?.columns[0];
    return (
      <Facts>
        <Fact k={ui?.subject ?? "对象"}>{cell(r, 0)}</Fact>
        <Fact k="命中类别">{ui?.name ?? r.viewKey}</Fact>
        {evidence && <Fact k={evidence.label}>{cell(r, evidence.main)}</Fact>}
        <Fact k="风险等级" tone={levelInfo(r.level).tone === "neutral" ? undefined : levelInfo(r.level).tone}>{levelInfo(r.level).text}</Fact>
        {r.clusterId && (r.clusterId === cell(r, 0)
          ? <Fact k="账户组状态">{CLUSTER_STATUS_LABELS[r.clusterStatus ?? ""] ?? "状态未知"}</Fact>
          : <Fact k="账户组">{r.clusterId}{r.clusterStatus ? `（${CLUSTER_STATUS_LABELS[r.clusterStatus] ?? r.clusterStatus}）` : ""}</Fact>)}
      </Facts>
    );
  };

  const markArb = (r: K2Row) =>
    ctx.openConfirm({ briefKind: "judgment",
      errorHandled: true,
      action: `标记套利账户 · ${r.cells[0]}`,
      title: "标记套利账户",
      detail: "标记为套利并附上证据，不冻结、不动钱。之后相关账户不再获得新人礼和邀请奖励。",
      effect: <>{IMMEDIATE}<IrreversibleTag>本页不能撤销</IrreversibleTag></>,
      content: rowFacts(r),
      statedBrief: {
        impact: "这条命中记为已标记套利并发出套利风险信号。不冻结账户、不扣已到账的钱；之后这些账户及其邀请人、同账户组成员不再获得新人礼和邀请奖励。",
        check: "核对对象、命中依据和等级；理由写清核查依据。本页没有撤销入口。",
      },
      reasonPlaceholder: "写清核查依据，例如：同一设备多次开试用、客服工单号",
      reason: true,
      okLabel: "确认标记",
      run: (reason) => runAction(
        `k2-flag:${r.rowId}:${r.version}`,
        (commandKey) => ctx.actions.executeK2Action(r.rowId, "flag", r.version, undefined, reason, commandKey),
        `${r.cells[0]} 已标记套利`,
      ),
    });

  const blockGift = (r: K2Row) =>
    ctx.openConfirm({ briefKind: "record",
      errorHandled: true,
      action: `拦截新人礼 · ${r.cells[0]}`,
      title: "拦截新人礼",
      detail: "之后不再给这组账户发新人礼和邀请奖励，已到账的不动。",
      effect: <>{IMMEDIATE}<IrreversibleTag>本页不能撤销</IrreversibleTag></>,
      content: rowFacts(r),
      statedBrief: {
        impact: "之后这组账户及其邀请人、同账户组成员的新人礼和邀请奖励不再发放；已到账的不追回，不冻结账户。表里的「已拦」笔数不会因此变化。",
        check: "核对账户组、已结算笔数和涉及金额；理由写清核查依据。本页没有撤销入口。",
      },
      reasonPlaceholder: "写清核查依据，例如：同一账户组集中领取、客服工单号",
      reason: true,
      okLabel: "确认拦截",
      run: (reason) => runAction(
        `k2-blockgift:${r.rowId}:${r.version}`,
        (commandKey) => ctx.actions.executeK2Action(r.rowId, "blockgift", r.version, undefined, reason, commandKey),
        `${r.cells[0]} 的后续新人礼已拦截`,
      ),
    });

  const boardFlag = (r: K2Row) =>
    ctx.openConfirm({ briefKind: "judgment",
      errorHandled: true,
      action: `标记刷榜账户 · ${r.cells[0]}`,
      title: "标记刷榜账户",
      detail: "标记为刷榜，作为排行榜的风险证据；取消排行榜资格要去「奖励池、名额与排行榜」操作。",
      effect: <>{IMMEDIATE}<IrreversibleTag>本页不能撤销</IrreversibleTag></>,
      content: rowFacts(r),
      statedBrief: {
        impact: "记为已标记刷榜，作为「奖励池、名额与排行榜」的风险证据。不取消榜单资格、不从奖池剔除；这个账户已经发过刷榜信号的，不会再发新通知。",
        check: "核对账户、本周累计佣金和增速；取消资格要去「奖励池、名额与排行榜」。本页没有撤销入口。",
      },
      reasonPlaceholder: "写清核查依据，例如：邀请集中在同一时段、客服工单号",
      reason: true,
      okLabel: "确认标记",
      run: (reason) => runAction(
        `k2-boardflag:${r.rowId}:${r.version}`,
        (commandKey) => ctx.actions.executeK2Action(r.rowId, "boardflag", r.version, undefined, reason, commandKey),
        `${r.cells[0]} 已标记刷榜`,
      ),
    });

  const linkFreeze = (r: K2Row) =>
    ctx.openActionConfirm({ briefKind: "security",
      action: `冻结关联账户 · ${r.cells[0]}`,
      title: "冻结关联账户",
      detail: `冻结 ${r.cluster || r.rowId} 这组关联账户，套利证据会一起记入操作记录。`,
      effect: <StatusTag tone="progress" filled explain="另一位有冻结和审批权限的管理员批准后才执行，不能自己批。批准前账户、登录和提现都不变。">批准后生效</StatusTag>,
      confirmLabel: "提交冻结审批",
      facts: (
        <Facts>
          <Fact k="账户组">{r.clusterId || "—"}</Fact>
          <Fact k="账户组状态"><Change from={CLUSTER_STATUS_LABELS[r.clusterStatus ?? ""] ?? "—"} to="已冻结" /></Fact>
          {cell(r, 0) !== r.clusterId && <Fact k="命中对象">{cell(r, 0)}</Fact>}
          <Fact k="风险等级" tone={levelInfo(r.level).tone === "neutral" ? undefined : levelInfo(r.level).tone}>{levelInfo(r.level).text}</Fact>
        </Facts>
      ),
      statedBrief: {
        impact: "批准后：这组里状态正常的账户全部冻结，登录会话失效，待处理的提现一并冻结；已注销等非正常账户不受影响。不会到期自动解冻，误判要到「多账户风险排查」解除。",
        check: "核对账户组和命中依据。提交后生成待审批单，批准执行前本页的命中仍显示为待处置。",
      },
      reasonPlaceholder: "写清冻结依据，例如：同一账户组反复领试用并已核实",
      reasonMax: 200,
      run: (reason) => proposeK2Freeze(r, reason),
    });

  const adjParam = (p: KRiskParam) => {
    const businessForm = k2ParamBusinessForm(p);
    if (!businessForm) {
      ctx.toast(`${p.name} 暂时不能在这里修改`);
      return;
    }
    const help = K2_PARAM_HELP[p.key];
    ctx.openActionConfirm({ briefKind: "config",
      action: `调整检测阈值 · ${p.name}`,
      title: `调整${help?.label ?? p.name}`,
      detail: `${p.name} · 当前 ${boardBaselineText(p.value)}。${help?.what ?? p.note}`,
      effect: IMMEDIATE,
      confirmLabel: "确认调整",
      // 检测阈值不动钱，后端也不查覆盖率，不挂「多付钱」提示（后端事实：三阈值摘要不符）。
      amplifies: false,
      facts: (
        <Facts>
          <Fact k="现在">{thresholdText(p.key, p.value)}</Fact>
          {help?.note && <Fact k="检测范围" tone="warn">目前只按账户组检测</Fact>}
        </Facts>
      ),
      statedBrief: {
        impact: `保存后下一次检测（约每分钟一次，打开本页时也会检测）就按新检测线重算，已有记录也会重新判定。${help?.effect ?? ""}`,
        check: "核对新检测线和统计口径；直接生效，不走审批。",
      },
      reasonPlaceholder: "写清调整依据，例如：近一周误报多、工单号",
      businessForm,
      reasonMax: 200,
      run: (reason, _newVal, businessValue) => {
        const nextValue = buildK2ThresholdValue(p, businessValue);
        if (!nextValue) {
          ctx.toast(`${p.name} 参数不完整或超出范围`);
          return;
        }
        return runAction(
          `k2-param:${p.key}:${p.version}:${p.value}`,
          (commandKey) => ctx.actions.updateK2Param(p.key, nextValue, p.version, reason, commandKey),
          `${p.name} 已更新为 ${boardBaselineText(nextValue)}`,
        );
      },
    });
  };

  const adjExtraParam = (definition: ExtraParamDef) => {
    const param = allParams.find((item) => item.key === definition.key);
    if (!param) {
      ctx.toast(`${definition.label} 加载失败，请刷新后重试`);
      return;
    }
    const firstConfig = OTP_FIRST_CONFIG[definition.key] === "required";
    const unit = OTP_UNIT_TEXT[definition.unit] ?? definition.unit;
    ctx.openActionConfirm({ briefKind: "config",
      action: `调整验证码设置 · ${definition.label}`,
      title: firstConfig ? `首次配置${definition.label}` : `调整${definition.label}`,
      detail: `${definition.label} · 当前 ${param.value} ${definition.unit}。${definition.what}`,
      effect: firstConfig
        ? <StatusTag tone="progress" filled explain="首次配置要另一位超级管理员批准后才写入，不能自己批。批准前 App 仍按系统默认值处理。">批准后生效</StatusTag>
        : IMMEDIATE,
      confirmLabel: firstConfig ? "提交审批" : "确认调整",
      amplifies: false,
      facts: firstConfig ? <Facts><Fact k="现在" tone="warn">还没有正式配置，按系统默认 {otpValueText(definition, param.value)} 处理</Fact></Facts> : undefined,
      edit: definition.options
        ? { kind: "select", current: param.value, options: definition.options, optionLabels: Object.fromEntries(definition.options.map((option) => [option, sceneText(option)])) }
        : { kind: "number", current: param.value, unit, min: definition.min, max: definition.max, step: definition.step, hint: definition.hint },
      statedBrief: {
        impact: `${firstConfig ? "批准后写入。" : ""}${definition.effect}`,
        check: firstConfig ? "这项还没有正式配置，首次生效要另一位超级管理员批准。" : "核对新值；直接生效，不走审批。",
      },
      reasonPlaceholder: "写清调整依据，例如：短信成本上升、被刷验证码的工单号",
      reasonMax: 200,
      // 待代码 worker：firstConfig 时改走 W14 首次配置审批提案；现在和普通调整一样提交。
      run: (reason, value) => {
        if (value == null || value === "") return;
        const backendValue = value;
        return runAction(
          `k2-param:${definition.key}:${param.version}:${param.value}`,
          (commandKey) => ctx.actions.updateK2Param(definition.key, backendValue, param.version, reason, commandKey),
          `${definition.label} 已更新为 ${value} ${definition.unit}`,
        );
      },
    });
  };

  const reload = () => void ctx.reloadKRisk().catch(() => undefined);
  const canAnyWrite = canWrite || canFlag || canFreeze || canBlockGift || canBoardFlag;
  const header = (
    <PageHeader pageId="K2" title="异常套利与刷量排查" summary="找出反复领试用、置换套利、批量领新人礼和刷榜的账户，核对证据后处置。"
      meta={readAt && overview && !ctx.contentError ? `读取于 ${formatBusinessTimeFull(new Date(readAt).toISOString())}（${businessZone().label}）· 打开时检测，手动刷新` : undefined}
      readOnly={canAnyWrite ? undefined : "当前账号只能查看这页"}
      actions={<Button icon={<RefreshCw size={14} aria-hidden />} loading={ctx.contentLoading && Boolean(overview)} onClick={reload}>刷新</Button>} />
  );

  if (ctx.contentLoading && !overview) {
    return <>{header}<BlockState state="loading" title="正在读取并检测命中" /></>;
  }

  if (ctx.contentError) {
    return (
      <>{header}
        <div data-module-health-state="error">
          <BlockState state="error" title="套利与刷量数据加载失败" detail={errorText(ctx.contentError).includes("已隐藏数据") ? errorText(ctx.contentError) : `${errorText(ctx.contentError)} 为避免误操作，已隐藏数据和操作按钮。`} onRetry={reload} retrying={ctx.contentLoading} retryLabel="重新加载" />
        </div>
      </>
    );
  }

  if (!overview) {
    return <>{header}<BlockState state="empty" title="暂无套利与刷量数据" /></>;
  }

  const stat = (key: string) => overview.stats.find((item) => item.key === key)?.value ?? "—";
  const summaries = views.map((view) => {
    const pendingRows = view.rows.filter((row) => !row.disposition);
    const maxPending = pendingRows.reduce((max, row) => Math.max(max, row.level), -1);
    const maxLevel = view.rows.reduce((max, row) => Math.max(max, row.level), -1);
    return { view, ui: viewUi(view), total: view.rows.length, pending: pendingRows.length, maxPending, maxLevel, high: pendingRows.filter((row) => row.level >= 4).length };
  });
  const totalRows = summaries.reduce((sum, item) => sum + item.total, 0);
  const totalPending = summaries.reduce((sum, item) => sum + item.pending, 0);
  const totalHigh = summaries.reduce((sum, item) => sum + item.high, 0);
  // 先处理哪一类：待处置里等级最高的，一样高时待处置多的。
  const urgent = summaries.filter((item) => item.pending > 0).sort((a, b) => b.maxPending - a.maxPending || b.pending - a.pending)[0];
  const currentKey = views.some((view) => view.key === viewKey) ? viewKey! : urgent?.view.key ?? (views.find((view) => view.key === "trial") ?? views[0])?.key;
  const current = summaries.find((item) => item.view.key === currentKey);
  const rows = current ? byUrgency(current.view.rows) : [];
  const openRow = rows.find((row) => row.rowId === openRowId) ?? null;
  const openIndex = openRow ? rows.indexOf(openRow) : -1;
  const selectView = (key: string) => { setViewKey(key); setOpenRowId(null); };
  const onCardKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabValue(views.map((view) => view.key), currentKey ?? "", event.key);
    if (next === null) return;
    event.preventDefault();
    selectView(next);
    document.getElementById(tabIds.tab(next))?.focus();
  };

  const conclusionExplain = (
    <>
      <p>按命中记录计数，不按用户去重；同一账户可能在几类里各有一条。</p>
      <p>风险等级 0–5 级：2 级可疑，3 级判定异常，4、5 级高危。全部命中里 3 级及以上 {stat("loopConfirmed")} 条、2 级 {stat("loopWarn")} 条（含已处置）。</p>
      <p>系统约每分钟检测一次，打开本页时也会检测。</p>
    </>
  );
  const conclusion = totalPending > 0
    ? <Conclusion state="warn" lead explain={conclusionExplain} hint={urgent ? `先看「${urgent.ui.name}」：表里待处置的排在前面，等级高的在上。` : undefined}>
        有 <b>{totalPending}</b> 条命中待处置{totalHigh > 0 ? `，其中 ${totalHigh} 条为 4 级以上高危` : ""}
      </Conclusion>
    : totalRows > 0
      ? <Conclusion state="neutral" explain={conclusionExplain}>命中都已处置，共 {totalRows} 条</Conclusion>
      : <Conclusion state="ok" explain={<><p>这是系统检测的结果，不是读取失败。</p><p>系统约每分钟检测一次，打开本页时也会检测。</p></>}>现在没有检出异常套利和刷量</Conclusion>;

  // 结果未确认的写操作：命令号还留在本标签页，重新提交同一操作会用同一命令号。
  const pendingRecords = commandAttempt.list().filter((record) => record.fingerprint !== inFlight);
  const allRows = views.flatMap((view) => view.rows);
  const pendingNotices = pendingRecords.map((record) => {
    const [kind, target, version, extra] = record.fingerprint.split(":");
    const action = kind.replace(/^k2-/, "");
    const row = action === "param" ? undefined : allRows.find((item) => item.rowId === target);
    const param = action === "param" ? allParams.find((item) => item.key === target) : undefined;
    const otp = OTP_GATE_PARAMS.find((item) => item.key === target);
    const name = action === "param" ? `调整${K2_PARAM_HELP[target]?.label ?? otp?.label ?? param?.name ?? target}` : ACTION_LABELS[action] ?? action;
    const object = row ? cell(row, 0) : action === "param" ? undefined : target;
    const sameRow = row && String(row.version) === version && !row.disposition && (action !== "freeze" || String(row.clusterVersion ?? -1) === extra);
    const sameParam = param && String(param.version) === version && record.fingerprint === `k2-param:${param.key}:${param.version}:${param.value}`;
    const retry = sameRow
      ? () => (action === "flag" ? markArb(row) : action === "blockgift" ? blockGift(row) : action === "boardflag" ? boardFlag(row) : linkFreeze(row))
      : sameParam ? () => (otp ? adjExtraParam(otp) : adjParam(param)) : undefined;
    const allowed = action === "flag" ? canFlag : action === "blockgift" ? canBlockGift : action === "boardflag" ? canBoardFlag : action === "freeze" ? canFreeze : canWrite;
    return (
      <Notice key={record.fingerprint} tone="warn" actionBelow
        title={<>{name}{object ? ` · ${object}` : ""} · 结果未确认</>}
        action={<>
          {allowed && <Button size="sm" disabledReason={retry ? undefined : "这条记录已经变了，到「操作记录与审批」核对原操作"} onClick={retry}>按原操作重试</Button>}
          {reach("/platform/audit", "platform_a2_read") ? <Link className="rd-link" href="/platform/audit">到「操作记录与审批」核对</Link> : null}
        </>}>
        <p>系统可能已经执行。重新提交同一操作会沿用命令号 <span data-mono="">{record.commandKey}</span>，不会执行两次；原理由没有保存，要填和上次完全一样的理由，否则会被拒绝。超过 24 小时不能再重试。</p>
      </Notice>
    );
  });

  const rowActions = (r: K2Row, size: "sm" | "md") => {
    if (r.disposition) return null;
    const buttons = r.actions.map((action) => {
      if (action === "flag") return canFlag ? <Button key={action} size={size} onClick={() => markArb(r)}>标记套利</Button> : null;
      if (action === "blockgift") return canBlockGift ? <Button key={action} size={size} onClick={() => blockGift(r)}>拦截新人礼</Button> : null;
      if (action === "boardflag") return canBoardFlag ? <Button key={action} size={size} onClick={() => boardFlag(r)}>标记刷榜</Button> : null;
      if (action === "freeze") {
        if (!canFreeze) return null;
        const ready = r.clusterStatus === "flagged" && r.clusterVersion !== undefined;
        return <Button key={action} size={size} variant="danger-outline" disabledReason={ready ? undefined : "这组账户要先在「多账户风险排查」标记为可疑，才能提交冻结"} onClick={() => linkFreeze(r)}>冻结关联账户</Button>;
      }
      return <StatusTag key={action} tone="warn" icon={AlertTriangle}>无法识别的操作，已暂停</StatusTag>;
    }).filter(Boolean);
    return buttons.length ? buttons : null;
  };

  const dispositionCell = (r: K2Row) => {
    if (r.disposition) return <StatusTag tone="done" icon={CheckCircle2}>{K2_DISPOSITION_LABELS[r.disposition] ?? "已处置"}</StatusTag>;
    const buttons = rowActions(r, "sm");
    return buttons ? <span className="k2-row-actions">{buttons}</span> : <StatusTag tone="neutral">待处置</StatusTag>;
  };

  const ui = current?.ui;
  const tableColumns = 3 + (ui?.columns.length ?? 0);
  const panelSub = current ? (current.total ? `共 ${current.total} 条 · ${current.pending} 条待处置` : "没有命中") : undefined;

  const freezeBlocked = openRow && openRow.actions.includes("freeze") && canFreeze && !openRow.disposition && !(openRow.clusterStatus === "flagged" && openRow.clusterVersion !== undefined);
  const drawerButtons = openRow ? rowActions(openRow, "md") : null;
  const drawerFreeze = drawerButtons?.find((node) => (node as { key?: string }).key === "freeze");
  const drawerOthers = drawerButtons?.filter((node) => (node as { key?: string }).key !== "freeze");

  return (
    <>
      {header}
      {conclusion}
      {pendingNotices}

      <StatBand cards role="tablist" label="套利检测命中视图">
        {summaries.map((item) => {
          const selected = item.view.key === currentKey;
          const Icon = item.ui.icon;
          const extraRow = item.view.key === "gift"
            ? { k: "已拦截新人礼", v: `${stat("giftBlockedCnt")} 条`, explain: "处置为「拦截新人礼」的命中记录数，不是拦下的礼金笔数或金额。" }
            : item.view.key === "board"
              ? { k: "刷榜信号", v: `${stat("boardSignals")} 条`, explain: "本周刷榜命中的记录数，含已处置的，不是通知次数。处置排行榜资格在「奖励池、名额与排行榜」。" }
              : undefined;
          return (
            <Stat key={item.view.key}
              head={<span className="k2-card-head"><Icon size={16} aria-hidden />{item.ui.name}{item.view.key === urgent?.view.key && <StatusTag tone="warn" icon={Flag}>先处理</StatusTag>}</span>}
              label="待处置" value={String(item.pending)} unit="条" sub={`共 ${item.total} 条`}
              tone={item.pending > 0 ? "warn" : undefined}
              selected={selected} selectedText="正在查看" onOpen={() => selectView(item.view.key)}
              openLabel={`${item.ui.name}，待处置 ${item.pending} 条，共 ${item.total} 条`}
              role="tab" id={tabIds.tab(item.view.key)} aria-selected={selected} aria-controls={tabIds.panelId(item.view.key)}
              tabIndex={selected ? 0 : -1} onKeyDown={onCardKey}>
              <RatioBar quiet label="已处置" value={item.total - item.pending} total={item.total} valueText={`已处置 ${item.total - item.pending} 条，共 ${item.total} 条`} tone="role-2"
                state={item.total === 0 ? "empty" : undefined} emptyText="没有命中" />
              <dl className="rd-stat-rows">
                <div className="rd-stat-row"><dt>最高风险等级</dt><dd data-empty={item.maxLevel < 0 ? "" : undefined}>{item.maxLevel < 0 ? "—" : <LevelTag level={item.maxLevel} settled={item.maxPending < 0} />}</dd></div>
                {extraRow && <div className="rd-stat-row"><dt>{extraRow.k}<Explain label={`${extraRow.k}的说明`} content={extraRow.explain} /></dt><dd>{extraRow.v}</dd></div>}
              </dl>
            </Stat>
          );
        })}
      </StatBand>

      {current && ui && (
        <Panel {...tabIds.panel(current.view.key)} title={ui.name} icon={ui.icon} tone="role-3" sub={panelSub} flush
          explain={<><p>{ui.what}</p><p>{ui.measure}</p><p>风险等级：{ui.levelRule}</p><p>全部命中一次读出，不分页；待处置的排前面，等级高的在上。</p></>}>
          <Table label={`${ui.name}命中`} className="k2-hits" data-view={current.view.key}>
            <thead>
              <tr>
                <Th>{ui.subject}</Th>
                {ui.columns.map((column) => <Th key={column.label} align={column.num ? "right" : undefined}>{column.label}{column.explain && <Explain label={`${column.label}的说明`} content={column.explain} />}</Th>)}
                <Th>风险等级<Explain label="风险等级的说明" content={<><p>0–5 级：2 级可疑，3 级判定异常，4、5 级高危。</p><p>{ui.levelRule}</p></>} /></Th>
                <Th align="right" sticky="end">处置</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.rowId} selected={r.rowId === openRowId} onOpen={() => setOpenRowId(r.rowId)} aria-label={`查看命中 ${cell(r, 0)} 的详情`}>
                  <Td><Cell mono main={shortId(cell(r, 0))} sub={ui.objectSub ? cell(r, ui.objectSub.index) : undefined} title={cell(r, 0)} /></Td>
                  {ui.columns.map((column) => (
                    <Td key={column.label} align={column.num ? "right" : undefined}><Cell num={column.num} main={cell(r, column.main)} sub={column.sub !== undefined ? cell(r, column.sub) : undefined} /></Td>
                  ))}
                  <Td><LevelTag level={r.level} settled={Boolean(r.disposition)} /></Td>
                  <Td align="right" sticky="end">{dispositionCell(r)}</Td>
                </Tr>
              ))}
              {!rows.length && <TableMessage columns={tableColumns} role="status">这一类现在没有命中。系统约每分钟检测一次，有新命中会列在这里。</TableMessage>}
            </tbody>
          </Table>
        </Panel>
      )}

      <Fold title="检测参数" icon={SlidersHorizontal} tone="role-4" open={paramsOpen} onOpenChange={setParamsOpen}
        summary={`${detectionParams.length} 项检测线 · ${OTP_GATE_PARAMS.length} 项验证码与滑块`}
        explain="检测线决定哪些记录算异常，改了下一次检测就按新值重算。验证码与滑块是注册、登录、找回密码共用的发码限制。这两组都是保存后立即生效，不走审批。">
        <div className="k2-param-groups">
        <Panel plain headingLevel={3} title="检测线" explain="改了之后，下一次检测（约每分钟一次）就按新值重算已有记录，命中会随之增减。">
          <ConfigList label="检测线">
            {detectionParams.map((p) => {
              const help = K2_PARAM_HELP[p.key];
              return (
                <ConfigRow key={p.key} name={help.label} explainLabel={`${help.label}的说明`}
                  what={help.what} when="保存后下一次检测起" effect={help.effect} note={help.note}
                  value={thresholdText(p.key, p.value)}
                  sub={p.key === "welcomeGiftAnomalyThreshold" ? <StatusTag tone="warn" icon={AlertTriangle}>目前只按账户组检测</StatusTag> : undefined}
                  action={canWrite ? <Button size="sm" aria-label={`调整${p.name}`} onClick={() => adjParam(p)}>调整</Button> : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
        <Panel plain headingLevel={3} title="验证码与滑块" explain="注册、登录、找回密码共用。H5 注册的专项限制在「多账户风险排查」里维护。" data-proof="k2-otp-gate-params">
          <ConfigList label="验证码与滑块">
            {OTP_GATE_PARAMS.map((definition) => {
              const param = allParams.find((item) => item.key === definition.key);
              const firstConfig = OTP_FIRST_CONFIG[definition.key];
              return (
                <ConfigRow key={definition.key} name={definition.label} explainLabel={`${definition.label}的说明`}
                  what={definition.what} when={firstConfig ? "首次配置要另一位超级管理员批准后才生效" : "保存后立即生效"} effect={definition.effect}
                  value={otpValueText(definition, param?.value)}
                  sub={firstConfig === "required" ? <StatusTag tone="warn" icon={AlertTriangle} explain="这项还没有正式配置，现在按系统默认值处理。首次生效要另一位超级管理员批准。">未正式配置</StatusTag>
                    : firstConfig === "pending" ? <StatusTag tone="progress" explain="首次配置已提交，等另一位超级管理员批准；批准前按系统默认值处理。">首次配置待审批</StatusTag> : undefined}
                  action={canWrite ? <Button size="sm" aria-label={`调整${definition.label}`} disabledReason={!param ? "这项没有读到，请刷新后重试" : firstConfig === "pending" ? "首次配置待审批，批准或驳回后才能再改" : undefined} onClick={() => adjExtraParam(definition)}>{firstConfig === "required" ? "首次配置" : "调整"}</Button> : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
        <Panel plain headingLevel={3} title="相关设置" explain="这两项归别的页面管，这里只读。">
          <ConfigList label="相关设置">
            <ConfigRow name="升级置换首档抵扣" explainLabel="升级置换首档抵扣的说明" what="升级置换第一档的抵扣比例，和置换套利有关。" where="在「设备使用与升级置换」设置，这里只读。"
              value={ladderReference.status === "loading" ? "读取中…"
                : ladderReference.status === "error" ? <span className="k2-ref-failed" role="alert" title={ladderReference.message}>没有读到抵扣比例 <InlineRetry label="重试" onRetry={() => setLadderReferenceAttempt((attempt) => attempt + 1)} /></span>
                : <>{ladderReference.value === null ? "未提供" : `${ladderReference.value}%`}{reach("/devices/trade-in", "device_e3_read") && <> · <Link className="rd-link" href="/devices/trade-in">设备使用与升级置换</Link></>}</>} />
            <ConfigRow name="新人礼金额与发放规则" explainLabel="新人礼金额与发放规则的说明" what="新人礼和邀请奖励发多少、怎么发。" where="在「新人礼与邀请奖励」设置，本页不改金额。"
              value={reach("/growth/referral-rewards", "growth_h8_read") ? <Link className="rd-link" href="/growth/referral-rewards">新人礼与邀请奖励</Link> : "新人礼与邀请奖励（没有查看权限）"} />
          </ConfigList>
        </Panel>
        </div>
      </Fold>

      <Drawer open={Boolean(openRow)} onClose={() => setOpenRowId(null)} title="命中详情" sub={openRow ? cell(openRow, 0) : undefined} icon={ui?.icon} tone="role-3"
        nav={{ hasPrev: openIndex > 0, hasNext: openIndex >= 0 && openIndex < rows.length - 1, onPrev: () => setOpenRowId(rows[openIndex - 1]?.rowId ?? null), onNext: () => setOpenRowId(rows[openIndex + 1]?.rowId ?? null) }}
        footer={openRow && !openRow.disposition && drawerButtons ? <Decision danger={drawerFreeze} primary={drawerOthers?.length ? drawerOthers : undefined}
          explain="标记套利、拦截新人礼、标记刷榜立即生效，本页不能撤销；冻结关联账户要另一位管理员批准。" /> : undefined}>
        {openRow && ui && (
          <>
            <JudgmentPoints rows={[
              { label: ui.subject, value: cell(openRow, 0) },
              ...(ui.objectSub && ui.objectSub.label !== "账户组" ? [{ label: ui.objectSub.label, value: cell(openRow, ui.objectSub.index) }] : []),
              { label: "风险等级", value: <LevelTag level={openRow.level} settled={Boolean(openRow.disposition)} />, reason: ui.levelRule },
              ...ui.columns.map((column) => ({ label: column.label, value: column.sub !== undefined ? `${cell(openRow, column.main)} · ${cell(openRow, column.sub)}` : cell(openRow, column.main), reason: column.explain })),
              { label: openRow.clusterId && openRow.clusterId === cell(openRow, 0) ? "账户组状态" : "账户组", value: !openRow.clusterId ? "没有关联账户组"
                : openRow.clusterId === cell(openRow, 0) ? CLUSTER_STATUS_LABELS[openRow.clusterStatus ?? ""] ?? "状态未知"
                : `${openRow.clusterId}（${CLUSTER_STATUS_LABELS[openRow.clusterStatus ?? ""] ?? "状态未知"}）` },
              { label: "处置", value: openRow.disposition ? <StatusTag tone="done" icon={CheckCircle2}>{K2_DISPOSITION_LABELS[openRow.disposition] ?? "已处置"}</StatusTag> : <StatusTag tone="warn">待处置</StatusTag> },
            ]} />
            {freezeBlocked && (
              <Notice tone="warn" title="冻结前要先标记可疑"
                action={reach("/risk/multi-account", "risk_k1_read") ? <Link className="rd-link" href="/risk/multi-account">去多账户风险排查</Link> : undefined}>
                这组账户在「多账户风险排查」标记为可疑后，才能在这里提交冻结。
              </Notice>
            )}
            <Fold inset title="后端原始记录" summary={`${current?.view.label ?? ""} · ${openRow.cells.length} 项`}
              explain="后端返回的原始列名和值，列名有的不准：试用的「累计套取试用收益」实际是开始试用次数，置换的「设备链」实际是置换次数。">
              <Facts>
                {openRow.cells.map((value, index) => <Fact key={index} k={current?.view.head[index] ?? `第 ${index + 1} 项`}>{value}</Fact>)}
                <Fact k="命中编号">{openRow.rowId}</Fact>
              </Facts>
            </Fold>
          </>
        )}
      </Drawer>
    </>
  );
}
