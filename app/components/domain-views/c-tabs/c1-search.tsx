"use client";

/**
 * C1 检索 & 画像。
 * 用户列表、分组筛选与搜索均走 /api/admin/users/profiles;接口在种子用户缺失时由后端先写入真实表再分页返回。
 * 本页只读:行点击深链 /users/search/<userNo> 进 360 画像;处置去 C2/C3/C4/C5。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { DataListPager } from "../design-kit";
import {
  exportUserProfilesCsv,
  fetchC1Overview,
  fetchUserProfilesPage,
  type User360Profile,
  type UserPage,
  type UserProfileQuery,
} from "@/lib/admin/user360-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { CCtx } from "./types";

type Seg = "all" | "frozen" | "highrisk" | "kyc";
type C1Stats = {
  totalUsers: number;
  highRisk: number | null;
  highRiskThreshold: number | null;
  riskAuthorityAvailable: boolean;
  frozen: number;
  kycPending: number;
};
export type C1ExportQuery = Omit<UserProfileQuery, "pageNum" | "pageSize">;

const SEGS: [Seg, string][] = [["all", "全部"], ["frozen", "冻结"], ["highrisk", "高风险"], ["kyc", "KYC 待确认"]];
const EMPTY_PAGE: UserPage<User360Profile> = { total: 0, pageNum: 1, pageSize: 50, records: [] };

type AdvancedFilters = {
  tier: string;
  vRank: string;
  referralCode: string;
  depositMin: string;
  depositMax: string;
  usdtMin: string;
  usdtMax: string;
  nexMin: string;
  nexMax: string;
  riskBand: string;
  joinedFrom: string;
  joinedTo: string;
};

const EMPTY_FILTERS: AdvancedFilters = {
  tier: "",
  vRank: "",
  referralCode: "",
  depositMin: "",
  depositMax: "",
  usdtMin: "",
  usdtMax: "",
  nexMin: "",
  nexMax: "",
  riskBand: "",
  joinedFrom: "",
  joinedTo: "",
};

const STATUS_META: Record<string, [label: string, tone: string]> = {
  ACTIVE: ["正常", "ok"],
  FROZEN: ["冻结", "bad"],
  RESTRICTED: ["受限", "warn"],
  BANNED: ["禁用", "bad"],
};

const KYC_META: Record<string, [label: string, tone: string]> = {
  APPROVED: ["已验证", "ok"],
  VERIFIED: ["已验证", "ok"],
  PENDING: ["复审中", "warn"],
  REVIEW: ["复审中", "warn"],
  NONE: ["未验证", "dim"],
  REJECTED: ["已拒绝", "bad"],
};

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function asNumber(value: unknown) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function riskTone(value: unknown) {
  const band = text(value, "").toUpperCase();
  if (!band) return "dim";
  if (band === "HIGH" || band.includes("高")) return "bad";
  if (band === "MEDIUM" || band.includes("中")) return "warn";
  return "ok";
}

function formatUsd(value: unknown) {
  const amount = asNumber(value);
  return amount == null ? "—" : `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function statusMeta(value: unknown) {
  const status = text(value, "").toUpperCase();
  return STATUS_META[status] ?? [status || "未知", "dim"];
}

function kycMeta(value: unknown) {
  const status = text(value, "").toUpperCase();
  return KYC_META[status] ?? [status || "未知", "dim"];
}

function countText(value: unknown) {
  const count = asNumber(value);
  return count == null ? "—" : count.toLocaleString("en-US");
}

function queryForSeg(seg: Seg): Pick<UserProfileQuery, "status" | "kycStatus" | "riskMin" | "riskBand"> {
  if (seg === "frozen") return { status: "FROZEN,BANNED,RESTRICTED" };
  if (seg === "highrisk") return { riskBand: "HIGH" };
  if (seg === "kyc") return { kycStatus: "PENDING" };
  return {};
}

function profileKey(profile: User360Profile) {
  return text(profile.userNo, text(profile.id, ""));
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "C1_REQUEST_FAILED";
  if (message === "C1_RAW_PHONE_SEARCH_FORBIDDEN") {
    return "为保护用户隐私，不支持按原始手机号检索；请使用脱敏手机号或手机号哈希";
  }
  return message;
}

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function keywordQuery(value: string): Pick<UserProfileQuery, "keyword" | "userId" | "phoneHash" | "phoneMasked"> {
  const keyword = value.trim();
  if (!keyword) return {};
  if (/^[+0-9()\s-]+$/.test(keyword)) {
    const digits = keyword.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      throw new Error("C1_RAW_PHONE_SEARCH_FORBIDDEN");
    }
  }
  if (/^[0-9]{1,9}$/.test(keyword)) return { userId: keyword };
  if (/^[0-9a-f]{64}$/i.test(keyword)) return { phoneHash: keyword.toLowerCase() };
  if (/^[0-9]{3}\*{4}[0-9]{4}$/.test(keyword)) return { phoneMasked: keyword };
  return { keyword };
}

function filterQuery(filters: AdvancedFilters): C1ExportQuery {
  return {
    tier: filters.tier || undefined,
    vRank: filters.vRank || undefined,
    referralCode: filters.referralCode.trim() || undefined,
    depositMin: optionalNumber(filters.depositMin),
    depositMax: optionalNumber(filters.depositMax),
    usdtMin: optionalNumber(filters.usdtMin),
    usdtMax: optionalNumber(filters.usdtMax),
    nexMin: optionalNumber(filters.nexMin),
    nexMax: optionalNumber(filters.nexMax),
    riskBand: filters.riskBand || undefined,
    joinedFrom: filters.joinedFrom || undefined,
    joinedTo: filters.joinedTo || undefined,
  };
}

function currentExportQuery(seg: Seg, keyword: string, filters: AdvancedFilters): C1ExportQuery {
  return {
    ...queryForSeg(seg),
    ...keywordQuery(keyword),
    ...filterQuery(filters),
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  return fileName;
}

export function C1Search({
  ctx,
  onExportQueryChange,
}: {
  ctx: CCtx;
  onExportQueryChange?: (query: C1ExportQuery | null) => void;
}) {
  const router = useRouter();
  const session = useAdminAuth((state) => state.session);
  const canReadRisk = session?.role === "superadmin"
    || session?.authorities.includes("risk_k4_read") === true;
  const [seg, setSeg] = useState<Seg>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [pageData, setPageData] = useState<UserPage<User360Profile>>(EMPTY_PAGE);
  const [stats, setStats] = useState<C1Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedSeg = params.get("seg") as Seg | null;
    if (savedSeg && SEGS.some(([value]) => value === savedSeg)) setSeg(savedSeg);
    setQ(params.get("q") ?? "");
    setPage(Math.max(1, Number(params.get("page")) || 1));
    const requestedPageSize = Number(params.get("pageSize"));
    setPageSize([20, 50, 100, 200].includes(requestedPageSize) ? requestedPageSize : 50);
    setFilters(Object.fromEntries(Object.keys(EMPTY_FILTERS).map((key) => [key, params.get(key) ?? ""])) as AdvancedFilters);
    setHydrated(true);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchC1Overview()
      .then((overview) => {
        if (!alive) return;
        setStats(overview);
      })
      .catch((err) => {
        if (!alive) return;
        setError(`C1 统计加载失败 · ${errorMessage(err)}`);
      });
    return () => {
      alive = false;
    };
  }, [canReadRisk]);

  useEffect(() => {
    if (!hydrated) return;
    let alive = true;
    setLoading(true);
    setError(null);
    let query: C1ExportQuery;
    try {
      query = currentExportQuery(seg, q, filters);
    } catch (err) {
      setPageData({ ...EMPTY_PAGE, pageNum: page, pageSize });
      setError(errorMessage(err));
      setLoading(false);
      return;
    }
    fetchUserProfilesPage({
      ...query,
      pageNum: page,
      pageSize,
    })
      .then((next) => {
        if (!alive) return;
        setPageData(next);
      })
      .catch((err) => {
        if (!alive) return;
        setPageData({ ...EMPTY_PAGE, pageNum: page, pageSize });
        setError(`C1 用户列表加载失败 · ${errorMessage(err)}`);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filters, hydrated, page, pageSize, q, seg]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      onExportQueryChange?.(currentExportQuery(seg, q, filters));
    } catch {
      onExportQueryChange?.(null);
    }
  }, [filters, hydrated, onExportQueryChange, q, seg]);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    if (seg !== "all") params.set("seg", seg);
    try {
      keywordQuery(q);
      if (q.trim()) params.set("q", q.trim());
    } catch {
      // A raw phone number is rejected locally and must never enter browser history or a request URL.
    }
    if (page !== 1) params.set("page", String(page));
    if (pageSize !== 50) params.set("pageSize", String(pageSize));
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [filters, hydrated, page, pageSize, q, seg]);

  const changeSeg = (next: Seg) => {
    setSeg(next);
    setPage(1);
  };

  const changeKeyword = (value: string) => {
    setQ(value);
    setPage(1);
  };

  const changeFilter = (key: keyof AdvancedFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const openProfile = (profile: User360Profile) => {
    const key = profileKey(profile);
    if (!key) {
      ctx.toast("该用户缺少用户编码,无法打开详情");
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    router.push(`/users/search/${encodeURIComponent(key)}?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const rows = pageData.records ?? [];

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">注册用户</div><div className="v">{countText(stats?.totalUsers ?? pageData.total)}</div><div className="sub">真实账户表分页查询</div></div>
        <div className="f-stat ok"><div className="k">KYC 待确认</div><div className="v">{countText(stats?.kycPending)}</div><div className="sub">状态来自用户实名字段</div></div>
        {canReadRisk && <div className="f-stat warn"><div className="k">高风险档(K4)</div><div className="v">{stats?.riskAuthorityAvailable ? countText(stats.highRisk) : "不可用"}</div><div className="sub">{stats?.highRiskThreshold == null ? "K4 权威阈值不可用" : `K4 动态阈值 ≥ ${stats.highRiskThreshold}`}</div></div>}
        <div className="f-stat cyan"><div className="k">冻结/受限账户</div><div className="v">{countText(stats?.frozen)}</div><div className="sub">冻结、禁用、受限合计</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检索 &amp; 画像</span>
          <span className="sub">· 用户分层口径 L0-L5 / V0-V12 · 手机号仅脱敏展示</span>
          <div className="r">
            <div className="search-bar">
              <input placeholder="用户编码 / 昵称 / 推荐码 / 脱敏手机号 / 手机哈希" value={q} onChange={(e) => changeKeyword(e.target.value)} />
            </div>
            <div className="chips">
              {SEGS.filter(([value]) => value !== "highrisk" || canReadRisk).map(([v, lb]) => (
                <button key={v} className={`chip${seg === v ? " sel" : ""}`} onClick={() => changeSeg(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid gap-2 px-3 pb-3 pt-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6" style={{ borderBottom: "1px solid var(--line)" }}>
          <select aria-label="生命周期" value={filters.tier} onChange={(event) => changeFilter("tier", event.target.value)}>
            <option value="">全部生命周期</option>{[0, 1, 2, 3, 4, 5].map((value) => <option key={value} value={`L${value}`}>L{value}</option>)}
          </select>
          <select aria-label="V-Rank" value={filters.vRank} onChange={(event) => changeFilter("vRank", event.target.value)}>
            <option value="">全部 V-Rank</option>{Array.from({ length: 13 }, (_, value) => <option key={value} value={`V${value}`}>V{value}</option>)}
          </select>
          <input aria-label="推荐码" placeholder="推荐码" value={filters.referralCode} onChange={(event) => changeFilter("referralCode", event.target.value)} />
          {canReadRisk && <select aria-label="风险档" value={filters.riskBand} onChange={(event) => changeFilter("riskBand", event.target.value)}>
            <option value="">全部风险档</option><option value="LOW">低风险</option><option value="MEDIUM">中风险</option><option value="HIGH">高风险</option>
          </select>}
          <input aria-label="累计充值下限" type="number" min="0" placeholder="累计充值 ≥" value={filters.depositMin} onChange={(event) => changeFilter("depositMin", event.target.value)} />
          <input aria-label="累计充值上限" type="number" min="0" placeholder="累计充值 ≤" value={filters.depositMax} onChange={(event) => changeFilter("depositMax", event.target.value)} />
          <input aria-label="USDT 余额下限" type="number" min="0" placeholder="USDT ≥" value={filters.usdtMin} onChange={(event) => changeFilter("usdtMin", event.target.value)} />
          <input aria-label="USDT 余额上限" type="number" min="0" placeholder="USDT ≤" value={filters.usdtMax} onChange={(event) => changeFilter("usdtMax", event.target.value)} />
          <input aria-label="NEX 余额下限" type="number" min="0" placeholder="NEX ≥" value={filters.nexMin} onChange={(event) => changeFilter("nexMin", event.target.value)} />
          <input aria-label="NEX 余额上限" type="number" min="0" placeholder="NEX ≤" value={filters.nexMax} onChange={(event) => changeFilter("nexMax", event.target.value)} />
          <input aria-label="加入日期起" type="date" value={filters.joinedFrom} onChange={(event) => changeFilter("joinedFrom", event.target.value)} />
          <input aria-label="加入日期止" type="date" value={filters.joinedTo} onChange={(event) => changeFilter("joinedTo", event.target.value)} />
        </div>
        {error && <div className="ctint warn" style={{ margin: 12 }}>{error}</div>}
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1000 }}>
            <thead><tr><th>用户编码</th><th>昵称</th><th>生命周期</th><th>V-Rank</th><th className="num">设备</th><th>KYC</th><th>风险分</th><th className="num">USDT余额</th><th>状态</th></tr></thead>
            <tbody>
              {rows.map((u) => {
                const [statusLabel, statusTone] = statusMeta(u.status);
                const [kycLabel, kycTone] = kycMeta(u.kycStatus);
                return (
                  <tr
                    key={profileKey(u)}
                    className={loading ? "" : "click"}
                    aria-disabled={loading}
                    style={loading ? { opacity: 0.56, cursor: "wait", pointerEvents: "none" } : undefined}
                    onClick={loading ? undefined : () => openProfile(u)}
                  >
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(u.userNo, "未生成")} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                    <td>{text(u.nickname)}</td>
                    <td><span className="bdg dim">{text(u.userLevel)}</span></td>
                    <td><span className="bdg dim">{text(u.vRank)}</span></td>
                    <td className="num mono">{text(u.deviceCount)} / {text(u.activeDeviceCount)}</td>
                    <td><span className={`bdg ${kycTone}`}>{kycLabel}</span></td>
                    <td><span className={`bdg ${riskTone(u.riskBand)}`}>{canReadRisk ? text(u.riskScore, "不可用") : "无权限"}</span></td>
                    <td className="num mono" style={{ fontWeight: 600 }}>{formatUsd(u.walletUsdt)}</td>
                    <td><span className={`bdg ${statusTone}`}>{statusLabel}</span></td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>无匹配用户 · 换个检索词或分组试试</td></tr>
              )}
              {loading && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>正在加载用户列表...</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="C1 用户列表"
          page={page}
          pageSize={pageSize}
          total={pageData.total}
          rawTotal={stats?.totalUsers}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setPageSize(next);
            setPage(1);
          }}
          pageSizeOptions={[20, 50, 100, 200]}
        />
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ctint"><b>检索结果只读</b> · 本页只定位与展示;冻结/解冻去 C2,资产调整去 C3,实名裁决去 C4,安全处置去 C5,各自走操作确认。</div>
        </div>
      </section>
      <p className="f-foot">手机号、地址等敏感字段在检索、展示、导出时只显示脱敏值;名单导出按当前筛选条件生成文件并保留操作记录。生命周期 L0-L5 / V-Rank V0-V12 是内部分诊口径,用户端永不可见。</p>
    </>
  );
}

export function C1HeaderActions({ ctx, query }: { ctx: CCtx; query: C1ExportQuery | null }) {
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const exportCooldownUntilRef = useRef(0);
  const exportKeyRef = useRef<string | null>(null);
  const session = useAdminAuth((state) => state.session);
  const canExport = session?.role === "superadmin" || session?.authorities.includes("user_c1_write") === true;

  const runExport = useCallback(async () => {
    if (!query) {
      ctx.toast("当前筛选条件无效，已禁止导出；请修正检索条件后重试");
      return;
    }
    if (exportingRef.current || Date.now() < exportCooldownUntilRef.current) {
      ctx.toast("C1 用户名单正在生成,请稍候");
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    exportKeyRef.current ??= `c1-user-profile-export-${crypto.randomUUID()}`;
    try {
      const file = await exportUserProfilesCsv(query, exportKeyRef.current);
      const fileName = downloadBlob(file.blob, file.fileName);
      exportKeyRef.current = null;
      ctx.toast(`已下载脱敏用户名单 · ${fileName}`);
    } catch (err) {
      ctx.toast(`C1 导出失败 · ${errorMessage(err)}`);
    } finally {
      exportCooldownUntilRef.current = Date.now() + 1_000;
      exportingRef.current = false;
      setExporting(false);
    }
  }, [ctx, query]);

  if (!canExport) return null;

  return (
    <button
      className="f-cta"
      disabled={exporting || !query}
      style={exporting || !query ? { opacity: 0.62, cursor: "not-allowed" } : undefined}
      title="按当前安全筛选条件直接下载脱敏 CSV；服务端记录筛选哈希与导出审计"
      onClick={() => { void runExport(); }}
    >
      <Download size={14} />
      {exporting ? "生成中..." : "导出脱敏 CSV"}
    </button>
  );
}
