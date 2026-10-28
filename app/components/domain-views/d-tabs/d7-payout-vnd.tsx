"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadPayoutVndConfig,
  updatePayoutVndConfig,
} from "@/lib/admin/payout-vnd-client";
import {
  PAYOUT_VND_FIELDS,
  derivePayoutVndRates,
  type PayoutVndConfig,
  type PayoutVndValues,
  type PayoutVndWritableField,
} from "@/lib/admin/payout-vnd-contract";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { DCtx } from "./types";

type Drafts = Record<PayoutVndWritableField, string>;

const FX_FIELDS = ["sellSpreadPct", "quoteTtlMinWithdraw", "requoteTolerancePct"] as const;
const FEE_FIELDS = ["feeRatePct", "feeMinUsd", "feeMaxUsd", "minAmountUsd", "maxAmountUsd"] as const;
const FORCE_PHRASE = "确认价格倒挂风险";

function draftsFrom(values: PayoutVndValues): Drafts {
  return Object.fromEntries(Object.keys(PAYOUT_VND_FIELDS).map((key) => [key, String(values[key as PayoutVndWritableField])])) as Drafts;
}

function formatVnd(value: number) {
  return `${value.toLocaleString("en-US")}₫`;
}

function alignsToStep(value: number, min: number, step: number) {
  const units = (value - min) / step;
  return Math.abs(units - Math.round(units)) < 1e-9;
}

function parseDrafts(drafts: Drafts) {
  const values = {} as PayoutVndValues;
  const errors: Partial<Record<PayoutVndWritableField, string>> = {};
  for (const [key, spec] of Object.entries(PAYOUT_VND_FIELDS) as Array<[PayoutVndWritableField, (typeof PAYOUT_VND_FIELDS)[PayoutVndWritableField]]>) {
    const raw = drafts[key].trim();
    const value = raw === "" ? Number.NaN : Number(raw);
    if (!Number.isFinite(value)) errors[key] = `${spec.label}请输入有效数值`;
    else if (value < spec.min || value > spec.max) errors[key] = `${spec.label}超出 ${spec.min}–${spec.max} ${spec.unit}`;
    else if ("integer" in spec && spec.integer && !Number.isInteger(value)) errors[key] = `${spec.label}必须是整数`;
    else if (!alignsToStep(value, spec.min, spec.step)) errors[key] = `${spec.label}必须按 ${spec.step} ${spec.unit}递增`;
    values[key] = value;
  }
  const cross: string[] = [];
  if (values.feeMinUsd > 0 && values.feeMinUsd >= values.minAmountUsd) cross.push("最低手续费须低于单笔最低金额");
  if (values.feeMinUsd > values.feeMaxUsd) cross.push("最低手续费不能高于手续费封顶");
  if (values.minAmountUsd > values.maxAmountUsd) cross.push("单笔最低金额不能高于单笔最高金额");
  return { values, errors, cross };
}

function amplification(before: PayoutVndConfig, after: PayoutVndValues) {
  return after.sellSpreadPct < before.sellSpreadPct
    || after.quoteTtlMinWithdraw > before.quoteTtlMinWithdraw
    || after.requoteTolerancePct > before.requoteTolerancePct
    || after.feeRatePct < before.feeRatePct
    || after.feeMinUsd < before.feeMinUsd
    || after.feeMaxUsd < before.feeMaxUsd
    || after.minAmountUsd < before.minAmountUsd
    || after.maxAmountUsd > before.maxAmountUsd;
}

export function D7PayoutVnd({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canManage = authorities.includes("finance_d7_manage");
  const canForce = authorities.includes("finance_d7_force_inverted");
  const [config, setConfig] = useState<PayoutVndConfig | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadPayoutVndConfig();
      setConfig(next);
      setDrafts(draftsFrom(next));
      setError("");
    } catch (caught) {
      setConfig(null);
      setDrafts(null);
      setError(displayAdminError(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const parsed = useMemo(() => drafts ? parseDrafts(drafts) : null, [drafts]);

  if (loading || !config || !drafts || !parsed) {
    return <section className="l-card"><div className="l-b">{error ? <><div className="dtint warn">{error}</div><button className="l-btn primary" style={{ marginTop: 12 }} onClick={() => void reload()}>重试</button></> : "正在加载…"}</div></section>;
  }

  const liveRates = derivePayoutVndRates(config);
  const draftRates = derivePayoutVndRates({ ...config, sellSpreadPct: parsed.values.sellSpreadPct });
  const inverted = Number.isFinite(draftRates.sell) && draftRates.sell >= draftRates.buy;
  const changed = (Object.keys(PAYOUT_VND_FIELDS) as PayoutVndWritableField[])
    .some((key) => parsed.values[key] !== config[key]);
  const invalid = Object.keys(parsed.errors).length > 0 || parsed.cross.length > 0;
  const amplifies = !invalid && amplification(config, parsed.values);

  const applySnapshot = (next: PayoutVndConfig) => {
    setConfig(next);
    setDrafts(draftsFrom(next));
    setError("");
  };

  const submit = (forceInverted = false) => {
    openActionConfirm({
      action: forceInverted ? "强制保存越南盾提现参数（价格倒挂）" : "调整越南盾提现参数",
      detail: <>
        <div>所有参数一起保存（版本 v{config.version} → v{config.version + 1}）。</div>
        <div>预览：买入价 {formatVnd(draftRates.buy)} / 卖出价 {formatVnd(draftRates.sell)}。</div>
        <div>只影响之后的报价；用户还没提交的旧报价需要重新报价，已提交的订单金额不变。</div>
        <div>{amplifies ? "这是放宽：平台会多付钱，提交时检查兑付覆盖率。" : "这是收紧，或不影响付款金额。"}</div>
        {forceInverted && <div><b>风险：卖出价不低于买入价，用户可能来回兑换套利。</b></div>}
      </>,
      amplifies,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "提交后立即生效。",
      run: async (reason) => {
        setBusy(true);
        try {
          applySnapshot(await updatePayoutVndConfig(parsed.values, config.version, reason, forceInverted));
          toast("越南盾提现参数已生效");
        } catch (caught) {
          const message = displayAdminError(caught);
          await reload();
          setError(message);
          throw caught;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const startForcedSave = () => {
    openConfirm({
      action: "确认保存倒挂的价格",
      detail: <div>卖出价不低于买入价，系统默认不允许保存。请输入「{FORCE_PHRASE}」后再填写理由。</div>,
      input: { label: `输入“${FORCE_PHRASE}”`, placeholder: FORCE_PHRASE, kind: "text" },
      okLabel: "继续填写理由",
      run: (_reason, value) => {
        if (value?.trim() !== FORCE_PHRASE) throw new Error("输入不一致，未保存。");
        submit(true);
      },
    });
  };

  const fieldRow = (key: PayoutVndWritableField) => {
    const spec = PAYOUT_VND_FIELDS[key];
    return <div className="p-row" key={key}>
      <div className="txt">
        <div className="k">{spec.label}</div>
        <div className="s">可设 {spec.min}–{spec.max} {spec.unit}</div>
        {parsed.errors[key] && <div className="s" style={{ color: "var(--danger)" }}>{parsed.errors[key]}</div>}
      </div>
      <input className="l-inp" aria-label={`${spec.label}目标值`} type="number" min={spec.min} max={spec.max} step={spec.step}
        value={drafts[key]} disabled={!canManage || busy}
        onChange={(event) => setDrafts((current) => current ? { ...current, [key]: event.target.value } : current)} />
      <span>{spec.unit}</span>
    </div>;
  };

  return <>
    {!config.providerReady && <div className="dtint warn" role="status" style={{ marginBottom: 12 }}>
      <b>HDPay 设置不可用</b>：请联系技术人员检查商户设置和服务状态。
    </div>}
    {error && <div className="dtint warn" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="f-stats">
      <div className="f-stat ok"><div className="k">买入价（来自「汇率设置」）</div><div className="v">{formatVnd(liveRates.buy)}</div><div className="sub">基准价 {formatVnd(config.baseRateVndPerUsdt)} · 买入点差 {config.buySpreadPct}%</div></div>
      <div className="f-stat cyan"><div className="k">卖出价</div><div className="v">{formatVnd(liveRates.sell)}</div><div className="sub">卖出点差 {config.sellSpreadPct}%</div></div>
      <div className={`f-stat ${inverted ? "danger" : ""}`}><div className="k">买卖价差（修改后）</div><div className="v">{formatVnd(draftRates.buy - draftRates.sell)}</div><div className="sub">{inverted ? "价格倒挂，默认不能保存" : "买入价 − 卖出价"}</div></div>
      <div className={`f-stat ${config.providerReady ? "ok" : "warn"}`}><div className="k">HDPay 打款设置</div><div className="v">{config.providerReady ? "已配置" : "不可用"}</div><div className="sub">和充值收款共用同一商户</div></div>
    </div>

    <section className="l-card" style={{ marginBottom: 12 }}>
      <div className="l-h"><span className="ttl">相关页面</span><span className="sub">· 版本 v{config.version} · {config.effectiveAt.replace("T", " ").replace("Z", " UTC")}</span><div className="r"><button className="l-btn sm" disabled={busy} onClick={() => void reload()}>刷新</button></div></div>
      <div className="l-b"><div className="chips">
        {authorities.includes("finance_d6_read") && <Link className="chip" href="/finance/fx-rate">汇率设置</Link>}
        {authorities.includes("finance_d2_read") && <Link className="chip" href="/finance/withdrawals">提现审核</Link>}
        {authorities.includes("finance_d5_read") && <Link className="chip" href="/finance/params">USDT 提现参数</Link>}
        {authorities.includes("platform_a2_read") && <Link className="chip" href="/platform/audit">操作记录</Link>}
      </div><div className="s" style={{ marginTop: 8 }}>最近操作者：{config.lastUpdatedBy}</div></div>
    </section>

    <div className="two-col r11">
      <section className="l-card"><div className="l-h"><span className="ttl">卖出报价参数</span><span className="sub">· 基准价和买入点差在「汇率设置」修改</span></div><div className="l-b">
        <div className="p-row"><div className="txt"><div className="k">基准价 / 买入点差</div><div className="s">在「汇率设置」修改</div></div><span>{formatVnd(config.baseRateVndPerUsdt)} / {config.buySpreadPct}%</span></div>
        {FX_FIELDS.map(fieldRow)}
        <div className={`dtint ${inverted ? "warn" : "ok"}`} style={{ marginTop: 10 }}>修改后：买入价 {formatVnd(draftRates.buy)} / 卖出价 {formatVnd(draftRates.sell)}</div>
      </div></section>
      <section className="l-card"><div className="l-h"><span className="ttl">手续费与单笔限额</span><span className="sub">· 和 USDT 提现的网络确认费分开设置</span></div><div className="l-b">
        {FEE_FIELDS.map(fieldRow)}
        {parsed.cross.map((message) => <div className="dtint warn" style={{ marginTop: 8 }} key={message}>{message}</div>)}
        {canManage && <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="l-btn sm mc" disabled={busy || !changed || invalid || inverted} onClick={() => submit(false)}>提交修改</button>
          {canForce && inverted && <button className="l-btn sm" disabled={busy || !changed || invalid} onClick={startForcedSave}>强制保存（价格倒挂）</button>}
          <button className="l-btn sm" disabled={busy} onClick={() => setDrafts(draftsFrom(config.defaults))}>恢复默认值</button>
        </div>}
      </div></section>
    </div>

    <section className="l-card" style={{ marginTop: 12 }}><div className="l-h"><span className="ttl">银行卡提现 · HDPay</span></div><div className="l-b">
      <div>用户绑定银行卡后申请提现，审核通过后由 HDPay 打款，结果自动更新。</div>
    </div></section>
  </>;
}
