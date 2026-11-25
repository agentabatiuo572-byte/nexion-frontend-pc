"use client";
/**
 * 客服工作台的业绩额显示件：我的数据的「期间业绩」、业绩额明细抽屉、表格里的业绩额格。
 * 只认 perf-view.tsx 的显示形状；数据投影见 perf-wiring.ts。
 */
import type { ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, BarChart3, ListChecks, Scale, UserCheck } from "lucide-react";
import { BlockState, Button, Cell, Drawer, Explain, Fact, Facts, Fold, Panel, Stat, StatBand, Table, Td, Th, Tr } from "@/app/components/rd";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { amountDisplay } from "@/lib/format";
import { perfCountText, perfNote, perfObservedText, perfText, type PerfCount, type PerfEvents, type PerfValue, type PeriodPerf } from "./perf-view";

/** 业绩额的问号：公式常显在名称行（CP-40 具名例外），口径和归属进问号。 */
const AMOUNT_EXPLAIN = "所选月份里你名下客户的入金减提现，可以是负数。每一笔算给发生时绑定的客服和所在的组；更正记在确认月，算给原来那笔的客服和组。";

function statValue(value: PerfValue) { return perfText(value); }
function statUnit(value: PerfValue, unit: string) { return value.state === "complete" ? unit : undefined; }

export function AnalyticsReadDenied({ compact = false }: { compact?: boolean }) {
  return <BlockState state="denied" compact={compact} title="无权限访问" detail="这个账号没有业绩统计的读取权限，需要时联系超级管理员。" />;
}

/** 我的数据最上面的「期间业绩」：业绩额是这一屏唯一的大数，后面是入金、提现、期间首充；下面是入金构成和提现构成。 */
export function PeriodPerfPanel({ perf, month, asOf, monthControl, onDetail, status, detail }: {
  perf: PeriodPerf | { unavailable: string };
  /** 期间业绩自己的加载和读取失败（不写成空态）。 */
  status?: "loading" | "denied" | { title?: string; error: string; onRetry: () => void };
  /** 「业绩明细」入口的加载和读取失败，写在入口处。 */
  detail?: { loading: boolean; error?: string };
  month: string;
  /** 已经按「{时间}（北京时间）」写好的统计截至。 */
  asOf?: string;
  monthControl: ReactNode;
  onDetail?: () => void;
}) {
  const ready = "totals" in perf;
  return <Panel title="期间业绩" icon={BarChart3} tone="role-1" className="m1-perf-panel"
    explain="按所选月份里发生的入金和提现算。只算 USDT，越南盾只在导出文件里作参考。"
    sub={[month, "USDT", asOf && `截至 ${asOf}`].filter(Boolean).join(" · ")}
    actions={<div className="m1-perf-actions">{monthControl}{ready && onDetail && <Button icon={<ListChecks size={14} aria-hidden />} loading={detail?.loading} loadingText="正在加载…" onClick={onDetail}>业绩明细</Button>}</div>}>
    {status === "loading" ? <BlockState state="loading" title="正在加载…" />
      : status === "denied" ? <AnalyticsReadDenied />
      : status ? <BlockState state="error" title={status.title ?? "期间业绩加载失败"} detail={status.error} onRetry={status.onRetry} />
      : !ready ? <BlockState state="empty" title={perf.unavailable} detail="名下客户和其他统计照常看。" /> : <>
      {detail?.error && <BlockState state="error" compact title="业绩额明细加载失败" detail={detail.error} onRetry={onDetail} />}
      <StatBand label="期间业绩">
        <Stat lead label="业绩额 = 客户入金 − 客户提现" icon={Scale} tone="role-other" value={statValue(perf.totals.amount)} unit={statUnit(perf.totals.amount, "USDT")}
          sub={perfObservedText(perf.totals.amount, " USDT") ?? (perf.totals.amount.state === "unavailable" ? perf.totals.amount.reason : undefined)} explain={AMOUNT_EXPLAIN} onOpen={onDetail} openLabel="查看业绩额明细" />
        <Stat label="客户入金" icon={ArrowDownToLine} tone="role-2" value={statValue(perf.totals.inflow)} unit={statUnit(perf.totals.inflow, "USDT")}
          sub={perf.totals.inflow.state === "partial" && perf.totals.inflow.observed !== null ? `已核 ${perfText({ state: "complete", value: perf.totals.inflow.observed })} USDT` : undefined} explain="链上和越南银行卡充值到账，加合格的购机直接付款（按商品价）。" />
        <Stat label="客户提现" icon={ArrowUpFromLine} tone="role-4" value={statValue(perf.totals.withdrawal)} unit={statUnit(perf.totals.withdrawal, "USDT")}
          sub={perf.totals.withdrawal.state === "partial" && perf.totals.withdrawal.observed !== null ? `已核 ${perfText({ state: "complete", value: perf.totals.withdrawal.observed })} USDT` : undefined} explain="提现成功时钱包实际扣掉的金额，含手续费；处理中、失败、被拒的不扣。" />
        <Stat label="期间首充" icon={UserCheck} tone="role-3" value={perfCountText(perf.first)} unit={perf.first.state === "complete" ? "人" : undefined}
          sub={perf.first.state === "complete" ? perf.firstSplit && `充值 ${perf.firstSplit.deposits} · 购机 ${perf.firstSplit.purchases}` : perf.first.state === "partial" ? perf.first.missing : perf.first.reason}
          explain={<><p>成功充值或合格付费购机，含直付；每位客户只算第一次。</p><dl className="m1-perf-pop-rows"><div><dt>算</dt><dd>链上、越南银行卡充值到账；用余额或直接付款买设备，含试用转正</dd></div><div><dt>不算</dt><dd>赠送的设备、免费或零价设备、还在核对的付款</dd></div></dl></>} />
      </StatBand>
      {/* 一个视图只露一个主列表（DP-67）：入金、提现构成放进默认展开的折叠。 */}
      <Fold title="入金和提现构成" summary={breakSummary(perf)} defaultOpen={![perf.totals.inflow, perf.totals.withdrawal].every(value => value.state === "unavailable")}>
      <div className="m1-perf-break">
        <Panel plain headingLevel={3} title="入金构成" sub="4 个渠道" explain="四个渠道各自的净额，已含本期更正。退款退回余额不算；核实过的站外退款记成本期更正（负数）。">
          <Table label="入金构成" className="m1-perf-table"><thead><Tr><Th>渠道</Th><Th align="right">金额（USDT）</Th></Tr></thead><tbody>
            {perf.inflow.map(row => <Tr key={row.label}><Td><span className={row.sub ? "m1-perf-sub-row" : undefined}>{row.label}</span></Td>
              <Td align="right"><Cell num main={perfText(row.value)} sub={row.value.state === "partial" ? row.value.missing : undefined} title={perfNote(row.value)} /></Td></Tr>)}
          </tbody></Table>
        </Panel>
        <Panel plain headingLevel={3} title="提现构成" sub="按提现网络" explain="业绩按钱包扣款算；手续费和客户到手只作参考。">
          <Table label="提现构成" className="m1-perf-table"><thead><Tr><Th>网络</Th><Th align="right">钱包扣款</Th><Th align="right">手续费</Th><Th align="right">客户到手</Th></Tr></thead><tbody>
            {perf.withdrawals.map(row => <Tr key={row.label}><Td>{row.label}</Td>
              {[row.walletDebited, row.fee, row.received].map((value, index) => <Td key={index} align="right"><Cell num main={perfText(value)} title={perfNote(value)} /></Td>)}</Tr>)}
          </tbody></Table>
        </Panel>
      </div>
      </Fold>
    </>}
  </Panel>;
}

/** 折叠标题的结论：入金、提现都核完写「已核完」，没核完或暂不可用照实写。 */
function breakSummary(perf: PeriodPerf) {
  const parts = [perf.totals.inflow, perf.totals.withdrawal];
  if (parts.every(value => value.state === "complete")) return "入金和提现都已核完";
  const gap = parts.find(value => value.state === "unavailable");
  return gap && gap.state === "unavailable" ? gap.reason : "有数据没核完";
}
/** 这个月有没有已转走客户的记录：没有时合计只写一行。读不准时照写三行。 */
function transferred(events: PerfEvents) {
  const { amount, count } = events.restricted;
  return !(amount.state === "complete" && Number(amount.value) === 0 && count.state === "complete" && count.value === 0);
}
/** 合计没有数时只写「—」，不带「（— 条，— 位客户）」。 */
const summaryText = (part: { amount: PerfValue; count: PerfCount; customers: PerfCount }) => part.amount.state !== "complete" ? <>—</>
  : <>{perfText(part.amount)} USDT<span className="m1-perf-count">（{perfCountText(part.count)} 条，{perfCountText(part.customers)} 位客户）</span></>;
/** 没有能显示的逐笔时写原因，不画空表头（ST-33）。 */
function emptyEvents(events: PerfEvents) {
  if (events.total.amount.state !== "complete") return { title: "这个月的记录还在核对", detail: "核完后点页头「刷新」再看。" };
  const moved = events.restricted.count.state === "complete" && events.restricted.count.value > 0;
  return moved ? { title: "现在名下的客户这个月没有记录", detail: "已转走客户的明细不显示，小计见上方。" }
    : { title: "这个月还没有计入业绩的记录", detail: "名下客户有入金或提现后会显示在这里。" };
}

/** 业绩额明细：先三行核对「本月合计 = 现在名下的客户 + 已转走的客户」，再列能看的每一笔。 */
export function PerfEventsDrawer({ events, page, pageSize, total, observedTotal, canContinue, loading, onPage, onClose }: {
  events: PerfEvents; page: number; pageSize: number; total: number | null; observedTotal: number;
  canContinue: boolean; loading: boolean; onPage: (page: number) => void; onClose: () => void;
}) {
  const range = `统计区间 ${formatBusinessTimeCompact(events.from, "—")} 至 ${formatBusinessTimeCompact(events.to, "—")}（北京时间）`;
  return <Drawer open title="业绩额明细" sub="本人 · USDT" onClose={onClose}
    footer={<div className="m1-perf-foot"><Button onClick={onClose}>关闭</Button>{events.rows.length > 0 && <span className="m1-perf-pager"><Button size="sm" disabledReason={loading ? "正在加载…" : page === 1 ? "已经是第一页" : undefined} onClick={() => onPage(page - 1)}>上一页</Button>第 {page} / {total === null ? "—" : Math.max(1, Math.ceil(observedTotal / pageSize))} 页 · 共 {total ?? "—"} 条<Button size="sm" disabledReason={loading ? "正在加载…" : canContinue ? undefined : "已经是最后一页"} onClick={() => onPage(page + 1)}>下一页</Button></span>}</div>}>
    <p className="rd-note">{range}</p>
    <Facts>
      <Fact k="本月合计">{summaryText(events.total)}{!transferred(events) && events.total.amount.state === "complete" && <span className="m1-fact-reason">全部是现在名下客户的记录</span>}</Fact>
      {transferred(events) && <>
        <Fact k="现在名下的客户">{summaryText(events.visible)}</Fact>
        <Fact k="已转走的客户"><span className="m1-perf-inline">{summaryText(events.restricted)}<Explain label="已转走的客户的说明" content="这位客户已转给别的客服。这个月在你名下发生的仍算你的业绩，明细不再显示。" /></span></Fact>
      </>}
    </Facts>
    <Fold title="统计口径" summary="和期间业绩是同一份统计">
      <p>列出这段时间里在你名下发生的每一笔，按发生时的归属算。买设备、奖励只作参考，不计入业绩。</p>
    </Fold>
    {events.rows.length === 0 ? <BlockState state="empty" {...emptyEvents(events)} /> : <Table label="业绩额明细" className="m1-perf-events"><thead><Tr><Th>时间（北京时间）</Th><Th>客户</Th><Th>类别</Th><Th align="right"><span className="m1-th-stack">计入业绩（USDT）<small>业务金额</small></span></Th></Tr></thead><tbody>
      {events.rows.map(row => <Tr key={row.id}>
        <Td><span className="sa-nowrap">{formatBusinessTimeCompact(row.at, "—")}</span></Td>
        <Td><Cell main={row.customer} sub={<span className="m-user-code">{row.customerNo}</span>} /></Td>
        <Td><Cell main={row.kind} sub={row.detail} /></Td>
        <Td align="right"><Cell num main={row.delta === null ? "—" : amountDisplay(row.delta)} sub={row.business ?? "—"} /></Td>
      </Tr>)}
    </tbody></Table>}
  </Drawer>;
}
