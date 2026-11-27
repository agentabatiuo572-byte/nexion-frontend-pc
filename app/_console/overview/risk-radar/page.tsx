"use client";
import { nextRecoveryDeadline, rebaseRecoveryFields, sendRecoveredDraft } from "@/lib/admin/abe-recovery-access";

/**
 * B5 风险提醒。先答「现在哪一项在报警、有多严重、去哪页处理」：一句结论，有事的项展开成卡片排在前面，
 * 正常的收成一行；再看出金压力走势、告警分布，最后是最近风险信号和我的站内告警。
 * 业务写从本标签页保存的原请求恢复；分诊只有审计副作用，沿B4-PD02处理。
 */
import "./risk-radar.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, BellRing, Eye, FileText, LockOpen, Lock, Power, RefreshCw, ShieldCheck, ShieldQuestion, SlidersHorizontal } from "lucide-react";
import {
  BlockState, Button, Change, Check, CheckGroup, Conclusion, ConflictBar, DiffField, Explain, Fact, Facts, Field, Input, Modal, Notice, NumberInput,
  PageHeader, PageTabs, Panel, RdPage, ReleaseModal, StatusTag, Textarea, useTabIds,
} from "@/app/components/rd";
import { displayAdminError, displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { useRecoveryDraftDiscard } from "@/app/components/domain-views/recovery-draft-discard";
import { useToast, usePendingReplayDeadline } from "@/app/components/domain-views/design-kit";
import {
  fetchB5Radar,
  fetchB5Signal,
  fetchB5Signals,
  fetchB5Inbox,
  fetchB5Subscription,
  previewB5Thresholds,
  recordB5Triage,
  useB5Radar,
  B5OutcomeUnknownError,
  B5RequestError,
  type B5InboxItem,
} from "@/lib/admin/b5-client";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import type { B5Signal } from "@/lib/admin/b5-radar-contract";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { EXPIRED_PROPOSAL_NOT_FOUND_LINE, recoveryNext } from "@/lib/admin/recovery-next";
import { useReasonRule } from "@/lib/admin/use-reason-rule";
import { useB5Read } from "@/lib/admin/use-b5-read";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { SIGNAL_CATEGORIES, SIGNAL_LIST_ANCHOR, isSignalCategory } from "@/lib/admin/risk-feed";
import { formatB5RiskLight } from "@/lib/admin/b5-display-labels";
import { RETRY_REJECTED_NEXT, RETRY_REJECTED_STATUS } from "@/lib/admin/retry-rejected";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isBCommandRejection } from "@/lib/admin/b-command-rejection";
import { b5Commands, b5Recovery, executeB5Command, inspectB5Command, isB5Original, pendingB5Commands, rememberB5Command, type B5PendingWrite, type B5ThresholdFacts } from "@/lib/admin/b5-commands";
import { bThresholdRecovery, canReleaseExpiredB5Approval, discardThresholdRecoveryDraft, pendingThresholdConfigApproval, releaseB5ThresholdApproval, submitB5ThresholdApproval, thresholdRecoveryDrafts } from "@/lib/admin/withdrawal-config-approval";
import { businessClock, businessZone, formatBusinessTimeCompact, parseBusinessTime } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { useReach } from "@/lib/nav/use-reach";
import { fmtConfigPct } from "@/lib/format";
import { buildDimensions, IssueCard, QuietRow, ratioPct, type BuiltDimension, type DimensionKey } from "./dimensions";
import { AlertDistribution, CATEGORY_TARGETS, HANDLING, InboxTable, PressureTrend, RefText, SEVERITY, STALE_MARK_REASON, SignalDrawer, TARGET_NAME, TabNote, handlingHint, levelTone, signalFacts, signalName, isTamper, signalTreatmentLink, stamp, triageTarget } from "./insights";
import { RiskCategoryPanel, StaleNotice, riskCategoryRows, type RiskCategoriesState, type RiskCategoryRow } from "./categories";
import { SignalList, type SignalListFilters, type SignalListPage, type SignalListState } from "./signal-list";
import { readSignalQuery, replaceSignalQuery, signalRequestQuery, signalReturnTo, SIGNAL_PAGE_SIZES } from "./signal-query";

const THRESHOLD_SLOT = "bankrun-threshold";
const SUBSCRIPTION_SLOT = "alert-subscription";
/** 旧记录没存原请求：和设备页旧记录同一个说法（缺原请求、不能重试），这里能做的只有查原审批单。 */
const APPROVAL_QUERY_ONLY = "旧记录缺原请求，不能重试，只能查询原审批单。";

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
};

/** 五项分诊的按钮名：写去哪一页。 */
const TRIAGE_LABEL: Record<DimensionKey, string> = {
  bankrun: "去提现审核 →",
  "abnormal-accounts": "去多账户风险排查 →",
  "withdraw-backlog": "去提现审核 →",
  "kill-switches": "去紧急停用开关 →",
  coverage: "去资金与应付款总览 →",
};

const STATUS_TEXT = { handled: "已处理", resolved: "已解决" } as const;
type SignalAction = keyof typeof STATUS_TEXT;
type StatusDialog = { alert: B5Signal; target: SignalAction };
type StatusRead = { state: "loading" | "ready" | "conflict" | "changed" } | { state: "error"; error: string };
type StatusLookup = { state: "loading" } | { state: "ready"; signal: B5Signal } | { state: "error"; error: string; code?: string };
const matchesAction = (signal: B5Signal, target: SignalAction) =>
  signal.handlingStatus === (target === "handled" ? "open" : "handled");
/** 只读说明点名角色页上显示的权限名，去掉页面编号（协调人定）。 */
const READ_ONLY = "你只能查看；标记进度需要「风险雷达-分诊跳转」权限";

/** 订阅写成人话：开了哪些渠道，外部通知带地址。 */
const subscriptionChannels = (value: { inApp: boolean; webhook: boolean; webhookUrl: string }) =>
  [value.inApp && "站内告警", value.webhook && `外部通知 ${value.webhookUrl}`].filter(Boolean).join("、") || "没有开渠道";
/** 后端没人保存过订阅时接收人是 unassigned。 */
const subscriberText = (value: string, displayName?: string | null) => (value === "unassigned" ? "暂无接收人" : displayName || value || "—");

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
  onRetry?: () => void;
  onRelease?: () => void;
  onQuery?: () => void;
  /** 上次「读取当前值」没读到：按钮改叫「重试」（ST-35），读到后换回来。 */
  queryFailed?: boolean;
  onRestore?: () => void;
  onDiscard?: () => void;
  recoveryLine?: string;
}

/**
 * 原样重试被拒时第二段的原因：只写变了什么，下一步统一接 RETRY_REJECTED_NEXT（OP-93 第 8 条、OP-152）。
 * 字典里这几句是给直接提交写的，带着「重新读取后再调整」这类下一步，和「核实后解除」打架；别的码照旧用字典。
 */
const REPLAY_REJECTED_REASON: Record<string, string> = {
  B5_THRESHOLD_VERSION_CONFLICT: "黄线或红线已被改过。",
  B5_SIGNAL_VERSION_CONFLICT: "这条信号的处理进度已经变了。",
  B5_SUBSCRIPTION_VERSION_CONFLICT: "告警订阅已被改过。",
  B5_INBOX_DELIVERY_NOT_FOUND: "这条站内告警现在查不到了。",
};
const replayRejectedLine = (code: string | undefined) => `${code && REPLAY_REJECTED_REASON[code] || displayAdminError(code)}${RETRY_REJECTED_NEXT}`;

function writeRecoveryLine(next: ReturnType<typeof recoveryNext>, rejection?: string) {
  if (next.kind === "rejected") return replayRejectedLine(rejection);
  if (next.kind === "missing") return `${next.block}请到操作记录与审批核对。`;
  return next.block ?? "24 小时内只能按原操作重试，不能改值。";
}

function approvalRecoveryNext(state: Parameters<typeof recoveryNext>[0], queryOnly: boolean) {
  return recoveryNext({ ...state, replayBlock: queryOnly ? "readback-only" : state.replayBlock });
}

function approvalRecoveryLine(next: ReturnType<typeof recoveryNext>, rejection?: string, expiredNotFound?: boolean) {
  if (expiredNotFound) return EXPIRED_PROPOSAL_NOT_FOUND_LINE;
  if (next.kind === "missing") return APPROVAL_QUERY_ONLY;
  if (next.kind === "rejected") return replayRejectedLine(rejection);
  if (next.kind === "not-found") return "暂未查到原审批单，可稍后再查，或按原配置和理由重试。";
  if (next.kind === "query") return "先查原审批单；查不到时 24 小时内可以按原操作重试，不会建第二张单。";
  return next.block ?? "先查原审批单。";
}

function PendingCommands({ items, auditReachable }: { items: readonly B5PendingCommand[]; auditReachable: boolean }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => (
        <Notice key={item.commandKey} tone="warn" title={item.title} actionBelow
          action={<span className="b5-row-actions">
            {item.onQuery && <Button size="sm" onClick={item.onQuery}>{item.queryFailed ? "重新读取" : "读取当前值"}</Button>}
            {item.onRestore && <Button size="sm" onClick={item.onRestore}>重新确认</Button>}
            {item.onDiscard && <Button size="sm" onClick={item.onDiscard}>放弃这份草稿</Button>}
            {item.onRetry && <Button size="sm" onClick={item.onRetry}>按原操作重试</Button>}
            {item.onRelease && <Button size="sm" onClick={item.onRelease}>核实后解除</Button>}
            {auditReachable && <Link className="rd-link" href="/platform/audit" prefetch={false}>到「操作记录与审批」核对</Link>}
          </span>}>
          <p>{item.body}</p>
          {item.recoveryLine && <p>{item.recoveryLine}</p>}
        </Notice>
      ))}
    </>
  );
}

export default function RiskRadarPage() {
  const router = useRouter();
  const params = useSearchParams();
  const query = readSignalQuery(params);
  const fromHome = params.get("from") === "home";
  const { tab } = query;
  const discardRecovery = useRecoveryDraftDiscard();
  const [thresholdDraftKey, setThresholdDraftKey] = useState<string>();
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const sessionKey = adminShellSessionKey(session, authEpoch);
  const operator = useAdminAuth((state) => state.operator || state.session?.operator || state.session?.username || "");
  const authorities = session?.authorities ?? [];
  const role = session?.role ?? "auditor";
  const canThreshold = authorities.includes("overview_b5_threshold_write");
  const canReadSubscription = authorities.includes("overview_b5_read");
  const radar = useB5Radar(sessionKey, canReadSubscription);
  const canReadCategories = canReadSubscription && authorities.includes("overview_b1_read");
  const categoryFeed = useBDomainDashboard(canReadCategories, "OPEN_BY_CATEGORY");
  const [categoryAutoFailures, setCategoryAutoFailures] = useState(0);
  const canSubscribe = authorities.includes("overview_b5_subscribe");
  const canTriage = authorities.includes("overview_b5_triage");
  // 只决定问号和确认框里「冻结、解冻」写去哪办还是找同事（design-plan 板 2「单条怎么处置」）。
  const canCross = useReach();
  const canManageAccount = canCross("/users/actions", "user_c2_read");
  const canFreeze = canManageAccount && authorities.includes("user_c2_account_freeze") && authorities.includes("user_c2_account_unfreeze");
  const canAudit = canCross("/platform/audit", "platform_a2_read");
  const [toastNode, setToast] = useToast();
  const [threshold, setThreshold] = useState<B5ThresholdFacts | null>(null);
  const [yellowInput, setYellowInput] = useState("");
  const [redInput, setRedInput] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<(NonNullable<B5ThresholdFacts["preview"]> & { key: string }) | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [thresholdError, setThresholdError] = useState("");
  const [otherThresholdChanges, setOtherThresholdChanges] = useState<string[]>([]);
  const [approvalRecovery, setApprovalRecovery] = useState(false);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [subscription, setSubscription] = useState({ inApp: true, email: false, webhook: false, webhookUrl: "" });
  const [savedSubscription, setSavedSubscription] = useState(subscription);
  const [savingSubscription, setSavingSubscription] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(true);
  const [subscriptionError, setSubscriptionError] = useState("");
  const [subscriptionReadAt, setSubscriptionReadAt] = useState<string | null>(null);
  const [subscriptionReload, setSubscriptionReload] = useState(0);
  const [subscriptionDraftPreserved, setSubscriptionDraftPreserved] = useState(false);
  const [subscriptionVersion, setSubscriptionVersion] = useState(0);
  const [webhookMode, setWebhookMode] = useState("disabled");
  const [updatingSignal, setUpdatingSignal] = useState("");
  const [inbox, setInbox] = useState<B5InboxItem[]>([]);
  const [inboxLoading, setInboxLoading] = useState(true);
  const [inboxError, setInboxError] = useState("");
  const [inboxReadAt, setInboxReadAt] = useState<string | null>(null);
  const [inboxReload, setInboxReload] = useState(0);
  const [acknowledgingDelivery, setAcknowledgingDelivery] = useState<number | null>(null);
  // 以下只管界面：弹窗开关、页签、分诊进行中。
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [subscriptionSaveError, setSubscriptionSaveError] = useState("");
  const [statusDialog, setStatusDialog] = useState<StatusDialog | null>(null);
  const [statusRead, setStatusRead] = useState<StatusRead>({ state: "loading" });
  const statusReadSequence = useRef(0);
  const [statusLookup, setStatusLookup] = useState<StatusLookup | null>(null);
  const [statusReason, setStatusReason] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [thresholdUnknown, setThresholdUnknown] = useState(false);
  const [subscriptionUnknown, setSubscriptionUnknown] = useState(false);
  const [openedSignal, setOpenedSignal] = useState<{ listKey: string; alert: B5Signal } | null>(null);
  const listQuery = signalRequestQuery(query).toString();
  const listKey = `${sessionKey}|${listQuery}`;
  const readList = useCallback(() => fetchB5Signals(listQuery), [listQuery]);
  const list = useB5Read(listKey, readList, canReadSubscription);
  const selectedSignal = tab === "signals" && openedSignal?.listKey === listKey ? openedSignal.alert : null;
  const openSignal = selectedSignal?.signalNo ?? null;
  const readDetail = useCallback(() => fetchB5Signal(openSignal!), [openSignal]);
  const detail = useB5Read(`${sessionKey}|${openSignal ?? ""}`, readDetail, canReadSubscription && !!openSignal);
  const listActionBlock = list.error ? STALE_MARK_REASON : list.loading ? "风险信号名单正在读取" : undefined;
  const detailActionBlock = detail.error ? "详情没刷新成功，重试成功后再标记"
    : detail.loading ? "正在加载风险信号详情…" : undefined;
  // 去处理的禁用原因：条件和上面两句相同，只是不说「再标记」。
  const listTriageBlock = list.error ? "名单没刷新成功，重试成功后再去处理" : list.loading ? "风险信号名单正在读取" : undefined;
  const detailTriageBlock = detail.error ? "详情没刷新成功，重试成功后再去处理"
    : detail.loading ? "正在加载风险信号详情…" : undefined;
  const signalList = list.data?.records ?? [];
  // 上次读到的分页范围，只给分页条显示用（同一账号）；换条件或翻页读取中留着它，首读没有（ST-13、ST-32）。
  const [lastListRange, setLastListRange] = useState<{ sessionKey: string; total: number; pageNum: number; pageSize: number; rows: number } | null>(null);
  useEffect(() => {
    if (list.data) setLastListRange({ sessionKey, total: list.data.total, pageNum: list.data.pageNum, pageSize: list.data.pageSize, rows: list.data.records.length });
  }, [list.data, sessionKey]);
  const signalIndex = signalList.findIndex(alert => alert.signalNo === openSignal);
  const signalTabs = useRef<HTMLElement>(null);
  const initialLandingDone = useRef(false);
  const openDetail = (alert: B5Signal) => setOpenedSignal({ listKey, alert });
  const [triaging, setTriaging] = useState<keyof typeof TRIAGE | null>(null);
  const tabIds = useTabIds();
  const [, syncPending] = useState(0);
  const [readErrors, setReadErrors] = useState<Record<string, string>>({});
  const [thresholdOriginal, setThresholdOriginal] = useState<Extract<B5PendingWrite, { kind: "threshold" }> | null>(null);
  const [subscriptionOriginal, setSubscriptionOriginal] = useState<Extract<B5PendingWrite, { kind: "subscription" }> | null>(null);
  const [statusOriginal, setStatusOriginal] = useState<Extract<B5PendingWrite, { kind: "signal" }> | null>(null);
  const statusRule = useReasonRule(!!statusDialog && !statusOriginal);
  const [subscriber, setSubscriber] = useState("");
  const [subscriberDisplayName, setSubscriberDisplayName] = useState<string | null>(null);
  const [needsFreshRadar, setNeedsFreshRadar] = useState(false);
  const [subscriptionNeedsRead, setSubscriptionNeedsRead] = useState(false);
  const [inboxNeedsRead, setInboxNeedsRead] = useState(false);
  const [approvalVerifiedKey, setApprovalVerifiedKey] = useState<string | null>(null);
  const [releasingApproval, setReleasingApproval] = useState(false);
  const [releasingWrite, setReleasingWrite] = useState<B5PendingWrite | null>(null);
  useSyncExternalStore(bThresholdRecovery.subscribe, bThresholdRecovery.getRevision, () => 0);
  useSyncExternalStore(b5Recovery.subscribe, b5Recovery.getRevision, () => 0);
  const pendingWrites = session ? pendingB5Commands(String(session.adminId)) : [];
  const pendingSignalNos = new Set(pendingWrites.flatMap(record =>
    isB5Original(record) && record.kind === "signal" ? [record.facts.signalNo] : []));
  const loadCategories = useCallback(async (cause?: "auto" | "mark") => {
    if (!canReadCategories) return;
    const next = await categoryFeed.reload(cause === "mark");
    setCategoryAutoFailures(count => !next && cause === "auto" ? count + 1 : 0);
  }, [canReadCategories, categoryFeed.reload]);

  // Wait for the panels above and below the tabs to settle before positioning the first landing.
  const initialLandingReady = !radar.loading && !list.loading
    && (!canReadCategories || categoryFeed.hasData || !!categoryFeed.error);
  useEffect(() => {
    if (!initialLandingReady || initialLandingDone.current) return;
    const target = fromHome ? signalTabs.current : window.location.hash === `#${SIGNAL_LIST_ANCHOR}`
      ? document.getElementById(SIGNAL_LIST_ANCHOR) : null;
    if (!target) return;
    initialLandingDone.current = true;
    target.scrollIntoView({ block: "start" });
  }, [fromHome, initialLandingReady]);

  useEffect(() => {
    if (!list.data || list.error) return;
    const lastPage = Math.max(1, Math.ceil(list.data.total / list.data.pageSize));
    if (query.page > lastPage) replaceSignalQuery({ page: lastPage });
  }, [list.data, list.error, query.page]);

  useEffect(() => {
    if (!canReadSubscription) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void radar.reload("auto");
      void loadCategories("auto");
      void list.reload("auto");
      void detail.reload("auto");
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [canReadSubscription, radar.reload, loadCategories, list.reload, detail.reload]);

  useEffect(() => () => { statusReadSequence.current += 1; }, [sessionKey]);
  const newWriteBlocked = needsFreshRadar || !!radar.error || !radar.data;
  useEffect(() => {
    if (!radar.loading && !radar.error && radar.data) setNeedsFreshRadar(false);
  }, [radar.loading, radar.error, radar.data]);

  useEffect(() => {
    if (!canReadSubscription) return;
    let alive = true;
    setInboxLoading(true);
    fetchB5Inbox()
      .then((items) => { if (alive) { setInbox(items); setInboxError(""); setInboxReadAt(new Date().toISOString()); setInboxNeedsRead(false); } })
      .catch((cause) => { if (alive) setInboxError(displayAdminReadError(cause)); })
      .finally(() => { if (alive) setInboxLoading(false); });
    return () => { alive = false; };
  }, [canReadSubscription, inboxReload, sessionKey]);

  useEffect(() => {
    if (!canReadSubscription) return;
    let alive = true;
    setSubscriptionLoading(true);
    fetchB5Subscription()
      .then((next) => {
        if (!alive) return;
        const normalized = { inApp: next.inApp, email: false, webhook: next.webhook, webhookUrl: next.webhookUrl };
        if (!subscriptionDraftPreserved && (!session || !pendingB5Commands(String(session.adminId)).some(record => record.fingerprint === SUBSCRIPTION_SLOT))) setSubscription(normalized);
        setSavedSubscription(normalized);
        setSubscriptionError("");
        setSubscriptionReadAt(new Date().toISOString());
        setSubscriptionVersion(next.version);
        setWebhookMode(next.webhookMode);
        setSubscriber(next.subscriber);
        setSubscriberDisplayName(next.subscriberDisplayName ?? null);
        setSubscriptionNeedsRead(false);
      })
      .catch((cause) => {
        if (alive) setSubscriptionError(displayAdminReadError(cause));
      })
      .finally(() => { if (alive) setSubscriptionLoading(false); });
    return () => {
      alive = false;
    };
  }, [canReadSubscription, subscriptionReload, subscriptionDraftPreserved, sessionKey]);

  const yellowPct = Number(yellowInput);
  const redPct = Number(redInput);
  const thresholdValid = Number.isFinite(yellowPct) && yellowPct >= 5 && yellowPct <= 50
    && Number.isFinite(redPct) && redPct >= 10 && redPct <= 80 && redPct > yellowPct;
  const thresholdRule = useReasonRule(!!threshold && !thresholdOriginal && !approvalRecovery);
  const thresholdReason = reason.trim();
  const reasonLength = visibleReasonLength(thresholdReason);
  const reasonValid = thresholdRule.ready && reasonLength >= thresholdRule.min && reasonLength <= thresholdRule.max;
  const reasonHint = !thresholdRule.ready ? thresholdRule.error || "正在加载，稍候即可提交。"
    : reasonLength < thresholdRule.min ? `操作理由还差 ${thresholdRule.min - reasonLength} 字`
      : reasonLength > thresholdRule.max ? `操作理由多了 ${reasonLength - thresholdRule.max} 字` : undefined;
  const pendingApproval = session && pendingThresholdConfigApproval("B5", session.adminId);
  const approvalQueryOnly = !!pendingApproval && (!pendingApproval.b5Facts || !pendingApproval.b5Request);
  usePendingReplayDeadline(nextRecoveryDeadline(pendingApproval ? [...pendingWrites, pendingApproval] : pendingWrites));
  const approvalRecoveryState = pendingApproval ? bThresholdRecovery.state(pendingApproval) : undefined;
  const approvalNext = approvalRecoveryState && approvalRecoveryNext(approvalRecoveryState, approvalQueryOnly);
  const approvalExpiredNotFound = !!pendingApproval && !!approvalRecoveryState && canReleaseExpiredB5Approval(pendingApproval, approvalRecoveryState);
  const thresholdReplay = thresholdOriginal ? b5Recovery.state(thresholdOriginal) : undefined;
  const thresholdNext = thresholdReplay && recoveryNext(thresholdReplay);
  const subscriptionReplay = subscriptionOriginal ? b5Recovery.state(subscriptionOriginal) : undefined;
  const subscriptionNext = subscriptionReplay && recoveryNext(subscriptionReplay);
  const requiresApproval = !thresholdOriginal && (!!pendingApproval || !!threshold && redPct > threshold.redPct);
  const staleThreshold = !thresholdOriginal && !approvalRecovery && !!threshold && radar.data?.bankrun.version !== threshold.version;
  const latestThreshold = radar.data?.bankrun;
  useEffect(() => {
    if (!threshold || !latestThreshold || threshold.version === latestThreshold.version
      || thresholdOriginal || approvalRecovery || savingThreshold) return;
    setYellowInput(input => Number(input) === threshold.yellowPct ? String(latestThreshold.yellowPct) : input);
    setRedInput(input => Number(input) === threshold.redPct ? String(latestThreshold.redPct) : input);
    setOtherThresholdChanges([
      threshold.yellowPct !== latestThreshold.yellowPct && `黄线 ${fmtConfigPct(threshold.yellowPct)} → ${fmtConfigPct(latestThreshold.yellowPct)}`,
      threshold.redPct !== latestThreshold.redPct && `红线 ${fmtConfigPct(threshold.redPct)} → ${fmtConfigPct(latestThreshold.redPct)}`,
    ].filter((change): change is string => !!change));
    setThreshold(latestThreshold);
  }, [threshold, latestThreshold, thresholdOriginal, approvalRecovery, savingThreshold]);
  const thresholdChanged = !!threshold && (yellowPct !== threshold.yellowPct || redPct !== threshold.redPct);
  const thresholdVersion = threshold?.version;
  const previewKey = thresholdValid && !staleThreshold && !radar.loading && thresholdVersion !== undefined && radar.data
    ? JSON.stringify([yellowPct, redPct, thresholdVersion, radar.data.generatedAt])
    : "";
  const currentPreview = preview?.key === previewKey ? preview : null;
  const previewReady = !!currentPreview && !previewError;
  const lookupOnly = (approvalRecovery && !approvalNext?.canRetry) || !!thresholdReplay?.expired;
  const thresholdLocked = savingThreshold || !!thresholdOriginal || !!approvalRecovery || lookupOnly;
  const canSubmitThreshold = canThreshold && !!session && !savingThreshold && !lookupOnly && (thresholdNext
    ? thresholdNext.canRetry
    : approvalRecovery || (!newWriteBlocked && !pendingApproval && !pendingWrites.some(record => record.fingerprint === THRESHOLD_SLOT) && thresholdChanged && reasonValid && previewReady));

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
          if (approvalRecovery) { setThreshold(null); setApprovalRecovery(false); }
          setNeedsFreshRadar(true); void radar.reload();
        }
      })
      .catch((cause) => { if (alive) setThresholdError(displayAdminError(cause)); })
      .finally(() => { if (alive) syncPending(value => value + 1); });
    return () => { alive = false; };
  }, [pendingApproval?.commandKey, radar.data?.generatedAt, savingThreshold]);

  useEffect(() => {
    if (!canThreshold || newWriteBlocked || thresholdOriginal || approvalRecovery || !previewKey || thresholdVersion === undefined) {
      setPreview(null);
      setPreviewError("");
      return;
    }
    let alive = true;
    setPreview(null);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      previewB5Thresholds(yellowPct, redPct, thresholdVersion)
        .then(({ ratio24h, light }) => {
          if (alive) setPreview({ ratio24h, light, readAt: new Date().toISOString(), key: previewKey });
        })
        .catch((cause) => {
          if (alive) setPreviewError(displayAdminReadError(cause));
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [canThreshold, newWriteBlocked, thresholdOriginal, approvalRecovery, previewKey, thresholdVersion, yellowPct, redPct, previewAttempt]);

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
    // 黄线、红线改了，类型列表里「提现压力」那一行跟着重读，不等 30 秒轮询。
    void loadCategories("mark");
    await radar.reload();
  };

  const closeStatus = () => {
    statusReadSequence.current += 1;
    setStatusDialog(null);
    setStatusLookup(null);
  };

  const loadStatus = async (dialog: StatusDialog, conflict = false) => {
    const sequence = ++statusReadSequence.current;
    if (!conflict) setStatusRead({ state: "loading" });
    try {
      const alert = await fetchB5Signal(dialog.alert.signalNo);
      if (sequence !== statusReadSequence.current) return;
      setStatusDialog({ ...dialog, alert });
      setStatusRead({ state: matchesAction(alert, dialog.target) ? "ready" : "changed" });
      if (conflict) setStatusReason("");
      if (conflict && openSignal === alert.signalNo) detail.setData(alert);
    } catch (cause) {
      if (sequence !== statusReadSequence.current) return;
      if (conflict) throw cause;
      setStatusRead({ state: "error", error: displayAdminReadError(cause) });
    }
  };

  const signalActionBlock = (fromDetail: boolean) => listActionBlock ?? (fromDetail ? detailActionBlock : undefined);
  const changeSignalStatus = async () => {
    if (!statusDialog || !session || !canTriage || updatingSignal) return;
    const { alert, target } = statusDialog;
    const reason = statusReason.trim();
    if (!statusOriginal && (statusRead.state !== "ready" || signalActionBlock(openSignal === alert.signalNo)
      || pendingSignalNos.has(alert.signalNo) || !statusRule.ok(reason))) return;
    let original = statusOriginal;
    setUpdatingSignal(alert.signalNo);
    setStatusError("");
    try {
      original ??= rememberB5Command(String(session.adminId), `signal-status:${alert.signalNo}`, "b5-signal-status", {
        kind: "signal", method: "PATCH", path: `/api/admin/risk/radar/signals/${encodeURIComponent(alert.signalNo)}/status`,
        body: JSON.stringify({ targetStatus: target, expectedStatus: alert.handlingStatus, expectedVersion: alert.handlingVersion, reason, operator }), facts: alert,
      }) as Extract<B5PendingWrite, { kind: "signal" }>;
      await executeB5Command(original, !!statusOriginal);
      closeStatus();
      setStatusOriginal(null);
      setStatusUnknown(false);
      setToast(`已标记为${STATUS_TEXT[target]}`);
      void list.reload(target);
      void loadCategories("mark");
      void detail.reload();
    } catch (cause) {
      if (!statusOriginal && cause instanceof B5RequestError && cause.backendMessage === "B5_SIGNAL_VERSION_CONFLICT") {
        setStatusRead({ state: "conflict" });
      } else if (!original || !statusOriginal && isBCommandRejection(cause, false)) {
        setStatusError(displayAdminError(cause));
      } else {
        setStatusOriginal(original);
        setStatusUnknown(true);
        setStatusError(displayAdminError(cause));
      }
    } finally {
      setUpdatingSignal("");
      syncPending(value => value + 1);
    }
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
    <PageHeader pageId="B5" title="风险提醒" summary="看五项风险有没有报警，报警的去哪页处理。" meta={meta} actions={actions} readOnly={readOnly}
      back={fromHome ? <Link href="/" prefetch={false}><ArrowLeft size={14} aria-hidden /> 返回今日概览</Link> : undefined} />
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
  const openThreshold = (draft?: ReturnType<typeof thresholdRecoveryDrafts<"B5">>[number]) => {
    if (draft && (threshold || pendingApproval || !draft.b5Facts || !session || !canThreshold || newWriteBlocked || !data)) return;
    setOtherThresholdChanges([]);
    setThresholdDraftKey(draft?.commandKey);
    if (pendingApproval) {
      setYellowInput(String(pendingApproval.values.yellowPct));
      setRedInput(String(pendingApproval.values.redPct));
      setReason(pendingApproval.reason);
      setThreshold(pendingApproval.b5Facts ?? null);
      setApprovalRecovery(true);
      if (!pendingApproval.b5Facts) void queryApproval();
    } else {
      const saved = pendingWrites.find(record => record.fingerprint === THRESHOLD_SLOT);
      if (saved) { recoverWrite(saved); return; }
      if (!canThreshold || newWriteBlocked || !data) return;
      const latest = data.bankrun;
      const merged = draft?.b5Facts ? rebaseRecoveryFields(draft.b5Facts,
        { yellowPct: draft.values.yellowPct, redPct: draft.values.redPct }, latest) : latest;
      setYellowInput(String(merged.yellowPct));
      setRedInput(String(merged.redPct));
      if (draft?.b5Facts && session) {
        const before = draft.b5Facts;
        setOtherThresholdChanges([
          before.yellowPct !== latest.yellowPct && `黄线 ${fmtConfigPct(before.yellowPct)} → ${fmtConfigPct(latest.yellowPct)}`,
          before.redPct !== latest.redPct && `红线 ${fmtConfigPct(before.redPct)} → ${fmtConfigPct(latest.redPct)}`,
        ].filter((value): value is string => !!value));
      }
      setReason("");
      setApprovalRecovery(false);
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
      if (result) {
        setToast(result.acknowledgement);
        if (approvalRecovery) { setThreshold(null); setApprovalRecovery(false); }
        setNeedsFreshRadar(true); await radar.reload();
      } else if (!threshold || !approvalRecovery) {
        const state = bThresholdRecovery.state(pendingApproval);
        const next = approvalRecoveryNext(state, approvalQueryOnly);
        const expiredNotFound = canReleaseExpiredB5Approval(pendingApproval, state);
        const line = expiredNotFound || next.kind === "not-found" ? approvalRecoveryLine(next, state.replayRejection, expiredNotFound)
          : `暂未查到原审批单。${approvalRecoveryLine(next, state.replayRejection)}`;
        setToast(line, next.canRetry ? undefined : "warn");
      }
    } catch (cause) { setThresholdError(displayAdminError(cause)); setToast(displayAdminError(cause)); }
    finally { syncPending(value => value + 1); }
  };
  const submitThreshold = async (recover = false) => {
    if (recover) { await queryApproval(); return; }
    if (!session || !threshold || !canSubmitThreshold) return;
    setSavingThreshold(true); setThresholdError("");
    let original = thresholdOriginal;
    const facts: B5ThresholdFacts = !original && !pendingApproval && currentPreview ? {
      ...(latestThreshold ?? threshold),
      radarReadAt: radar.at ?? undefined,
      preview: { ratio24h: currentPreview.ratio24h, light: currentPreview.light, readAt: currentPreview.readAt },
    } : threshold;
    try {
      if (requiresApproval) {
        const result = await submitB5ThresholdApproval(session, pendingApproval?.values ?? { expectedVersion: threshold.version, yellowPct, redPct },
          pendingApproval?.reason ?? thresholdReason, fetchB5Radar, pendingApproval ? "retry" : "new", facts, thresholdDraftKey);
        if (!result) return;
        setApprovalVerifiedKey(result.ticket.status === "pending" ? pendingThresholdConfigApproval("B5", session.adminId)?.commandKey ?? null : null);
        setToast(result.acknowledgement);
      } else {
        original ??= rememberB5Command(String(session.adminId), THRESHOLD_SLOT, "b5-threshold", {
          kind: "threshold", method: "PUT", path: "/api/admin/risk/bankrun-thresholds", facts,
          body: JSON.stringify({ yellowPct, redPct, expectedVersion: threshold.version, reason: thresholdReason, operator }),
        }) as Extract<B5PendingWrite, { kind: "threshold" }>;
        setThresholdOriginal(original);
        const saved = original;
        await sendRecoveredDraft(() => executeB5Command(saved, !!thresholdOriginal),
          () => b5Commands.isDurablyStored(saved.fingerprint, saved.commandKey), thresholdDraftKey
            ? () => discardThresholdRecoveryDraft("B5", session.adminId, thresholdDraftKey) : undefined);
        setToast("提现压力的黄线和红线已更新");
      }
      setApprovalRecovery(false); setThresholdUnknown(false);
      await refreshAfterWrite();
    } catch (cause) {
      let rereadAfterConflict = false;
      const rejected = isBCommandRejection(cause, !!thresholdOriginal || !!pendingApproval);
      if (rejected) {
        if (thresholdOriginal || pendingApproval) await refreshAfterWrite();
        else {
          const versionConflict = cause instanceof Error && "backendMessage" in cause
            && cause.backendMessage === "B5_THRESHOLD_VERSION_CONFLICT";
          if (versionConflict) setReason("");
          setThresholdOriginal(null); setApprovalRecovery(false); setPreview(null);
          setNeedsFreshRadar(true);
          const fresh = await radar.reload();
          rereadAfterConflict = !!fresh && versionConflict;
        }
      } else if (requiresApproval) {
        const saved = pendingThresholdConfigApproval("B5", session.adminId);
        if (saved) {
          setThreshold(saved.b5Facts ?? null);
          setApprovalRecovery(true);
        }
      }
      setThresholdUnknown(!!original && !rejected);
      // 版本冲突已重读：框里写一句就够，不再弹同一句。
      if (rereadAfterConflict) setThresholdError("当前阈值已更新，请核对后再保存。");
      else {
        // 框还开着：失败和结果未知都只写在框里，不同时弹提示（VS-107、DT-12）。
        // 按原操作重试被明确拒绝时 refreshAfterWrite 已经关框，框里的话看不到，才弹一次。
        setThresholdError(displayAdminError(cause));
        if (rejected && (thresholdOriginal || pendingApproval)) setToast(displayAdminError(cause), "warn");
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
        facts: { ...savedSubscription, version: subscriptionVersion, subscriber, subscriberDisplayName, emailMode: "disabled", webhookMode, sharedWith: "B1" },
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
      setReason(input.reason); setThresholdUnknown(true); setApprovalRecovery(false); setThresholdError("");
    } else if (record.kind === "subscription") {
      setSubscriptionOriginal(record); setSubscription({ inApp: input.inApp, email: input.email, webhook: input.webhook, webhookUrl: input.webhookUrl });
      setSubscriptionUnknown(true); setSubscriptionOpen(true); setSubscriptionSaveError("");
    } else if (record.kind === "signal") {
      setStatusOriginal(record); setStatusDialog({ alert: record.facts, target: input.targetStatus }); setStatusReason(input.reason); setStatusUnknown(true); setStatusError(""); setStatusLookup(null);
    } else void acknowledgeInbox(record.facts, record);
  };
  const readStatusCurrent = async () => {
    if (!statusOriginal || updatingSignal || statusLookup?.state === "loading") return;
    const sequence = ++statusReadSequence.current;
    setStatusLookup({ state: "loading" });
    try {
      const signal = await fetchB5Signal(statusOriginal.facts.signalNo);
      if (sequence === statusReadSequence.current) setStatusLookup({ state: "ready", signal });
    } catch (cause) {
      if (sequence === statusReadSequence.current) setStatusLookup({ state: "error", error: displayAdminReadError(cause), code: cause instanceof B5RequestError ? cause.backendMessage : undefined });
    }
  };
  const queryWrite = async (record: B5PendingWrite) => {
    try {
      const current = await inspectB5Command(record);
      setReadErrors(errors => {
        const { [record.commandKey]: _cleared, ...remaining } = errors;
        return remaining;
      });
      const next = recoveryNext(b5Recovery.state(record));
      const line = next.kind === "rejected" ? RETRY_REJECTED_NEXT
        : next.canRetry ? "可以按原操作重试，不会重复执行。" : next.block;
      if (current.kind === "radar") { radar.setData(current.data); setNeedsFreshRadar(false); }
      else if (current.kind === "ack") { setInbox(current.data); setInboxError(""); setInboxLoading(false); setInboxNeedsRead(false); setInboxReadAt(new Date().toISOString()); }
      else if (current.kind === "signal") {
        if (openSignal === current.data.signalNo) detail.setData(current.data);
        setToast(`当前进度：${HANDLING[current.data.handlingStatus].text}。已查到现在的值，但说明不了原操作成没成。${line}`, "warn");
        return;
      }
      else {
        setSavedSubscription({ inApp: current.data.inApp, email: current.data.email, webhook: current.data.webhook, webhookUrl: current.data.webhookUrl });
        setSubscriber(current.data.subscriber); setSubscriptionVersion(current.data.version); setWebhookMode(current.data.webhookMode);
        setSubscriberDisplayName(current.data.subscriberDisplayName ?? null);
        setSubscriptionError(""); setSubscriptionLoading(false); setSubscriptionNeedsRead(false); setSubscriptionReadAt(new Date().toISOString());
      }
      setToast(`已查到现在的值，但说明不了原操作成没成。${line}`, next.canRetry ? undefined : "warn");
    }
    catch (cause) {
      const error = cause instanceof B5RequestError && cause.backendMessage === "RISK_BACKEND_UNAVAILABLE"
        ? formatAdminApiError("SERVICE_UNAVAILABLE", "SERVICE_UNAVAILABLE", "read")
        : displayAdminReadError(cause);
      setReadErrors(errors => ({ ...errors, [record.commandKey]: error }));
    }
  };
  const pendingItems: B5PendingCommand[] = pendingWrites.map(record => {
    const original = isB5Original(record) ? record : null;
    const input = original?.body ? JSON.parse(original.body) : null;
    const body = original?.kind === "threshold" ? `黄线 ${fmtConfigPct(original.facts.yellowPct)} → ${fmtConfigPct(input.yellowPct)} · 红线 ${fmtConfigPct(original.facts.redPct)} → ${fmtConfigPct(input.redPct)}`
      : original?.kind === "signal" ? `信号 ${original.facts.signalNo} · ${HANDLING[original.facts.handlingStatus].text} → ${STATUS_TEXT[input.targetStatus as "handled" | "resolved"]}`
        : original?.kind === "ack" ? `信号 ${original.facts.signalNo}` : original?.kind === "subscription" ? subscriptionChannels(JSON.parse(original.body)) : "原记录不完整，到「操作记录与审批」核对";
    const name = original?.kind === "threshold" ? "调整黄线和红线" : original?.kind === "signal" ? `标记${STATUS_TEXT[input.targetStatus as "handled" | "resolved"]}` : original?.kind === "ack" ? "确认站内告警已读" : original?.kind === "subscription" ? "保存告警订阅" : "原操作";
    const recovery = b5Recovery.state(record);
    const next = recoveryNext(recovery);
    const readError = readErrors[record.commandKey];
    return {
      commandKey: record.commandKey,
      title: `${name} · ${next.kind === "rejected" ? RETRY_REJECTED_STATUS.label : "结果未知"}`,
      body: `${body} · ${timeText(new Date(record.createdAt).toISOString())}提交`,
      recoveryLine: `${readError ? `读取当前值失败：${readError} ` : ""}${writeRecoveryLine(next, recovery.replayRejection)}`,
      onRelease: original && next.kind === "rejected" ? () => setReleasingWrite(original) : undefined,
      onRetry: next.canRetry ? () => recoverWrite(record) : undefined,
      onQuery: original ? () => void queryWrite(original) : undefined,
      queryFailed: Boolean(readError),
    };
  });

  if (session) for (const draft of thresholdRecoveryDrafts("B5", session.adminId)) pendingItems.push({
    commandKey: draft.commandKey, title: "提高红线的审批 · 未执行",
    body: `黄线 ${fmtConfigPct(draft.values.yellowPct)} · 红线 ${fmtConfigPct(draft.values.redPct)}`,
    onRestore: draft.b5Facts && canThreshold ? () => openThreshold(draft) : undefined,
    onDiscard: () => discardRecovery.ask(() => { discardThresholdRecoveryDraft("B5", session.adminId, draft.commandKey); syncPending(value => value + 1); }),
  });

  // ---------- 五项 ----------
  const { issues, quiet } = data ? buildDimensions(data) : { issues: [], quiet: [] };
  const triageButton = (key: DimensionKey, variant: "primary" | "secondary" | "ghost", size: "md" | "sm") => canTriageDimension(key)
    ? <Button key="triage" variant={variant} size={size} loading={triaging === key} loadingText="正在记录…" icon={<ArrowUpRight size={14} aria-hidden />}
      disabledReason={radar.error ? "风险数据没刷新成功，请先重试" : triaging && triaging !== key ? "正在记录另一条分诊，记完再点" : undefined}
      onClick={() => void triage(key)}>{TRIAGE_LABEL[key]}</Button>
    : null;
  const thresholdButton = (size: "md" | "sm") => canThreshold
    ? <Button key="threshold" variant="ghost" size={size} icon={<SlidersHorizontal size={14} aria-hidden />} disabledReason={radar.error ? "风险数据没刷新成功，请先重试" : undefined} onClick={() => openThreshold()}>调整黄线 / 红线</Button>
    : null;
  const approvalPending = pendingApproval?.commandKey === approvalVerifiedKey && pendingApproval?.b5Ticket?.status === "pending" ? { redPct: pendingApproval.values.redPct, ticketId: pendingApproval.b5Ticket.id } : null;
  const approvalRejected = approvalNext?.kind === "rejected" && !pendingApproval?.received && !pendingApproval?.b5Ticket;
  const approvalReleasable = !approvalRecoveryState?.busy && (approvalRejected || approvalExpiredNotFound);
  const releaseApproval = () => {
    if (!session || !pendingApproval || !releaseB5ThresholdApproval(session.adminId, pendingApproval.commandKey)) return;
    setReleasingApproval(false); setThreshold(null); setApprovalRecovery(false);
    syncPending(value => value + 1);
    setToast("已解除本页的原操作记录");
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
  const unacked = inboxReadAt ? inbox.filter((item) => !item.acknowledgedAt).length : null;
  const inboxHint = unacked && !inboxError ? `你有 ${unacked} 条站内告警没确认。` : "";
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

  const meta = (data || radar.streamWarning) && (
    <span className="b5-meta">
      {data && <>数据时间 {timeText(data.generatedAt)}
        <Explain label="数据多久更新" content="打开页面时读一次，之后每 30 秒自动重读；站内告警和告警订阅不跟着自动重读。" /></>}
      {radar.streamWarning && <span className="b5-muted">{data && " · "}{radar.streamWarning.replace(/。$/, "")}</span>}
      {radar.reconnect && <Button size="sm" variant="ghost" onClick={radar.reconnect}>重新连接</Button>}
    </span>
  );
  const refreshAll = () => {
    void radar.reload();
    void loadCategories();
    void list.reload();
    void detail.reload();
    setInboxReload(value => value + 1);
    if (canReadSubscription && !subscriptionOpen) setSubscriptionReload(value => value + 1);
  };
  const headerActions = (
    <>
      <Button icon={<RefreshCw size={14} aria-hidden />} onClick={refreshAll}>刷新</Button>
      {canReadSubscription && <Button icon={<BellRing size={14} aria-hidden />} onClick={() => { const saved = pendingWrites.find(record => record.fingerprint === SUBSCRIPTION_SLOT); if (saved) { recoverWrite(saved); return; } setSubscriptionOriginal(null); setSubscriptionSaveError(""); setSubscriptionOpen(true); }}>告警订阅</Button>}
      {killSwitchLink}
    </>
  );
  const readOnly = !canThreshold && !canSubscribe && !canTriage ? READ_ONLY : undefined;
  const canTriageTarget = (target: string) => {
    const dimension = QUEUE_TRIAGE[target];
    return !!dimension && canTriageDimension(dimension);
  };
  const queueTriage = (target: string, fromDetail = false) => {
    if (signalActionBlock(fromDetail)) return true;
    const dimension = QUEUE_TRIAGE[target];
    if (dimension && canTriageDimension(dimension)) void triage(dimension);
    return true;
  };
  // 「真正去哪办」：排查去处只写「去处理」里点得开的页；表头问号是整张名单的，名单筛成一类时写那一类的页，没筛类型时指向每行的「去处理」（design-plan 板 2）。
  const triagePage = (target: string | null | undefined) => {
    const link = signalTreatmentLink(target, canCross, canTriage, canTriageTarget);
    return link && link.mode !== "unreachable" ? TARGET_NAME[link.target] ?? null : null;
  };
  const listCategory = query.signalType ? "TAMPER" : query.category.length === 1 ? query.category[0] : null;
  const listHandlingHint = listCategory ? handlingHint(triagePage(CATEGORY_TARGETS[listCategory]), canFreeze)
    : Object.values(CATEGORY_TARGETS).some((target) => triagePage(target)) ? `排查到每行「去处理」写的页面，${handlingHint(null, canFreeze)}` : handlingHint(null, canFreeze);
  const triageState = (target: string) => {
    const dimension = QUEUE_TRIAGE[target];
    if (!triaging || !dimension || !canTriageDimension(dimension)) return undefined;
    return triaging === dimension ? "active" as const : "blocked" as const;
  };
  const openSignalStatus = (alert: B5Signal, target: SignalAction, fromDetail = false) => {
    if (!canTriage || signalActionBlock(fromDetail) || pendingSignalNos.has(alert.signalNo)) return;
    const dialog = { alert, target };
    setStatusOriginal(null);
    setStatusReason("");
    setStatusError("");
    setStatusLookup(null);
    setStatusUnknown(false);
    setStatusDialog(dialog);
    void loadStatus(dialog);
  };
  const heldRange = !list.data && !list.error && lastListRange?.sessionKey === sessionKey ? lastListRange : null;
  const listState: SignalListState = list.data ? { state: "ready", rows: signalList, stale: list.stale }
    : list.error ? { state: "error", error: list.error } : { state: "loading", heldRows: heldRange ? Math.max(1, heldRange.rows) : undefined };
  const clearFilters = () => replaceSignalQuery({ category: null, signalType: null, handlingStatus: null, startAt: null, endAt: null, page: 1 });
  const listFilters: SignalListFilters = {
    category: query.signalType ?? query.category.join(","),
    categoryLabel: query.signalType ? "篡改拦截"
      : query.category.length > 1 ? SIGNAL_CATEGORIES.filter(option => query.category.includes(option.value)).map(option => option.label).join("、") : undefined,
    status: query.handlingStatus ?? "",
    window: query.startAt ? "fixed" : "rolling",
    windowOptions: [
      { value: "rolling", label: "近 7 天" },
      ...(query.startAt && query.endAt ? [{ value: "fixed", label: `${stamp(query.startAt)} — ${stamp(query.endAt)}（${businessZone().label}）` }] : []),
    ],
    onCategory: value => replaceSignalQuery({ category: isSignalCategory(value) ? value : null, signalType: null, page: 1 }),
    onStatus: value => replaceSignalQuery({ handlingStatus: value, page: 1 }),
    onWindow: value => { if (value === "rolling") replaceSignalQuery({ startAt: null, endAt: null, page: 1 }); },
    onClear: clearFilters,
    canClear: !!(query.category.length || query.signalType || query.handlingStatus || query.startAt),
    accountCount: list.data?.accountCount ?? null,
  };
  const listPage: SignalListPage | undefined = list.data ? {
    total: list.data.total, pageNum: list.data.pageNum, pageSize: list.data.pageSize, sizes: SIGNAL_PAGE_SIZES, loading: list.loading,
    onPage: page => replaceSignalQuery({ page }),
    onPageSize: pageSize => replaceSignalQuery({ pageSize, page: 1 }),
  } : heldRange ? {
    total: heldRange.total, pageNum: heldRange.pageNum, pageSize: heldRange.pageSize, sizes: SIGNAL_PAGE_SIZES, loading: true,
    onPage: page => replaceSignalQuery({ page }),
    onPageSize: pageSize => replaceSignalQuery({ pageSize, page: 1 }),
  } : undefined;
  const categories: RiskCategoriesState = !canReadCategories ? { state: "noperm" } : categoryFeed.data && categoryFeed.readAt ? {
    state: "ready",
    rows: riskCategoryRows(categoryFeed.riskRadar.feed, canCross),
    stale: categoryFeed.error ? { at: categoryFeed.readAt, auto: categoryAutoFailures >= 2 } : undefined,
  } : categoryFeed.error ? { state: "error", error: categoryFeed.error } : { state: "loading" };
  const selectedCategory = query.category.length === 1 ? query.category[0] : null;
  const selectCategory = (row: RiskCategoryRow) => {
    if (row.kind === "signal") {
      replaceSignalQuery({ tab: "signals", category: row.key, signalType: null, handlingStatus: row.handlingStatus,
        startAt: row.startAt, endAt: row.endAt, page: 1, pageSize: query.pageSize });
      document.getElementById(SIGNAL_LIST_ANCHOR)?.scrollIntoView({ block: "start" });
    } else if (row.kind === "fund") {
      const target = document.getElementById("b5-dim-bankrun") ?? document.querySelector(".radarpage > .rd-block-state");
      target?.scrollIntoView({ block: "start" });
    }
  };
  const returnTo = signalReturnTo(query, fromHome);
  const detailUser = detail.data?.userNo;
  const userHref = detailUser && canCross("/users/search", "user_c1hub_read")
    ? `/users/search/${encodeURIComponent(detailUser)}?${new URLSearchParams({ returnTo })}` : undefined;
  const actionsHref = detailUser && canManageAccount
    ? `/users/actions?${new URLSearchParams({ userCode: detailUser, source: "B5", returnTo })}` : undefined;

  return (
    <RdPage className="radarpage">
        {header(meta, headerActions, readOnly)}
        {discardRecovery.dialog}
        <PendingCommands items={pendingItems} auditReachable={canAudit} />
        {pendingApproval && (
          <Notice tone="warn" title={`提高红线的审批 · ${approvalPending ? "待审批" : approvalExpiredNotFound ? "已过期" : approvalRejected ? RETRY_REJECTED_STATUS.label : "结果未知"}`} actionBelow
            action={<span className="b5-row-actions">
              <Button size="sm" onClick={() => openThreshold()}>查询原操作</Button>
              {approvalReleasable && <Button size="sm" onClick={() => setReleasingApproval(true)}>核实后解除</Button>}
            </span>}>
            <p>黄线 {fmtConfigPct(pendingApproval.values.yellowPct)} · 红线 {fmtConfigPct(pendingApproval.values.redPct)} · {timeText(new Date(pendingApproval.createdAt).toISOString())}提交</p>
            <p>{approvalPending ? "等另一位超级管理员在「操作记录与审批」批准，批准前红线不变。"
              : !(threshold && approvalRecovery) && approvalNext && approvalRecoveryLine(approvalNext, approvalRecoveryState?.replayRejection, approvalExpiredNotFound)}</p>
          </Notice>
        )}
        {!data ? <>
          <Conclusion state="unknown" icon={ShieldQuestion}>
            {radar.loading && !radar.error ? "风险提醒：正在加载" : "暂无法判断：风险数据没读到"}
          </Conclusion>
          <BlockState state={radar.loading && !radar.error ? "loading" : "error"} title={radar.loading && !radar.error ? "正在加载五项风险…" : "风险数据加载失败"} detail={radar.error ?? undefined} onRetry={radar.loading && !radar.error ? undefined : radar.reload} retrying={radar.loading} />
        </> : <>
        {radar.stale && <StaleNotice stale={radar.stale} onRetry={() => void radar.reload()} />}
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

        </>}

        <section ref={signalTabs} id="risk-signal-tabs" className="b5-lists" aria-label="风险信号和站内告警">
          <PageTabs label="风险信号和站内告警" ids={tabIds} value={tab} onChange={tab => replaceSignalQuery({ tab })} items={[
            { value: "signals", label: "最近风险信号" },
            { value: "inbox", label: "我的站内告警", count: inboxError ? "—" : unacked ?? "—" },
          ]} />
          <div {...tabIds.panel(tab)} className="rd-tab-pane">
            {tab === "signals" ? (
              <div className="b5-signals-pane">
                <RiskCategoryPanel data={categories} selectedKey={selectedCategory} onSelect={selectCategory} onRetry={() => void loadCategories()} />
                <SignalList data={listState} filters={listFilters} page={listPage} onRetry={() => void list.reload()}
                  table={{ canTriage, handlingHint: listHandlingHint, actionBlocked: listActionBlock, triageBlocked: listTriageBlock, pendingSignalNos, updating: updatingSignal, reach: canCross, canTriageTarget, selected: openSignal, onOpen: list.loading ? undefined : openDetail,
                    onTriage: queueTriage, triageState, onStatus: openSignalStatus }} />
              </div>
            ) : (
              <Panel flush data-capability="b5-subscriber-inbox">
                <TabNote label="站内告警的范围" explain="只列发给你的站内告警，最多 100 条，不分页。确认已读只记录你看过，不改信号的处理进度。">
                  {/* 读取失败已由下面的失败卡写标题和原因，这里只写范围，不再写一遍「读取失败」（DT-12）。 */}
                  {!inboxReadAt ? inboxError ? "发给你的站内告警" : "正在加载…" : `发给你的 ${inbox.length} 条 · ${unacked} 条没确认`}
                </TabNote>
                {inboxError && inboxReadAt && <StaleNotice stale={{ at: inboxReadAt, auto: false }} onRetry={() => setInboxReload(value => value + 1)} />}
                <InboxTable state={inboxReadAt ? "ready" : inboxError ? "error" : "loading"} items={inbox} error={inboxError}
                  acknowledgeBlocked={inboxError ? "站内告警没刷新成功，重试成功后再确认" : inboxLoading || inboxNeedsRead ? "正在读取站内告警" : undefined}
                  onRetry={() => setInboxReload((value) => value + 1)} canTriage={canTriage} acknowledging={acknowledgingDelivery}
                  onAcknowledge={(item) => void acknowledgeInbox(item)} />
              </Panel>
            )}
          </div>
        </section>
        <SignalDrawer alert={detail.data ?? selectedSignal} canTriage={canTriage} canFreeze={canFreeze} canAudit={canAudit}
          readLoading={detail.loading && !detail.data} readError={detail.error} onRetry={() => void detail.reload()}
          staleNotice={detail.stale && <StaleNotice stale={detail.stale} onRetry={() => void detail.reload()} />}
          actionBlocked={signalActionBlock(true)} triageBlocked={listTriageBlock ?? detailTriageBlock} pendingWrite={!!openSignal && pendingSignalNos.has(openSignal)}
          userHref={userHref} actionsHref={actionsHref} updating={updatingSignal} reach={canCross} canTriageTarget={canTriageTarget}
          nav={{ hasPrev: signalIndex > 0, hasNext: signalIndex >= 0 && signalIndex < signalList.length - 1,
            onPrev: () => openDetail(signalList[signalIndex - 1]), onNext: () => openDetail(signalList[signalIndex + 1]) }}
          onClose={() => setOpenedSignal(null)} onTriage={target => queueTriage(target, true)} triageState={triageState}
          onStatus={(alert, target) => openSignalStatus(alert, target, true)} />

      {threshold && (() => {
        const recovering = !!thresholdOriginal || !!approvalRecovery;
        const pressure = thresholdOriginal?.facts ?? (approvalRecovery ? threshold : latestThreshold ?? threshold);
        const radarReadAt = recovering ? (thresholdOriginal?.facts ?? threshold).radarReadAt : radar.at;
        const outcome = recovering ? (thresholdOriginal?.facts ?? threshold).preview : previewReady ? currentPreview : null;
        const sameReading = outcome?.ratio24h === pressure.ratio24h;
        const sameDecision = sameReading && outcome?.light === pressure.light;
        const pct = (value: number | null) => value === null ? "暂无法计算" : ratioPct(value);
        const lightTag = (light: typeof pressure.light) => <StatusTag tone={light === "red" ? "danger" : light === "yellow" ? "warn" : light === "green" ? "ok" : "neutral"}>{formatB5RiskLight(light)}</StatusTag>;
        const readAt = (at: string | null | undefined, zone: boolean) => outcome && !sameReading && at
          ? <span className="rd-keep">（{businessClock(parseBusinessTime(at))} 读到{zone ? `，${businessZone().label}` : ""}）</span> : null;
        const raising = redPct > threshold.redPct;
        const redDirection = !Number.isFinite(redPct) || redPct === threshold.redPct ? null : raising
          ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="done" icon={Lock}>收紧</StatusTag>;
        const yellowDirection = !Number.isFinite(yellowPct) || yellowPct === threshold.yellowPct ? null : yellowPct > threshold.yellowPct
          ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="done" icon={Lock}>收紧</StatusTag>;
        const orderError = thresholdValid ? undefined : "黄线 5%–50%，红线 10%–80%，红线要高于黄线";
        const submitLabel = recovering ? "按原操作重试" : requiresApproval ? "提交审批" : "确认调整";
        const blocked = !canThreshold ? formatAdminApiError("ADMIN_PERMISSION_DENIED", "ADMIN_PERMISSION_DENIED") : staleThreshold ? "阈值刚被改过，关掉重新打开再调整"
          : !thresholdValid ? "先把黄线、红线填在范围内"
            : !recovering && !thresholdChanged ? "没有修改"
            : !recovering && !reasonValid ? reasonHint
              : !previewReady && !approvalRecovery ? (previewError ? "预览失败，暂不能提交" : "正在按新的线计算，请稍等")
                : undefined;
        return (
          <Modal title="调整提现压力的黄线和红线" icon={SlidersHorizontal} busy={savingThreshold} dirty={thresholdChanged || !!thresholdReason}
            sub={requiresApproval
              ? <StatusTag tone="progress" filled explain="提高红线要另一位超级管理员批准，自己不能批。批准前线被别人改过的，这张单会被拒。">批准后生效</StatusTag>
              : <StatusTag tone="progress" filled>立即生效</StatusTag>}
            onClose={() => setThreshold(null)}
            footer={<>
              <Button disabled={savingThreshold} onClick={() => setThreshold(null)}>取消</Button>
              {approvalRecovery && approvalReleasable && <Button disabled={savingThreshold} onClick={() => { setThreshold(null); setReleasingApproval(true); }}>核实后解除</Button>}
              {approvalRecovery && <Button variant={lookupOnly ? "primary" : "secondary"} loading={savingThreshold && lookupOnly} loadingText="查询中…" disabledReason={undefined} onClick={() => void submitThreshold(true)}>查询原操作</Button>}
              {!lookupOnly && <Button variant="primary" loading={savingThreshold} loadingText="提交中…" disabledReason={canSubmitThreshold ? undefined : blocked ?? "暂不能提交"} onClick={() => void submitThreshold()}>{submitLabel}</Button>}
            </>}>
            <div className="b5-dialog">
              {staleThreshold && <Notice tone="warn">阈值刚被别人改过，这次不能按旧值提交。关掉后重新打开再调整。</Notice>}
              {(thresholdError || approvalRecovery) && <Notice tone={approvalRecovery || thresholdUnknown ? "warn" : "danger"} title={approvalRecovery ? approvalExpiredNotFound ? "已过期" : approvalRejected ? RETRY_REJECTED_STATUS.label : "审批单结果未知" : thresholdUnknown ? "结果未知，可能已经生效" : "没有调整成功"}>{approvalRecovery
                ? approvalNext && (approvalNext.kind === "query" ? "请先查询原审批单。" : approvalRecoveryLine(approvalNext, approvalRecoveryState?.replayRejection, approvalExpiredNotFound))
                : thresholdUnknown && thresholdNext ? thresholdNext.canRetry
                  ? "可能已经生效。可以按原操作重试，不会重复执行；也可以关掉后点「读取当前值」。"
                  : writeRecoveryLine(thresholdNext, thresholdReplay?.replayRejection) : thresholdError}</Notice>}
              {otherThresholdChanges.length > 0 && <Notice tone="neutral" title="别人改了什么">{otherThresholdChanges.join(" · ")}</Notice>}
              <DiffField size="body" before={fmtConfigPct(threshold.yellowPct)} beforeLabel={recovering ? "提交时" : undefined} label="黄线改成" hint="5%–50%" state={yellowDirection}
                note={yellowDirection ? "黄线只决定什么时候标「注意」，不会自动暂停提现。" : undefined}>
                {(control) => <NumberInput {...control} aria-label="黄线（5%–50%）" unit="%" min={5} max={50} value={yellowInput} disabled={thresholdLocked} onChange={(event) => setYellowInput(event.target.value)} />}
              </DiffField>
              <DiffField before={fmtConfigPct(threshold.redPct)} beforeLabel={recovering ? "提交时" : undefined} label="红线改成" explain="紧急停用开关页把这条线叫挤兑红线，是同一条线。" hint="10%–80%，要高于黄线" state={redDirection} error={yellowInput && redInput ? orderError : undefined}
                note={redDirection ? (raising ? "红线调高，自动暂停提现会更晚触发。" : "红线调低，自动暂停提现会更早触发，立即生效。") : undefined}>
                {(control) => <NumberInput {...control} aria-label="红线（10%–80%）" unit="%" min={10} max={80} value={redInput} disabled={thresholdLocked} onChange={(event) => setRedInput(event.target.value)} />}
              </DiffField>
              {/* 两次读数各写一行，同一种说法：按哪条线、读到多少、标什么；读数不同才写各自的读取时间，时区跟第一个时间写一次（TX-25）。 */}
              <div className="b5-preview" role="status">
                {outcome && sameDecision
                  ? <p>提现压力 {pct(pressure.ratio24h)}，按{recovering ? "原来" : "现在"}的线和新的线都标 {lightTag(outcome.light)}</p>
                  : <>
                    <p>按{recovering ? "原来" : "现在"}的线：{recovering && !radarReadAt ? "提交时" : ""}提现压力 {pct(pressure.ratio24h)}，标 {lightTag(pressure.light)}{readAt(radarReadAt, true)}</p>
                    {outcome ? <p>按新的线：提现压力 {pct(outcome.ratio24h)}，会标 {lightTag(outcome.light)}{readAt(outcome.readAt, !radarReadAt)}</p>
                      : !recovering && !previewError && <p>按新的线：{previewKey ? "正在计算…" : "填好两条线后显示会标什么"}</p>}
                  </>}
              </div>
              {/* 预览只是读：失败时写成读取失败卡，原输入留着，只重读预览（ST-34、ST-35、OP-84）。 */}
              {!recovering && previewError && <BlockState compact state="error" title="按新的线的预览加载失败" detail={previewError} onRetry={() => setPreviewAttempt(value => value + 1)} />}
              <Notice tone="neutral">
                <p>和「紧急停用开关」共用，那边也跟着变。</p>
                <p>两边看同一个提现压力，到红线那边自动暂停提现。</p>
              </Notice>
              {requiresApproval && (
                <Notice tone="warn" title="提高红线要审批">
                  <Facts>
                    <Fact k="谁来批">另一位超级管理员，自己不能批</Fact>
                    <Fact k="批准人需有">审批批准权限</Fact>
                    <Fact k={recovering ? "提交时的红线" : "批准前的红线"}>{fmtConfigPct(threshold.redPct)}{recovering ? "；批没批以查询原操作为准" : ""}</Fact>
                  </Facts>
                </Notice>
              )}
              {/* 理由规则读不到：和共用确认框同一个样子，橙黄提示条；读取中写在字段名后面（OP-22、DT-22）。 */}
              {!recovering && thresholdRule.error && <div className="rd-confirm-alert" role="alert" data-policy-state="fail-closed"><Notice tone="warn">{thresholdRule.error}</Notice></div>}
              <Field label="操作理由" required hint={recovering ? undefined : thresholdRule.ready ? `至少 ${thresholdRule.min} 字` : thresholdRule.error ? undefined : "正在加载，稍候即可提交。"}
                error={!recovering && thresholdRule.ready && reason && !reasonValid && !thresholdLocked ? reasonHint : undefined}>
                <Textarea value={reason} disabled={thresholdLocked} rows={3} placeholder="例如：工单号、调整依据" count={!recovering && thresholdRule.ready ? `${reasonLength}/${thresholdRule.max}` : undefined} onChange={(event) => setReason(event.target.value)} />
              </Field>
            </div>
          </Modal>
        );
      })()}

      {subscriptionOpen && (canReadSubscription || subscriptionOriginal) && (() => {
        // 恢复原请求时，上面是冻结的原内容（重试只发它），现在的订阅读不到放在后面，不挡原内容。
        const subscriptionReadState = (
          <BlockState state={subscriptionLoading ? "loading" : "error"} title={subscriptionLoading ? "正在加载现在的订阅…" : subscriptionNext?.canRetry ? "现在的订阅没读到，不影响按原操作重试" : "现在的订阅没读到"} detail={subscriptionError || undefined}
            onRetry={subscriptionLoading ? undefined : () => setSubscriptionReload((value) => value + 1)} />
        );
        const subscriptionStale = subscriptionError && subscriptionReadAt;
        const subscriptionConflict = subscriptionDraftPreserved && !subscriptionOriginal && !subscriptionLoading && !subscriptionError;
        const subscriberNow = session?.username && (subscriptionOriginal?.facts.subscriber ?? subscriber) === maskAuditActor(session.username) ? "你" : subscriberText(subscriptionOriginal?.facts.subscriber ?? subscriber, subscriptionOriginal ? subscriptionOriginal.facts.subscriberDisplayName : subscriberDisplayName);
        // 只有查看权限：订阅状态写成只读事实，不放灰掉的勾选、输入和保存（OP-124、OP-125）；要什么权限只在标签的问号里说一次。
        if (!canSubscribe && !subscriptionOriginal) return (
          <Modal title="告警订阅" icon={BellRing} onClose={() => setSubscriptionOpen(false)}
            sub={<StatusTag tone="neutral" icon={Eye} explain="改接收人和发送渠道需要告警订阅权限。">只能查看</StatusTag>}
            footer={<Button onClick={() => setSubscriptionOpen(false)}>关闭</Button>}>
            <div className="b5-dialog">
              {!subscriptionReadAt && (subscriptionLoading || subscriptionError) && subscriptionReadState}
              {subscriptionStale && <StaleNotice stale={{ at: subscriptionStale, auto: false }} onRetry={() => setSubscriptionReload(value => value + 1)} />}
              {subscriptionReadAt && (
                <Facts>
                  <Fact k="现在的接收人">{subscriberNow}</Fact>
                  <Fact k="发送渠道">{subscriptionChannels(savedSubscription)}</Fact>
                </Facts>
              )}
            </div>
          </Modal>
        );
        return (
        <Modal title="告警订阅" icon={BellRing} busy={savingSubscription} dirty={subscriptionChannelsChanged}
          sub={<StatusTag tone="progress" filled>立即生效</StatusTag>}
          onClose={() => setSubscriptionOpen(false)}
          footer={<>
            <Button disabled={savingSubscription} onClick={() => setSubscriptionOpen(false)}>取消</Button>
            <Button variant="primary" loading={savingSubscription} loadingText="保存中…"
              disabledReason={!canSubscribe ? "需要告警订阅权限才能保存" : subscriptionNext ? subscriptionNext.block : subscriptionNeedsRead || subscriptionLoading ? "正在加载现在的订阅" : subscriptionError ? "现在的订阅没读到，不能保存" : !subscriptionChanged ? "还没有改动" : !subscriptionValid ? "至少开一个渠道" : undefined}
              onClick={() => void saveSubscription()}>{subscriptionOriginal ? "按原操作重试" : "保存订阅"}</Button>
          </>}>
          <div className="b5-dialog">
            {!subscriptionOriginal && !subscriptionReadAt && (subscriptionLoading || subscriptionError) && subscriptionReadState}
            {!subscriptionOriginal && subscriptionStale && <StaleNotice stale={{ at: subscriptionStale, auto: false }} onRetry={() => setSubscriptionReload(value => value + 1)} />}
            {(subscriptionOriginal || subscriptionReadAt) && (
              <>
                {subscriptionNext && subscriptionUnknown && (
                  <Notice tone="warn" title={subscriptionNext.kind === "rejected" ? RETRY_REJECTED_STATUS.label : "结果未知，可能已经生效"}>
                    {subscriptionNext.canRetry ? "下面是提交时的内容，已锁定。按原操作重试只发这一份，不会重复执行；也可以关掉后点「读取当前值」。"
                      : writeRecoveryLine(subscriptionNext, subscriptionReplay?.replayRejection)}
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
                  <Fact k={subscriptionOriginal ? "提交时的接收人" : "现在的接收人"}>{subscriberNow}</Fact>
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
        const length = visibleReasonLength(statusReason);
        const valid = statusRule.ok(statusReason);
        const hint = length < statusRule.min ? `操作理由还差 ${statusRule.min - length} 字`
          : length > statusRule.max ? `操作理由多了 ${length - statusRule.max} 字` : undefined;
        const busy = updatingSignal === alert.signalNo;
        const line = signalFacts(alert).line;
        const level = SEVERITY[alert.level];
        const statusChanged = statusRead.state === "changed" && !statusOriginal;
        const replay = statusOriginal && b5Recovery.state(statusOriginal);
        const next = replay && recoveryNext(replay);
        const rejected = next && next.kind === "rejected";
        const blocked = !canTriage ? READ_ONLY : next
          ? next.block
          : statusRead.state === "loading" ? "正在读取这条的当前进度…"
            : statusRead.state === "error" ? "这条的当前进度没读到"
              : statusRead.state === "conflict" ? "这条已被别人改过"
                : signalActionBlock(openSignal === alert.signalNo)
                  ?? (!statusRule.ready ? statusRule.error || "正在加载，稍候即可提交。" : valid ? undefined : hint);
        return (
          <Modal title={`标记${signalName(alert)}为${STATUS_TEXT[target]}`} icon={ShieldCheck} busy={busy} dirty={Boolean(statusReason.trim())}
            sub={<StatusTag tone="neutral" icon={FileText} explain="只更新这条信号的处理进度并留操作记录。不会解冻账户、不会放行提现、不会重发告警，也不改站内告警的已读。">只记录进度</StatusTag>}
            onClose={closeStatus}
            footer={statusChanged || rejected ? <Button onClick={closeStatus}>关闭</Button> : <>
              <Button disabled={busy} onClick={closeStatus}>取消</Button>
              <Button variant="primary" loading={busy} loadingText="提交中…" disabledReason={blocked}
                onClick={() => void changeSignalStatus()}>{statusUnknown ? "按原操作重试" : statusRead.state === "loading" ? "正在读取这条的当前进度…" : target === "handled" ? "确认标记已处理" : "确认标记已解决"}</Button>
            </>}>
            <div className="b5-dialog">
              {statusChanged ? <Notice tone="warn">这条已被别人改过，不用再标记。</Notice>
                : <p className="b5-line">不会解除风控，也不会放行提现；{handlingHint(triagePage(triageTarget(alert)), canFreeze)}</p>}
              <Facts>
                <Fact k="风险信号">{signalName(alert)}{line ? ` · ${line}` : ""}</Fact>
                <Fact k="级别"><StatusTag tone={levelTone(alert)} icon={level.icon}>{level.text}</StatusTag></Fact>
                <Fact k="用户"><span data-mono>{alert.userNo ?? `#${alert.userId}`}</span></Fact>
                <Fact k="信号号"><RefText value={alert.signalNo} /></Fact>
                <Fact k="记录时间">{timeText(alert.createdAt)}</Fact>
                <Fact k={statusChanged ? "最新进度" : "处理进度"}>{statusChanged ? HANDLING[alert.handlingStatus].text : <Change from={HANDLING[alert.handlingStatus].text} to={STATUS_TEXT[target]} />}</Fact>
              </Facts>
              {!statusChanged && !statusOriginal && statusRule.error && <div className="rd-confirm-alert" role="alert" data-policy-state="fail-closed"><Notice tone="warn">{statusRule.error}</Notice></div>}
              {!statusChanged && <Field label="操作理由" required hint={statusOriginal ? undefined : statusRule.ready ? `至少 ${statusRule.min} 字` : statusRule.error ? undefined : "正在加载，稍候即可提交。"}
                error={!statusOriginal && statusRule.ready && statusReason ? hint : undefined}>
                <Textarea value={statusReason} disabled={busy || statusUnknown}
                  rows={3} placeholder={isTamper(alert) ? "例如：已核对拦截记录，账户安全设置未改变" : "例如：已核对这条记录和账户近期操作"} count={statusRule.ready ? `${length}/${statusRule.max}` : undefined} onChange={(event) => setStatusReason(event.target.value)} />
              </Field>}
              {!statusOriginal && statusRead.state === "error" && <BlockState state="error" title="这条的当前进度没读到" detail={statusRead.error} onRetry={() => void loadStatus(statusDialog)} />}
              {!statusOriginal && statusRead.state === "conflict" && <Notice tone="warn">
                <ConflictBar message="这条已被别人改过" onRead={() => loadStatus(statusDialog, true)} />
              </Notice>}
              {next && statusUnknown ? <Notice tone="warn" title={rejected ? RETRY_REJECTED_STATUS.label : "结果未知，可能已经生效"}
                action={<Button size="sm" disabled={busy} loading={statusLookup?.state === "loading"} onClick={() => void readStatusCurrent()}>读取当前值</Button>}>
                <p>{next.canRetry ? `理由已锁住。「按原操作重试」用原单号重新发送，不会重复改；也可以点「读取当前值」看这一条现在的进度，读到已处理不等于是这次改的，${canAudit ? "到「操作记录与审批」核对。" : "请有「操作记录与审批」查看权限的同事按原操作核对。"}`
                  : writeRecoveryLine(next, replay?.replayRejection)}</p>
                {statusLookup?.state === "ready" ? <p>当前进度：{HANDLING[statusLookup.signal.handlingStatus].text}</p>
                  : statusLookup?.state === "error" ? <p>{statusLookup.code === "RISK_BACKEND_UNAVAILABLE"
                    // 共用的那句写着「已隐藏数据和操作按钮」，这里原操作还在：换成对得上的一句（不改共用错误字典）。
                    ? `风险服务暂时不可用，这条现在的进度没读到。${next.canRetry ? "原操作还在，可以稍后再读，或按原操作重试。" : "原操作记录还在，稍后再读。"}`
                    : statusLookup.error}</p> : null}
              </Notice> : statusError ? <Notice tone="danger" title="没有标记成功">{statusError}</Notice> : null}
            </div>
          </Modal>
        );
      })()}
      {releasingWrite && <ReleaseModal label="原风险提醒操作" onCancel={() => setReleasingWrite(null)} onConfirm={() => {
        if (!b5Recovery.releaseRejectedReplay(releasingWrite)) return;
        setReleasingWrite(null); syncPending(value => value + 1); setToast("已解除本页的原操作记录");
      }} />}
      {releasingApproval && pendingApproval && (
        <ReleaseModal onCancel={() => setReleasingApproval(false)} onConfirm={releaseApproval}
          label={`提高红线的审批 · 黄线 ${fmtConfigPct(pendingApproval.values.yellowPct)} · 红线 ${fmtConfigPct(pendingApproval.values.redPct)} · ${timeText(new Date(pendingApproval.createdAt).toISOString())}提交`}
          />
      )}
      {toastNode}
    </RdPage>
  );
}
