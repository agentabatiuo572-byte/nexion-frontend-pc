"use client";

/**
 * B5 五项风险的看板：提现压力、异常账户、提现积压、业务开关、兑付覆盖率。
 * 每项的状态只用接口给的灯和现有比较（后端的 light、B0 的「异常账户大于 0 要注意」、J1 的「已关停」），页面不新算。
 * 有事的项排前面、展开成卡片，写清数字和线、为什么、去哪页；正常的项收成一行，安静（DP-05）。
 */
import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeftRight, Ban, CircleHelp, Gauge, Gem, Hourglass, Landmark, Layers, Power, Scale, ShieldAlert, Ticket, UserX, type LucideIcon } from "lucide-react";
import { BarList, Explain, Fact, Facts, Figure, IconTile, StatusTag, ThresholdMeter } from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import type { B5Radar } from "@/lib/admin/b5-client";
import { UNAVAILABLE_GATES, byGateDisplayOrder } from "@/lib/admin/j-client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { amountText } from "@/lib/admin/treasury-amount";
import { b5AmountDigits, b5AmountText } from "@/lib/admin/b5-money";
import { fmtConfigPct, fmtNum } from "@/lib/format";

export type DimensionKey = "bankrun" | "abnormal-accounts" | "withdraw-backlog" | "kill-switches" | "coverage";
type Level = "danger" | "warn" | "ok" | "neutral";

const LEVEL_TAG: Record<Level, string> = { danger: "告警", warn: "注意", ok: "正常", neutral: "无法计算" };
const LEVEL_RANK: Record<Level, number> = { danger: 0, warn: 1, neutral: 2, ok: 3 };

/** 和「紧急停用开关」同名同序（J1、B0 一致）：提现、试用、兑换、创世节点、质押。 */
export const GATE_NAMES: Record<string, string> = { withdraw: "提现开关", trial: "试用开关", exchange: "兑换开关", genesis: "创世节点开关", staking: "质押开关" };
const GATE_ICON: Record<string, LucideIcon> = { withdraw: Landmark, staking: Layers, genesis: Gem, exchange: ArrowLeftRight, trial: Ticket };

/** 接口给的比率不舍入：0.5234 写 52.34%。 */
export const ratioPct = (ratio: number) => fmtConfigPct(ratio * 100);
const usdt = (value: number) => `${amountText(value)} USDT`;

interface Dimension {
  key: DimensionKey;
  name: string;
  icon: LucideIcon;
  level: Level;
  /** 结论句和卡片标题下的一句话：数字和线的对照，数字包在 <b> 里。 */
  headline: ReactNode;
  /** 正常时收成一行写的值。 */
  quiet: ReactNode;
  /** 这一行的值是 0：弱化，不和有数的行一样亮。 */
  zero?: boolean;
  /** 有事时卡片里的图和明细。 */
  body: ReactNode;
  explain: ReactNode;
}

function bankrunDimension(data: B5Radar): Dimension {
  const b = data.bankrun;
  const yellow = fmtConfigPct(b.yellowPct);
  const red = fmtConfigPct(b.redPct);
  const level: Level = b.light === "red" ? "danger" : b.light === "yellow" ? "warn"
    // 出金压力到 70% 只提醒，不触发自动暂停：最多标「注意」，和下面写的「提醒」一致（DT-13）。
    : b.pressureLight === "red" ? "warn" : b.light === "green" ? "ok" : "neutral";
  const pressureText = b.pressureRatio === null ? "暂无法计算" : ratioPct(b.pressureRatio);
  const headline = b.ratio24h === null
    ? (b.light === "red" ? <>可用储备为 <b>0</b>，近 24 小时有提现，按告警处理</> : <>近 24 小时没有提现，可用储备也是 0，提现压力无法计算</>)
    : b.light === "red" ? <>提现压力 <b>{ratioPct(b.ratio24h)}</b>，达到红线 {red}</>
      : b.light === "yellow" ? <>提现压力 <b>{ratioPct(b.ratio24h)}</b>，达到黄线 {yellow}</>
        : b.pressureLight === "red" ? <>出金压力 <b>{pressureText}</b>，{b.pressureCalculable ? "达到 70% 提醒线" : "近 24 小时没有流入但有出金"}</>
          : <>提现压力 <b>{ratioPct(b.ratio24h)}</b>，低于黄线 {yellow}</>;
  const pressureTag = b.pressureLight === "red"
    ? <StatusTag tone="warn">{b.pressureCalculable ? "到提醒线" : "没有流入"}</StatusTag>
    : b.pressureCalculable ? null : <StatusTag tone="neutral">没有流入</StatusTag>;
  const facts = (
    <Facts>
      <Fact k="近 24 小时提现">{usdt(b.ratioWithdraw24hUsdt)}</Fact>
      <Fact k="可用储备">{usdt(b.ratioReserveUsdt)}</Fact>
      <Fact k="出金压力">{pressureText} <span className="b5-muted">· 提醒线 70%</span> {pressureTag}</Fact>
    </Facts>
  );
  return {
    key: "bankrun",
    name: "提现压力",
    icon: Gauge,
    level,
    headline,
    zero: b.ratio24h === 0,
    quiet: b.ratio24h === null ? "无法计算" : <>{ratioPct(b.ratio24h)} <span className="b5-muted">· 黄线 {yellow} · 红线 {red}</span></>,
    body: b.ratio24h === null ? facts : (
      <Figure width={420} stack="wide" graphic={
        <ThresholdMeter label="提现压力和黄线、红线" rows={[{ key: "bankrun", label: "提现压力", value: b.ratio24h * 100, text: ratioPct(b.ratio24h), tone: b.light === "red" ? "danger" : b.light === "yellow" ? "warn" : "ok" }]}
          marks={[{ key: "yellow", text: `黄线 ${yellow}`, value: b.yellowPct, tone: "warn" }, { key: "red", text: `红线 ${red}`, value: b.redPct, tone: "danger" }]} />
      }>{facts}</Figure>
    ),
    explain: <>
      <p>提现压力 = 近 24 小时提现申请 ÷ 可用储备，只算 USDT。提现不含已失败、已拒绝、已取消的单；可用储备是已确认的储备账本净额。</p>
      <p>黄线、红线和「紧急停用开关」共用（那边叫挤兑红线），在这里改，那边跟着变。是否自动暂停提现由紧急停用开关按它自己的统计判断，这页标红不一定马上暂停提现。</p>
      <p>出金压力 =（提现出金 + 佣金）÷ 近 24 小时全部流入，70% 是固定提醒线，只提醒，不自动处理。</p>
    </>,
  };
}

function abnormalDimension(data: B5Radar): Dimension {
  const a = data.abnormalAccounts;
  const rows = [...a.byCategory].sort((x, y) => y.count - x.count);
  return {
    key: "abnormal-accounts",
    name: "异常账户",
    icon: UserX,
    // 和今日概览同一个比较：大于 0 就要注意（B0 风险与开关）。
    level: a.count > 0 ? "warn" : "ok",
    headline: a.count > 0 ? <>异常账户 <b>{fmtNum(a.count)}</b> 个，最多的是「{operatorCopyText(rows[0].label)}」</> : <>没有异常账户</>,
    zero: a.count === 0,
    quiet: a.count > 0 ? `${fmtNum(a.count)} 个` : "0 个",
    body: <BarList label="异常账户按类别" slot={3} rows={rows.map((row) => ({ key: row.category, label: operatorCopyText(row.label), value: row.count, text: `${fmtNum(row.count)} 个` }))} />,
    explain: <>
      <p>近 7 天被风险信号标记的账户，加上有冻结中提现的账户，按人去重。</p>
      <p>一个账户可能同时在几类里，所以各类相加可能比总数多。</p>
    </>,
  };
}

const BACKLOG_STATE: Record<string, string> = { submitted: "已提交", "review-passed": "审核通过", processing: "处理中" };

function backlogDimension(data: B5Radar): Dimension {
  const w = data.withdrawBacklog;
  const amountDigits = b5AmountDigits([...w.byState.map(row => row.amountUsdt), w.totalAmountUsdt]);
  return {
    key: "withdraw-backlog",
    name: "提现积压",
    icon: Hourglass,
    level: w.light === "yellow" ? "warn" : "ok",
    headline: w.overSlaCount > 0 ? <><b>{fmtNum(w.overSlaCount)}</b> 单提现超过 {w.slaHours} 小时还没处理完</>
      : w.totalCount > 0 ? <>积压 {fmtNum(w.totalCount)} 单，都没超过 {w.slaHours} 小时</> : <>没有积压的提现</>,
    zero: w.totalCount === 0,
    quiet: w.totalCount > 0 ? <>{fmtNum(w.totalCount)} 单 <span className="b5-muted">· 没有超过 {w.slaHours} 小时的</span></> : "0 单",
    body: (
      <div className="b5-backlog">
        <div className="b5-backlog-row" data-head="">
          <span>状态</span><span>单数（全部币种）</span><span>超过 {w.slaHours} 小时</span><span>USDT 金额</span>
        </div>
        {w.byState.map((row) => (
          <div className="b5-backlog-row" key={row.state}>
            <span>{BACKLOG_STATE[row.state] ?? "其他"}</span>
            <span className="b5-num" data-zero={row.count === 0 ? "" : undefined}>{fmtNum(row.count)} 单</span>
            <span className="b5-num" data-tone={row.overSlaCount > 0 ? "warn" : undefined} data-zero={row.overSlaCount === 0 ? "" : undefined}>{fmtNum(row.overSlaCount)} 单</span>
            <span className="b5-num" data-zero={!/[1-9]/.test(row.amountUsdt) ? "" : undefined}>{b5AmountText(row.amountUsdt, amountDigits)}</span>
          </div>
        ))}
        <div className="b5-backlog-row" data-total="">
          <span>合计</span>
          <span className="b5-num">{fmtNum(w.totalCount)} 单</span>
          <span className="b5-num" data-tone={w.overSlaCount > 0 ? "warn" : undefined}>{fmtNum(w.overSlaCount)} 单</span>
          <span className="b5-num">{b5AmountText(w.totalAmountUsdt, amountDigits)}</span>
        </div>
      </div>
    ),
    explain: <>
      <p>已提交、审核通过、处理中这三类还没结束的提现。从提交起超过 {w.slaHours} 小时算超时，有超时的就标注意。</p>
      <p>单数和超时含全部币种；金额只加 USDT 的单，按原金额不取整，别的币种不换算、不计入。所以金额和单数不是同一批单。</p>
    </>,
  };
}

function switchesDimension(data: B5Radar): Dimension {
  const gates = [...data.killSwitches].sort((a, b) => byGateDisplayOrder(a.key, b.key));
  const available = gates.filter((gate) => !UNAVAILABLE_GATES[gate.key]);
  const closed = available.filter((gate) => !gate.enabled);
  return {
    key: "kill-switches",
    name: "业务开关",
    icon: Power,
    // 和紧急停用开关、今日概览同一个画法：已关停是橙色，暂不可用不计数。
    level: closed.length > 0 ? "warn" : "ok",
    headline: closed.length > 0
      ? <><b>{closed.length}</b> 个业务已关停：{closed.map((gate) => GATE_NAMES[gate.key]).join("、")}</>
      : <>{available.length} 个业务都在线</>,
    quiet: <>{available.length - closed.length} / {available.length} 在线</>,
    body: (
      <ul className="b5-gates" aria-label="业务开关">
        {gates.map((gate) => {
          const Icon = GATE_ICON[gate.key] ?? Power;
          const off = UNAVAILABLE_GATES[gate.key];
          return (
            <li key={gate.key}>
              <IconTile icon={Icon} tone={off ? "role-other" : gate.enabled ? "ok" : "warn"} size={22} />
              <span className="b5-gate-name">{GATE_NAMES[gate.key] ?? gate.key}</span>
              {off ? <StatusTag tone="neutral" icon={Ban} explain={off.detail}>暂不可用</StatusTag>
                : gate.enabled ? <StatusTag tone="ok">在线</StatusTag> : <StatusTag tone="warn" icon={Power}>已关停</StatusTag>}
            </li>
          );
        })}
      </ul>
    ),
    explain: <>
      <p>和「紧急停用开关」读同一份开关设置。这页只能看，开关和恢复到紧急停用开关页办。</p>
      <p>开关还没设置过时系统按关闭处理，也写已关停；设置有误时这页会读不出来。地区限制不在这里，到「地区访问限制」看。</p>
    </>,
  };
}

function coverageDimension(data: B5Radar): Dimension {
  const c = data.coverage;
  const red = fmtConfigPct(c.redlinePct);
  const healthy = fmtConfigPct(c.healthyPct);
  const level: Level = c.light === "red" ? "danger" : c.light === "yellow" ? "warn" : c.light === "green" ? "ok" : "neutral";
  const ratio = c.ratio === null ? null : fmtConfigPct(c.ratio);
  const facts = (
    <Facts>
      <Fact k="储备">{usdt(c.ratioReserveUsdt)}</Fact>
      <Fact k="应付款">{usdt(c.ratioLiabilitiesUsdt)}</Fact>
    </Facts>
  );
  return {
    key: "coverage",
    name: "兑付覆盖率",
    icon: Scale,
    level,
    headline: c.ratio === null ? <>目前没有应付款，不用算覆盖率</>
      // 红灯用的是后端的精确判断：显示的比率四舍五入后可能和红线一样，这时写明是按精确值。
      : c.light === "red" ? c.ratio >= c.redlinePct ? <>兑付覆盖率 <b>{ratio}</b>，按精确值已低于红线 {red}</> : <>兑付覆盖率 <b>{ratio}</b>，低于红线 {red}</>
        : c.light === "yellow" ? <>兑付覆盖率 <b>{ratio}</b>，低于健康线 {healthy}</>
          : <>兑付覆盖率 <b>{ratio}</b>，不低于健康线 {healthy}</>,
    quiet: c.ratio === null ? "没有应付款" : <>{ratio} <span className="b5-muted">· 红线 {red}</span></>,
    body: c.ratio === null ? facts : (
      <Figure width={420} stack="wide" graphic={
        <ThresholdMeter label="兑付覆盖率和红线、健康线" rows={[{ key: "coverage", label: "覆盖率", value: c.ratio, text: ratio!, tone: level === "neutral" ? "ok" : level }]}
          marks={[{ key: "red", text: `红线 ${red}`, value: c.redlinePct, tone: "danger" }, { key: "healthy", text: `健康线 ${healthy}`, value: c.healthyPct, tone: "ok" }]} />
      }>{facts}</Figure>
    ),
    explain: <>
      <p>和「资金与应付款总览」同一组数：储备 ÷ 应付款。低于红线标告警，低于健康线标注意。</p>
      <p>这里的储备和提现压力用的可用储备算法不同，两个数不能直接比。</p>
    </>,
  };
}

export function buildDimensions(data: B5Radar) {
  const all = [bankrunDimension(data), abnormalDimension(data), backlogDimension(data), switchesDimension(data), coverageDimension(data)];
  const ordered = [...all].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  return {
    issues: ordered.filter((item) => item.level === "danger" || item.level === "warn"),
    quiet: ordered.filter((item) => item.level === "ok" || item.level === "neutral"),
  };
}
export type BuiltDimension = ReturnType<typeof buildDimensions>["issues"][number];

const TAG_TONE: Record<Level, StateTone> = { danger: "danger", warn: "warn", ok: "ok", neutral: "neutral" };
/** 告警、注意不是等待，不用默认的时钟；无法计算用问号。 */
const TAG_ICON: Partial<Record<Level, LucideIcon>> = { danger: ShieldAlert, warn: AlertTriangle, neutral: CircleHelp };

/** 有事的项：一张卡说清多严重、为什么、去哪。 */
export function IssueCard({ item, actions, extra }: { item: BuiltDimension; actions: ReactNode; extra?: ReactNode }) {
  return (
    <section className="b5-issue" data-tone={item.level} aria-labelledby={`b5-dim-${item.key}`}>
      <div className="b5-issue-head">
        <IconTile icon={item.icon} tone={TAG_TONE[item.level]} size={28} />
        <h2 id={`b5-dim-${item.key}`} className="b5-issue-name">{item.name}</h2>
        <Explain label={`${item.name}怎么算`} content={item.explain} />
        <StatusTag tone={TAG_TONE[item.level]} icon={TAG_ICON[item.level]}>{LEVEL_TAG[item.level]}</StatusTag>
        {extra}
      </div>
      <p className="b5-issue-headline">{item.headline}</p>
      <div className="b5-issue-body">{item.body}</div>
      {actions && <div className="b5-issue-actions">{actions}</div>}
    </section>
  );
}

/** 正常和不用算的项：一项一行，名称、值、状态、入口。 */
export function QuietRow({ item, actions, extra }: { item: BuiltDimension; actions: ReactNode; extra?: ReactNode }) {
  return (
    <li className="b5-quiet-row">
      <IconTile icon={item.icon} tone="role-other" size={22} />
      <span className="b5-quiet-name">{item.name}<Explain label={`${item.name}怎么算`} content={item.explain} /></span>
      <span className="b5-quiet-value" data-zero={item.zero ? "" : undefined}>{item.quiet}</span>
      <span className="b5-quiet-state">
        <StatusTag tone={TAG_TONE[item.level]} icon={TAG_ICON[item.level]}>{item.level === "neutral" && item.key === "coverage" ? "不用算" : LEVEL_TAG[item.level]}</StatusTag>
        {extra}
      </span>
      <span className="b5-quiet-actions">{actions}</span>
    </li>
  );
}
