"use client";
import { m1CustomerCode } from "./m1-customer-code";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, ChevronLeft, ChevronRight, Clock3, MessageSquare, Moon, RefreshCw, Search, Users, UserRoundPlus, X } from "lucide-react";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { parseBusinessTime } from "@/lib/admin/business-time";
import { fetchMRecentAdvisorConversations, type MSupportAgent } from "@/lib/admin/m-client";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { supportClient, SupportClientError, isIndeterminateSupportError, type SupportAgentCandidate, type SupportCustomer, type SupportCustomerDetail, type SupportCustomerFilter, type SupportMaintenanceHistory, type SupportWorkbenchSnapshot } from "@/lib/admin/m-support-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { SupportSeatRoleModal } from "./m1-overview";
import "./m-support-workbench.css";
import "./m1-personal-workbench.css";
import { SupportBulkComposer } from "./support-bulk-composer";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { SelfAvatarEditor } from "./self-avatar-editor";
import { SelfInviteCodeBar } from "./m1-invite-code";
import { readTransferTargets } from "./m1-customer-transfer";
import { M1StatisticDetails, maintenanceLabels, beijing, type MaintenanceChoice, type StatisticSource } from "./m1-statistic-details";
import type { SelfAvatarSnapshot } from "@/lib/admin/a1-client";
import type { MCtx } from "./types";
import { PaymentSecurityBlock } from "@/app/components/payment-security/payment-security-block";
import { BlockState, Button, Check, Conclusion, Drawer, Explain, Facts, Fact, Field, FilterBar, FilterField, Fold, Input, Modal, Notice, PageTabs, Panel, Pager, Select, StatBand, Stat, StatusTag, Table, Th, Td, Tr, Textarea, Timeline, type StateTone } from "@/app/components/rd";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { paymentSecurityPorts } from "@/lib/admin/payment-password-client";

type Permission = "agent" | "supervisor" | "superadmin";
export type PersonalWorkbenchView = "dashboard" | "customers";
const PAGE_SIZE = 10;
const metricDefs = [
  { key: "boundCustomers", label: "绑定客户", filter: "ALL", icon: Users, hint: "当前归属的客户" },
  { key: "windowActiveCustomers", label: "活跃客户", filter: "WINDOW_ACTIVE", icon: Activity, hint: "按活动统计窗口计算" },
  { key: "dormantCustomers", label: "沉睡客户", filter: "DORMANT", icon: Moon, hint: "按沉睡判定天数计算" },
  { key: "dueMaintenanceCustomers", label: "待维护", filter: "DUE", icon: Clock3, hint: "需要主动联系的客户" },
  { key: "waitingReplyCustomers", label: "待专属客服回复", filter: "WAITING_REPLY", icon: MessageSquare, hint: "已读不会清除待回复" },
  { key: "firstContactCustomers", label: "首次待联系", filter: "FIRST_CONTACT", icon: UserRoundPlus, hint: "按本次归属计算" },
] as const;
const filters: Array<{ value: SupportCustomerFilter; label: string }> = [
  { value: "ALL", label: "全部客户" },
  { value: "TODO", label: "全部待办" },
  { value: "WINDOW_ACTIVE", label: "窗口活跃" },
  { value: "ACTIVE", label: "当前活跃" },
  { value: "DORMANT", label: "沉睡" },
  { value: "UNKNOWN", label: "状态未知" },
  { value: "DUE", label: "待维护" },
  { value: "WAITING_REPLY", label: "待专属客服回复" },
  { value: "FIRST_CONTACT", label: "首次待联系" },
  { value: "STOPPED", label: "暂停主动维护" },
];
type MaintenancePayload = { customerId: string; assignmentId: string; enabled: boolean; reason: string; expectedVersion: number };
type MaintenanceRecord = PendingMutationRecord & { actorId: number; payload: MaintenancePayload };
export const maintenanceCommands = createPendingMutationStore<MaintenanceRecord>({ storageKey: "nexion-admin-m-maintenance-v1", ttlMs: Math.floor(Number.MAX_SAFE_INTEGER / 2), retainExpiredRecords: true, isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload?.customerId && row.payload.assignmentId && row.payload.reason) });
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const ts = parseBusinessTime(value);
  return Number.isNaN(ts) ? "数据未同步" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "medium", timeStyle: "short" }).format(ts);
}
function errorText(error: unknown): string {
  if (isIndeterminateSupportError(error)) return "操作结果待确认，请稍后查询原命令。";
  if (error instanceof SupportClientError) {
    if (error.backendMessage && ADMIN_ERROR_MESSAGES[error.backendMessage]) return displayAdminError(error);
    if (error.status === 401) return "登录已失效，请重新登录后重试。";
    if (error.status === 403 || error.status === 404) return "当前无权查看该客户，归属可能已经变更。";
    if (error.status === 409) return "资料已变化，请刷新后重新确认。";
  }
  return "暂无法同步客服数据，请检查连接后重试。";
}
function labelForAccount(state: SupportCustomer["accountState"]): string {
  return state === "ACTIVE" ? "活跃" : state === "DORMANT" ? "沉睡" : "未知";
}
function labelForMaintenance(row: SupportCustomer): string {
  if (row.maintenanceEnabled === false) return "暂停主动维护";
  if (row.maintenanceStatus === "DUE") return "待维护";
  if (row.maintenanceStatus === "OPEN") return "等待后续活动";
  if (row.maintenanceStatus === "UNCONFIGURED" || row.maintenanceStatus === undefined) return "未配置或未同步";
  return "正常跟进";
}
const HISTORY_STATES: Record<string, string> = { OPEN: "进行中", SUCCEEDED: "已完成", STOPPED: "已暂停", TRANSFERRED: "已转由其他专属客服接手" };
const HISTORY_KINDS: Record<string, string> = { EXECUTION: "主动联系", MAINTENANCE_EXECUTION: "主动联系", CYCLE: "维护周期", MAINTENANCE_CYCLE: "维护周期" };
function historyLabel(value: string, labels: Record<string, string>): string { return labels[value] ?? "记录未同步"; }
function customerName(row: SupportCustomer): string { return operatorNicknameText(row.displayName || "") || m1CustomerCode(row.customerId); }
function invalidateCustomerOnDenied(customerId: string, error: unknown): boolean {
  if (!(error instanceof SupportClientError) || ![403, 404].includes(error.status)) return false;
  window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { customerId } }));
  return true;
}

export function M1PersonalWorkbench({ permission, ctx, view, onViewChange, primarySummary, navigation, active = true, onBrowseCustomers, onTransfer, transferRevision = 0 }: { permission: Permission; ctx: MCtx; view: PersonalWorkbenchView; onViewChange: (view: PersonalWorkbenchView) => void; primarySummary?: ReactNode; navigation?: ReactNode; active?: boolean; onBrowseCustomers?: (filter: SupportCustomerFilter) => void; onTransfer?: (customerId: string) => void; transferRevision?: number }) {
  const router = useRouter();
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const sessionKey = adminShellSessionKey(session, authEpoch);
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const operatorName = useAdminAuth((state) => state.operator || state.session?.operator || state.session?.username || "");
  const canBulk = useAdminAuth(state => state.session?.role==="super"||state.session?.role==="superadmin"||Boolean(state.session?.authorities.includes("service_m3_write")));
  const selfAgent = (() => { try { return (JSON.parse(ctx.pget("I.support.agents")??"[]") as SupportAgentCandidate[]).find(a=>a.adminId===adminId); } catch { return undefined; } })();
  const [selfAvatarSnapshot, setSelfAvatarSnapshot] = useState<SelfAvatarSnapshot | null>(null);
  // M-41: the workbench tabs own the view; this component only renders it.
  const setView = onViewChange;
  const [bulkOpen,setBulkOpen]=useState(false);
  const [snapshot, setSnapshot] = useState<SupportWorkbenchSnapshot | null>(null);
  const overview = snapshot?.overview ?? null;
  const [maintenanceChoice, setMaintenanceChoice] = useState<MaintenanceChoice | null>(null);
  const statSource = useMemo<StatisticSource | null>(() => overview && maintenanceChoice && (!maintenanceChoice.day || overview.performance.trend.some(day => day.day === maintenanceChoice.day))
    ? { kind: "maintenance", overview, choice: maintenanceChoice } : null, [overview, maintenanceChoice]);
  const rows = snapshot?.customers.available ? snapshot.customers : null;
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsRefresh, setRowsRefresh] = useState(0);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof fetchMRecentAdvisorConversations>> | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentRefresh, setRecentRefresh] = useState(0);
  const [filter, setFilter] = useState<SupportCustomerFilter>(() => { if (typeof window === "undefined") return "TODO"; const value = new URLSearchParams(window.location.search).get("filter"); return filters.find(x => x.value === value)?.value ?? "TODO"; });
  const [page, setPage] = useState(1);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportCustomerDetail | null>(null);
  const [detailActorKey, setDetailActorKey] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [history, setHistory] = useState<SupportMaintenanceHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [maintenanceAction, setMaintenanceAction] = useState<"stop" | "resume" | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [maintenanceNeedsRefresh, setMaintenanceNeedsRefresh] = useState(false);
  const [maintenancePending, setMaintenancePending] = useState<MaintenanceRecord | null>(null);
  // null while unchecked or unreadable: the dialog then gives the real answer. false hides the entry (BUG-040).
  const [transferInScope, setTransferInScope] = useState<boolean | null>(null);
  const detailsGeneration = useRef(0);
  const snapshotController = useRef<AbortController | null>(null);
  const recentController = useRef<AbortController | null>(null);
  const [maintenanceTab, setMaintenanceTab] = useState("summary");
  const [reasonLeft, setReasonLeft] = useState(false);
  const invalidateStatistic = useCallback((status: number) => {
    snapshotController.current?.abort();
    setSnapshot(null);
    if (status !== 409) setMaintenanceChoice(null);
    setNotice(status === 409 ? "统计已变化，已重新读取工作台和明细第一页。" : "查看权限已变化，已关闭明细并重新核对范围。");
    setRowsRefresh(n => n + 1);
  }, []);
  const paymentSecurityPort = useMemo(() => {
    if (!detail || detailLoading || detailError || detail.customerId !== detailId || detailActorKey !== sessionKey) return null;
    return paymentSecurityPorts.support(detail.customerId);
  }, [detail, detailLoading, detailError, detailId, detailActorKey, sessionKey]);

  useEffect(() => {
    setSelfAvatarSnapshot(null); setMaintenanceChoice(null);
    setDetailId(null); setDetail(null); setSnapshot(null);
  }, [authEpoch]);

  const personalSearchKey = `nexion-m1-personal-keyword:${adminId}`;
  useEffect(() => { try { const saved = sessionStorage.getItem(personalSearchKey) ?? ""; setKeyword(saved); setKeywordDraft(saved); } catch { /* Search still works without memory. */ } }, [personalSearchKey]);
  useEffect(() => { if (!active || view !== "customers") return; const url = new URL(window.location.href); url.searchParams.set("filter", filter); window.history.replaceState(null, "", url); try { sessionStorage.setItem(personalSearchKey, keyword); } catch { /* Search still works without memory. */ } }, [active, view, filter, keyword, personalSearchKey]);
  const conversationSnapshot = ctx.pget("I.session.convos");
  const priorConversationSnapshot = useRef(conversationSnapshot);
  useEffect(() => { if (priorConversationSnapshot.current === conversationSnapshot) return; priorConversationSnapshot.current = conversationSnapshot; setRowsRefresh(n => n + 1); setRecentRefresh(n => n + 1); }, [conversationSnapshot]);
  const activeFilter = view === "dashboard" ? "TODO" : filter;
  useEffect(() => {
    const controller = new AbortController();
    snapshotController.current = controller;
    setSnapshot(null); setRowsLoading(true); setOverviewLoading(true); setRowsError(null); setOverviewError(null);
    void supportClient.snapshot({ mode: "PERSONAL", pageNum: view === "dashboard" ? 1 : page, pageSize: view === "dashboard" ? 6 : PAGE_SIZE, keyword: view === "dashboard" ? undefined : keyword || undefined, filter: activeFilter, signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) { setSnapshot(next); if (!next.customers.available) setRowsError("当前筛选条件暂不可用，请调整服务规则后重试。"); } })
      .catch((error) => { if (!controller.signal.aborted) { setSnapshot(null); setRowsError(errorText(error)); setOverviewError(errorText(error)); } })
      .finally(() => { if (!controller.signal.aborted) { setRowsLoading(false); setOverviewLoading(false); } });
    return () => { controller.abort(); if (snapshotController.current === controller) snapshotController.current = null; };
  }, [authEpoch, view, page, keyword, activeFilter, rowsRefresh]);
  useEffect(() => {
    if (!adminId) { setRecent(null); return; }
    const controller = new AbortController();
    recentController.current = controller;
    setRecent(null); setRecentError(null);
    void fetchMRecentAdvisorConversations(adminId, controller.signal)
      .then((next) => { if (!controller.signal.aborted) setRecent(next); })
      .catch(() => { if (!controller.signal.aborted) setRecentError("最近会话暂无法同步，请稍后重试。"); });
    return () => { controller.abort(); if (recentController.current === controller) recentController.current = null; };
  }, [adminId, authEpoch, recentRefresh]);

  const openDetail = useCallback(async (customerId: string) => {
    const generation = ++detailsGeneration.current;
    const actorKey = actorStamp();
    const pending = maintenanceCommands.list().find((row) => row.actorId === adminId && row.payload.customerId === customerId) ?? null;
    setDetailId(customerId); setDetail(null); setHistory(null); setDetailLoading(true); setDetailError(null); setMaintenanceAction(null); setSaveError(pending ? "上次操作结果待确认，请先查询原命令。" : null); setReason(""); setMaintenancePending(pending);
    setTransferInScope(null); setMaintenanceNeedsRefresh(false);
    try {
      const next = await supportClient.customerDetail(customerId);
      if (detailsGeneration.current !== generation || actorStamp() !== actorKey) return;
      setDetail(next); setDetailActorKey(actorKey);
      if (permission !== "agent") void readTransferTargets(next.agentAdminId, "MANAGED").then((targets) => { if (detailsGeneration.current === generation) setTransferInScope(targets !== null); }).catch(() => undefined);
    }
    catch (error) { if (detailsGeneration.current === generation && !invalidateCustomerOnDenied(customerId, error)) setDetailError(errorText(error)); }
    finally { if (detailsGeneration.current === generation) setDetailLoading(false); }
  }, [adminId, permission]);
  const closeDetail = useCallback(() => {
    detailsGeneration.current += 1; setDetailId(null); setDetail(null); setHistory(null); setMaintenanceAction(null); setReason(""); setSaveError(null); setMaintenancePending(null); setTransferInScope(null); setMaintenanceNeedsRefresh(false);
  }, []);
  useEffect(() => { closeDetail(); }, [authEpoch, closeDetail]);
  // A finished transfer moves the customer away from this list; drop the open drawer and reload.
  useEffect(() => { if (transferRevision) { closeDetail(); setRowsRefresh((value) => value + 1); } }, [transferRevision, closeDetail]);
  useEffect(() => {
    const onScope = (event: Event) => {
      const customerId = (event as CustomEvent<{ customerId?: string }>).detail?.customerId;
      setMaintenanceChoice(null);
      if (!customerId || detailId === customerId) { closeDetail(); setNotice("客户归属已变化，详情已关闭。"); }
      snapshotController.current?.abort(); recentController.current?.abort();
      setSnapshot(null); setRowsRefresh((value) => value + 1);
      setRecent(null); setRecentRefresh((value) => value + 1);
    };
    window.addEventListener("support-scope-invalidated", onScope);
    return () => window.removeEventListener("support-scope-invalidated", onScope);
  }, [detailId, closeDetail]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const customerId = params.get("customerId");
    if (!customerId || !/^[1-9]\d*$/.test(customerId)) return;
    setView("customers"); setFilter("ALL"); setKeyword(customerId);
    void openDetail(customerId);
  }, [authEpoch, openDetail, permission]);
  useEffect(() => {
    const refreshPersonal = () => { setRowsRefresh(n => n + 1); setRecentRefresh(n => n + 1); };
    window.addEventListener("support-todo-changed", refreshPersonal);
    return () => window.removeEventListener("support-todo-changed", refreshPersonal);
  }, []);

  const showCustomers = (next: SupportCustomerFilter) => { setFilter(next); setPage(1); setView("customers"); };
  // M-54: opening a due customer from the maintenance to-do pre-selects the explicit 联系维护 intent (still changeable).
  const openChat = (customerId: string, maintenance = false) => router.push(`/service/sessions?customerId=${encodeURIComponent(customerId)}${maintenance ? "&intent=maintenance" : ""}`);
  const loadHistory = async (pageNum = 1) => {
    if (!detailId) return;
    const generation = detailsGeneration.current;
    setHistoryError(null); setHistoryLoading(true);
    if (pageNum === 1) setHistory(null);
    try {
      const result = await supportClient.maintenanceHistory(detailId, { pageNum, pageSize: 10 });
      if (detailsGeneration.current === generation) setHistory((old) => pageNum === 1 || !old ? result : { ...result, cycles: [...old.cycles, ...result.cycles], executions: [...old.executions, ...result.executions] });
    }
    catch (error) { if (detailsGeneration.current === generation && !invalidateCustomerOnDenied(detailId, error)) setHistoryError(errorText(error)); }
    finally { if (detailsGeneration.current === generation) setHistoryLoading(false); }
  };
  const reloadMaintenanceDetail = async () => {
    if (!detailId || saving || detailLoading) return;
    const generation = detailsGeneration.current, actor = actorStamp();
    setDetailLoading(true); setSaveError(null);
    try {
      const current = await supportClient.customerDetail(detailId);
      if (detailsGeneration.current !== generation || actorStamp() !== actor) return;
      setDetail(current); setDetailActorKey(actor); setMaintenanceNeedsRefresh(false);
    } catch (error) { if (detailsGeneration.current === generation && !invalidateCustomerOnDenied(detailId, error)) setSaveError(errorText(error)); }
    finally { if (detailsGeneration.current === generation) setDetailLoading(false); }
  };
  const saveMaintenance = async () => {
    if (!detail || !detail.assignmentId || !maintenanceAction || saving || detailLoading || maintenanceNeedsRefresh || maintenancePending || detail.agentAdminId !== adminId) return;
    const actor = actorStamp();
    const generation = detailsGeneration.current;
    const payload: MaintenancePayload = { customerId: detail.customerId, assignmentId: detail.assignmentId, enabled: maintenanceAction === "resume", reason: reason.trim(), expectedVersion: detail.maintenanceVersion };
    if (payload.reason.length < 8 || payload.reason.length > 200) return;
    const fingerprint = `maintenance:${payload.customerId}:${payload.assignmentId}:${payload.expectedVersion}:${payload.enabled}:${payload.reason}`;
    if (maintenanceCommands.list().some(row => row.actorId === adminId && row.payload.customerId === payload.customerId)) return;
    const key = crypto.randomUUID();
    maintenanceCommands.remember(fingerprint, key, { actorId: adminId, payload });
    if (!maintenanceCommands.isDurablyStored(fingerprint, key)) { maintenanceCommands.forget(fingerprint, key); setSaveError("暂时无法保存命令，未提交维护调整。请恢复浏览器存储后重试。"); return; }
    setMaintenancePending(maintenanceCommands.list().find((row) => row.commandKey === key) ?? null);
    setSaving(true); setSaveError(null);
    let acknowledged = false;
    try {
      const next = await supportClient.setMaintenance(payload.customerId, { enabled: payload.enabled, reason: payload.reason, expectedVersion: payload.expectedVersion, expectedAssignmentId: payload.assignmentId }, key);
      acknowledged = true;
      if (actor !== actorStamp()) return;
      if (next.customerId !== payload.customerId || next.assignmentId !== payload.assignmentId || next.enabled !== payload.enabled) throw new Error("MAINTENANCE_RESULT_MISMATCH");
      const current = await supportClient.customerDetail(payload.customerId);
      if (actor !== actorStamp()) return;
      if (current.customerId !== payload.customerId || current.assignmentId !== payload.assignmentId || current.maintenanceEnabled !== payload.enabled || current.maintenanceVersion <= payload.expectedVersion) throw new Error("MAINTENANCE_READBACK_MISMATCH");
      maintenanceCommands.forget(fingerprint, key);
      setMaintenancePending(null);
      window.dispatchEvent(new Event("support-todo-changed"));
      if (detailsGeneration.current === generation) { setMaintenanceAction(null); setReason(""); await openDetail(payload.customerId); }
      setRowsRefresh((value) => value + 1);
    } catch (error) {
      if (actor !== actorStamp()) return;
      if (!acknowledged && isExplicitRejection(error)) { maintenanceCommands.forget(fingerprint, key); setMaintenancePending(null); setMaintenanceNeedsRefresh(true); setSaveError(errorText(error)); return; }
      if (detailsGeneration.current === generation) {
        setNotice("操作结果尚未核对，原命令已保留。请查询原命令并核对当前授权资料。");
        closeDetail(); setSnapshot(null); setRowsRefresh(value => value + 1);
        invalidateCustomerOnDenied(payload.customerId, error);
      }
    } finally { setSaving(false); }
  };
  const checkMaintenance = async (record = maintenancePending) => {
    if (!record || saving || record.actorId !== adminId) return;
    const actor = actorStamp();
    let readingCustomer = false;
    setSaving(true);
    try {
      const result = await supportClient.command(record.commandKey);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED" || result.status === "FAILED") {
        readingCustomer = true;
        const current = await supportClient.customerDetail(record.payload.customerId);
        if (actor !== actorStamp() || record.actorId !== useAdminAuth.getState().session?.adminId) return;
        const matches = current.customerId === record.payload.customerId && current.assignmentId === record.payload.assignmentId && (result.status === "SUCCEEDED"
          ? current.maintenanceEnabled === record.payload.enabled && current.maintenanceVersion > record.payload.expectedVersion
          : current.maintenanceEnabled !== record.payload.enabled && current.maintenanceVersion === record.payload.expectedVersion);
        if (!matches) throw new Error("MAINTENANCE_RECOVERY_FACTS_CHANGED");
        maintenanceCommands.forget(record.fingerprint, record.commandKey); setMaintenancePending(null); setSaveError(null);
        window.dispatchEvent(new Event("support-todo-changed"));
        closeDetail(); setRowsRefresh((value) => value + 1); setNotice(result.status === "FAILED" ? "上次操作没有成功，请重新确认。" : "上次操作已确认，请查看最新资料。");
      } else setNotice("原操作仍待确认，请稍后继续查询。");
    } catch (error) { if (actor === actorStamp()) { closeDetail(); if (!readingCustomer || !invalidateCustomerOnDenied(record.payload.customerId, error)) setNotice("结果暂时无法核对，原命令与理由已保留；客户名单仍为上次读取的结果。"); } }
    finally { setSaving(false); }
  };
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [maintenancePending, saving]);
  const listRecords = rows?.records ?? [];
  const canMaintain = canBulk && Boolean(detail && detail.assignmentId && detail.agentAdminId === adminId);
  const pendingRecords = maintenanceCommands.list().filter(record => record.actorId === adminId);
  const todoTotal = view === "dashboard" && rows ? rows.total : null;
  const accountTone = (row: SupportCustomer): StateTone => row.accountState === "ACTIVE" ? "ok" : "done";
  const maintenanceTone = (row: SupportCustomer): StateTone => row.maintenanceEnabled === false ? "done" : row.maintenanceStatus === "DUE" ? "neutral" : row.maintenanceStatus === "OPEN" ? "progress" : "done";
  const trend = overview?.performance.trend;
  const trendMax = trend?.reduce((max, point) => Math.max(max, point.executionCount, point.successfulCycleCount), 1) ?? 1;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const actionFor = (row: SupportCustomer) => row.waitingReply ? "回复" : row.maintenanceEnabled && row.maintenanceStatus === "DUE" ? "联系维护" : "发起会话";
  const listState = rowsLoading ? <BlockState state="loading" title="正在加载客户列表…" /> : rowsError ? <BlockState state="error" title={rowsError} onRetry={() => setRowsRefresh(n => n + 1)} /> : !listRecords.length ? <BlockState state="empty" title="当前筛选下没有客户。可切换筛选或等待主管分配。" /> : null;

  return <section className="m1-personal" data-proof="s5a-workbench">
    {pendingRecords.map((record, index) => <Notice tone="warn" key={record.commandKey} action={<Button size="sm" disabled={saving} onClick={() => void checkMaintenance(record)}>查询维护结果 {index + 1}</Button>}>有维护操作结果待确认，原客户、理由与命令号已保留。</Notice>)}
    {notice && <Notice tone="warn" action={<Button size="sm" onClick={() => setNotice(null)}>关闭提示</Button>}>{notice}</Notice>}
    {view === "dashboard" && <>
      <div className="m1-identity-line"><SupportAvatar name={(selfAgent?.name ?? operatorName) || "本人专属客服"} path={selfAvatarSnapshot ? selfAvatarSnapshot.assetId ? "/api/admin/platform/accounts/self/avatar/content" : undefined : selfAgent?.avatarAssetId && adminId ? advisorAvatarPath(adminId) : undefined} version={selfAvatarSnapshot?.avatarVersion ?? selfAgent?.avatarVersion ?? undefined} />
        <strong>{(selfAgent?.name ?? operatorName) || "本人账号"}</strong><StatusTag tone="progress">专属客服</StatusTag>
        <SelfAvatarEditor name={selfAgent?.name ?? (operatorName || "本人账号")} ctx={ctx} onChanged={setSelfAvatarSnapshot} onSnapshot={setSelfAvatarSnapshot} />
      </div>
      <Fold title="我的邀请码" summary="生成、重置与分享" explain="注册时使用客服码建立专属客服绑定。重置会作废旧码，已有绑定保留。"><SelfInviteCodeBar key={sessionKey} toast={ctx.toast} /></Fold>
      <Conclusion state={pendingRecords.length ? "warn" : todoTotal === null ? "unknown" : "neutral"} hint={pendingRecords.length ? "先查询原操作。" : overview?.counts.waitingReplyCustomers ? "先打开待回复客户，继续处理会话。" : "从下方客户卡开始联系。"} explain="待办客户取同一 PERSONAL TODO 快照的去重总数。三类待办可能重叠，不能相加。">{pendingRecords.length ? "有操作结果待确认" : todoTotal === null ? "待办客户暂未读到" : todoTotal ? `有 ${todoTotal} 位待办客户` : "当前没有待办客户"}</Conclusion>
      {overviewError && <BlockState state="error" compact title={overviewError} onRetry={() => setRowsRefresh(n => n + 1)} />}
      <StatBand label="今日服务待办"><Stat label="待办客户" value={todoTotal ?? "—"} unit="位" lead icon={Users} onOpen={() => showCustomers("TODO")} explain="同一快照中按客户去重的待办总数。" />
        {([ ["waitingReplyCustomers", "待专属客服回复", "WAITING_REPLY", MessageSquare], ["firstContactCustomers", "首次待联系", "FIRST_CONTACT", UserRoundPlus], ["dueMaintenanceCustomers", "待维护", "DUE", Clock3] ] as const).map(([key, label, target, icon]) => <Stat key={key} label={label} value={overviewLoading ? "—" : overview?.counts[key] ?? "—"} unit="位" icon={icon} onOpen={() => showCustomers(target)} explain={key === "waitingReplyCustomers" ? "已读不会清除待回复，须由专属客服回复。" : key === "firstContactCustomers" ? "按当前绑定识别首次待联系。" : "需要主动联系的客户；暂停维护的客户不计入。"} />)}
      </StatBand>
      {navigation}
      <Panel title="待办客户" sub={rows ? `展示 ${listRecords.length} / ${rows.total} 位 · 北京时间` : "尚未读取"} explain="沿用服务端 TODO 顺序，优先处理待回复客户。" actions={<Button size="sm" onClick={() => showCustomers("TODO")}>查看全部</Button>}>
        {listState ?? <ul className="m1-todo-cards">{listRecords.map(row => <li key={row.customerId}>
          <div className="m1-todo-identity"><SupportAvatar name={customerName(row)} path={row.customerAvatarRef ?? undefined} /><div><Button variant="ghost" size="sm" onClick={() => void openDetail(row.customerId)}>{customerName(row)}</Button><span className="rd-note">{m1CustomerCode(row.customerId)}</span></div><Button size="sm" variant={row.waitingReply ? "primary" : "secondary"} onClick={() => openChat(row.customerId, !row.waitingReply && row.maintenanceEnabled && row.maintenanceStatus === "DUE")}>{actionFor(row)}</Button></div>
          <div className="m1-todo-status"><StatusTag tone={accountTone(row)}>{labelForAccount(row.accountState)}</StatusTag><StatusTag tone={maintenanceTone(row)}>{labelForMaintenance(row)}</StatusTag>{row.waitingReply && <StatusTag tone="neutral">待专属客服回复</StatusTag>}{row.maintenanceEnabled && row.firstContact && <StatusTag tone="neutral">首次待联系</StatusTag>}<span className="rd-note">当前归属本人</span></div>
        </li>)}</ul>}
      </Panel>
      <Fold title="最近会话" summary={recentError ? "读取失败" : recent === null ? "尚未读取" : `${recent.length} 条`} actions={<Button variant="ghost" size="sm" onClick={() => router.push("/service/sessions")}>查看会话</Button>}>
        {recentError ? <BlockState state="error" title={recentError} onRetry={() => setRecentRefresh(n => n + 1)} /> : recent === null ? <BlockState state="loading" title="正在读取…" /> : !recent.length ? <BlockState state="empty" title="暂无最近会话。可从本人客户列表发起联系。" /> : <ul className="m1-recent-list">{recent.map(item => <li key={item.conversationNo}><Button variant="ghost" onClick={() => router.push(`/service/sessions?conversationNo=${encodeURIComponent(item.conversationNo)}`)}>{operatorNicknameText(item.customerName || "") || m1CustomerCode(item.customerId)}</Button><span data-user-content>{item.lastMessageKind === "IMAGE" ? "[图片]" : item.lastMessage || "暂无消息预览"}</span><span className="rd-note">{formatTime(new Date(item.lastTs).toISOString())}{item.unreadCount > 0 ? ` · ${item.unreadCount} 条未读` : ""}</span></li>)}</ul>}
      </Fold>
      <Fold title="本人客户与期间业绩" summary={overview ? `截至 ${formatTime(overview.evaluatedAt)}` : "尚未读取"}>
        <Facts>{metricDefs.map(item => <Fact key={item.key} k={item.key === "windowActiveCustomers" && overview?.activityWindowDays ? `近 ${overview.activityWindowDays} 天活跃` : item.label}><Button variant="ghost" size="sm" onClick={() => showCustomers(item.filter)}>{overview?.counts[item.key] ?? "—"} 位</Button></Fact>)}</Facts>
        {overview && overview.unknownWindowCount > 0 && <Notice tone="warn">所选期间活跃已确认 {overview.knownActiveCount} 位，另有 {overview.unknownWindowCount} 位活动数据待确认；名单只列已确认客户。</Notice>}
        {primarySummary}
      </Fold>
      <Fold title="维护进展" summary={overview?.performance ? `已执行 ${overview.performance.executionCount} · 成功周期 ${overview.performance.successfulCycleCount}` : "尚未同步"} explain="执行后仍须出现新的真实账户活动才计成功。暂停主动维护不会解除专属客服归属或屏蔽求助。">
        <PageTabs level={2} label="维护进展内容" value={maintenanceTab} onChange={setMaintenanceTab} items={[{ value: "summary", label: "概况" }, { value: "daily", label: "逐日" }]} />
        <p className="rd-note">{overview?.performance ? `${beijing(overview.performance.from)} 至 ${beijing(overview.performance.to)}（北京时间）` : "统计区间待同步"}</p>
        {maintenanceTab === "summary" ? <Facts>{([ ["EXECUTION", overview?.performance.executionCount], ["SUCCESSFUL_CYCLE", overview?.performance.successfulCycleCount], ["SUCCESSFUL_CUSTOMER", overview?.performance.successfulCustomerCount], ["STOPPED", overview?.counts.stoppedMaintenanceCustomers] ] as const).map(([metric, count]) => <Fact k={maintenanceLabels[metric]} key={metric}><Button variant="ghost" disabled={count == null} onClick={() => setMaintenanceChoice({ metric })}>{count ?? "—"}</Button></Fact>)}</Facts> : trend?.length ? <>
          {!trend.some(point => point.executionCount || point.successfulCycleCount) && <p className="rd-note">这段时间暂无执行或成功周期。</p>}
          <figure className="s5a-trend m1-trend" aria-label="逐日维护执行与成功周期"><div className="s5a-trend-bars">{trend.map(point => <div key={point.day} className="s5a-trend-day"><div className="s5a-trend-pair">{([ ["EXECUTION", point.executionCount], ["SUCCESSFUL_CYCLE", point.successfulCycleCount] ] as const).map(([metric, count]) => { const barStyle = { height: count / trendMax * 100 + "%" }; return <Button variant="ghost" key={metric} className="m1-stat-bar" aria-label={`${point.day} ${maintenanceLabels[metric]} ${count}，查看明细`} onClick={() => setMaintenanceChoice({ metric, day: point.day })}><i style={barStyle} /></Button>; })}</div><small>{point.day.slice(5)}</small><div className="m1-trend-values">{([ ["EXECUTION", point.executionCount], ["SUCCESSFUL_CYCLE", point.successfulCycleCount] ] as const).map(([metric, count]) => <Button key={metric} variant="ghost" size="sm" aria-label={`${point.day} ${maintenanceLabels[metric]} ${count}，查看明细`} onClick={() => setMaintenanceChoice({ metric, day: point.day })}>{count}</Button>)}</div></div>)}</div><figcaption className="rd-note">执行次数 / 成功周期；每个业务日的 0 次也可核对。</figcaption></figure>
        </> : <BlockState state="empty" title="趋势数据尚未同步。" />}
      </Fold>
      {statSource && <M1StatisticDetails key={overview?.snapshotId} source={statSource} onClose={() => setMaintenanceChoice(null)} onInvalid={invalidateStatistic} />}
    </>}
    {view === "customers" && <Panel title="我的客户" sub={rows ? `共 ${rows.total} 位 · 北京时间` : "总数待确认"} actions={canBulk ? <Button onClick={() => setBulkOpen(true)}>圈选群发</Button> : undefined}>
      {permission !== "agent" && <Fold title="我的邀请码" summary="生成、重置与分享"><SelfInviteCodeBar key={sessionKey} toast={ctx.toast} /></Fold>}
      <FilterBar onSubmit={() => { setPage(1); setKeyword(keywordDraft.trim()); }} onClear={() => { setFilter("ALL"); setKeyword(""); setKeywordDraft(""); setPage(1); }} canClear={filter !== "ALL" || Boolean(keyword)} action={<Button type="submit">搜索</Button>}>
        <FilterField label="客户" grow><Input aria-label="搜索客户名称或编码" value={keywordDraft} onChange={e => setKeywordDraft(e.target.value)} placeholder="客户名称或编码" /></FilterField>
        <FilterField label="服务状态"><Select aria-label="筛选客户" value={filter} options={filters} onChange={value => { setFilter(value as SupportCustomerFilter); setPage(1); }} /></FilterField>
      </FilterBar>
      {listState ?? <Table label="我的客户" className="m1-personal-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><Tr><Th>客户</Th><Th>上次活动</Th><Th>账户状态</Th><Th>维护状态</Th><Th>待办</Th><Th sticky="end">操作</Th></Tr></thead><tbody>{listRecords.map(row => <Tr key={row.customerId} selected={row.customerId === detailId}><Td><div className="m1-customer-name"><SupportAvatar name={customerName(row)} path={row.customerAvatarRef ?? undefined} /><div><Button variant="ghost" size="sm" onClick={() => void openDetail(row.customerId)}>{customerName(row)}</Button><span className="rd-note">{m1CustomerCode(row.customerId)}</span></div></div></Td><Td><span title={formatTime(row.lastEffectiveAt)} tabIndex={0}>{row.lastEffectiveAt ? beijing(row.lastEffectiveAt).slice(5) : "—"}</span></Td><Td><StatusTag tone={accountTone(row)}>{labelForAccount(row.accountState)}</StatusTag></Td><Td><StatusTag tone={maintenanceTone(row)}>{labelForMaintenance(row)}</StatusTag></Td><Td><span>{row.waitingReply ? "待回复" : ""}</span><span className="rd-note">{row.maintenanceEnabled && row.firstContact ? "首次待联系" : row.maintenanceEnabled && row.maintenanceStatus === "DUE" ? "待维护" : row.waitingReply ? "" : "—"}</span></Td><Td sticky="end"><Button size="sm" onClick={() => openChat(row.customerId, !row.waitingReply && row.maintenanceEnabled && row.maintenanceStatus === "DUE")}>{actionFor(row)}</Button></Td></Tr>)}</tbody></Table>}
      {rows && rows.total > 0 && <Pager label="我的客户" total={rows.total} page={page} pageSize={PAGE_SIZE} sizes={[PAGE_SIZE]} onPage={setPage} onPageSize={() => undefined} />}
    </Panel>}
    {bulkOpen && <SupportBulkComposer ctx={ctx} onClose={() => setBulkOpen(false)} />}
    {detailId && <Drawer open title="客户资料" sub={detail ? `${customerName(detail)} · ${m1CustomerCode(detail.customerId)}` : "正在读取"} busy={saving} onClose={closeDetail} footer={detail && <div className="m1-drawer-actions"><Button onClick={() => openChat(detail.customerId)}>联系客户</Button>{canMaintain && <Button disabledReason={maintenancePending ? "原操作结果待确认，请先查询。" : undefined} onClick={() => { setMaintenanceAction(detail.maintenanceEnabled ? "stop" : "resume"); setReason(""); setReasonLeft(false); setSaveError(null); }}>{detail.maintenanceEnabled ? "不再维护" : "恢复维护"}</Button>}{permission !== "agent" && detail.assignmentId && transferInScope !== false && <Button onClick={() => onTransfer?.(detail.customerId)}>正式转绑客户</Button>}</div>}>
      {detailLoading ? <BlockState state="loading" title="正在读取…" /> : detailError ? <BlockState state="error" title={detailError} onRetry={() => void openDetail(detailId)} /> : detail && <>
        <div className="m1-customer-name"><SupportAvatar name={customerName(detail)} path={detail.customerAvatarRef ?? undefined} /><strong>{customerName(detail)}</strong></div>
        <Facts><Fact k="当前专属客服">{detail.agentName ?? "资料未知"}</Fact><Fact k="客户编码">{m1CustomerCode(detail.customerId)}</Fact><Fact k="账户状态"><StatusTag tone={accountTone(detail)}>{labelForAccount(detail.accountState)}</StatusTag></Fact><Fact k="维护状态"><StatusTag tone={maintenanceTone(detail)}>{labelForMaintenance(detail)}</StatusTag></Fact><Fact k="上次账户活动">{formatTime(detail.lastEffectiveAt)}</Fact><Fact k="下次维护">{formatTime(detail.nextMaintenanceAt)}</Fact></Facts>
        {paymentSecurityPort && <PaymentSecurityBlock key={`${sessionKey}|${paymentSecurityPort.key}`} port={paymentSecurityPort} userLabel={customerName(detail)} canRelease={Boolean(session?.authorities.includes("user_c5_payment_password_release"))} />}
        {maintenancePending && <Notice tone="warn" action={<Button disabled={saving} onClick={() => void checkMaintenance()}>核对维护原操作</Button>}>这位客户有维护操作结果待确认，暂不能再次调整维护；原客户、理由与命令号已保留。</Notice>}
        {detail.accountState === "UNKNOWN" && <Notice tone="warn">账户活动数据不完整，无法判断沉睡或活跃。</Notice>}
        <Button variant="ghost" onClick={() => router.push(`/service/customers/${detail.customerId}?source=M1&returnTo=/service/overview`)}>查看完整客户档案</Button>
        <Fold title="维护记录" summary={history ? `周期 ${history.totalCycles} · 主动联系 ${history.totalExecutions}` : historyError ? "读取失败" : "尚未读取"} onOpenChange={open => { if (open && !history && !historyLoading) void loadHistory(); }}>
          <Button size="sm" disabled={historyLoading} onClick={() => void loadHistory()}>查看维护记录</Button>{historyError && <Notice tone="danger">{historyError}</Notice>}
          {history && <><Timeline entries={[...history.cycles, ...history.executions].map(item => ({ id: `${item.kind}:${item.id}`, action: historyLabel(item.kind, HISTORY_KINDS), actor: item.agentAdminId ? `客服账号 ${item.agentAdminId}` : "操作人未提供", at: item.occurredAt, detail: item.state ? historyLabel(item.state, HISTORY_STATES) : undefined }))} />{(history.cycles.length < history.totalCycles || history.executions.length < history.totalExecutions) && <Button disabled={historyLoading} onClick={() => void loadHistory(history.pageNum + 1)}>加载更多维护记录</Button>}</>}
        </Fold>
        <Fold title="技术信息" summary="客户、绑定与维护版本"><Facts><Fact k="客户编号">{detail.customerId}</Fact><Fact k="绑定编号">{detail.assignmentId || "—"}</Fact><Fact k="维护版本">{detail.maintenanceVersion}</Fact></Facts></Fold>
      </>}
    </Drawer>}
    {maintenanceAction && detail && <Modal title={maintenanceAction === "stop" ? "不再维护" : "恢复维护"} busy={saving} onClose={() => setMaintenanceAction(null)} footer={<><Button disabled={saving} onClick={() => setMaintenanceAction(null)}>取消</Button><Button variant="primary" disabled={saving} disabledReason={maintenancePending ? "先查询原操作" : maintenanceNeedsRefresh ? "请先重新读取客户资料" : detailLoading ? "正在重新读取客户资料" : !canMaintain ? "当前客户不再属于本人" : !reasonOk ? "请填写 8–200 字理由" : undefined} onClick={() => void saveMaintenance()}>{saving ? "提交中…" : maintenanceAction === "stop" ? "确认不再维护" : "确认恢复维护"}</Button></>}>
      <div className="m1-command-form">
      <Facts><Fact k="客户">{customerName(detail)} · {m1CustomerCode(detail.customerId)}</Fact><Fact k="当前专属客服">{detail.agentName || "本人"}</Fact><Fact k="维护状态">{detail.maintenanceEnabled ? "主动维护" : "暂停主动维护"} → {maintenanceAction === "stop" ? "暂停主动维护" : "主动维护"}</Fact></Facts>
      <p>{maintenanceAction === "stop" ? "仅停止主动跟进，客户归属、私聊与求助保持可用。" : "旧周期不恢复，不自动产生执行或成功。"}</p>
      <Field label="操作理由" required help="请填写 8–200 字，将记入操作记录。" error={reasonLeft && !reasonOk ? "请填写 8–200 字的理由。" : undefined}>{control => <Textarea {...control} value={reason} maxLength={200} disabled={saving || Boolean(maintenancePending)} count={`${reason.trim().length}/200`} onBlur={() => setReasonLeft(true)} onChange={e => setReason(e.target.value)} />}</Field>
      {saveError && <Notice tone="danger">{saveError}</Notice>}{maintenanceNeedsRefresh && <Button disabled={saving || detailLoading} onClick={() => void reloadMaintenanceDetail()}>重新读取客户资料</Button>}{maintenancePending && <Notice tone="warn" action={<Button disabled={saving} onClick={() => void checkMaintenance()}>查询原操作</Button>}>上次结果待确认，原理由与命令号已保留。</Notice>}
      </div>
    </Modal>}
  </section>;
}

/** M-41: 客服资格 entry for the 客服与分组 tab; opens the A1 seat-role dialog for supervisors and the super admin. */
export function SupportSeatRolesButton({ permission, ctx }: { permission: Permission; ctx: MCtx }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const operatorName = useAdminAuth((state) => state.operator || state.session?.operator || state.session?.username || "");
  const canManageSupportSeats = useAdminAuth((state) => state.session?.role === "super" || state.session?.role === "superadmin" || Boolean(state.session?.authorities.includes("service_m1_write"))) && permission !== "agent";
  const supportAgentsAvailable = ctx.pget("I.support.agentsAvailable") === "1";
  const supportAgentsPending = !supportAgentsAvailable && ctx.pget("I.support.agentsError") === "none";
  const seatAssignmentAgents = useMemo(() => {
    try {
      const agents = JSON.parse(ctx.pget("I.support.agents") ?? "[]") as MSupportAgent[];
      return Array.isArray(agents) ? agents.filter((agent) => agent.adminId > 0 && agent.assignmentEligible === true) : [];
    } catch { return []; }
  }, [ctx.params, ctx.pget]);
  const [showSeatRoles, setShowSeatRoles] = useState(false);
  if (permission === "agent") return null;
  return <>
    <button
      type="button"
      data-proof="m1-seat-role-entry"
      disabled={!canManageSupportSeats || !supportAgentsAvailable}
      title={!canManageSupportSeats ? "只有总管理员或客服主管可以分配坐席" : supportAgentsPending ? "坐席数据正在同步，请稍候" : !supportAgentsAvailable ? "坐席数据暂不可用，请刷新后重试" : "去「运营账号与权限」设置接待资格和主管资格"}
      onClick={() => { if (canManageSupportSeats && supportAgentsAvailable) setShowSeatRoles(true); }}
    >客服资格</button>
    {showSeatRoles && canManageSupportSeats && <SupportSeatRoleModal
      ctx={ctx}
      operatorName={operatorName}
      currentRole={String(currentRole)}
      currentAdminId={adminId ?? 0}
      agents={supportAgentsAvailable ? seatAssignmentAgents : []}
      canManage={canManageSupportSeats && supportAgentsAvailable}
      onClose={() => setShowSeatRoles(false)}
    />}
  </>;
}
