"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  changeA1AccountRole,
  createA1Account,
  createA1RbacAction,
  fetchA1Overview,
  resetA1Account2fa,
  revokeA1AccountSessions,
  updateA1AccountStatus,
  updateA1RbacGrants,
  updateA1SecurityBaseline,
  type A1CreateAccountInput,
  type A1Operator,
  type A1Overview,
  type A1RbacAction,
  type A1RoleDefinition,
  type A1SecurityBaseline,
  type GrantCell,
} from "@/lib/admin/a1-client";
import type { ACtx } from "./types";

type DomainGroup = "资金" | "用户/风控" | "增长/内容" | "基座/应急" | "all";
type MatrixAction = A1RbacAction;
type DisplayGrantCell = GrantCell | null;
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
};

const DOM_CHIPS: { key: DomainGroup; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "资金", label: "资金" },
  { key: "用户/风控", label: "用户/风控" },
  { key: "增长/内容", label: "增长/内容" },
  { key: "基座/应急", label: "基座/应急" },
];

const GRANT_LABEL: Record<GrantCell, string> = {
  M: "可发起",
  C: "可执行",
  R: "只读",
  "-": "无权",
};

const GRANT_OPTIONS: GrantCell[] = ["-", "R", "M", "C"];
const PWD_CHARS = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

function genPwdSegment(): string {
  let r = "";
  for (let i = 0; i < 4; i++) r += PWD_CHARS[Math.floor(Math.random() * PWD_CHARS.length)];
  return r;
}

function genPwd(): string {
  return `NX-${genPwdSegment()}-${genPwdSegment()}-${genPwdSegment()}`;
}

function toGrantCell(value: string | undefined): DisplayGrantCell {
  return value === "M" || value === "C" || value === "R" || value === "-" ? value : null;
}

function cellNode(c: DisplayGrantCell): ReactNode {
  if (c === "M") return <span className="a1-cell mk">M</span>;
  if (c === "C") return <span className="a1-cell ck">C</span>;
  if (c === "R") return <span className="a1-cell rd">读</span>;
  if (c === "-") return <span className="a1-cell no">—</span>;
  return <span className="a1-cell no">缺数据</span>;
}

function grantLabel(c: DisplayGrantCell) {
  return c == null ? "缺数据" : GRANT_LABEL[c];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function roleName(roles: A1RoleDefinition[], role: string) {
  return roles.find((r) => r.key === role)?.name ?? role;
}

function grantAt(row: { grants: readonly string[] }, index: number) {
  return index in row.grants ? toGrantCell(row.grants[index]) : null;
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

function operatorDisplayName(op: Pick<A1Operator, "name" | "email">) {
  return op.name?.trim() || op.email?.trim() || "运营账号";
}

function operatorDisplayLabel(op: Pick<A1Operator, "name" | "email">) {
  const name = operatorDisplayName(op);
  const email = op.email?.trim();
  return email && email !== name ? `${name}(${email})` : name;
}

export function A1Accounts({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const currentAdminId = useAdminAuth((s) => s.session?.adminId ?? null);
  const currentSessionRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const [overview, setOverview] = useState<A1Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutatingAction, setMutatingAction] = useState<string | null>(null);
  const [dom, setDom] = useState<DomainGroup>("all");
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [roleIdx, setRoleIdx] = useState<number | null>(null);
  const [naOpen, setNaOpen] = useState(false);

  const refreshOverview = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
    }
    setLoadError(null);
    try {
      setOverview(await fetchA1Overview());
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
        toast(`提交失败:${errorMessage(error)}`);
      } finally {
        setMutatingAction(null);
      }
    },
    [refreshOverview, toast],
  );

  const roles = overview?.roles ?? [];
  const operators = overview?.operators ?? [];
  const currentOperator = useMemo(() => {
    const id = currentAdminId === null ? null : String(currentAdminId);
    return id ? operators.find((op) => op.id === id) ?? null : null;
  }, [currentAdminId, operators]);
  const currentForceLogoutRole = forceLogoutRole(currentOperator?.role ?? currentSessionRole);
  const securityBaselines = overview?.securityBaselines ?? [];
  const rbacRows = overview?.rbacMatrix ?? [];
  const stats = overview?.stats;
  const effectiveSupers = stats?.effectiveSupers ?? 0;
  const supersTone = effectiveSupers <= 1 ? "danger" : effectiveSupers === 2 ? "warn" : "ok";
  const backendSessionBaseline = securityBaselines.find((b) => b.key === "session")?.value;
  const backendLockBaseline = securityBaselines.find((b) => b.key === "lock")?.value;
  const baselineCurrent = (key: string) => {
    if (key === "session_idle") return firstMatch(backendSessionBaseline, /(\d+(?:\.\d+)?)\s*min/i) ?? null;
    if (key === "session_abs") return firstMatch(backendSessionBaseline, /\/\s*(\d+(?:\.\d+)?)\s*h/i) ?? null;
    if (key === "lock_short_cnt") return firstMatch(backendLockBaseline, /(\d+(?:\.\d+)?)\s*次/) ?? null;
    if (key === "lock_short_min") return firstMatch(backendLockBaseline, /\/\s*(\d+(?:\.\d+)?)\s*min/i) ?? null;
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
  const mxRows = useMemo(
    () => rbacRows.filter((m) => dom === "all" || m.domainGroup === dom),
    [dom, rbacRows],
  );
  const forceLogoutBlockReason = (op: A1Operator) => {
    const targetId = operatorAccountId(op.id);
    if (currentAdminId !== null && targetId !== null && targetId === currentAdminId) {
      return "不能强制登出自己的当前账号";
    }
    if (!["super", "risk"].includes(currentForceLogoutRole)) {
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

  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [page, totalPages]);

  const changeRole = (op: A1Operator) => {
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
        roles: roles.map((r) => ({ key: r.key, label: r.name, scope: r.scope })),
        guardHint: `有效超管 ${effectiveSupers} 个;降级超管时仍需 ≥2`,
        actions: rbacRows.map((m) => ({ label: m.action, domainGroup: m.domainGroup })),
        grantsByRole: Object.fromEntries(
          roles.map((r, ri) => [r.key, rbacRows.map((m) => grantAt(m, ri) ?? "缺数据")]),
        ),
      },
      run: (reason, value) => {
        const roleStr = (value || "").trim();
        if (!roles.some((r) => r.key === roleStr)) {
          toast(`拒绝:无效角色 key (${roleStr})`);
          return;
        }
        if (op.role === "super" && op.status === "enabled" && roleStr !== "super" && effectiveSupers - 1 < 2) {
          toast("拒绝:剩余有效超管将不足 2 个");
          return;
        }
        void runMutation(
          `变更角色 ${displayName} → ${roleName(roles, roleStr)}`,
          () => changeA1AccountRole(op.id, roleStr, reason, operator),
          `${displayName} 角色已变更为 ${roleName(roles, roleStr)}`,
        );
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
      void runMutation(
        `重置双因子 ${operatorDisplayName(op)}`,
        () => resetA1Account2fa(op.id, `${reason}；${verify}`, operator),
        `${operatorDisplayName(op)} 双因子重置已提交 · 该账号需重新绑定`,
      );
    },
  });

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
        void runMutation(
          `禁用账号 ${displayName}`,
          () => updateA1AccountStatus(op.id, "disabled", reason, operator),
          `${displayName} 已禁用 · 活跃 session 已由后端吊销`,
        );
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
      void runMutation(
        `启用账号 ${operatorDisplayName(op)}`,
        () => updateA1AccountStatus(op.id, "enabled", reason, operator),
        `${operatorDisplayName(op)} 已启用`,
      );
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
        void runMutation(
          `强制登出 ${displayName}`,
          () => revokeA1AccountSessions(op.id, reason, operator),
          `${displayName} 全部 session 已强制登出`,
        );
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
        void runMutation(
          `调整安全基线 ${baseline.name}`,
          () => updateA1SecurityBaseline(backendKey, backendValue, reason, operator),
          `${baseline.name} 已调整为 ${n} ${baseline.unit}(对下一次登录签发生效)`,
        );
      },
    });
  };

  const editMx = (row: MatrixAction) => {
    const liveGrants = roles.map((_, index) => grantAt(row, index));
    openActionConfirm({
      action: `变更授权 · ${row.action}`,
      detail: (
        <>
          逐角色授权,值用 <span className="acode">M / C / R / -</span>。
          提交后后端校验最小权限底线:只读审计零写权、账号治理超管授权不可移除、跨域越权组合直接拒绝。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "permission-matrix",
        actionLabel: row.action,
        roles: roles.map((r, index) => ({ key: r.key, label: r.name, current: liveGrants[index] ?? "缺数据" })),
        guardHint: "后端会校验权限矩阵底线并写入配置与审计",
      },
      run: (reason, value) => {
        const grants = (value || "").split("/").map((s) => s.trim());
        if (grants.length !== roles.length) {
          toast(`拒绝:需要 ${roles.length} 项授权(收到 ${grants.length})`);
          return;
        }
        const bad = grants.find((grant) => !GRANT_OPTIONS.includes(grant as GrantCell));
        if (bad) {
          toast(`拒绝:无效授权值 "${bad}"`);
          return;
        }
        if (!grants.some((grant, index) => grant !== liveGrants[index])) {
          toast("没有授权变化");
          return;
        }
        void runMutation(
          `变更授权 ${row.action}`,
          () => updateA1RbacGrants(row.id, grants, reason, operator),
          `${row.action} 授权变更已发布`,
        );
      },
    });
  };

  const newMxRow = () => openActionConfirm({
    action: "登记新动作行",
    detail: (
      <>
        新增高敏动作会登记到后端 RBAC 总表;默认写权全关,只读审计默认保留取证读取。登记后再通过「改授权」逐角色开口。
      </>
    ),
    amplifies: false,
    edit: { kind: "text", current: "动作名", unit: "如:新提现参数审核" },
    run: (reason, value) => {
      const action = (value || "").trim();
      if (action.length < 4) {
        toast("拒绝:动作名称至少 4 个字符");
        return;
      }
      const domainGroup = dom === "all" ? "基座/应急" : dom;
      void runMutation(
        `登记新动作行 ${action}`,
        () => createA1RbacAction(action, domainGroup, reason, operator),
        `动作 ${action} 已登记到 RBAC 总表`,
      );
    },
  });

  const createAccount = (form: A1CreateAccountInput & { reason: string }) => {
    openActionConfirm({
      action: `新建运营账号 · ${form.displayName}`,
      detail: (
        <>
          <b>{form.displayName}</b> ({form.email}) · 角色 <b>{roleName(roles, form.role)}</b>
          · 凭据
          <span className="acode">{form.deliver === "mail" ? "工作邮箱自动下发" : "发起人当面交付"}</span>。
          <div style={{ marginTop: 8 }}>
            <b>新账号默认零写权,只有所选角色授权</b> · 首次登录强制绑定双因子 · 开通动作由后端创建账号、关系和审计。
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-4)" }}>
            临时密码由服务器生成和下发,前端只展示格式预览,不会保存或回显明文。
          </div>
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const finalReason = `${form.reason}；${reason}`;
        void runMutation(
          `新建运营账号 ${form.displayName}(${roleName(roles, form.role)})`,
          () => createA1Account(form, finalReason, operator),
          `账号 ${form.displayName} 已创建`,
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
          <div className="sub">后端约束 ≥2 · {effectiveSupers <= 2 ? "接近下限" : "健康"}</div>
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
          <span className="sub">· 数据来自后端账号表与 A1 配置 · 所有处置写入真实接口</span>
          <div className="r">
            <button className="l-btn sm" onClick={() => void refreshOverview(true)} disabled={!!mutatingAction}>刷新</button>
            <button className="l-btn sm mc" onClick={() => setNaOpen(true)} disabled={!roles.length || !!mutatingAction}>+ 新建账号</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
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
                  <tr key={op.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: "var(--ink)" }}>{operatorDisplayName(op)}</div>
                      <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>{op.email || "未配置邮箱"}</div>
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
                        <button className="l-btn sm" onClick={() => changeRole(op)} disabled={!!mutatingAction || !roles.length}>改角色</button>
                        <button className="l-btn sm" onClick={() => reset2fa(op)} disabled={!!mutatingAction}>重置 2FA</button>
                        <button
                          className="l-btn sm"
                          onClick={() => kickAllSessions(op)}
                          disabled={!!mutatingAction}
                          data-blocked={logoutBlock ? "true" : undefined}
                          title={logoutBlock ?? "强制吊销该账号全部 Redis 后台会话"}
                          style={logoutBlock ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
                        >
                          强制登出
                        </button>
                        {op.status === "enabled" ? (
                          <button className="l-btn sm dgr" onClick={() => disableAcct(op)} disabled={!!mutatingAction}>禁用</button>
                        ) : (
                          <button className="l-btn sm mc" onClick={() => enableAcct(op)} disabled={!!mutatingAction}>启用</button>
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

      <div className="two-col">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">登录与安全基线</span>
            <span className="sub">· 四条锁死,四项可调(每项单独调)</span>
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

        <section className="l-card">
          <div className="l-h">
          <span className="ttl">角色定义(c)· 后端角色表</span>
          <span className="sub">· 点角色看它在矩阵里拿到的全部动作</span>
          </div>
          <div className="l-b" style={{ paddingTop: 2 }}>
            {roles.map((role, index) => (
              <div className="a1-role" key={role.key} onClick={() => setRoleIdx(index)}>
                <span className="av" style={{ background: "var(--surface-2)", color: role.color || "var(--ink-2)" }}>{role.av}</span>
                <span className="bd">
                  <span className="t">{role.name}</span>
                  <span className="s">{role.desc}</span>
                </span>
                <span className="scope">{role.scope}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全域权限矩阵(b)· 域 × 动作 × 角色</span>
          <span className="sub">· 各域页面的权限表都是这张总表的局部投影 · 每行可改授权,变更即发布</span>
          <div className="r chips">
            <button className="l-btn sm mc" onClick={newMxRow} disabled={!!mutatingAction || !roles.length} style={{ marginRight: 6 }}>+ 登记新动作行</button>
            <span className="lb">域</span>
            {DOM_CHIPS.map((chip) => (
              <button
                key={chip.key}
                className={`chip${dom === chip.key ? " sel" : ""}`}
                onClick={() => setDom(chip.key)}
                type="button"
              >{chip.label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl a1-mx" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th>动作(代表性抽样)</th>
                {roles.map((role) => <th key={role.key}>{role.name}</th>)}
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {mxRows.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{row.action}</td>
                  {roles.map((role, index) => (
                    <td key={role.key}>{cellNode(grantAt(row, index))}</td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm mc" onClick={() => editMx(row)} disabled={!!mutatingAction}>改授权</button>
                  </td>
                </tr>
              ))}
              {!mxRows.length && (
                <tr>
                  <td colSpan={roles.length + 2} style={{ color: "var(--ink-4)", textAlign: "center", padding: 24 }}>
                    暂无该域动作
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
            {GRANT_OPTIONS.map((grant) => (
              <span key={grant}>{cellNode(grant)} {GRANT_LABEL[grant]}</span>
            ))}
          </div>
          <div className="atint">
            授权变更走后端接口 `/api/admin/platform/rbac/actions/:actionId/grants`, 后端统一校验最小权限和写入审计。
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>执行门槛</b>:账号建 / 停 / 启 / 改角色 / 重置双因子 / 强制登出走后端真实接口;安全基线 / RBAC 矩阵恢复 PRD 总表展示,提交动作仍通过后端接口发布。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "全域权限矩阵(b)· 域 × 动作 × 角色",
            kind: "fixed-matrix",
            maxRows: Math.max(16, rbacRows.length),
            reason: "固定角色动作矩阵,按域 chip 过滤,全量同屏比翻页更利于授权对比",
          },
        ]}
      />

      {roleIdx !== null && roles[roleIdx] && (() => {
        const role = roles[roleIdx];
        const granted = rbacRows.filter((row) => {
          const grant = grantAt(row, roleIdx);
          return grant != null && grant !== "-";
        }).slice(0, 8);
        return (
          <Drawer
            title={`角色 · ${role.name}`}
            sub={role.desc}
            onClose={() => setRoleIdx(null)}
          >
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.6, marginBottom: 10 }}>
              可访问域:<b style={{ color: "var(--ink-2)" }}>{role.scope}</b>。下表是该角色在全域矩阵中被授予的代表性动作(PRD 总表展示)。
            </div>
            <table className="l-tbl">
              <thead><tr><th>动作</th><th>授权</th></tr></thead>
              <tbody>
                {granted.map((row) => {
                  const grant = grantAt(row, roleIdx);
                  return (
                    <tr key={row.id}>
                      <td style={{ fontSize: 12.5 }}>{row.action}</td>
                      <td>{cellNode(grant)} <span style={{ marginLeft: 6, fontSize: 11.5, color: "var(--ink-4)" }}>{grantLabel(grant)}</span></td>
                    </tr>
                  );
                })}
                {!granted.length && (
                  <tr>
                    <td colSpan={2} style={{ color: "var(--ink-4)", textAlign: "center", padding: 18 }}>该角色暂无授权动作</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>
              完整授权以矩阵为准;授权变更走后端操作确认接口发布。
            </div>
          </Drawer>
        );
      })()}

      {naOpen && (
        <NewAccountDrawer
          roles={roles}
          disabled={!!mutatingAction}
          onClose={() => setNaOpen(false)}
          onSubmit={createAccount}
        />
      )}
    </>
  );
}

type NaForm = A1CreateAccountInput & {
  reason: string;
};

function NewAccountDrawer({
  roles,
  disabled,
  onClose,
  onSubmit,
}: {
  roles: A1RoleDefinition[];
  disabled?: boolean;
  onClose: () => void;
  onSubmit: (form: NaForm) => void;
}) {
  const defaultRole = "";
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [deliver, setDeliver] = useState<"mail" | "handoff">("mail");
  const [reason, setReason] = useState("");
  const [pwd, setPwd] = useState(() => genPwd());

  useEffect(() => {
    if (!roles.some((item) => item.key === role)) {
      setRole("");
    }
  }, [role, roles]);

  const emailOk = email.trim().endsWith("@nexion.io") && email.includes("@");
  const canSubmit = !disabled && displayName.trim().length > 0 && emailOk && role.length > 0 && reason.trim().length > 0;

  return (
    <Drawer
      title="新建运营账号"
      sub="① 账号信息 → ② 初始角色 → ③ 凭据 → 操作理由"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <button className="l-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>取消</button>
          <button
            className="l-btn primary"
            disabled={!canSubmit}
            style={{ flex: 2, justifyContent: "center", opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
            onClick={() => canSubmit && onSubmit({ displayName: displayName.trim(), email: email.trim(), role, deliver, reason: reason.trim() })}
          >确认创建账号</button>
        </div>
      }
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>① 账号信息</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
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
          工作邮箱 *(@nexion.io)
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@nexion.io"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
        </label>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>② 初始角色 *</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
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

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>③ 初始凭据 · 格式预览</div>
      <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: "var(--ink)" }}>{pwd}</span>
          <button className="l-btn sm" onClick={() => setPwd(genPwd())} type="button">换一个</button>
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>真密码由服务器生成;前端不持明文</span>
        </div>
        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>下发方式</span>
          <button className="l-btn sm" type="button" onClick={() => setDeliver("mail")} style={{ background: deliver === "mail" ? "var(--a-ac-soft)" : "var(--surface-2)", color: deliver === "mail" ? "var(--a-ac)" : "var(--ink-3)", fontWeight: deliver === "mail" ? 600 : 500 }}>工作邮箱自动下发</button>
          <button className="l-btn sm" type="button" onClick={() => setDeliver("handoff")} style={{ background: deliver === "handoff" ? "var(--a-ac-soft)" : "var(--surface-2)", color: deliver === "handoff" ? "var(--a-ac)" : "var(--ink-3)", fontWeight: deliver === "handoff" ? 600 : 500 }}>发起人当面交付</button>
        </div>
      </div>

      <div className="atint" style={{ marginBottom: 14 }}>
        <b>开通即生效的三条底线</b> · 默认零写权 · 首次登录强制绑定双因子 · 开通动作写入后端审计。
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
