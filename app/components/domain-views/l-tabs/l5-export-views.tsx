"use client";

/**
 * L5 数据导出与监管报告（改版，rd）的页面件：任务的名字和来源、状态标签、待放行卡、结果未知提醒、
 * 新建导出三张卡里的去向行、字段脱敏对照表、导出记录表。只排版，不发请求、不判权限。
 */
import type { ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass, LockKeyhole, type LucideIcon } from "lucide-react";
import { Cell, Explain, IconTile, Notice, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import type { LExportAuditRow, LExportTask } from "@/lib/admin/l-client";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { findByPath } from "@/lib/nav/console-nav";

/* ---------------- 名字和来源（只换显示，reportType 原样） ---------------- */

const SOURCE_PAGE: Record<string, string> = {
  KPI_SERIES: "/analytics/kpi",
  FUNNEL_COHORT: "/analytics/funnel-cohort",
  FINANCE_AGG: "/analytics/financial",
  OPERATIONS_AGG: "/analytics/operations",
  NETWORK_TREE: "/analytics/operations",
  REGULATORY: "/content/disclosures",
};

const TYPE_NAME: Record<string, string> = {
  KPI_SERIES: "关键指标汇总",
  FUNNEL_COHORT: "转化与留存汇总",
  FINANCE_AGG: "财务汇总",
  OPERATIONS_AGG: "运营汇总",
  NETWORK_TREE: "团队树明细",
  REGULATORY: "当前披露快照",
};

export function pageName(path: string, fallback: string) {
  return findByPath(path)?.l2.name ?? fallback;
}

function typeKey(task: LExportTask) {
  return task.reportType.trim().toUpperCase();
}

/** 任务叫什么：财务汇总里含隐私的是「财务报表」申请的脱敏资金明细（和 L3 同名）。 */
export function taskTitle(task: LExportTask, typeText: (value: string) => string) {
  const key = typeKey(task);
  if (key === "FINANCE_AGG" && task.pii) return "脱敏资金明细";
  return TYPE_NAME[key] ?? typeText(task.type);
}

/** 数据来自哪一页：按报表类型，不是按在哪一页点的创建。 */
export function taskSource(task: LExportTask) {
  const key = typeKey(task);
  const path = SOURCE_PAGE[key];
  if (!path) return "历史类型";
  return `数据来自「${pageName(path, key)}」`;
}

/** 行数按千分位写；l-client 小于 10000 不分组、0 写成「—」（说明 C01），这里只补分组，「—」照旧。 */
export function rowsText(rows: string) {
  return /^\d+$/.test(rows) ? Number(rows).toLocaleString("en-US") : rows;
}

export const MASK_LABEL: Record<LExportTask["mask"], string> = { masked: "已脱敏", partial: "部分脱敏", decrypted: "已解密", "—": "不涉及" };

export function MaskTag({ mask }: { mask: LExportTask["mask"] }) {
  if (mask === "—") return <span className="l5-weak">不涉及</span>;
  return <StatusTag tone={mask === "decrypted" ? "danger" : "neutral"} icon={mask === "decrypted" ? undefined : LockKeyhole}>{MASK_LABEL[mask]}</StatusTag>;
}

/* ---------------- 状态：一套标记，只有要人处理的上色 ---------------- */

const STATUS: Record<string, { label: string; tone: StateTone; icon?: LucideIcon; explain: string }> = {
  PENDING_CONFIRM: { label: "待放行", tone: "warn", icon: Clock3, explain: "含隐私的脱敏明细，要另一位有导出审批权的管理员放行后才能下载。" },
  PENDING_SPLIT_CONFIRM: { label: "待放行", tone: "warn", icon: Clock3, explain: "后端状态是「待拆分确认」，放行方式和普通待放行一样。" },
  PENDING: { label: "待处理", tone: "neutral", explain: "后端还没开始生成。" },
  GENERATING: { label: "生成中", tone: "progress", explain: "正在生成文件，好了以后变成可下载。页面不自动刷新，点页头「刷新」看最新状态。" },
  READY: { label: "可下载", tone: "ok", explain: "文件已生成。每次点「下载」签发一个只给你用、24 小时内有效的链接。" },
  EXPIRED: { label: "已过期", tone: "done", explain: "可以「重新发起」：用原来那份文件改回可下载，不重新取数；含隐私的要再放行一次。" },
  FAILED: { label: "生成失败", tone: "danger", explain: "可以「重新发起」：用原来那份文件改回可下载，不重新取数；含隐私的要再放行一次。" },
};

export function taskStatus(task: LExportTask): { label: string; tone: StateTone; icon?: LucideIcon; explain: string } {
  if (!task.supported) return { label: "历史类型已关闭", tone: "neutral", explain: "这种导出类型现在已关闭，只保留记录，不能下载或重新发起。" };
  if (task.st === "READY" && !task.snapshotAvailable) return { label: "旧任务无文件", tone: "neutral", explain: "这是早期的任务，没有保存文件，不能下载；需要的话重新创建一份。" };
  return STATUS[task.st] ?? { label: "状态未知", tone: "warn", explain: `后端返回了页面不认识的状态 ${task.st}，请刷新；仍然这样请联系技术同事。` };
}

export function TaskStatusTag({ task, unknown }: { task: LExportTask; unknown?: boolean }) {
  const status = taskStatus(task);
  return (
    <span className="l5-status">
      <StatusTag tone={status.tone} icon={status.icon} explain={<><p>{status.explain}</p><p>最近一次说明：{task.chain}</p></>}>{status.label}</StatusTag>
      {unknown && <StatusTag tone="warn" icon={CircleHelp} explain="放行或重新发起时没收到确定结果，可能已经生效。先看页面上方「结果未知」里这一条，查询原结果。">结果未知</StatusTag>}
    </span>
  );
}

/* ---------------- 待放行卡 ---------------- */

export function PendingCard({ task, title, source, scope, fields, requester, action }: {
  task: LExportTask;
  title: string;
  source: string;
  scope: string;
  fields: string;
  requester: ReactNode;
  action: ReactNode;
}) {
  return (
    <li className="l5-pending-card">
      <div className="l5-pending-head">
        <IconTile tone="warn" icon={LockKeyhole} size={28} />
        <span className="l5-pending-title">
          <span className="l5-pending-name">{title}</span>
          <span className="l5-pending-id" data-mono="">{task.id}</span>
        </span>
        <TaskStatusTag task={task} />
      </div>
      <dl className="l5-pending-facts">
        <div><dt>来源</dt><dd>{source}</dd></div>
        <div><dt>范围</dt><dd title={scope}>{scope}</dd></div>
        <div><dt>字段</dt><dd title={fields}>{fields}</dd></div>
        <div><dt>行数</dt><dd data-num="">{task.rows === "—" ? <span className="l5-weak">—</span> : <>{rowsText(task.rows)} 行</>}</dd></div>
        <div><dt>脱敏</dt><dd><MaskTag mask={task.mask} /></dd></div>
        <div><dt>申请人</dt><dd>{requester}</dd></div>
      </dl>
      <div className="l5-pending-foot">{action}</div>
    </li>
  );
}

/* ---------------- 结果未知（放行、重新发起会改任务状态，按 R1） ---------------- */

export type L5RecoveryItem = {
  key: string;
  reportId: string;
  /** 哪一份导出：任务名字，比如「脱敏资金明细」。 */
  title: string;
  /** 做的是什么：放行 / 重新发起。 */
  action: "放行" | "重新发起";
  /** 谁申请的：接口只说是不是你本人，这里照写。 */
  requester: string;
  /** 本机保存原请求的时间（毫秒）。 */
  submittedAt: number;
  expired?: boolean;
  actions: ReactNode;
};

export function L5RecoveryNotice({ rows }: { rows: L5RecoveryItem[] }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>有 {rows.length} 项操作结果未知<Explain label="结果未知怎么处理" content={<>
      <p>放行或重新发起时没收到确定结果，任务可能已经变了状态。</p>
      <p>先点「查询原结果」读回任务现在的状态。24 小时内也可以「按原请求重试」：后端认得出是同一次提交，不会放行两次。超过 24 小时只能查询。</p>
      <p>任务变成可下载，也可能是另一位管理员放行的，不能据此认定是你这一次生效。</p>
    </>} /></>}>
      <ul className="l5-recovery" aria-label="结果未知的操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="l5-recovery-name">{row.action}「{row.title}」</span>
            <span className="l5-recovery-who"><span data-mono="">{row.reportId}</span> · 申请人 {row.requester}</span>
            <span className="l5-recovery-time">{businessStamp(row.submittedAt)} {row.action}</span>
            <span className="l5-recovery-state">{row.expired
              ? <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试，只能查询。">已过期</StatusTag>
              : <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag>}</span>
            <span className="l5-recovery-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="l5-recovery-zone">时间为{businessZone().label}</p>
    </Notice>
  );
}

/* ---------------- 新建导出卡里的「去哪了」三行 ---------------- */

export function RouteFacts({ rows }: { rows: [string, ReactNode, boolean?][] }) {
  return (
    <dl className="l5-route">
      {rows.map(([name, value, strong]) => (
        <div key={name} data-strong={strong ? "" : undefined}><dt>{name}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

/* ---------------- 字段脱敏对照表 ---------------- */

export type MaskRule = { f: string; cat: string; catTone: string; rule: string; ruleNote: string; dec: string; appr: string };

export function MaskRuleTable({ rules }: { rules: MaskRule[] }) {
  return (
    <Table label="字段脱敏规则">
      <thead><tr><Th>字段</Th><Th>类别</Th><Th>导出来长什么样</Th><Th>能不能解密</Th><Th>解密要谁确认</Th></tr></thead>
      <tbody>
        {rules.map((rule) => (
          <Tr key={rule.f}>
            <Td><b className="l5-strong">{rule.f}</b></Td>
            <Td><StatusTag tone={rule.catTone === "bad" ? "warn" : "neutral"}>{rule.cat}</StatusTag></Td>
            <Td grow><span className="l5-mask-look">{rule.rule && <MaskTag mask={(rule.rule === "masked" || rule.rule === "partial" || rule.rule === "decrypted") ? rule.rule : "—"} />}<span>{rule.ruleNote}</span></span></Td>
            <Td>{rule.dec}</Td>
            <Td>{rule.appr}</Td>
          </Tr>
        ))}
        {rules.length === 0 && <TableMessage columns={5} role="alert">字段规则没有读到，已按最小权限处理：隐私字段一律不能原文导出。</TableMessage>}
      </tbody>
    </Table>
  );
}

/* ---------------- 导出记录（只读，最近 50 条） ---------------- */

function auditTime(ts: string) {
  return /^\d{4}-\d{2}-\d{2}T/.test(ts) ? ts.replace("T", " ").slice(0, 19) : ts;
}

export function AuditTable({ rows, loading, error }: { rows: LExportAuditRow[]; loading: boolean; error: string | null }) {
  return (
    <Table label="导出记录">
      <thead><tr><Th>时间</Th><Th>导出人</Th><Th>导出了什么</Th><Th align="right">行数</Th><Th>隐私与脱敏</Th><Th>经过的检查</Th><Th>下载</Th></tr></thead>
      <tbody>
        {loading && <TableLoading columns={7} rows={4} />}
        {!loading && error && <TableMessage columns={7} role="alert">导出记录读取失败，不显示旧记录：{error}</TableMessage>}
        {!loading && !error && rows.length === 0 && <TableMessage columns={7}>还没有导出记录</TableMessage>}
        {!loading && !error && rows.map((row, index) => (
          <Tr key={`${row.ts}-${index}`} mark={row.mask === "decrypted" ? "danger" : undefined}>
            <Td><Cell num main={auditTime(row.ts)} /></Td>
            <Td><Cell main={row.who} title={row.who} /></Td>
            <Td grow><Cell main={row.what} title={row.what} /></Td>
            <Td align="right"><Cell num main={String(row.rows)} /></Td>
            <Td><span className="l5-pii">{row.pii ? <StatusTag tone="warn">含隐私</StatusTag> : <span className="l5-weak">无隐私</span>}<MaskTag mask={row.mask} /></span></Td>
            <Td><Cell main={row.chain} title={row.chain} /></Td>
            <Td><span className="l5-weak">{row.dl}</span></Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
