"use client";
import "../a-domain.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchA6RolesOverview, fetchA6RoleDetail, createA6Role, updateA6Role, deleteA6Role, proposeA6RoleGrants, proposeA6RoleStatus, newA6IdempotencyKey,
  type A6RoleOverview, type A6RoleDetail, type A6RoleCreateInput, type A6RoleUpdateInput, type A6GrantsPayload,
} from "@/lib/admin/a6-client";
import { fetchA7MenusOverview, type A7MenuTreeNode } from "@/lib/admin/a7-client";
import { fetchA8Permissions, type A8Permission } from "@/lib/admin/a8-client";
import { groupPermissionsByDomain, type PermDomainGroup } from "@/lib/admin/perm-domain";
import { CONSOLE_NAV } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Card, CardH, CodeTag, Badge, Btn, Drawer, OperationConfirmModal, useToast } from "@/app/components/domain-views/design-kit";
import { DomainHeader } from "../domain-header";
import { buildRoleMetadataPayload } from "@/lib/admin/platform-contracts";

type ConfirmReq = { action: React.ReactNode; detail: React.ReactNode; completionCopy?: string; run: (reason: string) => Promise<unknown> };

/** 域代号 → 域色 var(用于菜单树节点圆点)。 */
const DOMAIN_ACCENT: Record<string, string> = Object.fromEntries(CONSOLE_NAV.map((d) => [d.code, `var(${d.accentVar})`]));

/** A6 角色管理（经典 RBAC 核心配置面）。旗舰外壳 + 左列表右详情 + 双绑定编辑（grants:Drawer→OperationConfirmModal→PUT）。 */
export default function A6Roles() {
  const [toast, setToast] = useToast();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const role = useAdminAuth((s) => s.session?.role ?? s.role);
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const isSuper = role === "super" || role === "superadmin";
  const canWrite = isSuper || authorities.includes("platform_a6_write");
  const canGrant = isSuper || authorities.includes("platform_a6_role_grants_update");
  const [overview, setOverview] = useState<A6RoleOverview | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<A6RoleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuTree, setMenuTree] = useState<A7MenuTreeNode[]>([]);
  const [allPerms, setAllPerms] = useState<A8Permission[]>([]);
  const [menuCatalogReady, setMenuCatalogReady] = useState(false);
  const [permissionCatalogReady, setPermissionCatalogReady] = useState(false);
  const [formMode, setFormMode] = useState<{ kind: "create" } | { kind: "update" } | null>(null);
  const [grantsOpen, setGrantsOpen] = useState(false);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);

  const refreshOverview = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try { setOverview(await fetchA6RolesOverview()); }
    catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOverview(null);
      setLoadError(message);
      setToast(message);
    }
    finally { setLoading(false); }
  }, [setToast]);

  useEffect(() => {
    void refreshOverview();
    if (!canGrant) {
      setMenuTree([]);
      setAllPerms([]);
      setMenuCatalogReady(false);
      setPermissionCatalogReady(false);
      return;
    }
    void fetchA7MenusOverview()
      .then((o) => { setMenuTree(o.tree); setMenuCatalogReady(true); })
      .catch((error) => setToast(`菜单目录加载失败，授权编辑已锁定：${error instanceof Error ? error.message : String(error)}`));
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
        setToast(`权限目录加载失败，授权编辑已锁定：${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, [canGrant, refreshOverview, setToast]);

  useEffect(() => {
    if (selectedId == null) { setDetail(null); return; }
    fetchA6RoleDetail(selectedId)
      .then(setDetail)
      .catch((e) => setToast(e instanceof Error ? e.message : String(e)));
  }, [selectedId, setToast]);

  const roles = overview?.roles ?? [];

  return (
    <div className="dkpage adom">
      <DomainHeader domainCode="A" domainName="平台基础" accentVar="--admin-domain-a"
        l2Id="A6" l2Name="角色管理"
        summary="数据库角色授权唯一真源：权限码控制操作权，菜单绑定控制侧栏、路由守卫与命令面板可见性。HIGH 变更统一进入 A2 待确认队列。"
        right={canWrite ? <Btn variant="primary" sm onClick={() => setFormMode({ kind: "create" })}>+ 新建角色</Btn> : <Badge tone="neutral">只读</Badge>} />

      <div className="two-col" style={{ alignItems: "flex-start" }}>
        <Card>
          <CardH title="角色" sub={`${roles.length} 个（8 内置 + 自定义）`} />
          {loading ? <div style={{ padding: 24, color: "var(--ink-3)" }}>加载中…</div> : loadError ? (
            <div className="alertbar warn" role="alert" style={{ margin: 16 }}>
              角色目录加载失败，当前数据不可确认。<Btn sm onClick={() => void refreshOverview()}>重试</Btn>
            </div>
          ) : (
            <div style={{ padding: "4px 8px" }}>
              {roles.map((r) => (
                <div key={r.id} onClick={() => setSelectedId(r.id)}
                  style={{ padding: "10px 12px", cursor: "pointer", background: selectedId === r.id ? "var(--surface-2)" : "transparent", borderRadius: 8, marginBottom: 4, border: "1px solid var(--border)" }}>
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{r.roleName || r.roleCode}</span>
                    {r.builtin && <Badge tone="neutral">内置</Badge>}
                    <Badge tone={r.status === 1 ? "ok" : "dim"}>{r.status === 1 ? "启用" : "停用"}</Badge>
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{r.adminCount} 账号</span>
                  </div>
                  {(ROLE_DESC[r.roleCode]?.desc || r.remark) && (
                    <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 3, lineHeight: 1.4 }}>{ROLE_DESC[r.roleCode]?.desc || r.remark}</div>
                  )}
                  <CodeTag><span className="mono" style={{ fontSize: 11 }}>{r.roleCode}</span></CodeTag>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardH title="角色详情" sub={detail ? `权限 ${detail.permissionCodes.length} · 菜单 ${detail.menuIds.length}` : "选择左侧角色"} />
          {!detail ? (
            <div style={{ padding: 24, color: "var(--ink-3)", textAlign: "center" }}>选择一个角色查看详情</div>
          ) : (
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
              <Row label="角色 code"><span className="mono">{detail.roleCode}</span></Row>
              <Row label="名称">{detail.roleName}</Row>
              {ROLE_DESC[detail.roleCode] && <Row label="职责说明">{ROLE_DESC[detail.roleCode].desc}（可访问:{ROLE_DESC[detail.roleCode].scope}）</Row>}
              <Row label="备注">{detail.remark || "—"}</Row>
              <Row label="状态"><Badge tone={detail.status === 1 ? "ok" : "dim"}>{detail.status === 1 ? "启用" : "停用"}</Badge></Row>
              <Row label="已绑权限">{detail.permissionCodes.length} 个权限码</Row>
              <Row label="可见菜单">{detail.menuIds.length} 个菜单</Row>
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {canWrite && <Btn sm onClick={() => setFormMode({ kind: "update" })}>编辑基本信息</Btn>}
                {canWrite && <Btn sm disabled={detail.roleCode === "SUPER_ADMIN"} onClick={() => {
                  const nextStatus = detail.status === 1 ? 0 : 1;
                  const actionLabel = nextStatus === 1 ? "启用" : "停用";
                  const stableKey = newA6IdempotencyKey("a6-role-status");
                  setConfirmReq({
                    action: `${actionLabel}角色 · ${detail.roleName}`,
                    completionCopy: "本次只创建 A2 待确认票；由具备对应 A6 权限的操作者确认后才执行。",
                    detail: <>{actionLabel}角色 <b>{detail.roleName}</b>（<span className="mono">{detail.roleCode}</span>）只提交 A2 单人确认，具备执行权限的操作者确认后才改变状态和恢复/失效对应权限。</>,
                    run: async (reason) => {
                      try {
                        const ticket = await proposeA6RoleStatus(detail.id, nextStatus, reason, operator, stableKey);
                        setToast(`角色${actionLabel}已提交 A2 单人确认 · ${ticket.id}`);
                        return ticket;
                      } catch (error) {
                        setToast(error instanceof Error ? error.message : String(error));
                        throw error;
                      }
                    },
                  });
                }}>{detail.status === 1 ? "停用角色" : "启用角色"}</Btn>}
                {canGrant && <Btn
                  sm
                  variant="primary"
                  disabled={!menuCatalogReady || !permissionCatalogReady}
                  title={!menuCatalogReady || !permissionCatalogReady ? "菜单/权限目录尚未完整加载" : undefined}
                  onClick={() => setGrantsOpen(true)}
                >编辑授权（权限/菜单）</Btn>}
                {canWrite && <Btn sm onClick={() => {
                  if (detail.builtin) { setToast("内置角色不可删除"); return; }
                  const stableKey = newA6IdempotencyKey("a6-role-delete");
                  setConfirmReq({
                    action: `删除角色 · ${detail.roleName}`,
                    completionCopy: "本次只创建 A2 待确认票；确认执行前角色和账号权限不会变化。",
                    detail: <>删除角色 <b>{detail.roleName}</b>（<span className="mono">{detail.roleCode}</span>）。提交后仅创建 A2 单人确认票；具备执行权限的操作者确认后，该角色下 {roles.find((x) => x.id === detail.id)?.adminCount ?? 0} 个账号才会失去此角色，并停用对应菜单和权限绑定。</>,
                    run: async (reason) => {
                      try {
                        const ticket = await deleteA6Role(detail.id, reason, operator, stableKey);
                        setToast(`已提交 A2 单人确认 · ${ticket.id}`);
                        return ticket;
                      } catch (error) {
                        setToast(error instanceof Error ? error.message : String(error));
                        throw error;
                      }
                    },
                  });
                }}>删除角色</Btn>}
              </div>
            </div>
          )}
        </Card>
      </div>

      {formMode && (
        <RoleFormDrawer mode={formMode} detail={detail} onClose={() => setFormMode(null)}
          onSubmit={(payload, action, detailNode) => {
            setFormMode(null);
            const stableKey = newA6IdempotencyKey(formMode.kind === "create" ? "a6-role-create" : "a6-role-update");
            setConfirmReq({
              action, detail: detailNode,
              run: async (reason) => {
                try {
                  if (formMode.kind === "create") {
                    const created = await createA6Role(payload as A6RoleCreateInput, reason, operator, stableKey);
                    setDetail(created);
                    await refreshOverview();
                    setSelectedId(created.id);
                    setToast("空角色已创建 · 后端留痕");
                    return created;
                  }
                  const updated = await updateA6Role(detail!.id, payload as A6RoleUpdateInput, reason, operator, stableKey);
                  setDetail(updated);
                  await refreshOverview();
                  setSelectedId(updated.id);
                  setToast("角色名称/备注已保存 · 后端留痕");
                  return updated;
                } catch (error) {
                  setToast(error instanceof Error ? error.message : String(error));
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
            setConfirmReq({
               action: `改角色授权 · ${detail.roleName}`,
               completionCopy: "本次只创建 A2 待确认票；确认执行后才同步角色白名单并失效权限缓存。",
               detail: <>改角色 <b>{detail.roleName}</b>（<span className="mono">{detail.roleCode}</span>）的权限/菜单绑定。权限 {permBefore}→{payload.permissionCodes.length} · 菜单 {menuBefore}→{payload.menuIds.length}。该 HIGH 操作只提交 A2 待确认票，具备执行权限的操作者确认后才由服务器同步白名单并失效缓存。</>,
               run: async (reason) => {
                 try {
                   const ticket = await proposeA6RoleGrants(detail.id, payload, reason, operator, stableKey);
                   setToast(`授权变更已提交 A2 单人确认 · ${ticket.id}`);
                   return ticket;
                 } catch (error) {
                   setToast(error instanceof Error ? error.message : String(error));
                   throw error;
                 }
               },
            });
          }} />
      )}

      {confirmReq && (
        <OperationConfirmModal
          action={confirmReq.action} detail={confirmReq.detail} completionCopy={confirmReq.completionCopy}
          onClose={() => setConfirmReq(null)}
          onConfirm={async (reason) => { await confirmReq.run(reason); setConfirmReq(null); }} />
      )}
      {toast}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div style={{ color: "var(--ink-3)", fontSize: 12, marginBottom: 4 }}>{label}</div><div>{children}</div></div>;
}

function RoleFormDrawer({ mode, detail, onClose, onSubmit }: {
  mode: { kind: "create" } | { kind: "update" };
  detail: A6RoleDetail | null;
  onClose: () => void;
  onSubmit: (payload: A6RoleCreateInput | A6RoleUpdateInput, action: React.ReactNode, detailNode: React.ReactNode) => void;
}) {
  const isCreate = mode.kind === "create";
  const [roleCode, setRoleCode] = useState(isCreate ? "" : detail?.roleCode ?? "");
  const [roleName, setRoleName] = useState(isCreate ? "" : detail?.roleName ?? "");
  const [remark, setRemark] = useState(isCreate ? "" : detail?.remark ?? "");
  const fieldStyle = { width: "100%", padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--ink)" } as const;
  const labelStyle = { color: "var(--ink-3)", fontSize: 12, marginBottom: 4 } as const;

  const submit = () => {
    if (isCreate && !roleCode.trim()) return;
    if (!roleName.trim()) return;
    if (isCreate) {
      onSubmit({ roleCode: roleCode.trim(), roleName: roleName.trim(), remark: remark.trim() || undefined, status: 1 },
        `新建角色 · ${roleName}`,
        <>新建角色 <b>{roleName}</b>（<span className="mono">{roleCode}</span>）。新角色默认零权限,需在编辑授权中绑定。审计留痕。</>);
    } else {
      onSubmit(buildRoleMetadataPayload(roleName, remark),
        `编辑角色 · ${roleName}`,
        <>编辑角色 <b>{roleName}</b>（<span className="mono">{detail?.roleCode}</span>,code 不可改）。本表单只保存名称与备注；启用/停用使用详情页独立确认动作。</>);
    }
  };

  return (
    <Drawer title={isCreate ? "新建角色" : `编辑 · ${detail?.roleName}`} sub={isCreate ? undefined : detail?.roleCode} onClose={onClose}
      footer={<Btn variant="primary" onClick={submit}>{isCreate ? "提交（需确认）" : "保存（需确认）"}</Btn>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
        <div><div style={labelStyle}>角色 code {isCreate ? "" : "（不可改,内置码保留）"}</div>
          <input style={fieldStyle} value={roleCode} onChange={(e) => setRoleCode(e.target.value)} disabled={!isCreate} placeholder="如 CONTENT_EDITOR" /></div>
        <div><div style={labelStyle}>名称</div>
          <input style={fieldStyle} value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="如 内容编辑员" /></div>
        <div><div style={labelStyle}>备注</div>
          <input style={fieldStyle} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="职责说明" /></div>
        <div className="atint" style={{ fontSize: 12 }}>提交后需在确认弹窗填写原因（≥8 字）。</div>
      </div>
    </Drawer>
  );
}

const PERM_TONE: Record<string, string> = { HIGH: "danger", WRITE: "warn", READ: "ok" };

/** 8 内置角色中文职责说明(角色定义,从 A1 挪来)。自定义角色用 remark 兜底。 */
const ROLE_DESC: Record<string, { desc: string; scope: string }> = {
  SUPER_ADMIN: { desc: "总管理员·平台拥有者,全域 A-M 全权限", scope: "全域 A-M" },
  CONFIG_ADMIN: { desc: "配置运营·平台配置/菜单/角色/权限管理", scope: "A 域" },
  FINANCE: { desc: "财务·资金对账/提现/账单/资金池", scope: "B/D 域" },
  RISK: { desc: "风控·风控规则/评分/反作弊,含跨域授权", scope: "C/K + 跨域" },
  CONTENT: { desc: "内容运营·文案/通知/信任中心/披露", scope: "I 域" },
  GROWTH: { desc: "增长运营·活动/任务/代金券/节奏", scope: "H 域" },
  SUPPORT: { desc: "客服·工单/会话/知识库/话术", scope: "M 域" },
  AUDITOR: { desc: "审计·只读全域审计/操作日志", scope: "全域只读" },
};

/** 权限授权编辑 Drawer:按业务域 A-M(中文+域色) → 域内页面(L2) → 权限 三级分组 + 搜索定位。 */
function GrantsEditorDrawer({ detail, menuTree, allPerms, onClose, onSubmit }: {
  detail: A6RoleDetail;
  menuTree: A7MenuTreeNode[];
  allPerms: A8Permission[];
  onClose: () => void;
  onSubmit: (payload: A6GrantsPayload, permBefore: number, menuBefore: number) => void;
}) {
  const [permSet, setPermSet] = useState<Set<string>>(() => new Set(detail.permissionCodes));
  const [menuSet, setMenuSet] = useState<Set<number>>(() => new Set(detail.menuIds));
  // 反转语义:折叠集(默认空 = 全展开);menuTree 异步加载后即默认全展开,无需 effect 填充
  const [menuCollapsed, setMenuCollapsed] = useState<Set<number>>(() => new Set());
  const [permQuery, setPermQuery] = useState("");
  const [selectedDomain, setSelectedDomain] = useState<string>("A");
  const [pageExpanded, setPageExpanded] = useState<Set<string>>(() => new Set());

  const togglePerm = (code: string) => {
    setPermSet((prev) => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; });
  };
  const togglePermGroup = (codes: string[], allOn: boolean) => {
    setPermSet((prev) => { const n = new Set(prev); codes.forEach((c) => allOn ? n.delete(c) : n.add(c)); return n; });
  };
  const toggleMenu = (node: A7MenuTreeNode, checked: boolean) => {
    setMenuSet((prev) => {
      const n = new Set(prev);
      const apply = (nd: A7MenuTreeNode, val: boolean) => { val ? n.add(nd.id) : n.delete(nd.id); nd.children.forEach((c) => apply(c, val)); };
      apply(node, checked);
      return n;
    });
  };

  const groups = useMemo<PermDomainGroup[]>(() => groupPermissionsByDomain(allPerms), [allPerms]);

  // 搜索过滤(权限码 / 中文名 / 页面 id / 页面名,跨域定位)
  const q = permQuery.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        pages: g.pages
          .map((p) => ({
            ...p,
            perms: p.perms.filter(
              (pp) =>
                pp.permissionCode.toLowerCase().includes(q) ||
                pp.permissionName.toLowerCase().includes(q) ||
                p.l2.id.toLowerCase().includes(q) ||
                p.l2.name.toLowerCase().includes(q),
            ),
          }))
          .filter((p) => p.perms.length > 0),
      }))
      .filter((g) => g.pages.length > 0);
  }, [groups, q]);

  // 选中域不在过滤结果(搜索后命中变) → 自动选第一个命中域
  useEffect(() => {
    if (filteredGroups.length && !filteredGroups.some((g) => g.domain.code === selectedDomain)) {
      setSelectedDomain(filteredGroups[0].domain.code);
    }
  }, [filteredGroups, selectedDomain]);

  const activeGroup = filteredGroups.find((g) => g.domain.code === selectedDomain) || filteredGroups[0];
  // 切换选中域 → 自动展开该域全部页面(权限直出,超出右栏滚动)
  useEffect(() => {
    if (activeGroup) {
      setPageExpanded(new Set(activeGroup.pages.map((p) => `${activeGroup.domain.code}:${p.l2.id}`)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDomain]);
  const togglePage = (key: string) => {
    setPageExpanded((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };

  return (
    <Drawer wide title={`编辑授权 · ${detail.roleName}`} sub={detail.roleCode} onClose={onClose}
      footer={<Btn variant="primary" onClick={() => onSubmit({ permissionCodes: [...permSet], menuIds: [...menuSet] }, detail.permissionCodes.length, detail.menuIds.length)}>保存授权（需确认）</Btn>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, height: "calc(100vh - 200px)", overflow: "hidden" }}>
        {/* 菜单授权(左,可见性) ‖ 权限授权(右,操作权)— 左右并排,各栏独立滚动 */}
        <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
          {/* 菜单授权(可见性)— 常驻左栏,默认全展开,栏内独立滚动 */}
          <div style={{ width: 340, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 700, fontSize: 13 }}>
              菜单授权（可见性）<span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 400 }}>· {menuSet.size} 项 · 父级联动子级</span>
            </div>
            <div style={{ overflow: "auto", flex: 1, minHeight: 0, padding: 8 }}>
              {menuTree.map((node) => (
                <MenuCheckRow key={node.id} node={node} depth={0} menuSet={menuSet} collapsed={menuCollapsed}
                  onToggleCollapse={(id) => setMenuCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                  onToggle={toggleMenu} />
              ))}
              {!menuTree.length && <div style={{ color: "var(--ink-4)", padding: 12 }}>菜单全集加载中…</div>}
            </div>
          </div>

          {/* 权限授权(操作权)— 整体卡:标题头 + 搜索 + 左域右详情 master-detail */}
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "9px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)", fontWeight: 700, fontSize: 13 }}>
            权限授权（操作权）<span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", fontWeight: 400 }}>· 左侧选业务域,右侧编辑该域页面权限;内容超出滚动</span>
          </div>
          <div style={{ padding: 10, borderBottom: "1px solid var(--border)" }}>
            <input aria-label="权限搜索" placeholder="搜索权限码 / 中文名 / 页面(如 staking、g1、提现) — 跨域定位,自动跳到命中域"
              value={permQuery} onChange={(e) => setPermQuery(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--ink)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 12, flex: 1, minHeight: 0, padding: 10 }}>
          {/* 左:域列表 A-M(选中高亮 + 域色 + 计数) */}
          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6, minHeight: 0 }}>
            {filteredGroups.map((g) => {
              const accent = `var(${g.domain.accentVar})`;
              const sel = g.domain.code === selectedDomain;
              const codes = g.pages.flatMap((p) => p.perms.map((pp) => pp.permissionCode));
              const selCnt = codes.filter((c) => permSet.has(c)).length;
              return (
                <button key={g.domain.code} onClick={() => setSelectedDomain(g.domain.code)}
                  style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 10px", marginBottom: 3, borderRadius: 7, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                    background: sel ? `color-mix(in srgb, ${accent} 16%, transparent)` : "transparent",
                    border: sel ? `1px solid color-mix(in srgb, ${accent} 42%, transparent)` : "1px solid transparent",
                    color: sel ? accent : "var(--ink-2)", fontWeight: sel ? 600 : 400, fontSize: 12.5 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>{g.domain.code} · {g.domain.name}</span>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-4)" }}>{selCnt}/{codes.length}</span>
                </button>
              );
            })}
            {!filteredGroups.length && <div style={{ color: "var(--ink-4)", padding: 12, fontSize: 12 }}>{allPerms.length ? "无匹配域" : "权限全集加载中…"}</div>}
          </div>

          {/* 右:选中域详情(页面 L2 + 权限,超出滚动) */}
          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 12, minHeight: 0 }}>
            {activeGroup ? (() => {
              const accent = `var(${activeGroup.domain.accentVar})`;
              const domCodes = activeGroup.pages.flatMap((p) => p.perms.map((pp) => pp.permissionCode));
              const domAllOn = domCodes.length > 0 && domCodes.every((c) => permSet.has(c));
              return (
                <>
                  <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: accent }} />
                    <span style={{ fontWeight: 700, color: accent, fontSize: 14 }}>{activeGroup.domain.code} · {activeGroup.domain.name}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{domCodes.filter((c) => permSet.has(c)).length}/{domCodes.length}</span>
                    <span style={{ flex: 1 }} />
                    <button className="l-btn sm" onClick={() => togglePermGroup(domCodes, domAllOn)}>域内{domAllOn ? "全清" : "全选"}</button>
                  </div>
                  {activeGroup.pages.map((p) => {
                    const pageKey = `${activeGroup.domain.code}:${p.l2.id}`;
                    const pageCodes = p.perms.map((pp) => pp.permissionCode);
                    const pageAllOn = pageCodes.length > 0 && pageCodes.every((c) => permSet.has(c));
                    const pageSel = pageCodes.filter((c) => permSet.has(c)).length;
                    const pgOpen = pageExpanded.has(pageKey) || !!q;
                    return (
                      <div key={pageKey} style={{ marginBottom: 8 }}>
                        <div className="row" style={{ alignItems: "center", gap: 6, padding: "5px 0" }}>
                          <button onClick={() => togglePage(pageKey)} style={{ background: "none", border: "none", color: "var(--ink-4)", cursor: "pointer", fontSize: 9, padding: 0, width: 12 }}>{pgOpen ? "▼" : "▶"}</button>
                          <span className="mono" style={{ fontWeight: 700, fontSize: 12 }}>{p.l2.id}</span>
                          <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{p.l2.name}</span>
                          <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{pageSel}/{pageCodes.length}</span>
                          <span style={{ flex: 1 }} />
                          <button className="l-btn sm" onClick={() => togglePermGroup(pageCodes, pageAllOn)}>{pageAllOn ? "全清" : "全选"}</button>
                        </div>
                        {pgOpen && (
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 4, padding: "2px 0 6px 22px" }}>
                            {p.perms.map((pp) => {
                              const on = permSet.has(pp.permissionCode);
                              const tone = PERM_TONE[pp.permType] ?? "neutral";
                              return (
                                <label key={pp.permissionCode} title={pp.permissionCode} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 12, background: on ? "var(--surface-2)" : "transparent" }}>
                                  <input type="checkbox" checked={on} onChange={() => togglePerm(pp.permissionCode)} />
                                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pp.permissionName || pp.permissionCode}</span>
                                  <Badge tone={tone}>{pp.permType}</Badge>
                                  {pp.amplifies === 1 && <span title="放大资金流出" style={{ color: "var(--danger)", fontSize: 12 }}>⚠</span>}
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })() : <div style={{ color: "var(--ink-4)", padding: 24, textAlign: "center" }}>{allPerms.length ? "无匹配权限" : "权限全集加载中…"}</div>}
          </div>
          </div>
        </div>
        </div>

        <div className="atint" style={{ fontSize: 12 }}>保存后需在确认弹窗填写原因（≥8 字）。服务器白名单同步（差量）,并失效该角色下账号权限缓存。</div>
      </div>
    </Drawer>
  );
}

function MenuCheckRow({ node, depth, menuSet, collapsed, onToggleCollapse, onToggle }: {
  node: A7MenuTreeNode;
  depth: number;
  menuSet: Set<number>;
  collapsed: Set<number>;
  onToggleCollapse: (id: number) => void;
  onToggle: (node: A7MenuTreeNode, checked: boolean) => void;
}) {
  const hasChildren = node.children.length > 0;
  const checked = menuSet.has(node.id);
  const isOpen = !collapsed.has(node.id);
  const accent = depth === 0 ? (DOMAIN_ACCENT[node.menuCode?.[0]?.toUpperCase() ?? ""] ?? "var(--ink-4)") : null;
  return (
    <div>
      <div className="row" style={{ alignItems: "center", gap: 6, padding: "4px 0", paddingLeft: depth * 16 }}>
        <button onClick={() => hasChildren && onToggleCollapse(node.id)} style={{ width: 16, background: "none", border: "none", color: "var(--ink-4)", cursor: hasChildren ? "pointer" : "default", fontSize: 10, padding: 0 }}>
          {hasChildren ? (isOpen ? "▼" : "▶") : "·"}
        </button>
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(node, e.target.checked)} />
        {accent && <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
        <span style={{ fontSize: 12, fontWeight: node.parentId == null ? 600 : 400 }}>{node.menuNameZh || node.menuName}</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{node.menuCode}</span>
      </div>
      {hasChildren && isOpen && node.children.map((c) => (
        <MenuCheckRow key={c.id} node={c} depth={depth + 1} menuSet={menuSet} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onToggle={onToggle} />
      ))}
    </div>
  );
}
