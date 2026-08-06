"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchD5WithdrawalParams,
  updateD5WithdrawalLimits,
  D5_SMALL_AMOUNT_THRESHOLD_MAX,
  D5_PAYOUT_SLA_HOURS_MIN,
  D5_PAYOUT_SLA_HOURS_MAX,
  D5_NETWORK_CONFIRM_FEE_DEFAULT,
  D5_NETWORK_CONFIRM_FEE_MAX,
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

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : "D5_REQUEST_FAILED";
  if (message.includes("CONFIG_VERSION_CONFLICT")) return "参数已被其他运营员更新，请刷新后重试";
  if (message.includes("COVERAGE_BELOW_REDLINE") || message.includes("覆盖率低于红线")) return "覆盖率低于红线，放大资金流出的调整已被服务器拒绝";
  if (message.includes("REASON_REQUIRED")) return "请输入 8-200 字变更理由";
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
  /** FEAT-WD01 小额免审线(USD) */
  smallAmt: string;
  /** FEAT-WD01 到账时效(小时) */
  slaHours: string;
};

const EMPTY_DRAFTS: Drafts = { daily: "", balancePct: "", feeTrc: "", feeBep: "", feeErc: "", nex: "", smallAmt: "", slaHours: "" };

function draftsFrom(params: D5ParamData): Drafts {
  return {
    daily: String(params.dailyLimitCount),
    balancePct: String(params.maxBalanceRatio * 100),
    feeTrc: String(params.networkConfirmFeeUsd.trc20),
    feeBep: String(params.networkConfirmFeeUsd.bep20),
    feeErc: String(params.networkConfirmFeeUsd.erc20),
    nex: String(params.nexFeeOffsetRate),
    smallAmt: String(params.smallAmountThresholdUsd),
    slaHours: String(params.payoutSlaHours),
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
      action: `提现参数变更 · ${label}`,
      detail: <>
        <div>{beforeAfter}</div>
        <div>{amplifies ? "方向：放大资金流出，服务器将强制校验 B1 红线。" : "方向：收紧资金流出，不受覆盖率红线阻断。"}</div>
        <div>提交基于配置版本 v{params.version}；并发变化会返回 409，任何字段失败均不会部分生效。</div>
      </>,
      amplifies,
      coverage: { coverageRatio: params.coverageRatio, redlinePct: params.redlinePct },
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "提交成功后生效并写入审计",
      run: async (reason) => {
        try {
          const next = await updateD5WithdrawalLimits(changes, params.version, reason, OPERATOR());
          requestId.current += 1;
          applySnapshot(next);
          toast(`${label} 已生效 · 已记审计`);
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
  const smallAmt = asNumber(drafts.smallAmt);
  const slaHours = asNumber(drafts.slaHours);
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
  // FEAT-WD01 值域(规格 §2):小额线 0–500(0=关闭快车道);到账时效 1–168 小时。
  const smallAmtValid = Number.isFinite(smallAmt) && smallAmt >= 0 && smallAmt <= D5_SMALL_AMOUNT_THRESHOLD_MAX;
  const slaValid = Number.isInteger(slaHours) && slaHours >= D5_PAYOUT_SLA_HOURS_MIN && slaHours <= D5_PAYOUT_SLA_HOURS_MAX;

  if (loading && !params) {
    return <section className="l-card"><div className="l-b">D5 权威配置加载中，写操作已冻结...</div></section>;
  }

  if (!params) {
    return <section className="l-card">
      <div className="l-h"><span className="ttl">D5 权威配置不可用</span></div>
      <div className="l-b">
        <div className="dtint warn">{error || "未获得服务器权威快照"}。旧值已清空，全部写操作保持冻结。</div>
        <button className="l-btn" onClick={() => void load()}>重试获取权威快照</button>
      </div>
    </section>;
  }

  return <>
    {error && <div className="dtint warn" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="f-stats">
      <div className="f-stat"><div className="k">每日提现次数</div><div className="v">{params.dailyLimitCount}</div><div className="sub">D5 · D2 实时消费</div></div>
      <div className="f-stat"><div className="k">小额免审线</div><div className="v">${params.smallAmountThresholdUsd}</div><div className="sub">{params.smallAmountThresholdUsd > 0 ? "快车道启用" : "快车道已关闭"}</div></div>
      <div className="f-stat"><div className="k">到账时效</div><div className="v">{params.payoutSlaHours}h</div><div className="sub">正常提现到账等待</div></div>
      <div className="f-stat cyan"><div className="k">余额可提上限</div><div className="v">{pctRatio(params.maxBalanceRatio)}</div><div className="sub">D5 权威</div></div>
      <div className="f-stat warn"><div className="k">网络确认费</div><div className="v">${params.networkConfirmFeeUsd.trc20} / ${params.networkConfirmFeeUsd.bep20} / ${params.networkConfirmFeeUsd.erc20}</div><div className="sub">TRC20 / BEP20 / ERC20 · 每笔固定</div></div>
      <div className="f-stat cyan"><div className="k">NEX 抵扣率</div><div className="v">${params.nexFeeOffsetRate.toFixed(2)}/NEX</div><div className="sub">D5 权威</div></div>
      <div className={`f-stat ${params.coverageReliable && params.coverageRatio >= params.redlinePct ? "ok" : "danger"}`}><div className="k">B1 覆盖率</div><div className="v">{pct(params.coverageRatio)}</div><div className="sub">红线 {pct(params.redlinePct)} · {params.coverageReliable ? "可信" : "不可用"}</div></div>
    </div>

    <div className="two-col r11">
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">D5 自有六组参数</span>
          <span className="sub">· 权威版本 v{params.version} · {canWriteAny ? "财务主管/超管可改" : "当前角色只读"}</span>
          <div className="r"><button className="l-btn sm" onClick={() => void load()}>刷新</button></div>
        </div>
        <div className="l-b">
          <div className="p-row">
            <div className="txt"><div className="k">每日提现次数</div><div className="s">1–10；上调放大、下调收紧</div></div>
            <input aria-label="每日提现次数目标值" className="l-inp" type="number" min="1" max="10" step="1" value={drafts.daily} disabled={!canDailyWrite} onChange={(event) => updateDraft("daily", event.target.value)} />
            {canDailyWrite && <button className="l-btn sm mc" disabled={!dailyValid || daily === params.dailyLimitCount} onClick={() => submit("每日提现次数", { dailyLimitCount: daily }, daily > params.dailyLimitCount, `${params.dailyLimitCount} 次 → ${daily} 次`)}>预览并提交</button>}
          </div>
          {/* FEAT-WD01:小额免审线 —— 金额 ≤ 此值免掉「首提必审」与「新地址 hold」两道闸,
              让新用户第一笔小额提现能当天走完。上调 = 更多提现绕过人工 = 放大流出方向。
              🔴 免的只是这两道闸,风控路由(冻结簇/共用地址/风险分)照常裁决,不因小额而豁免。 */}
          <div className="p-row">
            <div className="txt"><div className="k">小额免审线</div><div className="s">0–{D5_SMALL_AMOUNT_THRESHOLD_MAX} USD；金额不超过此值时<b>同时免掉两道闸</b>：① 首次提现人工初审 ② <b>新绑地址 24 小时延迟</b>(防盗号)。其余风控闸(冻结簇 / 共用地址 / 风险分)照常裁决。填 0 = 关闭快车道。上调放大、下调收紧</div></div>
            <input aria-label="小额免审线目标值" className="l-inp" type="number" min="0" max={D5_SMALL_AMOUNT_THRESHOLD_MAX} step="1" value={drafts.smallAmt} disabled={!canDailyWrite} onChange={(event) => updateDraft("smallAmt", event.target.value)} />
            {canDailyWrite && <button className="l-btn sm mc" disabled={!smallAmtValid || smallAmt === params.smallAmountThresholdUsd} onClick={() => submit("小额免审线", { smallAmountThresholdUsd: smallAmt }, smallAmt > params.smallAmountThresholdUsd, `$${params.smallAmountThresholdUsd} → $${smallAmt}`)}>预览并提交</button>}
          </div>
          {/* FEAT-WD01:到账时效 —— 正常提现「提交 → 到账」的等待小时数(默认 24 = T+1)。
              调小 = 用户更快拿到钱 = 放大流出方向。命中大额合规审查时改用「到账审查窗口」,取更晚者。 */}
          <div className="p-row">
            <div className="txt"><div className="k">到账时效</div><div className="s">{D5_PAYOUT_SLA_HOURS_MIN}–{D5_PAYOUT_SLA_HOURS_MAX} 小时；正常提现从提交到到账的等待时长(24 = 次日到账)。大额命中审查时改用下方「到账审查窗口」取更晚者。调小放大、调大收紧</div></div>
            <input aria-label="到账时效目标值" className="l-inp" type="number" min={D5_PAYOUT_SLA_HOURS_MIN} max={D5_PAYOUT_SLA_HOURS_MAX} step="1" value={drafts.slaHours} disabled={!canDailyWrite} onChange={(event) => updateDraft("slaHours", event.target.value)} />
            {canDailyWrite && <button className="l-btn sm mc" disabled={!slaValid || slaHours === params.payoutSlaHours} onClick={() => submit("到账时效", { payoutSlaHours: slaHours }, slaHours < params.payoutSlaHours, `${params.payoutSlaHours} 小时 → ${slaHours} 小时`)}>预览并提交</button>}
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">余额可提上限</div><div className="s">50%–100%；上调放大、下调收紧</div></div>
            <input aria-label="余额可提上限目标值" className="l-inp" type="number" min="50" max="100" step="0.01" value={drafts.balancePct} disabled={!canBalanceWrite} onChange={(event) => updateDraft("balancePct", event.target.value)} />
            <span>%</span>
            {canBalanceWrite && <button className="l-btn sm mc" disabled={!balanceValid || balancePct / 100 === params.maxBalanceRatio} onClick={() => submit("余额可提上限", { maxBalanceRatio: balancePct / 100 }, balancePct / 100 > params.maxBalanceRatio, `${pctRatio(params.maxBalanceRatio)} → ${balancePct.toFixed(2)}%`)}>预览并提交</button>}
          </div>
          {/* FEAT-WD02:三网络固定确认费(每笔 USD)。三值一次 PUT 原子提交,任一失败全回滚;
              任一网络调低 = 放大流出。0 = 该网络免手续费(合法值,给显著警示防误配)。 */}
          <div className="p-row">
            <div className="txt">
              <div className="k">网络确认费（三网络 · 原子更新）</div>
              <div className="s">每笔固定收取,按提现网络计,0–{D5_NETWORK_CONFIRM_FEE_MAX} USD、步进 0.5;三值一次提交,任一失败全回滚。任一网络<b>调低即放大流出</b>。默认 TRC20 $1 / BEP20 $1 / ERC20 $5</div>
              {canFeeWrite && !feeTrcValid && drafts.feeTrc !== "" && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>TRC20 超出 0–{D5_NETWORK_CONFIRM_FEE_MAX} 值域</div>}
              {canFeeWrite && !feeBepValid && drafts.feeBep !== "" && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>BEP20 超出 0–{D5_NETWORK_CONFIRM_FEE_MAX} 值域</div>}
              {canFeeWrite && !feeErcValid && drafts.feeErc !== "" && <div className="s" style={{ color: "var(--admin-danger, #e5484d)" }}>ERC20 超出 0–{D5_NETWORK_CONFIRM_FEE_MAX} 值域</div>}
              {feeValid && (feeTrc === 0 || feeBep === 0 || feeErc === 0) && <div className="s" style={{ color: "var(--admin-warning, #f5a623)" }}>配置为 0 的网络将免手续费,请确认这是有意为之</div>}
            </div>
            <input aria-label="TRC20 网络确认费目标值" className="l-inp" type="number" min="0" max={D5_NETWORK_CONFIRM_FEE_MAX} step="0.5" value={drafts.feeTrc} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeTrc", event.target.value)} />
            <input aria-label="BEP20 网络确认费目标值" className="l-inp" type="number" min="0" max={D5_NETWORK_CONFIRM_FEE_MAX} step="0.5" value={drafts.feeBep} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeBep", event.target.value)} />
            <input aria-label="ERC20 网络确认费目标值" className="l-inp" type="number" min="0" max={D5_NETWORK_CONFIRM_FEE_MAX} step="0.5" value={drafts.feeErc} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeErc", event.target.value)} />
            {canFeeWrite && <button className="l-btn sm mc" disabled={!feeValid || feeUnchanged} onClick={() => submit("网络确认费", { networkConfirmFeeUsd: { trc20: feeTrc, bep20: feeBep, erc20: feeErc } }, feeAmplifies, `TRC20 $${params.networkConfirmFeeUsd.trc20} / BEP20 $${params.networkConfirmFeeUsd.bep20} / ERC20 $${params.networkConfirmFeeUsd.erc20} → $${feeTrc} / $${feeBep} / $${feeErc}`)}>预览并提交</button>}
            {canFeeWrite && <button className="l-btn sm" disabled={feeIsDefault && feeUnchanged} onClick={() => submit("网络确认费恢复默认", { networkConfirmFeeUsd: { ...D5_NETWORK_CONFIRM_FEE_DEFAULT } }, D5_NETWORK_CONFIRM_FEE_DEFAULT.trc20 < params.networkConfirmFeeUsd.trc20 || D5_NETWORK_CONFIRM_FEE_DEFAULT.bep20 < params.networkConfirmFeeUsd.bep20 || D5_NETWORK_CONFIRM_FEE_DEFAULT.erc20 < params.networkConfirmFeeUsd.erc20, `TRC20 $${params.networkConfirmFeeUsd.trc20} / BEP20 $${params.networkConfirmFeeUsd.bep20} / ERC20 $${params.networkConfirmFeeUsd.erc20} → 默认 $${D5_NETWORK_CONFIRM_FEE_DEFAULT.trc20} / $${D5_NETWORK_CONFIRM_FEE_DEFAULT.bep20} / $${D5_NETWORK_CONFIRM_FEE_DEFAULT.erc20}`)}>恢复默认</button>}
          </div>
          <div className="p-row">
            <div className="txt"><div className="k">NEX 抵扣率</div><div className="s">必须大于 0；上调放大、下调收紧</div></div>
            <input aria-label="NEX 抵扣率目标值" className="l-inp" type="number" min="0.000001" step="0.01" value={drafts.nex} disabled={!canFeeWrite} onChange={(event) => updateDraft("nex", event.target.value)} />
            {canFeeWrite && <button className="l-btn sm mc" disabled={!nexValid || nex === params.nexFeeOffsetRate} onClick={() => submit("NEX 抵扣率", { nexFeeOffsetRate: nex }, nex > params.nexFeeOffsetRate, `$${params.nexFeeOffsetRate}/NEX → $${nex}/NEX`)}>预览并提交</button>}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">H1 Phase 派发（只读）</span><span className="sub">· D5 不缓存、不写入</span></div>
        <div className="l-b">
          <div className="p-row"><div className="txt"><div className="k">当前 Phase</div><div className="s">H1 月 {params.currentMonth}</div></div><span className="v">{params.currentPhase}</span></div>
          {/* FEAT-WD01 改名:「提现冷却」易被读成「两笔提现要隔 N 天」,实际是「大额提现要等 N 天才到账」,
              与上面的「每日提现次数」概念直接打架。只改显示名,字段键 cooldownDays 不动(改键会破坏后端契约与既有审计)。 */}
          <div className="p-row"><div className="txt"><div className="k">到账审查窗口</div><div className="s">source: phase-h1 · 大额提现(&gt; $1,000)在后期阶段的到账等待天数,非提现间隔</div></div><span className="v">{params.cooldownDays} 天</span></div>
          {/* FEAT-WD02:「提现惩罚费率」行已删 —— 费用模型换为按网络固定确认费(上方 D5 自有可写),
              H1 旋钮同步下线;历史审计记录不删账。 */}
          <div className="p-row"><div className="txt"><div className="k">增强合规审查</div><div className="s">source: phase-h1</div></div><span className={`bdg ${params.complianceHoldEnabled ? "warn" : "ok"}`}>{params.complianceHoldEnabled ? "开启" : "关闭"}</span></div>
          {authorities.includes("growth_h1_read") && <Link href="/growth/phase" className="l-btn">在 H1 调整 →</Link>}
        </div>
      </section>
    </div>

    <section className="l-card" style={{ marginTop: 12 }}>
      <div className="l-h"><span className="ttl">联动核验入口</span><span className="sub">· 参数、判定、审计、事件均可追溯</span></div>
      <div className="l-b" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {authorities.includes("overview_b1_read") && <Link className="l-btn" href="/overview/dual-ledger">B1 覆盖率</Link>}
        {authorities.includes("finance_d2_read") && <Link className="l-btn" href="/finance/withdrawals">D2 提现审核</Link>}
        {authorities.includes("platform_a2_read") && <Link className="l-btn" href="/platform/audit">A2 操作审计</Link>}
        {authorities.includes("platform_a4_read") && <Link className="l-btn" href="/platform/events">A4 事件中心</Link>}
      </div>
    </section>
  </>;
}
