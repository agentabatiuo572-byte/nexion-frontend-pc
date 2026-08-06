"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  createD3Injection,
  downloadD3Csv,
  fetchD3Dashboard,
  updateD3ForecastConfig,
  type D3Dashboard,
  type D3ForecastConfig,
  type D3WaterLevel,
} from "@/lib/admin/d-client";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { formatReserveCoverDays } from "@/lib/admin/treasury-cover-days";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;
const WATER_LABEL: Record<D3WaterLevel["tier"], string> = {
  NORMAL: "正常",
  WATCH: "关注",
  WARNING: "预警",
  DANGER: "危险",
};
const TREASURY_SOURCE_LABELS: Record<string, string> = {
  "nx_treasury_reserve_ledger": "储备资金账本",
  "nx_staking_position.amount_usdt": "生效中的质押本金",
  "nx_user_wallet": "用户钱包余额",
  "nx_user_wallet.usdt_available": "用户可提余额",
  "nx_staking_position": "质押本金与利息",
  "nx_staking_position.estimated_interest_usdt": "待付质押利息",
  "nx_genesis_holding": "Genesis 持仓承诺",
  "nx_genesis_holding × nx_genesis_series.daily_dividend_rate_pct": "Genesis 持仓与每日排放规则",
  "nx_nex_lock_order": "NEX 锁仓订单",
  "nx_nex_lock_order active maturity": "生效中的 NEX 锁仓到期额",
  "nx_withdrawal_order": "提现订单",
  "nx_withdrawal_order active queue": "待处理提现订单",
  "nx_wallet_ledger": "钱包资金流水",
  "nx_wallet_ledger pending commission": "待解锁佣金流水",
  "nx_treasury_legacy_lock_liability": "存量锁仓本息",
  "nx_treasury_legacy_lock_liability active principal + accrued interest": "生效中的存量锁仓本息",
  "nx_vietqr_reconciliation": "VietQR 银行回单",
  "nx_vietqr_reconciliation open suspense rows": "待处置 VietQR 银行回单",
};

function treasurySourceLabel(source: string) {
  const value = source.trim();
  return TREASURY_SOURCE_LABELS[value] ?? (value.startsWith("nx_") ? "服务端业务账本" : value || "服务端业务账本");
}

function money(value: number) {
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

/** 储备注入命令号跨刷新存活:注资是真金白银入账,重铸命令号 = 后端无法去重 = 重复入账。
 *  fingerprint 已编码动作类型(injection)与目标对象(凭证号,后端唯一去重位)+ 金额。 */
const pendingKeys = createPendingMutationStore({
  storageKey: "nexion-admin-d3-treasury-commands-v1",
});
const injectionScope = (voucherNo: string, amount: string) => `injection|${voucherNo}|${amount}`;

function reasonValid(reason: string, toast: (message: string) => void) {
  const length = reason.trim().length;
  if (length < 8 || length > 200) {
    toast("操作原因需为 8-200 个字符");
    return false;
  }
  return true;
}

export function D3Treasury({ ctx }: { ctx: DCtx }) {
  const { toast, openConfirm } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canConfig = authorities.includes("finance_d3_write");
  const canInject = authorities.includes("finance_d3_injection_create");
  const canExport = authorities.includes("finance_d3_export");
  const [data, setData] = useState<D3Dashboard | null>(null);
  const [draft, setDraft] = useState<D3ForecastConfig | null>(null);
  const [maturityWindow, setMaturityWindow] = useState<"7d" | "30d">("7d");
  const [exposureWindow, setExposureWindow] = useState<"7d" | "30d" | "90d">("30d");
  const [amount, setAmount] = useState("");
  const [voucherNo, setVoucherNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // merge 2026-08-06:pendingKeys 用分支侧 store 化版本(稳定命令号,声明在下方);
  // loadGeneration 是 main 侧独立功能(请求代际防过期响应),消费在 load() 内,保留。
  const loadGeneration = useRef(0);

  const operationKey = (scope: string) => {
    const existing = pendingKeys.get(scope);
    if (existing) return existing;
    const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const key = `d3-${scope.replace(/[^A-Za-z0-9_-]/g, "-")}-${uuid.replaceAll("-", "").replace(".", "").slice(0, 18)}`;
    pendingKeys.remember(scope, key);
    return key;
  };

  const load = async (nextMaturity?: "7d" | "30d", nextExposure?: "7d" | "30d" | "90d") => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError("");
    try {
      const next = await fetchD3Dashboard(nextMaturity, nextExposure);
      if (generation !== loadGeneration.current) return;
      setData(next);
      setMaturityWindow(next.maturity.window);
      setExposureWindow(next.exposure.window);
      setDraft(next.config.pendingConfig ? { ...next.config, ...next.config.pendingConfig } : next.config);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setData(null);
      setDraft(null);
      setError(err instanceof Error ? displayAdminError(err) : "D3 数据加载失败");
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The window controls explicitly invoke load with their selected value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exposureMax = useMemo(
    () => Math.max(1, ...(data?.exposure.series.map((row) => Math.abs(row.netExposureUsdt)) ?? [1])),
    [data?.exposure.series],
  );

  const selectMaturity = (value: "7d" | "30d") => {
    setMaturityWindow(value);
    void load(value, exposureWindow);
  };

  const selectExposure = (value: "7d" | "30d" | "90d") => {
    setExposureWindow(value);
    void load(maturityWindow, value);
  };

  const saveInjection = () => {
    const nextAmount = amount.trim();
    const nextVoucher = voucherNo.trim();
    if (!nextAmount || !Number.isFinite(Number(nextAmount)) || Number(nextAmount) <= 0) {
      toast("请输入有效注资金额");
      return;
    }
    if (!nextVoucher) {
      toast("请输入真实到账凭证号");
      return;
    }
    openConfirm({
      action: "储备注入登记",
      detail: `登记 ${money(Number(nextAmount))}，凭证号 ${nextVoucher}。凭证号不可重复。`,
      reason: true,
      okLabel: "确认登记",
      run: async (reason) => {
        if (!reasonValid(reason, toast)) return false;
        const scope = injectionScope(nextVoucher, nextAmount);
        try {
          await createD3Injection(nextAmount, nextVoucher, reason.trim(), OPERATOR(), operationKey(scope));
          pendingKeys.forget(scope);
          setAmount("");
          setVoucherNo("");
          toast("储备注入已登记");
          await load();
          return true;
        } catch (err) {
          setError(err instanceof Error ? displayAdminError(err) : "储备注入失败");
          throw err;
        }
      },
    });
  };

  const saveConfig = () => {
    if (!draft) return;
    openConfirm({
      action: "资金预测配置调整",
      detail: `预测窗口 ${draft.forecastWindow}，Genesis ${draft.genesisIncluded ? "纳入" : "不纳入"}；配置于下一 UTC 日 00:00 生效，不追溯历史。`,
      reason: true,
      okLabel: "保存配置",
      run: async (reason) => {
        if (!reasonValid(reason, toast)) return false;
        const values = {
          reserveCategories: draft.reserveCategories,
          liabilityCategories: draft.liabilityCategories,
          forecastWindow: draft.forecastWindow,
          genesisIncluded: draft.genesisIncluded,
          includeFarLiabilities: draft.includeFarLiabilities,
          stakingInterestMode: draft.stakingInterestMode,
          trialStressEnabled: draft.trialStressEnabled,
        };
        try {
          await updateD3ForecastConfig(values, draft.version, reason.trim(), OPERATOR());
          toast("预测配置已保存，将于下一 UTC 日 00:00 生效");
          await load();
          return true;
        } catch (err) {
          setError(err instanceof Error ? displayAdminError(err) : "预测配置保存失败");
          throw err;
        }
      },
    });
  };

  const exportCsv = (kind: "reconciliation" | "liabilities") => {
    void downloadD3Csv(kind)
      .then(() => toast(kind === "reconciliation" ? "储备负债对账 CSV 已导出" : "负债明细 CSV 已导出"))
      .catch((err) => setError(err instanceof Error ? displayAdminError(err) : "CSV 导出失败"));
  };

  if (loading && !data) {
    return <section className="l-card"><div className="l-b">D3 数据加载中...</div></section>;
  }

  if (!data || !draft) {
    return <section className="l-card"><div className="l-b"><div className="dtint warn">D3 数据异常 · {error || "服务端响应不完整，已停止展示旧财务数据"}</div><button className="l-btn primary" style={{ marginTop: 12 }} onClick={() => void load()}>重新加载</button></div></section>;
  }

  const water = data?.reserve.waterLevel;
  const sourceText = Array.from(new Set(
    [...(data?.reserve.sources ?? []), ...(data?.liabilities.sources ?? [])].map(treasurySourceLabel),
  )).join(" / ");

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D3 数据异常 · {error}</div>}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">真实储备</div><div className="v">{money(data?.reserve.reserveTotalUsdt ?? 0)}</div><div className="sub">已扣除质押锁定本金</div></div>
        <div className="f-stat"><div className="k">应付负债</div><div className="v">{money(data?.liabilities.totalUsdt ?? 0)}</div><div className="sub">固定 9 类服务端科目 · 银行轨挂账入科目 #9</div></div>
        <div className={`f-stat ${water?.tier === "DANGER" ? "danger" : water?.tier === "WARNING" ? "warn" : "cyan"}`}><div className="k">当前资金水位</div><div className="v">{water ? WATER_LABEL[water.tier] : "—"}</div><div className="sub">{formatReserveCoverDays(data.maturity.cumulativeUsdt, water?.reserveCoverDays ?? 0)}</div></div>
        <div className="f-stat warn"><div className="k">{data?.maturity.window ?? maturityWindow} 到期负债</div><div className="v">{money(data?.maturity.cumulativeUsdt ?? 0)}</div><div className="sub">提现 + 利息 + Genesis</div></div>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">资金水位分级</span><span className="sub">· 服务端按未来 7 日到期负债判定</span><div className="r"><button className="l-btn sm" onClick={() => void load()}>刷新</button></div></div>
        <div className="l-b">
          <div className="f-stats">
            {(water?.thresholds ?? []).map((row) => (
              <div className={`f-stat ${row.tier === water?.tier ? (row.tier === "DANGER" ? "danger" : row.tier === "WARNING" ? "warn" : "ok") : ""}`} key={row.tier}>
                <div className="k">{row.tier} · {WATER_LABEL[row.tier]}</div>
                <div className="v">{row.condition}</div>
                <div className="sub">{row.tier === water?.tier ? "当前所处分级" : "分级阈值"}</div>
              </div>
            ))}
          </div>
          {water && <div className="dtint" style={{ marginTop: 12 }}>建议动作：{water.suggestedAction}；通知策略：{water.notification}；日均到期 {money(water.dailyAverageDueUsdt)}。</div>}
        </div>
      </section>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h"><span className="ttl">真实储备明细</span><span className="sub">· 服务端权威口径</span></div>
          <div className="l-b">
            <div className="res-row"><span className="nm">USDT 储备<small>基础可动用储备</small></span><span className="v">{money(data?.reserve.usdtReserveUsdt ?? 0)}</span></div>
            <div className="res-row"><span className="nm">其他高流动资产<small>当前纳入口径</small></span><span className="v">{money(data?.reserve.otherLiquidUsdt ?? 0)}</span></div>
            <div className="res-row"><span className="nm">累计真实注资<small>凭证登记汇总</small></span><span className="v">{money(data?.reserve.injectedCumulativeUsdt ?? 0)}</span></div>
            <div className="res-row"><span className="nm">已扣除质押锁定本金<small>不作为可动用储备</small></span><span className="v">-{money(data?.reserve.lockedStakingPrincipalDeductedUsdt ?? 0)}</span></div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">储备注入登记</span><span className="sub">· 真实到账凭证必填</span></div>
          <div className="l-b">
            {canInject ? (
              <>
                <div className="lookup" style={{ marginBottom: 10 }}>
                  <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="注资金额 USDT" />
                  <input value={voucherNo} onChange={(event) => setVoucherNo(event.target.value)} placeholder="真实凭证号（必填且唯一）" />
                  <button className="l-btn primary" onClick={saveInjection}>登记</button>
                </div>
                <div className="dtint">重复凭证返回冲突，不会写储备、审计或事件。</div>
              </>
            ) : <div className="dtint">当前账号只有查看权限；仅财务负责人可登记储备注入。</div>}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">应付负债 · 9 类科目</span><span className="sub">· {data?.liabilities.hardLiabilityCategoryCount ?? 0}/9</span>{canExport && <div className="r"><button className="l-btn sm" onClick={() => exportCsv("liabilities")}>导出负债 CSV</button></div>}</div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead><tr><th>科目</th><th>说明</th><th className="num">金额</th><th className="num">占比</th><th>事实来源</th></tr></thead>
            <tbody>{(data?.liabilities.breakdown ?? []).map((row) => <tr key={row.category}><td className="mono">{row.category}</td><td>{row.label}</td><td className="num mono">{money(row.amountUsdt)}</td><td className="num mono">{(row.share * 100).toFixed(2)}%</td><td style={{ color: "var(--ink-4)" }}>{treasurySourceLabel(row.source)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h"><span className="ttl">到期负债预测</span><span className="sub">· 每日构成与累计</span><div className="r"><select value={maturityWindow} onChange={(event) => selectMaturity(event.target.value as "7d" | "30d")}><option value="7d">7 天</option><option value="30d">30 天</option></select></div></div>
          <div className="l-b" style={{ maxHeight: 430, overflowY: "auto" }}>
            {(data?.maturity.daily ?? []).map((row) => <div className="res-row" key={row.date}><span className="nm">{row.date}<small>提现 {money(row.withdrawDueUsdt)} · 利息 {money(row.interestDueUsdt)} · Genesis {money(row.genesisDividendUsdt)}{data.maturity.trialStressIncluded ? ` · Trial 压测 ${money(row.trialShadowStressUsdt)}` : ""}</small></span><span className="v">{money(row.totalDueUsdt)}</span></div>)}
            <div className="dtint" style={{ marginTop: 10 }}>{data?.maturity.farLiabilityNote ?? ""}</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">净敞口曲线</span><span className="sub">· 储备减应付负债</span><div className="r"><select value={exposureWindow} onChange={(event) => selectExposure(event.target.value as "7d" | "30d" | "90d")}><option value="7d">7 天</option><option value="30d">30 天</option><option value="90d">90 天</option></select></div></div>
          <div className="l-b">
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, data?.exposure.series.length ?? 1)}, minmax(2px, 1fr))`, gap: 2, alignItems: "end", height: 220 }}>
              {(data?.exposure.series ?? []).map((row) => <div key={row.date} title={`${row.date}: ${money(row.netExposureUsdt)}`} style={{ minHeight: 4, height: `${Math.max(4, Math.abs(row.netExposureUsdt) / exposureMax * 200)}px`, background: row.negative ? "var(--danger)" : "var(--success)", borderRadius: 2 }} />)}
            </div>
            <div className="dtint" style={{ marginTop: 12 }}>绿色为正敞口，红色为负敞口；本页只展示后端事实，不计算 B1 的安全判断。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h"><span className="ttl">预测口径配置</span><span className="sub">· 下一 UTC 日 00:00 生效，不追溯历史</span>{canExport && <div className="r"><button className="l-btn sm" onClick={() => exportCsv("reconciliation")}>导出对账 CSV</button></div>}</div>
        <div className="l-b">
          {draft && <>
            <div className="lookup" style={{ marginBottom: 12 }}>
              <label>默认窗口 <select disabled={!canConfig} value={draft.forecastWindow} onChange={(event) => setDraft({ ...draft, forecastWindow: event.target.value as D3ForecastConfig["forecastWindow"] })}><option value="7d">7 天</option><option value="30d">30 天</option><option value="90d">90 天</option></select></label>
              <label>利息预测 <select disabled={!canConfig} value={draft.stakingInterestMode} onChange={(event) => setDraft({ ...draft, stakingInterestMode: event.target.value as D3ForecastConfig["stakingInterestMode"] })}><option value="LINEAR">按日线性</option><option value="AT_MATURITY">到期确认</option></select></label>
            </div>
            <div className="lookup" style={{ marginBottom: 12 }}>
              <label><input type="checkbox" disabled={!canConfig} checked={draft.genesisIncluded} onChange={(event) => setDraft({ ...draft, genesisIncluded: event.target.checked })} /> 纳入 Genesis</label>
              <label><input type="checkbox" disabled={!canConfig} checked={draft.includeFarLiabilities} onChange={(event) => setDraft({ ...draft, includeFarLiabilities: event.target.checked })} /> 纳入远期负债</label>
              <label><input type="checkbox" disabled={!canConfig} checked={draft.trialStressEnabled} onChange={(event) => setDraft({ ...draft, trialStressEnabled: event.target.checked })} /> 试用压力情景</label>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div className="dtint" style={{ marginBottom: 8 }}>储备科目开关</div>
              <div className="lookup">{Object.entries(draft.reserveCategories).map(([key, enabled]) => <label key={key}><input type="checkbox" disabled={!canConfig} checked={enabled} onChange={(event) => setDraft({ ...draft, reserveCategories: { ...draft.reserveCategories, [key]: event.target.checked } })} /> {key}</label>)}</div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div className="dtint" style={{ marginBottom: 8 }}>负债科目开关</div>
              <div className="lookup">{Object.entries(draft.liabilityCategories).map(([key, enabled]) => <label key={key}><input type="checkbox" disabled={!canConfig} checked={enabled} onChange={(event) => setDraft({ ...draft, liabilityCategories: { ...draft.liabilityCategories, [key]: event.target.checked } })} /> {key}</label>)}</div>
            </div>
            <div className="dtint" style={{ marginBottom: 12 }}>当前修订 v{draft.version}（已生效 v{draft.effectiveVersion}）；储备科目 {Object.values(draft.reserveCategories).filter(Boolean).length}/{Object.keys(draft.reserveCategories).length} 开启；负债科目 {Object.values(draft.liabilityCategories).filter(Boolean).length}/{Object.keys(draft.liabilityCategories).length} 开启。</div>
            {draft.pendingConfig && <div className="dtint warn" style={{ marginBottom: 12 }}>待生效 v{draft.pendingVersion}：窗口 {draft.pendingConfig.forecastWindow}，储备科目 {Object.values(draft.pendingConfig.reserveCategories).filter(Boolean).length}/{Object.keys(draft.pendingConfig.reserveCategories).length}，负债科目 {Object.values(draft.pendingConfig.liabilityCategories).filter(Boolean).length}/{Object.keys(draft.pendingConfig.liabilityCategories).length}，Genesis {draft.pendingConfig.genesisIncluded ? "纳入" : "不纳入"}，生效时间 {draft.pendingEffectiveAt}。</div>}
            {canConfig ? <button className="l-btn primary" onClick={saveConfig}>保存预测配置</button> : <div className="dtint">当前账号只有查看权限；仅财务负责人可调整预测口径。</div>}
          </>}
        </div>
      </section>

      <p className="f-foot">D3 权威事实来源：{sourceText || "treasury backend"}。</p>
    </>
  );
}
