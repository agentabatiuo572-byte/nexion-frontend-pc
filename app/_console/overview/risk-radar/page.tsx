"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import "./risk-radar.css";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { displayAdminError } from "@/lib/admin/error-messages";
import { AlertTriangle, BellRing, Gauge, Landmark, Radar, ShieldAlert, ShieldCheck } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { BDomainDataState } from "@/app/components/dashboard/b-domain-state";
import { useToast } from "@/app/components/domain-views/design-kit";
import {
  acknowledgeB5Inbox,
  fetchB5Inbox,
  fetchB5Subscription,
  previewB5Thresholds,
  recordB5Triage,
  updateB5Subscription,
  updateB5Thresholds,
  updateB5SignalStatus,
  useB5Radar,
  B5OutcomeUnknownError,
  type B5Radar,
  type B5InboxItem,
} from "@/lib/admin/b5-client";
import { formatB5RiskLight, formatB5WithdrawalState } from "@/lib/admin/b5-display-labels";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { B5RestoredInsights } from "@/app/components/dashboard/restored-b-insights";
import { canAccessCrossDomainPath } from "@/lib/admin/cross-domain-authority";

/** B5 阈值 / 订阅 / 分类处理共用一张表,槽位分命名空间(分类处理槽位带维度 = 目标对象)。
 *  阈值与订阅额外把提交值 + 版本当输入指纹:改了值必须换新命令号,否则后端按旧号去重,
 *  新阈值会被静默吞掉。落 sessionStorage,刷新后「结果未知」的重试仍是同一命令号。 */
const b5Commands = createSlotAttemptStore({
  storageKey: "nexion-admin-b5-risk-radar-commands-v1",
});
const THRESHOLD_SLOT = "bankrun-threshold";
const SUBSCRIPTION_SLOT = "alert-subscription";

const TRIAGE = {
  bankrun: "/finance/withdrawals",
  "abnormal-accounts": "/risk/multi-account",
  "withdraw-backlog": "/finance/withdrawals",
  "kill-switches": "/emergency/kill-switch",
  coverage: "/overview/dual-ledger",
} as const;

const GATE_LABELS: Record<string, string> = {
  withdraw: "提现",
  staking: "质押",
  genesis: "创世节点交易",
  exchange: "兑换",
  trial: "试用入口",
};

const deliveryStatusText = (value: string) => ({ PENDING: "待发送", DELIVERED: "已送达", SANDBOX_DELIVERED: "测试送达", NOT_QUEUED: "尚未加入发送队列", PROCESSING: "发送中", FAILED_RETRY: "发送失败，等待重试", DEAD: "发送已终止", SENT: "已发送", FAILED: "发送失败" } as Record<string,string>)[value.toUpperCase()] ?? "发送状态待核实";

function pct(ratio: number | null) {
  return ratio === null ? "暂无法计算" : `${(ratio * 100).toFixed(1)}%`;
}

function money(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function RiskRadarPage() {
  const router = useRouter();
  const radar = useB5Radar();
  const session = useAdminAuth((state) => state.session);
  const operator = useAdminAuth((state) => state.operator || state.session?.operator || state.session?.username || "");
  const authorities = session?.authorities ?? [];
  const role = session?.role ?? "auditor";
  const canThreshold = authorities.includes("overview_b5_threshold_write");
  const canSubscribe = authorities.includes("overview_b5_subscribe");
  const canTriage = authorities.includes("overview_b5_triage");
  const canCross = (path: string) => canAccessCrossDomainPath(path, role, authorities);
  const [toastNode, setToast] = useToast();
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [yellowInput, setYellowInput] = useState("");
  const [redInput, setRedInput] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ light: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [subscription, setSubscription] = useState({ inApp: true, email: false, webhook: false, webhookUrl: "" });
  const [savedSubscription, setSavedSubscription] = useState(subscription);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const [webhookMode, setWebhookMode] = useState("disabled");
  const [updatingSignal, setUpdatingSignal] = useState("");
  const [inbox, setInbox] = useState<B5InboxItem[]>([]);
  const [acknowledgingDelivery, setAcknowledgingDelivery] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchB5Inbox()
      .then((items) => { if (alive) setInbox(items); })
      .catch((cause) => { if (alive) setToast(displayAdminError(cause)); });
    return () => { alive = false; };
  }, [setToast]);

  useEffect(() => {
    if (!canSubscribe) return;
    let alive = true;
    fetchB5Subscription()
      .then((next) => {
        if (!alive) return;
        const normalized = { inApp: next.inApp, email: false, webhook: next.webhook, webhookUrl: next.webhookUrl };
        setSubscription(normalized);
        setSavedSubscription(normalized);
        setSubscriptionVersion(next.version);
        setWebhookMode(next.webhookMode);
      })
      .catch((cause) => {
        if (alive) setToast(displayAdminError(cause));
      });
    return () => {
      alive = false;
    };
  }, [canSubscribe, setToast]);

  const yellowPct = Number(yellowInput);
  const redPct = Number(redInput);
  const thresholdValid = Number.isFinite(yellowPct) && yellowPct >= 5 && yellowPct <= 50
    && Number.isFinite(redPct) && redPct >= 10 && redPct <= 80 && redPct > yellowPct;
  const reasonValid = reason.trim().length >= 8 && reason.trim().length <= 200;

  useEffect(() => {
    if (!thresholdOpen || !radar.data || !thresholdValid) {
      setPreview(null);
      return;
    }
    let alive = true;
    setPreview(null);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      previewB5Thresholds(yellowPct, redPct, radar.data!.bankrun.version)
        .then((value) => {
          if (alive) setPreview({ light: value.light });
        })
        .catch((cause) => {
          if (alive) setPreviewError(displayAdminError(cause));
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [thresholdOpen, thresholdValid, yellowPct, redPct, radar.data]);

  const subscriptionChanged = useMemo(
    () => JSON.stringify(subscription) !== JSON.stringify(savedSubscription),
    [subscription, savedSubscription],
  );
  const subscriptionValid = subscription.inApp || subscription.email || subscription.webhook;

  const changeSignalStatus = async (alert: B5Radar["recentAlerts"][number], targetStatus: "handled" | "resolved") => {
    const reason = window.prompt(`请输入将 ${alert.signalNo} 标记为 ${targetStatus} 的理由（8–200 字）`)?.trim() || "";
    if (reason.length < 8 || reason.length > 200) { setToast("理由必须为 8–200 字"); return; }
    const slot = `signal-status:${alert.signalNo}`;
    const fingerprint = JSON.stringify([alert.signalNo, alert.handlingStatus, alert.handlingVersion, targetStatus, reason]);
    const commandKey = b5Commands.resolve(slot, fingerprint, () => `b5-signal-status-${crypto.randomUUID()}`);
    setUpdatingSignal(alert.signalNo);
    try {
      await updateB5SignalStatus(alert.signalNo, targetStatus, alert.handlingStatus as "open" | "handled", alert.handlingVersion, reason, operator, commandKey);
      b5Commands.forget(slot);
      await radar.reload();
      setToast(`${alert.signalNo} 已标记为${targetStatus}`);
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(slot);
      setToast(displayAdminError(cause));
    } finally { setUpdatingSignal(""); }
  };

  const acknowledgeInbox = async (delivery: B5InboxItem) => {
    const slot = `inbox-ack:${delivery.id}`;
    const commandKey = b5Commands.resolve(slot, String(delivery.id), () => `b5-inbox-ack-${crypto.randomUUID()}`);
    setAcknowledgingDelivery(delivery.id);
    try {
      await acknowledgeB5Inbox(delivery.id, commandKey);
      b5Commands.forget(slot);
      setInbox(await fetchB5Inbox());
      setToast(`${delivery.signalNo} 已确认`);
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(slot);
      setToast(displayAdminError(cause));
    } finally {
      setAcknowledgingDelivery(null);
    }
  };

  if (radar.loading && !radar.data || radar.error || !radar.data) {
    return (
      <div className="dkpage bpage radarpage">
        <BPageHeader
          id="B5"
          title="风险提醒"
          desc="正在加载…"
          ctaLabel="紧急停用开关"
          ctaHref="/emergency/kill-switch"
          ctaAllowed={canCross("/emergency/kill-switch")}
        />
        <BDomainDataState title="风险提醒" loading={radar.loading && !radar.error} error={radar.error} onRetry={radar.reload} />
      </div>
    );
  }

  const data = radar.data;
  // Compatibility aliases keep the pre-existing J1/B5 same-source regression guard explicit.
  const riskRadar = {
    bankRunYellowPct: data.bankrun.yellowPct,
    bankRunRedlinePct: data.bankrun.redPct,
  };
  const bankRunYellowPct = riskRadar.bankRunYellowPct;
  const bankRunRedlinePct = riskRadar.bankRunRedlinePct;
  const canTriageDimension = (dimension: keyof typeof TRIAGE) => {
    if (!canTriage) return false;
    if (!canCross(TRIAGE[dimension])) return false;
    if (role !== "finance") return true;
    return dimension === "bankrun" || dimension === "withdraw-backlog" || dimension === "coverage";
  };
  const triage = async (dimension: keyof typeof TRIAGE) => {
    const triageSlot = `triage|${dimension}`;
    const commandKey = b5Commands.resolve(triageSlot, dimension, () => `b5-triage-${crypto.randomUUID()}`);
    try {
      const target = TRIAGE[dimension];
      await recordB5Triage(dimension, target, operator, commandKey);
      b5Commands.forget(triageSlot);
      router.push(target);
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(triageSlot);
      setToast(cause instanceof Error ? displayAdminError(cause) : "处理失败，请稍后重试");
    }
  };
  const openThreshold = () => {
    setYellowInput(String(data.bankrun.yellowPct));
    setRedInput(String(data.bankrun.redPct));
    setReason("");
    setPreview(null);
    setPreviewError("");
    setThresholdOpen(true);
  };
  const submitThreshold = async () => {
    if (!thresholdValid || !reasonValid || !preview) return;
    setSavingThreshold(true);
    setPreviewError("");
    const commandKey = b5Commands.resolve(
      THRESHOLD_SLOT,
      JSON.stringify([yellowPct, redPct, data.bankrun.version, reason.trim()]),
      () => `b5-threshold-${crypto.randomUUID()}`,
    );
    try {
      const next = await updateB5Thresholds(
        yellowPct, redPct, data.bankrun.version, reason.trim(), operator, commandKey,
      );
      b5Commands.forget(THRESHOLD_SLOT);
      radar.setData(next);
      setThresholdOpen(false);
      setToast("提现压力红线已更新");
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(THRESHOLD_SLOT);
      setPreviewError(displayAdminError(cause));
    } finally {
      setSavingThreshold(false);
    }
  };
  const saveSubscription = async () => {
    if (!subscriptionChanged || !subscriptionValid) return;
    setSavingSubscription(true);
    const commandKey = b5Commands.resolve(
      SUBSCRIPTION_SLOT,
      JSON.stringify([subscription, subscriptionVersion]),
      () => `b5-subscription-${crypto.randomUUID()}`,
    );
    try {
      const saved = await updateB5Subscription(subscription, subscriptionVersion, operator, commandKey);
      b5Commands.forget(SUBSCRIPTION_SLOT);
      const normalized = { inApp: saved.inApp, email: saved.email, webhook: saved.webhook, webhookUrl: saved.webhookUrl };
      setSubscription(normalized);
      setSavedSubscription(normalized);
      setSubscriptionVersion(saved.version);
      setToast("告警订阅已保存");
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(SUBSCRIPTION_SLOT);
      setToast(displayAdminError(cause));
    } finally {
      setSavingSubscription(false);
    }
  };

  return (
    <div className="dkpage bpage radarpage">
      <BPageHeader
        id="B5"
        title="风险提醒"
        desc="提现压力、异常账户、提现积压、业务开关和兑付覆盖率集中查看。这里只看风险，处理请点各卡片进入对应页面。"
        ctaLabel="紧急停用开关"
        ctaHref="/emergency/kill-switch"
        ctaAllowed={canCross("/emergency/kill-switch")}
      />

      <div className="b5-summary">
        <span><Radar size={15} /> 实时汇总</span>
        <span>更新于 {new Date(data.generatedAt).toLocaleString()}</span>
        <span>提现与充值比率红线 {pct(data.bankrun.pressureRedLine)}（只提醒，不自动处理）</span>
      </div>
      {radar.streamWarning && <div className="b5-error" role="status">{radar.streamWarning}</div>}

      <div className="b5-dimensions">
        <section className={`b5-dimension ${data.bankrun.light}`}>
          <div className="b5-card-head">
            <div><Gauge size={18} /><b>提现压力</b></div>
            <span className={`b5-light ${data.bankrun.light}`}>{formatB5RiskLight(data.bankrun.light)}</span>
          </div>
          <div className="b5-bankrun-grid">
            <div>
              <span>24 小时提现 ÷ 可用储备</span>
              <strong>{pct(data.bankrun.ratio24h)}</strong>
              <small>{money(data.bankrun.withdraw24hUsdt)} ÷ {money(data.bankrun.reserveUsdt)}</small>
              {!data.bankrun.ratioCalculable && <small>{data.bankrun.withdraw24hUsdt > 0 ? "可用储备为 0，无法计算，按高风险处理。" : "提现和储备都是 0，暂无法计算。"}</small>}
            </div>
            <div>
              <span>提现与充值比率</span>
              <strong>{pct(data.bankrun.pressureRatio)}</strong>
              <small>{data.bankrun.pressureCalculable ? `红线 ${pct(data.bankrun.pressureRedLine)} · 只提醒` : "近 24 小时没有充值，暂无法计算"}</small>
            </div>
          </div>
          <p>提现压力（24 小时提现 ÷ 可用储备）：黄线 {bankRunYellowPct}% · 红线 {bankRunRedlinePct}%。超过红线会触发最高级告警，并自动暂停提现。</p>
          <div className="b5-actions">
            {canTriageDimension("bankrun") && <button onClick={() => void triage("bankrun")}>去处理提现 →</button>}
            {canThreshold && <button className="secondary" onClick={openThreshold}>调整黄线 / 红线</button>}
          </div>
        </section>

        <section className="b5-dimension">
          <div className="b5-card-head">
            <div><ShieldAlert size={18} /><b>异常账户</b></div>
            <strong>{data.abnormalAccounts.count}</strong>
          </div>
          <div className="b5-list">
            {data.abnormalAccounts.byCategory.map((item) => (
              <div key={item.category}><span>{operatorCopyText(item.label)}</span><b>{item.count}</b></div>
            ))}
          </div>
          <div className="b5-actions">
            {canTriageDimension("abnormal-accounts") && <button onClick={() => void triage("abnormal-accounts")}>去风控处理 →</button>}
          </div>
        </section>

        <section className={`b5-dimension ${data.withdrawBacklog.light}`}>
          <div className="b5-card-head">
            <div><Landmark size={18} /><b>提现积压</b></div>
            <span className={`b5-light ${data.withdrawBacklog.light}`}>须在 {data.withdrawBacklog.slaHours} 小时内处理</span>
          </div>
          <div className="b5-backlog">
            {data.withdrawBacklog.byState.map((item) => (
              <div key={item.state}>
                <span>{formatB5WithdrawalState(item.state)}</span>
                <b>{item.count} 单</b>
                <strong>{money(item.amountUsdt)}</strong>
                <small>已超时 {item.overSlaCount} 单</small>
              </div>
            ))}
          </div>
          <p>合计 {data.withdrawBacklog.totalCount} 单 · {money(data.withdrawBacklog.totalAmountUsdt)} · 已超时 {data.withdrawBacklog.overSlaCount} 单</p>
          <div className="b5-actions">
            {canTriageDimension("withdraw-backlog") && <button onClick={() => void triage("withdraw-backlog")}>去处理提现 →</button>}
          </div>
        </section>

        <section className="b5-dimension">
          <div className="b5-card-head">
            <div><ShieldCheck size={18} /><b>业务开关（5 个）</b></div>
            <span>地区限制见「地区访问限制」</span>
          </div>
          <div className="b5-gates">
            {data.killSwitches.map((gate) => (
              <div key={gate.key}>
                <i className={`b5-dot ${gate.enabled ? "green" : "red"}`} />
                <span>{GATE_LABELS[gate.key]}</span>
                <b>{gate.enabled ? "开放" : "已暂停"}</b>
              </div>
            ))}
          </div>
          <div className="b5-actions">
            {canTriageDimension("kill-switches") && <button onClick={() => void triage("kill-switches")}>去紧急停用开关 →</button>}
          </div>
        </section>

        <section className={`b5-dimension ${data.coverage.light}`}>
          <div className="b5-card-head">
            <div><AlertTriangle size={18} /><b>兑付覆盖率</b></div>
            <span className={`b5-light ${data.coverage.light}`}>{formatB5RiskLight(data.coverage.light)}</span>
          </div>
          <div className="b5-coverage">
            <strong>{data.coverage.ratio === null ? "—" : `${data.coverage.ratio}%`}</strong>
            <span>红线 {data.coverage.redlinePct}%</span>
            <small>储备 {money(data.coverage.reserveUsdt)} · 应付款 {money(data.coverage.liabilitiesUsdt)}</small>
            {data.coverage.ratio === null && <small>目前没有应付款，无需计算覆盖率。</small>}
          </div>
          <div className="b5-actions">
            {canTriageDimension("coverage") && <button onClick={() => void triage("coverage")}>查看资金总览 →</button>}
          </div>
        </section>
      </div>

      {canSubscribe && <section className="b5-subscription">
        <div className="b5-card-head">
          <div><BellRing size={18} /><b>告警订阅配置</b></div>
          <span>与「资金与应付款总览」共用</span>
        </div>
        <div className="b5-channel-row">
          <label><input type="checkbox" name="inApp" checked={subscription.inApp} disabled={!canSubscribe} onChange={(event) => setSubscription((value) => ({ ...value, inApp: event.target.checked }))} />站内</label>
          <label title="邮件服务未设置，暂不能发送"><input type="checkbox" name="email" checked={false} disabled />邮件（暂不可用）</label>
          <label title={webhookMode === "controlled-proxy" ? "通过外部接口发送" : "外部接口未设置，暂不能发送"}><input type="checkbox" name="webhook" checked={subscription.webhook} disabled={!canSubscribe || (webhookMode !== "controlled-proxy" && !subscription.webhook)} onChange={(event) => setSubscription((value) => ({ ...value, webhook: event.target.checked }))} />外部消息通知（{webhookMode === "controlled-proxy" ? "已配置受控代理" : "未配置"}）</label>
          {subscription.webhook && (
            <input
              aria-label="外部通知接收地址"
              value={subscription.webhookUrl}
              disabled={!canSubscribe}
              placeholder="https://..."
              onChange={(event) => setSubscription((value) => ({ ...value, webhookUrl: event.target.value }))}
            />
          )}
          <button disabled={!subscriptionChanged || !subscriptionValid || savingSubscription} onClick={() => void saveSubscription()}>
            {savingSubscription ? "保存中…" : "保存订阅"}
          </button>
        </div>
      </section>}

      <section className="b5-subscription" data-capability="b5-subscriber-inbox">
        <div className="b5-card-head"><div><BellRing size={18} /><b>我的站内告警</b></div><span>只显示发给你的告警</span></div>
        {inbox.map((delivery) => <div className="b5-channel-row" key={delivery.id}>
          <b>{delivery.signalNo}</b><span>{deliveryStatusText(delivery.deliveryStatus)}</span>
          <span>渠道：{({ "durable-inbox": "站内", "controlled-proxy": "外部接口", provider: "外部通知服务", mock: "测试" } as Record<string,string>)[delivery.receiptSource] ?? "未知"} · 送达 {delivery.deliveredAt}</span>
          <span>{delivery.readAt ? `已读 ${delivery.readAt}` : "未读"}</span>
          <span>{delivery.acknowledgedAt ? `已确认 ${delivery.acknowledgedAt}` : "未确认"}</span>
          {canTriage && !delivery.acknowledgedAt && <button disabled={acknowledgingDelivery === delivery.id} onClick={() => void acknowledgeInbox(delivery)}>确认已读</button>}
        </div>)}
        {!inbox.length && <p>当前没有站内告警。</p>}
      </section>

      <section className="b5-subscription" data-capability="b5-signal-disposition">
        <div className="b5-card-head"><div><ShieldAlert size={18} /><b>近期风险信号</b></div><span>发送和处理进度</span></div>
        {data.recentAlerts.map((alert) => <div className="b5-channel-row" key={alert.signalNo}>
          <b>{alert.signalNo}</b><span>{alert.message}</span><span>发送：{deliveryStatusText(alert.deliveryStatus)}</span><span>处理：{({ open: "待处理", handled: "已处理", resolved: "已解决" } as Record<string,string>)[alert.handlingStatus] ?? "状态未知"}</span>
          {canTriage && alert.handlingStatus === "open" && <button disabled={updatingSignal === alert.signalNo} onClick={() => void changeSignalStatus(alert, "handled")}>标记已处理</button>}
          {canTriage && alert.handlingStatus === "handled" && <button disabled={updatingSignal === alert.signalNo} onClick={() => void changeSignalStatus(alert, "resolved")}>标记已解决</button>}
        </div>)}
        {!data.recentAlerts.length && <p>当前没有近期风险信号。</p>}
      </section>

      <B5RestoredInsights data={data} canAccessPath={canCross} />

      <p className="b-foot">
        这页只用来查看风险，处理请到对应页面。提现压力超过红线会自动暂停提现，事后请补记处理结论。
      </p>

      {thresholdOpen && (
        <div className="b5-modal-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setThresholdOpen(false)}>
          <div className="b5-modal" role="dialog" aria-modal="true" aria-labelledby="b5-threshold-title">
            <h2 id="b5-threshold-title">调整提现压力黄线 / 红线</h2>
            <p>提现压力 = 24 小时提现 ÷ 可用储备。超过红线会触发最高级告警并自动暂停提现。当前提现压力 {pct(data.bankrun.ratio24h)}；提现与充值比率 {pct(data.bankrun.pressureRatio)}（{data.bankrun.pressureCalculable ? `红线 ${pct(data.bankrun.pressureRedLine)}，只提醒，不在这里调整` : "近 24 小时没有充值，暂无法计算"}）</p>
            <div className="b5-threshold-fields">
              <label>黄线（5%–50%）<input value={yellowInput} onChange={(event) => setYellowInput(event.target.value)} inputMode="decimal" /></label>
              <label>红线（10%–80%）<input value={redInput} onChange={(event) => setRedInput(event.target.value)} inputMode="decimal" /></label>
            </div>
            {!thresholdValid && <div className="b5-error">红线须高于黄线，且都在允许范围内。</div>}
            <label className="b5-reason">调整理由（8–200 字）<textarea value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label>
            <div className="b5-preview">
                  {preview ? <>按新的黄线 / 红线，当前状态为 <b>{formatB5RiskLight(preview.light)}</b></> : "正在计算…"}
              {redPct > data.bankrun.redPct && <p>注意：调高红线后，自动暂停提现会更晚触发。</p>}
            </div>
            {previewError && <div className="b5-error">{previewError}</div>}
            <div className="b5-modal-actions">
              <button className="secondary" onClick={() => setThresholdOpen(false)}>取消</button>
              <button disabled={!thresholdValid || !reasonValid || !preview || savingThreshold} onClick={() => void submitThreshold()}>
                {savingThreshold ? "提交中…" : "确认调整"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toastNode}
    </div>
  );
}
