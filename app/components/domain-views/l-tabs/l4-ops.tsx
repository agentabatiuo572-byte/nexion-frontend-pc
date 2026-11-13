"use client";

/**
 * L4 · 设备、任务与团队报表（改版，rd）。
 * 页头（两个导出）→ 筛选栏（时间段、阶段、保存为视图，「现在看」）→ 一句结论 → 四张报表卡（设备、任务、团队、运营阶段效果，
 * 同时是选报表的页签）→ 选中那一类的报表 → 四类共用的时间段表（折叠）。
 * 读取、本机视图、两种导出的请求体和命令号沿用改版前的写法（请求逐字节不变），这里只换界面。
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { Activity, Cpu, FileSpreadsheet, Flag, ListChecks, LockKeyhole, RefreshCw, Save, TriangleAlert, Users } from "lucide-react";
import {
  BlockState, Button, Conclusion, Explain, Fact, Facts, FilterBar, FilterField, Input, Notice, PageHeader, ScaleBar, Segments, Select,
  Stat, StatBand, StatusTag, useTabIds,
} from "@/app/components/rd";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { isLOutcomeUnknownError, type L4OperationsQuery } from "@/lib/admin/l-client";
import { findByPath } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { readL4Operations, type L4OperationsData } from "./l4-live-data";
import {
  ACCEPTANCE_EXPLAIN, ACCEPTANCE_WARN, acceptanceScale, bestConversion, count, DeviceReport, HistoryFold, money, pct, PhaseReport, TaskReport, TeamReport,
} from "./l4-ops-views";
import type { LCtx } from "./types";

type ReportTab = "device" | "tasks" | "network" | "phase";

const REPORT_TABS: ReadonlyArray<[ReportTab, string]> = [
  ["device", "设备"],
  ["tasks", "任务"],
  ["network", "团队"],
  ["phase", "运营阶段效果"],
];

const PERIODS: ReadonlyArray<[L4OperationsQuery["period"], string]> = [
  ["day", "日"], ["week", "周"], ["month", "月"], ["custom", "自定义"],
];

const EXPORT_PAGE = "/analytics/export";
/** 每类报表要处理具体对象时去哪一页（只是链接，不在这页处置）。 */
const REPORT_LINKS: Record<ReportTab, readonly string[]> = {
  device: ["/devices/ops", "/devices/trade-in"],
  tasks: ["/devices/tasks"],
  network: ["/network/v-rank", "/network/commissions"],
  phase: ["/growth/phase"],
};

type ExportOutcome =
  | { kind: "agg-done"; scope: string }
  | { kind: "agg-unknown"; scope: string }
  | { kind: "tree-done"; rows: number; scope: string; depth: number }
  | { kind: "tree-unknown"; scope: string; depth: number; at: string };

const phaseText = (phase: L4OperationsQuery["phase"]) => (phase === "ALL" ? "全部阶段" : phase);

export function L4Ops({ ctx, title, summary }: { ctx: LCtx; title: ReactNode; summary: string }) {
  const reach = useReach();
  const data = readL4Operations(ctx.biData?.l4);
  const query = ctx.l4Query ?? { period: "week", phase: "ALL" };
  const [tab, setTab] = useState<ReportTab>("device");
  const [from, setFrom] = useState(query.from ?? "");
  const [to, setTo] = useState(query.to ?? "");
  const restoredRef = useRef(false);
  const tabIds = useTabIds();
  // 只管显示：导出后页面上方的结果条。不参与请求。
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const readAt = useMemo(() => (data ? formatBusinessTimeCompact(new Date().toISOString(), "") : ""), [ctx.biData]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- 本机视图：恢复和保存沿用改版前（L4-A02、L4-H04） ---------------- */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.localStorage.getItem("nexion:l4:view");
      if (!raw) return;
      const saved = JSON.parse(raw) as { query?: Partial<L4OperationsQuery>; tab?: string };
      const period = saved.query?.period;
      const phase = saved.query?.phase;
      const validPeriod = PERIODS.some(([value]) => value === period);
      const validPhase = phase === "ALL" || /^P[1-6]$/.test(phase ?? "");
      const validTab = REPORT_TABS.some(([value]) => value === saved.tab);
      if (!validPeriod || !validPhase || !validTab) return;
      const restoredQuery: L4OperationsQuery = {
        period: period as L4OperationsQuery["period"],
        phase: phase as L4OperationsQuery["phase"],
      };
      if (period === "custom") {
        const restoredFrom = saved.query?.from ?? "";
        const restoredTo = saved.query?.to ?? "";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(restoredFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(restoredTo) || restoredFrom > restoredTo) return;
        restoredQuery.from = restoredFrom;
        restoredQuery.to = restoredTo;
        setFrom(restoredFrom);
        setTo(restoredTo);
      }
      setTab(saved.tab as ReportTab);
      ctx.setL4Query?.(restoredQuery);
    } catch {
      // A corrupt local view is ignored; the server-backed default remains authoritative.
    }
  }, [ctx.setL4Query]);

  const updateQuery = (next: Partial<L4OperationsQuery>) => {
    ctx.setL4Query?.({ ...query, ...next });
  };
  const applyCustom = () => {
    if (!from || !to) {
      ctx.toast("请选择自定义周期的开始和结束日期；当前报表没有变化");
      return;
    }
    if (from > to) {
      ctx.toast("开始日期不能晚于结束日期；当前报表没有变化");
      return;
    }
    updateQuery({ period: "custom", from, to });
  };
  const saveView = () => {
    try {
      window.localStorage.setItem("nexion:l4:view", JSON.stringify({ query, tab }));
      ctx.toast("已保存在这台电脑的浏览器里：时间段、阶段和当前报表；统计方式没有改变", "success");
    } catch {
      ctx.toast("视图保存失败 · 浏览器存储不可用；报表数据没有变化", "error");
    }
  };

  /* ---------------- 运营汇总导出：请求体、命令号、2 秒防连点和改版前一致（L4-A04） ---------------- */
  const aggExportingRef = useRef(false);
  const aggIntentKeyRef = useRef({ fingerprint: "", key: "" });
  const aggLastSuccessAtRef = useRef(0);
  const [aggExporting, setAggExporting] = useState(false);
  const queryMatchesData = data?.period.key === query.period && data.phaseFilter === query.phase
    && (query.period !== "custom" || Boolean(query.from && query.to
      && data.period.from.slice(0, 10) === query.from && data.period.to.slice(0, 10) === query.to));
  const canExportCurrent = ctx.canExport && data?.available && queryMatchesData
    && !ctx.biLoading && !ctx.biError;
  const dataScope = data ? `${data.period.label} · ${phaseText(data.phaseFilter)}` : "";

  const exportCurrent = () => {
    if (aggExportingRef.current || !canExportCurrent || !data) return;
    if (Date.now() - aggLastSuccessAtRef.current < 2_000) return;
    const range = [
      `period=${query.period}`,
      `phase=${query.phase}`,
      query.from ? `from=${query.from}` : "",
      query.to ? `to=${query.to}` : "",
    ].filter(Boolean).join(";");
    const input = {
      exportType: "运营报表",
      timeRange: range,
      fields: "设备/任务/网络/运营阶段 历史聚合指标",
      piiLevel: "NONE",
      maskPolicy: "NONE",
      recipient: "运营管理员",
      ticket: "L4-OPERATIONS",
    };
    const scope = `${data.period.label}（${data.period.from} 至 ${data.period.to}）· ${phaseText(data.phaseFilter)}`;
    setOutcome(null);
    ctx.openActionConfirm({ briefKind: "export",
      title: "导出运营汇总",
      action: "导出运营报表",
      detail: <>按 <b>{data.period.label} · {data.phaseFilter === "ALL" ? "全部阶段" : data.phaseFilter}</b> 导出运营汇总，不含用户明细。</>,
      effect: <StatusTag tone="progress" filled>立即生成</StatusTag>,
      statedBrief: { impact: "生成一份运营汇总 CSV 快照，不改任何数据，操作记录里留痕。", check: "快照按生成那一刻的数据存好，以后下载还是那一份，不随页面刷新变。" },
      facts: (
        <Facts>
          <Fact k="时间段和阶段">{scope}</Fact>
          <Fact k="文件内容">设备、任务、团队和各阶段的汇总数<Explain label="运营汇总里有什么" content={<>
            <p>设备：在用设备、购置、退役、锁定、首次产出、产出 USDT、产出 UVT、衰减影响。任务：派发、完成、任务承接率、队列饱和度、签到活跃。团队：新增直接邀请、奖励笔数、团队奖励发放、团队成交额、推广率、团队奖励触发率。每个阶段：活跃人数、留存率、转化率、产出。</p>
            <p>不含按时间段的数、分布、衰减分段、阶段切换和参数调整次数；这是现在能导出的全部范围。算不出的比例那一行不写。</p>
            <p>六列：分类、周期/阶段、运营指标、值、单位、数据来源。</p>
          </>} /></Fact>
          <Fact k="个人信息">不含</Fact>
          <Fact k="去哪下载">「{exportPageName}」</Fact>
        </Facts>
      ),
      confirmLabel: "确认导出",
      reasonPlaceholder: "写这份汇总给谁、做什么用，例如：周会运营复盘",
      reasonMax: 200,
      run: async (reason) => {
        const fingerprint = JSON.stringify([input, reason]);
        if (aggLastSuccessAtRef.current || aggIntentKeyRef.current.fingerprint !== fingerprint) {
          aggIntentKeyRef.current = { fingerprint, key: `l4-ops-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` };
          aggLastSuccessAtRef.current = 0;
        }
        aggExportingRef.current = true;
        setAggExporting(true);
        try {
          await ctx.biActions?.createReport(input, reason, aggIntentKeyRef.current.key);
          aggLastSuccessAtRef.current = Date.now();
          ctx.toast("运营报表已导出（按当前周期和阶段）");
          setOutcome({ kind: "agg-done", scope });
        } catch (error) {
          // 结果未知仍交给外壳关框、重读、提示（l-view）；这里只留一条提示。聚合快照不改业务数据，不做 R1 恢复（决定 B4-PD02）。
          if (isLOutcomeUnknownError(error)) setOutcome({ kind: "agg-unknown", scope });
          throw error;
        } finally {
          aggExportingRef.current = false;
          setAggExporting(false);
        }
      },
    });
  };

  /* ---------------- 团队关系明细导出：请求、命令号、深度表单和改版前一致（L4-A05、L4-X01） ---------------- */
  const treeExportingRef = useRef(false);
  const treeIntentKeyRef = useRef("");
  const treeLastSuccessAtRef = useRef(0);
  const [treeExporting, setTreeExporting] = useState(false);

  const requestNetworkTreeExport = () => {
    if (!data) return;
    if (treeExportingRef.current || query.period === "custom" || data.liveFacts.teamRelationships <= 0) return;
    const now = Date.now();
    if (treeLastSuccessAtRef.current && now - treeLastSuccessAtRef.current < 2_000) return;
    if (treeLastSuccessAtRef.current) {
      treeIntentKeyRef.current = "";
      treeLastSuccessAtRef.current = 0;
    }
    const scope = `${data.period.label}加入的关系`;
    setOutcome(null);
    ctx.openActionConfirm({ briefKind: "export",
      title: "导出团队关系明细",
      action: "导出团队明细",
      detail: (
        <div>
          将按当前 <b>{data.period.label}</b> 周期导出团队关系；预计 <b>{data.liveFacts.teamRelationships}</b> 条（以实际导出为准）。只包含部分隐藏的用户编码、关系深度、会员等级、关系记录上的团队 GMV 和加入时间，不含手机号、昵称。下载链接 24 小时有效，导出留一条高风险操作记录。
        </div>
      ),
      effect: <StatusTag tone="warn" icon={LockKeyhole}>敏感导出 · 留高风险记录</StatusTag>,
      statedBrief: {
        impact: "生成一份团队关系快照并直接下载到这台电脑，不改团队关系和奖励；导出和下载都留操作记录，导出记为高风险。",
        check: "核对时间段和追溯次数；快照在确认这一刻生成，以后下载还是这一份。",
      },
      facts: (
        <Facts>
          <Fact k="导出什么">所有团队里的成员关系，每个成员一行，六列<Explain label="六列分别是什么" content={<>
            <p>成员用户编码（部分隐藏）。</p>
            <p>邀请人用户编码（部分隐藏）：其实是这条邀请链最上面那个人，不一定是这位成员的直接邀请人。</p>
            <p>关系深度：从最上面那个人往下第几层。V-Rank：关系记录上的等级，没有写 UNRANKED。</p>
            <p>团队 GMV USDT：关系记录上的累计量，不是所选时间段的成交额，没有写 0。</p>
            <p>加入时间：这条关系建立的时间，按服务器时间原样写。</p>
          </>} /></Fact>
          <Fact k="时间段">{data.period.label}加入的关系<Explain label="时间段怎么算" content="按关系建立的时间从现在往前算近 1、7 或 30 天，不跟运营阶段和自定义日期走；只能按日、周、月导出。" /></Fact>
          <Fact k="用户编码" tone="warn">部分隐藏<Explain label="隐藏到什么程度" content="编号 4 位以内整个写成 ***，更长的留前 2 位和后 2 位，中间换成 *。不含手机号、昵称。" /></Fact>
          <Fact k="多少行">现有团队关系 {count(data.liveFacts.teamRelationships)} 条，实际行数以导出为准<Explain label="行数上限" content="这个数是现在全部团队关系的累计条数，不按时间段和追溯次数筛。一次最多 100,000 行，超过时不导出，也不截断。" /></Fact>
          <Fact k="记录">导出留一条高风险操作记录，下载也留记录</Fact>
          <Fact k="需要的权限">团队关系明细导出权限</Fact>
          <Fact k="下载">确认后直接下载到这台电脑<Explain label="下载链接" content="下载链接从签发起 24 小时内有效，只给你用。" /></Fact>
        </Facts>
      ),
      confirmLabel: "确认导出并下载",
      reasonPlaceholder: "写这份明细给谁、做什么用，例如：工单号、核对哪个团队",
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        hint: "次数越多，导出越多；1 次只含直接邀请的好友，最多 10 次。",
        fields: [{
          key: "depth",
          label: "向下追溯的邀请次数",
          current: "3",
          inputKind: "select",
          options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
          optionLabels: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1} 次`])),
          required: true,
        }],
      },
      run: async (reason, _newValue, businessValue) => {
        if (treeExportingRef.current || !ctx.biActions) return;
        const depth = Number(businessValue?.depth ?? "3");
        if (!Number.isInteger(depth) || depth < 1 || depth > 10) throw new Error("追溯次数必须为 1–10");
        if (!treeIntentKeyRef.current) treeIntentKeyRef.current = `l4-network-tree-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const submittedAt = formatBusinessTimeCompact(new Date().toISOString(), "");
        treeExportingRef.current = true;
        setTreeExporting(true);
        try {
          const result = await ctx.biActions.createNetworkTreeExport(
            { period: query.period as "day" | "week" | "month", depth },
            reason,
            treeIntentKeyRef.current,
          ).catch((cause) => {
            if (!isLOutcomeUnknownError(cause)) treeIntentKeyRef.current = "";
            throw cause;
          });
          const file = await ctx.biActions.downloadReport(result.reportId);
          downloadBlob(file.blob, file.fileName);
          treeLastSuccessAtRef.current = Date.now();
          ctx.toast(`团队明细已安全下载 · ${result.rowCount} 行 · 用户编码部分隐藏 · 24 小时令牌`);
          setOutcome({ kind: "tree-done", rows: result.rowCount, scope, depth });
        } catch (error) {
          // 结果未知仍交给外壳关框、重读、提示；页面上方留一条结果未知提醒。R1 的本机保存、「查询原结果」「按原请求重试」由代码 worker 接（决定 B4-PD02）。
          if (isLOutcomeUnknownError(error)) setOutcome({ kind: "tree-unknown", scope, depth, at: submittedAt });
          throw error;
        } finally {
          treeExportingRef.current = false;
          setTreeExporting(false);
        }
      },
    });
  };

  /* ---------------- 页头 ---------------- */
  const exportPageName = findByPath(EXPORT_PAGE)?.l2.name ?? "数据导出与监管报告";
  const canOpenExportPage = reach(EXPORT_PAGE, "bi_l5_read");
  const exportPageLink = (text: string) => (canOpenExportPage
    ? <Link className="rd-link" href={EXPORT_PAGE}>{text}</Link>
    : <>你没有「{exportPageName}」的权限，请找有权限的同事核对。</>);

  const readBlocked = ctx.biLoading ? "正在读取，读完再导出" : ctx.biError ? "运营数据读取失败，暂时不能导出" : !data ? "还没有读到所选时间段的数据" : undefined;
  const aggBlocked = readBlocked ?? (!queryMatchesData ? "请先应用有效周期，再导出对应报表" : !data?.available ? "这个周期没有可导出的数据" : undefined);
  const treeBlocked = readBlocked ?? (query.period === "custom" ? "团队明细只能按日、周、月导出" : (data?.liveFacts.teamRelationships ?? 0) <= 0 ? "当前没有可导出的团队关系" : undefined);
  const actions = (ctx.canExport || ctx.canExportNetworkTree) ? (
    <span className="l4-actions">
      {ctx.canExport && (
        <span className="l4-pair" data-pair="">
          <Button icon={<FileSpreadsheet size={14} aria-hidden />} loading={aggExporting} loadingText="正在生成…" disabledReason={aggBlocked} onClick={exportCurrent}>导出运营汇总（CSV）</Button>
          <Explain label="运营汇总是什么" content={<><p>马上生成，不含个人信息：按现在看的时间段和阶段，导出设备、任务、团队和各阶段的汇总数。</p><p>到「{exportPageName}」下载。</p></>} />
        </span>
      )}
      {ctx.canExportNetworkTree && (
        <span className="l4-pair" data-pair="">
          <Button icon={<LockKeyhole size={14} aria-hidden />} loading={treeExporting} loadingText="正在生成…" disabledReason={treeBlocked} onClick={requestNetworkTreeExport}>导出团队关系明细</Button>
          <Explain label="团队关系明细是什么" content={<><p>敏感导出：每个团队成员一行，用户编码部分隐藏，要写理由，留高风险操作记录，最多 100,000 行。</p><p>只按日、周、月的加入时间筛，不跟运营阶段；确认后直接下载到这台电脑。</p></>} />
        </span>
      )}
      {ctx.canExport && !ctx.canExportNetworkTree && <span className="rd-toolbar-note">团队关系明细需要专门的导出权限</span>}
      {!ctx.canExport && <span className="rd-toolbar-note">你只能查看，导出需要报表导出权限</span>}
    </span>
  ) : undefined;

  const header = (
    <PageHeader
      pageId="L4"
      title={title}
      summary={summary}
      actions={actions}
      meta={<span className="rd-toolbar">
        <span>{readAt ? `${readAt} 读取（${businessZone().label}）· ` : ""}打开页面时读取，不自动刷新</span>
        <Button variant="ghost" size="sm" loading={ctx.biLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.reloadBi?.()}>刷新</Button>
      </span>}
      readOnly={!ctx.canExport && !ctx.canExportNetworkTree ? "你只能查看，导出需要报表导出权限" : undefined}
    />
  );

  /* ---------------- 导出结果条（只管显示） ---------------- */
  const outcomeNotice = outcome && (() => {
    const close = <Button size="sm" onClick={() => setOutcome(null)}>知道了</Button>;
    if (outcome.kind === "agg-done") return (
      <Notice tone="ok" title="已生成运营汇总快照" action={close}>
        {outcome.scope}，不含个人信息。{exportPageLink(`到「${exportPageName}」下载`)}
      </Notice>
    );
    if (outcome.kind === "agg-unknown") return (
      <Notice tone="warn" title="运营汇总导出结果未知" action={close}>
        请求已发出，但没有收到明确结果，快照可能已经生成。{canOpenExportPage ? <>先{exportPageLink(`到「${exportPageName}」看有没有这一份`)}，没有就再导出一次；</> : <>{exportPageLink("")}没有就再导出一次；</>}导出不改业务数据。
      </Notice>
    );
    if (outcome.kind === "tree-done") return (
      <Notice tone="ok" title="团队关系明细已下载" action={close}>
        {outcome.scope} · 向下追溯 {outcome.depth} 次 · {count(outcome.rows)} 行 · 用户编码部分隐藏。浏览器已开始下载，下载链接 24 小时内有效、只给你用。
      </Notice>
    );
    return (
      <Notice tone="warn" title="团队关系明细导出结果未知" action={close} actionBelow>
        <p>{outcome.scope} · 向下追溯 {outcome.depth} 次 · {outcome.at} 提交</p>
        <p>请求已发出，但没有收到明确结果，可能已经生成了一份快照。{canOpenExportPage
          ? <>先{exportPageLink(`到「${exportPageName}」核对`)}；核对之前不要换追溯次数或理由重新导出。</>
          : <>你没有「{exportPageName}」的权限，请找有权限的同事核对；核对之前不要换追溯次数或理由重新导出。</>}</p>
        {/* R1：代码 worker 在这里接本机保存原请求、「查询原结果」「按原请求重试」（决定 B4-PD02、全站-结果未知叫法、e-page-common R1）。 */}
      </Notice>
    );
  })();

  /* ---------------- 筛选栏：时间段、阶段立即读；自定义日期要应用（L4-Q01、L4-Q02、L4-S06） ---------------- */
  const customInvalid = Boolean(from && to && from > to);
  const customChanged = query.period === "custom" && (from !== (query.from ?? "") || to !== (query.to ?? ""));
  const shown = data && !ctx.biLoading && queryMatchesData
    ? `${data.period.label}（${data.period.from} 至 ${data.period.to}）· ${phaseText(data.phaseFilter)}`
    : query.period === "custom" && !(query.from && query.to)
      ? `自定义日期还没应用 · ${phaseText(query.phase)}`
      : `${PERIODS.find(([value]) => value === query.period)?.[1] ?? ""}${query.period === "custom" ? `（${query.from} 至 ${query.to}）` : ""} · ${phaseText(query.phase)} · 正在读取`;
  const scopeExplain = (
    <Explain label="时间段和阶段管哪几块" content={<>
      <p>日、周、月是从现在往前滚动的近 24 小时、7 天、30 天，不是自然日、周、月。自定义按业务日（{businessZone().label}）算，含首尾两天，结束日不能晚于今天，最长 400 天。</p>
      <p>时间段和阶段管设备、任务、团队、运营阶段效果四块里「这段时间」的数。「读取那一刻」的数（在用设备、置换、团队关系）不随它们变。</p>
      <p>四块用同一次读取，切报表卡不重新读取。</p>
    </>} />
  );
  const filterBar = (
    <FilterBar
      scope={<span className="rd-filter-group" aria-label="运营报表筛选" role="group">
        <Segments<L4OperationsQuery["period"]> label="报表周期" value={query.period}
          items={PERIODS.map(([value, label]) => ({ value, label }))}
          onChange={(period) => period === "custom" ? updateQuery({ period }) : updateQuery({ period, from: undefined, to: undefined })} />
      </span>}
      sort={<span className="l4-pair" data-pair="">
        <Button icon={<Save size={14} aria-hidden />} onClick={saveView}>保存为视图</Button>
        <Explain label="保存为视图存什么" content={<><p>只存在这台电脑的浏览器里，换电脑、换浏览器或清浏览器数据就没了；同一台电脑上的其他账号也会用到它。</p><p>存已经应用的时间段、阶段和正在看的报表，不存还没应用的日期，不存数字，不改统计方式。</p><p>下次打开这页按保存的条件读取。</p></>} />
      </span>}
      result={<span className="l4-scope">现在看：{shown}{customChanged && query.period === "custom" && query.from ? " · 输入框里的日期还没应用" : ""}{scopeExplain}</span>}
    >
      <FilterField label="运营阶段">
        <Select aria-label="运营阶段 筛选" value={query.phase}
          onChange={(value) => updateQuery({ phase: value as L4OperationsQuery["phase"] })}
          options={[{ value: "ALL", label: "全部阶段（P1–P6）" }, ...[1, 2, 3, 4, 5, 6].map((phase) => ({ value: `P${phase}`, label: `P${phase}` }))]} />
      </FilterField>
      {query.period === "custom" && (
        <div className="rd-filter-line">
          <label className="rd-note" htmlFor="l4-custom-from">起</label>
          <Input id="l4-custom-from" aria-label="自定义开始日期" type="date" value={from} max={to || undefined} aria-invalid={customInvalid || undefined} onChange={(event) => setFrom(event.target.value)} />
          <label className="rd-note" htmlFor="l4-custom-to">止</label>
          <Input id="l4-custom-to" aria-label="自定义结束日期" type="date" value={to} min={from || undefined} aria-invalid={customInvalid || undefined} onChange={(event) => setTo(event.target.value)} />
          <Button onClick={applyCustom}>应用日期</Button>
          {customInvalid && <span className="rd-toolbar-note" data-tone="warn">开始日期不能晚于结束日期</span>}
        </div>
      )}
    </FilterBar>
  );

  const page = (body: ReactNode) => (
    <>
      {header}
      {outcomeNotice}
      {filterBar}
      {body}
    </>
  );

  /* ---------------- 没有可用数据：读取中、失败、等自定义日期、空（L4-S01、L4-S06、L4-A01） ---------------- */
  if (!data) {
    const waitingCustom = !ctx.biLoading && !ctx.biError && query.period === "custom" && !(query.from && query.to);
    return page(<>
      <Conclusion state="unknown">{ctx.biLoading ? "运营报表：正在读取" : ctx.biError ? "运营报表：读取失败，暂时无法判断" : waitingCustom ? "运营报表：等待所选周期数据" : "运营报表：还没有数据"}</Conclusion>
      {ctx.biLoading
        ? <BlockState state="loading" title="正在读取设备、任务、团队和各阶段的数…" />
        : ctx.biError
          ? <BlockState state="error" title="运营数据读取失败，不显示旧数据" detail={`${ctx.biError} 可以换一个时间段再读；还是失败的话，请把错误信息发给技术同事。`} onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />
          : waitingCustom
            ? <BlockState state="empty" title="选好开始和结束日期，点「应用日期」后读取" detail="自定义日期按业务日算，含首尾两天。" />
            : <BlockState state="empty" title="还没有可显示的运营数据" detail="请先重新加载；仍然为空，说明还没有产生数据。" onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />}
    </>);
  }

  /* ---------------- 一句结论 ---------------- */
  return page(<L4Body data={data} tab={tab} setTab={setTab} tabIds={tabIds} reach={reach} />);
}

function L4Body({ data, tab, setTab, tabIds, reach }: {
  data: L4OperationsData;
  tab: ReportTab;
  setTab: (tab: ReportTab) => void;
  tabIds: ReturnType<typeof useTabIds>;
  reach: ReturnType<typeof useReach>;
}) {
  const scope = `${data.period.label} · ${phaseText(data.phaseFilter)}`;
  const t = data.tasks.summary;
  const rate = t.acceptanceRate;
  const low = rate !== null && rate < ACCEPTANCE_WARN;
  const taskPage = findByPath("/devices/tasks");

  const conclusion = !data.available ? (
    <Conclusion state="neutral" icon={Activity} hint="换一个时间段或阶段再看；「读取那一刻」的在用设备、置换和团队关系照常显示。">
      运营报表：{scope}没有可核验的运营事件
    </Conclusion>
  ) : low ? (
    <Conclusion state="warn" lead icon={TriangleAlert} explain={ACCEPTANCE_EXPLAIN} explainTitle="任务承接率怎么算"
      hint={reach("/devices/tasks") && taskPage ? <>建议到「<Link className="rd-link" href="/devices/tasks">{taskPage.l2.name}</Link>」检查任务定价和队列设置。</> : "建议检查任务定价和队列设置。"}>
      任务承接率 <b>{pct(rate)}</b>，低于 60% 预警线
    </Conclusion>
  ) : rate !== null ? (
    <Conclusion state="ok" icon={ListChecks} explain={ACCEPTANCE_EXPLAIN} explainTitle="任务承接率怎么算">
      运营报表：{scope}，任务承接率 {pct(rate)}，不低于 60% 预警线{rate > 100 ? "（完成数多于派发数，可以超过 100%）" : ""}
    </Conclusion>
  ) : (
    <Conclusion state="neutral" icon={Activity} explain={ACCEPTANCE_EXPLAIN} explainTitle="任务承接率怎么算">
      运营报表：{scope}有 {count(data.quality.eventCount)} 条运营事件；{t.dispatched === 0 ? "没有派发记录，任务承接率算不出" : "任务承接率算不出"}
    </Conclusion>
  );

  const quality = data.available && !data.quality.sameActorRates ? (
    <Notice tone="warn" title="同用户覆盖不完整">
      有的事件缺少用户编号（能识别用户的事件占 {pct(data.quality.actorCoveragePct)}），按人算的承接率、推广率、触发率、留存率和转化率都写「—」，不用事件数代替人数。
    </Notice>
  ) : null;

  /* ---------------- 四张报表卡：同时是选报表的页签（L4-Q03、L4-H05） ---------------- */
  const keys = REPORT_TABS.map(([key]) => key);
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTabValue(keys, tab, event.key);
    if (next === null) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(tabIds.tab(next))?.focus();
  };
  const tabProps = (key: ReportTab) => ({
    selected: tab === key, selectedText: "正在看", onOpen: () => setTab(key),
    role: "tab" as const, id: tabIds.tab(key), "aria-selected": tab === key, "aria-controls": tabIds.panelId(key),
    tabIndex: tab === key ? 0 : -1, onKeyDown,
  });
  const d = data.device.summary;
  const n = data.network.summary;
  const best = bestConversion(data.phaseEffect);
  const singlePhase = data.phaseEffect.length === 1 ? data.phaseEffect[0] : null;
  const max = rate === null ? 100 : acceptanceScale(rate);
  const cards = (
    <div className="l4-cards">
      <StatBand cards role="tablist" label="四类运营报表">
        <Stat head="设备" icon={Cpu} tone="role-2" label="在用设备" value={count(data.liveFacts.activeUserDevices)} unit="台" sub="读取那一刻"
          openLabel={`设备报表：在用设备 ${count(data.liveFacts.activeUserDevices)} 台`} {...tabProps("device")}>
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>这段时间购置</dt><dd data-empty={d.periodPurchasedDevices === 0 ? "" : undefined}>{count(d.periodPurchasedDevices)} 台</dd></div>
            <div className="rd-stat-row"><dt>这段时间退役</dt><dd data-empty={d.periodRetiredDevices === 0 ? "" : undefined}>{count(d.periodRetiredDevices)} 台</dd></div>
            <div className="rd-stat-row"><dt>这段时间产出</dt><dd data-empty={d.dailyYieldUsdt === 0 ? "" : undefined}>{money(d.dailyYieldUsdt)} USDT</dd></div>
          </dl>
        </Stat>
        <Stat head="任务" icon={ListChecks} tone={low ? "warn" : "role-2"} label="任务承接率" value={pct(rate)} surface={low ? "warn" : undefined}
          openLabel={`任务报表：任务承接率 ${pct(rate)}`} {...tabProps("tasks")}>
          {rate === null
            ? <span className="rd-note">{t.dispatched === 0 ? "没有派发记录，算不出" : "缺少用户或任务编号，算不出"}</span>
            : low
              ? <StatusTag tone="warn" icon={TriangleAlert}>低于 60% 预警线</StatusTag>
              : <ScaleBar quiet label="任务承接率" valueText={`任务承接率 ${pct(rate)}，预警线 60%`} max={max} value={rate} fill target={ACCEPTANCE_WARN} tone="role-2" />}
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>派发</dt><dd data-empty={t.dispatched === 0 ? "" : undefined}>{count(t.dispatched)} 次</dd></div>
            <div className="rd-stat-row"><dt>完成</dt><dd data-empty={t.completed === 0 ? "" : undefined}>{count(t.completed)} 次</dd></div>
          </dl>
        </Stat>
        <Stat head="团队" icon={Users} tone="role-3" label="新增直接邀请" value={count(n.directRefs)} unit="人"
          openLabel={`团队报表：新增直接邀请 ${count(n.directRefs)} 人`} {...tabProps("network")}>
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>团队奖励发放</dt><dd data-empty={n.commissionPaidUsdt === 0 ? "" : undefined}>{money(n.commissionPaidUsdt)} USDT</dd></div>
            <div className="rd-stat-row"><dt>团队成交额</dt><dd data-empty={n.teamGmvUsdt === 0 ? "" : undefined}>{money(n.teamGmvUsdt)} USDT</dd></div>
            <div className="rd-stat-row"><dt>团队关系（累计）</dt><dd data-empty={data.liveFacts.teamRelationships === 0 ? "" : undefined}>{count(data.liveFacts.teamRelationships)} 条</dd></div>
          </dl>
        </Stat>
        <Stat head="运营阶段效果" icon={Flag} tone="role-4"
          label={singlePhase ? `${singlePhase.phase} 转化率` : best ? `转化率最高：${best.phase}` : "转化率最高的阶段"}
          value={pct(singlePhase ? singlePhase.conversionRate : best?.conversionRate)}
          openLabel={`运营阶段效果报表：${singlePhase ? `${singlePhase.phase} 转化率 ${pct(singlePhase.conversionRate)}` : best ? `转化率最高的是 ${best.phase}，${pct(best.conversionRate)}` : "各阶段转化率都算不出"}`} {...tabProps("phase")}>
          {!singlePhase && !best && <span className="rd-note">各阶段转化率都算不出</span>}
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>对照的阶段</dt><dd>{singlePhase ? singlePhase.phase : `${data.phaseEffect.length} 个（P1–P6）`}</dd></div>
            <div className="rd-stat-row"><dt>阶段切换</dt><dd>{count(data.phaseEffect.reduce((sum, row) => sum + row.transitionCount, 0))} 次</dd></div>
            <div className="rd-stat-row"><dt>阶段参数调整</dt><dd>{count(data.phaseEffect.reduce((sum, row) => sum + row.dialChangeCount, 0))} 次</dd></div>
          </dl>
        </Stat>
      </StatBand>
    </div>
  );

  const links = (key: ReportTab) => {
    const reachable = REPORT_LINKS[key].filter((href) => reach(href));
    if (!reachable.length) return undefined;
    return (
      <nav className="rd-links l4-links" aria-label="去处理">
        <span>去处理</span>
        {reachable.map((href) => <Link key={href} className="rd-link" href={href}>{findByPath(href)?.l2.name ?? href}</Link>)}
      </nav>
    );
  };
  const panel = tabIds.panel(tab) as unknown as Record<string, string>;
  const body = tab === "device" ? <DeviceReport data={data} scope={scope} links={links("device")} panel={panel} />
    : tab === "tasks" ? <TaskReport data={data} scope={scope} links={links("tasks")} panel={panel} />
      : tab === "network" ? <TeamReport data={data} scope={scope} links={links("network")} panel={panel} />
        : <PhaseReport data={data} scope={scope} links={links("phase")} panel={panel} />;

  return (
    <>
      {conclusion}
      {quality}
      {cards}
      {body}
      <HistoryFold data={data} scope={scope} />
    </>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
