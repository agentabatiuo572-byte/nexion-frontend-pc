"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, ChevronDown, ChevronRight, Clock3, EyeOff, FolderTree, LayoutList, Minus, PanelLeft, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
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
import { OperationConfirmModal, useToast, type OperatorBriefKind } from "@/app/components/domain-views/design-kit";
import "../a-domain.css";
import { PlatformMutationReadbackError } from "@/lib/admin/platform-contracts";
import { CONSOLE_NAV, resolveVisibleDomains, type EffectiveMenuNode, type NavDomain } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import {
  BlockState, Button, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, Input, Notice, NumberInput,
  PageHeader, Panel, RdPage, Segments, Select, StatusTag,
} from "@/app/components/rd";

type FormMode = { kind: "create"; parent?: A7MenuTreeNode } | { kind: "update"; node: A7MenuTreeNode } | null;
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
  run: (reason: string) => Promise<void>;
};

const directTag = () => <StatusTag tone="progress" filled explain="填写理由并确认后立即生效，不走审批，保留操作记录。">立即生效</StatusTag>;
const ROUTE_HELP = "后台页面的地址，要和已上线页面的地址一模一样，比如 /platform/roles。对不上时这个菜单不会出现在左侧导航里；这里不会生成新页面。";
const ICON_HELP = "只存在菜单表里。左侧导航的图标是页面代码里固定的，改这里不会换导航图标。";

/**
 * 菜单在不在左侧导航里显示。用侧栏同一个函数 resolveVisibleDomains 算：拿全部启用的节点当作一个拥有全部菜单的账号，
 * 只有登记在导航里的页面、地址和所属一级菜单都对上才显示。只改显示，不发请求。
 */
function navPreview(tree: readonly A7MenuTreeNode[]) {
  const nodes: EffectiveMenuNode[] = [];
  const codes: string[] = [];
  for (const root of tree) {
    if (root.status !== 1) continue;
    codes.push(root.menuCode);
    nodes.push({ menuCode: root.menuCode, menuName: root.menuNameZh || root.menuName, routePath: root.routePath, parentCode: null, sortOrder: root.sortOrder });
    for (const child of root.children) {
      if (child.status !== 1) continue;
      codes.push(child.menuCode);
      nodes.push({ menuCode: child.menuCode, menuName: child.menuNameZh || child.menuName, routePath: child.routePath, parentCode: root.menuCode, sortOrder: child.sortOrder });
    }
  }
  // 客服排行榜按客服读权限插在客服中心里，拥有全部菜单的账号也有这项权限。
  const domains = resolveVisibleDomains({ role: "super", menuCodes: codes, menuNodes: nodes, authorities: ["service_m1_read"] });
  const shownPages = new Set<string>();
  const shownDomains = new Set<string>();
  for (const domain of domains) {
    shownDomains.add(domain.code);
    for (const item of domain.l2) shownPages.add(`${domain.code}/${item.id}`);
  }
  return { domains, shownPages, shownDomains };
}

type NavState = { shown: true } | { shown: false; reason: string };

function navStateOf(node: A7MenuTreeNode, parent: A7MenuTreeNode | undefined, preview: ReturnType<typeof navPreview>): NavState {
  if (node.status !== 1) return { shown: false, reason: "已停用" };
  if (parent && parent.status !== 1) return { shown: false, reason: "上一级已停用" };
  if (!parent) {
    if (preview.shownDomains.has(node.menuCode)) return { shown: true };
    const registered = CONSOLE_NAV.some((domain) => domain.code === node.menuCode);
    return { shown: false, reason: registered ? "下面没有能显示的页面" : "不是导航里登记的一级菜单" };
  }
  if (preview.shownPages.has(`${parent.menuCode}/${node.menuCode}`)) return { shown: true };
  const registered = CONSOLE_NAV.find((domain) => domain.code === parent.menuCode)?.l2.find((item) => item.id === node.menuCode);
  if (!registered) return { shown: false, reason: "不是导航里登记的页面" };
  if (registered.path !== node.routePath) return { shown: false, reason: `地址没对上已上线的页面 ${registered.path}` };
  return { shown: false, reason: "导航里不显示" };
}

/** A7 菜单管理：左边菜单树，右边选中节点的详情和动作，下面是左侧导航的预览。写操作都直接执行，要填理由。 */
export default function A7Menus() {
  const [, setToast] = useToast();
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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const reach = useReach();

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

  const tree = useMemo(() => overview?.tree ?? [], [overview]);
  const preview = useMemo(() => navPreview(tree), [tree]);
  const index = useMemo(() => {
    const byId = new Map<number, { node: A7MenuTreeNode; parent?: A7MenuTreeNode }>();
    for (const root of tree) {
      byId.set(root.id, { node: root });
      for (const child of root.children) byId.set(child.id, { node: child, parent: root });
    }
    return byId;
  }, [tree]);
  const selected = selectedId == null ? null : index.get(selectedId) ?? null;
  const all = [...index.values()];
  const stoppedCount = all.filter(({ node }) => node.status !== 1).length;
  const hidden = all.filter(({ node, parent }) => node.status === 1 && (!parent || parent.status === 1) && !navStateOf(node, parent, preview).shown);
  const parents = tree.filter((node) => node.children.length > 0).map((node) => node.id);
  const allOpen = parents.length > 0 && parents.every((id) => expanded.has(id));

  const pick = (node: A7MenuTreeNode) => {
    setSelectedId(node.id);
    requestAnimationFrame(() => document.getElementById("a7-node-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  const openDelete = (n: A7MenuTreeNode, parent: A7MenuTreeNode | undefined) => {
    const stableKey = newA7IdempotencyKey("a7-menu-delete");
    const name = n.menuNameZh || n.menuName;
    setConfirmReq({ briefKind: "config",
      action: `删除菜单 · ${name}`,
      title: `删除菜单「${menuNameText(n)}」`,
      detail: <>删除菜单 <b>{name}</b>（<span data-mono>{n.menuCode}</span>）。</>,
      effect: directTag(),
      confirmLabel: "确认删除",
      confirmTone: "danger",
      statedBrief: {
        impact: "确认后立即删除这一个菜单：左侧导航里不再有这个入口。不会删下级菜单、不会删页面，也不会改任何角色的授权。",
        check: "还有下级菜单、启用的权限挂在它下面，或任何角色（包括已停用的角色）勾了它，后端会拒绝删除，什么都不改。",
      },
      facts: <Facts>
        <Fact k="菜单">{menuNameText(n)} <span className="a7-code" data-mono>{n.menuCode}</span></Fact>
        <Fact k="位置">{parent ? `${menuNameText(parent)} 下的页面` : "一级菜单"}</Fact>
        {n.routePath && <Fact k="页面地址"><span data-mono>{n.routePath}</span></Fact>}
        <Fact k="下级菜单" tone={n.children.length ? "danger" : undefined}>{n.children.length ? `${n.children.length} 个，删除会被拒绝` : "没有"}</Fact>
        <Fact k="权限和角色引用">这页读不到，由后端提交时检查</Fact>
      </Facts>,
      content: n.children.length ? (
        <Notice tone="danger" title={`还有 ${n.children.length} 个下级菜单`}>
          <p>后端不会连带删除下级，这次提交会被拒绝。先逐个删除下级菜单，或改用「停用」。</p>
        </Notice>
      ) : (
        <Notice tone="warn" title="有权限或角色引用时删不掉">
          <p>后端会拒绝并写明原因：启用的权限挂在它下面的，先在「权限清单」移走；有角色勾了它的，到「角色管理」取消勾选。</p>
        </Notice>
      ),
      run: async (reason) => {
        try {
          const next = await deleteA7Menu(n.id, n.version, reason, operator, stableKey);
          setOverview(next);
          setToast("已删除");
        } catch (error) {
          setToast(error instanceof PlatformMutationReadbackError
            ? error.message
            : error instanceof Error ? error.message : String(error));
          throw error;
        }
      },
    });
  };

  const counts = overview ? (
    <>{overview.domainCount} 个一级菜单、{overview.pageCount} 个页面</>
  ) : null;

  const conclusion = loading ? (
    <Conclusion state="neutral" icon={Clock3}>正在加载菜单…</Conclusion>
  ) : loadError || !overview ? (
    <Conclusion state="danger" icon={TriangleAlert} hint="点菜单树里的「重试」再读一次。">菜单列表没读到，这部分没有判断</Conclusion>
  ) : tree.length === 0 ? (
    <Conclusion state="warn" icon={TriangleAlert}>还没有菜单，左侧导航只能按页面代码里的默认目录显示</Conclusion>
  ) : (
    <Conclusion state={stoppedCount ? "warn" : "ok"} icon={stoppedCount ? TriangleAlert : CheckCircle2}
      hint={hidden.length ? `另有 ${hidden.length} 个启用的菜单对不上已上线的页面，不会出现在导航里。` : undefined}
      explain="个数包括停用的菜单，按菜单表算，和左侧导航实际显示的页数不同。每个账号能看到哪些菜单，还取决于它的角色。">
      {counts}{stoppedCount ? `，${stoppedCount} 个已停用` : "，都在启用"}
    </Conclusion>
  );

  return (
    <RdPage className="adom a7-page">
      <PageHeader pageId="A7" title="菜单管理" summary="管左侧导航怎么分组、排序和显示。"
        actions={canWrite ? <Button variant="primary" onClick={() => setMode({ kind: "create" })}><Plus size={14} aria-hidden />新建一级菜单</Button> : undefined}
        readOnly={canWrite ? undefined : "只读：可以查看菜单树，不能修改"} />
      {conclusion}

      <div className="a7-layout">
        <div className="a7-main">
          <Panel title="菜单树" icon={FolderTree} tone="role-other" sub={overview ? `${overview.domainCount + overview.pageCount} 个` : undefined}
            explain="一级菜单下面是页面，最多两级。点一行在右边看详情和动作；排序数字小的排前面。"
            actions={parents.length > 0 ? <Button variant="ghost" onClick={() => setExpanded(allOpen ? new Set() : new Set(parents))}>{allOpen ? "全部收起" : "全部展开"}</Button> : undefined}>
            {loading ? <BlockState state="loading" title="加载中…" />
              : loadError ? <BlockState state="error" title="菜单列表加载失败，请重试。" detail={loadError} onRetry={() => void refresh()} />
              : tree.length === 0 ? <BlockState state="empty" title="暂无菜单" detail={canWrite ? "点页头「新建一级菜单」开始。" : undefined} />
              : (
                <div className="a7-tree" role="list" aria-label="菜单树">
                  {tree.map((node) => (
                    <MenuRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggleExpand}
                      selectedId={selectedId} onPick={pick} preview={preview} />
                  ))}
                </div>
              )}
          </Panel>

          <div className="a7-side">
            <div id="a7-node-detail" className="a7-detail-col">
              {selected ? (
                <NodeDetail node={selected.node} parent={selected.parent} canWrite={canWrite} nav={navStateOf(selected.node, selected.parent, preview)} reach={reach}
                  onCreate={() => setMode({ kind: "create", parent: selected.node })}
                  onEdit={() => setMode({ kind: "update", node: selected.node })}
                  onDelete={() => openDelete(selected.node, selected.parent)} />
              ) : (
                <Panel title="菜单详情" icon={LayoutList} tone="role-other">
                  <p className="a7-muted">{overview && tree.length ? "点左边一个菜单，看它的地址、排序、启停和在导航里显示不显示。" : "菜单读到后在这里看详情。"}</p>
                </Panel>
              )}
            </div>
            {overview && tree.length > 0 && (
              <NavPreviewPanel preview={preview} hidden={hidden} selected={selected} />
            )}
          </div>
        </div>
      </div>

      {mode && (
        <MenuFormDrawer
          mode={mode}
          tree={tree}
          onClose={() => setMode(null)}
          onSubmit={(payload, action, detail, view) => {
            const submittedMode = mode;
            const stableKey = newA7IdempotencyKey(submittedMode.kind === "create" ? "a7-menu-create" : "a7-menu-update");
            setConfirmReq({ briefKind: "config",
              action,
              detail,
              ...view,
              run: async (reason) => {
                try {
                  const next = submittedMode.kind === "create"
                    ? await createA7Menu(payload as A7MenuCreateInput, reason, operator, stableKey)
                    : await updateA7Menu(submittedMode.node.id, payload as A7MenuUpdateInput, reason, operator, stableKey);
                  setOverview(next);
                  setMode(null);
                  setToast("已保存");
                } catch (error) {
                  setToast(error instanceof PlatformMutationReadbackError
                    ? error.message
                    : error instanceof Error ? error.message : String(error));
                  throw error;
                }
              },
            });
          }}
        />
      )}

      {confirmReq && (
        <OperationConfirmModal briefKind={confirmReq.briefKind}
          action={confirmReq.action}
          title={confirmReq.title}
          detail={confirmReq.detail}
          effect={confirmReq.effect}
          confirmLabel={confirmReq.confirmLabel}
          confirmTone={confirmReq.confirmTone}
          statedBrief={confirmReq.statedBrief}
          facts={confirmReq.facts}
          content={confirmReq.content}
          onClose={() => setConfirmReq(null)}
          onConfirm={async (reason) => { await confirmReq.run(reason); setConfirmReq(null); }}
        />
      )}
    </RdPage>
  );
}

function menuNameText(node: A7MenuTreeNode): string {
  const name = node.menuNameZh || node.menuName;
  return node.menuCode === "I" && name === "内容与合规 CMS" ? "内容与合规" : name;
}

const DOMAIN_ICON = new Map(CONSOLE_NAV.map((domain) => [domain.code, domain.icon]));

function MenuRow({ node, depth, expanded, onToggle, selectedId, onPick, preview, parent }: {
  node: A7MenuTreeNode;
  depth: number;
  expanded: Set<number>;
  onToggle: (id: number) => void;
  selectedId: number | null;
  onPick: (node: A7MenuTreeNode) => void;
  preview: ReturnType<typeof navPreview>;
  parent?: A7MenuTreeNode;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isDomain = node.parentId == null;
  const targetName = node.menuNameZh || node.menuName;
  const Icon = isDomain ? DOMAIN_ICON.get(node.menuCode) : undefined;
  const nav = navStateOf(node, parent, preview);
  const stoppedChildren = node.children.filter((child) => child.status !== 1).length;
  const selected = node.id === selectedId;
  return (
    <div className="a7-node" role="listitem" data-depth={depth}>
      <div className="a7-row" data-selected={selected ? "" : undefined} data-stopped={node.status !== 1 ? "" : undefined}>
        {hasChildren ? (
          <button type="button" className="a7-toggle" onClick={() => onToggle(node.id)} aria-expanded={isOpen}
            aria-label={`${isOpen ? "收起" : "展开"} ${targetName}`}>
            {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          </button>
        ) : <span className="a7-toggle" aria-label={`${targetName} 无子级`} />}
        <button type="button" className="a7-pick" aria-pressed={selected} aria-label={`查看菜单 ${targetName}`} onClick={() => onPick(node)}>
          {isDomain && (Icon ? <Icon size={16} aria-hidden className="a7-icon" /> : <span className="a7-icon" aria-hidden />)}
          <span className="a7-name" data-root={isDomain ? "" : undefined}>{menuNameText(node)}</span>
          <span className="a7-code">{node.menuCode}</span>
          {!isDomain && node.routePath && <span className="a7-route" title={node.routePath}>{node.routePath}</span>}
          <span className="a7-row-tags">
            {node.status !== 1 && <StatusTag tone="neutral" icon={Ban}>已停用</StatusTag>}
            {node.status === 1 && !nav.shown && (!parent || parent.status === 1) && <StatusTag tone="warn" icon={EyeOff}>导航不显示</StatusTag>}
            {isDomain && <span className="a7-count">{node.children.length} 页{stoppedChildren ? ` · 停用 ${stoppedChildren}` : ""}</span>}
            <span className="a7-sort" title="排序">#{node.sortOrder}</span>
          </span>
        </button>
      </div>
      {hasChildren && isOpen && node.children.map((child) => (
        <MenuRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} selectedId={selectedId} onPick={onPick} preview={preview} parent={node} />
      ))}
    </div>
  );
}

function NodeDetail({ node, parent, canWrite, nav, reach, onCreate, onEdit, onDelete }: {
  node: A7MenuTreeNode;
  parent?: A7MenuTreeNode;
  canWrite: boolean;
  nav: NavState;
  reach: (href: string) => boolean;
  onCreate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isDomain = node.parentId == null;
  const Icon = isDomain ? DOMAIN_ICON.get(node.menuCode) : undefined;
  return (
    <Panel title={menuNameText(node)} icon={isDomain ? FolderTree : LayoutList} tone="role-other" sub={<span data-mono>{node.menuCode}</span>}
      actions={<span className="a7-tags">
        <StatusTag tone="neutral" icon={isDomain ? FolderTree : LayoutList}>{isDomain ? "一级菜单" : "页面"}</StatusTag>
        {node.status === 1 ? <StatusTag tone="ok" icon={CheckCircle2}>已启用</StatusTag> : <StatusTag tone="neutral" icon={Ban}>已停用</StatusTag>}
      </span>}>
      <div className="a7-detail">
        <div className="a7-navline" data-shown={nav.shown ? "" : undefined}>
          {nav.shown ? <PanelLeft size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
          <span>{nav.shown ? "会出现在左侧导航里" : `不会出现在左侧导航里：${nav.reason}`}</span>
          <Explain label="左侧导航显示规则" content={<><p>按拥有全部菜单的账号算：菜单启用、上一级启用，而且是导航里登记过的页面、地址一模一样，才会显示。</p><p>其他账号还要角色勾了这个菜单。</p></>} />
        </div>
        <dl className="a7-kv">
          {parent && <div><dt>上一级</dt><dd>{menuNameText(parent)} <span className="a7-code">{parent.menuCode}</span></dd></div>}
          <div><dt>页面地址<Explain label="页面地址" content={ROUTE_HELP} /></dt><dd data-empty={node.routePath ? undefined : ""}>{node.routePath ? <span data-mono>{node.routePath}</span> : "—"}</dd></div>
          <div><dt>图标名称<Explain label="图标名称" content={ICON_HELP} /></dt><dd data-empty={node.icon ? undefined : ""}>
            {Icon && <Icon size={14} aria-hidden className="a7-icon" />}{node.icon ? <span data-mono>{node.icon}</span> : "—"}
          </dd></div>
          <div><dt>排序<Explain label="排序" content="同一级里数字小的排前面，数字一样时按建的先后。改排序在「编辑」里填数字。" /></dt><dd>{node.sortOrder}</dd></div>
          {isDomain && <div><dt>下级菜单</dt><dd data-empty={node.children.length ? undefined : ""}>{node.children.length} 个{node.children.some((child) => child.status !== 1) ? `，其中 ${node.children.filter((child) => child.status !== 1).length} 个已停用` : ""}</dd></div>}
        </dl>
        {canWrite && (
          <div className="a7-actions">
            <Button variant="primary" onClick={onEdit}><Pencil size={14} aria-hidden />编辑</Button>
            {isDomain && <Button variant="secondary" onClick={onCreate}><Plus size={14} aria-hidden />新建下级菜单</Button>}
            <Button variant="danger-outline" onClick={onDelete}><Trash2 size={14} aria-hidden />删除</Button>
            {node.children.length > 0 && <span className="a7-note"><TriangleAlert size={14} aria-hidden />还有 {node.children.length} 个下级菜单，删除会被拒绝</span>}
          </div>
        )}
        <p className="a7-muted">启停、改名称、地址、图标和排序都在「编辑」里；保存后直接生效，不走审批。{reach("/platform/roles") ? <> 给角色勾菜单到 <Link className="rd-link" href="/platform/roles">角色管理</Link>。</> : null}</p>
      </div>
    </Panel>
  );
}

function NavPreviewPanel({ preview, hidden, selected }: {
  preview: ReturnType<typeof navPreview>;
  hidden: { node: A7MenuTreeNode; parent?: A7MenuTreeNode }[];
  selected: { node: A7MenuTreeNode; parent?: A7MenuTreeNode } | null;
}) {
  const focusDomain = selected ? (selected.parent ?? selected.node).menuCode : null;
  return (
    <Panel title="左侧导航预览" icon={PanelLeft} tone="role-other"
      sub={`${preview.domains.length} 组 · ${preview.domains.reduce((sum, domain) => sum + domain.l2.length, 0)} 页`}
      explain="拥有全部菜单的账号（比如超级管理员）看到的左侧导航，按现在的菜单表算。菜单表里还是旧名称的，导航显示页面代码里的名称。其他账号只看到自己角色勾了的那部分；已经打开的页面要重新读取登录信息后才更新。">
      <ul className="a7-preview" aria-label="左侧导航预览">
        {preview.domains.map((domain: NavDomain) => {
          const Icon = domain.icon;
          const open = domain.code === focusDomain;
          return (
            <li key={domain.code} data-open={open ? "" : undefined}>
              <span className="a7-preview-domain"><Icon size={14} aria-hidden /><span>{domain.name}</span><span className="a7-count">{domain.l2.length}</span></span>
              {open && (
                <ul>
                  {domain.l2.map((item) => (
                    <li key={item.id} data-current={selected?.node.menuCode === item.id && selected.parent ? "" : undefined}>{item.name}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {hidden.length > 0 && (
        <p className="a7-muted a7-preview-hidden">
          <Minus size={14} aria-hidden />{hidden.length} 个启用的菜单不在导航里
          <Explain label="不在导航里的菜单" rows={hidden.map(({ node, parent }) => ({ k: `${parent ? `${menuNameText(parent)} / ` : ""}${menuNameText(node)}`, v: node.menuCode }))} />
        </p>
      )}
    </Panel>
  );
}

type ConfirmView = Pick<ConfirmReq, "title" | "effect" | "confirmLabel" | "statedBrief" | "facts" | "content">;
type FieldKey = "code" | "name" | "route" | "sort";

function MenuFormDrawer({ mode, tree, onClose, onSubmit }: {
  mode: { kind: "create"; parent?: A7MenuTreeNode } | { kind: "update"; node: A7MenuTreeNode };
  tree: A7MenuTreeNode[];
  onClose: () => void;
  onSubmit: (payload: A7MenuCreateInput | A7MenuUpdateInput, action: ReactNode, detail: ReactNode, view: ConfirmView) => void;
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
  const [validationError, setValidationError] = useState("");
  // 只决定错误写在哪个框下面；校验规则和原文不变。
  const [errorField, setErrorField] = useState<FieldKey | null>(null);
  const fail = (field: FieldKey, message: string) => { setErrorField(field); setValidationError(message); };

  const existingParent = existing ? tree.find((root) => root.children.some((child) => child.id === existing.id)) : undefined;

  const submit = () => {
    const normalizedCode = menuCode.trim().toUpperCase();
    const normalizedName = menuName.trim();
    const normalizedRoute = routePath.trim();
    if (isCreate && !/^[A-Z][A-Z0-9_]{0,63}$/.test(normalizedCode)) {
      fail("code", "菜单编码需以大写字母开头，只能包含大写字母、数字和下划线，最长 64 位。");
      return;
    }
    if (!normalizedName || normalizedName.length > 64) {
      fail("name", "菜单名称不能为空，且不能超过 64 个字符。");
      return;
    }
    if (normalizedRoute && !/^\/[A-Za-z0-9/_-]*$/.test(normalizedRoute)) {
      fail("route", "页面地址须以 / 开头，只能包含字母、数字、/、_ 或 -。");
      return;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      fail("sort", "排序必须是 0 到 100000 之间的整数。");
      return;
    }
    setValidationError("");
    setErrorField(null);
    if (isCreate) {
      const payload: A7MenuCreateInput = { menuCode: normalizedCode, menuName: normalizedName, menuNameZh: normalizedName, parentCode: parentCode.trim() || undefined, routePath: normalizedRoute || undefined, icon: icon.trim() || undefined, sortOrder };
      const parent = tree.find((node) => node.menuCode === parentCode);
      onSubmit(payload, `新建菜单 · ${menuName}`, <>新建菜单 <b>{menuName}</b>（<span data-mono>{menuCode}</span>）。</>, {
        title: `新建菜单「${normalizedName}」`,
        effect: directTag(),
        confirmLabel: "确认新建",
        statedBrief: {
          impact: "确认后立即建好，默认启用。只有导航里登记过的页面、而且地址和上一级都对上，才会出现在左侧导航；新建菜单不会生成页面，也不会给任何角色授权。",
          check: "要让其他账号看到，还要到「角色管理」给角色勾上它。用过又删除的菜单标识会恢复成原来那个菜单。",
        },
        facts: <Facts>
          <Fact k="菜单标识"><span data-mono>{normalizedCode}</span></Fact>
          <Fact k="名称">{normalizedName}</Fact>
          <Fact k="位置">{parent ? `${menuNameText(parent)} 下的页面` : "一级菜单"}</Fact>
          <Fact k="页面地址">{normalizedRoute ? <span data-mono>{normalizedRoute}</span> : "—"}</Fact>
          <Fact k="图标名称">{icon.trim() ? <span data-mono>{icon.trim()}</span> : "—"}</Fact>
          <Fact k="排序">{sortOrder}</Fact>
        </Facts>,
        content: parent && parent.status !== 1 ? (
          <Notice tone="danger" title="上一级菜单已停用"><p>后端只接受启用中的一级菜单作为上一级，这次提交会被拒绝。先启用「{menuNameText(parent)}」。</p></Notice>
        ) : undefined,
      });
    } else if (existing) {
      const payload: A7MenuUpdateInput = { menuName: normalizedName, menuNameZh: normalizedName, routePath: normalizedRoute || undefined, icon: icon.trim() || undefined, sortOrder, status, expectedVersion: existing.version };
      const oldName = existing.menuNameZh || existing.menuName;
      const routeCleared = !normalizedRoute && Boolean(existing.routePath);
      const iconCleared = !icon.trim() && Boolean(existing.icon);
      const routeChanged = Boolean(normalizedRoute) && normalizedRoute !== existing.routePath;
      const stopping = existing.status === 1 && status === 0;
      const starting = existing.status !== 1 && status === 1;
      const notes: ReactNode[] = [];
      if (stopping) notes.push(
        <Notice key="stop" tone="warn" title="停用后左侧导航不再显示它">
          <p>拥有全部菜单的账号（比如超级管理员）会看不到这个入口{existing.parentId == null ? "，下面的页面也一起看不到" : ""}。</p>
          <p>还有启用的下级菜单、启用的权限挂在它下面，或任何角色（包括已停用的角色）勾了它时，后端会拒绝停用；角色的勾选到「角色管理」取消。</p>
        </Notice>);
      if (starting && existingParent && existingParent.status !== 1) notes.push(
        <Notice key="start" tone="danger" title="上一级菜单已停用"><p>后端要求先启用上一级「{menuNameText(existingParent)}」，这次提交会被拒绝。</p></Notice>);
      if (routeChanged) notes.push(
        <Notice key="route" tone="warn" title="改了页面地址">
          <p>勾了这个菜单的账号点它会去新地址。新地址和已上线的页面对不上时，这个菜单从左侧导航消失，不会生成页面。</p>
        </Notice>);
      if (!stopping && existing.status === 1 && status === 1) notes.push(
        <p key="check" className="a7-muted">每次保存都会带上启停状态，后端会再检查一遍上一级是否启用。</p>);
      onSubmit(payload, `编辑菜单 · ${menuName}`, <>修改菜单 <b>{menuName}</b>（<span data-mono>{existing.menuCode}</span>）。</>, {
        title: `修改菜单「${menuNameText(existing)}」`,
        effect: <>{directTag()}<StatusTag tone="neutral" icon={Minus}>不改任何角色的授权</StatusTag></>,
        confirmLabel: stopping ? "确认停用" : "确认保存",
        statedBrief: {
          impact: stopping
            ? "确认后立即停用，左侧导航不再显示它；菜单、页面和授权都保留，重新启用后恢复。"
            : "确认后立即保存菜单的名称、地址、图标、排序和启停；不改任何角色的授权，也不生成页面。左侧导航要等账号重新读取登录信息后才更新。",
          check: "核对改动；留空的地址和图标不会清掉原来的值。",
        },
        facts: <Facts>
          <Fact k="菜单">{menuNameText(existing)} <span className="a7-code" data-mono>{existing.menuCode}</span></Fact>
          {normalizedName !== oldName && <Fact k="名称"><Change from={oldName} to={normalizedName} /></Fact>}
          {routeCleared
            ? <Fact k="页面地址" tone="warn">留空不会清掉原地址 {existing.routePath}</Fact>
            : routeChanged ? <Fact k="页面地址"><Change from={existing.routePath || "—"} to={normalizedRoute} /></Fact> : null}
          {iconCleared
            ? <Fact k="图标名称" tone="warn">留空不会清掉原图标名 {existing.icon}</Fact>
            : icon.trim() && icon.trim() !== existing.icon ? <Fact k="图标名称"><Change from={existing.icon || "—"} to={icon.trim()} /></Fact> : null}
          {sortOrder !== existing.sortOrder && <Fact k="排序"><Change from={existing.sortOrder} to={sortOrder} /></Fact>}
          <Fact k="状态">{status !== existing.status ? <Change from={existing.status === 1 ? "已启用" : "已停用"} to={status === 1 ? "已启用" : "已停用"} /> : status === 1 ? "已启用（不变）" : "已停用（不变）"}</Fact>
        </Facts>,
        content: notes.length ? <div className="a7-notes">{notes}</div> : undefined,
      });
    }
  };

  // 只允许挂在顶级业务域下，避免生成控制台无法展示的第三级菜单。
  const parentOptions = tree
    .filter((node) => node.parentId == null && node.menuCode !== existing?.menuCode)
    .map((node) => ({ code: node.menuCode, label: `${menuNameText(node)} (${node.menuCode})`, stopped: node.status !== 1 }));
  const pickedParent = parentOptions.find((option) => option.code === parentCode);
  const err = (field: FieldKey) => (errorField === field ? validationError : undefined);

  return (
    <Drawer open
      title={isCreate ? (parentCode ? "新建下级菜单" : "新建一级菜单") : "编辑菜单"}
      sub={isCreate ? undefined : <>{existing?.menuNameZh || existing?.menuName} · <span data-mono>{existing?.menuCode}</span></>}
      explain="填好后点「下一步：确认」，在确认框里核对并填理由。保存后直接生效，不走审批。"
      onClose={onClose}
      footer={<Decision others={<Button variant="secondary" onClick={onClose}>取消</Button>}
        primary={<Button variant="primary" onClick={submit}>下一步：确认</Button>} />}
    >
      <div className="a7-form">
        <Field label="菜单标识" required={isCreate} hint={isCreate ? "大写字母开头，只用大写字母、数字和下划线，最长 64 位" : "不能修改"} error={err("code")}
          explain={isCreate ? "要出现在导航里，一级菜单用模块字母（如 A），页面用页面编号（如 A6），和导航里登记的一致。" : undefined}>
          {(control) => <Input {...control} value={menuCode} onChange={(e) => setMenuCode(e.target.value)} disabled={!isCreate} placeholder="如 A9 或 CUSTOM_X" data-mono="" />}
        </Field>
        <Field label="菜单名称（中文）" required hint="最多 64 字" error={err("name")}>
          {(control) => <Input {...control} value={menuName} onChange={(e) => setMenuName(e.target.value)} placeholder="如 角色管理" />}
        </Field>
        {isCreate && (
          <Field label="上一级" hint="不选就是一级菜单；最多两级" error={pickedParent?.stopped ? "这个一级菜单已停用，选它会被后端拒绝" : undefined}>
            {(control) => <Select {...control} aria-label="上一级" value={parentCode} onChange={setParentCode}
              options={[{ value: "", label: "（一级菜单）" }, ...parentOptions.map((o) => ({ value: o.code, label: o.stopped ? `${o.label} · 已停用` : o.label }))]} />}
          </Field>
        )}
        <Field label="页面地址" hint="以 / 开头，只用字母、数字、/、_ 或 -" error={err("route")} explain={ROUTE_HELP}
          help={!isCreate && existing?.routePath ? "留空不会清掉原地址；要改就填新地址。" : "填错时菜单不会出现在导航里，不会自动生成页面。"}>
          {(control) => <Input {...control} value={routePath} onChange={(e) => setRoutePath(e.target.value)} placeholder="/platform/xxx" data-mono="" />}
        </Field>
        <div className="rd-form-grid" data-cols="2" data-dense="">
          <Field label="图标名称" hint="最多 64 字" explain={ICON_HELP} help={!isCreate && existing?.icon ? "留空不会清掉原图标名。" : undefined}>
            {(control) => <Input {...control} value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="shield-check" data-mono="" />}
          </Field>
          <Field label="排序" hint="0–100000 的整数，小的在前" error={err("sort")}>
            {(control) => <NumberInput {...control} min={0} max={100000} step={1} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />}
          </Field>
        </div>
        {!isCreate && (
          <Field label="状态" help={status === 0 && existing?.status === 1 ? "停用后左侧导航不再显示它；有启用的下级、启用的权限或角色勾了它时后端会拒绝。" : undefined}>
            <Segments label="状态" value={status} onChange={setStatus} items={[{ value: 1, label: "启用" }, { value: 0, label: "停用" }]} />
          </Field>
        )}
        {isCreate && <Notice tone="neutral" title="新建菜单不会生成页面"><p>也不会给任何角色授权；建好后到「角色管理」给角色勾上它。</p></Notice>}
      </div>
    </Drawer>
  );
}
