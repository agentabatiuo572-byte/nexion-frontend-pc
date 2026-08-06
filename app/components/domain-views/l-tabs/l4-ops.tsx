"use client";

import { useEffect, useRef, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { LDataState } from "./live-data";
import { readL4Operations, type L4DistRow, type L4OperationsData } from "./l4-live-data";
import type { LCtx } from "./types";
import type { L4OperationsQuery } from "@/lib/admin/l-client";

type ReportTab = "device" | "tasks" | "network" | "phase";

const REPORT_TABS: ReadonlyArray<[ReportTab, string]> = [
  ["device", "设备运营报表"],
  ["tasks", "任务承接报表"],
  ["network", "网络与团队报表"],
  ["phase", "Phase 节奏效果报表"],
];

const PERIODS: ReadonlyArray<[L4OperationsQuery["period"], string]> = [
  ["day", "日"], ["week", "周"], ["month", "月"], ["custom", "自定义"],
];

export function L4HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportingRef = useRef(false);
  const intentKeyRef = useRef("");
  const lastSuccessAtRef = useRef(0);
  const [exporting, setExporting] = useState(false);
  const data = readL4Operations(ctx.biData?.l4);
  const query = ctx.l4Query ?? { period: "week", phase: "ALL" };

  const exportCurrent = async () => {
    if (exportingRef.current || !data?.available) return;
    const now = Date.now();
    if (lastSuccessAtRef.current && now - lastSuccessAtRef.current < 2_000) return;
    if (lastSuccessAtRef.current) {
      intentKeyRef.current = "";
      lastSuccessAtRef.current = 0;
    }
    if (!intentKeyRef.current) intentKeyRef.current = `l4-ops-${now}-${Math.random().toString(36).slice(2, 10)}`;
    exportingRef.current = true;
    setExporting(true);
    const range = [
      `period=${query.period}`,
      `phase=${query.phase}`,
      query.from ? `from=${query.from}` : "",
      query.to ? `to=${query.to}` : "",
    ].filter(Boolean).join(";");
    try {
      await ctx.biActions?.createReport({
        exportType: "运营报表",
        timeRange: range,
        fields: "设备/任务/网络/Phase 历史聚合指标",
        piiLevel: "NONE",
        maskPolicy: "NONE",
        recipient: "运营管理员",
        ticket: "L4-OPERATIONS",
      }, `导出 L4 ${data.period.label} ${data.phaseFilter} 聚合运营报表`, intentKeyRef.current);
      lastSuccessAtRef.current = Date.now();
      ctx.toast("运营报表 CSV 已生成 · 已固化当前周期与阶段并记录审计");
    } catch (error) {
      ctx.toast(error instanceof Error ? `导出任务提交失败 · ${displayAdminError(error)}` : "导出任务提交失败 · 请稍后重试");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  return (
    <>
      <span className="f-ro"><span className="d" />A4 历史事实 · 只读分析</span>
      {!ctx.canExport && <span className="f-ro">当前角色仅可查看 · 导出需 L4 权限</span>}
      <button
        className="f-cta"
        onClick={exportCurrent}
        disabled={exporting || !ctx.canExport || !data?.available || ctx.biLoading || Boolean(ctx.biError)}
        aria-busy={exporting}
        title={!data?.available ? "所选周期没有可导出的运营事实" : undefined}
      >
        {exporting ? "正在生成运营报表..." : "导出运营报表 CSV"}
      </button>
    </>
  );
}

export function L4Ops({ ctx }: { ctx: LCtx }) {
  const data = readL4Operations(ctx.biData?.l4);
  const query = ctx.l4Query ?? { period: "week", phase: "ALL" };
  const [tab, setTab] = useState<ReportTab>("device");
  const [from, setFrom] = useState(query.from ?? "");
  const [to, setTo] = useState(query.to ?? "");
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.localStorage.getItem("nexion:l4:view");
      if (!raw) return;
      const saved = JSON.parse(raw) as { query?: Partial<L4OperationsQuery>; tab?: string };
      const period = saved.query?.period;
      const phase = saved.query?.phase;
      const validPeriod = PERIODS.some(([value]) => value === period);
      const validPhase = phase === "ALL" || /^P[1-6]$/.test(phase ?? "");
      const validTab = REPORT_TABS.some(([value]) => value === saved.tab);
      if (!validPeriod || !validPhase || !validTab) return;
      const restoredQuery: L4OperationsQuery = {
        period: period as L4OperationsQuery["period"],
        phase: phase as L4OperationsQuery["phase"],
      };
      if (period === "custom") {
        const restoredFrom = saved.query?.from ?? "";
        const restoredTo = saved.query?.to ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(restoredFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(restoredTo) || restoredFrom > restoredTo) return;
        restoredQuery.from = restoredFrom;
        restoredQuery.to = restoredTo;
        setFrom(restoredFrom);
        setTo(restoredTo);
      }
      setTab(saved.tab as ReportTab);
      ctx.setL4Query?.(restoredQuery);
    } catch {
      // A corrupt local view is ignored; the server-backed default remains authoritative.
    }
  }, [ctx.setL4Query]);

  if (!data) return <LDataState ctx={ctx} label="L4" />;

  const updateQuery = (next: Partial<L4OperationsQuery>) => {
    ctx.setL4Query?.({ ...query, ...next });
  };
  const applyCustom = () => {
    if (!from || !to) {
      ctx.toast("请选择自定义周期的开始和结束日期；当前报表没有变化");
      return;
    }
    if (from > to) {
      ctx.toast("开始日期不能晚于结束日期；当前报表没有变化");
      return;
    }
    updateQuery({ period: "custom", from, to });
  };
  const saveView = () => {
    try {
      window.localStorage.setItem("nexion:l4:view", JSON.stringify({ query, tab }));
      ctx.toast("当前视图已保存 · 仅保存筛选与页签，不改变业务口径");
    } catch {
      ctx.toast("视图保存失败 · 浏览器存储不可用；报表数据没有变化");
    }
  };

  return (
    <div>
      <section className="l-card" aria-label="L4 历史运营报表筛选">
        <div className="l-h">
          <span className="ttl">历史运营报表</span>
          <span className="sub">· 设备、任务、网络与 Phase 同读 A4 服务端事件</span>
          <div className="r"><span className="lcode electric">{data.period.label} · {data.phaseFilter}</span></div>
        </div>
        <div className="l-b" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>报表周期</span>
          {PERIODS.map(([period, label]) => (
            <button
              key={period}
              className="l-btn sm"
              aria-pressed={query.period === period}
              style={query.period === period ? { color: "var(--cyan)", borderColor: "var(--cyan)" } : undefined}
              onClick={() => period === "custom" ? updateQuery({ period }) : updateQuery({ period, from: undefined, to: undefined })}
            >{label}</button>
          ))}
          <label style={{ fontSize: 12, color: "var(--ink-3)" }}>Phase
            <select
              aria-label="Phase 筛选"
              value={query.phase}
              onChange={(event) => updateQuery({ phase: event.target.value as L4OperationsQuery["phase"] })}
              style={{ marginLeft: 6 }}
            >
              <option value="ALL">P1–P6 全量</option>
              {[1, 2, 3, 4, 5, 6].map((phase) => <option key={phase} value={`P${phase}`}>P{phase}</option>)}
            </select>
          </label>
          {query.period === "custom" && (
            <>
              <label style={{ fontSize: 12 }}>开始 <input aria-label="自定义开始日期" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
              <label style={{ fontSize: 12 }}>结束 <input aria-label="自定义结束日期" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
              <button className="l-btn sm" onClick={applyCustom}>应用自定义周期</button>
            </>
          )}
          <button className="l-btn sm" onClick={saveView}>保存当前视图</button>
          <button className="l-btn sm" onClick={() => void ctx.reloadBi?.()}>刷新数据</button>
        </div>
      </section>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }} role="tablist" aria-label="L4 四类运营报表">
        {REPORT_TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className="l-btn"
            style={tab === key ? { color: "var(--cyan)", borderColor: "var(--cyan)" } : undefined}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>

      {!data.available && (
        <div className="ltint warn" style={{ marginBottom: 14, fontSize: 12 }}>
          <b>所选周期暂无历史运营事件</b> · 没有生成承接率、推广率、留存率或阶段跳变；请选择其他周期/Phase，或确认 E/F/H1 是否已产生服务端事件。
        </div>
      )}
      {!data.quality.sameActorRates && data.available && (
        <div className="ltint warn" style={{ marginBottom: 14, fontSize: 12 }}>
          <b>同用户覆盖不完整</b> · actor 覆盖率 {fmt(data.quality.actorCoveragePct, 1)}%，相关转化/留存比率显示“—”，不会用事件数替代用户数。
        </div>
      )}

      {tab === "device" && <DeviceReport data={data} />}
      {tab === "tasks" && <TaskReport data={data} />}
      {tab === "network" && <NetworkReport data={data} ctx={ctx} query={query} />}
      {tab === "phase" && <PhaseReport data={data} />}
      <HistoryTable data={data} />

      <p className="f-foot"><b>L4 只读、不另立账本</b>：历史效果来自 A4 schema-accepted 事件；设备/任务参数归 E 域，团队关系归 F 域，Phase dial 归 H1。缺分母或窗口数据时显示“—”，不推算。</p>
    </div>
  );
}

function DeviceReport({ data }: { data: L4OperationsData }) {
  const s = data.device.summary;
  return (
    <section className="l-card">
      <ReportHeader title="设备运营报表" subtitle="在网快照 + 期间购置、产出与衰减影响" />
      <div className="l-b">
        <MetricTiles rows={[
          ["当前活跃设备", data.liveFacts.activeUserDevices, "E 域设备台账当前事实"],
          ["期间购置设备", s.periodPurchasedDevices, "窗口内购买事件按设备去重，不等于期末在网数"],
          ["期间产出 USDT", s.dailyYieldUsdt, "earnings credited 聚合"],
          ["衰减影响 USDT", s.degradationLossUsdt, "基准产出 − 实际产出"],
        ]} />
        <div className="two-col">
          <Distribution title="购置代际分布" rows={data.device.byGeneration} />
          <Distribution title="购置机型分布" rows={data.device.byModel} />
        </div>
        <table className="l-tbl" style={{ marginTop: 12 }}>
          <thead><tr><th>衰减段</th><th className="num">事件数</th><th className="num">实际产出 USDT</th><th className="num">影响 USDT</th></tr></thead>
          <tbody>{data.device.degradation.map((row) => <tr key={row.band}><td>{row.band}</td><td className="num mono">{row.events}</td><td className="num mono">{fmt(row.actualUsdt)}</td><td className="num mono">{fmt(row.lossUsdt)}</td></tr>)}</tbody>
        </table>
        {data.device.degradation.length === 0 && <Empty text="本周期没有可核验的设备产出与衰减事件。" />}
      </div>
    </section>
  );
}

function TaskReport({ data }: { data: L4OperationsData }) {
  const s = data.tasks.summary;
  const acceptance = nullableMetric(s.acceptanceRate);
  const warning = acceptance !== null && acceptance < 60;
  return (
    <section className="l-card">
      <ReportHeader title="任务承接报表" subtitle="派发、完成、六类 tier、队列饱和与签到活跃" />
      <div className="l-b">
        <MetricTiles rows={[
          ["任务派发量", s.dispatched, "服务端派发事件"],
          ["任务完成量", s.completed, "服务端完成事件"],
          ["任务承接率", acceptance, warning ? "低于 60% 展示告警线" : "完成 ÷ 派发"],
          ["队列饱和度", s.queueSaturation, "最近服务端队列事实"],
          ["签到活跃", s.checkinActive, "同用户去重"],
        ]} percentKeys={new Set(["任务承接率", "队列饱和度"])} />
        {warning && <div className="ltint warn" style={{ marginBottom: 12 }}><b>任务承接率低于 60%</b> · 建议跳转 E 域任务定价与队列配置归因；L4 不在此修改参数。</div>}
        <Distribution title="六类任务 tier 完成分布" rows={data.tasks.byTier} />
      </div>
    </section>
  );
}

function NetworkReport({ data, ctx, query }: { data: L4OperationsData; ctx: LCtx; query: L4OperationsQuery }) {
  const s = data.network.summary;
  const exportingRef = useRef(false);
  const intentKeyRef = useRef("");
  const lastSuccessAtRef = useRef(0);
  const [exporting, setExporting] = useState(false);

  const requestNetworkTreeExport = () => {
    if (exportingRef.current || query.period === "custom" || data.liveFacts.teamRelationships <= 0) return;
    const now = Date.now();
    if (lastSuccessAtRef.current && now - lastSuccessAtRef.current < 2_000) return;
    if (lastSuccessAtRef.current) {
      intentKeyRef.current = "";
      lastSuccessAtRef.current = 0;
    }
    ctx.openActionConfirm({
      action: "导出团队明细",
      detail: (
        <div>
          将按当前 <b>{data.period.label}</b> 周期导出 F 域团队树快照；预计关系数 <b>{data.liveFacts.teamRelationships}</b>，最终行数由服务端重新核算。仅包含部分隐藏的用户编码、层级、V-Rank、团队业绩与加入时间，不包含手机号、昵称、完整用户编码或解密字段。文件下载令牌 24 小时有效，操作会通知超级管理员与增长负责人并写入高风险审计。
        </div>
      ),
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        title: "导出范围",
        hint: "层级越深，导出范围越大；服务端最多允许 10 层和 100,000 行。",
        fields: [{
          key: "depth",
          label: "团队树层级",
          current: "3",
          inputKind: "select",
          options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
          optionLabels: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1} 层`])),
          required: true,
        }],
      },
      run: async (reason, _newValue, businessValue) => {
        if (exportingRef.current || !ctx.biActions) return;
        const depth = Number(businessValue?.depth ?? "3");
        if (!Number.isInteger(depth) || depth < 1 || depth > 10) throw new Error("团队树层级必须为 1–10 层");
        if (!intentKeyRef.current) intentKeyRef.current = `l4-network-tree-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        exportingRef.current = true;
        setExporting(true);
        try {
          const result = await ctx.biActions.createNetworkTreeExport(
            { period: query.period as "day" | "week" | "month", depth },
            reason,
            intentKeyRef.current,
          );
          const file = await ctx.biActions.downloadReport(result.reportId);
          downloadBlob(file.blob, file.fileName);
          lastSuccessAtRef.current = Date.now();
          ctx.toast(`团队明细已安全下载 · ${result.rowCount} 行 · 用户编码部分隐藏 · 24 小时令牌`);
        } catch (error) {
          ctx.toast(error instanceof Error ? `团队明细导出失败 · ${displayAdminError(error)}` : "团队明细导出失败 · 请稍后重试");
        } finally {
          exportingRef.current = false;
          setExporting(false);
        }
      },
    });
  };

  return (
    <section className="l-card">
      <ReportHeader title="网络与团队报表" subtitle="F 域团队结构 + KPI #5/#7 完整下钻" />
      <div className="l-b">
        <MetricTiles rows={[
          ["直推用户", s.directRefs, "referral bound 按被推荐用户去重"],
          ["团队 GMV USDT", s.teamGmvUsdt, "带推荐来源的完成订单"],
          ["佣金派发 USDT", s.commissionPaidUsdt, "commission paid"],
          ["L4→L5 推广率", s.promotionRate, "设备持有者邀请 ÷ 设备持有者"],
          ["团队佣金触发率", s.commissionTriggerRate, "直推中产生佣金人数 ÷ 直推人数"],
        ]} percentKeys={new Set(["L4→L5 推广率", "团队佣金触发率"])} />
        <div className="net-grid">
          <Distribution title="团队规模分布" rows={data.network.teamSizeDist} />
          <Distribution title="V-Rank 分布" rows={data.network.vRankDist} />
          <Distribution title="佣金类型结构" rows={data.network.commissionStructure} />
        </div>
        <div className="ltint" style={{ marginTop: 12 }}><b>隐私边界</b> · 当前页和聚合 CSV 只展示计数与金额汇总，不包含用户编码、手机号或团队树明细。专用明细导出仅向授权角色开放，用户编码部分隐藏，且必须填写原因。</div>
        {ctx.canExportNetworkTree && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <button
              className="l-btn"
              onClick={requestNetworkTreeExport}
              disabled={exporting || query.period === "custom" || data.liveFacts.teamRelationships <= 0 || ctx.biLoading || Boolean(ctx.biError)}
              aria-busy={exporting}
              title={query.period === "custom"
                ? "团队明细导出仅支持服务端定义的日、周、月周期"
                : data.liveFacts.teamRelationships <= 0 ? "当前没有可导出的团队关系" : undefined}
            >{exporting ? "正在生成团队明细..." : "导出团队明细"}</button>
            <span className="f-ro">需选择 1–10 层并填写 8–200 字原因 · 高风险审计</span>
          </div>
        )}
      </div>
    </section>
  );
}

function PhaseReport({ data }: { data: L4OperationsData }) {
  return (
    <section className="l-card">
      <ReportHeader title="Phase 节奏效果报表" subtitle="P1–P6 跨阶段历史对比；dial 参数仍由 H1 管理" />
      <div style={{ overflowX: "auto" }}>
        <table className="l-tbl ph-tbl" style={{ minWidth: 820 }}>
          <thead><tr><th>Phase</th><th className="num">活跃人数</th><th className="num">留存率</th><th className="num">转化率</th><th className="num">产出 USDT</th><th className="num">切换事件</th><th className="num">dial 调整</th><th className="num">转化阶跃</th></tr></thead>
          <tbody>{data.phaseEffect.map((row) => (
            <tr key={row.phase}>
              <td><span className="lcode electric">{row.phase}</span></td>
              <td className="num mono">{row.activeUsers}</td>
              <td className="num mono">{pct(row.retentionRate)}</td>
              <td className="num mono">{pct(row.conversionRate)}</td>
              <td className="num mono">{fmt(row.yieldUsdt)}</td>
              <td className="num mono">{row.transitionCount}</td>
              <td className="num mono">{row.dialChangeCount}</td>
              <td className="num mono">{row.conversionStepPct == null ? "—" : `${row.conversionStepPct >= 0 ? "+" : ""}${fmt(row.conversionStepPct)}pp`}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryTable({ data }: { data: L4OperationsData }) {
  return (
    <section className="l-card">
      <ReportHeader title="周期趋势" subtitle={`${data.period.from} 至 ${data.period.to} · ${data.phaseFilter}`} />
      <div style={{ overflowX: "auto" }}>
        <table className="l-tbl" style={{ minWidth: 760 }}>
          <thead><tr><th>时间桶</th><th className="num">设备购置</th><th className="num">设备退役</th><th className="num">产出 USDT</th><th className="num">任务完成</th><th className="num">新增直推</th><th className="num">佣金 USDT</th></tr></thead>
          <tbody>{data.history.map((row) => <tr key={row.bucket}><td>{row.bucket}</td><td className="num mono">{row.devicePurchases}</td><td className="num mono">{row.deviceRetirements}</td><td className="num mono">{fmt(row.yieldUsdt)}</td><td className="num mono">{row.tasksCompleted}</td><td className="num mono">{row.directRefs}</td><td className="num mono">{fmt(row.commissionPaidUsdt)}</td></tr>)}</tbody>
        </table>
        {data.history.length === 0 && <Empty text="所选周期没有历史事件，趋势保持为空。" />}
      </div>
    </section>
  );
}

function ReportHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="l-h"><span className="ttl">{title}</span><span className="sub">· {subtitle}</span><div className="r"><span className="lcode">服务端历史聚合</span></div></div>;
}

function MetricTiles({ rows, percentKeys = new Set<string>() }: { rows: Array<[string, number | null | undefined, string]>; percentKeys?: Set<string> }) {
  return <div className="mini-tiles">{rows.map(([key, value, sub]) => <div className="t" key={key}><div className="k">{key}</div><div className="v">{value == null ? "—" : `${fmt(value)}${percentKeys.has(key) ? "%" : ""}`}</div><div className="s">{sub}</div></div>)}</div>;
}

function Distribution({ title, rows }: { title: string; rows: L4DistRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return <div><div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>{title}</div>{rows.map((row) => <div className="dist-row tight" key={row.key}><div className="nm">{row.key}</div><div className="track"><i style={{ width: `${Math.max(3, row.count / max * 100)}%`, background: "var(--cyan)" }} /></div><div className="amt">{row.count}</div></div>)}{rows.length === 0 && <Empty text="本周期暂无分布数据。" />}</div>;
}

function Empty({ text }: { text: string }) {
  return <div className="ltint" style={{ margin: 12, fontSize: 12 }}>{text}</div>;
}

function nullableMetric(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? null : value;
}

function fmt(value: number | null | undefined, digits = 2) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: digits });
}

function pct(value: number | null) {
  return value == null ? "—" : `${fmt(value)}%`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
