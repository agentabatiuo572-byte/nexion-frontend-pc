"use client";

/**
 * F1「月薪领取」页签（画板 C1、C2、C3）：月薪领取记录，按用户、月份、等级查，按领取时间倒序，游标每批 100 条。
 * 不传（这个后端读不到月薪）时整块写没有月薪数据，查询条不出现。
 */
import { useEffect, useRef, useState } from "react";
import { Banknote } from "lucide-react";
import { BlockState, Button, Cell, Drawer, FilterBar, FilterField, Input, KeyValues, Panel, Select, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { businessDay, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { growthTeamDate, isPreviousMonthSalaryClaim } from "@/lib/admin/business-calendar-client";
import { F1_EMPTY_SALARY_FILTERS as EMPTY, teamUserId } from "@/lib/admin/f-overview-contract";
import type { F1VRankRow } from "@/lib/admin/f1-client";
import { amountDisplay } from "@/lib/format";
import type { FViewCtx } from "./types";
import type { F1SalaryClaim, F1SalaryFilters } from "./f1-rank-types";
import { replaceTeamFilterParams } from "@/lib/admin/team-filter-url";

const SALARY_RANKS = ["V2", "V3", "V4", "V5", "V6", "V7", "V8"];

/** 近 12 个月（业务时区），本月在前。 */
function recentMonths(today: string): string[] {
  const [year, month] = today.slice(0, 7).split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const at = new Date(Date.UTC(year, month - 1 - i, 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function F1SalaryClaims({ ctx, rows }: { ctx: FViewCtx; rows: F1VRankRow[] }) {
  const [draft, setDraft] = useState<F1SalaryFilters>(() => ctx.salaryClaims?.filters ?? EMPTY);
  const [queryError, setQueryError] = useState(false);
  const [openNo, setOpenNo] = useState<string | null>(null);
  const state = ctx.salaryClaims;
  const zone = businessZone().label;
  const query = ctx.querySalaryClaims;
  const lateClaim = (claim: F1SalaryClaim) => isPreviousMonthSalaryClaim(ctx.teamBusinessCalendar, claim.month, claim.claimedAt);
  const today = growthTeamDate(ctx.teamBusinessCalendar, Date.now()) ?? businessDay();
  const months = recentMonths(today);
  const monthsRef = useRef(months);
  monthsRef.current = months;
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    if (!query) return;
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const user = params.get("userId") ?? "", month = params.get("month") ?? "", rank = params.get("rankCode") ?? "";
      const filters = { user: teamUserId(user) ? user : "", month: monthsRef.current.includes(month) ? month : "", rank: SALARY_RANKS.includes(rank) ? rank : "" };
      replaceTeamFilterParams({ userId: filters.user, month: filters.month, rankCode: filters.rank });
      setDraft(filters);
      const previous = stateRef.current;
      if (!previous?.loaded || filters.user !== previous.filters.user || filters.month !== previous.filters.month || filters.rank !== previous.filters.rank) void query(filters);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, [query]);
  if (!state || !ctx.querySalaryClaims) {
    return <Panel title="月薪领取记录" icon={Banknote} tone="role-1"
      explain="用户每领一次月薪记一条，领到的直接进可用余额，不冷却。">
      <BlockState state="empty" title="现在没有月薪数据" detail="这里还读不到各级月薪和领取记录；读到后会按领取时间倒序列出。" />
    </Panel>;
  }
  const applied = state.filters;
  const run = (next: F1SalaryFilters) => {
    const invalidUser = !!next.user.trim() && teamUserId(next.user) === null;
    setQueryError(invalidUser);
    if (invalidUser) return;
    const filters = { ...next, user: next.user.trim() };
    setDraft(filters);
    replaceTeamFilterParams({ userId: filters.user, month: filters.month, rankCode: filters.rank });
    void ctx.querySalaryClaims!(filters);
  };
  const read = ctx.querySalaryClaims;
  const hasFilter = !!(applied.user || applied.month || applied.rank);
  const chips = [
    applied.user && { key: "user", label: `用户 ${applied.user}`, onRemove: () => run({ ...applied, user: "" }) },
    applied.month && { key: "month", label: `月薪月份 ${applied.month}`, onRemove: () => run({ ...applied, month: "" }) },
    applied.rank && { key: "rank", label: `等级 ${applied.rank}`, onRemove: () => run({ ...applied, rank: "" }) },
  ].filter(Boolean) as { key: string; label: string; onRemove: () => void }[];
  const salaryRanks = rows.length ? rows.map(row => row.v).filter(rank => SALARY_RANKS.includes(rank)) : SALARY_RANKS;
  const items = state.items;
  const current = items.find((item) => item.claimNo === openNo) ?? null;
  const at = current ? items.indexOf(current) : -1;
  return <>
    <FilterBar onSubmit={() => run(draft)} querying={state.loading} onClear={() => run(EMPTY)} canClear={hasFilter} applied={chips} notice={queryError ? "查询条件有误：请填用户编码或正整数系统编号。这次没有查询。" : undefined}
      result={draft.user.trim() !== applied.user || draft.month !== applied.month || draft.rank !== applied.rank ? "条件未应用" : undefined}>
      <FilterField grow><Input aria-label="领取用户编码或系统编号" placeholder="用户编码或系统编号" value={draft.user}
        onChange={(event) => { setDraft({ ...draft, user: event.target.value }); setQueryError(false); }} /></FilterField>
      <FilterField><Select aria-label="月薪月份" value={draft.month} onChange={(value) => setDraft({ ...draft, month: value })}
        options={[{ value: "", label: "全部月份" }, ...months.map((month) => ({ value: month, label: month }))]} /></FilterField>
      <FilterField><Select aria-label="月薪等级" value={draft.rank} onChange={(value) => setDraft({ ...draft, rank: value })}
        options={[{ value: "", label: "全部等级" }, ...salaryRanks.map(rank => ({ value: rank, label: rank }))]} /></FilterField>
    </FilterBar>
    <Panel title="月薪领取记录" icon={Banknote} tone="role-1" flush sub={items.length ? `已加载 ${items.length} 条` : undefined}
      explain={<><p>用户每领一次记一条，一个月最多一条；等级和金额是这次实际领取用的等级和锁定的金额，领取后再升级不补差。</p>
        <p>只能当月领，没领的下月作废；月底最后一天升到当月新的最高等级的，下月 1 号当天还能领上个月的，行里写「1 号领上月」。</p>
        <p>领到的月薪直接进可用余额，不冷却。按领取时间倒序，每次加载 100 条；账单号可以在「账本与账单核对」查。</p></>}>
      <Table label="月薪领取记录" className="f1-table f1-salary-table">
        <thead><tr>
          <Th>领取号</Th><Th>用户</Th><Th>月份 / 等级</Th><Th align="right" className="f1-col-amt">金额（USDT）</Th>
          <Th className="f1-col-time">领取时间（{zone}）</Th><Th align="right" sticky="end">操作</Th>
        </tr></thead>
        <tbody>
          {state.error && items.length === 0 ? <TableMessage columns={6} role="alert">月薪领取记录读取失败 · {state.error} <Button size="sm" onClick={() => void read(applied)}>重试</Button></TableMessage>
            : items.length === 0 ? state.loading ? <TableLoading columns={6} />
              : hasFilter ? <TableMessage columns={6}>没有符合条件的月薪领取记录 <Button size="sm" onClick={() => run(EMPTY)}>清除筛选</Button></TableMessage>
                : <TableMessage columns={6}>还没有人领过月薪；V2 及以上的用户在 App 领取后会出现在这里</TableMessage>
              : items.map((item) => (
                <Tr key={item.claimNo} selected={item.claimNo === openNo} onOpen={() => setOpenNo(item.claimNo)}>
                  <Td><Cell title={item.claimNo} main={<span data-mono="">{item.claimNo}</span>} sub={item.billNo ? <span data-mono="">账单 {item.billNo}</span> : undefined} /></Td>
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
        <Button size="sm" loading={state.loading} onClick={() => void read(applied, state.nextCursor ?? undefined)}>{state.error ? "重试" : "加载更早记录"}</Button>
      </div>}
      <Drawer open={!!current} onClose={() => setOpenNo(null)} title="月薪领取" icon={Banknote} tone="role-1"
        sub={current ? <span data-mono="">{current.claimNo}</span> : undefined}
        nav={{ onPrev: () => setOpenNo(items[at - 1]?.claimNo ?? null), onNext: () => setOpenNo(items[at + 1]?.claimNo ?? null), hasPrev: at > 0, hasNext: at >= 0 && at < items.length - 1 }}>
        {current && <KeyValues rows={[
          { key: "user", label: "用户", value: <>{current.nickname || "—"} · <span data-mono="">{current.userCode || current.userId}</span></> },
          { key: "month", label: "月薪月份", value: current.month },
          { key: "rank", label: "等级", value: current.rankCode, explain: "这次实际领取用的等级，金额按它锁定；领取后再升级不补差。" },
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
