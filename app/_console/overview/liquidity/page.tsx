"use client";

import { ForecastConfigImpact } from "@/app/components/forecast-config-preview";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { RdPage } from "@/app/components/rd";
import { isDOutcomeUnknownError } from "@/lib/admin/d-client";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { exportScope, treasuryCommandKey, treasuryCommands } from "@/lib/admin/treasury-commands";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { displayAdminError } from "@/lib/admin/error-messages";
import { LIABILITY_DISPLAY_NAMES } from "@/lib/admin/liability-labels";
import {
  CalendarClock,
  Download,
  ExternalLink,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { B2RestoredInsights } from "@/app/components/dashboard/restored-b-insights";
import { useReach } from "@/lib/nav/use-reach";
import { TREASURY_EXPORT_BLOCKED, TREASURY_VALUATION_UNAVAILABLE } from "@/lib/admin/treasury-valuation";

/** B2 预测设置与资金储备页共用命令号，结果未知时跨刷新保留原操作。 */
const forecastConfigCommandKey = createSlotAttemptStore({
  storageKey: "nexion-admin-b2-liquidity-commands-v1",
  // 和资金储备页同一条记录，过期后不能再用原号重试，记录和锁都留着（OP-96）。
  retainExpiredRecords: true,
});
const FORECAST_CONFIG_SLOT = "forecast-config";
const RETRY_EXPIRED = "已超过 24 小时，不能再重试，请到操作记录与审批核对";
import {
  B2_LIABILITY_KEYS,
  B2OutcomeUnknownError,
  B2RequestError,
  previewB2ForecastConfig,
  type ForecastConfigPreview,
  downloadB2LiabilitiesCsv,
  fetchB2Dashboard,
  updateB2ForecastConfig,
  type B2Dashboard,
  type B2ForecastConfig,
  type B2ForecastValues,
  type B2MaturityWindow,
  type B2WaterLevel,
} from "@/lib/admin/b2-client";
import { BPageHeader } from "../b-page-header";
import { TabGroup } from "@/app/components/kit/tab-group";
import "../b-domain.css";
import "./liquidity.css";

const WATER_LABEL: Record<B2WaterLevel["tier"], string> = {
  NORMAL: "正常",
  WATCH: "关注",
  WARNING: "预警",
  DANGER: "危险",
};

/** 负债分类数一律由服务端口径常量派生 —— 页首、摘要、表格、导出共用同一个数,
 *  服务端增删科目时四处同步变化,不再各自硬编码(#108:页首写「8 类」而实际展示 9 类)。 */
const LIABILITY_CATEGORY_COUNT = B2_LIABILITY_KEYS.length;

const LIABILITY_LABELS: Record<(typeof B2_LIABILITY_KEYS)[number], string> = LIABILITY_DISPLAY_NAMES;

function money(value: number | null) {
  return value === null ? TREASURY_VALUATION_UNAVAILABLE
    : `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function activeConfig(config: B2ForecastConfig): B2ForecastValues {
  return config.pendingConfig
    ? { ...config, ...config.pendingConfig }
    : {
        reserveCategories: config.reserveCategories,
        liabilityCategories: config.liabilityCategories,
        forecastWindow: config.forecastWindow,
        genesisIncluded: config.genesisIncluded,
        includeFarLiabilities: config.includeFarLiabilities,
        stakingInterestMode: config.stakingInterestMode,
        trialStressEnabled: config.trialStressEnabled,
      };
}

export default function LiquidityPage() {
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canCross = useReach();
  const canConfig = authorities.includes("overview_b2_write") || authorities.includes("finance_d3_write");
  const canExport = authorities.includes("overview_b2_export") || authorities.includes("finance_d3_export");
  const [data, setData] = useState<B2Dashboard | null>(null);
  const valuationExportBlocked = data?.liabilities.totalUsdt === null ? TREASURY_EXPORT_BLOCKED : undefined;
  const [draft, setDraft] = useState<B2ForecastValues | null>(null);
  const [window, setWindow] = useState<B2MaturityWindow>("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogStep, setDialogStep] = useState<"closed" | "edit" | "confirm">("closed");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingTick, setPendingTick] = useState(0);
  const [pendingNote, setPendingNote] = useState("");
  /** 重试被后端明确拒绝的命令号，只有它能人工解除。 */
  const [rejectedKey, setRejectedKey] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState<"forecast" | "export" | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportNote, setExportNote] = useState("");
  /** 导出重试被后端明确拒绝的命令号，只有它能人工解除。 */
  const [exportRejectedKey, setExportRejectedKey] = useState("");
  const [preview, setPreview] = useState<{ key: string; value: ForecastConfigPreview } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const previewKey = JSON.stringify([draft, data?.config.version]);
  const currentPreview = preview?.key === previewKey ? preview.value : null;
  const previewReady = currentPreview !== null && currentPreview.forecastDeltaPreview.afterCoverageStatus !== "VALUATION_UNAVAILABLE";

  const load = useCallback(async (nextWindow: B2MaturityWindow) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchB2Dashboard(nextWindow);
      setData(next);
      setDraft(activeConfig(next.config));
      setWindow(next.maturity.window);
    } catch (caught) {
      setData(null);
      setDraft(null);
      setError(caught instanceof Error ? displayAdminError(caught) : "加载失败，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("7d");
  }, [load]);

  /** 结果未知的预测保存，和资金储备页是同一条记录。没有资金储备菜单的账号在这里恢复，规则相同。 */
  const pending = useMemo(() => {
    void pendingTick;
    const record = forecastConfigCommandKey.list().find((item) => item.fingerprint === FORECAST_CONFIG_SLOT);
    if (!record) return null;
    return { commandKey: record.commandKey, expiresAt: record.expiresAt, inputFingerprint: record.inputFingerprint, saved: JSON.parse(record.inputFingerprint) as { draft: B2ForecastValues; expectedVersion: number; reason: string; operator: string } };
  }, [pendingTick]);
  useEffect(() => {
    setPreview(null);
    setPreviewError("");
    if (dialogStep !== "confirm" || !draft || !data || !canConfig) return;
    let cancelled = false;
    void previewB2ForecastConfig(draft, data.config.version).then((value) => {
      if (!cancelled) setPreview({ key: previewKey, value });
    }).catch(async (caught) => {
      if (cancelled) return;
      if (caught instanceof B2RequestError && caught.status === 409) {
        setDialogStep("edit");
        setSaveError(displayAdminError(caught));
        await load(window);
      } else setPreviewError(displayAdminError(caught));
    });
    return () => { cancelled = true; };
    // The key contains the exact business draft and saved version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogStep, previewKey, previewRetry, canConfig]);

  const sourceText = useMemo(
    () => Array.from(new Set([...(data?.reserve.sources ?? []), ...(data?.liabilities.sources ?? [])])).join(" / "),
    [data],
  );

  const selectWindow = (value: B2MaturityWindow) => {
    setNotice("");
    void load(value);
  };

  /** 结果未知的导出，和资金储备页是同一条记录。 */
  const pendingExport = useMemo(() => {
    void pendingTick;
    return treasuryCommands.list().find((record) => record.fingerprint === exportScope("liabilities") && record.reason) ?? null;
  }, [pendingTick]);

  /** 确定失败丢号，留在框里改了再提交；结果未知保号，关框，转成页面上方的待确认（OP-92、OP-93）。 */
  const submitExport = async (reason: string) => {
    if (!data || loading) throw new Error("资金数据没读到或正在刷新，读完再导出。");
    if (valuationExportBlocked) throw new Error(valuationExportBlocked);
    const scope = exportScope("liabilities");
    const operator = currentAdminOperator();
    const key = treasuryCommandKey(scope, { exportKind: "liabilities", reason, operator });
    if (!treasuryCommands.isDurablyStored(scope, key)) {
      treasuryCommands.forget(scope);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await downloadB2LiabilitiesCsv(reason, operator, key);
    } catch (caught) {
      if (isDOutcomeUnknownError(caught)) { setPendingTick((tick) => tick + 1); return; }
      treasuryCommands.forget(scope);
      throw caught;
    }
    treasuryCommands.forget(scope);
    setPendingTick((tick) => tick + 1);
    setNotice("应付款 CSV 已导出");
  };

  /** 按原操作重试：同命令号、同理由。过期和查不到记录都不发送，也不解除（OP-96）。 */
  const retryExport = async () => {
    if (!pendingExport?.reason) return;
    if (valuationExportBlocked) { setExportNote(valuationExportBlocked); return; }
    if (pendingExport.expiresAt <= Date.now()) { setExportNote(RETRY_EXPIRED); return; }
    if (!treasuryCommands.isDurablyStored(pendingExport.fingerprint, pendingExport.commandKey)) {
      setExportNote("浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    setRetrying(true);
    setExportRejectedKey("");
    setExportNote("");
    try {
      await downloadB2LiabilitiesCsv(pendingExport.reason, pendingExport.operator ?? currentAdminOperator(), pendingExport.commandKey);
      treasuryCommands.forget(pendingExport.fingerprint, pendingExport.commandKey);
      setPendingTick((tick) => tick + 1);
      setNotice("应付款 CSV 已导出");
    } catch (caught) {
      if (isDOutcomeUnknownError(caught)) {
        setExportNote("结果还是未知，不要重复操作，可以稍后再按原操作重试。");
        return;
      }
      if (isPermissionDenied(caught)) announcePermissionDenied();
      setExportNote(`重试没有成功：${caught instanceof Error ? displayAdminError(caught) : "原因未知"} 这说明不了原操作的结果，原命令继续保留。`);
      setExportRejectedKey(pendingExport.commandKey);
    } finally {
      setRetrying(false);
    }
  };

  const openConfig = () => {
    if (!data || !canConfig || pending) return;
    setDraft(activeConfig(data.config));
    setReason("");
    setReasonError("");
    setSaveError("");
    setDialogStep("edit");
  };

  const proceedToConfirm = () => {
    if (draft?.forecastWindow === "90d") {
      setReasonError("90 天不再提供，改成 7 天或 30 天才能保存。");
      return;
    }
    const length = reason.trim().length;
    if (length < 8 || length > 200) {
      setReasonError("操作原因需为 8–200 个字");
      return;
    }
    setReasonError("");
    setPreview(null);
    setDialogStep("confirm");
  };

  const saveConfig = () => {
    if (!data || !draft || saving || !previewReady || !canConfig) return;
    const operator = currentAdminOperator();
    const fingerprint = JSON.stringify({
      draft,
      expectedVersion: data.config.version,
      reason: reason.trim(),
      operator,
    });
    const commandKey = forecastConfigCommandKey.resolve(
      FORECAST_CONFIG_SLOT, fingerprint, () => `b2-forecast-config-${crypto.randomUUID()}`,
    );
    // 记录存不下就不发：结果未知时没有它就没法用原号重试（OP-92）。
    if (!forecastConfigCommandKey.isDurablyStored(FORECAST_CONFIG_SLOT, fingerprint, commandKey)) {
      forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
      setSaveError("浏览器存不下这次操作，没有提交。换一个窗口再试。");
      return;
    }
    setSaving(true);
    setSaveError("");
    void updateB2ForecastConfig(draft, data.config.version, reason.trim(), operator, commandKey)
      .then(async () => {
        forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
        setDialogStep("closed");
        setNotice("已保存，次日 UTC 00:00 起生效");
        await load(window);
      })
      .catch(async (caught) => {
        if (caught instanceof B2OutcomeUnknownError) {
          setDialogStep("closed");
          setPendingTick((tick) => tick + 1);
          return;
        }
        forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
        setDialogStep("edit");
        setSaveError(caught instanceof Error ? displayAdminError(caught) : "保存失败，请重试");
        if (caught instanceof B2RequestError && caught.status === 409) await load(window);
      })
      .finally(() => setSaving(false));
  };

  /** 按原操作重试：同命令号、同内容、同理由、同操作人。只有成功才解除，明确拒绝也证明不了原操作的结果。 */
  const retryPending = async () => {
    if (!pending) return;
    // 过期和查不到记录都不发送，也不解除：解除只在后端明确拒绝之后（OP-96、OP-153）。
    if (pending.expiresAt <= Date.now()) { setPendingNote(RETRY_EXPIRED); return; }
    if (!forecastConfigCommandKey.isDurablyStored(FORECAST_CONFIG_SLOT, pending.inputFingerprint, pending.commandKey)) {
      setPendingNote("浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    const { draft: values, expectedVersion, reason: savedReason, operator } = pending.saved;
    setRetrying(true);
    setRejectedKey("");
    setPendingNote("");
    try {
      await updateB2ForecastConfig(values, expectedVersion, savedReason, operator, pending.commandKey);
      forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
      setPendingTick((tick) => tick + 1);
      setNotice("已保存，次日 UTC 00:00 起生效");
      await load(window);
    } catch (caught) {
      if (caught instanceof B2OutcomeUnknownError) {
        setPendingNote("结果还是未知，不要重复操作，可以稍后再按原操作重试。");
        return;
      }
      setPendingNote(`重试没有成功：${caught instanceof Error ? displayAdminError(caught) : "原因未知"} 这说明不了原操作的结果，原命令继续保留。`);
      setRejectedKey(pending.commandKey);
    } finally {
      setRetrying(false);
    }
  };

  /** 只放开本页的锁，不发请求，不写操作记录。 */
  const releasePending = () => {
    forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
    setPendingTick((tick) => tick + 1);
    setPendingNote("");
    setReleaseOpen(null);
    setNotice("已解除待确认，可以重新提交");
  };

  const releaseExport = () => {
    if (pendingExport) treasuryCommands.forget(pendingExport.fingerprint, pendingExport.commandKey);
    setPendingTick((tick) => tick + 1);
    setExportNote("");
    setReleaseOpen(null);
    setNotice("已解除待确认，可以重新导出");
  };

  if (loading && !data) {
    return (
      <div className="dkpage bpage liqpage">
        <BPageHeader
          id="B2"
          title="可用资金与应付款"
          desc="正在加载…"
          ctaLabel="资金储备明细"
          ctaHref="/finance/pool"
          ctaAllowed={canCross("/finance/pool")}
        />
        <section className="card b2-state" aria-live="polite">正在加载…</section>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dkpage bpage liqpage">
        <BPageHeader
          id="B2"
          title="可用资金与应付款"
          desc="数据来自「资金储备与应付款」。"
          ctaLabel="资金储备明细"
          ctaHref="/finance/pool"
          ctaAllowed={canCross("/finance/pool")}
        />
        <section className="card b2-state b2-state-error" aria-live="assertive">
          <b>加载失败，已暂停显示旧数据</b>
          <span>{error || "加载失败，请重试"}</span>
          <button type="button" className="b2-button primary" onClick={() => void load(window)}>
            <RefreshCw size={15} />重新加载
          </button>
        </section>
      </div>
    );
  }

  const { reserve, liabilities, maturity, config } = data;
  const coverageRatio = liabilities.totalUsdt !== null && liabilities.totalUsdt > 0
    ? (reserve.reserveTotalUsdt / liabilities.totalUsdt) * 100
    : null;
  const noDue = maturity.cumulativeUsdt === 0;
  const peak = maturity.daily.reduce(
    (best, row) => (row.totalDueUsdt > best.totalDueUsdt ? row : best),
    maturity.daily[0],
  );
  const meterWidth = coverageRatio === null ? 100 : Math.min(100, (coverageRatio / 120) * 100);

  return (
    <div className="dkpage bpage liqpage">
      <BPageHeader
        id="B2"
        title="可用资金与应付款"
        desc={`现在能动用的钱够不够付、${LIABILITY_CATEGORY_COUNT} 类应付款各有多少、未来 7 / 30 天什么时候到期。`}
        ctaLabel="资金储备明细"
        ctaHref="/finance/pool"
        ctaAllowed={canCross("/finance/pool")}
      />

      {valuationExportBlocked && <div className="b2-alert" role="status">{valuationExportBlocked}</div>}
      <div className="b2-toolbar" aria-label="操作栏">
        {/* 互斥到期预测窗口(zentao #159):aria-pressed 会被读屏按 toggle button 朗读,
            运营无法判断「7 天 / 30 天」是一组单选。TabGroup 给 tablist + aria-selected。 */}
        <TabGroup<"7d" | "30d">
          className="b2-window"
          label="到期预测窗口"
          value={window}
          items={["7d", "30d"] as const}
          onSelect={selectWindow}
          disabled={() => loading}
          itemClassName={(_v, selected) => (selected ? "active" : "")}
        >{(item) => (item === "7d" ? "7 天" : "30 天")}</TabGroup>
        <span className="b2-asof">统计时间：{reserve.asOf}</span>
        <button type="button" className="b2-button" disabled={loading} onClick={() => void load(window)}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />刷新
        </button>
        {canExport ? (
          <button type="button" className="b2-button" disabled={!!pendingExport || loading || !!valuationExportBlocked} title={valuationExportBlocked ?? (pendingExport ? "上次导出结果未知，先在页面上方核对" : undefined)} onClick={() => { setError(""); setExportOpen(true); }}>
            <Download size={14} />导出负债 CSV
          </button>
        ) : (
          <span className="b2-readonly">你没有导出权限</span>
        )}
        {canConfig ? (
          <button type="button" className="b2-button primary" disabled={!!pending} title={pending ? "上次保存结果未知，先在页面上方核对" : undefined} onClick={openConfig}>
            <Settings2 size={14} />调整预测配置
          </button>
        ) : (
          <span className="b2-readonly">你只有查看权限</span>
        )}
      </div>

      {error && <div className="b2-alert error" role="alert">加载失败 · {error}</div>}
      {notice && <div className="b2-alert success" role="status">{notice}</div>}
      {pending && canConfig && (
        <div className="b2-alert error" role="alert">
          <b>预测设置保存结果未知，可能已经保存</b>
          <div>基于版本 v{pending.saved.expectedVersion}，默认预测窗口 {pending.saved.draft.forecastWindow}，理由：{pending.saved.reason}。{pending.expiresAt <= Date.now() ? `${RETRY_EXPIRED}。` : "先看配置版本有没有变；重试不会重复保存，内容不能改。"}</div>
          {pendingNote && <div>{pendingNote}</div>}
          <div className="b2-dialog-actions">
            <button type="button" className="b2-button" disabled={retrying || pending.expiresAt <= Date.now()} title={pending.expiresAt <= Date.now() ? RETRY_EXPIRED : undefined} onClick={() => void retryPending()}>{retrying ? "提交中…" : "按原操作重试"}</button>
            {rejectedKey === pending.commandKey && <button type="button" className="b2-button" disabled={retrying} onClick={() => setReleaseOpen("forecast")}>解除待确认</button>}
          </div>
        </div>
      )}
      {pendingExport && canExport && (
        <div className="b2-alert error" role="alert">
          <b>应付款 CSV 导出结果未知</b>
          <div>文件可能没有下载下来，操作记录里可能已经有这次导出。{pendingExport.expiresAt <= Date.now() ? `${RETRY_EXPIRED}。` : "重试不会多记一次。"}</div>
          {exportNote && <div>{exportNote}</div>}
          <div className="b2-dialog-actions">
            <button type="button" className="b2-button" disabled={retrying || loading || !!valuationExportBlocked || pendingExport.expiresAt <= Date.now()} title={pendingExport.expiresAt <= Date.now() ? RETRY_EXPIRED : undefined} onClick={() => void retryExport()}>{retrying ? "提交中…" : "按原操作重试"}</button>
            {exportRejectedKey === pendingExport.commandKey && <button type="button" className="b2-button" disabled={retrying} onClick={() => setReleaseOpen("export")}>解除待确认</button>}
          </div>
        </div>
      )}

      <section className="b2-kpis" aria-label="可用资金与应付款摘要">
        <article className="card b2-kpi">
          <span>可动用储备</span>
          <strong>{money(reserve.reserveTotalUsdt)}</strong>
          <small>USDT 和其他可随时动用的资产，已扣除质押锁定金额</small>
        </article>
        <article className="card b2-kpi">
          <span>应付款</span>
          <strong>{money(liabilities.totalUsdt)}</strong>
          <small>{liabilities.totalUsdt === null ? "UVT 应付款缺少有效价格" : `${liabilities.hardLiabilityCategoryCount}/${LIABILITY_CATEGORY_COUNT} 类有金额`}</small>
        </article>
        <article className={`card b2-kpi tier-${reserve.waterLevel.tier.toLowerCase()}`}>
          <span>资金安全等级</span>
          <strong>{WATER_LABEL[reserve.waterLevel.tier]}</strong>
          <small>
            {noDue
              ? "这段时间没有到期款项"
              : `按每天平均到期额，储备够付 ${reserve.waterLevel.reserveCoverDays} 天`}
          </small>
        </article>
        <article className="card b2-kpi">
          <span>{window} 累计到期</span>
          <strong>{money(maturity.cumulativeUsdt)}</strong>
          <small>提现 + 质押奖励 + 创世节点收益{maturity.trialStressIncluded ? " + 试用业务（压力测试）" : ""}</small>
        </article>
      </section>

      <section className="card b2-coverage">
        <div>
          <span className="eyebrow">兑付覆盖率</span>
          <strong>{liabilities.totalUsdt === null ? TREASURY_VALUATION_UNAVAILABLE : coverageRatio === null ? "无应付款" : `${coverageRatio.toFixed(1)}%`}</strong>
        </div>
        {liabilities.totalUsdt !== null && <div className="b2-meter" aria-label="兑付覆盖率">
          <div style={{ width: `${meterWidth}%` }} />
        </div>}
        <div className="b2-cover-copy">
          <ShieldCheck size={18} />
          {noDue ? (
            <span>
              这段时间没有到期款项，无需安排资金。
            </span>
          ) : (
            <span>
              峰值日 <b>{peak.date}</b> 到期 <b>{money(peak.totalDueUsdt)}</b>；
              建议：{reserve.waterLevel.suggestedAction}。
            </span>
          )}
        </div>
      </section>

      <div className="b2-main">
        <section className="card b2-maturity">
          <header>
            <div>
              <CalendarClock size={17} />
              <b>未来 {window === "7d" ? "7" : "30"} 天到期的应付款</b>
            </div>
            <span>每天构成和累计 · USDT</span>
          </header>
          <div className="b2-maturity-list">
            {maturity.daily.map((row, index) => (
              <div className="b2-maturity-row" key={row.date}>
                <div>
                  <b>{row.date}</b>
                  <small>
                    提现 {money(row.withdrawDueUsdt)} · 质押奖励 {money(row.interestDueUsdt)} · 创世节点收益 {money(row.genesisDividendUsdt)}
                    {maturity.trialStressIncluded ? ` · 试用业务（压力测试）${money(row.trialShadowStressUsdt)}` : ""}
                  </small>
                </div>
                <div className="amount">
                  <b>{money(row.totalDueUsdt)}</b>
                  <small>累计 {money(maturity.cumulative[index].amountUsdt)}</small>
                </div>
              </div>
            ))}
          </div>
          <footer>
            {operatorCopyText(maturity.farLiabilityNote)}
            <span>UVT 锁仓到期应付默认不算作眼下必须付的钱。</span>
          </footer>
        </section>

        <aside className="card b2-config-summary">
          <header><b>当前预测设置</b><span>版本 {config.version}</span></header>
          <dl>
            <div><dt>默认窗口</dt><dd>{config.forecastWindow}</dd></div>
            <div><dt>质押奖励</dt><dd>{config.stakingInterestMode === "LINEAR" ? "线性摊提" : "到期计提"}</dd></div>
            <div><dt>创世节点</dt><dd>{config.genesisIncluded ? "纳入" : "不纳入"}</dd></div>
            <div><dt>试用业务压力测试</dt><dd>{config.trialStressEnabled ? "开启（不算必须付的钱）" : "关闭"}</dd></div>
            <div><dt>远期应付款</dt><dd>{config.includeFarLiabilities ? "纳入" : "排除"}</dd></div>
          </dl>
          <p>{config.effectiveRule === "NEXT_UTC_DAY_00:00" ? "次日 UTC 00:00 生效" : operatorCopyText(config.effectiveRule)}</p>
          {config.pendingConfig && (
            <div className="b2-pending">
              待生效版本 {config.pendingVersion} · {config.pendingEffectiveAt}
            </div>
          )}
          <div className="b2-cross-links">
            {canCross("/overview/dual-ledger") ? <Link href="/overview/dual-ledger">资金与应付款总览<ExternalLink size={13} /></Link> : <span aria-disabled="true">资金与应付款总览 · 无权限</span>}
            {canCross("/finance/pool") ? <Link href="/finance/pool">资金储备明细<ExternalLink size={13} /></Link> : <span aria-disabled="true">资金储备明细 · 无权限</span>}
            {canCross("/overview/risk-radar") ? <Link href="/overview/risk-radar">风险提醒<ExternalLink size={13} /></Link> : <span aria-disabled="true">风险提醒 · 无权限</span>}
          </div>
        </aside>
      </div>

      <section className="card b2-liabilities">
        <header>
          <div><b>应付款 · {LIABILITY_CATEGORY_COUNT} 类</b><span>{liabilities.hardLiabilityCategoryCount}/{LIABILITY_CATEGORY_COUNT} · 合计 {money(liabilities.totalUsdt)}</span></div>
          <span>试用业务只做压力测试：{liabilities.trialShadowIncluded ? "已显示" : "未计入必须付的钱"}</span>
        </header>
        <div className="b2-table-wrap">
          <table>
            <thead>
              <tr><th>类型编号</th><th>说明</th><th className="num">金额</th><th className="num">占比</th><th>数据来源</th></tr>
            </thead>
            <tbody>
              {liabilities.breakdown.map((row) => (
                <tr key={row.category}>
                  <td className="mono">{row.category}</td>
                  <td>{operatorCopyText(row.label)}</td>
                  <td className="num mono">{money(row.amountUsdt)}</td>
                  <td className="num mono">{row.share === null ? TREASURY_VALUATION_UNAVAILABLE : `${(row.share * 100).toFixed(2)}%`}</td>
                  <td className="mono source">{row.source.startsWith("nx_") ? "业务资金记录" : /[\u3400-\u9fff]/.test(row.source) ? row.source : "业务资金记录"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>数据来源：{sourceText ? "资金储备与应付款记录" : "—"}</footer>
      </section>

      <B2RestoredInsights data={data} />

      {exportOpen && (
        <RdPage>
          <OperationConfirmModal
            briefKind="export"
            action="导出应付款 CSV"
            detail="不生成任务，没有下载链接。"
            facts={<dl className="rd-facts"><div className="rd-fact"><dt>范围</dt><dd>全部 9 类的当前数据，不随页面窗口变</dd></div><div className="rd-fact"><dt>去向</dt><dd>浏览器直接下载</dd></div></dl>}
            statedBrief={{ impact: "浏览器直接下载，这次导出记入操作记录。", check: "核对导出内容，理由写明导出依据或工单号。" }}
            confirmLabel="确认导出"
            reasonMin={8}
            reasonMax={200}
            onClose={() => setExportOpen(false)}
            onConfirm={async (exportReason) => {
              await submitExport(exportReason);
              setExportOpen(false);
            }}
          />
        </RdPage>
      )}

      {releaseOpen && (
        <div className="b2-dialog-backdrop" role="presentation">
          <section className="b2-dialog" role="dialog" aria-modal="true" aria-labelledby="b2-release-title">
            <header>
              <div><b id="b2-release-title">解除待确认</b></div>
              <button type="button" aria-label="关闭解除待确认弹窗" onClick={() => setReleaseOpen(null)}>×</button>
            </header>
            <div className="b2-confirm">
              <p>确认这次操作没有生效后再解除。解除后可以重新操作，这一步不发请求，不写操作记录。</p>
            </div>
            <div className="b2-dialog-actions">
              <button type="button" className="b2-button" onClick={() => setReleaseOpen(null)}>取消</button>
              <button type="button" className="b2-button primary" onClick={releaseOpen === "export" ? releaseExport : releasePending}>确认解除</button>
            </div>
          </section>
        </div>
      )}

      {dialogStep !== "closed" && draft && (
        <div className="b2-dialog-backdrop" role="presentation">
          <section className="b2-dialog" role="dialog" aria-modal="true" aria-labelledby="b2-config-title">
            <header>
              <div>
                <b id="b2-config-title">{dialogStep === "edit" ? "调整预测配置" : "确认资金预测配置"}</b>
                <span>只有财务主管或超级管理员可以提交</span>
              </div>
              <button type="button" aria-label="关闭配置弹窗" onClick={() => setDialogStep("closed")}>×</button>
            </header>

            {saveError && <div className="b2-alert error" role="alert">{saveError}</div>}
            {dialogStep === "edit" ? (
              <>
                <div className="b2-form-grid">
                  <label>
                    默认预测窗口
                    <select
                      value={draft.forecastWindow}
                      onChange={(event) => setDraft({ ...draft, forecastWindow: event.target.value as B2ForecastValues["forecastWindow"] })}
                    >
                      <option value="7d">7 天</option>
                      <option value="30d">30 天</option>
                      {draft.forecastWindow === "90d" && <option value="90d" disabled>90 天（旧配置，请选择 7 或 30 天）</option>}
                    </select>
                  </label>
                  <label>
                    质押奖励计算方式
                    <select
                      value={draft.stakingInterestMode}
                      onChange={(event) => setDraft({ ...draft, stakingInterestMode: event.target.value as B2ForecastValues["stakingInterestMode"] })}
                    >
                      <option value="LINEAR">线性摊提</option>
                      <option value="AT_MATURITY">到期计提</option>
                    </select>
                  </label>
                </div>
                <fieldset>
                  <legend>{LIABILITY_CATEGORY_COUNT} 类应付款怎么算</legend>
                  <div className="b2-check-grid">
                    {B2_LIABILITY_KEYS.map((key) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          checked={draft.liabilityCategories[key]}
                          onChange={(event) => setDraft({
                            ...draft,
                            liabilityCategories: { ...draft.liabilityCategories, [key]: event.target.checked },
                          })}
                        />
                        {LIABILITY_LABELS[key]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="b2-check-grid compact">
                  <label><input type="checkbox" checked={draft.genesisIncluded} onChange={(event) => setDraft({ ...draft, genesisIncluded: event.target.checked })} />计入创世节点每日收益</label>
                  <label><input type="checkbox" checked={draft.trialStressEnabled} onChange={(event) => setDraft({ ...draft, trialStressEnabled: event.target.checked })} />显示试用业务压力测试</label>
                  <label><input type="checkbox" checked={draft.includeFarLiabilities} onChange={(event) => setDraft({ ...draft, includeFarLiabilities: event.target.checked })} />计入远期应付款</label>
                </div>
                <label className="b2-reason">
                  操作原因（8–200 字）
                  <textarea
                    value={reason}
                    maxLength={200}
                    aria-invalid={Boolean(reasonError)}
                    aria-describedby={reasonError ? "b2-reason-error" : undefined}
                    placeholder="为什么要调整预测设置"
                    onChange={(event) => { setReason(event.target.value); setReasonError(""); }}
                  />
                  <span>{reason.trim().length}/200</span>
                </label>
                {reasonError && <div id="b2-reason-error" className="b2-alert error" role="alert">{reasonError}</div>}
                <div className="b2-dialog-actions">
                  <button type="button" className="b2-button" onClick={() => setDialogStep("closed")}>取消</button>
                  <button type="button" className="b2-button primary" onClick={proceedToConfirm}>下一步：确认</button>
                </div>
              </>
            ) : (
              <>
                <div className="b2-confirm">
                  <b>请核对以下内容</b>
                  <p>预测窗口：{draft.forecastWindow}</p>
                  <p>质押奖励：{draft.stakingInterestMode === "LINEAR" ? "线性摊提" : "到期计提"}</p>
                  <p>创世节点：{draft.genesisIncluded ? "计入" : "不计入"}；试用业务压力测试：{draft.trialStressEnabled ? "开启" : "关闭"}</p>
                  <p>原因：{reason.trim()}</p>
                  <p>次日 UTC 00:00 起生效，不影响历史数据。</p>
                </div>
                {currentPreview ? <ForecastConfigImpact preview={currentPreview} categoryLabel={(key) => LIABILITY_LABELS[key as keyof typeof LIABILITY_LABELS] ?? "其他应付款"} />
                  : previewError ? <div role="alert">{previewError}<button type="button" className="b2-button" onClick={() => setPreviewRetry((value) => value + 1)}>重试预览</button></div>
                  : <p role="status">正在加载配置影响预览…</p>}
                <div className="b2-dialog-actions">
                  <button type="button" className="b2-button" disabled={saving} onClick={() => setDialogStep("edit")}>返回修改</button>
                  <button type="button" className="b2-button primary" disabled={saving || !previewReady} onClick={saveConfig}>
                    {saving ? "提交中…" : "确认提交"}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
