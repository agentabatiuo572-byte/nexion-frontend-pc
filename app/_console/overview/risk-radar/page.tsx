"use client";

import "./risk-radar.css";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, Gauge, Landmark, Radar, ShieldAlert, ShieldCheck } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { BDomainDataState } from "@/app/components/dashboard/b-domain-state";
import { useToast } from "@/app/components/domain-views/design-kit";
import {
  fetchB5Subscription,
  previewB5Thresholds,
  recordB5Triage,
  updateB5Subscription,
  updateB5Thresholds,
  useB5Radar,
  B5OutcomeUnknownError,
} from "@/lib/admin/b5-client";
import { formatB5RiskLight, formatB5WithdrawalState } from "@/lib/admin/b5-display-labels";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";

/** B5 阈值 / 订阅 / 分诊共用一张表,槽位分命名空间(分诊槽位带维度 = 目标对象)。
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
  genesis: "Genesis",
  exchange: "兑换",
  trial: "试用入口",
};

function pct(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
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
  const [toastNode, setToast] = useToast();
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [yellowInput, setYellowInput] = useState("");
  const [redInput, setRedInput] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ light: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [subscription, setSubscription] = useState({ inApp: true, email: true, webhook: false, webhookUrl: "" });
  const [savedSubscription, setSavedSubscription] = useState(subscription);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);

  useEffect(() => {
    if (!canSubscribe) return;
    let alive = true;
    fetchB5Subscription()
      .then((next) => {
        if (!alive) return;
        const normalized = { inApp: next.inApp, email: next.email, webhook: next.webhook, webhookUrl: next.webhookUrl };
        setSubscription(normalized);
        setSavedSubscription(normalized);
        setSubscriptionVersion(next.version);
      })
      .catch((cause) => {
        if (alive) setToast(cause instanceof Error ? cause.message : "B5_SUBSCRIPTION_FAILED");
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
          if (alive) setPreviewError(cause instanceof Error ? cause.message : "B5_PREVIEW_FAILED");
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

  if (radar.loading && !radar.data || radar.error || !radar.data) {
    return (
      <div className="dkpage bpage radarpage">
        <BPageHeader
          id="B5"
          title="风险雷达"
          desc="五维风险态势只读聚合；数据异常时停止展示旧值。"
          ctaLabel="Kill-Switch 矩阵"
          ctaHref="/emergency/kill-switch"
        />
        <BDomainDataState title="B5 风险雷达" loading={radar.loading && !radar.error} error={radar.error} onRetry={radar.reload} />
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
      setToast(cause instanceof Error ? cause.message : "分诊失败");
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
      setToast("挤兑阈值已更新 · 已记 A2 审计");
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(THRESHOLD_SLOT);
      setPreviewError(cause instanceof Error ? cause.message : "B5_THRESHOLD_FAILED");
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
      setToast("告警订阅已保存 · 已记 A2 审计");
    } catch (cause) {
      if (!(cause instanceof B5OutcomeUnknownError)) b5Commands.forget(SUBSCRIPTION_SLOT);
      setToast(cause instanceof Error ? cause.message : "B5_SUBSCRIPTION_FAILED");
    } finally {
      setSavingSubscription(false);
    }
  };

  return (
    <div className="dkpage bpage radarpage">
      <BPageHeader
        id="B5"
        title="风险雷达"
        desc="挤兑、异常账户、提现积压、五个功能闸与兑付覆盖率同屏；这里只读研判，处置必须进入权威域。"
        ctaLabel="Kill-Switch 矩阵"
        ctaHref="/emergency/kill-switch"
      />

      <div className="b5-summary">
        <span><Radar size={15} /> 服务端权威聚合</span>
        <span>更新于 {new Date(data.generatedAt).toLocaleString()}</span>
        <span>e(t) 固定红线 0.7（70%）</span>
      </div>
      {radar.streamWarning && <div className="b5-error" role="status">{radar.streamWarning}</div>}

      <div className="b5-dimensions">
        <section className={`b5-dimension ${data.bankrun.light}`}>
          <div className="b5-card-head">
            <div><Gauge size={18} /><b>挤兑预警</b></div>
            <span className={`b5-light ${data.bankrun.light}`}>{formatB5RiskLight(data.bankrun.light)}</span>
          </div>
          <div className="b5-bankrun-grid">
            <div>
              <span>24h 提现 ÷ 真实储备</span>
              <strong>{pct(data.bankrun.ratio24h)}</strong>
              <small>{money(data.bankrun.withdraw24hUsdt)} ÷ {money(data.bankrun.reserveUsdt)}</small>
            </div>
            <div>
              <span>出金压力比 e(t)</span>
              <strong>{pct(data.bankrun.pressureRatio)}</strong>
              <small>固定红线 {pct(data.bankrun.pressureRedLine)} · 仅人工警戒</small>
            </div>
          </div>
          <p>黄线 {bankRunYellowPct}% · 红线 {bankRunRedlinePct}%（J1 R1 已同步引用）</p>
          <div className="b5-actions">
            {canTriageDimension("bankrun") && <button onClick={() => void triage("bankrun")}>处置 → D2 提现队列</button>}
            {canThreshold && <button className="secondary" onClick={openThreshold}>阈值配置</button>}
          </div>
        </section>

        <section className="b5-dimension">
          <div className="b5-card-head">
            <div><ShieldAlert size={18} /><b>异常账户</b></div>
            <strong>{data.abnormalAccounts.count}</strong>
          </div>
          <div className="b5-list">
            {data.abnormalAccounts.byCategory.map((item) => (
              <div key={item.category}><span>{item.label}</span><b>{item.count}</b></div>
            ))}
          </div>
          <div className="b5-actions">
            {canTriageDimension("abnormal-accounts") && <button onClick={() => void triage("abnormal-accounts")}>处置 → K 风控</button>}
          </div>
        </section>

        <section className={`b5-dimension ${data.withdrawBacklog.light}`}>
          <div className="b5-card-head">
            <div><Landmark size={18} /><b>提现队列积压</b></div>
            <span className={`b5-light ${data.withdrawBacklog.light}`}>SLA {data.withdrawBacklog.slaHours}h</span>
          </div>
          <div className="b5-backlog">
            {data.withdrawBacklog.byState.map((item) => (
              <div key={item.state}>
                <span>{formatB5WithdrawalState(item.state)}</span>
                <b>{item.count} 单</b>
                <strong>{money(item.amountUsdt)}</strong>
                <small>超 SLA {item.overSlaCount} 单</small>
              </div>
            ))}
          </div>
          <p>合计 {data.withdrawBacklog.totalCount} 单 · {money(data.withdrawBacklog.totalAmountUsdt)} · 超 SLA {data.withdrawBacklog.overSlaCount} 单</p>
          <div className="b5-actions">
            {canTriageDimension("withdraw-backlog") && <button onClick={() => void triage("withdraw-backlog")}>处置 → D2 提现队列</button>}
          </div>
        </section>

        <section className="b5-dimension">
          <div className="b5-card-head">
            <div><ShieldCheck size={18} /><b>功能闸（5 个）</b></div>
            <span>geo-block 归 J2</span>
          </div>
          <div className="b5-gates">
            {data.killSwitches.map((gate) => (
              <div key={gate.key}>
                <i className={`b5-dot ${gate.enabled ? "green" : "red"}`} />
                <span>{GATE_LABELS[gate.key]}</span>
                <b>{gate.enabled ? "开放" : "已熔断"}</b>
              </div>
            ))}
          </div>
          <div className="b5-actions">
            {canTriageDimension("kill-switches") && <button onClick={() => void triage("kill-switches")}>处置 → J1 功能闸</button>}
          </div>
        </section>

        <section className={`b5-dimension ${data.coverage.light}`}>
          <div className="b5-card-head">
            <div><AlertTriangle size={18} /><b>兑付覆盖率</b></div>
            <span className={`b5-light ${data.coverage.light}`}>{formatB5RiskLight(data.coverage.light)}</span>
          </div>
          <div className="b5-coverage">
            <strong>{data.coverage.ratio}%</strong>
            <span>红线 {data.coverage.redlinePct}%</span>
            <small>储备 {money(data.coverage.reserveUsdt)} · 负债 {money(data.coverage.liabilitiesUsdt)}</small>
          </div>
          <div className="b5-actions">
            {canTriageDimension("coverage") && <button onClick={() => void triage("coverage")}>核验 → B1 双账本</button>}
          </div>
        </section>
      </div>

      {canSubscribe && <section className="b5-subscription">
        <div className="b5-card-head">
          <div><BellRing size={18} /><b>告警订阅配置</b></div>
          <span>与 B1 共用 · 保存后刷新仍保留</span>
        </div>
        <div className="b5-channel-row">
          <label><input type="checkbox" name="inApp" checked={subscription.inApp} disabled={!canSubscribe} onChange={(event) => setSubscription((value) => ({ ...value, inApp: event.target.checked }))} />站内</label>
          <label><input type="checkbox" name="email" checked={subscription.email} disabled={!canSubscribe} onChange={(event) => setSubscription((value) => ({ ...value, email: event.target.checked }))} />邮件</label>
          <label><input type="checkbox" name="webhook" checked={subscription.webhook} disabled={!canSubscribe} onChange={(event) => setSubscription((value) => ({ ...value, webhook: event.target.checked }))} />Webhook</label>
          {subscription.webhook && (
            <input
              aria-label="Webhook URL"
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

      <p className="b-foot">
        B5 不直接处置任何风险；五维数据分别引用 B1/D2/K/J1 单一权威源。P0 告警表示挤兑比率达到当前动态红线；
        R1 自动关停后须补录处置结论。接口失败、空值或结构异常时页面清空旧值并停止展示。
      </p>

      {thresholdOpen && (
        <div className="b5-modal-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setThresholdOpen(false)}>
          <div className="b5-modal" role="dialog" aria-modal="true" aria-labelledby="b5-threshold-title">
            <h2 id="b5-threshold-title">B5-MD1 · 挤兑阈值配置</h2>
            <p>当前挤兑比率 {pct(data.bankrun.ratio24h)} · e(t) {pct(data.bankrun.pressureRatio)}（固定红线 70%，不可修改）</p>
            <div className="b5-threshold-fields">
              <label>黄线（5%–50%）<input value={yellowInput} onChange={(event) => setYellowInput(event.target.value)} inputMode="decimal" /></label>
              <label>红线（10%–80%）<input value={redInput} onChange={(event) => setRedInput(event.target.value)} inputMode="decimal" /></label>
            </div>
            {!thresholdValid && <div className="b5-error">红线必须严格高于黄线，且两者均在允许范围内。</div>}
            <label className="b5-reason">调整理由（8–200 字）<textarea value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></label>
            <div className="b5-preview">
                  {preview ? <>服务端影响预览：新阈值下灯色为 <b>{formatB5RiskLight(preview.light)}</b></> : "服务端影响预览加载中…"}
              {redPct > data.bankrun.redPct && <p>警示：上调红线将同步推迟 J1 R1 提现闸自动熔断触发点。</p>}
            </div>
            {previewError && <div className="b5-error">{previewError}</div>}
            <div className="b5-modal-actions">
              <button className="secondary" onClick={() => setThresholdOpen(false)}>取消</button>
              <button disabled={!thresholdValid || !reasonValid || !preview || savingThreshold} onClick={() => void submitThreshold()}>
                {savingThreshold ? "提交中…" : "确认调整阈值"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toastNode}
    </div>
  );
}
