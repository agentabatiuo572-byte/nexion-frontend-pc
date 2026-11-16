"use client";

/**
 * A6 改权限和菜单的抽屉，以及确认框、详情里共用的「加了哪些、去掉哪些」「权限和菜单对不上」。
 * 勾选、搜索、分组、递归勾菜单的规则和改版前一样（A6-A05–A08、C22）：
 * - 从当前详情的完整两组初始化；搜索只筛看得到的项，不清筛外的勾选；
 * - 菜单勾上或取消会带上全部下级，但不自动勾上级；权限和菜单互不推导；
 * - 模块、页面的全选只作用于当前筛出来的权限。
 * 这里只算显示用的差异，不发请求；提交仍由页面带完整两组走原来的 PUT。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Coins, Eye, PenLine, Search, ShieldAlert, TriangleAlert } from "lucide-react";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { A6GrantsPayload, A6RoleDetail } from "@/lib/admin/a6-client";
import type { A7MenuTreeNode } from "@/lib/admin/a7-client";
import type { A8Permission } from "@/lib/admin/a8-client";
import { a6GrantsProblem } from "@/lib/admin/a6a7-mutations";
import { displayAdminError } from "@/lib/admin/error-messages";
import { domainOfPermission, groupPermissionsByDomain, type PermDomainGroup } from "@/lib/admin/perm-domain";
import { F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { CONSOLE_NAV } from "@/lib/nav/console-nav";
import { Button, Checkbox, Decision, Drawer, Explain, Fold, Input, Notice, PageTabs, StatusTag, useTabIds } from "@/app/components/rd";

const TYPE_LABEL: Record<string, string> = { HIGH: "敏感操作", WRITE: "修改", READ: "查看" };
const TYPE_ICON = { HIGH: ShieldAlert, WRITE: PenLine, READ: Eye } as const;
export const SENSITIVE_EXPLAIN = "权限清单里登记为「敏感操作」的权限，风险更高，比如放行资金、改账号和角色、紧急关停。";
export const AMPLIFIES_EXPLAIN = "登记时标的记号：这项权限对应的操作可能让平台多付钱。老数据没有记号的按「可能」算。授权时不做资金检查。";

export function TypeTag({ type }: { type: string }) {
  const Icon = TYPE_ICON[type as keyof typeof TYPE_ICON];
  return <StatusTag tone={type === "HIGH" ? "warn" : "neutral"} icon={Icon}>{TYPE_LABEL[type] ?? "未知类型"}</StatusTag>;
}

export function AmplifiesTag() {
  return <StatusTag tone="warn" icon={Coins}>可能多付钱</StatusTag>;
}

/** 权限的人话名：区域大使两项用专用名，其余用权限清单的名称，没有名称时写权限码。 */
export function permLabel(code: string, perm: A8Permission | undefined): string {
  const f4 = F4_MATERIAL_PERMISSIONS.find((item) => item.code === code)?.label;
  if (f4) return f4;
  return operatorCopyText(perm?.permissionName || code);
}

export function menuLabel(node: A7MenuTreeNode): string {
  return node.menuNameZh || node.menuName;
}

export function flattenMenus(tree: readonly A7MenuTreeNode[]): A7MenuTreeNode[] {
  const out: A7MenuTreeNode[] = [];
  const walk = (node: A7MenuTreeNode) => { out.push(node); node.children.forEach(walk); };
  tree.forEach(walk);
  return out;
}

export function setDiff<T>(before: readonly T[], after: readonly T[]) {
  const was = new Set(before);
  const now = new Set(after);
  return { added: after.filter((item) => !was.has(item)), removed: before.filter((item) => !now.has(item)) };
}

/**
 * 权限和菜单对不上（只用已读到的权限清单和菜单树算，不另读）：
 * - noPerm：勾了一个页面菜单，权限清单里这一页有权限，这个角色却一项都没有：看得到入口，进去没有权限。
 * - noMenu：有某一页的权限，这一页的菜单没勾：能做，但左侧导航里没有入口。
 */
export function grantMismatch(permCodes: Iterable<string>, menuIds: Iterable<number>, permByCode: ReadonlyMap<string, A8Permission>, menuById: ReadonlyMap<number, A7MenuTreeNode>) {
  const menus = new Set(menuIds);
  const pagesWithPerm = new Set<number>();
  const noMenu = new Map<number, string[]>();
  for (const code of permCodes) {
    const menuId = permByCode.get(code)?.menuId;
    if (menuId == null || !menuById.has(menuId)) continue;
    pagesWithPerm.add(menuId);
    if (!menus.has(menuId)) noMenu.set(menuId, [...(noMenu.get(menuId) ?? []), code]);
  }
  const catalogPages = new Set<number>();
  for (const perm of permByCode.values()) if (perm.menuId != null) catalogPages.add(perm.menuId);
  const noPerm = [...menus].filter((id) => {
    const node = menuById.get(id);
    return node !== undefined && node.parentId != null && catalogPages.has(id) && !pagesWithPerm.has(id);
  });
  return { noPerm, noMenu: [...noMenu.entries()].map(([menuId, codes]) => ({ menuId, codes })) };
}

export function MismatchNotice({ mismatch, menuById, title = "权限和菜单有对不上的地方" }: {
  mismatch: ReturnType<typeof grantMismatch>;
  menuById: ReadonlyMap<number, A7MenuTreeNode>;
  title?: ReactNode;
}) {
  const { noPerm, noMenu } = mismatch;
  if (!noPerm.length && !noMenu.length) return null;
  const name = (id: number) => { const node = menuById.get(id); return node ? menuLabel(node) : `菜单 ${id}`; };
  return (
    <Notice tone="warn" title={title}>
      {noPerm.length > 0 && (
        <p>
          {noPerm.length} 个页面勾了菜单、没有权限：点进去会提示没有权限
          <Explain label="勾了菜单没有权限的页面" rows={noPerm.map((id) => ({ k: "页面", v: name(id) }))} />
        </p>
      )}
      {noMenu.length > 0 && (
        <p>
          {noMenu.length} 个页面有权限、没勾菜单：导航里没有入口
          <Explain label="有权限没勾菜单的页面" rows={noMenu.map(({ menuId, codes }) => ({ k: name(menuId), v: `${codes.length} 项权限` }))} />
        </p>
      )}
    </Notice>
  );
}

/** 确认框和结果里列出加了、去掉的权限：按模块分组，每项写人话名和类型；多于 limit 项时其余收进折叠。 */
export function PermChangeList({ codes, permByCode, kind, limit = 8 }: { codes: readonly string[]; permByCode: ReadonlyMap<string, A8Permission>; kind: "add" | "remove" | "missing"; limit?: number }) {
  if (!codes.length) return null;
  const sorted = [...codes].sort((a, b) => {
    const pa = permByCode.get(a), pb = permByCode.get(b);
    const rank = (p?: A8Permission) => (p?.permType === "HIGH" ? 0 : 1) + (p?.amplifies === 1 ? 0 : 0.5);
    return rank(pa) - rank(pb) || a.localeCompare(b);
  });
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const list = (items: readonly string[]) => (
    <ul className="a6-change-list" data-kind={kind}>
      {items.map((code) => {
        const perm = permByCode.get(code);
        const domain = domainOfPermission(code);
        return (
          <li key={code} title={code}>
            <span className="a6-change-mark" aria-hidden>{kind === "add" ? "+" : kind === "remove" ? "−" : "·"}</span>
            <span className="a6-change-name">{permLabel(code, perm)}</span>
            <span className="a6-change-mod">{domain.code === "?" ? "其他" : `${domain.code} ${domain.name}`}</span>
            <span className="a6-change-tags">
              {perm && perm.permType !== "READ" && <TypeTag type={perm.permType} />}
              {perm?.amplifies === 1 && <AmplifiesTag />}
            </span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      {list(shown)}
      {rest.length > 0 && <Fold inset title={`还有 ${rest.length} 项`} summary={kind === "add" ? "加上的其余权限" : kind === "remove" ? "去掉的其余权限" : "其余没有的权限"}>{list(rest)}</Fold>}
    </>
  );
}

export function MenuChangeList({ ids, menuById, kind }: { ids: readonly number[]; menuById: ReadonlyMap<number, A7MenuTreeNode>; kind: "add" | "remove" }) {
  if (!ids.length) return null;
  return (
    <ul className="a6-change-list" data-kind={kind}>
      {ids.map((id) => {
        const node = menuById.get(id);
        const parent = node?.parentId != null ? menuById.get(node.parentId) : undefined;
        return (
          <li key={id}>
            <span className="a6-change-mark" aria-hidden>{kind === "add" ? "+" : "−"}</span>
            <span className="a6-change-name">{node ? menuLabel(node) : `菜单 ${id}`}</span>
            <span className="a6-change-mod">{parent ? menuLabel(parent) : node?.parentId == null ? "一级菜单" : "—"}</span>
            <span className="a6-change-tags">{node?.status === 0 && <StatusTag tone="warn" icon={TriangleAlert}>已停用</StatusTag>}</span>
          </li>
        );
      })}
    </ul>
  );
}

type Tab = "perms" | "menus";

/** 改权限和菜单：宽抽屉，上面一条改动汇总和提醒，下面「能做的操作」「能看的菜单」两个页签。 */
export function GrantsEditorDrawer({ detail, menuTree, allPerms, onClose, onSubmit }: {
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
  const [tab, setTab] = useState<Tab>("perms");
  const ids = useTabIds();

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
  const permByCode = useMemo(() => new Map(allPerms.map((perm) => [perm.permissionCode, perm])), [allPerms]);
  const allMenus = useMemo(() => flattenMenus(menuTree), [menuTree]);
  const menuById = useMemo(() => new Map(allMenus.map((node) => [node.id, node])), [allMenus]);

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
                (F4_MATERIAL_PERMISSIONS.find((item) => item.code === pp.permissionCode)?.label ?? pp.permissionName).toLowerCase().includes(q) ||
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

  // 下面全是显示用的统计：改动、敏感项、停用菜单、对不上、审计角色的写权限。
  const permDiff = setDiff(detail.permissionCodes, [...permSet]);
  const menuDiff = setDiff(detail.menuIds, [...menuSet]);
  const wasPerm = new Set(detail.permissionCodes);
  const wasMenu = new Set(detail.menuIds);
  const addedSensitive = permDiff.added.filter((code) => permByCode.get(code)?.permType === "HIGH").length;
  const addedAmplifies = permDiff.added.filter((code) => permByCode.get(code)?.amplifies === 1).length;
  const stoppedMenus = [...menuSet].filter((id) => menuById.get(id)?.status === 0);
  const mismatch = grantMismatch(permSet, menuSet, permByCode, menuById);
  const auditorWrites = detail.roleCode === "AUDITOR" ? [...permSet].filter((code) => { const t = permByCode.get(code)?.permType; return t === "WRITE" || t === "HIGH"; }).length : 0;
  const changed = permDiff.added.length + permDiff.removed.length + menuDiff.added.length + menuDiff.removed.length > 0;
  const allExpanded = menuCollapsed.size === 0;
  const submissionProblem = a6GrantsProblem(detail.roleCode, { permissionCodes: [...permSet], menuIds: [...menuSet] }, allMenus, allPerms);
  const parents = allMenus.filter((node) => node.children.length > 0).map((node) => node.id);

  const changeText = (added: number, removed: number) => added + removed === 0 ? "没改" : [added ? `加 ${added}` : "", removed ? `去 ${removed}` : ""].filter(Boolean).join(" · ");

  return (
    <Drawer open wide title="改权限和菜单" sub={<>{detail.roleName} · <span data-mono>{detail.roleCode}</span></>} onClose={onClose}
      explain="勾好后点「核对并提交」，在确认框里看加了哪些、去掉哪些，填理由提交审批。另一位管理员批准前，这个角色的权限和菜单都不变。"
      footer={<Decision note={changed ? `权限 ${changeText(permDiff.added.length, permDiff.removed.length)}，菜单 ${changeText(menuDiff.added.length, menuDiff.removed.length)}` : "还没有改动"}
        explain="提交的是勾选后的完整两组，一张审批单；批准后整组替换，批准前什么都不变。"
        others={<Button variant="secondary" onClick={onClose}>取消</Button>}
        primary={<Button variant="primary" disabledReason={submissionProblem ? displayAdminError(new Error(submissionProblem)) : undefined} onClick={() => {
          if (!submissionProblem) onSubmit({ permissionCodes: [...permSet], menuIds: [...menuSet] }, detail.permissionCodes.length, detail.menuIds.length);
        }}>核对并提交</Button>} />}>
      <div className="a6-grants">
        <dl className="a6-grants-sum" aria-label="改动汇总">
          <div><dt>权限</dt><dd><b>{detail.permissionCodes.length}</b><span aria-hidden>→</span><b data-changed={permDiff.added.length + permDiff.removed.length ? "" : undefined}>{permSet.size}</b> 项</dd><dd className="a6-grants-delta">{changeText(permDiff.added.length, permDiff.removed.length)}</dd></div>
          <div><dt>菜单</dt><dd><b>{detail.menuIds.length}</b><span aria-hidden>→</span><b data-changed={menuDiff.added.length + menuDiff.removed.length ? "" : undefined}>{menuSet.size}</b> 个</dd><dd className="a6-grants-delta">{changeText(menuDiff.added.length, menuDiff.removed.length)}</dd></div>
          <div><dt>新加的敏感操作<Explain label="敏感操作" content={SENSITIVE_EXPLAIN} /></dt><dd><b data-warn={addedSensitive ? "" : undefined}>{addedSensitive}</b> 项</dd><dd className="a6-grants-delta">{addedAmplifies ? `其中 ${addedAmplifies} 项可能多付钱` : " "}</dd></div>
        </dl>

        {detail.roleCode === "SUPER_ADMIN" && (
          <Notice tone="danger" title="超级管理员角色的权限和菜单不能修改，提交会被拒绝" />
        )}
        {detail.status === 0 && permDiff.added.length > 0 && (
          <Notice tone="warn" title="这个角色已停用">
            <p>批准后照常保存，启用这个角色后才生效。</p>
          </Notice>
        )}
        {auditorWrites > 0 && (
          <Notice tone="danger" title={`审计角色勾了 ${auditorWrites} 项修改或敏感权限`}>
            <p>审计角色只能有查看权限，这样提交不了：先取消这几项。</p>
          </Notice>
        )}
        {stoppedMenus.length > 0 && (
          <Notice tone="warn" title={`勾了 ${stoppedMenus.length} 个已停用的菜单`}>
            <p>提交会被整次拒绝：先取消勾选，或到「菜单管理」启用它。</p>
          </Notice>
        )}
        <MismatchNotice mismatch={mismatch} menuById={menuById} title="勾选后权限和菜单有对不上的地方" />

        <PageTabs label="改哪一组" level={2} ids={ids} value={tab} onChange={setTab} items={[
          { value: "perms", label: "能做的操作", count: `${permSet.size}/${allPerms.length}` },
          { value: "menus", label: "能看的菜单", count: `${menuSet.size}/${allMenus.length}` },
        ]} />

        {tab === "perms" && (
          <div {...ids.panel("perms")} className="a6-perm-pane">
            <label className="a6-search">
              <Search size={14} aria-hidden />
              <Input aria-label="权限搜索" data-search="" placeholder="搜权限名、权限码或页面，如 提现、A6" value={permQuery} onChange={(e) => setPermQuery(e.target.value)} />
            </label>
            <div className="a6-perm-grid">
              <nav className="a6-mods" aria-label="模块">
                {filteredGroups.map((g) => {
                  const codes = g.pages.flatMap((p) => p.perms.map((pp) => pp.permissionCode));
                  const selCnt = codes.filter((c) => permSet.has(c)).length;
                  const touched = codes.some((c) => permSet.has(c) !== wasPerm.has(c));
                  return (
                    <button type="button" key={g.domain.code} className="a6-mod" aria-current={g.domain.code === activeGroup?.domain.code ? "true" : undefined}
                      onClick={() => setSelectedDomain(g.domain.code)}>
                      <span className="a6-mod-code">{g.domain.code}</span>
                      <span className="a6-mod-name">{g.domain.name}</span>
                      {touched && <span className="a6-mod-dot" aria-label="有改动" />}
                      <span className="a6-mod-count" data-empty={selCnt === 0 ? "" : undefined}>{selCnt}/{codes.length}</span>
                    </button>
                  );
                })}
                {!filteredGroups.length && <p className="a6-muted">{allPerms.length ? "没有匹配的模块" : "正在加载权限…"}</p>}
              </nav>

              <div className="a6-perm-pages">
                {activeGroup ? (() => {
                  const domCodes = activeGroup.pages.flatMap((p) => p.perms.map((pp) => pp.permissionCode));
                  const domAllOn = domCodes.length > 0 && domCodes.every((c) => permSet.has(c));
                  return (
                    <>
                      <div className="a6-mod-head">
                        <h3>{activeGroup.domain.code} {activeGroup.domain.name}</h3>
                        <span className="a6-mod-count">已选 {domCodes.filter((c) => permSet.has(c)).length}/{domCodes.length}</span>
                        <Button variant="ghost" onClick={() => togglePermGroup(domCodes, domAllOn)}>{domAllOn ? "全部取消" : "全选本模块"}</Button>
                      </div>
                      {activeGroup.pages.map((p) => {
                        const pageKey = `${activeGroup.domain.code}:${p.l2.id}`;
                        const pageCodes = p.perms.map((pp) => pp.permissionCode);
                        const pageAllOn = pageCodes.length > 0 && pageCodes.every((c) => permSet.has(c));
                        const pageSel = pageCodes.filter((c) => permSet.has(c)).length;
                        const pgOpen = pageExpanded.has(pageKey) || !!q;
                        return (
                          <section key={pageKey} className="a6-page-group">
                            <div className="a6-page-head">
                              <button type="button" className="a6-page-toggle" aria-expanded={pgOpen} onClick={() => togglePage(pageKey)}>
                                {pgOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                                <span className="a6-page-name">{p.l2.name}</span>
                                <span className="a6-page-id">{p.l2.id}</span>
                              </button>
                              <span className="a6-mod-count" data-empty={pageSel === 0 ? "" : undefined}>{pageSel}/{pageCodes.length}</span>
                              <Button variant="ghost" onClick={() => togglePermGroup(pageCodes, pageAllOn)}>{pageAllOn ? "全部取消" : "全选"}</Button>
                            </div>
                            {pgOpen && (
                              <div className="a6-perm-items">
                                {p.perms.map((pp) => {
                                  const on = permSet.has(pp.permissionCode);
                                  const delta = on === wasPerm.has(pp.permissionCode) ? undefined : on ? "add" : "remove";
                                  return (
                                    <label key={pp.permissionCode} className="a6-perm" title={pp.permissionCode} data-on={on ? "" : undefined} data-delta={delta}>
                                      <Checkbox checked={on} onChange={() => togglePerm(pp.permissionCode)} />
                                      <span className="a6-perm-text">
                                        <span className="a6-perm-name">{permLabel(pp.permissionCode, pp)}</span>
                                        <span className="a6-perm-code">{pp.permissionCode}</span>
                                      </span>
                                      <span className="a6-perm-tags">
                                        {delta && <span className="a6-delta" data-kind={delta}>{delta === "add" ? "新加" : "去掉"}</span>}
                                        <TypeTag type={pp.permType} />
                                        {pp.amplifies === 1 && <AmplifiesTag />}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </>
                  );
                })() : <p className="a6-muted">{allPerms.length ? "没有匹配的权限" : "正在加载权限…"}</p>}
              </div>
            </div>
          </div>
        )}

        {tab === "menus" && (
          <div {...ids.panel("menus")} className="a6-menu-pane">
            <div className="a6-menu-tools">
              <span className="a6-muted">勾上一级菜单会带上它下面的全部页面，不会自动勾上一级</span>
              <Button variant="ghost" onClick={() => setMenuCollapsed(allExpanded ? new Set(parents) : new Set())}>{allExpanded ? "全部收起" : "全部展开"}</Button>
            </div>
            <div className="a6-menu-tree" role="group" aria-label="能看的菜单">
              {menuTree.map((node) => (
                <MenuCheckRow key={node.id} node={node} depth={0} menuSet={menuSet} was={wasMenu} collapsed={menuCollapsed}
                  onToggleCollapse={(id) => setMenuCollapsed((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                  onToggle={toggleMenu} />
              ))}
              {!menuTree.length && <p className="a6-muted">正在加载菜单…</p>}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

const DOMAIN_ICON = new Map(CONSOLE_NAV.map((domain) => [domain.code, domain.icon]));

function MenuCheckRow({ node, depth, menuSet, was, collapsed, onToggleCollapse, onToggle }: {
  node: A7MenuTreeNode;
  depth: number;
  menuSet: Set<number>;
  was: Set<number>;
  collapsed: Set<number>;
  onToggleCollapse: (id: number) => void;
  onToggle: (node: A7MenuTreeNode, checked: boolean) => void;
}) {
  const hasChildren = node.children.length > 0;
  const checked = menuSet.has(node.id);
  const isOpen = !collapsed.has(node.id);
  const Icon = depth === 0 ? DOMAIN_ICON.get(node.menuCode) : undefined;
  const picked = hasChildren ? node.children.filter((child) => menuSet.has(child.id)).length : 0;
  const delta = checked === was.has(node.id) ? undefined : checked ? "add" : "remove";
  return (
    <div className="a6-mnode" data-depth={depth}>
      <div className="a6-mrow" data-delta={delta}>
        {hasChildren
          ? <button type="button" className="a6-mtoggle" aria-expanded={isOpen} aria-label={`${isOpen ? "收起" : "展开"} ${menuLabel(node)}`} onClick={() => onToggleCollapse(node.id)}>
              {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            </button>
          : <span className="a6-mtoggle" aria-hidden />}
        <label className="a6-mlabel">
          <Checkbox checked={checked} indeterminate={!checked && picked > 0} onChange={(e) => onToggle(node, e.target.checked)} />
          {depth === 0 && (Icon ? <Icon size={14} aria-hidden className="a6-micon" /> : <span className="a6-micon" aria-hidden />)}
          <span className="a6-mname" data-root={depth === 0 ? "" : undefined}>{menuLabel(node)}</span>
          <span className="a6-mcode">{node.menuCode}</span>
        </label>
        <span className="a6-mtags">
          {delta && <span className="a6-delta" data-kind={delta}>{delta === "add" ? "新加" : "去掉"}</span>}
          {node.status === 0 && <StatusTag tone={checked ? "warn" : "neutral"} icon={checked ? TriangleAlert : undefined}>已停用</StatusTag>}
          {hasChildren && <span className="a6-mod-count" data-empty={picked === 0 ? "" : undefined}>{picked}/{node.children.length}</span>}
        </span>
      </div>
      {hasChildren && isOpen && node.children.map((c) => (
        <MenuCheckRow key={c.id} node={c} depth={depth + 1} menuSet={menuSet} was={was} collapsed={collapsed} onToggleCollapse={onToggleCollapse} onToggle={onToggle} />
      ))}
    </div>
  );
}
