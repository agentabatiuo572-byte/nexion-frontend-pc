"use client";

import { Download, HeartPulse } from "lucide-react";
import { useState } from "react";
import { recordK6Export } from "@/lib/admin/k6-client";
import { ACTION_TYPE_LABEL, HEALTH_LEVEL_LABEL, auditActionLabel, remoteUrlLabel } from "@/lib/admin/janus-c2/labels";
import { auditExportRows, auditTargetLabel, formatAuditTime } from "@/lib/admin/k6-audit-presenter";
import type { AuditLog, HealthLevel, K6ExportFile } from "@/lib/admin/janus-c2/types";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { useK6Operator } from "./use-operator";

const LEVEL_COLOR: Record<HealthLevel, string> = {
  HEALTHY: "var(--success)", WARNING: "var(--warning)", RISK: "var(--warning)", CRITICAL: "var(--danger)",
};

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadExport(file: K6ExportFile) {
  const auditRows = Array.isArray(file.data) && file.data.length > 0 && "auditId" in file.data[0]
    ? auditExportRows(file.data as AuditLog[])
    : null;
  let content: string;
  if (file.format === "json") {
    content = JSON.stringify(auditRows ?? file.data, null, 2);
  } else if (Array.isArray(file.data)) {
    const header = auditRows
      ? ["时间", "操作", "对象类型", "对象名称", "对象编号", "操作人", "原因", "变更前", "变更后", "追踪号"]
      : ["阶段", "数量", "占总设备比例"];
    const rows = auditRows
      ? auditRows.map((row) => header.map((column) => row[column] ?? ""))
      : file.data.map((row) => "label" in row ? [row.label, row.count, `${row.rate}%`] : []);
    content = [header, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");
  } else {
    content = [["指标", "数值", "分级", "说明"], ...file.data.indicators.map((item) => [item.label, item.value, HEALTH_LEVEL_LABEL[item.level], item.note])]
      .map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");
  }
  downloadFile(file.fileName, content, file.format === "json" ? "application/json" : "text/csv;charset=utf-8");
}

export function K6Dashboard() {
  const snapshot = useJanusC2Store((state) => state.dashboard);
  const status = useJanusC2Store((state) => state.dashboardStatus);
  const error = useJanusC2Store((state) => state.dashboardError);
  const retry = useJanusC2Store((state) => state.loadDashboard);
  const operator = useK6Operator();
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (status === "idle" || status === "loading") return <div className="k6-empty">正在读取服务端看板快照…</div>;
  if (status === "error" || !snapshot) {
    return <div className="k6-empty k6-error">看板读取失败，未显示旧数据且数据未更新。{error} <button className="k6-pgbtn" onClick={() => void retry()}>重试</button></div>;
  }
  if (snapshot.summary.totalDevices === 0) {
    return <div className="k6-empty">暂无设备样本，暂不能判定健康度、漏斗或趋势。等待 App 真实上报后再重试。</div>;
  }

  const { summary, distribution, funnel, health, primaryStrategy, recentAudit } = snapshot;
  const visibleRecentAudit = recentAudit.filter((item) => auditActionLabel(item.action));
  const abnormalCount = health.indicators.filter((item) => item.level !== "HEALTHY").length;
  const segments = [
    ["接管/激活", distribution.HIT + distribution.ACTIVATED + distribution.MANUAL_FORCED, "var(--brand)"],
    ["建议下发", distribution.RECOMMENDED, "var(--warning)"],
    ["观察/新设备", distribution.OBSERVING + distribution.NEW, "var(--cyan)"],
    ["环境过滤", distribution.ENV_FILTERED, "var(--danger)"],
    ["挂起/禁止/其他", distribution.MANUAL_HOLD + distribution.BLOCKED + distribution.STALE + distribution.RESET + distribution.ERROR, "var(--ink-4)"],
  ] as const;

  const exportReport = async (reportType: "health" | "funnel", format: "csv" | "json") => {
    setExporting(`${reportType}-${format}`);
    setExportError(null);
    try {
      const file = await recordK6Export(reportType, format, { totalDevices: summary.totalDevices, healthLevel: health.level });
      downloadExport(file);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  return <div>
    <div className="k6-command">
      <div className="k6-cmd-kicker">下一步 · 服务端决策建议</div>
      <div className="k6-cmd-title">{summary.recommended ? "处理建议下发队列" : "等待设备进入建议队列"}</div>
      <div className="k6-cmd-copy">{summary.recommended ? `当前有 ${summary.recommended} 台设备建议下发，请进入设备队列逐台核对。` : "暂无建议下发设备，继续积累真实上报信号。"}</div>
      <div className="k6-pending">
        <div className="k6-pending-chip"><b>{summary.recommended}</b><span>建议待确认</span></div>
        <div className="k6-pending-chip"><b>{distribution.HIT}</b><span>命中未激活</span></div>
        <div className="k6-pending-chip"><b>{summary.envFiltered}</b><span>过滤待核查</span></div>
        <div className="k6-pending-chip"><b>{distribution.STALE}</b><span>过期未上报</span></div>
      </div>
    </div>

    <div className="k6-metrics">
      {[["设备总数", summary.totalDevices], ["在线活跃", summary.activeDevices], ["建议下发", summary.recommended], ["命中率", `${summary.hitRate}%`]].map(([label, value]) =>
        <div className="k6-metric" key={label}><div className="k6-metric-k">{label}</div><div className="k6-metric-v">{value}</div><div className="k6-metric-note">服务端当前快照</div></div>)}
    </div>

    {primaryStrategy && <div className="k6-panel">
      <div className="k6-sec-head"><div><div className="k6-kicker">当前生效策略</div><h3>{primaryStrategy.name}</h3><p>{primaryStrategy.description}</p></div><span className="k6-bdg good">优先级 {primaryStrategy.priority}</span></div>
      <div className="k6-body">动作：{ACTION_TYPE_LABEL[primaryStrategy.action.type]}{primaryStrategy.action.remoteUrlKey ? ` · ${remoteUrlLabel(primaryStrategy.action.remoteUrlKey)}` : ""} · 灰度 {primaryStrategy.rollout?.percent ?? 100}%</div>
    </div>}

    <div className="k6-panel">
      <div className="k6-sec-head"><div><div className="k6-kicker">决策构成</div><h3>十二态服务端分布</h3></div><span className="k6-bdg dim">{summary.totalDevices} 台</span></div>
      <div className="k6-body"><div className="k6-stacked">{segments.filter(([, count]) => count > 0).map(([label, count, color]) => <span key={label} className="k6-seg" title={label} style={{ width: `${count / summary.totalDevices * 100}%`, background: color }} />)}</div>
        <div className="k6-legend">{segments.map(([label, count, color]) => <div className="k6-bar-row" key={label}><span className="k6-leg"><i style={{ background: color }} />{label}</span><span>{count}</span><span>{Math.round(count / summary.totalDevices * 100)}%</span></div>)}</div>
      </div>
    </div>

    <div className="k6-panel">
      <div className="k6-sec-head"><div><div className="k6-kicker">策略健康度</div><h3>服务端健康分级</h3><p>读取失败时本页不会用零值或浏览器计算结果代替。</p></div>
        {operator.role !== "viewer" && <div style={{ display: "flex", gap: 8 }}><button className="k6-pgbtn" disabled={!!exporting} onClick={() => void exportReport("health", "csv")}><Download size={14} /> 导出 CSV</button><button className="k6-pgbtn" disabled={!!exporting} onClick={() => void exportReport("health", "json")}>导出 JSON</button></div>}
      </div>
      {exportError && <div className="k6-empty k6-error">导出失败：{exportError}</div>}
      <div className="k6-body"><div className="k6-health-head"><span className="k6-health-dot" style={{ background: LEVEL_COLOR[health.level] }} /><div><div className="k6-health-lv" style={{ color: LEVEL_COLOR[health.level] }}>{HEALTH_LEVEL_LABEL[health.level]}</div><div className="k6-health-sub">{health.indicators.length} 项指标 · {abnormalCount ? `${abnormalCount} 项需关注` : "当前无异常项"}</div></div><HeartPulse size={18} /></div>
        <div className="k6-health-grid">{health.indicators.map((item) => <div className="k6-health-cell" key={item.key}><div className="hk">{item.label}</div><div className="hv">{item.value}</div><div className="hn">{item.note}</div></div>)}</div>
        {(health.reasons.length > 0 || health.suggestions.length > 0) && <div className="k6-reasons"><h4>异常原因与处理建议</h4><ul>{health.reasons.map((item) => <li key={item}>{item}</li>)}{health.suggestions.map((item) => <li className="sug" key={item}>建议：{item}</li>)}</ul></div>}
      </div>
    </div>

    <div className="k6-panel">
      <div className="k6-sec-head"><div><div className="k6-kicker">转化漏斗</div><h3>服务端命中漏斗</h3></div>{operator.role !== "viewer" && <div style={{ display: "flex", gap: 8 }}><button className="k6-pgbtn" disabled={!!exporting} onClick={() => void exportReport("funnel", "csv")}>导出 CSV</button><button className="k6-pgbtn" disabled={!!exporting} onClick={() => void exportReport("funnel", "json")}>导出 JSON</button></div>}</div>
      <div className="k6-body"><div className="k6-funnel">{funnel.map((row) => <div className="k6-funnel-row" key={row.label}><span className="fl">{row.label}</span><span className="ft" style={{ width: `${Math.max(8, row.rate)}%` }}>{row.count}</span><span className="fp">{row.rate}%</span></div>)}</div></div>
    </div>

    {visibleRecentAudit.length > 0 && <div className="k6-panel"><div className="k6-sec-head"><div><div className="k6-kicker">最近审计</div><h3>近期关键动作</h3></div></div><div className="k6-body"><div className="k6-recent-audit">{visibleRecentAudit.map((item) => <div className="k6-recent-row" key={item.auditId}><span className="k6-bdg dim">{auditTargetLabel(item.targetType)}</span><span>{auditActionLabel(item.action)}</span><span className="k6-recent-meta">{item.actorId} · {formatAuditTime(item.createdAt)}</span></div>)}</div></div></div>}
  </div>;
}
