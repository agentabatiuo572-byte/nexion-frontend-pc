"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import "../a-domain.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check as CheckIcon, Coins, Eye, KeyRound, PenLine, ShieldAlert, Users } from "lucide-react";
import { fetchA8Permissions, fetchA8PermissionDetail, type A8Permission, type A8PermissionPage } from "@/lib/admin/a8-client";
import { fetchA6RolesOverview, fetchA6RoleDetail, type A6RoleSummary } from "@/lib/admin/a6-client";
import {
  BlockState, Button, Cell, Conclusion, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Input, JudgmentPoints, Notice,
  PageHeader, Pager, Panel, RdPage, Segments, Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import { useToast } from "@/app/components/domain-views/design-kit";
import { CONSOLE_NAV } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { displayAdminReadError } from "@/lib/admin/error-messages";

const DOMAINS = [{ code: "ALL", label: "全部" }, ...CONSOLE_NAV.map((d) => ({ code: d.code, label: `${d.code} ${d.name}` })), { code: "UNMAPPED", label: "未归类" }];
const PERM_TYPES = ["ALL", "READ", "WRITE", "HIGH"];
const LABEL_BY_TYPE: Record<string, string> = { HIGH: "敏感操作", WRITE: "修改", READ: "查看" };
const ICON_BY_TYPE = { HIGH: ShieldAlert, WRITE: PenLine, READ: Eye } as const;
const PAGE_SIZES = [10, 20, 50] as const;
const ROLE_CHIPS = 2;
const ROLES_PATH = "/platform/roles";

type RoleGrants = { role: A6RoleSummary; codes: Set<string>; readable: boolean };

function TypeTag({ type }: { type: string }) {
  const Icon = ICON_BY_TYPE[type as keyof typeof ICON_BY_TYPE];
  return <StatusTag tone={type === "HIGH" ? "warn" : "neutral"} icon={Icon}>{LABEL_BY_TYPE[type] || "未知类型"}</StatusTag>;
}

const AMPLIFIES_EXPLAIN = "登记时标的记号：这项权限对应的操作可能让平台多付钱。老数据没有记号的按「可能」算。这页不做资金检查。";

/** A8 权限清单（只读）。服务端分页 + 搜索 debounce + 模块和类型筛选 + 详情抽屉 + 按需读取的角色对照。 */
export default function A8Permissions() {
  const [toast, setToast] = useToast();
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [domain, setDomain] = useState("ALL");
  const [permType, setPermType] = useState("ALL");
  const [result, setResult] = useState<A8PermissionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detail, setDetail] = useState<A8Permission | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestSeq = useRef(0);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [grants, setGrants] = useState<RoleGrants[] | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  // 重试必须用自增计数器,不能靠「把 grants 设回 null」——失败时它本来就是 null,
  // 依赖数组按 Object.is 比不出变化,effect 根本不会重跑,界面却从报错切成
  // 「没有可展示的角色」,比不重试更误导。同页主列表(reloadKey)早就是这个写法。
  const [matrixReloadKey, setMatrixReloadKey] = useState(0);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "matrix">("list");
  const reach = useReach();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    // 翻页、换筛选时不先清上一份：表格换成占位，分页条留着上一份的总数、翻页禁用（ST-13、ST-32）。读失败才清。
    fetchA8Permissions({ pageNum, pageSize, keyword, domain, permType })
      .then((data) => { if (!cancelled) setResult(data); })
      .catch((err) => {
        // 失败只写在列表那一块的失败卡里，不再弹提示条（ST-34、ST-57）。
        if (!cancelled) { setResult(null); setLoadError(displayAdminReadError(err)); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pageNum, pageSize, keyword, domain, permType, reloadKey, setToast]);

  // 矩阵按需拉:每个角色的授权明细要单独一次请求,不开矩阵就不发。
  useEffect(() => {
    if (!matrixOpen) return;
    let cancelled = false;
    setMatrixLoading(true);
    setMatrixError(null);
    setGrants(null);
    fetchA6RolesOverview()
      .then(async (overview) => {
        if (cancelled) return [];
        // 某个角色读不到时只让那一列变「读不到」,不能让它显示成「没这个权限」。
        const details = await Promise.allSettled(overview.roles.map((role) => fetchA6RoleDetail(role.id)));
        return overview.roles.map((role, index) => {
          const settled = details[index];
          return settled?.status === "fulfilled"
            ? { role, codes: new Set(settled.value.permissionCodes), readable: true }
            : { role, codes: new Set<string>(), readable: false };
        });
      })
      .then((rows) => { if (!cancelled) setGrants(rows); })
      .catch((err) => { if (!cancelled) setMatrixError(displayAdminReadError(err)); })
      .finally(() => { if (!cancelled) setMatrixLoading(false); });
    return () => { cancelled = true; };
  }, [matrixOpen, matrixReloadKey]);

  // keyword debounce 300ms（ST-17）
  useEffect(() => {
    const t = setTimeout(() => { setKeyword(keywordInput.trim()); setPageNum(1); }, 300);
    return () => clearTimeout(t);
  }, [keywordInput]);

  const openDetail = (code: string) => {
    if (!code) return;
    const requestId = ++detailRequestSeq.current;
    setDetailCode(code);
    setDetailLoading(true);
    setDetail(null);
    fetchA8PermissionDetail(code)
      .then((d) => { if (requestId === detailRequestSeq.current) setDetail(d); })
      .catch((err) => {
        if (requestId === detailRequestSeq.current) {
          setToast(displayAdminReadError(err));
        }
      })
      .finally(() => {
        if (requestId === detailRequestSeq.current) setDetailLoading(false);
      });
  };
  const closeDetail = () => {
    detailRequestSeq.current += 1;
    setDetail(null);
    setDetailLoading(false);
    setDetailCode(null);
  };

  // 加载中表格是占位：上一份的行不显示，也不给抽屉的上一条、下一条用。
  const records = loading ? [] : result?.records ?? [];
  const total = result?.total ?? 0;
  const filtered = keyword !== "" || keywordInput.trim() !== "" || domain !== "ALL" || permType !== "ALL";
  const clearFilters = () => { setKeywordInput(""); setDomain("ALL"); setPermType("ALL"); setPageNum(1); };
  const rolesReady = matrixOpen && !matrixLoading && !matrixError && grants !== null;
  const unreadableRoles = rolesReady ? grants.filter(({ readable }) => !readable) : [];
  const drawerOpen = Boolean(detail || detailLoading);
  const current = drawerOpen ? detailCode : null;
  const currentIndex = current ? records.findIndex((p) => p.permissionCode === current) : -1;
  const domainLabel = DOMAINS.find((d) => d.code === domain)?.label ?? domain;
  const rolesHref = reach(ROLES_PATH, "platform_a6_read") ? ROLES_PATH : null;

  const rolesWith = (code: string) => (grants ?? []).filter(({ readable, codes }) => readable && codes.has(code));
  const roleChip = ({ role }: RoleGrants) => {
    const label = <>{role.roleName}{role.status === 0 && <span className="a8-role-off">已停用</span>}</>;
    return rolesHref
      ? <Link key={role.id} className="a8-role" href={`${rolesHref}?roleId=${role.id}`} prefetch={false} aria-label={`去角色管理看「${role.roleName}」`}>{label}</Link>
      : <span key={role.id} className="a8-role">{label}</span>;
  };

  const rolesCell = (p: A8Permission) => {
    if (matrixOpen && matrixLoading) return <span className="rd-skeleton a8-role-skel" aria-label="正在加载角色" />;
    if (!rolesReady) {
      return <Cell num main={<span className={p.boundRoleCount === 0 ? "a8-muted" : undefined}>{p.boundRoleCount} 个角色</span>}
        sub={matrixOpen && matrixError ? "角色名没读到" : undefined} />;
    }
    const has = rolesWith(p.permissionCode);
    const rest = has.slice(ROLE_CHIPS);
    return (
      <span className="a8-roles">
        {has.length === 0 && unreadableRoles.length === 0 && <span className="a8-muted">没有角色</span>}
        {has.slice(0, ROLE_CHIPS).map(roleChip)}
        {rest.length > 0 && <Explain label={`另外 ${rest.length} 个角色`} content={rest.map(({ role }) => `${role.roleName}${role.status === 0 ? "（已停用）" : ""}`).join("、")}>等 {has.length} 个</Explain>}
        {unreadableRoles.length > 0 && <span className="a8-role" data-tone="warn" title={`${unreadableRoles.length} 个角色的授权没读到，不代表没有这项权限`}>? {unreadableRoles.length} 个没读到</span>}
      </span>
    );
  };

  const countText = loading ? "正在加载…" : loadError ? "数量没读到" : `共 ${total} 条`;

  // 首次加载不写结论；翻页、换筛选在途时写在途，不拿上一份的数说现在的筛选（CP-90）。
  const conclusion = loading ? result && <Conclusion state="unknown" icon={KeyRound}>正在加载权限列表…</Conclusion> : loadError ? (
    <Conclusion state="unknown" icon={KeyRound}>权限列表没读到，这页没有判断</Conclusion>
  ) : (
    <Conclusion state="neutral" icon={KeyRound}
      explain="只算启用中的权限；数量跟着搜索和筛选变。权限由运营账号与权限登记，授权在角色管理。">
      {filtered ? `当前筛选下有 ${total} 项权限` : `共 ${total} 项已登记的权限`}
    </Conclusion>
  );

  return (
    <RdPage className="a8-page">
      {toast}
      <PageHeader pageId="A8" title="权限清单" summary="查一个权限管什么、风险多大、哪些角色有它。"
        readOnly="这页只能查看；登记和授权在别的页面" />
      {conclusion}

      <FilterBar onClear={clearFilters} canClear={filtered}
        scope={<div className="rd-filter-scope-row a8-scope">
          <Segments label="权限类型" value={permType} onChange={(t) => { setPermType(t); setPageNum(1); }}
            items={PERM_TYPES.map((t) => ({ value: t, label: t === "ALL" ? "全部类型" : LABEL_BY_TYPE[t] }))} />
          {matrixOpen && <Segments label="怎么看" value={view} onChange={setView}
            items={[{ value: "list", label: "权限列表" }, { value: "matrix", label: "角色对照表" }]} />}
        </div>}
        sort={<Button icon={<Users size={14} aria-hidden />} aria-pressed={matrixOpen}
          onClick={() => { setView(matrixOpen ? "list" : "matrix"); setMatrixOpen((open) => !open); }}>{matrixOpen ? "收起对照表" : "展开对照表"}</Button>}>
        <FilterField grow><Input aria-label="权限搜索" placeholder="搜索权限编码或名称" value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} /></FilterField>
        <FilterField><Select aria-label="模块筛选" value={domain} onChange={(d) => { setDomain(d); setPageNum(1); }}
          options={DOMAINS.map((d) => ({ value: d.code, label: d.code === "ALL" ? "全部模块" : d.label }))} /></FilterField>
      </FilterBar>

      {view === "matrix" && matrixOpen ? (
        <Panel flush icon={Users} title="角色权限对照表"
          sub={rolesReady && records.length > 0 && grants.length > 0 ? `本页 ${records.length} 项权限 × ${grants.length} 个角色` : countText}
          explain={`横向是角色，纵向是列表当前页的${!loading && !loadError ? ` ${records.length} 项` : ""}权限，打勾表示该角色有这项权限。包括已停用的角色。翻页只换行，角色的授权不重新读取；要最新的就收起再展开。`}>
          {loading ? <BlockState state="loading" title="正在加载…" /> : loadError ? <BlockState state="error" title="权限列表加载失败" detail={loadError} retryKey="a8-records" onRetry={() => setReloadKey((value) => value + 1)} /> : <>
          {matrixLoading ? (
              <BlockState state="loading" title="正在加载…" detail="要逐个读取每个角色的授权，角色多时要等几秒。" />
            ) : matrixError ? (
              <BlockState state="error" title="各角色的权限加载失败，对照表暂不可信。" detail={matrixError} retryKey="a8-matrix" onRetry={() => setMatrixReloadKey((value) => value + 1)} />
            ) : !grants || grants.length === 0 ? (
              <BlockState state="empty" title="没有可展示的角色" />
            ) : records.length === 0 ? (
              <BlockState state="empty" title="当前筛选下没有权限" />
            ) : (
              <>
                {unreadableRoles.length > 0 && (
                  <Notice tone="warn" title={`${unreadableRoles.length} 个角色的权限没读到`}>
                    部分角色的权限没加载出来，标「?」的列不代表没有权限，请刷新后再看。
                  </Notice>
                )}
                <Table label="角色权限对照表" className="a8-matrix">
                  <thead><tr>
                    <Th sticky="start">权限</Th>
                    {grants.map(({ role, readable }) => (
                      <Th key={role.id} className="a8-matrix-role">
                        <span className="a8-matrix-head">
                          <span>{role.roleName}</span>
                          <span className="a8-matrix-code">{role.roleCode}</span>
                          {role.status === 0 && <span className="a8-role-off">已停用</span>}
                          {!readable && <span className="a8-matrix-fail">加载失败</span>}
                        </span>
                      </Th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {records.map((p) => (
                      <Tr key={p.permissionCode}>
                        <Td sticky="start"><Cell title={`${operatorCopyText(p.permissionName || p.permissionCode)}\n${p.permissionCode}`} main={operatorCopyText(p.permissionName || p.permissionCode)} sub={<span data-mono>{p.permissionCode}</span>} /></Td>
                        {grants.map(({ role, codes, readable }) => (
                          <Td key={role.id} className="a8-matrix-cell"
                            title={!readable ? `${role.roleName} 的权限加载失败，这一格不代表没有权限` : codes.has(p.permissionCode) ? `${role.roleName} 有此权限` : `${role.roleName} 没有此权限`}>
                            {!readable
                              ? <span className="a8-mark" data-mark="unknown" aria-label={`${role.roleName} 的权限加载失败，这一格不代表没有权限`}>?</span>
                              : codes.has(p.permissionCode)
                                ? <span className="a8-mark" data-mark="yes" aria-label={`${role.roleName} 有此权限`}><CheckIcon size={14} aria-hidden /></span>
                                : <span className="a8-mark" data-mark="no" aria-label={`${role.roleName} 没有此权限`}>—</span>}
                          </Td>
                        ))}
                      </Tr>
                    ))}
                  </tbody>
                </Table>
                <p className="a8-legend"><span className="a8-mark" data-mark="yes"><CheckIcon size={12} aria-hidden /></span>有这项权限<span className="a8-mark" data-mark="no">—</span>没有<span className="a8-mark" data-mark="unknown">?</span>没读到，不代表没有</p>
              </>
            )}
          </>}
        {!loadError && result && <Pager label="权限清单" total={total} page={pageNum} pageSize={pageSize} sizes={PAGE_SIZES} loading={loading}
          onPage={setPageNum} onPageSize={(s) => { setPageSize(s); setPageNum(1); }} />}
        </Panel>
      ) : (
        <Panel flush icon={KeyRound} title={domain === "ALL" ? "权限列表" : `${domainLabel}的权限`} sub={countText}
          explain="点一行看这项权限的详情。哪些角色有它：先显示绑定的角色数，点右上「展开对照表」读出每个角色后显示角色名。">
        {/* 读取失败用共用失败卡，不写在表格行里：重试中焦点留在这一块，仍失败回到「重试」，读到落在这块面板（ST-34、ST-35、BUG-710）。 */}
        {loadError && !loading ? <BlockState state="error" title="权限列表加载失败" detail={loadError} retryKey="a8-records" onRetry={() => setReloadKey((value) => value + 1)} /> : (
        <Table label="权限清单" aria-busy={loading} className="a8-table">
          <thead><tr>
            <Th>权限</Th>
            <Th><Explain label="类型怎么分" rows={[
              { k: "查看", v: "只能看这一页或这类数据" },
              { k: "修改", v: "能改数据或配置" },
              { k: "敏感操作", v: "风险更高的修改，比如动钱、动权限" },
            ]}>允许做什么</Explain></Th>
            <Th><Explain label="资金风险是什么" content={AMPLIFIES_EXPLAIN}>资金风险</Explain></Th>
            <Th><Explain label="角色数怎么算" content="角色数只算启用中的角色。对照表里也列出已停用的角色，所以打勾的角色可能更多。">哪些角色有</Explain></Th>
          </tr></thead>
          <tbody>
            {loading ? <TableLoading columns={4} rows={Math.min(pageSize, 10)} />
                : records.length === 0 ? <TableMessage columns={4} role="status">
                  {filtered ? <>无匹配权限：换个关键词，或把模块、类型改回全部。 <Button size="sm" onClick={clearFilters}>清除筛选</Button></> : "无匹配权限"}
                </TableMessage>
                  : records.map((p) => (
                    <Tr key={p.permissionCode} selected={p.permissionCode === current} onOpen={() => openDetail(p.permissionCode)}>
                      <Td><Cell title={`${operatorCopyText(p.permissionName || p.permissionCode)}\n${p.permissionCode}`}
                        main={<button type="button" className="rd-cell-link" aria-label={`查看权限详情 ${p.permissionCode}`} aria-haspopup="dialog"
                          onClick={(event) => { event.stopPropagation(); openDetail(p.permissionCode); }}>{operatorCopyText(p.permissionName || "—")}</button>}
                        sub={<span data-mono>{p.permissionCode}</span>} /></Td>
                      <Td><Cell main={<TypeTag type={p.permType} />} sub={operatorCopyText(p.menuCodePath)} title={operatorCopyText(p.menuCodePath)} /></Td>
                      <Td><Cell main={p.amplifies ? <StatusTag tone="warn" icon={Coins}>可能多付钱</StatusTag> : <span className="a8-muted">—</span>} /></Td>
                      <Td>{rolesCell(p)}</Td>
                    </Tr>
                  ))}
          </tbody>
        </Table>
        )}
        {!loadError && result && <Pager label="权限清单" total={total} page={pageNum} pageSize={pageSize} sizes={PAGE_SIZES} loading={loading}
          onPage={setPageNum} onPageSize={(s) => { setPageSize(s); setPageNum(1); }} />}
        </Panel>
      )}

      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {reach("/platform/rbac") && <Link className="rd-link" href="/platform/rbac" prefetch={false}>运营账号与权限</Link>}
        {rolesHref && <Link className="rd-link" href={rolesHref} prefetch={false}>角色管理</Link>}
        {reach("/platform/menus") && <Link className="rd-link" href="/platform/menus" prefetch={false}>菜单管理</Link>}
      </nav>

      <Drawer open={drawerOpen} onClose={closeDetail} icon={KeyRound} tone="role-3"
        title="权限详情"
        sub={detail ? operatorCopyText(detail.permissionName || detail.permissionCode) : current ?? undefined}
        explain="每次打开都重新读取这项权限，可能和列表里的略有不同。这里只能查看。"
        nav={{ hasPrev: currentIndex > 0, hasNext: currentIndex >= 0 && currentIndex < records.length - 1,
          onPrev: () => openDetail(records[currentIndex - 1].permissionCode), onNext: () => openDetail(records[currentIndex + 1].permissionCode) }}>
        {detailLoading || !detail ? <JudgmentPoints loading rows={[]} /> : (
          <>
            <JudgmentPoints rows={[
              { label: "允许做什么", value: <span className="a8-allow"><TypeTag type={detail.permType} />{operatorCopyText(detail.description ?? detail.menuCodePath)}</span> },
              { label: "资金风险", value: detail.amplifies ? <StatusTag tone="warn" icon={Coins} explain={AMPLIFIES_EXPLAIN}>可能多付钱</StatusTag> : "没有标记", state: detail.amplifies ? "warn" : undefined },
              { label: "已绑定角色", value: rolesReady && unreadableRoles.length === 0
                ? <span className="a8-roles">{rolesWith(detail.permissionCode).length === 0 ? <span className="a8-muted">没有角色</span> : rolesWith(detail.permissionCode).map(roleChip)}</span>
                : <span className="a8-allow">{detail.boundRoleCount} 个（启用中的角色）{!matrixOpen && <Button size="sm" onClick={() => setMatrixOpen(true)}>看是哪几个</Button>}</span> },
            ]} />
            <Facts>
              <Fact k="权限编码"><span data-mono>{detail.permissionCode}</span></Fact>
              <Fact k="所属菜单">{operatorCopyText(detail.menuCodePath)}</Fact>
              <Fact k="登记的资源路径"><span data-mono>{detail.resourcePath || "—"}</span></Fact>
            </Facts>
            <nav className="rd-links" aria-label="去别的页面">
              {rolesHref && <Link className="rd-link" href={rolesHref} prefetch={false}>去角色管理看各角色的授权 →</Link>}
              {reach("/platform/rbac") && <Link className="rd-link" href="/platform/rbac" prefetch={false}>去运营账号与权限登记权限 →</Link>}
            </nav>
          </>
        )}
      </Drawer>
    </RdPage>
  );
}
