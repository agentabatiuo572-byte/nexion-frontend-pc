"use client";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * L5 · 数据导出与监管报告 — 全平台数据出口的唯一管控面。
 * 当前闭环开放四类聚合快照、D4 八类账单脱敏明细与 I5 当前披露版本监管报告。
 * 明文敏感字段导出保持服务端阻断。
 */
import { useEffect, useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { TabGroup } from "@/app/components/kit/tab-group";
import { displayAdminError } from "@/lib/admin/error-messages";
import { LDataState, num, rec, rows, str } from "./live-data";
import {
  fetchL5ExportAudits,
  fetchL5ExportTasks,
  fetchL5RegulatoryOptions,
  type AdminPage,
  type LExportAuditRow,
  type LExportTask,
  type LRegulatoryOptions,
} from "@/lib/admin/l-client";
import { downloadD4BillsCsv } from "@/lib/admin/d-client";
import type { LCtx } from "./types";
import { clampL5Page, l5PageCount } from "./l5-pagination";
import { isL5KpiExport, l5KpiRange } from "./l5-kpi-range";

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
type MaskRule = { f: string; cat: string; catTone: string; rule: string; ruleNote: string; dec: string; appr: string };

/** 导出任务状态筛选(索引 = filter 状态值;label 同时用于按钮文本与切换 toast)。 */
const L5_TASK_FILTERS = ["全部", "待确认", "生成中", "已就绪（含历史）"] as const;

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

export function L5HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportTypes = ctx.availableAggregateExportTypes ?? [];
  const newExport = () => ctx.openActionConfirm({
    action: "导出汇总数据",
    detail: <>你可以导出：{exportTypes.map(exportTypeText).join("、")}。导出的是汇总数据，不含用户明细和隐私信息，确认后就能下载。</>,
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
      await ctx.biActions?.createReport({
        exportType: String(bv?.exportType ?? "后台导出报表"),
        ...range,
        fields: String(bv?.fields || "聚合指标"),
        piiLevel: String(bv?.piiLevel ?? "无隐私信息"),
        maskPolicy: "NONE",
        recipient: String(bv?.recipient ?? "未指定"),
        ticket: String(bv?.ticket ?? "L5-EXPORT"),
      }, reason);
      await ctx.reloadBi?.();
      ctx.toast(`已生成：${summary} · 可在下方任务列表下载`);
    },
  });
  return (
    <>
      <span className="f-ro"><span className="d" />数据导出统一管控面</span>
      <button
        className="f-cta"
        onClick={newExport}
        disabled={!ctx.canExport || exportTypes.length === 0 || ctx.biLoading || Boolean(ctx.biError) || !ctx.biData?.l5}
        title={!ctx.canExport
          ? "当前角色没有聚合报表来源域的导出权限"
          : ctx.biError || !ctx.biData?.l5
            ? "数据加载失败，暂时不能导出"
            : undefined}
      >
        导出汇总数据
      </button>
    </>
  );
}

export function L5Export({ ctx }: { ctx: LCtx }) {
  const { toast } = ctx;
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
        if (alive) setTaskError(error instanceof Error ? displayAdminError(error) : "导出任务加载失败");
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
      .catch((error) => { if (alive) setRegulatoryError(error instanceof Error ? displayAdminError(error) : "监管报告选项加载失败"); })
      .finally(() => { if (alive) setRegulatoryLoading(false); });
    setAuditLoading(true);
    setAuditError(null);
    void fetchL5ExportAudits()
      .then((value) => { if (alive) setAuditRows(value); })
      .catch((error) => { if (alive) setAuditError(error instanceof Error ? displayAdminError(error) : "导出记录加载失败"); })
      .finally(() => { if (alive) setAuditLoading(false); });
    return () => { alive = false; };
  }, [data]);
  if (!data) return <LDataState ctx={ctx} label="L5" />;
  const summaryRaw = rec(data.summary);
  const L5_STATS = {
    total: num(summaryRaw.totalReports, rows<LExportTask>(data.exportTasks).length),
    ready: num(summaryRaw.readyReports),
    sensitive: num(summaryRaw.sensitiveReports),
    pending: num(summaryRaw.pendingConfirm),
    legacyReadyWithoutSnapshot: num(summaryRaw.legacyReadyWithoutSnapshot),
  };
  const ST_LABEL = rec(data.statusLabels);
  const EXPORT_TASKS = taskPage?.records ?? [];
  const MASK_RULES = rows<MaskRule>(data.maskRules);
  const EXPORT_PARAMS = rows<ExportParam>(data.exportParams);
  const AUDIT_ROWS = auditRows.length > 0 ? auditRows : rows<LExportAuditRow>(data.auditRows);
  const CROSS_MODULE_BLOCKERS = rows<{ code: string; label: string; status: string; reason: string }>(data.crossModuleBlockers);
  const STATUS_FALLBACK: Record<string, string> = {
    PENDING: "待处理",
    PENDING_CONFIRM: "待确认",
    PENDING_SPLIT_CONFIRM: "待拆分确认",
    GENERATING: "生成中",
    READY: "可下载",
    EXPIRED: "已过期",
    FAILED: "生成失败",
  };
  const maskLabel = (mask: string) => ({ masked: "已脱敏", partial: "部分脱敏", decrypted: "已解密" })[mask] ?? mask;
  const statusLabel = (status: string): [string, string] => {
    const value = ST_LABEL[status];
    if (Array.isArray(value)) return [STATUS_FALLBACK[status] ?? "状态未知", str(value[1], "dim")];
    return [STATUS_FALLBACK[status] ?? "未知状态", "dim"];
  };
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
  const requestApproveTask = (t: LExportTask) => ctx.openActionConfirm({
    action: "审批脱敏资金明细",
    detail: <>任务 <span className="mono">{t.id}</span> 的数据会保持隐藏隐私，审批不会解密任何字段。批准后就能下载，下载链接 24 小时有效。</>,
    reasonMin: 8,
    reasonMax: 200,
    completionCopy: "通过后可签发限时下载令牌",
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
  const requestLedgerDownload = () => ctx.openActionConfirm({
    action: "导出八类账单脱敏明细",
    detail: <>导出 8 类账单；用户编号会隐藏部分字符，最多 10 万行，导出原因和范围都有记录。</>,
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => downloadLedger(reason),
  });
  const requestRegulatoryReport = () => {
    const templates = regulatoryOptions?.templates ?? [];
    const disclosures = regulatoryOptions?.disclosures ?? [];
    if (templates.length === 0 || disclosures.length === 0) {
      toast(regulatoryError || "「风险披露」里还没有可用于监管报告的完整（7 章）版本");
      return;
    }
    const disclosureValues = disclosures.map((item) => `${item.jurisdictionCode}|${item.disclosureVersion}`);
    ctx.openActionConfirm({
      action: "生成监管报告",
      detail: <>会检查所选地区当前生效的披露版本是否 7 章齐全，再汇总财务、运营、账单、操作记录和应急处理数据生成报告。报告不含用户明细和隐私信息。</>,
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        title: "监管报告 · 当前适用地区与披露版本",
        hint: "地区和版本来自「风险披露」当前生效的设置。",
        fields: [
          { key: "templateCode", label: "报告模板", inputKind: "select", current: templates[0].code, options: templates.map((item) => item.code), optionLabels: Object.fromEntries(templates.map((item) => [item.code, item.label])) },
          { key: "jurisdictionVersion", label: "适用地区 / 披露版本", inputKind: "select", current: disclosureValues[0], options: disclosureValues, optionLabels: Object.fromEntries(disclosures.map((item) => [`${item.jurisdictionCode}|${item.disclosureVersion}`, `${item.jurisdictionName} (${item.jurisdictionCode}) · ${item.disclosureVersion} · ${item.chapterCount}章`])) },
          { key: "period", label: "报告期间", placeholder: "如 2026-07 / 2026-Q3" },
          { key: "recipient", label: "接收机构 / 用途", placeholder: "如 合规团队 / 监管报送" },
          { key: "ticket", label: "业务工单", placeholder: "如 99105-L5-REG-001" },
        ],
      },
      run: async (reason, _value, business) => {
        const [jurisdictionCode, disclosureVersion] = String(business?.jurisdictionVersion ?? "").split("|", 2);
        await ctx.biActions?.createRegulatoryReport({
          templateCode: String(business?.templateCode ?? ""),
          period: String(business?.period ?? ""),
          jurisdictionCode,
          disclosureVersion,
          recipient: String(business?.recipient ?? ""),
          ticket: String(business?.ticket ?? ""),
        }, reason);
        await ctx.reloadBi?.();
        toast("监管报告已生成，可在下方任务列表下载");
      },
    });
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat"><div className="k">累计导出任务</div><div className="v">{L5_STATS.total}</div><div className="sub">全部导出任务</div></div>
        <div className="f-stat cyan"><div className="k">可以下载</div><div className="v">{L5_STATS.ready}</div><div className="sub">下载链接限时有效{L5_STATS.legacyReadyWithoutSnapshot > 0 ? ` · ${L5_STATS.legacyReadyWithoutSnapshot} 条旧任务没有文件，不能下载` : ""}</div></div>
        <div className="f-stat warn"><div className="k">待确认任务</div><div className="v">{L5_STATS.pending}</div><div className="sub">含隐私的任务需要审批</div></div>
        <div className="f-stat danger"><div className="k">含隐私任务</div><div className="v">{L5_STATS.sensitive}</div><div className="sub">只能导出隐藏后的数据，不能导出原文</div></div>
      </div>

      {/* 导出安全参数 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">导出安全参数</span>
          <span className="sub">· <AutoGloss>导出规则 · 隐私数据一律不能原文导出</AutoGloss></span>
          <div className="r"><span className="lcode electric" title="导出安全与隐私保护基线">数据导出管控</span></div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {EXPORT_PARAMS.map((p) => (
              <div key={p.k} className="p">
                <div className="k">{p.k}</div>
                <div className="v" style={p.fixed ? { color: "var(--success)" } : undefined}>
                  {operatorCopyText(p.v)}<span className="bdg dim">固定</span>
                </div>
                <div className="s"><AutoGloss>{p.s}</AutoGloss></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* (a) 导出任务管理 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">导出任务管理</span>
          <span className="sub">· <AutoGloss>四类汇总和监管报告都在这里</AutoGloss></span>
          <div className="r"><TabGroup
            className="chips"
            label="导出任务状态筛选"
            value={filter}
            items={[0, 1, 2, 3]}
            onSelect={(i) => { setFilter(i); setTaskPageNum(1); toast(`任务列表筛选:${L5_TASK_FILTERS[i]}`); }}
            itemClassName={(_i, selected) => `chip${selected ? " sel" : ""}`}
          >{(i) => L5_TASK_FILTERS[i]}</TabGroup></div>
        </div>
        <div className="l-b" style={{ paddingBottom: 10 }}>
          <div className="sm-strip">
            <span className="st">确认聚合范围</span><span className="ar">→</span>
            <span className="st ok">文件已生成</span><span className="ar">生成 24 小时下载链接 →</span>
            <span className="st">下载（有记录）</span>
            <span className="ar" style={{ marginLeft: 12 }}>旧任务失败 / 过期 →</span><span className="st bad">可重新发起</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1080 }}>
            <thead><tr><th>任务</th><th>类型</th><th>范围</th><th>字段 / 隐私信息</th><th>脱敏</th><th className="num">行数</th><th>状态</th><th>操作链</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {visibleTasks.map((t) => {
                const st: [string, string] = !t.supported
                  ? ["历史类型已关闭", "warn"]
                  : effSt(t) === "READY" && !t.snapshotAvailable
                    ? ["旧任务无文件", "warn"]
                    : statusLabel(effSt(t));
                const acts = effActs(t);
                const canAccessTask = ctx.canAccessReportType?.(t.reportType) ?? false;
                return (
                  <tr key={t.id}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{t.id}</td>
                    <td style={{ fontWeight: 600, color: "var(--ink-2)" }}><AutoGloss>{exportTypeText(t.type)}</AutoGloss></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{reportScopeText(t.scope)}</td>
                    <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{operatorCopyText(t.fields)}{t.pii && <span className="bdg bad" style={{ fontSize: 10.5, marginLeft: 4 }}>含隐私</span>}</td>
                    <td>{t.mask === "—" ? <span className="bdg dim">—</span> : <span className={"mask-pill " + t.mask}>{maskLabel(t.mask)}</span>}</td>
                    <td className="num mono">{t.rows}</td>
                    <td><span className={"bdg " + st[1]}>{st[0]}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{operatorCopyText(t.chain)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {!t.supported && <span className="bdg warn">当前版本已关闭此历史类型</span>}
                      {t.supported && acts.length === 0 && (t.snapshotAvailable || !["READY", "EXPIRED", "FAILED"].includes(effSt(t))) && <span className="mono" style={{ color: "var(--ink-4)" }}>—</span>}
                      {t.supported && ["READY", "EXPIRED", "FAILED"].includes(effSt(t)) && !t.snapshotAvailable && <span className="bdg warn">旧任务没有文件，不能下载</span>}
                      {acts.includes("approve") && !ctx.canApproveExportTasks && <span className="bdg dim">没有审批权限</span>}
                      {acts.includes("approve") && ctx.canApproveExportTasks && <button className="l-btn sm" onClick={() => requestApproveTask(t)}>审批脱敏明细</button>}
                      {(acts.includes("download") || acts.includes("retry")) && !canAccessTask && <span className="bdg dim">无此报表导出权限</span>}
                      {acts.includes("download") && canAccessTask && <button className="l-btn sm" onClick={() => { void downloadTask(t).catch((error) => toast(error instanceof Error ? displayAdminError(error) : "下载失败")); }}>下载</button>}
                      {acts.includes("retry") && canAccessTask && <button className="l-btn sm" onClick={() => { void retryTask(t).catch((error) => toast(error instanceof Error ? displayAdminError(error) : "重新发起失败")); }}>重新发起</button>}
                    </td>
                  </tr>
                );
              })}
              {visibleTasks.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>
                    {taskLoading ? "导出任务加载中…" : taskError ? "导出任务加载失败，请刷新重试" : taskPage ? "没有符合条件的导出任务" : "加载中…"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          {taskError && <div className="ltint warn" style={{ fontSize: 12, marginBottom: 10 }}>导出任务加载失败 · {taskError}</div>}
          <div className="row" data-list-pager="true" data-list-label="导出任务管理" style={{ justifyContent: "flex-end", gap: 8 }}>
            <span className="mono" style={{ color: "var(--ink-4)", fontSize: 11.5 }}>
              {taskPage ? `第 ${taskPageNum} / ${taskPages} 页 · 共 ${taskTotal} 条` : taskError ? "加载失败" : "加载中…"}
            </span>
            <button className="l-btn sm" disabled={!taskPage || taskPageNum <= 1 || taskLoading} onClick={() => setTaskPageNum((p) => Math.max(1, p - 1))}>上一页</button>
            <button className="l-btn sm" disabled={!taskPage || taskPageNum >= taskPages || taskLoading} onClick={() => setTaskPageNum((p) => Math.min(taskPages, p + 1))}>下一页</button>
          </div>
        </div>
      </section>

      {/* (b) I5 监管报告 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">监管报告生成</span>
          <span className="sub">· <AutoGloss>按地区当前生效的披露版本，汇总财务、运营、账单数据</AutoGloss></span>
          <div className="r">
            <button
              className="l-btn primary"
              disabled={!ctx.canGenerateRegulatory || regulatoryLoading || Boolean(regulatoryError) || (regulatoryOptions?.disclosures.length ?? 0) === 0}
              title={!ctx.canGenerateRegulatory ? "当前角色没有监管报告生成权限" : regulatoryError || undefined}
              onClick={requestRegulatoryReport}
            >生成监管报告</button>
          </div>
        </div>
        <div className="l-b">
          <div className="rev-row ui-export-row" style={{ gridTemplateColumns: "minmax(220px, 1fr) minmax(300px, 1.8fr) auto" }}>
            <span className="nm">提现发放 / 反洗钱 / 适用地区专项</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>会检查披露版本是否 7 章齐全；只用汇总数据，缺的数据会标为「暂无」，不估算。</span>
            <span className="bdg ok">已接入风险披露</span>
          </div>
          {(regulatoryOptions?.disclosures ?? []).map((item) => (
            <div key={`${item.jurisdictionCode}-${item.disclosureVersion}`} className="rev-row ui-export-row" style={{ gridTemplateColumns: "minmax(180px, .8fr) minmax(140px, .5fr) minmax(260px, 1.2fr)" }}>
              <span className="nm">{item.jurisdictionName} ({item.jurisdictionCode})</span>
              <span className="mono">{item.disclosureVersion} · {item.chapterCount}章</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>当前映射 · {item.countryCodes.join(" / ") || "适用地区级"} · 发布 {item.publishedAt || "见「风险披露」"}</span>
            </div>
          ))}
          {regulatoryLoading && <div className="ltint">正在加载披露版本…</div>}
          {regulatoryError && <div className="ltint warn">监管报告已失败关闭 · {regulatoryError}</div>}
        </div>
      </section>

      {/* (c) D4 八类账单监管导出 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">八类账单明细导出</span>
          <span className="sub">· <AutoGloss>来自账本 · 自动隐藏隐私 · 最多 10 万行 · 每次导出都有记录</AutoGloss></span>
          <div className="r"><span className="lcode electric">已接入账本</span></div>
        </div>
        <div className="l-b">
          <div className="rev-row ui-export-row" style={{ gridTemplateColumns: "minmax(220px, 1fr) minmax(320px, 2fr) auto" }}>
            <span className="nm">兑换 / 充值 / 提现 / 收益 / 佣金 / 退款 / 奖励 / 购买</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>用户编号只保留首尾字符，不导出昵称、备注等隐私。</span>
            <button className="l-btn sm" disabled={ledgerExporting} onClick={requestLedgerDownload}>
              {ledgerExporting ? "正在导出…" : "导出 8 类账单明细"}
            </button>
          </div>
        </div>
      </section>

      {/* (d) 明文能力边界 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">明文能力边界</span>
          <span className="sub">· <AutoGloss>隐私数据始终不能原文导出</AutoGloss></span>
          <div className="r"><span className="lcode electric">当前不提供假入口</span></div>
        </div>
        <div className="l-b">
          {CROSS_MODULE_BLOCKERS.map((item) => (
            <div key={item.code} className="rev-row ui-export-row" style={{ gridTemplateColumns: "minmax(160px, .7fr) auto minmax(280px, 1.4fr)" }}>
              <span className="nm">{item.label}</span>
              <span className={"bdg " + (item.status === "BLOCKED" ? "bad" : "warn")}>{item.status === "BLOCKED" ? "已禁止" : "等待其他模块接入"}</span>
              <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{item.reason}</span>
            </div>
          ))}
          {CROSS_MODULE_BLOCKERS.length === 0 && <div className="ltint warn">能力边界加载失败，已按最小权限关闭解密导出。</div>}
        </div>
      </section>

      <div className="bottom-split">
        {/* (c) 导出审计台 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">导出记录</span>
            <span className="sub">· <AutoGloss>汇总、账单和监管报告的每一次导出</AutoGloss></span>
            <div className="r"><span className="lcode">只读 · 当前页不写核查结果</span></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 680 }}>
              <thead><tr><th>时间</th><th>导出者</th><th>类型 / 范围</th><th className="num">行数</th><th>隐私信息</th><th>脱敏</th><th>操作员 / 执行门槛</th><th>下载</th></tr></thead>
              <tbody>
                {AUDIT_ROWS.map((a) => (
                  <tr key={a.ts} style={a.mask === "decrypted" ? { background: "var(--danger-soft)" } : undefined}>
                    <td className="mono" style={{ fontSize: 11.5 }}>{a.ts}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{a.who}</td>
                    <td style={{ fontSize: 12 }}><AutoGloss>{a.what}</AutoGloss></td>
                    <td className="num mono">{a.rows}</td>
                    <td>{a.pii ? <span className="bdg bad">包含</span> : <span className="bdg dim">否</span>}</td>
                    <td>{a.mask === "—" ? <span className="bdg dim">—</span> : <span className={"mask-pill " + a.mask}>{maskLabel(a.mask)}</span>}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{a.chain}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{a.dl}</td>
                  </tr>
                ))}
                {AUDIT_ROWS.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: "center", padding: 22, color: "var(--ink-4)" }}>{auditLoading ? "导出记录加载中…" : "没有符合条件的导出记录"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}>
            {auditError
              ? <div className="ltint warn" style={{ fontSize: 11.5 }}><b>失败关闭</b> · {auditError}</div>
              : <div className="ltint" style={{ fontSize: 11.5 }}><b>说明</b> · <AutoGloss>这里显示的是系统记下的每一次导出，和「操作记录与审批」一致。</AutoGloss></div>}
          </div>
        </section>

        {/* 字段级脱敏规则表 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">字段级脱敏规则表</span>
            <span className="sub">· 哪些字段会被隐藏</span>
            <div className="r"><span className="lcode">固定规则 · 不能原文导出</span></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead><tr><th>字段</th><th>类别</th><th>默认规则</th><th>允许解密</th><th>解密确认</th></tr></thead>
              <tbody>
                {MASK_RULES.map((r) => (
                  <tr key={r.f}>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}><AutoGloss>{r.f}</AutoGloss></td>
                    <td><span className={"bdg " + r.catTone}>{r.cat}</span></td>
                    <td>{r.rule && <span className={"mask-pill " + r.rule}>{maskLabel(r.rule)}</span>} {r.ruleNote}</td>
                    <td>{r.dec}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{r.appr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 10 }}><div className="ltint warn" style={{ fontSize: 11.5 }}><b>最小权限</b> · 手机号、卡信息令牌、地址和证件等明文敏感字段在当前管理端 API 中不可导出。</div></div>
        </section>
      </div>

      <p className="f-foot"><b>这页只导出数据，不会改任何业务。</b><AutoGloss>可以导出：关键指标、漏斗、财务、运营四类汇总，8 类账单明细，以及监管报告。下载链接 24 小时有效；账单最多 10 万行；每次导出都有记录，隐私数据不能原文导出。</AutoGloss></p>
    </div>
  );
}
