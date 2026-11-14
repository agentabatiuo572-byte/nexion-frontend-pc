"use client";

import { useRef, useState } from "react";
import { Inbox, RefreshCw } from "lucide-react";
import { fetchA4OutboxDiagnostics } from "@/lib/admin/a4-client";
import type { OutboxDiagnostics, OutboxFilters } from "@/lib/admin/a4-outbox-diagnostics";
import { BarList, BlockState, Button, Cell, Check, Explain, FilterBar, FilterField, Input, Notice, Panel, Select, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { BACKLOG_STATUS, RECEIPT_STATUS, errorText, minute, waited, zoneNote } from "./a4-event-views";

const statusText = (value: string) => BACKLOG_STATUS[value] ?? RECEIPT_STATUS[value] ?? "未知状态";
const emptyFilters: OutboxFilters = { eventType: "", status: "", unresolvedOnly: false };

/** 投递积压的查询状态。查询、翻页的写法和旧页面一样：草稿和已应用分开，下一页用已应用的条件。 */
export function useA4OutboxDiagnostics(canRead: boolean) {
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);
  const [data, setData] = useState<OutboxDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const request = useRef(0);
  async function load(next: OutboxFilters, cursor = "0") {
    if (!canRead) return;
    const sequence = ++request.current;
    setData(null); setError(false); setBusy(true); setApplied({ ...next });
    setPage((current) => cursor === "0" ? 1 : current + 1);
    try {
      const result = await fetchA4OutboxDiagnostics(next, cursor);
      if (sequence === request.current) setData(result);
    } catch {
      if (sequence === request.current) setError(true);
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  }
  return { canRead, filters, setFilters, applied, data, busy, error, page, load };
}

export type A4OutboxState = ReturnType<typeof useA4OutboxDiagnostics>;

/** 「投递与死信」页签上半部分：卡住没送到的事件，按类型汇总，再看逐条明细。只查询，不修改。 */
export function A4OutboxDiagnostics({ state, describe }: { state: A4OutboxState; describe: (eventType: string) => string | undefined }) {
  const { canRead, filters, setFilters, applied, data, busy, error, page, load } = state;
  const filtered = !!(applied.eventType || applied.status || applied.unresolvedOnly);
  const typeName = (value: string) => {
    if (value === "UNREGISTERED_EVENT_TYPE") return { main: "未登记事件", code: undefined };
    const desc = describe(value);
    return desc ? { main: desc, code: value } : { main: value, code: undefined };
  };
  return (
    <Panel data-proof="a4-outbox-diagnostics" title="没投递出去的事件" icon={Inbox} tone="role-2"
      sub={data ? `共 ${data.total} 条 · ${zoneNote()}` : undefined}
      explain={<><p>还在等发送（待发送）或发送失败、等下次重试的事件。只能查询，不会修改。</p><p>上面的总数和按类型汇总总是全部积压，不受下面筛选影响；筛选只影响逐条明细。</p><p>已终止（死信）的事件不在这里，见下方「重新排队一条任务事件」。</p><p>奖励池结算告警显示「已处理」只说明告警投递已登记，不代表结算已恢复。</p></>}
      actions={canRead ? <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={busy && !filtered} onClick={() => void load(applied)}>重新查询</Button> : undefined}>
      {!canRead ? <BlockState state="denied" title="你没有查看事件的权限" detail="查看投递积压要有用户行为事件的查看权限。" /> : <>
        {error && <BlockState state="error" title="查询失败，请重试。" onRetry={() => void load(applied)} retrying={busy} />}
        {!data && !error && busy && <BlockState state="loading" title="正在查询投递积压…" />}
        {!data && !error && !busy && <BlockState state="empty" title="还没有查询" detail="点「重新查询」读一次。" onRetry={() => void load(emptyFilters)} retryLabel="查询" />}
        {data && <>
          {data.total === 0 ? <Notice tone="ok">没有积压：所有事件都已发出或已结束。</Notice> : (
            <div className="a4-backlog-sum">
              <dl className="a4-backlog-facts">
                <div><dt>积压</dt><dd><b>{data.total}</b> 条</dd></div>
                <div><dt>最久已等</dt><dd><b>{waited(data.oldestSeconds)}</b></dd></div>
                <div><dt>缺操作记录<Explain label="缺操作记录是什么" content={<><p>只核对「查看用户资料」这一种事件：找不到对应的操作记录时计入。其他事件不做这项检查。</p><p>可能只是编号对不上，要进一步核实。</p></>} /></dt><dd><b>{data.unresolved}</b> 条</dd></div>
              </dl>
              <div className="a4-backlog-bars">
                <BarList label="积压按事件类型" slot={2} rows={data.groups.slice(0, 8).map((group, index) => {
                  const name = typeName(group.eventType);
                  return { key: `${group.eventType}-${group.status}-${index}`, label: <span className="a4-pair">{name.main}<StatusTag tone={group.status === "FAILED" ? "warn" : "neutral"}>{statusText(group.status)}</StatusTag></span>, value: group.count,
                    text: <>{group.count} 条 <span className="a4-dim">· 最早 {minute(group.oldestAt)}</span></> };
                })} />
                {(data.groups.length > 8 || data.groupsTruncated) && <p className="a4-note">
                  {data.groupsTruncated ? "只返回了前 200 组，各组相加不等于总数。" : `另有 ${data.groups.length - 8} 组没列出，逐条明细里能筛到。`}
                </p>}
              </div>
            </div>
          )}
        </>}
        <FilterBar onSubmit={() => void load(filters)} querying={busy}
          onClear={() => { setFilters(emptyFilters); void load(emptyFilters); }} canClear={filtered}
          result={data ? `第 ${page} 页 · 本页 ${data.rows.length} 条，每页最多 25 条` : undefined}>
          <FilterField grow><Input aria-label="积压事件类型" placeholder="事件类型，例如 trial.redeemed" maxLength={96} value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })} /></FilterField>
          <FilterField><Select aria-label="积压事件状态" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} placeholder="全部状态"
            options={[{ value: "PENDING", label: "待发送" }, { value: "FAILED", label: "发送失败" }, { value: "OTHER", label: "其他" }]} /></FilterField>
          <FilterField><Check label="只看缺操作记录的" checked={filters.unresolvedOnly} onChange={(event) => setFilters({ ...filters, unresolvedOnly: event.target.checked })} /></FilterField>
        </FilterBar>
        {data && <>
          <Table label="积压事件明细" className="a4-backlog-table">
            <thead><tr>
              <Th>事件</Th><Th>卡在哪</Th><Th align="right">已重试</Th><Th>产生 · 下次重试</Th><Th>失败原因</Th>
              <Th>使用方处理结果<Explain label="使用方处理结果是什么" content="每个使用这条事件的模块处理到了哪一步。没有发现回执不代表已经成功。" /></Th>
            </tr></thead>
            <tbody>
              {data.rows.map((row, index) => {
                const name = typeName(row.eventType);
                return (
                  <Tr key={`${row.eventId}-${index}`}>
                    <Td><Cell main={name.main} sub={<span data-mono title={row.eventId}>{row.eventId}</span>} /></Td>
                    <Td>
                      <span className="a4-pair">
                        <StatusTag tone={row.status === "FAILED" ? "warn" : "neutral"}>{statusText(row.status)}</StatusTag>
                        {row.auditLinkUnresolved && <StatusTag tone="warn" explain="这条「查看用户资料」事件找不到对应的操作记录，待核查。">缺操作记录</StatusTag>}
                      </span>
                    </Td>
                    <Td align="right"><span data-num>{row.retryCount}</span> 次</Td>
                    <Td><Cell main={minute(row.createdAt)} sub={row.nextRetryAt ? `下次 ${minute(row.nextRetryAt)}` : "没有安排重试"} /></Td>
                    <Td>{errorText(row.errorCode)}</Td>
                    <Td>{row.receipts.length
                      ? <span className="a4-receipts">{row.receipts.map((receipt) => <span key={receipt.status}>{RECEIPT_STATUS[receipt.status] ?? "其他"} {receipt.count}</span>)}</span>
                      : <span className="a4-dim">未发现回执（不代表成功）</span>}</Td>
                  </Tr>
                );
              })}
              {!data.rows.length && <TableMessage columns={6}>{filtered ? "没有符合条件的记录" : "暂无积压"}</TableMessage>}
            </tbody>
          </Table>
          <div className="a4-next">
            {page > 1 && <Button size="sm" onClick={() => void load(applied)}>回到第一页</Button>}
            <Button size="sm" disabledReason={busy ? "正在查询" : !data.hasMore ? "已经是最后一页" : undefined} onClick={() => data.nextCursor && void load(applied, data.nextCursor)}>下一页</Button>
          </div>
        </>}
      </>}
    </Panel>
  );
}

