"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchD5WithdrawalParams,
  updateD5WithdrawalLimits,
  D5_NETWORK_CONFIRM_FEE_DEFAULT,
  D5_NETWORK_CONFIRM_FEE_MAX,
  D5_SMALL_AMOUNT_THRESHOLD_MAX,
  D5_PAYOUT_SLA_HOURS_MIN,
  D5_PAYOUT_SLA_HOURS_MAX,
  type D5OwnedChanges,
  type D5Params as D5ParamData,
} from "@/lib/admin/d-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { DCtx } from "./types";

const OPERATOR = currentAdminOperator;

function pctRatio(value: number) {
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function pct(value: number) {
  return `${Number(value).toFixed(2)}%`;
}

function asNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

// 这三个码都只来自服务端,到这里之前 client 已过咽喉翻成中文,按机器码 includes 判的两条
// (CONFIG_VERSION_CONFLICT / REASON_REQUIRED)从来没命中过——已挂表由咽喉出文案。
// 覆盖率红线那条留着:它判的是**中文**译文,是活的,且 D5 要在通用文案上再点明「放大资金流出」。
function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : "";
  if (message.includes("覆盖率低于红线")) return "兑付覆盖率低于红线，这项放宽调整未生效";
  return displayAdminError(err);
}

type Drafts = {
  daily: string;
  balancePct: string;
  /** FEAT-WD02 三网络确认费(USD,每笔固定) */
  feeTrc: string;
  feeBep: string;
  feeErc: string;
  nex: string;
  smallAmount: string;
  payoutSla: string;
};

const EMPTY_DRAFTS: Drafts = {
  daily: "", balancePct: "", feeTrc: "", feeBep: "", feeErc: "", nex: "", smallAmount: "", payoutSla: "",
};

function draftsFrom(params: D5ParamData): Drafts {
  return {
    daily: String(params.dailyLimitCount),
    balancePct: String(params.maxBalanceRatio * 100),
    feeTrc: String(params.networkConfirmFeeUsd.trc20),
    feeBep: String(params.networkConfirmFeeUsd.bep20),
    feeErc: String(params.networkConfirmFeeUsd.erc20),
    nex: String(params.nexFeeOffsetRate),
    smallAmount: String(params.smallAmountThresholdUsd),
    payoutSla: String(params.payoutSlaHours),
  };
}

/** 单网络费值域校验([0,25],有限数)。 */
function confirmFeeValid(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= D5_NETWORK_CONFIRM_FEE_MAX;
}

export function D5Params({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canDailyWrite = authorities.includes("finance_d5_daily_limit_write");
  const canBalanceWrite = authorities.includes("finance_d5_balance_max_write");
  const canFeeWrite = authorities.includes("finance_d5_fee_write");
  const canWriteAny = canDailyWrite || canBalanceWrite || canFeeWrite;
  const [params, setParams] = useState<D5ParamData | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(EMPTY_DRAFTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  const applySnapshot = useCallback((next: D5ParamData) => {
    setParams(next);
    setDrafts(draftsFrom(next));
    setError("");
  }, []);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setParams(null);
    setDrafts(EMPTY_DRAFTS);
    setError("");
    try {
      const next = await fetchD5WithdrawalParams();
      if (id === requestId.current) applySnapshot(next);
    } catch (err) {
      if (id === requestId.current) setError(errorText(err));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [applySnapshot]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const updateDraft = (key: keyof Drafts, value: string) => setDrafts((current) => ({ ...current, [key]: value }));

  const submit = (label: string, changes: D5OwnedChanges, amplifies: boolean, beforeAfter: string) => {
    if (!params) return;
    openActionConfirm({
      action: `调整提现参数 · ${label}`,
      detail: <>
        <div>{beforeAfter}</div>
        <div>{amplifies ? "这是放宽：平台会多付钱，提交时检查兑付覆盖率。" : "这是收紧：平台会少付钱，不受覆盖率限制。"}</div>
        <div>如果设置在你提交前被别人改过，本次不会生效，请刷新后重试。</div>
      </>,
      amplifies,
      coverage: { coverageRatio: params.coverageRatio, redlinePct: params.redlinePct },
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "提交后立即生效。",
      run: async (reason) => {
        try {
          const next = await updateD5WithdrawalLimits(changes, params.version, reason, OPERATOR());
          requestId.current += 1;
          applySnapshot(next);
          toast(`${label} 已生效`);
        } catch (err) {
          requestId.current += 1;
          setParams(null);
          setDrafts(EMPTY_DRAFTS);
          const message = errorText(err);
          setError(message);
          toast(message);
          throw err;
        }
      },
    });
  };

  const daily = asNumber(drafts.daily);
  const balancePct = asNumber(drafts.balancePct);
  const feeTrc = asNumber(drafts.feeTrc);
  const feeBep = asNumber(drafts.feeBep);
  const feeErc = asNumber(drafts.feeErc);
  const nex = asNumber(drafts.nex);
  const smallAmount = asNumber(drafts.smallAmount);
  const payoutSla = asNumber(drafts.payoutSla);
  const dailyValid = Number.isInteger(daily) && daily >= 1 && daily <= 10;
  const balanceValid = balancePct >= 50 && balancePct <= 100;
  // FEAT-WD02:三网络确认费逐字段校验(字段级越界红字),整组同过才可提交(原子)。
  const feeTrcValid = confirmFeeValid(feeTrc);
  const feeBepValid = confirmFeeValid(feeBep);
  const feeErcValid = confirmFeeValid(feeErc);
  const feeValid = feeTrcValid && feeBepValid && feeErcValid;
  const feeUnchanged = params !== null
    && feeTrc === params.networkConfirmFeeUsd.trc20
    && feeBep === params.networkConfirmFeeUsd.bep20
    && feeErc === params.networkConfirmFeeUsd.erc20;
  // 放大方向判定:任一网络调低 = 放大流出(费降 → 用户提现成本降,与旧 networkFee 调低同向)。
  const feeAmplifies = params !== null
    && (feeTrc < params.networkConfirmFeeUsd.trc20
      || feeBep < params.networkConfirmFeeUsd.bep20
      || feeErc < params.networkConfirmFeeUsd.erc20);
  const feeIsDefault = feeTrc === D5_NETWORK_CONFIRM_FEE_DEFAULT.trc20
    && feeBep === D5_NETWORK_CONFIRM_FEE_DEFAULT.bep20
    && feeErc === D5_NETWORK_CONFIRM_FEE_DEFAULT.erc20;
  const nexValid = nex > 0;
  const smallAmountValid = Number.isFinite(smallAmount)
    && smallAmount >= 0 && smallAmount <= D5_SMALL_AMOUNT_THRESHOLD_MAX;
  const payoutSlaValid = Number.isInteger(payoutSla)
    && payoutSla >= D5_PAYOUT_SLA_HOURS_MIN && payoutSla <= D5_PAYOUT_SLA_HOURS_MAX;

  if (loading && !params) {
    return <section className="l-card"><div className="l-b">正在加载…</div></section>;
  }

  if (!params) {
    return <section className="l-card" data-module-health-state="error">
      <div className="l-h"><span className="ttl">提现参数加载失败</span></div>
      <div className="l-b">
        <div className="dtint warn">提现参数加载失败，旧值已清空，修改已暂停。{error && <> · {error}</>}</div>
        <button className="l-btn" onClick={() => void load()}>重试</button>
      </div>
    </section>;
  }

  return <>
    {error && <div className="dtint warn" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="f-stats">
      <div className="f-stat"><div className="k">每日提现次数</div><div className="v">{params.dailyLimitCount}</div><div className="sub">每个用户每天最多提现几次</div></div>
      <div className="f-stat cyan"><div className="k">余额可提上限</div><div className="v">{pctRatio(params.maxBalanceRatio)}</div><div className="sub">每次最多提余额的多少</div></div>
      <div className="f-stat warn"><div className="k">网络确认费</div><div className="v">${params.networkConfirmFeeUsd.trc20} / ${params.networkConfirmFeeUsd.bep20} / ${params.networkConfirmFeeUsd.erc20}</div><div className="sub">TRC20 / BEP20 / ERC20 · 每笔固定</div></div>
      <div className="f-stat"><div className="k">提现网络</div><div className="v">{params.networkEnabled.trc20 ? "TRC20 开" : "TRC20 关"} / {params.networkEnabled.bep20 ? "BEP20 开" : "BEP20 关"} / {params.networkEnabled.erc20 ? "ERC20 开" : "ERC20 关"}</div><div className="sub">当前生效配置 · 应用将按此隐藏不可用通道</div></div>
      <div className="f-stat cyan"><div className="k">UVT 抵扣率</div><div className="v">${params.nexFeeOffsetRate.toFixed(2)}/UVT</div><div className="sub">1 UVT 能抵多少手续费</div></div>
      <div className="f-stat"><div className="k">小额免审线</div><div className="v">${params.smallAmountThresholdUsd}</div><div className="sub">低于这个金额自动通过</div></div>
      <div className="f-stat"><div className="k">预计到账时限</div><div className="v">{params.payoutSlaHours} 小时</div><div className="sub">承诺用户的到账时间</div></div>
      <div className={`f-stat ${params.coverageReliable && params.coverageRatio >= params.redlinePct ? "ok" : "danger"}`}><div className="k">兑付覆盖率</div><div className="v">{pct(params.coverageRatio)}</div><div className="sub">红线 {pct(params.redlinePct)} · {params.coverageReliable ? "可信" : "不可用"}</div></div>
    </div>

    <div className="two-col r11">
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">提现参数</span>
          <span className="sub">· 版本 v{params.version} · {canWriteAny ? "财务主管或超级管理员可修改" : "你只能查看"}</span>
          <div className="r"><button className="l-btn sm" onClick={() => void load()}>刷新</button></div>
        </div>
        <div className="l-b">
          <div className="p-row">
            <div className="txt"><div className="k">每日提现次数</div><div className="s">1–10 次；调高是放宽，调低是收紧</div></div>
            <input aria-label="每日提现次数目标值" className="l-inp" type="text" inputMode="numeric" maxLength={2} value={drafts.daily} disabled={!canDailyWrite} onChange={(event) => updateDraft("daily", event.target.value)} />
            {canDailyWrite && <button className="l-btn sm mc" disabled={!dailyValid || daily === params.dailyLimitCount} onClick={() => submit("每日提现次数", { dailyLimitCount: daily }, daily > params.dailyLimitCount, `${params.dailyLimitCount} 次 → ${daily} 次`)}>预览并提交</button>}
          </div>
          <div className="dtint ok" style={{ marginBottom: 12 }}>
            新提现会按这里的小额免审线自动审核，并按到账时效计算截止时间；没确认到账前不会显示为已到账。
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">小额免审线</div><div className="s">0–{D5_SMALL_AMOUNT_THRESHOLD_MAX} USD；调高后，更多提现会自动通过</div></div>
            <input aria-label="小额免审线目标值" className="l-inp" type="text" inputMode="decimal" value={drafts.smallAmount} disabled={!canDailyWrite} onChange={(event) => updateDraft("smallAmount", event.target.value)} />
            <span>USD</span>
            {canDailyWrite && <button className="l-btn sm mc" disabled={!smallAmountValid || smallAmount === params.smallAmountThresholdUsd} onClick={() => submit("小额免审线", { smallAmountThresholdUsd: smallAmount }, smallAmount > params.smallAmountThresholdUsd, `$${params.smallAmountThresholdUsd} → $${smallAmount}`)}>预览并提交</button>}
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">提现网络（三个一起保存）</div><div className="s">关闭是收紧；开启是放宽，提交时检查兑付覆盖率。</div></div>
            {(["trc20", "bep20", "erc20"] as const).map((network) => {
              const enabled = params.networkEnabled[network];
              const label = network.toUpperCase();
              const next = { ...params.networkEnabled, [network]: !enabled };
              return <button key={network} aria-label={`${label} 提现通道${enabled ? "关闭" : "开启"}`} className={`l-btn sm ${enabled ? "mc" : ""}`} disabled={!canFeeWrite} onClick={() => submit(`${label} 提现通道`, { networkEnabled: next }, !enabled, `${label} ${enabled ? "开启" : "关闭"} → ${enabled ? "关闭" : "开启"}`)}>{label} {enabled ? "已开启" : "已关闭"}</button>;
            })}
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">到账时效</div><div className="s">{D5_PAYOUT_SLA_HOURS_MIN}–{D5_PAYOUT_SLA_HOURS_MAX} 小时；缩短时间会加大出款压力</div></div>
            <input aria-label="到账时效目标值" className="l-inp" type="text" inputMode="numeric" value={drafts.payoutSla} disabled={!canDailyWrite} onChange={(event) => updateDraft("payoutSla", event.target.value)} />
            <span>小时</span>
            {canDailyWrite && <button className="l-btn sm mc" disabled={!payoutSlaValid || payoutSla === params.payoutSlaHours} onClick={() => submit("到账时效", { payoutSlaHours: payoutSla }, payoutSla < params.payoutSlaHours, `${params.payoutSlaHours} 小时 → ${payoutSla} 小时`)}>预览并提交</button>}
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">余额可提上限</div><div className="s">50%–100%；调高是放宽，调低是收紧</div></div>
            <input aria-label="余额可提上限目标值" className="l-inp" type="text" inputMode="decimal" value={drafts.balancePct} disabled={!canBalanceWrite} onChange={(event) => updateDraft("balancePct", event.target.value)} />
            <span>%</span>
            {canBalanceWrite && <button className="l-btn sm mc" disabled={!balanceValid || balancePct / 100 === params.maxBalanceRatio} onClick={() => submit("余额可提上限", { maxBalanceRatio: balancePct / 100 }, balancePct / 100 > params.maxBalanceRatio, `${pctRatio(params.maxBalanceRatio)} → ${balancePct.toFixed(2)}%`)}>预览并提交</button>}
          </div>
          {/* FEAT-WD02:三网络固定确认费(每笔 USD)。三值一次 PUT 原子提交,任一失败全回滚;
              任一网络调低 = 放大流出。0 = 该网络免手续费(合法值,给显著警示防误配)。 */}
          <div className="p-row ui-network-fees">
            <div className="txt">
              <div className="k">网络确认费（三个一起保存）</div>
              <div className="s">每笔固定收取，按网络区分，0–{D5_NETWORK_CONFIRM_FEE_MAX} USD，每档 0.5。<b>调低任一网络都算放宽</b>。默认 TRC20 $1 / BEP20 $1 / ERC20 $5</div>
              {canFeeWrite && !feeTrcValid && drafts.feeTrc !== "" && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>TRC20 超出 0–{D5_NETWORK_CONFIRM_FEE_MAX} 范围</div>}
              {canFeeWrite && !feeBepValid && drafts.feeBep !== "" && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>BEP20 超出 0–{D5_NETWORK_CONFIRM_FEE_MAX} 范围</div>}
              {canFeeWrite && !feeErcValid && drafts.feeErc !== "" && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>ERC20 超出 0–{D5_NETWORK_CONFIRM_FEE_MAX} 范围</div>}
              {feeValid && (feeTrc === 0 || feeBep === 0 || feeErc === 0) && <div className="s" style={{ color: "var(--admin-warning, #f5a623)" }}>设为 0 的网络将不收手续费，请确认</div>}
            </div>
            <label className="ui-network-field">TRC20（美元 / 笔）<input aria-label="TRC20 网络确认费目标值" className="l-inp" type="text" inputMode="decimal" value={drafts.feeTrc} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeTrc", event.target.value)} /></label>
            <label className="ui-network-field">BEP20（美元 / 笔）<input aria-label="BEP20 网络确认费目标值" className="l-inp" type="text" inputMode="decimal" value={drafts.feeBep} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeBep", event.target.value)} /></label>
            <label className="ui-network-field">ERC20（美元 / 笔）<input aria-label="ERC20 网络确认费目标值" className="l-inp" type="text" inputMode="decimal" value={drafts.feeErc} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeErc", event.target.value)} /></label>
            {canFeeWrite && <button className="l-btn sm mc" disabled={!feeValid || feeUnchanged} onClick={() => submit("网络确认费", { networkConfirmFeeUsd: { trc20: feeTrc, bep20: feeBep, erc20: feeErc } }, feeAmplifies, `TRC20 $${params.networkConfirmFeeUsd.trc20} / BEP20 $${params.networkConfirmFeeUsd.bep20} / ERC20 $${params.networkConfirmFeeUsd.erc20} → $${feeTrc} / $${feeBep} / $${feeErc}`)}>预览并提交</button>}
            {canFeeWrite && <button className="l-btn sm" disabled={feeIsDefault && feeUnchanged} onClick={() => submit("网络确认费恢复默认", { networkConfirmFeeUsd: { ...D5_NETWORK_CONFIRM_FEE_DEFAULT } }, D5_NETWORK_CONFIRM_FEE_DEFAULT.trc20 < params.networkConfirmFeeUsd.trc20 || D5_NETWORK_CONFIRM_FEE_DEFAULT.bep20 < params.networkConfirmFeeUsd.bep20 || D5_NETWORK_CONFIRM_FEE_DEFAULT.erc20 < params.networkConfirmFeeUsd.erc20, `TRC20 $${params.networkConfirmFeeUsd.trc20} / BEP20 $${params.networkConfirmFeeUsd.bep20} / ERC20 $${params.networkConfirmFeeUsd.erc20} → 默认 $${D5_NETWORK_CONFIRM_FEE_DEFAULT.trc20} / $${D5_NETWORK_CONFIRM_FEE_DEFAULT.bep20} / $${D5_NETWORK_CONFIRM_FEE_DEFAULT.erc20}`)}>恢复默认</button>}
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">UVT 抵扣率</div><div className="s">必须大于 0；调高是放宽，调低是收紧</div></div>
            <input aria-label="UVT 抵扣率目标值" className="l-inp" type="text" inputMode="decimal" value={drafts.nex} disabled={!canFeeWrite} onChange={(event) => updateDraft("nex", event.target.value)} />
            {canFeeWrite && <button className="l-btn sm mc" disabled={!nexValid || nex === params.nexFeeOffsetRate} onClick={() => submit("UVT 抵扣率", { nexFeeOffsetRate: nex }, nex > params.nexFeeOffsetRate, `$${params.nexFeeOffsetRate}/UVT → $${nex}/UVT`)}>预览并提交</button>}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">随运营阶段变化的设置</span><span className="sub">· 只能查看，修改请到「运营阶段设置」</span></div>
        <div className="l-b">
          <div className="p-row"><div className="txt"><div className="k">当前运营阶段</div><div className="s">第 {params.currentMonth} 月</div></div><span className="v">{params.currentPhase}</span></div>
          {/* FEAT-WD01 改名:「提现冷却」易被读成「两笔提现要隔 N 天」,实际是「大额提现要等 N 天才到账」,
              与上面的「每日提现次数」概念直接打架。只改显示名,字段键 cooldownDays 不动(改键会破坏后端契约与既有审计)。 */}
          <div className="p-row"><div className="txt"><div className="k">到账审查窗口</div><div className="s">大额提现（超过 $1,000）在后期阶段要等多少天到账，不是两次提现的间隔</div></div><span className="v">{params.cooldownDays} 天</span></div>
          {/* FEAT-WD02:「提现惩罚费率」行已删 —— 费用模型换为按网络固定确认费(上方 D5 自有可写),
              H1 旋钮同步下线;历史审计记录不删账。 */}
          <div className="p-row"><div className="txt"><div className="k">加强合规审查</div><div className="s">由运营阶段决定</div></div><span className={`bdg ${params.complianceHoldEnabled ? "warn" : "ok"}`}>{params.complianceHoldEnabled ? "开启" : "关闭"}</span></div>
          {authorities.includes("growth_h1_read") && <Link href="/growth/phase" className="l-btn">去运营阶段设置 →</Link>}
        </div>
      </section>
    </div>

    <section className="l-card" style={{ marginTop: 12 }}>
      <div className="l-h"><span className="ttl">相关页面</span></div>
      <div className="l-b" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {authorities.includes("overview_b1_read") && <Link className="l-btn" href="/overview/dual-ledger">资金与应付款总览</Link>}
        {authorities.includes("finance_d2_read") && <Link className="l-btn" href="/finance/withdrawals">提现审核</Link>}
        {authorities.includes("platform_a2_read") && <Link className="l-btn" href="/platform/audit">操作记录</Link>}
        {authorities.includes("platform_a4_read") && <Link className="l-btn" href="/platform/events">用户行为事件</Link>}
      </div>
    </section>
  </>;
}
