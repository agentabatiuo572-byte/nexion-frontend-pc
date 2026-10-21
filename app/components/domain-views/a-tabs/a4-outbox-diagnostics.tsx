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
    <div className="l-h"><span className="ttl">事件积压 · 只读诊断</span></div>
    <div className="l-b">
      <p>与 A3 一样统计待发送和发送失败的事件，未识别的状态归入“其他”。本页仅查询，不修改事件。上方统计包含全部积压，筛选只影响下方明细；未登记类型统一显示为“未登记事件”。</p>
      {!canRead ? <div className="atint warn">需要 A4 读取权限</div> : <>
        <p>奖励池结算受阻告警的处理成功，仅表示告警已核查；不代表配置已修复或结算已恢复。</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <label>精确类型 <input className="fld" aria-label="积压事件类型" maxLength={96} value={filters.eventType} onChange={e => setFilters({ ...filters, eventType: e.target.value })} /></label>
          <label>状态 <select className="fld" aria-label="积压事件状态" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}><option value="">全部</option><option value="PENDING">待发送</option><option value="FAILED">发送失败</option><option value="OTHER">其他</option></select></label>
          <label><input type="checkbox" checked={filters.unresolvedOnly} onChange={e => setFilters({ ...filters, unresolvedOnly: e.target.checked })} />仅未关联审计记录</label>
          <button className="l-btn sm" disabled={busy} onClick={() => void load(filters)}>{busy ? "读取中…" : "查询 / 刷新"}</button>
        </div>
        {error && <div className="atint warn" role="alert">积压诊断读取失败，本次未展示任何结果。请重新查询。</div>}
        {data && <>
          <p>全部待投递 {data.total} 条 · 最久 {data.oldestSeconds}  秒 · 未关联审计记录 {data.unresolved} 条（待核验，不能据此判定原审计不存在）。此处按完整编号匹配，异常编号可能使本项统计高于 A3。</p>
          {data.groupsTruncated && <div className="atint warn">仅展示前 200 个类型 / 状态组；组计数之和不代表总积压。</div>}
          <table className="tbl"><thead><tr><th>类型</th><th>状态</th><th>条数</th><th>最早时间</th><th>缺审计关联</th></tr></thead><tbody>
            {data.groups.map((g, i) => <tr key={i}><td>{eventTypeText(g.eventType)}</td><td>{statusText(g.status)}</td><td>{g.count}</td><td>{g.oldestAt}</td><td>{g.unresolved}</td></tr>)}
            {!data.groups.length && <tr><td colSpan={5}>当前没有 A3 统计规则下的积压</td></tr>}
          </tbody></table>
          <p>明细按事件记录顺序，每页最多 25 条。当前条件：{applied.eventType || "全部类型"} / {applied.status ? statusText(applied.status) : "全部状态"}{applied.unresolvedOnly ? " / 仅缺审计关联" : ""}。事件状态会变化；刷新从第一页重新读取。</p>
          <div style={{ overflowX: "auto" }}><table className="tbl"><thead><tr><th>事件编号 / 类型</th><th>状态 / 重试</th><th>创建 / 下次重试</th><th>失败码</th><th>处理结果</th><th>审计关联</th></tr></thead><tbody>
            {data.rows.map((r, i) => <tr key={i}><td><code>{r.eventId}</code><br />{eventTypeText(r.eventType)}</td><td>{statusText(r.status)} / {r.retryCount}</td><td>{r.createdAt}<br />{r.nextRetryAt ?? "—"}</td><td>{r.errorCode ?? "无记录"}</td><td>{r.receipts.length ? r.receipts.map(x => `${statusText(x.status)}： ${x.count}`).join(" · ") : "未发现回执（不代表成功）"}</td><td>{r.auditLinkUnresolved ? "未关联审计记录，待核查" : "未命中缺关联条件"}</td></tr>)}
            {!data.rows.length && <tr><td colSpan={6}>当前条件下本页没有记录</td></tr>}
          </tbody></table></div>
          <button className="l-btn sm" disabled={busy || !data.hasMore} onClick={() => data.nextCursor && void load(applied, data.nextCursor)}>下一页</button>
        </>}
      </>}
    </div>
  </section>;
}
