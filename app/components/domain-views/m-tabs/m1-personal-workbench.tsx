"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, ChevronLeft, ChevronRight, Clock3, MessageSquare, Moon, RefreshCw, Search, Users, UserRoundPlus, X } from "lucide-react";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { parseBusinessTime } from "@/lib/admin/business-time";
import { fetchMRecentAdvisorConversations, type MSupportAgent } from "@/lib/admin/m-client";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { supportClient, verifySupportTransfer, SupportClientError, isIndeterminateSupportError, type SupportAgentCandidate, type SupportCustomer, type SupportCustomerDetail, type SupportCustomerFilter, type SupportMaintenanceHistory, type SupportWorkbenchSnapshot } from "@/lib/admin/m-support-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { M1SupervisorPool } from "./m1-supervisor-pool";
import { SupportSeatRoleModal } from "./m1-overview";
import "./m-support-workbench.css";
import { SupportBulkComposer } from "./support-bulk-composer";
import { SupportAvatar, advisorAvatarPath, customerAvatarPath } from "./support-avatar";
import { SelfAvatarEditor } from "./self-avatar-editor";
import type { SelfAvatarSnapshot } from "@/lib/admin/a1-client";
import type { MCtx } from "./types";

type Permission = "agent" | "supervisor" | "superadmin";
type View = "dashboard" | "customers" | "pool";
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
const maintenanceCommands = createPendingMutationStore<MaintenanceRecord>({ storageKey: "nexion-admin-m-maintenance-v1", ttlMs: Math.floor(Number.MAX_SAFE_INTEGER / 2), retainExpiredRecords: true, isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload?.customerId && row.payload.assignmentId && row.payload.reason) });
type TransferPayload = Parameters<typeof supportClient.transfer>[0];
type TransferRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; payload: TransferPayload };
const transferCommands = createPendingMutationStore<TransferRecord>({ storageKey: "nexion-admin-m-transfer-v1", ttlMs: Math.floor(Number.MAX_SAFE_INTEGER / 2), retainExpiredRecords: true, isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Array.isArray(row.payload.customers)) });
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };

function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const ts = parseBusinessTime(value);
  return Number.isNaN(ts) ? "数据待核对" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(ts);
}
function errorText(error: unknown): string {
  if (isIndeterminateSupportError(error)) return "操作结果待确认，请查询原命令请稍后继续查询。";
  if (error instanceof SupportClientError) {
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
  if (row.maintenanceStatus === "UNCONFIGURED" || row.maintenanceStatus === undefined) return "未配置或待核对";
  return "正常跟进";
}
const HISTORY_STATES: Record<string, string> = { OPEN: "进行中", SUCCEEDED: "已完成", STOPPED: "已暂停", TRANSFERRED: "已转由其他专属客服接手" };
const HISTORY_KINDS: Record<string, string> = { EXECUTION: "主动联系", MAINTENANCE_EXECUTION: "主动联系", CYCLE: "维护周期", MAINTENANCE_CYCLE: "维护周期" };
function historyLabel(value: string, labels: Record<string, string>): string { return labels[value] ?? "记录待核对"; }
function customerName(row: SupportCustomer): string { return row.displayName || row.customerNo || `客户 ${row.customerId}`; }
function invalidateCustomerOnDenied(customerId: string, error: unknown): boolean {
  if (!(error instanceof SupportClientError) || ![403, 404].includes(error.status)) return false;
  window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { customerId } }));
  return true;
}

export function M1PersonalWorkbench({ permission, ctx }: { permission: Permission; ctx: MCtx }) {
  const router = useRouter();
  const authEpoch = useAdminAuth((state) => state.authEpoch);
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
  const canBulk = useAdminAuth(state => state.session?.role==="super"||state.session?.role==="superadmin"||Boolean(state.session?.authorities.includes("service_m3_write")));
  const selfAgent = (() => { try { return (JSON.parse(ctx.pget("I.support.agents")??"[]") as SupportAgentCandidate[]).find(a=>a.adminId===adminId); } catch { return undefined; } })();
  const [selfAvatarSnapshot, setSelfAvatarSnapshot] = useState<SelfAvatarSnapshot | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [bulkOpen,setBulkOpen]=useState(false);
  const [showSeatRoles, setShowSeatRoles] = useState(false);
  const [snapshot, setSnapshot] = useState<SupportWorkbenchSnapshot | null>(null);
  const overview = snapshot?.overview ?? null;
  const rows = snapshot?.customers ?? null;
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(true);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsRefresh, setRowsRefresh] = useState(0);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof fetchMRecentAdvisorConversations>> | null>(null);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentRefresh, setRecentRefresh] = useState(0);
  const [filter, setFilter] = useState<SupportCustomerFilter>("TODO");
  const [page, setPage] = useState(1);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keyword, setKeyword] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportCustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [history, setHistory] = useState<SupportMaintenanceHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [maintenanceAction, setMaintenanceAction] = useState<"stop" | "resume" | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [maintenancePending, setMaintenancePending] = useState<MaintenanceRecord | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferAgents, setTransferAgents] = useState<SupportAgentCandidate[]>([]);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [transferReason, setTransferReason] = useState("");
  const [transferError, setTransferError] = useState("");
  const [transferAgentsError, setTransferAgentsError] = useState(false);
  const [transferSaving, setTransferSaving] = useState(false);
  const [transferPending, setTransferPending] = useState<TransferRecord | null>(null);
  const detailsGeneration = useRef(0);
  const snapshotController = useRef<AbortController | null>(null);
  const recentController = useRef<AbortController | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelfAvatarSnapshot(null);
    setDetailId(null); setDetail(null); setSnapshot(null);
  }, [authEpoch]);
  useEffect(() => { if (permission !== "agent" && new URLSearchParams(window.location.search).get("view") === "pool") setView("pool"); }, [permission]);

  const activeFilter = view === "dashboard" ? "TODO" : filter;
  useEffect(() => {
    if (view === "pool") return;
    const controller = new AbortController();
    snapshotController.current = controller;
    setSnapshot(null); setRowsLoading(true); setOverviewLoading(true); setRowsError(null); setOverviewError(null);
    void supportClient.snapshot({ pageNum: view === "dashboard" ? 1 : page, pageSize: view === "dashboard" ? 6 : PAGE_SIZE, keyword: view === "dashboard" ? undefined : keyword || undefined, filter: activeFilter, signal: controller.signal })
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
    const pending = maintenanceCommands.list().find((row) => row.actorId === adminId && row.payload.customerId === customerId) ?? null;
    setDetailId(customerId); setDetail(null); setHistory(null); setDetailLoading(true); setDetailError(null); setMaintenanceAction(null); setSaveError(pending ? "上次操作结果待确认，请先查询原命令。" : null); setReason(""); setMaintenancePending(pending);
    try { const next = await supportClient.customerDetail(customerId); if (detailsGeneration.current === generation) setDetail(next); }
    catch (error) { if (detailsGeneration.current === generation && !invalidateCustomerOnDenied(customerId, error)) setDetailError(errorText(error)); }
    finally { if (detailsGeneration.current === generation) setDetailLoading(false); }
  }, [adminId]);
  const closeDetail = useCallback(() => {
    detailsGeneration.current += 1; setDetailId(null); setDetail(null); setHistory(null); setMaintenanceAction(null); setReason(""); setSaveError(null); setMaintenancePending(null); setTransferOpen(false); setTransferAgents([]); setTransferTarget(null); setTransferPending(null);
  }, []);
  useEffect(() => { closeDetail(); }, [authEpoch, closeDetail]);
  useEffect(() => {
    const onScope = (event: Event) => {
      const customerId = (event as CustomEvent<{ customerId?: string }>).detail?.customerId;
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
    if (params.get("view") === "pool" && permission !== "agent") { setView("pool"); return; }
    const customerId = params.get("customerId");
    if (!customerId || !/^[1-9]\d*$/.test(customerId)) return;
    setView("customers"); setFilter("ALL"); setKeyword(customerId);
    void openDetail(customerId);
  }, [authEpoch, openDetail, permission]);
  useEffect(() => {
    if (!detailId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { closeDetail(); return; }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [detailId, closeDetail]);

  const showCustomers = (next: SupportCustomerFilter) => { setFilter(next); setPage(1); setView("customers"); };
  const openChat = (customerId: string) => router.push(`/service/sessions?customerId=${encodeURIComponent(customerId)}`);
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
  const saveMaintenance = async () => {
    if (!detail || !detail.assignmentId || !maintenanceAction || saving || maintenancePending || detail.agentAdminId !== adminId) return;
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
    try {
      const next = await supportClient.setMaintenance(payload.customerId, { enabled: payload.enabled, reason: payload.reason, expectedVersion: payload.expectedVersion, expectedAssignmentId: payload.assignmentId }, key);
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
    setSaving(true);
    try {
      const result = await supportClient.command(record.commandKey);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED" || result.status === "FAILED") {
        const current = await supportClient.customerDetail(record.payload.customerId);
        if (actor !== actorStamp() || record.actorId !== useAdminAuth.getState().session?.adminId) return;
        const matches = current.customerId === record.payload.customerId && current.assignmentId === record.payload.assignmentId && (result.status === "SUCCEEDED"
          ? current.maintenanceEnabled === record.payload.enabled && current.maintenanceVersion > record.payload.expectedVersion
          : current.maintenanceEnabled !== record.payload.enabled && current.maintenanceVersion === record.payload.expectedVersion);
        if (!matches) throw new Error("MAINTENANCE_RECOVERY_FACTS_CHANGED");
        maintenanceCommands.forget(record.fingerprint, record.commandKey); setMaintenancePending(null); setSaveError(null);
        window.dispatchEvent(new Event("support-todo-changed"));
        closeDetail(); setRowsRefresh((value) => value + 1); setNotice(result.status === "FAILED" ? "原操作已失败，当前资料已核对，请重新确认。" : "原操作已核对，请读取当前资料。");
      } else setNotice("原操作仍待确认，请稍后继续查询。");
    } catch { if (actor === actorStamp()) { closeDetail(); setSnapshot(null); setNotice("结果暂时无法核对，原命令与理由已保留。"); } }
    finally { setSaving(false); }
  };
  const loadTransferAgents = async () => {
    const actor = actorStamp();
    setTransferAgents([]); setTransferLoading(true); setTransferError(""); setTransferAgentsError(false);
    try {
      const first = await supportClient.agents({ pageNum: 1, pageSize: 100 });
      if (actor !== actorStamp()) return;
      const pages = [first];
      for (let pageNum = 2; (pageNum - 1) * 100 < first.total; pageNum++) { pages.push(await supportClient.agents({ pageNum, pageSize: 100 })); if (actor !== actorStamp()) return; }
      setTransferAgents(pages.flatMap((page) => page.records));
    } catch (error) { if (actor === actorStamp()) { setTransferAgents([]); setTransferTarget(null); setTransferAgentsError(true); setTransferError(errorText(error)); } }
    finally { if (actor === actorStamp()) setTransferLoading(false); }
  };
  const openTransfer = async () => {
    if (!detail || permission === "agent") return;
    setTransferOpen(true);
    const existing = transferCommands.list().find((row) => row.actorId === adminId && row.payload.customers.some((item) => item.id === detail.customerId));
    if (existing) { closeDetail(); setNotice("原转绑尚未核对，请通过查询原命令继续核对。"); return; }
    setTransferPending(null);
    setTransferTarget(null);
    setTransferReason("");
    await loadTransferAgents();
  };
  const submitTransfer = async () => {
    if (!detail || !detail.assignmentId || !adminId || permission === "agent" || transferSaving || transferPending) return;
    const actor = actorStamp();
    const target = transferAgents.find((agent) => agent.adminId === transferTarget && agent.assignmentEligible === true);
    if (!transferPending && (!target || transferReason.trim().length < 8 || transferReason.trim().length > 200)) return;
    const payload: TransferPayload = { targetAgentAdminId: target!.adminId, customers: [{ id: detail.customerId, expectedAssignmentId: detail.assignmentId, expectedVersion: detail.assignmentVersion }], reason: transferReason.trim() };
    const fingerprint = `bound-transfer:${detail.customerId}:${detail.assignmentId}:${detail.assignmentVersion}`;
    if (transferCommands.list().some(row => row.actorId === adminId && row.payload.customers.some(item => item.id === detail.customerId))) return;
    const commandKey = crypto.randomUUID();
    transferCommands.remember(fingerprint, commandKey, { actorId: adminId, payload });
    if (!transferCommands.isDurablyStored(fingerprint, commandKey)) { transferCommands.forget(fingerprint, commandKey); setTransferError("暂时无法保存命令，未提交转绑。请恢复浏览器存储后重试。"); return; }
    setTransferSaving(true); setTransferError("");
    try {
      await supportClient.transfer(payload, commandKey);
      if (actor !== actorStamp()) return;
      await verifySupportTransfer(payload, "SUCCEEDED");
      if (actor !== actorStamp()) return;
      transferCommands.forget(fingerprint, commandKey); setTransferPending(null); setTransferOpen(false); closeDetail();
      window.dispatchEvent(new Event("support-todo-changed")); setRowsRefresh((value) => value + 1);
    } catch (error) {
      if (actor !== actorStamp()) return;
      closeDetail(); setSnapshot(null); setRowsRefresh(value => value + 1); setNotice("转绑结果尚未核对，原命令已保留。请查询原命令并核对当前授权资料。");
    } finally { setTransferSaving(false); }
  };
  const checkTransfer = async (record = transferPending) => {
    if (!record || transferSaving || record.actorId !== adminId) return;
    const actor = actorStamp();
    setTransferSaving(true);
    try {
      const result = await supportClient.command(record.commandKey);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED" || result.status === "FAILED") {
        await verifySupportTransfer(record.payload, result.status);
        if (actor !== actorStamp() || record.actorId !== useAdminAuth.getState().session?.adminId) return;
        transferCommands.forget(record.fingerprint, record.commandKey); setTransferPending(null); closeDetail(); setRowsRefresh((value) => value + 1); setNotice(result.status === "FAILED" ? "原转绑已失败，当前资料已核对，请重新确认。" : "原转绑已核对，请读取当前资料。");
      } else setNotice("原转绑仍待确认，请稍后继续查询。");
    } catch { if (actor === actorStamp()) { closeDetail(); setSnapshot(null); setNotice("结果暂时无法核对，原命令和客户范围已保留。"); } }
    finally { setTransferSaving(false); }
  };
  const metrics = useMemo(() => metricDefs.map((item) => ({ ...item, count: overview?.counts[item.key] ?? null })), [overview]);
  const listRecords = rows?.records ?? [];
  const totalPages = rows ? Math.max(1, Math.ceil(rows.total / rows.pageSize)) : 1;
  const canMaintain = Boolean(detail && detail.assignmentId && detail.agentAdminId === adminId);
  const trend = overview?.performance?.trend;
  const trendMax = trend?.reduce((max, point) => Math.max(max, point.executionCount, point.successfulCycleCount), 1) ?? 1;

  return <section className="s5a" data-proof="s5a-workbench">
    {maintenanceCommands.list().filter(record => record.actorId === adminId).map((record, index) => <p className="s5a-note" key={record.commandKey}>存在未核对的维护操作。<button type="button" disabled={saving} onClick={() => void checkMaintenance(record)}>查询维护结果 {index + 1}</button></p>)}
    {transferCommands.list().filter(record => record.actorId === adminId).map((record, index) => <p className="s5a-note" key={record.commandKey}>存在未核对的转绑操作。<button type="button" disabled={transferSaving} onClick={() => void checkTransfer(record)}>查询转绑结果 {index + 1}</button></p>)}
    {notice && <div className="s5a-alert" role="alert">{notice}<button type="button" onClick={() => setNotice(null)}>关闭提示</button></div>}
    <nav className="s5a-nav" aria-label="客服工作区">
      <button type="button" className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>工作台</button>
      <button type="button" className={view === "customers" ? "active" : ""} onClick={() => showCustomers("ALL")}>我的客户</button>
      <button type="button" disabled={!canBulk} title={canBulk?"联系明确圈选的本人客户":"需要会话发送权限"} onClick={()=>setBulkOpen(true)}>圈选群发</button>
      {permission !== "agent" && <button type="button" className={view === "pool" ? "active" : ""} onClick={() => setView("pool")}>待绑定客户池</button>}
      {permission !== "agent" && <button
        type="button"
        data-proof="m1-seat-role-entry"
        disabled={!canManageSupportSeats || !supportAgentsAvailable}
        title={!canManageSupportSeats ? "只有总管理员或客服主管可以分配坐席" : supportAgentsPending ? "坐席数据正在同步，请稍候" : !supportAgentsAvailable ? "坐席数据暂不可用，请刷新后重试" : "前往 A1 维护接待资格与主管管理资格"}
        onClick={() => { if (canManageSupportSeats && supportAgentsAvailable) setShowSeatRoles(true); }}
      >客服资格</button>}
    </nav>

    {view === "pool" ? <M1SupervisorPool permission={permission} /> : <>
      {view === "dashboard" && <>
        <div className="s5a-intro"><div><div style={{display:"flex",gap:10,alignItems:"center"}}><SupportAvatar name={selfAgent?.name??"本人专属客服"} path={selfAvatarSnapshot ? selfAvatarSnapshot.assetId ? "/api/admin/platform/accounts/self/avatar/content" : undefined : selfAgent?.avatarAssetId&&adminId?advisorAvatarPath(adminId):undefined} version={selfAvatarSnapshot?.avatarVersion??selfAgent?.avatarVersion??undefined}/><h2>我的工作台</h2><SelfAvatarEditor name={selfAgent?.name??(operatorName||"本人账号")} ctx={ctx} onChanged={setSelfAvatarSnapshot}/></div><p>当前归属客户与可执行待办</p></div><span className="s5a-stamp">统计于 {overview ? formatTime(overview.evaluatedAt) : "待同步"}</span></div>
        {overviewError && <div className="s5a-alert" role="alert">{overviewError}<button type="button" onClick={() => setRowsRefresh((value) => value + 1)}><RefreshCw size={15} />重试</button></div>}
        <div className="s5a-metrics">
          {metrics.map(({ key, label, filter: metricFilter, icon: Icon, hint, count }) => <button type="button" key={key} className="s5a-metric" onClick={() => showCustomers(metricFilter)} aria-label={`${key === "windowActiveCustomers" ? overview?.activityWindowDays ? `近 ${overview.activityWindowDays} 天活跃` : "活跃客户，窗口待同步" : label}，${overviewLoading ? "加载中" : count === null ? "未配置或数据待核对" : `${count} 位`}，查看名单`}>
            <Icon size={21} aria-hidden="true" /><span>{key === "windowActiveCustomers" && overview?.activityWindowDays ? `近 ${overview.activityWindowDays} 天活跃` : label}</span><strong>{overviewLoading ? "···" : count === null ? "—" : count.toLocaleString("zh-CN")}</strong>
            <small>{count === null && !overviewLoading ? "未配置或数据待核对" : key === "windowActiveCustomers" && !overview?.activityWindowDays ? "统计窗口待同步" : hint}</small>
          </button>)}
        </div>
        {overview && overview.unknownWindowCount > 0 && <p className="s5a-note">窗口活跃已确认 {overview.knownActiveCount} 位，另有 {overview.unknownWindowCount} 位活动数据待确认；名单只列已确认客户。</p>}
        <div className="s5a-dashboard-grid">
          <section className="s5a-panel"><header><div><h3>待办客户</h3><p>待维护、待专属客服回复和首次待联系按客户去重。</p></div><button type="button" onClick={() => showCustomers("TODO")}>查看全部 <ArrowRight size={15} /></button></header>
            <CustomerRows rows={listRecords} loading={rowsLoading} error={rowsError} onRetry={() => setRowsRefresh((n) => n + 1)} onOpen={openDetail} onChat={openChat} />
          </section>
          <section className="s5a-panel s5a-recent"><header><div><h3>最近会话</h3><p>当前本人客户的最近消息</p></div><button type="button" onClick={() => router.push("/service/sessions")}>查看会话 <ArrowRight size={15} /></button></header>
            {recentError ? <div className="s5a-alert" role="alert">{recentError}<button type="button" onClick={() => setRecentRefresh((value) => value + 1)}>重试</button></div> : recent === null ? <div className="s5a-skeleton" aria-label="正在加载最近会话"><i /><i /><i /></div> : recent.length ? <ul>{recent.map((item) => <li key={item.conversationNo}><button type="button" onClick={() => openChat(item.customerId)}><strong>客户 {item.customerId}</strong><span>{item.lastMessageKind === "IMAGE" ? "[图片]" : item.lastMessage || "暂无消息预览"}</span><small>{formatTime(new Date(item.lastTs).toISOString())}{item.unreadCount > 0 ? ` · ${item.unreadCount} 条未读` : ""}</small></button></li>)}</ul> : <p className="s5a-empty">暂无最近会话。可从本人客户列表发起联系。</p>}
          </section>
        </div>
        <div className="s5a-progress-grid"><section className="s5a-panel s5a-progress"><header><div><h3>维护进展</h3><p>{overview?.performance ? `${formatTime(overview.performance.from)} 至 ${formatTime(overview.performance.to)}` : "统计区间待同步"}</p></div></header>
          <div className="s5a-performance"><div><span>已执行维护</span><strong>{overview?.performance?.executionCount ?? "—"}</strong><small>成功提交的人工维护消息次数</small></div><div><span>成功周期</span><strong>{overview?.performance?.successfulCycleCount ?? "—"}</strong><small>由后续真实活动完成</small></div><div><span>成功客户</span><strong>{overview?.performance?.successfulCustomerCount ?? "—"}</strong><small>统计期间去重人数</small></div><div><span>暂停主动维护</span><strong>{overview?.counts.stoppedMaintenanceCustomers ?? "—"}</strong><small>当前仍归属本人</small></div></div>
          <p className="s5a-note">执行后仍须出现新的真实账户活动才计成功。暂停主动维护不会解除专属客服归属或屏蔽求助。</p>
        </section><section className="s5a-panel"><header><div><h3>维护趋势</h3><p>逐日执行与成功周期</p></div></header>{trend?.length ? <figure className="s5a-trend" aria-label="维护执行与成功趋势"><div className="s5a-trend-bars">{trend.map((point) => <div key={point.day} className="s5a-trend-day"><div className="s5a-trend-pair" aria-label={`${point.day} 执行 ${point.executionCount} 次，成功 ${point.successfulCycleCount} 个周期`}><i style={{ height: `${point.executionCount ? Math.max(3, point.executionCount / trendMax * 100) : 0}%` }} /><i style={{ height: `${point.successfulCycleCount ? Math.max(3, point.successfulCycleCount / trendMax * 100) : 0}%` }} /></div><small>{point.day.slice(5)}</small><span>{point.executionCount} / {point.successfulCycleCount}</span></div>)}</div><p>紫色：执行次数　绿色：成功周期；每组数字为执行 / 成功。</p></figure> : <p className="s5a-note">趋势数据待同步，当前只展示已核实的汇总。</p>}</section></div>
      </>}

      {view === "customers" && <>
        <div className="s5a-intro"><div><h2>我的客户</h2><p>账户状态与维护状态分开查看</p></div><span className="s5a-stamp">{rows ? `共 ${rows.total} 位` : "待同步"}</span></div>
        <section className="s5a-panel"><form className="s5a-controls" onSubmit={(event) => { event.preventDefault(); setPage(1); setKeyword(keywordDraft.trim()); }}>
          <label><Search size={17} /><span className="sr-only">搜索客户名称或 ID</span><input value={keywordDraft} onChange={(event) => setKeywordDraft(event.target.value)} placeholder="搜索客户名称或 ID" /></label>
          <button type="submit">搜索</button>
          <select aria-label="筛选客户" value={filter} onChange={(event) => { setFilter(event.target.value as SupportCustomerFilter); setPage(1); }}>{filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          {(filter !== "ALL" || keyword) && <button type="button" onClick={() => { setFilter("ALL"); setKeyword(""); setKeywordDraft(""); setPage(1); }}>清除筛选</button>}
        </form>
          <CustomerRows rows={listRecords} loading={rowsLoading} error={rowsError} onRetry={() => setRowsRefresh((n) => n + 1)} onOpen={openDetail} onChat={openChat} />
          {rows && rows.total > rows.pageSize && <div className="s5a-pager"><button type="button" disabled={page <= 1} onClick={() => setPage((n) => n - 1)} aria-label="上一页"><ChevronLeft size={16} /></button><span>第 {page} / {totalPages} 页</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((n) => n + 1)} aria-label="下一页"><ChevronRight size={16} /></button></div>}
        </section>
      </>}
    </>}

    {bulkOpen&&<SupportBulkComposer ctx={ctx} onClose={()=>setBulkOpen(false)}/>}
    {showSeatRoles && canManageSupportSeats && <SupportSeatRoleModal
      ctx={ctx}
      operatorName={operatorName}
      currentRole={String(currentRole)}
      currentAdminId={adminId ?? 0}
      agents={supportAgentsAvailable ? seatAssignmentAgents : []}
      canManage={canManageSupportSeats && supportAgentsAvailable}
      onClose={() => setShowSeatRoles(false)}
    />}
    {detailId && <div className="s5a-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}><aside ref={drawerRef} className="s5a-drawer" role="dialog" aria-modal="true" aria-label="客户详情">
      <header><h2>{detail ? customerName(detail) : "客户详情"}</h2><button ref={drawerCloseRef} type="button" onClick={closeDetail} aria-label="关闭客户详情"><X size={20} /></button></header>
      {detailLoading && <div className="s5a-skeleton" aria-label="正在加载客户详情"><i /><i /><i /><i /></div>}
      {detailError && <div className="s5a-alert" role="alert">{detailError}<button type="button" onClick={() => void openDetail(detailId)}>重试</button></div>}
      {detail && <div className="s5a-drawer-body">
        <div style={{display:"flex",gap:12,alignItems:"center"}}><SupportAvatar name={customerName(detail)} path={customerAvatarPath(detail.customerId)}/><SupportAvatar name={detail.agentName??"当前专属客服"} path={detail.agentAdminId&&detail.advisorAvatar?advisorAvatarPath(detail.agentAdminId,detail.customerId):undefined} version={detail.advisorAvatar?.version}/><span>当前专属客服：{detail.agentName??"资料未知"}</span></div><dl><div><dt>客户编码</dt><dd>{detail.customerNo||"未知"}</dd></div><div><dt>客户 ID</dt><dd>{detail.customerId}</dd></div><div><dt>账户状态</dt><dd>{labelForAccount(detail.accountState)}</dd></div><div><dt>维护状态</dt><dd>{labelForMaintenance(detail)}</dd></div><div><dt>上次账户活动</dt><dd>{formatTime(detail.lastEffectiveAt)}</dd></div><div><dt>下次维护</dt><dd>{formatTime(detail.nextMaintenanceAt)}</dd></div></dl>
        {detail.accountState === "UNKNOWN" && <p className="s5a-note">账户活动数据待核对，不能推定为沉睡或活跃。</p>}
        <button type="button" className="s5a-primary" onClick={() => openChat(detail.customerId)}>联系客户 <ArrowRight size={16} /></button>
        {canMaintain ? <button type="button" className="s5a-secondary" disabled={Boolean(maintenancePending)} onClick={() => { setMaintenanceAction(detail.maintenanceEnabled ? "stop" : "resume"); setReason(""); setSaveError(null); }}>{detail.maintenanceEnabled ? "不再维护" : "恢复维护"}</button> : <p className="s5a-note">仅当前专属客服可调整主动维护；主管可审阅并办理正式转绑。</p>}
        {permission !== "agent" && detail.assignmentId && <button type="button" className="s5a-secondary" onClick={() => void openTransfer()}>正式转绑客户</button>}
        {transferOpen && <div className="s5a-confirm"><h3>正式转绑此客户</h3><p>仅变更当前客户的专属客服；提交后原专属客服立即失去私聊与图片权限。</p>
          {transferLoading ? <p role="status">正在读取可接待专属客服…</p> : <label>目标专属客服<select value={transferTarget ?? ""} disabled={transferSaving || Boolean(transferPending)} onChange={(event) => setTransferTarget(Number(event.target.value) || null)}><option value="">请选择专属客服</option>{transferAgents.filter((agent) => agent.assignmentEligible === true && agent.adminId !== detail.agentAdminId).map((agent) => <option key={agent.adminId} value={agent.adminId}>{agent.name}{agent.busy ? " · 忙碌" : ""}</option>)}</select></label>}
          {transferTarget&&<SupportAvatar name={transferAgents.find(a=>a.adminId===transferTarget)?.name??"目标专属客服"} path={transferAgents.find(a=>a.adminId===transferTarget)?.avatarAssetId?advisorAvatarPath(transferTarget):undefined} version={transferAgents.find(a=>a.adminId===transferTarget)?.avatarVersion??undefined}/>}
          {!transferLoading && transferAgentsError && <button type="button" onClick={() => void loadTransferAgents()}>重试读取专属客服名单</button>}
          {!transferLoading && !transferAgentsError && !transferAgents.some((agent) => agent.assignmentEligible === true && agent.adminId !== detail.agentAdminId) && <p className="s5a-note">暂无可接待的其他专属客服。请到 A1 账号管理核对接待资格。</p>}
          <label>转绑理由（8–200 字）<textarea value={transferReason} maxLength={200} disabled={transferSaving || Boolean(transferPending)} onChange={(event) => setTransferReason(event.target.value)} /></label><small>{transferReason.trim().length}/200 字</small>
          {transferPending && <p role="alert">上次转绑结果未确认，原客户范围和命令已锁定。<button type="button" onClick={() => void checkTransfer()} disabled={transferSaving}>查询原命令</button></p>}
          {transferError && <p role="alert">{transferError}</p>}
          <footer><button type="button" onClick={() => setTransferOpen(false)} disabled={transferSaving}>返回</button><button type="button" className="s5a-primary" disabled={Boolean(transferPending) || transferSaving || transferLoading || transferAgentsError || (!transferPending && (!transferTarget || transferTarget === detail.agentAdminId || transferReason.trim().length < 8 || transferReason.trim().length > 200))} onClick={() => void submitTransfer()}>{transferSaving ? "提交中…" : transferPending ? "等待原命令结果" : "确认正式转绑"}</button></footer>
        </div>}
        {maintenanceAction && <div className="s5a-confirm"><h3>{maintenanceAction === "stop" ? "暂停主动维护" : "恢复主动维护"}</h3><p>{maintenanceAction === "stop" ? "仅停止主动跟进。客户归属、私聊和求助保持可用。" : "旧周期不会恢复，也不会自动产生执行或成功。"}</p><label>操作理由（8–200 字）<textarea value={reason} maxLength={200} disabled={Boolean(maintenancePending)} onChange={(event) => setReason(event.target.value)} placeholder="填写本次操作的原因" /></label><small>{reason.trim().length}/200 字</small>{maintenancePending && <p role="alert">上次操作结果待确认，原理由与命令已保留。<button type="button" onClick={() => void checkMaintenance()} disabled={saving}>查询原命令</button></p>}{saveError && <p role="alert">{saveError}</p>}<footer><button type="button" onClick={() => { setMaintenanceAction(null); setSaveError(null); }} disabled={saving || Boolean(maintenancePending)}>取消</button><button type="button" className="s5a-primary" disabled={Boolean(maintenancePending) || saving || reason.trim().length < 8 || reason.trim().length > 200} onClick={() => void saveMaintenance()}>{saving ? "提交中…" : maintenancePending ? "等待原命令结果" : "确认"}</button></footer></div>}
        <section className="s5a-history"><button type="button" disabled={historyLoading} onClick={() => void loadHistory()}>{historyLoading ? "读取中…" : "查看维护记录"} <ArrowRight size={15} /></button>{historyError && <p role="alert">{historyError}</p>}{history && <><p>维护周期 {history.totalCycles} 条 · 主动联系 {history.totalExecutions} 条</p>{history.cycles.length || history.executions.length ? <ul>{[...history.cycles, ...history.executions].sort((a, b) => parseBusinessTime(b.occurredAt) - parseBusinessTime(a.occurredAt)).map((item) => <li key={`${item.kind}:${item.id}`}>{historyLabel(item.kind, HISTORY_KINDS)} · {formatTime(item.occurredAt)}{item.state ? ` · ${historyLabel(item.state, HISTORY_STATES)}` : ""}</li>)}</ul> : <p>尚无人工联系记录。</p>}{(history.cycles.length < history.totalCycles || history.executions.length < history.totalExecutions) && <button type="button" disabled={historyLoading} onClick={() => void loadHistory(history.pageNum + 1)}>加载更多维护记录</button>}</>}</section>
      </div>}
    </aside></div>}
  </section>;
}

function CustomerRows({ rows, loading, error, onRetry, onOpen, onChat }: { rows: SupportCustomer[]; loading: boolean; error: string | null; onRetry: () => void; onOpen: (id: string) => void; onChat: (id: string) => void }) {
  if (loading) return <div className="s5a-skeleton" aria-label="正在加载客户列表"><i /><i /><i /><i /></div>;
  if (error) return <div className="s5a-alert" role="alert">{error}<button type="button" onClick={onRetry}>重试</button></div>;
  if (!rows.length) return <div className="s5a-empty">当前筛选下没有客户。可切换筛选或等待主管分配。</div>;
  return <div className="s5a-table-wrap"><table className="s5a-table"><thead><tr><th>客户</th><th>上次账户活动</th><th>账户状态</th><th>维护状态</th><th>待办</th><th>操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.customerId}><td><SupportAvatar name={customerName(row)} path={customerAvatarPath(row.customerId)}/><button type="button" className="s5a-link" onClick={() => onOpen(row.customerId)}>{customerName(row)}</button><small>编码 {row.customerNo||"未知"} · ID {row.customerId}</small></td><td>{formatTime(row.lastEffectiveAt)}</td><td><span className={`s5a-tag ${row.accountState?.toLowerCase() || "unknown"}`}>{labelForAccount(row.accountState)}</span></td><td><span className="s5a-tag">{labelForMaintenance(row)}</span></td><td>{[row.waitingReply ? "待专属客服回复" : null, row.maintenanceEnabled && row.firstContact ? "首次待联系" : null, row.maintenanceEnabled && row.maintenanceStatus === "DUE" ? "待维护" : null].filter(Boolean).join(" · ") || "—"}</td><td><button type="button" onClick={() => row.waitingReply || (row.maintenanceEnabled && (row.firstContact || row.maintenanceStatus === "DUE")) ? onChat(row.customerId) : onOpen(row.customerId)}>{row.waitingReply ? "回复" : row.maintenanceEnabled && (row.firstContact || row.maintenanceStatus === "DUE") ? "联系" : "查看"}</button></td></tr>)}</tbody></table></div>;
}
