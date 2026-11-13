"use client";

import { useReach } from "@/lib/nav/use-reach";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Eye, Flag, Gift, ListChecks, RefreshCw, Repeat, RotateCcw, ShieldAlert, SlidersHorizontal, TrendingUp, type LucideIcon } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints,
  Notice, PageHeader, Panel, RatioBar, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import { executeK2Command, K1OutcomeUncertainError, K1RequestError, newK1CommandKey, type K2CommandRequest, type K2Row, type K2ViewGroup, type KRiskParam } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { A2OutcomeUncertainError, createA2OperationProposal, fetchA2ProposalByKey } from "@/lib/admin/a2-client";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { fetchE3Snapshot } from "@/lib/admin/e3-client";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { roleLabel } from "@/lib/nav/console-nav";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { KCtx } from "./types";
import { expiredTag, KRecoveryNotice, MidId, pendingTag, unknownTag, type KRecoveryRow } from "./k-recovery";

type K2ProposalInput = Parameters<typeof createA2OperationProposal>[0];
type K2SavedOperation = {
  kind: "flag" | "blockgift" | "boardflag" | "freeze" | "param" | "otp-initial";
  target: string;
  label: string;
  reason: string;
  row?: K2Row;
  param?: KRiskParam;
  businessValue?: BusinessFormValue;
  newValue?: string;
} & ({ request: K2CommandRequest; proposal?: never } | { request?: never; proposal: K2ProposalInput });
type K2PendingCommand = PendingMutationRecord & { operation?: K2SavedOperation; proposed?: boolean };
type K2ConfirmationAttempt = { retained?: K2PendingCommand };

// Keep legacy key-only evidence queryable; never reconstruct a missing original request.
const commandAttempt = createPendingMutationStore<K2PendingCommand>({
  storageKey: "nexion-admin-k2-arbitrage-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (record) => {
    if (record.operation === undefined) return true;
    const op = record.operation;
    return !!op && ["flag", "blockgift", "boardflag", "freeze", "param", "otp-initial"].includes(op.kind)
      && typeof op.target === "string" && typeof op.label === "string" && typeof op.reason === "string"
      && (op.request ? typeof op.request.path === "string" && /^\/arbitrage\/(params|rows)\//.test(op.request.path)
        && ["POST", "PATCH"].includes(op.request.method) && typeof op.request.body === "string"
        : !!op.proposal && op.proposal.sourceDomain === "K2" && op.proposal.obj === op.target && op.proposal.reason === op.reason)
      && (op.param ? op.param.key === op.target && typeof op.param.value === "string" && Number.isInteger(op.param.version)
        : !!op.row && op.row.rowId === op.target && Array.isArray(op.row.cells) && Array.isArray(op.row.actions) && Number.isInteger(op.row.version));
  },
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
    what: "本周佣金在最近两次快照之间的增长，达到全体正增长中位数的多少倍算刷榜；比较符选「超过」时要严格大于。已标记刷榜的账户不参与算中位数。",
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
    what: "在这些场景里，发验证码前都要先过滑块；滑块临时关闭期间放行。", effect: "之后的发送按新场景判断；累计发送次数和 H5 注册的强制滑块另外照算。",
  },
  { key: "captchaGate.afterSends", label: "累计发送后要求滑块", unit: "次/24h", min: 0, max: 50, step: 1,
    what: "同一手机号 24 小时内成功发送达到这个次数后（注册、登录、找回密码合计），再发要先过滑块。", effect: "之后的发送按新次数判断，已发的次数照算。填 0 表示从第一次发送起就要滑块，不是关闭滑块。", hint: "0–50 的整数，0 表示每次都要" },
];

const OTP_UNIT_TEXT: Record<string, string> = { "秒": "秒", "次/24h": "次 / 24 小时", "次": "次", "场景": "" };

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
type Column = { label: string; main: number; sub?: number; num?: boolean; explain?: string; kind?: "amounts" | "settled" | "multiple" };
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
    measure: "涉及金额是这组已结算新人礼的合计，USDT 和 UVT 分开写，各保留 2 位小数。",
    columns: [
      { label: "涉及金额", main: 3, num: true, kind: "amounts", explain: "这组已结算新人礼的合计，USDT 和 UVT 分开写，各保留 2 位小数。" },
      { label: "已结算", main: 4, num: true, kind: "settled", explain: "这组账户已结算的新人礼笔数，统计全部记录，没有时间窗。" },
    ],
  },
  board: {
    name: "排行榜刷榜", icon: TrendingUp, subject: "账户", objectSub: { label: "账户组", index: 4 },
    what: "本周佣金在最近两次快照（每 5 分钟一次）之间的增长，达到全体正增长中位数的检测倍数；比较符选「超过」时要严格大于。",
    levelRule: "增长超过中位数 10 倍为 4 级，否则 3 级。",
    measure: "本周累计佣金和增速倍数都保留 2 位小数。",
    columns: [
      { label: "本周累计佣金", main: 1, num: true, kind: "amounts", explain: "本周有效佣金的累计，保留 2 位小数。" },
      { label: "增速", main: 2, sub: 3, num: true, kind: "multiple", explain: "最近一次增长是全体正增长中位数的多少倍，保留 2 位小数。" },
    ],
  },
};
const VIEW_ORDER = ["trial", "tradein", "gift", "board"];
const viewUi = (view: K2ViewGroup): ViewUi => VIEW_UI[view.key] ?? { name: view.label, icon: ListChecks, subject: "对象", what: view.note, levelRule: "", measure: "", columns: [] };
const cell = (row: K2Row, index: number) => row.cells[index] ?? "—";
/** 金额的整数部分加千分位，小数原样保留，不换算、不舍入。 */
const groupDigits = (text: string) => text.replace(/(^|[\s(])(\d{4,})(?=(\.\d+)?(\s|$))/g, (_, lead: string, digits: string) => lead + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
/** 后端原文换成这页的叫法：账户组、倍、已结算笔数。认不出的原样写。 */
const plainText = (value: string) => value === "未关联 K1 簇" ? "未关联账户组" : value;
/** 一格的显示：金额分币种成行并加千分位，倍数写「倍」，已结算笔数只留数字部分。 */
function columnValue(row: K2Row, column: Column): { main: string[]; sub?: string } {
  const raw = cell(row, column.main);
  const sub = column.sub !== undefined ? plainText(cell(row, column.sub)) : undefined;
  if (column.kind === "amounts") return { main: raw.split(/\s+\+\s+/).map(groupDigits), sub };
  if (column.kind === "settled") {
    const settled = raw.match(/已结算\s*(\d+)\s*笔/);
    return { main: [settled ? `${settled[1]} 笔` : raw], sub };
  }
  if (column.kind === "multiple") {
    const multiple = raw.match(/^([\d.]+)\s*x(?:\s*(?:基线|上周期|7日均值|同层级均值))?$/i);
    return { main: [multiple ? `${multiple[1]} 倍中位数` : raw], sub };
  }
  return { main: [raw], sub };
}
const columnText = (row: K2Row, column: Column) => {
  const value = columnValue(row, column);
  return [value.main.join(" + "), value.sub].filter(Boolean).join(" · ");
};
const USER_NO = /^U\d{8,19}$/;

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

export function K2Arbitrage({ ctx, rereadPending, onRereadRequired, onCommandsChange }: {
  ctx: KCtx;
  rereadPending: boolean;
  onRereadRequired: () => void;
  onCommandsChange: () => void;
}) {
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
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
  const formRevision = useRef(0);
  const [, setPendingVersion] = useState(0);
  const syncPending = () => {
    setPendingVersion((version) => version + 1);
    onCommandsChange();
  };
  const [otpApprovalRequired, setOtpApprovalRequired] = useState<Record<string, boolean>>({});
  // Open confirmations keep their callbacks; new writes must read the latest page state.
  const currentState = useRef({ ctx, otpApprovalRequired, rereadPending });
  currentState.current = { ctx, otpApprovalRequired, rereadPending };
  const requireReread = () => {
    currentState.current.rereadPending = true;
    onRereadRequired();
  };
  const newWriteBlockedReason = rereadPending && overview && !ctx.contentError
    ? "原操作已有结果，正在重新读取，读完再操作"
    : rereadPending || ctx.contentLoading || ctx.contentError || !overview
      ? "这项没有读到，请刷新后重试" : undefined;
  const pending = commandAttempt.list();
  const pendingFor = (target: string) => commandAttempt.list().find((record) => record.operation?.target === target || record.fingerprint.split(":")[1] === target);
  const originalFor = (attempt: K2ConfirmationAttempt) => {
    const retained = attempt.retained;
    return retained ? commandAttempt.list().find((record) => record.fingerprint === retained.fingerprint && record.commandKey === retained.commandKey) : undefined;
  };
  const otpFirstConfig: Partial<Record<string, "required" | "pending">> = {};
  for (const definition of OTP_GATE_PARAMS) {
    if (pendingFor(definition.key)?.proposed) otpFirstConfig[definition.key] = "pending";
    else if (overview?.otpInitializationRequired[definition.key] || otpApprovalRequired[definition.key]) otpFirstConfig[definition.key] = "required";
  }
  const [readAt, setReadAt] = useState<number | null>(null);
  useEffect(() => {
    if (overview) {
      setReadAt(Date.now());
      setOtpApprovalRequired({});
    }
  }, [overview]);
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

  const queryProposal = async (record: K2PendingCommand, refresh = true) => {
    const original = await fetchA2ProposalByKey(record.commandKey, true);
    if (!original) return false;
    const expectedAction = record.operation?.kind === "freeze" ? `联动 K1 批量冻结 · ${record.operation.target}` : `首次配置验证码设置 · ${record.operation?.target}`;
    if (!original.mine || original.obj !== record.operation?.target
      || (original.operationCode ? original.operationCode !== record.operation.proposal?.command.op : original.action !== expectedAction)) throw new Error("A2_BUSINESS_CONTEXT_MISMATCH");
    if (original.status === "pending") commandAttempt.remember(record.fingerprint, record.commandKey, { operation: record.operation, proposed: true });
    else commandAttempt.forget(record.fingerprint, record.commandKey);
    syncPending();
    ctx.toast(`已找回原审批单 ${original.id}`);
    if (refresh && (!record.proposed || original.status !== "pending")) {
      requireReread();
      try { await ctx.reloadKRisk(); }
      catch { ctx.toast("已找回原审批单，但页面刷新失败；请点「重新加载」核对"); }
    }
    return true;
  };

  // A known pending proposal continues to lock its object across refresh; terminal tickets release it.
  useEffect(() => {
    for (const record of commandAttempt.list().filter((item) => item.proposed)) {
      void queryProposal(record).catch((error) => ctx.toast(errorText(error)));
    }
  // The authoritative refresh is the point at which pending ticket status is checked again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview]);

  const sendOperation = async (operation: K2SavedOperation, attempt: K2ConfirmationAttempt) => {
    const retained = originalFor(attempt);
    const scope = retained?.fingerprint ?? `${operation.row ? "k2-row" : "k2-param"}:${operation.target}`;
    const original = retained ?? pendingFor(operation.target);
    if (original && !retained) throw new Error("IDEMPOTENCY_RESULT_UNKNOWN");
    if (!retained) {
      const current = currentState.current.ctx;
      const currentOverview = current.risk.arbitrage;
      if (currentState.current.rereadPending || current.contentLoading || current.contentError || !currentOverview) throw new Error("RISK_BACKEND_UNAVAILABLE");
      const authority = operation.row ? `risk_k2_row_${operation.kind}` : "risk_k2_write";
      if (!useAdminAuth.getState().session?.authorities.includes(authority)) throw new K1RequestError(errorText(new Error("FORBIDDEN")), 403, "FORBIDDEN");
      if (operation.proposal && !["platform_a2_proposal_create", "platform_a2_write"].some((code) => useAdminAuth.getState().session?.authorities.includes(code))) {
        throw new K1RequestError(errorText(new Error("FORBIDDEN")), 403, "FORBIDDEN");
      }
      if (operation.row) {
        const row = currentOverview.views.flatMap((view) => view.rows).find((item) => item.rowId === operation.target);
        if (!row || row.version !== operation.row.version) throw new Error("K2_ROW_CONCURRENT_UPDATE");
        if (row.disposition || !row.actions.includes(operation.kind)) throw new Error("INVALID_STATE_TRANSITION");
        if (operation.kind === "freeze" && (row.clusterStatus !== "flagged" || row.clusterVersion !== operation.row.clusterVersion)) throw new Error("K1_CLUSTER_FLAG_REQUIRED");
      } else {
        const param = currentOverview.params.find((item) => item.key === operation.target);
        if (!param || param.version !== operation.param?.version || param.value !== operation.param?.value) throw new Error("K2_PARAM_CONCURRENT_UPDATE");
      }
    }
    if (retained && (isRetryExpired(retained) || retained.proposed)) throw new Error(RETRY_EXPIRED_TEXT);
    const commandKey = retained?.commandKey ?? newK1CommandKey();
    commandAttempt.remember(scope, commandKey, { operation });
    if (!commandAttempt.isDurablyStored(scope, commandKey)) {
      if (!retained) commandAttempt.forget(scope, commandKey);
      throw new Error(retained
        ? "浏览器存不下原操作，本次没有发送，结果仍未知。原命令继续保留，请查询原操作。"
        : "浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    // A later new submission can itself become unknown; this frame owns its new key too.
    attempt.retained = commandAttempt.list().find((record) => record.fingerprint === scope && record.commandKey === commandKey);
    setInFlight(scope);
    try {
      if (operation.proposal) {
        const receipt = await createA2OperationProposal(operation.proposal, commandKey, true);
        if (!receipt.mine || receipt.obj !== operation.target) throw new A2OutcomeUncertainError("提交结果不完整，请查询原审批单。", commandKey);
        // A replay confirms creation, not the ticket's current decision.
        if (retained) {
          requireReread();
        } else if (receipt.status === "pending") {
          commandAttempt.remember(scope, commandKey, { operation, proposed: true });
          ctx.toast("已提交，等待审批后执行");
        } else {
          commandAttempt.forget(scope, commandKey);
          ctx.toast(`已找回原审批单 ${receipt.id}`);
        }
      } else {
        await executeK2Command(operation.request, commandKey);
        commandAttempt.forget(scope, commandKey);
        if (retained) requireReread();
      }
    } catch (error) {
      if (isExplicitRejection(error)) {
        commandAttempt.forget(scope, commandKey);
        ctx.toast(`操作失败，没有生效，已填写的内容还在 · ${errorText(error)}`);
        throw error;
      }
      ctx.toast(operation.proposal ? "结果未知 · 申请可能已经提交，可以在框里按原请求重试" : "结果未知 · 可能已经生效，可以在框里按原请求重试");
      throw operation.proposal ? new A2OutcomeUncertainError(errorText(error), commandKey) : new K1OutcomeUncertainError(errorText(error), commandKey);
    } finally {
      setInFlight(null);
      syncPending();
    }
    if (operation.proposal) {
      if (!retained) return;
      // Reads are outside the mutation catch: a failed lookup/reread cannot undo creation.
      try { await queryProposal(retained, false); }
      catch (error) { ctx.toast(errorText(error)); }
      try { await ctx.reloadKRisk(); }
      catch { ctx.toast("已找回原审批单，但页面刷新失败；请点「重新加载」核对"); }
      return;
    }
    try {
      await ctx.reloadKRisk();
      ctx.toast(operation.label);
    } catch {
      ctx.toast(`${operation.label}，但页面刷新失败；请点「重新加载」核对`);
    }
  };

  const proposalInput = (op: string, target: string, action: string, beforeValue: string, afterValue: string, reason: string, values: Record<string, unknown>): K2ProposalInput => {
    const def = findHighOp(op)!;
    return { action, obj: target, beforeValue, afterValue, operator: currentAdminOperator(), operatorRole: roleLabel(session?.role ?? "risk"),
      type: def.type, amplifies: def.amplifies, sos: false, roleGate: def.gateLabel, reason, sourceDomain: "K2",
      command: def.buildCommand(values), target: def.buildTarget(values) };
  };

  const recovery = (attempt: K2ConfirmationAttempt) => {
    const retained = attempt.retained;
    return {
      getPendingReason: () => originalFor(attempt)?.operation?.reason,
      getPendingBusinessValue: () => originalFor(attempt)?.operation?.businessValue,
      blockedReason: retained && isRetryExpired(retained) && !retained.operation?.proposal ? RETRY_EXPIRED_TEXT : undefined,
      ...(retained?.operation?.proposal ? { inlineApproval: {
        resolve: () => undefined,
        pending: true,
        expired: isRetryExpired(retained),
        recover: async () => {
          const original = originalFor(attempt);
          if (!original) throw new Error("INVALID_STATE_TRANSITION");
          return queryProposal(original);
        },
        retry: async () => {
          const original = originalFor(attempt);
          if (!original?.operation) throw new Error("INVALID_STATE_TRANSITION");
          return sendOperation(original.operation, attempt);
        },
      } } : {}),
    };
  };

  const rowOperation = (r: K2Row, kind: "flag" | "blockgift" | "boardflag", reason: string, label: string, attempt: K2ConfirmationAttempt) => {
    const original = originalFor(attempt);
    return sendOperation(original?.operation ?? {
      kind, target: r.rowId, label, reason, row: r,
      request: { method: "POST", path: `/arbitrage/rows/${encodeURIComponent(r.rowId)}/${({ flag: "mark", blockgift: "block-gift", boardflag: "board-flag" })[kind]}`,
        body: JSON.stringify({ expectedVersion: r.version, operator: currentAdminOperator(), reason }) },
    }, attempt);
  };

  /** 命中对象：用户编号能看用户详情时链到详情（同 K1、K4），账户组号中间省略。 */
  const objectRef = (value: string) => USER_NO.test(value) && reach(`/users/search/${encodeURIComponent(value)}`, "user_c1_read")
    ? <Link className="rd-link" href={{ pathname: `/users/search/${encodeURIComponent(value)}` }} onClick={(event) => event.stopPropagation()}>{value}</Link>
    : <MidId value={value} />;
  const objectSubText = (r: K2Row, index: number) => {
    const value = plainText(cell(r, index));
    return value === r.clusterId ? <MidId value={value} /> : value;
  };

  /** 确认框里的事实：是谁、凭什么、涉及多少。四个行操作共用。 */
  const rowFacts = (r: K2Row) => {
    const ui = VIEW_UI[r.viewKey];
    const evidence = ui?.columns[0];
    return (
      <Facts>
        <Fact k={ui?.subject ?? "对象"}>{cell(r, 0)}</Fact>
        <Fact k="命中类别">{ui?.name ?? r.viewKey}</Fact>
        {evidence && <Fact k={evidence.label}>{columnText(r, evidence)}</Fact>}
        <Fact k="风险等级" tone={levelInfo(r.level).tone === "neutral" ? undefined : levelInfo(r.level).tone}>{levelInfo(r.level).text}</Fact>
        {r.clusterId && (r.clusterId === cell(r, 0)
          ? <Fact k="账户组状态">{CLUSTER_STATUS_LABELS[r.clusterStatus ?? ""] ?? "状态未知"}</Fact>
          : <Fact k="账户组">{r.clusterId}{r.clusterStatus ? `（${CLUSTER_STATUS_LABELS[r.clusterStatus] ?? r.clusterStatus}）` : ""}</Fact>)}
      </Facts>
    );
  };

  const markArb = (r: K2Row, retained?: K2PendingCommand) => {
    const attempt = { retained };
    ctx.openConfirm({ recoveryUi: true, briefKind: "judgment",
      ...recovery(attempt),
      errorHandled: (error) => error instanceof K1OutcomeUncertainError || isExplicitRejection(error),
      action: `标记套利账户 · ${r.cells[0]}`,
      title: "标记套利账户",
      detail: "标记为套利并附上证据，不冻结、不动钱。之后相关账户不再获得新人礼，以它们为新人或邀请人的邀请奖励也不再发放。",
      effect: <>{IMMEDIATE}<IrreversibleTag>本页不能撤销</IrreversibleTag></>,
      content: rowFacts(r),
      statedBrief: {
        impact: "这条命中记为已标记套利并发出套利风险信号。不冻结账户、不扣已到账的钱；之后这些账户和同账户组成员不再获得新人礼，它们作为新人或邀请人的邀请奖励也不再发放。",
        check: "核对对象、命中依据和等级；理由写清核查依据。本页没有撤销入口。",
      },
      reasonPlaceholder: "写清核查依据，例如：同一设备多次开试用、客服工单号",
      reason: true,
      okLabel: "确认标记",
      run: (reason) => rowOperation(r, "flag", reason, `${r.cells[0]} 已标记套利`, attempt),
    });
  };

  const blockGift = (r: K2Row, retained?: K2PendingCommand) => {
    const attempt = { retained };
    ctx.openConfirm({ recoveryUi: true, briefKind: "record",
      ...recovery(attempt),
      errorHandled: (error) => error instanceof K1OutcomeUncertainError || isExplicitRejection(error),
      action: `拦截新人礼 · ${r.cells[0]}`,
      title: "拦截新人礼",
      detail: "之后不再给这组账户发新人礼，以它们为新人或邀请人的邀请奖励也不发，已到账的不动。",
      effect: <>{IMMEDIATE}<IrreversibleTag>本页不能撤销</IrreversibleTag></>,
      content: rowFacts(r),
      statedBrief: {
        impact: "之后这组账户和同账户组成员的新人礼不再发放，它们作为新人或邀请人的邀请奖励也不再发放；已到账的不追回，不冻结账户。",
        check: "核对账户组、已结算新人礼和涉及金额；理由写清核查依据。本页没有撤销入口。",
      },
      reasonPlaceholder: "写清核查依据，例如：同一账户组集中领取、客服工单号",
      reason: true,
      okLabel: "确认拦截",
      run: (reason) => rowOperation(r, "blockgift", reason, `${r.cells[0]} 的后续新人礼已拦截`, attempt),
    });
  };

  const boardFlag = (r: K2Row, retained?: K2PendingCommand) => {
    const attempt = { retained };
    ctx.openConfirm({ recoveryUi: true, briefKind: "judgment",
      ...recovery(attempt),
      errorHandled: (error) => error instanceof K1OutcomeUncertainError || isExplicitRejection(error),
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
      run: (reason) => rowOperation(r, "boardflag", reason, `${r.cells[0]} 已标记刷榜`, attempt),
    });
  };

  const linkFreeze = (r: K2Row, retained?: K2PendingCommand) => {
    const attempt = { retained };
    ctx.openActionConfirm({ briefKind: "security",
      ...recovery(attempt),
      action: `冻结关联账户 · ${r.cells[0]}`,
      title: retained ? "重试原操作 · 冻结关联账户" : "冻结关联账户",
      detail: `冻结 ${r.cluster || r.rowId} 这组关联账户，套利证据会一起记入操作记录。`,
      effect: <StatusTag tone="progress" filled explain="另一位管理员批准后才执行，不能自己批。批准前账户、登录和提现都不变。">批准后生效</StatusTag>,
      confirmLabel: "提交审批",
      facts: (
        <Facts>
          <Fact k="账户组">{r.clusterId || "—"}</Fact>
          <Fact k="账户组状态"><Change from={CLUSTER_STATUS_LABELS[r.clusterStatus ?? ""] ?? "—"} to="已冻结" /></Fact>
          {cell(r, 0) !== r.clusterId && <Fact k="命中对象">{cell(r, 0)}</Fact>}
          <Fact k="风险等级" tone={levelInfo(r.level).tone === "neutral" ? undefined : levelInfo(r.level).tone}>{levelInfo(r.level).text}</Fact>
          <Fact k="谁来批">另一位管理员（需有冻结和审批权限）</Fact>
        </Facts>
      ),
      statedBrief: {
        impact: "批准后：这组里状态正常的账户全部冻结，登录会话失效，待处理的提现一并冻结；已注销等非正常账户不受影响。不会到期自动解冻，误判要到「多账户风险排查」解除。",
        check: "核对账户组和命中依据。提交后生成待审批单，批准执行前本页的命中仍显示为待处置。",
      },
      reasonPlaceholder: "写清冻结依据，例如：同一账户组反复领试用并已核实",
      reasonMax: 200,
      run: (reason) => {
        const original = originalFor(attempt);
        return sendOperation(original?.operation ?? {
          kind: "freeze", target: r.rowId, row: r, reason, label: `冻结关联账户 · ${r.cells[0]}`,
          proposal: proposalInput("k2_row_freeze", r.rowId, `冻结关联账户 · ${r.cells[0]}`, "已标记可疑", "冻结关联账户", reason,
            { rowId: r.rowId, expectedVersion: r.version, clusterExpectedVersion: r.clusterVersion }),
        }, attempt);
      },
    });
  };

  const adjParam = (p: KRiskParam, retained?: K2PendingCommand) => {
    const businessForm = k2ParamBusinessForm(p);
    if (!businessForm) {
      ctx.toast(`${p.name} 暂时不能在这里修改`);
      return;
    }
    const help = K2_PARAM_HELP[p.key];
    const attempt = { retained };
    ctx.openActionConfirm({ briefKind: "config",
      ...recovery(attempt),
      action: `调整检测阈值 · ${p.name}`,
      title: `${retained ? "重试原操作 · " : ""}调整${help?.label ?? p.name}`,
      detail: `${p.name} · 当前 ${boardBaselineText(p.value)}。`,
      effect: IMMEDIATE,
      confirmLabel: "确认修改",
      // 检测阈值不动钱，后端也不查覆盖率，不挂「多付钱」提示（后端事实：三阈值摘要不符）。
      amplifies: false,
      facts: (
        <Facts>
          <Fact k={retained ? "提交时" : "现在"}>{thresholdText(p.key, p.value)}</Fact>
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
        const original = originalFor(attempt);
        if (original?.operation) return sendOperation(original.operation, attempt);
        const nextValue = buildK2ThresholdValue(p, businessValue);
        if (!nextValue) {
          ctx.toast(`${p.name} 参数不完整或超出范围`);
          return;
        }
        return sendOperation({ kind: "param", target: p.key, param: p, reason, businessValue, newValue: nextValue,
          label: `${p.name} 已更新为 ${boardBaselineText(nextValue)}`,
          request: { method: "PATCH", path: `/arbitrage/params/${encodeURIComponent(p.key)}`,
            body: JSON.stringify({ value: nextValue, expectedVersion: p.version, operator: currentAdminOperator(), reason }) },
        }, attempt);
      },
    });
  };

  const adjExtraParam = (definition: ExtraParamDef, retained?: K2PendingCommand, forceFirstConfig = false, draft?: { reason: string; value: string }) => {
    const param = retained?.operation?.param ?? allParams.find((item) => item.key === definition.key);
    if (!param) {
      ctx.toast(`${definition.label} 加载失败，请刷新后重试`);
      return;
    }
    const attempt = { retained };
    const firstConfig = forceFirstConfig || retained?.operation?.kind === "otp-initial" || otpFirstConfig[definition.key] === "required";
    const unit = OTP_UNIT_TEXT[definition.unit] ?? definition.unit;
    ctx.openActionConfirm({ briefKind: "config",
      ...recovery(attempt),
      formKey: ++formRevision.current,
      initialReason: draft?.reason,
      action: `调整验证码设置 · ${definition.label}`,
      title: `${retained ? "重试原操作 · " : ""}${firstConfig ? "首次配置" : "调整"}${definition.label}`,
      detail: `${definition.label} · 当前 ${param.value} ${definition.unit}。`,
      effect: firstConfig
        ? <StatusTag tone="progress" filled explain="首次配置要另一位超级管理员批准后才写入，不能自己批。批准前 App 仍按系统默认值处理。">批准后生效</StatusTag>
        : IMMEDIATE,
      confirmLabel: firstConfig ? "提交审批" : "确认修改",
      amplifies: false,
      facts: firstConfig
        ? <Facts><Fact k="配置状态" tone="warn">还没有正式配置，App 按系统默认值处理</Fact><Fact k="谁来批">另一位超级管理员</Fact></Facts>
        : retained ? <Facts><Fact k="提交时">{otpValueText(definition, param.value)}</Fact></Facts> : undefined,
      edit: definition.options
        ? { kind: "select", current: param.value, initialValue: retained?.operation?.newValue ?? draft?.value, options: definition.options, optionLabels: Object.fromEntries(definition.options.map((option) => [option, sceneText(option)])) }
        : { kind: "number", current: param.value, initialValue: retained?.operation?.newValue ?? draft?.value, unit, min: definition.min, max: definition.max, step: definition.step, hint: definition.hint },
      statedBrief: {
        impact: `${firstConfig ? "批准后写入。" : ""}${definition.effect}`,
        check: firstConfig ? "这项还没有正式配置，首次生效要另一位超级管理员批准。" : "核对新值；直接生效，不走审批。",
      },
      reasonPlaceholder: "写清调整依据，例如：短信成本上升、被刷验证码的工单号",
      reasonMax: 200,
      run: async (reason, value) => {
        const original = originalFor(attempt);
        if (original?.operation) return sendOperation(original.operation, attempt);
        if (value == null || value === "") return;
        const base = { target: definition.key, param, reason, newValue: value, label: `${definition.label} 已更新为 ${value} ${definition.unit}` };
        const current = currentState.current;
        if (current.ctx.risk.arbitrage?.otpInitializationRequired[definition.key] || current.otpApprovalRequired[definition.key]) return sendOperation({ ...base, kind: "otp-initial",
          proposal: proposalInput("k2_otp_initial_config", definition.key, `首次配置验证码设置 · ${definition.key}`, param.value, value, reason,
            { key: definition.key, value, expectedVersion: param.version }),
        }, attempt);
        try {
          await sendOperation({ ...base, kind: "param", request: { method: "PATCH", path: `/arbitrage/params/${encodeURIComponent(definition.key)}`,
            body: JSON.stringify({ value, expectedVersion: param.version, operator: currentAdminOperator(), reason }) } }, attempt);
        } catch (error) {
          if (!(error instanceof K1RequestError) || error.reasonCode !== "K2_OTP_INITIAL_APPROVAL_REQUIRED" || !isExplicitRejection(error)) throw error;
          setOtpApprovalRequired((current) => ({ ...current, [definition.key]: true }));
          // The direct command was definitively rejected; reopen the prepared approval confirmation.
          adjExtraParam(definition, undefined, true, { reason, value });
        }
      },
    });
  };

  const reload = () => void ctx.reloadKRisk().catch(() => undefined);
  const canAnyWrite = canWrite || canFlag || canFreeze || canBlockGift || canBoardFlag;
  const header = (
    <PageHeader pageId="K2" title="异常套利与刷量排查" summary="查四类薅羊毛命中，核对证据后处置。"
      meta={readAt && overview && !ctx.contentError ? `读取于 ${formatBusinessTimeCompact(new Date(readAt).toISOString())}（${businessZone().label}）· 打开时检测，手动刷新` : undefined}
      readOnly={canAnyWrite ? undefined : "当前账号只能查看这页"}
      actions={<Button icon={<RefreshCw size={14} aria-hidden />} loading={ctx.contentLoading && Boolean(overview)} onClick={reload}>刷新</Button>} />
  );

  // 原操作提醒：结果未知的写操作和本人还在等批准的申请，逐条列出。原请求保存在本标签页，按原请求重试沿用同一次提交。
  const pendingRecords = pending.filter((record) => record.fingerprint !== inFlight);
  const allRows = views.flatMap((view) => view.rows);
  const recoveryRows: KRecoveryRow[] = pendingRecords.map((record) => {
    const [kind, legacyTarget] = record.fingerprint.split(":");
    const operation = record.operation;
    const target = operation?.target ?? legacyTarget;
    const action = operation?.kind ?? kind.replace(/^k2-/, "");
    const row = operation?.row ?? allRows.find((item) => item.rowId === target);
    const param = operation?.param ?? allParams.find((item) => item.key === target);
    const otp = OTP_GATE_PARAMS.find((item) => item.key === target);
    const name = action === "param" || action === "otp-initial" ? `调整${K2_PARAM_HELP[target]?.label ?? otp?.label ?? param?.name ?? target}` : ACTION_LABELS[action] ?? action;
    const approval = Boolean(operation?.proposal);
    const expired = isRetryExpired(record);
    const change = row
      ? action === "freeze" ? <>{row.clusterId || cell(row, 0)}：{CLUSTER_STATUS_LABELS[row.clusterStatus ?? ""] ?? "—"} → 已冻结</> : cell(row, 0)
      : param && operation?.newValue !== undefined
        ? otp ? `${otpValueText(otp, param.value)} → ${otpValueText(otp, operation.newValue)}` : `${thresholdText(param.key, param.value)} → ${thresholdText(param.key, operation.newValue)}`
        : target;
    const retry = !operation ? undefined : row
      ? () => (action === "flag" ? markArb(row, record) : action === "blockgift" ? blockGift(row, record) : action === "boardflag" ? boardFlag(row, record) : linkFreeze(row, record))
      : param ? () => (otp ? adjExtraParam(otp, record) : adjParam(param, record)) : undefined;
    const query = approval
      ? () => void queryProposal(record).then((found) => { if (!found) ctx.toast("暂未找到原审批单，记录继续保留；可以稍后再查，或到「操作记录与审批」核对"); }).catch((error) => ctx.toast(errorText(error)))
      : reload;
    const tag = record.proposed
      ? pendingTag(action === "freeze" ? "另一位管理员" : "另一位超级管理员", action === "freeze" ? "批准前这组账户、登录和提现都不变；这条命中的处置按钮先锁住。" : "批准前 App 仍按系统默认值处理；这一项先锁住。")
      : expired ? expiredTag(approval ? "approval" : "direct") : unknownTag(approval ? "approval" : "direct");
    return {
      key: record.fingerprint,
      name,
      change,
      submittedAt: record.createdAt,
      tag,
      state: record.proposed ? "pending" : expired ? "expired" : "unknown",
      actions: <>
        <Button size="sm" onClick={query}>查询原结果</Button>
        {!record.proposed && <Button size="sm" disabledReason={!retry ? "这是旧版本留下的记录，没有保存原请求，只能查询" : expired ? "原请求超过 24 小时，不能再重试，只能查询" : undefined} onClick={retry}>按原请求重试</Button>}
      </>,
    };
  });
  const pendingNotices = (
    <KRecoveryNotice key="k2-recovery" title={`有 ${recoveryRows.length} 项原操作要处理`} rows={recoveryRows}
      explain={<><p>结果未知：提交时没收到确定结果，可能已经生效（审批类是申请可能已经提交）。先查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会重复执行。</p><p>待审批：你提交的冻结或首次配置还在等批准，批准或驳回前对应的按钮先锁住。</p><p>原请求只保存在这个浏览器标签页里。</p></>}
      lead={reach("/platform/audit", "platform_a2_read") ? <>也可以<Link className="rd-link" href="/platform/audit">到「操作记录与审批」核对</Link>。</> : undefined} />
  );
  const rereadNotice = rereadPending && overview && !ctx.contentError
    ? <Notice tone="progress" title="原操作已有结果，正在重新读取">读完后命中和参数按最新数据显示；这期间不能发起新的操作。</Notice> : null;

  if (ctx.contentLoading && !overview) {
    return <>{header}{pendingNotices}<BlockState state="loading" title="正在读取并检测命中" /></>;
  }

  if (ctx.contentError) {
    return (
      <>{header}{pendingNotices}
        <div data-module-health-state="error">
          <BlockState state="error" title="套利与刷量数据加载失败" detail={errorText(ctx.contentError).includes("已隐藏数据") ? errorText(ctx.contentError) : `${errorText(ctx.contentError)} 为避免误操作，已隐藏数据和操作按钮。`} onRetry={reload} retrying={ctx.contentLoading} retryLabel="重新加载" />
        </div>
      </>
    );
  }

  if (!overview) {
    return <>{header}{pendingNotices}<BlockState state="empty" title="暂无套利与刷量数据" /></>;
  }

  const stat = (key: string) => overview.stats.find((item) => item.key === key)?.value ?? "—";
  // 本人提交、查询确认还在等批准的冻结申请：行上打「待审批」，不算进待处置。
  const awaitingApproval = (row: K2Row) => !row.disposition && Boolean(pendingFor(row.rowId)?.proposed);
  const summaries = views.map((view) => {
    const awaiting = view.rows.filter(awaitingApproval).length;
    const pendingRows = view.rows.filter((row) => !row.disposition && !awaitingApproval(row));
    const maxPending = pendingRows.reduce((max, row) => Math.max(max, row.level), -1);
    const maxLevel = view.rows.reduce((max, row) => Math.max(max, row.level), -1);
    return { view, ui: viewUi(view), total: view.rows.length, pending: pendingRows.length, awaiting, maxPending, maxLevel, high: pendingRows.filter((row) => row.level >= 4).length };
  });
  const totalRows = summaries.reduce((sum, item) => sum + item.total, 0);
  const totalPending = summaries.reduce((sum, item) => sum + item.pending, 0);
  const totalHigh = summaries.reduce((sum, item) => sum + item.high, 0);
  const totalAwaiting = summaries.reduce((sum, item) => sum + item.awaiting, 0);
  const awaitingText = totalAwaiting > 0 ? `另有 ${totalAwaiting} 条已提交冻结审批，等另一位管理员批准。` : "";
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
    ? <Conclusion state="warn" lead explain={conclusionExplain} hint={`${awaitingText}${urgent ? `先看「${urgent.ui.name}」：表里待处置的排在前面，等级高的在上。` : ""}`}>
        有 <b>{totalPending}</b> 条命中待处置{totalHigh > 0 ? `，其中 ${totalHigh} 条为 4 级以上高危` : ""}
      </Conclusion>
    : totalRows > 0
      ? <Conclusion state="neutral" explain={conclusionExplain} hint={awaitingText || undefined}>{totalAwaiting > 0 ? `没有待处置的命中，${totalAwaiting} 条在等冻结审批，共 ${totalRows} 条` : `命中都已处置，共 ${totalRows} 条`}</Conclusion>
      : <Conclusion state="ok" explain={<><p>这是系统检测的结果，不是读取失败。</p><p>系统约每分钟检测一次，打开本页时也会检测。</p></>}>现在没有检出异常套利和刷量</Conclusion>;

  const rowActions = (r: K2Row, size: "sm" | "md") => {
    if (r.disposition) return null;
    const locked = pendingFor(r.rowId);
    const lockedReason = locked ? errorText(new Error(locked.proposed ? "OBJECT_ALREADY_PENDING" : "IDEMPOTENCY_RESULT_UNKNOWN")) : newWriteBlockedReason;
    const buttons = r.actions.map((action) => {
      if (action === "flag") return canFlag ? <Button key={action} size={size} disabledReason={lockedReason} onClick={() => markArb(r)}>标记套利</Button> : null;
      if (action === "blockgift") return canBlockGift ? <Button key={action} size={size} disabledReason={lockedReason} onClick={() => blockGift(r)}>拦截新人礼</Button> : null;
      if (action === "boardflag") return canBoardFlag ? <Button key={action} size={size} disabledReason={lockedReason} onClick={() => boardFlag(r)}>标记刷榜</Button> : null;
      if (action === "freeze") {
        if (!canFreeze) return null;
        const ready = r.clusterStatus === "flagged" && r.clusterVersion !== undefined;
        return <Button key={action} size={size} variant="danger-outline" disabledReason={lockedReason ?? (ready ? undefined : "这组账户要先在「多账户风险排查」标记为可疑，才能提交冻结")} onClick={() => linkFreeze(r)}>冻结关联账户</Button>;
      }
      return <StatusTag key={action} tone="warn" icon={AlertTriangle}>无法识别的操作，已暂停</StatusTag>;
    }).filter(Boolean);
    return buttons.length ? buttons : null;
  };

  const dispositionCell = (r: K2Row) => {
    if (r.disposition) return <StatusTag tone="done" icon={CheckCircle2}>{K2_DISPOSITION_LABELS[r.disposition] ?? "已处置"}</StatusTag>;
    if (awaitingApproval(r)) return pendingTag("另一位管理员", "批准前这组账户、登录和提现都不变，这条命中的处置按钮先锁住。");
    const buttons = rowActions(r, "sm");
    return buttons ? <span className="k2-row-actions">{buttons}</span> : <StatusTag tone="neutral">待处置</StatusTag>;
  };

  const ui = current?.ui;
  const tableColumns = 3 + (ui?.columns.length ?? 0);
  const panelSub = current ? (current.total ? `共 ${current.total} 条 · ${current.pending} 条待处置${current.awaiting ? ` · ${current.awaiting} 条待审批` : ""}` : "没有命中") : undefined;

  const freezeBlocked = openRow && openRow.actions.includes("freeze") && canFreeze && !openRow.disposition && !(openRow.clusterStatus === "flagged" && openRow.clusterVersion !== undefined);
  const drawerButtons = openRow ? rowActions(openRow, "md") : null;
  const drawerFreeze = drawerButtons?.find((node) => (node as { key?: string }).key === "freeze");
  const drawerOthers = drawerButtons?.filter((node) => (node as { key?: string }).key !== "freeze");

  return (
    <>
      {header}
      {conclusion}
      {pendingNotices}
      {rereadNotice}

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
              label="待处置" value={String(item.pending)} unit="条" sub={`共 ${item.total} 条${item.awaiting ? ` · ${item.awaiting} 条待审批` : ""}`}
              tone={item.pending > 0 ? "warn" : undefined}
              selected={selected} selectedText="正在查看" onOpen={() => selectView(item.view.key)}
              openLabel={`${item.ui.name}，待处置 ${item.pending} 条，共 ${item.total} 条${item.awaiting ? `，${item.awaiting} 条待审批` : ""}`}
              role="tab" id={tabIds.tab(item.view.key)} aria-selected={selected} aria-controls={tabIds.panelId(item.view.key)}
              tabIndex={selected ? 0 : -1} onKeyDown={onCardKey}>
              <RatioBar quiet label="待处置" value={item.pending} total={item.total} valueText={`待处置 ${item.pending} 条，共 ${item.total} 条`} tone={item.pending > 0 ? "warn" : "role-2"}
                state={item.total === 0 ? "empty" : undefined} emptyText="没有命中" />
              <dl className="rd-stat-rows">
                <div className="rd-stat-row"><dt>已处置</dt><dd data-empty={item.total === 0 ? "" : undefined}>{item.total === 0 ? "—" : `${item.total - item.pending - item.awaiting} 条`}</dd></div>
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
                  <Td><Cell mono main={objectRef(cell(r, 0))} sub={ui.objectSub ? objectSubText(r, ui.objectSub.index) : undefined} title={cell(r, 0)} /></Td>
                  {ui.columns.map((column) => {
                    const value = columnValue(r, column);
                    return <Td key={column.label} align={column.num ? "right" : undefined}><Cell num={column.num} main={value.main.length > 1 ? value.main.map((line) => <span key={line} className="k2-amount-line">{line}</span>) : value.main[0]} sub={value.sub} /></Td>;
                  })}
                  <Td><LevelTag level={r.level} settled={Boolean(r.disposition)} /></Td>
                  <Td align="right" sticky="end">{dispositionCell(r)}</Td>
                </Tr>
              ))}
              {!rows.length && <TableMessage columns={tableColumns} role="status">这一类现在没有命中。系统约每分钟检测一次，本页不会自己刷新，点「刷新」看最新结果。</TableMessage>}
            </tbody>
          </Table>
        </Panel>
      )}

      <Fold title="检测参数" icon={SlidersHorizontal} tone="role-4" open={paramsOpen} onOpenChange={setParamsOpen}
        summary={`${detectionParams.length} 项检测线 · ${OTP_GATE_PARAMS.length} 项验证码与滑块`}
        explain="检测线决定哪些记录算异常，保存后下一次检测起按新值重算。验证码与滑块是注册、登录、找回密码共用的发码限制：已正式配置的保存后立即生效；还没正式配置的，首次配置要另一位超级管理员批准。">
        <div className="k2-param-groups">
        <Panel plain headingLevel={3} title="检测线" explain="改了之后，下一次检测（约每分钟一次）就按新值重算已有记录，命中会随之增减。">
          <ConfigList label="检测线">
            {detectionParams.map((p) => {
              const help = K2_PARAM_HELP[p.key];
              return (
                <ConfigRow key={p.key} name={help.label} explainLabel={help.label}
                  what={help.what} when="保存后下一次检测起" effect={help.effect} note={help.note}
                  value={thresholdText(p.key, p.value)}
                  sub={p.key === "welcomeGiftAnomalyThreshold" ? <StatusTag tone="warn" icon={AlertTriangle}>目前只按账户组检测</StatusTag> : undefined}
                  action={canWrite ? <Button size="sm" aria-label={`调整${help.label}`} disabledReason={pendingFor(p.key) ? errorText(new Error("IDEMPOTENCY_RESULT_UNKNOWN")) : newWriteBlockedReason} onClick={() => adjParam(p)}>调整</Button> : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
        <Panel plain headingLevel={3} title="验证码与滑块" explain="注册、登录、找回密码共用。H5 注册的专项限制在「多账户风险排查」里维护。" data-proof="k2-otp-gate-params">
          <ConfigList label="验证码与滑块">
            {OTP_GATE_PARAMS.map((definition) => {
              const param = allParams.find((item) => item.key === definition.key);
              const firstConfig = otpFirstConfig[definition.key];
              return (
                <ConfigRow key={definition.key} name={definition.label} explainLabel={definition.label}
                  what={definition.what} when={firstConfig ? "首次配置要另一位超级管理员批准后才生效" : "保存后立即生效"} effect={definition.effect}
                  value={otpValueText(definition, param?.value)}
                  sub={firstConfig === "required" ? <StatusTag tone="warn" icon={AlertTriangle} explain="这项还没有正式配置，App 按系统默认值处理；这里显示的是风控参数里存的值，不一定等于默认值。首次配置要另一位超级管理员批准。">未正式配置</StatusTag>
                    : firstConfig === "pending" ? <StatusTag tone="progress" explain="首次配置已提交，等另一位超级管理员批准；批准前 App 仍按系统默认值处理。">首次配置待审批</StatusTag> : undefined}
                  action={canWrite ? <Button size="sm" aria-label={`${firstConfig === "required" ? "首次配置" : "调整"}${definition.label}`} disabledReason={!param ? "这项没有读到，请刷新后重试" : firstConfig === "pending" ? "首次配置待审批，批准或驳回后才能再改" : pendingFor(definition.key) ? errorText(new Error("IDEMPOTENCY_RESULT_UNKNOWN")) : firstConfig && !["platform_a2_proposal_create", "platform_a2_write"].some(hasAuthority) ? errorText(new Error("K2_OTP_MAKER_FORBIDDEN")) : newWriteBlockedReason} onClick={() => adjExtraParam(definition)}>{firstConfig === "required" ? "首次配置" : "调整"}</Button> : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
        <Panel plain headingLevel={3} title="相关设置" explain="这两项归别的页面管，这里只读。">
          <ConfigList label="相关设置">
            <ConfigRow name="升级置换首档抵扣" explainLabel="升级置换首档抵扣" what="升级置换第一档的抵扣比例，和置换套利有关。" where="在「设备使用与升级置换」设置，这里只读。"
              value={ladderReference.status === "loading" ? "读取中…"
                : ladderReference.status === "error" ? <span className="k2-ref-failed" role="alert" title={ladderReference.message}>抵扣比例加载失败 · 请稍后重试<Button size="sm" aria-label="重试加载升级置换首档抵扣" onClick={() => setLadderReferenceAttempt((attempt) => attempt + 1)}>重试</Button></span>
                : <>{ladderReference.value === null ? "未提供" : `${ladderReference.value}%`}{reach("/devices/trade-in", "device_e3_read") && <> · <Link className="rd-link" href="/devices/trade-in">设备使用与升级置换</Link></>}</>} />
            <ConfigRow name="新人礼金额与发放规则" explainLabel="新人礼金额与发放规则" what="新人礼和邀请奖励发多少、怎么发。" where="在「新人礼与邀请奖励」设置，本页不改金额。"
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
              { label: ui.subject, value: objectRef(cell(openRow, 0)) },
              ...(ui.objectSub && ui.objectSub.label !== "账户组" ? [{ label: ui.objectSub.label, value: cell(openRow, ui.objectSub.index) }] : []),
              { label: "风险等级", value: <LevelTag level={openRow.level} settled={Boolean(openRow.disposition)} />, reason: ui.levelRule },
              ...ui.columns.map((column) => ({ label: column.label, value: columnText(openRow, column), reason: column.explain })),
              { label: openRow.clusterId && openRow.clusterId === cell(openRow, 0) ? "账户组状态" : "账户组", value: !openRow.clusterId ? "没有关联账户组"
                : openRow.clusterId === cell(openRow, 0) ? CLUSTER_STATUS_LABELS[openRow.clusterStatus ?? ""] ?? "状态未知"
                : `${openRow.clusterId}（${CLUSTER_STATUS_LABELS[openRow.clusterStatus ?? ""] ?? "状态未知"}）` },
              { label: "处置", value: openRow.disposition ? <StatusTag tone="done" icon={CheckCircle2}>{K2_DISPOSITION_LABELS[openRow.disposition] ?? "已处置"}</StatusTag>
                : awaitingApproval(openRow) ? pendingTag("另一位管理员", "批准前这组账户、登录和提现都不变，这条命中的处置按钮先锁住。") : <StatusTag tone="warn">待处置</StatusTag> },
            ]} />
            {freezeBlocked && (
              <Notice tone="warn" title="冻结前要先标记可疑"
                action={reach("/risk/multi-account", "risk_k1_read") ? <Link className="rd-link" href="/risk/multi-account">去多账户风险排查</Link> : undefined}>
                这组账户在「多账户风险排查」标记为可疑后，才能在这里提交冻结。
              </Notice>
            )}
            <Fold inset title="后端原始记录" summary={`${current?.view.label ?? ""} · ${openRow.cells.length} 项`}
              explain="后端返回的原始列名和值，列名有的不准：试用的「累计套取试用收益」实际是开始试用次数，置换的「设备链」实际是置换次数；新人礼的「已拦」目前固定写 0，不是真实的拦截笔数。">
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
