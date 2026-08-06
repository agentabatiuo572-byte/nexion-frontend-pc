"use client";

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

const ALL = "ALL";
const B4_REASON_MESSAGES: Record<string, string> = {
  B4_PHASE_DISTRIBUTION_EMPTY: "当前没有可确认的账户月龄分布；请检查用户创建时间事实后重试。",
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
  const canJump = superAdmin || authorities.includes("overview_b4_jump");
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
      setNotice("Phase 聚合 CSV 已生成并写入 A2 审计；文件不含用户标识或 PII。");
    } catch (value) {
      setNotice(value instanceof Error ? displayAdminError(value) : "B4 导出失败，请重新读取后再试。");
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
      setNotice(value instanceof Error ? displayAdminError(value) : "H1 跳转留痕失败，本次未跳转。");
      setBusy("");
    }
  }

  return (
    <div className="dkpage bpage rhythmpage">
      <BPageHeader
        id="B4"
        title="节奏状态"
        desc={
          <>
            从 <b>H1 服务端单一权威</b>读取 P1–P6 用户分布、当前 8-dial、下一月粒度拐点与杠杆组合。
            本页只读；所有调整与效果归因都进入 H1。
          </>
        }
      />

      <section className="card b4-controls" aria-label="节奏筛选与操作">
        <div className="b4-filter-grid">
          <label>
            <span>分布粒度</span>
            <select
              aria-label="分布粒度"
              value={filters.granularity}
              onChange={(event) => setFilters((current) => ({
                ...current,
                granularity: event.target.value as B4Filters["granularity"],
              }))}
            >
              <option value="PHASE">Phase 粒度</option>
              <option value="MONTH">月粒度</option>
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
                <option key={month} value={month}>月 {month}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Phase 筛选</span>
            <select
              aria-label="Phase 筛选"
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
            <RefreshCw size={14} aria-hidden /> 重新读取
          </button>
          {canExport && (
            <button
              type="button"
              className="b4-btn primary"
              onClick={() => void downloadDistribution()}
              disabled={busy !== "" || !data?.available || !data.distribution.length}
            >
              <Download size={14} aria-hidden /> 导出 Phase 分布
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
              <b>当前 Phase 分布不可用于决策</b>
              <span>{B4_REASON_MESSAGES[data.reason ?? ""] || "账户月龄事实不可确认；已禁用导出，不以旧值或演示值替代。"}</span>
            </section>
          )}

          <section className="b4-summary" aria-label="当前节奏摘要">
            <article className="card">
              <span>当前 Phase</span>
              <strong>{data.rhythm.currentPhase}</strong>
              <small>月 {data.rhythm.currentMonth} / {data.rhythm.totalMonths}</small>
            </article>
            <article className="card">
              <span>阶段进度</span>
              <strong>{data.rhythm.phaseProgressPct}%</strong>
              <small>由 H1 节奏骨架下发</small>
            </article>
            <article className="card">
              <span>当前视图</span>
              <strong>{data.filters.granularity === "PHASE" ? "Phase" : "月"}</strong>
              <small>月份 {data.filters.month} · {data.filters.phase === ALL ? "全 Phase" : data.filters.phase}</small>
            </article>
          </section>

          <section className="card b4-distribution">
            <div className="b4-section-head">
              <div>
                <h2>各 Phase 用户数分布</h2>
                <p>账户月龄事实由服务端映射到 H1 P1–P6；筛选只改变观察范围，不改变权威总数。</p>
              </div>
              <span className="b4-source">H1 权威数据</span>
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
                  <b>{row.month == null ? row.phase : `月 ${row.month}`}</b>
                  {row.month != null && <small>{row.phase}</small>}
                </article>
              ))}
            </div>
          </section>

          <div className="b4-grid">
            <section className="card b4-pivot">
              <div className="b4-section-head">
                <div>
                  <h2>距下一月粒度拐点</h2>
                  <p>{data.nextPivot.basis}</p>
                </div>
              </div>
              <strong>
                {data.nextPivot.atMonth == null
                  ? "节奏末月"
                  : `${data.nextPivot.daysLeft ?? "—"} 天`}
              </strong>
              <span>{data.nextPivot.message}</span>
              <ul>
                {data.nextPivot.changes.length
                  ? data.nextPivot.changes.map((change) => <li key={change}>{change}</li>)
                  : <li>下一月没有 dial 数值变化</li>}
              </ul>
            </section>

            <section className="card b4-levers">
              <div className="b4-section-head">
                <div>
                  <h2>本月被推动的杠杆组合</h2>
                  <p>月份 {data.filters.month} · 同时推动 2–3 个杠杆</p>
                </div>
              </div>
              <div className="b4-lever-list">
                {data.monthLeverCombo.map((lever) => (
                  <article key={`${lever.key}-${lever.label}`}>
                    <span>{lever.key}</span>
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
                <h2>8-dial 现值</h2>
                <p>现值取自 H1 调度器服务端权威；B4 不缓存、不重算、无写入控件。</p>
              </div>
              <span className="b4-source">8 / 8</span>
            </div>
            <div className="b4-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>dial</th>
                    <th>当前值</th>
                    <th>权威来源</th>
                    <th>V1 生效状态</th>
                    {canJump && <th>操作</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.dials.map((dial) => (
                    <tr key={dial.key} data-testid="b4-dial-row">
                      <td><b>{dial.label}</b><small>{dial.key}</small></td>
                      <td className="mono">{dialValue(dial.currentValue, dial.unit)}</td>
                      <td>{dial.source}</td>
                      <td><span className={dial.v1Active ? "b4-status active" : "b4-status pending"}>{dial.v1Status}</span></td>
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
                            在 H1 调整 →
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
                <h2>Phase 效果归因</h2>
                <p>H1 汇总选定 Phase 的 dial 变化；B3 提供转化，B1/B2 提供资金切片。</p>
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
                      <b>{item.label}</b><span>记录 B4 → H1 跳转审计</span>
                    </a>
                  )
                ) : (
                  <Link key={item.key} href={item.href} className="b4-link-card">
                    <b>{item.label}</b>
                    <span>{item.key === "B3"
                      ? `按 ${filters.phase === ALL ? "全部 Phase" : filters.phase} 查看`
                      : "查看全局资金事实"}</span>
                  </Link>
                )
              ))}
            </div>
          </section>

          <p className="b-foot">
            {data.sourceStatement} · 数据时间 {new Date(data.asOf).toLocaleString()} · 查看、跳 H1、导出均写 A2 审计。
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
      <b>{loading ? "B4 节奏状态加载中" : "B4 节奏状态加载失败"}</b>
      <span>{loading ? "正在读取 H1 权威节奏与账户月龄事实。" : `${error}；旧数据与导出已隐藏。`}</span>
      {error && onRetry && <button type="button" className="b4-btn" onClick={onRetry}>重试</button>}
    </section>
  );
}
