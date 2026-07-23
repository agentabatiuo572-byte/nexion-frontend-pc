"use client";

import "../b-domain.css";
import "./funnel.css";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, RefreshCw, Save, TrendingUp } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { BDomainDataState } from "@/app/components/dashboard/b-domain-state";
import { exportB3Cohort, saveB3View, useB3Funnel, type B3Filters } from "@/lib/admin/b3-client";
import { useAdminAuth } from "@/lib/store/admin-auth";

const ALL = "ALL";

function pct(value: number | null) {
  return value == null ? "不可计算" : `${value.toFixed(1)}%`;
}

export default function FunnelPage() {
  const [filters, setFilters] = useState<B3Filters>({ cohort: ALL, phase: ALL, ref: ALL });
  const [stage, setStage] = useState("purchase");
  const [viewName, setViewName] = useState("B3 当前视图");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"save" | "export" | "">("");
  const auth = useAdminAuth((state) => state.session);
  const { data, loading, error, reload } = useB3Funnel(filters, stage);
  const authorities = auth?.authorities ?? [];
  const superAdmin = auth?.role === "superadmin";
  const canSave = superAdmin || authorities.includes("overview_b3_view_write");
  const canExport = superAdmin || authorities.includes("overview_b3_export");

  const options = data?.filterOptions ?? { cohorts: [], phases: [], refs: [] };
  const selectedStage = data?.stages.find((item) => item.key === stage);
  const biggestDrop = useMemo(() => {
    if (!data) return null;
    return data.stages.slice(1).reduce<(typeof data.stages)[number] | null>((worst, item) => {
      if (item.cvrFromPrev == null) return worst;
      return !worst || (worst.cvrFromPrev ?? 101) > item.cvrFromPrev ? item : worst;
    }, null);
  }, [data]);

  async function saveView() {
    setBusy("save");
    setNotice("");
    try {
      const result = await saveB3View(viewName, filters);
      setNotice(result.replayed ? "相同视图已存在，未重复写入。" : "视图已保存到服务端，刷新或重登后仍可回读。");
      await reload();
    } catch (value) {
      setNotice(value instanceof Error ? value.message : "保存视图失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  async function exportCohort() {
    setBusy("export");
    setNotice("");
    try {
      const file = await exportB3Cohort(filters);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("聚合 CSV 已生成并留痕；文件不含用户标识或原始 PII。");
    } catch (value) {
      setNotice(value instanceof Error ? value.message : "导出失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="dkpage bpage funnelpage">
      <BPageHeader
        id="B3"
        title="转化漏斗"
        desc={
          <>
            从注册到提现的五级转化只读取 <b>A4 已登记事件</b>，并要求同一用户按时间顺序逐级进入。
            空分母与未成熟 Day7 窗口显示“不可计算”，不会用 0 冒充经营事实。
          </>
        }
      />

      <section className="card b3-controls" aria-label="漏斗筛选与操作">
        <div className="b3-filter-grid">
          <label>
            <span>注册 cohort</span>
            <select
              aria-label="注册 cohort"
              value={filters.cohort}
              onChange={(event) => setFilters((current) => ({ ...current, cohort: event.target.value }))}
            >
              <option value={ALL}>全部 cohort</option>
              {options.cohorts.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Phase</span>
            <select
              aria-label="Phase"
              value={filters.phase}
              onChange={(event) => setFilters((current) => ({ ...current, phase: event.target.value }))}
            >
              <option value={ALL}>全部 Phase</option>
              {options.phases.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>推荐码 / 渠道</span>
            <select
              aria-label="推荐码 / 渠道"
              value={filters.ref}
              onChange={(event) => setFilters((current) => ({ ...current, ref: event.target.value }))}
            >
              <option value={ALL}>全部渠道</option>
              {options.refs.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label className="b3-view-name">
            <span>视图名称</span>
            <input
              aria-label="视图名称"
              maxLength={80}
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
            />
          </label>
        </div>
        <div className="b3-actions">
          <button type="button" className="b3-btn" onClick={() => void reload()} disabled={loading}>
            <RefreshCw size={14} aria-hidden /> 重新读取
          </button>
          {canSave && (
            <button type="button" className="b3-btn" onClick={() => void saveView()} disabled={busy !== "" || !viewName.trim()}>
              <Save size={14} aria-hidden /> 保存为视图
            </button>
          )}
          {canExport && (
            <button
              type="button"
              className="b3-btn primary"
              onClick={() => void exportCohort()}
              disabled={busy !== "" || !data?.stages.length}
            >
              <Download size={14} aria-hidden /> 导出 cohort
            </button>
          )}
        </div>
        {notice && <p className="b3-notice" role="status">{notice}</p>}
      </section>

      {loading && !data && <BDomainDataState title="B3 转化漏斗" loading />}
      {error && <BDomainDataState title="B3 转化漏斗" error={error} onRetry={reload} />}

      {data && !error && (
        <>
          {!data.available && (
            <section className="card b3-unavailable" role="alert">
              <b>当前漏斗不可安全计算</b>
              <span>{data.message || data.reason || "A4 主漏斗事实缺少可靠用户标识。"}</span>
            </section>
          )}

          <section className="b3-aux-grid" aria-label="核心辅助指标">
            <article className="card">
              <span className="b3-kicker">Day0 接入率</span>
              <strong>{pct(data.auxMetrics.day0AccessRate)}</strong>
              <small>
                90 秒内首笔收益 {data.auxMetrics.day0Numerator} ÷ 注册 {data.auxMetrics.day0Denominator}
                · 目标 &gt; {data.auxMetrics.day0Target}%
              </small>
            </article>
            <article className="card">
              <span className="b3-kicker">Day7 留存率</span>
              <strong>{pct(data.auxMetrics.day7Retention)}</strong>
              <small>
                Day7 活跃 {data.auxMetrics.day7Numerator} ÷ 已成熟 cohort {data.auxMetrics.day7Denominator}
                · 目标 &gt; {data.auxMetrics.day7Target}%
              </small>
            </article>
          </section>

          <section className="card b3-stage-card">
            <div className="ttl-row">
              <span className="h">五级同用户漏斗</span>
              <span className="sub">注册 → 绑卡 → 首购 → 复投 → 提现 · L2–L5 生命周期参照</span>
            </div>
            <div className="b3-stage-grid">
              {data.stages.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  data-testid="b3-stage"
                  className={`b3-stage${stage === item.key ? " selected" : ""}`}
                  onClick={() => setStage(item.key)}
                  aria-pressed={stage === item.key}
                >
                  <span className="b3-stage-index">{index + 1}</span>
                  <span className="b3-stage-name">{item.stage}</span>
                  <span className="b3-stage-life">{item.lifecycleLabel}</span>
                  <strong>{item.distinctUsers.toLocaleString()}</strong>
                  <small>{index === 0 ? "漏斗入口" : `自上级 ${pct(item.cvrFromPrev)}`}</small>
                  <code>{item.event}</code>
                </button>
              ))}
            </div>
            {biggestDrop && (
              <p className="b3-bottleneck">
                当前最大流失环节：<b>{biggestDrop.stage}</b>（自上级 {pct(biggestDrop.cvrFromPrev)}）。
                请结合 H1 Phase 与 L2 cohort 下钻判断原因，页面不自动推断因果。
              </p>
            )}
          </section>

          <section className="card b3-table-card">
            <div className="ttl-row">
              <span className="h">级间指标表</span>
              <span className="sub">去重用户数、上级分母、CVR、A4 权威事件</span>
            </div>
            <div className="b3-table-wrap">
              <table>
                <thead>
                  <tr><th>阶段</th><th>生命周期</th><th>去重用户</th><th>上级</th><th>CVR</th><th>环比</th><th>事件口径</th></tr>
                </thead>
                <tbody>
                  {data.stages.map((item) => (
                    <tr key={item.key}>
                      <td>{item.stage}</td><td>{item.lifecycleLabel}</td><td>{item.distinctUsers}</td>
                      <td>{item.previousUsers}</td><td>{pct(item.cvrFromPrev)}</td>
                      <td>{item.momDelta == null ? "无可比 cohort" : pct(item.momDelta)}</td>
                      <td><code>{item.event}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card b3-trend-card">
            <div className="ttl-row">
              <TrendingUp size={15} aria-hidden />
              <span className="h">cohort 趋势 · {selectedStage?.stage ?? "首购"}</span>
              <span className="sub">最近 13 个注册周；未命中筛选时明确为空</span>
            </div>
            {data.trend.length ? (
              <div className="b3-trend-list">
                {data.trend.map((point) => (
                  <div key={point.cohort}>
                    <span>{point.cohort}</span>
                    <i style={{ width: `${Math.max(point.cvrFromPrev ?? 0, 2)}%` }} />
                    <b>{pct(point.cvrFromPrev)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="b3-empty">当前切片没有可比较 cohort，不推算趋势。</p>
            )}
          </section>

          <section className="card b3-links" aria-label="跨域下钻">
            <div>
              <b>归因与数据源</b>
              <span>{data.sourceStatement}</span>
            </div>
            <nav>
              <Link href="/analytics/funnel-cohort" prefetch={false}>L2 完整下钻 →</Link>
              <Link href="/growth/phase" prefetch={false}>H1 Phase 归因 →</Link>
              <Link href="/platform/events" prefetch={false}>A4 事件治理 →</Link>
            </nav>
          </section>

          {!!data.savedViews.length && (
            <section className="card b3-saved">
              <b>我的已保存视图</b>
              <span>最近 {data.savedViews.length} 个，来自服务端持久化；刷新和重登后仍可见。</span>
            </section>
          )}
        </>
      )}
    </div>
  );
}
