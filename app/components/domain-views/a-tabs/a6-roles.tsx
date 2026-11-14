"use client";
import "../a-domain.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, CircleHelp, Clock3, KeyRound, ListTree, Minus, Plus, ShieldCheck, TriangleAlert, UserCog, Users } from "lucide-react";
import {
  fetchA6RolesOverview, fetchA6RoleDetail, createA6Role, updateA6Role, deleteA6Role, proposeA6RoleGrants, proposeA6RoleStatus, newA6IdempotencyKey,
  type A6RoleOverview, type A6RoleDetail, type A6RoleCreateInput, type A6RoleUpdateInput, type A6RoleSummary,
} from "@/lib/admin/a6-client";
import { fetchA7MenusOverview, type A7MenuTreeNode } from "@/lib/admin/a7-client";
import { fetchA8Permissions, type A8Permission } from "@/lib/admin/a8-client";
import { domainOfPermission } from "@/lib/admin/perm-domain";
import { F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { OperationConfirmModal, useToast, type OperatorBriefKind } from "@/app/components/domain-views/design-kit";
import { buildRoleMetadataPayload } from "@/lib/admin/platform-contracts";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import {
  BarList, BlockState, Button, Change, Conclusion, Explain, Fact, Facts, Field, Fold, IconTile, Input, IrreversibleTag, Modal, Notice,
  PageHeader, Panel, RdPage, StatusTag, Textarea,
} from "@/app/components/rd";
import {
  AMPLIFIES_EXPLAIN, GrantsEditorDrawer, MenuChangeList, MismatchNotice, PermChangeList, SENSITIVE_EXPLAIN, flattenMenus, grantMismatch, permLabel, setDiff,
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
};

/** 本页打开期间提交成功的审批单。只记回执，批准、驳回后这里不会自己变，最新状态在「操作记录与审批」。 */
type Submitted = {
  ticket: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  label: string;
  change: string;
  at: number;
  /** 改授权时提交的完整两组，用来和之后读到的详情比，看实际存下了什么（A6-PD01）。 */
  desired?: { permissionCodes: string[]; menuIds: number[] };
};

/**
 * 结果未知、按原请求重试这一类原操作的位置（R1）。现在的逻辑在提交失败时只报错、不保存原请求，
 * 进不了这个状态；代码 worker 接上保存和恢复后，把行传进这里。按钮叫「查询原结果」「按原请求重试」。
 */
type UnknownRow = { key: string; name: string; change: string; submittedAt: number; actions: ReactNode };
const UNKNOWN_ROWS: UnknownRow[] = [];

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
const approvalTag = (note: string, extra?: string) => (
  <StatusTag tone="progress" filled explain={`提交到「操作记录与审批」，另一位管理员批准后执行。${note}${extra ?? ""}`}>批准后生效</StatusTag>
);
const directTag = () => <StatusTag tone="progress" filled explain="填写理由并确认后立即生效，保留操作记录。">立即生效</StatusTag>;
const approverFact = (authority: string) => <Fact k="批准人">另一位管理员，需有批准审批单的权限和{authority}</Fact>;
const roleFact = (name: string, code: string) => <Fact k="角色">{name} <span className="a6-code" data-mono>{code}</span></Fact>;

export default function A6Roles() {
  const [, setToast] = useToast();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const role = useAdminAuth((s) => s.session?.role ?? s.role);
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const isSuper = role === "super" || role === "superadmin";
  const canWrite = isSuper || authorities.includes("platform_a6_write");
  const canGrant = isSuper || authorities.includes("platform_a6_role_grants_update");
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
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [submitted, setSubmitted] = useState<Submitted[]>([]);
  const reach = useReach();

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setOverview(await fetchA6RolesOverview()); }
    catch (e) {
      const message = displayAdminError(e);
      setOverview(null);
      setLoadError(message);
      setToast(message);
    }
    finally { setLoading(false); }
  }, [setToast]);

  useEffect(() => {
    void refreshOverview();
    setCatalogFailed(null);
    if (!canGrant) {
      setMenuTree([]);
      setAllPerms([]);
      setMenuCatalogReady(false);
      setPermissionCatalogReady(false);
      return;
    }
    void fetchA7MenusOverview()
      .then((o) => { setMenuTree(o.tree); setMenuCatalogReady(true); })
      .catch((error) => { setCatalogFailed("菜单列表没读到，暂时不能改授权；刷新页面再试"); setToast(`菜单列表加载失败，暂时不能编辑授权：${displayAdminError(error)}`); });
    // A8 分页有上限(pageSize 被后端收口),多页拉全权限全集供 GrantsEditor 分组(避免缺域/缺权限)
    void (async () => {
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
      } catch (error) {
        setCatalogFailed("权限列表没读到，暂时不能改授权；刷新页面再试");
        setToast(`权限列表加载失败，暂时不能编辑授权：${displayAdminError(error)}`);
      }
    })();
  }, [canGrant, refreshOverview, setToast]);

  useEffect(() => {
    let active = true;
    setDetail(null);
    setDetailError(null);
    if (selectedId == null) return;
    fetchA6RoleDetail(selectedId)
      .then((result) => { if (active) setDetail(result); })
      .catch((e) => { if (active) setDetailError(displayAdminError(e)); });
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
  const remember = (entry: Submitted) => setSubmitted((rows) => [entry, ...rows]);

  const openStatus = (d: A6RoleDetail) => {
    const nextStatus = d.status === 1 ? 0 : 1;
    const actionLabel = nextStatus === 1 ? "启用" : "停用";
    const stableKey = newA6IdempotencyKey("a6-role-status");
    const bound = summary?.adminCount;
    setConfirmReq({ briefKind: "security",
      action: `${actionLabel}角色 · ${d.roleName}`,
      title: `${actionLabel}角色「${d.roleName}」`,
      detail: <>{actionLabel}角色 <b>{d.roleName}</b>（<span data-mono>{d.roleCode}</span>）。</>,
      effect: approvalTag(nextStatus === 0 ? "批准前角色照常生效。" : "批准前角色保持停用。"),
      confirmLabel: `提交${actionLabel}审批`,
      statedBrief: nextStatus === 0
        ? { impact: bound === 0
              ? "现在没有账号绑定它。批准后角色停用，之后分到它的账号也拿不到它的权限；授权保留，重新启用后恢复。"
              : `批准后，这个角色带来的权限和菜单对绑定它的${bound === undefined ? "" : ` ${bound} 个`}账号不再生效；绑定和授权都保留，重新启用后恢复。账号从其他角色得到的权限不受影响，已登录的不会被退出。`,
            check: "绑定账号数是现在读到的，批准时按当时实际绑定的账号执行。" }
        : { impact: `批准后，绑定它的${bound === undefined ? "" : ` ${bound} 个`}账号重新得到这个角色的权限；左侧菜单要等账号重新读取登录信息后才更新。`,
            check: "启用前核对这个角色现在存着的权限和菜单。" },
      facts: <Facts>
        <Fact k="绑定账号" lead unit="个">{bound ?? "—"}</Fact>
        {roleFact(d.roleName, d.roleCode)}
        <Fact k="状态"><Change from={d.status === 1 ? "已启用" : "已停用"} to={nextStatus === 1 ? "已启用" : "已停用"} /></Fact>
        {approverFact("角色管理的修改权限")}
      </Facts>,
      run: async (reason) => {
        try {
          const ticket = await proposeA6RoleStatus(d.id, nextStatus, reason, operator, stableKey);
          remember({ ticket: ticket.id, roleId: d.id, roleCode: d.roleCode, roleName: d.roleName, label: `${actionLabel}角色`, change: `${d.status === 1 ? "已启用" : "已停用"} → ${nextStatus === 1 ? "已启用" : "已停用"}`, at: Date.now() });
          setToast(`已提交${actionLabel}审批，等另一位管理员批准 · 审批单 ${ticket.id}`, "success");
          return ticket;
        } catch (error) {
          setToast(displayAdminError(error));
          throw error;
        }
      },
    });
  };

  const openDelete = (d: A6RoleDetail) => {
    const stableKey = newA6IdempotencyKey("a6-role-delete");
    const bound = roles.find((x) => x.id === d.id)?.adminCount ?? 0;
    setConfirmReq({ briefKind: "security",
      action: `删除角色 · ${d.roleName}`,
      title: `删除角色「${d.roleName}」`,
      detail: <>删除角色 <b>{d.roleName}</b>（<span data-mono>{d.roleCode}</span>）。</>,
      effect: <>{approvalTag("批准前角色和绑定都不变。")}<IrreversibleTag>批准后不能撤销</IrreversibleTag></>,
      confirmLabel: "提交删除审批",
      confirmTone: "danger",
      statedBrief: {
        impact: bound > 0
          ? `批准后，${bound} 个账号和这个角色解绑，失去它带来的权限和菜单；角色的授权清空，从列表里消失。账号本身、其他角色和历史记录不删。`
          : "现在没有账号绑定它。批准后角色的授权清空，从列表里消失；历史记录不删。",
        check: "绑定账号数是现在读到的，批准时按当时实际绑定执行。以后用同一个标识新建，得到的是一个没有任何权限的角色。",
      },
      facts: <Facts>
        <Fact k="会解绑的账号" lead unit="个" tone={bound > 0 ? "warn" : undefined}>{bound}</Fact>
        {roleFact(d.roleName, d.roleCode)}
        <Fact k="会清空的授权">权限 {d.permissionCodes.length} 项 · 菜单 {d.menuIds.length} 个</Fact>
        {approverFact("角色管理的修改权限")}
      </Facts>,
      run: async (reason) => {
        try {
          const ticket = await deleteA6Role(d.id, reason, operator, stableKey);
          remember({ ticket: ticket.id, roleId: d.id, roleCode: d.roleCode, roleName: d.roleName, label: "删除角色", change: `解绑 ${bound} 个账号`, at: Date.now() });
          setToast(`已提交删除审批，等另一位管理员批准 · 审批单 ${ticket.id}`, "success");
          return ticket;
        } catch (error) {
          setToast(displayAdminError(error));
          throw error;
        }
      },
    });
  };

  const header = (
    <PageHeader pageId="A6" title="角色管理" summary="设置每个角色能做的操作和能看的菜单。"
      actions={canWrite ? <Button variant="primary" onClick={() => setFormMode({ kind: "create" })}><Plus size={14} aria-hidden />新建角色</Button> : undefined}
      readOnly={!canWrite && !canGrant ? "只读：可以查看角色和授权，不能修改"
        : !canWrite ? "只能改权限和菜单；新建、改名称、启停和删除要角色管理的修改权限" : undefined} />
  );

  const conclusion = loading ? (
    <Conclusion state="neutral" icon={Clock3}>正在加载角色…</Conclusion>
  ) : loadError ? (
    <Conclusion state="danger" icon={TriangleAlert} hint="点角色目录里的「重试」再读一次。">角色列表没读到，这部分没有判断</Conclusion>
  ) : tempRoles.length > 0 ? (
    <Conclusion state="warn" icon={TriangleAlert} hint="确认没人用后删除，删除要另一位管理员批准。"
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

  const mySubmitted = submitted.filter((row) => row.roleId === selectedId);

  return (
    <RdPage className="adom a6-page">
      {header}
      {conclusion}

      {UNKNOWN_ROWS.length > 0 && (
        <Notice tone="warn" title="有原操作结果未知">
          <ul className="a6-recovery" aria-label="结果未知的原操作">
            {UNKNOWN_ROWS.map((row) => (
              <li key={row.key}>
                <span className="a6-recovery-name">{row.name}</span>
                <span className="a6-recovery-change">{row.change}</span>
                <span className="a6-recovery-time">{businessStamp(row.submittedAt)} 提交</span>
                <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效或已经建了审批单。24 小时内可以按原请求重试，后端认得出是同一次提交，不会重复执行。">结果未知</StatusTag>
                <span className="a6-recovery-actions">{row.actions}</span>
              </li>
            ))}
          </ul>
          <p className="a6-zone">提交时间为{businessZone().label}</p>
        </Notice>
      )}

      <div className="a6-layout">
        <div className="a6-main">
          <Panel title="角色目录" icon={Users} tone="role-3" sub={overview ? `${roles.length} 个` : undefined}
            explain="点一个角色，在右边看它能做什么、能看哪些菜单、有多少账号在用。">
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
                <p className="a6-muted">点左边一个角色，看它能做的操作、能看的菜单和在用的账号。</p>
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
                catalogsReady={catalogsReady} catalogFailed={catalogFailed} permByCode={permByCode} menuById={menuById}
                submitted={mySubmitted} reach={reach} onRetry={() => setDetailRetry((value) => value + 1)}
                onEdit={() => setFormMode({ kind: "update" })}
                onGrants={() => setGrantsOpen(true)}
                onStatus={() => openStatus(detail)}
                onDelete={() => openDelete(detail)}
                onBuiltinDelete={() => setToast("内置角色不可删除")} />
            )}
          </div>
        </div>
      </div>

      {formMode && (
        <RoleFormModal mode={formMode} detail={detail} onClose={() => setFormMode(null)}
          onSubmit={(payload, action, detailNode, confirmView) => {
            setFormMode(null);
            const stableKey = newA6IdempotencyKey(formMode.kind === "create" ? "a6-role-create" : "a6-role-update");
            setConfirmReq({ briefKind: "config",
              action, detail: detailNode, ...confirmView,
              run: async (reason) => {
                try {
                  if (formMode.kind === "create") {
                    const created = await createA6Role(payload as A6RoleCreateInput, reason, operator, stableKey);
                    setDetail(created);
                    await refreshOverview();
                    setSelectedId(created.id);
                    setToast("角色已创建，还没有任何权限");
                    return created;
                  }
                  const updated = await updateA6Role(detail!.id, payload as A6RoleUpdateInput, reason, operator, stableKey);
                  setDetail(updated);
                  await refreshOverview();
                  setSelectedId(updated.id);
                  setToast("已保存");
                  return updated;
                } catch (error) {
                  setToast(displayAdminError(error));
                  throw error;
                }
              },
            });
          }} />
      )}

      {grantsOpen && detail && (
        <GrantsEditorDrawer detail={detail} menuTree={menuTree} allPerms={allPerms} onClose={() => setGrantsOpen(false)}
          onSubmit={(payload, permBefore, menuBefore) => {
            setGrantsOpen(false);
            const stableKey = newA6IdempotencyKey("a6-role-grants");
            const bound = summary?.adminCount;
            const permDiff = setDiff(detail.permissionCodes, payload.permissionCodes);
            const menuDiff = setDiff(detail.menuIds, payload.menuIds);
            const addedSensitive = permDiff.added.filter((code) => permByCode.get(code)?.permType === "HIGH").length;
            const addedAmplifies = permDiff.added.filter((code) => permByCode.get(code)?.amplifies === 1).length;
            const nothing = permDiff.added.length + permDiff.removed.length + menuDiff.added.length + menuDiff.removed.length === 0;
            const mismatch = grantMismatch(payload.permissionCodes, payload.menuIds, permByCode, menuById);
            setConfirmReq({ briefKind: "security",
              action: `改角色授权 · ${detail.roleName}`,
              title: `改「${detail.roleName}」的权限和菜单`,
              detail: <>改角色 <b>{detail.roleName}</b>（<span data-mono>{detail.roleCode}</span>）的权限和菜单：权限 {permBefore}→{payload.permissionCodes.length} · 菜单 {menuBefore}→{payload.menuIds.length}。</>,
              effect: approvalTag("批准前这个角色的权限和菜单都不变。"),
              confirmLabel: "提交授权审批",
              statedBrief: {
                impact: `批准后整组替换：绑定这个角色的${bound === undefined ? "" : ` ${bound} 个`}账号按新的权限和菜单使用，左侧菜单要等账号重新读取登录信息后才更新。它们从其他角色得到的权限不受影响。`,
                check: "核对加了和去掉的权限，特别是敏感操作和可能多付钱的。",
              },
              facts: <Facts>
                <Fact k="会受影响的账号" lead unit="个">{bound ?? "—"}</Fact>
                {roleFact(detail.roleName, detail.roleCode)}
                <Fact k="权限"><Change from={`${permBefore} 项`} to={`${payload.permissionCodes.length} 项`} /></Fact>
                <Fact k="菜单"><Change from={`${menuBefore} 个`} to={`${payload.menuIds.length} 个`} /></Fact>
                {detail.status === 0 && <Fact k="角色状态" tone="warn">已停用：批准后也不生效，启用后才生效</Fact>}
                {approverFact("改角色授权的权限")}
              </Facts>,
              content: (
                <div className="a6-diff">
                  {addedSensitive > 0 && (
                    <Notice tone="warn" title={`加了 ${addedSensitive} 项敏感操作${addedAmplifies ? `，其中 ${addedAmplifies} 项可能多付钱` : ""}`}>
                      <p>拿到这些权限的账号可以做风险更高的修改。<Explain label="敏感操作" content={<><p>{SENSITIVE_EXPLAIN}</p><p>{AMPLIFIES_EXPLAIN}</p></>} /></p>
                    </Notice>
                  )}
                  {detail.status === 0 && permDiff.added.length > 0 && (
                    <Notice tone="warn" title="这个角色已停用">
                      <p>给停用的角色加它从没有过的权限，批准后可能存不上，审批却显示成功（已提后端修）。批准后回到这页，详情里会对比实际存下的权限。</p>
                    </Notice>
                  )}
                  {detail.roleCode === "SUPER_ADMIN" && (
                    <Notice tone="danger" title="超级管理员角色的授权不能修改"><p>后端会拒绝这次提交。</p></Notice>
                  )}
                  {nothing && <Notice tone="neutral" title="权限和菜单都没有改动"><p>照样会建一张审批单，批准后内容不变。</p></Notice>}
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
              run: async (reason) => {
                try {
                  const ticket = await proposeA6RoleGrants(detail.id, payload, reason, operator, stableKey);
                  remember({ ticket: ticket.id, roleId: detail.id, roleCode: detail.roleCode, roleName: detail.roleName, label: "改权限和菜单",
                    change: `权限 ${permBefore} → ${payload.permissionCodes.length} 项 · 菜单 ${menuBefore} → ${payload.menuIds.length} 个`, at: Date.now(),
                    desired: { permissionCodes: [...payload.permissionCodes], menuIds: [...payload.menuIds] } });
                  setToast(`已提交权限修改审批，等另一位管理员批准 · 审批单 ${ticket.id}`, "success");
                  return ticket;
                } catch (error) {
                  setToast(displayAdminError(error));
                  throw error;
                }
              },
            });
          }} />
      )}

      {confirmReq && (
        <OperationConfirmModal briefKind={confirmReq.briefKind}
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
                      <span className="a6-role-code" data-mono>{r.roleCode}</span>
                      {r.status !== 1 && <StatusTag tone="neutral" icon={Ban}>已停用</StatusTag>}
                      {/* 自动验收残留的临时角色必须与真实角色目录可区分(zentao #101)。 */}
                      {temp && <StatusTag tone="warn" icon={TriangleAlert}>测试用 · 建议删除</StatusTag>}
                    </span>
                    {desc && <span className="a6-role-desc">{desc}</span>}
                  </span>
                  <span className="a6-role-count" data-empty={r.adminCount === 0 ? "" : undefined}>
                    <b>{r.adminCount}</b><small>个账号</small>
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

function RoleDetail({ detail, summary, canWrite, canGrant, catalogsReady, catalogFailed, permByCode, menuById, submitted, reach, onRetry, onEdit, onGrants, onStatus, onDelete, onBuiltinDelete }: {
  detail: A6RoleDetail;
  summary: A6RoleSummary | null;
  canWrite: boolean;
  canGrant: boolean;
  catalogsReady: boolean;
  catalogFailed: string | null;
  permByCode: ReadonlyMap<string, A8Permission>;
  menuById: ReadonlyMap<number, A7MenuTreeNode>;
  submitted: Submitted[];
  reach: (href: string) => boolean;
  onRetry: () => void;
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
  const grantReason = !catalogsReady ? (catalogFailed ?? "菜单或权限列表还没加载完") : undefined;
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
          </div>
          <div>
            <dt>能做的操作<Explain label="能做的操作" content={<><p>这个角色存着的、启用中的接口权限数。</p><p>{SENSITIVE_EXPLAIN}</p></>} /></dt>
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

        {submitted.length > 0 && (
          <Notice tone="progress" title="本次打开页面后提交的审批">
            <ul className="a6-recovery" aria-label="已提交的审批">
              {submitted.map((row) => (
                <li key={row.ticket}>
                  <span className="a6-recovery-name">{row.label}</span>
                  <span className="a6-recovery-change">{row.change}</span>
                  <span className="a6-recovery-time">{businessStamp(row.at)} 提交</span>
                  <StatusTag tone="warn" icon={Clock3} explain="这是提交时的回执，批准或驳回后这里不会自己更新。最新状态在「操作记录与审批」。">已提交审批</StatusTag>
                  <span className="a6-recovery-actions">
                    {reach("/platform/audit") && <Link className="rd-link" href={`/platform/audit?domain=A&object=${encodeURIComponent(row.roleCode)}`}>看审批单 <span data-mono>{row.ticket}</span></Link>}
                  </span>
                  {row.desired && <SavedCheck desired={row.desired} detail={detail} permByCode={permByCode} onRetry={onRetry} />}
                </li>
              ))}
            </ul>
            <p className="a6-zone">提交时间为{businessZone().label}</p>
          </Notice>
        )}

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
                  <Button variant="secondary" onClick={onEdit}>编辑名称和备注</Button>
                </div>
              </div>
            )}
            <div className="a6-action-group">
              <span className="a6-action-cap">要另一位管理员批准</span>
              <div className="a6-action-row">
                {canGrant && <Button variant="primary" disabledReason={grantReason} onClick={onGrants}>改权限和菜单</Button>}
                {canWrite && <Button variant="secondary" disabledReason={isSuperRole ? "超级管理员角色不能停用" : undefined} onClick={onStatus}>{detail.status === 1 ? "停用" : "启用"}</Button>}
                {canWrite && <Button variant="danger-outline" disabledReason={detail.builtin ? "内置角色不能删除" : undefined} onBlockedClick={detail.builtin ? onBuiltinDelete : undefined} onClick={onDelete}>删除</Button>}
              </div>
            </div>
            {isSuperRole && <p className="a6-note"><TriangleAlert size={14} aria-hidden />超级管理员角色不能停用、不能删除，改权限和菜单会被后端拒绝。</p>}
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
function SavedCheck({ desired, detail, permByCode, onRetry }: { desired: { permissionCodes: string[]; menuIds: number[] }; detail: A6RoleDetail; permByCode: ReadonlyMap<string, A8Permission>; onRetry: () => void }) {
  const missing = desired.permissionCodes.filter((code) => !detail.permissionCodes.includes(code));
  const extra = detail.permissionCodes.filter((code) => !desired.permissionCodes.includes(code));
  const menuSame = setDiff(desired.menuIds, detail.menuIds);
  const same = missing.length === 0 && extra.length === 0 && menuSame.added.length === 0 && menuSame.removed.length === 0;
  return (
    <div className="a6-saved">
      {same ? <span>现在存着的权限和菜单和提交的一致</span> : (
        <Fold inset title="现在存着的和提交的不一样" alert summary={`提交的权限里有 ${missing.length} 项现在没有${extra.length ? `，多出 ${extra.length} 项` : ""}；审批还没批准时也会这样`}>
          {missing.length > 0 && <><p className="a6-muted">提交了、现在没有的权限{detail.status === 0 ? "（角色已停用时，新加的权限可能没存上）" : ""}：</p><PermChangeList codes={missing} permByCode={permByCode} kind="remove" limit={20} /></>}
          {missing.length === 0 && <p className="a6-muted">提交的权限都在；菜单或多出的权限有差别。</p>}
          <p className="a6-muted">提交的权限：{desired.permissionCodes.slice(0, 3).map((code) => permLabel(code, permByCode.get(code))).join("、")}{desired.permissionCodes.length > 3 ? ` 等 ${desired.permissionCodes.length} 项` : ""}</p>
        </Fold>
      )}
      <Button variant="ghost" onClick={onRetry}>重新读取</Button>
    </div>
  );
}

type ConfirmView = Pick<ConfirmReq, "title" | "effect" | "confirmLabel" | "statedBrief" | "facts">;

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
    if (isCreate) {
      onSubmit({ roleCode: roleCode.trim(), roleName: roleName.trim(), remark: remark.trim() || undefined, status: 1 },
        `新建角色 · ${roleName}`,
        <>新建角色 <b>{roleName}</b>（<span data-mono>{roleCode}</span>）。新角色没有任何权限，创建后再编辑权限和菜单。</>,
        {
          title: `新建角色「${roleName.trim()}」`,
          effect: directTag(),
          confirmLabel: "确认新建",
          statedBrief: {
            impact: "确认后立即建好；新角色没有任何权限和菜单，也没有绑定账号。接着给它改权限和菜单，再到「运营账号与权限」把账号分给它。",
            check: "标识建好后不能改。用过又删除的标识会恢复成原来那个角色，旧的授权和绑定全部清空。",
          },
          facts: <Facts>
            <Fact k="角色标识"><span data-mono>{roleCode.trim()}</span></Fact>
            <Fact k="名称">{roleName.trim()}</Fact>
            <Fact k="备注">{remark.trim() || "—"}</Fact>
            <Fact k="权限和菜单">没有，建好后再授权</Fact>
          </Facts>,
        });
    } else {
      const nextName = roleName.trim();
      const nextRemark = remark.trim();
      onSubmit(buildRoleMetadataPayload(roleName, remark),
        `编辑角色 · ${roleName}`,
        <>修改角色 <b>{roleName}</b>（<span data-mono>{detail?.roleCode}</span>）的名称和备注。</>,
        {
          title: `修改角色「${detail?.roleName ?? nextName}」`,
          effect: <>{directTag()}<StatusTag tone="neutral" icon={Minus}>不改权限和菜单</StatusTag></>,
          confirmLabel: "确认保存",
          statedBrief: {
            impact: "确认后立即保存，只改名称和备注；权限、菜单和绑定的账号都不变。",
            check: "核对新名称；角色标识不能改。",
          },
          facts: <Facts>
            <Fact k="角色标识"><span data-mono>{detail?.roleCode}</span></Fact>
            <Fact k="名称">{nextName === detail?.roleName ? nextName : <Change from={detail?.roleName ?? "—"} to={nextName} />}</Fact>
            {clearsRemark
              ? <Fact k="备注" tone="warn">留空不会清掉原备注「{detail?.remark}」</Fact>
              : <Fact k="备注">{nextRemark === (detail?.remark ?? "") ? nextRemark || "—" : <Change from={detail?.remark || "—"} to={nextRemark} />}</Fact>}
          </Facts>,
        });
    }
  };

  return (
    <Modal title={isCreate ? "新建角色" : "编辑名称和备注"} icon={isCreate ? Plus : ListTree} sub={isCreate ? directTag() : <>{directTag()}<StatusTag tone="neutral" icon={Minus}>不改权限和菜单</StatusTag></>}
      onClose={onClose} dirty={dirty}
      footer={<><Button variant="secondary" onClick={onClose}>取消</Button><Button variant="primary" onClick={submit}>下一步：确认</Button></>}>
      <Field label="角色标识" required={isCreate} hint={isCreate ? "大写字母开头，只用大写字母、数字和下划线，3–64 位" : "不能修改"}
        error={tried && codeMissing ? "填写角色标识" : undefined}
        explain={isCreate ? "建好后不能改。不能用 8 个内置角色的标识，也不能和现有角色重复。用过又删除的标识会恢复成原来那个角色，旧的授权和绑定全部清空。" : undefined}>
        {(control) => <Input {...control} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} disabled={!isCreate} placeholder="如 CONTENT_EDITOR" data-mono="" />}
      </Field>
      <Field label="名称" required hint="最多 64 字" error={tried && nameMissing ? "填写名称" : undefined}>
        {(control) => <Input {...control} value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="如 内容编辑员" />}
      </Field>
      <Field label="备注" hint="最多 255 字" help={clearsRemark ? "清空备注现在保存不了：留空时会保留原备注（已登记待修）。" : undefined}>
        {(control) => <Textarea {...control} rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="这个角色负责什么" />}
      </Field>
      {isCreate && <Notice tone="neutral" title="新角色没有任何权限"><p>建好后在详情里点「改权限和菜单」授权，再到「运营账号与权限」把账号分给它。</p></Notice>}
    </Modal>
  );
}
