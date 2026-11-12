"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fmtConfigPct } from "@/lib/format";
/**
 * G3 UVT 价格管理（改版，RdPage）。数据来自后端 /api/admin/market/nex/curve 与 /curve/history。
 * 首屏回答「现在价格多少、怎么来的、接下来七天怎么走」：结论一句、四个数、七天计划（走势图 + 逐日表）、最近 24 小时价格和运行方式。
 * 少用的「应急改现价」和后端还没使用的参数收进折叠。读取、提交和恢复逻辑照旧：同一个操作发出的请求和改版前一样。
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity, CalendarRange, CircleHelp, Clock3, Coins, Lock, PauseCircle, Pencil, PinIcon, RefreshCw, ShieldCheck, SlidersHorizontal, Star, TrendingDown, TrendingUp, TriangleAlert, Zap,
} from "lucide-react";
import {
  BlockState, Button, Change, Conclusion, ConfigList, ConfigRow, Explain, Fact, Facts, Figure, Fold, IconButton, Notice, PageHeader, Panel,
  RdPage, Stat, StatBand, StatusTag, Table, Td, Th, TrendLines,
} from "@/app/components/rd";
import {
  fetchG3MarketHistory,
  fetchG3MarketOverview,
  updateG3Control,
  updateG3CurveFrame,
  updateG3Override,
  g3NumberText,
  serializeG3Frames,
  type G3CurveField,
  type G3HistoryPoint,
  type G3Overview,
  type G3OverrideKey,
} from "@/lib/admin/g3-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import type { G3MarketChange } from "@/lib/admin/g3-market-command";
import { OperationConfirmModal, useToast, type BusinessFormValue, type EditSpec, type OperatorBriefKind } from "../design-kit";
import { G3MarketConfirm } from "./g3-market-confirm";

const OPERATOR = currentAdminOperator;

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
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void | Promise<void>;
};

/**
 * 界面已备好、等代码 worker 接逻辑的状态（报告「界面已备好」一节逐条列出）：
 * - OBJECT_STATES：某一项有结果待确认的原操作、有待批审批单、被审批锁住。现在没有读取来源，恒为空。
 *   键：weekly:D1:targetPrice … weekly:D7:volatilityPct、currentPrice、schedule、pin、loop、paused、volatilityPct、oracle、deviationPct、costBasis。
 * - MANUAL_TUNING：后端在当前环境是否允许人工改现价和上涨概率（非开发环境一律 403）。PC 读不到环境，恒为 "unknown"。
 */
type G3ObjectState = { kind: "unknown" | "approval" | "locked"; detail: string };
const OBJECT_STATES: Partial<Record<string, G3ObjectState>> = {};
const MANUAL_TUNING = "unknown" as "unknown" | "forbidden" | "allowed";
const TUNING_FORBIDDEN = "当前环境后端禁止人工修改，提交会被拒绝";
const TUNING_RULE = "开发环境以外，后端拒绝人工改上涨概率和直接改现价：直接保存、提交审批和批准都会被拒。";

const DAY_FIELDS = ["targetPrice", "pumpProbability"] as const;
const FIELD_NAME: Record<G3CurveField, string> = { targetPrice: "目标价", pumpProbability: "上涨概率", volatilityPct: "波动幅度" };
const CONTROL_ORDER = ["pin", "schedule", "loop"];

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

/** 后端原样的采样时间，只把 T 换成空格，不换时区（G3-V04）。 */
function sampleText(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

export function deriveG3RuntimeStatus(paused: boolean, pinValue: string) {
  const pin = pinValue.trim().toUpperCase();
  if (paused) {
    return {
      label: "已暂停",
      detail: "价格停在当前值，不再自动变化。",
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
  if (state.kind === "unknown") return <StatusTag tone="warn" icon={CircleHelp} explain={state.detail}>结果待确认</StatusTag>;
  if (state.kind === "approval") return <StatusTag tone="warn" icon={Clock3} explain={state.detail}>有待批申请</StatusTag>;
  return <StatusTag tone="warn" icon={Lock} explain={state.detail}>审批锁定中</StatusTag>;
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
  const [marketConfirm, setMarketConfirm] = useState<G3MarketChange | null>(null);
  const [confirm, openActionConfirm] = useState<G3ConfirmReq | null>(null);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const curveAuthority = (field: G3CurveField) => field === "targetPrice"
    ? "finprod_g3_curve_target_price_write"
    : field === "pumpProbability"
      ? "finprod_g3_curve_pump_prob_write"
      : "finprod_g3_write";
  const [overview, setOverview] = useState<G3Overview | null>(null);
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
    const [overviewResult, historyResult] = await Promise.allSettled([
      fetchG3MarketOverview(),
      fetchG3MarketHistory(),
    ]);
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
    if (!silent) setLoading(false);
  }, []);

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

  const mutate = useCallback(async (key: string, action: () => Promise<G3Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      const next = await action();
      setOverview(next);
      // 写入成功后回读历史属于附加刷新:历史面失败不能把已成功的写入报成失败。
      const [historyResult] = await Promise.allSettled([fetchG3MarketHistory()]);
      if (historyResult.status === "fulfilled") {
        setHistory(historyResult.value.points);
        setHistoryError("");
      } else {
        setHistory([]);
        setHistoryError(messageOf(historyResult.reason));
      }
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

  const canWriteAny = ["finprod_g3_write", "finprod_g3_curve_target_price_write", "finprod_g3_curve_pump_prob_write", "finprod_g3_override_price_write", "finprod_g3_engine_pause_toggle"].some(allowed);
  const header = (
    <PageHeader pageId="G3" title="UVT 价格管理"
      summary="管 UVT 七天价格计划和价格怎么推进。"
      actions={overview ? <Button variant="ghost" size="sm" loading={refreshing} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void refresh()}>刷新</Button> : undefined}
      meta={overview ? "打开时读取，不自动刷新" : undefined}
      readOnly={overview && !canWriteAny ? "你只能查看；这个账号没有修改价格计划和运行方式的权限。" : undefined} />
  );

  if (loading && !overview) {
    return (
      <>
        {header}
        <BlockState state="loading" title="正在读取 UVT 价格…" />
      </>
    );
  }

  if (!overview) {
    return (
      <>
        {header}
        <BlockState state="error" title="UVT 价格读取失败"
          detail={<>页面不显示任何旧价格。点「重新加载」；一直失败请联系值班同事。{error && <Explain label="失败原因" content={error} />}</>}
          retryLabel="重新加载" onRetry={() => void reload()} />
      </>
    );
  }

  const busy = !!busyKey;
  const busyReason = busy ? "正在保存上一项，稍候再改" : undefined;
  const paused = overview.overrides.paused;
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
  const coverageSnapshot = {
    coverageRatio: overview.coverage.coverageRatio,
    redlinePct: overview.coverage.redlinePct,
  };
  const ctlVals: Record<string, string> = { schedule: schedV, pin: pinV, loop: loopV };
  const ctlOptions: Record<string, string[]> = {
    pin: ["未钉住", ...overview.frames.map((_, index) => `D${index + 1}`)],
    loop: ["循环", "停在末值"],
  };
  const tuningBlocked = MANUAL_TUNING === "forbidden" ? TUNING_FORBIDDEN : undefined;

  const openCurveCellMc = (dayIndex: number, field: G3CurveField) => {
    const frame = overview.frames[dayIndex];
    if (!frame) return;
    const current = frameValue(frame, field);
    if (field === "targetPrice" || field === "pumpProbability") {
      setMarketConfirm({ action: "curve-cell", dayIndex, field, current: g3NumberText(current, field === "pumpProbability" ? 6 : 8),
        expectedRevision: overview.curveRevision ?? "", expectedFrames: serializeG3Frames(overview.frames) });
      return;
    }
    openActionConfirm({ briefKind: "config",
      action: `修改一周价格计划 · D${dayIndex + 1} · ${FIELD_NAME[field]}`,
      title: `修改 D${dayIndex + 1} 波动幅度`,
      detail: "七天计划里每一天各有一个波动幅度，推进到这一天时抄进当天配置。",
      effect: <StatusTag tone="neutral" explain="后端保存这个值，但发布价格时直接用目标价，没有按波动幅度随机涨跌；已提给后端接上或退役。">保存后不影响价格</StatusTag>,
      facts: <Facts>
        <Fact k="改的是">D{dayIndex + 1} 的计划波动幅度（百分数，2 表示 ±2%）</Fact>
        <Fact k="现在用不用">后端还没有使用：价格按目标价发布，现价和用户兑换都不变</Fact>
        <Fact k="提交时检查">七天计划在你打开后没有被别人改过，否则拒绝</Fact>
      </Facts>,
      statedBrief: { impact: "只改七天计划里这一天的波动幅度，现价和用户兑换不变。", check: "核对是哪一天、新值，理由写清依据或工单号。" },
      amplifies: false,
      confirmLabel: "确认修改",
      edit: { kind: "number", current: rawValue(current), min: 0, max: 20, step: 0.01, disallowCurrent: true, unit: "%", hint: "0–20，最多两位小数" },
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`curve:${dayIndex}:${field}`, () => updateG3CurveFrame(
          overview, dayIndex, field, value, reason, OPERATOR(),
        ), `D${dayIndex + 1} ${FIELD_NAME[field]}已保存，到那一天生效`);
      },
    });
  };

  const openCurveCtlMc = (key: string, name: string, current: string) => {
    const isSchedule = key === "schedule";
    const editCurrent = isSchedule ? (scheduleControl?.rawValue ?? (scheduleMissing ? "" : current)) : current;
    if (isSchedule) {
      setMarketConfirm({ action: "schedule", current: editCurrent, expectedRevision: overview.scheduleRevision ?? "" });
      return;
    }
    const pinFacts = (value?: string) => {
      const day = value && /^D[1-7]$/.test(value) ? Number(value.slice(1)) - 1 : -1;
      const target = day >= 0 ? overview.frames[day]?.targetPrice : undefined;
      return <Facts>
        {target !== undefined ? <>
          <Fact k="选了之后"><Change from={priceMissing ? "暂不可用" : `${price(overview.currentPrice)} USDT`} to={`${price(target)} USDT（${value} 目标价）`} /></Fact>
          <Fact k="什么时候变">确认后马上按 {value} 发布现价，之后不再自动切换</Fact>
          {!priceMissing && target > overview.currentPrice && <Fact k="提交时检查" tone="warn">比现价高：后端按 {value} 目标价重估兑付覆盖率，低于红线就拒绝；现行规则不需要审批</Fact>}
        </> : value === "未钉住" ? <>
          <Fact k="选了之后">现价不变，之后按排程从 D{curDay === 7 ? 1 : curDay + 1} 继续推进</Fact>
        </> : <Fact k="现价">{priceMissing ? "暂不可用" : `${price(overview.currentPrice)} USDT`}</Fact>}
      </Facts>;
    };
    const loopFacts = (value?: string) => <Facts>
      <Fact k="选了之后">{value === "停在末值" ? "D7 之后每次推进仍用 D7 的目标价（不是暂停）" : value === "循环" ? "D7 之后回到 D1，按七天计划循环" : "决定 D7 之后用哪一天"}</Fact>
      <Fact k="什么时候变">确认后立即保存，现价不变；到 D7 之后的那次推进才用上</Fact>
    </Facts>;
    openActionConfirm({ briefKind: "config",
      action: `调整价格计划运行方式 · ${name}`,
      title: key === "pin" ? "调整固定生效日" : "调整 D7 之后的走法",
      detail: <><b>{name}</b> · 当前:{current}。{isSchedule ? <>填写每天几点切换，例如 <span className="mono">每日 08:30 Asia/Shanghai 自动推进</span>（北京时间 08:30）。时区名称须紧随时刻；未填时区按 UTC。当前设置：{scheduleMeta}。</> : <>固定某一天或暂停切换，都不会改动已设好的计划。</>}</>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: key === "pin" ? pinFacts : loopFacts,
      statedBrief: key === "pin"
        ? { impact: "固定到某一天会立即按那天的目标价发布现价，之后的兑换按新价；七天计划不变。", check: "核对选的是哪一天和它的目标价，理由写清为什么固定。" }
        : { impact: "只决定 D7 之后怎么走，现价和七天计划都不变。", check: "核对选项，理由写清依据或工单号。" },
      amplifies: false,
      confirmLabel: "确认修改",
      edit: ctlOptions[key]
        ? { kind: "select", current, options: ctlOptions[key], optionLabels: { "未钉住": "不固定" }, disallowCurrent: true }
        : { kind: "text", current: editCurrent, disallowCurrent: true },
      run: async (reason, value) => {
        if (value == null) return;
        await mutate(`control:${key}`, () => updateG3Control(key, value, editCurrent, reason, OPERATOR()), `${name}已立即生效`);
      },
    });
  };

  const adj = (overrideKey: G3OverrideKey, label: string, current: string, note: string, amp?: boolean) => {
    if (overrideKey === "currentPrice") {
      setMarketConfirm({ action: "current-price", current: g3NumberText(overview.currentPrice), expectedRevision: overview.priceRevision ?? "" });
      return;
    }
    const unused = {
      volatilityPct: "后端把它记进当天配置，下次推进时被计划值替换；发布价格直接用目标价，没有按它随机涨跌。",
      deviationPct: "后端只保存这个值，没有任何地方拿现价和外部价格比较，也不会告警。",
      costBasis: "App 接口会带上它，但现在没有页面显示盈亏，也不影响价格和兑换。",
    } as const;
    openActionConfirm({ briefKind: "config",
      action: `手动设置 · ${label}`,
      title: `修改${label}`,
      detail: <><b>{label}</b> · 当前 {current} · {note}。{overrideKey === "deviationPct" || overrideKey === "costBasis" ? "保存后立即生效，之后的价格计划切换不会覆盖此设置，直到再次修改。" : "手动设置只是临时的，下次自动切换时会被计划里的值替换。"}</>,
      effect: <StatusTag tone="neutral" explain="已提给后端接上或退役。">目前不生效</StatusTag>,
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
      run: async (reason, value) => {
        if (!value) return;
        await mutate(`override:${overrideKey}`, () => updateG3Override(overrideKey, value, current, reason, OPERATOR()), `${label}已立即生效`);
      },
    });
  };

  const switchOracle = () => openActionConfirm({ briefKind: "config",
    action: "切换价格来源",
    title: "切换价格来源",
    detail: <>在内部定价和外部价格来源之间切换。只有超级管理员可以操作。</>,
    effect: <StatusTag tone="neutral" explain="已提给后端接上或退役。">目前不生效</StatusTag>,
    facts: <Facts>
      <Fact k="现在用不用">后端只保存这个选项，没有接外部价格：选「外部价格来源」后价格仍按七天计划发布</Fact>
      <Fact k="提交时检查">只有超级管理员能改；打开后来源没有被别人改过</Fact>
    </Facts>,
    statedBrief: { impact: "只改保存的来源选项，价格和用户兑换不变。", check: "核对选项，理由写清依据或工单号。" },
    confirmLabel: "确认切换",
    edit: { kind: "select", current: oracle, options: ["内部做市", "外部喂价"], optionLabels: { "内部做市": "内部定价", "外部喂价": "外部价格来源" }, disallowCurrent: true },
    run: async (reason, value) => {
      if (!value) return;
      await mutate("override:oracle", () => updateG3Override("oracle", value, oracle, reason, OPERATOR()), "价格来源已立即切换");
    },
  });

  const pauseEngine = () => openActionConfirm({ briefKind: "emergency",
    action: paused ? "恢复价格自动变化" : "暂停价格自动变化",
    title: paused ? "恢复价格自动变化" : "暂停价格自动变化",
    detail: paused
      ? <>恢复后价格继续按计划变化。价格上涨会让平台多付钱，覆盖率低于红线时无法恢复（当前 {cov}%，红线 {redline}）。</>
      : <>暂停后每日推进和 5 分钟采样都停下，UVT 价格停在当前值。</>,
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    coverageLead: paused ? "恢复后价格会继续按计划上涨，平台的 UVT 应付款跟着变" : undefined,
    coverageCheck: "恢复时后端用当前兑付覆盖率检查，低于红线或算不准时拒绝；不需要审批。",
    facts: paused
      ? <Facts>
        <Fact k="现价">{priceMissing ? "暂不可用" : `${price(overview.currentPrice)} USDT`}</Fact>
        <Fact k="恢复之后">不会马上切换，等下一次排程时刻推进到下一天{pinned ? `；现在固定在 ${pinV.trim().toUpperCase()}，固定不取消就仍不推进` : ""}{scheduleMissing ? "；自动推进还没配置，配置之前不会推进" : ""}</Fact>
      </Facts>
      : <Facts>
        <Fact k="现价">{priceMissing ? "暂不可用" : `${price(overview.currentPrice)} USDT`}</Fact>
        <Fact k="暂停之后">每日推进和 5 分钟采样都停下</Fact>
        <Fact k="仍会改价的">应急改现价、固定生效日照常发布价格，暂停挡不住这两项</Fact>
      </Facts>,
    statedBrief: paused
      ? { impact: "价格重新按七天计划自动推进，之后的兑换按推进后的价格。", check: "核对兑付覆盖率和固定生效日，理由写清为什么恢复。" }
      : { impact: "价格停在现在的值，用户兑换按这个价，直到恢复。", check: "理由写清为什么暂停、预计多久恢复。" },
    amplifies: paused,
    coverage: paused ? coverageSnapshot : undefined,
    confirmLabel: paused ? "确认恢复" : "确认暂停",
    run: async (reason) => {
      await mutate("override:paused", () => updateG3Override("paused", String(!paused), String(paused), reason, OPERATOR()), paused ? "价格已恢复自动变化" : "价格已暂停变化");
    },
  });

  // 一句话结论：只说配置，不说排程「运行正常」（G3-BE-04）；缺价不写成 0（G3-BE-01）。
  const conclusion = priceMissing
    ? <Conclusion state="warn" explain="后端在没有价格记录时返回 0。0 不是真实价格，页面不按 0 显示，也不按它算任何东西。" hint="先核对价格历史；一直读不到请联系值班同事。">UVT 价格暂时读不到</Conclusion>
    : paused
      ? <Conclusion state="warn" explain="暂停只停自动推进和采样；应急改现价和固定生效日仍会发布价格。">价格已暂停在 {price(overview.currentPrice)} USDT，不再自动推进</Conclusion>
      : overview.coverage.redlineBreached
        ? <Conclusion state="warn" explain="后端在提高价格、固定到更高的一天、恢复自动变化时检查兑付覆盖率，低于红线一律拒绝。">兑付覆盖率 {cov}% 低于红线 {redline}，提高价格会被拒绝</Conclusion>
        : scheduleMissing && !pinned
          ? <Conclusion state="warn" hint={allowed("finprod_g3_write") ? "在「运行方式」里首次配置自动按日推进，批准后启用。" : "请有修改权限的同事在「运行方式」首次配置自动按日推进。"}>自动推进还没配置，价格停在 D{curDay}，不会自动切换</Conclusion>
          : pinned
            ? <Conclusion state="neutral" icon={PinIcon}>价格固定在 {pinV.trim().toUpperCase()}，现价 {price(overview.currentPrice)} USDT，不自动切换</Conclusion>
            : <Conclusion state="neutral" icon={CalendarRange} explain="这句话只说配置：没有暂停、没有固定、排程已配置。页面看不到排程最近一次有没有真的执行。">按计划推进，今天用 D{curDay}，现价 {price(overview.currentPrice)} USDT</Conclusion>;

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
        {DAY_FIELDS.map((field) => {
          const current = frameValue(frame, field);
          const previous = dayIndex > 0 ? frameValue(overview.frames[dayIndex - 1], field) : current;
          const up = dayIndex > 0 && current > previous;
          const down = dayIndex > 0 && current < previous;
          const state = OBJECT_STATES[`weekly:D${dayIndex + 1}:${field}`];
          const canEdit = allowed(curveAuthority(field));
          const blocked = field === "pumpProbability" ? tuningBlocked : undefined;
          return (
            <Td key={field} align="right">
              {state && <span className="g3-cell-tag"><ObjectTag state={state} /></span>}
              <span className="g3-cell">
                {(up || down) && <span className="g3-delta" data-dir={up ? "up" : "down"} title={up ? "比前一天高" : "比前一天低"}>
                  {up ? <TrendingUp size={13} aria-hidden /> : <TrendingDown size={13} aria-hidden />}<span className="rd-sr-only">{up ? "比前一天高" : "比前一天低"}</span>
                </span>}
                <span className="g3-num">{fieldText(field, current)}</span>
                {canEdit && <IconButton data-size="sm" aria-label={`修改 D${dayIndex + 1} ${FIELD_NAME[field]}`} disabledReason={busyReason ?? blocked} onClick={() => openCurveCellMc(dayIndex, field)}><Pencil size={13} aria-hidden /></IconButton>}
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
          <Th align="right"><Explain label="目标价" content={<><p>推进或固定到这一天时，现价按这个值发布。</p><p>提高要另一位有权超管批准，降低直接保存；都只改计划，现价不变。</p></>} />目标价（USDT）</Th>
          <Th align="right"><Explain label="上涨概率" content={<><p>0.35 表示 35%。推进到这一天时写进当天配置；现价按目标价发布，上涨概率不改变发布的价格。</p><p>提高要另一位有权超管批准，降低直接保存。</p><p>{TUNING_RULE}</p></>} />上涨概率（0–1）</Th>
        </tr>
      </thead>
      <tbody>{dayRows}</tbody>
    </Table>
  );
  const planNote = MANUAL_TUNING === "forbidden" && <p className="g3-note"><Lock size={13} aria-hidden />当前环境后端禁止人工改上涨概率，这一列不能改。</p>;

  const objectNotices = Object.entries(OBJECT_STATES).filter(([, state]) => state);
  const controls = [...overview.controls].sort((a, b) => (CONTROL_ORDER.indexOf(a.key) + 99) % 99 - (CONTROL_ORDER.indexOf(b.key) + 99) % 99);
  const controlCopy: Record<string, { name: string; what: string; when: string; effect: string; value: (value: string) => string }> = {
    pin: { name: "固定生效日", what: "把价格固定在七天里的某一天，自动推进停下", when: "确认后立即生效", effect: "选一天马上按那天的目标价发布现价；选「不固定」现价不变，之后按排程继续推进", value: (value) => value === "未钉住" ? "不固定" : `固定在 ${value}` },
    schedule: { name: "自动按日推进", what: "每天几点切换到下一天的目标价，时区写在时刻后面，不写按 UTC", when: "已有排程直接保存，从下一次排程时刻起按新时间；第一次配置要另一位有权超管批准", effect: "只改切换时间，现价不当场变；同一个 UTC 日期最多推进一次", value: (value) => value === "" ? "未配置" : value },
    loop: { name: "D7 之后", what: "七天走完后回到 D1 循环，还是一直用 D7", when: "确认后立即保存，到 D7 之后的那次推进才用上", effect: "只决定 D7 之后怎么走，现价不变；停在末值不是暂停", value: (value) => value },
  };

  return (
    <>
      {header}
      {marketConfirm && session && <G3MarketConfirm session={session} epoch={epoch} requested={marketConfirm}
        today={overview.activeDayIndex} frames={overview.frames} tuning={MANUAL_TUNING}
        onClose={() => setMarketConfirm(null)}
        onDone={(result) => {
          setMarketConfirm(null);
          if (result.active) setOverview(result.active);
          toast(result.acknowledgement);
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
          edit={confirm.edit}
          effect={confirm.effect}
          facts={confirm.facts}
          statedBrief={confirm.statedBrief}
          completionCopy={confirm.completionCopy}
          confirmLabel={confirm.confirmLabel}
          reasonPlaceholder={confirm.reasonPlaceholder}
          onClose={() => openActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            await confirm.run(reason, newValue, businessValue);
            openActionConfirm(null);
          }}
        />
      )}

      {error && <Notice tone="warn">{error}</Notice>}
      {conclusion}

      {objectNotices.length > 0 && (
        <Notice tone="warn" title={`${objectNotices.length} 项原操作结果待确认或在等审批`}>
          <p>表里带标记的那一项，打开后按原操作查询或重试；确认之前不要换个值重新提交。</p>
        </Notice>
      )}

      <StatBand label="UVT 价格摘要">
        <Stat lead tone="role-1" icon={Coins} label="UVT 现价" value={priceMissing ? "—" : price(overview.currentPrice)} unit={priceMissing ? undefined : "USDT"}
          sub={priceMissing ? "价格暂不可用" : `${offPlan ? `今天计划 ${price(todayTarget)}` : `等于 D${curDay} 计划价`} · ${changeText}`}
          explain={<>
            <p>1 UVT 折合多少 USDT，是用户兑换时用的价格，取最近一次发布的价格记录。</p>
            <p>计划价要等推进或固定到这一天才发布；应急改价也会让现价和计划价不同，下次推进时恢复计划价。</p>
            <p>24 小时涨跌按最近 24 小时第一个和最后一个采样价算。</p>
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
            <p>提高价格、固定到更高的一天、恢复自动变化时，后端按拟发布的价格重估，低于红线就拒绝。</p>
            <p>读不到可靠数据时后端也可能返回 0，这时以「资金储备与应付款」为准。</p>
          </>} />
      </StatBand>

      <Panel title="七天价格计划" icon={CalendarRange} tone="role-1"
        sub={`今天 D${curDay} · 共 7 天 · ${loopV === "停在末值" ? "D7 之后停在末值" : "D7 之后回到 D1"}`}
        explain={<>
          <p>看图：七天里目标价怎么走、今天在第几天、哪天最高。现价和今天计划价的对照在「最近 24 小时价格」。</p>
          <p>改计划不改现价。推进到某一天（或固定到这一天）时，现价才按它的目标价发布。</p>
          <p>开发环境以外，后端拒绝人工改上涨概率；待批的提高申请存在时，后端现在仍允许直接降低这一项，会让原审批单批准时冲突。</p>
        </>}>
        <Figure width={520} stack="wide" graphic={planChart}>
          {planTable}
          {planNote}
        </Figure>
      </Panel>

      <div className="rd-split" data-even="">
        <Panel title="最近 24 小时价格" icon={Activity} tone="role-1"
          sub={chartPrices.length >= 2 ? `${historyPoints.length} 个采样点 · 最近 ${sampleText(historyLatest ?? "")}` : undefined}
          explain={<>
            <p>看图：价格这一天实际怎么走的，有没有到今天的计划价。</p>
            <p>后端每 5 分钟记一次已发布的价格；暂停或没有价格时不记。时间按后端记录原样显示。</p>
          </>}>
          {chartPrices.length >= 2 ? (
            <TrendLines label={`最近 24 小时 UVT 价格，${changeText}`} height={168}
              ticks={historyTicks}
              series={[{ key: "price", label: "价格", slot: 1, values: historyPoints.map((point) => point.price) }]}
              format={(value) => `${price(value)} USDT`} axisFormat={(value) => price(value)}
              marks={[{ key: "plan", text: `今天计划 ${price(todayTarget)}`, value: todayTarget, tone: "neutral" }]} />
          ) : (
            <div data-proof="g3-history-empty">
              {historyError
                ? <BlockState state="error" compact title="最近 24 小时价格读取失败" detail={historyError} onRetry={() => void reload(true)} retrying={refreshing} retryLabel="重新加载" />
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
              effect="暂停后现价停在当前值；恢复后等下一次排程再推进，恢复时后端检查兑付覆盖率"
              note="暂停挡不住应急改现价和固定生效日，这两项照常发布价格。暂停只要暂停权限；恢复还要超级管理员。"
              value={<span className="g3-value">{paused ? <StatusTag tone="warn" icon={PauseCircle}>已暂停</StatusTag> : <StatusTag tone="ok">自动变化中</StatusTag>}<ObjectTag state={OBJECT_STATES.paused} /></span>}
              action={allowed("finprod_g3_engine_pause_toggle") ? (describedBy) => (
                <Button size="sm" variant={paused ? "secondary" : "danger-outline"} aria-describedby={describedBy}
                  disabledReason={busyReason ?? (paused && !isSuper ? "恢复只有超级管理员能操作" : undefined)}
                  onClick={pauseEngine}>{paused ? "恢复" : "暂停"}</Button>
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
                  action={allowed("finprod_g3_write") ? (describedBy) => (
                    <Button size="sm" aria-describedby={describedBy} disabledReason={busyReason}
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
            when="降低确认后立即发布；提高要另一位有权超管批准后发布"
            effect="已完成的兑换不变；下次推进时被计划价替换（暂停或固定期间没有固定的到期时间）"
            note={TUNING_RULE}
            value={<span className="g3-value">{priceMissing ? <StatusTag tone="warn" icon={TriangleAlert}>暂不可用</StatusTag> : `${price(overview.currentPrice)} USDT`}
              <ObjectTag state={OBJECT_STATES.currentPrice} />
              {MANUAL_TUNING === "forbidden" && <StatusTag tone="neutral" icon={Lock}>当前环境不能改</StatusTag>}</span>}
            action={allowed("finprod_g3_override_price_write") ? (describedBy) => (
              <Button size="sm" aria-describedby={describedBy} disabledReason={busyReason ?? tuningBlocked}
                onClick={() => adj("currentPrice", "当前价格", rawValue(overview.currentPrice), "临时改价，下次自动切换时恢复计划值", true)}>调整</Button>
            ) : undefined} />
        </ConfigList>
      </Fold>

      <Fold title="目前不生效的参数" icon={CircleHelp} tone="role-other"
        summary="5 项 · 后端还没有使用，改了不影响价格和兑换"
        explain="这些值能保存，但后端发布价格和兑换时都不读它们。入口先保留，已提给后端接上或退役。">
        <div className="g3-subhead">七天波动幅度<Explain label="七天波动幅度" content="七天计划里每一天的波动幅度（2 表示 ±2%），推进到这一天时抄进当天配置。发布价格直接用目标价，不按它随机涨跌。" /></div>
        <Table label="七天波动幅度" className="g3-vol">
          <thead><tr>{overview.frames.map((_, index) => <Th key={index}>D{index + 1}</Th>)}</tr></thead>
          <tbody>
            <tr>
              {overview.frames.map((frame, dayIndex) => (
                <Td key={frame.dayIndex}>
                  {OBJECT_STATES[`weekly:D${dayIndex + 1}:volatilityPct`] && <span className="g3-cell-tag"><ObjectTag state={OBJECT_STATES[`weekly:D${dayIndex + 1}:volatilityPct`]} /></span>}
                  <span className="g3-cell">
                    <span className="g3-num">±{pctText(frame.volatilityPct)}</span>
                    {allowed(curveAuthority("volatilityPct")) && <IconButton data-size="sm" aria-label={`修改 D${dayIndex + 1} 波动幅度`} disabledReason={busyReason} onClick={() => openCurveCellMc(dayIndex, "volatilityPct")}><Pencil size={13} aria-hidden /></IconButton>}
                  </span>
                </Td>
              ))}
            </tr>
          </tbody>
        </Table>
        <ConfigList label="其他不生效的参数">
          <ConfigRow name="当前波动幅度" what="当天配置里的波动幅度" effect="下次推进时被计划值替换；发布价格不按它随机涨跌"
            value={<span className="g3-value">±{pctText(overview.overrides.volatilityPct)}<ObjectTag state={OBJECT_STATES.volatilityPct} /></span>}
            action={allowed("finprod_g3_write") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={busyReason} onClick={() => adj("volatilityPct", "波动幅度", rawValue(overview.overrides.volatilityPct), "可设 0–20%")}>调整</Button> : undefined} />
          <ConfigRow name="价格来源" what="内部定价或外部价格来源" effect="后端没有接外部价格，选哪个价格都按七天计划发布" note="只有超级管理员能切换。"
            value={<span className="g3-value">{oracle === "内部做市" ? "内部定价" : oracle === "外部喂价" ? "外部价格来源" : "价格来源未知"}<ObjectTag state={OBJECT_STATES.oracle} /></span>}
            action={isSuper ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={busyReason} onClick={switchOracle}>切换</Button> : undefined} />
          <ConfigRow name="偏离告警阈值" what="现价和外部价格相差多少算偏离" effect="后端没有拿现价和外部价格比较，也不会告警"
            value={<span className="g3-value">{overview.overrides.deviationPct == null ? "未配置" : pctText(overview.overrides.deviationPct)}<ObjectTag state={OBJECT_STATES.deviationPct} /></span>}
            action={allowed("finprod_g3_write") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={busyReason} onClick={() => adj("deviationPct", "偏离告警阈值", rawValue(overview.overrides.deviationPct), "可设 0–50%")}>调整</Button> : undefined} />
          <ConfigRow name="初始成本价" what="UVT 的初始成本价" effect="App 接口会带上它，但现在没有页面显示盈亏；不影响价格和兑换"
            value={<span className="g3-value">{overview.overrides.costBasis == null ? "未配置" : `${price(overview.overrides.costBasis)} USDT`}<ObjectTag state={OBJECT_STATES.costBasis} /></span>}
            action={allowed("finprod_g3_write") ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={busyReason} onClick={() => adj("costBasis", "初始成本价", rawValue(overview.overrides.costBasis), "只用于 App 显示盈亏，不影响价格和兑换")}>调整</Button> : undefined} />
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
