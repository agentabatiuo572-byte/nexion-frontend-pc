"use client";

/**
 * M6 业绩榜（改版）的展示件：前三名、全部排名、分页、公开成绩。只画接口给的数，不另算名次和差距。
 * 数字写法：金额按后端原值，千分位，去掉补的末尾 0，同一组按最多的小数位对齐（至少两位），不舍入、不缩写；人数千分位。
 */
import { useState, type ReactNode } from "react";
import { ArrowRight, ListOrdered, Trophy } from "lucide-react";
import { BlockState, Button, Cell, Explain, Fact, Facts, Notice, Panel, Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import type { SupportBoardCount, SupportBoardKey, SupportBoardQualification, SupportBoardRow } from "./support-leaderboard";
import { amountDisplay } from "@/lib/format";
import { PERF_UNAVAILABLE, perfFlowText, perfText, type PerfTotals } from "./perf-view";

/* ---------------- 名字和口径 ---------------- */

export const BOARD_LABEL: Record<SupportBoardKey, string> = { netContribution: "业绩额", firstPayment: "首充人数", customers: "当前绑定客户" };

/** 三类榜各一句话：只写数据（跟不跟月份、单位），怎么算收进问号。 */
export const BOARD_DEFINITION: Record<SupportBoardKey, { line: string; rows: { k: string; v: string }[] }> = {
  netContribution: {
    line: "按所选月份 · USDT",
    rows: [
      { k: "入金", v: "充值到账加合格的购机直付；人工加款、奖励不算。" },
      { k: "提现", v: "钱包实际扣的，含手续费。" },
      { k: "算给谁", v: "发生时绑定的客服和所在的组；更正记在确认月，算给原来那笔的客服和组。" },
    ],
  },
  firstPayment: {
    line: "按所选月份 · 人",
    rows: [
      { k: "算谁", v: "每位客户只算一次：最早一笔成功的充值或付费购机。" },
      { k: "算给谁", v: "付款时这位客户的专属客服，算在付款的那个月。" },
    ],
  },
  customers: {
    line: "现在的数 · 人",
    rows: [
      { k: "算谁", v: "发布时名下有效绑定的客户，同一位客户只算一次；不是这个月新增。" },
      { k: "时间", v: "每次发布时重新数，不随所选月份变；表里的业绩额、首充人数是这个月的参考数。" },
    ],
  },
};

const QUALIFICATION: Record<SupportBoardQualification, { text: string; tone: "done" | "neutral" | "ok" }> = {
  ACTIVE: { text: "在岗", tone: "ok" }, DISABLED: { text: "已停用", tone: "done" }, REMOVED: { text: "已移除", tone: "done" },
  HANDOVER_REQUIRED: { text: "待交接", tone: "neutral" }, UNKNOWN: { text: "资格未确认", tone: "neutral" },
};

/* ---------------- 数字写法 ---------------- */

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;
/** 后端金额字符串去掉补的末尾 0 后的小数位数。 */
export function decimalPlaces(value: string | null) {
  const parts = value === null ? null : DECIMAL.exec(value);
  return parts ? (parts[3] ?? "").replace(/0+$/, "").length : 0;
}
/** 同一组金额对齐用的小数位：最多的那个，至少两位。 */
export function amountPlaces(values: readonly (string | null)[]) {
  return Math.max(2, ...values.map(decimalPlaces));
}
/** 原值不舍入，按全站金额写法（amountDisplay）：整数千分位，去掉末尾 0、整数不写小数点，同组不补零对齐（PRD §6.6-8）；places 不再使用。 */
export function amountText(value: string | null, _places?: number) {
  return value !== null && DECIMAL.test(value) ? amountDisplay(value) : "—";
}
export function countText(value: string | null) {
  return value === null || !/^\d+$/.test(value) ? "—" : value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
export function rankText(row: SupportBoardRow) {
  return row.rankStatus === "confirmed" && row.rank !== null ? `${row.isTied ? "并列" : ""}第 ${row.rank} 名` : "名次未定";
}
function countShown(metric: SupportBoardCount) {
  return metric.coverage === "unavailable" ? "—" : countText(metric.value);
}
/** 名次变化：只写接口给的种类和位数；比不了时不写数，原因进成绩详情。 */
export function movementText(row: SupportBoardRow) {
  const m = row.movement;
  return m.kind === "up" ? `较上一业务日上升 ${m.places} 名` : m.kind === "down" ? `较上一业务日下降 ${m.places} 名`
    : m.kind === "same" ? "和上一业务日持平" : m.kind === "new" ? "新入榜" : undefined;
}
/** 比不了时的原因（「历史月份不比较每日变化」等），接口原文。 */
export function movementReason(row: SupportBoardRow) {
  return row.movement.kind === "unavailable" ? row.movement.explanation || "当前名次暂不可比" : undefined;
}

/* ---------------- 小件 ---------------- */

/** 头像：授权头像读到就用图，读不到或没有用姓名首字（和 M1、M3 一个样子）。 */
export function Avatar({ row, size = "md" }: { row: SupportBoardRow; size?: "md" | "lg" }) {
  const [failed, setFailed] = useState<string>();
  const url = row.avatarUrl && row.avatarUrl !== failed ? row.avatarUrl : undefined;
  return <span className="m6-avatar" data-size={size}>
    {url ? <img src={url} alt={`${row.name}头像`} onError={() => setFailed(url)} /> : <span aria-label={`${row.name}姓名占位`}>{Array.from(row.name.trim())[0] || "?"}</span>}
  </span>;
}
export function QualificationTag({ row, always = false }: { row: SupportBoardRow; always?: boolean }) {
  if (!row.qualification || (!always && row.qualification === "ACTIVE")) return null;
  const q = QUALIFICATION[row.qualification];
  return <StatusTag tone={q.tone}>{q.text}</StatusTag>;
}

/* ---------------- 前三名 ---------------- */

/** 前三名卡只写名次、姓名和组，不写成绩：成绩只在全部排名里写一次（ST-74、DP-61）。 */
export function Podium({ rows, total, status, onOpen, onViewAll }: {
  rows: SupportBoardRow[];
  total: number;
  status: { kind: "ready" } | { kind: "loading" };
  onOpen: (id: string) => void;
  onViewAll: () => void;
}) {
  const more = rows.length ? Math.max(0, total - rows.length) : 0;
  return <Panel title="前三名" icon={Trophy} tone="role-1" className="m6-podium-panel"
    explain="同一版榜单里业绩最好的前三个名次；成绩相同的并列，最多列 4 位。">
    {status.kind === "loading" ? <BlockState state="loading" title="正在加载前三名…" />
      : rows.length === 0 ? <BlockState state="empty" title="这个范围还没有排出名次的客服" />
      : <ol className="m6-podium" data-count={rows.length}>
        {rows.map((row) => (
          <li key={row.id} data-rank={row.rank ?? undefined}>
            <button type="button" className="m6-podium-card" onClick={() => onOpen(row.id)} aria-label={`${row.name}，${rankText(row)}，查看成绩`}>
              <span className="m6-podium-rank">{row.isTied && <small>并列</small>}<b>{row.rank}</b></span>
              <Avatar row={row} size="lg" />
              <span className="m6-podium-name">{row.name}</span>
              <span className="m6-podium-group">{row.groupName || "待分组"}<QualificationTag row={row} /></span>
            </button>
          </li>
        ))}
      </ol>}
    {more > 0 && <p className="m6-podium-more"><button type="button" className="rd-link" onClick={onViewAll}>还有 {more} 位并列，查看全部排名</button><ArrowRight size={14} aria-hidden /></p>}
  </Panel>;
}

/* ---------------- 全部排名 ---------------- */

export type BoardTableState =
  | { kind: "loading" }
  | { kind: "ready"; rows: SupportBoardRow[]; selfId?: string; empty?: ReactNode };

export function RankingTable({ board, state, month, perf, openId, privateRead, onOpen, onCustomers }: {
  board: SupportBoardKey;
  state: BoardTableState;
  month: string;
  /** 这一行的业绩额、入金合计、提现合计。 */
  perf: (agentId: string) => PerfTotals;
  /** 公开成绩抽屉开着的那一行：金额格写「见右侧」，同一组数不在表里和抽屉里同时出现（ST-74）。 */
  openId?: string;
  privateRead: boolean;
  onOpen: (id: string) => void;
  onCustomers: (id: string) => void;
}) {
  const primary = (key: SupportBoardKey) => (board === key ? "" : undefined);
  return <Table label="全部排名" className="m6-table">
    <thead><tr>
      <Th>名次</Th>
      <Th>客服</Th>
      <Th align="right" data-primary={primary("netContribution")}><span className="m6-th">业绩额<small>{month} · USDT</small></span></Th>
      <Th align="right" data-primary={primary("firstPayment")}><span className="m6-th">首充人数<small>{month} · 人</small></span></Th>
      <Th align="right" data-primary={primary("customers")}><span className="m6-th">当前绑定客户<small>现在 · 人</small></span></Th>
      <Th sticky="end">操作</Th>
    </tr></thead>
    <tbody>
      {state.kind === "loading" ? <TableLoading columns={6} rows={5} />
        : state.rows.length === 0 ? <TableMessage columns={6}>{state.empty}</TableMessage>
        : state.rows.map((row) => {
          const self = row.id === state.selfId;
          const movement = movementText(row);
          const customers = countShown(row.customers), totals = perf(row.id);
          return <Tr key={row.id} onOpen={() => onOpen(row.id)} selected={openId === row.id} mark={self ? "hit" : undefined} data-self={self ? "true" : undefined}>
            <Td><Cell main={row.rankStatus === "confirmed" && row.rank !== null ? <span className="m6-rank">{row.isTied && <small>并列</small>}{row.rank}</span> : "—"}
              sub={row.rankStatus === "confirmed" && movement ? <span className="m6-move" data-kind={row.movement.kind}>{movement.replace("较上一业务日", "").replace("和上一业务日", "")}</span> : undefined} /></Td>
            <Td><span className="m6-identity">
              <Avatar row={row} />
              <span className="m6-identity-text">
                <span className="sl-person-name"><Button variant="ghost" size="sm" className="m6-name" title={`${row.name} · ${row.groupName || "待分组"}`} onClick={() => onOpen(row.id)}>{row.name}</Button>{self && <span className="m6-me">我</span>}</span>
                <span className="rd-note">{row.groupName || "待分组"}<QualificationTag row={row} /></span>
              </span>
            </span></Td>
            <Td align="right" data-primary={primary("netContribution")}>{openId === row.id
              ? <Cell num main={<span className="m6-in-drawer">见右侧</span>} />
              : <Cell num main={perfText(totals.amount)} sub={perfFlowText(totals)} title={totals.amount.state === "complete" ? undefined : perfFlowText(totals)} />}</Td>
            <Td align="right" data-primary={primary("firstPayment")}><Cell num main={countShown(row.firstPayment)} {...gapNote(row.firstPayment)} /></Td>
            <Td align="right" data-primary={primary("customers")}><Cell num main={customers !== "—" && row.canViewCustomers && privateRead
              ? <button type="button" className="rd-link m6-count-link" aria-label={`查看${row.name}的当前绑定客户，${customers} 人`} onClick={() => onCustomers(row.id)}>{customers}</button>
              : customers} {...gapNote(row.customers)} /></Td>
            <Td sticky="end"><Button size="sm" onClick={() => onOpen(row.id)}>查看成绩<span className="rd-sr-only">：{row.name}</span></Button></Td>
          </Tr>;
        })}
    </tbody>
  </Table>;
}

/** 暂定或缺数：格子第二行写短词，完整原因在 title 里（窄屏被切时悬停、聚焦能看全）。 */
const PENDING_REASONS = ["成绩还在汇总", "参榜资料还在汇总"];
function gapNote(metric: SupportBoardCount, fallback = "数据未同步") {
  if (metric.coverage === "complete") return {};
  const reason = metric.reason || fallback;
  // 「没核完」全页一个说法：「待核」（和业绩额格、结论一致），完整原因在 title。
  return metric.coverage === "partial" || PENDING_REASONS.includes(reason) ? { sub: "待核", title: `待核：${reason}` } : { sub: reason, title: reason };
}

/** 分页：覆盖不完整时不写总人数（M6-Q04），所以不用共用 Pager（它总写「共 N 条」）；样子和 Pager 一样。 */
export function BoardPager({ page, pages, total, pageSize, onPage, onPageSize }: { page: number; pages: number; total?: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  return <div className="rd-pager" data-list-pager="" data-list-label="全部排名">
    <span className="rd-pager-range">第 {page} / {pages} 页{total !== undefined ? ` · 共 ${total.toLocaleString("en-US")} 人` : ""}</span>
    {total === undefined && <span className="rd-pager-note">参榜名单待核，暂不写总人数</span>}
    <div className="rd-pager-tools">
      <Select aria-label="全部排名每页条数" value={String(pageSize)} onChange={(value) => onPageSize(Number(value))} options={[5, 10, 20].map((size) => ({ value: String(size), label: `${size} 条/页` }))} />
      <Button size="sm" aria-label="全部排名 上一页" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
      <Button size="sm" aria-label="全部排名 下一页" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</Button>
    </div>
  </div>;
}

export function RankingPanel({ children, search, sub }: { children: ReactNode; search: ReactNode; sub?: ReactNode }) {
  return <Panel title="全部排名" icon={ListOrdered} tone="role-3" flush sub={sub} actions={search} className="m6-ranking-panel">{children}</Panel>;
}

/* ---------------- 公开成绩 ---------------- */

export function PerformanceBody({ row, board, month, perf, stale, refreshFailed }: {
  row: SupportBoardRow;
  board: SupportBoardKey;
  month: string;
  perf: PerfTotals;
  stale: boolean;
  refreshFailed: boolean;
}) {
  const movement = movementText(row), reason = movementReason(row);
  // 没核完的项写「…待核」，和表格、结论同一个说法；旧后端的「暂不可用」照写。
  const amountGap = perf.amount.state === "complete" ? undefined : perf.amount.state === "unavailable" && perf.amount.reason === PERF_UNAVAILABLE ? "业绩额暂不可用" : perf.amount.state === "unavailable" && perf.amount.reason === "数据正在升级" ? "业绩额：数据正在升级" : "业绩额待核";
  const countGap = (metric: SupportBoardCount, label: string) => metric.coverage === "complete" ? undefined
    : metric.coverage === "partial" || PENDING_REASONS.includes(metric.reason || "") ? `${label}待核` : `${label}：${metric.reason || "数据未同步"}`;
  const gaps = [amountGap, countGap(row.firstPayment, "首充人数"), countGap(row.customers, "当前绑定客户")].filter(Boolean);
  const amount = perfText(perf.amount), inflow = perfText(perf.inflow), withdrawal = perfText(perf.withdrawal);
  return <>
    <div className="m6-detail-who">
      <Avatar row={row} size="lg" />
      <div><strong>{row.name}</strong><span className="rd-note">{row.groupName || "待分组"}</span></div>
      <QualificationTag row={row} always />
    </div>
    {/* 关键数字：业绩额放最前（VS-102），名次和三项合计降一层。 */}
    <div className="m6-lead"><span className="m6-lead-label">业绩额 · {month}</span><span className="m6-lead-value">{amount}{amount !== "—" && <small>USDT</small>}</span></div>
    <Facts>
      <Fact k="名次">{rankText(row)}</Fact>
      <Fact k="名次变化">{movement ?? (reason && PENDING_REASONS.includes(reason) ? "待核" : reason) ?? "—"}</Fact>
      <Fact k="入金合计" unit={inflow === "—" ? undefined : "USDT"}>{inflow}</Fact>
      <Fact k="提现合计" unit={withdrawal === "—" ? undefined : "USDT"}>{withdrawal}</Fact>
      <Fact k="首充人数" unit={countShown(row.firstPayment) === "—" ? undefined : "人"}>{countShown(row.firstPayment)}</Fact>
      <Fact k="当前绑定客户" unit={countShown(row.customers) === "—" ? undefined : "人"}>{countShown(row.customers)}</Fact>
    </Facts>
    {gaps.length > 0 && <Notice tone="done" title={board === "netContribution" ? "这位客服的成绩还没核完" : "部分成绩还没核完"}>{gaps.join("、")}。</Notice>}
  </>;
}
