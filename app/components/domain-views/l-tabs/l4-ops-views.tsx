"use client";

/**
 * L4 设备、任务与团队报表（改版）的四块报表和共同时间段表。只画同一次读取里接口真给的数，不另算口径。
 * 数字写法：数量千分位；金额按后端实际小数位、带 USDT 或 UVT，不舍入；比例原样加 %，可以超过 100% 的写明。
 */
import type { ReactNode } from "react";
import { CalendarRange, Cpu, Flag, ListChecks, Users } from "lucide-react";
import { BarList, ColumnChart, Explain, Fold, Panel, ScaleBar, Table, Td, Th, Tr, type ChartSlot } from "@/app/components/rd";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { amountDigits, amountText } from "@/lib/admin/treasury-amount";
import type { L4DistRow, L4HistoryRow, L4OperationsData, L4PhaseRow } from "./l4-live-data";

/* ---------------- 数字写法 ---------------- */

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
export const count = (value: number | null | undefined) => (finite(value) ? value.toLocaleString("en-US") : "—");
export const money = (value: number | null | undefined, digits?: number) => (finite(value) ? amountText(value, digits ?? amountDigits([value])) : "—");
export const pct = (value: number | null | undefined) => (finite(value) ? `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%` : "—");
export const pp = (value: number | null | undefined) => (finite(value)
  ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} 个百分点`
  : "—");

/** 0、0.00、0%、「—」：不是要看的数，弱化（和 Stat 同一条规则）。 */
const ZERO = /^[-–—]$|^0(?:[.,]0+)?%?$/;

/** 承接率的预警线固定 60%（L4-PD04：页面固定，不可调）。 */
export const ACCEPTANCE_WARN = 60;

/** 时间段怎么切：日、周按业务日一天一段；月、自定义按周一段，写那一周周一的日期（后端 history 规则）。 */
export function bucketWord(data: L4OperationsData) {
  return data.period.key === "month" || data.period.key === "custom" ? "按周" : "按天";
}

/** 柱图标题旁的弱字：没有事件的天或周不画，柱子之间可能跳过日期。 */
function GapNote({ by }: { by: string }) {
  return <span className="l4-sub-note">只画有事件的{by === "按周" ? "周" : "天"}</span>;
}

/* ---------------- 小件 ---------------- */

/** 一组名称和数字：名称在上、数字在下，单位跟在数字后。 */
export function Nums({ label, rows }: {
  label: string;
  rows: readonly { key: string; name: ReactNode; value: string; unit?: string; sub?: ReactNode; explain?: ReactNode }[];
}) {
  return (
    <dl className="l4-nums" aria-label={label}>
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.name}{row.explain && <Explain label={`${typeof row.name === "string" ? row.name : label}的口径`} content={row.explain} side="top" align="start" />}</dt>
          <dd data-empty={ZERO.test(row.value) ? "" : undefined}>{row.value}{row.unit && row.value !== "—" && <small>{row.unit}</small>}</dd>
          {row.sub && <dd className="l4-nums-sub">{row.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Sub({ children, explain, explainLabel }: { children: ReactNode; explain?: ReactNode; explainLabel?: string }) {
  return <h3 className="l4-sub">{children}{explain && <Explain label={explainLabel ?? "这一块的口径"} content={explain} />}</h3>;
}

/** 按时间段的柱图：只画有事件的时间段；全是 0 或没有时间段时写一句话，不画 0 长度的柱。 */
function BucketChart({ label, history, pick, series, format, unit }: {
  label: string;
  history: readonly L4HistoryRow[];
  pick: (row: L4HistoryRow) => number[];
  series: readonly { label: string; slot: ChartSlot }[];
  format: (value: number) => string;
  unit: string;
}) {
  if (history.length === 0) return <p className="rd-note">这段时间没有事件，不画。</p>;
  if (history.every((row) => pick(row).every((value) => value === 0))) return <p className="rd-note">这段时间每一段都是 0 {unit}。</p>;
  return (
    <ColumnChart label={label} series={series} format={(value) => `${format(value)} ${unit}`} axisFormat={(value) => value.toLocaleString("en-US", { maximumFractionDigits: 2 })} height={140}
      data={history.map((row) => ({ key: row.bucket, tick: row.bucket.slice(5), values: pick(row), detail: <span>{row.bucket} 起</span> }))} />
  );
}

/** 分布：排序条，数字写在条右边。order 传固定顺序（团队规模、阶段），不传就按数量从多到少。 */
function Dist({ title, rows, slot, unit, explain, order, plainKeys }: {
  title: string;
  rows: readonly L4DistRow[];
  slot: ChartSlot;
  unit: string;
  explain: ReactNode;
  order?: readonly string[];
  plainKeys?: boolean;
}) {
  const sorted = order
    ? [...rows].sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)))
    : [...rows].sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return (
    <div className="l4-block">
      <Sub explain={explain} explainLabel={`${title}的口径`}>{title}<span className="l4-sub-note">共 {count(total)} {unit}</span></Sub>
      {rows.length === 0
        ? <p className="rd-note">这段时间没有这类事件。</p>
        : <BarList label={title} slot={slot}
          rows={sorted.map((row) => ({ key: row.key, label: plainKeys ? row.key : operatorCopyText(row.key), value: row.count, text: `${count(row.count)} ${unit}` }))} />}
    </div>
  );
}

/* ---------------- 设备 ---------------- */

export function DeviceReport({ data, scope, links, panel }: { data: L4OperationsData; scope: string; links: ReactNode; panel: Record<string, string> }) {
  const s = data.device.summary;
  const live = data.liveFacts;
  const digits = amountDigits([s.dailyYieldUsdt, s.degradationLossUsdt]);
  const by = bucketWord(data);
  return (
    <Panel {...panel} title="设备" icon={Cpu} tone="role-2" sub={scope} actions={links}
      explain={<><p>「这段时间」的数按所选时间段和阶段里的设备事件算；「读取那一刻」的数是现在的累计数，不随时间段变。</p><p>这页只能看，不处置设备。</p></>}>
      <div className="l4-stack">
        <div className="l4-groups">
          <section className="l4-group">
            <Sub>这段时间</Sub>
            <Nums label="这段时间的设备数" rows={[
              { key: "buy", name: "购置", value: count(s.periodPurchasedDevices), unit: "台", explain: "这段时间完成购买的设备，同一台只算一次；不等于期末还在用的台数。" },
              { key: "retire", name: "退役", value: count(s.periodRetiredDevices), unit: "台", explain: "这段时间退役的设备，同一台只算一次。" },
              { key: "lock", name: "锁定", value: count(s.periodLockedDevices), unit: "台", explain: "这段时间被锁定的设备，同一台只算一次。" },
              { key: "first", name: "首次产出", value: count(s.periodFirstYieldDevices), unit: "台", explain: "这段时间第一次拿到收益的设备，同一台只算一次。" },
            ]} />
            <Nums label="这段时间的产出" rows={[
              { key: "usdt", name: "产出", value: money(s.dailyYieldUsdt, digits), unit: "USDT", explain: "这段时间收益入账的 USDT 合计。" },
              { key: "uvt", name: "产出", value: money(s.dailyYieldNex), unit: "UVT", explain: "这段时间收益入账的 UVT 合计。" },
              { key: "loss", name: "衰减影响", value: money(s.degradationLossUsdt, digits), unit: "USDT", explain: "每笔收益比基准少产出的部分加起来，多产出的不抵。" },
            ]} />
          </section>
          <section className="l4-group" data-now="">
            <Sub explain="读取这页那一刻的累计数，不随时间段和阶段变。">读取那一刻</Sub>
            <Nums label="读取那一刻的设备数" rows={[
              { key: "active", name: "在用设备", value: count(live.activeUserDevices), unit: "台", explain: "状态是在线、忙碌、活跃或运行中的用户设备，不含测试用户。按设备状态算，不是实时连通检查。" },
              { key: "tradein", name: "置换申请", value: count(live.tradeinApplications), unit: "笔", explain: "升级置换申请的累计数。" },
              { key: "tradeinDone", name: "已完成置换", value: count(live.completedTradeins), unit: "笔", explain: "已完成的升级置换累计数。" },
            ]} />
          </section>
        </div>
        <div className="rd-split" data-even="">
          <div className="l4-block">
            <Sub explain={`${by}一段，只画有事件的时间段，没有事件的日子不补 0。`}>{by}购置和退役<GapNote by={by} /></Sub>
            <BucketChart label={`${by}购置和退役的设备`} history={data.history} unit="台" format={count}
              series={[{ label: "购置", slot: 2 }, { label: "退役", slot: "other" }]} pick={(row) => [row.devicePurchases, row.deviceRetirements]} />
          </div>
          <div className="l4-block">
            <Sub explain={`${by}一段的收益入账 USDT，只画有事件的时间段。`}>{by}产出<GapNote by={by} /></Sub>
            <BucketChart label={`${by}产出 USDT`} history={data.history} unit="USDT" format={(value) => money(value)}
              series={[{ label: "产出", slot: 1 }]} pick={(row) => [row.yieldUsdt]} />
          </div>
        </div>
        <div className="rd-split" data-even="">
          <Dist title="购置的代际" rows={data.device.byGeneration} slot={2} unit="次" plainKeys
            explain="这段时间每一次购买记一次，同一台设备买两次算两次；没有标代际的写「未标注」。" />
          <Dist title="购置的机型" rows={data.device.byModel} slot={2} unit="次" plainKeys
            explain="这段时间每一次购买记一次；没有标机型的写「未标注」。" />
        </div>
        <Fold inset title="按衰减程度看产出"
          summary={data.device.degradation.length ? `${data.device.degradation.length} 段 · 衰减影响合计 ${money(s.degradationLossUsdt, digits)} USDT` : "这段时间没有收益事件"}
          explain="收益事件按记下的衰减比例分段（四舍五入到两位），没有标衰减的写「未标注」。">
          {data.device.degradation.length === 0 ? <p className="rd-note">这段时间没有收益事件。</p> : (
            <Table label="按衰减程度看产出" className="l4-table">
              <thead><tr><Th>衰减段</Th><Th align="right">收益事件</Th><Th align="right">实际产出</Th><Th align="right">衰减影响</Th></tr></thead>
              <tbody>{data.device.degradation.map((row) => {
                const rowDigits = amountDigits(data.device.degradation.flatMap((item) => [item.actualUsdt, item.lossUsdt]));
                return (
                  <Tr key={row.band}>
                    <Td>{operatorCopyText(row.band)}</Td>
                    <Td align="right">{count(row.events)} 次</Td>
                    <Td align="right">{money(row.actualUsdt, rowDigits)} USDT</Td>
                    <Td align="right">{money(row.lossUsdt, rowDigits)} USDT</Td>
                  </Tr>
                );
              })}</tbody>
            </Table>
          )}
        </Fold>
      </div>
    </Panel>
  );
}

/* ---------------- 任务 ---------------- */

export const ACCEPTANCE_EXPLAIN = (
  <>
    <p>任务承接率 = 完成数 ÷ 派发数，是两个计数之比，可能超过 100%。</p>
    <p>同一个人的同一个任务，完成在每一段各数一次，派发整段只数一次，所以它不是「派出的任务完成了几成」。</p>
    <p>派发数是 0 或有的事件缺少用户、任务编号时算不出，写「—」。系统现在还不记任务派发，派发数多半是 0。</p>
    <p>低于 60% 时提醒，这条线固定，不能在这页调。</p>
  </>
);

export function acceptanceScale(rate: number) {
  return Math.max(100, Math.ceil(rate / 50) * 50);
}

export function TaskReport({ data, scope, links, panel }: { data: L4OperationsData; scope: string; links: ReactNode; panel: Record<string, string> }) {
  const s = data.tasks.summary;
  const rate = s.acceptanceRate;
  const low = rate !== null && rate < ACCEPTANCE_WARN;
  const by = bucketWord(data);
  const max = rate === null ? 100 : acceptanceScale(rate);
  return (
    <Panel {...panel} title="任务" icon={ListChecks} tone="role-2" sub={scope} actions={links}
      explain="按所选时间段和阶段里的任务事件算。这页只能看，不改任务规则。">
      <div className="l4-stack">
        <div className="l4-flow" role="group" aria-label="派发、完成和承接率">
          <div className="l4-flow-cell"><span className="l4-flow-label">派发</span><b data-empty={s.dispatched === 0 ? "" : undefined}>{count(s.dispatched)}<small>次</small></b></div>
          <span className="l4-flow-arrow" aria-hidden />
          <div className="l4-flow-cell"><span className="l4-flow-label">完成</span><b data-empty={s.completed === 0 ? "" : undefined}>{count(s.completed)}<small>次</small></b></div>
          <div className="l4-flow-cell" data-ratio="" data-tone={low ? "warn" : undefined}>
            <span className="l4-flow-label">任务承接率（完成 ÷ 派发）<Explain label="任务承接率怎么算" content={ACCEPTANCE_EXPLAIN} /></span>
            <b data-empty={rate === null ? "" : undefined}>{pct(rate)}</b>
            {rate === null
              ? <small className="rd-note">{s.dispatched === 0 ? "没有派发记录，算不出" : "有的事件缺少用户或任务编号，算不出"}</small>
              : <ScaleBar label="任务承接率" valueText={`任务承接率 ${pct(rate)}，预警线 60%，刻度 0 到 ${max}%`} max={max} value={rate} fill target={ACCEPTANCE_WARN}
                tone={low ? "warn" : "role-2"} ticks={[{ value: 0, text: "0" }, { value: ACCEPTANCE_WARN, text: "预警 60%" }, { value: max, text: `${max}%` }]} />}
          </div>
        </div>
        <Nums label="任务的其他数" rows={[
          { key: "queue", name: "队列饱和度", value: pct(s.queueSaturation), sub: "这段时间最后一次记录", explain: "取这段时间里最后一条带队列饱和度的事件；没有记录时写「—」。" },
          { key: "checkin", name: "签到活跃", value: count(s.checkinActive), unit: "人", explain: "这段时间签到过的人数，同一个人只算一次。" },
        ]} />
        <div className="rd-split" data-even="">
          <div className="l4-block">
            <Sub explain={`${by}一段的完成次数，只画有事件的时间段。各段加起来等于上面的完成数。派发没有按时间段的数。`}>{by}完成<GapNote by={by} /></Sub>
            <BucketChart label={`${by}完成的任务`} history={data.history} unit="次" format={count}
              series={[{ label: "完成", slot: 2 }]} pick={(row) => [row.tasksCompleted]} />
          </div>
          <Dist title="完成按任务类型" rows={data.tasks.byTier} slot={2} unit="次"
            explain="和上面的完成数是同一批，按任务记下的类型分；只列有记录的类型。" />
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- 团队 ---------------- */

const TEAM_SIZE_ORDER = ["1-9", "10-49", "50-199", "200+", "未标注"];

export function TeamReport({ data, scope, links, panel }: { data: L4OperationsData; scope: string; links: ReactNode; panel: Record<string, string> }) {
  const s = data.network.summary;
  const digits = amountDigits([s.teamGmvUsdt, s.commissionPaidUsdt]);
  const by = bucketWord(data);
  return (
    <Panel {...panel} title="团队" icon={Users} tone="role-3" sub={scope} actions={links}
      explain="按所选时间段和阶段里的邀请、下单和奖励事件算。这页只能看，不改团队关系。">
      <div className="l4-stack">
        <div className="l4-groups">
          <section className="l4-group">
            <Sub>这段时间</Sub>
            <Nums label="这段时间的团队数" rows={[
              { key: "refs", name: "新增直接邀请", value: count(s.directRefs), unit: "人", explain: "这段时间绑定了邀请关系的好友，同一个人只算一次。" },
              { key: "gmv", name: "团队成交额", value: money(s.teamGmvUsdt, digits), unit: "USDT", explain: "这段时间新绑定邀请、之后又下过单的人，他们这段时间的全部订单金额，含绑定前的单。" },
              { key: "paid", name: "团队奖励发放", value: money(s.commissionPaidUsdt, digits), unit: "USDT", sub: `${count(s.commissionEvents)} 笔`, explain: "这段时间发出的全部奖励，不只团队奖励一类。" },
            ]} />
            <Nums label="这段时间的比例" rows={[
              { key: "promo", name: "推广率", value: pct(s.promotionRate), explain: "这段时间买了设备、之后又发出邀请的人 ÷ 这段时间买了设备的人；不是全部持有设备的人。业务上也叫 L4→L5 推广率。算不出时写「—」。" },
              { key: "trigger", name: "团队奖励触发率", value: pct(s.commissionTriggerRate), explain: "新增直接邀请的好友里，绑定之后带来团队奖励的人数 ÷ 新增直接邀请的人数。奖励缺少来源时算不出，写「—」。" },
            ]} />
          </section>
          <section className="l4-group" data-now="">
            <Sub explain="读取这页那一刻的累计数，不随时间段和阶段变。">读取那一刻</Sub>
            <Nums label="读取那一刻的团队数" rows={[
              { key: "relations", name: "团队关系", value: count(data.liveFacts.teamRelationships), unit: "条", explain: "现在全部有效的团队成员关系累计条数，不按时间段、阶段筛。导出团队关系明细时按它判断有没有可导出的关系。" },
            ]} />
          </section>
        </div>
        <div className="rd-split" data-even="">
          <div className="l4-block">
            <Sub explain={`${by}一段新绑定邀请的人数，只画有事件的时间段。`}>{by}新增直接邀请<GapNote by={by} /></Sub>
            <BucketChart label={`${by}新增直接邀请`} history={data.history} unit="人" format={count}
              series={[{ label: "新增直接邀请", slot: 3 }]} pick={(row) => [row.directRefs]} />
          </div>
          <div className="l4-block">
            <Sub explain={`${by}一段发放的奖励 USDT，只画有事件的时间段。`}>{by}团队奖励发放<GapNote by={by} /></Sub>
            <BucketChart label={`${by}团队奖励发放 USDT`} history={data.history} unit="USDT" format={(value) => money(value)}
              series={[{ label: "团队奖励发放", slot: 1 }]} pick={(row) => [row.commissionPaidUsdt]} />
          </div>
        </div>
        <div className="l4-dists">
          <Dist title="邀请时的团队规模" rows={data.network.teamSizeDist} slot={3} unit="次" order={TEAM_SIZE_ORDER}
            explain="每次绑定邀请时记下的团队人数落在哪一档，是事件次数，不是现在各档有多少个团队。" />
          <Dist title="邀请和奖励按 V-Rank" rows={data.network.vRankDist} slot={3} unit="次"
            explain="邀请绑定和奖励发放事件按当时记下的 V-Rank 分，是事件次数，不是现在各等级有多少人。" />
          <Dist title="奖励按类型" rows={data.network.commissionStructure} slot={1} unit="笔"
            explain="这段时间发放的奖励按类型分的笔数。" />
        </div>
      </div>
    </Panel>
  );
}

/* ---------------- 运营阶段效果 ---------------- */

const PHASE_ORDER = ["P1", "P2", "P3", "P4", "P5", "P6"];

/** 转化率最高的阶段：在后端给的几行里挑，不另算。都算不出时返回 null。 */
export function bestConversion(rows: readonly L4PhaseRow[]) {
  return rows.reduce<L4PhaseRow | null>((best, row) => (row.conversionRate !== null && (best === null || row.conversionRate > (best.conversionRate ?? -1)) ? row : best), null);
}

const PHASE_EXPLAIN = {
  active: "这个阶段有日活记录的人数，同一个人只算一次。日活事件还没接上，这个数可能偏低甚至是 0。",
  retention: "在这个阶段注册、之后又活跃过的人 ÷ 在这个阶段注册的人；不是第 7 天留存。日活事件还没接上，可能偏低甚至是 0%。算不出时写「—」。",
  conversion: "在这个阶段先逛过商店、之后下单的人 ÷ 逛过商店的人。算不出时写「—」。",
  yield: "这个阶段的收益入账 USDT 合计。",
};

export function PhaseReport({ data, scope, links, panel, phaseNames }: { data: L4OperationsData; scope: string; links: ReactNode; panel: Record<string, string>; phaseNames: Record<string, string> }) {
  const phaseLabel = (phase: string) => phaseNames[phase] ? `${phase} ${phaseNames[phase]}` : phase;
  const rows = data.phaseEffect;
  const digits = amountDigits(rows.map((row) => row.yieldUsdt));
  const single = rows.length === 1;
  const bars = (title: string, explain: string, pick: (row: L4PhaseRow) => number | null, text: (value: number | null) => string, slot: ChartSlot, max?: number) => (
    <div className="l4-block">
      <Sub explain={explain} explainLabel={`${title}的口径`}>{title}</Sub>
      <BarList label={`各阶段的${title}`} slot={slot} max={max}
        rows={[...rows].sort((a, b) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase)).map((row) => ({ key: row.phase, label: phaseLabel(row.phase), value: pick(row), text: text(pick(row)) }))} />
    </div>
  );
  return (
    <Panel {...panel} title="运营阶段效果" icon={Flag} tone="role-4" sub={scope} actions={links}
      explain={<><p>每个阶段只算发生在这个阶段的事件。能读到运营阶段设置时显示阶段名，读不到只显示代号。</p><p>这页只能看，阶段在「运营阶段设置」里改。</p></>}>
      {/* 阶段名只采用有权读取的 H1 目录；不可用时保留原代号。 */}
      <div className="l4-stack">
        {single ? (
          <Nums label={`${phaseLabel(rows[0].phase)} 的效果`} rows={[
            { key: "active", name: "活跃人数", value: count(rows[0].activeUsers), unit: "人", explain: PHASE_EXPLAIN.active },
            { key: "retention", name: "留存率", value: pct(rows[0].retentionRate), explain: PHASE_EXPLAIN.retention },
            { key: "conversion", name: "转化率", value: pct(rows[0].conversionRate), explain: PHASE_EXPLAIN.conversion },
            { key: "yield", name: "产出", value: money(rows[0].yieldUsdt, digits), unit: "USDT", explain: PHASE_EXPLAIN.yield },
            { key: "transition", name: "阶段切换", value: count(rows[0].transitionCount), unit: "次" },
            { key: "dial", name: "阶段参数调整", value: count(rows[0].dialChangeCount), unit: "次" },
          ]} />
        ) : (
          <div className="l4-phase-grid">
            {bars("活跃人数", PHASE_EXPLAIN.active, (row) => row.activeUsers, (value) => `${count(value)} 人`, 3)}
            {bars("留存率", PHASE_EXPLAIN.retention, (row) => row.retentionRate, pct, 3, 100)}
            {bars("转化率", PHASE_EXPLAIN.conversion, (row) => row.conversionRate, pct, 3, 100)}
            {bars("产出", PHASE_EXPLAIN.yield, (row) => row.yieldUsdt, (value) => `${money(value, digits)} USDT`, 1)}
          </div>
        )}
        <Fold inset title="各阶段明细" summary={`${rows.length} 个阶段 · 含阶段切换、参数调整和转化率较上一阶段`}
          explain="较上一阶段 = 这一行的转化率 − 上一行的转化率，单位是百分点；第一行或任一行算不出时写「—」。阶段切换、参数调整是事件次数。">
          <Table label="各阶段明细" className="l4-table">
            <thead><tr>
              <Th>阶段</Th><Th align="right">活跃人数</Th><Th align="right">留存率</Th><Th align="right">转化率</Th>
              <Th align="right">转化率较上一阶段</Th><Th align="right">产出</Th><Th align="right">阶段切换</Th><Th align="right">阶段参数调整</Th>
            </tr></thead>
            <tbody>{rows.map((row) => (
              <Tr key={row.phase}>
                <Td>{phaseLabel(row.phase)}</Td>
                <Td align="right">{count(row.activeUsers)} 人</Td>
                <Td align="right">{pct(row.retentionRate)}</Td>
                <Td align="right">{pct(row.conversionRate)}</Td>
                <Td align="right">{pp(row.conversionStepPct)}</Td>
                <Td align="right">{money(row.yieldUsdt, digits)} USDT</Td>
                <Td align="right">{count(row.transitionCount)} 次</Td>
                <Td align="right">{count(row.dialChangeCount)} 次</Td>
              </Tr>
            ))}</tbody>
          </Table>
        </Fold>
      </div>
    </Panel>
  );
}

/* ---------------- 四类报表共用的时间段 ---------------- */

export function HistoryFold({ data, scope }: { data: L4OperationsData; scope: string }) {
  const rows = data.history;
  const digits = amountDigits(rows.flatMap((row) => [row.yieldUsdt, row.commissionPaidUsdt]));
  const by = bucketWord(data);
  return (
    <Fold icon={CalendarRange} tone="role-other" title="四类报表按同一组时间段对照"
      summary={rows.length ? `${scope} · ${by}列出有事件的 ${rows.length} 段 · ${rows[0].bucket} 至 ${rows[rows.length - 1].bucket}` : `${scope} · 没有事件，没有时间段`}
      explain={<>
        <p>设备、任务、团队三块里的柱图都按这同一组时间段切，所以能一段一段对着看：比如哪一周买设备的多、那一周任务完成和新邀请是不是也多。</p>
        <p>日、周按业务日一天一段；月、自定义按周一段，写那一周周一的日期。只列有事件的时间段，没有事件的日子不补 0 行。</p>
        <p>业务日按 {data.quality.businessTimeZone} 算。</p>
      </>}>
      {rows.length === 0 ? <p className="rd-note">所选时间段没有事件，不列时间段。</p> : (
        <Table label="四类报表按同一组时间段对照" className="l4-table">
          <thead><tr>
            <Th>时间段（起）</Th><Th align="right">设备购置</Th><Th align="right">设备退役</Th><Th align="right">产出</Th>
            <Th align="right">任务完成</Th><Th align="right">新增直接邀请</Th><Th align="right">团队奖励发放</Th>
          </tr></thead>
          <tbody>{rows.map((row) => (
            <Tr key={row.bucket}>
              <Td>{row.bucket}</Td>
              <Td align="right">{count(row.devicePurchases)} 台</Td>
              <Td align="right">{count(row.deviceRetirements)} 台</Td>
              <Td align="right">{money(row.yieldUsdt, digits)} USDT</Td>
              <Td align="right">{count(row.tasksCompleted)} 次</Td>
              <Td align="right">{count(row.directRefs)} 人</Td>
              <Td align="right">{money(row.commissionPaidUsdt, digits)} USDT</Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
    </Fold>
  );
}
