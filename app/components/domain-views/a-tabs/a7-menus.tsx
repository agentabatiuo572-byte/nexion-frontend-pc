"use client";
import { useCallback, useEffect, useState } from "react";
import {
  fetchA7MenusOverview,
  createA7Menu,
  updateA7Menu,
  deleteA7Menu,
  newA7IdempotencyKey,
  type A7MenuOverview,
  type A7MenuTreeNode,
  type A7MenuCreateInput,
  type A7MenuUpdateInput,
} from "@/lib/admin/a7-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Card, CardH, CodeTag, Badge, Btn, Drawer, OperationConfirmModal, useToast } from "@/app/components/domain-views/design-kit";
import "../a-domain.css";
import { DomainHeader } from "../domain-header";

type FormMode = { kind: "create"; parent?: A7MenuTreeNode } | { kind: "update"; node: A7MenuTreeNode } | null;
type ConfirmReq = { action: React.ReactNode; detail: React.ReactNode; run: (reason: string) => Promise<void> };

/** A7 菜单管理（手写树 + 节点 CRUD drawer + OperationConfirmModal reason 闭环）。 */
export default function A7Menus() {
  const [toast, setToast] = useToast();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const role = useAdminAuth((s) => s.session?.role ?? s.role);
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const canWrite = role === "super" || role === "superadmin" || authorities.includes("platform_a7_write");
  const [overview, setOverview] = useState<A7MenuOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<FormMode>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      setOverview(await fetchA7MenusOverview());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOverview(null);
      setLoadError(message);
      setToast(message);
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [setToast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="dkpage adom">
      <DomainHeader domainCode="A" domainName="平台基础" accentVar="--admin-domain-a"
        l2Id="A7" l2Name="菜单管理"
        summary={`A7 菜单状态、名称与排序（${overview?.domainCount ?? 0} 域 / ${overview?.pageCount ?? 0} 页）和 A6 角色绑定共同驱动侧栏；console-nav 仅保留已部署路由白名单，未注册或路由不匹配的节点不会进入导航。`}
        right={canWrite ? <Btn variant="primary" sm onClick={() => setMode({ kind: "create" })}>+ 新建顶级菜单</Btn> : <Badge tone="neutral">只读</Badge>} />
      <Card>
        <CardH title="菜单树" />
        {loading ? (
          <div style={{ padding: 24, color: "var(--ink-3)" }}>加载中…</div>
        ) : loadError ? (
          <div className="alertbar warn" role="alert" style={{ margin: 16 }}>
            菜单目录加载失败，当前数据不可确认。<Btn sm onClick={() => void refresh()}>重试</Btn>
          </div>
        ) : overview && overview.tree.length > 0 ? (
          <div style={{ padding: "8px 12px" }}>
            {overview.tree.map((node) => (
              <MenuRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggleExpand} canWrite={canWrite}
                onCreate={(parent) => setMode({ kind: "create", parent })} onEdit={(n) => setMode({ kind: "update", node: n })}
                onDelete={(n) => {
                  const stableKey = newA7IdempotencyKey("a7-menu-delete");
                  setConfirmReq({
                    action: `删除菜单 · ${n.menuNameZh || n.menuName}`,
                    detail: <>删除菜单 <b>{n.menuNameZh || n.menuName}</b>（<span className="mono">{n.menuCode}</span>）。{n.children.length ? <b>该节点仍有子菜单，请先迁移或删除子菜单。</b> : "若仍有权限字典归属或角色菜单授权，服务器会拒绝删除；请先迁移权限归属，并在角色管理中解除菜单授权。"}操作会写入审计记录。</>,
                    run: async (reason) => {
                      try {
                        const next = await deleteA7Menu(n.id, reason, operator, stableKey);
                        setOverview(next);
                        setToast("已删除 · 后端留痕");
                      } catch (error) {
                        setToast(error instanceof Error ? error.message : String(error));
                        throw error;
                      }
                    },
                  });
                }} />
            ))}
          </div>
        ) : (
          <div style={{ padding: 24, color: "var(--ink-3)", textAlign: "center" }}>暂无菜单</div>
        )}
      </Card>

      {mode && (
        <MenuFormDrawer
          mode={mode}
          tree={overview?.tree ?? []}
          onClose={() => setMode(null)}
          onSubmit={(payload, action, detail) => {
            const submittedMode = mode;
            const stableKey = newA7IdempotencyKey(submittedMode.kind === "create" ? "a7-menu-create" : "a7-menu-update");
            setConfirmReq({
              action,
              detail,
              run: async (reason) => {
                try {
                  const next = submittedMode.kind === "create"
                    ? await createA7Menu(payload as A7MenuCreateInput, reason, operator, stableKey)
                    : await updateA7Menu(submittedMode.node.id, payload as A7MenuUpdateInput, reason, operator, stableKey);
                  setOverview(next);
                  setMode(null);
                  setToast("已保存 · 后端留痕");
                } catch (error) {
                  setToast(error instanceof Error ? error.message : String(error));
                  throw error;
                }
              },
            });
          }}
        />
      )}

      {confirmReq && (
        <OperationConfirmModal
          action={confirmReq.action}
          detail={confirmReq.detail}
          onClose={() => setConfirmReq(null)}
          onConfirm={async (reason) => { await confirmReq.run(reason); setConfirmReq(null); }}
        />
      )}
      {toast}
    </div>
  );
}

function MenuRow({ node, depth, expanded, onToggle, onCreate, onEdit, onDelete, canWrite }: {
  node: A7MenuTreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onCreate: (parent: A7MenuTreeNode) => void;
  onEdit: (node: A7MenuTreeNode) => void;
  onDelete: (node: A7MenuTreeNode) => void;
  canWrite: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isDomain = node.parentId == null;
  return (
    <div>
      <div className="row" style={{ alignItems: "center", gap: 8, padding: "8px 0", paddingLeft: depth * 22, borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={() => hasChildren && onToggle(node.id)}
          style={{ width: 18, color: "var(--ink-3)", cursor: hasChildren ? "pointer" : "default", background: "none", border: "none", fontSize: 11 }}
          aria-label={isOpen ? "收起" : "展开"}
        >
          {hasChildren ? (isOpen ? "▼" : "▶") : "·"}
        </button>
        <span style={{ fontWeight: isDomain ? 600 : 400, color: "var(--ink)" }}>{node.menuNameZh || node.menuName}</span>
        <CodeTag>{node.menuCode}</CodeTag>
        {node.routePath && <CodeTag><span className="mono" style={{ fontSize: 11 }}>{node.routePath}</span></CodeTag>}
        <Badge tone={node.status === 1 ? "ok" : "dim"}>{node.status === 1 ? "启用" : "停用"}</Badge>
        <span style={{ flex: 1 }} />
        {canWrite && <Btn sm onClick={() => onCreate(node)}>+ 子级</Btn>}
        {canWrite && <Btn sm onClick={() => onEdit(node)}>编辑</Btn>}
        {canWrite && <Btn sm onClick={() => onDelete(node)}>删除</Btn>}
      </div>
      {hasChildren && isOpen && node.children.map((child) => (
        <MenuRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} canWrite={canWrite} />
      ))}
    </div>
  );
}

function MenuFormDrawer({ mode, tree, onClose, onSubmit }: {
  mode: { kind: "create"; parent?: A7MenuTreeNode } | { kind: "update"; node: A7MenuTreeNode };
  tree: A7MenuTreeNode[];
  onClose: () => void;
  onSubmit: (payload: A7MenuCreateInput | A7MenuUpdateInput, action: React.ReactNode, detail: React.ReactNode) => void;
}) {
  const isCreate = mode.kind === "create";
  const existing = isCreate ? null : mode.node;
  const [menuCode, setMenuCode] = useState(existing?.menuCode ?? "");
  const [menuName, setMenuName] = useState(existing?.menuNameZh ?? existing?.menuName ?? "");
  const [parentCode, setParentCode] = useState(isCreate ? mode.parent?.menuCode ?? "" : "");
  const [routePath, setRoutePath] = useState(existing?.routePath ?? "");
  const [icon, setIcon] = useState(existing?.icon ?? "");
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? 0);
  const [status, setStatus] = useState(existing?.status ?? 1);

  const submit = () => {
    if (isCreate && !menuCode.trim()) return;
    if (!menuName.trim()) return;
    if (isCreate) {
      const payload: A7MenuCreateInput = { menuCode: menuCode.trim(), menuName: menuName.trim(), menuNameZh: menuName.trim(), parentCode: parentCode.trim() || undefined, routePath: routePath.trim() || undefined, icon: icon.trim() || undefined, sortOrder };
      onSubmit(payload, `新建菜单 · ${menuName}`, <>新建菜单节点 <b>{menuName}</b>（<span className="mono">{menuCode}</span>）。菜单变更影响前端导航,审计留痕。</>);
    } else if (existing) {
      const payload: A7MenuUpdateInput = { menuName: menuName.trim(), menuNameZh: menuName.trim(), routePath: routePath.trim() || undefined, icon: icon.trim() || undefined, sortOrder, status };
      onSubmit(payload, `编辑菜单 · ${menuName}`, <>编辑菜单节点 <b>{menuName}</b>（<span className="mono">{existing.menuCode}</span>,menuCode 不可改）。元数据变更不影响权限码缓存。</>);
    }
  };

  // 收集所有节点（含嵌套）作 parent 选项
  const flatten = (nodes: A7MenuTreeNode[], acc: { code: string; label: string }[] = []) => {
    for (const n of nodes) {
      acc.push({ code: n.menuCode, label: `${n.menuNameZh || n.menuName} (${n.menuCode})` });
      if (n.children.length) flatten(n.children, acc);
    }
    return acc;
  };
  const parentOptions = flatten(tree).filter((o) => o.code !== existing?.menuCode);

  const fieldStyle = { flex: "1 1 200px", minWidth: 200, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--ink)" } as const;
  const labelStyle = { color: "var(--ink-3)", fontSize: 12, marginBottom: 4 } as const;

  return (
    <Drawer
      title={isCreate ? "新建菜单节点" : `编辑 · ${existing?.menuNameZh ?? existing?.menuName}`}
      sub={isCreate ? undefined : existing?.menuCode}
      onClose={onClose}
      footer={<Btn onClick={submit}>{isCreate ? "提交（需确认）" : "保存（需确认）"}</Btn>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
        <div>
          <div style={labelStyle}>菜单 code {isCreate ? "" : "（不可改）"}</div>
          <input style={fieldStyle} value={menuCode} onChange={(e) => setMenuCode(e.target.value)} disabled={!isCreate} placeholder="如 A9 或 CUSTOM_X" />
        </div>
        <div>
          <div style={labelStyle}>菜单名称（中文）</div>
          <input style={fieldStyle} value={menuName} onChange={(e) => setMenuName(e.target.value)} placeholder="如 角色管理" />
        </div>
        {isCreate && (
          <div>
            <div style={labelStyle}>父级菜单（空 = 顶级域）</div>
            <select style={fieldStyle} value={parentCode} onChange={(e) => setParentCode(e.target.value)}>
              <option value="">（顶级域）</option>
              {parentOptions.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>
        )}
        <div>
          <div style={labelStyle}>路由路径</div>
          <input style={fieldStyle} value={routePath} onChange={(e) => setRoutePath(e.target.value)} placeholder="/platform/xxx" />
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={labelStyle}>图标名（lucide）</div>
            <input style={fieldStyle} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="shield-check" />
          </div>
          <div style={{ width: 100 }}>
            <div style={labelStyle}>排序</div>
            <input style={fieldStyle} type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
          {!isCreate && <div style={{ width: 100 }}>
              <div style={labelStyle}>状态</div>
              <select style={fieldStyle} value={status} onChange={(e) => setStatus(Number(e.target.value))}>
                <option value={1}>启用</option>
                <option value={0}>停用</option>
              </select>
            </div>}
        </div>
        <div className="atint" style={{ fontSize: 12 }}>提交后需在确认弹窗填写原因（≥8 字）,确认即由服务器执行并留痕审计。</div>
      </div>
    </Drawer>
  );
}
