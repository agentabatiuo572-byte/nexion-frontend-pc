"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadPayoutVndConfig,
  togglePayoutVndChannel,
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
const FORCE_PHRASE = "确认倒挂风险";

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
  if (values.feeMinUsd > 0 && values.feeMinUsd >= values.minAmountUsd) cross.push("最低收费不得大于等于单笔下限");
  if (values.feeMinUsd > values.feeMaxUsd) cross.push("最低收费不得高于单笔封顶");
  if (values.minAmountUsd > values.maxAmountUsd) cross.push("单笔下限不得高于单笔上限");
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
  const canToggle = authorities.includes("finance_d7_channel_toggle");
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
    return <section className="l-card"><div className="l-b">{error ? <><div className="dtint warn">{error}</div><button className="l-btn primary" style={{ marginTop: 12 }} onClick={() => void reload()}>重试读取</button></> : "D7 服务端参数加载中..."}</div></section>;
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
      action: forceInverted ? "D7 参数变更（倒挂强制）" : "D7 法币提现参数变更",
      detail: <>
        <div>整组配置 v{config.version} → v{config.version + 1}，任何字段失败均不部分生效。</div>
        <div>报价预览：买入 {formatVnd(draftRates.buy)} / 卖出 {formatVnd(draftRates.sell)}。</div>
        <div>{amplifies ? "方向：放大资金流出，服务端会强制校验 B1 覆盖率。" : "方向：收紧或中性。"}</div>
        {forceInverted && <div><b>风险：卖出牌价不低于买入牌价，可能形成循环套利空间。</b></div>}
      </>,
      amplifies,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "服务端 CAS 生效并写入 A2 审计",
      run: async (reason) => {
        setBusy(true);
        try {
          applySnapshot(await updatePayoutVndConfig(parsed.values, config.version, reason, forceInverted));
          toast("D7 参数已由服务端生效并写入审计");
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
      action: "倒挂价差二次确认",
      detail: <div>此操作会突破默认价差保护。输入“{FORCE_PHRASE}”后仍需填写业务理由。</div>,
      input: { label: `输入“${FORCE_PHRASE}”`, placeholder: FORCE_PHRASE, kind: "text" },
      okLabel: "继续填写理由",
      run: (_reason, value) => {
        if (value?.trim() !== FORCE_PHRASE) throw new Error("输入内容不匹配，未进入倒挂风险确认流程。");
        submit(true);
      },
    });
  };

  const toggleChannel = () => {
    const enabled = !config.channelEnabled;
    openActionConfirm({
      action: `D7 法币提现通道${enabled ? "开启" : "关闭"}`,
      detail: <>
        <div>{config.channelEnabled ? "开启" : "关闭"} → <b>{enabled ? "开启" : "关闭"}</b></div>
        <div>{enabled ? "开启要求真实供应商就绪且资金覆盖率健康。" : "关闭是止损动作，不受供应商或覆盖率故障阻断。"}</div>
      </>,
      amplifies: enabled,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "服务端生效并写入 A2 审计",
      run: async (reason) => {
        setBusy(true);
        try {
          applySnapshot(await togglePayoutVndChannel(enabled, config.version, reason));
          toast(`D7 通道已${enabled ? "开启" : "关闭"}`);
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

  const fieldRow = (key: PayoutVndWritableField) => {
    const spec = PAYOUT_VND_FIELDS[key];
    return <div className="p-row" key={key}>
      <div className="txt">
        <div className="k">{spec.label}</div>
        <div className="s">合法范围 {spec.min}–{spec.max} {spec.unit}</div>
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
      <b>{config.providerStatusAvailable ? "真实出款供应商未就绪" : "真实出款供应商状态读取失败"}</b>：参数管理已接入服务端，
      {config.providerStatusAvailable ? "银行卡（越南盾）提现通道仍由后端强制关闭，不能从页面绕过。" : "系统已按未就绪失败关闭；若存量通道仍开启，关闭止损入口保持可用。"}
    </div>}
    {config.channelEnabled && !config.providerReady && <div className="dtint warn" role="alert" style={{ marginBottom: 12 }}>
      供应商状态异常但通道仍显示开启，请立即执行“关闭通道”止损。
    </div>}
    {error && <div className="dtint warn" style={{ marginBottom: 12 }}>{error}</div>}

    <div className="f-stats">
      <div className="f-stat ok"><div className="k">买入牌价（D6 单源）</div><div className="v">{formatVnd(liveRates.buy)}</div><div className="sub">基准价 {formatVnd(config.baseRateVndPerUsdt)} · 买入点差 {config.buySpreadPct}%</div></div>
      <div className="f-stat cyan"><div className="k">卖出牌价（D7 派生）</div><div className="v">{formatVnd(liveRates.sell)}</div><div className="sub">卖出点差 {config.sellSpreadPct}%</div></div>
      <div className={`f-stat ${inverted ? "danger" : ""}`}><div className="k">草稿双向价差</div><div className="v">{formatVnd(draftRates.buy - draftRates.sell)}</div><div className="sub">{inverted ? "倒挂，默认禁止保存" : "买入牌价 − 卖出牌价"}</div></div>
      <div className={`f-stat ${config.channelEnabled ? "warn" : "ok"}`}><div className="k">真实通道</div><div className="v">{config.channelEnabled ? "开启" : "关闭"}</div><div className="sub">供应商：{config.providerReady ? "已就绪" : config.providerStatusAvailable ? "未就绪" : "状态不可用（按未就绪处理）"}</div></div>
    </div>

    <section className="l-card" style={{ marginBottom: 12 }}>
      <div className="l-h"><span className="ttl">单源与审计入口</span><span className="sub">· 服务端 v{config.version} · {config.effectiveAt.replace("T", " ").replace("Z", " UTC")}</span><div className="r"><button className="l-btn sm" disabled={busy} onClick={() => void reload()}>刷新</button></div></div>
      <div className="l-b"><div className="chips">
        {authorities.includes("finance_d6_read") && <Link className="chip" href="/finance/fx-rate">D6 基准价与买入点差</Link>}
        {authorities.includes("finance_d2_read") && <Link className="chip" href="/finance/withdrawals">D2 提现审核</Link>}
        {authorities.includes("finance_d5_read") && <Link className="chip" href="/finance/params">D5 USDT 提现参数</Link>}
        {authorities.includes("platform_a2_read") && <Link className="chip" href="/platform/audit">A2 审计</Link>}
      </div><div className="s" style={{ marginTop: 8 }}>最近操作者：{config.lastUpdatedBy}</div></div>
    </section>

    <div className="two-col r11">
      <section className="l-card"><div className="l-h"><span className="ttl">卖出报价参数</span><span className="sub">· D6 两项只读，D7 三项可调整</span></div><div className="l-b">
        <div className="p-row"><div className="txt"><div className="k">基准价 / 买入点差</div><div className="s">仅由 D6 维护，本页没有第二写入口</div></div><span>{formatVnd(config.baseRateVndPerUsdt)} / {config.buySpreadPct}%</span></div>
        {FX_FIELDS.map(fieldRow)}
        <div className={`dtint ${inverted ? "warn" : "ok"}`} style={{ marginTop: 10 }}>草稿预览：买入 {formatVnd(draftRates.buy)} / 卖出 {formatVnd(draftRates.sell)}</div>
      </div></section>
      <section className="l-card"><div className="l-h"><span className="ttl">手续费与单笔限额</span><span className="sub">· 与 D5 网络确认费分离</span></div><div className="l-b">
        {FEE_FIELDS.map(fieldRow)}
        {parsed.cross.map((message) => <div className="dtint warn" style={{ marginTop: 8 }} key={message}>{message}</div>)}
        {canManage && <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <button className="l-btn sm mc" disabled={busy || !changed || invalid || inverted} onClick={() => submit(false)}>预览并提交整组配置</button>
          {canForce && inverted && <button className="l-btn sm" disabled={busy || !changed || invalid} onClick={startForcedSave}>强制保存倒挂配置</button>}
          <button className="l-btn sm" disabled={busy} onClick={() => setDrafts(draftsFrom(config.defaults))}>恢复默认草稿</button>
        </div>}
      </div></section>
    </div>

    <section className="l-card" style={{ marginTop: 12 }}><div className="l-h"><span className="ttl">通道总开关</span><span className="sub">· 独立高风险权限 · 供应商未就绪时只能保持或切回关闭</span></div><div className="l-b"><div className="p-row">
      <div className="txt"><div className="k">银行卡（越南盾）提现</div><div className="s">关闭后拒绝新单；真实供应商、订单、账本、回调未验收前禁止开启</div></div>
      <span className={`bdg ${config.channelEnabled ? "warn" : "ok"}`}>{config.channelEnabled ? "开启" : "关闭"}</span>
      {canToggle ? <button className="l-btn sm mc" disabled={busy || (!config.channelEnabled && !config.providerReady)} onClick={toggleChannel}>{config.channelEnabled ? "关闭通道" : "开启通道"}</button> : <span className="s">无通道启停权限</span>}
    </div>{!config.providerReady && !config.channelEnabled && <div className="s">开启按钮已禁用：真实出款供应商未就绪。</div>}</div></section>
  </>;
}
