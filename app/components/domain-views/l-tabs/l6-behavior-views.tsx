"use client";

/**
 * L6 用户行为热力图的页面件：合计、两张榜、页面热力表、单页点击位置、访问趋势、统计范围。
 * 只管显示，读取和导出在 l6-behavior-heatmap.tsx。颜色只取 --rd-* 令牌（样式在 l-domain.css 的 .l6-page 一段）。
 */
import type { ReactNode } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Clock3, Eye, Flame, LayoutGrid, LogOut, MousePointerClick, Smartphone, TrendingUp, TriangleAlert } from "lucide-react";
import {
  BarList, BlockState, Button, Cell, ColumnChart, Explain, Fact, Facts, Fold, Notice, Panel, ScaleBar, Segments, Stat, StatBand, StatusTag,
  Table, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import { behaviorPageTitle } from "@/lib/admin/l6-page-labels";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { DepthFilter, HeatRow, HeatSummary, L6BehaviorHeatmapData, PageClickHeat, TimeWindow } from "./l6-live-data";

export type SortKey = "pv" | "clicks" | "dwellMs" | "bounceRate";

export const DEPTHS: { v: DepthFilter; lb: string }[] = [
  { v: "all", lb: "全部页面" },
  { v: "L1", lb: "一级" },
  { v: "L2", lb: "二级" },
  { v: "L3", lb: "三级" },
];
export const DEPTH_HINT: Record<DepthFilter, string> = {
  all: "逐页列出这段时间有事件的目录页面",
  L1: "按一级入口页汇总，一行是一个入口下面的一组页面",
  L2: "按二级板块页汇总，一行是一个板块下面的一组页面",
  L3: "只看三级页面（详情、指南这类最里层的页面），逐页列出",
};
export const WINDOWS: { v: TimeWindow; lb: string }[] = [
  { v: "24h", lb: "近 24 小时" },
  { v: "7d", lb: "近 7 天" },
  { v: "30d", lb: "近 30 天" },
];
export const DEVICES: { v: "ALL" | "APP" | "H5" | "MP"; lb: string }[] = [
  { v: "ALL", lb: "全部设备" },
  { v: "H5", lb: "移动网页" },
  { v: "APP", lb: "原生应用" },
  { v: "MP", lb: "小程序" },
];
export const LOCALES: { v: string; lb: string }[] = [
  { v: "ALL", lb: "全部语言" },
  { v: "zh-CN", lb: "简体中文" },
  { v: "en-US", lb: "英语" },
  { v: "vi-VN", lb: "越南语" },
];
const SORTS: { v: SortKey; lb: string }[] = [
  { v: "pv", lb: "浏览次数" },
  { v: "clicks", lb: "点击次数" },
  { v: "dwellMs", lb: "平均停留" },
  { v: "bounceRate", lb: "跳出率" },
];

/** 跳出率预警线：固定 50%，不能调（决定 L6-现状、P-L6-02）。恰好 50% 不算超过。 */
export const BOUNCE_WARN = 0.5;
/** 单页点击少于这个数时不画分布，只列区域占比并写明样本少（显示规则，待协调人确认）。 */
const SMALL_SAMPLE = 30;
export const CSV_COLUMNS = "每个页面一行，八列";

export const n = (x: number): string => x.toLocaleString("en-US");
export const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;
export function dwell(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, "0")} 秒` : `${s} 秒`;
}

const DWELL_EXPLAIN = "离开一页（换到下一页）时记下在这一页停了多久，按浏览次数加权平均。切到后台、退出 App 时正在看的那一页不记。";
const BOUNCE_EXPLAIN = "同一次打开 App 里，看完这一页后到统计截止都没再打开别的页面，就算一次跳出；和停留长短无关。超过 50% 标出来，50% 是固定的预警线。";
const ZONE_NAME: Record<string, string> = {
  TOP: "页面顶部", CONTENT: "中间内容", MIDDLE: "页面中部", MAIN_CTA: "主按钮", BOTTOM: "页面底部",
  top: "页面顶部", middle: "页面中部", bottom: "页面底部",
};
const zoneName = (label: string) => ZONE_NAME[label] ?? operatorCopyText(label);

/** 活跃度色阶：按这一列最多的那一页比，五档（L6-V04，阈值沿用改版前）。 */
function activityLevel(v: number, max: number): number {
  const t = max > 0 ? v / max : 0;
  return t >= 0.8 ? 5 : t >= 0.55 ? 4 : t >= 0.3 ? 3 : t >= 0.08 ? 2 : 1;
}
/** 跳出率色阶：按绝对值，超过 50% 是最深一档并带图标（L6-V04）。 */
function bounceLevel(rate: number): number {
  return rate > BOUNCE_WARN ? 4 : rate >= 0.35 ? 3 : rate >= 0.22 ? 2 : 1;
}

/* ---------------- 四个合计（L6-V01） ---------------- */
export function SummaryBand({ summary, scope, device }: { summary: HeatSummary; scope: string; device: string }) {
  const noView = summary.totalPv === 0;
  const scopeNote = `${scope}；含这段时间有事件的已退役页面。`;
  return (
    <StatBand label="这段时间的合计">
      <Stat label="浏览次数" icon={Eye} tone="role-2" value={n(summary.totalPv)} unit="次"
        explain={`离开一页（换到下一页）时记一次浏览，同一页看两次算两次。${scopeNote}`} />
      <Stat label="点击次数" icon={MousePointerClick} tone="role-2" value={n(summary.totalClicks)} unit="次"
        sub={device === "APP" || device === "MP" ? "这一端还没记录点击" : noView ? "没有浏览，点击率算不出" : `点击率 ${pct(summary.totalClicks / summary.totalPv)}`}
        explain={`App 记下的点击次数，不是人数。点击率是点击次数 ÷ 浏览次数，可能超过 100%。${scopeNote}`} />
      <Stat label="平均停留" icon={Clock3} tone="role-3" value={noView ? "—" : dwell(summary.avgDwellMs)}
        sub={noView ? "没有浏览，算不出" : undefined} explain={DWELL_EXPLAIN} />
      <Stat label="平均跳出率" icon={LogOut} tone={!noView && summary.avgBounceRate > BOUNCE_WARN ? "warn" : "role-3"}
        value={noView ? "—" : pct(summary.avgBounceRate)} sub={noView ? "没有浏览，算不出" : "按浏览次数加权"} explain={BOUNCE_EXPLAIN} />
    </StatBand>
  );
}

/* ---------------- 两张榜：用得最多、跳出最高（首屏先回答） ---------------- */
function PageLink({ row, onPick }: { row: HeatRow; onPick: (key: string) => void }) {
  return (
    <button type="button" className="l6-page-link" onClick={() => onPick(row.key)} title={`看「${behaviorPageTitle(row)}」的点击位置`}>
      {behaviorPageTitle(row)}{row.pageCount > 1 ? <small>（一组 {row.pageCount} 页）</small> : null}
    </button>
  );
}

export function RankPanels({ rows, onPick, scope }: { rows: HeatRow[]; onPick: (key: string) => void; scope: string }) {
  const viewed = rows.filter((r) => r.pv > 0);
  const topPv = [...viewed].sort((a, b) => b.pv - a.pv).slice(0, 5);
  const topBounce = [...viewed].sort((a, b) => b.bounceRate - a.bounceRate).slice(0, 5);
  const over = viewed.filter((r) => r.bounceRate > BOUNCE_WARN).length;
  return (
    <div className="rd-split l6-ranks" data-even="">
      <Panel title="浏览最多的页面" icon={Flame} tone="role-2" sub={`${scope} · 前 ${topPv.length} 个`}
        explain="按浏览次数从多到少。点页面名，在下面看这一页的点击位置。">
        {topPv.length
          ? <BarList label="浏览最多的页面" slot={2} rows={topPv.map((r) => ({ key: r.key, label: <PageLink row={r} onPick={onPick} />, value: r.pv, text: <>{n(r.pv)} 次<small className="l6-bar-sub">{n(r.uv)} 人</small></> }))} />
          : <p className="rd-note">这段时间只有点击、没有浏览记录。</p>}
      </Panel>
      <Panel title="跳出率最高的页面" icon={LogOut} tone={over ? "warn" : "role-3"} sub={over ? `${over} 个超过 50%` : "都不超过 50%"}
        explain={BOUNCE_EXPLAIN}>
        {topBounce.length ? (
          <ul className="l6-bounce-list" aria-label="跳出率最高的页面">
            {topBounce.map((r) => {
              const warn = r.bounceRate > BOUNCE_WARN;
              return (
                <li key={r.key} data-warn={warn ? "" : undefined}>
                  <span className="l6-bounce-name"><PageLink row={r} onPick={onPick} /></span>
                  <ScaleBar compact quiet label={`${behaviorPageTitle(r)} 跳出率`} valueText={`跳出率 ${pct(r.bounceRate)}，预警线 50%`}
                    max={1} value={r.bounceRate} fill target={BOUNCE_WARN} tone={warn ? "warn" : "role-3"} />
                  <span className="l6-bounce-val">{warn && <TriangleAlert size={14} aria-label="超过 50%" />}{pct(r.bounceRate)}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="rd-note">这段时间只有点击、没有浏览记录，跳出率算不出。</p>}
      </Panel>
    </div>
  );
}

/* ---------------- 页面热力表（L6-V03、L6-V04、L6-Q04、L6-Q05） ---------------- */
function HeatLegend() {
  return (
    <div className="l6-legend" aria-label="颜色深浅的读法">
      <span className="l6-legend-group">
        <span>浏览、点击、停留：少</span>
        {[1, 2, 3, 4, 5].map((level) => <i key={level} className="l6-swatch" data-level={level} aria-hidden />)}
        <span>多</span>
        <Explain label="浏览、点击、停留的颜色" content="每一列和这一列最多的那一页比：到它的 80% 以上最深，30% 以下很浅。只比同一列，不同列之间不能比颜色。" />
      </span>
      <span className="l6-legend-group">
        <span>跳出率：低</span>
        {[1, 2, 3, 4].map((level) => <i key={level} className="l6-swatch" data-kind="bounce" data-level={level} aria-hidden />)}
        <span>超过 50%</span>
        <Explain label="跳出率的颜色" content="按跳出率本身分档：22% 以下、22%–35%、35%–50%、超过 50%。超过 50% 的格子带警示图标。" />
      </span>
    </div>
  );
}

function HeatCell({ level, kind, warn, empty, zero, children, title }: { level: number; kind?: "bounce"; warn?: boolean; empty?: boolean; zero?: boolean; children: ReactNode; title?: string }) {
  if (empty) return <span className="l6-heat" data-empty="" title={title}>—</span>;
  if (zero) return <span className="l6-heat" data-empty="">{children}</span>;
  return (
    <span className="l6-heat" data-level={level} data-kind={kind} title={title}>
      {warn && <TriangleAlert size={13} aria-label="超过 50%" />}
      {children}
    </span>
  );
}

export function HeatTable({ rows, activeKey, onPick, sort, sortDir, onSort, onFlip, busy, depthLabel }: {
  rows: HeatRow[];
  activeKey: string | null;
  onPick: (key: string) => void;
  sort: SortKey;
  sortDir: "desc" | "asc";
  onSort: (key: SortKey) => void;
  onFlip: () => void;
  busy: boolean;
  depthLabel: string;
}) {
  const maxPv = Math.max(1, ...rows.map((r) => r.pv));
  const maxUv = Math.max(1, ...rows.map((r) => r.uv));
  const maxClicks = Math.max(1, ...rows.map((r) => r.clicks));
  const maxDwell = Math.max(1, ...rows.map((r) => r.dwellMs));
  const levelName = (r: HeatRow) => (r.level === 1 ? "一级" : r.level === 2 ? "二级" : "三级");
  return (
    <Panel title="页面热力表" icon={LayoutGrid} tone="role-2" sub={`${n(rows.length)} 行 · ${depthLabel}`}
      explain={<>
        <p>一行一个页面（按一级、二级汇总时一行一组页面），颜色越深表示这一列里越多；数字照写，不只看颜色。</p>
        <p>只列当前页面目录里的页面，不分页。跳出率超过 50% 的格子带警示图标。</p>
        <p>横着看一页：浏览多、停留短、跳出高，说明进来的人多但留不住；竖着看一列，找最热和最冷的页面。</p>
        <p>点一行，在右边看这一页的点击位置。</p>
      </>}>
      <div className="l6-tools">
        <span className="l6-sort">
          <Segments<SortKey> label="排序" value={sort}
            items={SORTS.map((s) => ({ value: s.v, label: s.v === sort ? `${s.lb}${sortDir === "desc" ? " ↓" : " ↑"}` : s.lb }))}
            onChange={onSort} />
          <Button size="sm" variant="ghost" onClick={onFlip}
            icon={sortDir === "desc" ? <ArrowDownWideNarrow size={14} aria-hidden /> : <ArrowUpNarrowWide size={14} aria-hidden />}>
            {sortDir === "desc" ? "从多到少" : "从少到多"}
          </Button>
        </span>
        <HeatLegend />
      </div>
      <div className="l6-table-wrap" aria-busy={busy || undefined} data-busy={busy ? "" : undefined}>
        <Table label="页面热力表" rowFocus className="l6-table">
          <thead><tr>
            <Th>页面</Th>
            <Th align="right">浏览次数</Th>
            <Th align="right">浏览人数</Th>
            <Th align="right">点击次数</Th>
            <Th align="right">平均停留</Th>
            <Th align="right">跳出率</Th>
          </tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => {
              const noView = r.pv === 0;
              return (
                <Tr key={r.key} selected={r.key === activeKey} onOpen={() => onPick(r.key)}>
                  <Td>
                    <Cell main={behaviorPageTitle(r)} title={r.key}
                      sub={<>{levelName(r)}{r.pageCount > 1 ? ` · 一组 ${r.pageCount} 页` : ""} · <span className="l6-route">{r.key.replace(/^\/?pages\//, "")}</span></>} />
                  </Td>
                  <Td align="right"><HeatCell level={activityLevel(r.pv, maxPv)} zero={r.pv === 0}>{n(r.pv)}</HeatCell></Td>
                  <Td align="right"><HeatCell level={activityLevel(r.uv, maxUv)} zero={r.uv === 0}>{n(r.uv)}</HeatCell></Td>
                  <Td align="right"><HeatCell level={activityLevel(r.clicks, maxClicks)} zero={r.clicks === 0}>{n(r.clicks)}</HeatCell></Td>
                  <Td align="right"><HeatCell level={activityLevel(r.dwellMs, maxDwell)} empty={noView} title={noView ? "没有浏览，算不出" : undefined}>{dwell(r.dwellMs)}</HeatCell></Td>
                  <Td align="right"><HeatCell kind="bounce" level={bounceLevel(r.bounceRate)} warn={r.bounceRate > BOUNCE_WARN} empty={noView} title={noView ? "没有浏览，算不出" : undefined}>{pct(r.bounceRate)}</HeatCell></Td>
                </Tr>
              );
            }) : <TableMessage columns={6}>这组条件下没有页面浏览和点击。换一个时间范围、设备或语言再看。</TableMessage>}
          </tbody>
        </Table>
      </div>
    </Panel>
  );
}

/* ---------------- 单页点击位置（L6-V05、L6-S06、L6-X06） ---------------- */
export function ClickPanel({ gradId, row, heat, aggregate, loaded, failed, scope, device, onRetry }: {
  gradId: string;
  row: HeatRow;
  heat: PageClickHeat;
  aggregate: boolean;
  loaded: boolean;
  failed: boolean;
  scope: string;
  device: string;
  onRetry: () => void;
}) {
  const name = behaviorPageTitle(row);
  const zones = [...heat.zones].sort((a, b) => b.share - a.share);
  const small = row.clicks < SMALL_SAMPLE;
  const noCoords = loaded && !heat.points.length && !heat.zones.length;
  const nativeNote = device === "APP" || device === "MP"
    ? "选了原生应用或小程序：这两端还不记录点击，所以多半没有点击位置。"
    : "目前只有移动网页记录点击位置，原生应用和小程序还没有。";
  const body = aggregate ? (
    <Notice tone="progress" title="按一级、二级汇总时没有点击位置">
      {row.pageCount > 1 ? `「${name}」这一行合并了 ${row.pageCount} 个有事件的页面。` : `「${name}」这一行代表这一组页面。`}点击位置只按单个页面统计，不同页面叠在一起没有意义。把「页面层级」换成「全部页面」或「三级」，再点具体页面。
    </Notice>
  ) : failed ? (
    <BlockState state="error" title="这一页的点击位置读取失败" detail="页面热力表照常；不能据此认为这一页没有点击。" onRetry={onRetry} retryLabel="重新加载" />
  ) : !loaded ? (
    <BlockState state="loading" title="正在读取这一页的点击位置…" />
  ) : noCoords ? (
    <BlockState state="empty" title={row.clicks ? "这段时间没有记录到点击位置" : "这段时间这一页没有点击"}
      detail={row.clicks ? <>这一页有 {n(row.clicks)} 次点击记录，但没有带位置的点击。{nativeNote}</> : <>只有浏览，没有点击记录。{nativeNote}</>} />
  ) : (
    <div className="l6-drill">
      <figure className="l6-phone">
        <PhoneBoard gradId={gradId} points={small ? [] : heat.points} small={small} clicks={row.clicks} />
        <figcaption>{small ? `只有 ${n(row.clicks)} 次点击，样本太少，不画分布` : "只含移动网页的点击；颜色越亮点得越多，不是页面截图"}</figcaption>
      </figure>
      <div className="l6-zones">
        <div className="l6-zones-head">
          <span>点击区域占比</span>
          <Explain label="区域怎么分" content={<>
            <p>按这一页的点击次数算占比，不是人数。</p>
            <p>屏幕最上面 1/4 是页面顶部，最下面 1/4 是页面底部，其余是中间内容；App 标成主按钮的点击单独算「主按钮」。</p>
          </>} />
        </div>
        {zones.length ? (
          <BarList label="点击区域占比" slot={2} max={1} rows={zones.map((z, i) => ({
            key: z.label,
            label: zoneName(z.label),
            value: z.share,
            text: <span className="l6-zone-val">{Math.round(z.share * 100)}%{i === 0 && !small && <StatusTag tone="progress">最多</StatusTag>}</span>,
          }))} />
        ) : <p className="rd-note">没有区域记录。</p>}
        {small && <p className="rd-note">点击少，占比容易大起大落，换成近 30 天或全部设备再看。</p>}
      </div>
    </div>
  );
  return (
    <Panel id="l6-drill" className="l6-drill-panel" title="点击位置" icon={Smartphone} tone="role-2"
      sub={<span className="l6-drill-sub"><b>{name}</b> · {scope}{aggregate ? "" : ` · ${n(row.clicks)} 次点击`}</span>}
      explain={<>
        <p>位置是点击时手指在屏幕上的位置，按屏幕宽高的百分比合并，不是页面滚动后的位置。</p>
        <p>不同尺寸的手机叠在一起，只能看大概的区域，对不到具体按钮。颜色按点击次数，不是人数。</p>
        <p>少于 {SMALL_SAMPLE} 次点击不画分布，区域占比照列；{SMALL_SAMPLE} 次是这页定的门槛。</p>
        <p>{nativeNote}</p>
      </>}>
      {body}
    </Panel>
  );
}

function PhoneBoard({ gradId, points, small, clicks }: { gradId: string; points: { x: number; y: number; weight: number }[]; small: boolean; clicks: number }) {
  const W = 200;
  const H = 400;
  const PAD = 12;
  const sx = (x: number) => PAD + x * (W - PAD * 2);
  const sy = (y: number) => PAD + y * (H - PAD * 2);
  return (
    <svg className="l6-phone-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="单页点击坐标热力" data-small={small ? "" : undefined}>
      <title>{small ? `只有 ${clicks} 次点击，样本太少，不画分布` : `点击位置分布，共 ${points.length} 个位置`}</title>
      <defs>
        <radialGradient id={gradId}>
          <stop offset="0%" className="l6-blob-core" />
          <stop offset="55%" className="l6-blob-mid" />
          <stop offset="100%" className="l6-blob-edge" />
        </radialGradient>
      </defs>
      <rect className="l6-phone-body" x={2} y={2} width={W - 4} height={H - 4} rx={22} />
      <rect className="l6-phone-screen" x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} rx={12} />
      <line className="l6-phone-split" x1={PAD} x2={W - PAD} y1={sy(0.25)} y2={sy(0.25)} />
      <line className="l6-phone-split" x1={PAD} x2={W - PAD} y1={sy(0.75)} y2={sy(0.75)} />
      <text className="l6-phone-label" x={PAD + 6} y={sy(0.25) - 6}>顶部</text>
      <text className="l6-phone-label" x={PAD + 6} y={sy(0.25) + 14}>中间内容</text>
      <text className="l6-phone-label" x={PAD + 6} y={sy(0.75) + 14}>底部</text>
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={9 + p.weight * 15} fill={`url(#${gradId})`} opacity={0.3 + p.weight * 0.6} />
      ))}
    </svg>
  );
}

/* ---------------- 访问趋势（L6-V02、L6-C02） ---------------- */
type TrendPoint = { bucket: string; pv: number; clicks: number };
function TrendChart({ label, values, tick }: { label: string; values: TrendPoint[]; tick: (bucket: string) => string }) {
  const last = values.slice(-8);
  return (
    <div className="l6-trend">
      <h3 className="l6-trend-title">{label}</h3>
      {last.length
        ? <ColumnChart label={`${label}的浏览次数和点击次数`} format={(v) => `${n(v)} 次`} axisFormat={(v) => (Number.isInteger(v) ? n(v) : v.toFixed(1))}
          series={[{ label: "浏览次数", slot: 2 }, { label: "点击次数", slot: 3 }]}
          data={last.map((p) => ({ key: p.bucket, tick: tick(p.bucket), values: [p.pv, p.clicks], detail: <span>{p.bucket}</span> }))} />
        : <p className="rd-note">当前筛选暂无事件</p>}
    </div>
  );
}

export function TrendPanel({ daily, weekly, scope, zone }: { daily: TrendPoint[]; weekly: TrendPoint[]; scope: string; zone: string }) {
  return (
    <Panel title="访问趋势" icon={TrendingUp} tone="role-2" sub={`${scope} · 最近 8 个有事件的日、周`}
      explain={<>
        <p>按日、按周都按业务日期（{zone}）切，周从周一开始。时间范围是滚动的，第一段和最后一段可能不满一天或一周。</p>
        <p>只列有事件的日、周，没有事件的不补 0。跟时间范围、设备、语言走，不跟页面层级，所以和热力表加起来不一定相等。</p>
      </>}>
      <div className="rd-split l6-trends" data-even="">
        <TrendChart label="按日" values={daily} tick={(b) => b.slice(5)} />
        <TrendChart label="按周" values={weekly} tick={(b) => b.replace(/^\d{4}-/, "")} />
      </div>
    </Panel>
  );
}

/* ---------------- 统计范围和口径（L6-V06、L6-V08、L6-C04、L6-X03–X05） ---------------- */
export function ScopeFold({ data }: { data: L6BehaviorHeatmapData }) {
  return (
    <Fold title="统计范围和口径" summary={`页面目录 ${n(data.trackedCount)} 个页面 · 时区 ${data.businessTimeZone} · 只读`}>
      <Facts>
        <Fact k="统计哪些页面">页面目录里的 {n(data.trackedCount)} 个页面都在统计<Explain label="页面目录" content="页面目录是从 App 的页面清单复制到后台的一份，不随 App 实时更新。已退役的页面不在目录里：热力表不列，但合计和导出的 CSV 还会算它们这段时间的历史事件。" /></Fact>
        <Fact k="事件从哪来">App 记下的页面浏览和元素点击，只算正式环境的事件</Fact>
        <Fact k="什么时候记浏览">离开这一页、换到下一页时记一次浏览和停留<Explain label="哪些不记" content="切到后台、退出 App 时正在看的那一页会丢掉，不补记；所以浏览次数不是「进入页面」的次数。" /></Fact>
        <Fact k="抽样">只算抽样记下的事件，不按比例放大<Explain label="抽样是什么" content="记录时按「用户行为事件」页的采集比例抽样，没抽中的不进统计；发送失败或被限流的也不在里面，所以不是全部真实操作。" /></Fact>
        <Fact k="设备和语言">只按 App 记下的标记筛；目前只有移动网页记录点击位置</Fact>
        <Fact k="时间">从读取那一刻往前滚动；时区 {data.businessTimeZone}</Fact>
        <Fact k="这页能做什么">只能查看和导出，不改页面目录、采集设置和任何业务规则；每次导出留一条操作记录</Fact>
      </Facts>
    </Fold>
  );
}
