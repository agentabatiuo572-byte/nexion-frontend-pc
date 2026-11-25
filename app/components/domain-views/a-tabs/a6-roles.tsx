"use client";
import "../a-domain.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Ban, CheckCircle2, CircleHelp, Clock3, Hourglass, KeyRound, ListTree, Minus, Plus, ShieldCheck, TriangleAlert, Undo2, UserCog, Users, XCircle, type LucideIcon } from "lucide-react";
import {
  fetchA6RolesOverview, fetchA6RoleDetail,
  type A6RoleOverview, type A6RoleDetail, type A6RoleCreateInput, type A6RoleUpdateInput, type A6RoleSummary,
} from "@/lib/admin/a6-client";
import { fetchA7MenusOverview, type A7MenuTreeNode } from "@/lib/admin/a7-client";
import { A_APPROVAL_PERMISSION_NAMES, aApprovalPermissionText } from "@/lib/admin/a-approval-names";
import { permLabel } from "@/lib/admin/rbac-labels";
import { fetchA8Permissions, type A8Permission } from "@/lib/admin/a8-client";
import { domainOfPermission } from "@/lib/admin/perm-domain";
import { F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { OperationConfirmModal, useToast, type InlineOperationApproval, type OperatorBriefKind } from "@/app/components/domain-views/design-kit";
import { buildRoleMetadataPayload, PlatformMutationReadbackError } from "@/lib/admin/platform-contracts";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { a6Recovery, a6GrantsProblem, rbacAuthority, rbacProposal, useRbacCommands, type A6Original, type RbacCommand } from "@/lib/admin/a6a7-mutations";
import { rebaseRecoveryFields, rebaseRecoverySet, sendRecoveredDraft } from "@/lib/admin/abe-recovery-access";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { canInvestigateECommand, eCommandClosureRequests, eCommandSettled, type ECommandInvestigation } from "@/lib/admin/e-command-investigation";
import { rbacClosureConclusions, rbacOutcomeView, rbacSettledText, type RbacOutcome } from "./rbac-recovery";
import { useRecoveryDraftDiscard } from "../recovery-draft-discard";
import { FundClosureModal } from "../fund-command-check";
import { TechInfo, receiptFact } from "../recovery-panel";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import {
  BarList, BlockState, Button, Change, Conclusion, Explain, Fact, Facts, Field, Fold, IconTile, Input, IrreversibleTag, Modal, Notice,
  PageHeader, Panel, RdPage, ReleaseModal, StatusTag, Textarea,
} from "@/app/components/rd";
import {
  AMPLIFIES_EXPLAIN, GrantsEditorDrawer, MenuChangeList, MismatchNotice, PermChangeList, SENSITIVE_EXPLAIN, flattenMenus, grantMismatch, setDiff,
} from "./a6-grants";

type ConfirmReq = {
  briefKind: OperatorBriefKind;
  /** 记进操作记录的名字，和改版前一样。 */
  action: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  effect: ReactNode;
  confirmLabel: string;
  confirmTone?: "primary" | "danger";
  statedBrief: { impact: string; check: string };
  facts: ReactNode;
  content?: ReactNode;
  run: (reason: string) => Promise<unknown>;
  getRecord: () => RbacCommand | undefined;
  matchesCommand: (commandKey: string) => boolean;
  blockedReason?: string;
};

/** 原请求的持久化审批观察；只有按原号查询才更新当前状态。 */
type Submitted = {
  ticket: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  label: string;
  change: string;
  at: number;
  status?: "pending" | "approved" | "rejected" | "withdrawn" | "expired";
  /** 改授权时提交的完整两组，用来和之后读到的详情比，看实际存下了什么（A6-PD01）。 */
  desired?: { permissionCodes: string[]; menuIds: number[] };
};

/** 已备好的原操作提醒，由持久保存的完整请求驱动。 */
type UnknownRow = { key: string; name: string; change: string; submittedAt: number; tag: ReactNode; line?: string; receipt?: ECommandInvestigation | null; actions: ReactNode };

/** 审批单最后一次查到的状态；只有回执、还没查到状态时单独写。 */
const TICKET_LOOK: Record<NonNullable<Submitted["status"]>, { label: string; tone: "warn" | "progress" | "ok" | "neutral"; icon: LucideIcon }> = {
  pending: { label: "待审批", tone: "warn", icon: Clock3 },
  approved: { label: "已批准", tone: "ok", icon: CheckCircle2 },
  rejected: { label: "已驳回", tone: "neutral", icon: XCircle },
  withdrawn: { label: "已撤回", tone: "neutral", icon: Undo2 },
  expired: { label: "审批已过期", tone: "neutral", icon: Hourglass },
};
const ticketTag = (status: Submitted["status"]) => {
  if (!status) return <StatusTag tone="warn" icon={CircleHelp} explain="审批单已经建好，还没查到它现在的状态。点「查询原操作」再查。">已建单，状态未查到</StatusTag>;
  const look = TICKET_LOOK[status];
  return <StatusTag tone={look.tone} icon={look.icon} explain="上次查到的状态。重新进入这页会再查一次，也可以点「查询原操作」。">{look.label}</StatusTag>;
};

/**
 * 是否为自动验收残留的临时角色(zentao #101)。
 *
 * 用例运行器直接建角色并留下真实行:code 是「前缀 + 长随机段」(M3RAMRP0ZDPJ /
 * F2_RO_MRUBHW1P / K2_FLAG_2202430),remark 写着 "... temporary role",状态启用、0 账号。
 * 这里只做**标注**,不隐藏 —— 隐藏会让运营以为目录干净,而真实问题(角色没被清理)
 * 仍在。判据要求零账号绑定:任何被真实账号引用的角色都不会被标成临时。
 */
export function isAcceptanceTempRole(role: { roleCode: string; remark?: string | null; adminCount?: number }): boolean {
  if ((role.adminCount ?? 0) > 0) return false;
  const code = (role.roleCode ?? "").trim().toUpperCase();
  return /^(M3|F2_RO|K[0-9]_FLAG)[A-Z0-9_]{4,}$/.test(code);
}

/** 8 内置角色中文职责说明(角色定义,从 A1 挪来)。自定义角色用 remark 兜底。职责只是说明，不是授权。 */
const ROLE_DESC: Record<string, { desc: string; scope: string }> = {
  SUPER_ADMIN: { desc: "平台负责人，拥有全部权限", scope: "全部模块" },
  CONFIG_ADMIN: { desc: "查看运营总览的部分页面", scope: "运营总览（部分）" },
  FINANCE: { desc: "负责资金对账、提现、账单和资金储备", scope: "运营总览、资金与财务" },
  RISK: { desc: "负责风控规则、风险评分和反作弊", scope: "用户与账户、风控，以及部分其他模块" },
  CONTENT: { desc: "负责文案、通知、信任中心和风险披露", scope: "内容与合规" },
  GROWTH: { desc: "负责活动、任务、代金券和运营节奏", scope: "增长与活动" },
  SUPPORT: { desc: "负责工单、会话、知识库和话术", scope: "客服中心" },
  AUDITOR: { desc: "全域只读，可导出脱敏文件", scope: "全部模块（只读）" },
};

const ADMIN_COUNT_EXPLAIN = "绑定到这个角色的账号记录数：不排除已停用的账号，也不是在线人数。账号分配在「运营账号与权限」。";
const CARD_COUNT_EXPLAIN = "卡片上的权限数、菜单数是角色里绑定的条数，不等于实际生效的权限或导航里能看到的菜单；「启用」是其中启用中的账号数。";
const approvalTag = (note: string, extra?: string) => (
  <StatusTag tone="progress" filled explain={`提交到「操作记录与审批」，另一位超级管理员批准后执行。${note}${extra ?? ""}`}>批准后生效</StatusTag>
);
const directTag = () => <StatusTag tone="progress" filled explain="填写理由并确认后立即生效，保留操作记录。">立即生效</StatusTag>;
const approverFacts = (permission: string) => <>
  <Fact k="谁来批">另一位超级管理员</Fact>
  <Fact k="需有权限">{aApprovalPermissionText(permission)}</Fact>
</>;
const roleFact = (name: string, code: string) => <Fact k="角色">{name} <span className="a6-code" data-mono>{code}</span></Fact>;
const describeOriginal = (original: A6Original) => original.kind === "a6-create" ? original.input.roleCode
  : original.kind === "a6-update" ? `${original.role.roleName} → ${original.input.roleName ?? original.role.roleName}`
    : original.kind === "a6-status" ? `${original.role.status === 1 ? "已启用" : "已停用"} → ${original.status === 1 ? "已启用" : "已停用"}`
      : original.kind === "a6-delete" ? `解绑 ${original.bound ?? "—"} 个账号`
        : `权限 ${original.role.permissionCodes.length} → ${original.input.permissionCodes.length} 项 · 菜单 ${original.role.menuIds.length} → ${original.input.menuIds.length} 个`;

export default function A6Roles() {
  const [, setToast] = useToast();
  const searchParams = useSearchParams();
  const roleIds = searchParams.getAll("roleId");
  const requestedId = roleIds.length === 1 && /^[1-9]\d*$/.test(roleIds[0]) ? Number(roleIds[0]) : NaN;
  const locatedId = Number.isSafeInteger(requestedId) ? requestedId : null;
  const appliedLocation = useRef<number | null | undefined>(undefined);
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const role = useAdminAuth((s) => s.session?.role ?? s.role);
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const isSuper = role === "super" || role === "superadmin";
  const canWrite = isSuper || authorities.includes("platform_a6_write");
  const canGrant = isSuper || authorities.includes("platform_a6_role_grants_update");
  const actorId = useAdminAuth((s) => s.session?.adminId);
  const commands = useRbacCommands("a6", actorId);
  const [overview, setOverview] = useState<A6RoleOverview | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadedDetail, setDetail] = useState<A6RoleDetail | null>(null);
  const detail = loadedDetail?.id === selectedId ? loadedDetail : null;
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailRetry, setDetailRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuTree, setMenuTree] = useState<A7MenuTreeNode[]>([]);
  const [allPerms, setAllPerms] = useState<A8Permission[]>([]);
  const [menuCatalogReady, setMenuCatalogReady] = useState(false);
  const [permissionCatalogReady, setPermissionCatalogReady] = useState(false);
  // 只用来在按钮上写清为什么打不开授权；读取和提示照旧。
  const [catalogFailed, setCatalogFailed] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<{ kind: "create" } | { kind: "update" } | null>(null);
  const discardRecovery = useRecoveryDraftDiscard();
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [recheckOriginal, setRecheckOriginal] = useState<A6Original | null>(null);
  const [closing, setClosing] = useState<RbacCommand | null>(null);
  const [releasing, setReleasing] = useState<RbacCommand | null>(null);
  /** 查询原操作后记录还保留时，这一行写查到了什么；重试或解除后不再用。 */
  const [outcomes, setOutcomes] = useState<Record<string, RbacOutcome>>({});
  const editingRef = useRef(false);
  editingRef.current = !!(formMode || grantsOpen || confirmReq);
  const selectedRoleRef = useRef(selectedId);
  selectedRoleRef.current = selectedId;
  const freshOverview = useRef<A6RoleOverview | null>(null);
  const freshDetail = useRef<A6RoleDetail | null>(null);
  const busy = useRef(false);
  const needsRecheck = useRef(false);
  const queried = useRef(new Set<string>());
  const reach = useReach();

  const refreshOverview = useCallback(async () => {
    freshOverview.current = null;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchA6RolesOverview();
      freshOverview.current = next;
      setOverview(next);
      return next;
    }
    catch (e) {
      const message = displayAdminReadError(e);
      setOverview(null);
      setLoadError(message);
      setToast(message);
      return null;
    }
    finally { setLoading(false); }
  }, [setToast]);

  const refreshCatalogs = useCallback(async () => {
    setMenuCatalogReady(false);
    setPermissionCatalogReady(false);
    setCatalogFailed(null);
    if (!canGrant) {
      setMenuTree([]);
      setAllPerms([]);
      setMenuCatalogReady(false);
      setPermissionCatalogReady(false);
      return false;
    }
    const results = await Promise.all([fetchA7MenusOverview()
      .then((o) => { setMenuTree(o.tree); setMenuCatalogReady(true); return true; })
      .catch((error) => { setCatalogFailed("菜单列表没读到，暂时不能改授权；刷新页面再试"); setToast(`菜单列表加载失败，暂时不能编辑授权：${displayAdminError(error)}`); return false; }),
    // A8 分页有上限(pageSize 被后端收口),多页拉全权限全集供 GrantsEditor 分组(避免缺域/缺权限)
    (async () => {
      try {
        const all: A8Permission[] = [];
        let pageNum = 1;
        let total = Infinity;
        const seen = new Set<string>();
        while (all.length < total) {
          const p = await fetchA8Permissions({ pageNum, pageSize: 100 });
          total = p.total;
          if (p.records.length === 0 && all.length < total) throw new Error("A8_CATALOG_TRUNCATED");
          for (const permission of p.records) {
            if (seen.has(permission.permissionCode)) throw new Error("A8_CATALOG_DUPLICATE_PAGE");
            seen.add(permission.permissionCode);
          }
          all.push(...p.records);
          if (pageNum >= 1000) throw new Error("A8_CATALOG_TOO_LARGE");
          pageNum++;
        }
        if (all.length !== total) throw new Error("A8_CATALOG_INCOMPLETE");
        setAllPerms(all);
        setPermissionCatalogReady(true);
        return true;
      } catch (error) {
        setCatalogFailed("权限列表没读到，暂时不能改授权；刷新页面再试");
        setToast(`权限列表加载失败，暂时不能编辑授权：${displayAdminError(error)}`);
        return false;
      }
    })()]);
    return results.every(Boolean);
  }, [canGrant, setToast]);

  useEffect(() => {
    void refreshOverview();
    void refreshCatalogs();
  }, [refreshOverview, refreshCatalogs]);

  useEffect(() => {
    // 只在首次读到角色目录或网址定位改变时选中；普通刷新不覆盖运营手动选择。
    if (!overview || appliedLocation.current === locatedId) return;
    appliedLocation.current = locatedId;
    setSelectedId(overview.roles.some((role) => role.id === locatedId) ? locatedId : null);
  }, [overview, locatedId]);

  useEffect(() => {
    let active = true;
    freshDetail.current = null;
    setDetail(null);
    setDetailError(null);
    if (selectedId == null) return;
    fetchA6RoleDetail(selectedId)
      .then((result) => { if (active) { freshDetail.current = result; setDetail(result); } })
      .catch((e) => { if (active) setDetailError(displayAdminReadError(e)); });
    return () => { active = false; };
  }, [selectedId, detailRetry]);

  const roles = useMemo(() => overview?.roles ?? [], [overview]);
  const builtinRoles = roles.filter((r) => r.builtin);
  const customRoles = roles.filter((r) => !r.builtin);
  const stopped = roles.filter((r) => r.status !== 1);
  const tempRoles = roles.filter((r) => isAcceptanceTempRole(r));
  const unbound = roles.filter((r) => r.adminCount === 0);
  const summary = roles.find((r) => r.id === selectedId) ?? null;
  const permByCode = useMemo(() => new Map(allPerms.map((perm) => [perm.permissionCode, perm])), [allPerms]);
  const menuById = useMemo(() => new Map(flattenMenus(menuTree).map((node) => [node.id, node])), [menuTree]);
  const catalogsReady = menuCatalogReady && permissionCatalogReady;

  const pick = (id: number) => {
    setSelectedId(id);
    // 窄屏时详情排在列表下面，点了滚过去。
    requestAnimationFrame(() => document.getElementById("a6-role-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const requireActor = (original?: A6Original, writing = false) => {
    const auth = useAdminAuth.getState(), session = auth.session;
    if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !session || session.adminId !== actorId || session.passwordChangeRequired) throw new Error("RBAC_SESSION_CHANGED");
    if (writing && (!original || !session.authorities.includes(rbacAuthority(original)))) throw new Error("RBAC_OPERATION_FORBIDDEN");
  };
  const requireNew = (original: A6Original) => {
    requireActor(original, true);
    if (busy.current || needsRecheck.current || !freshOverview.current) throw new Error("RBAC_FRESH_READ_REQUIRED");
    if (commands.blocked(original)) throw new Error("RBAC_ORIGINAL_UNRESOLVED");
    if (original.kind === "a6-create") return;
    if (!freshDetail.current || JSON.stringify(freshDetail.current) !== JSON.stringify(original.role)) throw new Error("RBAC_FRESH_READ_REQUIRED");
    if (original.kind === "a6-status" && original.role.roleCode === "SUPER_ADMIN") throw new Error("SUPER_ADMIN_ROLE_IMMUTABLE");
    if (original.kind === "a6-delete" && original.role.builtin) throw new Error("BUILTIN_ROLE_NOT_DELETABLE");
    if (original.kind === "a6-grants") {
      if (!catalogsReady) throw new Error("A6_CATALOG_REQUIRED");
      const problem = a6GrantsProblem(original.role.roleCode, original.input, flattenMenus(menuTree), allPerms);
      if (problem) throw new Error(problem);
    }
  };
  const reloadCurrent = async (roleId = selectedId, keepConfirmation = false) => {
    freshDetail.current = null;
    setFormMode(null); setGrantsOpen(false);
    if (!keepConfirmation) setConfirmReq(null);
    setDetail(null);
    const next = await refreshOverview();
    if (!next) throw new Error("RBAC_FRESH_READ_REQUIRED");
    if (roleId == null) return;
    if (!next.roles.some(role => role.id === roleId)) {
      setSelectedId(null); setConfirmReq(null); setRecheckOriginal(null); needsRecheck.current = false; return;
    }
    setSelectedId(roleId);
    try {
      const latest = await fetchA6RoleDetail(roleId);
      requireActor();
      freshDetail.current = latest; setDetail(latest); setDetailError(null);
    } catch (error) { setDetailError(displayAdminReadError(error)); throw error; }
  };
  const closeOriginalView = (record: RbacCommand) => {
    setConfirmReq(current => current?.matchesCommand(record.commandKey) ? null : current);
    setReleasing(current => current?.commandKey === record.commandKey ? null : current);
  };
  const readAfterOriginal = async (record: RbacCommand) => {
    const next = await refreshOverview();
    if (!next) throw new Error("RBAC_FRESH_READ_REQUIRED");
    if (!("role" in record.original)) return;
    const id = record.original.role.id;
    if (id !== selectedRoleRef.current || editingRef.current) return;
    if (!next.roles.some(role => role.id === id)) { setSelectedId(null); return; }
    const role = await fetchA6RoleDetail(id);
    requireActor();
    if (selectedRoleRef.current === id && !editingRef.current) {
      freshDetail.current = role;
      setDetail(role);
      setDetailError(null);
    }
  };
  const settleOriginal = (record: RbacCommand, notExecuted: boolean, ticket?: RbacCommand["ticket"]) => {
    if (notExecuted) commands.preserveDraft(record, ticket);
    else if (!ticket) commands.forget(record);
    closeOriginalView(record);
  };
  const queryOriginal = async (record: RbacCommand, announce = true) => {
    requireActor();
    queried.current.add(record.commandKey);
    const proposal = rbacProposal(record.original);
    const result = await a6Recovery.query(record, async original => {
      const ticket = proposal ? await commands.queryProposal(original) : null;
      requireActor();
      const state = !ticket && (!proposal || original.original.kind === "a6-status" && !original.ticket && !original.receipt)
        ? await commands.queryReceipt(original).catch(() => null) : null;
      const receipt = state === "REJECTED" || state === "UNKNOWN" || state === "FAILED" && isRetryExpired(original)
        ? await commands.queryInvestigation(original).catch(() => undefined) : undefined;
      requireActor();
      const missing = !ticket && (original.original.kind === "a6-status" || !proposal
        ? state === "NOT_FOUND" : !original.ticket && !original.receipt);
      const conclusion = missing ? "not-found"
        : state === "SUCCEEDED" || receipt?.businessState === "SUCCEEDED" || ticket?.status === "approved" ? "succeeded"
          : state === "NOT_EXECUTED" ? "not-executed" : "unknown";
      return { ticket, state, receipt, conclusion } as const;
    });
    if (!result) return false;
    const { ticket, state, receipt } = result;
    if (proposal) commands.observe(record, ticket);
    const keep = (outcome: RbacOutcome) => setOutcomes(all => ({ ...all, [record.commandKey]: outcome }));
    if (!ticket) {
      if (receipt && eCommandSettled(receipt)) {
        settleOriginal(record, receipt.originalStatus !== "SUCCEEDED" && receipt.originalStatus !== "CONFIRMED_SUCCEEDED");
        await readAfterOriginal(record);
        if (announce) setToast(rbacSettledText(receipt));
        return false;
      }
      // A6 may return its trusted business refusal after writes began and rolled back.
      // Keep the original; the minimal status supplies neither its reason nor a governed conclusion.
      if (state === "REJECTED") {
        keep({ state, receipt });
        return false;
      }
      if ((!proposal || record.original.kind === "a6-status" && !record.ticket && !record.receipt)
        && (state === "SUCCEEDED" || state === "NOT_EXECUTED")) {
        settleOriginal(record, state === "NOT_EXECUTED");
        await readAfterOriginal(record);
        // The historical receipt says nothing about grants made since; the reread role is the current state.
        if (announce) setToast(state !== "SUCCEEDED" ? "查到原结果：没有执行，记录已解除。"
          : record.original.kind === "a6-create" ? "查到原结果：角色已创建。"
            : record.original.kind === "a6-status" ? `查到原结果：提交时角色已是「${record.original.status === 1 ? "启用" : "停用"}」，不用审批。` : "查到原结果：已保存。");
        return false;
      }
      if (!proposal) {
        keep({ state: state ?? "ERROR", receipt });
        return false;
      }
      if (record.original.kind === "a6-status" && (state === "PROCESSING" || receipt)) {
        keep({ state: state ?? "ERROR", receipt });
        return false;
      }
      // Start/stop without earlier ticket evidence also asked for the original result above.
      setToast(record.original.kind === "a6-status" && !record.ticket && !record.receipt
        ? "没查到审批单，也没查到原结果，原记录仍保留；请稍后再查，或在 24 小时内按原操作重试。"
        : displayAdminReadError(new Error("A6_ORIGINAL_PROPOSAL_NOT_FOUND"))); return false;
    }
    closeOriginalView(record);
    // A terminal ticket is authoritative about the decision; the current grants still require a real GET.
    let readbackFailed = false;
    if (ticket.status !== "pending") {
      try {
        settleOriginal(record, ticket.status !== "approved", ticket);
        await readAfterOriginal(record);
      }
      catch { readbackFailed = true; setToast(displayAdminReadError(new Error("A6_ROLE_READBACK_FAILED"))); }
    }
    if (announce && !readbackFailed) setToast(displayAdminReadError(new Error(`A6_PROPOSAL_${ticket.status.toUpperCase()}`)));
    return { ticket, readbackFailed };
  };
  const executeOriginal = async (record: RbacCommand, retry: boolean) => {
    if (!record.original.kind.startsWith("a6-")) throw new Error("RBAC_ORIGINAL_REOPEN_REQUIRED");
    const original = record.original as A6Original;
    const current = commands.saved(record.commandKey);
    if (retry && (current?.ticket || current?.receipt)) { await queryOriginal(current); return; }
    requireActor(original, true);
    if (busy.current) throw new Error("RBAC_OPERATION_BUSY");
    busy.current = true;
    try {
      let result;
      try { result = await commands.send(record, retry); }
      catch (error) {
        if (!commands.saved(record.commandKey)) {
          if (retry) closeOriginalView(record);
          else { needsRecheck.current = true; setRecheckOriginal(original); }
          const reads = await Promise.allSettled([
            retry ? readAfterOriginal(record) : reloadCurrent("role" in original ? original.role.id : selectedId, true),
            ...(original.kind === "a6-grants" ? [refreshCatalogs()] : []),
          ]);
          for (const read of reads) if (read.status === "rejected") setToast(displayAdminReadError(read.reason));
        }
        throw error;
      }
      requireActor();
      if (result.kind === "proposal") {
        // The retained POST receipt may predate approval. Only GET by the original key determines today's status.
        try {
          const current = await queryOriginal(record, false);
          if (!current) throw new Error("A6_PROPOSAL_STATUS_UNKNOWN");
          const { ticket, readbackFailed } = current;
          if (readbackFailed) return;
          if (ticket.status === "pending") {
            setToast(`已提交，等待审批后执行 · 审批单 ${ticket.id} · 由另一位超级管理员批准`, "success");
          } else setToast(displayAdminReadError(new Error(`A6_PROPOSAL_${ticket.status.toUpperCase()}`)));
        } catch (error) { throw new Error("A6_PROPOSAL_STATUS_UNKNOWN", { cause: error }); }
      } else {
        closeOriginalView(record);
        try { await readAfterOriginal(record); }
        catch (error) { setToast(new PlatformMutationReadbackError(error).message); return; }
        setToast(original.kind === "a6-create" ? "角色已创建，还没有任何权限" : "已保存");
      }
    } finally { busy.current = false; }
  };
  const openOperation = (original: A6Original, view: Omit<ConfirmReq, "run" | "getRecord" | "matchesCommand">, recovery?: RbacCommand, draft?: RbacCommand) => {
    if (!recovery) {
      try { requireNew(original); }
      catch (error) { setToast(displayAdminError(error)); return; }
    }
    let saved = recovery;
    const getRecord = () => saved ? commands.saved(saved.commandKey) : undefined;
    setConfirmReq({ ...view, getRecord, matchesCommand: key => saved?.commandKey === key, run: async (reason) => {
      try {
        if (view.blockedReason) throw new Error(view.blockedReason);
        if (saved && !getRecord()) throw new Error("RBAC_ORIGINAL_REOPEN_REQUIRED");
        const retry = !!saved;
        if (saved) { const key = saved.commandKey; setOutcomes(all => { const next = { ...all }; delete next[key]; return next; }); }
        if (!saved) {
          requireNew(original);
          saved = commands.capture(original, reason, operator, String(view.action), describeOriginal(original));
        }
        const record = getRecord() ?? saved;
        await sendRecoveredDraft(() => executeOriginal(record, retry),
          () => !!commands.saved(record.commandKey), draft && (() => commands.forget(draft)));
      } catch (error) { setToast(displayAdminError(error)); throw error; }
      finally { if (!recovery && saved && !commands.saved(saved.commandKey)) saved = undefined; }
    } });
  };

  const openStatus = (original: Extract<A6Original, { kind: "a6-status" }>, recovery?: RbacCommand, draft?: RbacCommand) => {
    const d = original.role, nextStatus = original.status;
    const actionLabel = nextStatus === 1 ? "启用" : "停用";
    const bound = original.bound;
    openOperation(original, { briefKind: "security",
      action: `${actionLabel}角色 · ${d.roleName}`,
      title: `${actionLabel}角色「${d.roleName}」`,
      detail: <>{actionLabel}角色 <b>{d.roleName}</b>（<span data-mono>{d.roleCode}</span>）。</>,
      effect: approvalTag(nextStatus === 0 ? "批准前角色照常生效。" : "批准前角色保持停用。"),
      confirmLabel: `提交${actionLabel}审批`,
      statedBrief: nextStatus === 0
        ? { impact: bound === 0
              ? "批准后角色停用，授权保留，重新启用后恢复。"
              : `批准后，绑定它的${bound === undefined ? "" : ` ${bound} 个`}账号失去这个角色的权限；授权保留，重新启用后恢复。`,
            check: "其他角色给的权限不受影响，已登录的不会被退出。绑定账号数是现在读到的，批准时按当时实际绑定执行。" }
        : { impact: `批准后，绑定它的${bound === undefined ? "" : ` ${bound} 个`}账号重新得到这个角色的权限。`,
            check: "左侧菜单要等账号重新读取登录信息才更新。启用前核对它现在存着的权限和菜单。" },
      facts: <Facts>
        <Fact k="绑定账号" lead unit="个">{bound ?? "—"}</Fact>
        {roleFact(d.roleName, d.roleCode)}
        <Fact k="状态"><Change from={d.status === 1 ? "已启用" : "已停用"} to={nextStatus === 1 ? "已启用" : "已停用"} /></Fact>
        {approverFacts(A_APPROVAL_PERMISSION_NAMES.platform_a6_write)}
      </Facts>,
    }, recovery, draft);
  };

  const openDelete = (original: Extract<A6Original, { kind: "a6-delete" }>, recovery?: RbacCommand, draft?: RbacCommand) => {
    const d = original.role, bound = original.bound;
    openOperation(original, { briefKind: "security",
      action: `删除角色 · ${d.roleName}`,
      title: `删除角色「${d.roleName}」`,
      detail: <>删除角色 <b>{d.roleName}</b>（<span data-mono>{d.roleCode}</span>）。</>,
      effect: <>{approvalTag("批准前角色和绑定都不变。")}<IrreversibleTag>批准后不能撤销</IrreversibleTag></>,
      confirmLabel: "提交删除审批",
      confirmTone: "danger",
      statedBrief: {
        impact: bound !== undefined && bound > 0
          ? `批准后，${bound} 个账号和它解绑、失去它的权限；授权清空，角色从列表消失。`
          : "批准后授权清空，角色从列表消失。",
        check: "账号本身、其他角色和历史记录不删。账号数含停用的账号，是现在读到的，批准时按当时实际绑定执行。以后用同一个标识新建，得到的是没有任何权限的角色。",
      },
      facts: <Facts>
        <Fact k="会解绑的账号" lead unit="个" tone={bound !== undefined && bound > 0 ? "warn" : undefined}>{bound ?? "—"}</Fact>
        {roleFact(d.roleName, d.roleCode)}
        <Fact k="会清空的授权">权限 {d.permissionCodes.length} 项 · 菜单 {d.menuIds.length} 个</Fact>
        {approverFacts(A_APPROVAL_PERMISSION_NAMES.platform_a6_write)}
      </Facts>,
    }, recovery, draft);
  };

  const openGrants = (original: Extract<A6Original, { kind: "a6-grants" }>, recovery?: RbacCommand, previousRole?: A6RoleDetail, draft?: RbacCommand) => {
    const d = original.role, payload = original.input, bound = original.bound;
    const permBefore = d.permissionCodes.length, menuBefore = d.menuIds.length;
    const permByCode = new Map(original.permissions.map(perm => [perm.permissionCode, perm]));
    const menuById = new Map(flattenMenus(original.menus).map(menu => [menu.id, menu]));
    const permDiff = setDiff(d.permissionCodes, payload.permissionCodes);
    const menuDiff = setDiff(d.menuIds, payload.menuIds);
    const othersPerm = previousRole && setDiff(previousRole.permissionCodes, d.permissionCodes);
    const othersMenu = previousRole && setDiff(previousRole.menuIds, d.menuIds);
    const addedSensitive = permDiff.added.filter((code) => permByCode.get(code)?.permType === "HIGH").length;
    const addedAmplifies = permDiff.added.filter((code) => permByCode.get(code)?.amplifies === 1).length;
    const nothing = permDiff.added.length + permDiff.removed.length + menuDiff.added.length + menuDiff.removed.length === 0;
    const mismatch = grantMismatch(payload.permissionCodes, payload.menuIds, permByCode, menuById);
    openOperation(original, { briefKind: "security",
      action: `改角色授权 · ${d.roleName}`,
      title: `改「${d.roleName}」的权限和菜单`,
      detail: <>改角色 <b>{d.roleName}</b>（<span data-mono>{d.roleCode}</span>）的权限和菜单：权限 {permBefore}→{payload.permissionCodes.length} · 菜单 {menuBefore}→{payload.menuIds.length}。</>,
      effect: approvalTag("批准前这个角色的权限和菜单都不变。"),
      confirmLabel: "提交授权审批",
      blockedReason: draft && nothing ? "当前授权已包含这份草稿的改动" : undefined,
      statedBrief: {
        impact: `批准后整组替换，绑定它的${bound === undefined ? "" : ` ${bound} 个`}账号按新的权限和菜单使用。`,
        check: "其他角色给的权限不受影响；左侧菜单要等账号重新读取登录信息才更新。核对加了和去掉的，特别是敏感操作。",
      },
      facts: <Facts>
        <Fact k="会受影响的账号" lead unit="个">{bound ?? "—"}</Fact>
        {roleFact(d.roleName, d.roleCode)}
        <Fact k="权限"><Change from={`${permBefore} 项`} to={`${payload.permissionCodes.length} 项`} /></Fact>
        <Fact k="菜单"><Change from={`${menuBefore} 个`} to={`${payload.menuIds.length} 个`} /></Fact>
        {d.status === 0 && <Fact k="角色状态" tone="warn">已停用：批准后也不生效，启用后才生效</Fact>}
        {approverFacts(A_APPROVAL_PERMISSION_NAMES.platform_a6_role_grants_update)}
      </Facts>,
      content: (
        <div className="a6-diff">
          {addedSensitive > 0 && (
            <Notice tone="warn" title={<>加了 {addedSensitive} 项敏感操作{addedAmplifies ? `，其中 ${addedAmplifies} 项可能多付钱` : ""}<Explain label="敏感操作" content={<><p>{SENSITIVE_EXPLAIN}</p><p>{AMPLIFIES_EXPLAIN}</p></>} /></>} />
          )}
          {d.roleCode === "SUPER_ADMIN" && (
            <Notice tone="danger" title="超级管理员角色的授权不能修改，提交会被拒绝" />
          )}
          {nothing && <Notice tone="neutral" title="权限和菜单都没有改动"><p>{draft ? "当前授权已包含这份草稿的改动。" : "照样会建一张审批单，批准后内容不变。"}</p></Notice>}
          {othersPerm && othersMenu && (othersPerm.added.length + othersPerm.removed.length + othersMenu.added.length + othersMenu.removed.length > 0) &&
            <Fold inset title="别人改了什么" summary="核对权限和菜单变化">
              <PermChangeList codes={othersPerm.added} permByCode={permByCode} kind="add" />
              <PermChangeList codes={othersPerm.removed} permByCode={permByCode} kind="remove" />
              <MenuChangeList ids={othersMenu.added} menuById={menuById} kind="add" />
              <MenuChangeList ids={othersMenu.removed} menuById={menuById} kind="remove" />
            </Fold>}
          <MismatchNotice mismatch={mismatch} menuById={menuById} title="提交后权限和菜单有对不上的地方" />
          {(permDiff.added.length > 0 || permDiff.removed.length > 0) && (
            <section className="a6-diff-block" aria-label="权限改动">
              <h3 className="a6-subhead">权限：加 {permDiff.added.length} 项 · 去掉 {permDiff.removed.length} 项</h3>
              <PermChangeList codes={permDiff.added} permByCode={permByCode} kind="add" />
              <PermChangeList codes={permDiff.removed} permByCode={permByCode} kind="remove" />
            </section>
          )}
          {(menuDiff.added.length > 0 || menuDiff.removed.length > 0) && (
            <section className="a6-diff-block" aria-label="菜单改动">
              <h3 className="a6-subhead">菜单：加 {menuDiff.added.length} 个 · 去掉 {menuDiff.removed.length} 个</h3>
              <MenuChangeList ids={menuDiff.added} menuById={menuById} kind="add" />
              <MenuChangeList ids={menuDiff.removed} menuById={menuById} kind="remove" />
            </section>
          )}
        </div>
      ),
    }, recovery, draft);
  };

  const showOriginal = (original: A6Original, record?: RbacCommand, draft?: RbacCommand) => {
    if (original.kind === "a6-status") openStatus(original, record, draft);
    else if (original.kind === "a6-delete") openDelete(original, record, draft);
    else if (original.kind === "a6-grants") openGrants(original, record, undefined, draft);
    else if (original.kind === "a6-create" || original.kind === "a6-update") {
      const d = original.kind === "a6-update" ? original.role : null;
      const [, action, detailNode, view] = roleFormConfirmation(original.kind === "a6-create", d,
        original.kind === "a6-create" ? original.input.roleCode : original.role.roleCode,
        original.input.roleName ?? d!.roleName, original.input.remark ?? d?.remark ?? "");
      openOperation(original, { briefKind: "config", action, detail: detailNode, ...view }, record, draft);
    }
  };
  const restoreOriginal = (record: RbacCommand) => {
    if (record.original.kind.startsWith("a6-")) showOriginal(record.original as A6Original, record);
  };
  const openRecoveredDraft = async (record: RbacCommand) => {
    if (!record.verifiedNotExecuted || editingRef.current || busy.current) return;
    const original = record.original as A6Original;
    try {
      requireActor(original, true);
      const latest = await refreshOverview();
      if (!latest || editingRef.current || commands.blocked(original)) return;
      if (original.kind === "a6-create") {
        requireNew(original);
        showOriginal(original, undefined, record);
      } else {
        const summary = latest.roles.find(role => role.id === original.role.id);
        if (!summary) throw new Error("RBAC_FRESH_READ_REQUIRED");
        const role = await fetchA6RoleDetail(original.role.id);
        if (editingRef.current) return;
        let next: A6Original;
        if (original.kind === "a6-grants") {
          if (!catalogsReady) throw new Error("A6_CATALOG_REQUIRED");
          const beforePermissions = original.input.expectedPermissionCodes ?? original.role.permissionCodes;
          const beforeMenus = original.input.expectedMenuIds ?? original.role.menuIds;
          next = { ...original, role, bound: summary.adminCount, menus: menuTree, permissions: allPerms,
            input: { ...original.input, expectedPermissionCodes: role.permissionCodes, expectedMenuIds: role.menuIds,
              permissionCodes: rebaseRecoverySet(beforePermissions, original.input.permissionCodes, role.permissionCodes),
              menuIds: rebaseRecoverySet(beforeMenus, original.input.menuIds, role.menuIds) } };
        } else if (original.kind === "a6-update") {
          next = { ...original, role, input: rebaseRecoveryFields(
            { roleName: original.role.roleName, remark: original.role.remark ?? "" }, original.input,
            { roleName: role.roleName, remark: role.remark ?? "" }) };
        } else next = { ...original, role, bound: summary.adminCount };
        freshDetail.current = role; setSelectedId(role.id); setDetail(role);
        requireNew(next);
        if (next.kind === "a6-grants") openGrants(next, undefined, original.role, record);
        else showOriginal(next, undefined, record);
      }
    } catch (error) { setToast(displayAdminError(error)); }
  };
  useEffect(() => {
    if (!recheckOriginal || loading || !freshOverview.current || recheckOriginal.kind === "a6-grants" && !catalogsReady) return;
    const role = freshDetail.current;
    if (recheckOriginal.kind !== "a6-create" && (!role || role.id !== recheckOriginal.role.id)) return;
    setRecheckOriginal(null);
    needsRecheck.current = false;
    // A definitive first-submit rejection stays with the existing editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recheckOriginal, loading, loadedDetail, catalogsReady]);
  useEffect(() => {
    for (const record of commands.records) {
      if (!record.verifiedNotExecuted && (record.ticket || record.receipt) && !queried.current.has(record.commandKey)) void queryOriginal(record).catch(error => setToast(displayAdminReadError(error)));
    }
    // Query persisted observations once on this mount; explicit reads can query them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commands.records]);

  const readReason = loading || !overview || loadError ? displayAdminError(new Error("RBAC_FRESH_READ_REQUIRED")) : undefined;
  const roleRecords = commands.records.filter(record => !record.verifiedNotExecuted && "role" in record.original && record.original.role.id === selectedId);
  const writeReason = readReason ?? (roleRecords.some(record => !record.ticket) ? displayAdminError(new Error("RBAC_ORIGINAL_UNRESOLVED")) : undefined);
  const approvalReason = writeReason ?? (roleRecords.some(record => record.ticket?.status === "pending") ? displayAdminError(new Error("OBJECT_ALREADY_PENDING")) : undefined);
  useSyncExternalStore(a6Recovery.subscribe, a6Recovery.getRevision, () => 0);
  const replayBlock = (record: RbacCommand) => {
    const state = a6Recovery.state(record);
    return state.expired ? RETRY_EXPIRED_TEXT
      : state.replayBlock ? "先查询原操作，查不到才能重试" : undefined;
  };
  const unknownRows: UnknownRow[] = commands.records.filter(record => !record.verifiedNotExecuted && !record.ticket && !record.receipt).map(record => {
    const expired = isRetryExpired(record);
    const original = record.original;
    const outcome = outcomes[record.commandKey];
    const shown = outcome && rbacOutcomeView(outcome, { expired, canRetry: !replayBlock(record), canClose: canInvestigateECommand("platform_a6_read") });
    const releasable = !!a6Recovery.state(record).replayRejection;
    return {
      key: record.commandKey, name: record.name, change: record.change, submittedAt: record.createdAt,
      line: expired ? RETRY_EXPIRED_TEXT : shown?.line, receipt: outcome?.receipt,
      tag: shown ? <StatusTag tone={shown.tone} explain={shown.more}>{shown.label}</StatusTag> : expired
        ? <StatusTag tone="neutral" icon={Hourglass} explain={RETRY_EXPIRED_TEXT}>已过期</StatusTag>
        : <StatusTag tone="warn" icon={CircleHelp} explain={rbacProposal(original) ? "没收到确定结果，可能已建审批单。24 小时内可以按原操作重试，不会建第二张。" : "没收到确定结果，可能已经生效。24 小时内可以按原操作重试，不会重复执行。"}>结果未知</StatusTag>,
      actions: <>
        <Button variant="ghost" onClick={() => void queryOriginal(record).catch(error => setToast(displayAdminReadError(error)))}>查询原操作</Button>
        {canInvestigateECommand("platform_a6_read") && rbacClosureConclusions(outcome, expired).length > 0 && <Button variant="danger-outline" onClick={() => setClosing(record)}>核查结案</Button>}
        {!expired && <Button variant="ghost" disabledReason={replayBlock(record)} onClick={() => restoreOriginal(record)}>按原操作重试</Button>}
        {releasable && <Button variant="ghost" onClick={() => setReleasing(record)}>解除原操作记录</Button>}
      </>,
    };
  });
  for (const draft of commands.records.filter(record => record.verifiedNotExecuted)) unknownRows.push({
    key: draft.commandKey, name: draft.name, change: draft.change, submittedAt: draft.createdAt,
    tag: <StatusTag tone="neutral">未执行</StatusTag>,
    actions: <><Button variant="ghost" disabled={!!(formMode || grantsOpen || confirmReq) || loading} onClick={() => void openRecoveredDraft(draft)}>重新确认</Button>
      <Button variant="ghost" onClick={() => discardRecovery.ask(() => commands.forget(draft))}>放弃这份草稿</Button></>,
  });
  const submitted: Submitted[] = commands.records.flatMap(record => {
    const original = record.original;
    const evidence = record.ticket ?? record.receipt;
    if (!evidence || record.verifiedNotExecuted || !("role" in original)) return [];
    return [{ ticket: evidence.id, status: record.ticket?.status, roleId: original.role.id, roleCode: original.role.roleCode, roleName: original.role.roleName,
      label: original.kind === "a6-status" ? `${original.status === 1 ? "启用" : "停用"}角色` : original.kind === "a6-delete" ? "删除角色" : "改权限和菜单",
      change: record.change, at: record.createdAt, desired: original.kind === "a6-grants" ? original.input : undefined }];
  });
  const recoveryRecord = confirmReq?.getRecord();
  const recovery: InlineOperationApproval | undefined = confirmReq ? {
    resolve: () => undefined, pending: !!recoveryRecord, initialRecovery: "retry", expired: !!recoveryRecord && isRetryExpired(recoveryRecord),
    expiredRequestRecovery: recoveryRecord && isRetryExpired(recoveryRecord) ? "query" : undefined,
    disabledReason: recoveryRecord && !authorities.includes(rbacAuthority(recoveryRecord.original)) ? displayAdminError(new Error("RBAC_OPERATION_FORBIDDEN")) : undefined,
    recover: async () => { const record = confirmReq.getRecord(); if (record) await queryOriginal(record); return true; },
  } : undefined;

  const header = (
    <PageHeader pageId="A6" title="角色管理" summary="设置每个角色能做的操作和能看的菜单。"
      actions={canWrite ? <Button variant="primary" disabledReason={readReason} onClick={() => setFormMode({ kind: "create" })}><Plus size={14} aria-hidden />新建角色</Button> : undefined}
      readOnly={!canWrite && !canGrant ? "只读：可以查看角色和授权，不能修改"
        : !canWrite ? "只能改权限和菜单；新建、改名称、启停和删除要角色管理的修改权限" : undefined} />
  );

  const conclusion = loading ? (
    <Conclusion state="neutral" icon={Clock3}>正在加载角色…</Conclusion>
  ) : loadError ? (
    <Conclusion state="danger" icon={TriangleAlert} hint="点角色目录里的「重试」再读一次。">角色列表没读到，这部分没有判断</Conclusion>
  ) : tempRoles.length > 0 ? (
    <Conclusion state="warn" icon={TriangleAlert} hint="确认没人用后删除，删除要另一位超级管理员批准。"
      explain="名字像自动验收建的、没有绑定账号的角色会被标成测试残留。只是按名字判断，不会自动删除。">
      有 {tempRoles.length} 个测试残留角色，建议删除
    </Conclusion>
  ) : stopped.length > 0 ? (
    <Conclusion state="warn" icon={TriangleAlert} explain="停用的角色保留授权和绑定，但它的权限对绑定的账号不生效。">
      {roles.length} 个角色里有 {stopped.length} 个已停用，它们的权限对账号不生效
    </Conclusion>
  ) : (
    <Conclusion state="ok" icon={ShieldCheck} explain={`角色和绑定账号数在打开页面、新建或改名称后读取。${ADMIN_COUNT_EXPLAIN}`}>
      {roles.length} 个角色都在启用{unbound.length > 0 ? `，${unbound.length} 个还没有绑定账号` : ""}
    </Conclusion>
  );

  return (
    <RdPage className="adom a6-page">
      {discardRecovery.dialog}
      {header}
      {conclusion}

      {unknownRows.length > 0 && (
        <Notice tone="warn" title={unknownRows.some(row => row.line) ? "有原操作要处理" : "有原操作结果未知"}>
          <ul className="a6-recovery" aria-label="结果未知的原操作">
            {unknownRows.map((row) => (
              <li key={row.key}>
                <span className="a6-recovery-name">{row.name}</span>
                <span className="a6-recovery-change">{row.change}</span>
                <span className="a6-recovery-time">{businessStamp(row.submittedAt)} 提交</span>
                {row.tag}
                <span className="a6-recovery-actions">{row.actions}</span>
                {row.line && <span className="a6-recovery-line" role="status">{row.line} <TechInfo commandKey={row.key} receipt={row.receipt} /></span>}
              </li>
            ))}
          </ul>
          <p className="a6-zone">提交时间为{businessZone().label}</p>
        </Notice>
      )}

      {submitted.length > 0 && (
        <Notice tone={submitted.some(row => row.status === "pending" || !row.status) ? "progress" : "neutral"} title="已提交的审批">
          <ul className="a6-recovery" aria-label="已提交的审批">
            {submitted.map((row) => (
              <li key={`${row.ticket}-${row.at}`}>
                <span className="a6-recovery-name">{row.label}</span>
                <span className="a6-recovery-change">{row.change}</span>
                <span className="a6-recovery-time">{businessStamp(row.at)} 提交</span>
                {ticketTag(row.status)}
                <span className="a6-recovery-actions">
                  <Button variant="ghost" onClick={() => { const record = commands.records.find(record => (record.ticket ?? record.receipt)?.id === row.ticket); if (record) void queryOriginal(record).catch(error => setToast(displayAdminReadError(error))); }}>查询原操作</Button>
                  {reach("/platform/audit") && <Link className="rd-link" href={`/platform/audit?domain=A&object=${encodeURIComponent(row.roleCode)}`}>看审批单 <span data-mono>{row.ticket}</span></Link>}
                </span>
                {row.desired && detail?.id === row.roleId && <SavedCheck desired={row.desired} detail={detail} approved={row.status === "approved"} permByCode={permByCode} menuById={menuById} onRetry={() => { const record = commands.records.find(record => (record.ticket ?? record.receipt)?.id === row.ticket); if (record) void queryOriginal(record).catch(error => setToast(displayAdminReadError(error))); }} />}
              </li>
            ))}
          </ul>
          <p className="a6-zone">提交时间为{businessZone().label}</p>
        </Notice>
      )}

      <div className="a6-layout">
        <div className="rd-split a6-main" data-detail="">
          <Panel title="角色目录" icon={Users} tone="role-3" sub={overview ? `${roles.length} 个` : undefined}
            explain={<><p>点一个角色，在右边看它能做什么、能看哪些菜单、有多少账号在用。</p><p>{CARD_COUNT_EXPLAIN}</p></>}>
            {loading ? <BlockState state="loading" title="正在加载角色…" />
              : loadError ? <BlockState state="error" title="角色列表加载失败" detail={loadError} onRetry={() => void refreshOverview()} />
              : roles.length === 0 ? <BlockState state="empty" title="还没有角色" />
              : (
                <div className="a6-groups">
                  <RoleGroup title="内置角色" count={builtinRoles.length}
                    explain="系统自带的 8 个角色，不能删除。超级管理员角色还不能停用、不能改授权。"
                    roles={builtinRoles} selectedId={selectedId} onPick={pick} />
                  <RoleGroup title="自定义角色" count={customRoles.length}
                    explain="不在内置 8 个之内的角色，包括系统迁移建的（比如财务主管）和运营新建的。可以删除，删除要审批。"
                    roles={customRoles} selectedId={selectedId} onPick={pick} empty="还没有自定义角色" />
                </div>
              )}
          </Panel>

          <div id="a6-role-detail" className="a6-detail-col">
            {selectedId == null ? (
              <Panel title="角色详情" icon={KeyRound} tone="role-4">
                <p className="a6-muted">点左边一个角色，看它能做什么。</p>
                {roles.length > 0 && (
                  <div className="a6-overview-bars">
                    <h3 className="a6-subhead">各角色绑定的账号<Explain label="绑定账号" content={ADMIN_COUNT_EXPLAIN} /></h3>
                    <BarList label="各角色绑定的账号" slot={3} rows={[...roles].sort((a, b) => b.adminCount - a.adminCount).map((r) => ({
                      key: String(r.id), label: r.roleName || r.roleCode, value: r.adminCount, text: `${r.adminCount} 个`,
                    }))} />
                  </div>
                )}
              </Panel>
            ) : detailError ? (
              <Panel title={summary?.roleName || "角色详情"} icon={KeyRound} tone="role-4">
                <BlockState state="error" title="角色详情加载失败" detail={detailError} onRetry={() => setDetailRetry((value) => value + 1)} />
              </Panel>
            ) : !detail ? (
              <Panel title={summary?.roleName || "角色详情"} icon={KeyRound} tone="role-4">
                <BlockState state="loading" title="角色详情加载中…" />
              </Panel>
            ) : (
              <RoleDetail detail={detail} summary={summary} canWrite={canWrite} canGrant={canGrant}
                writeReason={writeReason} approvalReason={approvalReason}
                catalogsReady={catalogsReady} catalogFailed={catalogFailed} permByCode={permByCode} menuById={menuById}
                reach={reach}
                onEdit={() => setFormMode({ kind: "update" })}
                onGrants={() => setGrantsOpen(true)}
                onStatus={() => openStatus({ kind: "a6-status", role: detail, status: detail.status === 1 ? 0 : 1, bound: summary?.adminCount })}
                onDelete={() => openDelete({ kind: "a6-delete", role: detail, bound: summary?.adminCount })}
                onBuiltinDelete={() => setToast("内置角色不可删除")} />
            )}
          </div>
        </div>
      </div>

      {formMode && (
        <RoleFormModal mode={formMode} detail={detail} onClose={() => setFormMode(null)}
          onSubmit={(payload, action, detailNode, confirmView) => {
            setFormMode(null);
            const original: A6Original = formMode.kind === "create" ? { kind: "a6-create", input: payload as A6RoleCreateInput }
              : { kind: "a6-update", role: detail!, input: payload as A6RoleUpdateInput };
            openOperation(original, { briefKind: "config", action, detail: detailNode, ...confirmView });
          }} />
      )}

      {grantsOpen && detail && (
        <GrantsEditorDrawer detail={detail} menuTree={menuTree} allPerms={allPerms} onClose={() => setGrantsOpen(false)}
          onSubmit={(payload) => {
            setGrantsOpen(false);
            openGrants({ kind: "a6-grants", role: detail, input: payload, bound: summary?.adminCount, menus: menuTree, permissions: allPerms });
          }} />
      )}

      {releasing && (
        <ReleaseModal label={<>{releasing.name}<br />{businessStamp(releasing.createdAt)} 提交</>}
          onCancel={() => setReleasing(null)}
          onConfirm={() => {
            if (!a6Recovery.releaseRejectedReplay(releasing)) throw new Error("RBAC_ORIGINAL_UNRESOLVED");
            commands.sync(); setReleasing(null); setToast("已解除原操作记录", "success");
          }} />
      )}

      {closing && <FundClosureModal label={closing.name} createdAt={closing.createdAt}
        offer={eCommandClosureRequests(outcomes[closing.commandKey]?.receipt, isRetryExpired(closing))}
        facts={<><Fact k="角色">{closing.change}</Fact><Fact k="系统记录">{receiptFact(outcomes[closing.commandKey]?.receipt ?? null, "记录保留")}</Fact></>}
        onClose={() => setClosing(null)} onSubmit={async evidence => {
          const record = closing;
          const next = await commands.queryInvestigation(record, evidence);
          requireActor();
          setClosing(null);
          if (!next || !eCommandSettled(next)) {
            setOutcomes(all => ({ ...all, [record.commandKey]: { state: next?.businessState === "PROCESSING" ? "PROCESSING" : next?.businessState === "REJECTED" ? "REJECTED" : "UNKNOWN", receipt: next } }));
            return;
          }
          settleOriginal(record, next.originalStatus !== "SUCCEEDED" && next.originalStatus !== "CONFIRMED_SUCCEEDED");
          setToast(rbacSettledText(next));
          await readAfterOriginal(record);
        }} />}

      {confirmReq && (
        <OperationConfirmModal briefKind={confirmReq.briefKind}
          initialReason={recoveryRecord?.reason} getPendingReason={() => confirmReq.getRecord()?.reason} inlineApproval={recovery}
          getPendingRecovery={() => {
            const record = confirmReq.getRecord();
            if (!record) return;
            const state = a6Recovery.state(record);
            return { state, expiresAt: state.expiresAt, blockedReason: replayBlock(record),
              subscribe: a6Recovery.subscribe, getRevision: a6Recovery.getRevision };
          }}
          blockedReason={confirmReq.blockedReason ?? (!recoveryRecord ? readReason : undefined)}
          action={confirmReq.action} title={confirmReq.title} detail={confirmReq.detail}
          effect={confirmReq.effect} confirmLabel={confirmReq.confirmLabel} confirmTone={confirmReq.confirmTone}
          statedBrief={confirmReq.statedBrief} facts={confirmReq.facts} content={confirmReq.content}
          onClose={() => setConfirmReq(null)}
          onConfirm={async (reason) => { await confirmReq.run(reason); setConfirmReq(null); }} />
      )}
    </RdPage>
  );
}

function RoleGroup({ title, count, explain, roles, selectedId, onPick, empty }: {
  title: string; count: number; explain: string; roles: A6RoleSummary[]; selectedId: number | null; onPick: (id: number) => void; empty?: string;
}) {
  return (
    <section className="a6-group" aria-label={title}>
      <h3 className="a6-subhead">{title}<span className="a6-group-count">{count}</span><Explain label={title} content={explain} /></h3>
      {roles.length === 0 ? <p className="a6-muted">{empty}</p> : (
        <ul className="a6-roles">
          {roles.map((r) => {
            const desc = ROLE_DESC[r.roleCode]?.desc || r.remark;
            const temp = isAcceptanceTempRole(r);
            const selected = r.id === selectedId;
            return (
              <li key={r.id}>
                <button type="button" className="a6-role" aria-pressed={selected} data-selected={selected ? "" : undefined} data-stopped={r.status !== 1 ? "" : undefined}
                  aria-label={`查看角色 ${r.roleName || r.roleCode}`} onClick={() => onPick(r.id)}>
                  <IconTile tone={r.status === 1 ? "role-3" : "neutral"} icon={r.builtin ? ShieldCheck : UserCog} size={28} />
                  <span className="a6-role-main">
                    <span className="a6-role-name">
                      <span className="a6-role-title">{r.roleName || r.roleCode}</span>
                      <span className="a6-role-code" data-mono title={r.roleCode}>{r.roleCode}</span>
                      {r.status !== 1 && <StatusTag tone="neutral" icon={Ban}>已停用</StatusTag>}
                      {/* 自动验收残留的临时角色必须与真实角色目录可区分（zentao 101）。 */}
                      {temp && <StatusTag tone="warn" icon={TriangleAlert}>测试用 · 建议删除</StatusTag>}
                    </span>
                    {desc && <span className="a6-role-desc" title={desc}>{desc}</span>}
                    {(r.permissionCount !== undefined || r.menuGrantCount !== undefined) && (
                      <span className="a6-role-meta">
                        {r.permissionCount !== undefined && <span>已绑定权限 {r.permissionCount} 项</span>}
                        {r.menuGrantCount !== undefined && <span>{r.permissionCount !== undefined ? "" : "已绑定"}菜单 {r.menuGrantCount} 个</span>}
                      </span>
                    )}
                  </span>
                  <span className="a6-role-count" data-empty={r.adminCount === 0 ? "" : undefined}>
                    <b>{r.adminCount}</b><small>个账号</small>
                    {r.enabledAdminCount !== undefined && <small>启用 {r.enabledAdminCount}</small>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function RoleDetail({ detail, summary, canWrite, canGrant, writeReason, approvalReason, catalogsReady, catalogFailed, permByCode, menuById, reach, onEdit, onGrants, onStatus, onDelete, onBuiltinDelete }: {
  detail: A6RoleDetail;
  summary: A6RoleSummary | null;
  canWrite: boolean;
  canGrant: boolean;
  writeReason?: string;
  approvalReason?: string;
  catalogsReady: boolean;
  catalogFailed: string | null;
  permByCode: ReadonlyMap<string, A8Permission>;
  menuById: ReadonlyMap<number, A7MenuTreeNode>;
  reach: (href: string) => boolean;
  onEdit: () => void;
  onGrants: () => void;
  onStatus: () => void;
  onDelete: () => void;
  onBuiltinDelete: () => void;
}) {
  const isSuperRole = detail.roleCode === "SUPER_ADMIN";
  const duty = ROLE_DESC[detail.roleCode];
  const permsKnown = permByCode.size > 0;
  const sensitive = permsKnown ? detail.permissionCodes.filter((code) => permByCode.get(code)?.permType === "HIGH").length : null;
  const amplifies = permsKnown ? detail.permissionCodes.filter((code) => permByCode.get(code)?.amplifies === 1).length : null;
  const byDomain = new Map<string, { label: string; count: number; sensitive: number }>();
  for (const code of detail.permissionCodes) {
    const domain = domainOfPermission(code);
    const row = byDomain.get(domain.code) ?? { label: domain.code === "?" ? "其他" : `${domain.code} ${domain.name}`, count: 0, sensitive: 0 };
    row.count += 1;
    if (permByCode.get(code)?.permType === "HIGH") row.sensitive += 1;
    byDomain.set(domain.code, row);
  }
  const domainRows = [...byDomain.entries()].sort((a, b) => b[1].count - a[1].count);
  const mismatch = catalogsReady ? grantMismatch(detail.permissionCodes, detail.menuIds, permByCode, menuById) : null;
  const grantReason = isSuperRole ? displayAdminError(new Error("SUPER_ADMIN_ROLE_IMMUTABLE"))
    : approvalReason ?? (!catalogsReady ? (catalogFailed ?? "菜单或权限列表还没加载完") : undefined);
  const links = [
    { href: "/platform/rbac", label: "运营账号与权限", text: "把账号分给这个角色" },
    { href: "/platform/permissions", label: "权限清单", text: "查一项权限管什么" },
    { href: "/platform/menus", label: "菜单管理", text: "改菜单本身" },
  ].filter((link) => reach(link.href));

  return (
    <Panel title={detail.roleName} icon={detail.builtin ? ShieldCheck : UserCog} tone="role-3"
      sub={<span data-mono>{detail.roleCode}</span>}
      actions={<span className="a6-tags">
        <StatusTag tone="neutral" icon={detail.builtin ? ShieldCheck : UserCog}>{detail.builtin ? "内置" : "自定义"}</StatusTag>
        {detail.status === 1 ? <StatusTag tone="ok" icon={CheckCircle2}>已启用</StatusTag> : <StatusTag tone="neutral" icon={Ban}>已停用</StatusTag>}
      </span>}>
      <div className="a6-detail">
        <dl className="a6-nums">
          <div>
            <dt>绑定账号<Explain label="绑定账号" content={ADMIN_COUNT_EXPLAIN} /></dt>
            <dd data-empty={summary?.adminCount === 0 ? "" : undefined}><b>{summary?.adminCount ?? "—"}</b> 个</dd>
            {summary?.enabledAdminCount !== undefined && <dd className="a6-nums-sub">启用中 {summary.enabledAdminCount} 个</dd>}
          </div>
          <div>
            <dt>能做的操作<Explain label="能做的操作" content={<><p>这个角色存着的、启用中的权限数。</p><p>{SENSITIVE_EXPLAIN}</p></>} /></dt>
            <dd data-empty={detail.permissionCodes.length === 0 ? "" : undefined}><b>{detail.permissionCodes.length}</b> 项</dd>
            {sensitive === null
              ? <dd className="a6-nums-sub">敏感操作数要能读权限清单</dd>
              : <><dd className="a6-nums-sub">敏感操作 {sensitive} 项</dd>{amplifies ? <dd className="a6-nums-sub">可能多付钱 {amplifies} 项<Explain label="可能多付钱" content={AMPLIFIES_EXPLAIN} /></dd> : null}</>}
          </div>
          <div>
            <dt>能看的菜单<Explain label="能看的菜单" content="存着的菜单数，一级菜单和页面都算，停用或还没上线的也算在内，所以不等于左侧导航实际显示的页数。" /></dt>
            <dd data-empty={detail.menuIds.length === 0 ? "" : undefined}><b>{detail.menuIds.length}</b> 个</dd>
          </div>
        </dl>

        <dl className="a6-kv">
          {duty && <div><dt>默认职责<Explain label="默认职责" content="页面上写的职责说明，不是授权。这个角色实际能做什么，以存着的权限和菜单为准。" /></dt><dd>{duty.desc}（{duty.scope}）</dd></div>}
          <div><dt>备注</dt><dd data-empty={detail.remark ? undefined : ""}>{detail.remark || "—"}</dd></div>
        </dl>

        {!!detail.legacyNonReadPermissionCodes?.length && <Notice tone="warn" title={`还存着 ${detail.legacyNonReadPermissionCodes.length} 项历史留下的修改权限`}>
          <p>默认职责是只读；这几项是早期授权留下的，不是现行职责，现在仍然有效：{detail.legacyNonReadPermissionCodes.slice(0, 5).map((code) => permLabel(code, permByCode.get(code))).join("、")}{detail.legacyNonReadPermissionCodes.length > 5 ? ` 等 ${detail.legacyNonReadPermissionCodes.length} 项` : ""}。</p>
          <p>要收回，点下面「改权限和菜单」去掉，另一位超级管理员批准后生效；这页不会自动收回。</p>
        </Notice>}


        {mismatch && <MismatchNotice mismatch={mismatch} menuById={menuById} />}

        <section aria-label="能做的操作按模块">
          <h3 className="a6-subhead">能做的操作，按模块<span className="a6-group-count">{byDomain.size} 个模块</span></h3>
          {domainRows.length === 0
            ? <p className="a6-muted">还没有任何权限{canGrant ? "，点下面「改权限和菜单」给它授权" : ""}</p>
            : <BarList label="能做的操作按模块" slot={4} rows={domainRows.map(([code, row]) => ({
                key: code, label: row.label, value: row.count, text: permsKnown && row.sensitive ? `${row.count} 项 · 敏感 ${row.sensitive}` : `${row.count} 项`,
              }))} />}
        </section>

        <section className="a6-f4" aria-label="区域大使核验">
          <h3 className="a6-subhead">区域大使核验<Explain label="区域大使核验" content="材料核验和费用核验分开授权，最终批准另有权限，核验的人不能批准同一版本。增长角色不会自动拿到核验权限；审计角色的默认职责是只读。" /></h3>
          <dl className="a6-kv">
            {F4_MATERIAL_PERMISSIONS.map((permission) => {
              const on = detail.permissionCodes.includes(permission.code);
              return <div key={permission.code}><dt>{permission.label}</dt><dd>{on ? <StatusTag tone="ok" icon={CheckCircle2}>已授权</StatusTag> : <StatusTag tone="neutral" icon={Minus}>未授权</StatusTag>}</dd></div>;
            })}
          </dl>
        </section>

        {(canWrite || canGrant) && (
          <div className="a6-actions">
            {canWrite && (
              <div className="a6-action-group">
                <span className="a6-action-cap">立即生效</span>
                <div className="a6-action-row">
                  <Button variant="secondary" disabledReason={writeReason} onClick={onEdit}>编辑名称和备注</Button>
                </div>
              </div>
            )}
            <div className="a6-action-group">
              <span className="a6-action-cap">要另一位超级管理员批准</span>
              <div className="a6-action-row">
                {canGrant && <Button variant="primary" disabledReason={grantReason} onClick={onGrants}>改权限和菜单</Button>}
                {canWrite && <Button variant="secondary" disabledReason={isSuperRole ? "超级管理员角色不能停用" : approvalReason} onClick={onStatus}>{detail.status === 1 ? "停用" : "启用"}</Button>}
                {canWrite && <Button variant="danger-outline" disabledReason={detail.builtin ? "内置角色不能删除" : approvalReason} onBlockedClick={detail.builtin ? onBuiltinDelete : undefined} onClick={onDelete}>删除</Button>}
              </div>
            </div>
            {isSuperRole && <p className="a6-note"><TriangleAlert size={14} aria-hidden />超级管理员角色的权限和菜单不能修改，提交会被拒绝</p>}
          </div>
        )}

        {links.length > 0 && (
          <nav className="a6-links" aria-label="相关页面">
            {links.map((link) => <span key={link.href}><Link className="rd-link" href={link.href}>{link.label}</Link><span className="a6-muted">{link.text}</span></span>)}
          </nav>
        )}
      </div>
    </Panel>
  );
}

/** A6-PD01：提交的整组和现在读到的详情比，列出没存上的权限。审批还没批准时两边也会不一样，所以只陈述差别。 */
function SavedCheck({ desired, detail, approved, permByCode, menuById, onRetry }: { desired: { permissionCodes: string[]; menuIds: number[] }; detail: A6RoleDetail; approved: boolean; permByCode: ReadonlyMap<string, A8Permission>; menuById: ReadonlyMap<number, A7MenuTreeNode>; onRetry: () => void }) {
  const missing = desired.permissionCodes.filter((code) => !detail.permissionCodes.includes(code));
  const extra = detail.permissionCodes.filter((code) => !desired.permissionCodes.includes(code));
  const menuSame = setDiff(desired.menuIds, detail.menuIds);
  const menuDiffs = menuSame.added.length + menuSame.removed.length;
  const same = missing.length === 0 && extra.length === 0 && menuDiffs === 0;
  const parts = [missing.length ? `${missing.length} 项权限提交了、现在没有` : "", extra.length ? `多出 ${extra.length} 项权限` : "", menuDiffs ? `菜单有 ${menuDiffs} 个不同` : ""].filter(Boolean);
  return (
    <div className="a6-saved">
      {approved && (same ? <span>现在存着的和提交的一致</span> : (
        <Fold inset title="和提交的不一样" alert summary={parts.join("；")}
          explain="只说明现在存着的和这次申请不同：多半是之后又改过授权；较早批准的申请也可能当时没存全。">
          {missing.length > 0 && <PermChangeList codes={missing} permByCode={permByCode} kind="missing" limit={20} />}
          {menuDiffs > 0 && <>
            <h4 className="a6-subhead">菜单：提交了、现在没有 {menuSame.removed.length} 个 · 现在多出 {menuSame.added.length} 个</h4>
            <MenuChangeList ids={menuSame.removed} menuById={menuById} kind="remove" />
            <MenuChangeList ids={menuSame.added} menuById={menuById} kind="add" />
          </>}
          {missing.length === 0 && menuDiffs === 0 && <p className="a6-muted">提交的权限都在，现在多出 {extra.length} 项权限。</p>}
        </Fold>
      ))}
      <Button variant="ghost" onClick={onRetry}>重新读取</Button>
    </div>
  );
}

type ConfirmView = Pick<ConfirmReq, "title" | "effect" | "confirmLabel" | "statedBrief" | "facts">;

function roleFormConfirmation(isCreate: boolean, detail: A6RoleDetail | null, roleCode: string, roleName: string, remark: string) {
  const clearsRemark = !isCreate && Boolean(detail?.remark) && !remark.trim();
    if (isCreate) {
      return [{ roleCode: roleCode.trim(), roleName: roleName.trim(), remark: remark.trim() || undefined, status: 1 },
        `新建角色 · ${roleName}`,
        <>新建角色 <b>{roleName}</b>（<span data-mono>{roleCode}</span>）。新角色没有任何权限，创建后再编辑权限和菜单。</>,
        {
          title: `新建角色「${roleName.trim()}」`,
          effect: directTag(),
          confirmLabel: "确认新建",
          statedBrief: {
            impact: "确认后立即建好，没有任何权限和菜单。",
            check: "接着改权限和菜单，再到「运营账号与权限」分给账号。标识建好后不能改；用过又删除的标识会恢复原角色并清空旧授权和绑定。",
          },
          facts: <Facts>
            <Fact k="角色标识"><span data-mono>{roleCode.trim()}</span></Fact>
            <Fact k="名称">{roleName.trim()}</Fact>
            <Fact k="备注">{remark.trim() || "—"}</Fact>
            <Fact k="权限和菜单">没有，建好后再授权</Fact>
          </Facts>,
        }] as const;
    } else {
      const nextName = roleName.trim();
      const nextRemark = remark.trim();
      return [buildRoleMetadataPayload(roleName, remark),
        `编辑角色 · ${roleName}`,
        <>修改角色 <b>{roleName}</b>（<span data-mono>{detail?.roleCode}</span>）的名称和备注。</>,
        {
          title: `修改角色「${detail?.roleName ?? nextName}」`,
          effect: <>{directTag()}<StatusTag tone="neutral" icon={Minus}>不改权限和菜单</StatusTag></>,
          confirmLabel: "确认保存",
          statedBrief: {
            impact: "确认后立即保存，只改名称和备注。",
            check: "核对新名称；角色标识不能改。",
          },
          facts: <Facts>
            <Fact k="角色标识"><span data-mono>{detail?.roleCode}</span></Fact>
            <Fact k="名称">{nextName === detail?.roleName ? nextName : <Change from={detail?.roleName ?? "—"} to={nextName} />}</Fact>
            {clearsRemark
              ? <Fact k="备注" tone="warn"><Change from={detail?.remark ?? "—"} to="清空" /></Fact>
              : <Fact k="备注">{nextRemark === (detail?.remark ?? "") ? nextRemark || "—" : <Change from={detail?.remark || "—"} to={nextRemark} />}</Fact>}
          </Facts>,
        }] as const;
    }
}

function RoleFormModal({ mode, detail, onClose, onSubmit }: {
  mode: { kind: "create" } | { kind: "update" };
  detail: A6RoleDetail | null;
  onClose: () => void;
  onSubmit: (payload: A6RoleCreateInput | A6RoleUpdateInput, action: ReactNode, detailNode: ReactNode, view: ConfirmView) => void;
}) {
  const isCreate = mode.kind === "create";
  const [roleCode, setRoleCode] = useState(isCreate ? "" : detail?.roleCode ?? "");
  const [roleName, setRoleName] = useState(isCreate ? "" : detail?.roleName ?? "");
  const [remark, setRemark] = useState(isCreate ? "" : detail?.remark ?? "");
  const [tried, setTried] = useState(false);
  const codeMissing = isCreate && !roleCode.trim();
  const nameMissing = !roleName.trim();
  const dirty = isCreate ? Boolean(roleCode || roleName || remark) : roleName !== (detail?.roleName ?? "") || remark !== (detail?.remark ?? "");
  const clearsRemark = !isCreate && Boolean(detail?.remark) && !remark.trim();

  const submit = () => {
    setTried(true);
    if (isCreate && !roleCode.trim()) return;
    if (!roleName.trim()) return;
    const [payload, action, detailNode, view] = roleFormConfirmation(isCreate, detail, roleCode, roleName, remark);
    onSubmit(payload, action, detailNode, view);
  };

  return (
    <Modal title={isCreate ? "新建角色" : "编辑名称和备注"} icon={isCreate ? Plus : ListTree} sub={isCreate ? directTag() : <>{directTag()}<StatusTag tone="neutral" icon={Minus}>不改权限和菜单</StatusTag></>}
      onClose={onClose} dirty={dirty}
      footer={<><Button variant="secondary" onClick={onClose}>取消</Button><Button variant="primary" onClick={submit}>下一步：确认</Button></>}>
      <Field label="角色标识" required={isCreate} help={isCreate ? "大写字母开头，只用大写字母、数字和下划线，3–64 位。" : "不能修改。"}
        error={tried && codeMissing ? "填写角色标识" : undefined}
        explain={isCreate ? "建好后不能改。不能用 8 个内置角色的标识，也不能和现有角色重复。用过又删除的标识会恢复成原来那个角色，旧的授权和绑定全部清空。" : undefined}>
        {(control) => <Input {...control} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} disabled={!isCreate} placeholder="如 CONTENT_EDITOR" data-mono="" />}
      </Field>
      <Field label="名称" required help="最多 64 字。" error={tried && nameMissing ? "填写名称" : undefined}>
        {(control) => <Input {...control} value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="如 内容编辑员" />}
      </Field>
      <Field label="备注" help={clearsRemark ? "留空保存会清空原备注。" : "最多 255 字。"}>
        {(control) => <Textarea {...control} rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="这个角色负责什么" />}
      </Field>
    </Modal>
  );
}
