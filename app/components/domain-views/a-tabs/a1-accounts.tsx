"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

const credentialStatusText = (value?: string | null) => value === "PASSWORD_CHANGE_REQUIRED" ? "下次登录需修改密码" : value === "ACTIVE" ? "正常" : "—";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { readAdminSessionBaseline } from "@/lib/admin/session-baseline";
import { Drawer } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import {
  changeA1AccountRole,
  createA1Account,
  fetchA1Overview,
  isA1OutcomeUncertainError,
  resetA1Account2fa,
  resetA1AccountPassword,
  registerA1Permission,
  revokeA1AccountSessions,
  revokeA1AccountSession,
  updateA1AccountProfile,
  updateA1AccountStatus,
  updateA1SecurityBaseline,
  type A1CreateAccountInput,
  type A1Operator,
  type A1Overview,
  type A1PasswordResetResult,
  type A1RoleDefinition,
  type A1SecurityBaseline,
  type A1UpdateAccountInput,
} from "@/lib/admin/a1-client";
import { fetchA6RoleDetail, fetchA6RolesOverview } from "@/lib/admin/a6-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { ACtx } from "./types";
import { AccountAvatarPicker } from "./account-avatar-picker";
import { HDSelect } from "../m-tabs/hd-ui";
import { AVATAR_GENDER_OPTIONS, type AvatarGender } from "@/lib/admin/account-avatar-contract";
import { avatarDrafts, avatarDraftFingerprint } from "@/lib/admin/account-avatar-pending";
import { SupportAvatar } from "../m-tabs/support-avatar";
import { SupportQualificationEditor, canManageSupportQualifications } from "../m-tabs/m1-group-management";
import {createPendingMutationStore,type PendingMutationRecord} from "@/lib/admin/pending-mutation-store";
type CreationPending=PendingMutationRecord&{actorId:number;form:A1CreateAccountInput&{reason:string};reason:string;operator:string};
const creationCommands=createPendingMutationStore<CreationPending>({storageKey:"nexion-a1-support-avatar-account-create",retainExpiredRecords:true,isValidRecord:r=>Number.isSafeInteger(r.actorId)&&Boolean(r.form?.username&&r.reason)});

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

function errorMessage(error: unknown) {
  return displayAdminError(error);
}

function roleName(roles: A1RoleDefinition[], role: string) {
  if (!role || role === "unassigned") return "暂未分配";
  return roles.find((r) => r.key === role)?.name ?? role;
}

function roleKeyFromCode(roleCode: string) {
  const normalized = roleCode.trim().toUpperCase();
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

function operatorDisplayName(op: Pick<A1Operator, "name" | "username" | "email">) {
  return op.name?.trim() || op.username?.trim() || op.email?.trim() || "运营账号";
}

function operatorDisplayLabel(op: Pick<A1Operator, "name" | "username" | "email">) {
  const name = operatorDisplayName(op);
  const username = op.username?.trim();
  if (username && username !== name) return `${name}(${username})`;
  const email = op.email?.trim();
  return email && email !== name ? `${name}(${email})` : name;
}

function stopRowAction(event: MouseEvent<HTMLButtonElement>, work: () => void) {
  event.stopPropagation();
  work();
}

function openRowAction(event: KeyboardEvent<HTMLTableRowElement>, work: () => void) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  work();
}

export function A1Accounts({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const propose = usePropose();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const currentAdminId = useAdminAuth((s) => s.session?.adminId ?? null);
  const currentSessionRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const canRegisterPermission = useAdminAuth((s) => s.session?.authorities.includes("platform_a1_rbac_grants_update") ?? false);
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
  const [creationPending,setCreationPending]=useState<CreationPending|null>(null);
  useEffect(()=>{setCreationPending(creationCommands.list().find(r=>r.actorId===currentAdminId)??null);},[currentAdminId]);
  const [detailAccount, setDetailAccount] = useState<A1Operator | null>(null);
  const canManageQualifications = useAdminAuth(s => canManageSupportQualifications(s.session));
  const [qualificationTarget, setQualificationTarget] = useState<{ id: string; kind: "SERVICE" | "SUPERVISOR" } | null>(null);
  const [editAccountTarget, setEditAccountTarget] = useState<A1Operator | null>(null);
  const [passwordReset, setPasswordReset] = useState<A1PasswordResetResult | null>(null);
  const [permissionDraft, setPermissionDraft] = useState({ code: "", name: "", path: "", type: "WRITE" as "READ" | "WRITE", amplifies: false });

  const refreshOverview = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }
    setLoadError(null);
    setPermissionDiffReady(false);
    setPermissionDiffError(null);
    try {
      const data = await fetchA1Overview();
      setOverview(data);
      try {
        const a6 = await fetchA6RolesOverview();
        const details = await Promise.all(a6.roles.filter((role) => role.status === 1).map((role) => fetchA6RoleDetail(role.id)));
        const codesByRole = Object.fromEntries(details.map((role) => [roleKeyFromCode(role.roleCode), role.permissionCodes]));
        if (!data.roles.every((role) => Array.isArray(codesByRole[role.key]))) {
          throw new Error("A6_ROLE_PERMISSION_DIFF_INCOMPLETE");
        }
        setPermissionCodesByRole(codesByRole);
        setPermissionDiffReady(true);
      } catch (error) {
        setPermissionCodesByRole({});
        setPermissionDiffError(`权限变化预览加载失败：${errorMessage(error)}，暂时不能改角色`);
      }
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      if (!quiet) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
  }, [refreshOverview]);

  const runMutation = useCallback(
    async (
      action: string,
      work: () => Promise<unknown>,
      success: string,
    ) => {
      setMutatingAction(action);
      try {
        await work();
        await refreshOverview(true);
        toast(success);
        return true;
      } catch (error) {
        if (isA1OutcomeUncertainError(error)) {
          toast(`提交结果暂未确认（命令号 ${error.commandKey}）。请先刷新，在操作记录里核对，不要重复提交。`);
        } else {
          toast(`提交失败:${errorMessage(error)}`);
        }
        return false;
      } finally {
        setMutatingAction(null);
      }
    },
    [refreshOverview, toast],
  );

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
  const permissionActions = useMemo(() => {
    const codes = [...new Set(Object.values(permissionCodesByRole).flat())].sort();
    return codes.map((code) => ({ label: code, domainGroup: code.split("_")[0]?.toUpperCase() || "OTHER" }));
  }, [permissionCodesByRole]);
  const grantsByRole = useMemo(() => Object.fromEntries(
    Object.entries(permissionCodesByRole).map(([role, codes]) => {
      const owned = new Set(codes);
      return [role, permissionActions.map((action) => owned.has(action.label) ? "R" : "-")];
    }),
  ), [permissionActions, permissionCodesByRole]);
  const supersTone = effectiveSupers <= 1 ? "danger" : effectiveSupers === 2 ? "warn" : "ok";
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
  const sessionBaseline = parsedSessionBaseline.idleDisabled
    ? `无操作自动登出已关闭 / ${parsedSessionBaseline.unlimited ? "无固定登录上限"
      : parsedSessionBaseline.absoluteHours ? `最长保持登录 ${parsedSessionBaseline.absoluteHours} 小时` : "最长登录时间未获取到"}`
    : backendSessionBaseline || "未获取到";
  const lockBaseline = backendLockBaseline || "未获取到";

  const totalPages = Math.max(1, Math.ceil(operators.length / perPage));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = operators.length ? safePage * perPage : 0;
  const pageEnd = Math.min(pageStart + perPage, operators.length);
  const pageRows = operators.slice(pageStart, pageEnd);
  const forceLogoutBlockReason = (op: A1Operator) => {
    const targetId = operatorAccountId(op.id);
    if (currentAdminId !== null && targetId !== null && targetId === currentAdminId) {
      return "不能强制登出自己的当前账号";
    }
    if (currentForceLogoutRole !== "super") {
      return "只有超级管理员可以强制登出运营账号";
    }
    if (op.role === "super") {
      return "超级管理员账号不能被强制登出";
    }
    if (op.sessions === 0) {
      return "该账号当前未登录";
    }
    return null;
  };
  const protectsEffectiveSuperFloor = (op: A1Operator) =>
    op.role === "super" && op.status === "enabled" && op.tfa && effectiveSupers <= 2;
  const changeRoleBlockReason = (op: A1Operator) => {
    if (!permissionDiffReady) return permissionDiffError ?? "权限变化预览加载失败，暂时不能改角色";
    if (governanceFrozen) return "可用的超级管理员不足 2 个，账号操作已暂停。请先新建一个超级管理员并绑定两步验证";
    if (protectsEffectiveSuperFloor(op)) return "操作后可用的超级管理员会少于 2 个";
    return null;
  };
  const reset2faBlockReason = (op: A1Operator) => {
    if (!op.tfa) return "该账号尚未绑定两步验证，无需重置";
    if (governanceFrozen) return "可用的超级管理员不足 2 个，账号操作已暂停";
    if (protectsEffectiveSuperFloor(op)) return "重置后可用的超级管理员会少于 2 个";
    return null;
  };
  const disableAccountBlockReason = (op: A1Operator) => {
    if (governanceFrozen) return "可用的超级管理员不足 2 个，账号操作已暂停";
    if (protectsEffectiveSuperFloor(op)) return "禁用后可用的超级管理员会少于 2 个";
    return null;
  };

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const changeRole = (op: A1Operator) => {
    if (!permissionDiffReady) {
      toast(permissionDiffError ?? "权限变化预览加载失败，暂时不能改角色");
      return;
    }
    const displayName = operatorDisplayName(op);
    const displayLabel = operatorDisplayLabel(op);
    openActionConfirm({
      action: `变更角色 · ${displayName}`,
      detail: (
        <>
          <b>{displayLabel}</b> · 当前 <b>{roleName(roles, op.role)}</b>。
          选择新角色，下方会显示权限的变化。可用的超级管理员不能少于 2 个。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "role-select",
        currentRole: op.role,
        roles: roleOptions.map((r) => ({ key: r.key, label: r.name, scope: r.scope })),
        actions: permissionActions,
        grantsByRole: { unassigned: permissionActions.map(() => "-"), ...grantsByRole },
        guardHint: `当前可用超级管理员 ${effectiveSupers} 个，至少保留 2 个`,
      },
      run: (reason, value) => {
        const roleStr = (value || "").trim();
        if (!roleOptions.some((r) => r.key === roleStr)) {
          toast(`无法保存：角色无效（${roleStr}）`);
          return;
        }
        if (roleStr === op.role) {
          toast("新角色与当前角色相同");
          return;
        }
        if (op.role === "super" && op.status === "enabled" && roleStr !== "super" && effectiveSupers - 1 < 2) {
          toast("不能执行：可用的超级管理员会少于 2 个");
          return;
        }
        const def = findHighOp("a1_account_change_role")!;
        void propose(toast, {
          action: `变更角色 · ${displayName} → ${roleName(roles, roleStr)}`,
          obj: String(op.id),
          before: roleName(roles, op.role),
          after: roleName(roles, roleStr),
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

  const reset2fa = (op: A1Operator) => openActionConfirm({
    action: `重置两步验证 · ${operatorDisplayName(op)}`,
    detail: (
      <>
        <div className="atint danger" style={{ marginBottom: 12 }}>
          <b>骗子常用这一步盗号</b> · 提交前请通过另一种方式核实是本人。
        </div>
        <div className="dlg-sec">重置后会发生什么</div>
        <div style={{ marginTop: 6, marginBottom: 4 }}>
          <div>1 · 当前绑定的验证器立即失效</div>
          <div>2 · 重新绑定前无法登录后台</div>
          <div>3 · 下次登录强制重新绑定两步验证</div>
        </div>
      </>
    ),
    amplifies: false,
    businessForm: {
      kind: "identity-verify",
      subject: operatorDisplayLabel(op),
      channels: ["视频核实", "当面核实", "回拨预留工作号"],
      ticketHint: "如 SEC-20260618-001",
    },
    run: (reason, _value, businessValue) => {
      const verify = `核验 ${businessValue?.channel ?? "—"} · ${businessValue?.verifiedAt || "—"} · 工单 ${businessValue?.ticket || "—"}`;
      const def = findHighOp("a1_account_reset_2fa")!;
      void propose(toast, {
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

  const resetPassword = (op: A1Operator) => openActionConfirm({
    action: `重置密码 · ${operatorDisplayName(op)}`,
    detail: (
      <>
        <div className="atint danger" style={{ marginBottom: 12 }}>
          系统会生成临时密码并让该账号下线，对方下次登录须先改密码。
        </div>
        <b>{operatorDisplayLabel(op)}</b> · 登录名 <span className="acode">{op.username || "未返回"}</span>。
      </>
    ),
    amplifies: false,
    businessForm: {
      kind: "identity-verify",
      subject: operatorDisplayLabel(op),
      channels: ["视频核实", "当面核实", "回拨预留工作号"],
      ticketHint: "如 SEC-20260618-001",
    },
    run: (reason, _value, businessValue) => {
      const verify = `核验 ${businessValue?.channel ?? "—"} · ${businessValue?.verifiedAt || "—"} · 工单 ${businessValue?.ticket || "—"}`;
      const action = `重置密码 ${operatorDisplayName(op)}`;
      setMutatingAction(action);
      resetA1AccountPassword(op.id, `${reason}；${verify}`, operator, op.version)
        .then(async (result) => {
          setPasswordReset(result);
          await refreshOverview(true);
          toast(`${operatorDisplayName(op)} 密码已重置 · 临时密码只展示在当前弹窗`);
        })
        .catch((error) => {
          toast(`提交失败:${errorMessage(error)}`);
        })
        .finally(() => setMutatingAction(null));
    },
  });

  const editAccount = (op: A1Operator, form: A1UpdateAccountInput & { reason: string }) => {
    openActionConfirm({
      action: `编辑账号 · ${operatorDisplayName(op)}`,
      detail: (
        <>
          <b>{operatorDisplayLabel(op)}</b> · 登录名从 <span className="acode">{op.username || "未返回"}</span> 更新为 <span className="acode">{form.username}</span>。
          登录名和邮箱不能与其他账号重复；改登录名后该账号会被强制下线。
        </>
      ),
      amplifies: false,
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
    if (op.role === "super" && op.status === "enabled" && effectiveSupers - 1 < 2) {
      toast("不能执行：可用的超级管理员会少于 2 个");
      return;
    }
    const displayName = operatorDisplayName(op);
    openActionConfirm({
      action: `禁用账号 · ${displayName}`,
      detail: (
        <>
          <b>{operatorDisplayLabel(op)}</b> · 角色 {roleName(roles, op.role)}。
          禁用后该账号立即下线且无法登录；它提交但还没确认的操作，请到「操作记录与审批」处理。
          {op.role === "super" && <>  禁用后剩余可用超级管理员 {effectiveSupers - 1} 个。</>}
        </>
      ),
      amplifies: false,
    run: (reason) => {
      const def = findHighOp("a1_account_status_update")!;
      void propose(toast, {
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

  const enableAcct = (op: A1Operator) => openActionConfirm({
    action: `启用账号 · ${operatorDisplayName(op)}`,
    detail: (
      <>
        <b>{operatorDisplayLabel(op)}</b> · 启用后可重新登录，角色仍为 <b>{roleName(roles, op.role)}</b>，登录时需通过两步验证。
      </>
    ),
    amplifies: false,
    run: (reason) => {
      const def = findHighOp("a1_account_status_update")!;
      void propose(toast, {
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

  const kickAllSessions = (op: A1Operator) => {
    const displayName = operatorDisplayName(op);
    const blocked = forceLogoutBlockReason(op);
    if (blocked) {
      toast(`${displayName}: ${blocked}`);
      return;
    }
    openActionConfirm({
      action: `强制登出 · ${displayName}`,
      detail: (
        <>
          <b>{operatorDisplayLabel(op)}</b> · 当前在 <b>{op.sessions}</b> 台设备上登录。
          确认后该账号在所有设备上立即下线，重新登录需再次通过两步验证。
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-4)" }}>

            只有超级管理员能操作；不能登出自己，也不能登出其他超级管理员。
          </div>
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const def = findHighOp("a1_account_force_logout")!;
        void propose(toast, {
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
    openActionConfirm({
      action: `调整 · ${baseline.name}`,
      detail: (
        <>
          <b>{baseline.name}</b> · 当前 <span className="acode">{curN} {baseline.unit}</span> · 可填范围 <span className="acode">{baseline.min}–{baseline.max} {baseline.unit}</span>。
          从下次登录开始生效，已登录的不受影响。
        </>
      ),
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

  const createAccount = (form: A1CreateAccountInput & { reason: string }) => {
    openActionConfirm({
      action: `新建运营账号 · ${form.displayName}`,
      detail: (
        <>
          <b>{form.displayName}</b> · 登录名 <span className="acode">{form.username}</span> · 角色 <b>{roleName(roles, form.role)}</b>。
          <div style={{ marginTop: 8 }}>
            按所选角色开通权限；首次登录须修改密码。
            {form.role === "support" && <> 专属客服仅服务本人绑定客户，主管资格需另行授予。</>}
          </div>
        </>
      ),
      amplifies: false,
      run: async (reason) => {
        const finalReason = `${form.reason}；${reason}`;
        if(!currentAdminId)return false;
        const command=creationPending??{fingerprint:`${currentAdminId}:create`,commandKey:crypto.randomUUID(),createdAt:Date.now(),expiresAt:Date.now()+86400000,actorId:currentAdminId,form,reason:finalReason,operator};
        if (Date.now() >= command.expiresAt) { toast("距上次提交已超过可重试时间。请先在账号列表核对是否已创建，不要重复创建。"); return false; }
        creationCommands.remember(command.fingerprint,command.commandKey,{actorId:command.actorId,form:command.form,reason:command.reason,operator:command.operator});setCreationPending(command);
        if(!creationCommands.isDurablyStored(command.fingerprint,command.commandKey)){toast("浏览器无法保存本次提交记录，尚未提交。请检查浏览器存储设置后重试。");return false;}
        let defaultAvatarMissing = false;
        const ok = await runMutation(
          `新建账号 ${form.username}`,
          async () => {
            let created:A1Operator;
            try{created=await createA1Account({
              username: command.form.username,displayName: command.form.displayName,email: command.form.email,avatarAssetId: command.form.avatarAssetId,avatarGender: command.form.avatarGender,useDefaultAvatar: command.form.useDefaultAvatar,role: command.form.role,
            },command.reason,command.operator,command.commandKey);}catch(e){if(!isA1OutcomeUncertainError(e)){creationCommands.forget(command.fingerprint);setCreationPending(null);}throw e;}
            if(useAdminAuth.getState().session?.adminId!==command.actorId)return created;
            if (!created.temporaryPassword) {
              throw new Error("A1_CREATE_TEMPORARY_PASSWORD_MISSING");
            }
            creationCommands.forget(command.fingerprint);setCreationPending(null);
            avatarDrafts.forget(avatarDraftFingerprint(command.actorId, "admin", "new"));
            setPasswordReset({ account: created, temporaryPassword: created.temporaryPassword });
            defaultAvatarMissing = Boolean(command.form.useDefaultAvatar && !created.avatarAssetId);
            return created;
          },
          `${form.displayName} 已创建，首次登录需绑定两步验证并修改密码`,
        );
        if (ok) { setNaOpen(false); if (defaultAvatarMissing) toast("账号已创建，但默认头像暂缺，请在账号资料里上传头像。不要重复创建账号。"); }
        return ok;
      },
    });
  };

  const submitPermissionRegistration = () => {
    if (!canRegisterPermission || !permissionDraft.code.trim() || !permissionDraft.name.trim() || !permissionDraft.path.trim()) return;
    openActionConfirm({
      action: `登记动作权限 · ${permissionDraft.code.trim()}`,
      detail: <>把新操作加入权限清单，<b>不会自动分给任何角色</b>。需要时到「角色管理」授权。</>,
      amplifies: permissionDraft.amplifies,
      reasonMin: 8,
      reasonMax: 200,
      run: async (reason) => {
        await runMutation(`登记权限 ${permissionDraft.code}`, async () => registerA1Permission({
          permissionCode: permissionDraft.code.trim(), permissionName: permissionDraft.name.trim(),
          resourcePath: permissionDraft.path.trim(), permType: permissionDraft.type,
          amplifies: permissionDraft.amplifies, reason, operator,
        }), `${permissionDraft.code.trim()} 已登记，尚未分给任何角色`);
        setPermissionDraft({ code: "", name: "", path: "", type: "WRITE", amplifies: false });
      },
    });
  };

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号与权限</span>
        </div>
        <div className="l-b">
          <div className="atint">正在加载…</div>
        </div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号与权限</span>
        </div>
        <div className="l-b">
          <div className="atint danger">加载失败：{loadError || "请重试，持续失败请联系值班人员。"}</div>
          <button className="l-btn sm mc" onClick={() => void refreshOverview()}>重试</button>
        </div>
      </section>
    );
  }

  return (
    <>
      {loadError && (
        <div className="atint danger" data-module-health-state="error" style={{ marginBottom: 12 }}>
          刷新失败：{loadError}
          <button className="l-btn sm mc" onClick={() => void refreshOverview()} style={{ marginLeft: 8 }}>重试</button>
        </div>
      )}
      {mutatingAction && (
        <div className="atint" style={{ marginBottom: 12 }}>
          正在提交：{mutatingAction}
        </div>
      )}
      {governanceFrozen && (
        <div className="atint danger" style={{ marginBottom: 12 }}>
          <b>账号操作已暂停</b> · 已启用且绑定两步验证的超级管理员不足 2 个。现在只能新建超级管理员账号或强制下线，补足后自动恢复。
        </div>
      )}

      <div className="f-stats">
        <div className="f-stat">
          <div className="k">运营账号</div>
          <div className="v">{stats?.totalAccounts ?? operators.length} 个</div>
          <div className="sub">启用 {stats?.activeAccounts ?? 0} · 已禁用 {stats?.disabledAccounts ?? 0}</div>
        </div>
        <div className="f-stat">
          <div className="k">在线登录</div>
          <div className="v">{stats?.activeSessions ?? 0} 个</div>
          <div className="sub">{sessionBaseline}</div>
        </div>
        <div className={`f-stat ${supersTone}`}>
          <div className="k">可用超级管理员</div>
          <div className="v">{effectiveSupers} 个</div>
          <div className="sub">至少 2 个 · {governanceFrozen ? "不足，账号操作已暂停" : effectiveSupers === 2 ? "已到下限" : "正常"}</div>
        </div>
        <div className="f-stat">
          <div className="k">待确认的账号操作</div>
          <div className="v">{stats?.pendingAcctTickets ?? 0} 件</div>
          <div className="sub">
            <Link className="l-btn sm" href="/platform/audit">去处理 →</Link>
          </div>
        </div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号</span>
          <span className="sub">
            · 角色能做什么在 <Link href="/platform/roles">角色管理</Link> 设置
          </span>
          <div className="r">
            <button className="l-btn sm" onClick={() => void refreshOverview(true)} disabled={!!mutatingAction}>刷新</button>
            <button className="l-btn sm mc" onClick={() => setNaOpen(true)} disabled={!roles.length || !!mutatingAction}>+ 新建账号</button>
          </div>
        </div>
        {permissionDiffError && (
          <div className="atint danger" style={{ margin: "0 12px 12px" }}>
            {permissionDiffError}。请刷新重试，其他账号操作不受影响。
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1120 }}>
            <thead>
              <tr>
                <th>账号</th>
                <th>角色</th>
                <th>两步验证</th>
                <th>状态</th>
                <th>最近登录</th>
                <th>登录会话数</th>
                <th style={{ textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((op) => {
                const logoutBlock = forceLogoutBlockReason(op);
                return (
                  <tr
                    key={op.id}
                    className="click"
                    tabIndex={0}
                    aria-label={`查看账号详情 ${operatorDisplayName(op)}`}
                    onClick={() => setDetailAccount(op)}
                    onKeyDown={(event) => openRowAction(event, () => setDetailAccount(op))}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <span onClick={event=>event.stopPropagation()}><SupportAvatar name={operatorDisplayName(op)} path={op.avatarAssetId?`/api/admin/platform/accounts/${op.id}/avatar`:undefined} version={op.avatarVersion??undefined}/></span>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{operatorDisplayName(op)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>
                        登录名: {op.username || "未返回"}{op.email ? ` · ${op.email}` : ""}
                      </div>
                    </td>
                    <td>
                      <span className="mc">{roleName(roles, op.role)}</span>
                    </td>
                    <td>{op.tfa ? <span className="mc ok">已绑定</span> : <span className="mc danger">未绑定</span>}</td>
                    <td>{op.status === "enabled" ? <span className="mc ok">启用</span> : <span className="mc danger">已禁用</span>}</td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{op.lastLogin || "—"}</td>
                    <td><span className="mono">{op.sessions}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="l-btn sm" aria-label={`编辑 ${operatorDisplayLabel(op)}`} onClick={(event) => stopRowAction(event, () => setEditAccountTarget(op))} disabled={!!mutatingAction || governanceFrozen}>编辑</button>
                        {canManageQualifications && <><button className="l-btn sm" aria-label={`管理 ${operatorDisplayLabel(op)} 的专属客服资格`} onClick={event => stopRowAction(event, () => setQualificationTarget({ id: op.id, kind: "SERVICE" }))} disabled={!!mutatingAction}>专属客服资格</button><button className="l-btn sm" aria-label={`管理 ${operatorDisplayLabel(op)} 的主管资格`} onClick={event => stopRowAction(event, () => setQualificationTarget({ id: op.id, kind: "SUPERVISOR" }))} disabled={!!mutatingAction}>主管资格</button></>}
                        <button className="l-btn sm" aria-label={`修改 ${operatorDisplayLabel(op)} 的角色`} title={changeRoleBlockReason(op) ?? undefined} onClick={(event) => stopRowAction(event, () => changeRole(op))} disabled={!!mutatingAction || !roles.length || !!changeRoleBlockReason(op)}>改角色</button>
                        <button className="l-btn sm" aria-label={`重置 ${operatorDisplayLabel(op)} 的两步验证`} title={reset2faBlockReason(op) ?? undefined} onClick={(event) => stopRowAction(event, () => reset2fa(op))} disabled={!!mutatingAction || !!reset2faBlockReason(op)}>重置 两步验证</button>
                        <button className="l-btn sm" aria-label={`重置 ${operatorDisplayLabel(op)} 的密码`} onClick={(event) => stopRowAction(event, () => resetPassword(op))} disabled={!!mutatingAction || governanceFrozen}>重置密码</button>
                        <button
                          className="l-btn sm"
                          aria-label={`强制登出 ${operatorDisplayLabel(op)}`}
                          onClick={(event) => stopRowAction(event, () => kickAllSessions(op))}
                          disabled={!!mutatingAction || !!logoutBlock}
                          data-blocked={logoutBlock ? "true" : undefined}
                          title={logoutBlock ?? "强制退出该账号的所有后台登录"}
                          style={logoutBlock ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                        >
                          强制登出
                        </button>
                        {op.status === "enabled" ? (
                          <button className="l-btn sm dgr" aria-label={`禁用 ${operatorDisplayLabel(op)}`} title={disableAccountBlockReason(op) ?? undefined} onClick={(event) => stopRowAction(event, () => disableAcct(op))} disabled={!!mutatingAction || !!disableAccountBlockReason(op)}>禁用</button>
                        ) : (
                          <button className="l-btn sm mc" aria-label={`启用 ${operatorDisplayLabel(op)}`} onClick={(event) => stopRowAction(event, () => enableAcct(op))} disabled={!!mutatingAction || governanceFrozen}>启用</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!pageRows.length && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink-4)", textAlign: "center", padding: 24 }}>
                    暂无运营账号
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="pager">
            <span className="pager-info">显示 {operators.length ? pageStart + 1 : 0}–{pageEnd} / {operators.length}</span>
            <button className="pager-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹</button>
            <span className="pager-num">{safePage + 1} / {totalPages}</span>
            <button className="pager-btn" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>›</button>
            <select className="pager-size" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}>
              {[10, 20, 50].map((n) => <option key={n} value={n}>{n}/页</option>)}
            </select>
          </div>

        </div>
      </section>

      <section className="l-card" data-capability="a1-permission-registration">
        <div className="l-h"><span className="ttl">登记新权限</span><span className="sub">· 登记后不会自动分给任何角色</span></div>
        <div className="l-b ui-form-grid">
          <label>权限编码<input aria-label="权限编码" placeholder="domain_action_write" value={permissionDraft.code} onChange={(e) => setPermissionDraft((v) => ({ ...v, code: e.target.value }))} /></label>
          <label>权限名称<input aria-label="权限名称" placeholder="权限名称" value={permissionDraft.name} onChange={(e) => setPermissionDraft((v) => ({ ...v, name: e.target.value }))} /></label>
          <label>资源路径<input aria-label="资源路径" placeholder="/api/admin/..." value={permissionDraft.path} onChange={(e) => setPermissionDraft((v) => ({ ...v, path: e.target.value }))} /></label>
          <label>权限类型<select aria-label="权限类型" value={permissionDraft.type} onChange={(e) => setPermissionDraft((v) => ({ ...v, type: e.target.value as "READ" | "WRITE" }))}><option value="READ">查询</option><option value="WRITE">修改</option></select></label>
          <label><input type="checkbox" checked={permissionDraft.amplifies} onChange={(e) => setPermissionDraft((v) => ({ ...v, amplifies: e.target.checked }))} />会让平台多付钱</label>
          <button className="l-btn sm mc" disabled={!canRegisterPermission || !!mutatingAction || !permissionDraft.code.trim() || !permissionDraft.name.trim() || !permissionDraft.path.trim()} onClick={submitPermissionRegistration}>登记权限</button>
        </div>
      </section>

      <section className="l-card">
          <div className="l-h">
            <span className="ttl">后台登录安全</span>
            <span className="sub">· 只针对后台账号，App 用户的登录规则在「注册与登录风险」设置</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {securityBaselineRows.map((baseline) => (
              <div className="a-vrow" key={baseline.key}>
                <span className="nm">{baseline.name}<small>{baseline.sub}</small></span>
                <span className={baseline.locked ? "acode lock" : "v"} title={baseline.locked ? "登录时强制验证，不能关闭" : undefined}>
                  {baselineDisplay(baseline)}
                </span>
                {!baseline.locked && (
                  <button className="l-btn sm mc" onClick={() => adjustBaseline(baseline)} disabled={!!mutatingAction}>调整</button>
                )}
              </div>
            ))}
            {securityBaselineRows.length === 0 && (
              <div className="atint">暂未获取到登录安全设置。</div>
            )}
            <div className="atint" style={{ marginTop: 10 }}>
              <b>账号疑似被盗？</b> 超级管理员可在上方列表点「强制登出」让它立即下线；要彻底收回权限，点「禁用」。当前锁定规则：<b>{operatorCopyText(lockBaseline)}</b>
            </div>
          </div>
        </section>



      {naOpen && (
        <NewAccountDrawer
          roles={roles}
          recoveryMode={governanceFrozen}
          disabled={!!mutatingAction||Boolean(creationPending)}
          initialForm={creationPending?.form}
          onClose={() => setNaOpen(false)}
          onSubmit={createAccount}
        />
      )}
      {creationPending&&<div className="atint" role="alert"><p>原账号创建结果待确认：{creationPending.form.username} · {creationPending.form.displayName} · {creationPending.form.email||"未填邮箱"}。原资料、头像素材和命令号已保留。</p><button className="l-btn primary" disabled={Boolean(mutatingAction)} onClick={()=>createAccount(creationPending.form)}>使用原资料与命令查询重试</button></div>}
      {qualificationTarget && canManageQualifications && <SupportQualificationEditor adminId={qualificationTarget.id} kind={qualificationTarget.kind} onClose={() => setQualificationTarget(null)} onChanged={() => void refreshOverview(true)} />}
      {detailAccount && (
        <AccountDetailDrawer
          account={detailAccount}
          roles={roles}
          sessionRevokeBlockReason={forceLogoutBlockReason(detailAccount)}
          onClose={() => setDetailAccount(null)}
          onEdit={() => {
            setEditAccountTarget(detailAccount);
            setDetailAccount(null);
          }}
          onRevokeSession={(sessionId) => {
            const target = detailAccount;
            openActionConfirm({
              action: `让单台设备下线 · ${operatorDisplayName(target)}`,
              detail: <>只让这台设备（<span className="acode">{sessionId}</span>）下线，不影响该账号的其他设备。</>,
              amplifies: false,
              run: (reason) => {
                setMutatingAction(`吊销会话 ${target.username}`);
                revokeA1AccountSession(target.id, sessionId, reason, operator, target.version)
                  .then(async () => {
                    await refreshOverview(true);
                    setDetailAccount(null);
                    toast("该设备已下线");
                  })
                  .catch((error) => toast(`提交失败:${errorMessage(error)}`))
                  .finally(() => setMutatingAction(null));
              },
            });
          }}
        />
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
          onClose={() => setPasswordReset(null)}
        />
      )}
    </>
  );
}

type NaForm = A1CreateAccountInput & {
  reason: string;
};

type EditAccountForm = A1UpdateAccountInput & {
  reason: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
function isValidEmail(email: string) {
  const normalized = email.trim();
  return !normalized || EMAIL_PATTERN.test(normalized);
}

function isValidUsername(username: string) {
  return USERNAME_PATTERN.test(username.trim());
}

function NewAccountDrawer({
  roles,
  recoveryMode,
  disabled,
  initialForm,
  onClose,
  onSubmit,
}: {
  roles: A1RoleDefinition[];
  recoveryMode: boolean;
  disabled?: boolean;
  initialForm?:NaForm;
  onClose: () => void;
  onSubmit: (form: NaForm) => void;
}) {
  const defaultRole = "support";
  const actorId = useAdminAuth(state => state.session?.adminId);
  const [username, setUsername] = useState(initialForm?.username??"");
  const [displayName, setDisplayName] = useState(initialForm?.displayName??"");
  const [email, setEmail] = useState(initialForm?.email??"");
  const [role, setRole] = useState(initialForm?.role??defaultRole);
  const [reason, setReason] = useState(initialForm?.reason??"");
  const [avatarGenderValue, setAvatarGenderValue] = useState<AvatarGender>(initialForm?.avatarGender ?? "UNSPECIFIED");
  const [avatarMode, setAvatarMode] = useState<"default" | "manual">(initialForm?.avatarAssetId || initialForm?.useDefaultAvatar === false || actorId && avatarDrafts.list().some(row => row.fingerprint === avatarDraftFingerprint(actorId, "admin", "new")) ? "manual" : "default");
  const [avatarAssetId,setAvatarAssetId]=useState<string|undefined>(),[avatarBlocking,setAvatarBlocking]=useState(false);
  const useDefaultAvatar = role === "support" && avatarMode === "default";
  useEffect(() => { if (avatarBlocking || avatarAssetId) setAvatarMode("manual"); }, [avatarBlocking, avatarAssetId]);

  useEffect(() => {
    if (recoveryMode && roles.some((item) => item.key === "super")) {
      setRole("super");
    } else if (role && !roles.some((item) => item.key === role)) {
      setRole("");
    }
  }, [recoveryMode, role, roles]);

  const emailOk = isValidEmail(email);
  const usernameOk = isValidUsername(username);
  const missingItems = [
    !username.trim() ? "登录名未填写" : !usernameOk ? "登录名格式不正确" : "",
    !displayName.trim() ? "显示名未填写" : "",
    email.trim() && !emailOk ? "工作邮箱格式不正确" : "",
    recoveryMode && role !== "super" ? "恢复模式只能创建超级管理员账号" : "",
    !reason.trim() ? "操作理由未填写" : "",
  ].filter(Boolean);
  const disabledReason = disabled ? "正在加载，稍后再创建" : "";
  const submitBlockers = [disabledReason, ...missingItems].filter(Boolean);
  const canSubmit = !disabled && !avatarBlocking && missingItems.length === 0;

  return (
    <Drawer
      title="新建运营账号"
      sub={<ol className="account-profile-steps" aria-label="账号创建步骤">{["登录资料", "初始角色", "首次登录", "操作理由"].map((title, index) => <li key={title}><span className="account-profile-step-number" aria-hidden="true">{index + 1}</span>{title}</li>)}</ol>}
      onClose={onClose}
      footer={
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--border)" }}>
          {submitBlockers.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--danger)", lineHeight: 1.6 }}>
              不能创建: {submitBlockers.join("、")}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="l-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>取消</button>
            <button
              className="l-btn primary"
              disabled={!canSubmit}
              title={canSubmit ? "确认创建账号" : `不能创建:${submitBlockers.join("、")}`}
              style={{ flex: 2, justifyContent: "center", opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
              onClick={() => canSubmit && onSubmit({
                username: username.trim().toLowerCase(),
                displayName: displayName.trim(),
                email: email.trim() || undefined,
                role,
                ...(useDefaultAvatar ? { useDefaultAvatar: true, avatarGender: avatarGenderValue } : { avatarAssetId, ...(role === "support" ? { useDefaultAvatar: false, avatarGender: avatarGenderValue } : {}) }),
                reason: reason.trim(),
              })}
            >确认创建账号</button>
          </div>
        </div>
      }
    >
      <fieldset className="account-profile-form" disabled={disabled} style={{border:0,padding:0,margin:0}}>
      <h3 className="account-profile-section-title"><span className="account-profile-step-number" aria-hidden="true">1</span>登录资料</h3>
      <div className="account-profile-fields">
        <label style={{ fontSize: 14, color: "var(--ink-3)" }}>
          登录名 *
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="risk.shift"
            autoComplete="username"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 14 }}
          />
          {username.trim() && !usernameOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 13 }}>
              3-32 位,仅小写字母、数字、点、下划线或短横线。
            </span>
          )}
        </label>
        <label style={{ fontSize: 14, color: "var(--ink-3)" }}>
          显示名 *
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="姓名,如:张三"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14 }}
          />
        </label>
        <label style={{ fontSize: 14, color: "var(--ink-3)" }}>
          工作邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 14 }}
          />
          {email.trim() && !emailOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 13 }}>
              请输入有效邮箱格式。
            </span>
          )}
        </label>
      </div>

      {role === "support" && <fieldset className="account-avatar-controls" disabled={disabled || avatarBlocking || Boolean(avatarAssetId)}><legend>客服默认头像</legend>
        <label className="account-avatar-field">头像分类<HDSelect value={avatarGenderValue} options={AVATAR_GENDER_OPTIONS} onChange={value => setAvatarGenderValue(value as AvatarGender)} /></label>
        <div className="account-avatar-modes">
          <label><input type="radio" name="avatar-mode" checked={avatarMode === "default"} onChange={() => setAvatarMode("default")} />创建时随机使用默认头像</label>
          <label><input type="radio" name="avatar-mode" checked={avatarMode === "manual"} onChange={() => setAvatarMode("manual")} />自行上传头像</label>
        </div>
        <p>创建后可更换头像。</p>
      </fieldset>}
      {!useDefaultAvatar && <AccountAvatarPicker name={displayName} disabled={disabled} onChange={setAvatarAssetId} onBlocking={setAvatarBlocking}/>}
      {avatarBlocking&&<p className="account-avatar-feedback" role="status">新头像尚未上传成功；上传或取消新头像后可继续创建。</p>}
      <h3 className="account-profile-section-title"><span className="account-profile-step-number" aria-hidden="true">2</span>初始角色（可暂不分配）</h3>
      <div className="account-initial-roles">
        <label className="l-btn" style={{ justifyContent: "flex-start", padding: "10px 12px", background: role === "" ? "var(--a-ac-soft)" : "var(--surface-2)", color: role === "" ? "var(--a-ac)" : "var(--ink-2)", cursor: recoveryMode ? "not-allowed" : "pointer" }}>
          <input type="radio" name="operator-role" value="" checked={role === ""} disabled={recoveryMode} onChange={() => setRole("")} style={{ accentColor: "var(--a-ac)" }} />
          <span style={{ fontSize: 14 }}>暂不分配</span>
          <span style={{ fontSize: 13, color: "var(--ink-4)", marginLeft: 8 }}>无业务权限</span>
        </label>
        {roles.map((item) => (
          <label
            key={item.key}
            className="l-btn"
            style={{
              justifyContent: "flex-start",
              padding: "10px 12px",
              background: role === item.key ? "var(--a-ac-soft)" : "var(--surface-2)",
              color: role === item.key ? "var(--a-ac)" : "var(--ink-2)",
              fontWeight: role === item.key ? 600 : 500,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="operator-role"
              value={item.key}
              checked={role === item.key}
              onChange={() => setRole(item.key)}
              style={{ accentColor: "var(--a-ac)" }}
            />
            <span style={{ fontSize: 14 }}>{item.name}</span>
            <span style={{ fontSize: 13, color: "var(--ink-4)", marginLeft: 8 }}>{item.scope}</span>
          </label>
        ))}
      </div>

      {role === "support" && <p className="account-profile-note">仅服务本人绑定客户，主管资格需另行授予。</p>}
      <h3 className="account-profile-section-title"><span className="account-profile-step-number" aria-hidden="true">3</span>首次登录</h3>
      <div className="atint" style={{ marginBottom: 10, fontSize: 13, lineHeight: 1.5 }}>
        创建后将显示一次 20 位临时密码，请妥善交给账号持有人。
      </div>

      <div className="atint" style={{ marginBottom: 14, fontSize: 13, lineHeight: 1.5 }}>
        按所选角色开通权限；首次登录须修改密码。
      </div>

      <h3 id="account-create-reason-title" className="account-profile-section-title"><span className="account-profile-step-number" aria-hidden="true">4</span>操作理由（必填）</h3>
      <div>
        <textarea
          aria-labelledby="account-create-reason-title"
          aria-required="true"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="为什么开这个账号（入职、换岗、外部审计…）"
          style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
        />
      </div>
      </fieldset>
    </Drawer>
  );
}

function AccountDetailDrawer({
  account,
  roles,
  sessionRevokeBlockReason,
  onClose,
  onEdit,
  onRevokeSession,
}: {
  account: A1Operator;
  roles: A1RoleDefinition[];
  sessionRevokeBlockReason: string | null;
  onClose: () => void;
  onEdit: () => void;
  onRevokeSession: (sessionId: string) => void;
}) {
  const rows = [
    ["账号编号", account.id],
    ["登录名", account.username || "未返回"],
    ["显示名", operatorDisplayName(account)],
    ["工作邮箱", account.email || "未填写"],
    ["角色", roleName(roles, account.role)],
    ["状态", account.status === "enabled" ? "启用" : "已禁用"],
    ["两步验证", account.tfa ? "已绑定" : "未绑定"],
    ["最近登录", account.lastLogin || "—"],
    ["在线设备", `${account.sessions}`],
    ["密码状态", credentialStatusText(account.credentialDeliveryStatus)],
  ];

  return (
    <Drawer
      title={`账号详情 · ${operatorDisplayName(account)}`}
      sub={account.username || account.email || account.id}
      onClose={onClose}
      footer={
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <button className="l-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>关闭</button>
          <button className="l-btn primary" onClick={onEdit} style={{ flex: 2, justifyContent: "center" }}>编辑账号</button>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 14 }}>
        <div className="f-stat">
          <div className="k">角色</div>
          <div className="v" style={{ fontSize: 18 }}>{roleName(roles, account.role)}</div>
          <div className="sub">{account.status === "enabled" ? "账号启用中" : "账号已禁用"}</div>
        </div>
        <div className="f-stat">
          <div className="k">在线设备</div>
          <div className="v" style={{ fontSize: 18 }}>{account.sessions} 个</div>
          <div className="sub">{credentialStatusText(account.credentialDeliveryStatus)}</div>
        </div>
      </div>
      <table className="l-tbl">
        <caption style={{textAlign:"left",paddingBottom:12}}><SupportAvatar name={operatorDisplayName(account)} path={account.avatarAssetId?`/api/admin/platform/accounts/${account.id}/avatar`:undefined} version={account.avatarVersion??undefined} size={64}/></caption>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td style={{ width: 120, color: "var(--ink-4)", fontSize: 12 }}>{label}</td>
              <td style={{ color: "var(--ink-2)", fontSize: 13 }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dlg-sec" style={{ marginTop: 16 }}>角色变更记录</div>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {(account.roleHistory ?? []).map((history, index) => (
          <div key={`${history.changedAt || "current"}-${index}`} className="atint">
            <div>
              <b>{history.source === "CURRENT_ASSIGNMENT" ? "当前生效" : `${roleName(roles, history.fromRole)} → ${roleName(roles, history.toRole)}`}</b>
              {history.source === "CURRENT_ASSIGNMENT" && <> · {roleName(roles, history.toRole)}</>}
            </div>
            <div style={{ marginTop: 3, color: "var(--ink-4)" }}>
              {history.source === "CURRENT_ASSIGNMENT"
                ? "没有更早的角色变更"
                : `${history.changedAt || "时间未返回"} · 操作者 ${history.operator || "系统"}`}
            </div>
          </div>
        ))}
        {!(account.roleHistory ?? []).length && <div className="atint">暂无角色变更记录。</div>}
      </div>
      <div className="dlg-sec" style={{ marginTop: 16 }}>在线设备</div>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {(account.sessionDetails ?? []).map((session) => (
          <div key={session.sessionId} className="atint" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div><b>{session.device || "未知设备"}</b> · <span className="mono">{session.ipAddress || "未返回"}</span></div>
              <div style={{ marginTop: 3, color: "var(--ink-4)" }}>开始 {session.issuedAt || "—"} · 最近活动 {session.lastSeenAt || "—"}</div>
            </div>
            <button
              className="l-btn sm dgr"
              type="button"
              disabled={!!sessionRevokeBlockReason}
              title={sessionRevokeBlockReason || "只让这台设备下线"}
              onClick={() => onRevokeSession(session.sessionId)}
            >
              让此设备下线
            </button>
          </div>
        ))}
        {!(account.sessionDetails ?? []).length && <div className="atint">当前没有在线设备。</div>}
      </div>
    </Drawer>
  );
}

function EditAccountDrawer({
  account,
  disabled,
  onClose,
  onSubmit,
}: {
  account: A1Operator;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (form: EditAccountForm) => void;
}) {
  const [username, setUsername] = useState(account.username || "");
  const [displayName, setDisplayName] = useState(operatorDisplayName(account));
  const [email, setEmail] = useState(account.email || "");
  const [reason, setReason] = useState("");
  const [avatarAssetId,setAvatarAssetId]=useState<string|undefined>(),[avatarBlocking,setAvatarBlocking]=useState(false);
  const [avatarGenderValue, setAvatarGenderValue] = useState<AvatarGender>(account.avatarGender ?? "UNSPECIFIED");
  const usernameOk = isValidUsername(username);
  const emailOk = isValidEmail(email);
  const changed =
    username.trim().toLowerCase() !== (account.username || "").trim().toLowerCase()
    || displayName.trim() !== operatorDisplayName(account)
    || email.trim().toLowerCase() !== (account.email || "").trim().toLowerCase()
    || Boolean(avatarAssetId && avatarAssetId !== account.avatarAssetId)
    || avatarGenderValue !== (account.avatarGender ?? "UNSPECIFIED");
  const missingItems = [
    !username.trim() ? "登录名未填写" : !usernameOk ? "登录名格式不正确" : "",
    !displayName.trim() ? "显示名未填写" : "",
    email.trim() && !emailOk ? "工作邮箱格式不正确" : "",
    !changed ? "资料没有变化" : "",
    !reason.trim() ? "操作理由未填写" : "",
  ].filter(Boolean);
  const disabledReason = disabled ? "正在提交，稍后再编辑" : "";
  const submitBlockers = [disabledReason, ...missingItems].filter(Boolean);
  const canSubmit = !disabled && !avatarBlocking && missingItems.length === 0;

  return (
    <Drawer
      title={`编辑账号 · ${operatorDisplayName(account)}`}
      sub={account.username || account.id}
      onClose={onClose}
      footer={
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--border)" }}>
          {submitBlockers.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 13, color: "var(--danger)", lineHeight: 1.6 }}>
              不能保存: {submitBlockers.join("、")}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="l-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>取消</button>
            <button
              className="l-btn primary"
              disabled={!canSubmit}
              title={canSubmit ? "保存账号资料" : `不能保存:${submitBlockers.join("、")}`}
              style={{ flex: 2, justifyContent: "center", opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
              onClick={() => canSubmit && onSubmit({
                username: username.trim().toLowerCase(),
                displayName: displayName.trim(),
                email: email.trim() || undefined,
                avatarAssetId,
                ...(avatarGenderValue !== (account.avatarGender ?? "UNSPECIFIED") ? { avatarGender: avatarGenderValue } : {}),
                reason: reason.trim(),
              })}
            >保存账号资料</button>
          </div>
        </div>
      }
    >
      <div className="account-profile-fields">
        <label style={{ fontSize: 14, color: "var(--ink-3)" }}>
          登录名 *
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 14 }}
          />
          {username.trim() && !usernameOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 13 }}>
              3-32 位,仅小写字母、数字、点、下划线或短横线。
            </span>
          )}
        </label>
        <label style={{ fontSize: 14, color: "var(--ink-3)" }}>
          显示名 *
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14 }}
          />
        </label>
        <label style={{ fontSize: 14, color: "var(--ink-3)", gridColumn: "1 / -1" }}>
          工作邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 14 }}
          />
          {email.trim() && !emailOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 13 }}>
              请输入有效邮箱格式。
            </span>
          )}
        </label>
      </div>
      <fieldset className="account-avatar-controls" disabled={disabled || avatarBlocking}><legend>头像分类</legend><HDSelect value={avatarGenderValue} options={AVATAR_GENDER_OPTIONS} onChange={value => setAvatarGenderValue(value as AvatarGender)} /><p>修改分类不换图；提交新头像后才会更换。</p></fieldset>
      <AccountAvatarPicker account={account} name={displayName} gender={avatarGenderValue} allowDefault={account.role === "support"} disabled={disabled} onChange={setAvatarAssetId} onBlocking={setAvatarBlocking}/>
      {avatarBlocking&&<p className="account-avatar-feedback" role="status">新头像尚未上传成功；上传或取消新头像后可提交。</p>}
      <p className="account-profile-note">提交后需在「操作记录与审批」确认才会生效。</p>
      <label style={{ fontSize: 14, color: "var(--ink-3)" }}>
        操作理由 *
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="为什么修改这个账号资料"
          style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 14, resize: "vertical" }}
        />
      </label>
    </Drawer>
  );
}

function PasswordResetDrawer({
  result,
  onClose,
}: {
  result: A1PasswordResetResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const account = result.account;
  const copyPassword = () => {
    void navigator.clipboard.writeText(result.temporaryPassword).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <Drawer
      title="密码已重置"
      sub="临时密码只在本次结果中展示"
      onClose={onClose}
      footer={
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <button className="l-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>关闭</button>
          <button className="l-btn primary" onClick={copyPassword} style={{ flex: 2, justifyContent: "center" }}>
            {copied ? "已复制" : "复制临时密码"}
          </button>
        </div>
      }
    >
      <div className="atint danger" style={{ marginBottom: 14 }}>
        关闭后不会再显示临时密码，请通过可靠渠道告诉账号本人。
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.7, marginBottom: 12 }}>
        账号 <b style={{ color: "var(--ink-2)" }}>{operatorDisplayName(account)}</b>
        {" · "}登录名 <span className="acode">{account.username || "未返回"}</span>
      </div>
      <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 6 }}>临时密码</div>
        <div className="mono" style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", wordBreak: "break-all" }}>
          {result.temporaryPassword}
        </div>
      </div>
      <div className="atint" style={{ marginTop: 14 }}>
        对方用临时密码登录后，须先修改密码才能使用后台。
      </div>
    </Drawer>
  );
}
