"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
/**
 * G2 兑换额度与规则（改版，RdPage）— 数据来自后端 /api/admin/market/exchange。
 * 首屏回答：兑换开着还是暂停、今天的额度用了多少、队列里压着多少；每个参数旁写清改哪个方向要另一位超级管理员批准。
 * 参数审批沿用共用实现；直接写由 G2 命令记录保存原请求和恢复上下文。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight, Ban, CircleHelp, ShieldAlert, Clock3, Coins, Database, Gauge, Globe2, Hourglass, ListOrdered, Lock, PauseCircle, PlayCircle, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Conclusion, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints, Modal, Notice,
  PageHeader, Panel, RatioBar, RdPage, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "../design-kit";
import {
  cancelG2ExchangeQueueOrder,
  fetchG2ExchangeOverview,
  G2BatchReceiptNotFound,
  pendingG2QueueBatch,
  processG2ExchangeQueue,
  updateG2ExchangeParam,
  updateG2ExchangeSwapStatus,
  type G2Cap,
  type G2ExchangeOrder,
  type G2Overview,
  type G2PendingBatch,
  type G2QueueEstimate,
} from "@/lib/admin/g2-client";
import type { ActionConfirmReq } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  g2ExchangeCommandExpired, listG2ExchangeCommands, pendingG2ExchangeCommand,
  queryG2ExchangeCommand, queryG2ExchangeParamReceipt, retryG2ExchangeCommand, G2OutcomeUnknownError,
  type G2PendingCommand,
} from "@/lib/admin/g2-exchange-command";
import { summarizeG2BatchResult, type G2BatchResult } from "@/lib/admin/g2-batch-result";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { useGParamApproval, type GParamRecovery } from "@/lib/admin/use-g-param-approval";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { expiredTag, GRecoveryNotice, pendingTag, resolvedTag, unknownTag, type GRecoveryRow } from "./g-recovery";
import { amountDisplay } from "@/lib/format";

const OPERATOR = currentAdminOperator;
const BATCH_AUTHORITY = "finprod_g2_write";
const batchOrderStatusLabel = {
  COMPLETED: "已成交",
  CANCELLED: "订单已取消",
  QUEUED: "订单仍在队列",
  FAILED: "订单已失败",
};
type GateKey = "user" | "platform" | "geo";

/** 本页的确认框请求：在共用的 ActionConfirmReq 上只加显示用的字段，提交仍走 run。 */
type G2ConfirmReq = ActionConfirmReq & {
  title?: ReactNode;
  effect?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  statedBrief?: { impact: string; check: string };
  confirmLabel?: string;
  confirmLabelForValue?: (value?: string) => string;
  confirmTone?: "primary" | "danger";
  coverageLead?: ReactNode;
  coverageCheck?: string;
  reasonPlaceholder?: string;
};

function messageOf(error: unknown) {
  return displayAdminError(error);
}

/** 金额：后端最多 6 位小数。按全站写法（amountDisplay）：去掉末尾 0、整数不写小数点，带千分位；不舍入。 */
function amount(value: number | string) {
  return typeof value === "number" ? amountDisplay(value, 6, "fixed") : amountDisplay(value.trim());
}

/** 资产数量：去掉补的 0，不补位，带千分位。 */
function quantity(value: number | string) {
  const text = (typeof value === "number" ? value.toFixed(6) : value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const [whole, fraction] = text.split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** 百分数：去掉补的 0。 */
function percent(value: number | string) {
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  return `${text.includes(".") ? text.replace(/\.?0+$/, "") : text}%`;
}

/** 一种资产的数量：USDT 按金额写（至少两位小数），UVT 去掉补的 0。 */
function assetNum(value: number | string, asset: string) {
  return asset === "USDT" ? amount(value) : quantity(value);
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

/** 以 1e-6 为单位的整数，避免小数相减出错。 */
function micros(value: number | string) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}

function fromMicros(value: bigint) {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = abs / BigInt(1_000_000);
  const fraction = String(abs % BigInt(1_000_000)).padStart(6, "0");
  return amount(`${negative ? "-" : ""}${whole}.${fraction}`);
}

/** 后端时间按业务时区写成「2026-11-13 09:30」；时区在列头或区块里写一次。 */
function timeText(value: string) {
  return value ? formatBusinessTimeCompact(value, "—") : "—";
}

function capEditValue(cap: G2Cap) {
  return cap.key === "queueMode" ? paramValueText(cap.key, cap.value, cap.displayValue) : cap.value || cap.displayValue;
}

function normalizeCapSubmitValue(cap: G2Cap, value: string | undefined) {
  if (!value) return "";
  if (cap.key !== "queueMode") return value;
  if (value === "拒绝" || value.toUpperCase() === "REJECT") return "REJECT";
  if (value === "排队" || value.toUpperCase() === "QUEUE") return "QUEUE";
  return "";
}

function requireBatchActor(adminId: number, write = true) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId
      || !auth.session.authorities.includes(write ? BATCH_AUTHORITY : "finprod_g2_read")) {
    throw new Error("登录身份或兑换处理权限已变化，请关闭后重新打开。");
  }
}

/** 五个参数的叫法、单位和方向。名字和后端、操作记录里一致。 */
const PARAM: Record<string, {
  name: string;
  loosen: string;
  tighten: string;
  what: string;
  queue: string;
  future: string;
  short: string;
  hint?: string;
  unit?: string;
  extra?: string;
}> = {
  userDailyCap: {
    name: "单用户日额度", short: "调高",
    loosen: "调高",
    tighten: "调低",
    what: "一个用户一天内兑换（UVT 换 USDT、USDT 换 UVT 都算）折合 USDT 的上限",
    queue: "排队中的单下次处理时按新额度判断，不会自动成交",
    future: "之后的兑换按新额度判断；超过的按「超额度处置策略」和用户发起时的选择排队或拒绝",
    hint: "0–10,000",
    unit: "USDT",
  },
  platformDailyCap: {
    name: "平台日额度", short: "调高",
    loosen: "调高",
    tighten: "调低",
    what: "全平台一天内所有兑换折合 USDT 的总上限",
    queue: "排队中的单下次处理时按新额度判断，不会自动成交",
    future: "之后的兑换按新额度判断；超过的按「超额度处置策略」和用户发起时的选择排队或拒绝",
    hint: "0–10,000,000",
    unit: "USDT",
  },
  fee: {
    name: "兑换手续费率", short: "调低",
    loosen: "调低",
    tighten: "调高",
    what: "每笔兑换按 USDT 金额收的手续费比例；0 表示不收",
    queue: "排队中的单成交时按新费率收，已成交的不变",
    future: "之后即时成交的兑换按新费率收；费率大于 0 时收比例费和最低手续费里较大的那个",
    hint: "0–10，单位是 %，最多两位小数",
    unit: "%",
    extra: "手续费成交时分配：30% 进回购销毁池，其余进兑付储备缓冲账户；不是当场销毁 UVT。",
  },
  feeMin: {
    name: "最低手续费", short: "调低",
    loosen: "调低",
    tighten: "调高",
    what: "费率大于 0 时每笔至少收多少 USDT；费率是 0 时不收费，这一项不起作用",
    queue: "排队中的单成交时按新下限收，已成交的不变",
    future: "之后即时成交的兑换按新下限收",
    hint: "0–5",
    unit: "USDT",
  },
  queueMode: {
    name: "超额度处置策略", short: "改成排队",
    loosen: "从拒绝改成排队",
    tighten: "从排队改成拒绝",
    what: "超过日额度的兑换：排队等运营处理，或直接拒绝",
    queue: "已经在排队的单不受影响，不会被转成拒绝或取消",
    future: "之后超额的兑换按新策略处理；改成排队后，用户发起时选了「超额时排队」才会排",
  },
};
const PARAM_ORDER = ["userDailyCap", "platformDailyCap", "fee", "feeMin", "queueMode"];
/** 排队单上的预计时间：两项都直接保存，不走审批（finprod_g2_write）。 */
type EtaKey = "queueEtaHours" | "queueEtaCopy" | "queueEtaCopyZh" | "queueEtaCopyVi";
const ETA: Record<EtaKey, { name: string; what: string }> = {
  queueEtaHours: { name: "预计处理时长", what: "排队单大约多久处理，填小时数" },
  queueEtaCopy: { name: "英文预计说法", what: "排队单上写的预计时间，用 {hours} 代表小时数" },
  queueEtaCopyZh: { name: "中文预计说法", what: "中文界面的预计说法，{hours} 换成小时数" },
  queueEtaCopyVi: { name: "越南语预计说法", what: "越南语界面的预计说法，{hours} 换成小时数" },
};
/** 中越说法只给 App 用；运营区域语言勾了这种语言时，这句没填好 App 上整条预计都不显示（AppExchangeService.queueEstimate）。 */
const ETA_APP_LANGUAGE: Partial<Record<EtaKey, string>> = { queueEtaCopyZh: "中文", queueEtaCopyVi: "越南语" };
const etaRaw = (estimate: G2QueueEstimate | null | undefined, key: EtaKey) =>
  (key === "queueEtaHours" ? estimate?.hours : key === "queueEtaCopy" ? estimate?.copy : key === "queueEtaCopyZh" ? estimate?.copyZh : estimate?.copyVi)?.trim() ?? "";
const isEtaKey = (key: string): key is EtaKey => key in ETA;
/** 和后端的校验一致：1–999 的整数；说法要含 {hours}、最多 240 个字、不能有换行等控制字符。 */
const etaHoursValid = (value: string) => /^[1-9]\d{0,2}$/.test(value.trim());
const etaCopyIssue = (value: string) => {
  const text = value.trim();
  if (!text.includes("{hours}")) return "要写上 {hours}，显示时换成小时数";
  if ([...text].length > 240) return "最多 240 个字";
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return "不能有换行";
  return undefined;
};
const etaSentence = (copy: string, hours: string) => copy.trim().replaceAll("{hours}", hours.trim());
/** 排队单的原因：系统给的是「排队等待次日处理」，不是排好的时间，这里不写固定时刻（G2-BE-05）。 */
const queueReasonText = (order: { status: string; gateReason: string }) => order.status === "QUEUED" ? "超过日额度" : order.gateReason;
/** 拦截原因：地区封锁的原文带页面代号，写成运营的说法。 */
const gateReasonText = (order: { gateType: string; gateReason: string }) => order.gateType === "geo" ? "所在地区被封锁" : order.gateReason;

function paramName(key: string, fallback?: string) {
  return PARAM[key]?.name ?? (isEtaKey(key) ? ETA[key].name : fallback ? operatorCopyText(fallback) : key);
}

/** 参数值的写法：额度和最低手续费写 USDT，费率写 %，策略写排队/拒绝；后端的 $ 写法不用。 */
function paramValueText(key: string, raw: string | undefined, display?: string) {
  const value = (raw ?? "").trim();
  if (key === "queueMode") {
    const upper = value.toUpperCase();
    if (upper === "QUEUE" || upper === "QUEUED" || value === "排队") return "排队";
    if (upper === "REJECT" || upper === "REJECTED" || value === "拒绝") return "拒绝";
    return display ? operatorCopyText(display) : value || "—";
  }
  if (!value) return key === "queueEtaHours" || key === "queueEtaCopy" ? "未设置" : "—";
  if (key === "queueEtaHours") return etaHoursValid(value) ? `${value} 小时` : value;
  if (key === "fee") return percent(value);
  if (key === "userDailyCap" || key === "platformDailyCap") return `${amount(value)} USDT`;
  if (key === "feeMin") return `${amount(value)} USDT`;
  return value;
}

/** 原申请记录的状态：标签、色调和气泡（G 域五页同一写法）。 */
function recoveryTag(record: GParamRecovery) {
  if (record.status === "unknown") return unknownTag("approval");
  if (record.status === "pending") return pendingTag();
  if (record.status === "expired") return expiredTag("approval");
  return resolvedTag(record.status);
}

/** 兑换单号：放不下时中间省略，留尾段区分。 */
function ExchangeNo({ value }: { value: string }) {
  const tail = value.slice(-8);
  const head = value.slice(0, Math.max(0, value.length - 8));
  return <span className="g2x-no" title={value} data-mono><span className="g2x-no-head">{head}</span><span className="g2x-no-tail">{tail}</span></span>;
}

function orderAmount(order: G2ExchangeOrder) {
  return `${assetNum(order.fromAmountText ?? order.fromAmount, order.fromAsset)} ${order.fromAsset} → ${assetNum(order.toAmountText ?? order.toAmount, order.toAsset)} ${order.toAsset}`;
}

export function G2Exchange() {
  return <RdPage className="g2x"><G2ExchangePage /></RdPage>;
}

function G2ExchangePage() {
  const reach = useReach();
  const [, toast] = useToast();
  const [mc, setActionConfirm] = useState<G2ConfirmReq | null>(null);
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const batchAdminId = session?.adminId ?? 0;
  const canProcessBatch = Number.isSafeInteger(batchAdminId) && batchAdminId > 0 && authorities.includes(BATCH_AUTHORITY);
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const capAuthority = (key: string) => key === "userDailyCap" ? "finprod_g2_cap_user_write"
    : key === "platformDailyCap" ? "finprod_g2_cap_platform_write"
      : key === "fee" || key === "feeMin" ? "finprod_g2_fee_rate_write" : "finprod_g2_write";
  const canPropose = authorities.some((a) => a === "platform_a2_proposal_create" || a === "platform_a2_write");
  const [overview, setOverview] = useState<G2Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overviewReadError, setOverviewReadError] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  // 原命令回包不是当前概览；重读完成前不能按旧概览发起新修改。
  const [rereadPending, setRereadPending] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const readGeneration = useRef(0);
  // Missing/invalid configuration disables execution; an absent fact stays unknown.
  const switchUnavailableReason = overview?.emergencySwitch?.exchange.unavailableReason;
  const switchBlockedReason = switchUnavailableReason === "MISSING" ? "兑换开关没有设置，兑换现在是停的"
    : switchUnavailableReason === "INVALID" ? "兑换开关设置有误，兑换现在是停的" : undefined;
  const j1ExecutionBlocked = overview?.swap.emergencyPaused === true || switchBlockedReason !== undefined;
  const disclosureBlocked = overview?.disclosureGate.exchange === true || overview?.swap.blockedBy === "I5_DISCLOSURE_GATE";
  const batchBlockedReason = j1ExecutionBlocked ? messageOf("EXCHANGE_SWAP_PAUSED")
    : disclosureBlocked ? messageOf("EXCHANGE_DISCLOSURE_GATE_CLOSED") : undefined;
  // 提交前说「会被拒绝」，提交被拒后才用 batchBlockedReason。
  const batchBlockedNote = j1ExecutionBlocked ? "兑换已暂停，这一批会被拒绝"
    : disclosureBlocked ? "风险披露闸门已阻断兑换，这一批会被拒绝" : undefined;
  // 「处理排队」灰着时的原因：两道都挡着就并列写，只有闸门挡着就只写闸门。
  const batchButtonNote = !disclosureBlocked ? switchBlockedReason ?? batchBlockedNote
    : j1ExecutionBlocked ? "兑换开关和风险披露闸门都在阻断兑换"
    : "风险披露闸门已阻断兑换，移出后才能处理";
  const latest = useRef({ overview, loading, busyKey, readFailed, rereadPending, j1ExecutionBlocked, batchBlockedReason });
  latest.current = { overview, loading, busyKey, readFailed, rereadPending, j1ExecutionBlocked, batchBlockedReason };
  const confirmationRecovery = useRef<{ request: G2ConfirmReq; saved: boolean } | null>(null);
  const openActionConfirm = useCallback((request: G2ConfirmReq | null) => {
    const view = latest.current;
    if (request && (view.loading || view.readFailed || view.rereadPending) && request.getPendingReason?.() === undefined) {
      setError("当前值没读到，重试成功后再改");
      return;
    }
    setActionConfirm(request);
  }, []);
  const paramApproval = useGParamApproval("G2", toast, setError, async () => {
    latest.current.readFailed = true;
    latest.current.rereadPending = true;
    setRereadPending(true);
    setReadFailed(true);
    const generation = ++readGeneration.current;
    const next = await fetchG2ExchangeOverview();
    if (generation !== readGeneration.current) return;
    setLoading(false);
    setOverview(next);
    setReadFailed(false);
    setRereadPending(false);
  });
  const [gateDrawer, setGateDrawer] = useState<GateKey | null>(null);
  const [queueDrawer, setQueueDrawer] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<G2BatchResult | null>(null);
  const [pendingBatch, setPendingBatch] = useState<G2PendingBatch>();
  const [directCommands, setDirectCommands] = useState<G2PendingCommand[]>([]);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<{ message: string; notFound: boolean } | null>(null);
  /** 只用于显示：直接修改时后端答复这一项被审批锁住，在这一行标出来。下一次提交仍由后端核对。 */
  const [lockedParams, setLockedParams] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!overview || loading || readFailed) return;
    setLockedParams(current => {
      const next = { ...current };
      for (const cap of overview.caps) {
        // False is authoritative only with the exact write grant used by the projection.
        if (cap.pendingApproval === false && authorities.includes(capAuthority(cap.key))) delete next[cap.key];
      }
      return next;
    });
  }, [overview, loading, readFailed, authorities]);
  const ownPendingBatch = authorities.includes("finprod_g2_read") && pendingBatch?.adminId === batchAdminId ? pendingBatch : undefined;
  const recoveryBatch = ownPendingBatch?.commandKey === recoveryKey ? ownPendingBatch : undefined;
  const [recoverBusy, setRecoverBusy] = useState(false);
  /** 只用于显示：这些错误句已经由原操作提醒里的一行承接，不再在「操作提示」里重复。 */
  const coveredErrors = useRef(new Set<string>());
  const pendingConfirmReason = mc?.getPendingReason?.();
  useEffect(() => {
    if (!mc) { confirmationRecovery.current = null; return; }
    const saved = pendingConfirmReason !== undefined;
    if (confirmationRecovery.current?.request !== mc) confirmationRecovery.current = { request: mc, saved: saved && !busyKey };
    if (saved && !busyKey) confirmationRecovery.current.saved = true;
    if ((!saved && confirmationRecovery.current.saved) || (rereadPending && !saved)) openActionConfirm(null);
  }, [mc, pendingConfirmReason, rereadPending, busyKey, openActionConfirm]);

  useEffect(() => {
    setPendingBatch(pendingG2QueueBatch(batchAdminId));
    const originals = listG2ExchangeCommands(batchAdminId).filter(record => record.path !== "/exchange/queue/process");
    setDirectCommands(originals);
    setRecoveryKey(null);
  }, [batchAdminId, canProcessBatch]);

  const reload = useCallback(async (silent = false, message = "") => {
    const generation = ++readGeneration.current;
    latest.current.readFailed = true;
    latest.current.rereadPending = true;
    setRereadPending(true);
    if (!silent) setLoading(true);
    setReadFailed(true);
    setError(message);
    setOverviewReadError("");
    try {
      const next = await fetchG2ExchangeOverview();
      if (generation !== readGeneration.current) return;
      setOverview(next);
      setReadFailed(false);
      setRereadPending(false);
    } catch (err) {
      if (generation !== readGeneration.current) return;
      setOverview(null);
      setOverviewReadError(displayAdminReadError(err));
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => { readGeneration.current += 1; };
  }, [reload]);

  const mutate = useCallback(async (key: string, action: () => Promise<G2Overview>, success: string, recovered = false) => {
    if (recovered) { latest.current.rereadPending = true; setRereadPending(true); }
    setBusyKey(key);
    setError("");
    try {
      const next = await action();
      readGeneration.current += 1;
      setOverview(next);
      setLoading(false);
      if (recovered) { setReadFailed(false); setRereadPending(false); }
      if (key.startsWith("param:")) setLockedParams(rows => { const next = { ...rows }; delete next[key.slice(6)]; return next; });
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      if (err instanceof G2OutcomeUnknownError) coveredErrors.current.add(message);
      setError(message);
      // 确认框开着、框里已写这句，不再弹一遍（同处理排队）。
      throw err;
    } finally {
      setDirectCommands(listG2ExchangeCommands(batchAdminId).filter(record => record.path !== "/exchange/queue/process"));
      setBusyKey(null);
    }
  }, [batchAdminId, toast]);

  const showBatchResult = useCallback((result: Awaited<ReturnType<typeof processG2ExchangeQueue>>) => {
    readGeneration.current += 1;
    setLoading(false);
    setOverview(result.overview);
    setBatchResult(result.batch);
    setReadFailed(false);
    setRereadPending(false);
    toast(summarizeG2BatchResult(result.batch));
  }, [toast]);

  const readOriginalCommand = async (original: G2PendingCommand) => {
    const param = /^\/exchange\/params\/(\w+)$/.exec(original.path)?.[1];
    setError("");
    try {
      if (param) {
        const state = await queryG2ExchangeParamReceipt(original.adminId, original.commandKey);
        if (state === "SUCCEEDED" || state === "REJECTED") {
          setDirectCommands(records => records.filter(record => record.commandKey !== original.commandKey));
          if (state === "SUCCEEDED") {
            await reload(true);
            toast(original.input.value === "" ? `${paramName(param)}已清空` : `${paramName(param)}已保存`);
          } else {
            setError(messageOf("IDEMPOTENCY_INVESTIGATION_CONFIRMED_REJECTED"));
          }
          return;
        }
      }
      // 未决回执只保留原记录，沿用现有概览回读和提示。
      latest.current.readFailed = true;
      latest.current.rereadPending = true;
      setReadFailed(true);
      setRereadPending(true);
      const result = await queryG2ExchangeCommand(original.adminId, original.commandKey);
      readGeneration.current += 1;
      setLoading(false);
      setOverview(result.overview);
      setReadFailed(false);
      setRereadPending(false);
      setError(result.confirmed ? "" : result.message);
    } catch (error) {
      setError(messageOf(error));
    }
  };

  /**
   * 原操作提醒：走审批的原申请、直接写的原记录（参数、暂停、取消排队）和处理排队的原批次都列在这里；
   * 概览读取中、失败时也显示；直接写从保存的上下文打开同一个原确认框，不依赖当前概览。
   */
  const recoveryNotice = () => {
    const approvals = paramApproval.list();
    const directs = listG2ExchangeCommands(batchAdminId);
    const recover = async (obj: string, retry: boolean) => {
      setRecoverBusy(true);
      try {
        if (retry) await paramApproval.retry(obj);
        else if (!await paramApproval.query(obj)) toast("暂未查到原审批单，原记录继续保留。");
      } catch (err) {
        toast(displayAdminError(err));
      } finally {
        setRecoverBusy(false);
      }
    };
    const rows: GRecoveryRow[] = [
      ...approvals.map((record) => {
        const key = record.request.obj;
        const params = record.request.command.params as { value?: unknown; expectedValue?: unknown };
        const to = paramValueText(key, typeof params.value === "string" ? params.value : undefined);
        const from = typeof params.expectedValue === "string" ? paramValueText(key, params.expectedValue) : undefined;
        return {
          key: record.commandKey, name: paramName(key), submittedAt: record.createdAt, ticket: record.ticket?.id, tag: recoveryTag(record),
          change: from ? <Change from={from} to={to} /> : <>申请改成 {to}</>,
          actions: <>
            <Button size="sm" disabled={recoverBusy} aria-label={`查询${paramName(key)}的原操作`} onClick={() => void recover(key, false)}>查询原操作</Button>
            {record.canRetry && <Button size="sm" disabled={recoverBusy} aria-label={`按原操作重试${paramName(key)}`} onClick={() => void recover(key, true)}>按原操作重试</Button>}
          </>,
        };
      }),
      ...directs.map((record) => {
        const param = /^\/exchange\/params\/(\w+)$/.exec(record.path)?.[1];
        const batch = record.path === "/exchange/queue/process";
        const cancelNo = /^\/exchange\/queue\/([^/]+)\/cancel$/.exec(record.path)?.[1];
        const order = record.context?.order;
        const name = param ? paramName(param) : batch ? "处理排队" : record.path === "/exchange/swap" ? "紧急暂停兑换" : "取消排队兑换";
        // 预计说法可能很长：前后两句各占一行、超出省略，悬停看全文，原操作提醒不被撑高。
        const paramText = (key: string, raw: string | undefined, display?: string) => {
          const text = paramValueText(key, raw, display);
          return key === "queueEtaCopy" ? <span className="g2x-eta-clip" title={text}>{text}</span> : text;
        };
        const change = param
          ? record.context?.cap ? <Change from={paramText(param, record.context.cap.value, record.context.cap.displayValue)} to={paramText(param, record.input.value)} /> : <>改成 {paramText(param, record.input.value)}</>
          : batch ? <>这一批最多 {fmtCount(record.input.limit ?? 0)} 单</>
          : record.path === "/exchange/swap" ? <Change from="开着" to="暂停" />
          : <><span data-mono>{order?.exchangeNo ?? decodeURIComponent(cancelNo ?? "")}</span>{order ? ` · ${amount(order.amountUsdtText ?? order.amountUsdt)} USDT` : ""}</>;
        const expired = g2ExchangeCommandExpired(record);
        const canRetry = !expired && (param ? !!record.context?.cap && authorities.includes(capAuthority(param))
          : record.path === "/exchange/swap" ? record.context?.queueDepth !== undefined && authorities.includes("finprod_g2_swap_toggle")
          : !!order && authorities.includes("finprod_g2_queue_cancel"));
        const retry = param ? isEtaKey(param) ? () => editEta(param) : () => void adjCap(record.context!.cap!)
          : record.path === "/exchange/swap" ? () => toggleSwap()
          : () => cancelQueue(order!);
        const query = batch
          ? () => { if (overview) { setRecoveryError(null); setRecoveryKey(record.commandKey); } else void checkOriginalBatch(record as G2PendingBatch); }
          : () => void readOriginalCommand(record);
        return {
          key: record.commandKey, name, change, submittedAt: record.createdAt, state: "direct-unknown",
          tag: expired ? expiredTag("direct") : unknownTag("direct"),
          actions: <>
            <Button size="sm" disabled={recoverBusy || !!busyKey} aria-label={param || batch ? `查询${name}的原操作` : `读取${name}的当前配置`} onClick={query}>{param || batch ? "查询原操作" : "读取当前配置"}</Button>
            {!batch && canRetry && <Button size="sm" disabled={recoverBusy || !!busyKey} aria-label={`按原操作重试${name}`} onClick={retry}>按原操作重试</Button>}
          </>,
        };
      }),
    ];
    const waiting = directs.length === 0 && approvals.length > 0 && approvals.every((record) => record.status === "pending");
    return <GRecoveryNotice label="兑换的原操作" rows={rows}
      title={`兑换的原操作 · ${rows.length} 项`}
      lead={waiting
        ? "有原申请的参数被审批锁住：批准、驳回或撤回之前，这一项调高调低都改不了；其他参数照常可改。"
        : `这些操作先只能核对（参数和处理排队查询原操作，开关和取消排队读取当前配置），或在 24 小时内按原操作重试，不能改成别的值${directs.some((record) => record.path === "/exchange/queue/process") ? "；处理排队的原批次确认之前不能开新的一批" : ""}。`}
      explain={<>
        <p>这里列你在这台电脑上提交过、还没有结论的原操作：走审批的参数申请，直接生效但没收到结果的参数修改、紧急暂停、取消排队，以及处理排队的原批次。参数和处理排队可以「查询原操作」查原结果；紧急暂停和取消排队只能读取当前配置核对，现在的值证明不了原操作成没成。都可以在 24 小时内按原操作重试，不能改值。</p>
        <p>要改成别的值，等原操作有结论后再在「兑换参数」里发起新修改。处理排队的原批次在这里只能查原结果，不会重发。</p>
      </>} />;
  };

  const processQueueBatch = useCallback(async (limit: number, reason: string) => {
    requireBatchActor(batchAdminId);
    if (pendingG2QueueBatch(batchAdminId)) { latest.current.rereadPending = true; setRereadPending(true); }
    setBusyKey("queue:batch");
    setError("");
    setBatchResult(null);
    try {
      const result = await processG2ExchangeQueue(batchAdminId, limit, reason, OPERATOR());
      requireBatchActor(batchAdminId);
      showBatchResult(result);
    } catch (err) {
      requireBatchActor(batchAdminId);
      const unknown = !!pendingG2QueueBatch(batchAdminId);
      if (unknown) {
        try {
          const current = await fetchG2ExchangeOverview();
          requireBatchActor(batchAdminId);
          readGeneration.current += 1;
          setLoading(false);
          setOverview(current);
          setReadFailed(false);
          setRereadPending(false);
        } catch {
          // POST 的原始错误仍是主证据；回读失败不能改写成确定失败。
        }
        requireBatchActor(batchAdminId);
        const message = "处理结果未知。在这里重试用的是同一批次编号，不会重复处理；也可以关掉确认框，到页面上方查询原操作。";
        // 确认框这时一直开着，这句只在框里写一次：不弹提示，页面上方也不再写。
        coveredErrors.current.add(message);
        setError(message);
        throw new Error(message);
      }
      const message = messageOf(err);
      setError(message);
      toast(`批次没有处理 · ${message}`);
      throw err;
    } finally {
      setPendingBatch(pendingG2QueueBatch(batchAdminId));
      setBusyKey(null);
    }
  }, [batchAdminId, showBatchResult, toast]);

  const checkOriginalBatch = async (original: G2PendingBatch) => {
    latest.current.rereadPending = true;
    setRereadPending(true);
    setBusyKey("queue:batch");
    setError("");
    setRecoveryError(null);
    try {
      requireBatchActor(original.adminId, false);
      const result = await queryG2ExchangeCommand(original.adminId, original.commandKey);
      requireBatchActor(original.adminId, false);
      if (result.confirmed) {
        showBatchResult(result);
        setRecoveryKey(null);
      } else {
        readGeneration.current += 1;
        setLoading(false);
        setOverview(result.overview);
        setReadFailed(false);
        setRereadPending(false);
        setRecoveryError({ message: result.message, notFound: false });
      }
    } catch (error) {
      try {
        const generation = ++readGeneration.current;
        const next = await fetchG2ExchangeOverview();
        if (generation !== readGeneration.current) return;
        setLoading(false);
        setOverview(next);
        setReadFailed(false);
        setRereadPending(false);
      } catch (readError) {
        setReadFailed(true);
        setError(messageOf(readError));
      }
      setRecoveryError({ message: messageOf(error), notFound: error instanceof G2BatchReceiptNotFound });
    } finally {
      setPendingBatch(pendingG2QueueBatch(original.adminId));
      setBusyKey(null);
    }
  };

  const confirmModal = mc && (
    <OperationConfirmModal briefKind={mc.briefKind}
      action={mc.action}
      title={mc.title}
      detail={mc.detail}
      amplifies={mc.amplifies}
      coverage={mc.coverage}
      edit={mc.edit}
      businessForm={mc.businessForm}
      reasonMax={mc.reasonMax}
      getPendingReason={mc.getPendingReason}
      getPendingBusinessValue={mc.getPendingBusinessValue}
      effect={mc.effect}
      facts={mc.facts}
      statedBrief={mc.statedBrief}
      confirmLabel={mc.confirmLabel}
      confirmLabelForValue={mc.confirmLabelForValue}
      confirmTone={mc.confirmTone}
      coverageLead={mc.coverageLead}
      coverageCheck={mc.coverageCheck}
      reasonPlaceholder={mc.reasonPlaceholder}
      blockedReason={pendingConfirmReason === undefined && (loading || readFailed || rereadPending) ? "当前值没读到，重试成功后再改" : undefined}
      onClose={() => openActionConfirm(null)}
      onConfirm={async (reason, newValue, businessValue) => {
        const saved = mc.getPendingReason?.() !== undefined;
        if (confirmationRecovery.current?.request === mc && confirmationRecovery.current.saved && !saved) {
          openActionConfirm(null);
          throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
        }
        const view = latest.current;
        if (!saved && (view.loading || view.readFailed || view.rereadPending)) {
          openActionConfirm(null);
          throw new Error("当前值没读到，重试成功后再改");
        }
        if (saved) confirmationRecovery.current = { request: mc, saved: true };
        try {
          await mc.run(reason, newValue, businessValue);
          openActionConfirm(null);
        } finally {
          if (mc.getPendingReason?.() !== undefined) confirmationRecovery.current = { request: mc, saved: true };
        }
      }}
    />
  );

  const canWriteAny = PARAM_ORDER.some((key) => allowed(capAuthority(key)))
    || allowed("finprod_g2_swap_toggle") || allowed("finprod_g2_queue_cancel") || canProcessBatch;
  const emergencyPaused = overview?.swap.emergencyPaused;
  const pendingPause = directCommands.find(record => record.path === "/exchange/swap");
  const pauseAction = overview && (emergencyPaused !== true || pendingPause
    ? (allowed("finprod_g2_swap_toggle") || pendingPause) && <Button variant="danger-outline" size="sm" icon={<PauseCircle size={14} aria-hidden />}
      disabledReason={busyKey ? "正在处理上一项，稍候再操作" : !pendingPause && (loading || readFailed || rereadPending) ? "当前值没读到，重试成功后再改" : !pendingPause ? switchBlockedReason : undefined} onClick={() => toggleSwap()}>紧急暂停兑换</Button>
    : reach("/emergency/kill-switch") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>{disclosureBlocked ? "去「紧急停用开关」恢复兑换开关 →" : "去「紧急停用开关」恢复 →"}</Link>);
  const header = (
    <PageHeader pageId="G2" title="兑换额度与规则"
      summary="管 UVT 和 USDT 兑换的额度、手续费和排队。"
      actions={pauseAction || undefined}
      meta={overview ? "打开时读取，不自动刷新；改完按保存后的结果刷新" : undefined}
      readOnly={overview && !canWriteAny ? "你只能查看；这个账号没有修改兑换参数、暂停兑换或处理排队的权限。" : undefined} />
  );

  const adjCap = async (requestedCap: G2Cap) => {
    const originalDirect = pendingG2ExchangeCommand(batchAdminId, `/exchange/params/${requestedCap.key}`);
    let cap = originalDirect?.context?.cap ?? requestedCap;
    if (originalDirect && (g2ExchangeCommandExpired(originalDirect) || !originalDirect.context?.cap
      || !useAdminAuth.getState().session?.authorities.includes(capAuthority(cap.key)))) {
      await readOriginalCommand(originalDirect);
      return;
    }
    if (!originalDirect && !paramApproval.record(cap.key) && requestedCap.pendingApproval === true) return;
    if (!originalDirect && !paramApproval.record(cap.key) && overview?.swap.emergencyPaused === true && !["fee", "feeMin"].includes(cap.key)) return;
    const original = originalDirect ? undefined : await paramApproval.open(cap.key);
    if (original === false) return;
    if (original) {
      const expected = original.request.command.params.expectedValue as string;
      cap = { ...cap, value: expected };
    }
    const isQueueMode = cap.key === "queueMode";
    const originalValue = originalDirect?.input.value ?? original?.request.command.params.value as string | undefined;
    const copy = PARAM[cap.key];
    const name = paramName(cap.key, cap.name);
    const currentText = paramValueText(cap.key, cap.value, cap.displayValue);
    const loosens = (value?: string) => {
      if (!value) return undefined;
      if (isQueueMode) {
        const next = normalizeCapSubmitValue(cap, value);
        return next && next !== cap.value ? next === "QUEUE" : undefined;
      }
      const [next, now] = [value, capEditValue(cap)].map(raw => {
        const match = /^(\d+)(?:\.(\d+))?$/.exec(raw.trim());
        if (!match) return undefined;
        const fraction = match[2] ?? "";
        return BigInt(match[1] + fraction.slice(0, 6).padEnd(6, "0"))
          + (Number(fraction[6] ?? "0") >= 5 ? BigInt(1) : BigInt(0));
      });
      if (next === undefined || now === undefined || next === now) return undefined;
      return cap.key === "fee" || cap.key === "feeMin" ? next < now : next > now;
    };
    const capFacts = (value?: string) => {
      const loose = original || originalDirect ? undefined : loosens(value);
      const nextText = value ? paramValueText(cap.key, value) : undefined;
      return (
        <div data-proof="g2-cap-preview">
          <Facts>
            <Fact k="改的是">{name}</Fact>
            {original && <Fact k="原申请"><Change from={currentText} to={nextText ?? "—"} /></Fact>}
            <Fact k="什么时候生效" tone={loose ? "warn" : undefined}>{originalDirect ? "提交结果未知，可能已经生效。有效期内按原操作重试，不会重复执行；过期后只能查询。" : original
              ? original.ticket?.status === "pending"
                ? "审批单在等另一位超级管理员批准；批准前参数不变，这一项被锁住"
                : "原申请结果还没确认：有效期内按原操作重试，不会重复建单"
              : loose === true
                ? "放宽：提交审批，另一位超级管理员（需有审批批准权限）批准后才生效；批准前参数不变，这一项被锁住"
                : loose === false
                  ? "收紧：确认后立即生效"
                  : value
                    ? "和现在一样，没有改动，不保存"
                    : `${copy?.loosen ?? "放宽"}要另一位超级管理员批准；${copy?.tighten ?? "收紧"}确认后立即生效`}</Fact>
            {loose === true && !canPropose && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，放宽方向会被拦下；请有提案权和这项修改权限的同事发起</Fact>}
            <Fact k="排队中的兑换">{copy?.queue ?? "—"}</Fact>
            <Fact k="之后的兑换">{copy?.future ?? "—"}</Fact>
            {loose === true && <Fact k="兑付覆盖率（现在）" tone={overview!.coverage.redlineBreached ? "danger" : undefined}>{percent(overview!.coverage.coverageRatio)}，红线 {percent(overview!.coverage.redlinePct)}</Fact>}
          </Facts>
        </div>
      );
    };
    openActionConfirm({ briefKind: "config",
      confirmLabelForValue: value => loosens(value) ? "提交审批" : "确认修改",
      action: `调整兑换${isQueueMode ? "超额处理方式" : "参数"} · ${operatorCopyText(cap.name)}`,
      title: originalDirect ? `${name} · 按原操作重试` : original ? `${name}的原申请` : `调整${name}`,
      detail: <>{copy?.what ?? operatorCopyText(cap.sub)}。{copy?.extra}</>,
      effect: originalDirect ? <StatusTag tone="warn" icon={CircleHelp} explain="提交结果未知，可能已经生效。有效期内按原操作重试，不会重复执行；过期后只能查询。">结果未知</StatusTag> : <StatusTag tone="neutral" icon={ArrowLeftRight} explain={<>
        <p>{copy?.loosen ?? "放宽"}是放宽：先提交审批，另一位超级管理员在「操作记录与审批」批准后才生效，你自己不能批。</p>
        <p>{copy?.tighten ?? "收紧"}是收紧：确认后立即生效。</p>
      </>}>{copy ? `${copy.loosen}要批准 · ${copy.tighten}立即生效` : "按方向生效"}</StatusTag>,
      facts: capFacts,
      statedBrief: { impact: "改的是之后的兑换和排队单下次处理时的规则，已完成的兑换不变。", check: "核对新值和方向；理由写清依据或工单号。" },
      coverageLead: cap.key === "fee" || cap.key === "feeMin"
        ? `${copy?.loosen ?? "放宽"}${name}会让平台多付 USDT，要另一位超级管理员批准`
        : `${copy?.loosen ?? "放宽"}${name}会让平台每天可能多付 USDT，要另一位超级管理员批准`,
      coverageCheck: cap.key === "fee" || cap.key === "feeMin"
        ? "提交审批时和批准时各检查一次：原值没被别人改过；把现在排队中、启用中的非测试账户的单按新旧费用各算一次到手 USDT，多出来的加进应付款后，兑付覆盖率不低于红线。低于红线或算不准都会被拒绝。"
        : "提交审批时和批准时各检查一次：原值没被别人改过；兑付覆盖率不低于红线（这项改动本身不算新增应付款）。低于红线或算不准都拒绝。",
      edit: isQueueMode
        ? { kind: "select", current: capEditValue(cap), currentLabel: originalDirect ? "提交时" : undefined, disallowCurrent: true, initialValue: originalValue === undefined ? undefined : originalValue === "REJECT" ? "拒绝" : "排队", options: ["排队", "拒绝"], amplifiesWhen: { from: "拒绝", to: "排队" } }
        : { kind: "number", current: capEditValue(cap), currentLabel: originalDirect ? "提交时" : undefined, disallowCurrent: true, min: 0,
            initialValue: originalValue,
            max: cap.key === "userDailyCap" ? 10000 : cap.key === "platformDailyCap" ? 10000000 : cap.key === "fee" ? 10 : cap.key === "feeMin" ? 5 : 1000000,
            step: cap.key === "fee" ? 0.01 : 0.1,
            unit: copy?.unit, hint: copy?.hint,
            amplifiesWhen: cap.key === "fee" || cap.key === "feeMin" ? "decrease" : "increase" },
      getPendingReason: () => pendingG2ExchangeCommand(batchAdminId, `/exchange/params/${cap.key}`)?.input.reason ?? paramApproval.getPendingReason(cap.key),
      run: async (reason, value) => {
        const savedDirect = pendingG2ExchangeCommand(batchAdminId, `/exchange/params/${cap.key}`);
        if (originalDirect || savedDirect) {
          if (!savedDirect) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
          if (g2ExchangeCommandExpired(savedDirect)) { await readOriginalCommand(savedDirect); return; }
          try {
            await mutate(`param:${cap.key}`, async () => await retryG2ExchangeCommand(batchAdminId, savedDirect.commandKey) as G2Overview, `${operatorCopyText(cap.name)}已立即生效`, true);
          } catch (error) {
            await reload(true);
            if (!pendingG2ExchangeCommand(batchAdminId, savedDirect.path)) openActionConfirm(null);
            throw error;
          }
          return;
        }
        const saved = paramApproval.record(cap.key);
        if (original && !saved) { openActionConfirm(null); throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。"); }
        const view = latest.current;
        const currentCap = view.overview?.caps.find(row => row.key === cap.key);
        const auth = useAdminAuth.getState();
        if (!saved && currentCap?.pendingApproval === true) throw new Error(messageOf("OBJECT_LOCKED_BY_A2"));
        if (!saved && (!currentCap || view.loading || view.busyKey || view.readFailed || view.rereadPending
          || (view.overview!.swap.emergencyPaused === true && !["fee", "feeMin"].includes(cap.key))
          || !auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session?.adminId
          || !auth.session?.authorities.includes(capAuthority(cap.key)))) {
          openActionConfirm(null);
          setError("当前兑换参数暂不能修改，请重新读取当前状态后操作。");
          return;
        }
        const nextValue = saved ? undefined : normalizeCapSubmitValue(currentCap!, value);
        if (!saved && (!nextValue || (cap.key === "queueMode" ? nextValue === currentCap!.value : Number(nextValue) === Number(currentCap!.value)))) return;
        setBusyKey(`param:${cap.key}`);
        setError("");
        try {
          if (saved) {
            await paramApproval.retry(saved.request.obj);
            return;
          }
          const result = await paramApproval.run({ key: cap.key, current: currentCap!.value, value: nextValue!, reason },
            () => updateG2ExchangeParam(cap.key, nextValue!, reason, OPERATOR(), currentCap!));
          setLockedParams(rows => { const next = { ...rows }; delete next[cap.key]; return next; });
          if ("direct" in result) {
            readGeneration.current += 1;
            setLoading(false);
            setOverview(result.direct);
            toast(`${operatorCopyText(cap.name)}已立即生效`);
          }
        } catch (err) {
          const code = (err as { backendMessage?: string } | null)?.backendMessage;
          if (code === "OBJECT_LOCKED_BY_A2" || code === "OBJECT_ALREADY_PENDING") setLockedParams((rows) => ({ ...rows, [cap.key]: messageOf(err) }));
          if (paramApproval.record(cap.key) || err instanceof G2OutcomeUnknownError) coveredErrors.current.add(messageOf(err));
          setError(messageOf(err));
          if (saved && !paramApproval.record(saved.request.obj)) { await reload(true); openActionConfirm(null); }
          throw err;
        } finally {
          setDirectCommands(listG2ExchangeCommands(batchAdminId).filter(record => record.path !== "/exchange/queue/process"));
          setBusyKey(null);
        }
      },
    });
  };

  function toggleSwap() {
    const original = pendingG2ExchangeCommand(batchAdminId, "/exchange/swap");
    if (original && (g2ExchangeCommandExpired(original) || original.context?.queueDepth === undefined
      || !useAdminAuth.getState().session?.authorities.includes("finprod_g2_swap_toggle"))) {
      void readOriginalCommand(original);
      return;
    }
    if (!original && latest.current.j1ExecutionBlocked) return;
    openActionConfirm({ briefKind: "emergency",
      action: "紧急暂停全部兑换",
      title: "紧急暂停全部兑换",
      detail: <>关闭全平台 UVT↔USDT 兑换，并同步到「紧急停用开关」：之后用户新发起的兑换和「处理排队」都会被拒绝。恢复要去「紧急停用开关」页面操作。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmTone: "danger",
      confirmLabel: "确认暂停",
      facts: <Facts>
        <Fact k="暂停的是">全平台 UVT 和 USDT 互换</Fact>
        <Fact k="暂停后">新兑换和「处理排队」都会被拒绝</Fact>
        <Fact k="排队中的兑换">{fmtCount(original?.context?.queueDepth ?? overview!.stats.queueDepth)} 单留着，不退款；暂停期间仍可单笔取消</Fact>
        <Fact k="已完成的兑换">不受影响，不回退</Fact>
        <Fact k="怎么恢复">到「紧急停用开关」恢复，这页没有入口</Fact>
      </Facts>,
      statedBrief: { impact: "之后用户新发起的兑换会被拒绝，直到在「紧急停用开关」恢复。", check: "选暂停原因，理由写清事件和工单号；涉及国家只记进这次的操作记录，不会封锁这些地区。" },
      amplifies: false,
      businessForm: { kind: "multi-field", title: "暂停原因", fields: [
        { key: "triggerBasis", label: "类型", current: "PRICE_ANOMALY", inputKind: "select", options: ["REGULATORY", "PRICE_ANOMALY", "SECURITY_INCIDENT", "OTHER"], optionLabels: { REGULATORY: "监管要求", PRICE_ANOMALY: "价格异常", SECURITY_INCIDENT: "安全事件", OTHER: "其他" }, required: true },
        { key: "geoBlock", label: "涉及国家（用逗号分隔）", current: "", inputKind: "text", required: false, help: "写国家代码，例如 VN, TH；只记进这次暂停的操作记录，不会封锁这些地区" },
      ] },
      getPendingReason: () => pendingG2ExchangeCommand(batchAdminId, "/exchange/swap")?.input.reason,
      getPendingBusinessValue: () => {
        const saved = pendingG2ExchangeCommand(batchAdminId, "/exchange/swap");
        return saved ? { triggerBasis: saved.input.triggerBasis!, geoBlock: saved.input.geoBlock!.join(",") } : undefined;
      },
      run: async (reason, _value, businessValue) => {
        const saved = pendingG2ExchangeCommand(batchAdminId, "/exchange/swap");
        if (original || saved) {
          if (!saved) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
          if (g2ExchangeCommandExpired(saved)) { await readOriginalCommand(saved); return; }
          try { await mutate("swap:pause", async () => await retryG2ExchangeCommand(batchAdminId, saved.commandKey) as G2Overview, "兑换已紧急暂停", true); }
          catch (error) { await reload(true); if (!pendingG2ExchangeCommand(batchAdminId, saved.path)) openActionConfirm(null); throw error; }
          return;
        }
        if (!latest.current.overview || latest.current.j1ExecutionBlocked || latest.current.loading || latest.current.readFailed || latest.current.rereadPending || latest.current.busyKey) {
          throw new Error("当前兑换参数暂不能修改，请重新读取当前状态后操作。");
        }
        const countries = (businessValue?.geoBlock ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await mutate("swap:pause", () => updateG2ExchangeSwapStatus(false, reason, OPERATOR(), {
          geoBlock: countries, triggerBasis: businessValue?.triggerBasis, queueDepth: stats.queueDepth,
        }), "兑换已紧急暂停");
      },
    });
  }

  const cancelQueue = (requestedOrder: G2ExchangeOrder) => {
    setQueueDrawer(null);
    const path = `/exchange/queue/${encodeURIComponent(requestedOrder.exchangeNo)}/cancel`;
    const original = pendingG2ExchangeCommand(batchAdminId, path);
    const order = original?.context?.order ?? requestedOrder;
    if (original && (g2ExchangeCommandExpired(original) || !original.context?.order
      || !useAdminAuth.getState().session?.authorities.includes("finprod_g2_queue_cancel"))) {
      void readOriginalCommand(original);
      return;
    }
    openActionConfirm({ briefKind: "funds",
      action: `取消排队中的兑换 · ${order.exchangeNo}`,
      title: "取消这笔排队兑换",
      detail: <>取消这笔排队中的兑换（{order.exchangeAmountDisplay}），立即生效，之后不会再成交。有资金预占记录的，退回已预占的来源币种金额并记退款账本；无预占记录的历史订单，只取消订单，不扣款也不退款。</>,
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      confirmTone: "danger",
      confirmLabel: "确认取消",
      facts: <Facts>
        <Fact k="折合" lead tone="role-1" unit="USDT">{amount(order.amountUsdtText ?? order.amountUsdt)}</Fact>
        <Fact k="影响">1 单</Fact>
        <Fact k="兑换单号"><span data-mono>{order.exchangeNo}</span></Fact>
        <Fact k="用户">{order.userNo} · {operatorNicknameText(order.nickname)}</Fact>
        <Fact k="兑换">{orderAmount(order)}</Fact>
        <Fact k="退款">有预占记录的退回 {assetNum(order.fromAmountText ?? order.fromAmount, order.fromAsset)} {order.fromAsset}（原来源币种、原数额）；没有预占记录的历史单只取消，不扣不退</Fact>
      </Facts>,
      statedBrief: { impact: "这笔兑换马上取消，之后不会再成交；不收取消费。", check: "核对单号和用户，理由写清为什么由后台取消。" },
      getPendingReason: () => pendingG2ExchangeCommand(batchAdminId, path)?.input.reason,
      run: async (reason) => {
        const saved = pendingG2ExchangeCommand(batchAdminId, path);
        if (original || saved) {
          if (!saved) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
          if (g2ExchangeCommandExpired(saved)) { await readOriginalCommand(saved); return; }
          try { await mutate(`cancel:${order.exchangeNo}`, async () => await retryG2ExchangeCommand(batchAdminId, saved.commandKey) as G2Overview, "已取消", true); }
          catch (error) { await reload(true); if (!pendingG2ExchangeCommand(batchAdminId, path)) openActionConfirm(null); throw error; }
          return;
        }
        const view = latest.current;
        if (view.loading || view.readFailed || view.rereadPending || view.busyKey || !view.overview?.queue.some(row => row.exchangeNo === order.exchangeNo && row.status === "QUEUED")) {
          throw new Error("当前兑换参数暂不能修改，请重新读取当前状态后操作。");
        }
        await mutate(`cancel:${order.exchangeNo}`, () => cancelG2ExchangeQueueOrder(order.exchangeNo, reason, OPERATOR(), order), "已取消");
      },
    });
  };


  /** 预计处理时长、预计说法：直接保存，确认后立即生效，不走审批；没收到结果时按原操作重试或查询。 */
  const editEta = (key: EtaKey) => {
    const path = `/exchange/params/${key}`;
    const original = pendingG2ExchangeCommand(batchAdminId, path);
    if (original && (g2ExchangeCommandExpired(original) || !original.context?.cap
      || !useAdminAuth.getState().session?.authorities.includes(capAuthority(key)))) {
      void readOriginalCommand(original);
      return;
    }
    // 没收到结果的是一次清空（提交的是空值）：按清空的确认框重试，调整框不收空值。
    if (original && original.input.value === "") { clearEta(key); return; }
    const name = ETA[key].name;
    const estimate = latest.current.overview?.queueEstimate;
    const hoursNow = estimate?.hours?.trim() ?? "";
    const copyNow = estimate?.copy?.trim() ?? "";
    const current = original?.context?.cap?.value ?? etaRaw(estimate, key);
    const cap: G2Cap = original?.context?.cap ?? { key, name, sub: "", value: current, displayValue: current, note: "", loosen: false };
    const appLanguage = ETA_APP_LANGUAGE[key];
    const shown = (value: string) => {
      const hours = key === "queueEtaHours" ? value : hoursNow;
      const copy = key === "queueEtaHours" ? copyNow : value;
      if (!etaHoursValid(hours)) return `「预计处理时长」还没设好，${appLanguage ? "App" : "排队单"}上先不显示`;
      if (appLanguage) return <>App {appLanguage}界面显示：「{etaSentence(copy, hours)}」</>;
      if (etaCopyIssue(copy)) return "「英文预计说法」还没设好，排队单上先不显示";
      return <>排队单上显示：「{etaSentence(copy, hours)}」</>;
    };
    openActionConfirm({ briefKind: "config",
      action: `调整排队预计 · ${name}`,
      title: original ? `${name} · 按原操作重试` : `调整${name}`,
      detail: <>{ETA[key].what}。</>,
      effect: original
        ? <StatusTag tone="warn" icon={CircleHelp} explain="提交结果未知，可能已经生效。有效期内按原操作重试，不会重复执行；过期后只能查询。">结果未知</StatusTag>
        : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认修改",
      facts: <Facts>
        <Fact k="改的是">{name}</Fact>
        <Fact k="什么时候生效">{original ? "提交结果未知，可能已经生效。有效期内按原操作重试，不会重复执行；过期后只能查询。" : "确认后立即生效，不用审批"}</Fact>
        {appLanguage
          ? <Fact k="显示在哪">App {appLanguage}界面，兑换进入排队时的提示；H5 不显示</Fact>
          : <><Fact k="排队中的兑换">单上的预计时间马上按新值显示</Fact><Fact k="显示在哪">这页排队单的详情，App 兑换进入排队时的提示；H5 不显示</Fact></>}
      </Facts>,
      statedBrief: { impact: appLanguage ? `改的是 App ${appLanguage}界面写的预计时间，不改处理顺序，也不会让单子自动成交。` : "改的是排队单上写的预计时间，不改处理顺序，也不会让单子自动成交。", check: "核对新值；理由写清依据或工单号。" },
      edit: key === "queueEtaHours"
        ? { kind: "number", current, displayCurrent: current ? undefined : "未设置", currentLabel: original ? "提交时" : undefined, disallowCurrent: true,
            initialValue: original?.input.value, min: 1, max: 999, step: 1, maxDecimals: 0, unit: "小时", hint: "1–999 的整数",
            validate: value => etaHoursValid(value) ? undefined : "填 1–999 的整数，开头不要写 0", preview: shown }
        : { kind: "text", current, displayCurrent: current ? undefined : "未设置", currentLabel: original ? "提交时" : undefined, disallowCurrent: true,
            initialValue: original?.input.value, hint: "写预计多久，不写具体几点；用 {hours} 代表小时数",
            validate: etaCopyIssue, preview: shown },
      getPendingReason: () => pendingG2ExchangeCommand(batchAdminId, path)?.input.reason,
      run: async (reason, value) => {
        const saved = pendingG2ExchangeCommand(batchAdminId, path);
        if (original || saved) {
          if (!saved) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
          if (g2ExchangeCommandExpired(saved)) { await readOriginalCommand(saved); return; }
          try { await mutate(`param:${key}`, async () => await retryG2ExchangeCommand(batchAdminId, saved.commandKey) as G2Overview, `${name}已保存`, true); }
          catch (error) { await reload(true); if (!pendingG2ExchangeCommand(batchAdminId, path)) openActionConfirm(null); throw error; }
          return;
        }
        const view = latest.current;
        if (!view.overview?.queueEstimate || view.loading || view.readFailed || view.rereadPending || view.busyKey || !value) {
          throw new Error("当前兑换参数暂不能修改，请重新读取当前状态后操作。");
        }
        await mutate(`param:${key}`, () => updateG2ExchangeParam(key, value, reason, OPERATOR(), cap), `${name}已保存`);
      },
    });
  };

  /** 清空一项预计设置：单独确认，按原保存通路提交空值。 */
  const clearEta = (key: EtaKey) => {
    const path = `/exchange/params/${key}`;
    const original = pendingG2ExchangeCommand(batchAdminId, path);
    if (original && (g2ExchangeCommandExpired(original) || !original.context?.cap
      || !useAdminAuth.getState().session?.authorities.includes(capAuthority(key)))) {
      void readOriginalCommand(original);
      return;
    }
    const name = ETA[key].name;
    const estimate = latest.current.overview?.queueEstimate;
    const current = original?.context?.cap?.value ?? etaRaw(estimate, key);
    const hoursNow = etaRaw(estimate, "queueEtaHours");
    const cap: G2Cap = original?.context?.cap ?? { key, name, sub: "", value: current, displayValue: current, note: "", loosen: false };
    const appLanguage = ETA_APP_LANGUAGE[key];
    const after = appLanguage
      ? `App ${appLanguage}界面不再用这句；运营区域语言勾了${appLanguage}时，App 上整条预计都不显示`
      : "排队单上不再显示预计时间，改成「等运营处理」";
    openActionConfirm({ briefKind: "config",
      action: `清空排队预计 · ${name}`,
      title: original ? `清空${name} · 按原操作重试` : `清空${name}`,
      detail: <>{ETA[key].what}。</>,
      effect: original
        ? <StatusTag tone="warn" icon={CircleHelp} explain="提交结果未知，可能已经清空。有效期内按原操作重试，不会重复执行；过期后只能查询。">结果未知</StatusTag>
        : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认清空",
      facts: <Facts>
        <Fact k="改的是">{name}</Fact>
        <Fact k="现在">{key === "queueEtaHours" ? paramValueText(key, current) : etaHoursValid(hoursNow) ? etaSentence(current, hoursNow) : current}</Fact>
        <Fact k="清空后" tone="danger">{after}</Fact>
        <Fact k="什么时候生效">{original ? "提交结果未知，可能已经清空。有效期内按原操作重试，不会重复执行；过期后只能查询。" : "确认后立即生效，不用审批"}</Fact>
      </Facts>,
      statedBrief: { impact: "只清空这一项，不改兑换的处理顺序。", check: "理由写清为什么清空，或写工单号。" },
      getPendingReason: () => pendingG2ExchangeCommand(batchAdminId, path)?.input.reason,
      run: async (reason) => {
        const saved = pendingG2ExchangeCommand(batchAdminId, path);
        if (original || saved) {
          if (!saved) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
          if (g2ExchangeCommandExpired(saved)) { await readOriginalCommand(saved); return; }
          try { await mutate(`param:${key}`, async () => await retryG2ExchangeCommand(batchAdminId, saved.commandKey) as G2Overview, `${name}已清空`, true); }
          catch (error) { await reload(true); if (!pendingG2ExchangeCommand(batchAdminId, path)) openActionConfirm(null); throw error; }
          return;
        }
        const view = latest.current;
        if (!view.overview?.queueEstimate || view.loading || view.readFailed || view.rereadPending || view.busyKey) {
          throw new Error("当前兑换参数暂不能修改，请重新读取当前状态后操作。");
        }
        await mutate(`param:${key}`, () => updateG2ExchangeParam(key, "", reason, OPERATOR(), cap), `${name}已清空`);
      },
    });
  };

  const operationNotice = error && !mc && !coveredErrors.current.has(error)
    ? <Notice tone="warn" title="操作提示">{error}</Notice>
    : null;

  if (loading && !overview) {
    return (
      <>
        {header}
        {recoveryNotice()}
        <BlockState state="loading" title="正在加载兑换额度与规则…" />
        {confirmModal}
      </>
    );
  }

  if (!overview) {
    return (
      <>
        {header}
        {operationNotice}
        {recoveryNotice()}
        <BlockState state="error" title="兑换数据加载失败"
          detail={overviewReadError || "没有收到数据。"}
          onRetry={() => void reload()} />
        {confirmModal}
      </>
    );
  }

  const { stats, swap, caps, queue, gateDetails, geoBlocked } = overview;
  const busy = !!busyKey;
  const busyReason = busy ? "正在处理上一项，稍候再操作" : undefined;
  const newWriteBlockedReason = loading || readFailed || rereadPending ? "当前值没读到，重试成功后再改" : undefined;
  const totalGate = stats.gateUser + stats.gatePlatform + stats.gateGeo;
  const selectedQueue = queueDrawer ? queue.find((row) => row.exchangeNo === queueDrawer) : null;
  const gateTiles: { key: GateKey; label: string; count: number; explain: string }[] = [
    { key: "user", label: "个人额度超限", count: stats.gateUser, explain: "今天创建、现在状态是「个人额度超限」的兑换单数。排进队列的不算在这里。" },
    { key: "platform", label: "平台额度超限", count: stats.gatePlatform, explain: "今天创建、现在状态是「平台额度超限」的兑换单数。排进队列的不算在这里。" },
    { key: "geo", label: "地区封锁", count: stats.gateGeo, explain: "今天创建、因用户所在地区被封锁而拦下的兑换单数。" },
  ];
  const platformCap = caps.find((cap) => cap.key === "platformDailyCap");
  const queueModeRaw = caps.find((cap) => cap.key === "queueMode")?.value.trim().toUpperCase();
  const queueModeNow = queueModeRaw === "QUEUE" || queueModeRaw === "REJECT" ? queueModeRaw : undefined;
  const userCap = caps.find((cap) => cap.key === "userDailyCap");
  const platformCapValue = platformCap ? Number(platformCap.value) : Number.NaN;
  const usedMicros = micros(stats.todayUsd);
  const capMicros = Number.isFinite(platformCapValue) ? micros(platformCapValue) : undefined;
  const leftMicros = capMicros === undefined ? undefined : capMicros - usedMicros;
  const queueTotalMicros = queue.reduce((sum, row) => sum + micros(row.amountUsdtText ?? row.amountUsdt), BigInt(0));
  const queueAllVisible = queue.length >= stats.queueDepth;

  const openBatch = () => openActionConfirm({ briefKind: "funds",
    action: "处理排队中的兑换",
    title: "处理排队中的兑换",
    detail: <>按当前 UVT 价格、每日额度、地区封锁和用户余额逐单检查，符合条件的马上成交。批次开始前和逐笔复核时都会检查风险披露闸门。</>,
    effect: <><StatusTag tone="progress" filled>立即执行</StatusTag><IrreversibleTag>成交后不能撤销</IrreversibleTag></>,
    confirmLabel: "确认处理",
    facts: (value?: string) => {
      const count = value && /^\d+$/.test(value) ? Number(value) : undefined;
      const oldest = count === undefined ? [] : [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(a.id) - Number(b.id)).slice(0, count);
      const oldestMicros = oldest.reduce((sum, row) => sum + micros(row.amountUsdtText ?? row.amountUsdt), BigInt(0));
      return <Facts>
        <Fact k="这一批" lead unit={count === undefined ? undefined : "单"}>{count === undefined ? "填写最多处理几单" : `最多 ${fmtCount(count)}`}</Fact>
        <Fact k="选哪几单">从最早排队的开始选，不限创建日期；不是列表里勾选的行。停用账户和测试账户的单不在这一批里</Fact>
        <Fact k="金额">{count === undefined ? `排队中 ${fmtCount(stats.queueDepth)} 单` : queueAllVisible && stats.queueDepth > 0
          ? `按列表估算：最早 ${fmtCount(Math.min(count, queue.length))} 单合计 ${fromMicros(oldestMicros)} USDT。列表里停用、测试账户的单也算进去了，以处理结果为准`
          : `列表只显示最近 ${fmtCount(queue.length)} 单，算不出这一批的金额；处理结果里逐单列出`}</Fact>
        <Fact k="每一单">依次检查兑换开关、风险披露闸门、用户、钱包、平台和个人日额度、地区、手续费；通过的马上成交，额度不够的留在队列；额度检查通过后地区被封锁的取消，有预占的退回</Fact>
        {batchBlockedNote && <Fact k="现在" tone="warn">{batchBlockedNote}</Fact>}
      </Facts>;
    },
    statedBrief: { impact: "符合条件的排队单马上成交、记账；处理结果逐单列出。", check: "核对处理数量，理由写清依据或工单号。" },
    edit: { kind: "number", current: String(Math.min(queue.length, 50)), min: 1, max: 100, step: 1, unit: "单", hint: "1–100 的整数" },
    getPendingReason: () => pendingG2QueueBatch(batchAdminId)?.reason,
    run: async (reason, value) => {
      const saved = pendingG2QueueBatch(batchAdminId);
      if (saved && g2ExchangeCommandExpired(saved)) { await checkOriginalBatch(saved); return; }
      if (!saved) {
        const view = latest.current;
        if (!view.overview || view.loading || view.readFailed || view.rereadPending || view.busyKey) {
          throw new Error("当前值没读到，重试成功后再改");
        }
        if (view.batchBlockedReason) throw new Error(view.batchBlockedReason);
      }
      try {
        await processQueueBatch(saved?.limit ?? Number(value || 50), saved?.reason ?? reason);
      } catch (error) {
        const rejection = explicitRejectionCode(error);
        const gateRejected = rejection === "EXCHANGE_DISCLOSURE_GATE_CLOSED" || rejection === "EXCHANGE_SWAP_PAUSED";
        if (saved || gateRejected) {
          await reload(true, gateRejected ? messageOf(error) : undefined);
          if (!pendingG2QueueBatch(batchAdminId)) openActionConfirm(null);
        }
        throw error;
      }
    },
  });

  // 一句话结论：先说开着还是暂停，再说有没有要人处理的排队。
  const killSwitchLink = reach("/emergency/kill-switch") ? <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>紧急停用开关</Link> : "「紧急停用开关」";
  // 兑换开关读不出时分三种：没有这一项、存的值不是开或关（后端这两种都按关处理），后端没给这一项。
  const switchUnread = swap.emergencyPaused !== null ? null
    : overview.emergencySwitch?.exchange.unavailableReason === "MISSING" ? "missing"
    : overview.emergencySwitch?.exchange.unavailableReason === "INVALID" ? "invalid" : "absent";
  const disclosureLink = reach("/content/disclosures") ? <Link className="rd-link" href="/content/disclosures" prefetch={false}>法律条款与风险披露</Link> : "「法律条款与风险披露」";
  // 两道都挡着时，各入口只解除自己那一道：分两步写，不说去一处就能恢复。
  const bothStepsHint = <>新兑换和处理排队都会被拒绝，排队的单留在队列；到 {killSwitchLink} 打开兑换开关、到 {disclosureLink} 把兑换移出受限动作，两步都做完后可继续处理。</>;
  const disclosureExplain = <p>风险披露闸门：兑换在「法律条款与风险披露」的受限动作里。移出要提交审批，批准后才解除；已经处理过的批次照常能查原结果。</p>;
  const conclusion = switchUnread === "absent" && !disclosureBlocked
    ? <Conclusion state="warn" icon={CircleHelp}
        hint={<>真实状态到 {killSwitchLink} 看。</>}
        explain={<>
          <p>兑换开关的状态暂时读不到。这页不据此判断用户能不能兑换，也不当成暂停。</p>
        </>}>这页读不到兑换开关</Conclusion>
    : switchUnread === "missing" || switchUnread === "invalid"
    ? <Conclusion state="warn" icon={ShieldAlert}
        hint={disclosureBlocked ? bothStepsHint : <>新兑换和处理排队都会被拒绝，排队的单留在队列；到 {killSwitchLink} 打开兑换开关后可继续处理。</>}
        explain={<>
          <p>{switchUnread === "missing" ? "「紧急停用开关」里没有兑换这一项。" : "「紧急停用开关」里兑换这一项存的不是开或关。"}这种情况兑换一律按关闭处理。</p>
          <p>点「紧急暂停兑换」会提示已经是关的；额度和超额度处置策略照常能改。</p>
          {disclosureBlocked && disclosureExplain}
        </>}>{switchUnread === "missing" ? "兑换开关没有设置" : "兑换开关设置有误"}{disclosureBlocked ? "，风险披露闸门也在阻断兑换" : "，兑换现在是停的"}</Conclusion>
    : swap.emergencyPaused
    ? <Conclusion state="warn" icon={PauseCircle}
        hint={disclosureBlocked ? bothStepsHint
          : <>处理排队也会被拒绝，排队的单留在队列；到 {killSwitchLink} 恢复后可继续处理。{canWriteAny ? "暂停期间仍可改手续费、取消排队单。" : ""}</>}
        explain={<>
          <p>「紧急停用开关」里的兑换开关现在是关的，可能是在这页或那一页关的。</p>
          <p>暂停时，用户新发起的兑换和「处理排队」都会被拒绝；额度和超额度处置策略要等恢复后再改。{disclosureBlocked && canWriteAny ? "手续费照常能改，排队单照常能取消。" : ""}</p>
          {disclosureBlocked && disclosureExplain}
        </>}>{disclosureBlocked ? "兑换已暂停，风险披露闸门也在阻断兑换" : "兑换已暂停，新发起的兑换会被拒绝"}</Conclusion>
    : disclosureBlocked
    ? <Conclusion state="warn" icon={ShieldAlert}
        hint={<>新兑换和处理排队都会被拒绝，排队的单留在队列；到 {disclosureLink} 把兑换移出受限动作后可继续处理。</>}
        explain={<>
          <p>{swap.emergencyPaused === false ? "兑换开关是开着的。" : "兑换开关的状态暂时读不到，移出后还要兑换开关开着才能处理。"}挡住兑换的是风险披露闸门：兑换在「法律条款与风险披露」的受限动作里。</p>
          <p>移出要提交审批，批准后才解除；已经处理过的批次照常能查原结果。</p>
        </>}>
        风险披露闸门已阻断兑换</Conclusion>
    : stats.queueDepth > 0
      ? <Conclusion state="warn" icon={ListOrdered}
          hint={canProcessBatch ? "排队的单不会自动成交，在下面「排队中的兑换」点「处理排队」。" : "排队的单不会自动成交，请有处理权限的同事处理。"}
          explain={<>
            <p>排队数是所有还在排队的单，不限哪天创建。没有定时处理，由运营确认后成交，到账时间以实际处理为准。</p>
          </>}>
          兑换开着，有 {fmtCount(stats.queueDepth)} 单在排队等处理</Conclusion>
      : <Conclusion state="neutral" icon={ArrowLeftRight}
          explain={<>
            <p>只说开关和队列：兑换开着、没有排队的单。今天的额度用量和拦截在下面。</p>
          </>}>
          兑换开着，队列是空的{totalGate > 0 ? `，今天拦下 ${fmtCount(totalGate)} 次` : ""}</Conclusion>;

  const capRows = PARAM_ORDER.map((key) => caps.find((cap) => cap.key === key)).filter((cap): cap is G2Cap => !!cap)
    .concat(caps.filter((cap) => !PARAM_ORDER.includes(cap.key)));
  const configRows = capRows.map((cap) => {
    const copy = PARAM[cap.key];
    const name = paramName(cap.key, cap.name);
    const record = paramApproval.record(cap.key);
    const direct = directCommands.find(row => row.path === `/exchange/params/${cap.key}`);
    const recovery = record ? paramApproval.list().find((row) => row.commandKey === record.commandKey) : undefined;
    const pausedBlocked = swap.emergencyPaused === true && !["fee", "feeMin"].includes(cap.key);
    const canEdit = allowed(capAuthority(cap.key));
    const disabledReason = busyReason ?? (!record && !direct && cap.pendingApproval === true ? messageOf("OBJECT_LOCKED_BY_A2") : !record && !direct && newWriteBlockedReason ? newWriteBlockedReason
      : !record && !direct && pausedBlocked ? "兑换已暂停，额度和超额度处置策略暂时不能改；手续费仍可改" : undefined);
    return (
      <ConfigRow key={cap.key} name={name}
        what={copy?.what ?? operatorCopyText(cap.sub)}
        when={copy ? `${copy.loosen}是放宽，提交审批，另一位超级管理员批准后生效；${copy.tighten}是收紧，确认后立即生效` : undefined}
        effect={copy ? `${copy.future}；${copy.queue}` : undefined}
        note={[
          copy?.extra,
          canEdit && !canPropose && copy ? `这个账号没有发起审批的权限，只能${copy.tighten}；${copy.loosen}请有提案权的同事发起。` : undefined,
          (cap.pendingApproval === true || lockedParams[cap.key]) && !record ? `这一项有一张审批单还没处理完，${cap.pendingApproval === true && cap.pendingOperationId ? `单号 ${cap.pendingOperationId}` : "页面看不到单号"}；批准、驳回或撤回之前，调高调低都改不了。` : undefined,
        ].filter(Boolean).join(" ") || undefined}
        value={<span className="g2x-param">
          <span className="g2x-value">
            <span className="g2x-value-num">{paramValueText(cap.key, cap.value, cap.displayValue)}</span>
            {recovery && recoveryTag(recovery)}
            {!recovery && direct && (g2ExchangeCommandExpired(direct) ? expiredTag("direct") : unknownTag("direct"))}
            {!record && (cap.pendingApproval === true || lockedParams[cap.key]) && <StatusTag tone="warn" icon={Lock} explain={`${cap.pendingApproval === true && cap.pendingOperationId ? `审批单 ${cap.pendingOperationId}：` : ""}${lockedParams[cap.key] || messageOf("OBJECT_LOCKED_BY_A2")}`}>审批锁定中</StatusTag>}
          </span>
          {copy && <span className="g2x-dir">{copy.short}要批准</span>}
        </span>}
        action={canEdit || record || direct ? (describedBy) => (
          <Button size="sm" aria-describedby={describedBy} aria-label={record || direct ? `查询${name}的原操作` : `调整${name}`}
            disabledReason={disabledReason} onClick={() => direct ? void readOriginalCommand(direct) : void adjCap(cap)}>{record || direct ? "查询原操作" : "调整"}</Button>
        ) : undefined} />
    );
  });


  // 预计设置：后端给了 queueEstimate 才显示（旧版后端没有这两项，单上的预计也不显示）。
  const estimate = overview.queueEstimate;
  const etaHours = estimate?.hours?.trim() ?? "";
  const etaCopy = estimate?.copy?.trim() ?? "";
  const etaReady = etaHoursValid(etaHours) && !etaCopyIssue(etaCopy);
  const etaFirstMissing: EtaKey | undefined = etaReady ? undefined : !etaHoursValid(etaHours) ? "queueEtaHours" : "queueEtaCopy";
  const etaRows = estimate ? (["queueEtaHours", "queueEtaCopy", "queueEtaCopyZh", "queueEtaCopyVi"] as const).map((key) => {
    const name = ETA[key].name;
    const direct = directCommands.find(row => row.path === `/exchange/params/${key}`);
    const raw = etaRaw(estimate, key);
    const appLanguage = ETA_APP_LANGUAGE[key];
    const valueText = key === "queueEtaHours" ? paramValueText(key, raw) : !raw ? (appLanguage ? "未设置 · 选填" : "未设置") : etaHoursValid(etaHours) ? etaSentence(raw, etaHours) : raw;
    return (
      <ConfigRow key={key} name={name}
        what={ETA[key].what}
        where={appLanguage ? `App ${appLanguage}界面，兑换进入排队时的提示；H5 不显示` : "这页排队单的详情，App 兑换进入排队时的提示；H5 不显示"}
        when="确认后立即生效，不用审批"
        effect={appLanguage ? `运营区域语言没勾${appLanguage}时可以不填；勾了就要填好，不然 App 上整条预计都不显示` : "排队中的单和之后排队的单，单上的预计时间都按新值显示"}
        note={appLanguage ? "要写上 {hours}；清空后这种语言不再用这句。" : "「预计处理时长」和「英文预计说法」都设好后，排队单上才显示预计时间；清空任一项，排队单上就不显示。"}
        value={<span className="g2x-param">
          <span className="g2x-value">
            <span className={key !== "queueEtaHours" ? "g2x-eta-copy" : "g2x-value-num"} title={key !== "queueEtaHours" && raw ? valueText : undefined}>{valueText}</span>
          </span>
          {direct ? <span className="g2x-dir">{g2ExchangeCommandExpired(direct) ? expiredTag("direct") : unknownTag("direct")}</span>
            : etaFirstMissing === key
            ? <span className="g2x-dir"><StatusTag tone="warn" explain="两项都设好后才显示。">排队单上不显示</StatusTag></span>
            : <span className="g2x-dir">立即生效</span>}
        </span>}
        action={allowed(capAuthority(key)) || direct ? (describedBy) => (
          <span className="rd-row-actions">
            {!direct && raw && allowed(capAuthority(key)) && <Button size="sm" variant="ghost" aria-label={`清空${name}`}
              disabledReason={busyReason ?? newWriteBlockedReason} onClick={() => clearEta(key)}>清空</Button>}
            <Button size="sm" aria-describedby={describedBy} aria-label={direct ? `查询${name}的原操作` : `调整${name}`}
              disabledReason={busyReason ?? (!direct ? newWriteBlockedReason : undefined)} onClick={() => direct ? void readOriginalCommand(direct) : editEta(key)}>{direct ? "查询原操作" : "调整"}</Button>
          </span>
        ) : undefined} />
    );
  }) : [];

  const batchAction = (canProcessBatch || ownPendingBatch) && (ownPendingBatch
    ? <Button size="sm" variant="primary" disabledReason={busyReason} onClick={() => {
      setRecoveryError(null);
      setRecoveryKey(ownPendingBatch.commandKey);
    }}>核对原处理</Button>
    : <Button size="sm" variant="primary" disabledReason={busyReason ?? newWriteBlockedReason ?? batchButtonNote ?? (queue.length === 0 ? "队列是空的，没有可处理的单" : undefined)} onClick={openBatch}>处理排队</Button>);

  const batchItems = batchResult ? [
    ...batchResult.completed.map((row) => ({ ...row, kind: "completed" as const })),
    ...batchResult.skipped.map((row) => ({ ...row, kind: "skipped" as const })),
    ...batchResult.failed.map((row) => ({ ...row, kind: "failed" as const })),
  ] : [];

  return (
    <>
      {header}
      {confirmModal}
      {operationNotice}
      {conclusion}
      {recoveryNotice()}

      <StatBand label="兑换摘要">
        <Stat label="兑换开关" icon={swap.emergencyPaused === null ? CircleHelp : !swap.emergencyPaused ? PlayCircle : PauseCircle}
          tone={switchUnread === "absent" ? "neutral" : switchUnread || swap.emergencyPaused ? "warn" : "ok"}
          value={switchUnread === "absent" ? "—" : switchUnread === "missing" ? "没有设置" : switchUnread === "invalid" ? "设置有误" : !swap.emergencyPaused ? "开着" : "已暂停"}
          sub={switchUnread === "absent" ? "这页读不到" : switchUnread ? "按关闭处理" : swap.emergencyPaused ? "新发起的兑换会被拒绝" : disclosureBlocked ? "兑换被风险披露闸门挡住" : "用户可以发起兑换"}
          explain={switchUnread === "absent" ? "这次没读到兑换开关的状态，到「紧急停用开关」看。"
            : switchUnread ? "「紧急停用开关」里的兑换开关读不出开或关，兑换按关闭处理。"
            : "和「紧急停用开关」里的兑换开关是同一个。"} />
        <Stat label="排队中" icon={ListOrdered} tone={stats.queueDepth > 0 ? "warn" : "role-3"}
          value={fmtCount(stats.queueDepth)} unit="单"
          sub={stats.queueDepth > queue.length ? `列表显示最近 ${fmtCount(queue.length)} 单` : stats.queueDepth > 0 ? `合计 ${fromMicros(queueTotalMicros)} USDT` : undefined}
          explain="所有还在排队的单，不限哪天创建。排队的单不会自动成交，由运营在这页点「处理排队」，到账时间以实际处理为准。" />
        <Stat label="今日拦截" icon={Ban} tone="role-4" value={fmtCount(totalGate)} unit="次"
          sub={`个人 ${fmtCount(stats.gateUser)} · 平台 ${fmtCount(stats.gatePlatform)} · 地区 ${fmtCount(stats.gateGeo)}`}
          explain="今天创建、现在是三种拦截状态的兑换单数之和；按系统业务日算，不按你电脑的时区。" />
        <Stat label="今日兑换成交" icon={Coins} tone="role-1" value={amount(stats.todayUsd)} unit="USDT"
          sub={`占平台日额度 ${percent(stats.poolPct)}`}
          explain="今天创建、已完成的兑换里 USDT 那一边的金额：UVT 换 USDT 是用户到手的金额（扣了手续费），USDT 换 UVT 是用户付出的金额。" />
      </StatBand>

      <div className="rd-split" data-even="">
        <Panel title="今天的额度" icon={Gauge} tone="role-1"
          explain={<>
            <p>看条：平台今天的额度用了多少、还剩多少。用完后，超出的兑换按「超额度处置策略」排队等运营处理，或直接拒绝。</p>
            <p>用量是今天已完成兑换的 USDT 金额（UVT 换 USDT 按到手金额），占比由系统算；放行每一笔时按系统记的已用量判断。</p>
          </>}>
          <div className="g2x-quota">
            <div className="g2x-quota-head">
              <span className="g2x-quota-name">平台日额度</span>
              <span className="g2x-quota-pct">{capMicros !== undefined && capMicros > BigInt(0) ? percent(stats.poolPct) : "—"}</span>
            </div>
            <RatioBar label="平台日额度用量" value={stats.todayUsd} total={Number.isFinite(platformCapValue) ? platformCapValue : 0}
              valueText={`已兑换 ${amount(stats.todayUsd)} USDT，日额度 ${platformCap ? amount(platformCap.value) : "—"} USDT`} tone="role-1"
              state={capMicros === BigInt(0) ? "empty" : undefined}
              emptyText="平台日额度是 0：之后的兑换都会被拦下"
              invalidText="今天已兑换的金额超过现在的日额度，条画不出来；这里按到手金额算，放行时按系统记的已用量判断" />
            <dl className="g2x-quota-nums">
              <div><dt>已兑换</dt><dd>{amount(stats.todayUsd)} USDT</dd></div>
              <div><dt>日额度</dt><dd>{platformCap ? paramValueText("platformDailyCap", platformCap.value) : "—"}</dd></div>
              <div><dt>还剩</dt><dd>{leftMicros === undefined ? "—" : leftMicros < BigInt(0) ? "0 USDT" : `${fromMicros(leftMicros)} USDT`}</dd></div>
            </dl>
          </div>
          <div className="g2x-quota g2x-quota-user">
            <div className="g2x-quota-head">
              <span className="g2x-quota-name">单用户日额度<Explain label="单用户日额度怎么看" content="按人算，系统没给每个人用了多少，所以这里不画条；看今天有多少次因为个人额度被拦。" /></span>
              <span className="g2x-quota-pct">{userCap ? `每人 ${paramValueText("userDailyCap", userCap.value)}` : "—"}</span>
            </div>
          </div>
          <div className="g2x-gates" role="group" aria-label="今天被拦下的兑换">
            <div className="g2x-gates-title">今天被拦下的兑换</div>
            {gateTiles.map((tile) => (
              <button key={tile.key} type="button" className="g2x-gate" data-zero={tile.count === 0 ? "" : undefined}
                onClick={() => setGateDrawer(tile.key)} aria-label={`${tile.label} ${tile.count} 次，看清单`}>
                <span className="g2x-gate-name">{tile.label}</span>
                <span className="g2x-gate-count">{fmtCount(tile.count)}<small>次</small></span>
                <span className="g2x-gate-more">看清单</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="兑换参数" icon={SlidersHorizontal} tone="role-4"
          explain={<>
            <p>每项自己保存。往「让平台多付」的方向改（调高额度、调低手续费、从拒绝改成排队）要另一位超级管理员批准，批准前什么都不变；反方向确认后立即生效。</p>
            <p>同一项有待批的申请时被审批锁住，调高调低都改不了，直到批准、驳回或撤回。</p>
            <p>兑换暂停时，两个额度和超额度处置策略不能改，其余各项仍可改。</p>
            {estimate && <p>预计处理时长和预计说法不涉及付钱，确认后立即生效。</p>}
          </>}>
          <ConfigList label="兑换参数">{configRows}{etaRows}</ConfigList>
        </Panel>
      </div>

      <Panel title="排队中的兑换" icon={ListOrdered} tone="role-3" className="g2x-queue"
        sub={`${stats.queueDepth > queue.length ? `共 ${fmtCount(stats.queueDepth)} 单 · 列表显示最近 ${fmtCount(queue.length)} 单` : `共 ${fmtCount(stats.queueDepth)} 单`} · 时间为${businessZone().label}`}
        explain={<>
          <p>超过个人或平台日额度、用户选了「超额时排队」的兑换在这里等运营处理，不会自动成交，到账时间以实际处理为准。点「处理排队」时，系统从最早排队的开始逐单检查。</p>
          <p>新排队的单已经从用户的来源币种里预占了金额，成交时不再扣；取消时退回预占的原币。没有预占记录的历史单成交时才扣、取消时不退。</p>
          <p>列表按排队时间从新到旧，最多显示 50 单，没有翻页。</p>
        </>}
        actions={batchAction || undefined}>
        {batchResult && (
          <div data-proof="g2-batch-result" className="g2x-batch">
            <Notice tone={batchResult.outcome === "FAILED" ? "danger" : batchResult.outcome === "COMPLETED" || batchResult.outcome === "EMPTY" ? "ok" : "warn"}
              title={`处理结果 · ${summarizeG2BatchResult(batchResult)}`}>
              <p>选中 {fmtCount(batchResult.selectedCount)} 单：成交 {fmtCount(batchResult.completedCount)}，跳过 {fmtCount(batchResult.skippedCount)}，失败 {fmtCount(batchResult.failedCount)}；还在排队 {fmtCount(batchResult.remainingQueuedCount)} 单。列表已刷新。</p>
            </Notice>
            {batchItems.length > 0 && <Table label="这一批逐单结果" className="g2x-batch-table">
              <thead><tr><Th>兑换单号</Th><Th>结果</Th><Th>原因</Th><Th>订单现在</Th></tr></thead>
              <tbody>{batchItems.map((row) => {
                // 后端原因写的是内部代号和「熔断」，闸门挡住、兑换暂停的单换成和结论同一个叫法。
                const reason = row.reasonCode === "EXCHANGE_DISCLOSURE_GATE_CLOSED" ? "风险披露闸门已阻断兑换，本单仍在队列"
                  : row.reasonCode === "EXCHANGE_SWAP_PAUSED" ? "兑换已暂停，本单仍在队列" : row.reason;
                return (
                <tr key={`${row.kind}-${row.exchangeNo}`}>
                  <Td><ExchangeNo value={row.exchangeNo} /></Td>
                  <Td>{row.kind === "completed" ? <StatusTag tone="done">已成交</StatusTag> : row.kind === "skipped" ? <StatusTag tone="warn">跳过</StatusTag> : <StatusTag tone="danger">失败</StatusTag>}</Td>
                  <Td grow><Cell main={reason || "—"} title={reason || undefined} /></Td>
                  <Td>{batchOrderStatusLabel[row.orderStatus]}</Td>
                </tr>
                );
              })}</tbody>
            </Table>}
          </div>
        )}
        <Table label="排队中的兑换" className="g2x-queue-table" data-tight="">
          <thead>
            <tr><Th>兑换单号</Th><Th>用户</Th><Th align="right">兑换</Th><Th>排队原因</Th><Th>排队时间</Th></tr>
          </thead>
          <tbody>
            {queue.length === 0 && <TableMessage columns={5}>没有排队中的兑换。</TableMessage>}
            {queue.map((order) => (
              <Tr key={order.exchangeNo} selected={order.exchangeNo === queueDrawer} onOpen={busy ? undefined : () => setQueueDrawer(order.exchangeNo)}>
                <Td><ExchangeNo value={order.exchangeNo} /></Td>
                <Td><Cell main={order.userNo} sub={operatorNicknameText(order.nickname)} title={`${order.userNo} · ${operatorNicknameText(order.nickname)}`} /></Td>
                <Td align="right"><Cell num main={`${assetNum(order.toAmountText ?? order.toAmount, order.toAsset)} ${order.toAsset}`} sub={`${assetNum(order.fromAmountText ?? order.fromAmount, order.fromAsset)} ${order.fromAsset} 换`} /></Td>
                <Td grow><Cell main={queueReasonText(order)} title={queueReasonText(order)} /></Td>
                <Td><Cell num main={timeText(order.createdAt)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Fold title="地区封锁" icon={Globe2} tone="role-other"
        summary={geoBlocked.length ? `${fmtCount(geoBlocked.length)} 个地区 · ${geoBlocked.map((row) => row.cc).join(" / ")}` : "没有封锁的地区"}
        explain={<><p>在「地区访问限制」页修改，这里只能查看。用户发起兑换时按访问来源的国家拦截。</p><p>处理排队时，一单先过兑换开关、风险披露闸门、用户、钱包和额度检查，再看用户资料里的国家：被封锁的取消，有预占的退回；前面没过的留在队列。</p><p>改封锁地区本身不会马上取消已经在排队的单。</p></>}
        actions={reach("/emergency/geo-block", "emergency_j2_read") ? <Link className="rd-link" href="/emergency/geo-block" prefetch={false}>去「地区访问限制」 →</Link> : undefined}>
        {geoBlocked.length === 0
          ? <BlockState state="empty" compact title="没有封锁的地区" detail="这里只列「地区访问限制」里状态是封锁的地区。" />
          : <Table label="封锁的地区" className="g2x-geo-table">
            <thead><tr><Th>国家代码</Th><Th>名称</Th><Th>原因</Th></tr></thead>
            <tbody>{geoBlocked.map((row) => (
              <tr key={row.cc}><Td><span data-mono>{row.cc}</span></Td><Td>{row.name}</Td><Td grow><Cell main={row.reason} title={row.reason} /></Td></tr>
            ))}</tbody>
          </Table>}
      </Fold>

      <Fold title="技术信息（数据来源）" icon={Database} tone="role-other" summary={`${fmtCount(overview.sources.length)} 个来源`}>
        <p className="g2x-sources" data-mono>{overview.sources.join(" / ")} · exchange.swapped</p>
        <p className="g2x-sources-note">exchange.swapped 是用户兑换成交时发出的事件名；只改参数不会发。</p>
      </Fold>

      {recoveryBatch && <Modal title="核对原处理" icon={ShieldCheck} busy={busy} onClose={() => setRecoveryKey(null)}
        sub={<StatusTag tone="neutral">只查原结果，不发新批次</StatusTag>}
        footer={<>
          <Button disabled={busy} onClick={() => setRecoveryKey(null)}>取消</Button>
          <Button variant="primary" loading={busy} onClick={() => void checkOriginalBatch(recoveryBatch)}>{busy ? "核对中…" : "核对原处理"}</Button>
        </>}>
        <Facts>
          <Fact k="原处理笔数">{recoveryBatch.limit} 单</Fact>
          <Fact k="原操作理由"><span className="g2x-wrap">{recoveryBatch.reason}</span></Fact>
          <Fact k="原批次编号"><span data-mono className="g2x-wrap">{recoveryBatch.commandKey}</span></Fact>
        </Facts>
        {recoveryError && <Notice tone={recoveryError.notFound ? "warn" : "danger"} title={recoveryError.notFound ? "没有查到原批次的结果" : "这次没核对成"}>
          {/* 查不到时标题已经说了，不再把同一句写一遍。 */}
          {!recoveryError.notFound && <p>{recoveryError.message}</p>}
          {recoveryError.notFound && <p>查不到不代表原批次没执行。原记录继续保留在这台电脑上，可以稍后再核对；要确认结果，到「操作记录与审批」核对，或请技术值班核对这一批的账本。</p>}
        </Notice>}
      </Modal>}

      {gateDrawer && (() => {
        const detail = gateDetails[gateDrawer];
        const tile = gateTiles.find((row) => row.key === gateDrawer)!;
        return (
          <Drawer open wide onClose={() => setGateDrawer(null)} title={`${tile.label}的拦截记录`} icon={Ban} tone="role-4"
            sub={`今天 ${fmtCount(detail.count)} 次${detail.count > detail.rows.length ? ` · 列出最近 ${fmtCount(detail.rows.length)} 条` : ""}`}
            explain={<>
              <p>{tile.explain}</p>
              {gateDrawer !== "geo" && queueModeNow && <p>{queueModeNow === "QUEUE"
                ? "现在超额度处置策略是「排队」：用户选了「超额时排队」的进入排队，其余直接拒绝。"
                : "现在超额度处置策略是「拒绝」：超过额度的兑换直接拒绝，不排队。"}</p>}
              <p>只能查看。要调额度改「兑换参数」。额度和地区检查不看信任名单，把用户加进信任名单不能让这些兑换通过。</p>
            </>}
            footer={<Decision primary={<Button onClick={() => setGateDrawer(null)}>关闭</Button>} />}>
            <Table label={`${tile.label}的拦截记录`} className="g2x-gate-table">
              <thead><tr><Th>用户</Th><Th>兑换单号</Th><Th align="right">兑换</Th><Th>说明</Th></tr></thead>
              <tbody>
                {detail.rows.length === 0 && <TableMessage columns={4}>暂无拦截记录</TableMessage>}
                {detail.rows.map((row) => (
                  <tr key={row.exchangeNo}>
                    <Td><Cell main={row.userNo} sub={operatorNicknameText(row.nickname)} /></Td>
                    <Td><ExchangeNo value={row.exchangeNo} /></Td>
                    <Td align="right"><Cell num main={`${assetNum(row.toAmountText ?? row.toAmount, row.toAsset)} ${row.toAsset}`} sub={`${assetNum(row.fromAmountText ?? row.fromAmount, row.fromAsset)} ${row.fromAsset} 换`} /></Td>
                    <Td grow><Cell main={gateReasonText(row)} title={gateReasonText(row)} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Drawer>
        );
      })()}

      {selectedQueue && (
        <Drawer open onClose={() => setQueueDrawer(null)} title="排队中的兑换" icon={ListOrdered} tone="role-3"
          sub={<span data-mono>{selectedQueue.exchangeNo}</span>} busy={busy}
          footer={allowed("finprod_g2_queue_cancel") || directCommands.some(record => record.path === `/exchange/queue/${encodeURIComponent(selectedQueue.exchangeNo)}/cancel`) ? <Decision
            note="取消后之后不会再成交；有预占记录的退回原币，没有预占的历史单只取消。"
            danger={<Button variant="danger-outline" disabledReason={busyReason ?? (directCommands.some(record => record.path === `/exchange/queue/${encodeURIComponent(selectedQueue.exchangeNo)}/cancel`) ? undefined : newWriteBlockedReason)} aria-label="取消这笔兑换" onClick={() => cancelQueue(selectedQueue)}>取消这笔兑换</Button>} /> : undefined}>
          <JudgmentPoints rows={[
            { label: "排队原因", value: queueReasonText(selectedQueue), state: "warn" },
            estimate && selectedQueue.etaLabel && selectedQueue.etaLabel !== "—"
              ? { label: "预计处理", value: selectedQueue.etaLabel, reason: "按「兑换参数」里设的预计显示，不是排好的处理时间。" }
              : { label: "预计处理", value: "等运营处理", reason: "没有排好的处理时间，由运营在这页点「处理排队」后成交，到账时间以实际处理为准。" },
            { label: "用户所在地区", value: selectedQueue.countryCode, reason: "处理排队时按这个国家判断地区封锁。" },
          ]} />
          <Facts>
            <Fact k="兑换" lead tone="role-1" unit={selectedQueue.toAsset}>{assetNum(selectedQueue.toAmountText ?? selectedQueue.toAmount, selectedQueue.toAsset)}</Fact>
            <Fact k="付出">{assetNum(selectedQueue.fromAmountText ?? selectedQueue.fromAmount, selectedQueue.fromAsset)} {selectedQueue.fromAsset}</Fact>
            <Fact k="折合">{amount(selectedQueue.amountUsdtText ?? selectedQueue.amountUsdt)} USDT</Fact>
            <Fact k="方向">{operatorCopyText(selectedQueue.directionLabel)}</Fact>
            <Fact k="汇率">{selectedQueue.rate ? `1 UVT = ${quantity(selectedQueue.rate)} USDT` : "—"}</Fact>
            <Fact k="用户编码">{selectedQueue.userNo}</Fact>
            <Fact k="用户名">{operatorNicknameText(selectedQueue.nickname)}</Fact>
            <Fact k="状态">{selectedQueue.status === "QUEUED" ? "排队中" : operatorCopyText(selectedQueue.statusLabel)}</Fact>
            <Fact k="排队时间">{timeText(selectedQueue.createdAt)}（{businessZone().label}）</Fact>
            <Fact k="最后更新">{timeText(selectedQueue.updatedAt)}（{businessZone().label}）</Fact>
          </Facts>
        </Drawer>
      )}
    </>
  );
}
