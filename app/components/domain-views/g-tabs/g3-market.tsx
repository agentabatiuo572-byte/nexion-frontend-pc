"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { displayAdminError } from "@/lib/admin/error-messages";
import { fmtConfigPct } from "@/lib/format";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { GRecoveryNotice, pendingTag, unknownTag, type GRecoveryRow } from "./g-recovery";
/**
 * G3 UVT 价格管理（改版，RdPage）。数据来自后端 /api/admin/market/nex/curve 与 /curve/history。
 * 首屏回答「现在价格多少、怎么来的、接下来七天怎么走」：结论一句、四个数、七天计划（走势图 + 逐日表）、最近 24 小时价格和运行方式。
 * 少用的「应急改现价」和后端还没使用的参数收进折叠。读取和既定界面保留；写入保存完整原请求并按原命令号恢复。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity, CalendarRange, CircleHelp, Info, Clock3, Coins, Lock, PauseCircle, Pencil, PinIcon, RefreshCw, ShieldCheck, SlidersHorizontal, Star, TrendingDown, TrendingUp, TriangleAlert, Zap,
} from "lucide-react";
import {
  BlockState, Button, Change, Conclusion, ConfigList, ConfigRow, Explain, Fact, Facts, Figure, Fold, IconButton, Notice, PageHeader, Panel,
  RdPage, Stat, StatBand, StatusTag, Table, Td, Th, TrendLines,
} from "@/app/components/rd";
import {
  fetchG3MarketHistory,
  fetchG3MarketOverview,
  g3NumberText,
  serializeG3Frames,
  type G3CurveField,
  type G3HistoryPoint,
  type G3Overview,
  type G3OverrideKey,
} from "@/lib/admin/g3-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import {
  executeG3MarketChange, canWriteG3MarketChange, g3MarketCommandExpired, g3MarketFailureCode, g3MarketObjectKey,
  G3_ENVIRONMENT_FORBIDDEN, listG3MarketCommands, pendingG3MarketCommand, refreshG3MarketApprovals,
  type G3MarketChange, type G3DirectChange, type G3ReviewedChange, type G3PendingCommand,
} from "@/lib/admin/g3-market-command";
import { OperationConfirmModal, useToast, type EditSpec, type OperatorBriefKind } from "../design-kit";
import { G3MarketConfirm, G3_TUNING_FORBIDDEN } from "./g3-market-confirm";

/** 本页的共用确认框请求：action 照旧是记进操作记录的名字，title 只写动作和对象（VS-101）。 */
type G3ConfirmReq = {
  briefKind: OperatorBriefKind;
  action: string;
  title: string;
  detail: ReactNode;
  amplifies?: boolean;
  coverage?: { coverageRatio: number; redlinePct: number };
  coverageCheck?: string;
  coverageLead?: ReactNode;
  edit?: EditSpec;
  effect?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  statedBrief?: { impact: string; check: string };
  completionCopy?: string;
  confirmLabel?: string;
  reasonPlaceholder?: string;
  change: G3DirectChange;
  value?: string;
  success: string;
};

/** Object states use saved original commands or actual backend rejection signals. */
export type G3ObjectState = { kind: "unknown" | "approval" | "locked"; detail: string; verification: "current" | "last-observation"; observedAt: number };
const TUNING_RULE = "开发环境以外，后端拒绝人工改上涨概率和直接改现价：直接保存、提交审批和批准都会被拒。";
const FIELD_NAME: Record<G3CurveField, string> = { targetPrice: "目标价", pumpProbability: "上涨概率", volatilityPct: "波动幅度" };
const CONTROL_ORDER = ["pin", "schedule", "loop"];
/** 按原请求重试成功后的提示：原操作已完成，页面在重读，读到之前不能发起新修改。 */
const REREAD_TEXT = "原操作已完成，正在重新读取 UVT 价格";
/** 结果未知的那句：原操作提醒里已经有一行，不再用「操作失败」或页面提示条重复。 */
const UNKNOWN_TEXT = /^提交结果(暂未确认|未知)/;

function messageOf(error: unknown) {
  return displayAdminError(error);
}

/** 价格：去掉补的末尾 0，最少两位、最多八位小数（后端 scale 8，不舍入）。 */
function price(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

/** 0–1 的比例，最多六位小数。 */
function ratio(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** 百分数点（2 表示 ±2%），最多八位小数。 */
function pctText(value: number) {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}%`;
}

function rawValue(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function frameValue(frame: G3Overview["frames"][number], field: G3CurveField) {
  if (field === "targetPrice") return frame.targetPrice;
  if (field === "pumpProbability") return frame.pumpProbability;
  return frame.volatilityPct;
}

function fieldText(field: G3CurveField, value: number) {
  if (field === "targetPrice") return `${price(value)} USDT`;
  if (field === "volatilityPct") return `±${pctText(value)}`;
  return ratio(value);
}

function controlValue(overview: G3Overview, key: string) {
  return overview.controls.find((control) => control.key === key)?.value || "—";
}

function changePct(points: number[]) {
  const first = points[0] || 0;
  const last = points[points.length - 1] || 0;
  if (first <= 0) return 0;
  return ((last - first) / first) * 100;
}

/** 采样时间按业务时区写成「2026-11-13 09:30」，时区在区块里写一次。 */
function sampleText(value: string) {
  return formatBusinessTimeCompact(value, "—");
}

/** 和 TrendLines 同一条取刻度的规则：最后一个时刻不在等距格上时，它和倒数第二个会挤在一起，页面藏掉倒数第二个。 */
function ticksCrowded(count: number) {
  const every = count <= 8 ? 1 : count <= 16 ? 2 : Math.ceil(count / 8);
  return (count - 1) % every !== 0;
}

export function deriveG3RuntimeStatus(paused: boolean, pinValue: string) {
  const pin = pinValue.trim().toUpperCase();
  if (paused) {
    return {
      label: "已暂停",
      detail: "不再自动推进；应急改现价和固定生效日仍会发布价格。",
      tone: "bad",
    };
  }
  if (/^D[1-7]$/.test(pin)) {
    return {
      label: `已固定在 ${pin}`,
      detail: "价格固定用这一天的设置，不再自动切换到下一天。",
      tone: "warn",
    };
  }
  return {
    label: "按计划自动运行",
    detail: "每天按设定时间自动切换到下一天的价格。",
    tone: "",
  };
}

function ObjectTag({ state }: { state?: G3ObjectState }) {
  if (!state) return null;
  if (state.verification === "last-observation") return <StatusTag tone="warn" icon={state.kind === "locked" ? Lock : Clock3} explain={state.detail}>上次观察</StatusTag>;
  if (state.kind === "unknown") return <StatusTag tone="warn" icon={CircleHelp} explain={state.detail}>结果未知</StatusTag>;
  if (state.kind === "approval") return <StatusTag tone="warn" icon={Clock3} explain={state.detail}>待审批</StatusTag>;
  return <StatusTag tone="warn" icon={Lock} explain={state.detail}>审批锁定中</StatusTag>;
}

/** New edits and recovered direct commands use the same existing confirmation contents. */
function directConfirmation(change: G3DirectChange, value: string | undefined, overview: G3Overview | null): G3ConfirmReq {
  const current = change.current;
  const priceMissing = !overview || !(overview.currentPrice > 0);
  const curDay = overview ? overview.activeDayIndex + 1 : undefined;
  const cov = overview?.coverage.coverageRatio.toFixed(1) ?? "—";
  const redline = overview ? fmtConfigPct(overview.coverage.redlinePct) : "—";
  const coverageSnapshot = overview ? { coverageRatio: overview.coverage.coverageRatio, redlinePct: overview.coverage.redlinePct } : undefined;
  const scheduleControl = overview?.controls.find(row => row.key === "schedule");
  const scheduleMissing = scheduleControl?.value === "";
  const pinV = overview ? controlValue(overview, "pin") : "—";
  const pinned = /^D[1-7]$/.test(pinV.trim().toUpperCase());
  const loopStop = overview ? controlValue(overview, "loop") === "停在末值" : false;
  if (change.action === "curve-cell") {
    const { dayIndex, field } = change;
    return { briefKind: "config",
      action: `修改一周价格计划 · D${dayIndex + 1} · ${FIELD_NAME[field]}`,
      title: `修改 D${dayIndex + 1} 波动幅度`,
      detail: "七天计划里每一天各有一个波动幅度，推进到这一天时抄进当天配置。",
      effect: <StatusTag tone="neutral" icon={Info} explain="后端保存这个值，但发布价格时直接用目标价，没有按波动幅度随机涨跌；已提给后端接上或退役。">目前不生效</StatusTag>,
      facts: <Facts>
        <Fact k="改的是">D{dayIndex + 1} 的计划波动幅度（百分数，2 表示 ±2%）</Fact>
        <Fact k="现在用不用">后端还没有使用：价格按目标价发布，现价和用户兑换都不变</Fact>
        <Fact k="提交时检查">七天计划在你打开后没有被别人改过，否则拒绝</Fact>
      </Facts>,
      statedBrief: { impact: "只改七天计划里这一天的波动幅度，现价和用户兑换不变。", check: "核对是哪一天、新值，理由写清依据或工单号。" },
      amplifies: false,
      confirmLabel: "确认修改",
      edit: { kind: "number", current, min: 0, max: 20, step: 0.01, disallowCurrent: true, unit: "%", hint: "0–20，最多两位小数" },
      change,
      success: `D${dayIndex + 1} ${FIELD_NAME[field]}已保存，到那一天生效`,
    };
  }
  if (change.action === "control") {
    const { key } = change;
    const name = key === "pin" ? "锁定生效日期" : "运行完一轮后循环或停在末值";
    const ctlOptions: Record<string, string[]> = { pin: ["未钉住", "D1", "D2", "D3", "D4", "D5", "D6", "D7"], loop: ["循环", "停在末值"] };
    const pinFacts = (value?: string) => {
      const day = value && /^D[1-7]$/.test(value) ? Number(value.slice(1)) - 1 : -1;
      const target = day >= 0 ? overview?.frames[day]?.targetPrice : undefined;
      return <Facts>
        {target !== undefined ? <>
          <Fact k="选了之后"><Change from={priceMissing ? "暂不可用" : `${price(overview!.currentPrice)} USDT`} to={`${price(target)} USDT（${value} 目标价）`} /></Fact>
          <Fact k="什么时候变">确认后马上按 {value} 发布现价，之后不再自动切换</Fact>
          {!priceMissing && target > overview!.currentPrice && <Fact k="提交时检查" tone="warn">比现价高：后端按 {value} 目标价重估兑付覆盖率，低于红线就拒绝；现行规则不需要审批</Fact>}
        </> : value === "未钉住" && overview ? <>
          <Fact k="选了之后">现价不变；之后在排程已配置、没有暂停时，从 D{curDay === 7 ? loopStop ? 7 : 1 : curDay! + 1} 继续推进{curDay === 7 && loopStop ? "（D7 之后选的是停在末值）" : ""}</Fact>
        </> : <Fact k="现价">{priceMissing ? "暂不可用" : `${price(overview!.currentPrice)} USDT`}</Fact>}
      </Facts>;
    };
    const loopFacts = (value?: string) => <Facts>
      <Fact k="选了之后">{value === "停在末值" ? "D7 之后每次推进仍用 D7 的目标价（不是暂停）" : value === "循环" ? "D7 之后回到 D1，按七天计划循环" : "决定 D7 之后用哪一天"}</Fact>
      <Fact k="什么时候变">确认后立即保存，现价不变；到 D7 之后的那次推进才用上</Fact>
    </Facts>;
    return { briefKind: "config",
      action: `调整价格计划运行方式 · ${name}`,
      title: key === "pin" ? "调整固定生效日" : "调整 D7 之后的走法",
      detail: <><b>{name}</b> · 当前:{current}。固定某一天或暂停切换，都不会改动已设好的计划。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: key === "pin" ? pinFacts : loopFacts,
      statedBrief: key === "pin"
        ? { impact: "固定到某一天会立即按那天的目标价发布现价，之后的兑换按新价；七天计划不变。", check: "核对选的是哪一天和它的目标价，理由写清为什么固定。" }
        : { impact: "只决定 D7 之后怎么走，现价和七天计划都不变。", check: "核对选项，理由写清依据或工单号。" },
      amplifies: false,
      confirmLabel: "确认修改",
      edit: { kind: "select", current, options: ctlOptions[key], optionLabels: { "未钉住": "不固定" }, disallowCurrent: true },
      change,
      success: `${name}已立即生效`,
    };
  }
  if (change.key === "oracle") {
    const oracle = current;
    return { briefKind: "config",
    action: "切换价格来源",
    title: "切换价格来源",
    detail: <>在内部定价和外部价格来源之间切换。只有超级管理员可以操作。</>,
    effect: <StatusTag tone="neutral" icon={Info} explain="已提给后端接上或退役。">目前不生效</StatusTag>,
    facts: <Facts>
      <Fact k="现在用不用">后端只保存这个选项，没有接外部价格：选「外部价格来源」后价格仍按七天计划发布</Fact>
      <Fact k="提交时检查">只有超级管理员能改；打开后来源没有被别人改过</Fact>
    </Facts>,
    statedBrief: { impact: "只改保存的来源选项，价格和用户兑换不变。", check: "核对选项，理由写清依据或工单号。" },
    confirmLabel: "确认切换",
    edit: { kind: "select", current: oracle, options: ["内部做市", "外部喂价"], optionLabels: { "内部做市": "内部定价", "外部喂价": "外部价格来源" }, disallowCurrent: true },
    change,
    success: "价格来源已立即切换",
  };
  }
  if (change.key === "paused") {
    // The saved target determines the original action even if the live read already changed.
    const paused = (value ?? String(change.current !== "true")) === "false";
    return { briefKind: "emergency",
    action: paused ? "恢复价格自动变化" : "暂停价格自动变化",
    title: paused ? "恢复价格自动变化" : "暂停价格自动变化",
    detail: paused
      ? <>恢复后在下一次排程时刻重新按计划推进（固定或没配置排程时仍不推进）。计划价更高时平台要多付钱，覆盖率低于红线时无法恢复（当前 {cov}%，红线 {redline}）。</>
      : <>暂停后每日推进和 5 分钟采样都停下；应急改现价和固定生效日仍会发布价格。</>,
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    coverageLead: paused ? "恢复后价格重新按七天计划推进，计划价更高时平台的 UVT 应付款跟着变" : undefined,
    coverageCheck: "恢复时后端用当前兑付覆盖率检查，低于红线或算不准时拒绝；不需要审批。",
    facts: paused
      ? <Facts>
        <Fact k="现价">{priceMissing ? "暂不可用" : `${price(overview!.currentPrice)} USDT`}</Fact>
        <Fact k="恢复之后">不会马上切换，等下一次排程时刻推进到下一天{pinned ? `；现在固定在 ${pinV.trim().toUpperCase()}，固定不取消就仍不推进` : ""}{scheduleMissing ? "；自动推进还没配置，配置之前不会推进" : ""}</Fact>
      </Facts>
      : <Facts>
        <Fact k="现价">{priceMissing ? "暂不可用" : `${price(overview!.currentPrice)} USDT`}</Fact>
        <Fact k="暂停之后">每日推进和 5 分钟采样都停下</Fact>
        <Fact k="仍会改价的">应急改现价、固定生效日照常发布价格，暂停挡不住这两项</Fact>
      </Facts>,
    statedBrief: paused
      ? { impact: "排程已配置、没有固定时，价格重新按七天计划推进，之后的兑换按推进后的价格。", check: "核对兑付覆盖率和固定生效日，理由写清为什么恢复。" }
      : { impact: "自动推进和采样停下；应急改现价和固定生效日仍会改价。", check: "理由写清为什么暂停、预计多久恢复。" },
    amplifies: paused,
    coverage: paused ? coverageSnapshot : undefined,
    confirmLabel: paused ? "确认恢复" : "确认暂停",
    change,
    value: String(!paused),
    success: paused ? "价格已恢复自动变化" : "价格已暂停变化",
  };
  }
  const overrideKey = change.key;
  const label = overrideKey === "volatilityPct" ? "当前波动幅度" : overrideKey === "deviationPct" ? "偏离告警阈值" : "初始成本价";
  const note = overrideKey === "volatilityPct" ? "可设 0–20%" : overrideKey === "deviationPct" ? "可设 0–50%" : "App 现在没有页面显示它，不影响价格和兑换";
  const amp = false;
    const unused = {
      volatilityPct: "后端把它记进当天配置，下次推进时被计划值替换；发布价格直接用目标价，没有按它随机涨跌。",
      deviationPct: "后端只保存这个值，没有任何地方拿现价和外部价格比较，也不会告警。",
      costBasis: "App 接口会带上它，但现在没有页面显示盈亏，也不影响价格和兑换。",
    } as const;
    return { briefKind: "config",
      action: `手动设置 · ${label}`,
      title: `修改${label}`,
      detail: <><b>{label}</b> · 当前 {current} · {note}。{overrideKey === "deviationPct" || overrideKey === "costBasis" ? "保存后立即生效，之后的价格计划切换不会覆盖此设置，直到再次修改。" : "手动设置只是临时的，下次自动切换时会被计划里的值替换。"}</>,
      effect: <StatusTag tone="neutral" icon={Info} explain="已提给后端接上或退役。">目前不生效</StatusTag>,
      facts: <Facts>
        <Fact k="现在用不用">{overrideKey === "volatilityPct" || overrideKey === "deviationPct" || overrideKey === "costBasis" ? unused[overrideKey] : "—"}</Fact>
        <Fact k="保存到什么时候">{overrideKey === "volatilityPct" ? "下次推进时被计划里的值替换" : "一直保留，直到再次修改"}</Fact>
        <Fact k="提交时检查">打开后这一项没有被别人改过，否则拒绝</Fact>
      </Facts>,
      statedBrief: { impact: "只改这一项的保存值，现价和用户兑换不变。", check: "核对新值，理由写清依据或工单号。" },
      amplifies: !!amp,
      coverage: amp ? coverageSnapshot : undefined,
      confirmLabel: "确认修改",
      edit: overrideKey === "volatilityPct"
        ? { kind: "number", current, min: 0, max: 20, step: 0.01, disallowCurrent: true, unit: "%", hint: "0–20，最多两位小数" }
        : overrideKey === "deviationPct"
          ? { kind: "number", current, min: 0, max: 50, step: 0.01, disallowCurrent: true, unit: "%", hint: "0–50，最多两位小数" }
          : { kind: "number", current, min: 0.00000001, max: 1000000, step: 0.00000001, disallowCurrent: true, amplifiesWhen: amp ? "increase" : undefined, unit: "USDT", hint: "大于 0，最多八位小数" },
      change,
      success: `${label}已立即生效`,
    };
}

export function G3Market() {
  const session = useAdminAuth((state) => state.session);
  const epoch = useAdminAuth((state) => state.authEpoch);
  return <RdPage className="g3m"><G3MarketEditor key={`${session?.adminId}:${epoch}`} /></RdPage>;
}

function G3MarketEditor() {
  const [toastNode, toast] = useToast();
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const epoch = useAdminAuth((state) => state.authEpoch);
  const [marketConfirm, setMarketConfirm] = useState<G3ReviewedChange | null>(null);
  const [confirm, openActionConfirm] = useState<G3ConfirmReq | null>(null);
  const [commandVersion, setCommandVersion] = useState(0);
  const [verifiedApprovals, setVerifiedApprovals] = useState<Record<string, number>>({});
  const [observedStates, setObservedStates] = useState<Partial<Record<string, G3ObjectState>>>({});
  const [MANUAL_TUNING, setManualTuning] = useState<"unknown" | "forbidden" | "allowed">("unknown");
  const commandRows = useMemo(() => session ? listG3MarketCommands(session.adminId) : [], [session, commandVersion]);
  const OBJECT_STATES = { ...observedStates };
  for (const row of commandRows) {
    OBJECT_STATES[g3MarketObjectKey(row.change)] = row.ticketId
      ? { kind: "approval", detail: `原审批单 ${row.ticketId} 在等另一位超级管理员批准，批准前不生效。`,
        verification: verifiedApprovals[row.commandKey] === undefined ? "last-observation" : "current", observedAt: verifiedApprovals[row.commandKey] ?? row.createdAt }
      : { kind: "unknown", detail: "提交时没收到确定结果，可能已经生效。打开这一项查询原结果，24 小时内也可以按原请求重试。", verification: "current", observedAt: row.createdAt };
  }
  const hasRecovery = (key: string) => commandRows.some(row => !row.ticketId && g3MarketObjectKey(row.change) === key);
  const syncCommands = useCallback(() => setCommandVersion(version => version + 1), []);
  const reconcileObservedAfterSave = useCallback((change: G3MarketChange) => {
    const key = g3MarketObjectKey(change);
    // Backend 66ecdb47: updateWeeklyCurve:1381–1422 has no A2 lock check;
    // updateOverride:1581 excludes currentPrice. Their direct saves do not end a pending ticket.
    // updateControl:1472 and the other overrides:1581 require no active lock before saving.
    const bypassesApprovalLock = change.action === "curve-cell" || change.action === "current-price";
    setObservedStates(states => Object.fromEntries(Object.entries(states).flatMap(([object, state]) => {
      const sameObject = change.action === "curve-cell" ? object.startsWith("weekly:") : object === key;
      if (!sameObject) return [[object, state]];
      return bypassesApprovalLock && state ? [[object, { ...state, verification: "last-observation" as const }]] : [];
    })));
  }, []);
  const onCommandFailure = (change: G3MarketChange, failure: unknown) => {
    const code = g3MarketFailureCode(failure);
    if (code === G3_ENVIRONMENT_FORBIDDEN) setManualTuning("forbidden");
    if (code === "OBJECT_ALREADY_PENDING" || code === "OBJECT_LOCKED_BY_A2") {
      setObservedStates(states => ({ ...states, [g3MarketObjectKey(change)]: {
        kind: code === "OBJECT_ALREADY_PENDING" ? "approval" : "locked", detail: messageOf(failure), verification: "current", observedAt: Date.now(),
      } }));
    }
    syncCommands();
  };
  const adminId = session?.adminId;
  const refreshKnownApprovals = useCallback(async () => {
    if (adminId === undefined) return;
    setVerifiedApprovals({});
    const pending = await refreshG3MarketApprovals(adminId);
    setVerifiedApprovals(Object.fromEntries(pending.map(key => [key, Date.now()])));
    syncCommands();
  }, [adminId, syncCommands]);
  useEffect(() => { void refreshKnownApprovals(); }, [refreshKnownApprovals]);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const curveAuthority = (field: G3CurveField) => field === "targetPrice"
    ? "finprod_g3_curve_target_price_write"
    : field === "pumpProbability"
      ? "finprod_g3_curve_pump_prob_write"
      : "finprod_g3_write";
  const [overview, setOverview] = useState<G3Overview | null>(null);
  // 按原请求恢复成功后，手里的概览已经不是那次写入之后的状态；重读成功之前不能拿它当新修改的基准。
  const [rereadPending, setRereadPending] = useState(false);
  const [history, setHistory] = useState<G3HistoryPoint[]>([]);
  // 概览与历史是两个独立服务面:历史读取失败必须有自己的原因与重试入口,
  // 不能只留一句「未返回」让运营无从定位(简报 #66)。
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    setHistoryError("");
    setObservedStates(states => Object.fromEntries(Object.entries(states).map(([key, state]) =>
      [key, state && { ...state, verification: "last-observation" as const }])));
    const [overviewResult, historyResult] = await Promise.allSettled([
      fetchG3MarketOverview(),
      fetchG3MarketHistory(),
      refreshKnownApprovals(),
    ]);
    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
      setRereadPending(false);
    } else {
      setError(messageOf(overviewResult.reason));
    }
    if (historyResult.status === "fulfilled") {
      setHistory(historyResult.value.points);
    } else {
      setHistory([]);
      setHistoryError(messageOf(historyResult.reason));
    }
    if (!silent) setLoading(false);
  }, [refreshKnownApprovals]);

  // 重读成功之前不留着按旧概览画出来的新修改确认框：它的事实和基准不会随重读更新。
  // 属于已保存原记录的恢复框不受影响。
  useEffect(() => {
    if (!rereadPending || !session) return;
    const staleMarket = marketConfirm && !pendingG3MarketCommand(session.adminId, marketConfirm);
    const staleDirect = confirm && !pendingG3MarketCommand(session.adminId, confirm.change);
    if (!staleMarket && !staleDirect) return;
    if (staleMarket) setMarketConfirm(null);
    if (staleDirect) openActionConfirm(null);
    toast("原操作已完成，正在重新读取 UVT 价格；读取成功后再发起新修改。");
    // commandVersion：原记录被了结（明确拒绝或成功）后要重新判断，恢复框不能留成一个按旧概览画的新修改框。
  }, [rereadPending, session, marketConfirm, confirm, toast, commandVersion]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setHistoryError("");
      const [overviewResult, historyResult] = await Promise.allSettled([
        fetchG3MarketOverview(),
        fetchG3MarketHistory(),
      ]);
      if (cancelled) return;
      if (overviewResult.status === "fulfilled") {
        setOverview(overviewResult.value);
      } else {
        setError(messageOf(overviewResult.reason));
      }
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.points);
      } else {
        setHistory([]);
        setHistoryError(messageOf(historyResult.reason));
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (change: G3MarketChange, action: () => Promise<G3Overview>, success: string, recovered = false) => {
    setBusyKey(g3MarketObjectKey(change));
    setError("");
    try {
      const next = await action();
      reconcileObservedAfterSave(change);
      // 按原请求恢复时，后端回放的是当时保存的回包，不是现在的读取：不拿它当当前概览，改为重读；
      // 重读失败只报读取失败，新修改继续不可用，原操作照常算完成。
      if (!recovered) setOverview(next);
      // 写入成功后回读历史属于附加刷新:历史面失败不能把已成功的写入报成失败。
      const [historyResult] = await Promise.allSettled([fetchG3MarketHistory()]);
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.points);
        setHistoryError("");
      } else {
        setHistory([]);
        setHistoryError(messageOf(historyResult.reason));
      }
      toast(recovered ? REREAD_TEXT : success);
      if (recovered) { setRereadPending(true); void reload(true); }
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(UNKNOWN_TEXT.test(message) ? message : `操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast, reconcileObservedAfterSave, reload]);

  const refresh = async () => {
    setRefreshing(true);
    await reload(true);
    setRefreshing(false);
  };

  const historyPoints = useMemo(() => history.filter((point) => point.price > 0), [history]);
  const chartPrices = useMemo(() => {
    const values = historyPoints.map((point) => point.price);
    return values.length >= 2 ? values : [];
  }, [historyPoints]);

  const openDirect = (requested: G3DirectChange, value?: string) => {
    const original = session ? pendingG3MarketCommand(session.adminId, requested) : undefined;
    openActionConfirm(directConfirmation((original?.change ?? requested) as G3DirectChange, original?.value ?? value, overview));
  };
  const openSavedCommand = (row: G3PendingCommand) => {
    if (row.ticketId) { void refreshKnownApprovals(); return; }
    const change = row.change;
    if (change.action === "curve-cell" && change.field === "volatilityPct" || change.action === "control" || change.action === "override") {
      openDirect(change as G3DirectChange, row.value);
    } else setMarketConfirm(change as G3ReviewedChange);
  };
  // 已有审批单号的记录只查原票；没有单号的未知记录才进入原请求恢复框。
  const recoveryRows: GRecoveryRow[] = commandRows.map((row) => {
    const change = row.change;
    const name = change.action === "curve-cell" ? `D${change.dayIndex + 1} ${FIELD_NAME[change.field]}`
      : change.action === "current-price" ? "现价（应急改价）" : change.action === "schedule" ? "自动按日推进"
      : change.action === "control" ? change.key === "pin" ? "固定生效日" : "D7 之后"
      : change.action === "override" ? { paused: "价格自动变化", oracle: "价格来源", volatilityPct: "当前波动幅度", deviationPct: "偏离告警阈值", costBasis: "初始成本价" }[change.key]
      : "原操作";
    const show = (value: string) => {
      if (value === "") return "未配置";
      if (change.action === "curve-cell") return fieldText(change.field, Number(value));
      if (change.action === "current-price" || change.action === "override" && change.key === "costBasis") return `${price(Number(value))} USDT`;
      if (change.action === "override" && change.key === "paused") return value === "true" ? "暂停" : "自动变化";
      if (change.action === "control" && change.key === "pin") return value === "未钉住" ? "不固定" : value;
      return value;
    };
    return {
      key: row.commandKey, name, submittedAt: row.createdAt, ticket: row.ticketId ?? undefined,
      state: row.ticketId ? verifiedApprovals[row.commandKey] === undefined ? "last-observation" : "approval" : "unknown",
      change: <Change from={show(change.current)} to={show(row.value)} />,
      tag: row.ticketId
        ? verifiedApprovals[row.commandKey] === undefined
          ? <ObjectTag state={{ kind: "approval", verification: "last-observation", observedAt: row.createdAt,
              detail: `原审批单 ${row.ticketId} 在等另一位超级管理员批准，批准前不生效。` }} />
          : pendingTag("这次申请批准前不生效。")
        : unknownTag(row.request.kind === "approval" ? "approval" : "direct"),
      actions: row.ticketId
        ? <Button size="sm" aria-label={`查询${name}的原结果`} onClick={() => void refreshKnownApprovals()}>查询原结果</Button>
        : <Button size="sm" aria-label={`打开${name}的原操作`} onClick={() => openSavedCommand(row)}>查询或重试</Button>,
    };
  });
  const recoveryNotice = <GRecoveryNotice label="价格的原操作" rows={recoveryRows}
    title={`价格的原操作 · ${recoveryRows.length} 项`}
    lead={commandRows.every((row) => row.ticketId)
      ? "这些申请在等另一位超级管理员审批：点「查询原结果」看结论；有结论之前不要换个值重新提交。"
      : "点「查询原结果」或打开那一项核对；没有审批单的原操作 24 小时内也可以按原请求重试。有结论之前不要换个值重新提交。"}
    explain={<>
      <p>这里列你在这台电脑上提交过、还没有结论的原操作：走审批的提高申请，和直接保存但没收到结果的修改。原操作只能查询或按原内容重试，不能改值。</p>
      <p>表里同一项也带着标记。别人提交的审批单不在这里，要到「操作记录与审批」看。</p>
    </>} />;
  const pendingDirect = confirm && session ? pendingG3MarketCommand(session.adminId, confirm.change) : undefined;
  const newWriteBlockedReason = !overview ? "UVT 价格读取失败"
    : rereadPending ? "原操作已完成，但 UVT 价格还没有重新读取成功，请先刷新" : undefined;
  const confirmationPanels = <>
      {marketConfirm && session && <G3MarketConfirm session={session} epoch={epoch} requested={marketConfirm}
        newWriteBlockedReason={newWriteBlockedReason}
        today={overview?.activeDayIndex} frames={overview?.frames ?? (marketConfirm.action === "curve-cell"
          ? marketConfirm.expectedFrames.map(frame => ({ dayIndex: frame.dayIndex, targetPrice: Number(frame.targetPrice), pumpProbability: Number(frame.pumpProbability), volatilityPct: Number(frame.volatilityPct) })) : [])} tuning={MANUAL_TUNING}
        onStateChange={syncCommands} onFailure={onCommandFailure} onBusy={value => setBusyKey(value ? "market-confirm" : null)}
        onCurrent={current => { setOverview(current); setRereadPending(false); }}
        onClose={() => setMarketConfirm(null)}
        onDone={(result) => {
          setMarketConfirm(null);
          if (result.active) reconcileObservedAfterSave(marketConfirm);
          if (result.active && !result.recovered) setOverview(result.active);
          if (result.recovered) setRereadPending(true);
          if (result.ticketKey) setVerifiedApprovals(keys => ({ ...keys, [result.ticketKey!]: Date.now() }));
          toast(result.recovered ? REREAD_TEXT : result.acknowledgement);
          void reload(true);
        }} />}
      {confirm && (
        <OperationConfirmModal briefKind={confirm.briefKind}
          action={confirm.action}
          title={confirm.title}
          detail={confirm.detail}
          amplifies={confirm.amplifies}
          coverage={confirm.coverage}
          coverageCheck={confirm.coverageCheck}
          coverageLead={confirm.coverageLead}
          edit={confirm.edit ? { ...confirm.edit, current: pendingDirect?.change.current ?? confirm.edit.current, initialValue: pendingDirect?.value } : undefined}
          effect={confirm.effect}
          facts={confirm.facts}
          statedBrief={confirm.statedBrief}
          completionCopy={confirm.completionCopy}
          confirmLabel={confirm.confirmLabel}
          reasonPlaceholder={confirm.reasonPlaceholder}
          blockedReason={!pendingDirect ? newWriteBlockedReason : undefined}
          getPendingReason={() => session ? pendingG3MarketCommand(session.adminId, confirm.change)?.reason : undefined}
          inlineApproval={{
            pending: !!pendingDirect,
            initialRecovery: "retry",
            expired: !!pendingDirect && g3MarketCommandExpired(pendingDirect),
            disabledReason: pendingDirect && g3MarketCommandExpired(pendingDirect)
              ? "原请求已超过 24 小时，只保留原内容供核对，不能重试；这一项没有按原请求查询结果的接口，请到「操作记录与审批」核对。"
              : pendingDirect && session && !canWriteG3MarketChange(session, pendingDirect.change, pendingDirect.value) ? "你没有修改这一项的权限。" : undefined,
            resolve: () => undefined,
            recover: async () => {
              if (session) await executeG3MarketChange(session, confirm.change, "", "", "lookup");
              return false;
            },
          }}
          onClose={() => openActionConfirm(null)}
          onConfirm={async (reason, newValue) => {
            if (!session) return;
            if (newWriteBlockedReason && !pendingG3MarketCommand(session.adminId, confirm.change)) throw new Error(newWriteBlockedReason);
            try {
              await mutate(confirm.change, async () => {
                const result = await executeG3MarketChange(session, confirm.change, newValue ?? pendingDirect?.value ?? confirm.value ?? "", reason);
                if (!result?.active) throw new Error("原操作结果仍需核对，请保留原记录。");
                return result.active;
              }, confirm.success, !!pendingDirect);
              openActionConfirm(null);
            } catch (failure) {
              onCommandFailure(confirm.change, failure);
              if (!overview && !pendingG3MarketCommand(session.adminId, confirm.change)) openActionConfirm(null);
              throw failure;
            } finally { syncCommands(); }
          }}
        />
      )}
  </>;

  const canWriteAny = ["finprod_g3_write", "finprod_g3_curve_target_price_write", "finprod_g3_curve_pump_prob_write", "finprod_g3_override_price_write", "finprod_g3_engine_pause_toggle"].some(allowed);
  const header = (
    <PageHeader pageId="G3" title="UVT 价格管理"
      summary="安排 UVT 每天的价格，需要时暂停或固定某一天。"
      actions={overview ? <Button variant="ghost" size="sm" loading={refreshing} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh()}>刷新</Button> : undefined}
      meta={overview ? "打开时读取，不自动刷新" : undefined}
      readOnly={overview && !canWriteAny ? "你只能查看；这个账号没有修改价格计划和运行方式的权限。" : undefined} />
  );

  if (loading && !overview) {
    return (
      <>
        {header}
        {confirmationPanels}
        {recoveryNotice}
        {toastNode}
        <BlockState state="loading" title="正在读取 UVT 价格…" />
      </>
    );
  }

  if (!overview) {
    return (
      <>
        {header}
        {confirmationPanels}
        {recoveryNotice}
        {toastNode}
        <BlockState state="error" title="UVT 价格读取失败"
          detail={<>页面不显示任何旧价格。点「重新加载」；一直失败请联系值班同事。{error && <Explain label="失败原因" content={error} />}</>}
          retryLabel="重新加载" onRetry={() => void reload()} />
      </>
    );
  }

  const busy = !!busyKey;
  const busyReason = busy ? "正在保存上一项，稍候再改" : undefined;
  // 原操作重试成功后在重读：新修改先不可用，带着原因；还有原记录的那一项照样能打开。
  const rereadReason = rereadPending ? "原操作已完成，正在重新读取 UVT 价格；读取成功后再改" : undefined;
  const lockReason = (key: string) => busyReason ?? (hasRecovery(key) ? undefined : rereadReason);
  const paused = overview.overrides.paused;
  const pendingPause = commandRows.find(row => !row.ticketId && g3MarketObjectKey(row.change) === "paused");
  const pauseActionResumes = pendingPause ? pendingPause.value === "false" : paused;
  const curDay = overview.activeDayIndex + 1;
  const peak = overview.weekPeakPrice;
  const peakDay = overview.frames.findIndex((frame) => Math.abs(frame.targetPrice - peak) < 0.0000001);
  const cov = overview.coverage.coverageRatio.toFixed(1);
  const redline = fmtConfigPct(overview.coverage.redlinePct);
  const priceMissing = !(overview.currentPrice > 0);
  const todayTarget = overview.activeFrame.targetPrice;
  const offPlan = !priceMissing && overview.currentPrice !== todayTarget;
  const oracle = overview.overrides.oracle;
  const scheduleControl = overview.controls.find((control) => control.key === "schedule");
  const scheduleMissing = scheduleControl?.value === "";
  const schedV = scheduleMissing ? "未配置" : controlValue(overview, "schedule");
  const scheduleMeta = scheduleControl?.cronExpression
    ? `${scheduleControl.cronExpression} · ${scheduleControl.zone || "—"}`
    : "—";
  const pinV = controlValue(overview, "pin");
  const loopV = controlValue(overview, "loop");
  const pinned = /^D[1-7]$/.test(pinV.trim().toUpperCase());
  const runtimeStatus = scheduleMissing && !paused && !pinned
    ? { label: "自动推进未配置", detail: "请在「自动按日推进」补充配置。价格查看、修改和暂停仍可使用。", tone: "warn" }
    : deriveG3RuntimeStatus(paused, pinV);
  const ctlVals: Record<string, string> = { schedule: schedV, pin: pinV, loop: loopV };
  const tuningBlocked = MANUAL_TUNING === "forbidden" ? G3_TUNING_FORBIDDEN : undefined;
  // 现价和今天计划价对不上时，在现价旁写差多少、为什么。原因只写配置能说明的；说明不了的如实写「后端没给原因」。
  const gap = offPlan ? overview.currentPrice - todayTarget : 0;
  const gapText = offPlan ? `比 D${curDay} 计划价 ${price(todayTarget)} ${gap < 0 ? "低" : "高"} ${Math.abs(gap / todayTarget * 100).toFixed(2)}%` : "";
  const gapReason = offPlan ? "差多少后端没有给出原因" : "";

  const openCurveCellMc = (dayIndex: number, field: G3CurveField) => {
    const frame = overview.frames[dayIndex];
    if (!frame) return;
    const current = g3NumberText(frameValue(frame, field), field === "pumpProbability" ? 6 : 8);
    if (field === "targetPrice" || field === "pumpProbability") {
      setMarketConfirm({ action: "curve-cell", dayIndex, field, current,
        expectedRevision: overview.curveRevision ?? "", expectedFrames: serializeG3Frames(overview.frames) });
    } else openDirect({ action: "curve-cell", dayIndex, field, current, expectedFrames: serializeG3Frames(overview.frames) });
  };

  const openCurveCtlMc = (key: string, _name: string, current: string) => {
    if (key === "schedule") {
      setMarketConfirm({ action: "schedule", current: scheduleControl?.rawValue ?? (scheduleMissing ? "" : current), expectedRevision: overview.scheduleRevision ?? "" });
    } else openDirect({ action: "control", key: key as "pin" | "loop", current });
  };

  const adj = (overrideKey: G3OverrideKey, _label: string, current: string, _note: string, _amp?: boolean) => {
    if (overrideKey === "currentPrice") {
      setMarketConfirm({ action: "current-price", current: g3NumberText(overview.currentPrice), expectedRevision: overview.priceRevision ?? "" });
    } else openDirect({ action: "override", key: overrideKey, current });
  };
  const switchOracle = () => openDirect({ action: "override", key: "oracle", current: oracle });
  const pauseEngine = () => openDirect({ action: "override", key: "paused", current: String(paused) }, String(!paused));

  // 一句话结论：只说配置，不说排程「运行正常」（G3-BE-04）；缺价不写成 0（G3-BE-01）。
  const conclusion = priceMissing
    ? <Conclusion state="warn" explain="后端在没有价格记录时返回 0。0 不是真实价格，页面不按 0 显示，也不按它算任何东西。" hint="先核对价格历史；一直读不到请联系值班同事。">UVT 价格暂时读不到</Conclusion>
    : paused
      ? <Conclusion state="warn" explain="暂停只停自动推进和采样；应急改现价和固定生效日仍会发布价格。">价格已暂停在 {price(overview.currentPrice)} USDT，不再自动推进</Conclusion>
      : overview.coverage.redlineBreached
        ? <Conclusion state="warn" explain="后端在提高价格、固定到更高的一天、恢复自动变化时检查兑付覆盖率，低于红线一律拒绝。">兑付覆盖率 {cov}% 低于红线 {redline}，提高价格会被拒绝</Conclusion>
        : scheduleMissing && !pinned
          ? <Conclusion state="warn" hint={allowed("finprod_g3_write") ? "在「运行方式」里首次配置自动按日推进，批准后启用。" : "请有修改权限的同事在「运行方式」首次配置自动按日推进。"}
            explain={`没有排程时价格不会自动切换。「今天 D${curDay}」是后端算出的当前生效日：固定的那天 > 上次推进记下的那天 > 都没有时按 UTC 星期几，所以没推进过时它每天会变，但现价不跟着变。`}>
            自动推进还没配置，现价 {price(overview.currentPrice)} USDT 不会自动切换</Conclusion>
          : pinned
            ? <Conclusion state="neutral" icon={PinIcon}>价格固定在 {pinV.trim().toUpperCase()}，现价 {price(overview.currentPrice)} USDT，不自动切换</Conclusion>
            : <Conclusion state="neutral" icon={CalendarRange} explain="这句话只说配置：没有暂停、没有固定、排程已配置。页面看不到排程最近一次有没有真的执行，现价和计划价可以不同。">排程已配置，今天是 D{curDay}，现价 {price(overview.currentPrice)} USDT</Conclusion>;

  const historyLatest = historyPoints.at(-1)?.sampledAt;
  // 横轴只写时刻；24 小时窗口里时刻撞上时才带日期，保证每格名字不同。
  const shortTicks = historyPoints.map((point) => sampleText(point.sampledAt).slice(11));
  const historyTicks = new Set(shortTicks).size === shortTicks.length ? shortTicks : historyPoints.map((point) => sampleText(point.sampledAt).slice(5));
  const change = chartPrices.length >= 2 ? changePct(chartPrices) : null;
  const changeText = change == null ? "24 小时涨跌暂无" : `24 小时 ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`;

  const planChart = (
    <TrendLines label={`七天目标价，今天 D${curDay}`} height={240}
      ticks={overview.frames.map((_, index) => `D${index + 1}`)}
      series={[{ key: "target", label: "目标价", slot: 1, values: overview.frames.map((frame) => frame.targetPrice) }]}
      format={(value) => `${price(value)} USDT`} axisFormat={(value) => price(value)}
      event={{ index: overview.activeDayIndex, text: "今天" }} />
  );
  // 图上看不出 D7 之后怎么走：图下一行轻提示，和「运行方式」里 D7 之后的设置同一句。
  const planFigure = <div className="g3-chart">
    {planChart}
    <p className="g3-chart-note"><RefreshCw size={12} aria-hidden />{loopV === "停在末值" ? "D7 之后一直用 D7 的目标价" : "D7 之后回到 D1，七天一轮"}</p>
  </div>;

  const dayRows = overview.frames.map((frame, dayIndex) => {
    const isToday = dayIndex === overview.activeDayIndex;
    const isPeak = Math.abs(frame.targetPrice - peak) < 0.0000001;
    const pinnedHere = pinned && pinV.trim().toUpperCase() === `D${dayIndex + 1}`;
    return (
      <tr key={frame.dayIndex} data-today={isToday ? "" : undefined}>
        <Td>
          <span className="g3-day">
            <b>D{dayIndex + 1}</b>
            {isToday && <StatusTag tone="progress" icon={CalendarRange}>今天</StatusTag>}
            {pinnedHere && <StatusTag tone="warn" icon={PinIcon}>已固定</StatusTag>}
            {isPeak && <span className="g3-peak" title="本周最高目标价"><Star size={12} aria-hidden /><span>最高</span></span>}
          </span>
        </Td>
        {(["targetPrice"] as const).map((field) => {
          const current = frameValue(frame, field);
          const previous = dayIndex > 0 ? frameValue(overview.frames[dayIndex - 1], field) : current;
          const up = dayIndex > 0 && current > previous;
          const down = dayIndex > 0 && current < previous;
          const state = OBJECT_STATES[`weekly:D${dayIndex + 1}:${field}`];
          const canEdit = allowed(curveAuthority(field)) || hasRecovery(`weekly:D${dayIndex + 1}:${field}`);
          return (
            <Td key={field} align="right">
              {state && <span className="g3-cell-tag"><ObjectTag state={state} /></span>}
              <span className="g3-cell">
                {(up || down) && <span className="g3-delta" data-dir={up ? "up" : "down"} title={up ? "比前一天高" : "比前一天低"}>
                  {up ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}<span className="rd-sr-only">{up ? "比前一天高" : "比前一天低"}</span>
                </span>}
                <span className="g3-num">{fieldText(field, current)}</span>
                {canEdit && <IconButton data-size="sm" aria-label={`修改 D${dayIndex + 1} ${FIELD_NAME[field]}`} disabledReason={lockReason(`weekly:D${dayIndex + 1}:${field}`)} onClick={() => openCurveCellMc(dayIndex, field)}><Pencil size={13} aria-hidden /></IconButton>}
              </span>
            </Td>
          );
        })}
      </tr>
    );
  });

  const planTable = (
    <Table label="七天价格计划" className="g3-plan">
      <thead>
        <tr>
          <Th>哪一天</Th>
          <Th align="right"><Explain label="目标价" content={<><p>推进或固定到这一天时，现价按这个值发布。</p><p>提高要另一位超级管理员批准，降低直接保存；都只改计划，现价不变。</p></>} />目标价（USDT）</Th>
        </tr>
      </thead>
      <tbody>{dayRows}</tbody>
    </Table>
  );
  /** 「目前不生效」里的一周一行小表：上涨概率、波动幅度。 */
  const weekTable = (field: "pumpProbability" | "volatilityPct") => (
    <Table label={`七天${FIELD_NAME[field]}`} className="g3-vol">
      <thead><tr>{overview.frames.map((_, index) => <Th key={index}>D{index + 1}</Th>)}</tr></thead>
      <tbody>
        <tr>
          {overview.frames.map((frame, dayIndex) => {
            const state = OBJECT_STATES[`weekly:D${dayIndex + 1}:${field}`];
            return (
              <Td key={frame.dayIndex}>
                {state && <span className="g3-cell-tag"><ObjectTag state={state} /></span>}
                <span className="g3-cell">
                  <span className="g3-num">{fieldText(field, frameValue(frame, field))}</span>
                  {(allowed(curveAuthority(field)) || hasRecovery(`weekly:D${dayIndex + 1}:${field}`)) && <IconButton data-size="sm" aria-label={`修改 D${dayIndex + 1} ${FIELD_NAME[field]}`} disabledReason={lockReason(`weekly:D${dayIndex + 1}:${field}`) ?? (field === "pumpProbability" && !hasRecovery(`weekly:D${dayIndex + 1}:${field}`) ? tuningBlocked : undefined)} onClick={() => openCurveCellMc(dayIndex, field)}><Pencil size={13} aria-hidden /></IconButton>}
                </span>
              </Td>
            );
          })}
        </tr>
      </tbody>
    </Table>
  );

  const controls = [...overview.controls].sort((a, b) => (CONTROL_ORDER.indexOf(a.key) + 99) % 99 - (CONTROL_ORDER.indexOf(b.key) + 99) % 99);
  const controlCopy: Record<string, { name: string; what: string; when: string; effect: string; value: (value: string) => string }> = {
    pin: { name: "固定生效日", what: "把价格固定在七天里的某一天，自动推进停下", when: "确认后立即生效", effect: "选一天马上按那天的目标价发布现价；选「不固定」现价不变，之后在排程已配置、没有暂停时按排程推进", value: (value) => value === "未钉住" ? "不固定" : `固定在 ${value}` },
    schedule: { name: "自动按日推进", what: "每天几点切换到下一天的目标价，时区写在时刻后面，不写按 UTC", when: "已有排程直接保存，从下一次排程时刻起按新时间；第一次配置要另一位超级管理员批准", effect: "只改切换时间，现价不当场变；同一个 UTC 日期最多推进一次", value: (value) => value === "" ? "未配置" : value },
    loop: { name: "D7 之后", what: "七天走完后回到 D1 循环，还是一直用 D7", when: "确认后立即保存，到 D7 之后的那次推进才用上", effect: "只决定 D7 之后怎么走，现价不变；停在末值不是暂停", value: (value) => value },
  };

  return (
    <>
      {header}
      {confirmationPanels}

      {error && !UNKNOWN_TEXT.test(error) && <Notice tone="warn">{error}</Notice>}
      {conclusion}
      {rereadPending && <Notice tone="progress" title={REREAD_TEXT} action={<Button size="sm" loading={refreshing} onClick={() => void refresh()}>重新读取</Button>}>读到最新价格之前，表里的修改先不可用；还有原记录的那一项照样能打开。</Notice>}

      {recoveryNotice}

      <StatBand label="UVT 价格摘要">
        <Stat lead tone="role-1" icon={Coins} label="UVT 现价" value={priceMissing ? "—" : price(overview.currentPrice)} unit={priceMissing ? undefined : "USDT"}
          sub={priceMissing ? "价格暂不可用" : offPlan
            ? <span className="g3-gap"><span>{gapText}</span><span>{gapReason}</span></span>
            : `等于今天 D${curDay} 计划价`}
          explain={<>
            <p>1 UVT 折合多少 USDT，是用户兑换时用的价格，取最近一次发布的价格记录。</p>
            <p>今天的计划价要等推进或固定到这一天才发布；应急改价也会让现价和计划价不同，下次推进时恢复计划价。</p>
            <p>「今天」是后端算出的当前生效日：固定的那天 &gt; 上次推进记下的那天 &gt; 都没有时按 UTC 星期几。从没推进过时，它每天跟着星期变，现价不跟着变。</p>
            <p>和计划价差多少：（现价 − 今天计划价）÷ 今天计划价。现价 {priceMissing ? "—" : `${price(overview.currentPrice)} USDT`}，今天 D{curDay} 计划价 {price(todayTarget)} USDT。</p>
          </>} />
        <Stat tone={paused || runtimeStatus.tone === "warn" ? "warn" : "role-3"} icon={paused ? PauseCircle : pinned ? PinIcon : Activity} label="运行方式" value={runtimeStatus.label}
          sub={`今天 D${curDay} / 7 · ${scheduleMissing ? "自动推进未配置" : schedV}`}
          explain="暂停优先，其次固定，再次按排程推进。这里只说配置，看不到排程最近一次是否真的执行。" />
        <Stat tone="role-4" icon={Star} label="本周最高目标价" value={price(peak)} unit="USDT"
          sub={peakDay >= 0 ? `D${peakDay + 1}` : undefined}
          explain="七天计划里最高的目标价，不是历史最高成交价。提高目标价时，后端按改后的这个值复核兑付覆盖率。" />
        <Stat tone={overview.coverage.redlineBreached ? "danger" : "role-2"} icon={ShieldCheck} label="兑付覆盖率" value={cov} unit="%"
          sub={`红线 ${redline}`}
          explain={<>
            <p>现在的储备能付多少应付款，来自「资金储备与应付款」的当前快照，不是这次修改后的值。</p>
            <p>提高价格、固定到更高的一天时，后端按拟发布的价格重估；恢复自动变化时按现在的覆盖率检查。低于红线就拒绝。</p>
            <p>读不到可靠数据时后端也可能返回 0，这时以「资金储备与应付款」为准。</p>
          </>} />
      </StatBand>

      <Panel title="七天价格计划" icon={CalendarRange} tone="role-1"
        sub={`今天 D${curDay} · 目标价 USDT`}
        explain={<>
          <p>看图：七天里目标价怎么走、今天在第几天、哪天最高。现价和今天计划价的对照在「最近 24 小时价格」。</p>
          <p>改计划不改现价。推进到某一天（或固定到这一天）时，现价才按它的目标价发布。</p>
          <p>表里只放决定价格的目标价；上涨概率和波动幅度目前不影响公布价，在页面下方「目前不生效的参数」。</p>
          <p>待批的提高申请存在时，后端现在仍允许直接降低这一项，会让原审批单批准时冲突。</p>
        </>}>
        <Figure width={560} stack="wide" graphic={planFigure}>
          {planTable}
        </Figure>
      </Panel>

      <div className="rd-split" data-even="">
        <Panel title="最近 24 小时价格" icon={Activity} tone="role-1"
          sub={chartPrices.length >= 2 ? `${changeText} · 最近 ${sampleText(historyLatest ?? "")}（${businessZone().label}）` : undefined}
          explain={<>
            <p>看图：价格这一天实际怎么走的，有没有到今天的计划价。</p>
            <p>后端每 5 分钟记一次已发布的价格；暂停或没有价格时不记。时间为{businessZone().label}。{chartPrices.length >= 2 ? `这 24 小时共 ${historyPoints.length} 个采样点；涨跌按第一个和最后一个采样价算。` : ""}</p>
          </>}>
          {chartPrices.length >= 2 ? (
            <div className="g3-history" data-tick-crowd={ticksCrowded(historyTicks.length) ? "" : undefined}><TrendLines label={`最近 24 小时 UVT 价格，${changeText}`} height={168}
              ticks={historyTicks}
              series={[{ key: "price", label: "价格", slot: 1, values: historyPoints.map((point) => point.price) }]}
              format={(value) => `${price(value)} USDT`} axisFormat={(value) => price(value)}
              marks={[{ key: "plan", text: `今天计划 ${price(todayTarget)}`, value: todayTarget, tone: "neutral" }]} /></div>
          ) : (
            <div data-proof="g3-history-empty">
              {historyError
                ? <BlockState state="error" compact title="最近 24 小时价格读取失败" detail={<>这次没读到价格历史，不影响现价和七天计划；点「重新加载」再读一次。<Explain label="失败原因" content={historyError} /></>} onRetry={() => void reload(true)} retrying={refreshing} retryLabel="重新加载" />
                : <BlockState state="empty" compact title="最近 24 小时没有价格记录" detail={paused ? "价格暂停期间不记录。" : "至少要有两个采样点才画走势。"} onRetry={() => void reload(true)} retryLabel="重新加载" />}
            </div>
          )}
        </Panel>

        <Panel title="运行方式" icon={SlidersHorizontal} tone="role-3"
          explain="决定现价什么时候按计划切换。暂停、固定、排程、D7 之后各管一件事，每项自己保存。">
          <ConfigList label="运行方式">
            <ConfigRow name="价格自动变化"
              what="每日推进和 5 分钟采样是否在跑"
              when="确认后立即生效，不需要审批"
              effect="暂停后不再自动推进；恢复后等下一次排程再推进，恢复时后端检查兑付覆盖率"
              note="暂停挡不住应急改现价和固定生效日，这两项照常发布价格。暂停只要暂停权限；恢复还要超级管理员。"
              value={<span className="g3-value">{paused ? <StatusTag tone="warn" icon={PauseCircle}>已暂停</StatusTag> : <StatusTag tone="ok">自动变化中</StatusTag>}<ObjectTag state={OBJECT_STATES.paused} /></span>}
              action={allowed("finprod_g3_engine_pause_toggle") || hasRecovery("paused") ? (describedBy) => (
                <Button size="sm" variant={pauseActionResumes ? "secondary" : "danger-outline"} aria-describedby={describedBy}
                  disabledReason={lockReason("paused") ?? (pauseActionResumes && !isSuper && !hasRecovery("paused") ? "恢复只有超级管理员能操作" : undefined)}
                  onClick={pauseEngine}>{pauseActionResumes ? "恢复" : "暂停"}</Button>
              ) : undefined} />
            {controls.map((item) => {
              const copy = controlCopy[item.key];
              const raw = ctlVals[item.key] || item.value;
              const value = copy ? copy.value(item.key === "schedule" && scheduleMissing ? "" : raw) : operatorCopyText(raw);
              const first = item.key === "schedule" && scheduleMissing;
              return (
                <ConfigRow key={item.key} name={copy?.name ?? operatorCopyText(item.name)}
                  what={copy?.what ?? operatorCopyText(item.description)} when={copy?.when} effect={copy?.effect}
                  note={item.key === "schedule" && !scheduleMissing ? `当前排程：${scheduleMeta}` : undefined}
                  value={<span className="g3-value">{first ? <StatusTag tone="warn" icon={TriangleAlert}>未配置</StatusTag> : value}<ObjectTag state={OBJECT_STATES[item.key]} /></span>}
                  action={allowed("finprod_g3_write") || hasRecovery(item.key) ? (describedBy) => (
                    <Button size="sm" aria-describedby={describedBy} disabledReason={lockReason(item.key)}
                      onClick={() => openCurveCtlMc(item.key, operatorCopyText(item.name), ctlVals[item.key] || item.value)}>
                      {first ? "首次配置" : "调整"}
                    </Button>
                  ) : undefined} />
              );
            })}
          </ConfigList>
        </Panel>
      </div>

      <Fold title="应急改现价" icon={Zap} tone="role-1"
        summary={priceMissing ? "现价暂不可用" : `现价 ${price(overview.currentPrice)} USDT · 降低立即发布，提高要批准`}
        explain="少用的应急入口：不改七天计划，直接发布一个现价，下次推进时恢复计划价。">
        <ConfigList label="应急改现价">
          <ConfigRow name="当前价格"
            what="全站 UVT 现价，用户兑换按它成交"
            when="降低确认后立即发布；提高要另一位超级管理员批准后发布"
            effect="已完成的兑换不变；下次推进时被计划价替换（暂停或固定期间没有固定的到期时间）"
            note={TUNING_RULE}
            value={<span className="g3-value">{priceMissing ? <StatusTag tone="warn" icon={TriangleAlert}>暂不可用</StatusTag> : `${price(overview.currentPrice)} USDT`}
              <ObjectTag state={OBJECT_STATES.currentPrice} />
              {MANUAL_TUNING === "forbidden" && <StatusTag tone="neutral" icon={Lock}>当前环境不能改</StatusTag>}</span>}
            action={allowed("finprod_g3_override_price_write") || hasRecovery("currentPrice") ? (describedBy) => (
              <Button size="sm" aria-describedby={describedBy} disabledReason={lockReason("currentPrice") ?? (hasRecovery("currentPrice") ? undefined : tuningBlocked)}
                onClick={() => adj("currentPrice", "当前价格", rawValue(overview.currentPrice), "临时改价，下次自动切换时恢复计划值", true)}>调整</Button>
            ) : undefined} />
        </ConfigList>
      </Fold>

      <Fold title="目前不生效的参数" icon={CircleHelp} tone="role-other"
        summary="6 项 · 目前不生效，不影响公布价和兑换"
        explain="这些值能保存，但后端发布价格和兑换时都不读它们。入口先保留，已提给后端接上或退役。">
        <div className="g3-subhead">七天上涨概率<span className="g3-subnote">目前不生效</span><Explain label="七天上涨概率" content={<><p>0.35 表示 35%。推进到这一天时写进当天配置；公布价直接用目标价，上涨概率目前不影响公布价。</p><p>提高要另一位超级管理员批准，降低直接保存。</p><p>{TUNING_RULE}</p></>} />
          {MANUAL_TUNING === "forbidden" && <StatusTag tone="neutral" icon={Lock} explain={G3_TUNING_FORBIDDEN}>当前环境不能改</StatusTag>}</div>
        {weekTable("pumpProbability")}
        <div className="g3-subhead">七天波动幅度<span className="g3-subnote">目前不生效</span><Explain label="七天波动幅度" content="七天计划里每一天的波动幅度（2 表示 ±2%），推进到这一天时抄进当天配置。发布价格直接用目标价，不按它随机涨跌。" /></div>
        {weekTable("volatilityPct")}
        <ConfigList label="其他不生效的参数">
          <ConfigRow name="当前波动幅度" what="当天配置里的波动幅度" effect="下次推进时被计划值替换；发布价格不按它随机涨跌"
            value={<span className="g3-value">±{pctText(overview.overrides.volatilityPct)}<ObjectTag state={OBJECT_STATES.volatilityPct} /></span>}
            action={allowed("finprod_g3_write") || hasRecovery("volatilityPct") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={lockReason("volatilityPct")} onClick={() => adj("volatilityPct", "波动幅度", rawValue(overview.overrides.volatilityPct), "可设 0–20%")}>调整</Button> : undefined} />
          <ConfigRow name="价格来源" what="内部定价或外部价格来源" effect="后端没有接外部价格，选哪个价格都按七天计划发布" note="只有超级管理员能切换。"
            value={<span className="g3-value">{oracle === "内部做市" ? "内部定价" : oracle === "外部喂价" ? "外部价格来源" : "价格来源未知"}<ObjectTag state={OBJECT_STATES.oracle} /></span>}
            action={isSuper || hasRecovery("oracle") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={lockReason("oracle")} onClick={switchOracle}>切换</Button> : undefined} />
          <ConfigRow name="偏离告警阈值" what="现价和外部价格相差多少算偏离" effect="后端没有拿现价和外部价格比较，也不会告警"
            value={<span className="g3-value">{overview.overrides.deviationPct == null ? "未配置" : pctText(overview.overrides.deviationPct)}<ObjectTag state={OBJECT_STATES.deviationPct} /></span>}
            action={allowed("finprod_g3_write") || hasRecovery("deviationPct") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={lockReason("deviationPct")} onClick={() => adj("deviationPct", "偏离告警阈值", rawValue(overview.overrides.deviationPct), "可设 0–50%")}>调整</Button> : undefined} />
          <ConfigRow name="初始成本价" what="UVT 的初始成本价" effect="App 接口会带上它，但现在没有页面显示盈亏；不影响价格和兑换"
            value={<span className="g3-value">{overview.overrides.costBasis == null ? "未配置" : `${price(overview.overrides.costBasis)} USDT`}<ObjectTag state={OBJECT_STATES.costBasis} /></span>}
            action={allowed("finprod_g3_write") || hasRecovery("costBasis") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={lockReason("costBasis")} onClick={() => adj("costBasis", "初始成本价", rawValue(overview.overrides.costBasis), "App 现在没有页面显示它，不影响价格和兑换")}>调整</Button> : undefined} />
        </ConfigList>
      </Fold>

      <RelatedLinks reach={reach} />
      {toastNode}
    </>
  );
}

function RelatedLinks({ reach }: { reach: ReturnType<typeof useReach> }) {
  const related = [
    reach("/finance/pool") && <Link key="pool" className="rd-link" href="/finance/pool" prefetch={false}>资金储备与应付款</Link>,
    reach("/finance-products/exchange") && <Link key="exchange" className="rd-link" href="/finance-products/exchange" prefetch={false}>兑换额度与规则</Link>,
    reach("/platform/audit", "platform_a2_read") && <Link key="audit" className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>,
  ].filter(Boolean);
  if (related.length === 0) return null;
  return (
    <nav className="rd-links" aria-label="相关页面">
      <span>相关页面</span>
      {related}
    </nav>
  );
}
