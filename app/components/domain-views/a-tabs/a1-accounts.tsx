"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, LogOut, PencilLine, RefreshCw, ShieldCheck, ShieldPlus, ShieldUser, UserCog, UserMinus, UserPlus, Users, MonitorSmartphone, ClipboardCheck, Headset, UsersRound, LockKeyhole } from "lucide-react";
import { BlockState, Button, Cell, Check, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, Change, Field, Fold, Input, MoreMenu, Notice, PageHeader, Pager, Panel, Select, Stat, StatBand, StatusDistributionBar, StatusTag, Table, TableMessage, Td, Th, Tr, type MoreMenuItem } from "@/app/components/rd";
import { readAdminSessionBaseline } from "@/lib/admin/session-baseline";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { roleLabel, canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { a1PendingCommands, a1IntentSlot, a1IntentAuthority, sendA1Pending, type A1Intent, type A1Pending, type A1Request, type A1Snapshot } from "@/lib/admin/a1-pending";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import {
  fetchA1Overview,
  isA1OutcomeUncertainError,
  type A1CreateAccountInput,
  type A1Operator,
  type A1Overview,
  type A1PasswordResetResult,
  type A1SecurityBaseline,
  type A1UpdateAccountInput,
} from "@/lib/admin/a1-client";
import { fetchA6RoleDetail, fetchA6RolesOverview } from "@/lib/admin/a6-client";
import { fetchA8PermissionDetail } from "@/lib/admin/a8-client";
import { groupPendingCommands, isInvitePending, type GroupPendingRecord } from "@/lib/admin/support-group-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { ACtx, ActionConfirmReq } from "./types";
import type { BusinessFormValue } from "../design-kit";
import { avatarDrafts, avatarDraftFingerprint } from "@/lib/admin/account-avatar-pending";
import { SupportAvatar } from "../m-tabs/support-avatar";
import { SupportQualificationEditor, canManageSupportQualifications } from "../m-tabs/m1-group-management";
import {
  A1RecoveryNotice, AccountDetailDrawer, AvatarRecoveryModal, EditAccountDrawer, NewAccountDrawer, PasswordResetDrawer, RoleChangeModal,
  approvalTag, approverFact, credentialStatusText, directTag, expiredTag, minuteText, operatorDisplayLabel, operatorDisplayName,
  permSummary, roleName, unknownTag, zoneNote, isHighRiskCode, HIGH_RISK_EXPLAIN, PermGroups, type A1AccountAction,
} from "./a1-account-views";

type SecurityBaselineMeta = {
  key: string;
  name: string;
  sub: string;
  unit?: string;
  min?: number;
  max?: number;
};

type SecurityBaselineRow = SecurityBaselineMeta & {
  sourceKey: "session" | "lock";
  current: string | null;
  locked: boolean;
};

const SECURITY_BASELINE_META: Record<string, SecurityBaselineMeta> = {
  session_idle: { key: "session_idle", name: "会话空闲时限", sub: "多久无操作自动登出", unit: "分钟" },
  session_abs: { key: "session_abs", name: "会话最长时限", sub: "登录后最长可保持多久", unit: "小时" },
  lock_short_cnt: { key: "lock_short_cnt", name: "短时锁定 · 连续输错次数", sub: "连续输错几次后锁定", unit: "次", min: 3, max: 10 },
  lock_short_min: { key: "lock_short_min", name: "短时锁定 · 锁定时长", sub: "锁定多久后可重试", unit: "分钟", min: 5, max: 60 },
  lock_long_cnt: { key: "lock_long_cnt", name: "长时锁定 · 24 小时内输错次数", sub: "一天内累计输错几次后长时锁定", unit: "次" },
  lock_long_hour: { key: "lock_long_hour", name: "长时锁定 · 锁定时长", sub: "锁定多久后可重试", unit: "小时" },
};

/** 账号列表的筛选：只在已读到的全部账号里筛，不发请求。 */
type ListFilter = "all" | "ok" | "unbound" | "disabled" | "super";
/** 直接执行的原操作结果未知时，各自「可能已经怎样」。 */
const DIRECT_UNKNOWN_NOTE: Partial<Record<A1Intent["kind"], string>> = {
  create: "提交时没收到确定结果，账号可能已经建好。24 小时内可以按原请求重试，不会建第二个。",
  password: "提交时没收到确定结果，密码可能已经重置。24 小时内可以按原请求重试，不会再生成一个新密码。",
  session: "提交时没收到确定结果，这台设备可能已经下线。24 小时内可以按原请求重试。",
  permission: "提交时没收到确定结果，权限可能已经登记。24 小时内可以按原请求重试，不会登记第二次。",
};

const FILTER_TEXT: Record<Exclude<ListFilter, "all">, string> = { ok: "启用且已绑定两步验证", unbound: "启用但未绑定两步验证", disabled: "已停用", super: "超级管理员" };

function errorMessage(error: unknown) {
  return displayAdminError(error);
}

function roleKeyFromCode(roleCode: string) {
  const normalized = roleCode.trim().toUpperCase().replaceAll("-", "_");
  const builtins: Record<string, string> = {
    SUPER_ADMIN: "super", CONFIG_ADMIN: "config", FINANCE: "finance", RISK: "risk",
    CONTENT: "content", GROWTH: "growth", SUPPORT: "support", AUDITOR: "audit",
  };
  return builtins[normalized] ?? normalized.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function firstMatch(value: string | undefined, pattern: RegExp) {
  const match = value?.match(pattern);
  return match?.[1];
}

function operatorAccountId(id: string | number | null | undefined) {
  if (id === null || id === undefined) return null;
  const normalized = String(id).trim();
  if (!normalized) return null;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const tail = normalized.match(/(\d+)$/);
  return tail ? Number(tail[1]) : null;
}

function forceLogoutRole(role: string | undefined | null) {
  if (role === "superadmin" || role === "super") return "super";
  if (role === "risk") return "risk";
  if (role === "auditor") return "audit";
  return role ?? "";
}

export function A1Accounts({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const currentAdminId = useAdminAuth((s) => s.session?.adminId ?? null);
  const currentSessionRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const isSuperAdmin = useAdminAuth((s) => s.session?.role === "super" || s.session?.role === "superadmin");
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const canPropose = authorities.includes("platform_a2_write");
  const canCreateAccount = isSuperAdmin && authorities.includes("platform_a1_write");
  const canEditAccount = authorities.includes("platform_a1_write") && canPropose;
  const canChangeRole = authorities.includes("platform_a1_account_role_change") && canPropose;
  const canReset2fa = authorities.includes("platform_a1_account_2fa_reset") && canPropose;
  const canResetPassword = isSuperAdmin && authorities.includes("platform_a1_account_password_reset");
  const canChangeStatus = authorities.includes("platform_a1_account_disable") && canPropose;
  const canRegisterPermission = authorities.includes("platform_a1_rbac_grants_update");
  const [overview, setOverview] = useState<A1Overview | null>(null);
  const [permissionCodesByRole, setPermissionCodesByRole] = useState<Record<string, string[]>>({});
  const [permissionDiffReady, setPermissionDiffReady] = useState(false);
  const [permissionDiffError, setPermissionDiffError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [naOpen, setNaOpen] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<A1Pending[]>([]);
  const reloadPending = () => setPendingOperations(a1PendingCommands.list().filter(r => r.actorId === useAdminAuth.getState().session?.adminId));
  useEffect(() => { setPendingOperations(a1PendingCommands.list().filter(r => r.actorId === currentAdminId)); }, [currentAdminId]);
  const creationPending = pendingOperations.find(r => r.intent.kind === "create");
  const restoring = useRef<A1Pending | null>(null);
  const submitting = useRef<{ intent: A1Intent; snapshot: A1Snapshot; reason: string; businessValue?: BusinessFormValue } | null>(null);
  const freshOverview = useRef<A1Overview | null>(null);
  const [overviewReady, setOverviewReady] = useState(false);
  const [detailAccount, setDetailAccount] = useState<A1Operator | null>(null);
  const canManageQualifications = useAdminAuth(s => canManageSupportQualifications(s.session));
  const [avatarRecovery, setAvatarRecovery] = useState<string | null>(null);
  const [qualificationTarget, setQualificationTarget] = useState<{ id: string; kind: "SERVICE" | "SUPERVISOR" } | null>(null);
  const [editAccountTarget, setEditAccountTarget] = useState<A1Operator | null>(null);
  const [passwordReset, setPasswordReset] = useState<A1PasswordResetResult | null>(null);
  const [permissionDraft, setPermissionDraft] = useState({ code: "", name: "", path: "", type: "WRITE" as "READ" | "WRITE", amplifies: false });
  // 以下只管界面：列表筛选、改角色的第一步、临时密码来自新建还是重置。
  const [filter, setFilter] = useState<ListFilter>("all");
  const [roleTarget, setRoleTarget] = useState<A1Operator | null>(null);
  const [passwordFromCreate, setPasswordFromCreate] = useState(false);

  const refreshOverview = useCallback(async (quiet = false) => {
    const actorId = useAdminAuth.getState().session?.adminId;
    freshOverview.current = null;
    setOverviewReady(false);
    if (!quiet) {
      setLoading(true);
    }
    setLoadError(null);
    setPermissionDiffReady(false);
    setPermissionDiffError(null);
    try {
      const data = await fetchA1Overview();
      if (useAdminAuth.getState().session?.adminId !== actorId) return null;
      setOverview(data);
      freshOverview.current = data;
      setOverviewReady(true);
      setDetailAccount(current => current ? data.operators.find(op => op.id === current.id) ?? null : null);
      try {
        const a6 = await fetchA6RolesOverview();
        const details = await Promise.all(a6.roles.filter((role) => role.status === 1).map((role) => fetchA6RoleDetail(role.id)));
        if (useAdminAuth.getState().session?.adminId !== actorId) return null;
        const codesByRole = Object.fromEntries(details.map((role) => [roleKeyFromCode(role.roleCode), role.permissionCodes]));
        if (!data.roles.every((role) => Array.isArray(codesByRole[role.key]))
          || !data.operators.every(op => !op.role || op.role === "unassigned" || Array.isArray(codesByRole[op.role]))) {
          throw new Error("A6_ROLE_PERMISSION_DIFF_INCOMPLETE");
        }
        setPermissionCodesByRole(codesByRole);
        setPermissionDiffReady(true);
      } catch (error) {
        setPermissionCodesByRole({});
        setPermissionDiffError(`角色权限没有读到：${errorMessage(error)}`);
      }
      return data;
    } catch (error) {
      setLoadError(errorMessage(error));
      return null;
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const roles = overview?.roles ?? [];
  const roleOptions = useMemo(() => [
    { key: "unassigned", name: "暂未分配", scope: "没有任何权限和菜单，在「角色管理」授权后再分配" },
    ...roles,
  ], [roles]);
  const operators = overview?.operators ?? [];
  const currentOperator = useMemo(() => {
    const id = currentAdminId === null ? null : String(currentAdminId);
    return id ? operators.find((op) => op.id === id) ?? null : null;
  }, [currentAdminId, operators]);
  const currentForceLogoutRole = forceLogoutRole(currentOperator?.role ?? currentSessionRole);
  const securityBaselines = overview?.securityBaselines ?? [];
  const stats = overview?.stats;
  const effectiveSupers = stats?.effectiveSupers ?? 0;
  const governanceFrozen = effectiveSupers < 2;
  const profileEditBlockReason = !overviewReady ? errorMessage(new Error("A1_FRESH_OVERVIEW_REQUIRED")) : !canEditAccount ? "你没有编辑账号资料的权限"
    : governanceFrozen ? "有效的超级管理员不足 2 人，暂时不能编辑账号资料"
    : mutatingAction ? "正在提交，请稍候" : null;
  const backendSessionBaseline = securityBaselines.find((b) => b.key === "session")?.value;
  const parsedSessionBaseline = readAdminSessionBaseline(backendSessionBaseline);
  const backendLockBaseline = securityBaselines.find((b) => b.key === "lock")?.value;
  const baselineCurrent = (key: string) => {
    if (key === "session_idle") return parsedSessionBaseline.idleDisabled ? "已停用" : parsedSessionBaseline.idleMinutes;
    if (key === "session_abs") return parsedSessionBaseline.unlimited ? "无固定上限" : parsedSessionBaseline.absoluteHours;
    if (key === "lock_short_cnt") return firstMatch(backendLockBaseline, /(\d+(?:\.\d+)?)\s*(?:times|次)/i) ?? null;
    if (key === "lock_short_min") return firstMatch(backendLockBaseline, /\/\s*(\d+(?:\.\d+)?)\s*min/i) ?? null;
    if (key === "lock_long_cnt") return firstMatch(backendLockBaseline, /\+\s*(\d+(?:\.\d+)?)\s*(?:times|次)/i) ?? null;
    if (key === "lock_long_hour") return firstMatch(backendLockBaseline, /\+\s*\d+(?:\.\d+)?\s*(?:times|次)\s*\/\s*(\d+(?:\.\d+)?)\s*h/i) ?? null;
    return null;
  };
  const registeredBaseline = (key: string): A1SecurityBaseline | undefined =>
    securityBaselines.find((baseline) => baseline.key === key);
  const securityBaselineRows: SecurityBaselineRow[] = [];
  if (registeredBaseline("session")) {
    securityBaselineRows.push(
      { ...SECURITY_BASELINE_META.session_idle, sourceKey: "session", current: baselineCurrent("session_idle"),
        unit: parsedSessionBaseline.idleDisabled ? undefined : "分钟",
        sub: parsedSessionBaseline.idleDisabled ? "无操作自动登出已关闭" : SECURITY_BASELINE_META.session_idle.sub, locked: true },
      { ...SECURITY_BASELINE_META.session_abs, sourceKey: "session", current: baselineCurrent("session_abs"), unit: parsedSessionBaseline.unlimited ? undefined : "小时", locked: true },
    );
  }
  if (registeredBaseline("lock")) {
    securityBaselineRows.push(
      { ...SECURITY_BASELINE_META.lock_short_cnt, sourceKey: "lock", current: baselineCurrent("lock_short_cnt"), locked: registeredBaseline("lock")?.locked ?? false },
      { ...SECURITY_BASELINE_META.lock_short_min, sourceKey: "lock", current: baselineCurrent("lock_short_min"), locked: registeredBaseline("lock")?.locked ?? false },
      { ...SECURITY_BASELINE_META.lock_long_cnt, sourceKey: "lock", current: baselineCurrent("lock_long_cnt"), locked: true },
      { ...SECURITY_BASELINE_META.lock_long_hour, sourceKey: "lock", current: baselineCurrent("lock_long_hour"), locked: true },
    );
  }
  const baselineDisplay = (baseline: SecurityBaselineRow) => (
    baseline.current == null ? "—" : `${baseline.current} ${baseline.unit ?? ""}`.trim()
  );
  const lockBaseline = backendLockBaseline || "未获取到";

  // 列表筛选只看已读到的账号，不改请求；分页沿用原来的组件内状态。
  const enabledOps = operators.filter((op) => op.status === "enabled");
  const unboundOps = enabledOps.filter((op) => !op.tfa);
  const okOps = enabledOps.filter((op) => op.tfa);
  const disabledOps = operators.filter((op) => op.status !== "enabled");
  const enabledSupers = enabledOps.filter((op) => op.role === "super");
  const onlineAccounts = operators.filter((op) => op.sessions > 0).length;
  const listed = filter === "all" ? operators
    : filter === "ok" ? okOps : filter === "unbound" ? unboundOps : filter === "disabled" ? disabledOps : operators.filter((op) => op.role === "super");
  const pickFilter = (next: ListFilter) => { setFilter((current) => current === next ? "all" : next); setPage(0); };

  const totalPages = Math.max(1, Math.ceil(listed.length / perPage));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = listed.length ? safePage * perPage : 0;
  const pageEnd = Math.min(pageStart + perPage, listed.length);
  const pageRows = listed.slice(pageStart, pageEnd);
  const forceLogoutBlockReason = (op: A1Operator) => {
    if (!authorities.includes("platform_a1_account_sessions_revoke")) return errorMessage(new Error("A1_OPERATION_FORBIDDEN"));
    const targetId = operatorAccountId(op.id);
    if (currentAdminId !== null && targetId !== null && targetId === currentAdminId) {
      return "不能撤销自己的登录";
    }
    if (currentForceLogoutRole !== "super") {
      return "只有超级管理员可以撤销运营账号的登录";
    }
    if (op.role === "super") {
      return "超级管理员账号的登录不能被撤销";
    }
    if (op.sessions === 0) {
      return "该账号当前未登录";
    }
    return null;
  };
  const protectsEffectiveSuperFloor = (op: A1Operator) =>
    op.role === "super" && op.status === "enabled" && op.tfa && effectiveSupers <= 2;
  const changeRoleBlockReason = (op: A1Operator) => {
    if (!canChangeRole) return "你没有变更账号角色的权限";
    if (!permissionDiffReady) return permissionDiffError ? "角色权限没有读到，暂时不能改角色" : "角色权限没有读到，暂时不能改角色";
    if (governanceFrozen && op.role === "super") return "恢复期间只能把其他账号提升为超级管理员";
    if (protectsEffectiveSuperFloor(op)) return "改后有效的超级管理员会少于 2 人";
    return null;
  };
  const reset2faBlockReason = (op: A1Operator) => {
    if (!canReset2fa) return "你没有重置两步验证的权限";
    if (!op.tfa) return "该账号尚未绑定两步验证，无需重置";
    if (governanceFrozen) return "有效的超级管理员不足 2 人，账号操作已暂停";
    if (protectsEffectiveSuperFloor(op)) return "重置后有效的超级管理员会少于 2 人";
    return null;
  };
  const disableAccountBlockReason = (op: A1Operator) => {
    if (!canChangeStatus) return "你没有启停账号的权限";
    if (governanceFrozen) return "有效的超级管理员不足 2 人，账号操作已暂停";
    if (protectsEffectiveSuperFloor(op)) return "停用后有效的超级管理员会少于 2 人";
    return null;
  };

  const pendingFor = (intent: A1Intent) => a1PendingCommands.list().find(r => r.actorId === currentAdminId && a1IntentSlot(r.intent) === a1IntentSlot(intent));
  const recoveryStarted = () => {
    freshOverview.current = null;
    setOverviewReady(false);
    setNaOpen(false); setEditAccountTarget(null); setRoleTarget(null); setDetailAccount(null);
  };
  const requireActor = (intent: A1Intent | null, writing: boolean, approval = false) => {
    const auth = useAdminAuth.getState(), session = auth.session;
    if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !session || session.adminId !== currentAdminId || session.passwordChangeRequired
      || !session.authorities.includes("platform_a1_read") || !canAccessResolvedPath(resolveVisibleDomains(session), "/platform/rbac")) throw new Error("A1_SESSION_CHANGED");
    if (writing && (!intent || !session.authorities.includes(a1IntentAuthority(intent)) || approval && !session.authorities.includes("platform_a2_write")
      || ["create", "password", "session", "logout"].includes(intent.kind) && !["super", "superadmin"].includes(session.role))) throw new Error("A1_OPERATION_FORBIDDEN");
    return session;
  };
  const requireNewIntent = (intent: A1Intent) => {
    const data = freshOverview.current;
    if (!data || mutatingAction) throw new Error("A1_FRESH_OVERVIEW_REQUIRED");
    if (pendingFor(intent)) throw new Error("A1_ORIGINAL_OPERATION_PENDING");
    const recovery = data.stats.effectiveSupers < 2;
    requireActor(intent, true, intent.kind === "create" ? intent.approval : !["password", "permission", "session"].includes(intent.kind));
    if (intent.kind === "create") {
      if (intent.approval !== recovery || recovery && intent.form.role !== "super") throw new Error("A1_FRESH_OVERVIEW_REQUIRED");
      return;
    }
    if (intent.kind === "permission") { if (recovery) throw new Error("ADMIN_GOVERNANCE_FROZEN"); return; }
    const current = data.operators.find(op => op.id === intent.account.id);
    if (!current || current.version !== intent.account.version) throw new Error("ACCOUNT_VERSION_STALE");
    if (recovery && !["role", "enable", "logout", "session"].includes(intent.kind)) throw new Error("ADMIN_GOVERNANCE_FROZEN");
    if (intent.kind === "role" && (!permissionDiffReady || !roleOptions.some(role => role.key === intent.picked)
      || intent.picked === current.role || recovery && (current.role === "super" || intent.picked !== "super"))) throw new Error("A1_FRESH_OVERVIEW_REQUIRED");
    if (intent.kind === "enable" && recovery && (current.role !== "super" || !current.tfa)) throw new Error("ADMIN_GOVERNANCE_FROZEN");
    if (intent.kind === "2fa" && !current.tfa) throw new Error("ADMIN_MFA_NOT_BOUND");
    if ((intent.kind === "disable" || intent.kind === "2fa" || intent.kind === "role" && intent.picked !== "super") && current.role === "super" && current.status === "enabled" && data.stats.effectiveSupers <= 2) throw new Error("MIN_EFFECTIVE_SUPER_REQUIRED");
    if ((intent.kind === "disable" && current.status !== "enabled") || (intent.kind === "enable" && current.status !== "disabled")) throw new Error("ACCOUNT_VERSION_STALE");
    if (intent.kind === "logout" || intent.kind === "session") {
      if (current.id === String(currentAdminId) || current.role === "super" || current.sessions === 0) throw new Error("FORCE_LOGOUT_FORBIDDEN");
      if (intent.kind === "session" && !current.sessionDetails?.some(s => s.sessionId === intent.sessionId)) throw new Error("ADMIN_SESSION_NOT_FOUND");
    }
  };
  const checkTicket = (record: A1Pending, ticket: A2OperationRow) => {
    if (record.request.kind !== "proposal" || !ticket.mine || ticket.obj !== record.request.input.obj || ticket.action !== record.request.input.action
      || ticket.operationCode !== record.request.input.command.op) throw new Error("A1_PROPOSAL_RECEIPT_MISMATCH");
  };
  const queryOriginal = async (record: A1Pending) => {
    requireActor(record.intent, false);
    if (record.request.kind !== "proposal") {
      if (record.request.kind === "permission") await fetchA8PermissionDetail(record.request.input.permissionCode);
      if (!await refreshOverview(true)) throw new Error("A1_FRESH_OVERVIEW_REQUIRED");
      toast(displayAdminError(new Error("A1_READBACK_ONLY")));
      return false;
    }
    const ticket = await fetchA2ProposalByKey(record.commandKey, true, true);
    if (useAdminAuth.getState().session?.adminId !== record.actorId) throw new Error("A1_SESSION_CHANGED");
    if (!ticket) {
      a1PendingCommands.remember(record.fingerprint, record.commandKey, { ...record, ticket: undefined, proposalNotFound: true }); reloadPending();
      return false;
    }
    checkTicket(record, ticket);
    a1PendingCommands.remember(record.fingerprint, record.commandKey, { ...record, ticket, proposalNotFound: false }); reloadPending();
    if (ticket.status === "pending") { toast("已提交，等待审批后执行"); return true; }
    recoveryStarted();
    await refreshOverview(true);
    a1PendingCommands.forget(record.fingerprint, record.commandKey); reloadPending();
    ctx.closeActionConfirm?.();
    toast(`原审批单：${({ approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" })[ticket.status]}`);
    return true;
  };
  const executeOriginal = async (record: A1Pending, retry: boolean) => {
    if (Date.now() >= record.expiresAt) throw new Error("A1_RETRY_EXPIRED");
    requireActor(record.intent, true, record.request.kind === "proposal");
    if (!a1PendingCommands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("A1_COMMAND_STORAGE_UNAVAILABLE");
    if (retry) recoveryStarted();
    setMutatingAction(record.request.kind === "proposal" ? record.request.input.action.replace(/ \(A1\)$/, "")
      : record.intent.kind === "create" ? "新建账号" : record.intent.kind === "password" ? "重置密码" : record.intent.kind === "session" ? "让这台设备下线" : "登记新权限");
    let result: Awaited<ReturnType<typeof sendA1Pending>>;
    try { result = await sendA1Pending(record); }
    catch (error) {
      const uncertain = isA1OutcomeUncertainError(error) || isA2OutcomeUncertainError(error);
      const status = (error as { status?: number } | null)?.status;
      if (retry ? isExplicitRejection(error) : !uncertain && typeof status === "number" && isDeterministicRejection(status)) {
        a1PendingCommands.forget(record.fingerprint, record.commandKey); reloadPending();
        if (retry) { await refreshOverview(true); ctx.closeActionConfirm?.(); }
      }
      throw error;
    } finally { setMutatingAction(null); }
    if (useAdminAuth.getState().session?.adminId !== record.actorId) throw new Error("A1_SESSION_CHANGED");
    if (result.kind === "proposal") {
      checkTicket(record, result.ticket);
      // A replayed POST is the old creation receipt, never today's ticket state.
      if (retry) {
        if (!await queryOriginal(record)) throw new Error("A1_PROPOSAL_STATUS_UNKNOWN");
      } else {
        a1PendingCommands.remember(record.fingerprint, record.commandKey, { ...record, ticket: result.ticket }); reloadPending();
        toast("已提交，等待审批后执行");
      }
      return result;
    }
    if (result.kind === "create" && record.request.kind === "create") {
      if (result.account.username !== record.request.input.username || result.account.role !== (record.request.input.role || "unassigned")) throw new Error("A1_MUTATION_RESPONSE_UNREADABLE");
      setPasswordFromCreate(true); setPasswordReset({ account: result.account, temporaryPassword: result.account.temporaryPassword! });
      avatarDrafts.forget(avatarDraftFingerprint(record.actorId, "admin", "new"));
    } else if (result.kind === "password") {
      if (record.request.kind !== "password" || result.result.account.id !== record.request.accountId) throw new Error("A1_MUTATION_RESPONSE_UNREADABLE");
      setPasswordFromCreate(false); setPasswordReset(result.result);
    } else if (result.kind === "session" && record.request.kind === "session" && result.account.id !== record.request.accountId
      || result.kind === "permission" && record.request.kind === "permission" && result.permission.permissionCode !== record.request.input.permissionCode.toLowerCase()) throw new Error("A1_MUTATION_RESPONSE_UNREADABLE");
    recoveryStarted();
    await refreshOverview(true);
    a1PendingCommands.forget(record.fingerprint, record.commandKey); reloadPending();
    if (retry) toast(displayAdminError(new Error("A1_ORIGINAL_OPERATION_CONFIRMED")));
    return result;
  };
  const submitRequest = async (request: A1Request) => {
    const draft = submitting.current;
    if (!draft || !currentAdminId) throw new Error("A1_SESSION_CHANGED");
    requireNewIntent(draft.intent);
    const now = Date.now(), fingerprint = `${currentAdminId}:${a1IntentSlot(draft.intent)}`, commandKey = crypto.randomUUID();
    const record: A1Pending = JSON.parse(JSON.stringify({ fingerprint, commandKey, createdAt: now, expiresAt: now + 86400000, actorId: currentAdminId, intent: draft.intent, snapshot: draft.snapshot, request, confirmationReason: draft.reason, businessValue: draft.businessValue }));
    a1PendingCommands.remember(fingerprint, commandKey, record);
    if (!a1PendingCommands.isDurablyStored(fingerprint, commandKey)) {
      a1PendingCommands.forget(fingerprint, commandKey); reloadPending();
      throw new Error("A1_COMMAND_STORAGE_UNAVAILABLE");
    }
    reloadPending();
    return executeOriginal(record, false);
  };
  const propose = async (_toast: typeof toast, spec: ProposeSpec) => {
    const session = requireActor(submitting.current!.intent, true, true);
    await submitRequest({ kind: "proposal", input: {
      action: `${spec.action} (A1)`, obj: spec.obj, beforeValue: spec.before, afterValue: spec.after,
      operator: session.operator || session.username || operator, operatorRole: roleLabel(session.role), type: spec.type,
      amplifies: !!spec.amplifies, sos: !!spec.sos, roleGate: spec.gateLabel, reason: spec.reason, sourceDomain: spec.sourceDomain,
      command: spec.command, target: spec.target, targets: spec.targets,
    } });
    return "proposed" as const;
  };
  const openOperation = (intent: A1Intent, spec: ActionConfirmReq) => {
    const original = restoring.current;
    const snapshot = original?.snapshot ?? { roles, codes: permissionCodesByRole, permissionReady: permissionDiffReady, effectiveSupers };
    let saved = original;
    openActionConfirm({ ...spec,
      initialReason: original?.confirmationReason,
      getPendingReason: () => saved && a1PendingCommands.list().some(r => r.commandKey === saved!.commandKey) ? saved.confirmationReason : undefined,
      getPendingBusinessValue: () => saved?.businessValue,
      inlineApproval: { resolve: () => undefined, pending: !!original, initialRecovery: "retry", expired: !!original && Date.now() >= original.expiresAt,
        disabledReason: original ? (() => { try { requireActor(intent, true, original.request.kind === "proposal"); return undefined; } catch (error) { return errorMessage(error); } })() : undefined,
        recover: async () => { if (!saved) return false; await queryOriginal(saved); return true; },
      },
      run: async (reason, value, businessValue) => {
        if (saved) {
          if (!a1PendingCommands.list().some(r => r.commandKey === saved!.commandKey)) throw new Error("A1_OPERATION_REOPEN_REQUIRED");
          await executeOriginal(saved, true);
          return true;
        }
        requireNewIntent(intent);
        submitting.current = { intent, snapshot, reason, businessValue };
        try { return await spec.run(reason, value, businessValue); }
        finally { saved = pendingFor(intent) ?? null; submitting.current = null; }
      },
    });
  };

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const codesOf = (role: string) => role === "unassigned" || !role ? [] : (restoring.current?.snapshot.codes ?? permissionCodesByRole)[role] ?? [];
  const gainLoss = (from: string, to: string) => {
    const before = new Set(codesOf(from)), after = new Set(codesOf(to));
    return { gained: [...after].filter((code) => !before.has(code)).length, lost: [...before].filter((code) => !after.has(code)).length };
  };

  // 改角色第一步：在页面自己的框里选新角色、对照权限；第二步才打开确认框填理由。
  const changeRole = (op: A1Operator) => {
    const blocked = changeRoleBlockReason(op);
    if (blocked) {
      toast(blocked);
      return;
    }
    setRoleTarget(op);
  };

  const confirmRoleChange = (op: A1Operator, picked: string) => {
    setRoleTarget(null);
    const viewRoles = restoring.current?.snapshot.roles ?? roles;
    const displayName = operatorDisplayName(op);
    const displayLabel = operatorDisplayLabel(op);
    const allowedRoles = governanceFrozen ? roleOptions.filter((role) => role.key === op.role || role.key === "super") : roleOptions;
    const diff = gainLoss(op.role, picked);
    const beforeCodes = new Set(codesOf(op.role)), afterCodes = new Set(codesOf(picked));
    const gainedCodes = [...afterCodes].filter((code) => !beforeCodes.has(code)), lostCodes = [...beforeCodes].filter((code) => !afterCodes.has(code));
    const riskyGained = gainedCodes.filter(isHighRiskCode).length;
    openOperation({ kind: "role", account: op, picked }, { briefKind: "security",
      action: `变更角色 · ${displayName}`,
      title: "改角色",
      detail: `${displayLabel}：${roleName(viewRoles, op.role)} 改成 ${roleName(viewRoles, picked)}。`,
      amplifies: false,
      effect: approvalTag("批准前角色和权限不变。"),
      confirmLabel: "提交审批",
      facts: (
        <Facts>
          <Fact k="账号">{displayLabel}</Fact>
          <Fact k="角色"><Change from={roleName(viewRoles, op.role)} to={roleName(viewRoles, picked)} /></Fact>
          <Fact k="权限变化" tone={diff.gained > 0 ? "warn" : undefined}>多出 {diff.gained} 项 · 少掉 {diff.lost} 项{riskyGained > 0 ? `，其中 ${riskyGained} 项高风险` : ""}</Fact>
          {approverFact()}
        </Facts>
      ),
      content: (
        <div className="a1-page a1-sheet">
          <Fold inset title="多出和少掉的权限" summary={`多出 ${diff.gained} 项 · 少掉 ${diff.lost} 项${riskyGained > 0 ? ` · ${riskyGained} 项高风险` : ""}`} explain={HIGH_RISK_EXPLAIN}>
            <div className="a1-role-lists" data-proof="role-perm-diff-confirm">
              <section aria-label="多出的权限"><h4 className="a1-role-list-title" data-tone="gain">多出的权限<span>{gainedCodes.length} 项</span></h4><PermGroups codes={gainedCodes} label="多出的权限" tone="gain" markRisk empty="没有多出的权限" /></section>
              <section aria-label="少掉的权限"><h4 className="a1-role-list-title" data-tone="loss">少掉的权限<span>{lostCodes.length} 项</span></h4><PermGroups codes={lostCodes} label="少掉的权限" tone="loss" markRisk empty="没有少掉的权限" /></section>
            </div>
          </Fold>
        </div>
      ),
      statedBrief: {
        impact: `${picked === "unassigned"
          ? "批准后这个账号没有任何权限和菜单；已登录的设备不会被踢下线。"
          : "批准后按新角色的权限生效，已登录的设备不会被踢下线。"}${picked !== "support" && picked !== "super" ? "新角色不是客服或超级管理员，批准时会移除客服资格；名下还有客户或组成员时会被拒绝。" : ""}`,
        check: "提交时带上你看到的账号版本；批准执行时核对版本，并检查有效的超级管理员不少于 2 人。",
      },
      run: async (reason) => {
        const roleStr = (picked || "").trim();
        if (!allowedRoles.some((r) => r.key === roleStr)) {
          toast(`无法保存：角色无效（${roleStr}）`);
          return;
        }
        if (roleStr === op.role) {
          toast("新角色与当前角色相同");
          return;
        }
        if (op.role === "super" && op.status === "enabled" && roleStr !== "super" && effectiveSupers - 1 < 2) {
          toast("不能执行：有效的超级管理员会少于 2 人");
          return;
        }
        const def = findHighOp("a1_account_change_role")!;
        await propose(toast, {
          action: `变更角色 · ${displayName} → ${roleName(viewRoles, roleStr)}`,
          obj: String(op.id),
          before: roleName(viewRoles, op.role),
          after: roleName(viewRoles, roleStr),
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "A1",
          command: def.buildCommand({ accountId: op.id, role: roleStr, expectedVersion: op.version }),
          target: def.buildTarget({ accountId: op.id }),
        });
      },
    });
  };

  const reset2fa = (op: A1Operator) => openOperation({ kind: "2fa", account: op }, { briefKind: "security",
    action: `重置两步验证 · ${operatorDisplayName(op)}`,
    title: "重置两步验证",
    detail: "核实是本人后提交；批准后旧验证器失效，下次登录重新绑定。",
    amplifies: false,
    effect: approvalTag("批准前两步验证不变，账号照常可以登录。"),
    confirmTone: "danger",
    confirmLabel: "提交审批",
    facts: (
      <Facts>
        <Fact k="账号">{operatorDisplayLabel(op)}</Fact>
        <Fact k="两步验证"><Change from="已绑定" to="待重新绑定" /></Fact>
        <Fact k="在线设备">{op.sessions} 台，批准后全部下线</Fact>
        {approverFact()}
      </Facts>
    ),
    statedBrief: {
      impact: "骗子常用这一步盗号，先用另一种方式核实是本人。批准后旧验证器失效、所有设备下线，下次登录重新绑定。",
      check: "批准执行时核对账号版本和是否已绑定；核验方式、时间和工单号写进理由，后端不另外核对。",
    },
    businessForm: {
      kind: "identity-verify",
      subject: operatorDisplayLabel(op),
      channels: ["视频核实", "当面核实", "回拨预留工作号"],
      ticketHint: "如 SEC-20260618-001",
    },
    run: async (reason, _value, businessValue) => {
      const verify = `核验 ${businessValue?.channel ?? "—"} · ${businessValue?.verifiedAt || "—"} · 工单 ${businessValue?.ticket || "—"}`;
      const def = findHighOp("a1_account_reset_2fa")!;
      await propose(toast, {
        action: `重置两步验证 · ${operatorDisplayName(op)}`,
        obj: String(op.id),
        before: "已绑定",
        after: "待重新绑定",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason: `${reason}；${verify}`,
        sourceDomain: "A1",
        command: def.buildCommand({ accountId: op.id, expectedVersion: op.version }),
        target: def.buildTarget({ accountId: op.id }),
      });
    },
  });

  const resetPassword = (op: A1Operator) => openOperation({ kind: "password", account: op }, { briefKind: "security",
    action: `重置密码 · ${operatorDisplayName(op)}`,
    title: "重置密码",
    detail: "系统生成临时密码并让该账号所有设备下线，对方下次登录须先改密码。",
    amplifies: false,
    effect: <>{directTag()}</>,
    confirmTone: "danger",
    confirmLabel: "确认重置密码",
    facts: (
      <Facts>
        <Fact k="账号">{operatorDisplayLabel(op)}</Fact>
        <Fact k="登录名"><span data-mono>{op.username || "未返回"}</span></Fact>
        <Fact k="在线设备">{op.sessions} 台，确认后马上全部下线</Fact>
        <Fact k="两步验证">不变</Fact>
      </Facts>
    ),
    statedBrief: {
      impact: "确认后马上生成 20 位临时密码，只在结果里显示一次；这个账号所有设备下线，下次登录先改密码。",
      check: "提交时检查重置密码权限、账号版本和当前身份；核验方式、时间和工单号写进理由。",
    },
    businessForm: {
      kind: "identity-verify",
      subject: operatorDisplayLabel(op),
      channels: ["视频核实", "当面核实", "回拨预留工作号"],
      ticketHint: "如 SEC-20260618-001",
    },
    run: async (reason, _value, businessValue) => {
      const verify = `核验 ${businessValue?.channel ?? "—"} · ${businessValue?.verifiedAt || "—"} · 工单 ${businessValue?.ticket || "—"}`;
      await submitRequest({ kind: "password", accountId: op.id, expectedVersion: op.version, reason: `${reason}；${verify}`, operator });
      toast(`${operatorDisplayName(op)} 密码已重置 · 临时密码只展示在当前弹窗`);
      return true;
    },
  });

  const editAccount = (op: A1Operator, form: A1UpdateAccountInput & { reason: string }) => {
    const usernameChanged = form.username !== (op.username || "").trim().toLowerCase();
    openOperation({ kind: "profile", account: op, form }, { briefKind: "security",
      action: `编辑账号 · ${operatorDisplayName(op)}`,
      title: "提交资料修改",
      detail: "登录名和邮箱不能与其他账号重复；改登录名后该账号会被强制下线。",
      amplifies: false,
      effect: approvalTag("批准前资料和头像都不变。"),
      confirmLabel: "提交审批",
      facts: (
        <Facts>
          <Fact k="账号">{operatorDisplayLabel(op)}</Fact>
          {usernameChanged && <Fact k="登录名"><Change from={op.username || "未返回"} to={form.username} /></Fact>}
          {form.displayName !== operatorDisplayName(op) && <Fact k="显示名"><Change from={operatorDisplayName(op)} to={form.displayName} /></Fact>}
          {(form.email ?? "") !== (op.email || "") && <Fact k="工作邮箱"><Change from={op.email || "未填写"} to={form.email || "未填写"} /></Fact>}
          {form.avatarAssetId && form.avatarAssetId !== op.avatarAssetId && <Fact k="头像">换成新头像</Fact>}
          {approverFact()}
        </Facts>
      ),
      statedBrief: {
        impact: usernameChanged
          ? "批准后改资料；登录名改了，这个账号所有设备下线，要用新登录名重新登录。"
          : "批准后改资料，已登录的设备不下线；新头像批准后才换上。",
        check: "批准执行时核对账号版本，并检查登录名、邮箱不重复。",
      },
      run: async (reason) => {
        const finalReason = `${form.reason}；${reason}`;
        const def = findHighOp("a1_account_update_profile")!;
        const outcome = await propose(toast, {
          action: `编辑账号 · ${operatorDisplayName(op)}`,
          obj: String(op.id),
          before: op.username || "—",
          after: form.username,
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason: finalReason,
          sourceDomain: "A1",
          command: def.buildCommand({
            accountId: op.id,
            username: form.username,
            displayName: form.displayName,
            email: form.email,
            avatarAssetId: form.avatarAssetId,
            avatarGender: form.avatarGender,
            expectedVersion: op.version,
          }),
          target: def.buildTarget({ accountId: op.id }),
        });
        if (outcome === "proposed" && currentAdminId) avatarDrafts.forget(avatarDraftFingerprint(currentAdminId, "admin", op.id));
        if (outcome === "proposed") setEditAccountTarget(null);
        return outcome === "proposed";
      },
    });
  };

  const disableAcct = (op: A1Operator) => {
    if (!restoring.current && op.role === "super" && op.status === "enabled" && effectiveSupers - 1 < 2) {
      toast("不能执行：有效的超级管理员会少于 2 人");
      return;
    }
    const displayName = operatorDisplayName(op);
    const countsAsEffective = op.role === "super" && op.status === "enabled" && op.tfa;
    const savedEffectiveSupers = restoring.current?.snapshot.effectiveSupers ?? effectiveSupers;
    // 决定表「A1-自停」：允许停用自己，确认框必须写明后果。
    const isSelf = currentAdminId !== null && operatorAccountId(op.id) === currentAdminId;
    openOperation({ kind: "disable", account: op }, { briefKind: "security",
      action: `禁用账号 · ${displayName}`,
      title: isSelf ? "停用你自己的账号" : "停用账号",
      detail: isSelf ? "这是你自己的账号，批准后你会被登出、不能再登录。" : "停用后该账号不能登录；它提交但还没确认的操作，请到「操作记录与审批」处理。",
      amplifies: false,
      effect: approvalTag("批准前账号照常可以登录。"),
      confirmTone: "danger",
      confirmLabel: "提交审批",
      facts: (
        <Facts>
          <Fact k="账号" tone={isSelf ? "danger" : undefined}>{operatorDisplayLabel(op)}{isSelf ? "（你自己）" : ""}</Fact>
          <Fact k="角色">{roleName(restoring.current?.snapshot.roles ?? roles, op.role)}，停用后保留</Fact>
          <Fact k="状态"><Change from="启用" to="已停用" /></Fact>
          <Fact k="在线设备">{op.sessions} 台，批准后全部下线</Fact>
          {countsAsEffective && <Fact k="有效的超级管理员"><Change from={`${savedEffectiveSupers} 人`} to={`${savedEffectiveSupers - 1} 人`} /></Fact>}
          {approverFact()}
        </Facts>
      ),
      statedBrief: {
        impact: `${isSelf ? "批准后你会被登出、不能再登录，只能请别的超级管理员重新启用。" : "批准后这个账号所有设备下线、不能再登录，角色保留。"}它发起的待审批单不会自动撤回；有主管资格时要先交接负责的组。`,
        check: "批准执行时核对账号版本、有效的超级管理员不少于 2 人和客服交接。",
      },
    run: async (reason) => {
      const def = findHighOp("a1_account_status_update")!;
      await propose(toast, {
        action: `禁用账号 · ${displayName}`,
        obj: String(op.id),
        before: "启用",
        after: "禁用",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "A1",
        command: def.buildCommand({ accountId: op.id, status: "disabled", expectedVersion: op.version }),
        target: def.buildTarget({ accountId: op.id }),
      });
    },
    });
  };

  const enableAccountBlockReason = (op: A1Operator) => {
    if (!canChangeStatus) return "你没有启停账号的权限";
    if (governanceFrozen && (op.role !== "super" || !op.tfa)) return "恢复期间只能启用已绑定两步验证的超级管理员";
    return null;
  };

  const enableAcct = (op: A1Operator) => {
    const blocked = enableAccountBlockReason(op);
    if (!restoring.current && blocked) { toast(blocked); return; }
    openOperation({ kind: "enable", account: op }, { briefKind: "security",
    action: `启用账号 · ${operatorDisplayName(op)}`,
    title: "启用账号",
    detail: "批准后可以重新登录，角色不变。",
    amplifies: false,
    effect: approvalTag("批准前账号仍是停用的。"),
    confirmLabel: "提交审批",
    facts: (
      <Facts>
        <Fact k="账号">{operatorDisplayLabel(op)}</Fact>
        <Fact k="状态"><Change from="已停用" to="启用" /></Fact>
        <Fact k="角色">{roleName(restoring.current?.snapshot.roles ?? roles, op.role)}，不变</Fact>
        <Fact k="两步验证">{op.tfa ? "已绑定，不变" : "未绑定，登录时先绑定"}</Fact>
        {approverFact()}
      </Facts>
    ),
    statedBrief: {
      impact: "批准后可以重新登录，角色和两步验证保持原样；之前撤掉的客服资格不会自动恢复。",
      check: "批准执行时核对账号版本；恢复期间只能启用已绑定两步验证的超级管理员。",
    },
    run: async (reason) => {
      const def = findHighOp("a1_account_status_update")!;
      await propose(toast, {
        action: `启用账号 · ${operatorDisplayName(op)}`,
        obj: String(op.id),
        before: "禁用",
        after: "启用",
        type: "acct",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "A1",
        command: def.buildCommand({ accountId: op.id, status: "enabled", expectedVersion: op.version }),
        target: def.buildTarget({ accountId: op.id }),
      });
    },
    });
  };

  const kickAllSessions = (op: A1Operator) => {
    const displayName = operatorDisplayName(op);
    const blocked = forceLogoutBlockReason(op);
    if (!restoring.current && blocked) {
      toast(`${displayName}: ${blocked}`);
      return;
    }
    openOperation({ kind: "logout", account: op }, { briefKind: "security",
      action: `强制登出 · ${displayName}`,
      title: "撤销全部登录",
      detail: "只有超级管理员能操作；不能撤销自己的登录，也不能撤销其他超级管理员的登录。",
      amplifies: false,
      effect: approvalTag("批准前设备仍在线。"),
      confirmLabel: "提交审批",
      facts: (
        <Facts>
          <Fact k="账号">{operatorDisplayLabel(op)}</Fact>
          <Fact k="在线设备">现在 {op.sessions} 台，批准时在线的全部下线</Fact>
          <Fact k="密码和两步验证">不变，可以马上重新登录</Fact>
          {approverFact()}
        </Facts>
      ),
      statedBrief: {
        impact: "另一位超级管理员批准后，批准时在线的设备全部下线；不改密码和两步验证，对方可以马上重新登录。要让对方登录不了，用「停用账号」。",
        check: "批准执行时核对账号版本，并检查目标不是超级管理员、不是批准人自己。",
      },
      run: async (reason) => {
        const def = findHighOp("a1_account_force_logout")!;
        await propose(toast, {
          action: `强制登出 · ${displayName}`,
          obj: String(op.id),
          before: `${op.sessions} active sessions`,
          after: "0 active sessions",
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "A1",
          command: def.buildCommand({ accountId: op.id, expectedVersion: op.version }),
          target: def.buildTarget({ accountId: op.id }),
        });
      },
    });
  };

  const adjustBaseline = (baseline: SecurityBaselineRow) => {
    if (baseline.sourceKey === "session") {
      const idlePolicy = parsedSessionBaseline.idleDisabled ? "无操作自动登出已关闭"
        : parsedSessionBaseline.idleMinutes ? `${parsedSessionBaseline.idleMinutes} 分钟无操作自动登出` : "无操作登出时间未获取到";
      const absolutePolicy = parsedSessionBaseline.unlimited ? "无固定登录上限"
        : parsedSessionBaseline.absoluteHours ? `最长保持登录 ${parsedSessionBaseline.absoluteHours} 小时` : "最长登录时间未获取到";
      toast(`登录时长由系统固定，不能修改：${idlePolicy}，${absolutePolicy}`);
      return;
    }
    if (baseline.locked) {
      toast("这项设置由系统固定，不能修改");
      return;
    }
    if (baseline.current == null) {
      toast("没有获取到当前值，请刷新后重试");
      return;
    }
    const curN = Number(baseline.current);
    const siblingNumber = (key: string) => {
      const current = baselineCurrent(key);
      if (current == null) return null;
      const value = Number(current);
      return Number.isFinite(value) ? value : null;
    };
    if (!Number.isFinite(curN)) {
      toast("没有获取到当前值，请刷新后重试");
      return;
    }
    openActionConfirm({ briefKind: "config",
      action: `调整 · ${baseline.name}`,
      detail: `${baseline.name}：当前 ${curN} ${baseline.unit ?? ""}，可填 ${baseline.min}–${baseline.max} ${baseline.unit ?? ""}。`,
      amplifies: false,
      edit: { kind: "number", current: `${curN} ${baseline.unit}`, unit: baseline.unit },
      run: (reason, value) => {
        const n = Number((value ?? "").replace(/[^\d.]/g, "").trim());
        if (!Number.isFinite(n) || n < baseline.min! || n > baseline.max!) {
          toast(`${baseline.name}需在 ${baseline.min}–${baseline.max} ${baseline.unit} 之间`);
          return;
        }
        let backendKey: "session" | "lock";
        let backendValue: string;
        if (baseline.key === "lock_short_cnt" || baseline.key === "lock_short_min") {
          const count = baseline.key === "lock_short_cnt" ? n : siblingNumber("lock_short_cnt");
          const minutes = baseline.key === "lock_short_min" ? n : siblingNumber("lock_short_min");
          if (count == null || minutes == null) {
            toast("当前锁定设置不完整，请刷新后重试");
            return;
          }
          backendKey = "lock";
          backendValue = `${count} 次 / ${minutes}min`;
        } else {
          toast("这项设置暂不支持修改");
          return;
        }
        const def = findHighOp("a1_security_baseline_update")!;
        void propose(toast, {
          action: `调整 · ${baseline.name}`,
          obj: backendKey,
          before: baselineDisplay(baseline),
          after: `${n} ${baseline.unit ?? ""}`.trim(),
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "A1",
          command: def.buildCommand({
            baselineKey: backendKey,
            value: backendValue,
            expectedValue: registeredBaseline(backendKey)?.value ?? "",
          }),
          target: def.buildTarget({ baselineKey: backendKey }),
        });
      },
    });
  };

  const createFacts = (form: A1CreateAccountInput & { reason: string }) => (
    <Facts>
      <Fact k="显示名">{form.displayName}</Fact>
      <Fact k="登录名"><span data-mono>{form.username}</span></Fact>
      <Fact k="工作邮箱">{form.email || "未填写"}</Fact>
      <Fact k="角色">{roleName(restoring.current?.snapshot.roles ?? roles, form.role)} · {permSummary(form.role ? (restoring.current?.snapshot.permissionReady ?? permissionDiffReady) ? codesOf(form.role) : null : [])}</Fact>
      {form.role === "support" && <Fact k="头像">{form.useDefaultAvatar ? "随机默认头像" : form.avatarAssetId ? "已上传的新头像" : "暂不设置"}</Fact>}
    </Facts>
  );

  const createAccount = (form: A1CreateAccountInput & { reason: string }) => {
    if (restoring.current ? restoring.current.intent.kind === "create" && restoring.current.intent.approval : governanceFrozen) {
      const definition = findHighOp("a1_account_create")!;
      openOperation({ kind: "create", form, approval: true }, { briefKind: "security",
        action: `提交新建账号审批 · ${form.displayName}`,
        title: "提交新建超级管理员审批",
        detail: "这里只提交提案，须另一位超级管理员批准后才创建账号。",
        amplifies: false,
        effect: approvalTag("批准前账号不会建好。"),
        confirmLabel: "提交审批",
        facts: <>{createFacts(form)}<Facts>{approverFact()}</Facts></>,
        statedBrief: {
          impact: "另一位超级管理员批准后才创建账号；本页拿不到临时密码，批准后到账号列表点「重置密码」，把临时密码交给本人。",
          check: "提交时检查当前身份和审批发起权限；批准时再检查登录名、邮箱不重复，恢复期只能建超级管理员。",
        },
        run: async (reason) => {
          await propose(toast, {
            action: definition.action, obj: form.username, before: "账号尚未创建",
            after: `${form.displayName} · ${roleName(restoring.current?.snapshot.roles ?? roles, form.role)}`, type: definition.type,
            amplifies: false, gate: { roles: [] }, gateLabel: definition.gateLabel,
            reason: `${form.reason}；${reason}`, sourceDomain: "A1",
            command: definition.buildCommand({ ...form }), target: definition.buildTarget({ ...form }),
          });
          setNaOpen(false);
        },
      });
      return;
    }
    openOperation({ kind: "create", form, approval: false }, { briefKind: "security",
      action: `新建运营账号 · ${form.displayName}`,
      title: "新建运营账号",
      detail: form.role === "support" ? "按所选角色开通权限；首次登录须修改密码。专属客服仅服务本人绑定客户，主管资格需另行授予。" : "按所选角色开通权限；首次登录须修改密码。",
      amplifies: false,
      effect: directTag(),
      confirmLabel: "确认创建账号",
      facts: createFacts(form),
      statedBrief: {
        impact: form.role === "support"
          ? "确认后马上建好启用的账号，显示一次 20 位临时密码；首次登录先绑定两步验证再改密码。客服账号自动有专属客服资格（未分组）。"
          : "确认后马上建好启用的账号，显示一次 20 位临时密码；首次登录先绑定两步验证再改密码。",
        check: "提交时检查当前身份、登录名和邮箱不重复、角色可用；同一次提交重试不会建第二个账号。",
      },
      run: async (reason) => {
        const finalReason = `${form.reason}；${reason}`;
        const result = await submitRequest({ kind: "create", input: {
          username: form.username, displayName: form.displayName, email: form.email, avatarAssetId: form.avatarAssetId,
          avatarGender: form.avatarGender, useDefaultAvatar: form.useDefaultAvatar, role: form.role,
        }, reason: finalReason, operator });
        setNaOpen(false);
        toast(`${form.displayName} 已创建，首次登录需绑定两步验证并修改密码`);
        if (result.kind === "create" && form.useDefaultAvatar && !result.account.avatarAssetId) toast("账号已创建，但默认头像暂缺，请在账号资料里上传头像。不要重复创建账号。");
        return true;
      },
    });
  };

  const submitPermissionRegistration = (originalDraft?: typeof permissionDraft) => {
    const draft = originalDraft ?? permissionDraft;
    if (!restoring.current && (governanceFrozen || !canRegisterPermission || !draft.code.trim() || !draft.name.trim() || !draft.path.trim())) return;
    openOperation({ kind: "permission", draft }, { briefKind: "config",
      action: `登记动作权限 · ${draft.code.trim()}`,
      title: "登记新权限",
      detail: "把新操作加入权限清单，不会自动分给任何角色。需要时到「角色管理」授权。",
      amplifies: draft.amplifies,
      coverageLead: "这项权限标记为「会让平台多付钱」",
      coverageCheck: "登记本身不付款、不检查覆盖率；勾了这项，按「高危」类型登记。",
      effect: <>{directTag()}<StatusTag tone="neutral">不改任何人的权限</StatusTag></>,
      confirmLabel: "确认登记",
      facts: (
        <Facts>
          <Fact k="权限编码"><span data-mono>{draft.code.trim()}</span></Fact>
          <Fact k="权限名称">{draft.name.trim()}</Fact>
          <Fact k="资源路径"><span data-mono>{draft.path.trim()}</span></Fact>
          <Fact k="权限类型">{draft.amplifies ? "高危" : draft.type === "READ" ? "查询" : "修改"}</Fact>
        </Facts>
      ),
      statedBrief: {
        impact: "确认后写进权限清单，不分给任何角色；要用这项权限，到「角色管理」分配给角色。",
        check: "提交时检查权限码格式、资源路径和这个码还没登记过。",
      },
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason) => {
        await submitRequest({ kind: "permission", input: {
          permissionCode: draft.code.trim(), permissionName: draft.name.trim(), resourcePath: draft.path.trim(),
          permType: draft.amplifies ? "HIGH" : draft.type, amplifies: draft.amplifies, reason, operator,
        } });
        toast(`${draft.code.trim()} 已登记，尚未分给任何角色`);
        setPermissionDraft({ code: "", name: "", path: "", type: "WRITE", amplifies: false });
        return true;
      },
    });
  };

  const revokeOneSession = (target: A1Operator, sessionId: string) => {
    const session = (target.sessionDetails ?? []).find((row) => row.sessionId === sessionId);
    openOperation({ kind: "session", account: target, sessionId }, { briefKind: "security",
      action: `让单台设备下线 · ${operatorDisplayName(target)}`,
      title: "让这台设备下线",
      detail: `只让这台设备（${sessionId}）下线，不影响该账号的其他设备。`,
      amplifies: false,
      effect: directTag(),
      confirmLabel: "确认让这台设备下线",
      facts: (
        <Facts>
          <Fact k="账号">{operatorDisplayLabel(target)}</Fact>
          <Fact k="设备">{session?.device || "未知设备"}</Fact>
          <Fact k="IP"><span data-mono>{session?.ipAddress || "未返回"}</span></Fact>
          <Fact k="最近活动">{minuteText(session?.lastSeenAt)}</Fact>
        </Facts>
      ),
      statedBrief: {
        impact: "确认后只让这台设备马上下线，这个账号的其他设备不受影响；对方可以重新登录。",
        check: "提交时检查撤销登录权限、账号版本和这台设备还在线。",
      },
      run: async (reason) => {
        await submitRequest({ kind: "session", accountId: target.id, sessionId, expectedVersion: target.version, reason, operator });
        setDetailAccount(null);
        toast("该设备已下线");
        return true;
      },
    });
  };

  // 每个账号能做的事：行尾菜单和详情抽屉用同一份，按钮上写明为什么不能做。
  const busyReason = mutatingAction ? "正在提交，请稍候" : !overviewReady ? errorMessage(new Error("A1_FRESH_OVERVIEW_REQUIRED")) : null;
  const accountActions = (op: A1Operator): A1AccountAction[] => {
    const enabled = op.status === "enabled";
    const list: A1AccountAction[] = [
      { key: "edit", label: "编辑资料", verb: "编辑", icon: PencilLine, mode: "approval", impact: "改登录名会让全部设备下线", disabledReason: profileEditBlockReason, onSelect: () => { setDetailAccount(null); setEditAccountTarget(op); } },
      { key: "role", label: "改角色", verb: "改角色", icon: UserCog, mode: "approval", impact: "权限随新角色变，已登录的不下线", disabledReason: busyReason ?? (!roles.length ? "角色目录没有读到" : changeRoleBlockReason(op)), onSelect: () => changeRole(op) },
      { key: "password", label: "重置密码", verb: "重置", icon: KeyRound, mode: "direct", impact: "全部设备马上下线，下次先改密码", disabledReason: !canResetPassword ? "需要超级管理员和重置密码权限" : busyReason ?? (governanceFrozen ? "有效的超级管理员不足 2 人，暂时不能重置密码" : null), onSelect: () => resetPassword(op) },
      { key: "2fa", label: "重置两步验证", verb: "重置", icon: ShieldUser, mode: "approval", impact: "全部设备下线，下次登录重新绑定", disabledReason: busyReason ?? reset2faBlockReason(op), onSelect: () => reset2fa(op) },
      { key: "logout", label: "撤销全部登录", verb: "撤销", icon: LogOut, mode: "approval", impact: "全部设备下线，可以马上重新登录", disabledReason: busyReason ?? (!canPropose ? errorMessage(new Error("A1_OPERATION_FORBIDDEN")) : forceLogoutBlockReason(op)), onSelect: () => kickAllSessions(op) },
      enabled
        ? { key: "status", label: "停用账号", verb: "停用", icon: UserMinus, mode: "approval", impact: "全部设备下线，之后不能再登录", danger: true, disabledReason: busyReason ?? disableAccountBlockReason(op), onSelect: () => disableAcct(op) }
        : { key: "status", label: "启用账号", verb: "启用", icon: UserPlus, mode: "approval", impact: "可以重新登录，角色不变", disabledReason: busyReason ?? enableAccountBlockReason(op), onSelect: () => enableAcct(op) },
    ];
    if (canManageQualifications) {
      const blocked = busyReason ?? (governanceFrozen ? "有效的超级管理员不足 2 人，暂时不能改资格" : null);
      list.push(
        { key: "service", label: "专属客服资格", verb: "管理", icon: Headset, mode: "direct", impact: "不改角色，管能否接待本人客户", explain: "资格不是角色，单独管理；首次启用会把账号放进未分组成员，不会自动绑定或改派客户。停用、移除前要先交接本人客户并退出组。", disabledReason: blocked, onSelect: () => setQualificationTarget({ id: op.id, kind: "SERVICE" }) },
        { key: "supervisor", label: "主管资格", verb: "管理", icon: UsersRound, mode: "direct", impact: "不改角色，管客服组", explain: "和专属客服资格互相独立，可以兼任；主管资格不带账号管理权限。停用、移除前要把负责的组（含已归档的）交接给别的主管。", disabledReason: blocked, onSelect: () => setQualificationTarget({ id: op.id, kind: "SUPERVISOR" }) },
      );
    }
    const pending = pendingFor({ kind: "password", account: op });
    return list.map(action => ({ ...action, disabledReason: action.disabledReason ?? (pending ? pending.ticket?.status === "pending" ? "已提交，等待审批后执行" : errorMessage(new Error("A1_ORIGINAL_OPERATION_PENDING")) : null) }));
  };
  const menuItems = (op: A1Operator): MoreMenuItem[] => accountActions(op).map((action) => ({ key: action.key, label: action.label, danger: action.danger, disabledReason: action.disabledReason ?? undefined, onSelect: action.onSelect }));

  const canWriteSomething = canCreateAccount || canEditAccount || canChangeRole || canReset2fa || canResetPassword || canChangeStatus || canRegisterPermission || canManageQualifications;
  const header = (
    <PageHeader pageId="A1" title="运营账号与权限" summary="管谁能登录后台、是什么角色、能做什么。"
      readOnly={overview && !canWriteSomething ? "当前账号只能查看，账号操作都不可用" : undefined}
      actions={<>
        <Button icon={<RefreshCw size={14} />} loading={loading && Boolean(overview)} disabledReason={mutatingAction ? "正在提交，请稍候" : undefined} onClick={() => void refreshOverview(true)}>刷新</Button>
        <Button variant="primary" icon={<UserPlus size={14} />} disabledReason={!overviewReady ? errorMessage(new Error("A1_FRESH_OVERVIEW_REQUIRED")) : !canCreateAccount ? "需要超级管理员和账号管理权限" : governanceFrozen && !canPropose ? errorMessage(new Error("A1_OPERATION_FORBIDDEN")) : creationPending ? errorMessage(new Error("A1_ORIGINAL_OPERATION_PENDING")) : !roles.length ? "角色目录没有读到" : mutatingAction ? "正在提交，请稍候" : undefined} onClick={() => setNaOpen(true)}>{governanceFrozen && overview ? "新建超级管理员" : "新建账号"}</Button>
      </>} />
  );

  const restoreOperation = (record: A1Pending) => {
    restoring.current = record;
    try {
      const intent = record.intent;
      switch (intent.kind) {
        case "create": createAccount(intent.form); break;
        case "profile": editAccount(intent.account, intent.form); break;
        case "role": confirmRoleChange(intent.account, intent.picked); break;
        case "2fa": reset2fa(intent.account); break;
        case "password": resetPassword(intent.account); break;
        case "disable": disableAcct(intent.account); break;
        case "enable": enableAcct(intent.account); break;
        case "logout": kickAllSessions(intent.account); break;
        case "session": revokeOneSession(intent.account, intent.sessionId); break;
        case "permission": submitPermissionRegistration(intent.draft); break;
      }
    } finally { restoring.current = null; }
  };
  const releaseExpiredProposal = (record: A1Pending) => ctx.openConfirm({
    briefKind: "security", action: "解除原操作记录", title: "解除原操作记录", reason: false,
    detail: errorMessage(new Error("A1_EXPIRED_PROPOSAL_NOT_FOUND")),
    run: async () => {
      if (Date.now() < record.expiresAt || record.request.kind !== "proposal" || await fetchA2ProposalByKey(record.commandKey, true, true)) throw new Error("A1_ORIGINAL_OPERATION_PENDING");
      recoveryStarted(); await refreshOverview(true);
      a1PendingCommands.forget(record.fingerprint, record.commandKey); reloadPending();
    },
  });
  const recoveryRows = pendingOperations.map(record => {
    const intent = record.intent, request = record.request;
    const expired = Date.now() >= record.expiresAt;
    let retryBlock: string | undefined;
    try { requireActor(intent, true, request.kind === "proposal"); } catch (error) { retryBlock = errorMessage(error); }
    return {
      key: record.commandKey,
      name: request.kind === "proposal" ? request.input.action.replace(/ \(A1\)$/, "") : intent.kind === "create" ? "新建账号" : intent.kind === "password" ? "重置密码" : intent.kind === "session" ? "让这台设备下线" : "登记新权限",
      change: request.kind === "proposal" ? <Change from={request.input.beforeValue} to={request.input.afterValue} />
        : intent.kind === "create" ? <>{intent.form.displayName} · <span data-mono>{intent.form.username}</span> · {roleName(record.snapshot.roles, intent.form.role)} · {intent.form.email || "未填邮箱"}</>
        : intent.kind === "permission" ? `${intent.draft.code} · ${intent.draft.name}` : operatorDisplayLabel(intent.account),
      submittedAt: record.createdAt,
      tag: record.ticket?.status === "pending" ? <StatusTag tone="progress">待审批</StatusTag>
        : expired ? expiredTag(intent.kind === "create" && request.kind !== "proposal" ? "原请求超过 24 小时，不能再重试。先在账号列表核对是否已建好，不要重复创建。" : undefined)
        : unknownTag(request.kind === "proposal" ? "approval" : "direct", request.kind === "proposal" ? undefined : DIRECT_UNKNOWN_NOTE[intent.kind]),
      actions: <>
        <Button size="sm" disabledReason={mutatingAction ? "正在提交，请稍候" : undefined} onClick={() => void queryOriginal(record).catch(error => toast(errorMessage(error)))}>查询原结果</Button>
        {!record.ticket && !expired && <Button size="sm" variant="primary" disabledReason={mutatingAction ? "正在提交，请稍候" : retryBlock} onClick={() => restoreOperation(record)}>按原请求重试</Button>}
        {request.kind === "proposal" && expired && record.proposalNotFound && <Button size="sm" onClick={() => releaseExpiredProposal(record)}>解除原操作记录</Button>}
      </>,
    };
  });
  const qualificationPending = groupPendingCommands.list().filter((r): r is GroupPendingRecord => !isInvitePending(r) && r.actorId === currentAdminId && r.intent.kind === "QUALIFICATION");
  for (const record of qualificationPending) {
    if (record.intent.kind !== "QUALIFICATION") continue;
    const intent = record.intent;
    recoveryRows.push({ key: record.commandKey, name: record.label, change: intent.payload.state, submittedAt: record.createdAt, tag: Date.now() >= record.createdAt + 86400000 ? expiredTag() : unknownTag("direct", "提交时没收到确定结果，资格可能已经改了。这里只能查询：点「查询原结果」核对当前资格。"), actions: <Button size="sm" onClick={() => setQualificationTarget({ id: intent.targetId, kind: intent.payload.qualificationKind })}>查询原结果</Button> });
  }
  for (const draft of avatarDrafts.list().filter(row => row.actorId === currentAdminId && row.scope === "admin" && (!row.asset || row.cancelKey))) {
    const target = draft.fingerprint.split(":")[2] ?? "new";
    recoveryRows.push({ key: draft.cancelKey ?? draft.commandKey, name: draft.cancelKey ? "取消账号头像" : "准备账号头像", change: <>{draft.kind === "UPLOAD" ? draft.fileName ?? "上传的图片" : "随机默认头像"} · {target === "new" ? "新建账号" : <>账号编号 <span data-mono>{target}</span></>}</>, submittedAt: draft.createdAt,
      tag: Date.now() >= draft.expiresAt ? expiredTag("原请求超过 24 小时，不能再重试；头像没有按原请求查询的接口，请联系值班人员核对。")
        : unknownTag("direct", draft.cancelKey
          ? "提交时没收到确定结果，取消可能已经生效。取消不能重试，后端也没有原请求回执，只能联系值班人员核对。"
          : "提交时没收到确定结果，头像可能已经准备好。24 小时内可以点「处理原头像」按原请求重试，上传的要选同一张图片。"),
      actions: <>
        <Button size="sm" onClick={() => void (async () => {
          requireActor(null, false);
          if (!await refreshOverview(true)) throw new Error("A1_FRESH_OVERVIEW_REQUIRED");
          toast(errorMessage(new Error("A1_AVATAR_READBACK_ONLY")));
        })().catch(error => toast(errorMessage(error)))}>查询原结果</Button>
        {!draft.cancelKey && Date.now() < draft.expiresAt && <Button size="sm" variant="primary" onClick={() => setAvatarRecovery(target)}>处理原头像</Button>}
      </>,
    });
  }
  const pendingCount = recoveryRows.filter(row => pendingOperations.some(record => record.commandKey === row.key && record.ticket?.status === "pending")).length;
  const recoveryTitle = [recoveryRows.length - pendingCount && `${recoveryRows.length - pendingCount} 个结果未知`, pendingCount && `${pendingCount} 个待审批`].filter(Boolean).join("、");
  const recovery = <><A1RecoveryNotice title={`账号原操作：${recoveryTitle}`} rows={recoveryRows} />
    {avatarRecovery !== null && <AvatarRecoveryModal target={avatarRecovery} onClose={() => setAvatarRecovery(null)} />}{qualificationTarget && <SupportQualificationEditor adminId={qualificationTarget.id} kind={qualificationTarget.kind} writeBlockedReason={!overviewReady ? errorMessage(new Error("A1_FRESH_OVERVIEW_REQUIRED")) : governanceFrozen ? "有效的超级管理员不足 2 人，暂时不能改资格" : undefined} onClose={() => setQualificationTarget(null)} onChanged={() => void refreshOverview(true)} />}</>;

  if (loading && !overview) {
    return <div className="a1-page">{header}{recovery}<BlockState state="loading" title="正在加载运营账号与权限" /></div>;
  }

  if (!overview) {
    return (
      <div className="a1-page">
        {header}
        {recovery}
        <Conclusion state="warn" icon={ShieldCheck}>运营账号没有读到，安全状况这部分没有判断</Conclusion>
        <BlockState state="error" title="运营账号没有读到" detail={loadError || "请重试，持续失败请联系值班人员。"} onRetry={() => void refreshOverview()} retryLabel="重试" />
      </div>
    );
  }

  const sessionSummary = parsedSessionBaseline.idleDisabled ? "无操作不自动登出" : parsedSessionBaseline.idleMinutes ? `无操作 ${parsedSessionBaseline.idleMinutes} 分钟登出` : "登录时长没有读到";
  const lockSummary = baselineCurrent("lock_short_cnt") && baselineCurrent("lock_short_min") ? `连续输错 ${baselineCurrent("lock_short_cnt")} 次锁 ${baselineCurrent("lock_short_min")} 分钟` : "锁定规则没有读到";
  const pending = stats?.pendingAcctTickets;

  const conclusion = !stats
    ? { state: "warn" as const, text: "账号统计没有读到，有效的超级管理员人数这部分没有判断", hint: "点「刷新」重读。" }
    : governanceFrozen
      ? { state: "danger" as const, text: `有效的超级管理员只有 ${effectiveSupers} 人，账号管理进入恢复期`, hint: "先新建或提升一位超级管理员，要另一位超级管理员批准。" }
      : creationPending
        ? { state: "warn" as const, text: "有 1 个新建账号结果未知，先核对再继续", hint: "在上方点「按原请求重试」，不会建第二个。" }
        : unboundOps.length
          ? { state: "warn" as const, text: `${unboundOps.length} 个启用中的账号还没绑定两步验证`, hint: "提醒本人登录后完成绑定。" }
          : effectiveSupers === 2
            ? { state: "ok" as const, text: "后台账号安全正常，有效的超级管理员正好 2 人", hint: "再停用或降级一位会被拦下。" }
            : { state: "ok" as const, text: `后台账号安全正常：有效的超级管理员 ${effectiveSupers} 人，启用账号都已绑定两步验证`, hint: undefined };

  const detailIndex = detailAccount ? pageRows.findIndex((row) => row.id === detailAccount.id) : -1;
  const roleCodesOf = (op: A1Operator) => permissionDiffReady ? codesOf(op.role) : null;

  return (
    <div className="a1-page">
      {header}
      {loadError && <Notice tone="danger" title="刷新失败，下面是上次读到的数据" action={<Button size="sm" onClick={() => void refreshOverview()}>重试</Button>}>{loadError}</Notice>}
      {mutatingAction && <Notice tone="progress">正在提交：{mutatingAction}</Notice>}
      {recovery}
      <Conclusion state={conclusion.state} icon={ShieldCheck} hint={conclusion.hint}
        explainTitle={governanceFrozen && stats ? "恢复期能做什么" : undefined}
        explain={governanceFrozen && stats
          ? <><p>只能新建或提升超级管理员、启用已绑定两步验证的超级管理员，都要另一位超级管理员批准。</p><p>资料、密码、两步验证、停用、资格和权限登记暂停；撤销登录不受影响。</p><p>没有第二位能批准的超级管理员时，请运维执行服务器恢复。</p></>
          : "有效的超级管理员要同时满足：启用、超级管理员角色、已绑定两步验证，只按真实绑定计算。两步验证按账号列表里启用中的账号统计。"}>{conclusion.text}</Conclusion>

      <StatBand label="账号安全">
        <Stat lead icon={ShieldUser} tone={!stats ? undefined : effectiveSupers < 2 ? "danger" : "role-3"} label="有效的超级管理员" value={stats ? String(effectiveSupers) : "—"} unit={stats ? "人" : undefined}
          sub={`底线 2 人 · 启用的超级管理员 ${enabledSupers.length} 人`}
          explain="启用、超级管理员角色、已绑定两步验证三样都满足才算。少于 2 人时进入恢复期，只能新建或恢复超级管理员。点这格只看超级管理员。"
          onOpen={() => pickFilter("super")} openLabel="只看超级管理员" selected={filter === "super"} selectedText="已筛选" aria-pressed={filter === "super"} />
        <Stat icon={ShieldCheck} tone={unboundOps.length ? "warn" : "role-3"} label="未绑定两步验证" value={String(unboundOps.length)} unit="个"
          sub={`启用账号 ${enabledOps.length} 个`}
          explain="启用中的账号里还没绑定的。没绑定的账号登录时要先绑定，绑定前不能正常使用后台；例外是 superadmin 在临时绕过开关打开时可免验证登录，发布前必须关闭。点这格只看这些账号。"
          onOpen={() => pickFilter("unbound")} openLabel="只看未绑定两步验证的账号" selected={filter === "unbound"} selectedText="已筛选" aria-pressed={filter === "unbound"} />
        <Stat icon={ClipboardCheck} tone="role-3" label="待审批的账号变更" value={pending === undefined || pending === null ? "—" : String(pending)} unit={pending === undefined || pending === null ? undefined : "件"}
          explain="按操作名统计，资料、角色、两步验证、启停、撤销全部登录的申请目前可能没算进来，数字会偏少。以「操作记录与审批」里的待审批为准。"
          href="/platform/audit" openLabel="去操作记录与审批" />
        <Stat icon={MonitorSmartphone} tone="role-3" label="在线登录" value={stats ? stats.activeSessions.toLocaleString("en-US") : "—"} unit={stats ? "个" : undefined}
          sub={`${onlineAccounts} 个账号在线`}
          explain="后台登录会话总数，一个账号在几台设备上登录就算几个，不是在线人数。" />
      </StatBand>

      <Panel title="运营账号" icon={Users} tone="role-3" flush
        sub={`${operators.length} 个 · 启用 ${stats ? stats.activeAccounts : enabledOps.length} · 已停用 ${stats ? stats.disabledAccounts : disabledOps.length} · 时间为${zoneNote()}`}
        actions={<Link className="rd-link" href="/platform/roles">角色管理</Link>}
        explain="角色能做什么在「角色管理」设置；这里只给账号分配角色。点一行看详情和全部操作。">
        <div className="a1-list-tools">
          <StatusDistributionBar label="账号按安全状态" selectedKey={filter === "all" || filter === "super" ? null : filter} segments={[
            { key: "ok", label: "启用且已绑定两步验证", value: okOps.length, text: `${okOps.length} 个`, tone: "ok", onSelect: () => pickFilter("ok") },
            { key: "unbound", label: "启用但未绑定两步验证", value: unboundOps.length, text: `${unboundOps.length} 个`, tone: "warn", onSelect: () => pickFilter("unbound") },
            { key: "disabled", label: "已停用", value: disabledOps.length, text: `${disabledOps.length} 个`, tone: "done", onSelect: () => pickFilter("disabled") },
          ]} emptyText="暂无运营账号" />
          {filter !== "all" && <span className="a1-filter-note">只看{FILTER_TEXT[filter]} · {listed.length} 个<Button size="sm" variant="ghost" onClick={() => { setFilter("all"); setPage(0); }}>显示全部</Button></span>}
        </div>
        {permissionDiffError && (
          <div className="a1-inset"><Notice tone="warn" title="角色权限没有读到，暂时不能改角色" action={<Button size="sm" onClick={() => void refreshOverview(true)}>重新读取</Button>}>{permissionDiffError.replace(/。$/, "")}。其他账号操作不受影响。</Notice></div>
        )}
        <Table label="运营账号" className="a1-accounts">
          <thead><tr><Th>账号</Th><Th>角色</Th><Th>两步验证</Th><Th>状态</Th><Th align="right">最近登录</Th><Th align="right">在线设备</Th><Th sticky="end">操作</Th></tr></thead>
          <tbody>
            {pageRows.map((op) => {
              const self = currentAdminId !== null && operatorAccountId(op.id) === currentAdminId;
              return (
                <Tr key={op.id} selected={detailAccount?.id === op.id} onOpen={() => setDetailAccount(op)} aria-label={`查看账号详情 ${operatorDisplayName(op)}`}>
                  <Td>
                    <span className="a1-who">
                      <SupportAvatar name={operatorDisplayName(op)} path={op.avatarAssetId?`/api/admin/platform/accounts/${op.id}/avatar`:undefined} version={op.avatarVersion??undefined}/>
                      <Cell main={<>{operatorDisplayName(op)}{self && <span className="a1-self">你</span>}</>} sub={<span data-mono>{op.username || "登录名未返回"}</span>} title={operatorDisplayLabel(op)} />
                    </span>
                  </Td>
                  <Td><Cell main={roleName(restoring.current?.snapshot.roles ?? roles, op.role)} sub={permissionDiffReady ? permSummary(codesOf(op.role)) : undefined} /></Td>
                  <Td>{op.tfa ? <StatusTag tone="ok" icon={ShieldCheck}>已绑定</StatusTag> : <StatusTag tone="warn" icon={LockKeyhole}>未绑定</StatusTag>}</Td>
                  <Td><Cell main={op.status === "enabled" ? "启用" : <StatusTag tone="done">已停用</StatusTag>} sub={op.credentialDeliveryStatus === "PASSWORD_CHANGE_REQUIRED" ? credentialStatusText(op.credentialDeliveryStatus) : undefined} /></Td>
                  <Td align="right"><Cell num main={minuteText(op.lastLogin)} /></Td>
                  <Td align="right"><span className="a1-sessions-count" data-empty={op.sessions > 0 ? undefined : ""}>{op.sessions > 0 ? `${op.sessions.toLocaleString("en-US")} 台` : "未登录"}</span></Td>
                  <Td sticky="end" data-fit=""><MoreMenu label={`账号操作 ${operatorDisplayLabel(op)}`} items={menuItems(op)} /></Td>
                </Tr>
              );
            })}
            {!pageRows.length && <TableMessage columns={7}>{filter === "all" ? "暂无运营账号" : `没有${FILTER_TEXT[filter]}的账号`}</TableMessage>}
          </tbody>
        </Table>
        {listed.length > 0 && <Pager label="运营账号" total={listed.length} page={safePage + 1} pageSize={perPage} sizes={[10, 20, 50]} onPage={(next) => setPage(next - 1)} onPageSize={(size) => { setPerPage(size); setPage(0); }} />}
      </Panel>

      <Fold icon={LockKeyhole} title="后台登录规则" summary={securityBaselineRows.length ? `${sessionSummary} · ${lockSummary}` : "登录规则没有读到"}
        explain="只针对后台账号，App 用户的登录规则在「注册与登录风险」设置。这些规则由系统固定，这里只能看。">
        {securityBaselineRows.length ? (
          <ConfigList label="后台登录规则">
            {securityBaselineRows.map((baseline) => (
              <ConfigRow key={baseline.key} name={baseline.name} what={baseline.sub} when={baseline.locked ? "由系统固定，不能在这里改" : "从下次登录开始生效"} value={baselineDisplay(baseline)}
                action={baseline.locked ? undefined : (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={mutatingAction ? "正在提交，请稍候" : governanceFrozen ? "有效的超级管理员不足 2 人，暂时不能调整" : undefined} onClick={() => adjustBaseline(baseline)}>调整</Button>} />
            ))}
          </ConfigList>
        ) : <BlockState compact state="empty" title="暂未获取到登录安全设置。" />}
        <p className="a1-help">账号疑似被盗：先在详情里「让此设备下线」，再「重置密码」；要彻底收回，停用账号。<Explain label="锁定规则原文" content={`后端给的锁定规则：${operatorCopyText(lockBaseline)}`} /></p>
      </Fold>

      <Fold icon={ShieldPlus} title="登记新权限" summary="登记后不会自动分给任何角色"
        explain="登记只是把新操作写进权限清单，不等于任何人有了这个权限；要在「角色管理」里分配给角色才生效。">
        <div className="a1-register" data-capability="a1-permission-registration">
          <div className="rd-form-grid" data-cols="3" data-dense="">
            <Field label="权限编码" required hint="小写字母开头">
              <Input aria-label="权限编码" data-mono="" placeholder="domain_action_write" value={permissionDraft.code} onChange={(e) => setPermissionDraft((v) => ({ ...v, code: e.target.value }))} />
            </Field>
            <Field label="权限名称" required>
              <Input aria-label="权限名称" placeholder="权限名称" value={permissionDraft.name} onChange={(e) => setPermissionDraft((v) => ({ ...v, name: e.target.value }))} />
            </Field>
            <Field label="资源路径" required hint="/api/admin/ 开头">
              <Input aria-label="资源路径" data-mono="" placeholder="/api/admin/..." value={permissionDraft.path} onChange={(e) => setPermissionDraft((v) => ({ ...v, path: e.target.value }))} />
            </Field>
            <Field label="权限类型">
              {(control) => <Select {...control} aria-label="权限类型" value={permissionDraft.type} onChange={(value) => setPermissionDraft((v) => ({ ...v, type: value as "READ" | "WRITE" }))} options={[{ value: "READ", label: "查询" }, { value: "WRITE", label: "修改" }]} />}
            </Field>
            <div className="a1-register-check">
              <Check label="会让平台多付钱" checked={permissionDraft.amplifies} onChange={(e) => setPermissionDraft((v) => ({ ...v, amplifies: e.target.checked }))}
                help={permissionDraft.amplifies ? "勾选后按「高危」类型登记，左边选的类型不用。" : undefined} />
            </div>
          </div>
          <div className="rd-toolbar" data-end="">
            <Button variant="primary" disabledReason={!overviewReady ? errorMessage(new Error("A1_FRESH_OVERVIEW_REQUIRED")) : pendingOperations.some(r => r.intent.kind === "permission") ? errorMessage(new Error("A1_ORIGINAL_OPERATION_PENDING")) : governanceFrozen ? "有效的超级管理员不足 2 人，暂时不能登记" : !canRegisterPermission ? "你没有登记权限的权限" : mutatingAction ? "正在提交，请稍候" : !permissionDraft.code.trim() || !permissionDraft.name.trim() || !permissionDraft.path.trim() ? "先填权限编码、名称和资源路径" : undefined} onClick={() => submitPermissionRegistration()}>登记权限</Button>
          </div>
        </div>
      </Fold>

      {naOpen && (
        <NewAccountDrawer
          roles={roles}
          codesByRole={permissionDiffReady ? permissionCodesByRole : null}
          recoveryMode={governanceFrozen}
          disabled={!!mutatingAction||Boolean(creationPending)}
          initialForm={creationPending?.intent.kind === "create" ? creationPending.intent.form : undefined}
          onClose={() => setNaOpen(false)}
          onSubmit={createAccount}
        />
      )}
      {detailAccount && (
        <AccountDetailDrawer
          account={detailAccount}
          roles={roles}
          roleCodes={roleCodesOf(detailAccount)}
          materialPermissionCodes={permissionDiffReady ? permissionCodesByRole[detailAccount.role] ?? [] : null}
          isSelf={currentAdminId !== null && operatorAccountId(detailAccount.id) === currentAdminId}
          sessionRevokeBlockReason={busyReason ?? forceLogoutBlockReason(detailAccount)}
          editBlockReason={profileEditBlockReason}
          actions={accountActions(detailAccount)}
          busy={Boolean(mutatingAction)}
          nav={detailIndex >= 0 ? {
            hasPrev: detailIndex > 0, hasNext: detailIndex < pageRows.length - 1,
            onPrev: () => setDetailAccount(pageRows[detailIndex - 1] ?? detailAccount),
            onNext: () => setDetailAccount(pageRows[detailIndex + 1] ?? detailAccount),
          } : undefined}
          onClose={() => setDetailAccount(null)}
          onEdit={() => {
            setEditAccountTarget(detailAccount);
            setDetailAccount(null);
          }}
          onRevokeSession={(sessionId) => revokeOneSession(detailAccount, sessionId)}
        />
      )}
      {roleTarget && (
        <RoleChangeModal account={roleTarget} roles={roles} codesByRole={permissionCodesByRole} effectiveSupers={effectiveSupers} recovery={governanceFrozen}
          options={governanceFrozen ? roleOptions.filter((role) => role.key === roleTarget.role || role.key === "super") : roleOptions}
          onClose={() => setRoleTarget(null)} onNext={(picked) => confirmRoleChange(roleTarget, picked)} />
      )}
      {editAccountTarget && (
        <EditAccountDrawer
          account={editAccountTarget}
          disabled={!!mutatingAction}
          onClose={() => setEditAccountTarget(null)}
          onSubmit={(form) => editAccount(editAccountTarget, form)}
        />
      )}
      {passwordReset && (
        <PasswordResetDrawer
          result={passwordReset}
          created={passwordFromCreate}
          onClose={() => setPasswordReset(null)}
        />
      )}
    </div>
  );
}

