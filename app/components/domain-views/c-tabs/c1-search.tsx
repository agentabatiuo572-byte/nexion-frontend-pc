"use client";

/**
 * C1 检索 & 画像。
 * 用户列表、分组筛选与搜索均走 /api/admin/users/profiles;接口在种子用户缺失时由后端先写入真实表再分页返回。
 * 本页只读:行点击深链 /users/search/<userNo> 进 360 画像;处置去 C2/C3/C4/C5。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { DataListPager } from "../design-kit";
import {
  fetchUserProfilesPage,
  type User360Profile,
  type UserPage,
  type UserProfileQuery,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

type Seg = "all" | "frozen" | "highrisk" | "kyc";
type C1Stats = {
  totalUsers: number;
  highRisk: number;
  frozen: number;
  kycPending: number;
};
export type C1ExportQuery = Pick<UserProfileQuery, "keyword" | "status" | "kycStatus" | "riskMin">;

const SEGS: [Seg, string][] = [["all", "全部"], ["frozen", "冻结"], ["highrisk", "高风险"], ["kyc", "KYC 待确认"]];
const EMPTY_PAGE: UserPage<User360Profile> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
const EXPORT_PAGE_SIZE = 100;

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
  return Number.isFinite(next) ? next : 0;
}

function riskTone(value: unknown) {
  const score = asNumber(value);
  if (score >= 70) return "bad";
  if (score >= 40) return "warn";
  return "ok";
}

function formatUsd(value: unknown) {
  return `$${asNumber(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function statusMeta(value: unknown) {
  const status = text(value, "ACTIVE").toUpperCase();
  return STATUS_META[status] ?? [status || "未知", "dim"];
}

function kycMeta(value: unknown) {
  const status = text(value, "NONE").toUpperCase();
  return KYC_META[status] ?? [status || "未知", "dim"];
}

function queryForSeg(seg: Seg): Pick<UserProfileQuery, "status" | "kycStatus" | "riskMin"> {
  if (seg === "frozen") return { status: "FROZEN,BANNED,RESTRICTED" };
  if (seg === "highrisk") return { riskMin: 70 };
  if (seg === "kyc") return { kycStatus: "PENDING" };
  return {};
}

function profileKey(profile: User360Profile) {
  return text(profile.userNo, text(profile.id, ""));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "C1_REQUEST_FAILED";
}

function currentExportQuery(seg: Seg, keyword: string): C1ExportQuery {
  return {
    ...queryForSeg(seg),
    keyword: keyword.trim() || undefined,
  };
}

function excelEscape(value: unknown) {
  const raw = text(value, "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return safe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function excelCell(value: unknown, align: "left" | "right" = "left") {
  const valueText = excelEscape(value);
  const style = align === "right"
    ? "mso-number-format:'\\@';text-align:right;"
    : "mso-number-format:'\\@';";
  return `<td style="${style}">${valueText}</td>`;
}

function excelHeader(value: string) {
  return `<th style="background:#eef3f8;font-weight:700;border:1px solid #c8d3df;">${excelEscape(value)}</th>`;
}

function buildMaskedUserExcel(rows: User360Profile[]) {
  const headers = [
    "用户编码",
    "昵称",
    "手机号(脱敏)",
    "国家/地区",
    "生命周期",
    "V-Rank",
    "KYC",
    "状态",
    "风险分",
    "风险等级",
    "设备数",
    "活跃设备数",
    "USDT余额",
    "NEX余额",
    "注册时间",
    "最近登录",
  ];
  const body = rows.map((profile) => {
    const [statusLabel] = statusMeta(profile.status);
    const [kycLabel] = kycMeta(profile.kycStatus);
    return `<tr>${
      [
        text(profile.userNo, "未生成"),
        text(profile.nickname),
        text(profile.phoneMasked),
        text(profile.countryCode),
        text(profile.userLevel),
        text(profile.vRank),
        kycLabel,
        statusLabel,
        text(profile.riskScore, "0"),
        text(profile.riskBand),
        text(profile.deviceCount, "0"),
        text(profile.activeDeviceCount, "0"),
        text(profile.walletUsdt, "0"),
        text(profile.walletNex, "0"),
        text(profile.registeredAt),
        text(profile.lastLoginAt),
      ].map((cell, index) => excelCell(cell, index >= 8 && index <= 13 ? "right" : "left")).join("")
    }</tr>`;
  }).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 12px; }
    td { border: 1px solid #d7dee8; padding: 6px 8px; }
    th { padding: 7px 8px; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${headers.map(excelHeader).join("")}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

function downloadMaskedUserExcel(rows: User360Profile[]) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const fileName = `c1-masked-users-${stamp}.xls`;
  const blob = new Blob(["\ufeff", buildMaskedUserExcel(rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
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

async function fetchAllExportUsers(query: C1ExportQuery) {
  const first = await fetchUserProfilesPage({ ...query, pageNum: 1, pageSize: EXPORT_PAGE_SIZE });
  const records = [...first.records];
  const totalPages = Math.max(1, Math.ceil(first.total / EXPORT_PAGE_SIZE));
  for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
    const page = await fetchUserProfilesPage({ ...query, pageNum, pageSize: EXPORT_PAGE_SIZE });
    records.push(...page.records);
  }
  return records;
}

export function C1Search({
  ctx,
  onExportQueryChange,
}: {
  ctx: CCtx;
  onExportQueryChange?: (query: C1ExportQuery) => void;
}) {
  const router = useRouter();
  const [seg, setSeg] = useState<Seg>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [pageData, setPageData] = useState<UserPage<User360Profile>>(EMPTY_PAGE);
  const [stats, setStats] = useState<C1Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetchUserProfilesPage({ pageNum: 1, pageSize: 1 }),
      fetchUserProfilesPage({ riskMin: 70, pageNum: 1, pageSize: 1 }),
      fetchUserProfilesPage({ status: "FROZEN,BANNED,RESTRICTED", pageNum: 1, pageSize: 1 }),
      fetchUserProfilesPage({ kycStatus: "PENDING", pageNum: 1, pageSize: 1 }),
    ])
      .then(([all, highRisk, frozen, kycPending]) => {
        if (!alive) return;
        setStats({
          totalUsers: all.total,
          highRisk: highRisk.total,
          frozen: frozen.total,
          kycPending: kycPending.total,
        });
      })
      .catch((err) => {
        if (!alive) return;
        setError(`C1 统计加载失败 · ${errorMessage(err)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchUserProfilesPage({
      ...queryForSeg(seg),
      keyword: q.trim() || undefined,
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
  }, [seg, q, page, pageSize]);

  useEffect(() => {
    onExportQueryChange?.(currentExportQuery(seg, q));
  }, [onExportQueryChange, seg, q]);

  const changeSeg = (next: Seg) => {
    setSeg(next);
    setPage(1);
  };

  const changeKeyword = (value: string) => {
    setQ(value);
    setPage(1);
  };

  const openProfile = (profile: User360Profile) => {
    const key = profileKey(profile);
    if (!key) {
      ctx.toast("该用户缺少用户编码,无法打开详情");
      return;
    }
    router.push(`/users/search/${encodeURIComponent(key)}`);
  };

  const rows = pageData.records ?? [];

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">注册用户</div><div className="v">{(stats?.totalUsers ?? pageData.total).toLocaleString("en-US")}</div><div className="sub">真实账户表分页查询</div></div>
        <div className="f-stat ok"><div className="k">KYC 待确认</div><div className="v">{(stats?.kycPending ?? 0).toLocaleString("en-US")}</div><div className="sub">状态来自用户实名字段</div></div>
        <div className="f-stat warn"><div className="k">高风险档(K4)</div><div className="v">{(stats?.highRisk ?? 0).toLocaleString("en-US")}</div><div className="sub">风险分 ≥ 70</div></div>
        <div className="f-stat cyan"><div className="k">冻结/受限账户</div><div className="v">{(stats?.frozen ?? 0).toLocaleString("en-US")}</div><div className="sub">冻结、禁用、受限合计</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检索 &amp; 画像</span>
          <span className="sub">· 用户分层口径 L0-L5 / V0-V12 · 手机号仅脱敏展示</span>
          <div className="r">
            <div className="search-bar">
              <input placeholder="用户编码 / 昵称 / 推荐码 / 手机号" value={q} onChange={(e) => changeKeyword(e.target.value)} />
            </div>
            <div className="chips">
              {SEGS.map(([v, lb]) => (
                <button key={v} className={`chip${seg === v ? " sel" : ""}`} onClick={() => changeSeg(v)}>{lb}</button>
              ))}
            </div>
          </div>
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
                  <tr key={profileKey(u)} className="click" onClick={() => openProfile(u)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{text(u.userNo, "未生成")} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                    <td>{text(u.nickname)}</td>
                    <td><span className="bdg dim">{text(u.userLevel)}</span></td>
                    <td><span className="bdg dim">{text(u.vRank)}</span></td>
                    <td className="num mono">{text(u.deviceCount, "0")} / {text(u.activeDeviceCount, "0")}</td>
                    <td><span className={`bdg ${kycTone}`}>{kycLabel}</span></td>
                    <td><span className={`bdg ${riskTone(u.riskScore)}`}>{text(u.riskScore, "0")}</span></td>
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
          pageSizeOptions={[5, 10, 20]}
        />
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ctint"><b>检索结果只读</b> · 本页只定位与展示;冻结/解冻去 C2,资产调整去 C3,实名裁决去 C4,安全处置去 C5,各自走操作确认。</div>
        </div>
      </section>
      <p className="f-foot">手机号、地址等敏感字段在检索、展示、导出时只显示脱敏值;名单导出按当前筛选条件生成文件并保留操作记录。生命周期 L0-L5 / V-Rank V0-V12 是内部分诊口径,用户端永不可见。</p>
    </>
  );
}

export function C1HeaderActions({ ctx, query }: { ctx: CCtx; query: C1ExportQuery }) {
  const [exporting, setExporting] = useState(false);

  const runExport = useCallback(async () => {
    if (exporting) {
      ctx.toast("C1 用户名单正在生成,请稍候");
      return;
    }
    setExporting(true);
    try {
      const rows = await fetchAllExportUsers(query);
      if (rows.length === 0) {
        ctx.toast("当前筛选条件下没有可导出的用户");
        return;
      }
      const fileName = downloadMaskedUserExcel(rows);
      ctx.logAudit({
        actor: "总管理员",
        action: `导出用户名单(脱敏 Excel) · ${rows.length} 行`,
        target: "C1",
      });
      ctx.toast(`已下载 ${rows.length.toLocaleString("en-US")} 条脱敏用户名单 · ${fileName}`);
    } catch (err) {
      ctx.toast(`C1 导出失败 · ${errorMessage(err)}`);
    } finally {
      setExporting(false);
    }
  }, [ctx, exporting, query]);

  return (
    <button
      className="f-cta"
      disabled={exporting}
      style={exporting ? { opacity: 0.62, cursor: "wait" } : undefined}
      onClick={() => ctx.openConfirm({
        action: "导出用户名单(脱敏 Excel)",
        detail: "按当前 C1 检索条件导出用户编码、昵称、脱敏手机号、账户状态、KYC、层级、V-Rank、设备、风险分、余额和时间字段;不包含数据库 userId。",
        okLabel: "确认导出",
        run: () => { void runExport(); },
      })}
    >
      <Download size={14} />
      {exporting ? "生成中..." : "导出用户名单(脱敏)"}
    </button>
  );
}
