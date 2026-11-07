"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Coins, FileText, Hash, ListChecks, RefreshCw, Scale, Settings2, ShieldAlert } from "lucide-react";
import {
  BlockState, Button, Cell, Change, ConfigList, IrreversibleTag, ConfigRow, Conclusion, Drawer, Fact, Facts, FilterBar, FilterField, Fold, Input, JudgmentPoints, KeyValues,
  Notice, PageHeader, PageTabs, Pager, Panel, Segments, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { adminAuthLifecycleEpoch, AdminAuthEpochChangedError } from "@/lib/admin/auth-lifecycle";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { CregisStatus } from "./cregis-status";
import { D1BankOrders, orderStatusText } from "./d1-bank-orders";
import { D1OrderPayments } from "./d1-order-payments";
import { CrossAreaNotice, D1_SECTIONS, D1_SECTION_NAME, PendingNotices, SwitchTag, countText, readPage, readParam, usdt, vnd, writeParams, zoneLabel, type D1Activity, type D1Count, type D1PendingItem, type D1Section } from "./d1-shared";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  D1_COMMAND_EXPIRED_TEXT,
  d1PendingObjectReason,
  fetchD1BankOrders,
  fetchD1TopupFlows,
  fetchD1TopupOverview,
  listD1PendingBankOrderCommands,
  listD1PendingCommands,
  loadD1VietQrOverview,
  manualCreditD1BankOrder,
  releaseD1PendingCommand,
  retryD1PendingCommand,
  retryD1PendingTopupCommand,
  retryD1PendingBankOrderCommand,
  updateD1TopupChannelEnabled,
  updateD1TopupChannelMax,
  updateD1VietQrConfig,
  writeoffD1Reconciliation,
  type D1DepositFlow,
  type D1BankOrder,
  type D1Overview,
  type D1PendingCommand,
  type D1ReconciliationRow,
  type D1VietQrOverview,
  type PageResult,
} from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const depositChannelText = (value: string) => ({vietqr:"银行卡支付",bank:"银行转账",card:"国际卡刷卡",trc20:"USDT（TRC20）",bep20:"USDT（BEP20）",erc20:"USDT（ERC20）",hdpay:"银行卡支付",cregis:"USDT 链上充值"} as Record<string,string>)[value.toLowerCase()] ?? value;
const FLOW_TABS = [
  ["", "全部"],
  ["pending", "处理中"],
  ["confirmed", "已入账"],
  ["abnormal", "异常"],
] as const;
const FLOW_SIZES = [10, 20, 50] as const;

const time = (value?: string | null) => formatBusinessTimeCompact(value, "—");

function flowTone(status: string): StateTone {
  const s = status.toUpperCase();
  if (["SUCCESS", "CONFIRMED", "CREDITED", "CHARGEBACK_RECOVERED", "RECOVERED"].includes(s)) return "ok";
  if (["FAILED", "EXPIRED", "REJECTED", "ABNORMAL", "CHARGEBACK_ENTERED", "CHARGEBACK_PARTIAL", "PARTIAL_ANOMALY"].includes(s)) return "danger";
  return "progress";
}

function vietQrReceivedAtInstant(value: string) {
  const normalized = value.trim().replace(" ", "T");
  const parts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!parts) {
    throw new Error("请选择到账时间（按越南时间 UTC+7）");
  }
  const [, year, month, day, hour, minute, second = "00"] = parts;
  const calendarCheck = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second),
  ));
  if (
    calendarCheck.getUTCFullYear() !== Number(year)
    || calendarCheck.getUTCMonth() !== Number(month) - 1
    || calendarCheck.getUTCDate() !== Number(day)
    || calendarCheck.getUTCHours() !== Number(hour)
    || calendarCheck.getUTCMinutes() !== Number(minute)
    || calendarCheck.getUTCSeconds() !== Number(second)
  ) {
    throw new Error("银行到账时间包含不存在的日期或时间，请按银行回单重新填写");
  }
  const absolute = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
    ? normalized
    : `${normalized}+07:00`;
  const instant = new Date(absolute);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("银行到账时间无效，请核对日期和时间");
  }
  return instant.toISOString();
}

const VIETQR_ACTION_EVIDENCE_FIELD = {
  key: "evidenceAssetId", label: "银行回单图片", inputKind: "asset-upload" as const, required: true, wide: true,
  uploadPurpose: "vietqr-receipt" as const,
  accept: "image/jpeg,image/png",
  help: "上传清晰的 JPG / PNG 银行回单图片，最大 10 MB，上传完成后再确认。",
};

function vietQrActionEvidenceRef(assetId?: string) {
  const value = assetId?.trim() ?? "";
  if (!/^vqr_[0-9a-f]{32}$/.test(value)) throw new Error("请先上传回单图片，等上传完成");
  return `media:${value}`;
}

const D1_STATUS_LABELS: Record<string, string> = {
  SUCCESS: "已成功",
  CONFIRMED: "已确认",
  CREDITED: "已入账",
  PENDING: "待确认",
  PROCESSING: "处理中",
  FAILED: "处理失败",
  DECLINED: "支付被拒绝",
  EXPIRED: "已过期",
  REJECTED: "已拒绝",
  ABNORMAL: "账务异常",
  CHARGEBACK: "拒付待处理",
  DISPUTED: "拒付争议中",
  CHARGEBACK_REVIEW: "拒付复核中",
  CHARGEBACK_REFUNDED: "拒付已退款",
  CHARGEBACK_RECOVERED: "拒付已追回",
  CHARGEBACK_PARTIAL: "拒付部分追回",
  RECOVERED: "已追回",
  PARTIAL_ANOMALY: "部分追回异常",
};

function d1StatusText(status: string) {
  return D1_STATUS_LABELS[status.toUpperCase()] ?? "状态未知";
}

/** 金额和笔数是不是真的一致：按原数比，挂账不等于对上（D1-A10）。 */
const mismatched = (row: D1ReconciliationRow) => row.providerCount !== row.ledgerCount || row.providerAmount !== row.ledgerAmount;

/** 差异怎么写：后端的差异文字带 $，这些数其实是 USDT，按字段重写（D1-V12）。 */
function gapText(row: D1ReconciliationRow) {
  const amount = `${usdt(Math.abs(row.diffAmount))} USDT`;
  if (row.providerCount !== row.ledgerCount) return `单边 ${amount}`;
  return row.diffAmount > 0 ? `支付商侧多 ${amount}` : `平台侧多 ${amount}`;
}

/** 三种结果分开写：金额与笔数一致、有差异待挂账、有差异已挂账。挂账只是登记例外，钱和笔数仍然对不上。 */
function diffText(row: D1ReconciliationRow) {
  if (!mismatched(row)) return "金额与笔数一致";
  return row.reconciled ? `已挂账，差异仍在：${gapText(row)}` : `待挂账：${gapText(row)}`;
}

/** 结果未确认的写请求叫什么，按路径认，不露路径（D1-A09）。 */
function pendingLabel(path: string) {
  if (path.startsWith("/topup/reconciliation/")) return `对账差异挂账 · ${depositChannelText(path.split("/")[3] ?? "")}`;
  if (path.endsWith("/enabled")) return `启用或停用充值渠道 · ${depositChannelText(path.split("/")[3] ?? "")}`;
  if (path.endsWith("/max-amount") || path.endsWith("/max")) return "单笔上限调整";
  if (path === "/vietqr/config") return "调整银行卡支付参数 · 单笔上限";
  if (path.startsWith("/vietqr/orders/")) return `人工确认入账 · ${path.split("/")[3] ?? ""}`;
  return "充值操作";
}

export function D1Recon({ ctx }: { ctx: DCtx }) {
  const owner = useAdminAuth(state => state.session?.adminId), epoch = useAdminAuth(state => state.authEpoch);
  if (owner == null) return null;
  return <D1Workspace key={`${owner}:${epoch}`} ctx={ctx} />;
}

function D1Workspace({ ctx }: { ctx: DCtx }) {
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
  const canRead = isSuper || authorities.includes("finance_d1_read");
  const canWriteAny = isSuper || ["finance_d1_fx_manage", "finance_d1_bank_reconcile", "finance_d1_channel_manage", "finance_d1_reconcile", "finance_d1_bank_config_manage"].some(code => authorities.includes(code));
  const [section, setSection] = useState<D1Section>(() => (readParam("tab", D1_SECTIONS) as D1Section | null) ?? "payments");
  const tabIds = useTabIds();
  const [counts, setCounts] = useState<Record<D1Section, D1Count>>({ payments: undefined, bank: undefined, usdt: undefined, ledger: undefined });
  const [activity, setActivity] = useState<Record<D1Section, D1Activity>>({ payments: [], bank: [], usdt: [], ledger: [] });
  const [usdtAlert, setUsdtAlert] = useState(false);
  const [unconfiguredFees, setUnconfiguredFees] = useState(0);
  const [reloadTick, setReloadTick] = useState(0);
  const report = useMemo(() => Object.fromEntries(D1_SECTIONS.map(key => [key, {
    count: (count: D1Count) => setCounts(current => current[key] === count ? current : { ...current, [key]: count }),
    activity: (lines: D1Activity) => setActivity(current => current[key].join("|") === lines.join("|") ? current : { ...current, [key]: lines }),
  }])) as Record<D1Section, { count: (count: D1Count) => void; activity: (lines: D1Activity) => void }>, []);
  const select = (next: D1Section) => { setSection(next); writeParams({ tab: next }); };

  if (!canRead) {
    return <>
      <PageHeader pageId="D1" title="充值与收款对账" summary="核对订单付款和充值，处理没对上的钱。" />
      <BlockState state="denied" title="无权限访问" detail="这个账号没有这页的读取权限，需要时联系超级管理员。" />
    </>;
  }

  const values = D1_SECTIONS.map(key => counts[key]);
  const loadingCount = values.some(value => value === undefined);
  const failed = D1_SECTIONS.filter(key => counts[key] === "failed");
  const total = values.reduce((sum, value) => sum + (value && value !== "failed" ? value.n : 0), 0);
  const capped = values.some(value => value && value !== "failed" && value.capped);
  const totalText = `${total}${capped ? "+" : ""}`;
  const failedNames = failed.map(key => D1_SECTION_NAME[key]).join("、");
  const explain = "算了需人工处理的付款、待核对的银行卡订单、USDT 异常和待挂账的对账差异。系统还在处理的不算。没有数据不代表已经对上。";
  // 后端还没给「本地待人工核对」的银行卡订单计数（BE-27），这个数不全，零也不是绝对的：常显说明，不收进问号（D1-S04）。
  const bankGap = "银行卡订单里「本地待人工核对」的还没算进来，要在「银行卡充值」列表里逐行看。";
  const feeGap = unconfiguredFees ? `付款手续费有 ${unconfiguredFees} 种付款方式未配置，用户付款时看不到这几种方式。` : "";
  const retryAll = <Button size="sm" onClick={() => setReloadTick(value => value + 1)}>重试</Button>;
  const alertLead = usdtAlert ? "USDT 有未解除的紧急或严重告警" : "";
  const conclusion = failed.length === D1_SECTIONS.length
    ? <Conclusion state="danger" explain={explain} action={retryAll}>读取失败，不知道有没有要处理的事</Conclusion>
    : loadingCount && !usdtAlert
      ? <Conclusion state="unknown" explain={explain}>正在读取要处理的事</Conclusion>
      : total > 0
        ? <Conclusion state={usdtAlert ? "danger" : "warn"} lead explain={explain} hint={failed.length ? undefined : `点页签上带数字的区处理。${bankGap}`} action={failed.length ? retryAll : undefined}>
          {alertLead && `${alertLead}；`}有 <b>{totalText}</b> 项要处理{failed.length ? `，${failedNames}读取失败，这个数不全` : ""}
        </Conclusion>
        : usdtAlert
          ? <Conclusion state="danger" explain={explain} hint="到「USDT 充值」看告警。">{alertLead}{failed.length ? `；${failedNames}读取失败` : ""}</Conclusion>
          : failed.length
            ? <Conclusion state="warn" explain={explain} action={retryAll}>{failedNames}读取失败，不知道这部分有没有要处理的事</Conclusion>
            // 零态不用绿色：银行卡本地人工核对还没计入，不能说成全部正常（重构说明版面例外）。
            : <Conclusion state="neutral" explain={explain} hint={`${bankGap}${feeGap}`}>没有发现要处理的事</Conclusion>;
  const crossRows = D1_SECTIONS.filter(key => key !== section && activity[key].length > 0).map(key => ({ section: key, lines: activity[key] }));

  return <>
    <PageHeader pageId="D1" title="充值与收款对账" summary="核对订单付款和充值，处理没对上的钱。"
      meta={<span className="rd-toolbar"><span>打开和点「刷新」时读取，不自动刷新</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => setReloadTick(value => value + 1)}>刷新</Button></span>}
      readOnly={canWriteAny ? undefined : "没有修改权限时，这页只能查看。"} />
    {conclusion}
    <CrossAreaNotice rows={crossRows} onGo={select} />
    <PageTabs ids={tabIds} label="充值与收款对账分区" value={section} onChange={select}
      items={D1_SECTIONS.map(key => ({ value: key, count: countText(counts[key]),
        // 有未解除告警时页签上标出来；告警不加进数字（产品已定，告警可能和异常是同一件事）。
        label: key === "usdt" && usdtAlert ? <>{D1_SECTION_NAME[key]}<ShieldAlert size={14} color="var(--rd-danger)" aria-label="有未解除告警" /></> : D1_SECTION_NAME[key] }))} />
    <div {...tabIds.panel("payments")} hidden={section !== "payments"} className="rd-tab-pane">
      <D1OrderPayments ctx={ctx} onCount={report.payments.count} onActivity={report.payments.activity} onUnconfigured={setUnconfiguredFees} reloadTick={reloadTick} />
    </div>
    <RechargeAreas ctx={ctx} section={section} tabIds={tabIds} onGo={select} reloadTick={reloadTick}
      onBankCount={report.bank.count} onBankActivity={report.bank.activity}
      onLedgerCount={report.ledger.count} onLedgerActivity={report.ledger.activity}
      usdt={<CregisStatus ctx={ctx} onCount={report.usdt.count} onActivity={report.usdt.activity} onAlert={setUsdtAlert} reloadTick={reloadTick} />} />
  </>;
}

type TabIdsLike = ReturnType<typeof useTabIds>;

function RechargeAreas({ ctx, section, tabIds, onGo, reloadTick, onBankCount, onBankActivity, onLedgerCount, onLedgerActivity, usdt: usdtArea }: {
  ctx: DCtx; section: D1Section; tabIds: TabIdsLike; onGo: (section: D1Section) => void; reloadTick: number;
  onBankCount: (count: D1Count) => void; onBankActivity: (lines: D1Activity) => void;
  onLedgerCount: (count: D1Count) => void; onLedgerActivity: (lines: D1Activity) => void;
  usdt: React.ReactNode;
}) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
  const operator = session?.operator || session?.username || "";
  const canManageChannels = isSuper || authorities.includes("finance_d1_channel_manage");
  const canReconcile = isSuper || authorities.includes("finance_d1_reconcile");
  const canBankReconcile = isSuper || authorities.includes("finance_d1_bank_reconcile");
  const canManageBankConfig = isSuper || authorities.includes("finance_d1_bank_config_manage");
  const [overview, setOverview] = useState<D1Overview | null>(null);
  const [overviewError, setOverviewError] = useState("");
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [vietQr, setVietQr] = useState<D1VietQrOverview | null>(null);
  const [vietQrError, setVietQrError] = useState("");
  const [flows, setFlows] = useState<PageResult<D1DepositFlow> | null>(null);
  const [flowsError, setFlowsError] = useState("");
  const [flowsLoading, setFlowsLoading] = useState(true);
  const [status, setStatus] = useState(() => readParam("flowStatus", FLOW_TABS.map(([key]) => key)) ?? "");
  const [keyword, setKeyword] = useState(() => readParam("flowQ") ?? "");
  const [query, setQuery] = useState(() => readParam("flowQ") ?? "");
  // 用户编号单独一个框，按后端的 userId 精确查；关键字只匹配单号和交易号，不拿来猜人（D1-Q06）。
  const [userInput, setUserInput] = useState(() => readParam("flowUser") ?? "");
  const [userQuery, setUserQuery] = useState(() => { const value = readParam("flowUser") ?? ""; return /^[1-9]\d{0,18}$/.test(value) ? value : ""; });
  const [page, setPage] = useState(() => readPage("flowPage"));
  const [pageSize, setPageSize] = useState(() => Number(readParam("flowPageSize", FLOW_SIZES.map(String)) ?? 10));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<D1PendingCommand[]>([]);
  const [bankPending, setBankPending] = useState(listD1PendingBankOrderCommands);
  const [bankKey, setBankKey] = useState(0);
  const [flowSelected, setFlowSelected] = useState<string | null>(null);
  const [reconOpen, setReconOpen] = useState<boolean | null>(null);
  const overviewSeq = useRef(0), flowSeq = useRef(0);

  const syncPending = useCallback(() => {
    setPending(listD1PendingCommands().filter(command => command.path.startsWith("/topup/") || command.path === "/vietqr/config"));
    setBankPending(listD1PendingBankOrderCommands());
  }, []);

  const loadOverview = useCallback(async () => {
    const current = ++overviewSeq.current;
    setOverviewLoading(true); setOverviewError(""); setVietQrError("");
    syncPending();
    const [nextOverview, nextVietQr] = await Promise.allSettled([fetchD1TopupOverview(), loadD1VietQrOverview("inflight")]);
    if (current !== overviewSeq.current) return;
    if (nextOverview.status === "fulfilled") setOverview(nextOverview.value);
    else { setOverview(null); setOverviewError(displayAdminReadError(nextOverview.reason)); }
    if (nextVietQr.status === "fulfilled") setVietQr(nextVietQr.value);
    else { setVietQr(null); setVietQrError(displayAdminReadError(nextVietQr.reason)); }
    setOverviewLoading(false);
  }, [syncPending]);

  const loadFlows = useCallback(async () => {
    const current = ++flowSeq.current;
    setFlowsLoading(true); setFlowsError("");
    try {
      const next = await fetchD1TopupFlows({ status, keyword: query, userId: userQuery ? Number(userQuery) : undefined, pageNum: page, pageSize });
      if (current === flowSeq.current) setFlows(next);
    } catch (err) {
      if (current === flowSeq.current) { setFlows(null); setFlowsError(displayAdminReadError(err)); }
    } finally {
      if (current === flowSeq.current) setFlowsLoading(false);
    }
  }, [status, query, userQuery, page, pageSize]);

  useEffect(() => { void loadOverview(); return () => { overviewSeq.current++; }; }, [loadOverview]);
  useEffect(() => { void loadFlows(); return () => { flowSeq.current++; }; }, [loadFlows]);
  const firstTick = useRef(reloadTick);
  useEffect(() => { if (reloadTick !== firstTick.current) { void loadOverview(); void loadFlows(); setBankKey(value => value + 1); } }, [reloadTick, loadOverview, loadFlows]);
  useEffect(() => { writeParams({ flowStatus: status || null, flowQ: query || null, flowUser: userQuery || null, flowPage: page > 1 ? page : null, flowPageSize: pageSize !== 10 ? pageSize : null }); }, [status, query, userQuery, page, pageSize]);
  const userIssue = userInput.trim() && !/^[1-9]\d{0,18}$/.test(userInput.trim()) ? "用户编号只能是数字" : undefined;
  useEffect(() => { onLedgerCount(overviewLoading && !overview ? undefined : overview ? { n: overview.diffCount } : "failed"); }, [onLedgerCount, overview, overviewLoading]);

  const ledgerPending = pending.filter(command => command.path.startsWith("/topup/reconciliation/"));
  const bankSettingsPending = pending.filter(command => !command.path.startsWith("/topup/reconciliation/"));
  useEffect(() => {
    onBankActivity([
      ...(bankPending.length ? [`有 ${bankPending.length} 次人工入账结果未确认`] : []),
      ...(bankSettingsPending.length ? [`有 ${bankSettingsPending.length} 次设置修改结果未确认`] : []),
    ]);
  }, [onBankActivity, bankPending.length, bankSettingsPending.length]);
  useEffect(() => { onLedgerActivity(ledgerPending.length ? [`有 ${ledgerPending.length} 次核销结果未确认`] : []); }, [onLedgerActivity, ledgerPending.length]);

  const refreshAfterWrite = async () => {
    syncPending();
    await Promise.all([loadOverview(), loadFlows()]);
  };

  /** 写操作共用：提交中锁住，成功重读；失败留在框里，结果未知时转成页面上方的待确认（OP-92、OP-93）。 */
  const write = async (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await task();
      toast(ok, "success");
    } finally {
      setBusy(false);
      await refreshAfterWrite();
    }
  };

  const openBankManualCredit = (order: D1BankOrder, onSettled: () => void | Promise<void>) => {
    const providerVersion = order.providerVersion;
    if (!canBankReconcile || !order.manualCreditAllowed || order.paymentRail !== "HDPAY"
        || order.creditedUsdt > 0 || providerVersion === null) return;
    const authEpoch = adminAuthLifecycleEpoch();
    openActionConfirm({ briefKind: "funds",
      action: `人工确认入账 · ${order.intentNo}`,
      title: "人工确认入账",
      confirmLabel: "确认入账",
      confirmTone: "danger",
      reasonMin: 8, reasonMax: 200,
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      facts: <Facts>
        <Fact k="入账" lead tone="role-1" unit="USDT">{usdt(order.requestedUsdt)}</Fact>
        <Fact k="应付">{vnd(order.payableVnd)} VND</Fact>
        <Fact k="用户">{order.userId}</Fact>
        <Fact k="付款单">{order.intentNo}</Fact>
        <Fact k="状态"><Change from={orderStatusText(order.status)} to="已入账" /></Fact>
      </Facts>,
      detail: `请先核实已实际到账 ${vnd(order.payableVnd)} VND，确认后按下单时的金额入账 ${usdt(order.requestedUsdt)} USDT。`,
      completionCopy: "确认后立即入账到用户钱包，不能撤销。实际到账金额必须等于应付金额。已入账的订单不会重复入账。",
      reasonPlaceholder: "例如：银行回单已核对，工单号",
      businessForm: { kind: "multi-field", fields: [
        { key: "paymentReference", label: "实际收款交易参考号", inputKind: "text", required: true,
          minLength: 6, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$", patternMessage: "只能填字母、数字和 . _ : / -，以字母或数字开头",
          explain: "照抄银行或支付商收款凭证上的交易参考号，不是付款单号或附言码。" },
        // 用日期时间选择，不让人手敲带 T 的格式（DP-44）。按越南时间理解。
        { key: "receivedAt", label: "实际到账时间（越南 UTC+7）", inputKind: "datetime-local", step: 1, required: true,
          current: "", explain: "选收款凭证上的到账时间，不是现在的时间，按越南时间。" },
        VIETQR_ACTION_EVIDENCE_FIELD,
      ] },
      run: async (reason, _value, business) => {
        if (authEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
        const paymentReference = business?.paymentReference?.trim() ?? "";
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/.test(paymentReference)
            || paymentReference === order.intentNo || paymentReference === order.memoCode) throw new Error("请填写收款凭证上的交易参考号");
        const receivedAt = vietQrReceivedAtInstant(business?.receivedAt ?? "");
        const evidenceRef = vietQrActionEvidenceRef(business?.evidenceAssetId);
        setBusy(true);
        try {
          await manualCreditD1BankOrder(order.intentNo, {
            expectedVersion: order.version, providerVersion,
            receivedVnd: order.payableVnd, paymentReference, receivedAt, evidenceRef, reason, operator,
          });
          if (authEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
          toast("人工入账已提交，请核对订单和用户钱包", "success");
        } finally {
          setBusy(false);
          syncPending();
          if (authEpoch === adminAuthLifecycleEpoch()) await onSettled();
        }
      },
    });
  };

  const toggleChannel = (channel: D1Overview["channels"][number]) => {
    const name = depositChannelText(channel.code) ?? channel.id;
    const stopping = channel.enabled;
    openActionConfirm({ briefKind: "record",
      action: `${stopping ? "停用" : "启用"}充值渠道 · ${name}`,
      title: `${stopping ? "停用" : "启用"}${name}`,
      confirmLabel: stopping ? "确认停用" : "确认启用",
      confirmTone: stopping ? "danger" : "primary",
      reasonMin: 8, reasonMax: 200,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: <Facts><Fact k="通道">{name}</Fact><Fact k="状态"><Change from={stopping ? "启用" : "停用"} to={stopping ? "停用" : "启用"} /></Fact></Facts>,
      detail: "只影响之后的新交易。",
      completionCopy: stopping ? "确认后立即生效。App 充值页不再显示银行卡支付。已在付款的不受影响，订单付款也不受影响。" : "确认后立即生效，App 充值页重新显示银行卡支付，只影响新充值。",
      run: (reason) => write(() => updateD1TopupChannelEnabled(channel.code, !channel.enabled, channel.enabled, reason, operator), `${name} 已${stopping ? "停用" : "启用"}`),
    });
  };

  const updateChannelMax = (channel: D1Overview["channels"][number]) => {
    const current = channel.maxAmountValue;
    if (current === null) return;
    const name = depositChannelText(channel.code) ?? channel.id;
    openActionConfirm({ briefKind: "config",
      action: `单笔上限调整 · ${name}`,
      title: `调整${name}单笔上限`,
      confirmLabel: "确认调整",
      reasonMin: 8, reasonMax: 200,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      detail: "只影响之后的新交易。",
      edit: { kind: "number", current: String(current), unit: "USD", min: 0.01, max: 100000, step: 0.01, disallowCurrent: true, hint: "0.01–100,000，最多两位小数" },
      run: (reason, value) => write(() => updateD1TopupChannelMax(channel.code, Number(value), current, reason, operator), `${name} 单笔上限已更新`),
    });
  };

  const editPerTxLimit = () => {
    if (!vietQr) return;
    const config = vietQr.config;
    const current = config.perTxLimitUsd;
    openActionConfirm({ briefKind: "config",
      action: "调整银行卡支付参数 · 单笔上限",
      title: "调整银行卡支付单笔上限",
      confirmLabel: "确认调整",
      reasonMin: 8, reasonMax: 200,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      detail: "只对之后的新付款单生效。",
      completionCopy: "只对之后的新付款单生效。",
      edit: { kind: "number", current: String(current), unit: "USD", min: 100, max: 10_000, step: 1, disallowCurrent: true, hint: "100–10,000 的整数",
        preview: (value) => /^\d+$/.test(value) ? `改成 ${Number(value).toLocaleString("en-US")}：用户一笔最多充 ${Number(value).toLocaleString("en-US")} USD。` : undefined },
      run: (reason, value) => {
        const next = Number(value);
        if (!Number.isInteger(next) || next < 100 || next > 10_000) throw new Error("单笔上限须为范围内的整数");
        // 后端仍要求整组配置必填，其他字段按读回值原样提交。
        const { toleranceVnd, graceMinutes, trc20Confirmations, erc20Confirmations, bep20Confirmations, rotationStrategy, version } = config;
        return write(
          () => updateD1VietQrConfig({ toleranceVnd, graceMinutes, perTxLimitUsd: next, trc20Confirmations, erc20Confirmations, bep20Confirmations, rotationStrategy, version }, reason, operator),
          "单笔上限已更新",
        );
      },
    });
  };

  const writeoff = (row: D1ReconciliationRow) => {
    const name = depositChannelText(row.channel);
    openActionConfirm({ briefKind: "record",
      action: `对账差异挂账 · ${name}`,
      title: "对账差异挂账",
      confirmLabel: "确认挂账",
      reasonMin: 8, reasonMax: 200,
      effect: <StatusTag tone="neutral" filled>只登记，不动余额</StatusTag>,
      // 不动钱的框第一行写对象，金额是普通的值（VS-102）。
      facts: <Facts>
        <Fact k="对象">{name} · {gapText(row)}</Fact>
        <Fact k="差异金额">{usdt(Math.abs(row.diffAmount))} USDT</Fact>
        <Fact k="支付商">{row.providerCount} 笔 · {usdt(row.providerAmount)} USDT</Fact>
        <Fact k="平台">{row.ledgerCount} 笔 · {usdt(row.ledgerAmount)} USDT</Fact>
      </Facts>,
      detail: "把这个差异登记为例外并挂账，须填写支付商账单或工单号。挂账后差异仍在，只是不再算待处理。",
      completionCopy: "只登记差异，不改用户余额，金额和笔数仍然对不上。今天这个通道不能再挂账一次。",
      businessForm: { kind: "multi-field", fields: [
        { key: "evidenceRef", label: "支付商账单号或工单号", inputKind: "text", placeholder: "如 PSP-STMT-20260720-001", required: true },
      ] },
      run: (reason, _value, business) => {
        const evidenceRef = business?.evidenceRef?.trim() ?? "";
        return write(() => writeoffD1Reconciliation(row.channel, "CONFIRM_EXCEPTION", evidenceRef, reason, operator), `${name} 差异已挂账，差异仍在`);
      },
    });
  };

  /** 读回这条命令改的对象现在是什么样，只给事实，不当成原命令的结果（OP-93、OP-95）。 */
  const verifyCommand = async (path: string) => {
    const code = decodeURIComponent(path.split("/")[3] ?? "");
    const kept = "状态可能是别人改的，待确认继续保留。";
    if (path === "/vietqr/config") {
      const current = await loadD1VietQrOverview("inflight");
      setVietQr(current);
      return `读回：银行卡支付单笔上限现在是 ${current.config.perTxLimitUsd.toLocaleString("en-US")} USD（第 ${current.config.version} 版）。${kept}`;
    }
    if (path.startsWith("/vietqr/orders/")) {
      const latest = await fetchD1BankOrders({ keyword: code, pageNum: 1, pageSize: 20 });
      const order = latest.records.find(value => value.intentNo === code);
      return order ? `读回：这笔现在是「${orderStatusText(order.status)}」${order.creditedUsdt > 0 ? `，已入账 ${usdt(order.creditedUsdt)} USDT` : "，还没入账"}。${kept}` : "读回：列表里暂时找不到这笔，待确认继续保留。";
    }
    const current = await fetchD1TopupOverview();
    setOverview(current);
    const name = depositChannelText(code);
    if (path.startsWith("/topup/reconciliation/")) {
      const row = current.reconciliation.find(value => value.channel === code);
      return row ? `读回：${name}今天的差异现在是「${diffText(row)}」。${kept}` : `读回：今天没有${name}的对账记录。${kept}`;
    }
    const channel = current.channels.find(value => value.code === code);
    if (!channel) return `读回：暂时读不到${name}。待确认继续保留。`;
    return path.endsWith("/enabled") ? `读回：${name}现在是「${channel.enabled ? "启用" : "停用"}」。${kept}`
      : `读回：${name}单笔上限现在是 ${channel.maxAmountValue == null ? "未设置" : `${channel.maxAmountValue.toLocaleString("en-US")} USD`}。${kept}`;
  };
  const pendingItem = (command: D1PendingCommand, retry: () => Promise<unknown>, permitted: boolean): D1PendingItem => ({
    key: command.commandKey,
    label: pendingLabel(command.path),
    createdAt: command.createdAt,
    hint: "先读回核对；按原操作重试用同一个命令号，不会重复执行。",
    blocked: command.expiresAt <= Date.now() ? D1_COMMAND_EXPIRED_TEXT : permitted ? undefined : "这个账号没有这项权限",
    auditHref: "/platform/audit?domain=D",
    verify: () => verifyCommand(command.path),
    retry: async () => { setBusy(true); try { await retry(); } finally { setBusy(false); } },
    release: () => releaseD1PendingCommand(command.commandKey),
    after: () => { void refreshAfterWrite(); setBankKey(value => value + 1); },
  });
  const bankItems: D1PendingItem[] = [
    ...bankPending.map(command => ({ ...pendingItem({ ...command, method: "POST", body: "" }, () => retryD1PendingBankOrderCommand(command.commandKey), canBankReconcile), hint: "先在下面的列表核对订单和用户钱包；按原操作重试不会重复入账。" })),
    ...bankSettingsPending.map(command => pendingItem(command, () => command.path === "/vietqr/config" ? retryD1PendingCommand(command.commandKey) : retryD1PendingTopupCommand(command.commandKey),
      command.path === "/vietqr/config" ? canManageBankConfig : canManageChannels)),
  ];
  const ledgerItems = ledgerPending.map(command => pendingItem(command, () => retryD1PendingTopupCommand(command.commandKey), canReconcile));

  const readingReason = overviewLoading ? "正在读取最新数据" : busy ? "正在提交" : undefined;
  const bankChannels = (overview?.channels ?? []).filter((channel) => ["vietqr", "hdpay"].includes(channel.code));
  const perTxLimit = vietQr?.config.perTxLimitUsd;
  const bankSummary = overviewLoading && !overview ? "正在读取"
    : !overview && !vietQr ? "读取失败"
      : [bankChannels.length ? (bankChannels.every(channel => channel.enabled) ? "启用" : bankChannels.some(channel => channel.enabled) ? "部分停用" : "停用") : null,
        perTxLimit != null ? `单笔上限 ${perTxLimit.toLocaleString("en-US")} USD` : null].filter(Boolean).join(" · ") || "—";

  const reconRows = overview?.reconciliation ?? [];
  const hasDiff = (overview?.diffCount ?? 0) > 0;
  const registered = reconRows.filter(row => row.reconciled && mismatched(row)).length;
  const reconSummary = overviewLoading && !overview ? "正在读取" : !overview ? "读取失败"
    : reconRows.length === 0 ? "今天还没有支付商流水或入账记录"
      : hasDiff ? "有通道没对上，要挂账"
        : registered ? `没有待挂账的差异；${registered} 个通道的差异已挂账，金额仍对不上` : "今天的通道金额与笔数都一致";
  const flowRecords = flows?.records ?? [];
  const flowIndex = flowRecords.findIndex(flow => flow.depositNo === flowSelected);
  const flow = flowIndex >= 0 ? flowRecords[flowIndex] : null;
  const zone = zoneLabel();

  return <>
    <div {...tabIds.panel("bank")} hidden={section !== "bank"} className="rd-tab-pane">
      <PendingNotices items={bankItems} disabled={busy} />
      <D1BankOrders canManage={canBankReconcile} busyReason={busy ? "正在提交" : undefined} onCount={onBankCount}
        refreshKey={`${vietQr?.asOf ?? ""}:${bankKey}`}
        blocked={(order) => bankPending.some(command => command.path === `/vietqr/orders/${order.intentNo}/manual-credit`)}
        onManualCredit={openBankManualCredit} />
      <Fold title="银行卡支付设置" icon={Settings2} tone="role-4" summary={bankSummary}
        alert={!!overviewError || !!vietQrError || bankChannels.some(channel => !channel.enabled)} alertTone={overviewError || vietQrError ? "danger" : "warn"}>
        {overviewError && <BlockState state="error" compact title="充值通道读取失败" detail={overviewError} onRetry={() => void loadOverview()} />}
        {vietQrError && <BlockState state="error" compact title="银行卡支付参数读取失败" detail={vietQrError} onRetry={() => void loadOverview()} />}
        <ConfigList label="银行卡支付设置">
          {bankChannels.map(channel => {
            const name = depositChannelText(channel.code) ?? channel.id;
            return <ConfigRow key={channel.code} name={name}
              what="银行卡充值入口开不开" when="确认后立即生效，只影响新充值" where="App 充值页的银行卡支付入口"
              effect="停用后 App 充值页不再显示银行卡支付。已在付款的不受影响，订单付款也不受影响"
              value={<SwitchTag on={channel.enabled}>{channel.enabled ? "启用" : "停用"}</SwitchTag>}
              action={canManageChannels ? <Button size="sm" variant={channel.enabled ? "danger-outline" : "secondary"} disabledReason={readingReason ?? d1PendingObjectReason(`/topup/channels/${encodeURIComponent(channel.code)}/enabled`)} onClick={() => toggleChannel(channel)}>{channel.enabled ? "停用" : "启用"}</Button> : undefined} />;
          })}
          {bankChannels.filter(channel => channel.maxAmountValue !== null).map(channel => (
            <ConfigRow key={`${channel.code}-max`} name={`${depositChannelText(channel.code)}单笔上限`} what="这个通道一笔充值的上限" when="确认后立即生效，只影响新交易"
              value={`${(channel.maxAmountValue ?? 0).toLocaleString("en-US")} USD`}
              action={canManageChannels ? <Button size="sm" disabledReason={readingReason ?? d1PendingObjectReason(`/topup/channels/${encodeURIComponent(channel.code)}/max-amount`)} onClick={() => updateChannelMax(channel)}>调整</Button> : undefined} />
          ))}
          <ConfigRow name="单笔上限" what="银行卡充值一笔的上限" when="确认后立即生效，只对之后的新付款单" where="App 充值页 › 银行卡支付「单笔限额」"
            effect="改成 1,000：用户一笔最多充 1,000 USD"
            value={perTxLimit != null ? `${perTxLimit.toLocaleString("en-US")} USD` : "—"}
            action={canManageBankConfig ? <Button size="sm" disabledReason={readingReason ?? (vietQr ? d1PendingObjectReason("/vietqr/config") : "银行卡支付参数没读到，刷新后再试")} onClick={editPerTxLimit}>调整</Button> : undefined} />
          <ConfigRow name="最低充值金额" what="银行卡充值的最低金额" where="App 充值页 › 银行卡支付「单笔限额」" effect="只限制充值，不限制订单付款"
            value="在「订单付款 › 付款手续费」里设置"
            action={<Button size="sm" onClick={() => onGo("payments")}>去设置</Button>} />
          <ConfigRow name="USDT 链上充值（BEP20 / ERC20）" what="收款地址分配、入账和异常处理由 USDT 收款开关控制"
            value="在「USDT 充值」看"
            action={<Button size="sm" onClick={() => onGo("usdt")}>查看实际状态</Button>} />
        </ConfigList>
      </Fold>
    </div>

    <div {...tabIds.panel("usdt")} hidden={section !== "usdt"} className="rd-tab-pane">{usdtArea}</div>

    <div {...tabIds.panel("ledger")} hidden={section !== "ledger"} className="rd-tab-pane">
      <PendingNotices items={ledgerItems} disabled={busy} />
      {overview && !overview.historicalBackfillComplete && (
        <Notice tone="warn" title="历史充值累计数不完整">
          部分历史账目尚未核清，共 {overview.historicalBackfillAnomalyCount} 条（手续费 {overview.feeEvidenceAnomalyCount} 条，储备 {overview.treasuryReserveAnomalyCount} 条）。
        </Notice>
      )}
      {overviewError && !overview
        ? <BlockState state="error" title="今日入账和对账差异读取失败" detail={overviewError} onRetry={() => void loadOverview()} />
        : <StatBand label="今日充值">
          <Stat tone="role-1" icon={Coins} label="今日入账" value={overview ? usdt(overview.ledgerTotal) : "—"} unit={overview ? "USDT" : undefined}
            explain="今天对账记录里平台已入账的充值合计，只算 USDT，按业务日算。和上面的历史累计无关。" />
          <Stat tone="role-2" icon={Hash} label="今日入账笔数" value={overview ? String(overview.ledgerCount) : "—"} unit={overview ? "笔" : undefined} />
          <Stat tone={hasDiff ? "warn" : undefined} icon={Scale} iconTone={hasDiff ? "warn" : undefined} label="对账差异" value={overview ? String(overview.diffCount) : "—"} unit={overview ? "个通道" : undefined}
            explain="今天支付商记录和平台账目对不上、还没挂账的通道数。已挂账的差异仍在，但不算在这里。" />
          <Stat tone={hasDiff ? "warn" : undefined} icon={ArrowLeftRight} label="差异金额" value={overview ? usdt(overview.diffAmount) : "—"} unit={overview ? "USDT" : undefined}
            explain="还没挂账的通道里，支付商金额减平台金额的合计。" />
        </StatBand>}
      <Fold title="对账差异" icon={Scale} tone="role-2" summary={reconSummary} alert={hasDiff} open={reconOpen ?? hasDiff} onOpenChange={setReconOpen}
        explain="支付商记录和平台账目按通道比对，今天的数。有数据后会自动对比；没有数据不代表已经对上。">
        {overviewLoading && !overview ? <BlockState state="loading" title="正在读取对账差异…" />
          : !overview ? <BlockState state="error" title="对账差异读取失败" detail={overviewError} onRetry={() => void loadOverview()} />
            : reconRows.length === 0 ? <BlockState state="empty" title="今天还没有支付商流水或入账记录。有数据后会自动对比；没有数据不代表已经对上。" />
              : <Table label="对账差异">
                <thead><tr><Th>通道</Th><Th align="right">支付商（USDT）</Th><Th align="right">平台（USDT）</Th><Th>差异</Th>{canReconcile && <Th sticky="end" align="right">操作</Th>}</tr></thead>
                <tbody>{reconRows.map(row => <tr key={row.channel}>
                  <Td><Cell main={depositChannelText(row.channel)} /></Td>
                  <Td align="right"><Cell num main={usdt(row.providerAmount)} sub={`${row.providerCount} 笔`} /></Td>
                  <Td align="right"><Cell num main={usdt(row.ledgerAmount)} sub={`${row.ledgerCount} 笔`} /></Td>
                  <Td><Cell main={<StatusTag tone={!mismatched(row) ? "ok" : row.reconciled ? "done" : "warn"}>{diffText(row)}</StatusTag>} /></Td>
                  {canReconcile && <Td sticky="end" align="right">{!row.reconciled && mismatched(row)
                    ? <Button size="sm" disabledReason={readingReason ?? d1PendingObjectReason(`/topup/reconciliation/${encodeURIComponent(row.channel)}/writeoff`)} onClick={() => writeoff(row)}>挂账</Button>
                    : <span className="rd-note">—</span>}</Td>}
                </tr>)}</tbody>
              </Table>}
      </Fold>
      <FilterBar
        scope={<Segments label="充值流水状态" value={status} onChange={(key) => { setStatus(key); setPage(1); }} items={FLOW_TABS.map(([value, label]) => ({ value, label }))} />}
        onSubmit={() => {
          if (userIssue) return;
          const nextUser = userInput.trim();
          if (page === 1 && query === keyword.trim() && userQuery === nextUser) void loadFlows(); else { setPage(1); setQuery(keyword.trim()); setUserQuery(nextUser); }
        }}
        querying={flowsLoading}
        onClear={() => { setStatus(""); setKeyword(""); setQuery(""); setUserInput(""); setUserQuery(""); setPage(1); }}
        canClear={status !== "" || query !== "" || keyword !== "" || userInput !== "" || userQuery !== ""}
      >
        <FilterField><Input data-search id="d1-flow-user" aria-label="用户编号" inputMode="numeric" placeholder="用户编号" aria-invalid={userIssue ? true : undefined} title={userIssue} value={userInput} onChange={(e) => setUserInput(e.target.value)} /></FilterField>
        <FilterField grow><Input data-search id="d1-flow-keyword" aria-label="充值流水查询关键字：充值单号 / 交易号" placeholder="充值单号 / 交易号" value={keyword} onChange={(e) => setKeyword(e.target.value)} /></FilterField>
      </FilterBar>
      <Panel flush icon={FileText} tone="role-2" title="充值流水" explain="链上充值单、历史支付记录和国际卡记录。银行卡支付的订单不在这张表，在「银行卡充值」里看。金额按每一行自己的币种写，不折算。"
        actions={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={flowsLoading} onClick={() => { void loadFlows(); void loadOverview(); }}>刷新</Button>}>
        <Table label="充值流水" aria-busy={flowsLoading}>
          <thead><tr>
            <Th sticky="start">充值单 · 提交时间（{zone}）</Th>
            <Th>用户 · 通道</Th>
            <Th align="right" icon={Coins} tone="money">金额</Th>
            <Th>状态</Th>
            <Th sticky="end" align="right">操作</Th>
          </tr></thead>
          <tbody>
            {flowsLoading ? <TableLoading columns={5} rows={5} />
              : flowsError ? <TableMessage columns={5} role="alert">充值流水读取失败。{flowsError} <Button size="sm" onClick={() => void loadFlows()}>重试</Button></TableMessage>
                : flowRecords.length === 0 ? <TableMessage columns={5} role="status">{status || query || userQuery ? "没有符合条件的充值流水。" : "暂无充值流水。用户链上充值或国际卡充值后会出现在这里；银行卡支付的订单在「银行卡充值」里看。"}</TableMessage>
                  : flowRecords.map((item) => <Tr key={item.depositNo} selected={item.depositNo === flowSelected} onOpen={() => setFlowSelected(item.depositNo)}>
                    <Td sticky="start"><Cell mono full main={item.depositNo} sub={time(item.createdAt)} /></Td>
                    <Td><Cell main={String(item.userId)} sub={depositChannelText(item.channel)} /></Td>
                    <Td align="right"><Cell num main={`${usdt(item.amount)} ${nexGridBrandText(item.asset)}`} sub={`实收 ${usdt(item.providerReceived)}`} /></Td>
                    <Td><Cell main={<StatusTag tone={flowTone(item.status)}>{d1StatusText(item.status)}</StatusTag>} sub={item.creditedAt ? `入账 ${time(item.creditedAt)}` : "尚未入账"} /></Td>
                    <Td sticky="end" align="right"><Button size="sm" variant="ghost" onClick={() => setFlowSelected(item.depositNo)}>查看详情</Button></Td>
                  </Tr>)}
          </tbody>
        </Table>
        {flows && flows.total > 0 && <Pager label="充值流水" sizeLabel="充值流水" total={flows.total} page={flows.pageNum} pageSize={pageSize} sizes={FLOW_SIZES} loading={flowsLoading}
          onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />}
      </Panel>
      <Drawer open={!!flow} onClose={() => setFlowSelected(null)} title="充值流水" sub={flow?.depositNo} icon={FileText} tone="role-2"
        nav={{ hasPrev: flowIndex > 0, hasNext: flowIndex >= 0 && flowIndex < flowRecords.length - 1, onPrev: () => setFlowSelected(flowRecords[flowIndex - 1]?.depositNo ?? flowSelected), onNext: () => setFlowSelected(flowRecords[flowIndex + 1]?.depositNo ?? flowSelected) }}>
        {flow && <>
          <JudgmentPoints rows={[
            { label: "金额", icon: Coins, tone: "money", value: `${usdt(flow.amount)} ${nexGridBrandText(flow.asset)}`, reason: `支付商实收 ${usdt(flow.providerReceived)} ${nexGridBrandText(flow.asset)}` },
            { label: "用户", icon: ListChecks, tone: "users", value: String(flow.userId), reason: `${depositChannelText(flow.channel)} · ${nexGridBrandText(flow.asset)}` },
            { label: "状态", state: flowTone(flow.status) === "progress" ? undefined : flowTone(flow.status), value: d1StatusText(flow.status) },
          ]} />
          <Fold inset title="时间与交易号" summary={flow.creditedAt ? `入账 ${time(flow.creditedAt)}` : "尚未入账"}>
            <KeyValues rows={[
              { key: "proof", label: "交易号", value: flow.proof || "—", mono: !!flow.proof },
              { key: "created", label: `提交（${zone}）`, value: time(flow.createdAt) },
              { key: "confirmed", label: `确认（${zone}）`, value: flow.confirmedAt ? time(flow.confirmedAt) : "尚未确认" },
              { key: "credited", label: `入账（${zone}）`, value: flow.creditedAt ? time(flow.creditedAt) : "尚未入账" },
            ]} />
          </Fold>
        </>}
      </Drawer>
    </div>
  </>;
}
