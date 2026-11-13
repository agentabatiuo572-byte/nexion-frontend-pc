"use client";

/**
 * L5 · 数据导出与监管报告（改版，rd）— 全平台数据出口。
 * 一句结论（有没有等我放行的）→ 四个数 → 导出任务（待放行卡在前，其余一张表，8 条一页）
 * → 新建导出三张卡（汇总、当前披露快照、8 类账单，去向不同）→ 参考页签（导出规则、字段脱敏、导出记录）。
 * 读取、筛选、翻页、四种提交和下载的请求沿用改版前的写法（请求逐字节不变），这里只换界面。
 * 明文敏感字段导出保持服务端阻断。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Ban, Download, FilePlus2, FileSpreadsheet, Files, Inbox, ListChecks, LockKeyhole, ReceiptText, RefreshCw, RotateCcw,
  ScrollText, ShieldCheck, ShieldQuestion,
} from "lucide-react";
import {
  BlockState, Button, Cell, Conclusion, Explain, Fact, Facts, Fold, IconTile, IrreversibleTag, Notice, PageHeader, PageTabs, Panel,
  Segments, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { num, rec, rows, str } from "./live-data";
import {
  fetchL5ExportAudits,
  fetchL5ExportTasks,
  fetchL5RegulatoryOptions,
  isLOutcomeUnknownError,
  type AdminPage,
  type LExportAuditRow,
  type LExportTask,
  type LRegulatoryOptions,
} from "@/lib/admin/l-client";
import { downloadD4BillsCsv } from "@/lib/admin/d-client";
import { businessZone } from "@/lib/admin/business-time";
import { useReach } from "@/lib/nav/use-reach";
import type { LCtx } from "./types";
import { clampL5Page, l5PageCount } from "./l5-pagination";
import { isL5KpiExport, l5KpiRange } from "./l5-kpi-range";
import {
  AuditTable, L5RecoveryNotice, MaskRuleTable, MaskTag, PendingCard, RouteFacts, TaskStatusTag, pageName, rowsText, taskSource, taskTitle,
  type L5RecoveryItem, type MaskRule,
} from "./l5-export-views";

function reportScopeText(value: string): string {
  const scope = /^(L[1-4]) \{(.*)\}$/.exec(value) ?? /^(.*)；切片=\{(.*)\}$/.exec(value);
  if (!scope) return value.replace(/ \/ platform$/, " / 平台汇总").replace(/ \/ user$/, " / 用户明细");
  const labels: Record<string,string> = {stage:"转化步骤",window:"统计窗口",from:"开始日期",to:"结束日期",cohort:"注册用户组",phase:"运营阶段",locale:"语言",ref:"推荐渠道"};
  const parts = scope[2].split(",").map(part => {
    const split = part.indexOf("=");
    if (split < 0) return part.trim();
    const key = part.slice(0,split).trim(), raw = part.slice(split+1).trim();
    if (!raw) return "";
    const label = key === "window" ? ({"7d":"近 7 天","30d":"近 30 天",custom:"自定义日期"} as Record<string,string>)[raw] ?? raw : raw;
    return `${labels[key] ?? key}：${label}`;
  }).filter(Boolean);
  return `${scope[1]} · ${parts.join(" · ") || "默认范围"}`;
}

type ExportParam = { k: string; v: string; fixed?: boolean; cur?: string; s: string };

/** 导出任务状态筛选(索引 = filter 状态值;label 同时用于按钮文本与切换 toast)。 */
const L5_TASK_FILTERS = ["全部", "待放行", "生成中", "已就绪（含旧任务）"] as const;

const LEDGER_PAGE = "/finance/ledger";
const L3_PAGE = "/analytics/financial";
const L4_PAGE = "/analytics/operations";
const I5_PAGE = "/content/disclosures";
const AUDIT_PAGE = "/platform/audit";

function downloadBlob(blob: Blob, fileName: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

function exportTypeText(value: string) { return value.replace(/^KPI/, "关键指标").replaceAll("聚合", "汇总"); }

/** 这个账号能导的汇总类型，按全站页名写；提交仍用原 label（协议依赖）。 */
const AGGREGATE_NAME: Record<string, string> = { "KPI 序列": "关键指标", "漏斗序列": "转化与留存", "财务聚合": "财务", "运营聚合": "运营" };
function aggregateNames(types: readonly string[]) { return types.map((type) => AGGREGATE_NAME[type] ?? exportTypeText(type)).join("、"); }

type Outcome =
  | { kind: "summary-done"; text: string }
  | { kind: "summary-unknown" }
  | { kind: "reg-done"; text: string }
  | { kind: "reg-unknown"; text: string };

type RefTab = "tasks" | "rules" | "masks" | "audit";

export function L5Export({ ctx, title, summary }: { ctx: LCtx; title: ReactNode; summary: string }) {
  const { toast } = ctx;
  const reach = useReach();
  const [filter, setFilter] = useState(0);
  const [taskPageNum, setTaskPageNum] = useState(1);
  const [taskPageResult, setTaskPage] = useState<{
    source: unknown; status: string; pageNum: number; page: AdminPage<LExportTask>;
  } | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [ledgerExporting, setLedgerExporting] = useState(false);
  const [regulatoryOptions, setRegulatoryOptions] = useState<LRegulatoryOptions | null>(null);
  const [regulatoryLoading, setRegulatoryLoading] = useState(false);
  const [regulatoryError, setRegulatoryError] = useState<string | null>(null);
  const [auditRows, setAuditRows] = useState<LExportAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  // 以下只管界面：页上方的结果条、行内按钮转圈、参考页签。
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [refTab, setRefTab] = useState<RefTab>("tasks");
  const refIds = useTabIds();
  const createRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const data = ctx.biData?.l5;
  const filterStatus =
    filter === 1 ? "PENDING_CONFIRM,PENDING_SPLIT_CONFIRM"
    : filter === 2 ? "GENERATING"
    : filter === 3 ? "READY"
    : "";
  const taskPage = taskPageResult && taskPageResult.source === data
    && taskPageResult.status === filterStatus && taskPageResult.pageNum === taskPageNum
    ? taskPageResult.page : null;
  useEffect(() => {
    if (!data) {
      setTaskPage(null);
      setTaskLoading(false);
      return;
    }
    let alive = true;
    setTaskPage(null);
    setTaskLoading(true);
    setTaskError(null);
    fetchL5ExportTasks(filterStatus, taskPageNum, 8)
      .then((page) => {
        if (!alive) return;
        const clampedPage = clampL5Page(taskPageNum, page.total, page.pageSize);
        if (clampedPage !== taskPageNum) {
          setTaskPage(null);
          setTaskPageNum(clampedPage);
          return;
        }
        setTaskPage({ source: data, status: filterStatus, pageNum: taskPageNum, page });
      })
      .catch((error) => {
        if (alive) setTaskError(error instanceof Error ? displayAdminReadError(error) : "导出任务加载失败");
      })
      .finally(() => {
        if (alive) setTaskLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [filterStatus, taskPageNum, data]);
  useEffect(() => {
    if (!data) {
      setRegulatoryOptions(null);
      setAuditRows([]);
      return;
    }
    let alive = true;
    setRegulatoryLoading(true);
    setRegulatoryError(null);
    void fetchL5RegulatoryOptions()
      .then((value) => { if (alive) setRegulatoryOptions(value); })
      .catch((error) => { if (alive) setRegulatoryError(error instanceof Error ? displayAdminReadError(error) : "当前披露快照选项加载失败"); })
      .finally(() => { if (alive) setRegulatoryLoading(false); });
    setAuditLoading(true);
    setAuditError(null);
    void fetchL5ExportAudits()
      .then((value) => { if (alive) setAuditRows(value); })
      .catch((error) => { if (alive) setAuditError(error instanceof Error ? displayAdminReadError(error) : "导出记录加载失败"); })
      .finally(() => { if (alive) setAuditLoading(false); });
    return () => { alive = false; };
  }, [data]);

  /* ---------------- 页头、结果条：读到数据之前也要有 ---------------- */
  const exportTypes = ctx.availableAggregateExportTypes ?? [];
  const canCreateSomething = (Boolean(ctx.canExport) && exportTypes.length > 0) || Boolean(ctx.canGenerateRegulatory) || Boolean(ctx.canExportLedger);
  const readOnly = !canCreateSomething && !ctx.canApproveExportTasks
    ? "当前角色只能查看，有来源权限的任务可以下载" : undefined;
  const scrollTo = (target: HTMLElement | null) => {
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
    target?.querySelector<HTMLElement>("[data-l5-focus]")?.focus({ preventScroll: true });
  };
  const header = (
    <PageHeader
      pageId="L5"
      title={title}
      summary={summary}
      actions={canCreateSomething && data ? <Button icon={<FilePlus2 size={14} aria-hidden />} onClick={() => { setRefTab("tasks"); requestAnimationFrame(() => scrollTo(createRef.current)); }}>新建导出</Button> : undefined}
      meta={<span className="rd-toolbar">
        <span>打开页面时读取，不自动刷新</span>
        <Button variant="ghost" size="sm" loading={ctx.biLoading} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.reloadBi?.()}>刷新</Button>
      </span>}
      readOnly={readOnly}
    />
  );
  const listLink = <button type="button" className="rd-link l5-inline-link" onClick={() => { setFilter(0); setTaskPageNum(1); setRefTab("tasks"); requestAnimationFrame(() => scrollTo(listRef.current)); }}>到下面任务列表</button>;
  const outcomeNotice = outcome && (() => {
    const close = <Button size="sm" onClick={() => setOutcome(null)}>知道了</Button>;
    if (outcome.kind === "summary-done") return (
      <Notice tone="ok" title="已生成汇总数据" action={close}>{outcome.text}。{listLink}下载。</Notice>
    );
    if (outcome.kind === "summary-unknown") return (
      <Notice tone="warn" title="汇总导出结果未知" action={close} actionBelow>
        请求已发出，但没有收到明确结果，可能已经生成。先{listLink}看有没有这一份，没有再重新导出；导出不改业务数据。
      </Notice>
    );
    if (outcome.kind === "reg-done") return (
      <Notice tone="ok" title="已生成当前披露快照" action={close}>{outcome.text}。{listLink}下载。</Notice>
    );
    return (
      <Notice tone="warn" title="当前披露快照生成结果未知" action={close} actionBelow>
        <p>{outcome.text}</p>
        <p>请求已发出，但没有收到明确结果，快照可能已经生成。先{listLink}看有没有这一份，没有再重新生成；生成不改业务数据。</p>
      </Notice>
    );
  })();
  // R1：放行、重新发起会改任务状态。结果未知时的本机保存、查询原结果、按原请求重试由代码 worker 接（说明 B01），
  // 接好后把保存的原记录拼成这里的行（哪一份、谁申请的、什么时候放行的），按钮调用原有的查询和原号重试。
  const recoveryRows: L5RecoveryItem[] = [];
  const recoveryIds = new Set(recoveryRows.map((row) => row.reportId));

  if (!data) return (
    <>
      {header}
      {outcomeNotice}
      <L5RecoveryNotice rows={recoveryRows} />
      <Conclusion state="unknown" icon={ShieldQuestion}>{ctx.biLoading ? "导出任务：正在读取" : ctx.biError ? "导出任务：读取失败，暂时无法判断有没有等你放行的" : "导出任务：还没有数据"}</Conclusion>
      {ctx.biLoading
        ? <BlockState state="loading" title="正在读取导出任务、统计和规则…" />
        : ctx.biError
          ? <BlockState state="error" title="导出数据读取失败，不显示旧数据，创建、放行和下载都先关着" detail={`${ctx.biError} 请先重新加载；还是失败的话，请把错误信息发给技术同事。`} onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />
          : <BlockState state="empty" title="还没有可显示的导出数据" detail="请先重新加载；仍然为空，说明还没有产生数据。" onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />}
    </>
  );

  const summaryRaw = rec(data.summary);
  const L5_STATS = {
    total: num(summaryRaw.totalReports, rows<LExportTask>(data.exportTasks).length),
    ready: num(summaryRaw.readyReports),
    sensitive: num(summaryRaw.sensitiveReports),
    pending: num(summaryRaw.pendingConfirm),
    legacyReadyWithoutSnapshot: num(summaryRaw.legacyReadyWithoutSnapshot),
  };
  const EXPORT_TASKS = taskPage?.records ?? [];
  const MASK_RULES = rows<MaskRule>(data.maskRules);
  const EXPORT_PARAMS = rows<ExportParam>(data.exportParams);
  const AUDIT_ROWS = auditLoading || auditError ? [] : auditRows;
  const CROSS_MODULE_BLOCKERS = rows<{ code: string; label: string; status: string; reason: string }>(data.crossModuleBlockers);
  const effSt = (t: LExportTask): string => t.st.toUpperCase();
  const effActs = (t: LExportTask): LExportTask["acts"] => t.acts;
  const visibleTasks = EXPORT_TASKS;
  const taskPageSize = taskPage?.pageSize ?? 8;
  const taskTotal = taskPage?.total ?? visibleTasks.length;
  const taskPages = l5PageCount(taskTotal, taskPageSize);
  const retryTask = async (t: LExportTask) => {
    await ctx.biActions?.reportAction(t.id, "rerun", "重新生成当前报表任务", t.pii);
    await ctx.reloadBi?.();
    toast(`${t.id} 已重新发起${t.pii ? "（含隐私数据，需要重新确认）" : ""}`);
  };
  const l3Name = pageName(L3_PAGE, "财务报表");
  const requestApproveTask = (t: LExportTask, requester: string) => ctx.openActionConfirm({ briefKind: "record",
    action: "审批脱敏资金明细",
    title: "放行脱敏资金明细",
    detail: <>任务 <span className="mono">{t.id}</span> 的数据会保持隐藏隐私，审批不会解密任何字段。批准后就能下载，下载链接 24 小时有效。</>,
    effect: <><StatusTag tone="warn" icon={LockKeyhole} filled>放行后有权限的人就能下载</StatusTag><IrreversibleTag>放行后不能撤回</IrreversibleTag></>,
    confirmTone: "danger",
    confirmLabel: "确认放行",
    statedBrief: {
      impact: "放行后这份脱敏明细变成可下载，用的是申请时生成的那份文件：不解密任何字段、不重新取数、不改余额。放行后没有收回的入口。",
      check: "核对范围、字段和行数是不是申请人工单里要的；看不懂这份申请就先别放行，找申请人确认。",
    },
    facts: (
      <Facts>
        <Fact k="行数" lead={t.rows !== "—"} unit={t.rows !== "—" ? "行" : undefined}>{rowsText(t.rows)}</Fact>
        <Fact k="导出的是什么">{taskTitle(t, exportTypeText)} · <span data-mono="">{t.id}</span></Fact>
        <Fact k="范围">{reportScopeText(t.scope)}</Fact>
        <Fact k="字段">{operatorCopyText(t.fields)}</Fact>
        <Fact k="脱敏到什么程度" tone="warn">只隐藏用户编码，留前 2 位和后 2 位<Explain label="脱敏到什么程度" content={<><p>用户编码 4 位以内整个写成 ***。</p><p>业务编号、金额、余额、交易时间都是原值；不导出手机号、昵称、备注。系统不允许解密导出。</p></>} /></Fact>
        <Fact k="申请人">{requester}</Fact>
        <Fact k="放行后谁能下载">有资金明细导出权限的管理员，含申请人<Explain label="谁能下载" content="下载要「财务资金明细导出」权限（bi_l3_export_detail）。你放行不需要这项权限；没有它，你自己下载不了。" /></Fact>
        <Fact k="能下多久">一直可下载；每次下载签发一个只给本人用、24 小时内有效的链接</Fact>
        <Fact k="留什么记录">放行写进「{pageName(AUDIT_PAGE, "操作记录与审批")}」，每次下载也会记录</Fact>
        <Fact k="谁能放行">另一位管理员，需有导出任务审批权限（bi_l5_task_approve）；申请人不能放行自己的申请</Fact>
      </Facts>
    ),
    reasonPlaceholder: "写放行依据，例如：已核对申请人的工单号和用途",
    reasonMin: 8,
    reasonMax: 200,
    run: async (reason) => {
      await ctx.biActions?.reportAction(t.id, "approve", reason, true);
      await ctx.reloadBi?.();
      toast(`${t.id} 脱敏明细审批通过 · 可签发 24 小时下载令牌`);
    },
  });
  const downloadTask = async (t: LExportTask) => {
    const file = await ctx.biActions?.downloadReport(t.id);
    if (file) downloadBlob(file.blob, file.fileName);
    toast(`${t.id} 开始下载`);
  };
  const downloadLedger = async (reason: string) => {
    setLedgerExporting(true);
    try {
      await downloadD4BillsCsv({}, reason);
      toast("8 类账单明细已下载（最多 10 万行，已隐藏隐私）");
    } finally {
      setLedgerExporting(false);
    }
  };
  const ledgerName = pageName(LEDGER_PAGE, "账本与账单核对");
  const requestLedgerDownload = () => ctx.openActionConfirm({ briefKind: "export",
    action: "导出八类账单脱敏明细",
    title: "导出 8 类账单明细",
    detail: <>导出 8 类账单；用户编号会隐藏部分字符，最多 10 万行，导出原因和范围都有记录。</>,
    effect: <StatusTag tone="progress" filled>直接下载 CSV</StatusTag>,
    statedBrief: {
      impact: "马上生成并下载一个 CSV 文件，不进任务列表，也没有下载链接；不改余额和账单。",
      check: `这里不能缩小范围：全平台所有时间的 8 类账单，超过 10 万行会被拒；要按日期、用户筛，到「${ledgerName}」导出。`,
    },
    facts: (
      <Facts>
        <Fact k="范围">全平台、所有时间、各种状态的 8 类账单<Explain label="8 类是哪些" content="兑换、充值、提现、收益、团队奖励、退款、奖励、购买。按创建时间从新到旧，不限已结算。" /></Fact>
        <Fact k="文件">d4-bills-masked.csv，11 列<Explain label="11 列是什么" content="账单号、用户编号（脱敏）、类型、子类型、资产、方向、金额、变动后余额、状态、业务编号、创建时间。金额是原币原值，不换算、不舍入。" /></Fact>
        <Fact k="脱敏" tone="warn">用户编号只留首 1 位和末 2 位<Explain label="脱敏到什么程度" content="业务编号里和该用户编号相同的一段会被替换，其余原样；不导出昵称、备注。" /></Fact>
        <Fact k="上限">最多 100,000 行，超过会被拒</Fact>
        <Fact k="怎么拿到">确认后浏览器直接下载，不进任务列表，没有 24 小时链接</Fact>
        <Fact k="留什么记录">每次导出写进导出记录</Fact>
      </Facts>
    ),
    confirmLabel: "确认导出",
    reasonPlaceholder: "写这份账单给谁、做什么用，例如：月度对账工单号",
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => downloadLedger(reason),
  });
  const newExport = () => ctx.openActionConfirm({ briefKind: "export",
    action: "导出汇总数据",
    title: "导出汇总数据",
    detail: <>你可以导出：{exportTypes.map(exportTypeText).join("、")}。导出的是汇总数据，不含用户明细和隐私信息，确认后就能下载。</>,
    effect: <StatusTag tone="progress" filled>立即生成</StatusTag>,
    statedBrief: {
      impact: "按所选类型生成一份汇总 CSV，创建这一刻取数，以后下载还是这一刻的数；不改任何业务数据。",
      check: "核对类型和时间范围；只有关键指标按所选时间取数，其他三类见「时间范围怎么算」。",
    },
    facts: (
      <Facts>
        <Fact k="时间范围怎么算">关键指标按所选时间窗取数<Explain label="时间范围怎么算" content={<><p>关键指标：按所选的近 1、7、30 天或自选日期（{businessZone().label}业务日，最长 400 天，不含未来）。</p><p>转化与留存：时间范围只记在任务里，不按它筛日期。</p><p>财务：此刻的财务快照，不按时间筛。</p><p>运营：只认「period=…;phase=…」这种写法，其他文字按近一周、全部阶段算。</p></>} /></Fact>
        <Fact k="去哪下载">生成后在任务列表下载，不用放行</Fact>
      </Facts>
    ),
    confirmLabel: "确认导出",
    reasonPlaceholder: "写这份汇总给谁、做什么用，例如：周报分析",
    reasonMin: 8,
    reasonMax: 200,
    businessForm: {
      kind: "export-wizard",
      mode: "aggregate-only",
      kpiStructuredRange: true,
      exportTypes: [...exportTypes],
      piiLevels: ["无隐私信息"],
      maskPolicies: ["无需脱敏（仅聚合）"],
    },
    run: async (reason, _v, bv) => {
      const range = isL5KpiExport(String(bv?.exportType ?? ""))
        ? l5KpiRange(bv ?? {}) : { timeRange: String(bv?.timeRange ?? "ON_DEMAND") };
      const summary = `${bv?.exportType} · ${range.timeRange} · 聚合字段[${bv?.fields || "默认汇总项"}] · 用途 ${bv?.recipient}`;
      try {
        await ctx.biActions?.createReport({
          exportType: String(bv?.exportType ?? "后台导出报表"),
          ...range,
          fields: String(bv?.fields || "聚合指标"),
          piiLevel: String(bv?.piiLevel ?? "无隐私信息"),
          maskPolicy: "NONE",
          recipient: String(bv?.recipient ?? "未指定"),
          ticket: String(bv?.ticket ?? "L5-EXPORT"),
        }, reason);
      } catch (error) {
        // 结果未知仍交给外壳关框、重读、提示（l-view）；这里只在页面上方留一条核对提示（决定 B4-PD02，不做 R1）。
        if (isLOutcomeUnknownError(error)) setOutcome({ kind: "summary-unknown" });
        throw error;
      }
      await ctx.reloadBi?.();
      ctx.toast(`已生成：${summary} · 可在下方任务列表下载`);
      setOutcome({ kind: "summary-done", text: `${exportTypeText(String(bv?.exportType ?? ""))} · ${range.timeRange} · 用途 ${bv?.recipient}` });
    },
  });
  const i5Name = pageName(I5_PAGE, "法律条款与风险披露");
  const requestRegulatoryReport = () => {
    const templates = regulatoryOptions?.templates ?? [];
    const disclosures = regulatoryOptions?.disclosures ?? [];
    if (templates.length === 0 || disclosures.length === 0) {
      toast(regulatoryError || "「风险披露」里还没有可用于生成当前披露快照的完整（7 章）版本");
      return;
    }
    const disclosureValues = disclosures.map((item) => `${item.jurisdictionCode}|${item.disclosureVersion}`);
    ctx.openActionConfirm({ briefKind: "export",
      action: "生成当前披露快照",
      title: "生成当前披露快照",
      detail: <>会检查所选地区当前生效的披露版本是否 7 章齐全，再汇总财务、运营、账单、操作记录和应急处理数据生成报告。报告不含用户明细和隐私信息。</>,
      effect: <StatusTag tone="progress" filled>立即生成</StatusTag>,
      statedBrief: {
        impact: "生成一份汇总报告放进任务列表，立即可下载；不改披露版本、不通知用户、不改业务数据。",
        check: "核对地区和版本是不是要报送的那一份；报告期间只写进报告的说明行，不按它筛数据。",
      },
      facts: (
        <Facts>
          <Fact k="报告里有什么">所选地区当前版本的七章完整性、确认进度、拦截数，加模板对应的汇总<Explain label="报告里有什么" content={<><p>三个模板共有：披露章节、影响用户、确认进度、被拦截用户、此前导出记录数、应急预案执行数。</p><p>提现发放、反洗钱：再加储备、应付款、覆盖率、24 小时净流量、提现队列和账单行数。适用地区专项：再加设备、算力任务、团队关系、佣金和以旧换新，按本月、全部阶段。</p><p>财务和账单是全平台的数，不按地区和报告期间筛。缺的数在文件里写 UNAVAILABLE，不估算。</p></>} /></Fact>
        <Fact k="个人信息">不含单个用户明细</Fact>
        <Fact k="地区和版本">「{i5Name}」当前生效的设置<Explain label="地区和版本" content="生成时后端再核对一次：所选版本已不是当前版本、或不再 7 章齐全，会被拒。" /></Fact>
        <Fact k="去哪下载">下面任务列表，生成后立即可下载，不用放行</Fact>
      </Facts>
    ),
    confirmLabel: "确认生成",
    reasonPlaceholder: "写报送对象和依据，例如：季度监管报送工单号",
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        fields: [
          { key: "templateCode", label: "报告模板", inputKind: "select", current: templates[0].code, options: templates.map((item) => item.code), optionLabels: Object.fromEntries(templates.map((item) => [item.code, item.label])) },
          { key: "jurisdictionVersion", label: "适用地区 / 披露版本", inputKind: "select", current: disclosureValues[0], options: disclosureValues, optionLabels: Object.fromEntries(disclosures.map((item) => [`${item.jurisdictionCode}|${item.disclosureVersion}`, `${item.jurisdictionName} (${item.jurisdictionCode}) · ${item.disclosureVersion} · ${item.chapterCount}章`])) },
          { key: "period", label: "报告期间", placeholder: "如 2026-07 / 2026-Q3", explain: "只写进报告的说明行，不按它筛财务、运营和账单数据。" },
          { key: "recipient", label: "接收机构 / 用途", placeholder: "如 合规团队 / 监管报送", explain: "会写进操作记录。" },
          { key: "ticket", label: "业务工单", placeholder: "如 99105-L5-REG-001", explain: "会写进操作记录。" },
        ],
      },
      run: async (reason, _value, business) => {
        const [jurisdictionCode, disclosureVersion] = String(business?.jurisdictionVersion ?? "").split("|", 2);
        const shown = `${templates.find((item) => item.code === String(business?.templateCode ?? ""))?.label ?? String(business?.templateCode ?? "")} · ${jurisdictionCode} ${disclosureVersion} · 期间 ${String(business?.period ?? "")}`;
        try {
          await ctx.biActions?.createRegulatoryReport({
            templateCode: String(business?.templateCode ?? ""),
            period: String(business?.period ?? ""),
            jurisdictionCode,
            disclosureVersion,
            recipient: String(business?.recipient ?? ""),
            ticket: String(business?.ticket ?? ""),
          }, reason);
        } catch (error) {
          // 结果未知仍交给外壳关框、重读、提示；页面上方留一条核对提示（决定 B4-PD02）。
          if (isLOutcomeUnknownError(error)) setOutcome({ kind: "reg-unknown", text: shown });
          throw error;
        }
        await ctx.reloadBi?.();
        toast("当前披露快照已生成，可在下方任务列表下载");
        // B02：回复没有读到创建回执也会走到这里。代码 worker 修好后，只在读到 created 回执时显示「已生成」。
        setOutcome({ kind: "reg-done", text: shown });
      },
    });
  };

  /* ---------------- 结论和四个数 ---------------- */
  const pending = L5_STATS.pending;
  const selectFilter = (next: number) => {
    setFilter(next);
    setTaskPageNum(1);
    toast(`任务列表筛选:${L5_TASK_FILTERS[next]}`);
  };
  const toggleFilter = (next: number) => {
    selectFilter(filter === next ? 0 : next);
    setRefTab("tasks");
    requestAnimationFrame(() => scrollTo(listRef.current));
  };
  const conclusion = pending > 0
    ? ctx.canApproveExportTasks
      ? <Conclusion state="warn" icon={Inbox} lead hint={<>在下面「等待放行」逐份核对后放行；你自己申请的要另一位管理员放行。</>}
          explain="待放行 = 含隐私的脱敏资金明细，在「财务报表」申请后停在这里，另一位管理员放行前谁都不能下载。数的是全部待放行任务，不分谁申请的。">
          有 <b>{pending}</b> 份高敏导出等待放行
        </Conclusion>
      : <Conclusion state="neutral" icon={Inbox} hint="你没有放行权限；有导出审批权的管理员放行后，有来源权限的人才能下载。">
          有 {pending} 份高敏导出等待另一位管理员放行
        </Conclusion>
    : <Conclusion state="ok" icon={ShieldCheck}>没有等待放行的导出，可下载 {L5_STATS.ready} 份</Conclusion>;
  const stats = (
    <StatBand label="导出任务统计">
      <Stat icon={Inbox} tone={pending > 0 ? "warn" : undefined} label="等待放行" value={String(pending)} unit="份"
        explain="含隐私的脱敏明细，要另一位管理员放行后才能下载。点这格只看待放行的任务。"
        onOpen={() => toggleFilter(1)} openLabel={`等待放行 ${pending} 份，点击只看待放行`} selected={filter === 1} selectedText="已筛选" aria-pressed={filter === 1} />
      <Stat icon={Download} tone="role-2" label="可下载" value={String(L5_STATS.ready)} unit="份"
        sub={L5_STATS.legacyReadyWithoutSnapshot > 0 ? `另有 ${L5_STATS.legacyReadyWithoutSnapshot} 份旧任务没有文件` : undefined}
        explain="已生成、有文件的任务。下载时每次签发一个只给你用、24 小时内有效的链接。点这格只看已就绪的任务（含没有文件的旧任务）。"
        onOpen={() => toggleFilter(3)} openLabel={`可下载 ${L5_STATS.ready} 份，点击只看已就绪`} selected={filter === 3} selectedText="已筛选" aria-pressed={filter === 3} />
      <Stat icon={LockKeyhole} tone="role-3" label="含隐私任务" value={String(L5_STATS.sensitive)} unit="份"
        explain="文件里有脱敏后的用户编码这类字段（资金明细、团队树）。只能导出脱敏后的数据，不能导出原文。" />
      <Stat icon={Files} tone="role-other" label="累计导出任务" value={String(L5_STATS.total)} unit="份"
        explain="六类导出任务的总数，不分谁创建的；不含 8 类账单直接下载（那个不进任务列表）。" />
    </StatBand>
  );

  /* ---------------- 导出任务：待放行卡在前，其余一张表 ---------------- */
  const requesterText = (t: LExportTask) => !ctx.canApproveExportTasks ? "—"
    : t.approvalEligibility === "SELF" ? "你本人"
    : t.approvalEligibility === "ELIGIBLE" ? "另一位管理员"
    : "发起记录核对不上";
  const isPendingCard = (t: LExportTask) => t.supported && effActs(t).includes("approve");
  const pendingTasks = visibleTasks.filter(isPendingCard);
  const otherTasks = visibleTasks.filter((t) => !isPendingCard(t));
  const approveAction = (t: LExportTask) => {
    const approvalBlocked = !ctx.canApproveExportTasks ? "你没有放行权限，要有导出任务审批权的管理员放行"
      : t.approvalEligibility === "SELF" ? "这是你申请的，要另一位管理员放行"
      : t.approvalEligibility === "ELIGIBLE" ? null : "发起记录核对不上，暂时不能放行；请联系技术同事核对";
    if (recoveryIds.has(t.id)) return <span className="rd-toolbar-note">结果未知，先在页面上方查询原结果</span>;
    return approvalBlocked
      ? <span className="rd-toolbar-note" data-tone={t.approvalEligibility === "MAKER_UNVERIFIED" ? "warn" : undefined}>{approvalBlocked}</span>
      : <Button variant="primary" icon={<ShieldCheck size={14} aria-hidden />} onClick={() => requestApproveTask(t, requesterText(t))}>放行…</Button>;
  };
  const rowActions = (t: LExportTask) => {
    const acts = effActs(t);
    const st = effSt(t);
    const canAccessTask = ctx.canAccessReportType?.(t.reportType, t.pii) ?? false;
    const busy = busyTask === t.id;
    const out: ReactNode[] = [];
    if (!t.supported) out.push(<span key="closed" className="l5-weak">当前版本已关闭此历史类型</span>);
    if (t.supported && ["READY", "EXPIRED", "FAILED"].includes(st) && !t.snapshotAvailable) out.push(<span key="nofile" className="l5-weak">没有文件，不能下载</span>);
    if (acts.includes("approve")) out.push(<span key="approve">{approveAction(t)}</span>);
    if ((acts.includes("download") || acts.includes("retry")) && !canAccessTask) out.push(<span key="denied" className="l5-weak">无此报表导出权限</span>);
    if (acts.includes("download") && canAccessTask) out.push(
      <Button key="download" size="sm" icon={<Download size={14} aria-hidden />} loading={busy} loadingText="正在下载…"
        onClick={() => { setBusyTask(t.id); void downloadTask(t).catch((error) => toast(error instanceof Error ? displayAdminError(error) : "下载失败")).finally(() => setBusyTask(null)); }}>下载</Button>,
    );
    if (acts.includes("retry") && canAccessTask) out.push(
      <Button key="retry" size="sm" icon={<RotateCcw size={14} aria-hidden />} loading={busy} loadingText="正在发起…"
        disabledReason={recoveryIds.has(t.id) ? "结果未知，先在页面上方查询原结果" : undefined}
        onClick={() => { setBusyTask(t.id); void retryTask(t).catch((error) => toast(error instanceof Error ? displayAdminError(error) : "重新发起失败")).finally(() => setBusyTask(null)); }}>重新发起</Button>,
    );
    if (out.length === 0) out.push(<span key="none" className="l5-weak">—</span>);
    return <span className="l5-row-actions">{out}</span>;
  };
  const listState = taskLoading || (!taskPage && !taskError) ? "loading" : taskError ? "error" : "ready";
  const segItems = L5_TASK_FILTERS.map((label, index) => ({ value: index, label, count: index === 1 ? pending : undefined }));
  const taskPanel = (
    <div ref={listRef} className="l5-anchor">
      <Panel title={<span tabIndex={-1} data-l5-focus="">导出任务</span>} explainLabel="导出任务" icon={ListChecks}
        sub={taskPage ? `共 ${taskTotal} 份 · 每页 8 份` : undefined}
        explain={<>
          <p>L1–L4 各报表页和这页创建的导出都在这里，按状态排：待放行在最前，其次生成中、可下载、已过期、失败。</p>
          <p>汇总和当前披露快照创建后直接可下载；脱敏资金明细在「{l3Name}」申请，另一位管理员放行后才能下载；团队树明细在「{pageName(L4_PAGE, "设备、任务与团队报表")}」导出，只能在这里下载，不能重新发起。</p>
          <p>失败或过期的任务可以「重新发起」：用原来那份文件，不重新取数；含隐私的要再放行一次。</p>
        </>}>
        <div className="l5-list-tools">
          <Segments<number> label="导出任务状态筛选" value={filter} items={segItems} onChange={selectFilter} />
        </div>
        {taskError && <BlockState state="error" title="导出任务读取失败，不显示旧列表" detail={`${taskError} 可以换个状态再读，或点页头「刷新」。`} />}
        {!taskError && pendingTasks.length > 0 && (
          <section className="l5-pending" aria-label="等待放行">
            <h3 className="l5-sub-title">等待放行 <span className="l5-weak">这一页 {pendingTasks.length} 份{pending > pendingTasks.length ? `，共 ${pending} 份` : ""}</span></h3>
            <ul className="l5-pending-grid">
              {pendingTasks.map((t) => (
                <PendingCard key={t.id} task={t} title={taskTitle(t, exportTypeText)} source={taskSource(t)}
                  scope={reportScopeText(t.scope)} fields={operatorCopyText(t.fields)}
                  requester={ctx.canApproveExportTasks ? requesterText(t) : undefined} action={approveAction(t)} />
              ))}
            </ul>
          </section>
        )}
        {!taskError && (pendingTasks.length === 0 || otherTasks.length > 0 || listState !== "ready") && (
          <>
            {pendingTasks.length > 0 && <h3 className="l5-sub-title">其他任务</h3>}
            <Table label="导出任务" data-tight="">
              <thead><tr><Th>导出内容</Th><Th>范围</Th><Th>字段</Th><Th>脱敏</Th><Th align="right">行数</Th><Th>状态</Th><Th align="right" sticky="end">操作</Th></tr></thead>
              <tbody>
                {listState === "loading" && <TableLoading columns={7} rows={4} />}
                {listState === "ready" && otherTasks.map((t) => (
                  <Tr key={t.id}>
                    <Td><Cell main={taskTitle(t, exportTypeText)} sub={<><span data-mono="">{t.id}</span> · {taskSource(t)}</>} title={`${t.id} · ${taskSource(t)}`} /></Td>
                    <Td><Cell main={reportScopeText(t.scope)} title={reportScopeText(t.scope)} /></Td>
                    <Td grow><Cell main={operatorCopyText(t.fields)} sub={t.pii ? "含隐私（已脱敏）" : undefined} title={operatorCopyText(t.fields)} /></Td>
                    <Td><MaskTag mask={t.mask} /></Td>
                    <Td align="right"><Cell num main={rowsText(t.rows)} /></Td>
                    <Td><TaskStatusTag task={t} unknown={recoveryIds.has(t.id)} /></Td>
                    <Td align="right" sticky="end" data-fit="">{rowActions(t)}</Td>
                  </Tr>
                ))}
                {listState === "ready" && visibleTasks.length === 0 && (
                  <TableMessage columns={7}>{filter === 0 ? "还没有导出任务" : `没有「${L5_TASK_FILTERS[filter]}」的任务`}</TableMessage>
                )}
              </tbody>
            </Table>
          </>
        )}
        {taskPage && (
          <div className="rd-pager" data-list-pager="" data-list-label="导出任务管理">
            <span className="rd-pager-range">第 {taskPageNum} / {taskPages} 页 · 共 {taskTotal} 条</span>
            <div className="rd-pager-tools">
              <Button size="sm" aria-label="导出任务 上一页" disabled={!taskPage || taskPageNum <= 1 || taskLoading} onClick={() => setTaskPageNum((p) => Math.max(1, p - 1))}>上一页</Button>
              <Button size="sm" aria-label="导出任务 下一页" disabled={!taskPage || taskPageNum >= taskPages || taskLoading} onClick={() => setTaskPageNum((p) => Math.min(taskPages, p + 1))}>下一页</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );

  /* ---------------- 新建导出：三种去向不同的出口 ---------------- */
  const exportBlocked = !ctx.canExport ? "当前角色没有聚合报表来源域的导出权限"
    : exportTypes.length === 0 ? "当前角色没有可导出的汇总类型"
    : ctx.biLoading ? "正在读取，读完再导出"
    : ctx.biError || !ctx.biData?.l5 ? "数据加载失败，暂时不能导出" : undefined;
  const disclosures = regulatoryOptions?.disclosures ?? [];
  const regulatoryBlocked = !ctx.canGenerateRegulatory ? "当前角色没有披露快照生成权限"
    : regulatoryLoading ? "正在读取可用的披露版本"
    : regulatoryError ? "披露版本读取失败，暂时不能生成"
    : disclosures.length === 0 ? `「${i5Name}」里还没有 7 章齐全的当前版本` : undefined;
  const linkTo = (path: string, fallback: string) => reach(path)
    ? <Link className="rd-link" href={path}>{pageName(path, fallback)}</Link>
    : <>「{pageName(path, fallback)}」</>;
  const createPanel = (
    <div ref={createRef} className="l5-anchor">
      <Panel title={<span tabIndex={-1} data-l5-focus="">新建导出</span>} explainLabel="新建导出" icon={FilePlus2} sub="三种出口，去向不同"
        explain={<><p>汇总和当前披露快照生成后进上面的任务列表，直接可下载；8 类账单确认后浏览器直接下载，不进任务列表。三种都不含原文隐私，都要填理由并写进记录。</p><p>脱敏资金明细在 {linkTo(L3_PAGE, "财务报表")} 申请，团队树明细在 {linkTo(L4_PAGE, "设备、任务与团队报表")} 导出，都在上面任务列表里放行和下载。</p></>}>
        <div className="l5-create">
          <article className="l5-create-card" aria-labelledby="l5-create-agg">
            <div className="l5-create-head"><IconTile tone="role-2" icon={FileSpreadsheet} size={28} /><h3 id="l5-create-agg">汇总数据</h3><Explain label="汇总数据是什么" content="关键指标、转化与留存、财务、运营四类汇总，不含个人信息。创建那一刻取数，以后下载还是那一刻的数。" /></div>
            <RouteFacts rows={[["进任务列表", "进"], ["要放行", "不用"], ["拿到文件", "生成后在任务列表下载", true]]} />
            {ctx.canExport && exportTypes.length > 0 && <p className="l5-create-types">这个账号能导：{aggregateNames(exportTypes)}</p>}
            <div className="l5-create-foot"><Button icon={<FileSpreadsheet size={14} aria-hidden />} disabledReason={exportBlocked} onClick={newExport}>导出汇总数据</Button></div>
          </article>
          <article className="l5-create-card" aria-labelledby="l5-create-reg">
            <div className="l5-create-head"><IconTile tone="role-3" icon={ScrollText} size={28} /><h3 id="l5-create-reg">当前披露快照</h3><Explain label="当前披露快照是什么" content={`按「${i5Name}」当前生效的版本，生成给监管看的汇总报告，不含单个用户明细。`} /></div>
            <RouteFacts rows={[["进任务列表", "进"], ["要放行", "不用"], ["拿到文件", "生成后在任务列表下载", true]]} />
            {regulatoryLoading && <BlockState compact state="loading" title="正在读取可用的地区和版本…" />}
            {!regulatoryLoading && regulatoryError && <BlockState compact state="error" title="披露版本读取失败" detail={regulatoryError} onRetry={() => void ctx.reloadBi?.()} retryLabel="重新加载" />}
            {!regulatoryLoading && !regulatoryError && disclosures.length === 0 && <p className="l5-create-types">还没有 7 章齐全的当前版本，到「{i5Name}」发布后再来</p>}
            {!regulatoryLoading && !regulatoryError && disclosures.length > 0 && (
              <Fold inset title="可用地区" summary={`${disclosures.length} 个`}>
                <ul className="l5-disclosures" aria-label="可用的地区和版本">
                  {disclosures.map((item) => (
                    <li key={`${item.jurisdictionCode}-${item.disclosureVersion}`}>
                      <span className="l5-strong">{item.jurisdictionName} ({item.jurisdictionCode})</span>
                      <span data-mono="">{item.disclosureVersion}</span>
                      <span className="l5-weak">{item.chapterCount} 章 · 适用 {item.countryCodes.join(" / ") || "地区级"} · 发布 {item.publishedAt || "见「风险披露」"}</span>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}
            <div className="l5-create-foot"><Button icon={<ScrollText size={14} aria-hidden />} disabledReason={regulatoryBlocked} onClick={requestRegulatoryReport}>生成当前披露快照</Button></div>
          </article>
          <article className="l5-create-card" aria-labelledby="l5-create-ledger">
            <div className="l5-create-head"><IconTile tone="role-1" icon={ReceiptText} size={28} /><h3 id="l5-create-ledger">8 类账单明细</h3><Explain label="8 类账单明细是什么" content={<><p>兑换、充值、提现、收益、团队奖励、退款、奖励、购买，全平台所有时间。</p><p>用户编号只保留首尾字符，不导出昵称、备注。要按日期、用户筛，到「{ledgerName}」导出。</p></>} /></div>
            <RouteFacts rows={[["进任务列表", "不进"], ["要放行", "不用"], ["拿到文件", "确认后直接下载 CSV，最多 10 万行", true]]} />
            <div className="l5-create-foot">{ctx.canExportLedger
              ? <Button icon={<ReceiptText size={14} aria-hidden />} loading={ledgerExporting} loadingText="正在导出…" onClick={requestLedgerDownload}>导出 8 类账单明细</Button>
              : <span className="rd-toolbar-note">当前角色没有账单明细导出权限</span>}</div>
          </article>
        </div>
      </Panel>
    </div>
  );

  /* ---------------- 参考：导出规则、字段脱敏、导出记录 ---------------- */
  const refTabs = [
    { value: "tasks" as const, label: "导出任务", count: pending > 0 ? pending : undefined },
    { value: "rules" as const, label: "导出规则" },
    { value: "masks" as const, label: "字段脱敏规则" },
    { value: "audit" as const, label: "导出记录", count: auditLoading ? undefined : auditError ? "—" : AUDIT_ROWS.length },
  ];
  const reference = (
    <div className="l5-ref">
      <PageTabs<RefTab> label="导出任务、规则和记录" value={refTab} items={refTabs} onChange={setRefTab} ids={refIds} />
      {refTab === "tasks" && <div {...refIds.panel("tasks")} className="l5-ref-main">{taskPanel}{createPanel}</div>}
      {refTab === "rules" && (
        <Panel {...refIds.panel("rules")} title="导出规则" icon={ShieldCheck} sub="固定规则，不能在这页改"
          explain="这些是后端写死的安全规则，页面只展示。">
          <dl className="l5-params">
            {EXPORT_PARAMS.map((p) => (
              <div key={p.k}>
                <dt>{p.k}</dt>
                <dd><span className="l5-strong">{operatorCopyText(p.v)}</span><Explain label={`${p.k}的说明`} content={p.s} /></dd>
              </div>
            ))}
            {CROSS_MODULE_BLOCKERS.map((item) => (
              <div key={item.code}>
                <dt>{item.label}</dt>
                <dd><StatusTag tone={item.status === "BLOCKED" ? "danger" : "warn"} icon={Ban}>{item.status === "BLOCKED" ? "已禁止" : "等待其他模块接入"}</StatusTag><span className="l5-weak">{item.reason}</span></dd>
              </div>
            ))}
          </dl>
          {CROSS_MODULE_BLOCKERS.length === 0 && <Notice tone="warn" title="能力边界加载失败">已按最小权限关闭解密导出。</Notice>}
        </Panel>
      )}
      {refTab === "masks" && (
        <Panel {...refIds.panel("masks")} title="字段脱敏规则" icon={LockKeyhole} sub={`${MASK_RULES.length} 个字段 · 固定规则`}
          explain="哪个字段、导出来长什么样。手机号、卡信息令牌、地址和证件等明文敏感字段在管理端接口里都不能导出，也没有可以批准解密的路径。">
          <MaskRuleTable rules={MASK_RULES} />
        </Panel>
      )}
      {refTab === "audit" && (
        <Panel {...refIds.panel("audit")} title="导出记录" icon={ScrollText} sub={`最近 50 条 · 时间为${businessZone().label}`}
          explain={<><p>系统记下的导出：汇总、当前披露快照、8 类账单和用户名单导出，和「{pageName(AUDIT_PAGE, "操作记录与审批")}」是同一份记录。</p><p>只读，这页不写核查结果；「下载」一列只说明已记录，不能从这里下载文件。每次下载文件的记录不在这里，到「{pageName(AUDIT_PAGE, "操作记录与审批")}」查。</p></>}
          actions={auditError ? <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void ctx.reloadBi?.()}>重新加载</Button> : undefined}>
          <AuditTable rows={AUDIT_ROWS} loading={auditLoading} error={auditError} />
        </Panel>
      )}
    </div>
  );

  return (
    <>
      {header}
      {outcomeNotice}
      <L5RecoveryNotice rows={recoveryRows} />
      {conclusion}
      {stats}
      {reference}
    </>
  );
}
