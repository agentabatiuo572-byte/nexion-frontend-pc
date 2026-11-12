"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G2 兑换额度与规则（改版，RdPage）— 数据来自后端 /api/admin/market/exchange。
 * 首屏回答：兑换开着还是暂停、今天的额度用了多少、队列里压着多少；每个参数旁写清改哪个方向要另一位超管批准。
 * 读取、写入、审批分流和原申请恢复的逻辑沿用原实现，本文件只换界面。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight, Ban, CircleHelp, Clock3, Coins, Database, Gauge, Globe2, Hourglass, ListOrdered, Lock, PauseCircle, PlayCircle, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Conclusion, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints, Modal, Notice,
  PageHeader, Panel, RatioBar, RdPage, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "../design-kit";
import {
  cancelG2ExchangeQueueOrder,
  fetchG2ExchangeOverview,
  finishLocalG2QueueBatchReview,
  G2BatchReceiptNotFound,
  pendingG2QueueBatch,
  processG2ExchangeQueue,
  recoverG2ExchangeQueue,
  updateG2ExchangeParam,
  updateG2ExchangeSwapStatus,
  type G2Cap,
  type G2ExchangeOrder,
  type G2Overview,
  type G2PendingBatch,
} from "@/lib/admin/g2-client";
import type { ActionConfirmReq } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { classifyStableMutationFailure } from "@/lib/admin/stable-mutation";
import { summarizeG2BatchResult, type G2BatchResult } from "@/lib/admin/g2-batch-result";
import { useGParamApproval, type GParamRecovery } from "@/lib/admin/use-g-param-approval";

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
  confirmTone?: "primary" | "danger";
  coverageLead?: ReactNode;
  coverageCheck?: string;
  reasonPlaceholder?: string;
};

function messageOf(error: unknown) {
  return displayAdminError(error);
}

/** 金额：后端最多 6 位小数。去掉补的 0，至少两位，带千分位；不舍入。 */
function amount(value: number | string) {
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return String(value);
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${BigInt(match[2]).toLocaleString("en-US")}.${fraction}`;
}

/** 资产数量：去掉补的 0，不补位，带千分位。 */
function quantity(value: number) {
  const text = value.toFixed(6).replace(/\.?0+$/, "");
  const [whole, fraction] = text.split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** 百分数：去掉补的 0。 */
function percent(value: number | string) {
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  return `${text.includes(".") ? text.replace(/\.?0+$/, "") : text}%`;
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

/** 以 1e-6 为单位的整数，避免小数相减出错。 */
function micros(value: number) {
  return BigInt(Math.round(value * 1_000_000));
}

function fromMicros(value: bigint) {
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const whole = abs / BigInt(1_000_000);
  const fraction = String(abs % BigInt(1_000_000)).padStart(6, "0");
  return amount(`${negative ? "-" : ""}${whole}.${fraction}`);
}

/** 后端时间原样显示：只把 T 换成空格、去掉秒，不换时区。 */
function timeText(value: string) {
  return value ? value.replace("T", " ").slice(0, 16) : "—";
}

function capEditValue(cap: G2Cap) {
  return cap.key === "queueMode" ? cap.displayValue : cap.value || cap.displayValue;
}

function normalizeCapSubmitValue(cap: G2Cap, value: string | undefined) {
  if (!value) return "";
  if (cap.key !== "queueMode") return value;
  return value === "拒绝" || value.toUpperCase() === "REJECT" ? "REJECT" : "QUEUE";
}

function requireBatchActor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId
      || !auth.session.authorities.includes(BATCH_AUTHORITY)) {
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
    future: "之后的兑换按新额度判断；超过的按「超额度处置策略」排队或拒绝",
    hint: "0–10,000",
    unit: "USDT",
  },
  platformDailyCap: {
    name: "平台日额度", short: "调高",
    loosen: "调高",
    tighten: "调低",
    what: "全平台一天内所有兑换折合 USDT 的总上限",
    queue: "排队中的单下次处理时按新额度判断，不会自动成交",
    future: "之后的兑换按新额度判断；超过的按「超额度处置策略」排队或拒绝",
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
    what: "一笔兑换超过个人或平台日额度时，排进队列还是直接拒绝",
    queue: "已经在排队的单不受影响，不会被转成拒绝或取消",
    future: "之后超额的兑换按新策略处理；改成排队后，用户发起时选了「超额时排队」才会排",
  },
};
const PARAM_ORDER = ["userDailyCap", "platformDailyCap", "fee", "feeMin", "queueMode"];

function paramName(key: string, fallback?: string) {
  return PARAM[key]?.name ?? (fallback ? operatorCopyText(fallback) : key);
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
  if (!value) return "—";
  if (key === "fee") return percent(value);
  if (key === "userDailyCap" || key === "platformDailyCap") return `${amount(value)} USDT`;
  if (key === "feeMin") return `${amount(value)} USDT`;
  return value;
}

/** 原申请记录的状态：标签、色调和气泡。 */
function recoveryTag(record: GParamRecovery) {
  if (record.status === "unknown") return <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经建了审批单。先查询原审批单；24 小时内也可以按原请求重试，后端按原命令号去重，不会建第二张。">结果未知</StatusTag>;
  if (record.status === "pending") return <StatusTag tone="warn" icon={Clock3} explain="等另一位在职超级管理员在「操作记录与审批」批准。批准前参数不变；这一项被审批锁住，调高调低都改不了。">待审批</StatusTag>;
  if (record.status === "expired") return <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试，只能查询原审批单。查不到也不能据此认定没提交。">已过期</StatusTag>;
  const label = { approved: "已批准", rejected: "已驳回", withdrawn: "已撤回" }[record.status];
  return <StatusTag tone="done" explain="原审批单已有结论。点「查询原审批单」读回当前值后，这条记录会清掉。">{label}</StatusTag>;
}

/**
 * 原参数申请：待审批、结果未知、过期的都列在这里，每条写哪个参数、申请改成什么、现在什么状态、能做什么。
 * 只看本机保存的原记录，不依赖概览读取；按钮只查原单或按原请求重试，不拼新申请。
 */
function ParamRecoveryNotice({ approval, toast }: {
  approval: ReturnType<typeof useGParamApproval>;
  toast: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const records = approval.list();
  if (records.length === 0) return null;
  const recover = async (obj: string, retry: boolean) => {
    setBusy(true);
    try {
      if (retry) await approval.retry(obj);
      else if (!await approval.query(obj)) toast("暂未查到原审批单，原记录继续保留。");
    } catch (error) {
      toast(displayAdminError(error));
    } finally {
      setBusy(false);
    }
  };
  const waiting = records.every((record) => record.status === "pending");
  return (
    <Notice tone="warn" title={<>{waiting ? `${records.length} 项参数修改在等审批` : `${records.length} 项参数修改申请待确认`}
      <Explain label="原申请怎么处理" content={<>
        <p>这里只列你在这台电脑上提交过的原申请。原申请只能查询原审批单，或在 24 小时内按原内容、原命令号重试，不能改值。</p>
        <p>要改成别的值，等原申请有结论后再在「额度和手续费」里发起新修改。</p>
      </>} /></>}>
      <ul className="g2x-recover" aria-label="原参数申请">
        {records.map((record) => {
          const key = record.request.obj;
          const params = record.request.command.params as { value?: unknown; expectedValue?: unknown };
          const to = paramValueText(key, typeof params.value === "string" ? params.value : undefined);
          const from = typeof params.expectedValue === "string" ? paramValueText(key, params.expectedValue) : undefined;
          return (
            <li key={record.commandKey}>
              <span className="g2x-recover-name">{paramName(key)}</span>
              <span className="g2x-recover-change">{from ? <Change from={from} to={to} /> : <>申请改成 {to}</>}</span>
              <span className="g2x-recover-state">
                {recoveryTag(record)}
                {record.ticket && <span className="g2x-recover-ticket">审批单 <span data-mono>{record.ticket.id}</span></span>}
              </span>
              <span className="g2x-recover-actions">
                <Button size="sm" disabled={busy} aria-label={`查询${paramName(key)}的原审批单`} onClick={() => void recover(key, false)}>查询原审批单</Button>
                {record.canRetry && <Button size="sm" disabled={busy} aria-label={`按原请求重试${paramName(key)}`} onClick={() => void recover(key, true)}>按原请求重试</Button>}
              </span>
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

/** 兑换单号：放不下时中间省略，留尾段区分。 */
function ExchangeNo({ value }: { value: string }) {
  const tail = value.slice(-8);
  const head = value.slice(0, Math.max(0, value.length - 8));
  return <span className="g2x-no" title={value} data-mono><span className="g2x-no-head">{head}</span><span className="g2x-no-tail">{tail}</span></span>;
}

function orderAmount(order: G2ExchangeOrder) {
  return `${quantity(order.fromAmount)} ${order.fromAsset} → ${quantity(order.toAmount)} ${order.toAsset}`;
}

export function G2Exchange() {
  return <RdPage className="g2x"><G2ExchangePage /></RdPage>;
}

function G2ExchangePage() {
  const reach = useReach();
  const [, toast] = useToast();
  const [mc, openActionConfirm] = useState<G2ConfirmReq | null>(null);
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
  const [readFailed, setReadFailed] = useState(false);
  const paramApproval = useGParamApproval("G2", toast, setError, async () => {
    setReadFailed(true);
    setOverview(await fetchG2ExchangeOverview());
    setReadFailed(false);
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [gateDrawer, setGateDrawer] = useState<GateKey | null>(null);
  const [queueDrawer, setQueueDrawer] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<G2BatchResult | null>(null);
  const [pendingBatch, setPendingBatch] = useState<G2PendingBatch>();
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<{ message: string; notFound: boolean } | null>(null);
  /** 只用于显示：直接修改时后端答复这一项被审批锁住，在这一行标出来。下一次提交仍由后端核对。 */
  const [lockedParams, setLockedParams] = useState<Record<string, string>>({});
  const ownPendingBatch = canProcessBatch && pendingBatch?.adminId === batchAdminId ? pendingBatch : undefined;
  const recoveryBatch = ownPendingBatch?.commandKey === recoveryKey ? ownPendingBatch : undefined;
  const latest = useRef({ overview, loading, busyKey, readFailed });
  latest.current = { overview, loading, busyKey, readFailed };
  const paramRecovery = <ParamRecoveryNotice approval={paramApproval} toast={toast} />;

  useEffect(() => {
    setPendingBatch(canProcessBatch ? pendingG2QueueBatch(batchAdminId) : undefined);
    setRecoveryKey(null);
  }, [batchAdminId, canProcessBatch]);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setReadFailed(true);
    setError("");
    try {
      setOverview(await fetchG2ExchangeOverview());
      setReadFailed(false);
    } catch (err) {
      setOverview(null);
      setError(messageOf(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setReadFailed(true);
      setError("");
      try {
        const next = await fetchG2ExchangeOverview();
        if (!cancelled) {
          setOverview(next);
          setReadFailed(false);
        }
      } catch (err) {
        if (!cancelled) {
          setOverview(null);
          setError(messageOf(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (key: string, action: () => Promise<G2Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      setOverview(await action());
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  const showBatchResult = useCallback((result: Awaited<ReturnType<typeof processG2ExchangeQueue>>) => {
    setOverview(result.overview);
    setBatchResult(result.batch);
    toast(summarizeG2BatchResult(result.batch));
  }, [toast]);

  const processQueueBatch = useCallback(async (limit: number, reason: string) => {
    requireBatchActor(batchAdminId);
    setBusyKey("queue:batch");
    setError("");
    setBatchResult(null);
    try {
      const result = await processG2ExchangeQueue(batchAdminId, limit, reason, OPERATOR());
      requireBatchActor(batchAdminId);
      showBatchResult(result);
    } catch (err) {
      requireBatchActor(batchAdminId);
      const unknown = classifyStableMutationFailure(err) === "outcome-unknown";
      if (unknown) {
        try {
          const current = await fetchG2ExchangeOverview();
          requireBatchActor(batchAdminId);
          setOverview(current);
        } catch {
          // POST 的原始错误仍是主证据；回读失败不能改写成确定失败。
        }
        requireBatchActor(batchAdminId);
        const message = "处理结果暂未确认。可关闭确认框后选择「核对原处理」，查看原批次回执。";
        setError(message);
        toast(message);
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
    setBusyKey("queue:batch");
    setError("");
    setRecoveryError(null);
    try {
      requireBatchActor(original.adminId);
      const result = await recoverG2ExchangeQueue(original.adminId, original.commandKey);
      requireBatchActor(original.adminId);
      showBatchResult(result);
      setRecoveryKey(null);
    } catch (error) {
      setRecoveryError({ message: messageOf(error), notFound: error instanceof G2BatchReceiptNotFound });
    } finally {
      setPendingBatch(pendingG2QueueBatch(original.adminId));
      setBusyKey(null);
    }
  };

  const finishLocalReview = (original: G2PendingBatch) => {
    try {
      requireBatchActor(original.adminId);
      finishLocalG2QueueBatchReview(original.adminId, original.commandKey);
      setRecoveryKey(null);
      setPendingBatch(pendingG2QueueBatch(original.adminId));
    } catch (error) {
      setRecoveryError({ message: messageOf(error), notFound: false });
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
      confirmTone={mc.confirmTone}
      coverageLead={mc.coverageLead}
      coverageCheck={mc.coverageCheck}
      reasonPlaceholder={mc.reasonPlaceholder}
      onClose={() => openActionConfirm(null)}
      onConfirm={async (reason, newValue, businessValue) => {
        await mc.run(reason, newValue, businessValue);
        openActionConfirm(null);
      }}
    />
  );

  const canWriteAny = PARAM_ORDER.some((key) => allowed(capAuthority(key)))
    || allowed("finprod_g2_swap_toggle") || allowed("finprod_g2_queue_cancel") || canProcessBatch;
  const swapEnabled = overview?.swap.enabled;
  const pauseAction = overview && (swapEnabled
    ? allowed("finprod_g2_swap_toggle") && <Button variant="danger-outline" size="sm" icon={<PauseCircle size={14} aria-hidden />}
      disabledReason={busyKey ? "正在处理上一项，稍候再操作" : undefined} onClick={() => toggleSwap()}>紧急暂停兑换</Button>
    : reach("/emergency/kill-switch") && <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>去「紧急停用开关」恢复</Link>);
  const header = (
    <PageHeader pageId="G2" title="兑换额度与规则"
      summary="管 UVT 和 USDT 兑换的额度、手续费和排队。"
      actions={pauseAction || undefined}
      meta={overview ? "打开时读取，不自动刷新；改完用返回的结果刷新" : undefined}
      readOnly={overview && !canWriteAny ? "你只能查看；这个账号没有修改兑换参数、暂停兑换或处理排队的权限。" : undefined} />
  );

  if (loading && !overview) {
    return (
      <>
        {header}
        {paramRecovery}
        <BlockState state="loading" title="正在读取兑换额度与规则…" />
        {confirmModal}
      </>
    );
  }

  if (!overview) {
    return (
      <>
        {header}
        {paramRecovery}
        <BlockState state="error" title="兑换数据读取失败"
          detail={<>页面不显示任何旧数据。点「重新加载」；一直失败请联系值班同事。<Explain label="失败原因" content={error || "没有收到数据。"} /></>}
          retryLabel="重新加载" onRetry={() => void reload()} />
        {confirmModal}
      </>
    );
  }

  const { stats, swap, caps, queue, gateDetails, geoBlocked } = overview;
  const busy = !!busyKey;
  const busyReason = busy ? "正在处理上一项，稍候再操作" : undefined;
  const totalGate = stats.gateUser + stats.gatePlatform + stats.gateGeo;
  const selectedQueue = queueDrawer ? queue.find((row) => row.exchangeNo === queueDrawer) : null;
  const gateTiles: { key: GateKey; label: string; count: number; explain: string }[] = [
    { key: "user", label: "个人额度超限", count: stats.gateUser, explain: "今天创建、现在状态是「个人额度超限」的兑换单数。排进队列的不算在这里。" },
    { key: "platform", label: "平台额度超限", count: stats.gatePlatform, explain: "今天创建、现在状态是「平台额度超限」的兑换单数。排进队列的不算在这里。" },
    { key: "geo", label: "地区封锁", count: stats.gateGeo, explain: "今天创建、因用户所在地区被封锁而拦下的兑换单数。" },
  ];
  const platformCap = caps.find((cap) => cap.key === "platformDailyCap");
  const userCap = caps.find((cap) => cap.key === "userDailyCap");
  const platformCapValue = platformCap ? Number(platformCap.value) : Number.NaN;
  const usedMicros = micros(stats.todayUsd);
  const capMicros = Number.isFinite(platformCapValue) ? micros(platformCapValue) : undefined;
  const leftMicros = capMicros === undefined ? undefined : capMicros - usedMicros;
  const queueTotalMicros = queue.reduce((sum, row) => sum + micros(row.amountUsdt), BigInt(0));
  const queueAllVisible = queue.length >= stats.queueDepth;

  const adjCap = async (cap: G2Cap) => {
    if (!paramApproval.record(cap.key) && !swap.enabled && !["fee", "feeMin"].includes(cap.key)) return;
    const original = await paramApproval.open(cap.key);
    if (original === false) return;
    const isQueueMode = cap.key === "queueMode";
    const originalValue = original?.request.command.params.value as string | undefined;
    const copy = PARAM[cap.key];
    const name = paramName(cap.key, cap.name);
    const currentText = paramValueText(cap.key, cap.value, cap.displayValue);
    const loosens = (value?: string) => {
      if (!value) return undefined;
      if (isQueueMode) return value !== cap.displayValue ? value === "排队" : undefined;
      const next = Number(value);
      const now = Number(capEditValue(cap));
      if (!Number.isFinite(next) || !Number.isFinite(now) || next === now) return undefined;
      return cap.key === "fee" || cap.key === "feeMin" ? next < now : next > now;
    };
    const capFacts = (value?: string) => {
      const loose = original ? undefined : loosens(value);
      const nextText = value ? paramValueText(cap.key, value) : undefined;
      return (
        <div data-proof="g2-cap-preview">
          <Facts>
            <Fact k="改的是">{name}</Fact>
            {original && <Fact k="原申请"><Change from={currentText} to={nextText ?? "—"} /></Fact>}
            <Fact k="什么时候生效" tone={loose ? "warn" : undefined}>{original
              ? original.ticket?.status === "pending"
                ? "审批单在等另一位在职超级管理员批准；批准前参数不变，这一项被锁住"
                : "原申请结果还没确认：有效期内按原内容、原命令号重试，后端不会重复建单"
              : loose === true
                ? "放宽：提交审批，另一位在职超级管理员批准后才生效；批准前参数不变，这一项被锁住"
                : loose === false
                  ? "收紧：确认后立即生效"
                  : value
                    ? "和现在一样：直接保存，参数不变"
                    : `${copy?.loosen ?? "放宽"}要另一位超管批准；${copy?.tighten ?? "收紧"}确认后立即生效`}</Fact>
            {loose === true && !canPropose && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，放宽方向会被拦下；请有提案权和这项修改权限的同事发起</Fact>}
            <Fact k="排队中的兑换">{copy?.queue ?? "—"}</Fact>
            <Fact k="之后的兑换">{copy?.future ?? "—"}</Fact>
            {loose === true && <Fact k="兑付覆盖率（现在）" tone={overview.coverage.redlineBreached ? "danger" : undefined}>{percent(overview.coverage.coverageRatio)}，红线 {percent(overview.coverage.redlinePct)}</Fact>}
          </Facts>
        </div>
      );
    };
    openActionConfirm({ briefKind: "config",
      action: `调整兑换${isQueueMode ? "超额处理方式" : "参数"} · ${operatorCopyText(cap.name)}`,
      title: original ? `${name}的原申请` : `调整${name}`,
      detail: <>{copy?.what ?? operatorCopyText(cap.sub)}。{copy?.extra}</>,
      effect: <StatusTag tone="neutral" icon={ArrowLeftRight} explain={<>
        <p>{copy?.loosen ?? "放宽"}是放宽：先提交审批，另一位在职超级管理员在「操作记录与审批」批准后才生效，你自己不能批。</p>
        <p>{copy?.tighten ?? "收紧"}是收紧：确认后立即生效。新旧值一样时直接保存，参数不变。</p>
      </>}>{copy ? `${copy.loosen}要批准 · ${copy.tighten}立即生效` : "按方向生效"}</StatusTag>,
      facts: capFacts,
      statedBrief: { impact: "改的是之后的兑换和排队单下次处理时的规则，已完成的兑换不变。", check: "核对新值和方向；理由写清依据或工单号。" },
      coverageLead: cap.key === "fee" || cap.key === "feeMin"
        ? `${copy?.loosen ?? "放宽"}${name}会让平台多付 USDT，要另一位超管批准`
        : `${copy?.loosen ?? "放宽"}${name}会让平台每天可能多付 USDT，要另一位超管批准`,
      coverageCheck: cap.key === "fee" || cap.key === "feeMin"
        ? "提交审批时和批准时，后端各检查一次：原值没被别人改过；把现在所有排队中的单按新旧费用各算一次到手 USDT，多出来的加进应付款后，兑付覆盖率不低于红线。低于红线或算不准都拒绝。"
        : "提交审批时和批准时，后端各检查一次：原值没被别人改过；兑付覆盖率不低于红线（这项改动本身不算新增应付款）。低于红线或算不准都拒绝。",
      edit: isQueueMode
        ? { kind: "select", current: cap.displayValue, initialValue: originalValue === undefined ? undefined : originalValue === "REJECT" ? "拒绝" : "排队", options: ["排队", "拒绝"], amplifiesWhen: { from: "拒绝", to: "排队" } }
        : { kind: "number", current: capEditValue(cap), min: 0,
            initialValue: originalValue,
            max: cap.key === "userDailyCap" ? 10000 : cap.key === "platformDailyCap" ? 10000000 : cap.key === "fee" ? 10 : cap.key === "feeMin" ? 5 : 1000000,
            step: cap.key === "fee" ? 0.01 : 0.1,
            unit: copy?.unit, hint: copy?.hint,
            amplifiesWhen: cap.key === "fee" || cap.key === "feeMin" ? "decrease" : "increase" },
      getPendingReason: () => paramApproval.getPendingReason(cap.key),
      run: async (reason, value) => {
        const saved = paramApproval.record(cap.key);
        const view = latest.current;
        const currentCap = view.overview?.caps.find(row => row.key === cap.key);
        const auth = useAdminAuth.getState();
        if (!saved && (!currentCap || view.loading || view.busyKey || view.readFailed
          || (!view.overview!.swap.enabled && !["fee", "feeMin"].includes(cap.key))
          || !auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session?.adminId
          || !auth.session?.authorities.includes(capAuthority(cap.key)))) {
          openActionConfirm(null);
          setError("当前兑换参数暂不能修改，请重新读取当前状态后操作。");
          return;
        }
        const nextValue = saved ? undefined : normalizeCapSubmitValue(currentCap!, value);
        if (!saved && !nextValue) return;
        setBusyKey(`param:${cap.key}`);
        setError("");
        try {
          if (saved) {
            await paramApproval.retry(saved.request.obj);
            return;
          }
          const result = await paramApproval.run({ key: cap.key, current: currentCap!.value, value: nextValue!, reason },
            () => updateG2ExchangeParam(cap.key, nextValue!, reason, OPERATOR()));
          if ("direct" in result) {
            setOverview(result.direct);
            toast(`${operatorCopyText(cap.name)}已立即生效`);
          }
        } catch (err) {
          const code = (err as { backendMessage?: string } | null)?.backendMessage;
          if (code === "OBJECT_LOCKED_BY_A2" || code === "OBJECT_ALREADY_PENDING") setLockedParams((rows) => ({ ...rows, [cap.key]: messageOf(err) }));
          setError(messageOf(err));
          if (saved && !paramApproval.record(saved.request.obj)) openActionConfirm(null);
          if (!paramApproval.record(cap.key)) toast(`操作失败 · ${messageOf(err)}`);
          throw err;
        } finally {
          setBusyKey(null);
        }
      },
    });
  };

  function toggleSwap() {
    if (!swap.enabled) return;
    openActionConfirm({ briefKind: "emergency",
      action: "紧急暂停全部兑换",
      title: "紧急暂停全部兑换",
      detail: <>马上停止全平台所有 UVT↔USDT 兑换，并同步到「紧急停用开关」。恢复要去「紧急停用开关」页面操作。</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmTone: "danger",
      confirmLabel: "确认暂停",
      facts: <Facts>
        <Fact k="暂停的是">全平台 UVT 和 USDT 互换：用户新发起的兑换和「处理排队」都会被拒绝</Fact>
        <Fact k="排队中的兑换">{fmtCount(stats.queueDepth)} 单留在队列，不取消、不退款；暂停期间仍可单笔取消</Fact>
        <Fact k="已完成的兑换">不受影响，不回退</Fact>
        <Fact k="怎么恢复">只能在「紧急停用开关」页面恢复，这页没有恢复入口</Fact>
      </Facts>,
      statedBrief: { impact: "用户马上不能兑换，直到在「紧急停用开关」恢复。", check: "选暂停原因，理由写清事件和工单号；涉及国家只记进这次的操作记录，不会封锁这些地区。" },
      amplifies: false,
      businessForm: { kind: "multi-field", title: "暂停原因", fields: [
        { key: "triggerBasis", label: "原因", current: "PRICE_ANOMALY", inputKind: "select", options: ["REGULATORY", "PRICE_ANOMALY", "SECURITY_INCIDENT", "OTHER"], optionLabels: { REGULATORY: "监管要求", PRICE_ANOMALY: "价格异常", SECURITY_INCIDENT: "安全事件", OTHER: "其他" }, required: true },
        { key: "geoBlock", label: "涉及国家（可选，用逗号分隔）", current: "", inputKind: "text", required: false, help: "写国家代码，例如 VN, TH；只记进这次暂停的操作记录，不会封锁这些地区" },
      ] },
      run: async (reason, _value, businessValue) => {
        const countries = (businessValue?.geoBlock ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await mutate("swap:pause", () => updateG2ExchangeSwapStatus(false, reason, OPERATOR(), {
          geoBlock: countries, triggerBasis: businessValue?.triggerBasis,
        }), "兑换已紧急暂停");
      },
    });
  }

  const cancelQueue = (order: G2ExchangeOrder) => {
    setQueueDrawer(null);
    openActionConfirm({ briefKind: "funds",
      action: `取消排队中的兑换 · ${order.exchangeNo}`,
      title: "取消这笔排队兑换",
      detail: <>取消这笔排队中的兑换（{order.exchangeAmountDisplay}），立即生效，之后不会再成交。有资金预占记录的，退回已预占的来源币种金额并记退款账本；无预占记录的历史订单，只取消订单，不扣款也不退款。</>,
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      confirmTone: "danger",
      confirmLabel: "确认取消",
      facts: <Facts>
        <Fact k="折合" lead tone="role-1" unit="USDT">{amount(order.amountUsdt)}</Fact>
        <Fact k="影响">1 单</Fact>
        <Fact k="兑换单号"><span data-mono>{order.exchangeNo}</span></Fact>
        <Fact k="用户">{order.userNo} · {operatorNicknameText(order.nickname)}</Fact>
        <Fact k="兑换">{orderAmount(order)}</Fact>
        <Fact k="退款">有预占记录的退回 {quantity(order.fromAmount)} {order.fromAsset}（原来源币种、原数额）；没有预占记录的历史单只取消，不扣不退</Fact>
      </Facts>,
      statedBrief: { impact: "这笔兑换马上取消，之后不会再成交；不收取消费。", check: "核对单号和用户，理由写清为什么由后台取消。" },
      run: async (reason) => {
        await mutate(`cancel:${order.exchangeNo}`, () => cancelG2ExchangeQueueOrder(order.exchangeNo, reason, OPERATOR()), "已取消");
      },
    });
  };

  const openBatch = () => openActionConfirm({ briefKind: "funds",
    action: "处理今天的排队兑换",
    title: "处理排队中的兑换",
    detail: <>按当前 UVT 价格、每日额度、地区封锁和用户余额逐单检查，符合条件的马上成交。</>,
    effect: <><StatusTag tone="progress" filled>立即执行</StatusTag><IrreversibleTag>成交后不能撤销</IrreversibleTag></>,
    confirmLabel: "确认处理",
    facts: (value?: string) => {
      const count = value && /^\d+$/.test(value) ? Number(value) : undefined;
      const oldest = count === undefined ? [] : [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || Number(a.id) - Number(b.id)).slice(0, count);
      const oldestMicros = oldest.reduce((sum, row) => sum + micros(row.amountUsdt), BigInt(0));
      return <Facts>
        <Fact k="这一批" lead unit={count === undefined ? undefined : "单"}>{count === undefined ? "填写最多处理几单" : `最多 ${fmtCount(count)}`}</Fact>
        <Fact k="选哪几单">从最早排队的开始选，不限创建日期；不是列表里勾选的行。停用账户和测试账户的单不在这一批里</Fact>
        <Fact k="金额">{count === undefined ? `排队中 ${fmtCount(stats.queueDepth)} 单` : queueAllVisible && stats.queueDepth > 0
          ? `最早的 ${fmtCount(Math.min(count, queue.length))} 单合计 ${fromMicros(oldestMicros)} USDT（实际以处理结果为准）`
          : `列表只显示最近 ${fmtCount(queue.length)} 单，算不出这一批的金额；处理结果里逐单列出`}</Fact>
        <Fact k="每一单">依次检查兑换开关、用户、钱包、平台和个人日额度、地区、手续费；通过的马上成交，额度不够的留在队列，地区被封锁的取消并退回预占</Fact>
        {!swap.enabled && <Fact k="现在" tone="warn">兑换已暂停，后端会拒绝这一批</Fact>}
      </Facts>;
    },
    statedBrief: { impact: "符合条件的排队单马上成交、记账；处理结果逐单列出。", check: "核对处理数量，理由写清依据或工单号。" },
    edit: { kind: "number", current: String(Math.min(queue.length, 50)), min: 1, max: 100, step: 1, unit: "单", hint: "1–100 的整数" },
    run: async (reason, value) => processQueueBatch(Number(value || 50), reason),
  });

  // 一句话结论：先说开着还是暂停，再说有没有要人处理的排队。
  const conclusion = !swap.enabled
    ? <Conclusion state="warn" icon={PauseCircle}
        hint={reach("/emergency/kill-switch") ? <>恢复要到 <Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>紧急停用开关</Link>。暂停期间仍可改手续费、取消排队单。</> : "恢复要请有「紧急停用开关」权限的同事操作。暂停期间仍可改手续费、取消排队单。"}
        explain={<>
          <p>暂停可能是有人在这页或「紧急停用开关」关了兑换，也可能是风险披露没有确认（后端会因此关闭兑换）；页面目前读不到是哪一种。</p>
          <p>暂停时用户不能兑换，「处理排队」也会被后端拒绝；额度和超额度处置策略要等恢复后再改。</p>
        </>}>兑换已暂停，用户现在不能兑换</Conclusion>
    : stats.queueDepth > 0
      ? <Conclusion state="warn" icon={ListOrdered}
          hint={canProcessBatch ? "排队的单不会自动成交，在下面「排队中的兑换」点「处理排队」。" : "排队的单不会自动成交，请有处理权限的同事处理。"}
          explain="排队数是所有还在排队的单，不限哪天创建。后端没有定时处理队列的任务，单子上的「明天 00:00」是固定文字，不是排好的处理时间。">
          兑换开着，有 {fmtCount(stats.queueDepth)} 单在排队等处理</Conclusion>
      : <Conclusion state="neutral" icon={ArrowLeftRight}
          explain="只说开关和队列：兑换开着、没有排队的单。今天的额度用量和拦截在下面。">
          兑换开着，队列是空的{totalGate > 0 ? `，今天拦下 ${fmtCount(totalGate)} 次` : ""}</Conclusion>;

  const capRows = PARAM_ORDER.map((key) => caps.find((cap) => cap.key === key)).filter((cap): cap is G2Cap => !!cap)
    .concat(caps.filter((cap) => !PARAM_ORDER.includes(cap.key)));
  const configRows = capRows.map((cap) => {
    const copy = PARAM[cap.key];
    const name = paramName(cap.key, cap.name);
    const record = paramApproval.record(cap.key);
    const recovery = record ? paramApproval.list().find((row) => row.commandKey === record.commandKey) : undefined;
    const pausedBlocked = !swap.enabled && !["fee", "feeMin"].includes(cap.key);
    const canEdit = allowed(capAuthority(cap.key));
    const disabledReason = busyReason ?? (!record && readFailed ? "当前值没读到，重新加载后再改"
      : !record && pausedBlocked ? "兑换已暂停，额度和超额度处置策略暂时不能改；手续费仍可改" : undefined);
    return (
      <ConfigRow key={cap.key} name={name}
        what={copy?.what ?? operatorCopyText(cap.sub)}
        when={copy ? `${copy.loosen}是放宽，提交审批，另一位在职超级管理员批准后生效；${copy.tighten}是收紧，确认后立即生效` : undefined}
        effect={copy ? `${copy.future}；${copy.queue}` : undefined}
        note={[
          copy?.extra,
          canEdit && !canPropose && copy ? `这个账号没有发起审批的权限，只能${copy.tighten}；${copy.loosen}请有提案权的同事发起。` : undefined,
          lockedParams[cap.key] && !record ? "这一项有一张审批单还没处理完，页面看不到单号；批准、驳回或撤回之前，调高调低都改不了。" : undefined,
        ].filter(Boolean).join(" ") || undefined}
        value={<span className="g2x-param">
          <span className="g2x-value">
            <span className="g2x-value-num">{paramValueText(cap.key, cap.value, cap.displayValue)}</span>
            {recovery && recoveryTag(recovery)}
            {!record && lockedParams[cap.key] && <StatusTag tone="warn" icon={Lock} explain={lockedParams[cap.key]}>审批锁定中</StatusTag>}
          </span>
          {copy && <span className="g2x-dir">{copy.short}要批准</span>}
        </span>}
        action={canEdit || record ? (describedBy) => (
          <Button size="sm" aria-describedby={describedBy} aria-label={record ? `查看${name}的原申请` : `调整${name}`}
            disabledReason={disabledReason} onClick={() => void adjCap(cap)}>{record ? "查看原申请" : "调整"}</Button>
        ) : undefined} />
    );
  });

  const batchAction = canProcessBatch && (ownPendingBatch
    ? <Button size="sm" variant="primary" disabledReason={busyReason} onClick={() => {
      setRecoveryError(null);
      setRecoveryKey(ownPendingBatch.commandKey);
    }}>核对原处理</Button>
    : <Button size="sm" variant="primary" disabledReason={busyReason ?? (queue.length === 0 ? "队列是空的，没有可处理的单" : undefined)} onClick={openBatch}>处理排队</Button>);

  const batchItems = batchResult ? [
    ...batchResult.completed.map((row) => ({ ...row, kind: "completed" as const })),
    ...batchResult.skipped.map((row) => ({ ...row, kind: "skipped" as const })),
    ...batchResult.failed.map((row) => ({ ...row, kind: "failed" as const })),
  ] : [];

  return (
    <>
      {header}
      {confirmModal}
      {error && <Notice tone="warn" title="操作提示">{error}</Notice>}
      {conclusion}
      {paramRecovery}

      <StatBand label="兑换摘要">
        <Stat label="兑换开关" icon={swap.enabled ? PlayCircle : PauseCircle} tone={swap.enabled ? "ok" : "warn"}
          value={swap.enabled ? "开着" : "已暂停"} sub={swap.enabled ? "用户可以兑换" : "用户现在不能兑换"}
          explain="和「紧急停用开关」里的兑换开关是同一个。风险披露没确认时后端也会关闭兑换。" />
        <Stat label="排队中" icon={ListOrdered} tone={stats.queueDepth > 0 ? "warn" : "role-3"}
          value={fmtCount(stats.queueDepth)} unit="单"
          sub={stats.queueDepth > queue.length ? `列表显示最近 ${fmtCount(queue.length)} 单` : stats.queueDepth > 0 ? `合计 ${fromMicros(queueTotalMicros)} USDT` : undefined}
          explain="所有还在排队的单，不限哪天创建。排队的单不会自动成交，要在这页点「处理排队」。" />
        <Stat label="今日拦截" icon={Ban} tone="role-4" value={fmtCount(totalGate)} unit="次"
          sub={`个人 ${fmtCount(stats.gateUser)} · 平台 ${fmtCount(stats.gatePlatform)} · 地区 ${fmtCount(stats.gateGeo)}`}
          explain="今天创建、现在是三种拦截状态的兑换单数之和；按后端业务日算，不按你电脑的时区。" />
        <Stat label="今日兑换成交" icon={Coins} tone="role-1" value={amount(stats.todayUsd)} unit="USDT"
          sub={`占平台日额度 ${percent(stats.poolPct)}`}
          explain="今天创建、已完成的兑换里 USDT 那一边的金额：UVT 换 USDT 是用户到手的金额（扣了手续费），USDT 换 UVT 是用户付出的金额。" />
      </StatBand>

      <div className="rd-split" data-even="">
        <Panel title="今天的额度" icon={Gauge} tone="role-1"
          explain={<>
            <p>看条：平台今天的额度用了多少、还剩多少。快满时，之后的兑换会按「超额度处置策略」排队或被拒。</p>
            <p>用量是今天已完成兑换的 USDT 金额（UVT 换 USDT 按到手金额），占比由后端算；后端放行每一笔时按自己的已用量判断。</p>
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
              invalidText="今天已兑换超过日额度（额度今天被调低过），之后的兑换会被拦下" />
            <dl className="g2x-quota-nums">
              <div><dt>已兑换</dt><dd>{amount(stats.todayUsd)} USDT</dd></div>
              <div><dt>日额度</dt><dd>{platformCap ? paramValueText("platformDailyCap", platformCap.value) : "—"}</dd></div>
              <div><dt>还剩</dt><dd>{leftMicros === undefined ? "—" : leftMicros < BigInt(0) ? "0.00 USDT" : `${fromMicros(leftMicros)} USDT`}</dd></div>
            </dl>
          </div>
          <div className="g2x-quota g2x-quota-user">
            <div className="g2x-quota-head">
              <span className="g2x-quota-name">单用户日额度<Explain label="单用户日额度怎么看" content="按人算，每个人用了多少接口不给，所以这里不画条；看今天有多少次因为个人额度被拦。" /></span>
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

        <Panel title="额度和手续费" icon={SlidersHorizontal} tone="role-4"
          explain={<>
            <p>每项自己保存。往「让平台多付」的方向改（调高额度、调低手续费、从拒绝改成排队）要另一位在职超级管理员批准，批准前什么都不变；反方向确认后立即生效。</p>
            <p>同一项有待批的申请时被审批锁住，调高调低都改不了，直到批准、驳回或撤回。</p>
            <p>兑换暂停时，两个额度和超额度处置策略不能改，两项手续费仍可改。</p>
          </>}>
          <ConfigList label="兑换参数">{configRows}</ConfigList>
        </Panel>
      </div>

      <Panel title="排队中的兑换" icon={ListOrdered} tone="role-3" className="g2x-queue"
        sub={stats.queueDepth > queue.length ? `共 ${fmtCount(stats.queueDepth)} 单 · 列表显示最近 ${fmtCount(queue.length)} 单` : `共 ${fmtCount(stats.queueDepth)} 单`}
        explain={<>
          <p>超过个人或平台日额度、用户选了「超额时排队」的兑换在这里等。它们不会自动成交：点「处理排队」时，后端从最早排队的开始逐单检查。</p>
          <p>新排队的单已经从用户的来源币种里预占了金额，成交时不再扣；取消时退回预占的原币。没有预占记录的历史单成交时才扣、取消时不退。</p>
          <p>列表按排队时间从新到旧，最多显示 50 单，没有翻页。</p>
        </>}
        actions={batchAction || undefined}>
        {ownPendingBatch && <Notice tone="warn" title="上一批处理的结果还没确认">
          <p>点「核对原处理」查原批次回执，确认之前不能开新的一批。</p>
        </Notice>}
        {batchResult && (
          <div data-proof="g2-batch-result" className="g2x-batch">
            <Notice tone={batchResult.outcome === "FAILED" ? "danger" : batchResult.outcome === "COMPLETED" || batchResult.outcome === "EMPTY" ? "ok" : "warn"}
              title={`处理结果 · ${summarizeG2BatchResult(batchResult)}`}>
              <p>选中 {fmtCount(batchResult.selectedCount)} 单：成交 {fmtCount(batchResult.completedCount)}，跳过 {fmtCount(batchResult.skippedCount)}，失败 {fmtCount(batchResult.failedCount)}；还在排队 {fmtCount(batchResult.remainingQueuedCount)} 单。列表已刷新。</p>
            </Notice>
            {batchItems.length > 0 && <Table label="这一批逐单结果" className="g2x-batch-table">
              <thead><tr><Th>兑换单号</Th><Th>结果</Th><Th>原因</Th><Th>订单现在</Th></tr></thead>
              <tbody>{batchItems.map((row) => (
                <tr key={`${row.kind}-${row.exchangeNo}`}>
                  <Td><ExchangeNo value={row.exchangeNo} /></Td>
                  <Td>{row.kind === "completed" ? <StatusTag tone="done">已成交</StatusTag> : row.kind === "skipped" ? <StatusTag tone="warn">跳过</StatusTag> : <StatusTag tone="danger">失败</StatusTag>}</Td>
                  <Td grow><Cell main={row.reason || "—"} title={row.reason || undefined} /></Td>
                  <Td>{batchOrderStatusLabel[row.orderStatus]}</Td>
                </tr>
              ))}</tbody>
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
                <Td align="right"><Cell num main={`${quantity(order.toAmount)} ${order.toAsset}`} sub={`${quantity(order.fromAmount)} ${order.fromAsset} 换`} /></Td>
                <Td grow><Cell main={order.gateReason} title={order.gateReason} /></Td>
                <Td><Cell num main={timeText(order.createdAt)} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Fold title="地区封锁" icon={Globe2} tone="role-other"
        summary={geoBlocked.length ? `${fmtCount(geoBlocked.length)} 个地区 · ${geoBlocked.map((row) => row.cc).join(" / ")}` : "没有封锁的地区"}
        explain="在「地区访问限制」页修改，这里只能查看。用户发起兑换时按访问来源的国家拦截；处理排队时按用户资料里的国家判断，被封锁的单会取消并退回预占。改封锁地区本身不会马上取消已经在排队的单。"
        actions={reach("/emergency/geo-block", "emergency_j2_read") ? <Link className="rd-link" href="/emergency/geo-block" prefetch={false}>去「地区访问限制」</Link> : undefined}>
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
        sub={<StatusTag tone="neutral">只查原回执，不发新批次</StatusTag>}
        footer={<>
          <Button disabled={busy} onClick={() => setRecoveryKey(null)}>取消</Button>
          {recoveryError?.notFound && <Button disabled={busy} onClick={() => finishLocalReview(recoveryBatch)}>结束本机核对</Button>}
          <Button variant="primary" loading={busy} onClick={() => void checkOriginalBatch(recoveryBatch)}>{busy ? "核对中…" : "核对原处理"}</Button>
        </>}>
        <Facts>
          <Fact k="原处理笔数">{recoveryBatch.limit} 单</Fact>
          <Fact k="原操作理由"><span className="g2x-wrap">{recoveryBatch.reason}</span></Fact>
          <Fact k="命令号"><span data-mono className="g2x-wrap">{recoveryBatch.commandKey}</span></Fact>
        </Facts>
        {recoveryError && <Notice tone={recoveryError.notFound ? "warn" : "danger"} title={recoveryError.notFound ? "没有查到原回执" : "这次没核对成"}>
          <p>{recoveryError.message}</p>
          {recoveryError.notFound && <p>查不到不代表原批次没执行。「结束本机核对」只清除这台电脑上的待核对记录，不撤销原批次、不退款。</p>}
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
              <p>只能查看。要调额度改「额度和手续费」。后端的额度和地区检查不看信任名单，把用户加进信任名单不能让这些兑换通过。</p>
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
                    <Td align="right"><Cell num main={`${quantity(row.toAmount)} ${row.toAsset}`} sub={`${quantity(row.fromAmount)} ${row.fromAsset} 换`} /></Td>
                    <Td grow><Cell main={row.gateReason} title={row.gateReason} /></Td>
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
          footer={allowed("finprod_g2_queue_cancel") ? <Decision
            note="取消后退回预占的原币，之后不会再成交。"
            danger={<Button variant="danger-outline" disabledReason={busyReason} aria-label="取消这笔兑换" onClick={() => cancelQueue(selectedQueue)}>取消这笔兑换</Button>} /> : undefined}>
          <JudgmentPoints rows={[
            { label: "排队原因", value: selectedQueue.gateReason, state: "warn" },
            { label: "后端标注", value: selectedQueue.etaLabel === "—" ? "—" : `${selectedQueue.etaLabel} 处理`, reason: "这是后端固定写的文字，不是排好的处理时间；目前要在这页点「处理排队」才会成交。" },
            { label: "用户所在地区", value: selectedQueue.countryCode, reason: "处理排队时按这个国家判断地区封锁。" },
          ]} />
          <Facts>
            <Fact k="兑换" lead tone="role-1" unit={selectedQueue.toAsset}>{quantity(selectedQueue.toAmount)}</Fact>
            <Fact k="付出">{quantity(selectedQueue.fromAmount)} {selectedQueue.fromAsset}</Fact>
            <Fact k="折合">{amount(selectedQueue.amountUsdt)} USDT</Fact>
            <Fact k="方向">{operatorCopyText(selectedQueue.directionLabel)}</Fact>
            <Fact k="汇率">{selectedQueue.rate ? `1 UVT = ${quantity(selectedQueue.rate)} USDT` : "—"}</Fact>
            <Fact k="用户编码">{selectedQueue.userNo}</Fact>
            <Fact k="用户名">{operatorNicknameText(selectedQueue.nickname)}</Fact>
            <Fact k="状态">{operatorCopyText(selectedQueue.statusLabel)}</Fact>
            <Fact k="排队时间">{timeText(selectedQueue.createdAt)}</Fact>
            <Fact k="最后更新">{timeText(selectedQueue.updatedAt)}</Fact>
          </Facts>
        </Drawer>
      )}
    </>
  );
}
