"use client";

import { useRef, useState } from "react";
import { fetchA4OutboxDiagnostics } from "@/lib/admin/a4-client";
import type { OutboxDiagnostics, OutboxFilters } from "@/lib/admin/a4-outbox-diagnostics";

const statusText = (value: string) => ({ PENDING: "待发送", FAILED: "发送失败", OTHER: "其他", SUCCESS: "已完成", DEAD: "已终止", PROCESSING: "处理中", SKIPPED: "已跳过", PENDING_BINDING: "待关联" } as Record<string, string>)[value] ?? "未知状态";
const eventTypeText = (value: string) => value === "UNREGISTERED_EVENT_TYPE" ? "未登记事件" : value;
const emptyFilters: OutboxFilters = { eventType: "", status: "", unresolvedOnly: false };
export function A4OutboxDiagnostics({ canRead }: { canRead: boolean }) {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [data, setData] = useState<OutboxDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  async function load(next: OutboxFilters, cursor = "0") {
    if (!canRead) return;
    const sequence = ++request.current;
    setData(null); setError(false); setBusy(true); setApplied({ ...next });
    try {
      const result = await fetchA4OutboxDiagnostics(next, cursor);
      if (sequence === request.current) setData(result);
    } catch {
      if (sequence === request.current) setError(true);
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  }
  return <section className="l-card" data-proof="a4-outbox-diagnostics">
    <div className="l-h"><span className="ttl">待发送事件积压</span></div>
    <div className="l-b">
      <p>查看还没发出去或发送失败的事件，只能查询，不会修改。筛选只影响下方明细。</p>
      {!canRead ? <div className="atint warn">你没有查看事件的权限</div> : <>
        <p>注意：奖励池结算告警显示「已处理」只代表告警已查看，不代表结算已恢复。</p>
        <div className="ui-form-grid">
          <label>事件类型 <input className="fld" aria-label="积压事件类型" maxLength={96} value={filters.eventType} onChange={e => setFilters({ ...filters, eventType: e.target.value })} /></label>
          <label>状态 <select className="fld" aria-label="积压事件状态" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">全部</option><option value="PENDING">待发送</option><option value="FAILED">发送失败</option><option value="OTHER">其他</option></select></label>
          <label><input type="checkbox" checked={filters.unresolvedOnly} onChange={e => setFilters({ ...filters, unresolvedOnly: e.target.checked })} />只看没有操作记录的</label>
          <button className="l-btn sm" disabled={busy} onClick={() => void load(filters)}>{busy ? "查询中…" : "查询"}</button>
        </div>
        {error && <div className="atint warn" role="alert">查询失败，请重试。</div>}
        {data && <>
          <p>共积压 {data.total} 条 · 最久已等待 {data.oldestSeconds} 秒 · 没有对应操作记录的 {data.unresolved} 条（可能只是编号对不上，需进一步核实）。</p>
          {data.groupsTruncated && <div className="atint warn">只显示前 200 组，各组相加不等于总数。</div>}
          <table className="tbl"><thead><tr><th>类型</th><th>状态</th><th>条数</th><th>最早时间</th><th>无操作记录</th></tr></thead><tbody>
            {data.groups.map((g, i) => <tr key={i}><td>{eventTypeText(g.eventType)}</td><td>{statusText(g.status)}</td><td>{g.count}</td><td>{g.oldestAt}</td><td>{g.unresolved}</td></tr>)}
            {!data.groups.length && <tr><td colSpan={5}>暂无积压</td></tr>}
          </tbody></table>
          <p>每页最多 25 条。当前条件：{applied.eventType || "全部类型"} / {applied.status ? statusText(applied.status) : "全部状态"}{applied.unresolvedOnly ? " / 只看没有操作记录的" : ""}。</p>
          <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>事件编号 / 类型</th><th>状态 / 重试</th><th>创建 / 下次重试</th><th>失败原因</th><th>处理结果</th><th>操作记录</th></tr></thead><tbody>
            {data.rows.map((r, i) => <tr key={i}><td><code>{r.eventId}</code><br />{eventTypeText(r.eventType)}</td><td>{statusText(r.status)} / {r.retryCount}</td><td>{r.createdAt}<br />{r.nextRetryAt ?? "—"}</td><td>{r.errorCode ?? "无记录"}</td><td>{r.receipts.length ? r.receipts.map(x => `${statusText(x.status)}： ${x.count}`).join(" · ") : "未发现回执（不代表成功）"}</td><td>{r.auditLinkUnresolved ? "未关联审计记录，待核查" : "未命中缺关联条件"}</td></tr>)}
            {!data.rows.length && <tr><td colSpan={6}>没有符合条件的记录</td></tr>}
          </tbody></table></div>
          <button className="l-btn sm" disabled={busy || !data.hasMore} onClick={() => data.nextCursor && void load(applied, data.nextCursor)}>下一页</button>
        </>}
      </>}
    </div>
  </section>;
}
