"use client";

/**
 * L4 · 设备、任务与团队报表（改版，rd）。
 * 页头（两个导出）→ 筛选栏（时间段、阶段、保存为视图，「现在看」）→ 一句结论 → 四张报表卡（设备、任务、团队、运营阶段效果，
 * 同时是选报表的页签）→ 选中那一类的报表 → 四类共用的时间段表（折叠）。
 * 敏感团队导出持久保存原请求并分阶段恢复；读取、本机视图及导出业务合同保持原样。
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
import { fetchL4NetworkReport, isLOutcomeUnknownError, LOutcomeUnknownError, type L4OperationsQuery } from "@/lib/admin/l-client";
import { displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { downloadL4NetworkSnapshot, isL4NetworkDurable, l4NetworkCommands, l4NetworkGrantRecovery, networkReasonLength, type PendingL4NetworkExport } from "@/lib/admin/l4-network-export";
import { fetchH1Phases } from "@/lib/admin/h-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
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

const phaseText = (phase: L4OperationsQuery["phase"], names: Record<string, string> = {}) => (phase === "ALL" ? "全部阶段" : names[phase] ? `${phase} ${names[phase]}` : phase);

export function L4Ops({ ctx, title, summary }: { ctx: LCtx; title: ReactNode; summary: string }) {
  const reach = useReach();
  const session = useAdminAuth(state => state.session);
  const owner = session ? `${session.adminId}:${session.username}` : "";
  const latestContext = useRef(ctx);
  latestContext.current = ctx;
  const [pendingTree, setPendingTree] = useState<PendingL4NetworkExport | null>(null);
  const syncTree = () => setPendingTree(l4NetworkCommands.list().find(record => record.owner === owner) ?? null);
  useEffect(() => { syncTree(); }, [owner]);
  useEffect(() => {
    if (!pendingTree || isRetryExpired(pendingTree)) return;
    const timer = setTimeout(syncTree, pendingTree.expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [pendingTree]);
  const [phaseNames, setPhaseNames] = useState<Record<string, string>>({});
  const canReadPhaseNames = session?.role?.toLowerCase() === "superadmin" || session?.authorities.includes("growth_h1_read") === true;
  useEffect(() => {
    let cancelled = false;
    setPhaseNames({});
    if (canReadPhaseNames) void fetchH1Phases().then(result => {
      if (!cancelled) setPhaseNames(Object.fromEntries(result.attribution.filter(row => /^P[1-6]$/.test(row.phase) && row.name).map(row => [row.phase, row.name])));
    }).catch(() => {
      // Catalog names are optional: the decided fallback is the original code,
      // without a new H1 permission requirement or an invented name.
      if (!cancelled) setPhaseNames({});
    });
    return () => { cancelled = true; };
  }, [owner, canReadPhaseNames]);
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
      ctx.toast("请先选好开始和结束日期");
      return;
    }
    if (from > to) {
      ctx.toast("开始日期不能晚于结束日期");
      return;
    }
    updateQuery({ period: "custom", from, to });
  };
  const saveView = () => {
    try {
      window.localStorage.setItem("nexion:l4:view", JSON.stringify({ query, tab }));
      ctx.toast("视图已保存在这台电脑的浏览器里", "success");
    } catch {
      ctx.toast("视图没存上：这个浏览器现在存不了网站数据", "error");
    }
  };

  /* ---------------- 运营汇总导出：请求体、命令号、2 秒防连点和改版前一致（L4-A04） ---------------- */
  const aggExportingRef = useRef(false);
  const aggLastSuccessAtRef = useRef(0);
  const [aggExporting, setAggExporting] = useState(false);
  const queryMatchesData = data?.period.key === query.period && data.phaseFilter === query.phase
    && (query.period !== "custom" || Boolean(query.from && query.to
      && data.period.from.slice(0, 10) === query.from && data.period.to.slice(0, 10) === query.to));
  const canExportCurrent = ctx.canExport && data?.available && queryMatchesData
    && !ctx.biLoading && !ctx.biError;
  const dataScope = data ? `${data.period.label} · ${phaseText(data.phaseFilter, phaseNames)}` : "";

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
    const scope = `${data.period.label}（${data.period.from} 至 ${data.period.to}）· ${phaseText(data.phaseFilter, phaseNames)}`;
    setOutcome(null);
    ctx.openActionConfirm({ briefKind: "export",
      title: "导出运营汇总",
      action: "导出运营报表",
      detail: <>按 <b>{data.period.label} · {data.phaseFilter === "ALL" ? "全部阶段" : data.phaseFilter}</b> 导出运营汇总，不含用户明细。</>,
      effect: <StatusTag tone="progress" filled>立即生成</StatusTag>,
      statedBrief: { impact: "生成一份运营汇总 CSV，不改业务数据，留操作记录。", check: "文件按生成那一刻的数存好，以后下载还是这一份。" },
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
        const latest = latestContext.current;
        const auth = useAdminAuth.getState().session;
        if (!auth || `${auth.adminId}:${auth.username}` !== owner
          || !(auth.role?.toLowerCase() === "superadmin" || auth.authorities.includes("bi_l4_write"))
          || !latest.canExport || latest.biLoading || latest.biError || latest.biData?.l4 !== ctx.biData?.l4
          || JSON.stringify(latest.l4Query) !== JSON.stringify(ctx.l4Query)) {
          throw new Error(formatAdminApiError("L4_EXPORT_VIEW_CHANGED", "L4_EXPORT_VIEW_CHANGED"));
        }
        const commandKey = `l4-ops-${crypto.randomUUID()}`;
        aggExportingRef.current = true;
        setAggExporting(true);
        try {
          await ctx.biActions?.createReport(input, reason, commandKey);
          aggLastSuccessAtRef.current = Date.now();
          ctx.toast("运营汇总已生成（按现在看的时间段和阶段）");
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
  const treeLastSuccessAtRef = useRef(0);
  const [treeExporting, setTreeExporting] = useState(false);

  const saveTree = (record: PendingL4NetworkExport) => {
    l4NetworkCommands.remember(record.fingerprint, record.commandKey, record);
    syncTree();
    if (!isL4NetworkDurable(record)) throw new Error(formatAdminApiError("L4_TREE_STORAGE_UNAVAILABLE", "L4_TREE_STORAGE_UNAVAILABLE"));
    return record;
  };

  const downloadTree = async (record: PendingL4NetworkExport) => {
    const result = record.result;
    if (result?.status !== "READY") return;
    if (!isL4NetworkDurable(record)) throw new Error(formatAdminApiError("L4_TREE_STORAGE_UNAVAILABLE", "L4_TREE_STORAGE_UNAVAILABLE"));
    const file = await downloadL4NetworkSnapshot(result.reportId);
    downloadBlob(file.blob, file.fileName);
    syncTree();
    treeLastSuccessAtRef.current = Date.now();
    ctx.closeActionConfirm?.();
    ctx.toast(`团队关系明细已下载 · ${count(result.rowCount)} 行 · 用户编码部分隐藏`);
    setOutcome({ kind: "tree-done", rows: result.rowCount, scope: record.scope, depth: record.request.depth });
    await latestContext.current.reloadBi?.();
  };

  const canQueryTree = session?.role?.toLowerCase() === "superadmin" || session?.authorities.includes("bi_l5_read") === true;
  const queryTree = async (record: PendingL4NetworkExport) => {
    const auth = useAdminAuth.getState().session;
    if (!record.result || !auth || `${auth.adminId}:${auth.username}` !== record.owner
      || !(auth.role?.toLowerCase() === "superadmin" || auth.authorities.includes("bi_l5_read")) || treeExportingRef.current) return;
    treeExportingRef.current = true;
    setTreeExporting(true);
    try {
      const result = await fetchL4NetworkReport(record.result.reportId, record.request);
      if (result.rowCount !== record.result.rowCount || record.result.status === "READY" && result.status !== "READY") {
        throw new Error(formatAdminApiError("L4_TREE_RECEIPT_INVALID", "L4_TREE_RECEIPT_INVALID"));
      }
      saveTree({ ...record, result });
      // The snapshot read does not prove the outcome of a lost grant response.
      // Keep that stage and its evidence; never issue a token from this query.
      await latestContext.current.reloadBi?.();
      ctx.toast(result.status === "PENDING_CONFIRM" ? "已申请，等另一位管理员放行" : `已重新读取报表 ${result.reportId}：已就绪，${count(result.rowCount)} 行`, "success");
    } catch (error) {
      ctx.toast(displayAdminReadError(error), "error");
    } finally {
      treeExportingRef.current = false;
      setTreeExporting(false);
    }
  };

  const treeGrant = pendingTree?.result ? l4NetworkGrantRecovery(pendingTree.result.reportId) : undefined;
  const treeRecoveryBlocked = pendingTree?.result?.status === "PENDING_CONFIRM" ? "等另一位管理员放行后才能下载"
    : !pendingTree?.result && pendingTree && isRetryExpired(pendingTree) || treeGrant && isRetryExpired(treeGrant) ? RETRY_EXPIRED_TEXT
    : treeGrant && !treeGrant.downloadToken ? formatAdminApiError("L4_TREE_GRANT_UNKNOWN", "L4_TREE_GRANT_UNKNOWN") : undefined;

  const requestNetworkTreeExport = (original?: PendingL4NetworkExport) => {
    if (treeExportingRef.current || !ctx.canExportNetworkTree) return;
    if (original ? treeRecoveryBlocked
      : pendingTree || !data || ctx.biLoading || ctx.biError || !queryMatchesData || query.period === "custom" || data.liveFacts.teamRelationships <= 0) return;
    const now = Date.now();
    if (treeLastSuccessAtRef.current && now - treeLastSuccessAtRef.current < 2_000) return;
    if (treeLastSuccessAtRef.current) {
      treeLastSuccessAtRef.current = 0;
    }
    const periodLabel = original ? original.scope.replace(/加入的关系$/, "") : data!.period.label;
    const relationships = original?.relationships ?? data!.liveFacts.teamRelationships;
    const scope = original?.scope ?? `${periodLabel}加入的关系`;
    const downloadOnly = Boolean(original?.result);
    setOutcome(null);
    let attemptedKey = original?.commandKey;
    ctx.openActionConfirm({ briefKind: "export",
      title: downloadOnly ? "下载已生成的团队关系明细" : "导出团队关系明细",
      action: downloadOnly ? "下载团队明细" : "导出团队明细",
      detail: (
        <div>
          <p>按 <b>{periodLabel}</b> 加入的关系导出，行数以导出为准。</p>
          <p>用户编码部分隐藏，不含手机号、昵称。</p>
          <p>下载链接 24 小时有效。</p>
        </div>
      ),
      effect: <StatusTag tone="warn" icon={LockKeyhole}>{downloadOnly ? "敏感导出 · 已就绪" : "敏感导出 · 需要放行"}</StatusTag>,
      statedBrief: downloadOnly ? {
        impact: `下载已经生成的这一份（报表号 ${original?.result?.reportId}），不重新生成；下载会留操作记录。`,
        check: "原来的时间段、追溯次数和理由不能改。",
      } : {
        impact: "提交后生成一份文件，另一位管理员放行后才能下载；不改团队关系和奖励，系统不会通知对方。",
        check: "核对时间段和追溯次数；文件在确认这一刻生成，以后下载还是这一份。",
      },
      facts: (
        <Facts>
          <Fact k="导出什么">每对「上级 · 成员」一行，六列<Explain label="六列分别是什么" content={<>
            <p>成员往上追溯次数以内的每位上级各占一行，所以同一位成员可能有几行，行数可以多于人数。</p>
            <p>「成员用户编码（部分脱敏）」：这一行的成员。</p>
            <p>「根节点用户编码（部分脱敏）」：这一行的上级，可能是直接邀请人，也可能是再往上几层的人。</p>
            <p>「关系深度」：上级往下第几层，1 是直接邀请。</p>
            <p>「V-Rank」：等级，空的写 UNRANKED。</p>
            <p>「关系表累计量 USDT」：成员邀请记录上存的累计量，不是所选时间段的成交额，没有写 0。</p>
            <p>「加入时间」：成员被直接邀请加入的时间，按服务器时间原样写。</p>
          </>} /></Fact>
          <Fact k="时间段">{periodLabel}加入的关系<Explain label="时间段怎么算" content="按关系建立的时间从现在往前算近 1、7 或 30 天，不跟运营阶段和自定义日期走；只能按日、周、月导出。" /></Fact>
          <Fact k="用户编码" tone="warn">部分隐藏<Explain label="隐藏到什么程度" content="编号 4 位以内整个写成 ***，更长的留前 2 位和后 2 位，中间写成 ***。不含手机号、昵称。" /></Fact>
          <Fact k="多少行">{downloadOnly ? `${count(original!.result!.rowCount)} 行（已生成）` : <>现有团队关系 {count(relationships)} 条，实际行数以导出为准<Explain label="行数上限" content="这个数是现在全部团队关系的累计条数，不按时间段和追溯次数筛。一次最多 100,000 行，超过时不导出，也不截断。" /></>}</Fact>
          <Fact k="记录">导出留两条高风险操作记录，下载也留记录</Fact>
          <Fact k="需要的权限">团队关系明细导出权限</Fact>
          {!downloadOnly && <Fact k="理由字数" tone="warn">一个汉字按 9 计，最多约 22 个汉字<Explain label="为什么汉字按 9 计" content="系统现在这样数理由的长度（已报给技术同事修）：汉字算 9，字母和数字算 1。下面的计数就是这么数的，写的内容不会被截短。" /></Fact>}
          {downloadOnly ? <Fact k="下载">下载这一份<Explain label="下载链接" content="下载链接 24 小时内有效，只有你能用。" /></Fact>
            : <Fact k="谁来放行">另一位有这项权限的管理员，不能是你</Fact>}
        </Facts>
      ),
      confirmLabel: original?.result ? "只下载" : "提交申请",
      reasonPlaceholder: "写导出用途，例如：工单号、核对哪个团队",
      reasonMin: 8,
      reasonMax: 200,
      measureReason: networkReasonLength,
      getPendingReason: () => l4NetworkCommands.list().find(record => record.owner === owner)?.request.reason,
      getPendingBusinessValue: () => {
        const request = l4NetworkCommands.list().find(record => record.owner === owner)?.request;
        return request ? { depth: String(request.depth) } : undefined;
      },
      businessForm: {
        kind: "multi-field",
        hint: "次数越多，导出越多；1 次只含直接邀请的好友，最多 10 次。",
        fields: [{
          key: "depth",
          label: "向下追溯的邀请次数",
          current: String(original?.request.depth ?? 3),
          inputKind: "select",
          options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
          optionLabels: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [String(index + 1), `${index + 1} 次`])),
          required: true,
        }],
      },
      run: async (reason, _newValue, businessValue) => {
        if (treeExportingRef.current || !ctx.biActions) return;
        const auth = useAdminAuth.getState().session;
        if (!auth || `${auth.adminId}:${auth.username}` !== owner
          || !(auth.role?.toLowerCase() === "superadmin" || auth.authorities.includes("bi_l4_export_tree"))) {
          throw new Error(formatAdminApiError("PERMISSION_DENIED", "PERMISSION_DENIED"));
        }
        let record = l4NetworkCommands.list().find(item => item.owner === owner);
        if (attemptedKey) {
          if (!record || record.commandKey !== attemptedKey) {
            ctx.closeActionConfirm?.();
            throw new Error(formatAdminApiError("L4_TREE_ALREADY_SETTLED", "L4_TREE_ALREADY_SETTLED"));
          }
          if (!record.result && isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
        } else {
          if (record) throw new Error(formatAdminApiError("L4_TREE_PENDING", "L4_TREE_PENDING"));
          const latest = latestContext.current;
          if (!latest.canExportNetworkTree || latest.biLoading || latest.biError
            || latest.biData?.l4 !== ctx.biData?.l4 || JSON.stringify(latest.l4Query) !== JSON.stringify(ctx.l4Query)) {
            throw new Error(formatAdminApiError("L4_EXPORT_VIEW_CHANGED", "L4_EXPORT_VIEW_CHANGED"));
          }
          const depth = Number(businessValue?.depth ?? "3");
          if (!Number.isInteger(depth) || depth < 1 || depth > 10) throw new Error("追溯次数必须为 1–10");
          if (networkReasonLength(reason) > 200) throw new Error(formatAdminApiError("L4_TREE_REASON_ENCODED_TOO_LONG", "L4_TREE_REASON_ENCODED_TOO_LONG"));
          const request = { period: query.period as "day" | "week" | "month", depth, reason: reason.trim() };
          const fingerprint = JSON.stringify(request);
          const commandKey = `l4-network-tree-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          l4NetworkCommands.remember(fingerprint, commandKey, { owner, request, scope, relationships });
          record = l4NetworkCommands.list().find(item => item.commandKey === commandKey);
          if (record && !isL4NetworkDurable(record)) {
            l4NetworkCommands.forget(fingerprint, commandKey);
            record = undefined;
          }
        }
        syncTree();
        if (!record || !isL4NetworkDurable(record)) throw new Error(formatAdminApiError("L4_TREE_STORAGE_UNAVAILABLE", "L4_TREE_STORAGE_UNAVAILABLE"));
        attemptedKey = record.commandKey;
        treeExportingRef.current = true;
        setTreeExporting(true);
        try {
          if (!record.result) {
            let result;
            try {
              result = await ctx.biActions.createNetworkTreeExport(record.request, record.request.reason, record.commandKey);
            } catch (error) {
              if (isExplicitRejection(error)) {
                l4NetworkCommands.forget(record.fingerprint, record.commandKey);
                attemptedKey = undefined;
                syncTree();
                if (original) { ctx.closeActionConfirm?.(); await latestContext.current.reloadBi?.(); }
              }
              throw error;
            }
            record = saveTree({ ...record, result });
          }
          if (record.result?.status === "PENDING_CONFIRM") {
            ctx.closeActionConfirm?.();
            ctx.toast("已申请，等另一位管理员放行", "success");
            return;
          }
          await downloadTree(record);
        } finally {
          syncTree();
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
  const aggBlocked = readBlocked ?? (!queryMatchesData ? "先应用所选的时间段，再导出" : !data?.available ? "这个时间段没有可导出的数据" : undefined);
  const treeBlocked = pendingTree ? formatAdminApiError("L4_TREE_PENDING", "L4_TREE_PENDING") : readBlocked ?? (!queryMatchesData ? "先应用所选的时间段，再导出" : query.period === "custom" ? "团队明细只能按日、周、月导出" : (data?.liveFacts.teamRelationships ?? 0) <= 0 ? "当前没有可导出的团队关系" : undefined);
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
          <Button icon={<LockKeyhole size={14} aria-hidden />} loading={treeExporting} loadingText="正在生成…" disabledReason={treeBlocked} onClick={() => requestNetworkTreeExport()}>导出团队关系明细</Button>
          <Explain label="团队关系明细是什么" content={<><p>敏感导出：每对「上级 · 成员」一行，一位成员可能有几行；用户编码部分隐藏，不含手机号、昵称；超过 100,000 行时不导出。只按日、周、月的加入时间筛，不跟运营阶段。</p><p>要有团队关系明细导出权限并写理由。创建后，等另一位有这项权限的管理员放行才能下载。</p></>} />
        </span>
      )}
      {ctx.canExport && !ctx.canExportNetworkTree && <span className="rd-toolbar-note">团队关系明细需要专门的导出权限</span>}
      {!ctx.canExport && <span className="rd-toolbar-note">运营汇总导出需要报表导出权限</span>}
    </span>
  ) : undefined;

  const header = (
    <PageHeader
      pageId="L4"
      title={title}
      summary={summary}
      actions={actions}
      meta={<span className="rd-toolbar">
        {readAt && <span>{readAt} 读取（{businessZone().label}）<Explain label="数据时间说明" content="打开时读取，不自动刷新；点「刷新」重读。" /></span>}
        <Button variant="ghost" size="sm" loading={ctx.biLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.reloadBi?.()}>刷新</Button>
      </span>}
      readOnly={!ctx.canExport && !ctx.canExportNetworkTree ? "你只能查看，导出需要报表导出权限" : undefined}
    />
  );

  /* ---------------- 导出结果条（只管显示） ---------------- */
  const shownOutcome: ExportOutcome | null = pendingTree ? {
    kind: "tree-unknown", scope: pendingTree.scope, depth: pendingTree.request.depth,
    at: formatBusinessTimeCompact(new Date(pendingTree.createdAt).toISOString(), ""),
  } : outcome;
  const outcomeNotice = shownOutcome && (() => {
    const outcome = shownOutcome;
    const close = <Button size="sm" onClick={() => setOutcome(null)}>知道了</Button>;
    if (outcome.kind === "agg-done") return (
      <Notice tone="ok" title="已生成运营汇总" action={close}>
        {outcome.scope}，不含个人信息。{exportPageLink(`到「${exportPageName}」下载`)}
      </Notice>
    );
    if (outcome.kind === "agg-unknown") return (
      <Notice tone="warn" title="运营汇总导出结果未知" action={close}>
        快照可能已经生成。{canOpenExportPage
          ? <>先{exportPageLink(`到「${exportPageName}」看有没有这一份`)}，没有再重新导出。</>
          : <>你没有「{exportPageName}」的权限，请找有权限的同事核对，没有再重新导出。</>}
      </Notice>
    );
    if (outcome.kind === "tree-done") return (
      <Notice tone="ok" title="团队关系明细已下载" action={close}>
        {outcome.scope} · 向下追溯 {outcome.depth} 次 · {count(outcome.rows)} 行 · 用户编码部分隐藏。浏览器已开始下载，下载链接 24 小时内有效、只给你用。
      </Notice>
    );
    const report = pendingTree?.result;
    const awaitingApproval = report?.status === "PENDING_CONFIRM";
    const grantUnknown = Boolean(treeGrant && !treeGrant.downloadToken);
    const expired = Boolean(treeGrant && isRetryExpired(treeGrant) || !report && pendingTree && isRetryExpired(pendingTree));
    const askExportPage = (what: string) => (canOpenExportPage ? exportPageLink(`到「${exportPageName}」${what}`) : <>请有「{exportPageName}」权限的同事{what}</>);
    return (
      <Notice tone="warn" title={awaitingApproval ? "已申请团队关系明细，等另一位放行" : !report ? "团队关系明细导出结果未知" : grantUnknown ? "团队关系明细下载结果未知" : treeGrant ? "团队关系明细已生成，还没下载成功" : "团队关系明细已就绪，可以下载"} actionBelow>
        <p>{outcome.scope} · 向下追溯 {outcome.depth} 次{report ? ` · 报表号 ${report.reportId} · ${count(report.rowCount)} 行` : ""} · <span className="rd-keep">{outcome.at} 提交（{businessZone().label}）</span></p>
        <p>{!report
          ? expired
            ? <>可能已经生成了一份快照。已超过 24 小时，只能核对：{askExportPage("看有没有这一份")}。</>
            : <>可能已经生成了一份快照。先{canOpenExportPage ? <>点「查询原结果」到「{exportPageName}」看有没有</> : <>请有「{exportPageName}」权限的同事核对</>}；没有的话，24 小时内可以按原请求重试，不会重复生成。</>
          : awaitingApproval
            ? <>另一位有这项导出权限的管理员放行后才能下载，你不能批自己的申请。放行后点「查询报表」{canOpenExportPage ? <>，或{exportPageLink(`到「${exportPageName}」看进度`)}</> : null}。</>
          : grantUnknown
            ? <>没收到下载链接。为免重复生成链接，这里不能再下载，请找技术同事核对这份报表。</>
            : expired
              ? <>已超过 24 小时，这里不能再下载。{askExportPage("下载这份报表")}。</>
              : <>文件已经生成。点「只下载」下载这一份，不会重新生成。</>}</p>
        {pendingTree && <span className="rd-toolbar">
          {pendingTree.result
            ? <Button size="sm" loading={treeExporting} disabledReason={canQueryTree ? undefined : formatAdminApiError("L4_TREE_QUERY_PERMISSION", "L4_TREE_QUERY_PERMISSION")} onClick={() => void queryTree(pendingTree)}>查询报表</Button>
            : canOpenExportPage && <Link className="rd-link" href={EXPORT_PAGE}>查询原结果</Link>}
          {!awaitingApproval && <Button size="sm" loading={treeExporting} disabledReason={!ctx.canExportNetworkTree ? formatAdminApiError("PERMISSION_DENIED", "PERMISSION_DENIED") : treeRecoveryBlocked} onClick={() => requestNetworkTreeExport(pendingTree)}>{pendingTree.result ? "只下载" : "按原请求重试"}</Button>}
        </span>}
      </Notice>
    );
  })();

  /* ---------------- 筛选栏：时间段、阶段立即读；自定义日期要应用（L4-Q01、L4-Q02、L4-S06） ---------------- */
  const customInvalid = Boolean(from && to && from > to);
  const customChanged = query.period === "custom" && (from !== (query.from ?? "") || to !== (query.to ?? ""));
  const shown = data && !ctx.biLoading && queryMatchesData
    ? `${data.period.label}（${data.period.from} 至 ${data.period.to}）· ${phaseText(data.phaseFilter, phaseNames)}`
    : query.period === "custom" && !(query.from && query.to)
      ? `自定义日期还没应用 · ${phaseText(query.phase, phaseNames)}`
      : `${PERIODS.find(([value]) => value === query.period)?.[1] ?? ""}${query.period === "custom" ? `（${query.from} 至 ${query.to}）` : ""} · ${phaseText(query.phase, phaseNames)} · 正在读取`;
  const scopeExplain = (
    <Explain label="时间段和阶段管哪几块" content={<>
      <p>日、周、月是从现在往前滚动的近 24 小时、7 天、30 天，不是自然日、周、月。自定义按业务日（{businessZone().label}）算，含首尾两天，结束日不能晚于今天，最长 400 天。</p>
      <p>时间段和阶段管设备、任务、团队、运营阶段效果四块里「这段时间」的数。「读取那一刻」的数（在用设备、置换、团队关系）不随它们变。</p>
    </>} />
  );
  const filterBar = (
    <FilterBar
      scope={<span className="rd-filter-group" aria-label="运营报表筛选" role="group">
        <Segments<L4OperationsQuery["period"]> label="报表周期" value={query.period}
          items={PERIODS.map(([value, label]) => ({ value, label }))}
          onChange={(period) => period === "custom" ? updateQuery({ period }) : updateQuery({ period, from: undefined, to: undefined })} />
      </span>}
      sort={<span className="l4-sort">
        <span className="l4-scope rd-filter-result">现在看：{shown}{customChanged && query.period === "custom" && query.from ? " · 输入框里的日期还没应用" : ""}{scopeExplain}</span>
        <span className="l4-pair" data-pair="">
        <Button icon={<Save size={14} aria-hidden />} onClick={saveView}>保存为视图</Button>
        <Explain label="保存为视图存什么" content={<><p>只存在这台电脑的浏览器里，换电脑、换浏览器或清浏览器数据就没了；同一台电脑上的其他账号也会用到它。</p><p>存已经应用的时间段、阶段和正在看的报表，不存还没应用的日期，不存数字，不改统计方式。</p><p>下次打开这页按保存的条件读取。</p></>} />
        </span>
      </span>}
    >
      <FilterField label="运营阶段">
        <Select aria-label="运营阶段 筛选" value={query.phase}
          onChange={(value) => updateQuery({ phase: value as L4OperationsQuery["phase"] })}
          options={[{ value: "ALL", label: "全部阶段（P1–P6）" }, ...[1, 2, 3, 4, 5, 6].map((phase) => ({ value: `P${phase}`, label: phaseText(`P${phase}` as L4OperationsQuery["phase"], phaseNames) }))]} />
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
      <Conclusion state="unknown">{ctx.biLoading ? "运营报表：正在读取" : ctx.biError ? "运营报表：读取失败，暂时无法判断" : waitingCustom ? "运营报表：等待所选时间段的数据" : "运营报表：没有读到数据"}</Conclusion>
      {ctx.biLoading
        ? <BlockState state="loading" title="正在读取设备、任务、团队和各阶段的数…" />
        : ctx.biError
          ? <BlockState state="error" title="运营数据读取失败，不显示旧数据" detail={`${ctx.biError} 可以换一个时间段再读；还是失败的话，请把错误信息发给技术同事。`} onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />
          : waitingCustom
            ? <BlockState state="empty" title="选好开始和结束日期，点「应用日期」后读取" detail="自定义日期按业务日算，含首尾两天。" />
            : <BlockState state="empty" title="这次没有读到运营数据" detail="请重新加载；仍然没有，请把情况告诉技术同事。" onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />}
    </>);
  }

  /* ---------------- 一句结论 ---------------- */
  return page(<L4Body data={data} tab={tab} setTab={setTab} tabIds={tabIds} reach={reach} phaseNames={phaseNames} />);
}

function L4Body({ data, tab, setTab, tabIds, reach, phaseNames }: {
  data: L4OperationsData;
  tab: ReportTab;
  setTab: (tab: ReportTab) => void;
  tabIds: ReturnType<typeof useTabIds>;
  reach: ReturnType<typeof useReach>;
  phaseNames: Record<string, string>;
}) {
  const scope = `${data.period.label} · ${phaseText(data.phaseFilter, phaseNames)}`;
  const t = data.tasks.summary;
  const rate = t.acceptanceRate;
  const low = rate !== null && rate < ACCEPTANCE_WARN;
  const taskPage = findByPath("/devices/tasks");

  const conclusion = !data.available ? (
    <Conclusion state="neutral" icon={Activity} hint="换一个时间段或阶段再看。" explain="在用设备、置换和团队关系是读取那一刻的数，照常显示。">
      运营报表：{scope}没有运营事件
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
    <Notice tone="warn" title="部分事件没有用户编号">
      能认出用户的事件只占 {pct(data.quality.actorCoveragePct)}，按人算的承接率、推广率、触发率、留存率和转化率先写「—」。
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
          label={singlePhase ? `${phaseText(singlePhase.phase as L4OperationsQuery["phase"], phaseNames)} 转化率` : best ? `转化率最高：${phaseText(best.phase as L4OperationsQuery["phase"], phaseNames)}` : "转化率最高的阶段"}
          value={pct(singlePhase ? singlePhase.conversionRate : best?.conversionRate)}
          openLabel={`运营阶段效果报表：${singlePhase ? `${phaseText(singlePhase.phase as L4OperationsQuery["phase"], phaseNames)} 转化率 ${pct(singlePhase.conversionRate)}` : best ? `转化率最高的是 ${phaseText(best.phase as L4OperationsQuery["phase"], phaseNames)}，${pct(best.conversionRate)}` : "各阶段转化率都算不出"}`} {...tabProps("phase")}>
          {!singlePhase && !best && <span className="rd-note">各阶段转化率都算不出</span>}
          <dl className="rd-stat-rows">
            <div className="rd-stat-row"><dt>对照的阶段</dt><dd>{singlePhase ? phaseText(singlePhase.phase as L4OperationsQuery["phase"], phaseNames) : `${data.phaseEffect.length} 个（P1–P6）`}</dd></div>
            <div className="rd-stat-row"><dt>阶段切换</dt><dd>{count(data.phaseEffect.reduce((sum, row) => sum + row.transitionCount, 0))} 次</dd></div>
            <div className="rd-stat-row"><dt>阶段参数调整</dt><dd>{count(data.phaseEffect.reduce((sum, row) => sum + row.dialChangeCount, 0))} 次</dd></div>
          </dl>
        </Stat>
      </StatBand>
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
        : <PhaseReport phaseNames={phaseNames} data={data} scope={scope} links={links("phase")} panel={panel} />;

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
