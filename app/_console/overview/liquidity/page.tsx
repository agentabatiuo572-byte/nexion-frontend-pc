"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Download,
  ExternalLink,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  B2_LIABILITY_KEYS,
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
import "../b-domain.css";
import "./liquidity.css";

const WATER_LABEL: Record<B2WaterLevel["tier"], string> = {
  NORMAL: "正常",
  WATCH: "关注",
  WARNING: "预警",
  DANGER: "危险",
};

const LIABILITY_LABELS: Record<(typeof B2_LIABILITY_KEYS)[number], string> = {
  withdrawable_balance: "可提现余额",
  usdt_staking_principal: "USDT 质押本金",
  staking_interest: "质押利息",
  genesis_daily_emission: "Genesis 每日分红",
  nex_v2_future: "NEX v2 远期权益",
  withdrawal_queue: "提现队列",
  commission_cooling: "冷却期佣金",
  lock_other: "其他锁仓",
  unverified_deposit: "待核实入金",
};

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
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
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
      setError(caught instanceof Error ? caught.message : "B2 服务端响应异常");
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
      .catch((caught) => setError(caught instanceof Error ? caught.message : "B2 导出失败"));
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
      setError("操作原因需为 8-200 个字符");
      return;
    }
    setError("");
    setDialogStep("confirm");
  };

  const saveConfig = () => {
    if (!data || !draft || saving) return;
    setSaving(true);
    setError("");
    void updateB2ForecastConfig(draft, data.config.version, reason.trim(), currentAdminOperator())
      .then(async () => {
        setDialogStep("closed");
        setNotice("预测配置已保存，配置于下一 UTC 日 00:00 生效；刷新后可核对待生效版本");
        await load(window);
      })
      .catch((caught) => {
        setDialogStep("edit");
        setError(caught instanceof Error ? caught.message : "B2 配置保存失败");
      })
      .finally(() => setSaving(false));
  };

  if (loading && !data) {
    return (
      <div className="dkpage bpage liqpage">
        <BPageHeader
          id="B2"
          title="资金池水位"
          desc="正在从 D3 权威资金口径读取储备、8 类应付负债与到期预测。"
          ctaLabel="D3 资金池深页"
          ctaHref="/finance/pool"
        />
        <section className="card b2-state" aria-live="polite">B2 资金水位加载中...</section>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dkpage bpage liqpage">
        <BPageHeader
          id="B2"
          title="资金池水位"
          desc="D3 是 B2 负债与到期预测的唯一权威来源。"
          ctaLabel="D3 资金池深页"
          ctaHref="/finance/pool"
        />
        <section className="card b2-state b2-state-error" aria-live="assertive">
          <b>服务端响应异常，已停止展示旧财务数据</b>
          <span>{error || "B2 服务端响应异常"}</span>
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
        title="资金池水位"
        desc="以 D3 权威口径回答：当前可动用储备够不够、8 类负债来自哪里、未来 7/30 天何时到期。"
        ctaLabel="D3 资金池深页"
        ctaHref="/finance/pool"
      />

      <div className="b2-toolbar" aria-label="B2 操作栏">
        <div className="b2-window" role="group" aria-label="到期预测窗口">
          {(["7d", "30d"] as const).map((item) => (
            <button
              type="button"
              key={item}
              className={window === item ? "active" : ""}
              aria-pressed={window === item}
              disabled={loading}
              onClick={() => selectWindow(item)}
            >
              {item === "7d" ? "7 天" : "30 天"}
            </button>
          ))}
        </div>
        <span className="b2-asof">口径时点：{reserve.asOf}</span>
        <button type="button" className="b2-button" disabled={loading} onClick={() => void load(window)}>
          <RefreshCw size={14} className={loading ? "spin" : ""} />刷新
        </button>
        {canExport ? (
          <button type="button" className="b2-button" onClick={exportLiabilities}>
            <Download size={14} />导出负债 CSV
          </button>
        ) : (
          <span className="b2-readonly">当前账号无导出权限</span>
        )}
        {canConfig ? (
          <button type="button" className="b2-button primary" onClick={openConfig}>
            <Settings2 size={14} />调整预测配置
          </button>
        ) : (
          <span className="b2-readonly">当前账号只有查看权限</span>
        )}
      </div>

      {error && <div className="b2-alert error" role="alert">服务端响应异常 · {error}</div>}
      {notice && <div className="b2-alert success" role="status">{notice}</div>}

      <section className="b2-kpis" aria-label="资金池水位摘要">
        <article className="card b2-kpi">
          <span>真实可动用储备</span>
          <strong>{money(reserve.reserveTotalUsdt)}</strong>
          <small>USDT + 其他高流动资产，已扣锁定本金</small>
        </article>
        <article className="card b2-kpi">
          <span>应付负债</span>
          <strong>{money(liabilities.totalUsdt)}</strong>
          <small>{liabilities.hardLiabilityCategoryCount}/{B2_LIABILITY_KEYS.length} 类服务端科目</small>
        </article>
        <article className={`card b2-kpi tier-${reserve.waterLevel.tier.toLowerCase()}`}>
          <span>当前资金水位</span>
          <strong>{WATER_LABEL[reserve.waterLevel.tier]}</strong>
          <small>
            {noDue
              ? "当前窗口无到期兑付，不计算覆盖天数"
              : `按日均到期可覆盖 ${reserve.waterLevel.reserveCoverDays} 天`}
          </small>
        </article>
        <article className="card b2-kpi">
          <span>{window} 累计到期</span>
          <strong>{money(maturity.cumulativeUsdt)}</strong>
          <small>提现 + 利息 + Genesis{maturity.trialStressIncluded ? " + Trial 压测" : ""}</small>
        </article>
      </section>

      <section className="card b2-coverage">
        <div>
          <span className="eyebrow">兑付覆盖率</span>
          <strong>{coverageRatio === null ? "无应付负债" : `${coverageRatio.toFixed(1)}%`}</strong>
        </div>
        <div className="b2-meter" aria-label="储备相对负债覆盖率">
          <div style={{ width: `${meterWidth}%` }} />
        </div>
        <div className="b2-cover-copy">
          <ShieldCheck size={18} />
          {noDue ? (
            <span>
              当前窗口无到期兑付；不虚构“可覆盖天数”，也无需对 0 USDT 安排调度。
            </span>
          ) : (
            <span>
              峰值日 <b>{peak.date}</b> 到期 <b>{money(peak.totalDueUsdt)}</b>；
              服务端建议：{reserve.waterLevel.suggestedAction}。
            </span>
          )}
        </div>
      </section>

      <div className="b2-main">
        <section className="card b2-maturity">
          <header>
            <div>
              <CalendarClock size={17} />
              <b>未来 {window === "7d" ? "7" : "30"} 日到期负债</b>
            </div>
            <span>每日构成与累计 · USDT</span>
          </header>
          <div className="b2-maturity-list">
            {maturity.daily.map((row, index) => (
              <div className="b2-maturity-row" key={row.date}>
                <div>
                  <b>{row.date}</b>
                  <small>
                    提现 {money(row.withdrawDueUsdt)} · 利息 {money(row.interestDueUsdt)} · Genesis {money(row.genesisDividendUsdt)}
                    {maturity.trialStressIncluded ? ` · Trial 压测 ${money(row.trialShadowStressUsdt)}` : ""}
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
            {maturity.farLiabilityNote}
            <span>NEX v2 远期权益默认不作为当前硬负债。</span>
          </footer>
        </section>

        <aside className="card b2-config-summary">
          <header><b>当前预测口径</b><span>版本 {config.version}</span></header>
          <dl>
            <div><dt>默认窗口</dt><dd>{config.forecastWindow}</dd></div>
            <div><dt>质押利息</dt><dd>{config.stakingInterestMode === "LINEAR" ? "线性摊提" : "到期计提"}</dd></div>
            <div><dt>Genesis</dt><dd>{config.genesisIncluded ? "纳入" : "不纳入"}</dd></div>
            <div><dt>Trial 压测</dt><dd>{config.trialStressEnabled ? "启用（非硬负债）" : "关闭"}</dd></div>
            <div><dt>远期负债</dt><dd>{config.includeFarLiabilities ? "纳入" : "排除"}</dd></div>
          </dl>
          <p>{config.effectiveRule}</p>
          {config.pendingConfig && (
            <div className="b2-pending">
              待生效版本 {config.pendingVersion} · {config.pendingEffectiveAt}
            </div>
          )}
          <div className="b2-cross-links">
            <Link href="/overview/dual-ledger">B1 双账本总览<ExternalLink size={13} /></Link>
            <Link href="/finance/pool">D3 资金池深页<ExternalLink size={13} /></Link>
            <Link href="/overview/risk-radar">B5 风险雷达<ExternalLink size={13} /></Link>
          </div>
        </aside>
      </div>

      <section className="card b2-liabilities">
        <header>
          <div><b>应付负债 · {B2_LIABILITY_KEYS.length} 类科目</b><span>{liabilities.hardLiabilityCategoryCount}/{B2_LIABILITY_KEYS.length} · 合计 {money(liabilities.totalUsdt)}</span></div>
          <span>Trial 仅为压力测试：{liabilities.trialShadowIncluded ? "当前展示" : "未计入硬负债"}</span>
        </header>
        <div className="b2-table-wrap">
          <table>
            <thead>
              <tr><th>科目</th><th>说明</th><th className="num">金额</th><th className="num">占比</th><th>事实来源</th></tr>
            </thead>
            <tbody>
              {liabilities.breakdown.map((row) => (
                <tr key={row.category}>
                  <td className="mono">{row.category}</td>
                  <td>{row.label}</td>
                  <td className="num mono">{money(row.amountUsdt)}</td>
                  <td className="num mono">{(row.share * 100).toFixed(2)}%</td>
                  <td className="mono source">{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>权威事实来源：{sourceText || "服务端未返回来源"}</footer>
      </section>

      {dialogStep !== "closed" && draft && (
        <div className="b2-dialog-backdrop" role="presentation">
          <section className="b2-dialog" role="dialog" aria-modal="true" aria-labelledby="b2-config-title">
            <header>
              <div>
                <b id="b2-config-title">{dialogStep === "edit" ? "调整预测配置" : "确认资金预测配置"}</b>
                <span>仅财务负责人 / 超级管理员可提交</span>
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
                  <legend>{B2_LIABILITY_KEYS.length} 类负债口径</legend>
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
                  <label><input type="checkbox" checked={draft.genesisIncluded} onChange={(event) => setDraft({ ...draft, genesisIncluded: event.target.checked })} />纳入 Genesis 每日分红</label>
                  <label><input type="checkbox" checked={draft.trialStressEnabled} onChange={(event) => setDraft({ ...draft, trialStressEnabled: event.target.checked })} />展示 Trial 压力测试</label>
                  <label><input type="checkbox" checked={draft.includeFarLiabilities} onChange={(event) => setDraft({ ...draft, includeFarLiabilities: event.target.checked })} />纳入远期负债</label>
                </div>
                <label className="b2-reason">
                  操作原因（8-200 字符）
                  <textarea
                    value={reason}
                    maxLength={200}
                    placeholder="说明本次口径调整的业务原因"
                    onChange={(event) => setReason(event.target.value)}
                  />
                  <span>{reason.trim().length}/200</span>
                </label>
                <div className="b2-dialog-actions">
                  <button type="button" className="b2-button" onClick={() => setDialogStep("closed")}>取消</button>
                  <button type="button" className="b2-button primary" onClick={proceedToConfirm}>保存并进入确认</button>
                </div>
              </>
            ) : (
              <>
                <div className="b2-confirm">
                  <b>请核对不可省略的写入信息</b>
                  <p>预测窗口：{draft.forecastWindow}</p>
                  <p>质押利息：{draft.stakingInterestMode === "LINEAR" ? "线性摊提" : "到期计提"}</p>
                  <p>Genesis：{draft.genesisIncluded ? "纳入" : "不纳入"}；Trial 压测：{draft.trialStressEnabled ? "启用" : "关闭"}</p>
                  <p>原因：{reason.trim()}</p>
                  <p>基于版本 {config.version} 提交；配置于下一 UTC 日 00:00 生效，不追溯历史。版本过期将返回 409，请刷新后重试。</p>
                </div>
                <div className="b2-dialog-actions">
                  <button type="button" className="b2-button" disabled={saving} onClick={() => setDialogStep("edit")}>返回修改</button>
                  <button type="button" className="b2-button primary" disabled={saving} onClick={saveConfig}>
                    {saving ? "提交中..." : "确认提交配置"}
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
