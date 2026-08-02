"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchD5WithdrawalParams,
  updateD5WithdrawalLimits,
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

function errorText(err: unknown) {
  const message = err instanceof Error ? err.message : "D5_REQUEST_FAILED";
  if (message.includes("CONFIG_VERSION_CONFLICT")) return "参数已被其他运营员更新，请刷新后重试";
  if (message.includes("COVERAGE_BELOW_REDLINE") || message.includes("覆盖率低于红线")) return "覆盖率低于红线，放大资金流出的调整已被服务器拒绝";
  if (message.includes("REASON_REQUIRED")) return "请输入 8-200 字变更理由";
  return message;
}

type Drafts = {
  daily: string;
  balancePct: string;
  feePct: string;
  feeMin: string;
  feeMax: string;
  nex: string;
  /** FEAT-WD01 小额免审线(USD) */
  smallAmt: string;
  /** FEAT-WD01 到账时效(小时) */
  slaHours: string;
};

const EMPTY_DRAFTS: Drafts = { daily: "", balancePct: "", feePct: "", feeMin: "", feeMax: "", nex: "", smallAmt: "", slaHours: "" };

function draftsFrom(params: D5ParamData): Drafts {
  return {
    daily: String(params.dailyLimitCount),
    balancePct: String(params.maxBalanceRatio * 100),
    feePct: String(params.networkFeeRatio * 100),
    feeMin: String(params.networkFeeMin),
    feeMax: String(params.networkFeeMax),
    nex: String(params.nexFeeOffsetRate),
    smallAmt: String(params.smallAmountThresholdUsd),
    slaHours: String(params.payoutSlaHours),
  };
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
  const feePct = asNumber(drafts.feePct);
  const feeMin = asNumber(drafts.feeMin);
  const feeMax = asNumber(drafts.feeMax);
  const nex = asNumber(drafts.nex);
  const smallAmt = asNumber(drafts.smallAmt);
  const slaHours = asNumber(drafts.slaHours);
  const dailyValid = Number.isInteger(daily) && daily >= 1 && daily <= 10;
  const balanceValid = balancePct >= 50 && balancePct <= 100;
  const feeValid = feePct >= 0 && feePct <= 5 && feeMin >= 0 && feeMax >= feeMin;
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
      <div className="f-stat warn"><div className="k">网络费率</div><div className="v">{pctRatio(params.networkFeeRatio)}</div><div className="sub">{params.networkFeeMin}–{params.networkFeeMax} USDT</div></div>
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
          <div className="p-row">
            <div className="txt"><div className="k">网络费（原子更新）</div><div className="s">费率 0%–5% + min/max；任一失败全回滚</div></div>
            <input aria-label="网络费率目标值" className="l-inp" type="number" min="0" max="5" step="0.01" value={drafts.feePct} disabled={!canFeeWrite} onChange={(event) => updateDraft("feePct", event.target.value)} />
            <input aria-label="网络费最小值" className="l-inp" type="number" min="0" step="0.01" value={drafts.feeMin} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeMin", event.target.value)} />
            <input aria-label="网络费最大值" className="l-inp" type="number" min="0" step="0.01" value={drafts.feeMax} disabled={!canFeeWrite} onChange={(event) => updateDraft("feeMax", event.target.value)} />
            {canFeeWrite && <button className="l-btn sm mc" disabled={!feeValid || (feePct / 100 === params.networkFeeRatio && feeMin === params.networkFeeMin && feeMax === params.networkFeeMax)} onClick={() => submit("网络费", { networkFeeRatio: feePct / 100, networkFeeMin: feeMin, networkFeeMax: feeMax }, feePct / 100 < params.networkFeeRatio || feeMin < params.networkFeeMin || feeMax < params.networkFeeMax, `${pctRatio(params.networkFeeRatio)} / ${params.networkFeeMin}–${params.networkFeeMax} → ${feePct.toFixed(2)}% / ${feeMin}–${feeMax}`)}>预览并提交</button>}
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
          <div className="p-row"><div className="txt"><div className="k">提现惩罚费率</div><div className="s">source: phase-h1</div></div><span className="v">{pctRatio(params.penaltyFeeRate)}</span></div>
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
