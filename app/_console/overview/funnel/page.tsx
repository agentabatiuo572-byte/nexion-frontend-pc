"use client";

/**
 * B3 用户转化概览。先答「这批用户转化得怎么样、卡在哪一步」：结论句点出转化率最低的一步，
 * 主视觉是宽度和人数成比例的四步漏斗，相邻两步之间写转化率和掉了多少人；
 * 再看四个辅助指标、近 8 天每日首购、首购渠道和按注册周的走势。
 * 读取、筛选、步骤切换、导出的请求和权限判断沿用改版前的写法，只换界面。
 * 「保存为视图」和「已保存视图」数量按已批复的 S33 去掉（保存了没有任何使用入口）。
 */
import "./funnel.css";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarCheck, CalendarDays, Download, Filter, Megaphone, RefreshCw, ShoppingCart, Store, TrendingDown, TrendingUp, Users, Zap } from "lucide-react";
import {
  BarList, BlockState, Button, Cell, Conclusion, Explain, FilterBar, FilterField, Fold, Notice, PageHeader, Panel, RdPage,
  Segments, Select, Stat, StatBand, StatusTag, Table, Td, Th, Tr, TrendLines,
} from "@/app/components/rd";
import { useToast } from "@/app/components/domain-views/design-kit";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { exportB3Cohort, SMALL_SAMPLE_LABEL, useB3Funnel, type B3Dashboard, type B3Filters, type B3Stage } from "@/lib/admin/b3-client";
import { formatB3RefOption, normalizeB3RefOptions } from "@/lib/admin/b3-ref-display";
import { businessZone } from "@/lib/admin/business-time";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";

const ALL = "ALL";

/** 后端给的已是百分数、一位小数；没有分母时是 null，写「暂无法计算」，不写 0。 */
function pct(value: number | null) {
  return value == null ? "暂无法计算" : `${value.toFixed(1)}%`;
}
const people = (value: number) => value.toLocaleString("en-US");

const isAll = (value: string | undefined) => !value || value.toUpperCase() === ALL;
const phaseName = (value: string) => (value === "SYSTEM" ? "系统默认" : value);
/** 每块图现在按什么范围算：数据里回来的筛选，和图上的数是同一次读取。 */
function scopeText(filters: B3Filters, withCohort: boolean) {
  return [
    withCohort ? (isAll(filters.cohort) ? "全部注册批次" : `${filters.cohort} 批次`) : null,
    isAll(filters.phase) ? "全部阶段" : `阶段 ${phaseName(filters.phase)}`,
    isAll(filters.ref) ? "全部渠道" : formatB3RefOption(filters.ref),
  ].filter(Boolean).join(" · ");
}

const PROTECT_NOTE = "少于 5 人的分组不显示人数和比例，0 人也算，防止从小分组推出具体用户。";
const caliberNote = () => (
  <>
    <p>同一批用户按时间先后走四步：注册 → 首购 → 锁定计划 → 提现，后一步必须晚于前一步，同一时刻不算。</p>
    <p>首购：这次注册之后最早的一笔购买。锁定计划：首购之后第一次锁定计划，或第二次购买（二次购机也算）。提现：提交了提现申请，不代表已经到账。</p>
    <p>同一人只算一次。转化率 = 这一步人数 ÷ 上一步人数。日期按平台业务日（{businessZone().label}）算，不按你电脑的时区。</p>
    <p>{PROTECT_NOTE}</p>
  </>
);

/** 后三步里「从上一步转化」最低的一步（改版前的算法）；不是掉人最多的一步。 */
function lowestStep(stages: readonly B3Stage[]) {
  return stages.slice(1).reduce<B3Stage | null>((worst, item) => {
    if (item.cvrFromPrev == null) return worst;
    return !worst || (worst.cvrFromPrev ?? 101) > item.cvrFromPrev ? item : worst;
  }, null);
}

function Funnel({ stages, lowest }: { stages: readonly B3Stage[]; lowest: B3Stage | null }) {
  const base = stages[0]?.distinctUsers ?? null;
  return (
    <ol className="b3-funnel" aria-label="四步转化漏斗">
      {stages.map((item, index) => {
        const width = base && item.distinctUsers != null ? Math.max((item.distinctUsers / base) * 100, 0.5) : null;
        const dropped = item.previousUsers != null && item.distinctUsers != null ? item.previousUsers - item.distinctUsers : null;
        const isLowest = lowest?.key === item.key;
        // 条宽是运行时的人数比例，只能写在元素上。
        const barStyle = width == null ? undefined : { width: `${width}%` };
        return (
          <li key={item.key} className="b3-funnel-item">
            {index > 0 && (
              <div className="b3-funnel-gap" data-tone={isLowest ? "warn" : undefined}>
                <span className="b3-funnel-gap-mid">
                <span className="b3-funnel-gap-text">
                  {item.suppressed
                    ? "样本过小，转化率不显示"
                    : <>转化 <b>{pct(item.cvrFromPrev)}</b>{dropped != null && <> · 掉了 {people(dropped)} 人</>}</>}
                </span>
                {isLowest && <StatusTag tone="warn" icon={TrendingDown}>转化率最低</StatusTag>}
                </span>
              </div>
            )}
            <div className="b3-funnel-step">
              <span className="b3-funnel-name">
                <span className="b3-funnel-index" aria-hidden>{index + 1}</span>
                <span><b>{item.stage}</b></span>
              </span>
              <span className="b3-funnel-track">
                {width != null
                  ? <span className="b3-funnel-bar" data-lowest={isLowest ? "" : undefined} style={barStyle} aria-hidden />
                  : <span className="b3-funnel-protected">{SMALL_SAMPLE_LABEL}：少于 5 人不显示</span>}
              </span>
              <span className="b3-funnel-value" data-empty={item.distinctUsers == null ? "" : undefined}>
                {item.distinctUsers == null ? "—" : <>{people(item.distinctUsers)}<small>人</small></>}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StageTable({ stages }: { stages: readonly B3Stage[] }) {
  return (
    <Table label="各步骤转化数据" className="b3-stage-table">
      <thead>
        <tr>
          <Th>步骤</Th><Th>用户阶段<Explain label="用户阶段的说明" content="系统给用户分的阶段（L1–L5），和运营阶段 P1–P6 不是一回事。" /></Th><Th align="right">用户数</Th><Th align="right">上一步人数</Th><Th align="right">转化率</Th>
          <Th align="right">与上月比较<Explain label="与上月比较的说明" content="系统目前不计算月比较，这一列都是「—」。看变化请用下面「按注册周看转化走势」。" /></Th>
          <Th>对应事件</Th>
        </tr>
      </thead>
      <tbody>
        {stages.map((item) => (
          <Tr key={item.key}>
            <Td><Cell main={item.stage} /></Td>
            <Td><Cell main={item.lifecycleLabel} /></Td>
            {item.suppressed ? (
              <Td colSpan={4} align="right"><Cell main={`${SMALL_SAMPLE_LABEL}，不显示`} /></Td>
            ) : (
              <>
                <Td align="right"><Cell num main={item.distinctUsers == null ? "—" : people(item.distinctUsers)} /></Td>
                <Td align="right"><Cell num main={item.previousUsers == null ? "—" : people(item.previousUsers)} /></Td>
                <Td align="right"><Cell num main={item.key === "register" ? "—" : pct(item.cvrFromPrev)} /></Td>
                <Td align="right"><Cell num main={item.momDelta == null ? "—" : pct(item.momDelta)} /></Td>
              </>
            )}
            <Td grow><Cell mono title={item.event} main={item.event} /></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

function AuxStats({ aux }: { aux: B3Dashboard["auxMetrics"] }) {
  const hidden = (key: string) => aux.suppressedMetrics?.includes(key) ?? false;
  const value = (key: string, rate: number | null) => (hidden(key) ? SMALL_SAMPLE_LABEL : pct(rate));
  const frac = (key: string, top: number | null, bottom: number | null) =>
    hidden(key) ? "少于 5 人，不显示" : `${top == null ? "—" : people(top)} ÷ ${bottom == null ? "—" : people(bottom)} 人`;
  // 分式和目标各自不拆行，放不下时整段换到下一行，不留孤字。
  const withTarget = (text: string, target: number) => <><span className="b3-nowrap">{text}</span> · <span className="b3-nowrap">目标 {target}%</span></>;
  return (
    <StatBand label="注册后的关键行为">
      <Stat tone="role-3" icon={Store} label="注册后浏览商城" value={value("storeViewRate", aux.storeViewRate)}
        sub={frac("storeViewRate", aux.storeViewNumerator, aux.storeViewDenominator)}
        explain={<><p>注册之后看过商城的人 ÷ 注册人数，按人算，不是访问次数。</p><p>看它能判断：新用户有没有找到商城入口。偏低先查注册后的引导。</p></>} />
      <Stat tone="role-3" icon={ShoppingCart} label="浏览商城后首购" value={value("purchaseFromStoreRate", aux.purchaseFromStoreRate)}
        sub={frac("purchaseFromStoreRate", aux.purchaseFromStoreNumerator, aux.purchaseFromStoreDenominator)}
        explain={<><p>注册后看过商城、之后又购买的人 ÷ 注册后看过商城的人。这一单不一定是首购，先买过、再看商城又买的也算。</p><p>看它能判断：进了商城的人买不买。偏低先看商品和价格。主漏斗的首购不要求先看商城，所以两个人数可能不同。</p></>} />
      <Stat tone="role-3" icon={Zap} label={`首笔收益到账（${aux.day0WindowSeconds} 秒内）`} value={value("day0AccessRate", aux.day0AccessRate)}
        sub={hidden("day0AccessRate") ? "少于 5 人，不显示" : withTarget(frac("day0AccessRate", aux.day0Numerator, aux.day0Denominator), aux.day0Target)}
        explain={<><p>注册后首笔收益在 {aux.day0WindowSeconds} 秒内到账的人 ÷ 注册人数。用时看收益记录上记的数，不拿收益时间减注册时间，也不按「注册当天」算；时限在「用户行为事件」里设置。</p><p>看它能判断：新用户是不是很快看到收益。目标只用来对照，不会拦截任何操作。</p></>} />
      <Stat tone="role-3" icon={CalendarCheck} label="第 7 天仍活跃" value={value("day7Retention", aux.day7Retention)}
        sub={hidden("day7Retention") ? (aux.day7Mature ? "少于 5 人，不显示" : "还没有注册满 7 天的用户") : withTarget(frac("day7Retention", aux.day7Numerator, aux.day7Denominator), aux.day7Target)}
        explain={<><p>只算注册满 7 天的人：注册后第 7 天当天打开过 App 的人 ÷ 注册满 7 天的人。不是第 7 天以后任意一天活跃。</p><p>看它能判断：用户第一周之后还留不留下。</p></>} />
    </StatBand>
  );
}

function DailyPanel({ data }: { data: B3Dashboard }) {
  const daily = data.dailyFirstPurchase;
  const target = data.dailyFirstPurchaseTargetPct;
  const hiddenDays = daily.filter((row) => row.suppressed).map((row) => row.date.slice(5));
  const latest = [...daily].reverse().find((row) => !row.suppressed && row.conversionPct != null);
  const values = daily.map((row) => row.conversionPct);
  // 没有相邻两天都有数时连不成线，只剩几个孤点看不清，改成一句话列出有数的那几天。
  const linked = values.some((value, index) => value != null && values[index + 1] != null);
  const shown = daily.filter((row) => row.conversionPct != null);
  return (
    <Panel data-testid="b5-daily-first-purchase-conversion" title="每日首购转化" icon={CalendarDays} tone="role-3"
      sub={`近 8 天 · 目标 ${target}%`}
      explain={<><p>当天注册的人里，当天就完成首购的比例，按平台业务日算。注册批次、阶段、渠道三个筛选都生效。</p><p>看它能判断：最近几天新注册的人是不是当天就买。连续低于目标线，先查注册当天的引导和活动。</p></>}>
      {hiddenDays.length === daily.length ? (
        <BlockState state="empty" title="近 8 天每天注册或首购都少于 5 人，不显示" />
      ) : (
        <div className="rd-stack">
          {linked ? (
            <TrendLines label={`近 8 天每日首购转化和 ${target}% 目标线`} ticks={daily.map((row) => row.date.slice(5))} format={pct}
              axisFormat={(v) => `${Number(v.toFixed(1))}%`} height={140}
              series={[{ key: "daily", label: "每日首购转化", slot: 3, values }]}
              marks={[{ key: "target", text: `目标 ${target}%`, value: target, tone: "ok" }]} />
          ) : (
            <ul className="b3-daily-list" aria-label="有数的日子">
              {shown.map((row) => (
                <li key={row.date}><span>{row.date.slice(5)}</span><b>{pct(row.conversionPct)}</b><small>{people(row.firstPurchaseUsers ?? 0)} ÷ {people(row.registeredUsers ?? 0)} 人</small></li>
              ))}
            </ul>
          )}
          {linked && latest && <p className="rd-note">最近一天（{latest.date.slice(5)}）：注册 {people(latest.registeredUsers ?? 0)} 人，当天首购 {people(latest.firstPurchaseUsers ?? 0)} 人，{pct(latest.conversionPct)}</p>}
          {hiddenDays.length > 0 && <p className="rd-note">{hiddenDays.join("、")} 人数少于 5，不显示{linked ? "，图上断开" : ""}</p>}
        </div>
      )}
    </Panel>
  );
}

function ChannelPanel({ data }: { data: B3Dashboard }) {
  const channels = data.purchaseChannels;
  const partial = channels.some((row) => row.suppressed);
  return (
    <Panel data-testid="b7-first-purchase-channel-share" title="首购用户从哪来" icon={Megaphone} tone="role-3"
      sub={channels.length ? `${channels.length} 个渠道 · 按注册时的渠道` : "按注册时的渠道"}
      explain={<><p>首购用户按注册时带的推荐码或渠道分组，占比 = 这个渠道的首购人数 ÷ 全部首购人数。不是付款方式。</p><p>看它能判断：首购用户主要是哪几个渠道带来的。它不比较各渠道的转化率，要比转化请在上面筛一个渠道看漏斗。</p></>}>
      {channels.length === 0 ? (
        <BlockState state="empty" title="当前条件下没有首购用户" />
      ) : (
        <div className="rd-stack">
          <div className="b3-channels"><BarList label="首购渠道占比" slot={3} max={100} rows={channels.map((row) => ({
            key: row.channel,
            label: <span title={formatB3RefOption(row.channel)}>{formatB3RefOption(row.channel)}</span>,
            value: row.suppressed ? null : row.sharePct,
            text: row.suppressed || row.sharePct == null ? SMALL_SAMPLE_LABEL : `${row.sharePct.toFixed(1)}% · ${people(row.firstPurchaseUsers ?? 0)} 人`,
          }))} /></div>
          {partial && <p className="rd-note">{channels.every((row) => row.suppressed) ? "每个渠道的首购都少于 5 人，不显示" : "少于 5 人的渠道不显示；其余占比仍按全部首购人数算，没有重新分配"}</p>}
        </div>
      )}
    </Panel>
  );
}

function TrendPanel({ data, stage, onStage }: { data: B3Dashboard; stage: string; onStage: (key: string) => void }) {
  const selected = data.stages.find((item) => item.key === stage) ?? data.stages[0];
  const trend = data.trend;
  const counting = selected?.key === "register";
  const cohort = isAll(data.filters.cohort) ? null : data.filters.cohort;
  const cohortIndex = cohort ? trend.findIndex((point) => point.cohort === cohort) : -1;
  const values = trend.map((point) => (counting ? point.distinctUsers : point.cvrFromPrev));
  const drawable = values.filter((value) => value != null).length;
  const weeks = trend.map((point) => point.cohort.replace(/^\d{4}-/, ""));
  const caliber = (
    <span className="rd-toolbar-note b3-caliber" data-tone={cohort ? "warn" : undefined}>
      {cohort ? `不受注册批次影响：你选了 ${cohort}，这张图仍比较各周` : "不受注册批次影响，只按阶段和渠道比较各周"}
    </span>
  );
  return (
    <Panel data-testid="b3-cohort-trend-chart" title="按注册周看转化走势" icon={TrendingUp} tone="role-3"
      sub={trend.length ? `最近 ${trend.length} 个有注册的周 · ${scopeText(data.filters, false)}` : scopeText(data.filters, false)}
      explain={<><p>每个注册周的用户各自按同样的四步算，这里画所选那一步的「从上一步转化」；选「注册」时画每周注册人数。</p><p>只按阶段和渠道筛，不受注册批次影响；只列有注册的周，没注册的周不补，所以不一定是连续的 13 周。</p><p>看它能判断：同一步的转化最近几周在变好还是变坏。</p></>}>
      <div className="rd-stack">
        {data.stages.length > 0 && (
          <div className="rd-toolbar">
            <Segments label="看哪一步的走势" value={selected?.key ?? stage} onChange={onStage}
              items={data.stages.map((item) => ({ value: item.key, label: item.stage }))} />
            {caliber}
          </div>
        )}
        {data.stages.length === 0 && caliber}
        {trend.length === 0 ? (
          <div data-testid="b3-cohort-trend-empty"><BlockState state="empty" title="当前筛选下没有可比较的数据，暂无法显示趋势" /></div>
        ) : drawable === 0 ? (
          <BlockState state="empty" title={counting ? "每周注册人数都少于 5，不显示" : `各周「${selected?.stage}」都少于 5 人，转化率不显示`} />
        ) : (
          <TrendLines label={counting ? "按注册周的注册人数" : `按注册周的「${selected?.stage}」转化率`} ticks={weeks}
            format={counting ? (v) => `${people(v)} 人` : pct}
            axisFormat={counting ? (v) => people(Math.round(v)) : (v) => `${Number(v.toFixed(1))}%`} height={150}
            series={[{ key: "trend", label: counting ? "注册人数" : "转化率", slot: 3, values }]}
            event={cohortIndex >= 0 ? { index: cohortIndex, text: "所选批次" } : undefined} />
        )}
        {trend.length > 0 && (
          <Fold inset title="逐周数字" summary={`${trend.length} 周${trend.some((point) => point.suppressed) ? ` · ${trend.filter((point) => point.suppressed).length} 周样本过小` : ""}`}>
            <Table label="按注册周的转化数字" className="b3-week-table">
              <thead><tr><Th>注册周</Th><Th align="right">{selected?.stage ?? "这一步"}人数</Th><Th align="right">从上一步转化</Th></tr></thead>
              <tbody>
                {[...trend].reverse().map((point) => (
                  <Tr key={point.cohort} mark={point.cohort === cohort ? "hit" : undefined}>
                    <Td><Cell main={point.cohort} /></Td>
                    {point.suppressed
                      ? <Td colSpan={2} align="right"><Cell main={`${SMALL_SAMPLE_LABEL}，不显示`} /></Td>
                      : <>
                        <Td align="right"><Cell num main={point.distinctUsers == null ? "—" : people(point.distinctUsers)} /></Td>
                        <Td align="right"><Cell num main={counting ? "—" : pct(point.cvrFromPrev)} /></Td>
                      </>}
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Fold>
        )}
      </div>
    </Panel>
  );
}

export default function FunnelPage() {
  const [filters, setFilters] = useState<B3Filters>({ cohort: ALL, phase: ALL, ref: ALL });
  const [stage, setStage] = useState("purchase");
  const [urlReady, setUrlReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [, setToast] = useToast();
  const auth = useAdminAuth((state) => state.session);
  const { data, loading, error, reload } = useB3Funnel(filters, stage, urlReady);
  const authorities = auth?.authorities ?? [];
  const superAdmin = auth?.role === "superadmin";
  const canExport = superAdmin || authorities.includes("overview_b3_export");
  const canCross = useReach();

  useEffect(() => {
    const readUrl = () => {
      const params = new URLSearchParams(window.location.search);
      setFilters({ cohort: params.get("cohort") || ALL, phase: params.get("phase")?.toUpperCase() || ALL, ref: params.get("ref") || ALL });
      setStage(params.get("stage")?.toLowerCase() || "purchase");
      setUrlReady(true);
    };
    readUrl();
    window.addEventListener("popstate", readUrl);
    return () => window.removeEventListener("popstate", readUrl);
  }, []);

  useEffect(() => {
    if (!urlReady) return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({ ...filters, stage })) {
      if (isAll(value) || key === "stage" && value === "purchase") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [filters, stage, urlReady]);

  const options = data?.filterOptions ?? { cohorts: [], phases: [], refs: [] };
  const lowest = useMemo(() => (data ? lowestStep(data.stages) : null), [data]);

  async function exportCohort() {
    setExporting(true);
    setExportError("");
    try {
      const file = await exportB3Cohort(filters);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setToast("已开始下载 CSV：四个步骤的汇总数，不含用户个人信息", "success");
    } catch (value) {
      setExportError(value instanceof Error ? displayAdminReadError(value) : "导出失败，请重试。");
    } finally {
      setExporting(false);
    }
  }

  const setFilter = (key: keyof B3Filters) => (value: string) => {
    setExportError("");
    setFilters((current) => ({ ...current, [key]: value || ALL }));
  };
  const filtered = !isAll(filters.cohort) || !isAll(filters.phase) || !isAll(filters.ref);

  const exportBlocked = !data ? (error ? "读取失败，重新读取后再导出" : "正在加载，读完再导出") : !data.available || !data.stages.length ? "当前条件下算不出转化，没有可导出的数据" : undefined;
  const headerActions = canExport ? (
    <span className="b3-pair" data-pair="">
      <Explain label="导出 CSV 的内容" content={<><p>导出当前注册批次、阶段、渠道下四个步骤的人数、上一步人数和转化率，每步一行，不含用户明细。</p><p>和下面「看哪一步的走势」选哪一步无关。少于 5 人的格子留空，并标「样本过小」。导出会记入操作记录。</p></>} />
      <Button icon={<Download size={14} aria-hidden />} loading={exporting} disabledReason={exporting ? undefined : exportBlocked} onClick={() => void exportCohort()}>导出 CSV</Button>
    </span>
  ) : undefined;

  const header = (
    <PageHeader pageId="B3" title="用户转化概览" summary="看同一批用户从注册走到提现，每一步剩多少人。"
      actions={headerActions}
      readOnly={canExport ? undefined : "你只能查看；导出 CSV 需要导出权限。"} />
  );

  const filterBar = (
    <FilterBar
      action={<Button icon={<RefreshCw size={14} aria-hidden />} loading={loading && !!data} disabled={loading} onClick={() => void reload()}>刷新</Button>}
      onClear={() => { setExportError(""); setFilters({ cohort: ALL, phase: ALL, ref: ALL }); }}
      canClear={filtered}
      sort={<span className="rd-filter-result">不自动刷新<Explain label="读取方式说明" content="改筛选或换走势的步骤会立即重新读取，读取时先显示上一次的结果。查看会尽量记一条操作记录，记不上也照常显示。" /></span>}>
      <FilterField label="注册批次">
        <Select aria-label="注册批次" value={isAll(filters.cohort) ? "" : filters.cohort} onChange={setFilter("cohort")}
          options={[{ value: "", label: "全部批次" }, ...options.cohorts.map((value) => ({ value, label: value === "SYSTEM" ? "系统默认" : value }))]} />
      </FilterField>
      <FilterField label="运营阶段">
        <Select aria-label="运营阶段" value={isAll(filters.phase) ? "" : filters.phase} onChange={setFilter("phase")}
          options={[
            { value: "", label: "全部阶段" },
            ...(/^P[1-6]$/.test(filters.phase) && !options.phases.includes(filters.phase) ? [{ value: filters.phase, label: filters.phase }] : []),
            ...options.phases.map((value) => ({ value, label: phaseName(value) })),
          ]} />
      </FilterField>
      <FilterField label="推荐码 / 渠道">
        <Select aria-label="推荐码 / 渠道" value={isAll(filters.ref) ? "" : filters.ref} onChange={setFilter("ref")}
          options={[{ value: "", label: "全部渠道" }, ...normalizeB3RefOptions(options.refs)]} />
      </FilterField>
    </FilterBar>
  );

  const exportNotice = exportError && (
    <Notice tone="danger" title="导出没有成功" action={<Button size="sm" loading={exporting} onClick={() => void exportCohort()}>重新导出</Button>}>
      {/[。！？.!?]$/.test(exportError) ? exportError : `${exportError}。`}没有生成文件，可以直接重新导出。
    </Notice>
  );

  if (!data) {
    return (
      <RdPage className="b3-page">
        {header}
        {filterBar}
        <Conclusion state="unknown">{error ? "用户转化：读取失败，暂时无法判断" : "用户转化：正在加载"}</Conclusion>
        {error
          ? <BlockState state="error" title="转化数据读取失败，不显示旧数据" detail={displayAdminReadError(error)} onRetry={() => void reload()} />
          : <BlockState state="loading" title="正在加载这批用户的转化…" />}
      </RdPage>
    );
  }

  const continueRow = (
    <nav className="rd-links b3-links" aria-label="相关页面">
      <span>继续分析</span>
      {canCross("/analytics/funnel-cohort") ? <Link className="rd-link" href="/analytics/funnel-cohort" prefetch={false}>用户转化与留存</Link> : <span aria-disabled="true">用户转化与留存 · 无权限</span>}
      {canCross("/growth/phase") ? <Link className="rd-link" href="/growth/phase" prefetch={false}>运营阶段设置</Link> : <span aria-disabled="true">运营阶段设置 · 无权限</span>}
      {canCross("/platform/events") ? <Link className="rd-link" href="/platform/events" prefetch={false}>用户行为事件</Link> : <span aria-disabled="true">用户行为事件 · 无权限</span>}
      <Explain label="数据从哪来" content={operatorCopyText(data.sourceStatement)} />
    </nav>
  );

  if (!data.available) {
    const coverage = data.reason === "ACTOR_COVERAGE_INCOMPLETE";
    return (
      <RdPage className="b3-page">
        {header}
        {filterBar}
        {exportNotice}
        <Conclusion state="unknown" icon={Filter}
          hint={coverage ? "事件数据补齐前算不出，可到「用户行为事件」查看。" : "换一个注册批次、阶段或渠道再看。"}>
          用户转化：当前条件下暂时无法计算
        </Conclusion>
        <BlockState state="empty" title={coverage ? "部分事件缺少用户或时间，已停止计算" : "当前筛选下没有注册用户"} detail={data.message || data.reason || "用户行为数据不完整。"} />
        <Fold title="每日首购、首购渠道和周走势" summary="当前条件下没有可显示的转化" icon={TrendingUp} tone="role-other">
          <div className="rd-stack">
            <div className="rd-split" data-even="">
              <DailyPanel data={data} />
              <ChannelPanel data={data} />
            </div>
            <TrendPanel data={data} stage={stage} onStage={setStage} />
          </div>
        </Fold>
        {continueRow}
      </RdPage>
    );
  }

  const register = data.stages[0];
  const withdraw = data.stages[data.stages.length - 1];
  const conclusionExplain = (
    <>
      <p>「转化率最低的一步」是首购、锁定计划、提现三步里「从上一步转化」最低的一步，不一定是掉人最多的一步。</p>
      {caliberNote()}
    </>
  );
  let conclusion: ReactNode;
  if (register?.distinctUsers == null) {
    conclusion = <Conclusion state="neutral" icon={Users} explain={PROTECT_NOTE} hint="换一个更大的范围再看，比如全部批次或全部渠道。">用户转化：这批注册用户少于 5 人，人数不显示</Conclusion>;
  } else if (!lowest) {
    conclusion = <Conclusion state="neutral" icon={Users} explain={conclusionExplain} hint="后面几步人数太少，看不出卡在哪一步；换一个更大的范围再看。">用户转化：注册 {people(register.distinctUsers)} 人，首购人数少于 5 人</Conclusion>;
  } else {
    conclusion = (
      <Conclusion state="neutral" lead icon={TrendingDown} explain={conclusionExplain}
        hint={<>注册 {people(register.distinctUsers)} 人，走到提现 {withdraw?.distinctUsers == null ? "少于 5 人" : `${people(withdraw.distinctUsers)} 人`}。可以结合「运营阶段设置」和「用户转化与留存」找原因。</>}>
        转化率最低的一步：<b>{lowest.stage}</b>（从上一步转化 {pct(lowest.cvrFromPrev)}）
      </Conclusion>
    );
  }

  return (
    <RdPage className="b3-page">
      {header}
      {filterBar}
      {exportNotice}
      {conclusion}
      <Panel title="同一批用户的四步转化" icon={Filter} tone="role-3" sub={scopeText(data.filters, true)}
        explain={<><p>条的长度和人数成比例，第一步注册是 100%。两步之间写这一步的转化率和掉了多少人。</p>{caliberNote()}</>}>
        <div className="rd-stack">
          {register?.distinctUsers == null
            ? <BlockState state="empty" title="这批注册用户少于 5 人，四步的人数和转化率都不显示" />
            : <Funnel stages={data.stages} lowest={lowest} />}
          <Fold inset title="各步骤明细" summary={`${data.stages.length} 步 · 人数、上一步人数、转化率和对应事件`}>
            <StageTable stages={data.stages} />
          </Fold>
        </div>
      </Panel>
      <AuxStats aux={data.auxMetrics} />
      <div className="rd-split" data-even="">
        <DailyPanel data={data} />
        <ChannelPanel data={data} />
      </div>
      <TrendPanel data={data} stage={stage} onStage={setStage} />
      {continueRow}
    </RdPage>
  );
}
