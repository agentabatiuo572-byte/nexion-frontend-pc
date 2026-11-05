"use client";

/**
 * 资金储备与应付款：看平台的钱够不够付，要不要补储备。四个页签，当前页签和时间窗写进网址（PG-33、ST-23）。
 * 读取按接口原授权分开判断，不合成一个权限（X05）：
 *   储备、应付款、到期预测、预测配置：B2 或 D3 读权限，一起读，任一失败全部清掉，不留旧水位（D3-S01）。
 *   差额曲线：B1 或 D3 读权限，单独读。资金流历史：只认 B2 读权限，单独读。两块失败都不影响别的内容。
 * 四个动作互不替代：应付款导出认 B2 或 D3 导出权限，对账导出只认 D3 导出权限，
 * 预测保存认 B2 或 D3 写权限，储备注入只认注入权限。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, Landmark, RefreshCw } from "lucide-react";
import { OperationConfirmModal, useToast, type OperatorBriefKind } from "../design-kit";
import { BlockState, Button, Conclusion, Decision, DiffList, Drawer, Field, Input, KeyValues, Modal, Notice, PageHeader, PageTabs, RdPage, Select, StatusTag } from "@/app/components/rd";
import { useB2LiquidityHistory } from "@/lib/admin/b-restoration-client";
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
import { createPendingMutationStore, createSlotAttemptStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { DueTab, FORECAST_90D_BLOCK, FlowTab, FundConclusion, OverviewTab, SettingsTab, categoryText, effectiveText, forecastDiffRows, money, timeText, type CrossLink, type ForecastValues, type Loadable } from "./d3-treasury-views";

const OPERATOR = currentAdminOperator;

/** 储备注入命令号跨刷新存活:注资是真金白银入账,重铸命令号 = 后端无法去重 = 重复入账。
 *  fingerprint 已编码动作类型(injection)与目标对象(凭证号,后端唯一去重位)+ 金额。
 *  结果未知时要能原样重试(OP-94),所以连金额、凭证号和理由一起存。 */
const pendingKeys = createPendingMutationStore<PendingMutationRecord & { amount?: string; voucherNo?: string; reason?: string }>({
  storageKey: "nexion-admin-d3-treasury-commands-v1",
});
const injectionScope = (voucherNo: string, amount: string) => `injection|${voucherNo}|${amount}`;
const exportScope = (kind: "reconciliation" | "liabilities") => `sensitive-export|${kind}`;

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
  reasonMax?: number;
  effect?: string;
  confirmLabel: string;
  run: (reason: string) => Promise<void>;
}

interface RetryRequest {
  title: string;
  rows: Array<{ key: string; label: string; value: string }>;
  run: () => Promise<void>;
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
  const [retry, setRetry] = useState<RetryRequest | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
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

  const reloadAll = () => {
    if (canReadMain) void load();
    else if (tab === "due") void loadExposure();
    if (flowVisited && canReadFlow) void history.reload();
  };

  const refresh = () => {
    if (dirty) setRefreshAsk(true);
    else reloadAll();
  };

  const operationKey = (scope: string, extra: { amount?: string; voucherNo?: string; reason?: string } = {}) => {
    const existing = pendingKeys.get(scope);
    if (existing) return existing;
    const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const key = `d3-${scope.replace(/[^A-Za-z0-9_-]/g, "-")}-${uuid.replaceAll("-", "").replace(".", "").slice(0, 18)}`;
    pendingKeys.remember(scope, key, extra);
    return key;
  };

  const submitInjection = async (nextAmount: string, nextVoucher: string, reason: string) => {
    const scope = injectionScope(nextVoucher, nextAmount);
    try {
      await createD3Injection(nextAmount, nextVoucher, reason, OPERATOR(), operationKey(scope, { amount: nextAmount, voucherNo: nextVoucher, reason }));
      pendingKeys.forget(scope);
      setAmount("");
      setVoucherNo("");
      setInjectOpen(false);
      toast("储备注入已登记");
      await load({ keepDraft: true });
    } catch (err) {
      // 确定性拒绝必须丢号(同 D2:留着旧号会让运营改完输入重提时撞载荷不符,
      // 这笔注资 24h 内做不了);结果未知必须保号,丢了重试就是第二笔注资。
      if (!isDOutcomeUnknownError(err)) pendingKeys.forget(scope);
      throw err;
    } finally {
      setUnknownTick((tick) => tick + 1);
    }
  };

  const saveInjection = () => {
    const nextAmount = amount.trim();
    const nextVoucher = voucherNo.trim();
    const errors: { amount?: string; voucher?: string } = {};
    if (!nextAmount || !Number.isFinite(Number(nextAmount)) || Number(nextAmount) <= 0) errors.amount = "请输入有效的注入金额";
    else if (!/^\d+(\.\d{1,2})?$/.test(nextAmount)) errors.amount = "最多两位小数，不会自动四舍五入";
    if (!nextVoucher) errors.voucher = "请输入到账凭证号";
    else if (!/^[A-Za-z0-9][A-Za-z0-9:_./-]{5,95}$/.test(nextVoucher)) errors.voucher = "6–96 位，字母或数字开头，只能用字母、数字和 : _ . / -";
    setInjectErrors(errors);
    if (errors.amount || errors.voucher) return;
    // 凭证号原样提交，后端按原值判重。类型只有说明作用，写进理由，理由随注入记录和操作记录保存。
    const typeLabel = VOUCHER_TYPES.find((item) => item.value === voucherType)?.label;
    const reasonPrefix = `凭证类型：${typeLabel}。`;
    setConfirm({
      action: "储备注入登记",
      detail: `登记 ${money(Number(nextAmount))}，${typeLabel}，凭证号 ${nextVoucher}。凭证号不可重复。登记后计入可用储备。凭证类型会写在理由前面，留在操作记录里。`,
      briefKind: "record",
      effect: "立即生效",
      confirmLabel: "确认登记",
      reasonMax: 200 - reasonPrefix.length,
      run: (reason) => submitInjection(nextAmount, nextVoucher, `${reasonPrefix}${reason}`),
    });
  };

  const submitForecast = async (values: ForecastValues, version: number, reason: string, operator: string, commandKey: string) => {
    try {
      await updateD3ForecastConfig(values, version, reason, operator, commandKey);
      forecastCommand.forget(FORECAST_SLOT);
      toast("已保存，次日 UTC 00:00 起生效");
      await load();
    } catch (err) {
      if (!isDOutcomeUnknownError(err)) forecastCommand.forget(FORECAST_SLOT);
      throw err;
    } finally {
      setUnknownTick((tick) => tick + 1);
    }
  };

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
      run: async (reason) => {
        const operator = OPERATOR();
        const fingerprint = JSON.stringify({ draft: values, expectedVersion: version, reason, operator });
        const commandKey = forecastCommand.resolve(FORECAST_SLOT, fingerprint, () => `b2-forecast-config-${crypto.randomUUID()}`);
        await submitForecast(values, version, reason, operator, commandKey);
      },
    });
  };

  const exportCsv = (kind: "reconciliation" | "liabilities") => {
    setConfirm({
      action: "导出",
      detail: kind === "reconciliation" ? "导出储备与应付款对账数据：储备、应付款、净差额三行。" : "导出应付款明细：全部 9 类的当前数据，不随页面窗口变。",
      briefKind: "record",
      confirmLabel: "确认导出",
      run: async (reason) => {
        const scope = exportScope(kind);
        const pendingKeyBeforeRequest = pendingKeys.get(scope);
        const commandKey = operationKey(scope);
        try {
          await downloadD3Csv(kind, reason, OPERATOR(), commandKey);
          pendingKeys.forget(scope);
          toast(kind === "reconciliation" ? "对账 CSV 已导出" : "应付款明细 CSV 已导出");
        } catch (err) {
          if (!pendingKeyBeforeRequest && !isDOutcomeUnknownError(err)) pendingKeys.forget(scope);
          throw err;
        }
      },
    });
  };

  // 结果未知的提交写在页面最上面,刷新后还在(OP-93)。unknownTick 在每次提交收尾时变,让这里重读。
  const unknownCommands = useMemo(() => {
    void unknownTick;
    return {
      injections: pendingKeys.list().filter((record) => record.fingerprint.startsWith("injection|") && record.amount && record.voucherNo && record.reason),
      forecast: forecastCommand.list().find((record) => record.fingerprint === FORECAST_SLOT) ?? null,
    };
  }, [unknownTick]);

  const startRetry = (request: RetryRequest) => {
    setRetryError("");
    setRetry(request);
  };

  const runRetry = async () => {
    if (!retry) return;
    setRetrying(true);
    setRetryError("");
    try {
      await retry.run();
      setRetry(null);
    } catch (err) {
      setRetryError(errorText(err, "重试失败，请刷新后核对"));
    } finally {
      setRetrying(false);
    }
  };

  const crossLink = (href: string, label: string): CrossLink => ({
    href,
    label,
    reachable: reach(href),
  });

  const dataBlocked = !main ? "资金数据没读到，刷新后再试" : loading ? "正在刷新，稍等" : undefined;
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
          {canExportReconciliation && <Button icon={<Download size={14} aria-hidden />} disabledReason={dataBlocked} onClick={() => exportCsv("reconciliation")}>导出对账 CSV</Button>}
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

  const forecastUnknown = unknownCommands.forecast;
  return (
    <RdPage>
      {header}
      {fundAlarm && fundConclusion}
      {mainFailed && (
        <Notice tone="warn" title="资金状态：暂时无法判断" action={<Button size="sm" onClick={reloadAll}>重新加载</Button>}>
          加载失败，已暂停显示旧数据。{mainError || "数据不完整。"}
        </Notice>
      )}
      {unknownCommands.injections.map((record) => (
        <Notice
          key={record.commandKey}
          tone="danger"
          title="储备注入登记结果未知，可能已经入账"
          action={(
            <>
              <Button size="sm" onClick={refresh}>刷新核对</Button>
              <Button size="sm" onClick={() => startRetry({
                title: "按原操作重试储备注入",
                rows: [
                  { key: "amount", label: "金额", value: money(Number(record.amount)) },
                  { key: "voucher", label: "凭证号", value: record.voucherNo ?? "" },
                  { key: "reason", label: "理由", value: record.reason ?? "" },
                ],
                run: () => submitInjection(record.amount ?? "", record.voucherNo ?? "", record.reason ?? ""),
              })}>按原操作重试</Button>
            </>
          )}
        >
          {money(Number(record.amount))}，凭证号 {record.voucherNo}，{timeText(new Date(record.createdAt).toISOString())} 提交。先看累计注入有没有变；重试用同一个请求号，不会重复登记。
        </Notice>
      ))}
      {forecastUnknown && (
        <Notice
          tone="danger"
          title="预测设置保存结果未知，可能已经保存"
          action={(
            <>
              <Button size="sm" onClick={refresh}>刷新核对</Button>
              <Button size="sm" onClick={() => {
                const saved = JSON.parse(forecastUnknown.inputFingerprint) as { draft: ForecastValues; expectedVersion: number; reason: string; operator: string };
                startRetry({
                  title: "按原操作重试保存预测设置",
                  rows: [
                    { key: "version", label: "基于版本", value: `v${saved.expectedVersion}` },
                    { key: "window", label: "默认预测天数", value: saved.draft.forecastWindow.replace("d", " 天") },
                    { key: "reason", label: "理由", value: saved.reason },
                  ],
                  run: () => submitForecast(saved.draft, saved.expectedVersion, saved.reason, saved.operator, forecastUnknown.commandKey),
                });
              }}>按原操作重试</Button>
            </>
          )}
        >
          {timeText(new Date(forecastUnknown.createdAt).toISOString())} 提交。先看「预测设置」的版本有没有变；重试用同一个请求号，不会重复保存。
        </Notice>
      )}
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
          exportBlocked={dataBlocked}
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
          busyReason={forecastUnknown ? "上次保存结果未知，先在页面上方核对" : loading ? "正在刷新，稍等" : draft?.forecastWindow === "90d" ? FORECAST_90D_BLOCK : undefined}
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
          title={retry.title}
          busy={retrying}
          onClose={() => setRetry(null)}
          footer={<><Button disabled={retrying} onClick={() => setRetry(null)}>取消</Button><Button variant="primary" loading={retrying} loadingText="提交中…" onClick={() => void runRetry()}>按原操作重试</Button></>}
        >
          <div className="rd-stack">
            <p className="rd-note">用同一个请求号重发原来的内容，已经成功的不会重复执行。</p>
            <KeyValues rows={retry.rows} />
            {retryError && <Notice tone="danger">{retryError}</Notice>}
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
