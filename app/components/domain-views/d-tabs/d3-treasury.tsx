"use client";

/**
 * 资金储备与应付款：看平台的钱够不够付，要不要补储备。四个页签，当前页签和时间窗写进网址（PG-33、ST-23）。
 * 读取按接口原授权分开判断，不合成一个权限（X05）：
 *   储备、应付款、到期预测、预测配置：B2 或 D3 读权限，一起读，任一失败全部清掉，不留旧水位（D3-S01）。
 *   差额曲线：B1 或 D3 读权限，单独读。资金流历史：只认 B2 读权限，单独读。两块失败都不影响别的内容。
 * 四个动作互不替代：应付款导出认 B2 或 D3 导出权限，对账导出只认 D3 导出权限，
 * 预测保存认 B2 或 D3 写权限，储备注入只认注入权限。
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { OperationConfirmModal, useToast, type OperatorBriefKind } from "../design-kit";
import { ForecastConfigImpact } from "@/app/components/forecast-config-preview";
import { BlockState, Button, Change, Conclusion, Decision, DiffList, Drawer, Explain, Fact, Facts, Field, Input, IrreversibleTag, Modal, Notice, PageHeader, PageTabs, RdPage, ReleaseModal, Select, StatusTag, useTabIds } from "@/app/components/rd";
import { B2RequestError, previewB2ForecastConfig, type ForecastConfigPreview } from "@/lib/admin/b2-client";
import { useB2LiquidityHistory } from "@/lib/admin/b-restoration-client";
import { businessClock } from "@/lib/admin/business-time";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import {
  createD3Injection,
  DRequestError,
  downloadD3Csv,
  fetchD3Main,
  fetchD3Maturity,
  fetchD3NetExposure,
  isDOutcomeUnknownError,
  updateD3ForecastConfig,
  type D3ForecastConfig,
  type D3Main,
  type D3MaturityForecast,
  type D3NetExposure,
} from "@/lib/admin/d-client";
import { TREASURY_EXPORT_BLOCKED } from "@/lib/admin/treasury-valuation";
import { displayAdminError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { exportScope, treasuryCommandKey, treasuryCommands, type TreasuryExportKind } from "@/lib/admin/treasury-commands";
import { LeaveDialog, useLeaveGuard, type EditorSwitch } from "../i-tabs/i5-writes";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { DueTab, FORECAST_90D_BLOCK, FlowTab, FundConclusion, OverviewTab, SettingsTab, amountText, categoryText, effectiveText, forecastDiffRows, money, timeText, type CrossLink, type ForecastValues, type Loadable } from "./d3-treasury-views";

const OPERATOR = currentAdminOperator;

type ExportKind = TreasuryExportKind;
const pendingKeys = treasuryCommands;
const injectionScope = (voucherNo: string, amount: string) => `injection|${voucherNo}|${amount}`;
const EXPORT_LABEL: Record<ExportKind, string> = { reconciliation: "对账 CSV", liabilities: "应付款明细 CSV" };
const EXPORT_TITLE: Record<ExportKind, string> = { reconciliation: "导出对账 CSV", liabilities: "导出应付款 CSV" };
const EXPORT_RANGE: Record<ExportKind, string> = { reconciliation: "储备、应付款、净差额三行", liabilities: "全部 9 类的当前数据，不随页面窗口变" };
const RETRY_EXPIRED = "已超过 24 小时，不能再重试，请到操作记录与审批核对";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请到操作记录与审批核对";

/** 预测保存只有一个槽位:草稿 / 期望版本 / 理由 / 操作人没变就复用命令号。和旧「可用资金与应付款」共用这张表,
 *  那边留下的未决记录在这里接着恢复(B2-H02)。 */
const forecastCommand = createSlotAttemptStore({ storageKey: "nexion-admin-b2-liquidity-commands-v1", retainExpiredRecords: true });
const FORECAST_SLOT = "forecast-config";

type TabValue = "overview" | "due" | "flow" | "settings";
type MaturityWindow = D3MaturityForecast["window"];

const TABS: readonly { value: TabValue; label: string }[] = [
  { value: "overview", label: "资金概况" },
  { value: "due", label: "应付款与到期" },
  { value: "flow", label: "资金流" },
  { value: "settings", label: "预测设置" },
];

const VOUCHER_TYPES = [{ value: "CHAIN", label: "链上交易哈希" }, { value: "BANK", label: "银行流水号" }];

interface ConfirmRequest {
  /** 进操作记录的名字，不改。框上写的短标题传 title。 */
  action: string;
  title?: string;
  detail: ReactNode;
  briefKind: OperatorBriefKind;
  /** 这个操作自己的影响说明，和这类操作的通用说明不一样时才传。 */
  statedBrief?: { impact: string; check: string };
  /** 金额、对象、前后值，常显。执行摘要默认收起，这些不能只写在 detail 里（OP-48）。 */
  facts?: ReactNode;
  reasonMax?: number;
  effect?: string;
  /** 提交后收不回来：标题下再加「不能撤销」（VS-106）。 */
  irreversible?: boolean;
  confirmLabel: string;
  /** 不能撤销的操作传 danger。 */
  confirmTone?: "primary" | "danger";
  /** 这次不能提交的原因，写在框里，确认按钮禁用。 */
  blocked?: ReactNode;
  /** 变了就重开确认框，理由清空（OP-97）。 */
  revision?: number;
  run: (reason: string) => Promise<void>;
}

/** 页面上方一条结果未知的操作。重试只发存下来的内容，这里没有能改的东西（OP-94）。 */
interface PendingItem {
  commandKey: string;
  title: string;
  body: ReactNode;
  /** 还能重试时写在 body 后面；过期后换成 RETRY_EXPIRED。 */
  hint: string;
  expiresAt: number;
  /** 这个账号现在还有没有这项写权限，重试和原入口一样判断（OP-124）。 */
  allowed: boolean;
  auditHref: string;
  retryTitle: string;
  /** 重试框标题下的生效方式，和原操作一样。 */
  retryEffect: string;
  /** lead 是这次的关键数字，放第一行，单位传 unit（VS-102）。 */
  rows: Array<{ key: string; label: string; value: ReactNode; lead?: boolean; unit?: string }>;
  stored: () => boolean;
  resend: () => Promise<void>;
  forget: () => void;
}

function queryValue<T extends string>(name: string, allowed: readonly T[]): T | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(name);
  return allowed.find((item) => item === value) ?? null;
}

/** 替换写入,不增加浏览器历史;别的参数(比如临时的 theme)原样留着。 */
function writeQuery(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function forecastValues(config: D3ForecastConfig): ForecastValues {
  const source = config.pendingConfig ?? config;
  return {
    reserveCategories: source.reserveCategories,
    liabilityCategories: source.liabilityCategories,
    forecastWindow: source.forecastWindow,
    genesisIncluded: source.genesisIncluded,
    includeFarLiabilities: source.includeFarLiabilities,
    stakingInterestMode: source.stakingInterestMode,
    trialStressEnabled: source.trialStressEnabled,
  };
}

/** 读取最新后合并：自己改过的字段留着，其余取最新（OP-97）。 */
function mergeForecast(base: ForecastValues, mine: ForecastValues, latest: ForecastValues): ForecastValues {
  const pick = <K extends keyof ForecastValues>(key: K) => (mine[key] !== base[key] ? mine[key] : latest[key]);
  const pickAll = (from: Record<string, boolean>, to: Record<string, boolean>, theirs: Record<string, boolean>) =>
    Object.fromEntries(Object.keys(theirs).map((key) => [key, to[key] !== from[key] ? to[key] : theirs[key]]));
  return {
    reserveCategories: pickAll(base.reserveCategories, mine.reserveCategories, latest.reserveCategories),
    liabilityCategories: pickAll(base.liabilityCategories, mine.liabilityCategories, latest.liabilityCategories),
    forecastWindow: pick("forecastWindow"),
    genesisIncluded: pick("genesisIncluded"),
    includeFarLiabilities: pick("includeFarLiabilities"),
    stakingInterestMode: pick("stakingInterestMode"),
    trialStressEnabled: pick("trialStressEnabled"),
  };
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? displayAdminError(error) : fallback);

export function D3Treasury() {
  const [toastNode, toast] = useToast();
  const reach = useReach();
  const session = useAdminAuth((state) => state.session);
  const authorities = useMemo(() => session?.authorities ?? [], [session?.authorities]);
  const has = (code: string) => authorities.includes(code);
  const canReadMain = has("finance_d3_read") || has("overview_b2_read");
  const canReadExposure = has("finance_d3_read") || has("overview_b1_read");
  const canReadFlow = has("overview_b2_read");
  const canConfig = has("finance_d3_write") || has("overview_b2_write");
  const canInject = has("finance_d3_injection_create");
  const canExportLiabilities = has("overview_b2_export") || has("finance_d3_export");
  const canExportReconciliation = has("finance_d3_export");

  const visibleTabs = TABS.filter((item) => (item.value === "flow" ? canReadFlow : item.value === "due" ? canReadMain || canReadExposure : canReadMain));
  const tabIds = useTabIds();
  const [requestedTab, setRequestedTab] = useState<TabValue | null>(() => queryValue("tab", TABS.map((item) => item.value)));
  const tab = visibleTabs.find((item) => item.value === requestedTab)?.value ?? visibleTabs[0]?.value ?? null;

  const [main, setMain] = useState<D3Main | null>(null);
  const valuationExportBlocked = main?.liabilities.totalUsdt === null ? TREASURY_EXPORT_BLOCKED : undefined;
  const [draft, setDraft] = useState<ForecastValues | null>(null);
  const [loading, setLoading] = useState(canReadMain);
  const [mainError, setMainError] = useState("");
  const loadGeneration = useRef(0);

  const [maturityChoice, setMaturityChoice] = useState<MaturityWindow | null>(() => queryValue("maturity", ["7d", "30d"] as const));
  const maturityWindow: MaturityWindow = maturityChoice ?? (main?.config.forecastWindow === "30d" ? "30d" : "7d");

  const [maturity30, setMaturity30] = useState<Loadable<D3MaturityForecast>>({ data: null, loading: false, error: "" });
  const [exposure, setExposure] = useState<Loadable<D3NetExposure>>({ data: null, loading: false, error: "" });
  const maturityGeneration = useRef(0);
  const exposureGeneration = useRef(0);
  const maturityLoadedFor = useRef<D3Main | null>(null);
  const exposureLoadedFor = useRef<D3Main | null | undefined>(undefined);

  const [flowVisited, setFlowVisited] = useState(tab === "flow");
  const history = useB2LiquidityHistory(canReadFlow && flowVisited);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [injectOpen, setInjectOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [voucherType, setVoucherType] = useState("CHAIN");
  const [voucherNo, setVoucherNo] = useState("");
  /** 刚打开不报错：失焦或点过下一步才显示这个字段的错（DP-06）。 */
  const [injectShown, setInjectShown] = useState<{ amount?: boolean; voucher?: boolean }>({});
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  /** 保存前的影响预览。只对这份草稿和这个版本有效，草稿或版本变了就作废（D3-MD1）。 */
  const [preview, setPreview] = useState<{ key: string; value: ForecastConfigPreview } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [configNote, setConfigNote] = useState<{ tone: "warn" | "danger"; text: string } | null>(null);
  const previewGeneration = useRef(0);
  const [retry, setRetry] = useState<PendingItem | null>(null);
  const [retrying, setRetrying] = useState(false);
  /** 待确认条上最近一次重试的结果，只是当下的事实，不影响待确认本身。 */
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  /** 最近一次重试被后端明确拒绝的命令号，只有它们才能人工解除。按命令号记，解除后重新提交的新命令不沿用。 */
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<PendingItem | null>(null);
  const [refreshAsk, setRefreshAsk] = useState(false);
  const [unknownTick, setUnknownTick] = useState(0);

  const load = useCallback(async ({ keepDraft = false }: { keepDraft?: boolean } = {}) => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setMainError("");
    try {
      const next = await fetchD3Main();
      if (generation !== loadGeneration.current) return;
      setMain(next);
      if (!keepDraft) setDraft(forecastValues(next.config));
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setMain(null);
      setDraft(null);
      setMainError(errorText(err, "加载失败，请重试"));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);

  const loadMaturity30 = useCallback(async () => {
    const generation = ++maturityGeneration.current;
    setMaturity30({ data: null, loading: true, error: "" });
    try {
      const data = await fetchD3Maturity("30d");
      if (generation === maturityGeneration.current) setMaturity30({ data, loading: false, error: "" });
    } catch (err) {
      if (generation === maturityGeneration.current) setMaturity30({ data: null, loading: false, error: errorText(err, "读取失败，请重试") });
    }
  }, []);

  // 只取当前差额。序列不是真实历史，不画图（DP-63），窗口用最短的。
  const loadExposure = useCallback(async () => {
    const generation = ++exposureGeneration.current;
    setExposure((current) => ({ ...current, loading: true, error: "" }));
    try {
      const data = await fetchD3NetExposure("7d");
      if (generation === exposureGeneration.current) setExposure({ data, loading: false, error: "" });
    } catch (err) {
      if (generation === exposureGeneration.current) setExposure({ data: null, loading: false, error: errorText(err, "读取失败，请重试") });
    }
  }, []);

  useEffect(() => {
    if (canReadMain) void load();
  }, [canReadMain, load]);

  useEffect(() => {
    if (tab !== "due" || !main || maturityWindow !== "30d" || maturityLoadedFor.current === main) return;
    maturityLoadedFor.current = main;
    void loadMaturity30();
  }, [tab, main, maturityWindow, loadMaturity30]);

  useEffect(() => {
    if (tab !== "due" || !canReadExposure || exposureLoadedFor.current === main) return;
    exposureLoadedFor.current = main;
    void loadExposure();
  }, [tab, main, canReadExposure, loadExposure]);

  const selectTab = (next: TabValue) => {
    setRequestedTab(next);
    writeQuery("tab", next === visibleTabs[0]?.value ? null : next);
    if (next === "flow") setFlowVisited(true);
    setSelectedCategory(null);
  };

  const selectMaturity = (next: MaturityWindow) => {
    setMaturityChoice(next);
    writeQuery("maturity", next);
  };

  const baseValues = useMemo(() => (main ? forecastValues(main.config) : null), [main]);
  const dirty = Boolean(draft && baseValues && JSON.stringify(draft) !== JSON.stringify(baseValues));
  const previewKey = JSON.stringify([draft, main?.config.version]);
  const currentPreview = preview?.key === previewKey ? preview.value : null;

  useEffect(() => {
    setPreview(null);
    ++previewGeneration.current;
    return () => { ++previewGeneration.current; };
  }, [previewKey, canConfig]);

  // 配置改了没保存时，离开这页先问（OP-29）。结果未知时设置已锁，草稿等核对完再说，不拦。
  const leaveSwitcher = useRef<EditorSwitch | null>(null);
  const leave = useLeaveGuard(dirty && !forecastCommand.list().some((record) => record.fingerprint === FORECAST_SLOT), () => { if (baseValues) setDraft(baseValues); }, leaveSwitcher);

  // 预测保存结果未知时草稿留着，解除待确认后可以接着改了重新提交。
  const reloadAll = () => {
    if (canReadMain) void load({ keepDraft: Boolean(unknownCommands.forecast) });
    else if (tab === "due") void loadExposure();
    if (flowVisited && canReadFlow) void history.reload();
  };

  const refresh = () => {
    if (dirty && !unknownCommands.forecast) setRefreshAsk(true);
    else reloadAll();
  };

  /**
   * 写操作共用一条路，做法同提现审核：先把原操作存好再发，存不了就不发（OP-92）。
   * 🔴 第一次被确定性拒绝必须丢号，留在确认框改了再提交：留着旧号改完重提会撞载荷不符，这笔 24h 内做不了。
   *    结果未知必须保号，关框，转成页面上方的待确认（OP-93），丢了重试就是第二笔注资。
   *    重试的是保留下来的原命令时，明确拒绝也证明不了原操作的结果，继续保留（CP-33）。只有成功才解除。
   */
  const sendCommand = async ({ retained, stored, forget, send, onUnknown, done }: {
    retained: boolean;
    stored: () => boolean;
    forget: () => void;
    send: () => Promise<unknown>;
    onUnknown?: () => void;
    done: () => Promise<void>;
  }) => {
    if (!stored()) {
      if (!retained) forget();
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await send();
    } catch (err) {
      const unknown = isDOutcomeUnknownError(err);
      if (!unknown && !retained) forget();
      setUnknownTick((tick) => tick + 1);
      if (!unknown) throw err;
      onUnknown?.();
      toast("结果未确认，不要重复操作。到页面上方核对或按原操作重试。");
      return;
    }
    forget();
    setUnknownTick((tick) => tick + 1);
    await done();
  };

  const submitInjection = async (nextAmount: string, nextVoucher: string, reason: string, operator = OPERATOR()) => {
    const scope = injectionScope(nextVoucher, nextAmount);
    const retained = Boolean(pendingKeys.get(scope));
    const key = treasuryCommandKey(scope, { amount: nextAmount, voucherNo: nextVoucher, reason, operator });
    const clearForm = () => {
      setAmount("");
      setVoucherNo("");
      setInjectShown({});
      setInjectOpen(false);
    };
    await sendCommand({
      retained,
      stored: () => pendingKeys.isDurablyStored(scope, key),
      forget: () => pendingKeys.forget(scope),
      send: () => createD3Injection(nextAmount, nextVoucher, reason, operator, key),
      onUnknown: clearForm,
      done: async () => {
        clearForm();
        toast("储备注入已登记");
        await load({ keepDraft: true });
      },
    });
  };

  const saveInjection = () => {
    const nextAmount = amount.trim();
    const nextVoucher = voucherNo.trim();
    // 凭证号原样提交，后端按原值判重。类型只有说明作用，写进理由，理由随注入记录和操作记录保存。
    const typeLabel = VOUCHER_TYPES.find((item) => item.value === voucherType)?.label;
    const reasonPrefix = `凭证类型：${typeLabel}。`;
    setConfirm({
      action: "储备注入登记",
      detail: `登记 ${money(Number(nextAmount))}，${typeLabel}，凭证号 ${nextVoucher}。凭证号不可重复。凭证类型会写在理由前面，留在操作记录里。`,
      facts: <Facts><Fact k="注入金额" lead tone="role-1" unit="USDT">{amountText(Number(nextAmount))}</Fact><Fact k="凭证类型">{typeLabel}</Fact><Fact k="凭证号"><span data-mono>{nextVoucher}</span></Fact></Facts>,
      briefKind: "funds",
      statedBrief: { impact: "登记后计入可用储备。", check: "核对金额和凭证号，理由写清到账依据或工单号。" },
      effect: "立即生效",
      irreversible: true,
      confirmLabel: "确认登记",
      confirmTone: "danger",
      reasonMax: 200 - reasonPrefix.length,
      run: async (reason) => {
        try {
          await submitInjection(nextAmount, nextVoucher, `${reasonPrefix}${reason}`);
        } catch (err) {
          // 确认框由共用层提示并关掉，下面的抽屉这里关，草稿留着。
          if (isPermissionDenied(err)) setInjectOpen(false);
          throw err;
        }
      },
    });
  };

  const submitForecast = (values: ForecastValues, version: number, reason: string, operator: string, commandKey: string, inputFingerprint: string, retained: boolean) => sendCommand({
    retained,
    stored: () => forecastCommand.isDurablyStored(FORECAST_SLOT, inputFingerprint, commandKey),
    forget: () => forecastCommand.forget(FORECAST_SLOT),
    send: () => updateD3ForecastConfig(values, version, reason, operator, commandKey),
    done: async () => {
      toast(`已保存，${effectiveText()}`);
      await load();
      leave.saved();
    },
  });

  /** 别人先保存了：框内读最新，显示别人改了什么，留下自己改的字段，理由清空，在最新版本上重新核对（OP-97）。 */
  const forecastConflict = (read: () => void, busy = false, failed = "") => (
    <span className="rd-toolbar">
      <span>这项刚被别人改过。{failed}</span>
      <Button size="sm" loading={busy} onClick={read}>读取最新</Button>
    </span>
  );

  const readLatestForecast = async (sent: D3Main, values: ForecastValues, revision: number) => {
    const read = () => void readLatestForecast(sent, values, revision);
    setConfirm((current) => current && { ...current, blocked: forecastConflict(read, true) });
    let latest: D3Main;
    try {
      latest = await fetchD3Main();
    } catch (err) {
      setConfirm((current) => current && { ...current, blocked: forecastConflict(read, false, errorText(err, "读取失败，请重试。")) });
      return;
    }
    const before = forecastValues(sent.config);
    const after = forecastValues(latest.config);
    const merged = mergeForecast(before, values, after);
    setMain(latest);
    setDraft(merged);
    if (JSON.stringify(merged) === JSON.stringify(after)) {
      setConfirm(null);
      toast("你改的内容和最新设置一样，不用再保存。");
      return;
    }
    // 版本变了，原来的影响作废，要看到最新版本的影响才能确认。
    let impact: ForecastConfigPreview;
    try {
      impact = await previewB2ForecastConfig(merged, latest.config.version);
    } catch (err) {
      setConfirm((current) => current && { ...current, blocked: forecastConflict(read, false, errorText(err, "影响预览读取失败，请重试。")) });
      return;
    }
    if (impact.forecastDeltaPreview.afterCoverageStatus === "VALUATION_UNAVAILABLE") {
      setConfirm(null);
      setPreview({ key: JSON.stringify([merged, latest.config.version]), value: impact });
      return;
    }
    setConfirm(forecastRequest(latest, merged, impact, forecastDiffRows(before, after).filter((row) => row.before !== row.after), revision + 1));
  };

  const forecastRequest = (latest: D3Main, values: ForecastValues, impact: ForecastConfigPreview, others: ReturnType<typeof forecastDiffRows> = [], revision = 0): ConfirmRequest => {
    const base = forecastValues(latest.config);
    const version = latest.config.version;
    const dropped = latest.liabilities.breakdown.filter((row) => base.liabilityCategories[row.category] && !values.liabilityCategories[row.category]);
    // 某一项改了有风险，写在这一行下面，不另铺横幅（VS-103）。
    const notes: Record<string, { tone: "warn" | "danger"; note: string }> = Object.fromEntries(dropped.map((row) => [`liability-${row.category}`, { tone: "warn", note: `这类现在是 ${money(row.amountUsdt)}。` }]));
    if (base.reserveCategories.usdt && !values.reserveCategories.usdt) notes["reserve-usdt"] = { tone: "danger", note: "资金安全等级会按储备 0 算。" };
    return {
      action: "调整应付款预测设置",
      title: "保存预测设置",
      revision,
      detail: `预测 ${values.forecastWindow.replace("d", " 天")}，创世节点收益${values.genesisIncluded ? "计入" : "不计入"}。${effectiveText()}，不影响历史。`,
      facts: (
        <div className="rd-stack">
          {/* 这次没动、但 USDT 储备本来就不计入时，照旧提醒一句。 */}
          {!base.reserveCategories.usdt && !values.reserveCategories.usdt && <Notice tone="danger">不计入 USDT 储备后，资金安全等级会按储备 0 算。</Notice>}
          {others.length > 0 && <Notice tone="warn" title="别人改了这些，已按最新读取">{others.map((row) => <div key={row.key}>{row.label}：{row.before} → {row.after}</div>)}</Notice>}
          <DiffList rows={forecastDiffRows(base, values).map((row) => ({ ...row, ...notes[row.key] }))} />
          <ForecastConfigImpact preview={impact} categoryLabel={categoryText} />
        </div>
      ),
      briefKind: "config",
      statedBrief: { impact: "影响这页的到期、差额、资金安全等级和今日概览的可覆盖天数，用户看不到。不改全部应付款算的兑付覆盖率。", check: "核对改动项和生效时间，理由写清依据或工单号。" },
      effect: effectiveText(),
      confirmLabel: "确认保存，次日生效",
      run: async (reason) => {
        const operator = OPERATOR();
        const fingerprint = JSON.stringify({ draft: values, expectedVersion: version, reason, operator });
        const commandKey = forecastCommand.resolve(FORECAST_SLOT, fingerprint, () => `b2-forecast-config-${crypto.randomUUID()}`);
        try {
          await submitForecast(values, version, reason, operator, commandKey, fingerprint, false);
        } catch (err) {
          if (err instanceof DRequestError && err.reasonCode === "D3_FORECAST_CONFIG_VERSION_CONFLICT") {
            setConfirm((current) => current && { ...current, blocked: forecastConflict(() => void readLatestForecast(latest, values, revision)) });
          }
          throw err;
        }
      },
    };
  };

  /** 保存前先看系统算的影响：失败和改后无法估值都不开确认框，写在按钮旁，再点重试（D3-MD1）。 */
  const saveConfig = async () => {
    if (!main || !draft || !canConfig || loading || previewLoading || draft.forecastWindow === "90d") return;
    const generation = ++previewGeneration.current;
    const sent = main;
    const values = draft;
    setPreviewLoading(true);
    setPreview(null);
    setConfigNote(null);
    let impact: ForecastConfigPreview;
    try {
      impact = await previewB2ForecastConfig(values, sent.config.version);
    } catch (caught) {
      if (generation !== previewGeneration.current) return;
      if (isPermissionDenied(caught)) { announcePermissionDenied(); return; }
      const conflict = caught instanceof B2RequestError && caught.status === 409;
      setConfigNote({ tone: conflict ? "warn" : "danger", text: errorText(caught, "影响预览读取失败，请重试。") });
      if (conflict) {
        // 别人先保存了：读最新，自己改的字段留着，再点保存时看新版本的影响（OP-97）。
        const latest = await fetchD3Main();
        setMain(latest);
        setDraft(mergeForecast(forecastValues(sent.config), values, forecastValues(latest.config)));
      }
      return;
    } finally {
      setPreviewLoading(false);
    }
    if (generation !== previewGeneration.current) return;
    if (impact.forecastDeltaPreview.afterCoverageStatus === "VALUATION_UNAVAILABLE") {
      setPreview({ key: previewKey, value: impact });
      return;
    }
    setConfirm(forecastRequest(sent, values, impact));
  };

  const submitExport = async (kind: ExportKind, reason: string, operator = OPERATOR()) => {
    if (!main || loading) throw new Error("资金数据没读到或正在刷新，读完再导出。");
    if (valuationExportBlocked) throw new Error(valuationExportBlocked);
    const scope = exportScope(kind);
    const retained = Boolean(pendingKeys.get(scope));
    const key = treasuryCommandKey(scope, { exportKind: kind, reason, operator });
    await sendCommand({
      retained,
      stored: () => pendingKeys.isDurablyStored(scope, key),
      forget: () => pendingKeys.forget(scope),
      send: () => downloadD3Csv(kind, reason, operator, key),
      done: async () => toast(`${EXPORT_LABEL[kind]} 已导出`),
    });
  };

  const exportCsv = (kind: ExportKind) => {
    setConfirm({
      action: "导出",
      title: EXPORT_TITLE[kind],
      detail: "不生成任务，没有下载链接。",
      facts: <Facts><Fact k="范围">{EXPORT_RANGE[kind]}</Fact><Fact k="去向">浏览器直接下载</Fact></Facts>,
      briefKind: "export",
      statedBrief: { impact: "浏览器直接下载，这次导出记入操作记录。", check: "核对导出内容，理由写明导出依据或工单号。" },
      effect: "立即生效",
      confirmLabel: "确认导出",
      run: (reason) => submitExport(kind, reason),
    });
  };

  // 结果未知的提交写在页面最上面,刷新后还在(OP-93)。unknownTick 在每次提交收尾时变,让这里重读。
  const unknownCommands = useMemo(() => {
    void unknownTick;
    const records = pendingKeys.list();
    return {
      injections: records.flatMap((record) => (record.fingerprint.startsWith("injection|") && record.amount && record.voucherNo && record.reason
        ? [{ ...record, amount: record.amount, voucherNo: record.voucherNo, reason: record.reason }] : [])),
      exports: records.flatMap((record) => (record.exportKind && record.reason ? [{ ...record, exportKind: record.exportKind, reason: record.reason }] : [])),
      forecast: forecastCommand.list().find((record) => record.fingerprint === FORECAST_SLOT) ?? null,
    };
  }, [unknownTick]);

  const injectAmount = amount.trim();
  const injectVoucher = voucherNo.trim();
  const amountIssue = !injectAmount || !Number.isFinite(Number(injectAmount)) || Number(injectAmount) <= 0 ? "请输入有效的注入金额"
    : !/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(injectAmount) ? "最多两位小数，不会自动四舍五入" : undefined;
  const voucherIssue = !injectVoucher ? "请输入到账凭证号"
    : !/^[A-Za-z0-9][A-Za-z0-9:_./-]{5,95}$/.test(injectVoucher) ? "6–96 位，字母或数字开头，只能用字母、数字和 : _ . / -"
      : unknownCommands.injections.some((record) => record.voucherNo === injectVoucher) ? "这个凭证号的登记结果未知，先在页面上方核对" : undefined;

  /** 按原操作重试：同命令号、同内容、同理由、同操作人，不接受新输入（OP-94）。只有成功才解除待确认。 */
  const runRetry = async () => {
    if (!retry) return;
    // 过期和查不到记录都不发送，也不解除：解除只在后端明确拒绝之后（OP-96、OP-153）。
    const stale = retry.expiresAt <= Date.now() ? RETRY_EXPIRED : !retry.allowed ? RETRY_NO_PERMISSION : !retry.stored() ? "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。" : "";
    if (stale) {
      setPendingNotes((current) => ({ ...current, [retry.commandKey]: `${businessClock(Date.now())} ${stale}` }));
      setRetry(null);
      return;
    }
    setRetrying(true);
    setRetryRejected((current) => current.filter((key) => key !== retry.commandKey));
    try {
      await retry.resend();
    } catch (err) {
      if (isPermissionDenied(err)) announcePermissionDenied();
      setPendingNotes((current) => ({ ...current, [retry.commandKey]: `${businessClock(Date.now())} 重试没有成功：${errorText(err, "原因未知")} 这说明不了原操作的结果，原命令继续保留。` }));
      setRetryRejected((current) => [...current, retry.commandKey]);
    } finally {
      setRetrying(false);
      setRetry(null);
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。不发请求。 */
  const releasePending = (item: PendingItem) => {
    item.forget();
    setUnknownTick((tick) => tick + 1);
    setReleasing(null);
    toast("已解除待确认，可以重新提交");
  };

  const crossLink = (href: string, label: string): CrossLink => ({
    href,
    label,
    reachable: reach(href),
  });

  const dataBlocked = !main ? "资金数据没读到，刷新后再试" : loading ? "正在刷新，稍等" : undefined;
  const exportBlocked = (kind: ExportKind) => (unknownCommands.exports.some((record) => record.exportKind === kind) ? "上次导出结果未知，先在页面上方核对" : valuationExportBlocked ?? dataBlocked);
  const mainFailed = canReadMain && !main && !loading;
  const mainState = loading && !main
    ? <BlockState state="loading" title="正在读取资金数据…" />
    : mainFailed
      ? <BlockState state="error" title="资金数据没读到，这里先不显示" detail="页面上方可以重新加载。" />
      : null;
  const tier = main?.reserve.waterLevel.tier;
  const fundAlarm = tier === "DANGER" || tier === "WARNING";
  const fundConclusion = main ? <FundConclusion main={main} emergencyLink={crossLink("/emergency/kill-switch", "去紧急停用开关")} withdrawalsLink={crossLink("/finance/withdrawals", "去提现审核")} /> : null;

  const asOf = main?.reserve.asOf;
  const header = (
    <PageHeader
      pageId="D3"
      title="资金储备与应付款"
      summary="看平台的钱够不够付，要不要补储备。"
      meta={tab ? <>{asOf ? `统计时间：${timeText(asOf)} · ` : ""}打开时读取 <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={refresh}>刷新</Button></> : undefined}
      readOnly={canInject || canConfig || canExportLiabilities || !tab ? undefined : "你只能查看；登记储备注入需财务主管。"}
      actions={(
        <>
          {canExportReconciliation && <Button icon={<Download size={14} aria-hidden />} disabledReason={exportBlocked("reconciliation")} onClick={() => exportCsv("reconciliation")}>导出对账 CSV</Button>}
          {canInject && <Button variant={tier && tier !== "NORMAL" ? "primary" : "secondary"} disabledReason={dataBlocked} onClick={() => setInjectOpen(true)}>登记储备注入</Button>}
        </>
      )}
    />
  );

  if (!tab) {
    return (
      <RdPage>
        {header}
        <BlockState state="denied" title="无权限访问" detail="这个账号没有这页内容的读取权限，需要时联系超级管理员。" />
      </RdPage>
    );
  }

  const forecastRecord = unknownCommands.forecast;
  const savedForecast = forecastRecord && JSON.parse(forecastRecord.inputFingerprint) as { draft: ForecastValues; expectedVersion: number; reason: string; operator: string };
  const savedChanges = savedForecast && baseValues
    ? forecastDiffRows(baseValues, savedForecast.draft).filter((row) => row.before !== row.after).map((row) => ({ key: row.key, label: row.label, value: <Change from={row.before} to={row.after} /> }))
    : [];
  const pendingItems: PendingItem[] = [
    ...unknownCommands.injections.map((record): PendingItem => ({
      commandKey: record.commandKey,
      title: "储备注入登记结果未知，可能已经入账",
      body: <>{money(Number(record.amount))}，凭证号 {record.voucherNo}，{timeText(new Date(record.createdAt).toISOString())} 提交。</>,
      hint: "先看累计注入有没有变；重试不会重复登记。",
      expiresAt: record.expiresAt,
      allowed: canInject,
      auditHref: `/platform/audit?domain=D&object=${encodeURIComponent(record.voucherNo)}`,
      retryTitle: "按原操作重试储备注入",
      retryEffect: "立即生效",
      rows: [
        { key: "amount", label: "金额", value: amountText(Number(record.amount)), lead: true, unit: "USDT" },
        { key: "voucher", label: "凭证号", value: record.voucherNo },
        { key: "reason", label: "理由", value: record.reason },
      ],
      stored: () => pendingKeys.isDurablyStored(record.fingerprint, record.commandKey),
      resend: () => submitInjection(record.amount, record.voucherNo, record.reason, record.operator),
      forget: () => pendingKeys.forget(record.fingerprint, record.commandKey),
    })),
    ...(forecastRecord && savedForecast ? [{
      commandKey: forecastRecord.commandKey,
      title: "预测设置保存结果未知，可能已经保存",
      body: <>{timeText(new Date(forecastRecord.createdAt).toISOString())} 提交。</>,
      hint: "先看「预测设置」的版本有没有变；重试不会重复保存。",
      expiresAt: forecastRecord.expiresAt,
      allowed: canConfig,
      auditHref: "/platform/audit?domain=D",
      retryTitle: "按原操作重试保存预测设置",
      retryEffect: effectiveText(),
      rows: [
        { key: "version", label: "基于版本", value: `v${savedForecast.expectedVersion}` },
        ...(savedChanges.length ? savedChanges : [{ key: "changes", label: "这次改动", value: baseValues ? "和现在的设置一样，可能已经保存" : "现在的设置没读到，比不出改动" }]),
        { key: "reason", label: "理由", value: savedForecast.reason },
      ],
      stored: () => forecastCommand.isDurablyStored(FORECAST_SLOT, forecastRecord.inputFingerprint, forecastRecord.commandKey),
      resend: () => submitForecast(savedForecast.draft, savedForecast.expectedVersion, savedForecast.reason, savedForecast.operator, forecastRecord.commandKey, forecastRecord.inputFingerprint, true),
      forget: () => forecastCommand.forget(FORECAST_SLOT),
    }] : []),
    ...unknownCommands.exports.map((record): PendingItem => ({
      commandKey: record.commandKey,
      title: `${EXPORT_LABEL[record.exportKind]} 导出结果未知`,
      body: <>{timeText(new Date(record.createdAt).toISOString())} 提交。</>,
      hint: "文件可能没有下载下来，操作记录里可能已经有这次导出；重试不会多记一次。",
      expiresAt: record.expiresAt,
      allowed: record.exportKind === "liabilities" ? canExportLiabilities : canExportReconciliation,
      auditHref: "/platform/audit?domain=D",
      retryTitle: "按原操作重试导出",
      retryEffect: "立即生效",
      rows: [
        { key: "kind", label: "内容", value: EXPORT_LABEL[record.exportKind] },
        { key: "reason", label: "理由", value: record.reason },
      ],
      stored: () => pendingKeys.isDurablyStored(record.fingerprint, record.commandKey),
      resend: () => submitExport(record.exportKind, record.reason, record.operator),
      forget: () => pendingKeys.forget(record.fingerprint, record.commandKey),
    })),
  ];
  return (
    <RdPage>
      {header}
      {valuationExportBlocked && <Notice tone="warn">{valuationExportBlocked}</Notice>}
      {fundAlarm && fundConclusion}
      {mainFailed && (
        <Notice tone="warn" title="资金状态：暂时无法判断" action={<Button size="sm" onClick={reloadAll}>重新加载</Button>}>
          加载失败，已暂停显示旧数据。{mainError || "数据不完整。"}
        </Notice>
      )}
      {pendingItems.map((item) => (
        <Notice
          key={item.commandKey}
          tone="warn"
          title={item.title}
          action={(
            <>
              <Button size="sm" onClick={refresh}>刷新核对</Button>
              <Button size="sm" disabledReason={item.expiresAt <= Date.now() ? RETRY_EXPIRED : item.allowed ? (unknownCommands.exports.some((record) => record.commandKey === item.commandKey) ? valuationExportBlocked ?? dataBlocked : undefined) : RETRY_NO_PERMISSION} onClick={() => setRetry(item)}>按原操作重试</Button>
              {retryRejected.includes(item.commandKey) && <Button size="sm" onClick={() => setReleasing(item)}>解除待确认</Button>}
            </>
          )}
        >
          {item.body}{item.expiresAt <= Date.now() ? `${RETRY_EXPIRED}。` : item.hint}
          {reach(item.auditHref, "platform_a2_read") && <> <Link className="rd-link" href={item.auditHref}>到操作记录核查</Link></>}
          <Explain label="技术信息" content={`命令号 ${item.commandKey}`} />
          {pendingNotes[item.commandKey] && <div>{pendingNotes[item.commandKey]}</div>}
        </Notice>
      ))}
      <PageTabs
        ids={tabIds}
        label="资金储备内容"
        value={tab}
        onChange={selectTab}
        items={visibleTabs.map((item) => ({ ...item, count: item.value === "settings" && main?.config.pendingConfig ? 1 : undefined }))}
      />
      <div {...tabIds.panel(tab)} className="rd-tab-pane">
      {tab === "overview" && (main
        ? (
          <>
            {!fundAlarm && fundConclusion}
            <OverviewTab main={main} links={[crossLink("/overview/dual-ledger", "资金与应付款总览（看覆盖率和告警）"), crossLink("/overview/risk-radar", "风险提醒")]} />
          </>
        )
        : (
          <>
            {loading && <Conclusion state="unknown">资金状态：正在读取</Conclusion>}
            {mainState}
          </>
        ))}
      {tab === "due" && (
        <DueTab
          main={main}
          mainState={mainState}
          windowValue={maturityWindow}
          onWindow={selectMaturity}
          maturity={maturityWindow === "7d" ? { data: main?.maturity7 ?? null, loading, error: mainError } : maturity30}
          exposure={exposure}
          onExposureRetry={() => void loadExposure()}
          onMaturityRetry={() => void loadMaturity30()}
          canReadExposure={canReadExposure}
          canExport={canExportLiabilities}
          exportBlocked={exportBlocked("liabilities")}
          onExport={() => exportCsv("liabilities")}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}
      {tab === "flow" && <FlowTab history={history} />}
      {tab === "settings" && (
        <SettingsTab
          main={main}
          draft={draft}
          mainState={mainState}
          canConfig={canConfig}
          dirty={dirty}
          lockedNote={forecastRecord ? "上次保存结果未知，先在页面上方核对。核对完之前这里只能查看。" : undefined}
          busyReason={loading ? "正在刷新，稍等" : draft?.forecastWindow === "90d" ? FORECAST_90D_BLOCK : dirty ? undefined : "还没有修改"}
          saving={previewLoading}
          note={configNote}
          impact={currentPreview && <ForecastConfigImpact surface preview={currentPreview} categoryLabel={categoryText} />}
          onChange={setDraft}
          onDiscard={() => { if (baseValues) setDraft(baseValues); }}
          onSave={() => void saveConfig()}
        />
      )}
      </div>

      <Drawer
        open={injectOpen}
        onClose={() => setInjectOpen(false)}
        title="储备注入登记"
        explain="须填写到账凭证号"
        icon={Landmark}
        tone="role-1"
        footer={<Decision explain="凭证号重复时不会登记。下一步核对金额和凭证，再写理由。" others={<Button variant="ghost" onClick={() => setInjectOpen(false)}>取消</Button>} primary={<Button variant="primary" disabledReason={dataBlocked ?? ([amountIssue, voucherIssue].filter(Boolean).join("；") || undefined)} onBlockedClick={() => setInjectShown({ amount: true, voucher: true })} onClick={saveInjection}>下一步：确认</Button>} />}
      >
        <Field label="注入金额" required explain="单位 USDT，最多两位小数。" error={injectShown.amount ? amountIssue : undefined}>
          {(control) => <Input {...control} value={amount} onChange={(event) => setAmount(event.target.value)} onBlur={() => setInjectShown((current) => ({ ...current, amount: true }))} inputMode="decimal" placeholder="注入金额 USDT" aria-label="注入金额（USDT，最多两位小数）" />}
        </Field>
        <Field label="凭证类型" required explain="到账凭证是链上交易还是银行流水。会写进理由，不进凭证号。">
          <Select aria-label="凭证类型" value={voucherType} options={VOUCHER_TYPES} onChange={setVoucherType} />
        </Field>
        <Field label="凭证编号 / 哈希" required explain="填原始编号，至少 6 位，须能查到。" error={injectShown.voucher ? voucherIssue : undefined}>
          {(control) => (
            <div className="rd-reason-box">
              <Input {...control} className="rd-input-counted" maxLength={96} value={voucherNo} onChange={(event) => setVoucherNo(event.target.value)} onBlur={() => setInjectShown((current) => ({ ...current, voucher: true }))} placeholder="凭证号（不能重复）" aria-label="凭证号（必填，不能重复）" />
              <span className="rd-reason-count">{injectVoucher.length}/96</span>
            </div>
          )}
        </Field>
      </Drawer>

      {confirm && (
        <OperationConfirmModal
          key={`${confirm.action}:${confirm.revision ?? 0}`}
          action={confirm.action}
          title={confirm.title}
          detail={confirm.detail}
          briefKind={confirm.briefKind}
          statedBrief={confirm.statedBrief}
          facts={confirm.facts}
          effect={confirm.effect ? <><StatusTag tone="progress" filled>{confirm.effect}</StatusTag>{confirm.irreversible && <IrreversibleTag />}</> : undefined}
          confirmLabel={confirm.confirmLabel}
          confirmTone={confirm.confirmTone}
          blockedReason={confirm.blocked}
          reasonMin={8}
          reasonMax={confirm.reasonMax ?? 200}
          onClose={() => setConfirm(null)}
          onConfirm={async (reason) => {
            await confirm.run(reason);
            setConfirm(null);
          }}
        />
      )}

      {retry && (
        <Modal
          title={retry.retryTitle}
          icon={ShieldCheck}
          sub={<StatusTag tone="progress" filled>{retry.retryEffect}</StatusTag>}
          busy={retrying}
          onClose={() => setRetry(null)}
          footer={<><Button disabled={retrying} onClick={() => setRetry(null)}>取消</Button><Button variant="primary" loading={retrying} loadingText="提交中…" onClick={() => void runRetry()}>按原操作重试</Button></>}
        >
          <div className="rd-stack">
            <Facts>{retry.rows.map((row) => <Fact key={row.key} k={row.label} lead={row.lead} tone={row.lead ? "role-1" : undefined} unit={row.unit}>{row.value}</Fact>)}</Facts>
            <p className="rd-note">重发原内容，已成功的不会重复执行。</p>
          </div>
        </Modal>
      )}

      {releasing && <ReleaseModal label={releasing.title} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)} explain="重试被拒说明不了原操作的结果，先到操作记录确认。解除后原操作不再重试。" />}

      <LeaveDialog guard={leave} saveLabel="保存预测设置" saveBlocked={loading ? "正在刷新，稍等" : draft?.forecastWindow === "90d" ? FORECAST_90D_BLOCK : undefined} onSave={() => void saveConfig()} />

      {refreshAsk && (
        <Modal
          title="有未保存的修改，刷新后会丢失"
          icon={ShieldCheck}
          onClose={() => setRefreshAsk(false)}
          footer={<><Button onClick={() => setRefreshAsk(false)}>继续编辑</Button><Button onClick={() => { setRefreshAsk(false); reloadAll(); }}>放弃修改并刷新</Button></>}
        >
          <p>「预测设置」里的修改还没保存。</p>
        </Modal>
      )}
      {toastNode}
    </RdPage>
  );
}
