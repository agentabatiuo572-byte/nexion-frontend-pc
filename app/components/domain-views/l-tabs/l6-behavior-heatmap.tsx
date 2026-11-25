"use client";

/**
 * L6 · 用户行为热力图（改版，rd）。
 * 页头（两个导出、刷新）→ 筛选栏（时间范围、页面层级、设备、语言，「现在看」）→ 一句结论 → 四个合计 →
 * 浏览最多、跳出率最高两张榜 → 页面热力表（左）和单页点击位置（右）→ 访问趋势 → 统计范围和口径（折叠）。
 * 读取与导出范围保留；导出按后端合同携带实际理由（BUG-352）。
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { FileSpreadsheet, MousePointerClick, RefreshCw, TriangleAlert } from "lucide-react";
import {
  BlockState, Button, Conclusion, Explain, Fact, Facts, FilterBar, FilterField, Notice, PageHeader, Segments, Select, StatusTag,
} from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { downloadL6Behavior, fetchL6Behavior, fetchL6ClickHeat } from "@/lib/admin/l-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { behaviorPageTitle } from "@/lib/admin/l6-page-labels";
import {
  aggregateByDepth,
  activityForWindow,
  clickHeatForRoute,
  normalizeL6BehaviorHeatmap,
  summarize,
  type DepthFilter,
  type HeatRow,
  type TimeWindow,
} from "./l6-live-data";
import {
  BOUNCE_WARN, ClickPanel, CSV_COLUMNS, DEPTH_HINT, DEPTHS, DEVICES, HeatTable, LOCALES, n, pct, RankPanels, ScopeFold, SummaryBand, TrendPanel,
  WINDOWS, zoneWord, type SortKey,
} from "./l6-behavior-views";
import type { LCtx } from "./types";

const exportReasonLength = (reason: string) => [...reason.trim()].length;

export function L6BehaviorHeatmap({ ctx, title, summary }: { ctx: LCtx; title: ReactNode; summary: string }) {
  const session = useAdminAuth(state => state.session);
  const owner = session ? `${session.adminId}:${session.username}` : "";
  const hasCurrentExportPermission = () => {
    const auth = useAdminAuth.getState().session;
    return !!auth && `${auth.adminId}:${auth.username}` === owner
      && (auth.role?.toLowerCase() === "superadmin" || auth.authorities.includes("bi_l6_export"));
  };
  const [depth, setDepth] = useState<DepthFilter>("all");
  const [win, setWin] = useState<TimeWindow>("7d");
  const [sort, setSort] = useState<SortKey>("pv");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [sel, setSel] = useState<string | null>(null);
  const [device, setDevice] = useState<"ALL" | "APP" | "H5" | "MP">("ALL");
  const [locale, setLocale] = useState("ALL");
  const [liveRaw, setLiveRaw] = useState<Record<string, unknown> | null>(null);
  const [liveHeat, setLiveHeat] = useState<Record<string, unknown> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [liveError, setLiveError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reloadRevision] = useState(0);
  const gradId = "l6heat-" + useId().replace(/:/g, "");
  const overviewRaw = ctx.biData?.l6 ?? null;

  /* ---------------- 局部条件读取：沿用改版前（L6-H03、L6-S05、L6-S07） ---------------- */
  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    setLiveError("");
    setSel(null);
    if (ctx.biLoading) return () => { cancelled = true; };

    if (overviewRaw) {
      try {
        normalizeL6BehaviorHeatmap(overviewRaw);
        const isDefaultQuery = win === "7d" && device === "ALL" && locale === "ALL" && depth === "all" && sort === "pv";
        if (isDefaultQuery) {
          setLiveRaw(overviewRaw);
          setRefreshing(false);
          return () => { cancelled = true; };
        }
      } catch (error) {
        setLiveRaw(null);
        setLiveHeat(null);
        setLiveError(displayAdminReadError(error));
        setRefreshing(false);
        return () => { cancelled = true; };
      }
    }
    if (ctx.biError) {
      setLiveRaw(null);
      setLiveHeat(null);
      setLiveError(ctx.biError);
      setRefreshing(false);
      return () => { cancelled = true; };
    }

    void fetchL6Behavior({ window: win, device, locale, depth, sort })
      .then((data) => {
        normalizeL6BehaviorHeatmap(data);
        if (!cancelled) setLiveRaw(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setLiveRaw(null);
          setLiveHeat(null);
          setLiveError(displayAdminReadError(error));
        }
      })
      .finally(() => { if (!cancelled) setRefreshing(false); });
    return () => { cancelled = true; };
  }, [ctx.biError, ctx.biLoading, depth, device, locale, overviewRaw, reloadRevision, sort, win]);

  const heatmapData = useMemo(() => normalizeL6BehaviorHeatmap(liveRaw), [liveRaw]);

  const stats = useMemo(() => activityForWindow(heatmapData, win), [heatmapData, win]);
  const summaryNums = useMemo(() => summarize(stats), [stats]);
  const rows = useMemo<HeatRow[]>(() => {
    const r = aggregateByDepth(heatmapData.pageTree, stats, depth);
    const dir = sortDir === "desc" ? 1 : -1;
    return [...r].sort((a, b) => (b[sort] - a[sort]) * dir);
  }, [heatmapData.pageTree, stats, depth, sort, sortDir]); // eslint-disable-line react-hooks/exhaustive-deps

  // 查看明细：默认选第一行，可点切换（L6-Q05）
  const activeKey = sel ?? rows[0]?.key ?? null;
  const activeRow = rows.find((r) => r.key === activeKey) ?? null;
  useEffect(() => {
    let cancelled = false;
    setLiveHeat(null);
    if (!activeKey || !activeRow || activeRow.pageCount > 1 || depth === "L1" || depth === "L2") return;
    void fetchL6ClickHeat(activeKey, { window: win, device, locale, depth, sort })
      .then((data) => {
        normalizeL6BehaviorHeatmap({ ...liveRaw, clickHeatByRoute: { [activeKey]: data } });
        if (!cancelled) { setLiveHeat(data); setLiveError(""); }
      })
      .catch((error) => {
        if (!cancelled) {
          setLiveHeat(null);
          setLiveError(displayAdminReadError(error));
        }
      });
    return () => { cancelled = true; };
  }, [activeKey, activeRow, depth, device, locale, sort, win]); // eslint-disable-line react-hooks/exhaustive-deps
  const heat = useMemo(() => {
    if (!activeKey) return null;
    if (!liveHeat || liveHeat.route !== activeKey) return clickHeatForRoute(heatmapData, activeKey);
    const withHeat = normalizeL6BehaviorHeatmap({ ...liveRaw, clickHeatByRoute: { [activeKey]: liveHeat } });
    return clickHeatForRoute(withHeat, activeKey);
  }, [activeKey, heatmapData, liveHeat, liveRaw]);
  const aggregateSelection = depth === "L1" || depth === "L2" || (activeRow?.pageCount ?? 0) > 1;
  // 只管显示：这一页的点击位置读到了没有。读取中、读取失败不当成「没有点击」。
  const heatLoaded = Boolean(liveHeat && activeKey && liveHeat.route === activeKey);

  /* ---------------- 页头「导出近 7 天全端」：可导条件沿用改版前的 L6HeaderActions（L6-A02） ---------------- */
  const parent = useMemo(() => {
    try {
      const normalized = normalizeL6BehaviorHeatmap(overviewRaw);
      return {
        available: normalized.available && activityForWindow(normalized, "7d").length > 0,
        invalid: !normalized.available && normalized.status !== "LOADING",
        rows7d: activityForWindow(normalized, "7d").length,
      };
    } catch {
      return { available: false, invalid: true, rows7d: 0 };
    }
  }, [overviewRaw]);
  const parentLoading = Boolean(ctx.biLoading);
  const parentFailed = Boolean(ctx.biError) || parent.invalid || (!parentLoading && !ctx.biData?.l6);
  const [allExporting, setAllExporting] = useState(false);
  const exportAvailability = useRef({ all: false, current: false, query: "" });

  const runExportAll = async (reason: string) => {
    if (allExporting) return;
    if (!hasCurrentExportPermission() || !exportAvailability.current.all) throw new Error(formatAdminApiError("L6_EXPORT_VIEW_CHANGED", "L6_EXPORT_VIEW_CHANGED"));
    setAllExporting(true);
    try {
      const file = await downloadL6Behavior({ window: "7d", device: "ALL", locale: "ALL", reason });
      saveFile(file.blob, file.fileName);
      ctx.toast("已下载近 7 天全端页面数据（CSV，不含用户身份）", "success");
    } finally {
      setAllExporting(false);
    }
  };
  const exportScopeExplain = (
    <Explain label="八列分别是什么" content={<>
      <p>每个页面一行：页面路径、页面名、层级（1–3）、浏览次数、浏览人数、点击次数、平均停留（毫秒）、跳出率（0–1 的小数）。数字是原值，不换算。</p>
      <p>不含点击位置、区域占比、访问趋势，也不含任何用户身份。</p>
      <p>被排除的、已退役的页面这段时间有事件的也在里面，所以行数可能比页面热力表多；查不到名字的页面，页面名写路径、层级写 3。</p>
    </>} />
  );
  const openExportAll = () => {
    ctx.openActionConfirm({
      briefKind: "export",
      title: "导出近 7 天全端页面数据",
      action: "导出近 7 天全端",
      detail: "按确认那一刻往前 7 天，导出全部设备、全部语言的逐页汇总，不跟下面的筛选。",
      effect: <StatusTag tone="progress" filled>直接下载</StatusTag>,
      statedBrief: {
        impact: "确认后按那一刻重新统计，下载一个 CSV 到这台电脑；不改业务数据，导出留一条操作记录。",
        check: "范围固定是近 7 天、全部设备、全部语言、逐页，和页面上现在选的条件无关。",
      },
      facts: (
        <Facts>
          <Fact k="范围">近 7 天 · 全部设备 · 全部语言 · 逐页<Explain label="近 7 天怎么算" content={`从确认那一刻往前滚动 7×24 小时，不是自然周；时区 ${businessZone().label}。`} /></Fact>
          <Fact k="排序">按浏览次数从多到少</Fact>
          <Fact k="文件内容">{CSV_COLUMNS}{exportScopeExplain}</Fact>
          <Fact k="行数">现在约 {n(parent.rows7d)} 行，以确认时为准</Fact>
          <Fact k="记录">每次导出留一条操作记录</Fact>
        </Facts>
      ),
      confirmLabel: "确认并下载",
      reasonPlaceholder: "写这份数据给谁、做什么用，例如：周会复盘各页面跳出",
      reasonMin: 8,
      reasonMax: 200,
      measureReason: exportReasonLength,
      run: runExportAll,
    });
  };

  /* ---------------- 「导出当前筛选」：可导条件和请求沿用改版前（L6-A03） ---------------- */
  const canExportCurrent = ctx.canExport && heatmapData.available && stats.length > 0 && !liveError && !refreshing;
  const winLabel = WINDOWS.find((w) => w.v === win)?.lb ?? "";
  const deviceLabel = DEVICES.find((d) => d.v === device)?.lb ?? "";
  const localeLabel = LOCALES.find((l) => l.v === locale)?.lb ?? "";
  const depthLabel = DEPTHS.find((d) => d.v === depth)?.lb ?? "";
  const sortLabel = { pv: "浏览次数", clicks: "点击次数", dwellMs: "平均停留", bounceRate: "跳出率" }[sort];
  const scope = `${winLabel} · ${deviceLabel} · ${localeLabel} · ${depthLabel}`;
  const exportQuery = JSON.stringify([win, device, locale, depth, sort, sortDir]);
  exportAvailability.current = { all: !!ctx.canExport && !parentLoading && !parentFailed && parent.available,
    current: !!canExportCurrent, query: exportQuery };

  const runExportCurrent = async (reason: string) => {
    if (exporting) return;
    if (!hasCurrentExportPermission() || !exportAvailability.current.current || exportAvailability.current.query !== exportQuery) {
      throw new Error(formatAdminApiError("L6_EXPORT_VIEW_CHANGED", "L6_EXPORT_VIEW_CHANGED"));
    }
    setExporting(true);
    try {
      const file = await downloadL6Behavior({ window: win, device, locale, depth, sort, sortDir, reason });
      saveFile(file.blob, file.fileName);
      ctx.toast("已下载当前筛选的页面数据（CSV，不含用户身份）", "success");
    } finally {
      setExporting(false);
    }
  };
  const openExportCurrent = () => {
    ctx.openActionConfirm({
      briefKind: "export",
      title: "导出当前筛选的页面数据",
      action: "导出当前筛选",
      detail: <>按现在看的 <b>{scope}</b> 导出逐行汇总，不含点击位置和访问趋势。</>,
      effect: <StatusTag tone="progress" filled>直接下载</StatusTag>,
      statedBrief: {
        impact: "确认后按那一刻重新统计，下载一个 CSV 到这台电脑；不改业务数据，导出留一条操作记录。",
        check: "核对时间范围、设备、语言和页面层级；时间范围从确认那一刻往前滚动，数可能和页面上差一点。",
      },
      facts: (
        <Facts>
          <Fact k="范围">{scope}</Fact>
          <Fact k="排序">按{sortLabel}{sortDir === "desc" ? "从多到少" : "从少到多"}</Fact>
          <Fact k="文件内容">{CSV_COLUMNS}{exportScopeExplain}</Fact>
          <Fact k="行数">现在约 {n(stats.length)} 行，以确认时为准</Fact>
          <Fact k="不含">选中页面的点击位置、区域占比、访问趋势</Fact>
          <Fact k="记录">每次导出留一条操作记录</Fact>
        </Facts>
      ),
      confirmLabel: "确认并下载",
      reasonPlaceholder: "写这份数据给谁、做什么用，例如：核对新版首页的跳出",
      reasonMin: 8,
      reasonMax: 200,
      measureReason: exportReasonLength,
      run: runExportCurrent,
    });
  };

  /* ---------------- 页头 ---------------- */
  const readAt = useMemo(() => (overviewRaw ? formatBusinessTimeCompact(new Date().toISOString(), "") : ""), [overviewRaw]);
  const allBlocked = parentLoading ? "正在加载，读完再导出" : parentFailed ? "行为数据读取失败，暂时不能导出" : !parent.available ? "近 7 天没有页面浏览和点击，没有可导出的数据" : undefined;
  const currentBlocked = refreshing ? "正在按新条件读取，读完再导出"
    : liveError ? "这组条件有读取失败，刷新或换一个条件后再导出"
      : !heatmapData.available || !stats.length ? "这组条件下没有页面浏览和点击，没有可导出的数据" : undefined;
  const actions = ctx.canExport ? (
    <span className="l6-actions">
      <span className="l6-pair" data-pair="">
        <Button icon={<FileSpreadsheet size={14} aria-hidden />} loading={allExporting} loadingText="正在下载…" disabledReason={allBlocked} onClick={openExportAll}>导出近 7 天全端</Button>
        <Explain label="导出近 7 天全端是什么" content={<><p>固定导出近 7 天、全部设备、全部语言的逐页汇总，不跟下面的筛选。</p><p>写理由后直接下载 CSV，不含点击位置和用户身份，每次导出留操作记录。</p></>} />
      </span>
      <span className="l6-pair" data-pair="">
        <Button icon={<FileSpreadsheet size={14} aria-hidden />} loading={exporting} loadingText="正在下载…" disabledReason={currentBlocked} onClick={openExportCurrent}>导出当前筛选</Button>
        <Explain label="导出当前筛选是什么" content={<><p>按现在看的时间范围、设备、语言、页面层级和排序导出，和页面热力表是同一组条件。</p><p>写理由后直接下载 CSV，不含选中页面的点击位置和访问趋势。</p></>} />
      </span>
    </span>
  ) : undefined;
  const header = (
    <PageHeader
      pageId="L6"
      title={title}
      summary={summary}
      actions={actions}
      meta={<span className="rd-toolbar">
        {readAt && <span>{readAt} 读取（{businessZone().label}）<Explain label="数据时间说明" content="打开时读取，不自动刷新；点「刷新」重读。" /></span>}
        <Button variant="ghost" size="sm" loading={parentLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.reloadBi?.()}>刷新</Button>
      </span>}
      readOnly={!ctx.canExport ? "当前角色只有查看权限，不能导出" : undefined}
    />
  );

  /* ---------------- 筛选栏（L6-Q01、L6-Q02、L6-Q03） ---------------- */
  const filterBar = (
    <FilterBar
      scope={<>
        <Segments<TimeWindow> label="时间范围" value={win} items={WINDOWS.map((w) => ({ value: w.v, label: w.lb }))}
          onChange={(value) => { setWin(value); setSel(null); }} />
        <Segments<DepthFilter> label="页面层级" value={depth} items={DEPTHS.map((d) => ({ value: d.v, label: d.lb }))}
          onChange={(value) => { setDepth(value); setSel(null); }} />
      </>}
      sort={<span className="l6-now rd-filter-result">
        现在看：{refreshing ? `${scope} · 正在加载` : scope}
        <Explain label="这几个条件管什么" content={<>
          <p>时间范围从读取那一刻往前滚动 24 小时、7 天、30 天，不是自然日、周、月；时区 {heatmapData.available ? zoneWord(heatmapData.businessTimeZone) : businessZone().label}。</p>
          <p>页面层级：{DEPTH_HINT[depth]}。按一级、二级汇总时一行是一组页面，同一人在一组里只算一次。</p>
          <p>设备、语言只按 App 记下的标记筛，「全部语言」里也包含这三种以外的语言。条件不保存，刷新页面回到近 7 天、全部。</p>
          <p>页头「导出近 7 天全端」不跟这些条件。</p>
        </>} />
      </span>}
    >
      <FilterField>
        <Select aria-label="设备筛选" value={device} onChange={(value) => setDevice(value as typeof device)}
          options={DEVICES.map((d) => ({ value: d.v, label: d.lb }))} />
      </FilterField>
      <FilterField>
        <Select aria-label="语言筛选" value={locale} onChange={setLocale}
          options={LOCALES.map((l) => ({ value: l.v, label: l.lb }))} />
      </FilterField>
    </FilterBar>
  );

  const page = (body: ReactNode) => (
    <>
      {header}
      {filterBar}
      {body}
    </>
  );

  /* ---------------- 数据源状态（L6-S03、L6-S04） ---------------- */
  if (!heatmapData.available && heatmapData.status === "BLOCKED_CROSS_MODULE") {
    return page(<>
      <Conclusion state="unknown">用户行为热力图：等待跨模块接入</Conclusion>
      <BlockState state="empty" title="还没上线：行为数据还没接入"
        detail={<>{heatmapData.message || "行为数据还没接入，页面不会用别的数据冒充用户行为。"} 要等 App 开始记录页面浏览和点击后才能使用；目前不显示热力数据，也不能导出。</>} />
    </>);
  }
  if (!heatmapData.available && heatmapData.status === "RETIRED_ENVIRONMENT") {
    return page(<>
      <Conclusion state="unknown">用户行为热力图：数据来源无效</Conclusion>
      <BlockState state="error" title="数据来源不对，已停止显示。" detail={heatmapData.message || "收到的是已停用的数据来源。"} />
    </>);
  }

  /* ---------------- 读取中、失败、没有页面目录（L6-S01、L6-A01） ---------------- */
  if (!heatmapData.pageTree.length) {
    const loading = refreshing || ctx.biLoading;
    const error = liveError || ctx.biError;
    return page(<>
      <Conclusion state="unknown">{loading ? "用户行为热力图：正在加载" : error ? "用户行为热力图：读取失败，暂时无法判断" : "用户行为热力图：没有读到要统计的页面"}</Conclusion>
      {loading
        ? <BlockState state="loading" title="正在加载页面目录和行为数据…" />
        : error
          ? <BlockState state="error" title="行为数据读取失败，不显示旧数据" detail={<>{error === ctx.biError ? `${error} ` : ""}筛选条件还留着，重新加载后按这组条件再读；还是失败的话，请把错误信息发给技术同事。{error !== ctx.biError && <ErrorText text={error} />}</>} onRetry={() => void ctx.reloadBi?.()} />
          : <BlockState state="empty" title="没有读到要统计的页面" detail="页面目录里可能没有开启统计的页面，或这次没读到。请重新加载；仍然没有，请告诉技术同事。" onRetry={() => void ctx.reloadBi?.()} />}
    </>);
  }

  const selectRow = (key: string) => {
    setSel(key);
    // 让单页点击位置进入视野（已在视野则不滚动）
    requestAnimationFrame(() => document.getElementById("l6-drill")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  /* ---------------- 一句结论 ---------------- */
  const viewed = rows.filter((r) => r.pv > 0);
  const topPv = [...viewed].sort((a, b) => b.pv - a.pv)[0];
  const overLine = [...viewed].filter((r) => r.bounceRate > BOUNCE_WARN).sort((a, b) => b.bounceRate - a.bounceRate);
  const conclusion = !rows.length ? (
    <Conclusion state="neutral" icon={MousePointerClick} hint="换一个时间范围、设备或语言再看。">
      {winLabel}，{deviceLabel}、{localeLabel}：没有页面浏览和点击记录
    </Conclusion>
  ) : overLine.length ? (
    <Conclusion state="warn" lead icon={TriangleAlert} explainTitle="跳出率怎么算"
      explain="同一次打开 App 里，看完这一页后到统计截止都没再打开别的页面，就算一次跳出；和停留长短无关。50% 是这页固定的预警线，不能调。"
      hint={<>点下面热力表里的这一页，看用户在页面上点了哪里。</>}>
      <b>{overLine.length}</b> 个页面跳出率超过 50%，<span className="l6-keep">最高「{behaviorPageTitle(overLine[0])}」<b>{pct(overLine[0].bounceRate)}</b></span>
    </Conclusion>
  ) : (
    <Conclusion state="ok" icon={MousePointerClick} explainTitle="跳出率怎么算"
      explain="同一次打开 App 里，看完这一页后到统计截止都没再打开别的页面，就算一次跳出；和停留长短无关。50% 是这页固定的预警线，不能调。">
      {winLabel}：{topPv ? <>浏览最多的是「{behaviorPageTitle(topPv)}」{n(topPv.pv)} 次，</> : "只有点击、没有浏览记录，"}没有页面跳出率超过 50%
    </Conclusion>
  );

  /* ---------------- 合计和矩阵范围不同时写明（L6-X02、P-L6-04） ---------------- */
  const catalogRoutes = new Set(heatmapData.pageTree.map((node) => depth === "L1" ? node.parentL1 : depth === "L2" ? node.parentL2 : node.route));
  const outside = stats.filter((stat) => !catalogRoutes.has(stat.route));
  const outsideNotice = outside.length ? (
    <Notice tone="progress" title={`合计里含 ${n(outside.length)} 个热力表不列的页面`}>
      这些页面被排除或已退役，这段时间还有 {n(outside.reduce((sum, stat) => sum + stat.pv, 0))} 次浏览、{n(outside.reduce((sum, stat) => sum + stat.clicks, 0))} 次点击。合计和导出的 CSV 算它们，热力表不列，所以表里加起来比合计少，不是数错了。
    </Notice>
  ) : null;

  // 换条件后重读期间，旧数据不一定覆盖新的时间范围，整块换成读取中，不显示可能是错的数（L6-S05）。
  if (refreshing) {
    return page(<>
      <Conclusion state="unknown">用户行为热力图：正在按新条件读取</Conclusion>
      <BlockState state="loading" title={`正在加载 ${scope} 的页面数据…`} detail="读完自动显示；这期间不能导出当前筛选。" />
    </>);
  }

  const pending = liveError ? (
    <Notice tone="warn" title="有一部分没读到" action={<Button size="sm" onClick={() => void ctx.reloadBi?.()}>重新加载</Button>}>
      这一页的点击位置没有读到，页面热力表照常显示；重新加载或换一个条件之前，「导出当前筛选」暂时不能用。<ErrorText text={liveError} />
    </Notice>
  ) : null;

  return page(<>
    {pending}
    {conclusion}
    <SummaryBand summary={summaryNums} scope={scope} device={device} />
    {outsideNotice}
    {rows.length > 0 && <RankPanels rows={rows} onPick={selectRow} scope={winLabel} />}
    <div className="rd-split l6-main" data-detail="">
      <HeatTable rows={rows} activeKey={activeKey} onPick={selectRow} sort={sort} sortDir={sortDir} busy={refreshing}
        depthLabel={depthLabel}
        onSort={(next) => {
          if (sort === next) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
          else { setSort(next); setSortDir("desc"); }
        }}
        onFlip={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))} />
      {heat && activeRow && (
        <ClickPanel gradId={gradId} row={activeRow} heat={heat} aggregate={aggregateSelection} loaded={heatLoaded}
          failed={Boolean(liveError) && !heatLoaded} scope={`${winLabel} · ${deviceLabel} · ${localeLabel}`}
          device={device} onRetry={() => void ctx.reloadBi?.()} />
      )}
    </div>
    <TrendPanel daily={heatmapData.dailyTrend} weekly={heatmapData.weeklyTrend} scope={`${winLabel} · ${deviceLabel} · ${localeLabel}`} zone={heatmapData.businessTimeZone} />
    <ScopeFold data={heatmapData} />
  </>);
}

/** 沿用已备好的错误信息位置，读取失败使用只读口吻。 */
function ErrorText({ text }: { text: string }) {
  return <Explain label="错误信息" content={text} />;
}

function saveFile(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(href);
}
