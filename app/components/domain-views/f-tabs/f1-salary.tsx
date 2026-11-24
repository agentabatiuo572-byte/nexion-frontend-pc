"use client";

/**
 * F1「月薪领取」页签（画板 C1、C2、C3）：月薪领取记录，按用户、月份、等级查，按领取时间倒序，游标每批 100 条。
 * F1-RANK-WIRE：数据来自 ctx.salaryClaims，查询调 ctx.querySalaryClaims(filters, cursor)（B87-BE-04）。
 * 不传（这个后端读不到月薪）时整块写没有月薪数据，查询条不出现。
 */
import { useEffect, useRef, useState } from "react";
import { Banknote } from "lucide-react";
import { BlockState, Button, Cell, Drawer, FilterBar, FilterField, Input, KeyValues, Panel, Select, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { businessDay, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { amountDisplay } from "@/lib/format";
import type { FViewCtx } from "./types";
import type { F1RankRowView, F1SalaryClaim, F1SalaryFilters } from "./f1-rank-types";

const EMPTY: F1SalaryFilters = { user: "", month: "", rank: "" };

/** 近 12 个月（业务时区），本月在前。 */
function recentMonths(): string[] {
  const [year, month] = businessDay(0).slice(0, 7).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const at = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** 领取时间（业务时区）不在月薪那个月：只会是 1 号领上个月。由月份和领取时间比出来，不要新字段。 */
const lateClaim = (claim: F1SalaryClaim) => {
  const at = formatBusinessTimeCompact(claim.claimedAt, "");
  return at !== "" && at.slice(0, 7) !== claim.month;
};

export function F1SalaryClaims({ ctx, rows }: { ctx: FViewCtx; rows: F1RankRowView[] }) {
  const [draft, setDraft] = useState<F1SalaryFilters>(EMPTY);
  const [applied, setApplied] = useState<F1SalaryFilters>(EMPTY);
  const [openNo, setOpenNo] = useState<string | null>(null);
  const state = ctx.salaryClaims;
  const zone = businessZone().label;
  // 第一次打开这个页签读一次（不带条件）；之后只在点「查询」、移除条件、加载更早记录时读。
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !ctx.querySalaryClaims || !ctx.salaryClaims) return;
    opened.current = true;
    if (ctx.salaryClaims.items.length === 0 && !ctx.salaryClaims.loading) void ctx.querySalaryClaims(EMPTY);
  }, [ctx.querySalaryClaims, ctx.salaryClaims]);
  if (!state || !ctx.querySalaryClaims) {
    return <Panel title="月薪领取记录" icon={Banknote} tone="role-1"
      explain="用户每领一次月薪记一条，领到的直接进可用余额，不冷却。">
      <BlockState state="empty" title="现在没有月薪数据" detail="这里还读不到各级月薪和领取记录；读到后会按领取时间倒序列出。" />
    </Panel>;
  }
  const query = ctx.querySalaryClaims;
  const run = (next: F1SalaryFilters) => { setApplied(next); setDraft(next); void query(next); };
  const hasFilter = !!(applied.user || applied.month || applied.rank);
  const chips = [
    applied.user && { key: "user", label: `用户 ${applied.user}`, onRemove: () => run({ ...applied, user: "" }) },
    applied.month && { key: "month", label: `月薪月份 ${applied.month}`, onRemove: () => run({ ...applied, month: "" }) },
    applied.rank && { key: "rank", label: `等级 ${applied.rank}`, onRemove: () => run({ ...applied, rank: "" }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[];
  const salaryRanks = rows.filter((row) => Number(row.v.slice(1)) >= 2);
  const items = state.items;
  const current = items.find((item) => item.claimNo === openNo) ?? null;
  const at = current ? items.indexOf(current) : -1;
  return <>
    <FilterBar onSubmit={() => run(draft)} querying={state.loading} onClear={() => run(EMPTY)} canClear={hasFilter} applied={chips}>
      <FilterField grow><Input aria-label="领取用户编码或系统编号" placeholder="用户编码或系统编号" value={draft.user}
        onChange={(event) => setDraft({ ...draft, user: event.target.value })} /></FilterField>
      <FilterField><Select aria-label="月薪月份" value={draft.month} onChange={(value) => setDraft({ ...draft, month: value })}
        options={[{ value: "", label: "全部月份" }, ...recentMonths().map((month) => ({ value: month, label: month }))]} /></FilterField>
      <FilterField><Select aria-label="月薪等级" value={draft.rank} onChange={(value) => setDraft({ ...draft, rank: value })}
        options={[{ value: "", label: "全部等级" }, ...salaryRanks.map((row) => ({ value: row.v, label: row.v }))]} /></FilterField>
    </FilterBar>
    <Panel title="月薪领取记录" icon={Banknote} tone="role-1" flush sub={items.length ? `已加载 ${items.length} 条` : undefined}
      explain={<><p>用户每领一次记一条，一个月最多一条；等级是这个月到达过的最高等级。</p>
        <p>只能当月领，没领的下月作废；月底最后一天升到当月新的最高等级的，下月 1 号当天还能领上个月的，行里写「1 号领上月」。</p>
        <p>领到的月薪直接进可用余额，不冷却。按领取时间倒序，每次加载 100 条；账单号可以在「账本与账单核对」查。</p></>}>
      <Table label="月薪领取记录" className="f1-table f1-salary-table">
        <thead><tr>
          <Th>领取号</Th><Th>用户</Th><Th>月份 / 等级</Th><Th align="right" className="f1-col-amt">金额（USDT）</Th>
          <Th className="f1-col-time">领取时间（{zone}）</Th><Th align="right" sticky="end">操作</Th>
        </tr></thead>
        <tbody>
          {state.error && items.length === 0 ? <TableMessage columns={6} role="alert">月薪领取记录读取失败 · {state.error} <Button size="sm" onClick={() => void query(applied)}>重试</Button></TableMessage>
            : items.length === 0 ? state.loading ? <TableLoading columns={6} />
              : hasFilter ? <TableMessage columns={6}>没有符合条件的月薪领取记录 <Button size="sm" onClick={() => run(EMPTY)}>清除筛选</Button></TableMessage>
                : <TableMessage columns={6}>还没有人领过月薪；V2 及以上的用户在 App 领取后会出现在这里</TableMessage>
              : items.map((item) => (
                <Tr key={item.claimNo} selected={item.claimNo === openNo} onOpen={() => setOpenNo(item.claimNo)}>
                  <Td><Cell main={<span data-mono="">{item.claimNo}</span>} sub={item.billNo ? <span data-mono="">账单 {item.billNo}</span> : undefined} /></Td>
                  <Td><Cell mono main={item.userCode || item.userId} sub={<span className="f5-sans">{item.nickname || "—"}</span>} /></Td>
                  <Td><Cell num main={item.month} sub={lateClaim(item) ? `${item.rankCode} · 1 号领上月` : item.rankCode} /></Td>
                  <Td align="right"><Cell num main={amountDisplay(item.amountUsdt)} /></Td>
                  <Td className="f1-col-time"><Cell num main={formatBusinessTimeCompact(item.claimedAt, "—")} /></Td>
                  <Td align="right" sticky="end" data-fit=""><Button size="sm" variant="ghost" onClick={() => setOpenNo(item.claimNo)}>详情</Button></Td>
                </Tr>
              ))}
        </tbody>
      </Table>
      {items.length > 0 && (state.nextCursor || state.error) && <div className="f1-more">
        {state.error && <span className="f1-more-error" role="alert">没有加载到更早记录 · {state.error}</span>}
        <Button size="sm" loading={state.loading} onClick={() => void query(applied, state.nextCursor ?? undefined)}>{state.error ? "重试" : "加载更早记录"}</Button>
      </div>}
      <Drawer open={!!current} onClose={() => setOpenNo(null)} title="月薪领取" icon={Banknote} tone="role-1"
        sub={current ? <span data-mono="">{current.claimNo}</span> : undefined}
        nav={{ onPrev: () => setOpenNo(items[at - 1]?.claimNo ?? null), onNext: () => setOpenNo(items[at + 1]?.claimNo ?? null), hasPrev: at > 0, hasNext: at >= 0 && at < items.length - 1 }}>
        {current && <KeyValues rows={[
          { key: "user", label: "用户", value: <>{current.nickname || "—"} · <span data-mono="">{current.userCode || current.userId}</span></> },
          { key: "month", label: "月薪月份", value: current.month },
          { key: "rank", label: "等级", value: current.rankCode, explain: "这个月到达过的最高等级。" },
          ...(lateClaim(current) ? [{ key: "late", label: "领取方式", value: "1 号领上月", explain: "上个月最后一天升到当月新的最高等级，只能在下月 1 号当天领上个月的。" }] : []),
          { key: "amt", label: "金额", value: `${amountDisplay(current.amountUsdt)} USDT` },
          { key: "to", label: "到账", value: "直接进可用余额，不冷却" },
          { key: "at", label: `领取时间（${zone}）`, value: formatBusinessTimeCompact(current.claimedAt, "—") },
          { key: "bill", label: "账单", value: current.billNo ? <span data-mono="">{current.billNo}</span> : "—", explain: "可以在「账本与账单核对」按账单号查。" },
        ]} />}
      </Drawer>
    </Panel>
  </>;
}
