"use client";

// audit-ok:hydration —— K6 client-only(console-shell mount 门内渲染,无 SSR 水合);janus-c2 persist 走 localStorage 同步水合,无时序错位。

/**
 * K6 审计日志(SPEC 5 · PRD §16 / §19)。
 * 策略发布 / 手动下发 / 状态修改 / 回滚等关键动作的不可篡改记录:操作者 / 时间 / 前后快照 / 原因 / 请求号。
 * 支持按对象类型筛选 + 关键词搜索 + CSV 导出。数据来自 store.audit(append-only)。
 */
import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { useK6Operator } from "./use-operator";
import { timeAgo } from "@/lib/mock/admin/janus-c2/scoring";
import {
  ACTION_TYPE_LABEL,
  STATUS_LABEL,
  STRATEGY_STATUS_LABEL,
  STATUS_SOURCE_LABEL,
  remoteUrlLabel,
} from "@/lib/mock/admin/janus-c2/labels";
import type { AuditLog } from "@/lib/mock/admin/janus-c2/types";

const TARGET_LABEL: Record<string, string> = { device: "设备", strategy: "策略", config: "配置" };
const KEY_LABEL: Record<string, string> = {
  status: "状态", statusSource: "来源", remoteUrlKey: "远程地址", version: "版本",
  name: "名称", priority: "优先级", action: "动作", rolledBackFrom: "回滚自", from: "原值",
};
const lookup = (m: Record<string, string>, v: unknown): string => m[String(v)] ?? String(v);
const DEVICE_STATUS_KEYS = new Set(Object.keys(STATUS_LABEL));

function valLabel(key: string, v: unknown): string {
  if (v == null) return "—";
  // status 值可能是设备状态或策略状态:按 key 集合判定归属,避免误判致 code 裸露。
  if (key === "status") return DEVICE_STATUS_KEYS.has(String(v)) ? lookup(STATUS_LABEL as Record<string, string>, v) : lookup(STRATEGY_STATUS_LABEL as Record<string, string>, v);
  if (key === "statusSource") return lookup(STATUS_SOURCE_LABEL as Record<string, string>, v);
  if (key === "action") return lookup(ACTION_TYPE_LABEL as Record<string, string>, v);
  if (key === "remoteUrlKey") return remoteUrlLabel(String(v));
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}

function snapText(snap: unknown): string {
  if (snap == null) return "—";
  if (typeof snap !== "object") return String(snap);
  return Object.entries(snap as Record<string, unknown>)
    .map(([k, v]) => `${KEY_LABEL[k] ?? k} ${valLabel(k, v)}`)
    .join(" · ");
}

function reasonText(a: AuditLog): string {
  // reasonCategory 存的就是运营可读中文(来自 REASON_CATEGORIES 选项)。
  return [a.reasonCategory, a.reasonText].filter(Boolean).join(" · ") || "—";
}

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
  const head = ["时间", "操作", "对象类型", "对象", "操作者", "原因", "变更前", "变更后", "请求号"];
  const esc = (s: string): string => `"${s.replace(/"/g, '""')}"`;
  const body = rows.map((a) =>
    [new Date(a.createdAt).toISOString(), a.action, TARGET_LABEL[a.targetType] ?? a.targetType, a.targetId, a.actorId, reasonText(a), snapText(a.beforeSnapshot), snapText(a.afterSnapshot), a.requestId ?? ""]
      .map((c) => esc(String(c))).join(","),
  );
  return [head.map(esc).join(","), ...body].join("\n");
}

function exportRows(rows: AuditLog[]) {
  return rows.map((a) => ({
    时间: new Date(a.createdAt).toISOString(),
    操作: a.action,
    对象类型: TARGET_LABEL[a.targetType] ?? a.targetType,
    对象: a.targetId,
    操作者: a.actorId,
    原因: reasonText(a),
    变更前: snapText(a.beforeSnapshot),
    变更后: snapText(a.afterSnapshot),
    请求号: a.requestId ?? "",
  }));
}

export function K6AuditLog() {
  const audit = useJanusC2Store((s) => s.audit);
  const recordExport = useJanusC2Store((s) => s.recordExport);
  const operator = useK6Operator();
  const [targetType, setTargetType] = useState<"all" | "device" | "strategy">("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      audit.filter(
        (a) =>
          (targetType === "all" || a.targetType === targetType) &&
          (!q ||
            a.action.includes(q) ||
            a.targetId.toLowerCase().includes(q.toLowerCase()) ||
            (a.reasonText ?? "").includes(q) ||
            a.actorId.toLowerCase().includes(q.toLowerCase())),
      ),
    [audit, targetType, q],
  );

  const ts = (): string => new Date(audit[0]?.createdAt ?? 0).toISOString().slice(0, 10);

  return (
    <div className="k6-panel">
      <div className="k6-sec-head">
        <div><div className="k6-kicker">审计日志</div><h3>关键动作记录</h3><p>策略发布、手动状态下发、回滚等动作的 append-only 记录,含操作者、前后快照与原因,可追溯不可篡改。</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="k6-pgbtn" disabled={!filtered.length} onClick={() => { download(`janus-audit-${ts()}.csv`, toCsv(filtered), "text/csv;charset=utf-8"); recordExport("导出审计日志 CSV", operator.id, { 格式: "CSV", 条数: filtered.length, 范围: targetType }); }}><Download size={14} aria-hidden style={{ marginRight: 4 }} />导出 CSV</button>
          <button className="k6-pgbtn" disabled={!filtered.length} onClick={() => { download(`janus-audit-${ts()}.json`, JSON.stringify(exportRows(filtered), null, 2), "application/json"); recordExport("导出审计日志 JSON", operator.id, { 格式: "JSON", 条数: filtered.length, 范围: targetType }); }}>导出 JSON</button>
        </div>
      </div>
      <div className="k6-body">
        <div className="k6-audit-filters">
          <div className="k6-seg-tabs" role="tablist" aria-label="对象类型筛选">
            {([["all", "全部"], ["strategy", "策略"], ["device", "设备"]] as const).map(([k, lbl]) => (
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
            {filtered.map((a) => (
              <div key={a.auditId} className="k6-audit-row">
                <div className="k6-audit-main">
                  <span className={`k6-bdg ${a.targetType === "strategy" ? "cyan" : "good"}`}>{TARGET_LABEL[a.targetType] ?? a.targetType}</span>
                  <span className="k6-audit-action">{a.action}</span>
                  <span className="k6-audit-meta">{a.actorId} · {timeAgo(a.createdAt)}</span>
                </div>
                <div className="k6-audit-diff">
                  <span className="k6-audit-before">{snapText(a.beforeSnapshot)}</span>
                  <span className="k6-audit-arrow" aria-hidden>→</span>
                  <span className="k6-audit-after">{snapText(a.afterSnapshot)}</span>
                </div>
                <div className="k6-audit-foot">
                  <span>原因:{reasonText(a)}</span>
                  {a.requestId && <span className="k6-audit-req">{a.requestId}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
