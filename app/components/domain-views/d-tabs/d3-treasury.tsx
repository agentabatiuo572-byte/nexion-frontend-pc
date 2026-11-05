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
import { Download, Landmark, RefreshCw } from "lucide-react";
import { OperationConfirmModal, useToast, type OperatorBriefKind } from "../design-kit";
import { BlockState, Button, Conclusion, Decision, DiffList, Drawer, Explain, Field, Input, KeyValues, Modal, Notice, PageHeader, PageTabs, RdPage, Select, StatusTag } from "@/app/components/rd";
import { useB2LiquidityHistory } from "@/lib/admin/b-restoration-client";
import { businessClock } from "@/lib/admin/business-time";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import {
  createD3Injection,
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
import { displayAdminError } from "@/lib/admin/error-messages";
import { createPendingMutationStore, createSlotAttemptStore, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { DueTab, FORECAST_90D_BLOCK, FlowTab, FundConclusion, OverviewTab, SettingsTab, categoryText, effectiveText, forecastDiffRows, money, timeText, type CrossLink, type ForecastValues, type Loadable } from "./d3-treasury-views";

const OPERATOR = currentAdminOperator;

type ExportKind = "reconciliation" | "liabilities";
type D3PendingRecord = PendingMutationRecord & { amount?: string; voucherNo?: string; reason?: string; operator?: string; exportKind?: ExportKind };

/** 储备注入命令号跨刷新存活:注资是真金白银入账,重铸命令号 = 后端无法去重 = 重复入账。
 *  fingerprint 已编码动作类型(injection)与目标对象(凭证号,后端唯一去重位)+ 金额。
 *  结果未知时要能原样重试(OP-94),所以连内容、理由和操作人一起存。导出同一张表。 */
const pendingKeys = createPendingMutationStore<D3PendingRecord>({
  storageKey: "nexion-admin-d3-treasury-commands-v1",
});
const injectionScope = (voucherNo: string, amount: string) => `injection|${voucherNo}|${amount}`;
const exportScope = (kind: ExportKind) => `sensitive-export|${kind}`;
const EXPORT_LABEL: Record<ExportKind, string> = { reconciliation: "对账 CSV", liabilities: "应付款明细 CSV" };

/** 预测保存只有一个槽位:草稿 / 期望版本 / 理由 / 操作人没变就复用命令号。和旧「可用资金与应付款」共用这张表,
 *  那边留下的未决记录在这里接着恢复(B2-H02)。 */
const forecastCommand = createSlotAttemptStore({ storageKey: "nexion-admin-b2-liquidity-commands-v1" });
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
  action: string;
  detail: ReactNode;
  briefKind: OperatorBriefKind;
  /** 这个操作自己的影响说明，和这类操作的通用说明不一样时才传。 */
  statedBrief?: { impact: string; check: string };
  reasonMax?: number;
  effect?: string;
  confirmLabel: string;
  run: (reason: string) => Promise<void>;
}

/** 页面上方一条结果未知的操作。重试只发存下来的内容，这里没有能改的东西（OP-94）。 */
interface PendingItem {
  commandKey: string;
  tone: "danger" | "warn";
  title: string;
  body: ReactNode;
  auditHref: string;
  retryTitle: string;
  rows: Array<{ key: string; label: string; value: string }>;
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
  const [requestedTab, setRequestedTab] = useState<TabValue | null>(() => queryValue("tab", TABS.map((item) => item.value)));
  const tab = visibleTabs.find((item) => item.value === requestedTab)?.value ?? visibleTabs[0]?.value ?? null;

  const [main, setMain] = useState<D3Main | null>(null);
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
  const [injectErrors, setInjectErrors] = useState<{ amount?: string; voucher?: string }>({});
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
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

  const operationKey = (scope: string, extra: PendingMutationExtra<D3PendingRecord>) => {
    const existing = pendingKeys.get(scope);
    if (existing) return existing;
    const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const key = `d3-${scope.replace(/[^A-Za-z0-9_-]/g, "-")}-${uuid.replaceAll("-", "").replace(".", "").slice(0, 18)}`;
    pendingKeys.remember(scope, key, extra);
    return key;
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
      forget();
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
    const key = operationKey(scope, { amount: nextAmount, voucherNo: nextVoucher, reason, operator });
    const clearForm = () => {
      setAmount("");
      setVoucherNo("");
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
    const errors: { amount?: string; voucher?: string } = {};
    if (!nextAmount || !Number.isFinite(Number(nextAmount)) || Number(nextAmount) <= 0) errors.amount = "请输入有效的注入金额";
    else if (!/^\d+(\.\d{1,2})?$/.test(nextAmount)) errors.amount = "最多两位小数，不会自动四舍五入";
    if (!nextVoucher) errors.voucher = "请输入到账凭证号";
    else if (!/^[A-Za-z0-9][A-Za-z0-9:_./-]{5,95}$/.test(nextVoucher)) errors.voucher = "6–96 位，字母或数字开头，只能用字母、数字和 : _ . / -";
    else if (unknownCommands.injections.some((record) => record.voucherNo === nextVoucher)) errors.voucher = "这个凭证号的登记结果未知，先在页面上方核对";
    setInjectErrors(errors);
    if (errors.amount || errors.voucher) return;
    // 凭证号原样提交，后端按原值判重。类型只有说明作用，写进理由，理由随注入记录和操作记录保存。
    const typeLabel = VOUCHER_TYPES.find((item) => item.value === voucherType)?.label;
    const reasonPrefix = `凭证类型：${typeLabel}。`;
    setConfirm({
      action: "储备注入登记",
      detail: `登记 ${money(Number(nextAmount))}，${typeLabel}，凭证号 ${nextVoucher}。凭证号不可重复。登记后计入可用储备。凭证类型会写在理由前面，留在操作记录里。`,
      briefKind: "funds",
      effect: "立即生效",
      confirmLabel: "确认登记",
      reasonMax: 200 - reasonPrefix.length,
      run: (reason) => submitInjection(nextAmount, nextVoucher, `${reasonPrefix}${reason}`),
    });
  };

  const submitForecast = (values: ForecastValues, version: number, reason: string, operator: string, commandKey: string, inputFingerprint: string, retained: boolean) => sendCommand({
    retained,
    stored: () => forecastCommand.isDurablyStored(FORECAST_SLOT, inputFingerprint, commandKey),
    forget: () => forecastCommand.forget(FORECAST_SLOT),
    send: () => updateD3ForecastConfig(values, version, reason, operator, commandKey),
    done: async () => {
      toast("已保存，次日 UTC 00:00 起生效");
      await load();
    },
  });

  const saveConfig = () => {
    if (!main || !draft || !baseValues) return;
    const values = draft;
    const version = main.config.version;
    const dropped = main.liabilities.breakdown.filter((row) => baseValues.liabilityCategories[row.category] && !values.liabilityCategories[row.category]);
    setConfirm({
      action: "调整应付款预测设置",
      detail: (
        <>
          预测 {values.forecastWindow.replace("d", " 天")}，创世节点收益{values.genesisIncluded ? "计入" : "不计入"}。{effectiveText()}，不影响历史。
          {!values.reserveCategories.usdt && <Notice tone="danger">不计入 USDT 储备后，资金安全等级会按储备 0 算。</Notice>}
          {dropped.map((row) => <Notice key={row.category} tone="warn">不再计入「{categoryText(row.category)}」，这类现在是 {money(row.amountUsdt)}。</Notice>)}
          <DiffList rows={forecastDiffRows(baseValues, values)} emptyNote="这次没有改动任何设置，保存只会多一个版本。" />
        </>
      ),
      briefKind: "config",
      effect: effectiveText(),
      confirmLabel: "保存配置",
      run: (reason) => {
        const operator = OPERATOR();
        const fingerprint = JSON.stringify({ draft: values, expectedVersion: version, reason, operator });
        const commandKey = forecastCommand.resolve(FORECAST_SLOT, fingerprint, () => `b2-forecast-config-${crypto.randomUUID()}`);
        return submitForecast(values, version, reason, operator, commandKey, fingerprint, false);
      },
    });
  };

  const submitExport = async (kind: ExportKind, reason: string, operator = OPERATOR()) => {
    const scope = exportScope(kind);
    const retained = Boolean(pendingKeys.get(scope));
    const key = operationKey(scope, { exportKind: kind, reason, operator });
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
      detail: kind === "reconciliation" ? "导出储备与应付款对账数据：储备、应付款、净差额三行。" : "导出应付款明细：全部 9 类的当前数据，不随页面窗口变。",
      briefKind: "export",
      statedBrief: { impact: "确认后浏览器直接下载这份 CSV，不生成任务，没有下载链接。这次导出记入操作记录。", check: "核对导出内容，理由写明导出依据或工单号。" },
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

  /** 按原操作重试：同命令号、同内容、同理由、同操作人，不接受新输入（OP-94）。只有成功才解除待确认。 */
  const runRetry = async () => {
    if (!retry) return;
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!retry.stored()) {
      retry.forget();
      setUnknownTick((tick) => tick + 1);
      setRetry(null);
      reloadAll();
      toast("原操作已结束或过期，本次未再次发送。请先核对列表，再决定如何处理。");
      return;
    }
    setRetrying(true);
    setRetryRejected((current) => current.filter((key) => key !== retry.commandKey));
    try {
      await retry.resend();
    } catch (err) {
      setPendingNotes((current) => ({ ...current, [retry.commandKey]: `${businessClock(Date.now())} 重试没有成功：${errorText(err, "原因未知")} 这说明不了原操作的结果，原命令继续保留。` }));
      setRetryRejected((current) => [...current, retry.commandKey]);
    } finally {
      setRetrying(false);
      setRetry(null);
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求。 */
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
  const exportBlocked = (kind: ExportKind) => (unknownCommands.exports.some((record) => record.exportKind === kind) ? "上次导出结果未知，先在页面上方核对" : dataBlocked);
  const mainFailed = canReadMain && !main && !loading;
  const mainState = loading && !main
    ? <BlockState state="loading" title="正在读取资金数据…" />
    : mainFailed
      ? <BlockState state="error" title="资金数据没读到，这里先不显示" detail="页面上方可以重新加载。" />
      : null;
  const tier = main?.reserve.waterLevel.tier;
  const fundAlarm = tier === "DANGER" || tier === "WARNING";
  const fundConclusion = main ? <FundConclusion main={main} emergencyLink={crossLink("/emergency/kill-switch", "去紧急停用开关")} withdrawalsLink={crossLink("/finance/withdrawals", "去待审核提现")} /> : null;

  const asOf = main?.reserve.asOf;
  const header = (
    <PageHeader
      pageId="D3"
      title="资金储备与应付款"
      summary="看平台的钱够不够付，要不要补储备。"
      meta={tab ? <>{asOf ? `统计时间：${timeText(asOf)} · ` : ""}打开时读取 <Button variant="ghost" size="sm" loading={loading} icon={<RefreshCw size={14} aria-hidden />} onClick={refresh}>刷新</Button></> : undefined}
      readOnly={canInject || !tab ? undefined : "你只能查看；登记储备注入需财务负责人。"}
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
  const pendingItems: PendingItem[] = [
    ...unknownCommands.injections.map((record): PendingItem => ({
      commandKey: record.commandKey,
      tone: "danger",
      title: "储备注入登记结果未知，可能已经入账",
      body: <>{money(Number(record.amount))}，凭证号 {record.voucherNo}，{timeText(new Date(record.createdAt).toISOString())} 提交。先看累计注入有没有变；重试用同一个请求号，不会重复登记。</>,
      auditHref: `/platform/audit?domain=D&object=${encodeURIComponent(record.voucherNo)}`,
      retryTitle: "按原操作重试储备注入",
      rows: [
        { key: "amount", label: "金额", value: money(Number(record.amount)) },
        { key: "voucher", label: "凭证号", value: record.voucherNo },
        { key: "reason", label: "理由", value: record.reason },
      ],
      stored: () => pendingKeys.isDurablyStored(record.fingerprint, record.commandKey),
      resend: () => submitInjection(record.amount, record.voucherNo, record.reason, record.operator),
      forget: () => pendingKeys.forget(record.fingerprint, record.commandKey),
    })),
    ...(forecastRecord && savedForecast ? [{
      commandKey: forecastRecord.commandKey,
      tone: "danger" as const,
      title: "预测设置保存结果未知，可能已经保存",
      body: <>{timeText(new Date(forecastRecord.createdAt).toISOString())} 提交。先看「预测设置」的版本有没有变；重试用同一个请求号，不会重复保存。</>,
      auditHref: "/platform/audit?domain=D",
      retryTitle: "按原操作重试保存预测设置",
      rows: [
        { key: "version", label: "基于版本", value: `v${savedForecast.expectedVersion}` },
        { key: "window", label: "默认预测天数", value: savedForecast.draft.forecastWindow.replace("d", " 天") },
        { key: "reason", label: "理由", value: savedForecast.reason },
      ],
      stored: () => forecastCommand.isDurablyStored(FORECAST_SLOT, forecastRecord.inputFingerprint, forecastRecord.commandKey),
      resend: () => submitForecast(savedForecast.draft, savedForecast.expectedVersion, savedForecast.reason, savedForecast.operator, forecastRecord.commandKey, forecastRecord.inputFingerprint, true),
      forget: () => forecastCommand.forget(FORECAST_SLOT),
    }] : []),
    ...unknownCommands.exports.map((record): PendingItem => ({
      commandKey: record.commandKey,
      tone: "warn",
      title: `${EXPORT_LABEL[record.exportKind]} 导出结果未知`,
      body: <>{timeText(new Date(record.createdAt).toISOString())} 提交。文件可能没有下载下来，操作记录里可能已经有这次导出；重试用同一个请求号，不会多记一次。</>,
      auditHref: "/platform/audit?domain=D",
      retryTitle: "按原操作重试导出",
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
      {fundAlarm && fundConclusion}
      {mainFailed && (
        <Notice tone="warn" title="资金状态：暂时无法判断" action={<Button size="sm" onClick={reloadAll}>重新加载</Button>}>
          加载失败，已暂停显示旧数据。{mainError || "数据不完整。"}
        </Notice>
      )}
      {pendingItems.map((item) => (
        <Notice
          key={item.commandKey}
          tone={item.tone}
          title={item.title}
          action={(
            <>
              <Button size="sm" onClick={refresh}>刷新核对</Button>
              <Button size="sm" onClick={() => setRetry(item)}>按原操作重试</Button>
              {retryRejected.includes(item.commandKey) && <Button size="sm" onClick={() => setReleasing(item)}>解除待确认</Button>}
            </>
          )}
        >
          {item.body}
          {reach(item.auditHref, "platform_a2_read") && <> <Link className="rd-link" href={item.auditHref}>到操作记录核查</Link></>}
          <Explain label="技术信息" content={`命令号 ${item.commandKey}`} />
          {pendingNotes[item.commandKey] && <div>{pendingNotes[item.commandKey]}</div>}
        </Notice>
      ))}
      <PageTabs
        label="资金储备内容"
        value={tab}
        onChange={selectTab}
        items={visibleTabs.map((item) => ({ ...item, count: item.value === "settings" && main?.config.pendingConfig ? 1 : undefined }))}
      />
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
          busyReason={loading ? "正在刷新，稍等" : draft?.forecastWindow === "90d" ? FORECAST_90D_BLOCK : undefined}
          onChange={setDraft}
          onDiscard={() => { if (baseValues) setDraft(baseValues); }}
          onSave={saveConfig}
        />
      )}

      <Drawer
        open={injectOpen}
        onClose={() => setInjectOpen(false)}
        title="储备注入登记"
        sub="须填写到账凭证号"
        icon={Landmark}
        tone="role-1"
        footer={<Decision note="凭证号重复时不会登记。下一步核对金额和凭证，再写理由。" others={<Button variant="ghost" onClick={() => setInjectOpen(false)}>取消</Button>} primary={<Button variant="primary" disabledReason={dataBlocked} onClick={saveInjection}>下一步：确认</Button>} />}
      >
        <Field label="注入金额" required help="单位 USDT，最多两位小数。" error={injectErrors.amount}>
          {(control) => <Input {...control} value={amount} onChange={(event) => { setAmount(event.target.value); setInjectErrors((current) => ({ ...current, amount: undefined })); }} inputMode="decimal" placeholder="注入金额 USDT" aria-label="注入金额（USDT，最多两位小数）" />}
        </Field>
        <Field label="凭证类型" required help="到账凭证是链上交易还是银行流水。会写进理由，不进凭证号。">
          <Select aria-label="凭证类型" value={voucherType} options={VOUCHER_TYPES} onChange={setVoucherType} />
        </Field>
        <Field label="凭证编号 / 哈希" required help="填原始编号，至少 6 位，须能查到。" error={injectErrors.voucher}>
          {(control) => <Input {...control} value={voucherNo} onChange={(event) => { setVoucherNo(event.target.value); setInjectErrors((current) => ({ ...current, voucher: undefined })); }} placeholder="凭证号（不能重复）" aria-label="凭证号（必填，不能重复）" />}
        </Field>
      </Drawer>

      {confirm && (
        <OperationConfirmModal
          key={confirm.action}
          action={confirm.action}
          detail={confirm.detail}
          briefKind={confirm.briefKind}
          statedBrief={confirm.statedBrief}
          effect={confirm.effect ? <StatusTag tone="progress" filled>{confirm.effect}</StatusTag> : undefined}
          confirmLabel={confirm.confirmLabel}
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
          busy={retrying}
          onClose={() => setRetry(null)}
          footer={<><Button disabled={retrying} onClick={() => setRetry(null)}>取消</Button><Button variant="primary" loading={retrying} loadingText="提交中…" onClick={() => void runRetry()}>按原操作重试</Button></>}
        >
          <div className="rd-stack">
            <p className="rd-note">用同一个请求号重发原来的内容，已经成功的不会重复执行。</p>
            <KeyValues rows={retry.rows} />
          </div>
        </Modal>
      )}

      {releasing && (
        <Modal
          title="解除待确认"
          onClose={() => setReleasing(null)}
          footer={<><Button onClick={() => setReleasing(null)}>取消</Button><Button variant="primary" onClick={() => releasePending(releasing)}>确认解除</Button></>}
        >
          <div className="rd-stack">
            <p><b>{releasing.title}</b></p>
            <p>重试被拒说明不了原操作的结果。先到操作记录确认原操作有没有生效，再解除。</p>
            <p>解除后可以重新提交，原操作不再重试。这一步只放开本页的锁，不发请求，不写操作记录。</p>
          </div>
        </Modal>
      )}

      {refreshAsk && (
        <Modal
          title="有未保存的修改，刷新后会丢失"
          onClose={() => setRefreshAsk(false)}
          footer={<><Button onClick={() => setRefreshAsk(false)}>继续编辑</Button><Button onClick={() => { setRefreshAsk(false); reloadAll(); }}>放弃修改并刷新</Button></>}
        >
          <p className="rd-note">「预测设置」里的修改还没保存。</p>
        </Modal>
      )}
      {toastNode}
    </RdPage>
  );
}
