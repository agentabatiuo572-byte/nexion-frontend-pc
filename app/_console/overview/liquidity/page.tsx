"use client";

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
import { canAccessCrossDomainPath } from "@/lib/admin/cross-domain-authority";

/** B2 预测配置只有一个槽位:草稿 / 期望版本 / 理由没变就复用命令号,变了铸新号并丢弃旧号。
 *  落 sessionStorage,刷新后「结果未知」的重试仍是同一命令号,后端才能去重。 */
const forecastConfigCommandKey = createSlotAttemptStore({
  storageKey: "nexion-admin-b2-liquidity-commands-v1",
});
const FORECAST_CONFIG_SLOT = "forecast-config";
import {
  B2_LIABILITY_KEYS,
  B2OutcomeUnknownError,
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

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const canCross = (path: string) => canAccessCrossDomainPath(path, session?.role, authorities);
  const canConfig = authorities.includes("overview_b2_write") || authorities.includes("finance_d3_write");
  const canExport = authorities.includes("overview_b2_export") || authorities.includes("finance_d3_export");
  const [data, setData] = useState<B2Dashboard | null>(null);
  const [draft, setDraft] = useState<B2ForecastValues | null>(null);
  const [window, setWindow] = useState<B2MaturityWindow>("7d");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dialogStep, setDialogStep] = useState<"closed" | "edit" | "confirm">("closed");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

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

  const sourceText = useMemo(
    () => Array.from(new Set([...(data?.reserve.sources ?? []), ...(data?.liabilities.sources ?? [])])).join(" / "),
    [data],
  );

  const selectWindow = (value: B2MaturityWindow) => {
    setNotice("");
    void load(value);
  };

  const exportLiabilities = () => {
    setError("");
    void downloadB2LiabilitiesCsv()
      .then(() => setNotice("负债明细 CSV 已导出"))
      .catch((caught) => setError(caught instanceof Error ? displayAdminError(caught) : "导出失败，请重试"));
  };

  const openConfig = () => {
    if (!data || !canConfig) return;
    setDraft(activeConfig(data.config));
    setReason("");
    setDialogStep("edit");
  };

  const proceedToConfirm = () => {
    const length = reason.trim().length;
    if (length < 8 || length > 200) {
      setError("操作原因需为 8–200 个字");
      return;
    }
    setError("");
    setDialogStep("confirm");
  };

  const saveConfig = () => {
    if (!data || !draft || saving) return;
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
    setSaving(true);
    setError("");
    void updateB2ForecastConfig(draft, data.config.version, reason.trim(), operator, commandKey)
      .then(async () => {
        forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
        setDialogStep("closed");
        setNotice("已保存，次日 UTC 00:00 起生效");
        await load(window);
      })
      .catch((caught) => {
        if (!(caught instanceof B2OutcomeUnknownError)) forecastConfigCommandKey.forget(FORECAST_CONFIG_SLOT);
        setDialogStep(caught instanceof B2OutcomeUnknownError ? "confirm" : "edit");
        setError(caught instanceof Error ? displayAdminError(caught) : "保存失败，请重试");
      })
      .finally(() => setSaving(false));
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
  const coverageRatio = liabilities.totalUsdt > 0
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
          <button type="button" className="b2-button" onClick={exportLiabilities}>
            <Download size={14} />导出负债 CSV
          </button>
        ) : (
          <span className="b2-readonly">你没有导出权限</span>
        )}
        {canConfig ? (
          <button type="button" className="b2-button primary" onClick={openConfig}>
            <Settings2 size={14} />调整预测配置
          </button>
        ) : (
          <span className="b2-readonly">你只有查看权限</span>
        )}
      </div>

      {error && <div className="b2-alert error" role="alert">加载失败 · {error}</div>}
      {notice && <div className="b2-alert success" role="status">{notice}</div>}

      <section className="b2-kpis" aria-label="可用资金与应付款摘要">
        <article className="card b2-kpi">
          <span>可动用储备</span>
          <strong>{money(reserve.reserveTotalUsdt)}</strong>
          <small>USDT 和其他可随时动用的资产，已扣除锁定的本金</small>
        </article>
        <article className="card b2-kpi">
          <span>应付款</span>
          <strong>{money(liabilities.totalUsdt)}</strong>
          <small>{liabilities.hardLiabilityCategoryCount}/{LIABILITY_CATEGORY_COUNT} 类有金额</small>
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
          <small>提现 + 利息 + 创世节点分红{maturity.trialStressIncluded ? " + 试用业务（压力测试）" : ""}</small>
        </article>
      </section>

      <section className="card b2-coverage">
        <div>
          <span className="eyebrow">兑付覆盖率</span>
          <strong>{coverageRatio === null ? "无应付款" : `${coverageRatio.toFixed(1)}%`}</strong>
        </div>
        <div className="b2-meter" aria-label="兑付覆盖率">
          <div style={{ width: `${meterWidth}%` }} />
        </div>
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
                    提现 {money(row.withdrawDueUsdt)} · 利息 {money(row.interestDueUsdt)} · 创世节点分红 {money(row.genesisDividendUsdt)}
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
            <div><dt>质押利息</dt><dd>{config.stakingInterestMode === "LINEAR" ? "线性摊提" : "到期计提"}</dd></div>
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
                  <td className="num mono">{(row.share * 100).toFixed(2)}%</td>
                  <td className="mono source">{row.source.startsWith("nx_") ? "业务资金记录" : /[\u3400-\u9fff]/.test(row.source) ? row.source : "业务资金记录"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>数据来源：{sourceText ? "资金储备与应付款记录" : "—"}</footer>
      </section>

      <B2RestoredInsights data={data} />

      {dialogStep !== "closed" && draft && (
        <div className="b2-dialog-backdrop" role="presentation">
          <section className="b2-dialog" role="dialog" aria-modal="true" aria-labelledby="b2-config-title">
            <header>
              <div>
                <b id="b2-config-title">{dialogStep === "edit" ? "调整预测配置" : "确认资金预测配置"}</b>
                <span>只有财务负责人或超级管理员可以提交</span>
              </div>
              <button type="button" aria-label="关闭配置弹窗" onClick={() => setDialogStep("closed")}>×</button>
            </header>

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
                      <option value="90d">90 天</option>
                    </select>
                  </label>
                  <label>
                    质押利息模式
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
                  <label><input type="checkbox" checked={draft.genesisIncluded} onChange={(event) => setDraft({ ...draft, genesisIncluded: event.target.checked })} />计入创世节点每日分红</label>
                  <label><input type="checkbox" checked={draft.trialStressEnabled} onChange={(event) => setDraft({ ...draft, trialStressEnabled: event.target.checked })} />显示试用业务压力测试</label>
                  <label><input type="checkbox" checked={draft.includeFarLiabilities} onChange={(event) => setDraft({ ...draft, includeFarLiabilities: event.target.checked })} />计入远期应付款</label>
                </div>
                <label className="b2-reason">
                  操作原因（8–200 字）
                  <textarea
                    value={reason}
                    maxLength={200}
                    placeholder="为什么要调整预测设置"
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <span>{reason.trim().length}/200</span>
                </label>
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
                  <p>质押利息：{draft.stakingInterestMode === "LINEAR" ? "线性摊提" : "到期计提"}</p>
                  <p>创世节点：{draft.genesisIncluded ? "计入" : "不计入"}；试用业务压力测试：{draft.trialStressEnabled ? "开启" : "关闭"}</p>
                  <p>原因：{reason.trim()}</p>
                  <p>次日 UTC 00:00 起生效，不影响历史数据。</p>
                </div>
                <div className="b2-dialog-actions">
                  <button type="button" className="b2-button" disabled={saving} onClick={() => setDialogStep("edit")}>返回修改</button>
                  <button type="button" className="b2-button primary" disabled={saving} onClick={saveConfig}>
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
