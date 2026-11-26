"use client";

/**
 * K4 风险评分规则的展示件：只画已读到的数据，不发请求、不判权限、不改请求内容。
 * 状态和提交处理都在 k4-scoring.tsx，这里只收值和回调。
 */
import { Fragment, useId, useState, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChevronDown, CircleOff, Crosshair, Minus } from "lucide-react";
import { BarList, Button, Cell, Check, DiffList, Explain, Fold, NumberInput, Panel, RatioBar, ScaleBar, StatusTag, Table, Td, Th, Tr, type DiffRow } from "@/app/components/rd";
import { K4_DIMENSION_KEYS, type K4Contribution, type K4Dimension, type K4DimensionKey, type K4Distribution, type K4Model, type K4ScoreMappingKey, type K4ScoreMappings, type K4WithdrawalEvidence, type K4WithdrawalWindow } from "@/lib/admin/k-client";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { amountDisplay } from "@/lib/format";

export const fmt = (value: number) => value.toLocaleString("en-US");

export type EditableModel = {
  weights: Record<K4DimensionKey, number>;
  inputSources: Record<K4DimensionKey, boolean>;
  scoreMappings: K4ScoreMappings;
  bandLowMax: number;
  bandHighMin: number;
  autoEscalateScore: number;
};

export function editableModel(model: K4Model): EditableModel {
  return {
    weights: { ...model.weights },
    inputSources: { ...model.inputSources },
    scoreMappings: { ...model.scoreMappings },
    bandLowMax: model.bandLowMax,
    bandHighMin: model.bandHighMin,
    autoEscalateScore: model.autoEscalateScore,
  };
}

export const K4_MAPPING_FIELDS: Array<{ key: K4ScoreMappingKey; label: string; min: number; max: number; unit: string }> = [
  { key: "multiAccount.mediumMin", label: "中风险关联组最少账号数", min: 1, max: 100, unit: "个" },
  { key: "multiAccount.highMin", label: "高风险关联组最少账号数", min: 1, max: 100, unit: "个" },
  { key: "multiAccount.mediumScore", label: "中风险关联账户情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "multiAccount.highScore", label: "高风险关联账户情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "multiAccount.fraudScore", label: "关联欺诈账户情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "arbitrage.singleScore", label: "单次异常套利情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "arbitrage.repeatMin", label: "重复套利最小次数", min: 2, max: 100, unit: "次" },
  { key: "arbitrage.repeatScore", label: "重复套利情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "arbitrage.severeScore", label: "高风险套利情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "withdraw.baselineMultiplierPct", label: "提现基线倍数（%）", min: 100, max: 1000, unit: "%" },
  { key: "withdraw.baselineScore", label: "提现超过平时水平时的风险分", min: 0, max: 100, unit: "分" },
  { key: "withdraw.highFrequency24h", label: "24小时频繁提现最少笔数", min: 1, max: 100, unit: "笔" },
  { key: "withdraw.largeAmountUsd", label: "大额单笔阈值（USD）", min: 1, max: 1000000, unit: "USD" },
  { key: "withdraw.highScore", label: "频繁大额提现情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "account.matureDays", label: "成熟账户天数", min: 1, max: 10000, unit: "天" },
  { key: "account.newDays", label: "新账户天数", min: 1, max: 10000, unit: "天" },
  { key: "account.middleScore", label: "普通新账户情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "account.newLargeScore", label: "新账户大额操作情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "anomaly.lowScore", label: "一般异常情形的风险分", min: 0, max: 100, unit: "分" },
  { key: "anomaly.tamperScore", label: "篡改拦截情形的风险分", min: 0, max: 100, unit: "分" },
];

/** 字段名去掉括号里的单位：单位写在输入框和值后面。 */
export const fieldName = (label: string) => label.replace(/（[^）]*）$/, "");

/** 20 项细则按维度分五组，次序同后端校验的跨字段次序。说明只写后端评分器的真实算法（K4RiskScorer）。 */
export const MAPPING_GROUPS: Array<{ dimKey: K4DimensionKey; keys: K4ScoreMappingKey[]; explain: string }> = [
  { dimKey: "multiAccount", keys: ["multiAccount.mediumMin", "multiAccount.highMin", "multiAccount.mediumScore", "multiAccount.highScore", "multiAccount.fraudScore"],
    explain: "取这位用户所在关联组的最大账户数：组里有已冻结的按关联欺诈的分；否则达到高风险账号数按高风险的分，达到中风险账号数按中风险的分，其余 0 分。中风险账号数要小于高风险账号数，三个分要从低到高。" },
  { dimKey: "arbitrage", keys: ["arbitrage.singleScore", "arbitrage.repeatMin", "arbitrage.repeatScore", "arbitrage.severeScore"],
    explain: "数这位用户在套利与刷量记录里出现的次数：记录有冻结账户组、拦截新人礼或标记账户的处置，按高风险套利的分；次数达到重复次数按重复套利的分；只有 1 次按单次的分；没有为 0。三个分要从低到高。" },
  { dimKey: "withdrawVelocity", keys: ["withdraw.baselineMultiplierPct", "withdraw.baselineScore", "withdraw.highFrequency24h", "withdraw.largeAmountUsd", "withdraw.highScore"],
    explain: "近 24 小时笔数达到频繁笔数、而且最大一笔达到大额阈值，按频繁大额的分；否则近 7 天的日均笔数或日均金额，任一达到之前 30 天日均乘以基线倍数（200% 就是 2 倍），按超过平时水平的分；都没有为 0。统计全部提现，不分是否成功。" },
  { dimKey: "accountAge", keys: ["account.matureDays", "account.newDays", "account.middleScore", "account.newLargeScore"],
    explain: "注册满成熟账户天数为 0 分；不到成熟天数的都按普通新账户的分；不满新账户天数、而且近 24 小时有一笔达到大额阈值的提现，按新账户大额的分。新账户天数要小于成熟账户天数。" },
  { dimKey: "anomalyBehavior", keys: ["anomaly.lowScore", "anomaly.tamperScore"],
    explain: "近 30 天有篡改拦截信号按篡改拦截的分；有其他异常信号按一般异常的分；没有为 0。篡改拦截的分不能低于一般异常的分。" },
];

const field = (key: K4ScoreMappingKey) => K4_MAPPING_FIELDS.find((item) => item.key === key)!;
export const mappingText = (key: K4ScoreMappingKey, value: number) => `${fmt(value)} ${field(key).unit}`;

/** 草稿和生效版本逐项比，供页面差异表和发布确认用；只是显示，不参与提交。 */
export function modelDiffRows(before: EditableModel, after: EditableModel, dimensions: K4Dimension[]): DiffRow[] {
  const names = new Map(dimensions.map((item) => [item.dimKey, item.name]));
  const rows: DiffRow[] = [];
  for (const key of K4_DIMENSION_KEYS) rows.push({ key: `w-${key}`, label: `${names.get(key) ?? key} · 权重`, before: `${before.weights[key]}%`, after: `${after.weights[key]}%` });
  for (const key of K4_DIMENSION_KEYS) rows.push({
    key: `s-${key}`, label: `${names.get(key) ?? key} · 参与评分`, before: before.inputSources[key] ? "参与" : "不参与", after: after.inputSources[key] ? "参与" : "不参与",
    note: before.inputSources[key] && !after.inputSources[key] ? "不参与后这一维的贡献记 0，权重仍计入合计，其余维度不会自动补上。" : undefined,
  });
  rows.push({ key: "low", label: "中风险起始分", before: `${before.bandLowMax} 分`, after: `${after.bandLowMax} 分` });
  rows.push({ key: "high", label: "高风险起始分", before: `${before.bandHighMin} 分`, after: `${after.bandHighMin} 分` });
  rows.push({ key: "esc", label: "自动升级线", before: `${before.autoEscalateScore} 分`, after: `${after.autoEscalateScore} 分`,
    note: after.autoEscalateScore < before.autoEscalateScore ? "线变低：分数落在新旧两条线之间的人，新提现也会发升级告警；没被「提现风险规则」冻结或延迟的转人工审核。" : undefined });
  for (const item of K4_MAPPING_FIELDS) rows.push({ key: item.key, label: fieldName(item.label), before: mappingText(item.key, before.scoreMappings[item.key]), after: mappingText(item.key, after.scoreMappings[item.key]) });
  return rows;
}

export const changedCount = (rows: DiffRow[]) => rows.filter((row) => row.before !== row.after).length;

/** 分数轴上的分档段：按真实分界切，零宽的段不画（比如高风险起始分是 100）。 */
function bandSegments(model: Pick<EditableModel, "bandLowMax" | "bandHighMin" | "autoEscalateScore">) {
  const cuts = [
    { from: 0, to: model.bandLowMax, name: "低风险" },
    { from: model.bandLowMax, to: model.bandHighMin, name: "中风险" },
    { from: model.bandHighMin, to: model.autoEscalateScore, name: "高风险" },
    { from: model.autoEscalateScore, to: 100, name: "达到自动升级线" },
  ].filter((cut) => cut.to > cut.from);
  return { labels: cuts.map((item) => item.name), marks: cuts.slice(1).map((item) => ({ value: item.from, text: String(item.from) })) };
}

export const bandsText = (model: Pick<EditableModel, "bandLowMax" | "bandHighMin" | "autoEscalateScore">) =>
  `${model.bandLowMax > 0 ? `低风险 0–${model.bandLowMax - 1} 分，` : ""}中风险 ${model.bandLowMax}–${model.bandHighMin - 1} 分，高风险 ${model.bandHighMin}–100 分，自动升级线 ${model.autoEscalateScore} 分`;

/** 分档线和自动升级线落在 0–100 分数轴上哪里。看它能判断：多少分算中、高风险，升级线在高风险里的哪个位置。 */
export function BandAxis({ model, label }: { model: Pick<EditableModel, "bandLowMax" | "bandHighMin" | "autoEscalateScore">; label: string }) {
  const valid = model.bandLowMax >= 0 && model.bandLowMax < model.bandHighMin && model.bandHighMin <= 100 && model.autoEscalateScore >= model.bandHighMin && model.autoEscalateScore <= 100;
  if (!valid) return <span className="k4-quiet" data-kind="problem">分档线的次序不对，改正后这里画分数轴。</span>;
  return <ScaleBar label={label} valueText={bandsText(model)} max={100} bands={bandSegments(model)} />;
}

/** 分档线的数字写在轴旁边：三个分界一行。 */
export function BandValues({ model, before }: { model: Pick<EditableModel, "bandLowMax" | "bandHighMin" | "autoEscalateScore">; before?: Pick<EditableModel, "bandLowMax" | "bandHighMin" | "autoEscalateScore"> }) {
  const item = (name: string, value: number, old?: number) => (
    <div className="k4-band-value">
      <dt>{name}</dt>
      <dd>{old !== undefined && old !== value ? <><span className="k4-was">{old}</span><span className="k4-arrow" aria-hidden>→</span><b data-after="">{value}</b></> : <b>{value}</b>} <span className="k4-unit">分</span></dd>
    </div>
  );
  return (
    <dl className="k4-band-values">
      {item("中风险起始分", model.bandLowMax, before?.bandLowMax)}
      {item("高风险起始分", model.bandHighMin, before?.bandHighMin)}
      {item("自动升级线", model.autoEscalateScore, before?.autoEscalateScore)}
    </dl>
  );
}

/** 各档现在有多少人。人数是角色紫（人），一个颜色比大小，数字在条右边。 */
export function Distribution({ rows, total }: { rows: K4Distribution[]; total: number }) {
  if (total === 0 || rows.length === 0) return <p className="k4-quiet">还没有评分用户，没有分布可看。</p>;
  return <BarList label="各档人数" slot={3} max={total} rows={rows.map((row) => ({
    key: row.band, label: <span className="k4-dist-name">{row.band}<span className="k4-dist-range">{row.rangeText.replace(">=", "≥").replace("<", "<")}</span></span>,
    value: row.count, text: <span className="k4-dist-num"><b>{fmt(row.count)}</b> 人<span className="k4-dist-pct">{row.percentage}%</span></span>,
  }))} />;
}

/** 五维权重表：每一维的权重占 100% 的多少，草稿和生效并排。看它能判断：哪一维对总分影响最大，草稿把哪一维调了多少。 */
export function WeightTable({ dimensions, active, draft, activeLabel, draftLabel }: {
  dimensions: K4Dimension[];
  active: EditableModel;
  draft?: EditableModel;
  activeLabel: string;
  draftLabel?: string;
}) {
  const weightCell = (model: EditableModel, key: K4DimensionKey, name: string, compare?: number) => {
    const weight = model.weights[key];
    const changed = compare !== undefined && compare !== weight;
    return (
      <span className="k4-weight">
        <RatioBar compact quiet label={`${name}权重`} value={weight} total={100} valueText={`${weight}%，五维合计 100%`} tone="role-4" />
        <span className="k4-weight-num" data-changed={changed ? "" : undefined}>{weight}%</span>
        {changed && <span className="k4-delta">{weight > compare! ? `+${weight - compare!}` : weight - compare!}</span>}
      </span>
    );
  };
  const source = (model: EditableModel, key: K4DimensionKey, compare?: boolean) => {
    const on = model.inputSources[key];
    const tag = on ? <StatusTag tone="ok">参与</StatusTag> : <StatusTag tone="warn" icon={CircleOff}>不参与</StatusTag>;
    return compare !== undefined && compare !== on ? <span className="k4-source-change">{tag}<span className="k4-delta">已改</span></span> : tag;
  };
  return (
    <Table label="五维权重" className="k4-weights" data-single={draft ? undefined : ""}>
      <thead><tr>
        <Th>维度</Th>
        <Th>{activeLabel}</Th>
        {draft && <Th>{draftLabel}</Th>}
        <Th>参与评分</Th>
      </tr></thead>
      <tbody>
        {dimensions.map((item) => (
          <Tr key={item.dimKey}>
            <Td><Cell main={item.name} sub={item.source} /></Td>
            <Td>{weightCell(active, item.dimKey, item.name)}</Td>
            {draft && <Td>{weightCell(draft, item.dimKey, item.name, active.weights[item.dimKey])}</Td>}
            <Td>{source(draft ?? active, item.dimKey, draft ? active.inputSources[item.dimKey] : undefined)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

/** 20 项细则的只读视图：按维度五组，草稿改过的写前后值。 */
export function MappingView({ dimensions, active, draft }: { dimensions: K4Dimension[]; active: EditableModel; draft?: EditableModel }) {
  const names = new Map(dimensions.map((item) => [item.dimKey, item.name]));
  return (
    <div className="k4-map-groups">
      {MAPPING_GROUPS.map((group) => (
        <Panel key={group.dimKey} plain headingLevel={3} title={names.get(group.dimKey) ?? group.dimKey} explain={group.explain} explainLabel={`${names.get(group.dimKey) ?? ""}怎么算`}>
          <dl className="k4-map-list">
            {group.keys.map((key) => {
              const now = active.scoreMappings[key];
              const next = draft?.scoreMappings[key];
              return (
                <div key={key} className="k4-map-row">
                  <dt>{fieldName(field(key).label)}</dt>
                  <dd>{next !== undefined && next !== now
                    ? <><span className="k4-was">{fmt(now)}</span><span className="k4-arrow" aria-hidden>→</span><b data-after="">{fmt(next)}</b> <span className="k4-unit">{field(key).unit}</span></>
                    : <><b>{fmt(now)}</b> <span className="k4-unit">{field(key).unit}</span></>}</dd>
                </div>
              );
            })}
          </dl>
        </Panel>
      ))}
    </div>
  );
}

/** 差异表：只列改了的项，其余收起。 */
export function ModelDiff({ rows }: { rows: DiffRow[] }) {
  return <DiffList rows={rows} emptyNote="草稿和生效版本的配置完全相同" restTitle="没有改的项" />;
}

/** 原文金额按全站写法（amountDisplay）：去掉末尾 0、整数不写小数点、千分位，不舍入。 */
const moneyText = (raw: string) => amountDisplay(raw);

/** 日均笔数这类不是金额的原文：去掉末尾的 0、最少 2 位、不舍入，整数部分加千分位（写法不变）。 */
function decimalText(raw: string) {
  const [whole, fraction = ""] = raw.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** 提现速度打分那一刻的原始记录：每个币种一行，金额是申请提现的原额，不换算、不相加。 */
function WithdrawEvidence({ data, id }: { data: K4WithdrawalEvidence; id: string }) {
  const time = (value: string | null) => (value ? formatBusinessTimeCompact(value, "—") : "—");
  const amount = (count: number, value: string, currency: string) => <Cell num main={`${count} 笔`} sub={`${moneyText(value)} ${currency}`} />;
  return (
    <div className="k4-withdraw" id={id}>
      <p className="k4-withdraw-head">
        <span>{data.assets.length === 0 ? `打分时 ${time(data.capturedAt)}（${businessZone().label}），近 7 天和此前 30 天都没有提现。`
          : `打分时 ${time(data.capturedAt)}（${businessZone().label}）的提现记录 · 申请金额，按各币种原额`}</span>
        <Explain label="这些数怎么统计" content={<>
          <p>近 24 小时、近 7 天都截到打分那一刻；「此前 30 天」是 7 天以前的 30 天（{time(data.windows.baseline.fromInclusive)} 至 {time(data.windows.baseline.toExclusive)}），日均按 {data.baselineDivisorDays} 天平均。</p>
          <p>不分是否成功，全部提现都算。金额是用户申请提现的数，不是到账额，不换算成别的币种。</p>
        </>} />
      </p>
      {data.assets.length > 0 && (
        <Table label="各币种的提现记录" className="k4-withdraw-assets">
          <thead><tr>
            <Th>币种</Th>
            <Th align="right">近 24 小时</Th>
            <Th align="right">近 7 天</Th>
            <Th align="right">此前 30 天日均</Th>
            <Th align="right">24 小时内最大一笔</Th>
          </tr></thead>
          <tbody>
            {data.assets.map((asset) => (
              <Tr key={asset.currency}>
                <Td><Cell mono main={asset.currency} /></Td>
                <Td align="right">{amount(asset.count24h, asset.amount24h, asset.currency)}</Td>
                <Td align="right">{amount(asset.count7d, asset.amount7d, asset.currency)}</Td>
                <Td align="right"><Cell num main={`${decimalText(asset.baselineDailyCount)} 笔`} sub={`${moneyText(asset.baselineDailyAmount)} ${asset.currency}`} /></Td>
                <Td align="right"><Cell num main={asset.max24h === null ? "—" : `${moneyText(asset.max24h)} ${asset.currency}`} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

/** 笔数原样写：去掉小数末尾的 0（日均可以是 0.4 笔），不补零、不舍入。 */
const countText = (raw: string) => raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;

/** 一个窗口：「24 小时 · 6 笔 · 31,500 USDT」；混币只写笔数，零笔写「0 笔」（TX-20）。 */
function windowText(name: string, window: K4WithdrawalWindow) {
  const count = countText(String(window.count));
  const money = window.amount !== null && window.currency !== null && count !== "0" ? ` · ${moneyText(window.amount)} ${window.currency}` : "";
  return `${name} · ${count} 笔${money}`;
}

/** 悬停和聚焦看的那一行：一个币种照格子里写；几种币种时在后面按币种写原额（ST-04，板 3）。 */
function windowTip(name: string, window: K4WithdrawalWindow, perAsset: Array<{ count: string; amount: string; currency: string }>) {
  const line = windowText(name, window);
  const spread = perAsset.filter((asset) => !/^0(\.0*)?$/.test(asset.count));
  return window.amount === null && spread.length > 1 ? `${line}：${spread.map((asset) => `${asset.count} 笔 ${moneyText(asset.amount)} ${asset.currency}`).join("，")}` : line;
}

/** 提现速度的证据：三个窗口分三段并排，放不下按段换行，段内不折行（VS-109）。悬停或键盘聚焦看同一套写法的原币种证据。 */
function WithdrawWindows({ data }: { data: K4WithdrawalEvidence }) {
  const { summary, assets } = data;
  const tip = [
    windowTip("24 小时", summary.last24h, assets.map((asset) => ({ count: String(asset.count24h), amount: asset.amount24h, currency: asset.currency }))),
    windowTip("7 天", summary.last7d, assets.map((asset) => ({ count: String(asset.count7d), amount: asset.amount7d, currency: asset.currency }))),
    windowTip("历史日均", summary.baselineDaily, assets.map((asset) => ({ count: countText(asset.baselineDailyCount), amount: asset.baselineDailyAmount, currency: asset.currency }))),
  ];
  return (
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="k4-evidence-wins" tabIndex={0}>
            <span>{windowText("24 小时", summary.last24h)}</span>
            <span>{windowText("7 天", summary.last7d)}</span>
            <span>{windowText("历史日均", summary.baselineDaily)}</span>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content className="rd-tip rd-cell-tip" sideOffset={6}>{tip.join("\n")}</Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/**
 * 一个用户五维贡献：子分、权重、贡献和证据。提现速度用结构化记录，可以展开看各币种。
 */
export function ContributionTable({ rows, total, label }: { rows: K4Contribution[]; total: number; label: string }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <Table label={label} className="k4-contrib">
      <thead><tr>
        <Th>维度 · 命中</Th>
        <Th align="right">子分 · 权重</Th>
        <Th>贡献</Th>
        <Th><span className="k4-th">证据<Explain label="证据是什么" content="每一维为什么得这个分。提现速度按时间窗口写笔数和金额，金额按各自币种；一个窗口里有几种币种时只写笔数，点「各币种明细」看。" /></span></Th>
      </tr></thead>
      <tbody>
        {rows.map((row) => {
          const evidence = row.dimKey === "withdrawVelocity" ? "—" : row.evidence;
          return (
            <Fragment key={row.dimKey}>
              <Tr>
                <Td><span className="k4-dim">{row.name}{row.hit ? <StatusTag tone="warn" icon={Crosshair}>命中</StatusTag> : <StatusTag tone="neutral" icon={Minus}>未命中</StatusTag>}</span></Td>
                <Td align="right"><Cell num main={`${row.subScore} 分`} sub={`权重 ${row.weightPct}%`} /></Td>
                <Td>
                  <span className="k4-weight">
                    {total > 0 ? <RatioBar compact quiet label={`${row.name}贡献`} value={row.points} total={total} valueText={`${row.points} 分，系统评分 ${total} 分`} tone="role-4" /> : <span className="k4-bar-gap" aria-hidden />}
                    <span className="k4-weight-num">{row.points} 分</span>
                  </span>
                </Td>
                <Td grow>
                  <span className="k4-evidence-cell">
                    {row.structured
                      ? <WithdrawWindows data={row.structured} />
                      : <span className="k4-evidence" data-user-content="" title={evidence === "—" ? undefined : evidence || undefined}>{evidence || "—"}</span>}
                    {row.structured && <Button size="sm" variant="ghost" className="k4-evidence-toggle" aria-expanded={open} aria-controls={detailId}
                      icon={<ChevronDown size={14} aria-hidden className="k4-chevron" data-open={open ? "" : undefined} />} onClick={() => setOpen((value) => !value)}>各币种明细</Button>}
                  </span>
                </Td>
              </Tr>
              {row.structured && open && <tr className="k4-withdraw-row"><td colSpan={4}><WithdrawEvidence data={row.structured} id={detailId} /></td></tr>}
            </Fragment>
          );
        })}
      </tbody>
      <tfoot><tr className="k4-contrib-total"><Td>系统评分</Td><Td /><Td><b>{total} 分</b></Td><Td /></tr></tfoot>
    </Table>
  );
}

/** 编辑抽屉里的一行权重：输入、参与评分、生效值。 */
export function WeightEditRow({ item, value, on, activeValue, activeOn, baseLabel, disabled, onValue, onSource, error }: {
  item: K4Dimension;
  /** 比较的底版：草稿或生效。 */
  baseLabel: string;
  value: number;
  on: boolean;
  activeValue: number;
  activeOn: boolean;
  disabled: boolean;
  onValue: (value: number) => void;
  onSource: (on: boolean) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="k4-edit-row" data-invalid={error ? "" : undefined}>
      <label className="k4-edit-name" htmlFor={id}><span>{item.name}</span><span className="k4-quiet">{item.source}</span></label>
      <div className="k4-edit-entry">
        <NumberInput id={id} unit="%" min={0} max={100} step={1} disabled={disabled} value={String(value)} aria-invalid={error ? true : undefined}
          aria-label={`${item.name} 权重百分比`} onChange={(event) => onValue(Number(event.target.value))} />
        <span className="k4-edit-was">{[activeValue !== value ? `${baseLabel} ${activeValue}%` : "", activeOn !== on ? (activeOn ? `${baseLabel}参与` : `${baseLabel}不参与`) : ""].filter(Boolean).join(" · ") || null}</span>
      </div>
      <Check label="参与评分" checked={on} disabled={disabled} aria-label={`${item.name}是否参与评分`} onChange={(event) => onSource(event.target.checked)} />
      {error && <div className="rd-form-error k4-edit-error" role="alert">{error}</div>}
    </div>
  );
}

/** 编辑抽屉里的一个数字字段：名字、范围、生效值。 */
export function NumberEditRow({ label, unit, min, max, value, activeValue, baseLabel, disabled, error, onValue, ariaLabel }: {
  label: ReactNode;
  baseLabel: string;
  unit: string;
  min: number;
  max: number;
  value: number;
  activeValue: number;
  disabled: boolean;
  error?: string;
  onValue: (value: number) => void;
  ariaLabel: string;
}) {
  const id = useId();
  return (
    <div className="k4-edit-row" data-num="" data-invalid={error ? "" : undefined}>
      <label className="k4-edit-name" htmlFor={id}><span>{label}</span><span className="k4-quiet">{fmt(min)}–{fmt(max)} {unit}</span></label>
      <div className="k4-edit-entry">
        <NumberInput id={id} unit={unit} min={min} max={max} step={1} disabled={disabled} value={String(value)} aria-invalid={error ? true : undefined}
          aria-label={ariaLabel} onChange={(event) => onValue(Number(event.target.value))} />
        <span className="k4-edit-was">{activeValue !== value ? <>{baseLabel} {fmt(activeValue)} {unit}</> : null}</span>
      </div>
      {error && <div className="rd-form-error k4-edit-error" role="alert">{error}</div>}
    </div>
  );
}

/** 编辑框里按组折叠的细则。 */
export function MappingEditGroup({ title, explain, summary, alert, children }: { title: string; explain: string; summary: string; alert: boolean; children: ReactNode }) {
  return <Fold inset title={title} explain={explain} summary={summary} alert={alert} defaultOpen={alert}>{children}</Fold>;
}

/** 版本卡里的几行名称和值：名称窄列，值紧跟在后面。 */
export function VersionFacts({ rows }: { rows: Array<{ key: string; label: string; value: ReactNode }> }) {
  return (
    <dl className="k4-facts">
      {rows.map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl>
  );
}
