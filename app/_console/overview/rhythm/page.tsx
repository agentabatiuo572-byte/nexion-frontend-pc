"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

import "../b-domain.css";
import "./rhythm.css";
import Link from "next/link";
import { useMemo, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Download, RefreshCw } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import {
  exportB4Distribution,
  recordB4H1Jump,
  useB4PhaseOverview,
  type B4Filters,
} from "@/lib/admin/b4-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { B4RestoredInsights } from "@/app/components/dashboard/restored-b-insights";
import { canAccessCrossDomainPath } from "@/lib/admin/cross-domain-authority";

const ALL = "ALL";
const B4_REASON_MESSAGES: Record<string, string> = {
  B4_PHASE_DISTRIBUTION_EMPTY: "暂时统计不出各阶段的用户数，请稍后重试。",
};

function dialValue(value: string | number | boolean, unit: string) {
  if (typeof value === "boolean") return value ? "已开启" : "未开启";
  if (String(value) === "是" || String(value) === "否") return String(value);
  return `${value}${unit ? ` ${unit}` : ""}`;
}

export default function RhythmPage() {
  const [filters, setFilters] = useState<B4Filters>({
    granularity: "PHASE",
    month: "",
    phase: ALL,
  });
  const [busy, setBusy] = useState<"export" | "jump" | "">("");
  const [notice, setNotice] = useState("");
  const session = useAdminAuth((state) => state.session);
  const { data, loading, error, reload } = useB4PhaseOverview(filters);
  const authorities = session?.authorities ?? [];
  const superAdmin = session?.role === "superadmin";
  const canExport = superAdmin || authorities.includes("overview_b4_export");
  const canCross = (path: string) => canAccessCrossDomainPath(path, session?.role, authorities);
  const canJump = (superAdmin || authorities.includes("overview_b4_jump")) && canCross("/growth/phase");
  const maxUsers = useMemo(
    () => Math.max(1, ...(data?.distribution.map((row) => row.userCount) ?? [1])),
    [data],
  );

  async function downloadDistribution() {
    setBusy("export");
    setNotice("");
    try {
      const file = await exportB4Distribution(filters);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("已导出，文件不含用户个人信息。");
    } catch (value) {
      setNotice(value instanceof Error ? displayAdminError(value) : "导出失败，请刷新后重试。");
    } finally {
      setBusy("");
    }
  }

  async function openH1(dial: string) {
    setBusy("jump");
    setNotice("");
    try {
      const target = await recordB4H1Jump(dial, filters.phase);
      window.location.assign(target.href);
    } catch (value) {
      setNotice(value instanceof Error ? displayAdminError(value) : "跳转失败，请重试。");
      setBusy("");
    }
  }

  return (
    <div className="dkpage bpage rhythmpage">
      <BPageHeader
        id="B4"
        title="运营阶段状态"
        desc={
          <>
            查看各阶段的用户数、当前八项调节值和下个月的变化。这里只能查看，调整请到 <b>运营阶段设置</b>。
          </>
        }
      />

      <section className="card b4-controls" aria-label="筛选与操作">
        <div className="b4-filter-grid">
          <label>
            <span>查看方式</span>
            <select
              aria-label="查看方式"
              value={filters.granularity}
              onChange={(event) => setFilters((current) => ({
                ...current,
                granularity: event.target.value as B4Filters["granularity"],
              }))}
            >
              <option value="PHASE">按运营阶段</option>
              <option value="MONTH">按月</option>
            </select>
          </label>
          <label>
            <span>查看月份</span>
            <select
              aria-label="查看月份"
              value={filters.month || String(data?.filters.month ?? "")}
              onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))}
            >
              {(data?.filters.monthOptions ?? []).map((month) => (
                <option key={month} value={month}>第 {month} 月</option>
              ))}
            </select>
          </label>
          <label>
            <span>运营阶段</span>
            <select
              aria-label="运营阶段"
              value={filters.phase}
              onChange={(event) => setFilters((current) => ({ ...current, phase: event.target.value }))}
            >
              <option value={ALL}>全部 P1–P6</option>
              {(data?.filters.phaseOptions ?? ["P1", "P2", "P3", "P4", "P5", "P6"]).map((phase) => (
                <option key={phase} value={phase}>{phase}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="b4-actions">
          <button type="button" className="b4-btn" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} aria-hidden /> 刷新
          </button>
          {canExport && (
            <button
              type="button"
              className="b4-btn primary"
              onClick={() => void downloadDistribution()}
              disabled={busy !== "" || !data?.available || !data.distribution.length}
            >
              <Download size={14} aria-hidden /> 导出各阶段用户数
            </button>
          )}
        </div>
        {notice && <p className="b4-notice" role="status">{notice}</p>}
      </section>

      {loading && !data && <B4State loading />}
      {error && <B4State error={error} onRetry={reload} />}

      {data && !error && (
        <>
          {!data.available && (
            <section className="card b4-alert" role="alert">
              <b>各阶段用户数暂时不准，请勿据此决策</b>
              <span>{B4_REASON_MESSAGES[data.reason ?? ""] || "用户注册时长数据不完整，已暂停导出。"}</span>
            </section>
          )}

          <section className="b4-summary" aria-label="当前阶段摘要">
            <article className="card">
              <span>当前运营阶段</span>
              <strong>{data.rhythm.currentPhase}</strong>
              <small>第 {data.rhythm.currentMonth} / {data.rhythm.totalMonths} 月</small>
            </article>
            <article className="card">
              <span>阶段进度</span>
              <strong>{data.rhythm.phaseProgressPct}%</strong>
              <small>按「运营阶段设置」</small>
            </article>
            <article className="card">
              <span>当前视图</span>
              <strong>{data.filters.granularity === "PHASE" ? "按运营阶段" : "按月"}</strong>
              <small>第 {data.filters.month} 月 · {data.filters.phase === ALL ? "全部阶段" : data.filters.phase}</small>
            </article>
          </section>

          <section className="card b4-distribution">
            <div className="b4-section-head">
              <div>
                <h2>各运营阶段用户数</h2>
                <p>按用户注册时长分到 P1–P6 各阶段，筛选不影响总数。</p>
              </div>
              <span className="b4-source">来自运营阶段设置</span>
            </div>
            <div className="b4-bars">
              {data.distribution.map((row) => (
                <article
                  key={`${row.phase}-${row.month ?? "phase"}`}
                  className={row.inScope ? "" : "muted"}
                  data-testid="b4-distribution-row"
                >
                  <div className="b4-bar-value">{row.userCount.toLocaleString()}</div>
                  <div className="b4-bar-track">
                    <div style={{ height: `${Math.max(4, (row.userCount / maxUsers) * 100)}%` }} />
                  </div>
                  <b>{row.month == null ? row.phase : `第 ${row.month} 月`}</b>
                  {row.month != null && <small>{row.phase}</small>}
                </article>
              ))}
            </div>
          </section>

          <div className="b4-grid">
            <section className="card b4-pivot">
              <div className="b4-section-head">
                <div>
                  <h2>距下次调整还有</h2>
                  <p>{data.nextPivot.basis}</p>
                </div>
              </div>
              <strong>
                {data.nextPivot.atMonth == null
                  ? "已是最后一个月"
                  : `${data.nextPivot.daysLeft ?? "—"} 天`}
              </strong>
              <span>{data.nextPivot.message}</span>
              <ul>
                {data.nextPivot.changes.length
                  ? data.nextPivot.changes.map((change) => <li key={change}>{change}</li>)
                  : <li>下个月没有调节值变化</li>}
              </ul>
            </section>

            <section className="card b4-levers">
              <div className="b4-section-head">
                <div>
                  <h2>本月重点调整的项目</h2>
                  <p>第 {data.filters.month} 月 · 每月重点调 2–3 项</p>
                </div>
              </div>
              <div className="b4-lever-list">
                {data.monthLeverCombo.map((lever) => (
                  <article key={`${lever.key}-${lever.label}`}>
                    <span title={lever.key}>调整项</span>
                    <b>{lever.label}</b>
                    <small>{lever.purpose}</small>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="card b4-dials">
            <div className="b4-section-head">
              <div>
                <h2>八项调节值</h2>
                <p>修改请到「运营阶段设置」。</p>
              </div>
              <span className="b4-source">8 / 8</span>
            </div>
            <div className="b4-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>调节项</th>
                    <th>当前值</th>
                    <th>来源</th>
                    <th>是否生效</th>
                    {canJump && <th>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.dials.map((dial) => (
                    <tr key={dial.key} data-testid="b4-dial-row">
                      <td><b>{dial.label}</b></td>
                      <td className="mono">{dialValue(dial.currentValue, dial.unit)}</td>
                      <td>{dial.source === "H1" ? "运营阶段设置" : "运营阶段记录"}</td>
                      <td><span className={dial.v1Active ? "b4-status active" : "b4-status pending"}>{operatorCopyText(dial.v1Status)}</span></td>
                      {canJump && (
                        <td>
                          <a
                            href={dial.adjustHref}
                            className="b4-link"
                            aria-disabled={busy !== ""}
                            onClick={(event) => {
                              event.preventDefault();
                              if (!busy) void openH1(dial.key);
                            }}
                          >
                            去调整 →
                          </a>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card b4-attribution">
            <div className="b4-section-head">
              <div>
                <h2>运营阶段效果分析</h2>
                <p>看调节值变化后，用户转化和资金分别怎么变。</p>
              </div>
            </div>
            <div className="b4-attribution-links">
              {data.attributionLinks.map((item) => (
                item.key === "H1" ? (
                  canJump && (
                    <a
                      key={item.key}
                      href={item.href}
                      className="b4-link-card"
                      onClick={(event) => {
                        event.preventDefault();
                        if (!busy) void openH1("phaseAttribution");
                      }}
                    >
                      <b>{operatorCopyText(item.label)}</b><span>打开运营阶段设置</span>
                    </a>
                  )
                ) : canCross(item.href) ? (
                  <Link key={item.key} href={item.href} className="b4-link-card">
                    <b>{operatorCopyText(item.label)}</b>
                    <span>{item.key === "B3"
                      ? `按 ${filters.phase === ALL ? "全部阶段" : filters.phase} 查看`
                      : "查看整体资金情况"}</span>
                  </Link>
                ) : (
                  <span key={item.key} className="b4-link-card" aria-disabled="true">
                    <b>{operatorCopyText(item.label)}</b><span>无权限</span>
                  </span>
                )
              ))}
            </div>
          </section>

          <B4RestoredInsights />

          <p className="b-foot">
            {data.sourceStatement} · 数据时间 {new Date(data.asOf).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function B4State({
  loading,
  error,
  onRetry,
}: {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <section className="card b4-alert" role={error ? "alert" : "status"}>
      <b>{loading ? "正在加载运营阶段状态" : "运营阶段状态加载失败"}</b>
      <span>{loading ? "请稍候…" : `${error}，已暂停显示旧数据和导出。`}</span>
      {error && onRetry && <button type="button" className="b4-btn" onClick={onRetry}>重试</button>}
    </section>
  );
}
