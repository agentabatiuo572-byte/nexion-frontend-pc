"use client";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
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
import type { ACtx } from "./types";

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
  session_idle: { key: "session_idle", name: "session 滑动过期", sub: "无操作多久自动登出", unit: "分钟", min: 15, max: 60 },
  session_abs: { key: "session_abs", name: "session 绝对上限", sub: "一次登录最长存活多久", unit: "小时", min: 4, max: 12 },
  lock_short_cnt: { key: "lock_short_cnt", name: "登录失败短锁 · 触发次数", sub: "连错几次触发短锁", unit: "次", min: 3, max: 10 },
  lock_short_min: { key: "lock_short_min", name: "登录失败短锁 · 锁定时长", sub: "触发短锁后锁定多久", unit: "分钟", min: 5, max: 60 },
  lock_long_cnt: { key: "lock_long_cnt", name: "24 小时累计长锁 · 触发次数", sub: "一天内累计失败几次触发长锁", unit: "次" },
  lock_long_hour: { key: "lock_long_hour", name: "24 小时累计长锁 · 锁定时长", sub: "触发长锁后锁定多久", unit: "小时" },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  const [detailAccount, setDetailAccount] = useState<A1Operator | null>(null);
  const [editAccountTarget, setEditAccountTarget] = useState<A1Operator | null>(null);
  const [passwordReset, setPasswordReset] = useState<A1PasswordResetResult | null>(null);

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
        setPermissionDiffError(`权限差异预览不可用：${errorMessage(error)}；改角色已停用`);
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
      } catch (error) {
        if (isA1OutcomeUncertainError(error)) {
          toast(`提交结果未知（命令号 ${error.commandKey}）；请先刷新并核对 A2 审计，禁止重复提交。`);
        } else {
          toast(`提交失败:${errorMessage(error)}`);
        }
      } finally {
        setMutatingAction(null);
      }
    },
    [refreshOverview, toast],
  );

  const roles = overview?.roles ?? [];
  const roleOptions = useMemo(() => [
    { key: "unassigned", name: "暂未分配", scope: "默认零权限、零菜单；在 A6 明确授权后再分配" },
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
  const backendLockBaseline = securityBaselines.find((b) => b.key === "lock")?.value;
  const baselineCurrent = (key: string) => {
    if (key === "session_idle") return firstMatch(backendSessionBaseline, /(\d+(?:\.\d+)?)\s*min/i) ?? null;
    if (key === "session_abs") return firstMatch(backendSessionBaseline, /\/\s*(\d+(?:\.\d+)?)\s*h/i) ?? null;
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
      { ...SECURITY_BASELINE_META.session_idle, sourceKey: "session", current: baselineCurrent("session_idle"), locked: registeredBaseline("session")?.locked ?? false },
      { ...SECURITY_BASELINE_META.session_abs, sourceKey: "session", current: baselineCurrent("session_abs"), locked: registeredBaseline("session")?.locked ?? false },
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
  const sessionBaseline = backendSessionBaseline || "后端未返回会话基线";
  const lockBaseline = backendLockBaseline || "后端未返回登录锁定基线";

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
      return "只有超管可以强制登出运营账号";
    }
    if (op.role === "super") {
      return "超管账号不能被强制登出";
    }
    if (op.sessions === 0) {
      return "Redis 中没有活跃后台会话,该账号当前未登录";
    }
    return null;
  };
  const protectsEffectiveSuperFloor = (op: A1Operator) =>
    op.role === "super" && op.status === "enabled" && op.tfa && effectiveSupers <= 2;
  const changeRoleBlockReason = (op: A1Operator) => {
    if (!permissionDiffReady) return permissionDiffError ?? "权限差异预览不可用，改角色已停用";
    if (governanceFrozen) return "有效超管不足 2 个，治理写已冻结；请先创建并绑定恢复超管";
    if (protectsEffectiveSuperFloor(op)) return "该操作会使有效超管少于 2 个";
    return null;
  };
  const reset2faBlockReason = (op: A1Operator) => {
    if (!op.tfa) return "该账号尚未绑定双因子，无需重置";
    if (governanceFrozen) return "有效超管不足 2 个，治理写已冻结；请先恢复安全基线";
    if (protectsEffectiveSuperFloor(op)) return "重置后有效超管将少于 2 个";
    return null;
  };
  const disableAccountBlockReason = (op: A1Operator) => {
    if (governanceFrozen) return "有效超管不足 2 个，治理写已冻结；请先恢复安全基线";
    if (protectsEffectiveSuperFloor(op)) return "禁用后有效超管将少于 2 个";
    return null;
  };

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const changeRole = (op: A1Operator) => {
    if (!permissionDiffReady) {
      toast(permissionDiffError ?? "权限差异预览不可用，改角色已停用");
      return;
    }
    const displayName = operatorDisplayName(op);
    const displayLabel = operatorDisplayLabel(op);
    openActionConfirm({
      action: `变更角色 · ${displayName}`,
      detail: (
        <>
          <b>{displayLabel}</b> · 当前 <b>{roleName(roles, op.role)}</b>。
          在下方业务表单选择目标角色;提交后由后端更新账号角色关系、平台配置和审计记录。
          <b> 后端校验:</b>最小权限基线、角色合法性、有效超管不得少于 2 个。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "role-select",
        currentRole: op.role,
        roles: roleOptions.map((r) => ({ key: r.key, label: r.name, scope: r.scope })),
        actions: permissionActions,
        grantsByRole: { unassigned: permissionActions.map(() => "-"), ...grantsByRole },
        guardHint: `有效超管 ${effectiveSupers} 个;降级超管时仍需 ≥2`,
      },
      run: (reason, value) => {
        const roleStr = (value || "").trim();
        if (!roleOptions.some((r) => r.key === roleStr)) {
          toast(`拒绝:无效角色 key (${roleStr})`);
          return;
        }
        if (roleStr === op.role) {
          toast("未提交:目标角色与当前角色相同");
          return;
        }
        if (op.role === "super" && op.status === "enabled" && roleStr !== "super" && effectiveSupers - 1 < 2) {
          toast("拒绝:剩余有效超管将不足 2 个");
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
    action: `重置双因子 · ${operatorDisplayName(op)}`,
    detail: (
      <>
        <div className="atint danger" style={{ marginBottom: 12 }}>
          <b>社工高危路径</b> · 提交前请用第二渠道核实本人身份;核验方式和工单会随理由提交到后端审计。
        </div>
        <div className="dlg-sec">重置后会发生什么</div>
        <div style={{ marginTop: 6, marginBottom: 4 }}>
          <div>1 · 当前绑定的验证器立即失效</div>
          <div>2 · 重新绑定前无法登录后台</div>
          <div>3 · 下次登录强制重新绑定双因子</div>
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
        action: `重置双因子 · ${operatorDisplayName(op)}`,
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
          <b>高敏凭据操作</b> · 系统会生成临时密码、更新账号密码、吊销该账号旧登录态,并要求下次登录立即修改密码。
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
          后端会检查登录名和邮箱唯一性;登录名变更后会吊销该账号当前登录态。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const finalReason = `${form.reason}；${reason}`;
        const def = findHighOp("a1_account_update_profile")!;
        void propose(toast, {
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
            expectedVersion: op.version,
          }),
          target: def.buildTarget({ accountId: op.id }),
        });
        setEditAccountTarget(null);
      },
    });
  };

  const disableAcct = (op: A1Operator) => {
    if (op.role === "super" && op.status === "enabled" && effectiveSupers - 1 < 2) {
      toast("拒绝:剩余有效超管将不足 2 个");
      return;
    }
    const displayName = operatorDisplayName(op);
    openActionConfirm({
      action: `禁用账号 · ${displayName}`,
      detail: (
        <>
          <b>{operatorDisplayLabel(op)}</b> · 角色 {roleName(roles, op.role)}。
          禁用后后端会收回后台访问权并吊销该账号全部活跃 session;在途高敏动作仍需到 A2 操作确认中心处理。
          {op.role === "super" && <> 剩余有效超管 {effectiveSupers} - 1 = {effectiveSupers - 1}。</>}
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
        <b>{operatorDisplayLabel(op)}</b> · 启用后恢复后台访问权,角色沿用 <b>{roleName(roles, op.role)}</b>;
        首次登录仍需通过强制双因子校验。
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
          <b>{operatorDisplayLabel(op)}</b> 当前活跃 session <b>{op.sessions}</b> 个。
          确认后后端立即吊销该账号全部 session,重新登录必须重过后台认证与双因子。
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-4)" }}>
            规则:不能登出自己;只有超管可执行;超管账号不可被强制登出。
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
    if (baseline.locked) {
      toast("该安全基线由后端锁定,不可在前端调整");
      return;
    }
    if (baseline.current == null) {
      toast("后端未返回当前基线值,请先刷新或在配置中心补齐该基线");
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
      toast("后端未返回当前基线值,请先刷新或在配置中心补齐该基线");
      return;
    }
    openActionConfirm({
      action: `调整 · ${baseline.name}`,
      detail: (
        <>
          <b>{baseline.name}</b> · 当前 <span className="acode">{curN} {baseline.unit}</span> · 可填范围 <span className="acode">{baseline.min}–{baseline.max} {baseline.unit}</span>。
          对<b> 下一次登录签发</b>生效,在途不受影响。后台是高敏操盘台,时限 / 阈值比用户侧更严。
        </>
      ),
      amplifies: false,
      edit: { kind: "number", current: `${curN} ${baseline.unit}`, unit: baseline.unit },
      run: (reason, value) => {
        const n = Number((value ?? "").replace(/[^\d.]/g, "").trim());
        if (!Number.isFinite(n) || n < baseline.min! || n > baseline.max!) {
          toast(`拒绝:${baseline.name} 需在 ${baseline.min}–${baseline.max} ${baseline.unit} 之间`);
          return;
        }
        let backendKey: "session" | "lock";
        let backendValue: string;
        if (baseline.key === "session_idle" || baseline.key === "session_abs") {
          const idle = baseline.key === "session_idle" ? n : siblingNumber("session_idle");
          const absolute = baseline.key === "session_abs" ? n : siblingNumber("session_abs");
          if (idle == null || absolute == null) {
            toast("后端会话基线不完整,拒绝用前端默认值补齐");
            return;
          }
          backendKey = "session";
          backendValue = `${idle}min / ${absolute}h`;
        } else if (baseline.key === "lock_short_cnt" || baseline.key === "lock_short_min") {
          const count = baseline.key === "lock_short_cnt" ? n : siblingNumber("lock_short_cnt");
          const minutes = baseline.key === "lock_short_min" ? n : siblingNumber("lock_short_min");
          if (count == null || minutes == null) {
            toast("后端登录锁定基线不完整,拒绝用前端默认值补齐");
            return;
          }
          backendKey = "lock";
          backendValue = `${count} 次 / ${minutes}min`;
        } else {
          toast("拒绝:该安全基线暂不支持前端调整");
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
            <b>新账号默认零写权,只有所选角色授权</b> · 初始密码只用于首次登录 · 首次登录必须修改密码。
          </div>
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const finalReason = `${form.reason}；${reason}`;
        void runMutation(
          `新建账号 ${form.username}`,
          async () => {
            const created = await createA1Account({
            username: form.username,
            displayName: form.displayName,
            email: form.email,
            role: form.role,
            }, finalReason, operator);
            if (!created.temporaryPassword) {
              throw new Error("A1_CREATE_TEMPORARY_PASSWORD_MISSING");
            }
            setPasswordReset({ account: created, temporaryPassword: created.temporaryPassword });
            return created;
          },
          `${form.displayName} 已创建，首次登录需绑定 2FA 并修改密码`,
        );
        setNaOpen(false);
      },
    });
  };

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号 & RBAC</span>
          <span className="sub">· 正在从后端加载 A1 overview</span>
        </div>
        <div className="l-b">
          <div className="atint">正在读取 /api/admin/platform/accounts/overview。</div>
        </div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号 & RBAC</span>
          <span className="sub">· 后端数据加载失败</span>
        </div>
        <div className="l-b">
          <div className="atint danger">A1 真实接口不可用:{loadError || "UNKNOWN_ERROR"}</div>
          <button className="l-btn sm mc" onClick={() => void refreshOverview()}>重试</button>
        </div>
      </section>
    );
  }

  return (
    <>
      {loadError && (
        <div className="atint danger" style={{ marginBottom: 12 }}>
          后端刷新失败:{loadError}
          <button className="l-btn sm mc" onClick={() => void refreshOverview()} style={{ marginLeft: 8 }}>重试</button>
        </div>
      )}
      {mutatingAction && (
        <div className="atint" style={{ marginBottom: 12 }}>
          正在提交后端操作:{mutatingAction}
        </div>
      )}
      {governanceFrozen && (
        <div className="atint danger" style={{ marginBottom: 12 }}>
          <b>账号治理恢复模式</b> · 当前实际启用且已绑定 2FA 的超管不足 2 个。除“新建超管账号”和安全事件下的会话吊销外，其他治理写操作已由前后端冻结。
        </div>
      )}

      <div className="f-stats">
        <div className="f-stat">
          <div className="k">运营账号</div>
          <div className="v">{stats?.totalAccounts ?? operators.length} 个</div>
          <div className="sub">启用 {stats?.activeAccounts ?? 0} · 已禁用 {stats?.disabledAccounts ?? 0}</div>
        </div>
        <div className="f-stat">
          <div className="k">活跃 session</div>
          <div className="v">{stats?.activeSessions ?? 0} 个</div>
          <div className="sub">{sessionBaseline}</div>
        </div>
        <div className={`f-stat ${supersTone}`}>
          <div className="k">有效超管</div>
          <div className="v">{effectiveSupers} 个</div>
          <div className="sub">后端约束 ≥2 · {governanceFrozen ? "治理冻结" : effectiveSupers === 2 ? "位于下限" : "健康"}</div>
        </div>
        <div className="f-stat">
          <div className="k">账号治理待办</div>
          <div className="v">{stats?.pendingAcctTickets ?? 0} 件</div>
          <div className="sub">
            在操作确认中心(A2)排队 · <Link className="l-btn sm" href="/platform/audit" style={{ marginLeft: 4 }}>→ 去 A2</Link>
          </div>
        </div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号(a)</span>
          <span className="sub">
            · 账号归属在 A1；角色授权以 <Link href="/platform/roles">A6 角色管理</Link> 与 <Link href="/platform/permissions">A8 权限字典</Link> 为准
          </span>
          <div className="r">
            <button className="l-btn sm" onClick={() => void refreshOverview(true)} disabled={!!mutatingAction}>刷新</button>
            <button className="l-btn sm mc" onClick={() => setNaOpen(true)} disabled={!roles.length || !!mutatingAction}>+ 新建账号</button>
          </div>
        </div>
        {permissionDiffError && (
          <div className="atint danger" style={{ margin: "0 12px 12px" }}>
            {permissionDiffError}。请刷新重试；在恢复前仍可查看账号和执行不依赖权限差异的操作。
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1120 }}>
            <thead>
              <tr>
                <th>账号</th>
                <th>角色</th>
                <th>双因子</th>
                <th>状态</th>
                <th>最近登录</th>
                <th>session</th>
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
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{operatorDisplayName(op)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>
                        登录名: {op.username || "未返回"}{op.email ? ` · ${op.email}` : ""}
                      </div>
                    </td>
                    <td>
                      <span className="mc">{roleName(roles, op.role)}</span>
                    </td>
                    <td>{op.tfa ? <span className="mc ok">强制已绑</span> : <span className="mc danger">未绑定</span>}</td>
                    <td>{op.status === "enabled" ? <span className="mc ok">启用</span> : <span className="mc danger">已禁用</span>}</td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{op.lastLogin || "—"}</td>
                    <td><span className="mono">{op.sessions}</span></td>
                    <td style={{ textAlign: "right" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <button className="l-btn sm" onClick={(event) => stopRowAction(event, () => setEditAccountTarget(op))} disabled={!!mutatingAction || governanceFrozen}>编辑</button>
                        <button className="l-btn sm" title={changeRoleBlockReason(op) ?? undefined} onClick={(event) => stopRowAction(event, () => changeRole(op))} disabled={!!mutatingAction || !roles.length || !!changeRoleBlockReason(op)}>改角色</button>
                        <button className="l-btn sm" title={reset2faBlockReason(op) ?? undefined} onClick={(event) => stopRowAction(event, () => reset2fa(op))} disabled={!!mutatingAction || !!reset2faBlockReason(op)}>重置 2FA</button>
                        <button className="l-btn sm" onClick={(event) => stopRowAction(event, () => resetPassword(op))} disabled={!!mutatingAction || governanceFrozen}>重置密码</button>
                        <button
                          className="l-btn sm"
                          onClick={(event) => stopRowAction(event, () => kickAllSessions(op))}
                          disabled={!!mutatingAction || !!logoutBlock}
                          data-blocked={logoutBlock ? "true" : undefined}
                          title={logoutBlock ?? "强制吊销该账号全部 Redis 后台会话"}
                          style={logoutBlock ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                        >
                          强制登出
                        </button>
                        {op.status === "enabled" ? (
                          <button className="l-btn sm dgr" title={disableAccountBlockReason(op) ?? undefined} onClick={(event) => stopRowAction(event, () => disableAcct(op))} disabled={!!mutatingAction || !!disableAccountBlockReason(op)}>禁用</button>
                        ) : (
                          <button className="l-btn sm mc" onClick={(event) => stopRowAction(event, () => enableAcct(op))} disabled={!!mutatingAction || governanceFrozen}>启用</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!pageRows.length && (
                <tr>
                  <td colSpan={7} style={{ color: "var(--ink-4)", textAlign: "center", padding: 24 }}>
                    后端暂无运营账号记录
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
          <div className="atint" style={{ marginTop: 10 }}>
            后端会再次校验有效超管 ≥2、角色合法性和写权限;前端预判只用于减少误操作。
          </div>
        </div>
      </section>

      <section className="l-card">
          <div className="l-h">
            <span className="ttl">登录与安全基线</span>
            <span className="sub">· 服务端实时返回；锁定项只读，可调项逐项生效</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {securityBaselineRows.map((baseline) => (
              <div className="a-vrow" key={baseline.key}>
                <span className="nm">{baseline.name}<small>{baseline.sub}</small></span>
                <span className={baseline.locked ? "acode lock" : "v"} title={baseline.locked ? "server 校验,前端不可关" : undefined}>
                  {baselineDisplay(baseline)}
                </span>
                {!baseline.locked && (
                  <button className="l-btn sm mc" onClick={() => adjustBaseline(baseline)} disabled={!!mutatingAction}>调整</button>
                )}
              </div>
            ))}
            {securityBaselineRows.length === 0 && (
              <div className="atint">后端未返回安全基线配置。</div>
            )}
            <div className="atint" style={{ marginTop: 10 }}>
              <b>疑似被盗怎么办</b> · 超管可立即强制登出非超管账号全部 session(普通确认、必填原因,事后可查);不能登出自己,Redis 无活跃会话代表目标未登录。要收权限走「禁用账号」操作确认。登录失败短锁基线: <b>{lockBaseline}</b>。
            </div>
          </div>
        </section>

      <p className="f-foot">
        <b>执行门槛</b>:账号建 / 停 / 启 / 改角色 / 重置双因子 / 强制登出走后端真实接口;安全基线恢复 PRD 总表展示,提交动作仍通过后端接口发布。
      </p>

      {naOpen && (
        <NewAccountDrawer
          roles={roles}
          recoveryMode={governanceFrozen}
          disabled={!!mutatingAction}
          onClose={() => setNaOpen(false)}
          onSubmit={createAccount}
        />
      )}
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
              action: `吊销单个会话 · ${operatorDisplayName(target)}`,
              detail: <>只吊销会话 <span className="acode">{sessionId}</span>，不会影响该账号的其他设备。</>,
              amplifies: false,
              run: (reason) => {
                setMutatingAction(`吊销会话 ${target.username}`);
                revokeA1AccountSession(target.id, sessionId, reason, operator, target.version)
                  .then(async () => {
                    await refreshOverview(true);
                    setDetailAccount(null);
                    toast("指定会话已吊销");
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
  onClose,
  onSubmit,
}: {
  roles: A1RoleDefinition[];
  recoveryMode: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (form: NaForm) => void;
}) {
  const defaultRole = "";
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [reason, setReason] = useState("");

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
    recoveryMode && role !== "super" ? "恢复模式只能创建超管账号" : "",
    !reason.trim() ? "操作理由未填写" : "",
  ].filter(Boolean);
  const disabledReason = disabled ? "权限或数据仍在加载,暂不能创建" : "";
  const submitBlockers = [disabledReason, ...missingItems].filter(Boolean);
  const canSubmit = !disabled && missingItems.length === 0;

  return (
    <Drawer
      title="新建运营账号"
      sub="① 登录资料 → ② 初始角色(可暂不分配) → ③ 服务端临时凭据 → 操作理由"
      onClose={onClose}
      footer={
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--border)" }}>
          {submitBlockers.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 12, color: "var(--danger)", lineHeight: 1.6 }}>
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
                reason: reason.trim(),
              })}
            >确认创建账号</button>
          </div>
        </div>
      }
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>① 登录资料</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          登录名 *
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="risk.shift"
            autoComplete="username"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
          {username.trim() && !usernameOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 11 }}>
              3-32 位,仅小写字母、数字、点、下划线或短横线。
            </span>
          )}
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          显示名 *
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="姓名,如:张三"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13 }}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          工作邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
          {email.trim() && !emailOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 11 }}>
              请输入有效邮箱格式。
            </span>
          )}
        </label>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>② 初始角色(可暂不分配)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        <label className="l-btn" style={{ justifyContent: "flex-start", padding: "10px 12px", background: role === "" ? "var(--a-ac-soft)" : "var(--surface-2)", color: role === "" ? "var(--a-ac)" : "var(--ink-2)", cursor: recoveryMode ? "not-allowed" : "pointer" }}>
          <input type="radio" name="operator-role" value="" checked={role === ""} disabled={recoveryMode} onChange={() => setRole("")} style={{ accentColor: "var(--a-ac)" }} />
          <span style={{ fontSize: 13 }}>暂不分配</span>
          <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 8 }}>默认零权限、零菜单</span>
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
            <span style={{ fontSize: 13 }}>{item.name}</span>
            <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 8 }}>{item.scope}</span>
          </label>
        ))}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>③ 服务端临时凭据</div>
      <div className="atint" style={{ marginBottom: 10 }}>
        账号创建成功后由服务端生成 20 位四类强临时密码，并且只展示一次；浏览器不会生成、编辑或提前持有账号密码。
      </div>

      <div className="atint" style={{ marginBottom: 14 }}>
        <b>开通即生效的三条底线</b> · 默认零写权 · 首次登录强制改密 · 账号创建写入后端审计。
      </div>

      <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
        操作理由 *(必填 · 写入审计)
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="为什么开这个账号(入职 / 换岗 / 外审…)"
          style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
        />
      </label>
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
    ["账号 ID", account.id],
    ["登录名", account.username || "未返回"],
    ["显示名", operatorDisplayName(account)],
    ["工作邮箱", account.email || "未填写"],
    ["角色", roleName(roles, account.role)],
    ["状态", account.status === "enabled" ? "启用" : "已禁用"],
    ["双因子", account.tfa ? "强制已绑" : "未绑定"],
    ["最近登录", account.lastLogin || "—"],
    ["活跃 session", `${account.sessions}`],
    ["凭据状态", account.credentialDeliveryStatus || "ACTIVE"],
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
          <div className="k">会话</div>
          <div className="v" style={{ fontSize: 18 }}>{account.sessions} 个</div>
          <div className="sub">{account.credentialDeliveryStatus || "ACTIVE"}</div>
        </div>
      </div>
      <table className="l-tbl">
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
                ? "暂无更早的角色变更审计记录"
                : `${history.changedAt || "时间未返回"} · 操作者 ${history.operator || "system"}`}
            </div>
          </div>
        ))}
        {!(account.roleHistory ?? []).length && <div className="atint">服务端未返回角色变更记录。</div>}
      </div>
      <div className="dlg-sec" style={{ marginTop: 16 }}>活跃会话明细</div>
      <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
        {(account.sessionDetails ?? []).map((session) => (
          <div key={session.sessionId} className="atint" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div><b>{session.device || "未知设备"}</b> · <span className="mono">{session.ipAddress || "unknown"}</span></div>
              <div style={{ marginTop: 3, color: "var(--ink-4)" }}>开始 {session.issuedAt || "—"} · 最近活动 {session.lastSeenAt || "—"}</div>
            </div>
            <button
              className="l-btn sm dgr"
              type="button"
              disabled={!!sessionRevokeBlockReason}
              title={sessionRevokeBlockReason || "只吊销这一条会话"}
              onClick={() => onRevokeSession(session.sessionId)}
            >
              吊销此会话
            </button>
          </div>
        ))}
        {!(account.sessionDetails ?? []).length && <div className="atint">当前没有可展示的活跃会话。</div>}
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
  const usernameOk = isValidUsername(username);
  const emailOk = isValidEmail(email);
  const changed =
    username.trim().toLowerCase() !== (account.username || "").trim().toLowerCase()
    || displayName.trim() !== operatorDisplayName(account)
    || email.trim().toLowerCase() !== (account.email || "").trim().toLowerCase();
  const missingItems = [
    !username.trim() ? "登录名未填写" : !usernameOk ? "登录名格式不正确" : "",
    !displayName.trim() ? "显示名未填写" : "",
    email.trim() && !emailOk ? "工作邮箱格式不正确" : "",
    !changed ? "资料没有变化" : "",
    !reason.trim() ? "操作理由未填写" : "",
  ].filter(Boolean);
  const disabledReason = disabled ? "账号操作仍在提交,暂不能编辑" : "";
  const submitBlockers = [disabledReason, ...missingItems].filter(Boolean);
  const canSubmit = !disabled && missingItems.length === 0;

  return (
    <Drawer
      title={`编辑账号 · ${operatorDisplayName(account)}`}
      sub={account.username || account.id}
      onClose={onClose}
      footer={
        <div style={{ padding: "10px 16px 12px", borderTop: "1px solid var(--border)" }}>
          {submitBlockers.length > 0 && (
            <div style={{ marginBottom: 8, fontSize: 12, color: "var(--danger)", lineHeight: 1.6 }}>
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
                reason: reason.trim(),
              })}
            >保存账号资料</button>
          </div>
        </div>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          登录名 *
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            autoComplete="username"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
          {username.trim() && !usernameOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 11 }}>
              3-32 位,仅小写字母、数字、点、下划线或短横线。
            </span>
          )}
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          显示名 *
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13 }}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-3)", gridColumn: "1 / -1" }}>
          工作邮箱
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
          {email.trim() && !emailOk && (
            <span style={{ display: "block", marginTop: 4, color: "var(--danger)", fontSize: 11 }}>
              请输入有效邮箱格式。
            </span>
          )}
        </label>
      </div>
      <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
        操作理由 *(必填 · 写入审计)
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="为什么修改这个账号资料"
          style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
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
        关闭此窗口后不会再次显示临时密码;请通过已核验渠道告知对应运维人员。
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
        该账号使用临时密码登录后,必须先修改密码才能进入控制台。
      </div>
    </Drawer>
  );
}
