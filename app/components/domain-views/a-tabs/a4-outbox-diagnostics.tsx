"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Inbox, RefreshCw } from "lucide-react";
import { fetchA4OutboxDeadLetters, fetchA4OutboxDiagnostics } from "@/lib/admin/a4-client";
import type { OutboxDeadLetters, OutboxDiagnostics, OutboxFilters } from "@/lib/admin/a4-outbox-diagnostics";
import { BarList, BlockState, Button, Cell, Check, Explain, FilterBar, FilterField, Input, Notice, Panel, Select, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { BACKLOG_STATUS, H3_TYPE_TEXT, RECEIPT_STATUS, errorText, minute, waited, zoneNote } from "./a4-event-views";

const statusText = (value: string) => BACKLOG_STATUS[value] ?? RECEIPT_STATUS[value] ?? "未知状态";
const emptyFilters: OutboxFilters = { eventType: "", status: "", unresolvedOnly: false };
export const A4_USER_NOTE = "能看到用户编号的才显示，点编号打开用户详情。显示「—」可能是这条事件不属于某位用户、没查到这位用户、用户已删除、你没有查看用户的权限，或这位用户不在你的客服范围内；页面分不出是哪一种。";
/** Whose event this is: a user number links to the user detail; an empty one stays 「—」, whatever the reason. */
export function a4UserCell(userNo: string | null | undefined, canOpenUser: boolean): ReactNode {
  if (!userNo) return "—";
  return canOpenUser ? <Link className="rd-link" data-mono href={`/users/search/${encodeURIComponent(userNo)}`} prefetch={false}>{userNo}</Link> : <span data-mono>{userNo}</span>;
}

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
export function A4OutboxDiagnostics({ state, describe, canOpenUser }: { state: A4OutboxState; describe: (eventType: string) => string | undefined; canOpenUser: boolean }) {
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
      explain={<><p>还在等发送或发送失败、等下次重试的事件，只能查询。上面的总数和按类型汇总不受筛选影响。</p><p>已终止（死信）的不在这里，见下方「周任务死信」。奖励池结算告警显示「已处理」，不代表结算已恢复。</p></>}
      actions={canRead ? <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={busy && !filtered} onClick={() => void load(applied)}>重新查询</Button> : undefined}>
      {!canRead ? <BlockState state="denied" title="你没有查看事件的权限" detail="查看投递积压要有用户行为事件的查看权限。" /> : <>
        {error && <BlockState state="error" title="查询失败，请重试。" onRetry={() => void load(applied)} retrying={busy} />}
        {!data && !error && busy && <BlockState state="loading" title="正在查询投递积压…" />}
        {!data && !error && !busy && <BlockState state="empty" title="还没有查询" detail="点「重新查询」读一次。" onRetry={() => void load(emptyFilters)} retryLabel="查询" />}
        {data && <>
          {data.total === 0 ? <Notice tone="ok">没有积压：现在没有待发送或等重试的事件。死信另算，见下方。</Notice> : (
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
                  {data.groupsTruncated ? "只列出前 200 组，各组相加不等于总数。" : `另有 ${data.groups.length - 8} 组没列出，逐条明细里能筛到。`}
                </p>}
              </div>
            </div>
          )}
        </>}
        <FilterBar onSubmit={() => void load(filters)} querying={busy}
          onClear={() => { setFilters(emptyFilters); void load(emptyFilters); }} canClear={filtered}>
          <FilterField grow><Input aria-label="积压事件类型" placeholder="事件类型，例如 trial.redeemed" maxLength={96} value={filters.eventType} onChange={(event) => setFilters({ ...filters, eventType: event.target.value })} /></FilterField>
          <FilterField><Select aria-label="积压事件状态" value={filters.status} onChange={(status) => setFilters({ ...filters, status })} placeholder="全部状态"
            options={[{ value: "PENDING", label: "待发送" }, { value: "FAILED", label: "发送失败" }, { value: "OTHER", label: "其他" }]} /></FilterField>
          <FilterField><Check label="只看缺操作记录的" checked={filters.unresolvedOnly} onChange={(event) => setFilters({ ...filters, unresolvedOnly: event.target.checked })} /></FilterField>
        </FilterBar>
        {data && <>
          <Table label="积压事件明细" className="a4-backlog-table">
            <thead><tr>
              <Th>事件</Th><Th>用户<Explain label="用户编号怎么显示" content={A4_USER_NOTE} /></Th><Th>卡在哪 · 已重试</Th><Th>产生 · 下次重试</Th><Th>失败原因</Th>
              <Th>处理结果<Explain label="处理结果是什么" content="每个使用这条事件的模块（使用方）处理到了哪一步。还没有处理结果，不代表已经成功。" /></Th>
            </tr></thead>
            <tbody>
              {data.rows.map((row, index) => {
                const name = typeName(row.eventType);
                return (
                  <Tr key={`${row.eventId}-${index}`}>
                    <Td><Cell main={name.main} sub={<span data-mono className="a4-mid" title={row.eventId}><span>{row.eventId.slice(0, -8)}</span><span>{row.eventId.slice(-8)}</span></span>} /></Td>
                    <Td>{a4UserCell(row.userNo, canOpenUser)}</Td>
                    <Td>
                      <span className="a4-pair">
                        <StatusTag tone={row.status === "FAILED" ? "warn" : "neutral"}>{statusText(row.status)}</StatusTag>
                        <span className="a4-dim">已重试 <span data-num>{row.retryCount}</span> 次</span>
                        {row.auditLinkUnresolved && <StatusTag tone="warn" explain="这条「查看用户资料」事件找不到对应的操作记录，待核查。">缺操作记录</StatusTag>}
                      </span>
                    </Td>
                    <Td><Cell main={minute(row.createdAt)} sub={row.nextRetryAt ? `下次 ${minute(row.nextRetryAt)}` : "没有安排重试"} /></Td>
                    <Td>{errorText(row.errorCode)}</Td>
                    <Td>{row.receipts.length
                      ? <span className="a4-receipts">{row.receipts.map((receipt) => <span key={receipt.status}>{RECEIPT_STATUS[receipt.status] ?? "其他"} {receipt.count}</span>)}</span>
                      : <span className="a4-dim a4-stack"><span>还没有处理结果</span><span>不代表成功</span></span>}</Td>
                  </Tr>
                );
              })}
              {!data.rows.length && <TableMessage columns={6}>{filtered ? "没有符合条件的记录" : "暂无积压"}</TableMessage>}
            </tbody>
          </Table>
          <div className="a4-next">
            <span className="a4-note">第 {page} 页 · 本页 {data.rows.length} 条，每页最多 25 条</span>
            {page > 1 && <Button size="sm" onClick={() => void load(applied)}>回到第一页</Button>}
            <Button size="sm" disabledReason={busy ? "正在查询" : !data.hasMore ? "已经是最后一页" : undefined} onClick={() => data.nextCursor && void load(applied, data.nextCursor)}>下一页</Button>
          </div>
        </>}
      </>}
    </Panel>
  );
}


/** 「投递与死信」页签中间：5 种周任务事件已终止（死信）的按类型汇总。只读，不触发重新排队。 */
export function A4DeadLetterSummary({ canRead }: { canRead: boolean }) {
  const [data, setData] = useState<OutboxDeadLetters | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  async function load() {
    const sequence = ++request.current;
    setError(false); setBusy(true);
    try {
      const result = await fetchA4OutboxDeadLetters();
      if (sequence === request.current) setData(result);
    } catch {
      if (sequence === request.current) { setData(null); setError(true); }
    } finally {
      if (sequence === request.current) setBusy(false);
    }
  }
  useEffect(() => { if (canRead) void load(); }, [canRead]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!canRead) return null;
  const total = data?.types.reduce((sum, row) => sum + row.outboxDeadCount, 0) ?? 0;
  const both = data?.types.reduce((sum, row) => sum + row.bothLayersDeadCount, 0) ?? 0;
  return (
    <Panel title="周任务死信" icon={Ban} tone="role-2"
      sub={data && total ? `原事件终止 ${total} 条 · 两层都终止 ${both} 条 · ${zoneNote()}` : undefined}
      explain={<><p>5 种周任务事件里，原事件已终止、不再自动重发的条数；「两层都终止」是其中任务处理也已终止的。</p><p>两层都终止不等于能重新排队：要在下面逐条查询，满足条件才能排。时间是最早一条变成终止的时间，不一定是第一次失败的时间。</p></>}
      actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={busy} onClick={() => void load()}>重新查询</Button>}>
      {error ? <BlockState state="error" title="死信汇总没查到，请重试。" onRetry={() => void load()} retrying={busy} />
        : !data ? <BlockState state="loading" title="正在查询死信…" />
        : total === 0 ? <p className="a4-note">5 种周任务事件现在都没有死信。</p>
        : <Table label="周任务死信按类型" className="a4-dead-table">
          <thead><tr><Th>周任务事件</Th><Th align="right">原事件终止</Th><Th align="right">两层都终止</Th><Th>最早一条</Th></tr></thead>
          <tbody>{data.types.map((row) => (
            <Tr key={row.questCode}>
              <Td><Cell main={H3_TYPE_TEXT[row.eventType] ?? row.eventType} /></Td>
              <Td align="right"><span data-num>{row.outboxDeadCount}</span> 条</Td>
              <Td align="right"><span data-num>{row.bothLayersDeadCount}</span> 条</Td>
              <Td><Cell main={minute(row.oldestOutboxLastStateAt)}
                sub={row.bothLayersDeadCount === 0 ? undefined : !row.bothLayersDeadTimeComplete ? "两层：有的没记时间" : `两层 ${minute(row.oldestBothLayersDeadObservedAt)}`} /></Td>
            </Tr>
          ))}</tbody>
        </Table>}
    </Panel>
  );
}
