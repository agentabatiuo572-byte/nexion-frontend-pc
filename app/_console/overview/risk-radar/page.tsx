"use client";

/**
 * B5 风险提醒。先答「现在哪一项在报警、有多严重、去哪页处理」：一句结论，有事的项展开成卡片排在前面，
 * 正常的收成一行；再看出金压力走势、告警分布，最后是最近风险信号和我的站内告警。
 * 业务写从本标签页保存的原请求恢复；分诊只有审计副作用，沿B4-PD02处理。
 */
import "./risk-radar.css";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BellRing, CheckCheck, FileText, LockOpen, Lock, Power, ShieldQuestion, SlidersHorizontal } from "lucide-react";
import {
  BlockState, Button, Change, Check, CheckGroup, Conclusion, DiffField, Explain, Fact, Facts, Field, Input, Modal, Notice, NumberInput,
  PageHeader, PageTabs, Panel, RdPage, ReleaseModal, StatusTag, Textarea, useTabIds,
} from "@/app/components/rd";
import { displayAdminError, displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { useToast } from "@/app/components/domain-views/design-kit";
import {
  fetchB5Radar,
  fetchB5Inbox,
  fetchB5Subscription,
  previewB5Thresholds,
  recordB5Triage,
  useB5Radar,
  B5OutcomeUnknownError,
  B5RequestError,
  type B5Radar,
  type B5InboxItem,
} from "@/lib/admin/b5-client";
import { formatB5RiskLight } from "@/lib/admin/b5-display-labels";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isBCommandRejection } from "@/lib/admin/b-command-rejection";
import { b5Commands, executeB5Command, inspectB5Command, isB5Original, pendingB5Commands, rememberB5Command, type B5PendingWrite, type B5ThresholdFacts } from "@/lib/admin/b5-commands";
import { pendingThresholdConfigApproval, releaseExpiredB5ThresholdApproval, submitB5ThresholdApproval } from "@/lib/admin/withdrawal-config-approval";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { useReach } from "@/lib/nav/use-reach";
import { fmtConfigPct } from "@/lib/format";
import { buildDimensions, IssueCard, QuietRow, ratioPct, type BuiltDimension, type DimensionKey } from "./dimensions";
import { AlertDistribution, HANDLING, InboxTable, PressureTrend, SEVERITY, SignalDrawer, SignalsTable, TabNote, TARGET_NAME, signalFacts, signalName, stamp } from "./insights";

const THRESHOLD_SLOT = "bankrun-threshold";
const SUBSCRIPTION_SLOT = "alert-subscription";

const TRIAGE = {
  bankrun: "/finance/withdrawals",
  "abnormal-accounts": "/risk/multi-account",
  "withdraw-backlog": "/finance/withdrawals",
  "kill-switches": "/emergency/kill-switch",
  coverage: "/overview/dual-ledger",
  abuse: "/risk/abuse",
  tamper: "/emergency/tamper",
  scoring: "/risk/scoring",
} as const;

const QUEUE_TRIAGE: Record<string, keyof typeof TRIAGE> = {
  "/risk/multi-account": "abnormal-accounts",
  "/finance/withdrawals": "withdraw-backlog",
  "/risk/abuse": "abuse",
  "/emergency/tamper": "tamper",
  "/risk/scoring": "scoring",
};

/** 五项分诊的按钮名：写去哪一页。 */
const TRIAGE_LABEL: Record<DimensionKey, string> = {
  bankrun: "去提现审核",
  "abnormal-accounts": "去多账户风险排查",
  "withdraw-backlog": "去提现审核",
  "kill-switches": "去紧急停用开关",
  coverage: "去资金与应付款总览",
};

const STATUS_TEXT = { handled: "已处理", resolved: "已解决" } as const;

/** 订阅写成人话：开了哪些渠道，外部通知带地址。 */
const subscriptionChannels = (value: { inApp: boolean; webhook: boolean; webhookUrl: string }) =>
  [value.inApp && "站内告警", value.webhook && `外部通知 ${value.webhookUrl}`].filter(Boolean).join("、") || "没有开渠道";
/** 后端没人保存过订阅时接收人是 unassigned。 */
const subscriberText = (value: string) => (value === "unassigned" ? "暂无接收人" : value || "—");

/** 全页时间一种写法：2026-11-13 14:30（北京时间），和资金与应付款总览一致。 */
const timeText = (value: string) => `${formatBusinessTimeCompact(value, "—")}（${businessZone().label}）`;

/**
 * 直接写入（黄线红线、告警订阅、确认已读、信号处理进度）结果未知时的待确认条。
 * 原对象、内容、理由、命令号和首次时间来自b5-commands；恢复入口不依赖主快照成功。
 * 写法照资金与应付款总览：页头下、结论句上，一条一个 Notice，24 小时后只核对不重试。
 */
interface B5PendingCommand {
  commandKey: string;
  title: string;
  body: ReactNode;
  expired: boolean;
  onRetry?: () => void;
  onQuery?: () => void;
}

function PendingCommands({ items, auditReachable }: { items: readonly B5PendingCommand[]; auditReachable: boolean }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => (
        <Notice key={item.commandKey} tone="warn" title={item.title} actionBelow
          action={<span className="b5-row-actions">
            {item.onQuery && <Button size="sm" onClick={item.onQuery}>查询原结果</Button>}
            {!item.expired && item.onRetry && <Button size="sm" onClick={item.onRetry}>按原请求重试</Button>}
            {auditReachable && <Link className="rd-link" href="/platform/audit" prefetch={false}>到「操作记录与审批」核对</Link>}
          </span>}>
          <p>{item.body}</p>
          <p>{item.expired ? "已超过 24 小时，不能重试，只能查询；查到的是现在的值，说明不了原操作成没成。" : "24 小时内只能按原请求重试，不能改值。"}</p>
        </Notice>
      ))}
    </>
  );
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
  const canCross = useReach();
  const [toastNode, setToast] = useToast();
  const [threshold, setThreshold] = useState<B5ThresholdFacts | null>(null);
  const [yellowInput, setYellowInput] = useState("");
  const [redInput, setRedInput] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<{ light: string; key: string } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [thresholdError, setThresholdError] = useState("");
  const [approvalRecovery, setApprovalRecovery] = useState<"lookup" | "retry" | null>(null);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [subscription, setSubscription] = useState({ inApp: true, email: false, webhook: false, webhookUrl: "" });
  const [savedSubscription, setSavedSubscription] = useState(subscription);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [subscriptionReload, setSubscriptionReload] = useState(0);
  const [subscriptionDraftPreserved, setSubscriptionDraftPreserved] = useState(false);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const [webhookMode, setWebhookMode] = useState("disabled");
  const [updatingSignal, setUpdatingSignal] = useState("");
  const [inbox, setInbox] = useState<B5InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState("");
  const [inboxReload, setInboxReload] = useState(0);
  const [acknowledgingDelivery, setAcknowledgingDelivery] = useState<number | null>(null);
  // 以下只管界面：弹窗开关、页签、分诊进行中。
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionSaveError, setSubscriptionSaveError] = useState("");
  const [statusDialog, setStatusDialog] = useState<{ alert: B5Radar["recentAlerts"][number]; target: "handled" | "resolved" } | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [thresholdUnknown, setThresholdUnknown] = useState(false);
  const [subscriptionUnknown, setSubscriptionUnknown] = useState(false);
  const [tab, setTab] = useState<"signals" | "inbox">("signals");
  const [openSignal, setOpenSignal] = useState<string | null>(null);
  const [triaging, setTriaging] = useState<keyof typeof TRIAGE | null>(null);
  const tabIds = useTabIds();
  const [, syncPending] = useState(0);
  const [thresholdOriginal, setThresholdOriginal] = useState<Extract<B5PendingWrite, { kind: "threshold" }> | null>(null);
  const [subscriptionOriginal, setSubscriptionOriginal] = useState<Extract<B5PendingWrite, { kind: "subscription" }> | null>(null);
  const [statusOriginal, setStatusOriginal] = useState<Extract<B5PendingWrite, { kind: "signal" }> | null>(null);
  const [subscriber, setSubscriber] = useState("");
  const [needsFreshRadar, setNeedsFreshRadar] = useState(false);
  const [subscriptionNeedsRead, setSubscriptionNeedsRead] = useState(false);
  const [inboxNeedsRead, setInboxNeedsRead] = useState(false);
  const [approvalVerifiedKey, setApprovalVerifiedKey] = useState<string | null>(null);
  const [releasingApproval, setReleasingApproval] = useState(false);
  const pendingWrites = session ? pendingB5Commands(String(session.adminId)) : [];
  const newWriteBlocked = needsFreshRadar || !!radar.error || !radar.data;
  useEffect(() => {
    if (!radar.loading && !radar.error && radar.data) setNeedsFreshRadar(false);
  }, [radar.loading, radar.error, radar.data]);

  useEffect(() => {
    let alive = true;
    setInboxLoading(true);
    setInboxError("");
    fetchB5Inbox()
      .then((items) => { if (alive) { setInbox(items); setInboxNeedsRead(false); } })
      .catch((cause) => { if (alive) setInboxError(displayAdminReadError(cause)); })
      .finally(() => { if (alive) setInboxLoading(false); });
    return () => { alive = false; };
  }, [inboxReload]);

  useEffect(() => {
    if (!canSubscribe) return;
    let alive = true;
    setSubscriptionLoading(true);
    setSubscriptionError("");
    fetchB5Subscription()
      .then((next) => {
        if (!alive) return;
        const normalized = { inApp: next.inApp, email: false, webhook: next.webhook, webhookUrl: next.webhookUrl };
        if (!subscriptionDraftPreserved && (!session || !pendingB5Commands(String(session.adminId)).some(record => record.fingerprint === SUBSCRIPTION_SLOT))) setSubscription(normalized);
        setSavedSubscription(normalized);
        setSubscriptionVersion(next.version);
        setWebhookMode(next.webhookMode);
        setSubscriber(next.subscriber);
        setSubscriptionNeedsRead(false);
      })
      .catch((cause) => {
        if (alive) setSubscriptionError(displayAdminReadError(cause));
      })
      .finally(() => { if (alive) setSubscriptionLoading(false); });
    return () => {
      alive = false;
    };
  }, [canSubscribe, subscriptionReload, subscriptionDraftPreserved]);

  const yellowPct = Number(yellowInput);
  const redPct = Number(redInput);
  const thresholdValid = Number.isFinite(yellowPct) && yellowPct >= 5 && yellowPct <= 50
    && Number.isFinite(redPct) && redPct >= 10 && redPct <= 80 && redPct > yellowPct;
  const reasonValid = reason.trim().length >= 8 && reason.trim().length <= 200;
  const pendingApproval = session && pendingThresholdConfigApproval("B5", session.adminId);
  const requiresApproval = !thresholdOriginal && (!!pendingApproval || !!threshold && redPct > threshold.redPct);
  const staleThreshold = !thresholdOriginal && !approvalRecovery && !!threshold && radar.data?.bankrun.version !== threshold.version;
  useEffect(() => {
    if (radar.data && !thresholdOriginal && !approvalRecovery && !savingThreshold) {
      setThreshold(current => current && current.version !== radar.data!.bankrun.version ? radar.data!.bankrun : current);
    }
  }, [radar.data, thresholdOriginal, approvalRecovery, savingThreshold]);
  const thresholdVersion = threshold?.version;
  const ratio24h = radar.data?.bankrun.ratio24h;
  const withdraw24hUsdt = radar.data?.bankrun.withdraw24hUsdt;
  const previewKey = thresholdValid && !staleThreshold && thresholdVersion !== undefined
    ? JSON.stringify([yellowPct, redPct, thresholdVersion])
    : "";
  const previewReady = !!preview && preview.key === previewKey && !previewError;
  const lookupOnly = approvalRecovery === "lookup" || !!(pendingApproval && pendingApproval.expiresAt <= Date.now()) || !!(thresholdOriginal && isRetryExpired(thresholdOriginal));
  const thresholdLocked = savingThreshold || !!thresholdOriginal || !!approvalRecovery || lookupOnly;
  const canSubmitThreshold = canThreshold && !!session && !savingThreshold && !lookupOnly && (thresholdOriginal
    ? !isRetryExpired(thresholdOriginal)
    : approvalRecovery === "retry" ? !!pendingApproval?.b5Request
      : !newWriteBlocked && !pendingApproval && !pendingWrites.some(record => record.fingerprint === THRESHOLD_SLOT) && reasonValid && previewReady);

  useEffect(() => {
    if (!session || !pendingApproval || savingThreshold) return;
    let alive = true;
    setApprovalVerifiedKey(null);
    void submitB5ThresholdApproval(session, pendingApproval.values, pendingApproval.reason, fetchB5Radar, "query")
      .then((result) => {
        if (alive && result?.ticket.status === "pending") setApprovalVerifiedKey(pendingApproval.commandKey);
        // 待审批条和读取失败块都在页面上，自动核对不再弹提示。
        if (alive && result?.activeReadFailed) setNeedsFreshRadar(true);
        if (alive && result && result.ticket.status !== "pending") {
          setThreshold(null); setApprovalRecovery(null); setNeedsFreshRadar(true); void radar.reload();
        }
      })
      .catch((cause) => { if (alive) setThresholdError(displayAdminError(cause)); })
      .finally(() => { if (alive) syncPending(value => value + 1); });
    return () => { alive = false; };
  }, [pendingApproval?.commandKey, radar.data?.generatedAt, savingThreshold]);

  useEffect(() => {
    if (!canThreshold || thresholdOriginal || approvalRecovery || !previewKey || thresholdVersion === undefined) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    let alive = true;
    setPreview(null);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      previewB5Thresholds(yellowPct, redPct, thresholdVersion)
        .then((value) => {
          if (alive && value.expectedVersion === thresholdVersion) setPreview({ light: value.light, key: previewKey });
        })
        .catch((cause) => {
          if (alive) setPreviewError(displayAdminError(cause));
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [canThreshold, thresholdOriginal, approvalRecovery, previewKey, thresholdVersion, yellowPct, redPct, ratio24h, withdraw24hUsdt]);

  const subscriptionChannelsChanged = useMemo(
    () => JSON.stringify(subscription) !== JSON.stringify(savedSubscription),
    [subscription, savedSubscription],
  );
  // The authenticated username, not the display operator, is persisted by AdminActorResolver.
  const subscriptionRecipientChanged = !subscriber || subscriber === "unassigned" || subscriber !== maskAuditActor(session?.username ?? "");
  const subscriptionChanged = subscriptionChannelsChanged || subscriptionRecipientChanged;
  const subscriptionValid = subscription.inApp || subscription.email || subscription.webhook;
  const subscriptionWebhookMode = subscriptionOriginal?.facts.webhookMode ?? webhookMode;

  const refreshAfterWrite = async () => {
    setThreshold(null);
    setStatusDialog(null);
    setThresholdOriginal(null);
    setStatusOriginal(null);
    setNeedsFreshRadar(true);
    await radar.reload();
  };

  useEffect(() => {
    if (!statusOriginal && !updatingSignal && radar.data) {
      setStatusDialog(current => {
        const latest = current && radar.data!.recentAlerts.find(alert => alert.signalNo === current.alert.signalNo);
        return current && latest && latest !== current.alert ? { ...current, alert: latest } : current;
      });
    }
  }, [radar.data, statusOriginal, updatingSignal]);

  const changeSignalStatus = async (alert: B5Radar["recentAlerts"][number], targetStatus: "handled" | "resolved", input: string) => {
    const reason = input.trim();
    if (!session || !canTriage || updatingSignal || (!statusOriginal && newWriteBlocked)) return;
    if (reason.length < 8 || reason.length > 200) { setStatusError("理由要写 8–200 个字"); return; }
    let original = statusOriginal;
    setUpdatingSignal(alert.signalNo);
    setStatusError("");
    try {
      if (original && !b5Commands.get(original.fingerprint)) return;
      original ??= rememberB5Command(String(session.adminId), `signal-status:${alert.signalNo}`, "b5-signal-status", {
        kind: "signal", method: "PATCH", path: `/api/admin/risk/radar/signals/${encodeURIComponent(alert.signalNo)}/status`,
        body: JSON.stringify({ targetStatus, expectedStatus: alert.handlingStatus, expectedVersion: alert.handlingVersion, reason, operator }), facts: alert,
      }) as Extract<B5PendingWrite, { kind: "signal" }>;
      setStatusOriginal(original);
      await executeB5Command(original, !!statusOriginal);
      await refreshAfterWrite();
      setStatusUnknown(false);
      setToast(`已标记为${STATUS_TEXT[targetStatus]}：${original.facts.message}`);
    } catch (cause) {
      // 框还开着、红框里已写这句时不再弹；框已关或结果未知才弹。
      let shownInDialog = false;
      if (!statusOriginal && isBCommandRejection(cause, false)) {
        setStatusOriginal(null); setStatusUnknown(false); setNeedsFreshRadar(true);
        await radar.reload();
        shownInDialog = true;
      }
      else if (isExplicitRejection(cause)) { await refreshAfterWrite(); setStatusUnknown(false); }
      else setStatusUnknown(!!original);
      setStatusError(displayAdminError(cause));
      if (!shownInDialog) setToast(displayAdminError(cause));
    } finally { setUpdatingSignal(""); syncPending(value => value + 1); }
  };

  const acknowledgeInbox = async (delivery: Pick<B5InboxItem, "id" | "signalNo">, recovered?: Extract<B5PendingWrite, { kind: "ack" }>) => {
    if (!session || !canTriage || acknowledgingDelivery !== null || (!recovered && (inboxLoading || inboxNeedsRead || !!inboxError))) return;
    if (!recovered && !pendingWrites.some(record => record.fingerprint === `inbox-ack:${delivery.id}`)
      && !inbox.some(item => item.id === delivery.id && item.deliveryStatus === "DELIVERED" && item.deliveredAt !== null && !item.acknowledgedAt)) return;
    setAcknowledgingDelivery(delivery.id);
    try {
      const saved = pendingWrites.find(record => record.fingerprint === `inbox-ack:${delivery.id}`);
      const original = recovered ?? (saved && isB5Original(saved) && saved.kind === "ack" ? saved : undefined)
        ?? rememberB5Command(String(session.adminId), `inbox-ack:${delivery.id}`, "b5-inbox-ack", {
          kind: "ack", method: "POST", path: `/api/admin/risk/radar/inbox/${delivery.id}/acknowledge`, body: "", facts: { id: delivery.id, signalNo: delivery.signalNo },
        });
      await executeB5Command(original, !!recovered || !!saved);
      setInboxNeedsRead(true);
      setInboxReload((value) => value + 1);
      setToast(`已确认：${delivery.signalNo}`);
    } catch (cause) {
      setInboxNeedsRead(true); setInboxReload((value) => value + 1);
      setToast(displayAdminError(cause));
    } finally { setAcknowledgingDelivery(null); syncPending(value => value + 1); }
  };

  const canJ1 = canCross("/emergency/kill-switch");
  const header = (meta?: ReactNode, actions?: ReactNode, readOnly?: ReactNode) => (
    <PageHeader pageId="B5" title="风险提醒" summary="看五项风险有没有报警，报警的去哪页处理。" meta={meta} actions={actions} readOnly={readOnly} />
  );
  // 页头直达紧急停用开关：只是导航，不记分诊（B5-L02）。
  const killSwitchLink = canJ1
    ? <Link className="rd-btn" data-variant="secondary" data-size="md" href="/emergency/kill-switch" prefetch={false}><span className="rd-btn-face"><Power size={14} aria-hidden />紧急停用开关</span></Link>
    : null;

  const data = radar.data!;
  const canTriageDimension = (dimension: keyof typeof TRIAGE) => {
    if (!canTriage) return false;
    if (!canCross(TRIAGE[dimension])) return false;
    if (role !== "finance") return true;
    return dimension === "bankrun" || dimension === "withdraw-backlog" || dimension === "coverage";
  };
  const triage = async (dimension: keyof typeof TRIAGE) => {
    if (triaging || !canTriageDimension(dimension)) return;
    const commandKey = `b5-triage-${crypto.randomUUID()}`;
    setTriaging(dimension);
    try {
      const target = TRIAGE[dimension];
      await recordB5Triage(dimension, target, operator, commandKey);
      router.push(target);
    } catch (cause) {
      // 还没升级的后端不认 K2、J3、K4 这三个分诊目标（回 B5_TRIAGE_TARGET_INVALID）：这三类链接在那里照旧只是导航，不能因此点不动。
      if (cause instanceof B5RequestError && cause.backendMessage === "B5_TRIAGE_TARGET_INVALID" && (dimension === "abuse" || dimension === "tamper" || dimension === "scoring")) {
        router.push(TRIAGE[dimension]);
        return;
      }
      // 分诊只留一条审计，失败了如实说没成功、重新点一次即可（决定 B4-PD02）；没有权限时再点也一样，不叫人再点。
      const forbidden = cause instanceof B5RequestError && cause.status === 403;
      // 后端统一拒绝页只回「无权限访问」四个字，没有句号、也不说怎么办；换成全站的无权限说明，接在后面读得通。
      const reason = forbidden && cause.backendMessage === "无权限访问" ? formatAdminApiError("ADMIN_PERMISSION_DENIED", "ADMIN_PERMISSION_DENIED")
        : cause instanceof B5OutcomeUnknownError ? "" : cause instanceof Error ? displayAdminReadError(cause) : "";
      // 结果未知时记录可能已经记上了，不说「没记上」。
      setToast(`${forbidden ? "没有跳转：分诊记录没记上。" : cause instanceof B5OutcomeUnknownError ? "没有跳转：分诊记录结果未知，请再点一次。" : "没有跳转：分诊记录没记上，请再点一次。"}${reason}`);
    } finally {
      setTriaging(null);
    }
  };
  const openThreshold = () => {
    if (pendingApproval) {
      setYellowInput(String(pendingApproval.values.yellowPct));
      setRedInput(String(pendingApproval.values.redPct));
      setReason(pendingApproval.reason);
      setThreshold(pendingApproval.b5Facts ?? null);
      setApprovalRecovery("lookup");
      if (!pendingApproval.b5Facts) void queryApproval();
    } else {
      const saved = pendingWrites.find(record => record.fingerprint === THRESHOLD_SLOT);
      if (saved) { recoverWrite(saved); return; }
      if (!canThreshold || newWriteBlocked || !data) return;
      setYellowInput(String(data.bankrun.yellowPct));
      setRedInput(String(data.bankrun.redPct));
      setReason("");
      setApprovalRecovery(null);
      setThresholdOriginal(null);
      setThresholdUnknown(false);
      setThreshold(data.bankrun);
    }
    setPreview(null); setPreviewError(""); setThresholdError("");
  };
  const queryApproval = async () => {
    if (!session || !pendingApproval) return;
    try {
      const result = await submitB5ThresholdApproval(session, pendingApproval.values, pendingApproval.reason, fetchB5Radar, "query");
      setApprovalVerifiedKey(result?.ticket.status === "pending" ? pendingApproval.commandKey : null);
      setToast(result?.acknowledgement ?? "暂未查到原审批单，可稍后再查，或按原配置和理由重试。");
      if (result) { setThreshold(null); setNeedsFreshRadar(true); await radar.reload(); }
      else setApprovalRecovery("retry");
    } catch (cause) { setThresholdError(displayAdminError(cause)); setToast(displayAdminError(cause)); }
    finally { syncPending(value => value + 1); }
  };
  const submitThreshold = async (recover = false) => {
    if (recover) { await queryApproval(); return; }
    if (!session || !threshold || !canSubmitThreshold) return;
    setSavingThreshold(true); setThresholdError("");
    let original = thresholdOriginal;
    const facts = !original && !pendingApproval && data ? { ...threshold, ratio24h: data.bankrun.ratio24h, light: data.bankrun.light } : threshold;
    try {
      if (requiresApproval) {
        const result = await submitB5ThresholdApproval(session, pendingApproval?.values ?? { expectedVersion: threshold.version, yellowPct, redPct },
          pendingApproval?.reason ?? reason.trim(), fetchB5Radar, pendingApproval ? "retry" : "new", facts);
        if (!result) return;
        setApprovalVerifiedKey(result.ticket.status === "pending" ? pendingThresholdConfigApproval("B5", session.adminId)?.commandKey ?? null : null);
        setToast(result.acknowledgement);
      } else {
        original ??= rememberB5Command(String(session.adminId), THRESHOLD_SLOT, "b5-threshold", {
          kind: "threshold", method: "PUT", path: "/api/admin/risk/bankrun-thresholds", facts,
          body: JSON.stringify({ yellowPct, redPct, expectedVersion: threshold.version, reason: reason.trim(), operator }),
        }) as Extract<B5PendingWrite, { kind: "threshold" }>;
        setThresholdOriginal(original);
        await executeB5Command(original, !!thresholdOriginal);
        setToast("提现压力的黄线和红线已更新");
      }
      setApprovalRecovery(null); setThresholdUnknown(false);
      await refreshAfterWrite();
    } catch (cause) {
      let rereadAfterConflict = false;
      const rejected = isBCommandRejection(cause, !!thresholdOriginal || !!pendingApproval);
      if (rejected) {
        if (thresholdOriginal || pendingApproval) await refreshAfterWrite();
        else {
          setThresholdOriginal(null); setApprovalRecovery(null); setPreview(null);
          setNeedsFreshRadar(true);
          const fresh = await radar.reload();
          if (fresh) setThreshold(fresh.bankrun);
          rereadAfterConflict = !!fresh && cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "B5_THRESHOLD_VERSION_CONFLICT";
        }
      } else if (requiresApproval && pendingThresholdConfigApproval("B5", session.adminId)) setApprovalRecovery("lookup");
      setThresholdUnknown(!!original && !rejected);
      // 版本冲突已重读：框里写一句就够，不再弹同一句。
      if (rereadAfterConflict) setThresholdError("当前阈值已更新，请核对后再保存。");
      else {
        setThresholdError(displayAdminError(cause));
        // 框还开着、红框里已写这句时不再弹；框已关或结果未知（框里写的是另一句）才弹。
        if (!rejected || thresholdOriginal || pendingApproval) setToast(displayAdminError(cause));
      }
    } finally { setSavingThreshold(false); syncPending(value => value + 1); }
  };
  const saveSubscription = async () => {
    if (!session || !canSubscribe || savingSubscription || (!subscriptionOriginal
      && (subscriptionLoading || subscriptionNeedsRead || !!subscriptionError || !subscriptionChanged || !subscriptionValid))) return;
    setSavingSubscription(true); setSubscriptionSaveError("");
    let original = subscriptionOriginal;
    try {
      original ??= rememberB5Command(String(session.adminId), SUBSCRIPTION_SLOT, "b5-subscription", {
        kind: "subscription", method: "PUT", path: "/api/admin/risk/alert-subscription",
        body: JSON.stringify({ ...subscription, expectedVersion: subscriptionVersion, operator }),
        facts: { ...savedSubscription, version: subscriptionVersion, subscriber, emailMode: "disabled", webhookMode, sharedWith: "B1" },
      }) as Extract<B5PendingWrite, { kind: "subscription" }>;
      setSubscriptionOriginal(original);
      await executeB5Command(original, !!subscriptionOriginal);
      setSubscriptionOriginal(null); setSubscriptionUnknown(false); setSubscriptionOpen(false); setSubscriptionDraftPreserved(false);
      setSubscriptionNeedsRead(true); setSubscriptionReload(value => value + 1);
      setToast("告警订阅已保存，之后的新告警发给你");
    } catch (cause) {
      const rejected = isBCommandRejection(cause, !!subscriptionOriginal);
      if (rejected) {
        setSubscriptionOriginal(null);
        if (subscriptionOriginal) {
          setSubscriptionOpen(false);
          setSubscriptionDraftPreserved(false);
          setSubscriptionNeedsRead(true); setSubscriptionReload(value => value + 1);
        } else if (cause instanceof B5RequestError && cause.backendMessage === "B5_SUBSCRIPTION_VERSION_CONFLICT") {
          setSubscriptionDraftPreserved(true);
          setSubscriptionNeedsRead(true); setSubscriptionReload(value => value + 1);
        }
      }
      setSubscriptionUnknown(!!original && !rejected);
      setSubscriptionSaveError(displayAdminError(cause));
      // 框还开着、红框里已写这句时不再弹（版本冲突由框里「别人刚保存过订阅」说明）；框已关或结果未知才弹。
      if (!rejected || subscriptionOriginal) setToast(displayAdminError(cause));
    } finally { setSavingSubscription(false); syncPending(value => value + 1); }
  };
  const recoverWrite = (record: ReturnType<typeof pendingB5Commands>[number]) => {
    if (!isB5Original(record)) { setToast("原审批内容不完整，请到操作记录核对。"); return; }
    const input = record.body ? JSON.parse(record.body) : null;
    if (record.kind === "threshold") {
      setThresholdOriginal(record); setThreshold(record.facts); setYellowInput(String(input.yellowPct)); setRedInput(String(input.redPct));
      setReason(input.reason); setThresholdUnknown(true); setApprovalRecovery(null); setThresholdError("");
    } else if (record.kind === "subscription") {
      setSubscriptionOriginal(record); setSubscription({ inApp: input.inApp, email: input.email, webhook: input.webhook, webhookUrl: input.webhookUrl });
      setSubscriptionUnknown(true); setSubscriptionOpen(true); setSubscriptionSaveError("");
    } else if (record.kind === "signal") {
      setStatusOriginal(record); setStatusDialog({ alert: record.facts, target: input.targetStatus }); setStatusReason(input.reason); setStatusUnknown(true); setStatusError("");
    } else void acknowledgeInbox(record.facts, record);
  };
  const queryWrite = async (record: ReturnType<typeof pendingB5Commands>[number]) => {
    if (!isB5Original(record)) { setToast("原审批内容不完整，请到操作记录核对。"); return; }
    try {
      const current = await inspectB5Command(record);
      if (current.kind === "radar") { radar.setData(current.data); setNeedsFreshRadar(false); }
      else if (current.kind === "ack") { setInbox(current.data); setInboxError(""); setInboxLoading(false); setInboxNeedsRead(false); }
      else {
        setSavedSubscription({ inApp: current.data.inApp, email: current.data.email, webhook: current.data.webhook, webhookUrl: current.data.webhookUrl });
        setSubscriber(current.data.subscriber); setSubscriptionVersion(current.data.version); setWebhookMode(current.data.webhookMode);
        setSubscriptionError(""); setSubscriptionLoading(false); setSubscriptionNeedsRead(false);
      }
      setToast(isRetryExpired(record) ? "已查到现在的值，但说明不了原操作成没成，待确认记录继续保留。" : "已查到现在的值，但说明不了原操作成没成。可以按原请求重试，不会重复执行。");
    }
    catch (cause) { setToast(displayAdminError(cause)); }
  };
  const pendingItems: B5PendingCommand[] = pendingWrites.map(record => {
    const original = isB5Original(record) ? record : null;
    const input = original?.body ? JSON.parse(original.body) : null;
    const body = original?.kind === "threshold" ? `黄线 ${fmtConfigPct(original.facts.yellowPct)} → ${fmtConfigPct(input.yellowPct)} · 红线 ${fmtConfigPct(original.facts.redPct)} → ${fmtConfigPct(input.redPct)}`
      : original?.kind === "signal" ? `信号 ${original.facts.signalNo} · ${HANDLING[original.facts.handlingStatus].text} → ${STATUS_TEXT[input.targetStatus as "handled" | "resolved"]}`
        : original?.kind === "ack" ? `信号 ${original.facts.signalNo}` : original?.kind === "subscription" ? subscriptionChannels(JSON.parse(original.body)) : "原记录不完整，到「操作记录与审批」核对";
    const name = original?.kind === "threshold" ? "调整黄线和红线" : original?.kind === "signal" ? `标记${STATUS_TEXT[input.targetStatus as "handled" | "resolved"]}` : original?.kind === "ack" ? "确认站内告警已读" : original?.kind === "subscription" ? "保存告警订阅" : "原操作";
    return { commandKey: record.commandKey, title: `${name} · 结果未知`, body: `${body} · ${timeText(new Date(record.createdAt).toISOString())}提交`,
      expired: isRetryExpired(record), onRetry: () => recoverWrite(record), onQuery: () => void queryWrite(record) };
  });

  // ---------- 五项 ----------
  const { issues, quiet } = data ? buildDimensions(data) : { issues: [], quiet: [] };
  const triageButton = (key: DimensionKey, variant: "primary" | "secondary" | "ghost", size: "md" | "sm") => canTriageDimension(key)
    ? <Button key="triage" variant={variant} size={size} loading={triaging === key} loadingText="正在记录…" icon={<ArrowUpRight size={14} aria-hidden />}
      disabledReason={triaging && triaging !== key ? "正在记录另一条分诊，记完再点" : undefined}
      onClick={() => void triage(key)}>{TRIAGE_LABEL[key]}</Button>
    : null;
  const thresholdButton = (size: "md" | "sm") => canThreshold
    ? <Button key="threshold" variant="ghost" size={size} icon={<SlidersHorizontal size={14} aria-hidden />} onClick={openThreshold}>调整黄线 / 红线</Button>
    : null;
  const approvalPending = pendingApproval?.commandKey === approvalVerifiedKey && pendingApproval?.b5Ticket?.status === "pending" ? { redPct: pendingApproval.values.redPct, ticketId: pendingApproval.b5Ticket.id } : null;
  // 过期、并且过期后按原请求查询明确没有这张单，才可以解除（决定 R1-提案过期；判断在 releaseExpiredB5ThresholdApproval 里再核一次）。
  const approvalReleasable = !!pendingApproval && pendingApproval.expiresAt <= Date.now() && !!pendingApproval.b5NotFound && !pendingApproval.received && !pendingApproval.b5Ticket;
  const releaseApproval = async () => {
    if (!session || !pendingApproval) return;
    try {
      const released = await releaseExpiredB5ThresholdApproval(session.adminId, pendingApproval.commandKey);
      setReleasingApproval(false);
      if (!released) { setToast("这条记录现在不能解除，请先查询原结果。"); return; }
      setThreshold(null); setApprovalRecovery(null); setNeedsFreshRadar(true); void radar.reload();
      setToast("已解除本页的待确认记录");
    } catch (error) { setToast(displayAdminError(error)); }
    finally { syncPending(value => value + 1); }
  };
  const approvalTag = approvalPending
    ? <StatusTag tone="warn" explain={`审批单 ${approvalPending.ticketId}。另一位超级管理员批准前，红线不变。`}>红线提高到 {fmtConfigPct(approvalPending.redPct)} 待审批</StatusTag>
    : null;
  const actionsFor = (item: BuiltDimension, issue: boolean) => {
    // 一屏只留一个主按钮：排第一的那张卡（结论句说「先看」的那项），其余卡用次按钮。
    const list = [triageButton(item.key, issue ? (item.key === issues[0]?.key ? "primary" : "secondary") : "ghost", issue ? "md" : "sm"), item.key === "bankrun" ? thresholdButton(issue ? "md" : "sm") : null].filter(Boolean);
    return list.length ? <>{list}</> : null;
  };

  // ---------- 结论 ----------
  const first = issues[0];
  const others = issues.slice(1);
  const unacked = inboxError || inboxLoading || inboxNeedsRead ? null : inbox.filter((item) => !item.acknowledgedAt).length;
  const inboxHint = unacked ? `你有 ${unacked} 条站内告警没确认。` : "";
  const unknownItems = quiet.filter((item) => item.level === "neutral");
  const conclusionExplain = "每一项的颜色都按系统现有的线判断：提现压力看黄线、红线，覆盖率看红线、健康线，积压看有没有超过 48 小时，业务开关看有没有关停，异常账户看有没有。";
  const conclusion = !first ? (unknownItems.length ? (
    <Conclusion state="neutral" icon={ShieldQuestion} hint={`没有要马上处理的。${inboxHint}`} explainTitle="五项怎么判断" explain={conclusionExplain}>
      风险提醒：没有报警，{unknownItems.map((item) => item.name).join("、")}无法计算
    </Conclusion>
  ) : (
    <Conclusion state="ok" hint={`没有要马上处理的。${inboxHint}`} explainTitle="五项怎么判断" explain={conclusionExplain}>
      风险提醒：五项都正常
    </Conclusion>
  )) : first.level === "danger" ? (
    <Conclusion state="danger" lead hint={<>{others.length ? `另有 ${others.length} 项要注意：${others.map((item) => item.name).join("、")}。` : "在下面卡片里点按钮去处理。"}{inboxHint}</>}>
      风险告警：{first.headline}
    </Conclusion>
  ) : issues.length === 1 ? (
    <Conclusion state="warn" hint={`在下面卡片里点按钮去处理。${inboxHint}`}>风险提醒：{first.headline}</Conclusion>
  ) : (
    <Conclusion state="warn" hint={`先看${first.name}。${inboxHint}`}>风险提醒：<b>{issues.length}</b> 项要注意，{issues.map((item) => item.name).join("、")}</Conclusion>
  );

  const meta = data && (
    <span className="b5-meta">
      数据时间 {timeText(data.generatedAt)}
      <Explain label="数据多久更新" content="打开页面时读一次，之后每 30 秒自动重读；站内告警和告警订阅不跟着自动重读。" />
      {radar.streamWarning && <span className="b5-muted"> · 实时连接正在重连，先显示最近一次数据</span>}
    </span>
  );
  const headerActions = (killSwitchLink || canSubscribe) ? (
    <>
      {canSubscribe && <Button icon={<BellRing size={14} aria-hidden />} onClick={() => { const saved = pendingWrites.find(record => record.fingerprint === SUBSCRIPTION_SLOT); if (saved) { recoverWrite(saved); return; } setSubscriptionOriginal(null); setSubscriptionSaveError(""); setSubscriptionOpen(true); }}>告警订阅</Button>}
      {killSwitchLink}
    </>
  ) : undefined;
  const readOnly = !canThreshold && !canSubscribe && !canTriage ? "你只能查看；分诊、调整黄线红线和告警订阅需要对应权限。" : undefined;
  const openCount = (data?.recentAlerts ?? []).filter((alert) => alert.handlingStatus === "open").length;
  const queueTriage = (target: string) => { const dimension = QUEUE_TRIAGE[target]; if (!dimension || !canTriageDimension(dimension)) return false; void triage(dimension); return true; };
  const triageState = (target: string) => { const dimension = QUEUE_TRIAGE[target]; if (!triaging || !dimension || !canTriageDimension(dimension)) return undefined; return triaging === dimension ? "active" as const : "blocked" as const; };
  const openSignalStatus = (alert: B5Radar["recentAlerts"][number], target: "handled" | "resolved") => { const saved = pendingWrites.find(record => record.fingerprint === `signal-status:${alert.signalNo}`); if (saved) { recoverWrite(saved); return; } if (newWriteBlocked) return; setStatusOriginal(null); setStatusReason(""); setStatusError(""); setStatusUnknown(false); setStatusDialog({ alert, target }); };
  const signalList = data?.recentAlerts ?? [];
  const signalIndex = signalList.findIndex((alert) => alert.signalNo === openSignal);

  return (
    <RdPage className="radarpage">
        {header(meta, !data || radar.error ? killSwitchLink : headerActions, !data || radar.error ? undefined : readOnly)}
        <PendingCommands items={pendingItems} auditReachable={canCross("/platform/audit")} />
        {pendingApproval && (
          <Notice tone="warn" title={`提高红线的审批 · ${approvalPending ? "待审批" : "结果未知"}`} actionBelow
            action={<span className="b5-row-actions">
              <Button size="sm" onClick={openThreshold}>查询原结果</Button>
              {approvalReleasable && <Button size="sm" onClick={() => setReleasingApproval(true)}>解除待确认</Button>}
            </span>}>
            <p>黄线 {fmtConfigPct(pendingApproval.values.yellowPct)} · 红线 {fmtConfigPct(pendingApproval.values.redPct)} · {timeText(new Date(pendingApproval.createdAt).toISOString())}提交</p>
            <p>{approvalPending ? "等另一位超级管理员在「操作记录与审批」批准，批准前红线不变。"
              : approvalReleasable ? "已超过 24 小时，查询结果是没有这张审批单，可以解除待确认。"
                : pendingApproval.expiresAt <= Date.now() ? "已超过 24 小时，不能重试，只能查询原审批单。"
                  : "先查原审批单；查不到时 24 小时内可以按原请求重试，不会建第二张单。"}</p>
          </Notice>
        )}
        {!data || radar.error ? <>
          <Conclusion state="unknown" icon={ShieldQuestion} hint={radar.loading && !radar.error ? undefined : "数据读到之前不判断有没有风险。"}>
            {radar.loading && !radar.error ? "风险提醒：正在读取" : "风险提醒：读取失败，暂时无法判断"}
          </Conclusion>
          <BlockState state={radar.loading && !radar.error ? "loading" : "error"} title={radar.loading && !radar.error ? "正在读取五项风险…" : "风险数据读取失败"} detail={radar.error ?? undefined} onRetry={radar.loading && !radar.error ? undefined : radar.reload} retrying={radar.loading} />
        </> : <>
        {conclusion}

        {issues.length > 0 && (
          <div className="rd-split b5-issues" data-even="">
            {issues.map((item) => <IssueCard key={item.key} item={item} actions={actionsFor(item, true)} extra={item.key === "bankrun" ? approvalTag : undefined} />)}
          </div>
        )}
        {quiet.length > 0 && (
          <Panel title={issues.length ? "其余各项" : "五项风险"} sub={`${quiet.length} 项没有报警`} explain="点「去…」会先记一条分诊记录（谁、什么时候、从哪一项进去），再打开对应页面；不改任何业务数据。" className="b5-quiet">
            <ul className="b5-quiet-list">
              {quiet.map((item) => <QuietRow key={item.key} item={item} actions={actionsFor(item, false)} extra={item.key === "bankrun" ? approvalTag : undefined} />)}
            </ul>
          </Panel>
        )}

        <div className="rd-split" data-even="">
          <PressureTrend data={data} />
          <AlertDistribution data={data} />
        </div>

        <section className="b5-lists" aria-label="风险信号和站内告警">
          <PageTabs label="风险信号和站内告警" ids={tabIds} value={tab} onChange={setTab} items={[
            { value: "signals", label: "最近风险信号", count: openCount },
            { value: "inbox", label: "我的站内告警", count: inboxError || inboxLoading || inboxNeedsRead ? "—" : unacked ?? 0 },
          ]} />
          <div {...tabIds.panel(tab)} className="rd-tab-pane">
            {tab === "signals" ? (
              <Panel flush data-testid="b5-recent-alert-feed" data-capability="b5-signal-disposition">
                <TabNote label="最近风险信号的范围" explain="近 7 个业务日按时间倒序的最新 20 条，不分页；不代表这段时间只有这些。">
                  近 7 个业务日最新 {data.recentAlerts.length} 条 · {openCount} 条待处理 · 北京时间
                </TabNote>
                <SignalsTable alerts={data.recentAlerts} canTriage={canTriage} updating={updatingSignal} reach={canCross}
                  selected={openSignal} onOpen={(alert) => setOpenSignal(alert.signalNo)} onTriage={queueTriage} triageState={triageState} onStatus={openSignalStatus} />
              </Panel>
            ) : (
              <Panel flush data-capability="b5-subscriber-inbox">
                <TabNote label="站内告警的范围" explain="只列发给你的站内告警，最多 100 条，不分页。确认已读只记录你看过，不改信号的处理进度。">
                  {inboxLoading ? "正在读取…" : inboxError ? "读取失败" : `发给你的 ${inbox.length} 条 · ${unacked ?? 0} 条没确认`}
                </TabNote>
                <InboxTable state={inboxError ? "error" : inboxLoading || inboxNeedsRead ? "loading" : "ready"} items={inbox} error={inboxError}
                  onRetry={() => setInboxReload((value) => value + 1)} canTriage={canTriage} acknowledging={acknowledgingDelivery}
                  onAcknowledge={(item) => void acknowledgeInbox(item)} />
              </Panel>
            )}
          </div>
        </section>
        <SignalDrawer alert={tab === "signals" && signalIndex >= 0 ? signalList[signalIndex] : null} canTriage={canTriage} updating={updatingSignal} reach={canCross}
          nav={{ hasPrev: signalIndex > 0, hasNext: signalIndex >= 0 && signalIndex < signalList.length - 1,
            onPrev: () => setOpenSignal(signalList[signalIndex - 1]?.signalNo ?? null), onNext: () => setOpenSignal(signalList[signalIndex + 1]?.signalNo ?? null) }}
          onClose={() => setOpenSignal(null)} onTriage={queueTriage} triageState={triageState} onStatus={openSignalStatus} />

        </>}

      {threshold && (() => {
        const pressure = thresholdOriginal || approvalRecovery ? threshold : data?.bankrun ?? threshold;
        const raising = redPct > threshold.redPct;
        const redDirection = !Number.isFinite(redPct) || redPct === threshold.redPct ? null : raising
          ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="done" icon={Lock}>收紧</StatusTag>;
        const yellowDirection = !Number.isFinite(yellowPct) || yellowPct === threshold.yellowPct ? null : yellowPct > threshold.yellowPct
          ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="done" icon={Lock}>收紧</StatusTag>;
        const orderError = thresholdValid ? undefined : "黄线 5%–50%，红线 10%–80%，红线要高于黄线";
        const recovering = !!thresholdOriginal || !!approvalRecovery;
        const submitLabel = recovering ? "按原请求重试" : requiresApproval ? "提交审批" : "确认调整";
        const blocked = !canThreshold ? formatAdminApiError("ADMIN_PERMISSION_DENIED", "ADMIN_PERMISSION_DENIED") : staleThreshold ? "阈值刚被改过，关掉重新打开再调整"
          : !thresholdValid ? "先把黄线、红线填在范围内"
            : !reasonValid && approvalRecovery !== "retry" ? "理由要写 8–200 个字"
              : !previewReady && approvalRecovery !== "retry" ? (previewError ? "预览失败，暂不能提交" : "正在按新的线计算，请稍等")
                : undefined;
        return (
          <Modal title="调整提现压力的黄线和红线" icon={SlidersHorizontal} busy={savingThreshold} dirty
            sub={requiresApproval
              ? <StatusTag tone="warn" icon={LockOpen} explain="提高红线要另一位超级管理员批准，自己不能批。批准前线被别人改过的，这张单会被拒。">批准后生效</StatusTag>
              : <StatusTag tone="progress" filled>立即生效</StatusTag>}
            onClose={() => setThreshold(null)}
            footer={<>
              <Button disabled={savingThreshold} onClick={() => setThreshold(null)}>取消</Button>
              {approvalRecovery && approvalReleasable && <Button disabled={savingThreshold} onClick={() => { setThreshold(null); setReleasingApproval(true); }}>解除待确认</Button>}
              {approvalRecovery && <Button variant={lookupOnly ? "primary" : "secondary"} loading={savingThreshold && lookupOnly} loadingText="查询中…" disabledReason={undefined} onClick={() => void submitThreshold(true)}>查询原结果</Button>}
              {!lookupOnly && <Button variant="primary" loading={savingThreshold} loadingText="提交中…" disabledReason={canSubmitThreshold ? undefined : blocked ?? "暂不能提交"} onClick={() => void submitThreshold()}>{submitLabel}</Button>}
            </>}>
            <div className="b5-dialog">
              {staleThreshold && <Notice tone="warn">阈值刚被别人改过，这次不能按旧值提交。关掉后重新打开再调整。</Notice>}
              {previewError && <Notice tone="danger" title="预览失败">{previewError}</Notice>}
              {thresholdError && <Notice tone={approvalRecovery || thresholdUnknown ? "warn" : "danger"} title={approvalRecovery ? "审批单结果未知" : thresholdUnknown ? "结果未知，可能已经生效" : "没有调整成功"}>{approvalRecovery
                ? approvalReleasable ? "已超过 24 小时，查询结果是没有这张审批单，可以解除待确认。" : "可能已经建了审批单。先点「查询原结果」；查不到时 24 小时内可以按原请求重试，不会建第二张单。"
                : thresholdUnknown ? "可能已经生效。可以按原请求重试，不会重复执行；也可以关掉后点「查询原结果」。" : thresholdError}</Notice>}
              {approvalRecovery === "lookup" && !thresholdError && <Notice tone="warn" title="审批单结果未知">{approvalReleasable ? "已超过 24 小时，查询结果是没有这张审批单，可以解除待确认。" : "先点「查询原结果」查原审批单；查到了就不用再提交。"}</Notice>}
              <DiffField size="body" before={fmtConfigPct(threshold.yellowPct)} beforeLabel={recovering ? "提交时" : undefined} label="黄线改成" hint="5%–50%" state={yellowDirection}
                note={yellowDirection ? "黄线只决定什么时候标「注意」，不会自动暂停提现。" : undefined}>
                {(control) => <NumberInput {...control} aria-label="黄线（5%–50%）" unit="%" min={5} max={50} value={yellowInput} disabled={thresholdLocked} onChange={(event) => setYellowInput(event.target.value)} />}
              </DiffField>
              <DiffField before={fmtConfigPct(threshold.redPct)} beforeLabel={recovering ? "提交时" : undefined} label="红线改成" explain="紧急停用开关页把这条线叫挤兑红线，是同一条线。" hint="10%–80%，要高于黄线" state={redDirection} error={yellowInput && redInput ? orderError : undefined}
                note={redDirection ? (raising ? "红线调高，自动暂停提现会更晚触发。" : "红线调低，自动暂停提现会更早触发，立即生效。") : undefined}>
                {(control) => <NumberInput {...control} aria-label="红线（10%–80%）" unit="%" min={10} max={80} value={redInput} disabled={thresholdLocked} onChange={(event) => setRedInput(event.target.value)} />}
              </DiffField>
              <p className="b5-preview" role="status">
                {recovering ? "提交时" : "现在"}的提现压力 {pressure.ratio24h === null ? "暂无法计算" : ratioPct(pressure.ratio24h)}，标「{formatB5RiskLight(pressure.light)}」{recovering ? "。" : "；"}
                {recovering ? null : previewReady ? <>按新的线会标 <StatusTag tone={preview!.light === "red" ? "danger" : preview!.light === "yellow" ? "warn" : preview!.light === "green" ? "ok" : "neutral"}>{formatB5RiskLight(preview!.light)}</StatusTag></>
                  : previewKey && !previewError ? "正在按新的线计算…" : "填好两条线后显示按新的线会标什么。"}
              </p>
              <Notice tone="neutral">
                <p>和「紧急停用开关」共用，那边也跟着变。</p>
                <p>是否自动暂停提现，由那边按自己的统计判断。</p>
              </Notice>
              {requiresApproval && (
                <Notice tone="warn" title="提高红线要审批">
                  <Facts>
                    <Fact k="谁来批">另一位超级管理员，自己不能批</Fact>
                    <Fact k="批准人需有">审批批准权限</Fact>
                    <Fact k={recovering ? "提交时的红线" : "批准前的红线"}>{fmtConfigPct(threshold.redPct)}{recovering ? "；批没批以查询原结果为准" : ""}</Fact>
                  </Facts>
                </Notice>
              )}
              <Field label="调整理由" required error={reason && !reasonValid && !thresholdLocked ? "理由要写 8–200 个字" : undefined}>
                <Textarea value={reason} disabled={thresholdLocked} maxLength={200} rows={3} placeholder="8–200 字，例如：工单号、调整依据" count={`${reason.trim().length} / 200`} onChange={(event) => setReason(event.target.value)} />
              </Field>
            </div>
          </Modal>
        );
      })()}

      {subscriptionOpen && (canSubscribe || subscriptionOriginal) && (() => {
        // 恢复原请求时，上面是冻结的原内容（重试只发它），现在的订阅读不到放在后面，不挡原内容。
        const subscriptionReadState = (
          <BlockState state={subscriptionLoading ? "loading" : "error"} title={subscriptionLoading ? "正在读取现在的订阅…" : subscriptionOriginal ? "现在的订阅没读到，不影响按原请求重试" : "现在的订阅没读到"} detail={subscriptionError || undefined}
            onRetry={subscriptionLoading ? undefined : () => setSubscriptionReload((value) => value + 1)} retryLabel="重新读取" />
        );
        const subscriptionConflict = subscriptionDraftPreserved && !subscriptionOriginal && !subscriptionLoading && !subscriptionError;
        return (
        <Modal title="告警订阅" icon={BellRing} busy={savingSubscription} dirty={subscriptionChannelsChanged}
          sub={<StatusTag tone="progress" filled>立即生效</StatusTag>}
          onClose={() => setSubscriptionOpen(false)}
          footer={<>
            <Button disabled={savingSubscription} onClick={() => setSubscriptionOpen(false)}>取消</Button>
            <Button variant="primary" loading={savingSubscription} loadingText="保存中…"
              disabledReason={!canSubscribe ? formatAdminApiError("ADMIN_PERMISSION_DENIED", "ADMIN_PERMISSION_DENIED") : subscriptionOriginal ? isRetryExpired(subscriptionOriginal) ? "已超过 24 小时，只能核对，不能重试。" : undefined : subscriptionNeedsRead || subscriptionLoading ? "正在读取现在的订阅" : subscriptionError ? "现在的订阅没读到，不能保存" : !subscriptionChanged ? "还没有改动" : !subscriptionValid ? "至少开一个渠道" : undefined}
              onClick={() => void saveSubscription()}>{subscriptionOriginal ? "按原请求重试" : "保存订阅"}</Button>
          </>}>
          <div className="b5-dialog">
            {!subscriptionOriginal && (subscriptionLoading || subscriptionError) && subscriptionReadState}
            {(subscriptionOriginal || (!subscriptionLoading && !subscriptionError)) && (
              <>
                {subscriptionOriginal && subscriptionUnknown && (
                  <Notice tone="warn" title="结果未知，可能已经生效">
                    下面是提交时的内容，已锁定。按原请求重试只发这一份，不会重复执行；也可以关掉后点「查询原结果」。
                  </Notice>
                )}
                {subscriptionConflict && (() => {
                  const diffs = ([
                    ["站内告警", savedSubscription.inApp ? "开" : "关", subscription.inApp ? "开" : "关"],
                    ["外部通知", savedSubscription.webhook ? "开" : "关", subscription.webhook ? "开" : "关"],
                    ["外部通知地址", savedSubscription.webhookUrl || "—", subscription.webhookUrl || "—"],
                  ] as const).filter(([, latest, draft]) => latest !== draft);
                  return (
                    <Notice tone="warn" title="别人刚保存过订阅">
                      <p>{subscriptionRecipientChanged ? "已读到最新的订阅。再保存，接收人会换成你。" : subscriptionChanged ? "已读到最新的订阅，你的改动还在。核对差别后再保存。" : "已读到最新的订阅，和你的改动一样，不用再保存。"}</p>
                      {diffs.length > 0 && <Facts>
                        {diffs.map(([k, latest, draft]) => <Fact key={k} k={k}><Change from={`最新 ${latest}`} to={`你的 ${draft}`} /></Fact>)}
                      </Facts>}
                    </Notice>
                  );
                })()}
                <Facts>
                  <Fact k={subscriptionOriginal ? "提交时的接收人" : "现在的接收人"}>{session?.username && (subscriptionOriginal?.facts.subscriber ?? subscriber) === maskAuditActor(session.username) ? "你" : subscriberText(subscriptionOriginal?.facts.subscriber ?? subscriber)}</Fact>
                  <Fact k="保存后的接收人">你</Fact>
                </Facts>
                <Notice tone="warn">
                  全平台只有一份，和「资金与应付款总览」共用。保存后新告警只发给你，排队中的外部通知也按新地址发。
                </Notice>
                <CheckGroup legend="发送渠道" summary={subscriptionValid ? undefined : "至少开一个"}>
                  <Check name="inApp" label="站内告警" checked={subscription.inApp} disabled={!canSubscribe || !!subscriptionOriginal || savingSubscription} onChange={(event) => setSubscription((value) => ({ ...value, inApp: event.target.checked }))} />
                  <Check name="email" label="邮件" checked={false} disabled help="邮件服务没接通，暂不可用。" />
                  <Check name="webhook" label="外部通知" checked={subscription.webhook}
                    disabled={!canSubscribe || !!subscriptionOriginal || savingSubscription || (subscriptionWebhookMode !== "controlled-proxy" && !subscription.webhook)}
                    help={subscriptionWebhookMode === "controlled-proxy" ? "发送通道已配好，可以开启。" : subscription.webhook ? "发送通道还没配好，只能关闭。" : "发送通道还没配好，暂不能开启。"}
                    onChange={(event) => setSubscription((value) => ({ ...value, webhook: event.target.checked }))} />
                </CheckGroup>
                {subscription.webhook && (
                  <Field label="外部通知接收地址" hint="https 开头，最多 500 字" help="保存时系统检查地址是否在允许名单内、是不是公网地址；保存时不试发。">
                    <Input aria-label="外部通知接收地址" value={subscription.webhookUrl} disabled={!canSubscribe || !!subscriptionOriginal || savingSubscription} placeholder="https://..."
                      onChange={(event) => setSubscription((value) => ({ ...value, webhookUrl: event.target.value }))} />
                  </Field>
                )}
                {subscriptionSaveError && !subscriptionUnknown && !(subscriptionConflict && subscriptionSaveError === formatAdminApiError("B5_SUBSCRIPTION_VERSION_CONFLICT", "B5_SUBSCRIPTION_VERSION_CONFLICT")) && <Notice tone={subscriptionUnknown ? "warn" : "danger"} title={subscriptionUnknown ? "结果未知，可能已经生效" : "没有保存成功"}>{subscriptionSaveError}</Notice>}
              </>
            )}
            {subscriptionOriginal && (subscriptionLoading || subscriptionError) && subscriptionReadState}
          </div>
        </Modal>
        );
      })()}

      {statusDialog && (() => {
        const { alert, target } = statusDialog;
        const valid = statusReason.trim().length >= 8 && statusReason.trim().length <= 200;
        const busy = updatingSignal === alert.signalNo;
        return (
          <Modal title={target === "handled" ? "标记已处理" : "标记已解决"} icon={CheckCheck} busy={busy} dirty
            sub={<StatusTag tone="neutral" icon={FileText} explain="只更新这条信号的处理进度并留操作记录。不会解冻账户、不会放行提现、不会重发告警，也不改站内告警的已读。">只记录进度</StatusTag>}
            onClose={() => setStatusDialog(null)}
            footer={<>
              <Button disabled={busy} onClick={() => setStatusDialog(null)}>取消</Button>
              <Button variant="primary" loading={busy} loadingText="提交中…" disabledReason={!canTriage ? "你只能查看；分诊、调整黄线红线和告警订阅需要对应权限。" : statusOriginal && isRetryExpired(statusOriginal) ? "已超过 24 小时，只能核对，不能重试。" : valid ? undefined : "理由要写 8–200 个字"}
                onClick={() => void changeSignalStatus(alert, target, statusReason)}>{statusUnknown ? "按原请求重试" : target === "handled" ? "确认标记已处理" : "确认标记已解决"}</Button>
            </>}>
            <div className="b5-dialog">
              <Facts>
                <Fact k="风险信号">{signalName(alert)}</Fact>
                {signalFacts(alert).line && <Fact k="具体情况">{signalFacts(alert).line}</Fact>}
                <Fact k="级别">{SEVERITY[alert.level].text}</Fact>
                <Fact k="用户 · 信号号"><>{alert.userNo ?? `#${alert.userId}`} · <span data-mono>{alert.signalNo}</span></></Fact>
                <Fact k="发生时间">{stamp(alert.createdAt)}</Fact>
                <Fact k="处理进度"><Change from={HANDLING[alert.handlingStatus].text} to={STATUS_TEXT[target]} /></Fact>
              </Facts>
              <p className="b5-line">标成「{STATUS_TEXT[target]}」只记录进度，不会解除风控，也不会放行提现。真正的处置到「{TARGET_NAME[alert.target] ?? "对应页面"}」办。</p>
              <Field label="处理理由" required error={statusReason && !valid ? "理由要写 8–200 个字" : undefined}>
                <Textarea value={statusReason} disabled={busy || statusUnknown} maxLength={200} rows={3} placeholder="8–200 字，例如：已核实、工单号" count={`${statusReason.trim().length} / 200`} onChange={(event) => setStatusReason(event.target.value)} />
              </Field>
              {statusError && <Notice tone={statusUnknown ? "warn" : "danger"} title={statusUnknown ? "结果未知，可能已经生效" : "没有标记成功"}>
                {statusUnknown ? "理由已锁住，只能按原请求重试；也可以关掉后点「查询原结果」，看这条的处理进度变了没有。" : statusError}
              </Notice>}
            </div>
          </Modal>
        );
      })()}
      {releasingApproval && pendingApproval && (
        <ReleaseModal onCancel={() => setReleasingApproval(false)} onConfirm={releaseApproval}
          label={`提高红线的审批 · 黄线 ${fmtConfigPct(pendingApproval.values.yellowPct)} · 红线 ${fmtConfigPct(pendingApproval.values.redPct)} · ${timeText(new Date(pendingApproval.createdAt).toISOString())}提交`}
          explain="原申请已超过 24 小时，查不到这张审批单，说明没有建成，之后也不会再建成。解除后可以重新调整黄线和红线。" />
      )}
      {toastNode}
    </RdPage>
  );
}
