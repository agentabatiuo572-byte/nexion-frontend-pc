"use client";
import { useCallback, useEffect, useState } from "react";
import {
  fetchA7MenusOverview,
  createA7Menu,
  updateA7Menu,
  deleteA7Menu,
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
type ConfirmReq = { action: React.ReactNode; detail: React.ReactNode; run: (reason: string) => void };

/** A7 菜单管理（手写树 + 节点 CRUD drawer + OperationConfirmModal reason 闭环）。 */
export default function A7Menus() {
  const [toast, setToast] = useToast();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const [overview, setOverview] = useState<A7MenuOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<FormMode>(null);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setOverview(await fetchA7MenusOverview());
    } catch (err) {
      setToast(err instanceof Error ? err.message : String(err));
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
        right={<Btn variant="primary" sm onClick={() => setMode({ kind: "create" })}>+ 新建顶级菜单</Btn>} />
      <Card>
        <CardH title="菜单树" />
        {loading ? (
          <div style={{ padding: 24, color: "var(--ink-3)" }}>加载中…</div>
        ) : overview && overview.tree.length > 0 ? (
          <div style={{ padding: "8px 12px" }}>
            {overview.tree.map((node) => (
              <MenuRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggleExpand}
                onCreate={(parent) => setMode({ kind: "create", parent })} onEdit={(n) => setMode({ kind: "update", node: n })}
                onDelete={(n) => setConfirmReq({
                  action: `删除菜单 · ${n.menuNameZh || n.menuName}`,
                  detail: <>删除菜单 <b>{n.menuNameZh || n.menuName}</b>（<span className="mono">{n.menuCode}</span>）。{n.children.length ? <b>该节点有子级,后端将拒绝（需先删子级）。</b> : "叶子节点删除后 role_menu 绑定级联软删,permission.menu_id 变悬挂（A8 容错）。"}审计留痕。</>,
                  run: (reason) => {
                    deleteA7Menu(n.id, reason, operator)
                      .then((next) => { setOverview(next); setToast("已删除 · 后端留痕"); })
                      .catch((err: unknown) => setToast(err instanceof Error ? err.message : String(err)));
                  },
                })} />
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
            setMode(null);
            setConfirmReq({
              action,
              detail,
              run: (reason) => {
                const mutate = mode.kind === "create"
                  ? createA7Menu(payload as A7MenuCreateInput, reason, operator)
                  : updateA7Menu((mode as { kind: "update"; node: A7MenuTreeNode }).node.id, payload as A7MenuUpdateInput, reason, operator);
                mutate.then((next) => { setOverview(next); setToast("已保存 · 后端留痕"); })
                  .catch((err: unknown) => setToast(err instanceof Error ? err.message : String(err)));
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
          onConfirm={(reason) => { confirmReq.run(reason); setConfirmReq(null); }}
        />
      )}
      {toast}
    </div>
  );
}

function MenuRow({ node, depth, expanded, onToggle, onCreate, onEdit, onDelete }: {
  node: A7MenuTreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  onCreate: (parent: A7MenuTreeNode) => void;
  onEdit: (node: A7MenuTreeNode) => void;
  onDelete: (node: A7MenuTreeNode) => void;
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
        <Btn sm onClick={() => onCreate(node)}>+ 子级</Btn>
        <Btn sm onClick={() => onEdit(node)}>编辑</Btn>
        <Btn sm onClick={() => onDelete(node)}>删除</Btn>
      </div>
      {hasChildren && isOpen && node.children.map((child) => (
        <MenuRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} onCreate={onCreate} onEdit={onEdit} onDelete={onDelete} />
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
