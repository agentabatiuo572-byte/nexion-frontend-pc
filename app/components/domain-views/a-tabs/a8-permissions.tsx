"use client";
import "../a-domain.css";
import { useEffect, useRef, useState } from "react";
import { fetchA8Permissions, fetchA8PermissionDetail, type A8Permission, type A8PermissionPage } from "@/lib/admin/a8-client";
import { fetchA6RolesOverview, fetchA6RoleDetail, type A6RoleSummary } from "@/lib/admin/a6-client";
import { Card, CardH, CodeTag, Chip, Badge, Btn, Drawer, DataListPager, useToast } from "@/app/components/domain-views/design-kit";
import { DomainHeader } from "../domain-header";
import { CONSOLE_NAV } from "@/lib/nav/console-nav";
import { displayAdminError } from "@/lib/admin/error-messages";

const DOMAINS = [{ code: "ALL", label: "全部" }, ...CONSOLE_NAV.map((d) => ({ code: d.code, label: `${d.code} ${d.name}` })), { code: "UNMAPPED", label: "未归类" }];
const PERM_TYPES = ["ALL", "READ", "WRITE", "HIGH"];
const TONE_BY_TYPE: Record<string, string> = { HIGH: "danger", WRITE: "warn", READ: "ok" };
const LABEL_BY_TYPE: Record<string, string> = { HIGH: "高敏操作", WRITE: "写操作", READ: "只读" };

type RoleGrants = { role: A6RoleSummary; codes: Set<string>; readable: boolean };

/** A8 权限字典（只读）。服务端分页 + 搜索 debounce + 域 tab + 类型筛选 + 详情 drawer + 角色矩阵。 */
export default function A8Permissions() {
  const [toast, setToast] = useToast();
  const [pageNum, setPageNum] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [domain, setDomain] = useState("ALL");
  const [permType, setPermType] = useState("ALL");
  const [result, setResult] = useState<A8PermissionPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detail, setDetail] = useState<A8Permission | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestSeq = useRef(0);
  const [matrixOpen, setMatrixOpen] = useState(false);
  const [grants, setGrants] = useState<RoleGrants[] | null>(null);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setResult(null);
    fetchA8Permissions({ pageNum, pageSize, keyword, domain, permType })
      .then((data) => { if (!cancelled) setResult(data); })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(displayAdminError(err));
          setToast("权限目录加载失败，当前数据不可确认，请重试");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pageNum, pageSize, keyword, domain, permType, reloadKey, setToast]);

  // 矩阵按需拉:每个角色的授权明细要单独一次请求,不开矩阵就不发。
  useEffect(() => {
    if (!matrixOpen || grants) return;
    let cancelled = false;
    setMatrixLoading(true);
    setMatrixError(null);
    fetchA6RolesOverview()
      .then(async (overview) => {
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
      .catch((err) => { if (!cancelled) setMatrixError(displayAdminError(err)); })
      .finally(() => { if (!cancelled) setMatrixLoading(false); });
    return () => { cancelled = true; };
  }, [matrixOpen, grants]);

  // keyword debounce 350ms
  useEffect(() => {
    const t = setTimeout(() => { setKeyword(keywordInput.trim()); setPageNum(1); }, 350);
    return () => clearTimeout(t);
  }, [keywordInput]);

  const openDetail = (code: string) => {
    if (!code) return;
    const requestId = ++detailRequestSeq.current;
    setDetailLoading(true);
    setDetail(null);
    fetchA8PermissionDetail(code)
      .then((d) => { if (requestId === detailRequestSeq.current) setDetail(d); })
      .catch((err) => {
        if (requestId === detailRequestSeq.current) {
          setToast(err instanceof Error ? err.message : "权限详情加载失败，请重试");
        }
      })
      .finally(() => {
        if (requestId === detailRequestSeq.current) setDetailLoading(false);
      });
  };

  const records = result?.records ?? [];
  const total = result?.total ?? 0;

  return (
    <div className="dkpage adom">
      {toast}
      <DomainHeader domainCode="A" domainName="平台基础" accentVar="--admin-domain-a"
        l2Id="A8" l2Name="权限字典"
        summary="全平台权限码只读浏览。权限分为只读、写操作和高敏操作，由平台统一维护，本页不支持增删。"
        right={<span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>{loading ? "正在统计…" : `共 ${total} 条`}</span>} />
      <Card>
        <CardH title="权限列表" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <input
            aria-label="权限搜索"
            placeholder="搜索权限值 / 中文名"
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            style={{ flex: "1 1 240px", minWidth: 200, padding: "8px 12px", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 8, color: "var(--ink)" }}
          />
          <div className="row" style={{ gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--ink-3)", fontSize: 12 }}>域:</span>
            {DOMAINS.map((d) => (
              <Chip key={d.code} sel={domain === d.code} tab onClick={() => { setDomain(d.code); setPageNum(1); }}>{d.label}</Chip>
            ))}
          </div>
          <div className="row" style={{ gap: 4, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: "var(--ink-3)", fontSize: 12 }}>类型:</span>
            {PERM_TYPES.map((t) => (
              <Chip key={t} sel={permType === t} tab onClick={() => { setPermType(t); setPageNum(1); }}>{t === "ALL" ? "全部" : LABEL_BY_TYPE[t]}</Chip>
            ))}
          </div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface-2)", color: "var(--ink-3)", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", fontWeight: 600 }}>权限值</th>
              <th style={{ padding: "10px 12px", fontWeight: 600 }}>中文名</th>
              <th style={{ padding: "10px 12px", fontWeight: 600, width: 80 }}>类型</th>
              <th style={{ padding: "10px 12px", fontWeight: 600 }}>所属菜单</th>
              <th style={{ padding: "10px 12px", fontWeight: 600, width: 70 }}>放大</th>
              <th style={{ padding: "10px 12px", fontWeight: 600, width: 90 }}>绑定角色</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>加载中…</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: "center" }}>
                <div className="alertbar warn" role="alert" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  权限目录加载失败，当前没有可确认的数据。<Btn sm onClick={() => setReloadKey((value) => value + 1)}>重试</Btn>
                </div>
              </td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>无匹配权限</td></tr>
            ) : records.map((p) => (
              <tr key={p.permissionCode} onClick={() => openDetail(p.permissionCode)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "10px 12px" }}><CodeTag>{p.permissionCode}</CodeTag></td>
                <td style={{ padding: "10px 12px" }}>{p.permissionName || "—"}</td>
                <td style={{ padding: "10px 12px" }}><Badge tone={TONE_BY_TYPE[p.permType] || "neutral"}>{LABEL_BY_TYPE[p.permType] || "未知类型"}</Badge></td>
                <td style={{ padding: "10px 12px" }}><span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{p.menuCodePath}</span></td>
                <td style={{ padding: "10px 12px", textAlign: "center" }}>{p.amplifies ? <span title="放大资金流出·受 B1 红线约束">⚠️</span> : "—"}</td>
                <td style={{ padding: "10px 12px" }}><span className="mono">{p.boundRoleCount}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loadError && <DataListPager
          label="权限字典"
          page={pageNum}
          pageSize={pageSize}
          total={total}
          onPageChange={setPageNum}
          onPageSizeChange={(s) => { setPageSize(s); setPageNum(1); }}
        />}
      </Card>
      <Card>
        <CardH title="权限矩阵" right={
          <Btn sm onClick={() => setMatrixOpen((open) => !open)}>{matrixOpen ? "收起矩阵" : "一屏看哪些角色有权"}</Btn>
        } />
        {matrixOpen && (
          <div style={{ padding: "12px 16px" }}>
            <div className="tint tiny" style={{ marginBottom: 10 }}>
              横排是角色,竖排是当前这一页的权限(共 {records.length} 条,跟着上面的搜索和筛选走)。
              打勾 = 该角色有这个权限。要看别的权限就先在上面筛。
            </div>
            {matrixLoading ? (
              <div style={{ padding: 20, color: "var(--ink-3)" }}>正在读取各角色的授权明细…</div>
            ) : matrixError ? (
              <div className="alertbar warn" role="alert" style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                角色授权读取失败,矩阵不可信。{matrixError}
                <Btn sm onClick={() => { setGrants(null); setMatrixError(null); }}>重试</Btn>
              </div>
            ) : !grants || grants.length === 0 ? (
              <div style={{ padding: 20, color: "var(--ink-3)" }}>没有可展示的角色</div>
            ) : records.length === 0 ? (
              <div style={{ padding: 20, color: "var(--ink-3)" }}>当前筛选下没有权限可比对</div>
            ) : (
              <>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                    <thead>
                      <tr style={{ background: "var(--surface-2)", color: "var(--ink-3)" }}>
                        <th style={{ padding: "10px 12px", fontWeight: 600, textAlign: "left", position: "sticky", left: 0, background: "var(--surface-2)", minWidth: 220 }}>权限</th>
                        {grants.map(({ role, readable }) => (
                          <th key={role.id} style={{ padding: "10px 12px", fontWeight: 600, textAlign: "center", minWidth: 92 }}>
                            <div style={{ color: "var(--ink-2)" }}>{role.roleName}</div>
                            <div className="mono" style={{ marginTop: 2, color: "var(--ink-4)", fontSize: 11.5 }}>{role.roleCode}</div>
                            {!readable && <div style={{ marginTop: 2, color: "var(--warning)", fontSize: 11.5 }}>读不到</div>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((p) => (
                        <tr key={p.permissionCode} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "10px 12px", position: "sticky", left: 0, background: "var(--surface)" }}>
                            <div>{p.permissionName || p.permissionCode}</div>
                            <div className="mono" style={{ marginTop: 2, color: "var(--ink-4)", fontSize: 11.5 }}>{p.permissionCode}</div>
                          </td>
                          {grants.map(({ role, codes, readable }) => (
                            <td key={role.id} style={{ padding: "10px 12px", textAlign: "center" }}
                              title={!readable ? `${role.roleName} 的授权读不到,这一格不代表没有权限` : codes.has(p.permissionCode) ? `${role.roleName} 有此权限` : `${role.roleName} 没有此权限`}>
                              {!readable
                                ? <span style={{ color: "var(--warning)" }}>?</span>
                                : codes.has(p.permissionCode)
                                  ? <span style={{ color: "var(--success)", fontWeight: 600 }}>✓</span>
                                  : <span style={{ color: "var(--ink-4)" }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {grants.some(({ readable }) => !readable) && (
                  <div className="alertbar warn" role="alert" style={{ marginTop: 10 }}>
                    有角色的授权明细没读到,那几列标的是「?」,不是「没权限」。别拿这张图下结论,先解决读取问题。
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
      {(detail || detailLoading) && (
        <Drawer
          title={detail ? (detail.permissionName || detail.permissionCode) : "加载中…"}
          sub={detail?.permissionCode}
          onClose={() => {
            detailRequestSeq.current += 1;
            setDetail(null);
            setDetailLoading(false);
          }}
        >
          {detailLoading ? (
            <div style={{ padding: 24, color: "var(--ink-3)" }}>加载中…</div>
          ) : detail ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
              <Row label="权限值"><span className="mono">{detail.permissionCode}</span></Row>
              <Row label="中文名">{detail.permissionName || "—"}</Row>
              <Row label="类型"><Badge tone={TONE_BY_TYPE[detail.permType] || "neutral"}>{LABEL_BY_TYPE[detail.permType] || "未知类型"}</Badge></Row>
              <Row label="所属菜单"><span className="mono" style={{ fontSize: 13 }}>{detail.menuCodePath}</span></Row>
              <Row label="资源路径"><span className="mono" style={{ fontSize: 13 }}>{detail.resourcePath || "—"}</span></Row>
              <Row label="放大资金流出">{detail.amplifies ? "是（受 B1 红线约束）" : "否"}</Row>
              <Row label="已绑定角色"><span className="mono">{detail.boundRoleCount} 个</span></Row>
            </div>
          ) : null}
        </Drawer>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: "var(--ink-3)", fontSize: 12, marginBottom: 4 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
