"use client";

import "../b-domain.css";
import "./funnel.css";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TabGroup } from "@/app/components/kit/tab-group";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Download, RefreshCw, Save, TrendingUp } from "lucide-react";
import { BPageHeader } from "../b-page-header";
import { BDomainDataState } from "@/app/components/dashboard/b-domain-state";
import {
  B3OutcomeUnknownError,
  exportB3Cohort,
  saveB3View,
  useB3Funnel,
  type B3Filters,
} from "@/lib/admin/b3-client";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { normalizeB3RefOptions } from "@/lib/admin/b3-ref-display";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { B3RestoredInsights } from "@/app/components/dashboard/restored-b-insights";
import { canAccessCrossDomainPath } from "@/lib/admin/cross-domain-authority";

/** B3 保存视图只有一个槽位:视图名 / 筛选条件没变就复用命令号,变了铸新号并丢弃旧号。
 *  落 sessionStorage,刷新后「结果未知」的重试仍是同一命令号,后端才能去重。 */
const viewCommandKey = createSlotAttemptStore({
  storageKey: "nexion-admin-b3-funnel-commands-v1",
});
const VIEW_SAVE_SLOT = "view-save";

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
  const canCross = (path: string) => canAccessCrossDomainPath(path, auth?.role, authorities);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phase = params.get("phase")?.toUpperCase() ?? ALL;
    if (/^P[1-6]$/.test(phase)) {
      setFilters((current) => ({ ...current, phase }));
    }
  }, []);

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
    const fingerprint = JSON.stringify({ viewName, filters, granularity: "WEEK", comparison: "PREVIOUS" });
    const commandKey = viewCommandKey.resolve(VIEW_SAVE_SLOT, fingerprint, () => `b3-view-${crypto.randomUUID()}`);
    setBusy("save");
    setNotice("");
    try {
      const result = await saveB3View(viewName, filters, "WEEK", "PREVIOUS", commandKey);
      viewCommandKey.forget(VIEW_SAVE_SLOT);
      setNotice(result.replayed ? "相同视图已存在，未重复写入。" : "视图已保存到服务端，刷新或重登后仍可回读。");
      await reload();
    } catch (value) {
      if (!(value instanceof B3OutcomeUnknownError)) viewCommandKey.forget(VIEW_SAVE_SLOT);
      setNotice(value instanceof Error ? displayAdminError(value) : "保存视图失败，请重试。");
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
      setNotice("聚合 CSV 已生成并留痕；文件不含用户标识或原始个人隐私信息。");
    } catch (value) {
      setNotice(value instanceof Error ? displayAdminError(value) : "导出失败，请重试。");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="dkpage bpage funnelpage">
      <BPageHeader
        id="B3"
        title="用户转化分析"
        desc={
          <>
            从注册到提现的四级转化只读取 <b>A4 已登记事件</b>，并要求同一用户按时间顺序逐级进入。
            没有符合条件的用户，或注册尚未满七天时，显示“不可计算”，不会用 0 冒充经营事实。
          </>
        }
      />

      <section className="card b3-controls" aria-label="漏斗筛选与操作">
        <div className="b3-filter-grid">
          <label>
            <span>注册时间分组</span>
            <select
              aria-label="注册时间分组"
              value={filters.cohort}
              onChange={(event) => setFilters((current) => ({ ...current, cohort: event.target.value }))}
            >
              <option value={ALL}>全部注册时间</option>
              {options.cohorts.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>运营阶段</span>
            <select
              aria-label="运营阶段"
              value={filters.phase}
              onChange={(event) => setFilters((current) => ({ ...current, phase: event.target.value }))}
            >
              <option value={ALL}>全部阶段</option>
              {/^P[1-6]$/.test(filters.phase) && !options.phases.includes(filters.phase) && (
                <option value={filters.phase}>{filters.phase}</option>
              )}
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
              {normalizeB3RefOptions(options.refs).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
            <button type="button" className="b3-btn" onClick={() => void saveView()} disabled={busy !== "" || !viewName.trim() || !data?.available}>
              <Save size={14} aria-hidden /> 保存为视图
            </button>
          )}
          {canExport && (
            <button
              type="button"
              className="b3-btn primary"
              onClick={() => void exportCohort()}
              disabled={busy !== "" || !data?.available || !data.stages.length}
            >
              <Download size={14} aria-hidden /> 导出注册用户分组
            </button>
          )}
        </div>
        {notice && <p className="b3-notice" role="status">{notice}</p>}
      </section>

      {loading && !data && <BDomainDataState title="B3 用户转化分析" loading />}
      {error && <BDomainDataState title="B3 用户转化分析" error={error} onRetry={reload} />}

      {data && !error && (
        <>
          {!data.available && (
            <section className="card b3-unavailable" role="alert">
              <b>当前无法计算用户转化</b>
              <span>{data.message || data.reason || "用户行为记录缺少可靠的用户标识。"}</span>
            </section>
          )}

          <B3RestoredInsights data={data} />

          {data.available && (
            <>
          <section className="b3-aux-grid" aria-label="核心辅助指标">
            <article className="card">
              <span className="b3-kicker">商店访问率</span>
              <strong>{pct(data.auxMetrics.storeViewRate)}</strong>
              <small>
                商店访问 {data.auxMetrics.storeViewNumerator} ÷ 注册 {data.auxMetrics.storeViewDenominator}
              </small>
            </article>
            <article className="card">
              <span className="b3-kicker">商店到首购转化</span>
              <strong>{pct(data.auxMetrics.purchaseFromStoreRate)}</strong>
              <small>
                首购 {data.auxMetrics.purchaseFromStoreNumerator} ÷ 商店访问 {data.auxMetrics.purchaseFromStoreDenominator}
              </small>
            </article>
            <article className="card">
              <span className="b3-kicker">注册当天获得收益比例</span>
              <strong>{pct(data.auxMetrics.day0AccessRate)}</strong>
              <small>
                {data.auxMetrics.day0WindowSeconds} 秒内首笔收益 {data.auxMetrics.day0Numerator} ÷ 注册 {data.auxMetrics.day0Denominator}
                · 目标 &gt; {data.auxMetrics.day0Target}%
              </small>
            </article>
            <article className="card">
              <span className="b3-kicker">注册第 7 天仍活跃的比例</span>
              <strong>{pct(data.auxMetrics.day7Retention)}</strong>
              <small>
                第 7 天活跃 {data.auxMetrics.day7Numerator} ÷ 满 7 天的注册用户 {data.auxMetrics.day7Denominator}
                · 目标 &gt; {data.auxMetrics.day7Target}%
              </small>
            </article>
          </section>

          <section className="card b3-stage-card">
            <div className="ttl-row">
              <span className="h">同一批用户的四步转化</span>
              <span className="sub">注册 → 首购 → 复投 → 提现</span>
            </div>
            <TabGroup label="漏斗阶段" value={selectedStage?.key ?? data.stages[0]?.key ?? ""}
              items={data.stages.map((item) => item.key)} onSelect={setStage}
              className="b3-stage-grid" itemDataTestId="b3-stage"
              itemClassName={(_key, selected) => `b3-stage${selected ? " selected" : ""}`}>
              {(key) => {
                const index = data.stages.findIndex((item) => item.key === key);
                const item = data.stages[index];
                return <>
                  <span className="b3-stage-index">{index + 1}</span>
                  <span className="b3-stage-name">{item.stage}</span>
                  <span className="b3-stage-life">{item.lifecycleLabel}</span>
                  <strong>{item.distinctUsers.toLocaleString()}</strong>
                  <small>{index === 0 ? "第一步" : `从上一步转化 ${pct(item.cvrFromPrev)}`}</small>
                  <code>{item.event}</code>
                </>;
              }}
            </TabGroup>
            {biggestDrop && (
              <p className="b3-bottleneck">
                当前流失最多的环节：<b>{biggestDrop.stage}</b>（从上一步转化 {pct(biggestDrop.cvrFromPrev)}）。
                请结合 H1 运营阶段和 L2 用户转化与留存数据判断原因。
              </p>
            )}
          </section>

          <section className="card b3-table-card">
            <div className="ttl-row">
              <span className="h">各步骤转化数据</span>
              <span className="sub">用户数、上一步人数、转化率和对应行为记录</span>
            </div>
            <div className="b3-table-wrap">
              <table>
                <thead>
                  <tr><th>步骤</th><th>用户阶段</th><th>用户数</th><th>上一步人数</th><th>转化率</th><th>与上月比较</th><th>对应行为</th></tr>
                </thead>
                <tbody>
                  {data.stages.map((item) => (
                    <tr key={item.key}>
                      <td>{item.stage}</td><td>{item.lifecycleLabel}</td><td>{item.distinctUsers}</td>
                      <td>{item.previousUsers}</td><td>{pct(item.cvrFromPrev)}</td>
                      <td>{item.momDelta == null ? "没有可比较的注册用户组" : pct(item.momDelta)}</td>
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
              <span className="h">按注册周查看转化趋势 · {selectedStage?.stage ?? "首购"}</span>
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
              <p className="b3-empty">当前筛选条件下没有可比较的注册用户组，无法计算趋势。</p>
            )}
          </section>

          <section className="card b3-links" aria-label="跨域查看明细">
            <div>
              <b>原因分析与数据来源</b>
              <span>{data.sourceStatement}</span>
            </div>
            <nav>
              {canCross("/analytics/funnel-cohort") ? <Link href="/analytics/funnel-cohort" prefetch={false}>到 L2 查看完整分析 →</Link> : <span aria-disabled="true">L2 完整分析 · 无权限</span>}
              {canCross("/growth/phase") ? <Link href="/growth/phase" prefetch={false}>H1 运营阶段效果 →</Link> : <span aria-disabled="true">H1 运营阶段效果 · 无权限</span>}
              {canCross("/platform/events") ? <Link href="/platform/events" prefetch={false}>A4 事件治理 →</Link> : <span aria-disabled="true">A4 事件治理 · 无权限</span>}
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
        </>
      )}
    </div>
  );
}
