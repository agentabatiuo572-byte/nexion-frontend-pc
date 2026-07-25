"use client";

// K6 client-only；挂载后从鉴权接口加载业务数据。

/**
 * K6 审计日志(SPEC 5 · PRD §16 / §19)。
 * 策略发布 / 手动下发 / 状态修改 / 回滚等关键动作的不可篡改记录:操作者 / 时间 / 前后快照 / 原因 / 请求号。
 * 支持按对象类型筛选 + 关键词搜索 + CSV / JSON 导出。数据来自服务端只追加且不可修改的审计记录。
 */
import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { useK6Operator } from "./use-operator";
import { auditActionLabel } from "@/lib/admin/janus-c2/labels";
import type { AuditLog } from "@/lib/admin/janus-c2/types";
import { recordK6Export } from "@/lib/admin/k6-client";
import {
  auditExportRows,
  auditObjectReference,
  auditReasonText,
  auditSnapshotText,
  auditTargetLabel,
  formatAuditTime,
} from "@/lib/admin/k6-audit-presenter";

function download(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: AuditLog[]): string {
  const head = ["时间", "操作", "对象类型", "对象名称", "对象编号", "操作人", "原因", "变更前", "变更后", "追踪号"];
  const esc = (s: string): string => {
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const body = auditExportRows(rows).map((row) => head.map((column) => esc(row[column] ?? "")).join(","));
  return [head.map(esc).join(","), ...body].join("\n");
}

export function K6AuditLog() {
  const audit = useJanusC2Store((s) => s.audit);
  const status = useJanusC2Store((s) => s.auditStatus);
  const loadError = useJanusC2Store((s) => s.auditError);
  const retry = useJanusC2Store((s) => s.loadAudit);
  const operator = useK6Operator();
  const [targetType, setTargetType] = useState<"all" | "device" | "strategy" | "config">("all");
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState<"csv" | "json" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      audit.filter(
        (a) =>
          (targetType === "all" || a.targetType === targetType) &&
          (!q ||
            auditActionLabel(a.action).includes(q) ||
            auditObjectReference(a).value.toLowerCase().includes(q.toLowerCase()) ||
            (a.reasonText ?? "").includes(q) ||
            a.actorId.toLowerCase().includes(q.toLowerCase())),
      ),
    [audit, targetType, q],
  );

  const exportAudit = async (format: "csv" | "json") => {
    setExporting(format);
    setExportError(null);
    try {
      const file = await recordK6Export("audit", format, { targetType, q: q.trim() });
      const rows = Array.isArray(file.data) ? file.data as AuditLog[] : [];
      const content = format === "csv" ? toCsv(rows) : JSON.stringify(auditExportRows(rows), null, 2);
      download(file.fileName, content, format === "csv" ? "text/csv;charset=utf-8" : "application/json");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "导出失败");
    } finally {
      setExporting(null);
    }
  };

  if (status === "idle" || status === "loading") return <div className="k6-empty">正在读取审计记录…</div>;
  if (status === "error") return <div className="k6-empty k6-error">审计记录读取失败，数据未更新。{loadError} <button className="k6-pgbtn" onClick={() => void retry()}>重试</button></div>;

  return (
    <div className="k6-panel">
      <div className="k6-sec-head">
        <div><div className="k6-kicker">审计日志</div><h3>关键动作记录</h3><p>策略发布、手动状态下发、回滚等仅追加且不可修改的记录，含操作者、前后快照与原因。</p></div>
        {operator.role !== "viewer" && <div style={{ display: "flex", gap: 8 }}>
          <button className="k6-pgbtn" disabled={!filtered.length || exporting !== null} onClick={() => void exportAudit("csv")}><Download size={14} aria-hidden style={{ marginRight: 4 }} />{exporting === "csv" ? "导出中…" : "导出 CSV"}</button>
          <button className="k6-pgbtn" disabled={!filtered.length || exporting !== null} onClick={() => void exportAudit("json")}>{exporting === "json" ? "导出中…" : "导出 JSON"}</button>
        </div>}
      </div>
      {exportError && <div className="k6-empty k6-error">导出失败：{exportError}</div>}
      <div className="k6-body">
        <div className="k6-audit-filters">
          <div className="k6-seg-tabs" role="tablist" aria-label="对象类型筛选">
            {([["all", "全部"], ["strategy", "策略"], ["device", "设备"], ["config", "批准目标"]] as const).map(([k, lbl]) => (
              <button key={k} role="tab" aria-selected={targetType === k} className={`k6-seg-tab${targetType === k ? " active" : ""}`} onClick={() => setTargetType(k)}>{lbl}</button>
            ))}
          </div>
          <div className="k6-search">
            <Search size={14} aria-hidden />
            <input className="k6-search-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索动作 / 对象 / 操作者 / 原因" aria-label="搜索审计记录" />
          </div>
          <span className="k6-bdg dim">{filtered.length} 条</span>
        </div>

        {filtered.length === 0 ? (
          <div className="k6-empty-row">暂无匹配的审计记录。发布策略、手动下发或回滚后将在此留痕。</div>
        ) : (
          <div className="k6-audit-list">
            {filtered.map((a) => {
              const actionLabel = auditActionLabel(a.action);
              const object = auditObjectReference(a);
              return (
                <div key={a.auditId} className="k6-audit-row">
                  <div className="k6-audit-main">
                    <span className={`k6-bdg ${a.targetType === "strategy" ? "cyan" : "good"}`}>{auditTargetLabel(a.targetType)}</span>
                    {actionLabel && <span className="k6-audit-action">{actionLabel}</span>}
                    <span className="k6-audit-meta">{object.label}：{object.value} · 操作人：{a.actorId} · 时间：{formatAuditTime(a.createdAt)}</span>
                  </div>
                  <div className="k6-audit-diff">
                    <span className="k6-audit-before">{auditSnapshotText(a.beforeSnapshot)}</span>
                    <span className="k6-audit-arrow" aria-hidden>→</span>
                    <span className="k6-audit-after">{auditSnapshotText(a.afterSnapshot)}</span>
                  </div>
                  <div className="k6-audit-foot">
                    <span>原因：{auditReasonText(a)}</span>
                    {a.requestId && <span className="k6-audit-req">追踪号：{a.requestId}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
