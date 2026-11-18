"use client";
import { eCommandClosureOffer, eCommandClosureRequests } from "@/lib/admin/e-command-investigation";

/**
 * J3 · 篡改防御监控（看板页）。安全和风控同事在这页看系统拦下了多少次篡改请求、集中在哪些接口、
 * 哪些账户达到告警阈值、告警有没有送到风险评分（K4）和风险提醒（B5）。处置不在本页：账户行只跳
 * C2 账户操作和 K1 多账户风险排查。本页的写入口是导出脱敏报表（带审计的只读导出）和修改告警设置（直接生效）。
 * 配置恢复使用提交前保存的完整原请求；报表按只读导出的既定例外处理。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import {
  ArrowDown, ArrowUp, CalendarDays, ChartColumn, Check, CircleHelp, CircleSlash, Download, FileDown, Gauge, ListChecks,
  RefreshCw, Route, ShieldAlert, ShieldCheck, SlidersHorizontal, TriangleAlert, UsersRound,
} from "lucide-react";
import {
  BarList, BlockState, Button, Cell, ColumnChart, Conclusion, DiffField, Explain, Fact, Facts, Field, FilterBar, Fold, Modal,
  Notice, NumberInput, PageHeader, Panel, ReleaseModal, Segments, Stat, StatBand, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr,
} from "@/app/components/rd";
import type { JCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { finishJ3ReportAttempt, getJ3LegacyCommand, getJ3PendingCommand, isEmergencyOutcomeUncertain, queryJ3Command, releaseExpiredJLegacyCommand, retryJ3Command } from "@/lib/admin/j-client";
import { fundCommandSettled, fundInvestigationAccess, type FundCommandRecord, type FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { FundRecoveryPanel, type FundRecoveryRow } from "../fund-command-check";
import { SettledLine, receiptFact, receiptRejected } from "../recovery-panel";
import { CommandClosureModal, } from "../e-tabs/e-command-check";
import { PROCESSED_IN_DIALOG, REJECTED_IN_DIALOG, SETTLED_OTHER, SETTLED_TEXT, processedStatus } from "./j-recovery-copy";
import type { J3PendingCommand, TamperAccount, TamperOverview, TamperReport } from "@/lib/admin/j-client";
import { downloadJ3ReportFile } from "@/lib/admin/j3-report-download";
import { createSlotAttemptStore, isRetryExpired, RETRY_EXPIRED_TEXT, type SlotAttemptRecord } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessClock, businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

/** Old page records lack expected values: retain them for read-only investigation, never resend them. */
const commandAttempt = createSlotAttemptStore({
  storageKey: "nexion-admin-j3-tamper-commands-v1",
  retainExpiredRecords: true,
});
const ALERT_CONFIG_SLOT = "alert-config";

type J3Window = "24h" | "7d" | "30d";
const WINDOWS: readonly J3Window[] = ["24h", "7d", "30d"];
/** 时间范围在页面上的叫法：标题、统计和导出都用这一套。 */
const WINDOW_TEXT: Record<J3Window, string> = { "24h": "近 24 小时", "7d": "近 7 天", "30d": "近 30 天" };
const WINDOW_SPAN: Record<J3Window, string> = { "24h": "24 小时", "7d": "7 天", "30d": "30 天" };
const PREVIOUS_SPAN: Record<J3Window, string> = { "24h": "前一个 24 小时", "7d": "前一个 7 天", "30d": "前一个 30 天" };

/** 后端登记的 10 类拦截接口（TamperCoverageRegistry）。接口返回的中文名优先，这张表只给还没有拦截记录的接口配中文。 */
const PATH_NAMES: Record<string, string> = {
  free_trial_state: "试用状态篡改",
  risk_disclosure_ack: "风险披露确认篡改",
  two_factor_state: "两步验证状态篡改",
  product_phase_override: "产品阶段覆盖",
  device_slot_cap: "设备槽位上限篡改",
  dev_seed_state: "设备开发种子篡改",
  otp_verification: "验证码校验绕过",
  bill_client_push: "客户端账单伪造",
  client_minted_id: "客户端业务 ID 伪造",
  charge_fail_rate: "扣款成功率篡改",
};

const num = (value: number) => value.toLocaleString("en-US");

function j3ErrorText(error: unknown) {
  return error instanceof Error ? displayAdminError(error) : "操作失败，请刷新页面后重试。";
}

type SavedConfig = { threshold: number; feedK4: boolean; reason: string; createdAt: number; expiresAt: number; command?: J3PendingCommand; legacy?: { record: SlotAttemptRecord; store: "emergency" | "page" } };

function readSavedConfig(): SavedConfig | null {
  const command = getJ3PendingCommand();
  if (command) return { ...command.tamper.input, createdAt: command.createdAt, expiresAt: command.expiresAt, command };
  const emergencyRecord = getJ3LegacyCommand();
  const record = emergencyRecord ?? commandAttempt.list().find((row) => row.fingerprint === ALERT_CONFIG_SLOT);
  if (!record) return null;
  try {
    const input = JSON.parse(record.inputFingerprint) as { threshold?: unknown; feedK4?: unknown; reason?: unknown };
    if (typeof input.threshold !== "number" || typeof input.feedK4 !== "boolean") return null;
    return { threshold: input.threshold, feedK4: input.feedK4, reason: typeof input.reason === "string" ? input.reason : "", createdAt: record.createdAt, expiresAt: record.expiresAt,
      legacy: { record, store: emergencyRecord ? "emergency" : "page" } };
  } catch {
    return null;
  }
}

const feedText = (feedK4: boolean) => (feedK4 ? "计入" : "不计入");

/** 恢复列表的一行：有原来的值写「从…改成…」，旧记录没存原来的值只写改成什么。 */
function savedChange(saved: SavedConfig) {
  const input = saved.command?.tamper.input;
  if (!input) return `告警阈值改成 ${saved.threshold} 次 / 24 小时，风险评分${feedText(saved.feedK4)}（原来的值没存）`;
  const parts = [
    input.expectedThreshold !== input.threshold ? `告警阈值 ${input.expectedThreshold} → ${input.threshold} 次 / 24 小时` : `告警阈值仍是 ${input.threshold} 次 / 24 小时`,
    input.expectedFeedK4 !== input.feedK4 ? `风险评分${feedText(input.expectedFeedK4)} → ${feedText(input.feedK4)}` : `风险评分仍${feedText(input.feedK4)}`,
  ];
  return parts.join("，");
}

/** 恢复面板一行的标题：只写改了的那一项。 */
function savedTitle(saved: SavedConfig) {
  const input = saved.command?.tamper.input;
  if (!input) return `告警设置 · 阈值改成 ${saved.threshold} 次`;
  const parts = [
    input.expectedThreshold !== input.threshold ? `阈值 ${input.expectedThreshold} → ${input.threshold} 次` : "",
    input.expectedFeedK4 !== input.feedK4 ? `风险评分${feedText(input.expectedFeedK4)} → ${feedText(input.feedK4)}` : "",
  ].filter(Boolean);
  return `告警设置 · ${parts.join("，") || "阈值和风险评分不变"}`;
}

/** 查询、结案都按原记录的出处定位；升级期间没存出处的完整记录按当前账号查，和 queryJ3Command 一致。 */
function investigationRecord(command: J3PendingCommand, adminId: string): FundCommandRecord {
  return { ...command, commandOrigin: command.tamper.commandOrigin
    ?? { originalMethod: "PUT", originalPath: "/api/admin/emergency/tamper/alert-config", readAuthority: "emergency_j3_read", originalAdminId: adminId } };
}

type J3Settled = { key: string; label: string; status: string };

/** 修改框里「查询原结果」没有结论时的一句。 */
function outcomeText(outcome: FundInvestigationOutcome) {
  if ("error" in outcome) return `原结果没查到：${outcome.error}`;
  const status = outcome.receipt?.originalStatus;
  return !status ? "没有查到原修改的记录，查不到不等于没执行。"
    : status === "SUCCEEDED" ? receiptRejected(outcome.receipt) ? REJECTED_IN_DIALOG : PROCESSED_IN_DIALOG
    : status === "PROCESSING" ? "原修改还在执行，稍后再查。"
      : status === "FAILED" ? "系统记录原修改失败了。"
        : "系统也没有结果，需要有调查权限的超级管理员核查结案。";
}

/** 后端小时桶「2026-11-13 14:00」、日桶「2026-11-13」，横轴只写时分或月日。 */
const tickOf = (label: string) => (/^\d{4}-\d{2}-\d{2} /.test(label) ? label.slice(11) : /^\d{4}-/.test(label) ? label.slice(5) : label);

export function J3Tamper({ ctx }: { ctx: JCtx }) {
  const { toast, actions, emergency } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const reach = useReach();
  const canExport = authorities.includes("emergency_j3_export");
  const canConfigure = authorities.includes("emergency_j3_alert_config");
  const canViewK1 = reach("/risk/multi-account", "risk_k1_read");
  const canFreezeC2 = reach("/users/actions", "user_c2_read") && authorities.includes("user_c2_account_freeze");
  const data = emergency.tamper;
  const alert = data?.alertConfig;
  const window = data?.window ?? "24h";
  const hasData = data?.hasData ?? false;
  const [configOpen, setConfigOpen] = useState<null | { original: SavedConfig | null }>(null);
  const [exporting, setExporting] = useState(false);
  const [pendingReport, setPendingReport] = useState<TamperReport | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [releasing, setReleasing] = useState<SavedConfig["legacy"] | null>(null);
  const adminId = useAdminAuth((state) => String(state.session?.adminId ?? ""));
  const [outcomes, setOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [settled, setSettled] = useState<J3Settled[]>([]);
  const [checking, setChecking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [readAt, setReadAt] = useState<number | null>(null);
  const accountsRef = useRef<HTMLDivElement>(null);
  const retryableReport = pendingReport?.window === window ? pendingReport : null;

  const syncSaved = useCallback(() => setSaved(readSavedConfig()), []);
  useEffect(() => { syncSaved(); }, [syncSaved]);
  useEffect(() => { if (data) setReadAt(Date.now()); }, [data]);
  useEffect(() => {
    if (!saved || isRetryExpired(saved)) return;
    const timer = setTimeout(syncSaved, saved.expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [saved?.expiresAt, syncSaved]);
  useEffect(() => {
    if (configOpen && !configOpen.original && (ctx.contentLoading || ctx.contentError || !alert || accountLoading)) setConfigOpen(null);
  }, [configOpen, ctx.contentLoading, ctx.contentError, alert, accountLoading]);

  const abandonPendingReport = () => {
    setPendingReport(null);
    toast("已放弃这份报表；下次导出会重新生成。", "info");
  };
  const downloadReport = () => {
    if ((!hasData && !retryableReport) || exporting) return;
    if (retryableReport) {
      try {
        downloadJ3ReportFile(retryableReport);
        setPendingReport(null);
        toast(`已重新开始下载${WINDOW_TEXT[retryableReport.window]}的脱敏报表`, "success");
      } catch (error) {
        toast(`报表已生成，但浏览器还是没下载成功。可以再点「重新下载」，或放弃这份报表 · ${j3ErrorText(error)}`, "error");
      }
      return;
    }
    ctx.openActionConfirm({ briefKind: "export",
      action: `导出 ${window} 报表`,
      title: "导出篡改拦截报表",
      detail: <>导出{WINDOW_TEXT[window]}的篡改拦截报表，用户编号脱敏，导出会留操作记录。</>,
      effect: <StatusTag tone="neutral" icon={FileDown}>不改业务数据</StatusTag>,
      facts: (
        <Facts>
          <Fact k="时间范围">{WINDOW_TEXT[window]}（从生成报表的时刻往前算）</Fact>
          <Fact k="内容">各入口的拦截汇总，和这个范围内全部达到告警阈值的账户（不只是当前页）</Fact>
          <Fact k="脱敏">用户编号只留首字符和末 4 位，比如 U****1234；不含昵称、手机号</Fact>
          <Fact k="上限">达到告警阈值的账户超过 10,000 个时不能导出，请换短一点的时间范围</Fact>
          <Fact k="文件">CSV 文件，确认后由浏览器下载，没有下载链接</Fact>
        </Facts>
      ),
      statedBrief: {
        impact: "只生成一份脱敏报表并下载，不改账户、风险评分和告警设置；导出会写一条操作记录。",
        check: "核对时间范围；理由写清用途或工单号。",
      },
      confirmLabel: "确认导出",
      reasonPlaceholder: "例如：工单号、报表用途",
      reasonMax: 200,
      run: async (reason) => {
        if (!useAdminAuth.getState().session?.authorities.includes("emergency_j3_export")) throw new Error("ACCESS_DENIED");
        const exportKey = `j3-report-${crypto.randomUUID()}`;
        setExporting(true);
        let report: TamperReport;
        try {
          report = await actions.createJ3Report(window, reason, exportKey);
        } catch (error) {
          if (isEmergencyOutcomeUncertain(error)) {
            toast("没有收到报表文件，导出没有完成，请重新导出。", "warn");
            return;
          }
          throw error;
        } finally {
          finishJ3ReportAttempt(exportKey);
          setExporting(false);
        }
        // 服务端已生成报表，后续只重试下载该文件。
        setPendingReport(report);
        try {
          downloadJ3ReportFile(report);
          setPendingReport(null);
          toast(`报表已生成，开始下载${WINDOW_TEXT[report.window]}的脱敏报表 · ${num(report.eventCount)} 次拦截`, "success");
        } catch (error) {
          toast(`报表已生成，但浏览器没下载成功。可以点「重新下载」，或放弃这份报表 · ${j3ErrorText(error)}`, "error");
        }
      },
    });
  };

  const reload = () => void actions.reloadJEmergency().catch(() => undefined);
  /** 只记下查到的结论给运营看；解除与否由 queryJ3Command 按后端结论决定。 */
  const recordOutcome = (command: J3PendingCommand, outcome: FundInvestigationOutcome, label: string) => {
    setOutcomes((current) => ({ ...current, [command.commandKey]: outcome }));
    if ("receipt" in outcome && fundCommandSettled(outcome.receipt)) {
      setSettled((current) => [...current.filter((item) => item.key !== command.commandKey), { key: command.commandKey, label, status: outcome.receipt!.originalStatus }]);
    }
  };
  const queryOriginal = async () => {
    if (saved?.command) {
      const command = saved.command;
      setChecking(true);
      try {
        const receipt = await queryJ3Command(command);
        recordOutcome(command, { receipt }, savedTitle(saved));
        if (fundCommandSettled(receipt)) {
          setConfigOpen(null);
          syncSaved();
          await actions.reloadJEmergency().catch(() => undefined);
          return;
        }
      } catch (error) {
        // An auxiliary lookup failure must not prevent the current-settings read.
        recordOutcome(command, { error: j3ErrorText(error) }, savedTitle(saved));
      } finally { setChecking(false); }
    }
    void actions.reloadJEmergency().then((next) => {
      const now = next.tamper?.alertConfig;
      if (now) toast(`现在读到：告警阈值 ${now.threshold} 次 / 24 小时，风险评分${feedText(now.feedK4)}。这是现在的值，不能据此判断原修改成没成。`, "info");
    }).catch(() => undefined);
  };
  const closeConfig = () => { setConfigOpen(null); syncSaved(); };
  const configBlocked = saved ? j3ErrorText(new Error("J3_ORIGINAL_CONFIG_PENDING"))
    : ctx.contentLoading || ctx.contentError || accountLoading ? j3ErrorText(new Error("J3_LATEST_OVERVIEW_REQUIRED")) : undefined;

  const exportDisabledReason = exporting ? undefined
    : retryableReport ? undefined
      : !data ? "数据还没读到，读到后才能导出"
        : !hasData ? `${WINDOW_TEXT[window]}没有拦截记录，不用导出空报表` : undefined;

  const header = (
    <PageHeader pageId="J3" title="篡改防御监控"
      summary="看系统拦下了多少次篡改请求、打在哪里、哪些账户要处理。"
      actions={<>
        {canExport && (
          <Button icon={<Download size={14} aria-hidden />} loading={exporting} loadingText="生成中…" disabledReason={exportDisabledReason}
            onClick={downloadReport}>
            {retryableReport ? `重新下载${WINDOW_TEXT[window]}报表` : `导出${WINDOW_TEXT[window]}报表`}
          </Button>
        )}
        {canConfigure && alert && (
          <Button icon={<SlidersHorizontal size={14} aria-hidden />} disabledReason={configBlocked}
            onClick={() => { if (readSavedConfig()) syncSaved(); else setConfigOpen({ original: null }); }}>修改告警设置</Button>
        )}
      </>}
      meta={<span className="rd-toolbar">
        {readAt && <span>{businessClock(readAt)} 读取（{businessZone().label}）<Explain label="数据时间说明" content="打开页面、切换时间范围、翻页和点「刷新」时读取，不自动更新。" /></span>}
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={ctx.contentLoading} onClick={reload}>刷新</Button>
      </span>}
      readOnly={!canExport && !canConfigure ? <>你只能查看 <Explain label="只读说明" content="导出报表和修改告警设置各要单独的权限，请联系超级管理员。" /></> : undefined}
      guideExtra={<>
        <p>这个账号：{canExport ? "能导出报表" : "不能导出报表"}，{canConfigure ? "能改告警设置" : "不能改告警设置"}。</p>
        <p>处理账户：{canFreezeC2 ? "能去账户操作" : "不能去账户操作"}，{canViewK1 ? "能去多账户排查" : "不能去多账户排查"}。</p>
      </>} />
  );

  const command = saved?.command;
  const expired = !!saved && isRetryExpired(saved);
  const record = command ? investigationRecord(command, adminId) : null;
  const outcome = command ? outcomes[command.commandKey] : undefined;
  const receipt = outcome && "receipt" in outcome ? outcome.receipt : null;
  const canSubmit = !!record && fundInvestigationAccess(record).canSubmit;
  const processed = receipt?.originalStatus === "SUCCEEDED";
  const canClose = canSubmit && eCommandClosureRequests(receipt, expired).conclusions.length > 0;
  const recoveryRows: FundRecoveryRow[] = saved ? [{
    key: command?.commandKey ?? "j3-legacy",
    title: savedTitle(saved),
    record: record ?? undefined,
    outcome,
    createdAt: saved.createdAt,
    expired,
    canRetry: canConfigure && !expired && !!command,
    canQuery: true,
    status: saved.legacy ? expired
      ? { tone: "neutral", label: "已过期", line: "改版前的旧记录查不了原结果；到操作记录与审批核对后，可以确认解除。" }
      : { tone: "warn", label: "结果未知", line: "改版前的旧记录不能重试，查询只能看到现在的设置。" }
      : processed ? processedStatus({ expired, canRetry: canConfigure, canClose: canSubmit, receipt }) : undefined,
    actions: <>
      <Button size="sm" loading={checking || ctx.contentLoading} disabled={closing} onClick={queryOriginal}>查询原结果</Button>
      {canClose && <Button size="sm" variant="danger-outline" disabled={checking} onClick={() => setClosing(true)}>核查结案</Button>}
      {canConfigure && !expired && !!command && <Button size="sm" disabled={checking} onClick={() => setConfigOpen({ original: saved })}>按原请求重试</Button>}
      {saved.legacy && expired && <Button size="sm" onClick={() => setReleasing(saved.legacy)}>确认解除</Button>}
    </>,
    detail: <p>{savedChange(saved)}。</p>,
  }] : [];

  const savedNotice = <>
    {settled.map((item) => <SettledLine key={item.key} label={item.label} text={SETTLED_TEXT[item.status] ?? SETTLED_OTHER}
      onDismiss={() => setSettled((current) => current.filter((row) => row.key !== item.key))} />)}
    <FundRecoveryPanel rows={recoveryRows} />
    {closing && command && record && <CommandClosureModal label="修改告警设置" commandKey={command.commandKey} createdAt={command.createdAt} offer={eCommandClosureOffer(outcome, isRetryExpired(command))}
      facts={<>
        <Fact k="改动">{savedChange(saved!)}</Fact>
        <Fact k="系统记录">{receiptFact(receipt, "原修改还锁着")}</Fact>
        {receipt?.investigation && <Fact k="上次核查">{formatBusinessTimeCompact(receipt.investigation.investigatedAt, "—")}，记为「{receipt.investigation.conclusion === "SUCCEEDED" ? "已执行" : receipt.investigation.conclusion === "NOT_EXECUTED" ? "未执行" : "仍未知"}」</Fact>}
      </>}
      onClose={() => setClosing(false)}
      onSubmit={async (evidence) => {
        const next = await queryJ3Command(command, evidence);
        recordOutcome(command, { receipt: next }, savedTitle(saved!));
        setClosing(false);
        if (fundCommandSettled(next)) {
          syncSaved();
          await actions.reloadJEmergency().catch(() => undefined);
        }
      }} />}
    {releasing && <ReleaseModal label="告警设置 · 改版前的旧记录"
      explain={<><p>改版前的旧记录没存原修改的内容，不能重试，也不能核查结案。</p><p>先到「操作记录与审批」核对原修改有没有生效。</p></>}
      onCancel={() => setReleasing(null)} onConfirm={() => {
        if (releasing.store === "emergency") releaseExpiredJLegacyCommand(releasing.record);
        // The old page and client saved the same operation in both stores.
        const record = commandAttempt.list().find((row) => row.fingerprint === ALERT_CONFIG_SLOT && row.commandKey === releasing.record.commandKey);
        if (record && isRetryExpired(record)) commandAttempt.forget(record.fingerprint, record.commandKey);
        setReleasing(null);
        syncSaved();
      }} />}
  </>;

  const reportNotice = retryableReport && (
    <Notice tone="warn" title="报表已生成，还没下载到本机"
      action={<>
        <Button size="sm" disabled={exporting} onClick={downloadReport}>重新下载</Button>
        <Button size="sm" variant="ghost" disabled={exporting} onClick={abandonPendingReport}>放弃这份报表</Button>
      </>}>
      {WINDOW_TEXT[retryableReport.window]}的报表只存在这个页面里，刷新就没了。重新下载不会再生成，也不多记一次导出。
    </Notice>
  );

  const modal = configOpen && (configOpen.original?.command || alert) && (
    <J3ConfigModal ctx={ctx} original={configOpen.original} onClose={closeConfig}
      onOutcome={(pending, result) => recordOutcome(pending, result, configOpen.original ? savedTitle(configOpen.original) : "修改告警设置")}
      onPending={() => { const next = readSavedConfig(); setSaved(next); if (next?.command) setConfigOpen({ original: next }); }} />
  );

  if (ctx.contentError) {
    return <div className="j3-page">
      {header}
      {savedNotice}
      {reportNotice}
      <BlockState state="error" title="当前无法确认最新状态" detail={`${ctx.contentError} 统计和告警账户先不显示，读到后再判断。`} onRetry={reload} retrying={ctx.contentLoading} />
      {modal}
    </div>;
  }
  if (!data) {
    return <div className="j3-page">
      {header}
      {savedNotice}
      {ctx.contentLoading
        ? <BlockState state="loading" title="篡改防御数据加载中" detail="正在读取拦截统计和告警账户" />
        : <BlockState state="empty" title="暂无篡改防御数据" detail="请稍后点「刷新」。" />}
      {modal}
    </div>;
  }

  return <div className="j3-page">
    {header}
    {savedNotice}
    {reportNotice}
    <J3Board data={data} ctx={ctx} accountLoading={accountLoading} setAccountLoading={setAccountLoading} accountsRef={accountsRef}
      canViewK1={canViewK1} canFreezeC2={canFreezeC2} reach={reach} />
    {modal}
  </div>;
}

function J3Board({ data, ctx, accountLoading, setAccountLoading, accountsRef, canViewK1, canFreezeC2, reach }: {
  data: TamperOverview;
  ctx: JCtx;
  accountLoading: boolean;
  setAccountLoading: (loading: boolean) => void;
  accountsRef: RefObject<HTMLDivElement | null>;
  canViewK1: boolean;
  canFreezeC2: boolean;
  reach: ReturnType<typeof useReach>;
}) {
  const win = data.window;
  const TAMPER_TREND = data.trend;
  const TAMPER_PATHS = data.paths;
  const TAMPER_ACCTS = data.accounts;
  const d = TAMPER_TREND[win];
  const totalPath = TAMPER_PATHS.reduce((s, p) => s + p.ct, 0);
  const total7d = TAMPER_TREND["7d"].pts.reduce((s, p) => s + p, 0);
  const accountPager = data.accountPage;
  const accountTotal = Number(data.stats.highFrequencyAccounts ?? accountPager.total ?? TAMPER_ACCTS.length);
  const statNumber = (...keys: string[]) => {
    for (const key of keys) {
      const raw = data.stats[key];
      if (raw === null || raw === undefined || raw === "") continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  };
  const deltaPrevPct = statNumber("deltaPrevPct");
  const alertThreshold = data.alertConfig.effectiveThreshold;
  const loadAccountPage = (nextPage: number) => {
    if (accountLoading) return;
    const targetPage = Math.max(1, Math.min(nextPage, Math.max(1, accountPager.pages)));
    if (targetPage === accountPager.page) return;
    setAccountLoading(true);
    ctx.actions.loadJ3TamperPage(win, targetPage, accountPager.pageSize)
      .catch((error) => ctx.toast(`告警账户加载失败 · ${j3ErrorText(error)}`, "error"))
      .finally(() => setAccountLoading(false));
  };
  const loadWindow = (nextWindow: J3Window) => {
    if (accountLoading || nextWindow === win) return;
    setAccountLoading(true);
    ctx.actions.loadJ3TamperPage(nextWindow, 1, accountPager.pageSize)
      .catch((error) => ctx.toast(`时间范围切换失败 · ${j3ErrorText(error)}`, "error"))
      .finally(() => setAccountLoading(false));
  };
  const fedCount = TAMPER_ACCTS.filter((account) => account.fedToK4).length;
  const b5Count = TAMPER_ACCTS.filter((account) => account.b5Triggered).length;
  const coverageComplete = data.coverage.status === "complete";
  const zone = businessZone().label;
  const W = WINDOW_TEXT[win];
  const pathName = (key: string) => TAMPER_PATHS.find((path) => path.id === key)?.nm || PATH_NAMES[key] || key;

  // 并列峰值取最后一个（和旧页面一致）。
  const peakIndex = d.pts.reduce((best, value, index) => (value >= (d.pts[best] ?? -1) ? index : best), 0);
  const peakLabel = d.labels[peakIndex];
  const scrollToAccounts = () => accountsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const deltaText = deltaPrevPct === null ? `${PREVIOUS_SPAN[win]}为 0，无法比较`
    : `比${PREVIOUS_SPAN[win]} ${deltaPrevPct > 0 ? "+" : ""}${deltaPrevPct}%`;
  const conclusionExplain = <>
    <p>拦截次数是{W}里系统已经处理完的拦截事件之和，只统计已登记的 {data.coverage.registeredCount} 类入口；还没处理完的事件不算在内。</p>
    <p>账户达到告警阈值：{W}内被拦次数 ≥ {num(alertThreshold)} 次（每 24 小时 {data.alertConfig.threshold} 次 × {win === "24h" ? 1 : win === "7d" ? 7 : 30}）。</p>
  </>;

  const userRef = (code: string) => {
    const href = `/users/search/${encodeURIComponent(code)}`;
    return reach(href, "user_c1_read")
      ? <Link className="rd-link" href={`${href}?returnTo=${encodeURIComponent(`${globalThis.location.pathname}${globalThis.location.search}`)}`}>{code}</Link>
      : code;
  };

  return <>
    {accountTotal > 0
      ? <Conclusion state="warn" lead icon={TriangleAlert} explain={conclusionExplain}
          hint="逐个去账户操作或多账户排查处理；本页不冻结账户。"
          action={<Button size="sm" onClick={scrollToAccounts}>查看这些账户</Button>}>
          {W}有 <b>{num(accountTotal)}</b> 个账户达到告警阈值
        </Conclusion>
      : totalPath > 0
        ? <Conclusion state="ok" icon={ShieldCheck} explain={conclusionExplain}>{W}有拦截，没有账户达到告警阈值</Conclusion>
        : <Conclusion state="ok" icon={ShieldCheck} explain={conclusionExplain}>{W}没有拦截记录</Conclusion>}

    {!coverageComplete && (
      <Notice tone="warn" title={`还有 ${data.coverage.registeredCount - data.coverage.activeCount} 类入口没接入拦截统计`}>
        这些入口被篡改时不会出现在这页，「没有拦截」只说明已接入的 {data.coverage.activeCount} 类入口：{data.coverage.missingPaths.map((key) => PATH_NAMES[key] ?? key).join("、")}。
      </Notice>
    )}

    <FilterBar
      scope={<Segments<J3Window> label="篡改趋势时间范围" value={win}
        items={WINDOWS.map((value) => ({ value, label: WINDOW_TEXT[value], disabled: accountLoading && value !== win }))}
        onChange={loadWindow} />}
      sort={<span className="rd-filter-result">时间范围管拦截次数、走势、入口、告警账户和导出</span>} />

    <StatBand label="篡改拦截统计" fit>
      <Stat lead={accountTotal === 0 && totalPath > 0} tone="role-2" icon={ShieldAlert} label={`${W}拦截`} value={num(totalPath)} unit="次" sub={deltaText}
        explain={`和紧挨着的${PREVIOUS_SPAN[win]}比。前一段为 0 而这段有拦截时没法算百分比。`} />
      <Stat tone="role-2" icon={CalendarDays} label="近 7 天拦截" value={num(total7d)} unit="次" sub={`日均约 ${num(Math.round(total7d / 7))} 次`}
        explain="固定看近 7 天，不随时间范围变。日均是 7 天合计除以 7 后四舍五入。" />
      <Stat tone="role-4" icon={Gauge} label="告警阈值" value={String(data.alertConfig.threshold)} unit="次 / 24 小时"
        sub={`风险评分：${feedText(data.alertConfig.feedK4)}`}
        explain={<>
          <p>一个账户 24 小时内被拦到这个次数就进告警名单；看 7 天、30 天时门槛按 7 倍、30 倍算。</p>
          <p>「风险评分：计入」表示新的篡改事件会给账户加风险分；不计入时风险提醒照常收到。</p>
          <p>「紧急停用开关」页的篡改告警激增规则读的也是这个阈值，那条规则只在这页统计账户，不发通知、不自动关停。</p>
        </>} />
    </StatBand>

    <div className="rd-split" data-even="">
      <Panel title="拦截走势" icon={ChartColumn} tone="role-2" sub={`${W} · ${win === "24h" ? "按小时" : "按天"} · ${zone}`}
        explain="只画有拦截的时段，没有拦截的时段不占位，所以柱子之间的间隔不代表时间长短。都是已被拦下的请求。">
        {!data.hasData || d.pts.length === 0
          ? <BlockState state="empty" title={`${W}没有拦截记录`} detail={coverageComplete ? undefined : "没接入的入口不在统计里。"} />
          : <>
            <ColumnChart label={`${W}每${win === "24h" ? "小时" : "天"}的拦截次数`} height={220} format={(value) => `${num(value)} 次`} axisFormat={num}
              series={[{ label: "拦截次数", slot: 2 }]}
              data={d.labels.map((label, index) => ({ key: label, tick: tickOf(label), values: [d.pts[index] ?? 0], detail: label }))} />
            <p className="j3-peak">最多的一段：{peakLabel ?? "—"} · {num(d.pts[peakIndex] ?? 0)} 次</p>
          </>}
      </Panel>

      <Panel title="被拦最多的入口" icon={Route} tone="role-2" sub={`${W} · 共 ${num(totalPath)} 次`}
        explain="按入口统计被拦下的篡改请求，从多到少排。中文名后面是入口的编号；账户数是被拦过的不同账户。">
        {TAMPER_PATHS.length === 0
          ? <BlockState state="empty" title={`${W}没有篡改记录`} />
          : <BarList label={`${W}各入口的拦截次数`} slot={2}
              rows={TAMPER_PATHS.map((path) => ({
                key: path.id,
                label: <span className="j3-path" title={path.desc || undefined}>
                  <span className="j3-path-name">{path.nm || PATH_NAMES[path.id] || path.id}</span>
                  <span className="j3-path-sub"><span data-mono>{path.id}</span> · {num(path.acct)} 个账户</span>
                </span>,
                value: path.ct,
                text: <>{num(path.ct)} 次<span className="j3-path-share">{totalPath > 0 ? `${Math.round((path.ct / totalPath) * 1000) / 10}%` : "—"}</span></>,
              }))} />}
      </Panel>
    </div>

    <div ref={accountsRef} className="j3-accounts">
      <Panel title="达到告警阈值的账户" icon={UsersRound} tone="role-3" flush
        sub={`${W} · 门槛 ≥ ${num(alertThreshold)} 次 · 共 ${num(accountPager.total)} 个`}
        explain={<>
          <p>{W}内被拦次数达到门槛的账户，按次数从多到少排。本页不冻结账户，处理请去账户操作或多账户排查。</p>
          <p>风险评分：这个范围里的拦截事件有没有计入风险评分，写的是这些事件加了多少分（分数到上限时可能是 0），不是账户现在的总分。风险提醒：有没有送进「风险提醒」页的最近风险信号，在那里显示为「篡改风险」。</p>
        </>}>
        {TAMPER_ACCTS.length > 0 && (
          <p className="j3-feed">
            本页 {TAMPER_ACCTS.length} 个账户：风险评分已计入 <b>{fedCount}</b> 个，风险提醒已送到 <b>{b5Count}</b> 个
            <Explain label="送达统计说明" content={`只算这一页的账户。新的篡改事件现在${data.alertConfig.feedK4 ? "会" : "不会"}计入风险评分。`} />
          </p>
        )}
        <Table label={`${W}达到告警阈值的账户`} data-loading={accountLoading ? "" : undefined}>
          <thead>
            <tr>
              <Th>用户编号</Th>
              <Th align="right">拦截次数（次）· 最近一次</Th>
              <Th>集中在</Th>
              <Th>告警送达</Th>
              <Th sticky="end">下一步</Th>
            </tr>
          </thead>
          <tbody>
            {TAMPER_ACCTS.length === 0
              ? <TableMessage columns={5} role="status">{W}没有账户达到告警阈值。</TableMessage>
              : TAMPER_ACCTS.map((a) => (
                <J3AccountRow key={a.userCode} account={a} feedK4={data.alertConfig.feedK4} zone={zone} userRef={userRef} pathName={pathName}
                  canViewK1={canViewK1} canFreezeC2={canFreezeC2} />
              ))}
          </tbody>
        </Table>
        {TAMPER_ACCTS.length > 0 && (
          <div className="rd-pager j3-pager">
            <span className="rd-pager-range">第 {accountPager.page} / {accountPager.pages} 页 · 共 {num(accountPager.total)} 个账户</span>
            <div className="rd-pager-tools">
              <Button size="sm" aria-label="告警账户 上一页" disabled={accountLoading || !accountPager.hasPrev} onClick={() => loadAccountPage(accountPager.page - 1)}>上一页</Button>
              <Button size="sm" aria-label="告警账户 下一页" disabled={accountLoading || !accountPager.hasNext} onClick={() => loadAccountPage(accountPager.page + 1)}>下一页</Button>
            </div>
          </div>
        )}
      </Panel>
    </div>

    <Fold title="统计范围" icon={ListChecks} tone="role-other"
      summary={`已登记 ${data.coverage.registeredCount} 类入口，${data.coverage.activeCount} 类在统计里 · 数据来源：系统实际拦截记录`}
      explain="已登记的是系统发布时登记的拦截入口，不是实时探测；统计只算已经处理完的拦截事件。">
      <ul className="j3-coverage" aria-label="已登记的拦截入口">
        {data.coverage.registeredPaths.map((key) => {
          const active = data.coverage.activePaths.includes(key);
          return (
            <li key={key}>
              <span className="j3-coverage-name">{pathName(key)}</span>
              <span data-mono className="j3-coverage-key">{key}</span>
              {active ? <StatusTag tone="ok" icon={Check}>在统计里</StatusTag> : <StatusTag tone="warn" icon={CircleSlash}>没接入</StatusTag>}
            </li>
          );
        })}
      </ul>
    </Fold>
  </>;
}

function J3AccountRow({ account: a, feedK4, zone, userRef, pathName, canViewK1, canFreezeC2 }: {
  account: TamperAccount;
  feedK4: boolean;
  zone: string;
  userRef: (code: string) => ReactNode;
  pathName: (key: string) => string;
  canViewK1: boolean;
  canFreezeC2: boolean;
}) {
  const alerting = a.alertState === "flagged" || a.alertState === "escalated";
  const names = a.paths.map(pathName);
  const k4 = a.fedToK4
    ? Number(a.k4) > 0
      ? <StatusTag tone="ok" icon={Check}>风险评分 {a.k4} 分</StatusTag>
      : <StatusTag tone="neutral" icon={Check} explain="风险评分已收到这些事件，但没有加分（比如账户分数已到上限）。">风险评分已计入 · 未加分</StatusTag>
    : <StatusTag tone={feedK4 ? "warn" : "neutral"} icon={feedK4 ? CircleHelp : CircleSlash} explain={`这个时间范围里这个账户的拦截都没有计入风险评分。告警设置现在是「${feedText(feedK4)}」；事件当时计没计入，以风险评分记录为准。`}>风险评分未计入</StatusTag>;
  const b5 = a.b5Triggered
    ? <StatusTag tone="ok" icon={Check}>风险提醒已送到</StatusTag>
    : <StatusTag tone="warn" icon={CircleHelp} explain="这个时间范围里这个账户的拦截没有一条进入风险提醒的风险信号。">风险提醒没送到</StatusTag>;
  return (
    <Tr>
      <Td><Cell mono main={userRef(a.userCode)} sub={a.cluster ? <>关联组 <span data-mono>{a.cluster}</span></> : "没有关联账户组"} /></Td>
      <Td align="right"><Cell num main={num(a.cnt)} sub={<span className="j3-last">最近 {a.lastOccurredAt.slice(0, 16)}<span className="rd-sr-only">（{zone}）</span></span>} /></Td>
      <Td grow><Cell main={names.length ? names.join("、") : "—"} title={a.paths.length ? a.paths.map((key) => `${pathName(key)}（${key}）`).join("、") : undefined} /></Td>
      <Td><span className="j3-feed-tags">{k4}{b5}</span></Td>
      <Td sticky="end">
        <span className="j3-next">
          {canFreezeC2 && alerting
            ? <Link className="rd-link" href={{ pathname: "/users/actions", query: { userCode: a.userCode, source: "J3" } }} title={`${a.userCode} · 去账户操作冻结或解冻`}>去账户操作处理</Link>
            : <span className="j3-off" aria-disabled="true" title="这个账号没有账户操作的冻结权限">去账户操作处理</span>}
          {a.cluster && (canViewK1 && alerting
            ? <Link className="rd-link" href={{ pathname: "/risk/multi-account", query: { focusClusterId: a.cluster, source: "J3" } }} title={`${a.cluster} · 查看关联账户组`}>去多账户排查</Link>
            : <span className="j3-off" aria-disabled="true" title="这个账号没有多账户风险排查的权限">去多账户排查</span>)}
        </span>
      </Td>
    </Tr>
  );
}

/** Recovery facts and requests come only from the submission-time record, including after a failed overview read. */
function J3ConfigModal({ ctx, original, onClose, onPending, onOutcome }: { ctx: JCtx; original: SavedConfig | null; onClose: () => void; onPending: () => void;
  onOutcome: (pending: J3PendingCommand, outcome: FundInvestigationOutcome) => void }) {
  const [current] = useState(() => original?.command?.tamper.context ?? ctx.emergency.tamper!.alertConfig);
  const sevenDayAlertAccounts = current.sevenDayAlertAccounts;
  const [thresholdText, setThresholdText] = useState(String(original?.threshold ?? current.threshold));
  const threshold = Number(thresholdText);
  const [feedK4, setFeedK4] = useState(original?.feedK4 ?? current.feedK4);
  const [reason, setReason] = useState(original?.reason ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(original?.command ?? null);
  const unknownAt = pending?.createdAt ?? null;
  const [readBack, setReadBack] = useState<ReactNode>(null);
  const changed = threshold !== current.threshold || feedK4 !== current.feedK4;
  const reasonLength = reason.trim().length;
  const targetSevenDayAccounts = current.sevenDayPreviewByThreshold[String(threshold)];
  const previewAvailable = Number.isInteger(targetSevenDayAccounts) && targetSevenDayAccounts >= 0;
  const thresholdValid = Number.isInteger(threshold) && threshold >= 1 && threshold <= 100;
  const valid = changed && thresholdValid && previewAvailable && reasonLength >= 8 && reasonLength <= 200;
  const thresholdChanged = thresholdValid && threshold !== current.threshold;
  const feedChanged = feedK4 !== current.feedK4;
  const locked = unknownAt !== null || submitting;
  const submit = async () => {
    if (submitting || !pending && !valid) return;
    if (!useAdminAuth.getState().session?.authorities.includes("emergency_j3_alert_config")) {
      ctx.toast(j3ErrorText(new Error("ACCESS_DENIED")), "error");
      return;
    }
    if (pending && isRetryExpired(pending)) {
      ctx.toast(RETRY_EXPIRED_TEXT, "warn");
      return;
    }
    if (!pending && (readSavedConfig() || ctx.contentLoading || ctx.contentError || !ctx.emergency.tamper)) {
      ctx.toast(j3ErrorText(new Error("J3_LATEST_OVERVIEW_REQUIRED")), "warn");
      return;
    }
    setSubmitting(true);
    try {
      if (pending) await retryJ3Command(pending);
      else await ctx.actions.updateJ3AlertConfig(
        threshold, feedK4, current.threshold, current.feedK4, reason.trim(), `j3-config-${crypto.randomUUID()}`, current,
      );
    } catch (error) {
      const retained = getJ3PendingCommand();
      if (retained) {
        setPending(retained);
        onPending();
      }
      setSubmitting(false);
      if (!isEmergencyOutcomeUncertain(error)) ctx.toast(`修改没有成功 · ${j3ErrorText(error)}`, "error");
      // An original retry has ended only after the client removed it on a definite backend verdict.
      if (pending && !retained) {
        onClose();
        await ctx.actions.reloadJEmergency().catch(() => undefined);
      }
      return;
    }
    onClose();
    try {
      await ctx.actions.reloadJEmergency();
      ctx.toast(pending ? "原修改已生效；页面显示的是现在的设置" : "告警设置已生效", "success");
    } catch {
      ctx.toast(pending ? "原修改已生效，但页面刷新失败，请手动刷新核对现在的设置。" : "告警设置已生效，但页面刷新失败，请手动刷新核对。", "warn");
    } finally {
      setSubmitting(false);
    }
  };
  const queryOriginal = async () => {
    setReadBack("正在读取…");
    let found = "";
    if (pending) {
      try {
        const receipt = await queryJ3Command(pending);
        onOutcome(pending, { receipt });
        if (fundCommandSettled(receipt)) {
          onClose();
          await ctx.actions.reloadJEmergency().catch(() => undefined);
          return;
        }
        found = outcomeText({ receipt });
      } catch (error) {
        // Preserve the original and continue with the existing read-only fallback.
        onOutcome(pending, { error: j3ErrorText(error) });
        found = outcomeText({ error: j3ErrorText(error) });
      }
    }
    void ctx.actions.reloadJEmergency().then((next) => {
      const now = next.tamper?.alertConfig;
      setReadBack(<>{found && <>{found}<br /></>}{now ? `现在读到：告警阈值 ${now.threshold} 次 / 24 小时，风险评分${feedText(now.feedK4)}。这是现在的值，不能据此判断原修改成没成。` : "没读到告警设置，请稍后再查。"}</>);
    }).catch((error) => setReadBack(`${found ? `${found} ` : ""}读取失败 · ${j3ErrorText(error)}`));
  };

  const canRetry = useAdminAuth((state) => state.session?.authorities.includes("emergency_j3_alert_config") ?? false);
  const blocked = pending ? !canRetry ? j3ErrorText(new Error("ACCESS_DENIED")) : isRetryExpired(pending) ? RETRY_EXPIRED_TEXT : undefined
    : !changed ? "告警阈值和风险评分都没改"
    : !thresholdValid ? "告警阈值要填 1–100 的整数"
      : !previewAvailable ? "暂时算不出这个阈值的影响，不能提交。"
        : reasonLength < 8 ? "操作理由至少 8 字"
          : reasonLength > 200 ? "操作理由最多 200 字" : undefined;
  const thresholdError = touched && !thresholdValid ? "要填 1–100 的整数" : undefined;
  const reasonError = touched && reasonLength < 8 ? `至少 8 字，还差 ${8 - reasonLength} 字` : undefined;

  return (
    <Modal title="修改告警设置" icon={SlidersHorizontal} busy={submitting} dirty={changed || reason.length > 0}
      sub={unknownAt !== null ? <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag> : <StatusTag tone="progress" filled>立即生效</StatusTag>}
      onClose={() => { if (!submitting) onClose(); }}
      footer={unknownAt !== null ? <>
        <Button disabled={submitting} onClick={onClose}>取消</Button>
        <Button disabled={submitting} onClick={queryOriginal}>查询原结果</Button>
        <Button variant="primary" loading={submitting} loadingText="提交中…" disabledReason={blocked} onClick={() => { setTouched(true); void submit(); }}>按原请求重试</Button>
      </> : <>
        <Button disabled={submitting} onClick={onClose}>取消</Button>
        <Button variant="primary" loading={submitting} loadingText="提交中…" disabledReason={blocked} onBlockedClick={() => setTouched(true)}
          onClick={() => { setTouched(true); void submit(); }}>确认修改</Button>
      </>}>
      {unknownAt !== null && (
        <Notice tone="warn" title="这次修改结果未知">
          <p>{businessStamp(unknownAt)}（{businessZone().label}）提交后没收到确定结果，可能已经生效。下面是这次提交的内容，不能再改。</p>
          <p>可以查询原结果；24 小时内也可以按原请求重试，不会重复执行。</p>
          {readBack && <p>{readBack}</p>}
        </Notice>
      )}
      <DiffField before={String(current.threshold)} unit="次 / 24 小时" beforeLabel="告警阈值" label="改成" hint="1–100 的整数" error={thresholdError}
        explain="一个账户 24 小时内被拦到这个次数就进告警名单；看 7 天、30 天时按 7 倍、30 倍算。保存后立即生效。"
        state={thresholdChanged ? threshold < current.threshold
          ? <StatusTag tone="neutral" icon={ArrowDown}>调低：告警账户不会变少</StatusTag>
          : <StatusTag tone="neutral" icon={ArrowUp}>调高：告警账户不会变多</StatusTag> : undefined}
        note={thresholdChanged ? previewAvailable
          ? <>按近 7 天的记录重算，达到告警的账户 {num(sevenDayAlertAccounts)} 个 → <b>{num(targetSevenDayAccounts)}</b> 个；24 小时、7 天、30 天的门槛变成 {num(threshold)}、{num(threshold * 7)}、{num(threshold * 30)} 次。</>
          : "暂时算不出这个阈值的影响，不能提交。" : undefined}>
        {(control) => <NumberInput {...control} unit="次" min={1} max={100} step={1} value={thresholdText} disabled={locked}
          onChange={(event) => setThresholdText(event.target.value)} onBlur={() => setTouched(true)} />}
      </DiffField>
      <DiffField before={feedText(current.feedK4)} beforeLabel="新事件计入风险评分" label="改成" size="body"
        explain="新的篡改事件要不要给账户加风险分（风险评分规则里的篡改分）。保存后立即生效。"
        state={feedChanged ? feedK4
          ? <StatusTag tone="neutral" icon={ArrowUp}>开始计入</StatusTag>
          : <StatusTag tone="warn" icon={CircleSlash}>停止计入</StatusTag> : undefined}
        note={feedChanged ? feedK4
          ? "之后处理的篡改事件按次数给账户加风险分；不计入期间处理过的事件不补加。"
          : "之后处理的篡改事件不再加风险分（提交前发生、提交后才处理的也算），风险提醒照常收到；已经加的分不撤回。" : undefined}>
        {() => <Segments<"on" | "off"> label="新的篡改事件计入风险评分" value={feedK4 ? "on" : "off"}
          items={[{ value: "on", label: "计入", disabled: locked && !feedK4 }, { value: "off", label: "不计入", disabled: locked && feedK4 }]}
          onChange={(value) => { if (!locked) setFeedK4(value === "on"); }} />}
      </DiffField>
      {changed && (
        <Facts>
          {thresholdChanged && <Fact k="已在名单里的账户">名单不单独保存，每次打开都按新阈值重新筛；已经加的风险分、已经送到风险提醒的不撤回</Fact>}
          {thresholdChanged && <Fact k="紧急停用开关">篡改告警激增规则读同一个阈值，打开那页就显示新值；它只统计，不发通知、不自动关停</Fact>}
          <Fact k="留痕">写一条操作记录；超级管理员随后收到提醒</Fact>
        </Facts>
      )}
      <Field label="操作理由" required hint="至少 8 字" error={reasonError}>
        {(control) => <Textarea {...control} value={reason} maxLength={200} rows={3} disabled={locked} placeholder="例如：工单号、调整依据"
          count={`${reasonLength}/200`} onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched(true)} />}
      </Field>
    </Modal>
  );
}

