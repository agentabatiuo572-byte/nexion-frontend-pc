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

/* ---------------- 名字和口径 ---------------- */

export const BOARD_LABEL: Record<SupportBoardKey, string> = { netContribution: "净贡献额", firstPayment: "首充人数", customers: "当前绑定客户" };

/** 三类榜各一句话：管什么数，跟不跟月份和币种。细则在问号里。 */
export const BOARD_DEFINITION: Record<SupportBoardKey, { line: string; rows: { k: string; v: string }[] }> = {
  netContribution: {
    line: "按所选月份 · 付款贡献减去退款、提现冲回 · 可以是负数 · USDT 和 UVT 分开排",
    rows: [
      { k: "计入", v: "充值计入贡献；用余额消费时，只把还没算过的部分计入，同一笔钱不重复算。" },
      { k: "冲减", v: "后台退款只冲减消费时新增的那部分；成功提现只冲减已经算过贡献的部分，收益提现不冲减原业绩。冲减记在发生的那个月。" },
      { k: "币种", v: "USDT 和 UVT 各算各的，不换算，不合并比较。" },
      { k: "组榜", v: "按贡献发生时所在的组统计，调组后历史贡献仍算在原来的组，所以组榜里可能有现在已经不在这个组的客服。" },
    ],
  },
  firstPayment: {
    line: "按所选月份 · 第一笔充值或购机的客户数 · 算给付款时的专属客服 · 不分币种",
    rows: [
      { k: "算谁", v: "每个客户一生只算一次：最早一笔成功的充值或购机。同一时刻两笔时先算充值。" },
      { k: "算给谁", v: "算给付款那一刻这位客户的专属客服，按这笔付款所在的月份计数。" },
      { k: "币种", v: "人数不随所选币种变；切币种只换表里的净贡献额一列。" },
    ],
  },
  customers: {
    line: "现在的数 · 发布时名下有效绑定的客户 · 不分月份 · 不是这个月新增",
    rows: [
      { k: "算谁", v: "当前有效绑定、账号未删除的真实客户；同一客户在一位客服名下只算一次。" },
      { k: "时间", v: "每次发布时重新数一次，不随所选月份变；表里的净贡献额、首充人数是这个月的参考数。" },
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
/** 主指标：净贡献额按金额写，另两个是人数。 */
export function mainValue(row: SupportBoardRow, board: SupportBoardKey, places?: number) {
  return board === "netContribution" ? amountShown(row.amount, places) : countShown(board === "firstPayment" ? row.firstPayment : row.customers);
}
function amountShown(metric: SupportBoardCount, places?: number) {
  return metric.coverage === "unavailable" ? "—" : amountText(metric.value, places);
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

export function Podium({ board, rows, total, unit, places, status, onOpen, onViewAll }: {
  board: SupportBoardKey;
  rows: SupportBoardRow[];
  total: number;
  unit: string;
  places: number;
  status: { kind: "ready" } | { kind: "loading" } | { kind: "provisional"; reason: string } | { kind: "none" };
  onOpen: (id: string) => void;
  onViewAll: () => void;
}) {
  const more = rows.length ? Math.max(0, total - rows.length) : 0;
  return <Panel title="前三名" icon={Trophy} tone="role-1" className="m6-podium-panel"
    explain="同一版榜单里成绩最好的前三个名次；成绩相同的并列，最多列 4 位，其余并列的在全部排名里。不受搜索和翻页影响。">
    {status.kind === "loading" ? <BlockState state="loading" title="正在读取前三名…" />
      : status.kind === "provisional" ? <BlockState state="empty" compact title="这一版还在汇总，暂不评前三名" />
      : rows.length === 0 ? <BlockState state="empty" title="这个范围还没有排出名次的客服" />
      : <ol className="m6-podium" data-count={rows.length}>
        {rows.map((row) => (
          <li key={row.id} data-rank={row.rank ?? undefined}>
            <button type="button" className="m6-podium-card" onClick={() => onOpen(row.id)} aria-label={`${row.name}，${rankText(row)}，${BOARD_LABEL[board]} ${mainValue(row, board, places)} ${unit}，查看成绩`}>
              <span className="m6-podium-rank">{row.isTied && <small>并列</small>}<b>{row.rank}</b></span>
              <Avatar row={row} size="lg" />
              <span className="m6-podium-name">{row.name}</span>
              <span className="m6-podium-group">{row.groupName || "待分组"}<QualificationTag row={row} /></span>
              <span className="m6-podium-value"><b>{mainValue(row, board, places)}</b><small>{unit}</small></span>
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

export function RankingTable({ board, state, currency, month, places, privateRead, onOpen, onCustomers }: {
  board: SupportBoardKey;
  state: BoardTableState;
  currency: string;
  month: string;
  places: number;
  privateRead: boolean;
  onOpen: (id: string) => void;
  onCustomers: (id: string) => void;
}) {
  const primary = (key: SupportBoardKey) => (board === key ? "" : undefined);
  return <Table label="全部排名" className="m6-table">
    <thead><tr>
      <Th>名次</Th>
      <Th>客服</Th>
      <Th align="right" data-primary={primary("netContribution")}><span className="m6-th">净贡献额<small>{month} · {currency}</small></span></Th>
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
          const customers = countShown(row.customers);
          return <Tr key={row.id} onOpen={() => onOpen(row.id)} mark={self ? "hit" : undefined} data-self={self ? "true" : undefined}>
            <Td><Cell main={row.rankStatus === "confirmed" && row.rank !== null ? <span className="m6-rank">{row.isTied && <small>并列</small>}{row.rank}</span> : "—"}
              sub={row.rankStatus === "confirmed" && movement ? <span className="m6-move" data-kind={row.movement.kind}>{movement.replace("较上一业务日", "").replace("和上一业务日", "")}</span> : undefined} /></Td>
            <Td><span className="m6-identity">
              <Avatar row={row} />
              <span className="m6-identity-text">
                <span className="sl-person-name"><Button variant="ghost" size="sm" className="m6-name" title={`${row.name} · ${row.groupName || "待分组"}`} onClick={() => onOpen(row.id)}>{row.name}</Button>{self && <span className="m6-me">我</span>}</span>
                <span className="rd-note">{row.groupName || "待分组"}<QualificationTag row={row} /></span>
              </span>
            </span></Td>
            <Td align="right" data-primary={primary("netContribution")}><Cell num main={amountShown(row.amount, places)} {...gapNote(row.amount, "金额未同步")} /></Td>
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
function gapNote(metric: SupportBoardCount, fallback = "数据未同步") {
  if (metric.coverage === "complete") return {};
  const reason = metric.reason || fallback;
  return metric.coverage === "partial" ? { sub: "暂定", title: `暂定：${reason}` } : { sub: reason, title: reason };
}

/** 分页：覆盖不完整时不写总人数（M6-Q04），所以不用共用 Pager（它总写「共 N 条」）；样子和 Pager 一样。 */
export function BoardPager({ page, pages, total, pageSize, onPage, onPageSize }: { page: number; pages: number; total?: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) {
  return <div className="rd-pager" data-list-pager="" data-list-label="全部排名">
    <span className="rd-pager-range">第 {page} / {pages} 页{total !== undefined ? ` · 共 ${total.toLocaleString("en-US")} 人` : ""}</span>
    {total === undefined && <span className="rd-pager-note">参榜名单还在汇总，暂不写总人数</span>}
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

export function PerformanceBody({ row, board, month, places, asOf, stale, refreshFailed, privateRead }: {
  row: SupportBoardRow;
  board: SupportBoardKey;
  month: string;
  places: number;
  asOf: string;
  stale: boolean;
  refreshFailed: boolean;
  privateRead: boolean;
}) {
  const movement = movementText(row), reason = movementReason(row);
  const reasons = [...new Set([row.amount.reason, row.firstPayment.reason, row.customers.reason].filter(Boolean))];
  return <>
    <div className="m6-detail-who">
      <Avatar row={row} size="lg" />
      <div><strong>{row.name}</strong><span className="rd-note">{row.groupName || "待分组"}</span></div>
      <QualificationTag row={row} always />
    </div>
    <Facts>
      <Fact k="名次" lead>{rankText(row)}</Fact>
      <Fact k="名次变化">{movement ?? reason ?? "—"}</Fact>
      <Fact k="统计月份">{month}</Fact>
      <Fact k="净贡献额" tone="role-1" unit={amountShown(row.amount, places) === "—" ? undefined : row.amount.currency}>{amountShown(row.amount, places)}</Fact>
      <Fact k="首充人数" unit={countShown(row.firstPayment) === "—" ? undefined : "人"}>{countShown(row.firstPayment)}</Fact>
      <Fact k="当前绑定客户" unit={countShown(row.customers) === "—" ? undefined : "人"}>{countShown(row.customers)}</Fact>
      <Fact k="数据截至">{asOf}</Fact>
    </Facts>
    {reasons.length > 0 && <Notice tone="done" title="部分成绩是暂定或缺数">{reasons.join("；")}。缺的数写「—」，不是 0。</Notice>}
    {(stale || refreshFailed) && <Notice tone="warn">显示的是上次发布的结果{refreshFailed ? "；榜单更新暂未成功，请稍后读取最新结果" : ""}。</Notice>}
    {!(privateRead && row.canViewCustomers) && <p className="rd-note">暂无这位客服的客户明细查看权限。</p>}
  </>;
}
