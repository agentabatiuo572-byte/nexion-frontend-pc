"use client";

/**
 * B1 资金与应付款总览。先答「付不付得起」：结论句、可用储备对应付款、覆盖率和红线健康线的距离；
 * 再答「欠的钱谁是大头」「趋势往哪走」「有没有告警要我处理」。
 * 保留既有界面和请求合同；业务写入保存原请求，审计导出按 B4-PD02 可直接重试。
 * 写入结论不替代当前读取，账本和独立差额走势均在写入后刷新。
 */
import "./dual-ledger.css";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownUp, Download, Gauge, Landmark, ReceiptText, Scale, ShieldAlert, ShieldCheck, ShieldQuestion, SlidersHorizontal, TrendingUp, Wallet } from "lucide-react";
import {
  BlockState, Button, Cell, Conclusion, Donut, Explain, Fact, Facts, Figure, IrreversibleTag, KeyValues, NumberInput, DiffField,
  Notice, PageHeader, Panel, RdPage, ReleaseModal, Segments, Stat, StatBand, StatusTag, Table, Td, Th, ThresholdMeter, Tr, TrendLine, TrendLines,
  type ChartSlot,
} from "@/app/components/rd";
import { useBDomainDashboard, type BLedger } from "@/lib/admin/b-client";
import { downloadD3Csv, fetchD3NetExposure, type D3NetExposure } from "@/lib/admin/d-client";
import { pendingThresholdConfigApproval, releaseExpiredB1ThresholdApproval, submitB1ThresholdApproval } from "@/lib/admin/withdrawal-config-approval";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { b1Commands, executeB1Command, type B1PendingWrite, type B1CommandFacts } from "@/lib/admin/b1-commands";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isBCommandRejection } from "@/lib/admin/b-command-rejection";
import { isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { DOutcomeUnknownError } from "@/lib/admin/d-client";
import { TREASURY_VALUATION_UNAVAILABLE } from "@/lib/admin/treasury-valuation";
import { amountDigits, amountText } from "@/lib/admin/treasury-amount";
import { LIABILITY_EXPLANATIONS, liabilityDisplayName } from "@/lib/admin/liability-labels";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { fmtConfigPct, fmtNum, fmtPct } from "@/lib/format";
import { OperationConfirmModal, useToast, type BusinessFormValue } from "@/app/components/domain-views/design-kit";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";

const round2 = (n: number) => Math.round(n * 100) / 100;

// 驾驶舱决策动作(高敏,均走操作确认)。
type Mc = (
  | { kind: "threshold"; idempotencyKey: string; baseline: Pick<BLedger, "redlinePct" | "healthyPct" | "thresholdVersion"> }
  | { kind: "injection" | "ack" | "export"; idempotencyKey: string }
) & { requestKey?: string; original?: B1PendingWrite; facts?: B1CommandFacts; approvalRecovery?: true; draft?: BusinessFormValue; draftReason?: string };

function command(kind: Exclude<Mc["kind"], "threshold">): Mc {
  return { kind, idempotencyKey: `b1-${kind}-${crypto.randomUUID()}` };
}

/** 全页时间一种写法：2026-11-13 14:30（北京时间），和资金储备与应付款一致。 */
const THRESHOLD_REFRESHED = "当前阈值已更新，请核对后再保存。";
const timeText = (value: string | undefined) => `${formatBusinessTimeCompact(value, "—")}（${businessZone().label}）`;
/** 接口给两位小数，原样写，不补也不舍（F04）。 */
const pctText = (value: number) => `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const pointsText = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
const money = (value: number | null, digits?: number) => (value === null ? TREASURY_VALUATION_UNAVAILABLE : `${amountText(value, digits)} USDT`);
const signedMoney = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${amountText(Math.abs(value))} USDT`;
/** 纵轴刻度是取整的整齐数，写完整数字加千分位，不用 K、M（F04）。 */
const axisMoney = (value: number) => `${value < 0 ? "−" : ""}${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** 一亿以上纵轴写不下完整数字：刻度改用「万」，单位写在图上方（提示框和右侧仍是完整金额）。 */
const AXIS_WAN_FROM = 100_000_000;
const UVT_NOTE = "UVT 锁仓到期应付按最新有效价格折算。没有有效价格时，这一类金额、应付款合计、覆盖率、差额和各类占比都写「暂时无法估值」；储备和其余 8 类照常显示。";
/** 一类占到这个比例时，环几乎是单色，说明不了构成，写一句话（和资金储备与应付款一致）。 */
const RING_DOMINANT_SHARE = 0.9;
const WINDOWS = [{ value: "7d", label: "7 天" }, { value: "30d", label: "30 天" }, { value: "90d", label: "90 天" }] as const;

/**
 * 业务写入及审批的本标签页恢复记录。原请求在发送前保存；导出不进入 R1。
 * 写法照资金储备与应付款的待确认条：页头下、结论句上，一条一个 Notice，24 小时后只核对不重试。
 */
interface B1PendingCommand {
  commandKey: string;
  title: string;
  body: ReactNode;
  expired: boolean;
  /** 第二行：能做什么。过期后直接写入查不到不等于没执行；审批单查不到可以解除。 */
  note: string;
  onRetry?: () => void;
  onQuery: () => void;
  /** 只有审批提案过期、且刚刚按原请求查询明确没有这张单时才给（决定 R1-提案过期）。 */
  onRelease?: () => void;
}

function PendingCommands({ items, auditReachable }: { items: readonly B1PendingCommand[]; auditReachable: boolean }) {
  if (!items.length) return null;
  return (
    <>
      {items.map((item) => (
        <Notice key={item.commandKey} tone="warn" title={item.title} actionBelow
          action={<span className="b1-actions">
            <Button size="sm" onClick={item.onQuery}>查询原结果</Button>
            {!item.expired && item.onRetry && <Button size="sm" onClick={item.onRetry}>按原请求重试</Button>}
            {item.onRelease && <Button size="sm" onClick={item.onRelease}>解除待确认</Button>}
            {auditReachable && <Link className="rd-link" href="/platform/audit" prefetch={false}>到「操作记录与审批」核对</Link>}
          </span>}>
          <p>{item.body}</p>
          <p>{item.note}</p>
        </Notice>
      ))}
    </>
  );
}

function GapTag({ net }: { net: number }) {
  return net > 0 ? <StatusTag tone="ok">有富余</StatusTag> : net === 0 ? <StatusTag tone="warn">刚好够</StatusTag> : <StatusTag tone="danger">不够付</StatusTag>;
}

export default function DualLedgerPage() {
  const bDomain = useBDomainDashboard();
  const { ledger: LEDGER, alerts } = bDomain;
  const session = useAdminAuth((s) => s.session);
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const reach = useReach();
  const canConfigureThresholds = authorities.includes("overview_b1_redline_write");
  const canInjectReserve = authorities.includes("finance_d3_injection_create");
  const canExport = authorities.includes("finance_d3_export");
  const canAcknowledge = authorities.includes("overview_b1_write");
  const [toastNode, setToast] = useToast();
  const [mc, setActionConfirm] = useState<Mc | null>(null);
  const [, setPendingRevision] = useState(0);
  const [needsRead, setNeedsRead] = useState(false);
  const [exposureRevision, setExposureRevision] = useState(0);
  // 只管界面：过期审批刚查到「没有这张单」、正在开解除框、这次会话里查到的待审批单。
  const [releasableApproval, setReleasableApproval] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [verifiedPendingKey, setVerifiedPendingKey] = useState<string | null>(null);
  // 只管界面：写入已确认、随后重读失败时，读取失败页上留着这句结论，下一次读到数据就清掉。
  const [savedWhileUnread, setSavedWhileUnread] = useState<string | null>(null);
  useEffect(() => { if (bDomain.hasData && !bDomain.loading && !bDomain.error) setSavedWhileUnread(null); }, [bDomain.hasData, bDomain.loading, bDomain.error]);
  const syncPending = () => setPendingRevision(value => value + 1);
  const pendingWrites = session ? b1Commands.list().filter(record => record.adminId === String(session.adminId)) : [];
  const pendingApproval = session ? pendingThresholdConfigApproval("B1", session.adminId) : undefined;
  useEffect(() => { setPendingRevision(value => value + 1); }, [session?.adminId]);
  useEffect(() => {
    if (bDomain.hasData && !bDomain.loading && !bDomain.error) {
      setNeedsRead(false);
      setActionConfirm(current => current?.kind === "threshold" && !current.original && !current.approvalRecovery
        && current.baseline.thresholdVersion !== bDomain.ledger.thresholdVersion
        ? { ...current, baseline: bDomain.ledger, facts: undefined } : current);
    }
  }, [bDomain.data, bDomain.hasData, bDomain.loading, bDomain.error]);
  const [showZero, setShowZero] = useState(false);
  const [exposureWindow, setExposureWindow] = useState<"7d" | "30d" | "90d">("30d");
  const [exposure, setExposure] = useState<D3NetExposure | null>(null);
  const [exposureError, setExposureError] = useState("");
  const currentExposure = exposure?.window === exposureWindow ? exposure : null;
  const exposureSeries = currentExposure?.series ?? [];

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        setExposureError("");
        const next = await fetchD3NetExposure(exposureWindow, controller.signal);
        if (!controller.signal.aborted) setExposure(next);
      } catch (err) {
        if (controller.signal.aborted) return;
        setExposure(null);
        setExposureError(displayAdminReadError(err));
      }
    })();
    return () => controller.abort();
  }, [exposureWindow, exposureRevision]);

  const header = (meta?: ReactNode, actions?: ReactNode, readOnly?: ReactNode) => (
    <PageHeader pageId="B1" title="资金与应付款总览" summary="看平台付不付得起欠用户的钱，差多少、往哪走。" meta={meta} actions={actions} readOnly={readOnly} />
  );

  const {
    reserveUsd,
    liabilitiesUsd,
    valuationReliable,
    coverageRatio,
    redlinePct,
    healthyPct,
    accounts,
    netFlow24hUsd,
    queueBacklogCount,
    queueBacklogUsd,
    avgRiskScore,
    coverageSeries,
    coverageSeriesIntervalHours,
    prev,
  } = LEDGER;
  const generatedAt = bDomain.data?.generatedAt;
  const b1DataError =
    valuationReliable && coverageSeries.length < 2
      ? "覆盖率走势数据不足，暂时无法显示"
      : accounts.length === 0
        ? "B1_LEDGER_ACCOUNTS_EMPTY"
        : "";
  const warnings = bDomain.warnings ?? [];
  const warningNotice = warnings.length > 0 && (
    <Notice tone="warn" title="部分设置未生效">
      {warnings.slice(0, 4).map((warning) => (
        <p key={`${warning.key}-${warning.code}`}><span data-mono>{warning.key}</span> · {warning.code}：{warning.message}</p>
      ))}
      {warnings.length > 4 && <p>另有 {warnings.length - 4} 条未展开。</p>}
    </Notice>
  );
  const netExposure = reserveUsd - liabilitiesUsd;
  // 两个两位小数相减会带浮点尾数，显示按两位写，不造位数（F04）。
  const netShown = round2(netExposure);

  // 派生:阈值和熔断态均以后端接口为准。
  const effRedline = Number(redlinePct);
  const alertAcked = alerts.coverageRedlineAcked;

  // 覆盖率 zone(以生效红线判定)
  const zone = LEDGER.redlineBreached ? "danger" : coverageRatio < healthyPct ? "warning" : "success";
  // 页面拿到的是两位小数的覆盖率，后端护栏用未舍入的值比较（F05）：刚好压线时不画成安全。
  const onRedline = coverageRatio === effRedline;
  const onHealthy = coverageRatio === healthyPct;
  const coverTone = zone === "danger" ? "danger" : zone === "warning" || onHealthy ? "warn" : "ok";

  const bufferPct = round2(coverageRatio - effRedline);
  const toHealthy = round2(coverageRatio - healthyPct);
  const distanceText =
    zone === "danger"
      ? round2(effRedline - coverageRatio) > 0 ? `低于红线 ${pointsText(round2(effRedline - coverageRatio))} 个百分点` : "显示值等于红线，系统按精确值判断已低于红线"
      : bufferPct === 0
        ? "正好在红线上"
        : zone === "warning"
          ? `高于红线 ${pointsText(bufferPct)} 个百分点，低于健康线 ${pointsText(-toHealthy)} 个百分点`
          : toHealthy === 0
            ? `正好在健康线上，高于红线 ${pointsText(bufferPct)} 个百分点`
            : `高于健康线 ${pointsText(toHealthy)} 个百分点，离红线还有 ${pointsText(bufferPct)} 个百分点`;

  // 触红线预测:由近 8 窗口斜率外推(真实趋势,非装饰)
  const slope =
    coverageSeries.length > 1
      ? (coverageSeries[coverageSeries.length - 1] - coverageSeries[0]) / (coverageSeries.length - 1)
      : 0;
  const windowsToRedline =
    slope < -0.01 && coverageRatio > effRedline
      ? Math.max(1, Math.round((coverageRatio - effRedline) / -slope))
      : null;
  // 历史点是当时的储备 ÷ 现在的应付款，线的起伏只说明储备在变（决定 B1-走势）。估算是旧页面就有的，只按储备变化的速度算。
  const trendMsg = windowsToRedline != null ? `储备在减少，按这个速度约 ${windowsToRedline} 个时段后跌破红线` : slope < -0.01 ? "储备在减少" : slope > 0.01 ? "储备在增加" : "储备没有明显变化";
  const seriesTicks = coverageSeries.map((_, index) => {
    const back = coverageSeries.length - 1 - index;
    if (back === 0) return "现在";
    return coverageSeriesIntervalHours ? `${back * coverageSeriesIntervalHours}h 前` : `前 ${back} 段`;
  });

  // 真实环比(对上一统计窗口),替代硬编码 delta
  const prevReserve = Math.abs(prev.reserveUsd) > 0 ? prev.reserveUsd : reserveUsd || 1;
  const reserveChg = round2(((reserveUsd - prevReserve) / prevReserve) * 100);

  // 应付负债科目(占比派生)
  const liabRows = accounts.map((a) => ({ ...a, pct: liabilitiesUsd > 0 ? round2((a.amount / liabilitiesUsd) * 100) : 0 }));
  const liabName = (a: (typeof liabRows)[number]) => liabilityDisplayName(a.key, operatorCopyText(a.label));
  const liabAmount = (a: (typeof liabRows)[number]) => (!valuationReliable && a.key === "nex_v2_future" ? null : a.amount);
  const ranked = [...liabRows].sort((a, b) => (liabAmount(b) ?? -1) - (liabAmount(a) ?? -1));
  const zeroRows = ranked.filter((a) => liabAmount(a) === 0);
  const listed = showZero ? ranked : ranked.filter((a) => liabAmount(a) !== 0);
  const liabDigits = amountDigits(ranked.map(liabAmount));
  const positive = ranked.filter((a) => (liabAmount(a) ?? 0) > 0);
  const slots = new Map<string, ChartSlot>();
  let ring: ReactNode = null;
  let ringNote: ReactNode = null;
  if (!valuationReliable) {
    ringNote = <p className="rd-note">UVT 锁仓到期应付缺少有效价格，合计和占比暂时无法估值，所以不画构成环。</p>;
  } else if (positive.length < 2) {
    ringNote = <p className="rd-note">{positive.length ? `全部是${liabName(positive[0])}。` : "目前没有应付款。"}</p>;
  } else if (liabilitiesUsd > 0 && positive[0].amount / liabilitiesUsd >= RING_DOMINANT_SHARE) {
    ringNote = <p className="rd-note">几乎全是{liabName(positive[0])}，占 {fmtPct(positive[0].pct)}。</p>;
  } else {
    positive.slice(0, 2).forEach((a, index) => slots.set(a.key, (index + 1) as ChartSlot));
    const rest = positive.slice(2);
    const restSum = round2(rest.reduce((sum, a) => sum + a.amount, 0));
    const parts = [
      ...positive.slice(0, 2).map((a, index) => ({ key: a.key, label: liabName(a), value: a.amount, slot: (index + 1) as ChartSlot, text: money(a.amount), share: fmtPct(a.pct) })),
      ...(restSum > 0 ? [{ key: "rest", label: `其他 ${rest.length} 类`, value: restSum, slot: "other" as ChartSlot, text: money(restSum), share: fmtPct(round2((restSum / liabilitiesUsd) * 100)) }] : []),
    ];
    rest.forEach((a) => slots.set(a.key, "other"));
    // 环中间放不下 10 位以上的金额时写有金额的类数，合计在面板标题旁和统计里都有，不缩写金额。
    const total = amountText(liabilitiesUsd);
    ring = <Donut legend={false} label="应付款构成" center={total.length <= 12 ? total : `${positive.length} 类`} centerLabel={total.length <= 12 ? "USDT" : "有金额"} segments={parts} />;
  }

  const statDigits = amountDigits(valuationReliable ? [reserveUsd, liabilitiesUsd] : [reserveUsd]);

  const thresholdBaseline = mc?.kind === "threshold" ? mc.baseline : null;
  const dialogFacts: B1CommandFacts = mc?.original?.facts ?? mc?.facts ?? { reserveUsd, valuationReliable, redlineBreached: LEDGER.redlineBreached, coverageRatio, redlinePct, healthyPct, thresholdVersion: LEDGER.thresholdVersion, generatedAt };
  const newWriteBlocked = !bDomain.hasData || !!bDomain.error || bDomain.loading || needsRead || !!b1DataError;
  const writePermission = (kind: B1PendingWrite["kind"]) => kind === "threshold" ? canConfigureThresholds : kind === "injection" ? canInjectReserve : canAcknowledge;
  const refreshB1 = async () => {
    setNeedsRead(true);
    setExposureRevision(value => value + 1);
    const next = await bDomain.reload();
    if (next) {
      setNeedsRead(false);
      setActionConfirm(current => current?.kind === "threshold" && !current.original && !current.approvalRecovery
        ? { ...current, baseline: next.ledger, facts: undefined } : current);
    }
    return next;
  };
  const readActive = async () => {
    const next = await refreshB1();
    if (!next) throw new Error("资金数据读取失败，不显示旧数据");
    return next;
  };
  // 框关掉之后框里的错误行看不到，原因改用提示条写一次；缺权限由外壳统一提示。
  const toastClosedDialogError = (error: unknown) => { if (!isPermissionDenied(error)) setToast(displayAdminError(error)); };
  const submitThresholdApproval = async (reason: string, values: BusinessFormValue, lookupOnly = false) => {
    if (!session || !thresholdBaseline) return false;
    const original = pendingThresholdConfigApproval("B1", session.adminId);
    if (mc?.kind === "threshold") setActionConfirm({ ...mc, facts: dialogFacts, approvalRecovery: true });
    setNeedsRead(true);
    try {
      const result = await submitB1ThresholdApproval(session, original?.values ?? {
        expectedVersion: thresholdBaseline.thresholdVersion!,
        redlinePct: round2(Number(values.redlinePct)),
        healthyPct: round2(Number(values.healthyPct)),
      }, original?.reason ?? reason, readActive, lookupOnly ? "query" : original ? "retry" : "new", dialogFacts);
      if (!result) return false;
      if (result.ticket.status === "pending") setVerifiedPendingKey(pendingThresholdConfigApproval("B1", session.adminId)?.commandKey ?? null);
      setToast(result.acknowledgement);
      setActionConfirm(null);
      return true;
    } catch (error) {
      if (!original && isBCommandRejection(error, false)) {
        if (mc?.kind === "threshold") setActionConfirm({ ...mc, approvalRecovery: undefined, draft: values, draftReason: reason });
        await refreshB1();
      } else if (original && (isExplicitRejection(error) || !pendingThresholdConfigApproval("B1", session.adminId))) {
        setActionConfirm(null);
        toastClosedDialogError(error);
        await refreshB1();
      }
      throw error;
    } finally { syncPending(); }
  };

  const onMcConfirm = async (reason: string, _newValue?: string, businessValue?: BusinessFormValue) => {
    if (!mc || !session) return;
    const current = mc;
    try {
      if (current.kind === "export") {
        await downloadD3Csv("reconciliation", reason, operator, `b1-export-${crypto.randomUUID()}`);
        setToast("对账 CSV 已开始下载");
        setActionConfirm(null);
        return;
      }
      if (!writePermission(current.kind)) throw new Error("当前账号没有此操作权限，请重新读取权限后核对原操作。");
      if (current.kind === "threshold" && (current.approvalRecovery || pendingApproval && !current.original)) {
        await submitThresholdApproval(reason, businessValue!);
        return;
      }
      let original = current.original;
      if (original && !b1Commands.list().some(record => record.commandKey === original!.commandKey)) {
        const handled = new Error("原操作已处理，请重新读取后再操作。");
        setActionConfirm(null);
        toastClosedDialogError(handled);
        throw handled;
      }
      if (!original) {
        if (newWriteBlocked || pendingWrites.some(record => record.kind === current.kind) || current.kind === "threshold" && pendingApproval) {
          throw new Error("请先重新读取并核对原操作，再发起新修改。");
        }
        let body: string;
        const form = businessValue ?? {};
        if (current.kind === "threshold") {
          const redline = round2(Number(form.redlinePct));
          const healthy = round2(Number(form.healthyPct));
          if (!Number.isFinite(redline) || redline < 80 || redline > 150) throw new Error("红线必须在 80%–150%");
          if (!Number.isFinite(healthy) || healthy < 100 || healthy > 200) throw new Error("健康线必须在 100%–200%");
          if (healthy <= redline) throw new Error("健康线必须高于红线");
          if (current.baseline.thresholdVersion !== LEDGER.thresholdVersion) {
            setActionConfirm({ ...current, baseline: LEDGER, facts: undefined, draft: form, draftReason: reason });
            throw new Error(THRESHOLD_REFRESHED);
          }
          if (redline < current.baseline.redlinePct) {
            if (current.baseline.thresholdVersion === null) throw new Error("暂未取得当前阈值版本，请刷新后重试。");
            await submitThresholdApproval(reason, form);
            return;
          }
          body = JSON.stringify({ redlinePct: String(redline), healthyPct: String(healthy), expectedVersion: current.baseline.thresholdVersion ?? undefined, reason, operator });
        } else if (current.kind === "injection") {
          const amount = Number(form.amount);
          if (!Number.isFinite(amount) || amount <= 0) throw new Error("请输入有效的注入金额");
          if (!["CHAIN", "BANK"].includes(form.voucherType || "")) throw new Error("请选择凭证类型");
          if (!form.voucher?.trim()) throw new Error("请输入凭证编号或哈希");
          body = JSON.stringify({ amount: String(amount), voucherNo: `${form.voucherType}:${form.voucher.trim()}`, reason, operator });
        } else body = JSON.stringify({ reason, operator });
        const fingerprint = `${session.adminId}:${current.kind}`;
        const commandKey = current.requestKey ?? current.idempotencyKey;
        b1Commands.remember(fingerprint, commandKey, { adminId: String(session.adminId), kind: current.kind, body, form, facts: dialogFacts });
        if (!b1Commands.isDurablyStored(fingerprint, commandKey)) {
          b1Commands.forget(fingerprint, commandKey);
          throw new Error("浏览器无法保存这次操作的记录，没有提交。请允许浏览器存储后重试。");
        }
        original = b1Commands.list().find(record => record.commandKey === commandKey)!;
        setActionConfirm({ ...current, original });
      }
      setNeedsRead(true);
      try {
        await executeB1Command(original, !!current.original);
      } catch (error) {
        if (isBCommandRejection(error, !!current.original)) {
          setActionConfirm(current.original ? null : { ...current, requestKey: `b1-${current.kind}-${crypto.randomUUID()}`, original: undefined, draft: original.form, draftReason: JSON.parse(original.body).reason });
          if (current.original) toastClosedDialogError(error);
          const fresh = await refreshB1();
          if (fresh && !current.original && error instanceof Error && "reasonCode" in error && error.reasonCode === "CONFIG_VERSION_CONFLICT") throw new Error(THRESHOLD_REFRESHED);
          if (fresh && error instanceof Error && "reasonCode" in error && error.reasonCode === "B1_THRESHOLDS_APPROVAL_REQUIRED") {
            setActionConfirm({ kind: "threshold", idempotencyKey: `b1-threshold-${crypto.randomUUID()}`,
              baseline: fresh.ledger, draft: original.form, draftReason: JSON.parse(original.body).reason });
            return;
          }
        }
        throw error;
      } finally { syncPending(); }
      const success = current.kind === "threshold" ? "红线和健康线已更新"
        : current.kind === "injection" ? "储备注入已登记" : "覆盖率告警已标记为已处理";
      setToast(success, "success");
      setActionConfirm(null);
      const refreshed = await refreshB1();
      if (refreshed) setToast(current.kind === "threshold"
        ? `已更新 · 红线 ${fmtConfigPct(refreshed.ledger.redlinePct)} / 健康线 ${fmtConfigPct(refreshed.ledger.healthyPct)}`
        : current.kind === "injection" ? refreshed.ledger.valuationReliable ? "储备注入已登记，覆盖率已重算" : "储备注入已登记；UVT 暂时无法估值，覆盖率算不出" : "已标记为已处理");
      else { setSavedWhileUnread(success); setToast(success, "success"); }
    } catch (err) {
      if (current.kind === "export") {
        // 错误只在确认框里写一次，不再在页面顶部弹同一句。
        throw new Error(displayAdminReadError(err instanceof DOutcomeUnknownError ? "B1_EXPORT_FAILED" : err));
      }
      throw err;
    }
  };

  const recoverWrite = (record: B1PendingWrite) => setActionConfirm(record.kind === "threshold"
    ? { kind: "threshold", idempotencyKey: record.commandKey, original: record, baseline: record.facts }
    : { kind: record.kind, idempotencyKey: record.commandKey, original: record });
  const queryWrite = async (record: B1PendingWrite) => {
    if (await refreshB1()) setToast(record.expiresAt <= Date.now()
      ? "已读回现在的值。现在的值说明不了原操作成没成，记录继续保留。"
      : "已读回现在的值。说明不了原操作成没成，可以按原请求重试，不会重复执行。");
  };
  const queryApproval = async () => {
    if (!session || !pendingApproval) return;
    const expired = pendingApproval.expiresAt <= Date.now();
    setReleasableApproval(null);
    try {
      const result = await submitB1ThresholdApproval(session, pendingApproval.values, pendingApproval.reason, readActive, "query");
      if (!result && expired) setReleasableApproval(pendingApproval.commandKey);
      setVerifiedPendingKey(result?.ticket.status === "pending" ? pendingApproval.commandKey : null);
      setToast(result?.acknowledgement ?? (expired ? "没有这张审批单：原申请没有建成。核对后可以解除待确认。" : "暂未查到原审批单，可以按原请求重试，不会建第二张。"));
      if (result && result.ticket.status !== "pending") setActionConfirm(null);
    } catch (error) { setToast(displayAdminReadError(error)); }
    finally { syncPending(); }
  };
  const releaseApproval = async () => {
    if (!session || !pendingApproval) return;
    try {
      const released = await releaseExpiredB1ThresholdApproval(session.adminId, pendingApproval.commandKey);
      setReleasing(false);
      setReleasableApproval(null);
      if (!released) { setToast(displayAdminReadError(new Error("OPERATION_RESULT_UNKNOWN"))); return; }
      void refreshB1();
      setToast("已解除本页的待确认记录");
    } catch (error) { setToast(displayAdminReadError(error)); }
    finally { syncPending(); }
  };
  const recoverApproval = () => {
    if (!pendingApproval?.b1Facts) { void queryApproval(); return; }
    setActionConfirm({ kind: "threshold", idempotencyKey: pendingApproval.commandKey, baseline: pendingApproval.b1Facts, facts: pendingApproval.b1Facts, approvalRecovery: true });
  };
  const pendingItems: B1PendingCommand[] = pendingWrites.map(record => ({
    commandKey: record.commandKey,
    title: `${record.kind === "threshold" ? "调整红线和健康线" : record.kind === "injection" ? "登记储备注入" : "标记覆盖率告警已处理"} · 结果未知`,
    body: `${record.kind === "threshold" ? `红线 ${fmtConfigPct(record.facts.redlinePct)} → ${fmtConfigPct(Number(record.form.redlinePct))} · 健康线 ${fmtConfigPct(record.facts.healthyPct)} → ${fmtConfigPct(Number(record.form.healthyPct))}` : record.kind === "injection" ? `${money(Number(record.form.amount))} · ${record.form.voucherType === "BANK" ? "银行流水号" : "链上交易哈希"} ${record.form.voucher}` : "标记覆盖率告警已处理"} · ${timeText(new Date(record.createdAt).toISOString())}提交`,
    expired: record.expiresAt <= Date.now(),
    note: record.expiresAt <= Date.now() ? "已超过 24 小时，不能重试，只能查询；查到的是现在的值，说明不了原操作成没成。" : "24 小时内只能按原请求重试，不能改值。",
    onRetry: () => recoverWrite(record),
    onQuery: () => void queryWrite(record),
  }));
  if (pendingApproval) {
    const expired = pendingApproval.expiresAt <= Date.now();
    const verified = verifiedPendingKey === pendingApproval.commandKey;
    pendingItems.push({
      commandKey: pendingApproval.commandKey,
      title: `降低红线的审批 · ${verified ? "待审批" : "结果未知"}`,
      body: `红线 ${fmtConfigPct(pendingApproval.values.redlinePct)} · 健康线 ${fmtConfigPct(pendingApproval.values.healthyPct)} · ${timeText(new Date(pendingApproval.createdAt).toISOString())}提交`,
      expired,
      note: verified ? "等另一位超级管理员在「操作记录与审批」批准，批准前红线不变。"
        : !expired ? "24 小时内只能按原请求重试，不会建第二张单。"
          : releasableApproval === pendingApproval.commandKey ? "已超过 24 小时，查询结果是没有这张审批单，可以解除待确认。" : "已超过 24 小时，不能重试，只能查询原审批单。",
      onRetry: verified ? undefined : recoverApproval,
      onQuery: () => void queryApproval(),
      onRelease: expired && releasableApproval === pendingApproval.commandKey && !pendingApproval.received && !pendingApproval.b1Ticket ? () => setReleasing(true) : undefined,
    });
  }
  const openThreshold = () => setActionConfirm({
    kind: "threshold", idempotencyKey: `b1-threshold-${crypto.randomUUID()}`,
    baseline: { redlinePct, healthyPct, thresholdVersion: LEDGER.thresholdVersion },
  });

  // ---------- 结论 ----------
  const alertActive = valuationReliable && zone !== "success";
  const withdrawalsLink = reach("/finance/withdrawals") && !alertAcked && (
    <Link href="/finance/withdrawals" prefetch={false} className="rd-btn" data-variant={zone === "danger" ? "danger-outline" : "secondary"} data-size="md"><span className="rd-btn-face">去提现审核</span></Link>
  );
  const ackButton = alertActive && !alertAcked && canAcknowledge && (
    <Button disabledReason={newWriteBlocked || pendingWrites.some(record => record.kind === "ack") ? "请先重新读取并核对原操作，再发起新修改。" : undefined} onClick={() => setActionConfirm(command("ack"))}>标记已处理</Button>
  );
  const conclusionAction = alertActive && (withdrawalsLink || ackButton) ? <span className="b1-actions">{withdrawalsLink}{ackButton}</span> : undefined;
  const ackHint = alertAcked
    ? "告警已有人标记处理。"
    : canAcknowledge ? "告警还没人确认。" : "告警还没人确认，需要有确认权限的同事处理。";
  const conclusionExplain = (
    <>
      <p>兑付覆盖率 = 可用储备 ÷ 应付款，只在后台显示。</p>
      <p>是否低于红线按系统的精确判断，和提现放行等检查一致；健康线按显示的两位小数比，刚好相等时按警戒算。</p>
      <p>告警确认只记下有人跟进，不停业务。系统读到覆盖率回到健康线以上时会清掉确认，之后再跌会重新提醒；两次读取之间短暂回升读不到。</p>
    </>
  );
  const conclusion = !valuationReliable ? (
    <Conclusion state="unknown" icon={ShieldQuestion} hint="储备、其余 8 类应付款和资金进出照常显示。" explain={UVT_NOTE} explainTitle="为什么不下结论">
      资金状态：UVT 暂时无法估值，覆盖率不下结论
    </Conclusion>
  ) : zone === "danger" ? (
    <Conclusion state="danger" strong lead icon={ShieldAlert} explain={conclusionExplain} action={conclusionAction}
      hint={alertAcked ? ackHint : <>请立即暂停会多付钱的操作和收益发放。{ackHint}</>}>
      资金告警：覆盖率 <b>{pctText(coverageRatio)}</b>，跌破红线
    </Conclusion>
  ) : zone === "warning" ? (
    <Conclusion state="warn" lead icon={ShieldAlert} explain={conclusionExplain} action={conclusionAction}
      hint={alertAcked ? ackHint : onRedline ? <>系统精确判断还没跌破，再降一点提现审核就不能放行。{ackHint}</> : <>建议收紧大额提现，暂缓创世节点收益发放和调高参考年奖励率。{ackHint}</>}>
      资金需要注意：覆盖率 <b>{pctText(coverageRatio)}</b>，{onRedline ? "正好压在红线上" : "低于健康线"}
    </Conclusion>
  ) : onHealthy ? (
    <Conclusion state="warn" lead icon={ShieldAlert} explain={conclusionExplain} hint="以系统的精确判断为准，先别当作已经恢复。">
      资金需要注意：覆盖率 <b>{pctText(coverageRatio)}</b>，正好压在健康线上
    </Conclusion>
  ) : (
    <Conclusion state="ok" icon={ShieldCheck} explain={conclusionExplain} hint="储备够付全部应付款，这页不用处理。">
      资金安全：覆盖率 {pctText(coverageRatio)}，高于健康线 {fmtConfigPct(healthyPct)}
    </Conclusion>
  );

  // ---------- 页头 ----------
  const headerActions = (canExport || canInjectReserve) ? (
    <>
      {canExport && <Button icon={<Download size={14} aria-hidden />} onClick={() => setActionConfirm(command("export"))}>导出对账 CSV</Button>}
      {canInjectReserve && <Button variant={zone === "success" || !valuationReliable ? "secondary" : "primary"} disabledReason={newWriteBlocked || pendingWrites.some(record => record.kind === "injection") ? "请先重新读取并核对原操作，再发起新修改。" : undefined} onClick={() => setActionConfirm(command("injection"))}>登记储备注入</Button>}
    </>
  ) : undefined;
  const readOnly = !canConfigureThresholds && !canInjectReserve ? "你只能查看；调整红线和登记注入需财务主管或超级管理员。" : undefined;

  // ---------- 三个数 ----------
  const reserveLink = reach("/finance/pool");
  const stats = (
    <StatBand label="储备和应付款" fit>
      <Stat tone="role-1" icon={Wallet} label="可用储备" value={amountText(reserveUsd, statDigits)} unit="USDT"
        sub={prev.reserveUsd === 0 ? "24 小时前是 0，不算变化" : `较 24 小时前 ${reserveChg > 0 ? "+" : reserveChg < 0 ? "−" : ""}${fmtPct(Math.abs(reserveChg))}`}
        href={reserveLink ? "/finance/pool" : undefined} openLabel="可用储备，去资金储备与应付款"
        explain={`平台现在能动用的钱：已确认的储备账本、VietQR 已收款，减去还锁着的质押本金，不低于 0。不是用户钱包余额，也不是链上在线核对的余额。24 小时前的值 = 现在的储备 − 这 24 小时的净流入。原始数值 ${reserveUsd} USDT。`} />
      <Stat tone="role-2" icon={ReceiptText} label="应付款" value={valuationReliable ? amountText(liabilitiesUsd, statDigits) : TREASURY_VALUATION_UNAVAILABLE} unit={valuationReliable ? "USDT" : undefined}
        sub={`${accounts.length} 类`}
        explain={`平台之后要付给用户的九类钱，全口径合计，不是都能马上提现。构成在下面「应付款构成」。${UVT_NOTE}${valuationReliable ? `原始数值 ${liabilitiesUsd} USDT。` : ""}`} />
      <Stat icon={Scale} iconTone="role-other" label="差额（储备 − 应付款）"
        value={valuationReliable ? `${netShown < 0 ? "−" : ""}${amountText(Math.abs(netShown), statDigits)}` : TREASURY_VALUATION_UNAVAILABLE}
        unit={valuationReliable ? "USDT" : undefined}
        sub={valuationReliable ? <GapTag net={netShown} /> : undefined}
        explain="负数表示储备不够付全部应付款，不等于某一笔提现会马上失败。按上面两个数相减。" />
    </StatBand>
  );

  // ---------- 覆盖率 ----------
  const coveragePanel = (
    <Panel title="兑付覆盖率" icon={Gauge} tone="role-other" sub={`红线 ${fmtConfigPct(effRedline)} · 健康线 ${fmtConfigPct(healthyPct)}`}
      explain="覆盖率低于红线时，提现审核不能放行，会让平台多付钱的调整也会被拒，这是各业务自己的检查。覆盖率低于健康线算警戒。红线可设 80%–150%，健康线 100%–200%。"
      actions={canConfigureThresholds ? <Button size="sm" icon={<SlidersHorizontal size={14} aria-hidden />} disabledReason={newWriteBlocked || !!pendingApproval || pendingWrites.some(record => record.kind === "threshold") ? "请先重新读取并核对原操作，再发起新修改。" : undefined} onClick={openThreshold}>调整红线和健康线</Button> : undefined}>
      {valuationReliable ? (
        <div className="b1-coverage">
          <ThresholdMeter label="覆盖率和红线、健康线"
            rows={[{ key: "coverage", label: "覆盖率", value: coverageRatio, text: pctText(coverageRatio), tone: coverTone }]}
            marks={[
              { key: "redline", text: `红线 ${fmtConfigPct(effRedline)}`, value: effRedline, tone: "danger" },
              { key: "healthy", text: `健康线 ${fmtConfigPct(healthyPct)}`, value: healthyPct, tone: "ok" },
            ]} />
          <p className="b1-distance" data-tone={coverTone}>{distanceText}</p>
          <div className="b1-trend-head">
            <h3 className="b1-sub">近 {coverageSeries.length} 个时段<Explain label="覆盖率走势怎么算" content={`每 ${coverageSeriesIntervalHours ?? "—"} 小时一个点。储备按资金账本倒推当时的值，应付款一律用现在的值（应付款没有历史记录），所以这条线不是当时真实的覆盖率，起伏只来自储备进出。「按这个速度」只用第一个点和最后一个点的储备变化估，没算应付款的变化，不是系统预测。`} /></h3>
            <span className="b1-trend-msg" data-tone={windowsToRedline != null || (slope < -0.01 && zone !== "success") ? "warn" : undefined}>{trendMsg}</span>
          </div>
          <p className="b1-caliber">历史点 = 当时的储备 ÷ 现在的应付款，只反映储备变化</p>
          {windowsToRedline != null && <p className="b1-caliber">只按储备减少的速度估算，没算应付款的变化</p>}
          <TrendLines label="近几个时段的覆盖率" ticks={seriesTicks} format={pctText} axisFormat={(v) => `${Number(v.toFixed(1))}%`} height={120}
            series={[{ key: "coverage", label: "覆盖率", slot: 2, values: coverageSeries }]}
            // 图上第一条线的字写在线上方、第二条写在线下方：健康线在上、红线在下，两行字不叠。
            marks={[
              { key: "healthy", text: `健康线 ${fmtConfigPct(healthyPct)}`, value: healthyPct, tone: "ok" },
              { key: "redline", text: `红线 ${fmtConfigPct(effRedline)}`, value: effRedline, tone: "danger" },
            ]} />
        </div>
      ) : (
        <div className="rd-stack">
          <BlockState state="empty" title={`覆盖率${TREASURY_VALUATION_UNAVAILABLE}`} detail="UVT 锁仓到期应付缺少有效价格，算不出应付款合计。红线和健康线照常生效。" />
        </div>
      )}
    </Panel>
  );

  // ---------- 资金进出和提现 ----------
  const flowLink = reach("/finance/pool?tab=flow", "overview_b2_read");
  const queueLink = reach("/finance/withdrawals");
  const scoreLink = reach("/risk/scoring");
  const linked = (href: string, ok: boolean, label: string, body: ReactNode) => ok
    ? <Link className="rd-link" href={href} prefetch={false} aria-label={label}>{body}</Link>
    : body;
  const flowPanel = (
    <Panel title="资金进出和提现" icon={ArrowDownUp} tone="role-2"
      explain={<><p>{netFlow24hUsd >= 0 ? "资金在净流入" : "资金在净流出"}，{valuationReliable && "结合覆盖率走势，"}建议持续关注大额提现和奖励发放节奏。</p><p>这页只提醒和给建议，不会自己停业务。要停用某项业务去「紧急停用开关」。</p></>}>
      <div className="rd-stack">
        <KeyValues rows={[
          {
            key: "flow", label: "24 小时资金净流入",
            explain: "储备账本里过去 24 小时已确认的进出合计，进为正、出为负。不是用户充值总额，也不是收入。",
            value: <span className="b1-kv-value">{linked("/finance/pool?tab=flow", flowLink, "24 小时资金净流入，去资金流", signedMoney(netFlow24hUsd))}<small>前一个 24 小时 {signedMoney(prev.netFlow24hUsd)}</small></span>,
          },
          {
            key: "queue", label: "进行中的提现",
            explain: "所有还没结束的 USDT 提现：待审核、延迟、已通过、处理中、已发送、冻结、失败待处理等，不只是待审核。",
            value: <span className="b1-kv-value">{linked("/finance/withdrawals", queueLink, "进行中的提现，去提现审核", `${fmtNum(queueBacklogCount)} 单`)}<small>{money(queueBacklogUsd)}</small></span>,
          },
          {
            key: "risk", label: "提现风险评分均值",
            explain: "只算进行中的 USDT 提现，没有风险评分的单按 0 算，不是全部用户的平均。系统没给上一时段的值，所以不写变化。",
            value: <span className="b1-kv-value">{linked("/risk/scoring", scoreLink, "提现风险评分均值，去风险评分", `${avgRiskScore} / 100`)}</span>,
          },
        ]} />
        {reach("/emergency/kill-switch") && (
          <nav className="rd-links" aria-label="紧急处理"><span>紧急处理</span><Link className="rd-link" href="/emergency/kill-switch" prefetch={false}>去紧急停用开关</Link></nav>
        )}
      </div>
    </Panel>
  );

  // ---------- 应付款构成 ----------
  const nonZeroCount = ranked.filter((a) => liabAmount(a) === null || (liabAmount(a) ?? 0) > 0).length;
  const liabilityTable = (
    <Table label="九类应付款" className="b1-liabilities">
      <thead><tr><Th>类型</Th><Th align="right">金额 USDT</Th><Th align="right">占比</Th></tr></thead>
      <tbody>
        {listed.map((a) => {
          const slot = slots.get(a.key);
          const amount = liabAmount(a);
          return (
            <Tr key={a.key}>
              <Td><Cell main={<>{slot && <span className="rd-chart-swatch" data-slot={slot} aria-hidden />}{liabName(a)}<Explain label={`${liabName(a)}是什么`} content={LIABILITY_EXPLANATIONS[a.key] ?? operatorCopyText(a.label)} /></>} /></Td>
              <Td align="right"><Cell num full title={amount === null ? undefined : String(amount)} main={amountText(amount, liabDigits)} /></Td>
              <Td align="right"><Cell num full main={valuationReliable ? fmtPct(a.pct) : TREASURY_VALUATION_UNAVAILABLE} /></Td>
            </Tr>
          );
        })}
        {zeroRows.length > 0 && !showZero && (
          <Tr>
            <Td colSpan={3}><Button variant="ghost" size="sm" className="rd-record-more" onClick={() => setShowZero(true)}>另有 {zeroRows.length} 类现在是 0，展开看</Button></Td>
          </Tr>
        )}
      </tbody>
    </Table>
  );
  const duePage = reach("/finance/pool?tab=due", ["overview_b2_read", "finance_d3_read"]);
  const compositionPanel = (
    <Panel flush title="应付款构成" icon={ReceiptText} tone="role-2"
      sub={valuationReliable ? `${nonZeroCount} 类有金额，共 ${accounts.length} 类` : "UVT 应付款缺少有效价格"}
      explain={`按金额从大到小排。占比 = 这一类 ÷ 应付款合计。每类单独保留两位小数，加起来可能和合计差最后一位。${UVT_NOTE}`}
      actions={duePage ? <Link className="rd-link" href="/finance/pool?tab=due" prefetch={false}>到期和每类详情</Link> : undefined}>
      <div className="rd-panel-inset">
        {ring ? <Figure graphic={ring} width={200}>{liabilityTable}</Figure> : <div className="rd-stack">{ringNote}{liabilityTable}</div>}
      </div>
    </Panel>
  );

  // ---------- 差额走势 ----------
  const latest = exposureSeries.at(-1);
  const exposureDigits = amountDigits(exposureSeries.map((point) => point.netExposureUsdt));
  const exposureLoading = !exposureError && !currentExposure;
  const axisWan = exposureSeries.some((point) => Math.abs(point.netExposureUsdt) >= AXIS_WAN_FROM);
  // 走势图隔几个点写一个日期，最后一个点总写；倒数第二个写出来的日期离它太近时让给最后一个，日期挪进悬停提示。
  const tickStep = exposureSeries.length <= 8 ? 1 : exposureSeries.length <= 16 ? 2 : Math.ceil(exposureSeries.length / 8);
  const lastTicked = Math.floor((exposureSeries.length - 1) / tickStep) * tickStep;
  const crowded = exposureSeries.length - 1 - lastTicked > 0 && exposureSeries.length - 1 - lastTicked < tickStep / 2 ? lastTicked : -1;
  const exposurePanel = (
    <Panel title="差额走势" icon={TrendingUp} tone="role-1"
      explain="每天的差额 = 当天的储备 − 现在的应付款。储备按资金进出倒推，应付款没有历史记录，一律用现在的值，所以这不是当时真实的差额，线的起伏只来自储备进出。科目按「资金储备与应付款」的预测设置计入，可能和上面的全口径差额不同。切换天数不影响对账 CSV。"
>
      <div className="rd-stack">
      <p className="b1-caliber">历史点 = 当时的储备 − 现在的应付款，只反映储备变化</p>
      <div className="rd-toolbar">
        <Segments label="储备与应付款差额趋势时间范围" value={exposureWindow} onChange={setExposureWindow} items={WINDOWS} />
        <span className="rd-toolbar-note b1-window-note">{currentExposure && latest ? `截至 ${latest.date} · 共 ${exposureSeries.length} 天${axisWan ? " · 纵轴单位 万 USDT" : ""}` : exposureError ? "没有读到" : currentExposure ? "这段时间没有点" : "正在读取…"}</span>
      </div>
      {exposureError ? (
        <BlockState state="error" title="差额走势读取失败，已暂停显示" detail={`${exposureError} 切换时间范围或刷新页面会重新读取。`} />
      ) : exposureLoading ? (
        <BlockState state="loading" title="正在读取差额走势…" />
      ) : currentExposure?.valuationReliable === false ? (
        <BlockState state="empty" title={`差额${TREASURY_VALUATION_UNAVAILABLE}`} detail="计入的 UVT 应付款缺少有效价格。" />
      ) : exposureSeries.length === 0 || !latest ? (
        <BlockState state="empty" title="这段时间暂无数据" />
      ) : (
        <Figure width={720} stack="wide" graphic={
          <TrendLine label={`近 ${exposureSeries.length} 天储备与应付款差额`} format={(v) => money(v, exposureDigits)} axisFormat={axisWan ? (v) => axisMoney(v / 10_000) : axisMoney} slot={1} height={160}
            data={exposureSeries.map((point, index) => (index === crowded ? { key: point.date, tick: "", value: point.netExposureUsdt, detail: <span>{point.date}</span> } : { key: point.date, tick: point.date.slice(5), value: point.netExposureUsdt }))} />
        }>
          <Facts>
            <Fact k={`${latest.date} 差额`} lead tone={latest.netExposureUsdt < 0 ? "danger" : "role-1"} unit="USDT">{`${latest.netExposureUsdt < 0 ? "−" : ""}${amountText(Math.abs(latest.netExposureUsdt), exposureDigits)}`}</Fact>
            <Fact k="结论"><GapTag net={latest.netExposureUsdt} /></Fact>
            <Fact k="数据时间">{timeText(currentExposure?.asOf)}</Fact>
          </Facts>
        </Figure>
      )}
      </div>
    </Panel>
  );

  // ---------- 弹窗 ----------
  const thresholdForm = (value: BusinessFormValue, onChange: (value: BusinessFormValue) => void, locked: boolean, approval: boolean) => {
    if (!thresholdBaseline) return null;
    const { valuationReliable, coverageRatio } = dialogFacts;
    const red = value.redlinePct?.trim() ? Number(value.redlinePct) : Number.NaN;
    const healthy = value.healthyPct?.trim() ? Number(value.healthyPct) : Number.NaN;
    const redBad = value.redlinePct?.trim() && (!Number.isFinite(red) || red < 80 || red > 150) ? "红线要填 80–150，最多一位小数。" : undefined;
    const healthyBad = value.healthyPct?.trim() && (!Number.isFinite(healthy) || healthy < 100 || healthy > 200) ? "健康线要填 100–200，最多一位小数。" : undefined;
    const order = !redBad && !healthyBad && Number.isFinite(red) && Number.isFinite(healthy) && healthy <= red ? "健康线要高于红线。" : undefined;
    const redChanged = Number.isFinite(red) && !redBad && round2(red) !== thresholdBaseline.redlinePct;
    const healthyChanged = Number.isFinite(healthy) && !healthyBad && round2(healthy) !== thresholdBaseline.healthyPct;
    const lowering = redChanged && round2(red) < thresholdBaseline.redlinePct;
    return (
      <div className="rd-stack">
        <DiffField before={pointsText(thresholdBaseline.redlinePct)} beforeLabel={factWhen} unit="%" label="红线" hint="80–150，步长 0.1" error={redBad}
          explain="覆盖率低于红线时，提现审核不能放行，会让平台多付钱的调整也会被拒。"
          state={redChanged ? (lowering
            ? <StatusTag tone="warn">放宽 · 批准后生效</StatusTag>
            : <StatusTag tone="progress">{approval ? "收紧 · 批准后生效" : "收紧 · 立即生效"}</StatusTag>) : undefined}
          note={redChanged ? (lowering
            ? `红线从 ${fmtConfigPct(thresholdBaseline.redlinePct)} 降到 ${fmtConfigPct(round2(red))}：覆盖率要跌到 ${fmtConfigPct(round2(red))} 以下才停止放行提现，比现在更晚触发。${valuationReliable && coverageRatio < round2(red) ? `现在覆盖率 ${pctText(coverageRatio)} 低于拟调整的红线，系统会拒绝这次提交。` : ""}`
            : `红线从 ${fmtConfigPct(thresholdBaseline.redlinePct)} 提到 ${fmtConfigPct(round2(red))}：覆盖率低于 ${fmtConfigPct(round2(red))} 就停止放行提现，比现在更早触发。`) : undefined}>
          {(control) => <NumberInput {...control} aria-label="红线 (%)" unit="%" min={80} max={150} step={0.1} disabled={locked} value={value.redlinePct ?? ""} onChange={(event) => onChange({ ...value, redlinePct: event.target.value })} />}
        </DiffField>
        <DiffField size="body" before={pointsText(thresholdBaseline.healthyPct)} beforeLabel={factWhen} unit="%" label="健康线" hint="100–200，步长 0.1，要高于红线" error={healthyBad ?? order}
          explain="覆盖率低于健康线算警戒。已确认的告警要等系统读到覆盖率回到健康线以上才会清掉。"
          state={healthyChanged ? <StatusTag tone="progress">{approval ? "批准后生效" : "立即生效"}</StatusTag> : undefined}
          note={healthyChanged ? `健康线从 ${fmtConfigPct(thresholdBaseline.healthyPct)} 改到 ${fmtConfigPct(round2(healthy))}：覆盖率低于 ${fmtConfigPct(round2(healthy))} 就提示警戒，回到它以上才算恢复。` : undefined}>
          {(control) => <NumberInput {...control} aria-label="健康线 (%)" unit="%" min={100} max={200} step={0.1} disabled={locked} value={value.healthyPct ?? ""} onChange={(event) => onChange({ ...value, healthyPct: event.target.value })} />}
        </DiffField>
      </div>
    );
  };

  const dialogCoverTone = dialogFacts.redlineBreached ? "danger" : dialogFacts.coverageRatio <= dialogFacts.healthyPct ? "warn" : "ok";
  // 恢复原操作时事实来自提交那一刻的记录，不是现在的读数。
  const factWhen = mc?.original || mc?.facts ? "提交时" : "现在";
  const coverageFact = dialogFacts.valuationReliable ? <Fact k={`${factWhen}的覆盖率`} tone={dialogCoverTone}>{pctText(dialogFacts.coverageRatio)}</Fact> : <Fact k={`${factWhen}的覆盖率`}>{TREASURY_VALUATION_UNAVAILABLE}</Fact>;
  const dialog = mc && (
    <OperationConfirmModal key={mc.idempotencyKey} businessFormRevision={mc.kind === "threshold" ? mc.baseline.thresholdVersion : undefined} blockedReason={mc.original ? !writePermission(mc.original.kind) ? "当前账号没有此操作权限，请重新读取权限后核对原操作。" : undefined : mc.approvalRecovery ? undefined : mc.kind !== "export" && newWriteBlocked ? "请先重新读取并核对原操作，再发起新修改。" : undefined} briefKind={mc.kind === "export" ? "export" : mc.kind === "threshold" ? "config" : mc.kind === "injection" ? "funds" : "record"}
      action={
        mc.kind === "threshold"
          ? "设置兑付覆盖率红线和健康线"
          : mc.kind === "injection"
            ? "登记储备注入"
            : mc.kind === "export" ? "导出对账 CSV" : "标记覆盖率告警已处理"
      }
      title={mc.kind === "threshold" ? "调整红线和健康线" : mc.kind === "injection" ? "登记储备注入" : mc.kind === "export" ? "导出对账 CSV" : "确认覆盖率告警"}
      detail={
        mc.kind === "threshold"
          ? "红线是提现放行等检查用的门槛；健康线以下算警戒。只改之后的判断，不改已有储备、应付款和已经在走的提现。"
          : mc.kind === "injection"
            ? "只登记已经到账的平台资金，不会转账，也不会给用户钱包入账。"
            : mc.kind === "export" ? "下载一份当前读数的对账 CSV：可用储备、应付款、差额三行。" : "记下这条覆盖率告警已经有人跟进。"
      }
      effect={
        mc.kind === "injection" ? <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>
          : mc.kind === "export" ? <StatusTag tone="progress" filled>立即生效</StatusTag>
            : mc.kind === "ack" ? <StatusTag tone="neutral" filled>只做记录，不改业务</StatusTag>
              : undefined
      }
      confirmLabel={mc.kind === "threshold" ? "确认调整" : mc.kind === "injection" ? "确认登记" : mc.kind === "export" ? "确认导出" : "确认已跟进"}
      confirmTone={mc.kind === "injection" ? "danger" : "primary"}
      statedBrief={
        mc.kind === "threshold"
          ? (value: BusinessFormValue) => ({
              impact: value.redlinePct?.trim() && round2(Number(value.redlinePct)) < (thresholdBaseline?.redlinePct ?? 0)
                ? "降低红线会放宽资金检查，要另一位超级管理员在「操作记录与审批」批准，自己不能批。"
                : "提交后立即按新线判断之后的提现放行、放宽类调整和告警，已有储备、应付款和提现不会重算。",
              check: "核对前后值。提交时会核对打开这个框时的阈值版本，别人先改过会被拒，关掉重开就能看到最新值。",
            })
          : mc.kind === "injection"
            ? (value: BusinessFormValue) => ({
                impact: Number(value.amount) > 0
                  ? `可用储备立即增加 ${money(Number(value.amount))}，覆盖率随之重算；这页没有撤回入口。`
                  : "登记后可用储备立即增加这笔钱，覆盖率随之重算；这页没有撤回入口。",
                check: "系统只检查凭证格式和是否登记过，不会去链上或银行核实。先自己核对到账，理由写清到账依据或工单号。",
              })
            : mc.kind === "export"
              ? { impact: "这次导出记入操作记录（敏感导出），不改任何数据。", check: "核对导出内容，理由写明导出依据或工单号。" }
              : { impact: "所有能看这页的人都会看到告警已处理。不会停业务，也不会放行或冻结提现。", check: "理由写清已经做了什么，比如已暂停大额放行、已上报。" }
      }
      facts={
        mc.kind === "threshold" ? <Facts>{coverageFact}<Fact k="数据时间">{timeText(dialogFacts.generatedAt)}</Fact></Facts>
          : mc.kind === "injection" ? <Facts><Fact k={`${factWhen}的可用储备`} tone="role-1" unit="USDT">{amountText(dialogFacts.reserveUsd)}</Fact>{coverageFact}</Facts>
            : mc.kind === "export" ? (
              <Facts>
                <Fact k="内容">三行：可用储备、应付款、差额</Fact>
                <Fact k="列">项目、金额（USDT）、读取时间、估值状态</Fact>
                <Fact k="范围">导出时的读数，不跟着差额走势的天数变</Fact>
                {!valuationReliable && <Fact k="估值" tone="warn">暂时无法估值，应付款和差额两行金额留空</Fact>}
                <Fact k="去向">浏览器直接下载 d3-reconciliation.csv</Fact>
              </Facts>
            ) : (
              <Facts>
                {coverageFact}
                <Fact k="红线 / 健康线">{fmtConfigPct(dialogFacts.redlinePct)} / {fmtConfigPct(dialogFacts.healthyPct)}</Fact>
                <Fact k={factWhen === "现在" ? "告警" : "提交时的告警"}>还没人确认</Fact>
              </Facts>
            )
      }
      reasonPlaceholder={mc.kind === "injection" ? "例如：到账依据、工单号" : mc.kind === "export" ? "例如：月度对账、工单号" : mc.kind === "ack" ? "例如：已暂停大额放行，已上报财务主管" : "例如：调整依据、工单号"}
      initialReason={mc.draftReason}
      inlineApproval={mc.original ? {
        pending: true, initialRecovery: "retry", expired: mc.original.expiresAt <= Date.now(),
        resolve: () => undefined,
        renderForm: mc.kind === "threshold" ? thresholdForm : undefined,
        recover: async () => { await queryWrite(mc.original!); return true; },
        retry: () => onMcConfirm(""),
      } : thresholdBaseline ? {
        pending: !!pendingApproval,
        expired: !!pendingApproval && pendingApproval.expiresAt <= Date.now(),
        disabledReason: pendingApproval && !canConfigureThresholds ? "当前账号缺少设置兑付覆盖率阈值的权限。" : undefined,
        resolve: (value) => pendingApproval || value.redlinePct?.trim() && round2(Number(value.redlinePct)) < thresholdBaseline.redlinePct ? {
          coverageCheckCopy: "提交和批准时都按拟调整的红线校验覆盖率。",
          completionCopy: pendingApproval ? `提交时红线是 ${fmtConfigPct(thresholdBaseline.redlinePct)}；批没批以查询原审批单为准。` : `另一位超级管理员批准前，红线仍是 ${fmtConfigPct(thresholdBaseline.redlinePct)}。`,
          disabledReason: !pendingApproval && thresholdBaseline.thresholdVersion === null ? "暂未取得当前阈值版本，请刷新后重试。" : undefined,
        } : undefined,
        renderForm: thresholdForm,
        recover: (reason, value) => submitThresholdApproval(reason, value, true),
      } : undefined}
      businessForm={
        mc.kind === "threshold"
          ? {
              kind: "multi-field",
              title: "覆盖率阈值",
              hint: "红线可设 80%–150%，健康线可设 100%–200%，健康线须高于红线。",
              requireAnyChange: true,
              fields: [
                { key: "redlinePct", label: "红线 (%)", current: String(mc.baseline.redlinePct), inputKind: "number", min: 80, max: 150, step: 0.1, required: true, showDiff: true },
                { key: "healthyPct", label: "健康线 (%)", current: String(mc.baseline.healthyPct), inputKind: "number", min: 100, max: 200, step: 0.1, required: true, showDiff: true },
              ],
            }
          : mc.kind === "injection"
            ? {
                kind: "multi-field",
                fields: [
                  { key: "amount", label: "注入金额 (USDT)", inputKind: "number", min: 0.01, step: 0.01, required: true, explain: "实际到账的 USDT 金额，最多两位小数。" },
                  {
                    key: "voucherType",
                    label: "凭证类型",
                    inputKind: "select",
                    options: ["CHAIN", "BANK"],
                    optionLabels: { CHAIN: "链上交易哈希", BANK: "银行流水号" },
                    required: true,
                  },
                  { key: "voucher", label: "凭证编号 / 哈希", inputKind: "text", required: true, wide: true, placeholder: "填到账凭证上的原始编号", explain: "提交时会在前面加上凭证类型（CHAIN: 或 BANK:）。同一个凭证只能登记一次。系统只检查格式，不会去链上或银行核实。" },
                ],
              }
            : undefined
      }
      getPendingReason={() => { const saved = b1Commands.list().find(record => record.commandKey === (mc.original?.commandKey ?? mc.requestKey ?? mc.idempotencyKey)); return saved ? (JSON.parse(saved.body) as { reason: string }).reason : mc.kind === "threshold" && session ? pendingThresholdConfigApproval("B1", session.adminId)?.reason : undefined; }}
      getPendingBusinessValue={() => b1Commands.list().find(record => record.commandKey === (mc.original?.commandKey ?? mc.requestKey ?? mc.idempotencyKey))?.form ?? (mc.kind === "threshold" && pendingApproval ? { redlinePct: String(pendingApproval.values.redlinePct), healthyPct: String(pendingApproval.values.healthyPct) } : mc.draft)}
      reasonMin={8}
      reasonMax={200}
      onClose={() => setActionConfirm(null)}
      onConfirm={onMcConfirm}
    />
  );

  const releaseDialog = releasing && pendingApproval && (
    <ReleaseModal onCancel={() => setReleasing(false)} onConfirm={releaseApproval}
      label={`降低红线的审批 · 红线 ${fmtConfigPct(pendingApproval.values.redlinePct)} · 健康线 ${fmtConfigPct(pendingApproval.values.healthyPct)} · ${timeText(new Date(pendingApproval.createdAt).toISOString())}提交`}
      explain="原申请已超过 24 小时，按原请求查询明确没有这张审批单，说明申请没有建成，之后也不会再建成。解除后可以重新调整红线。" />
  );

  if ((bDomain.loading && !bDomain.hasData) || bDomain.error || !bDomain.hasData) {
    const loading = bDomain.loading && !bDomain.error;
    return (
      <RdPage className="b1-page">
        {header()}
        {savedWhileUnread && !loading && <Notice tone="ok" title={savedWhileUnread}>现在的数据没读到，读到后才能再改。</Notice>}
        <Conclusion state="unknown" icon={ShieldQuestion}>{loading ? "资金状态：正在读取" : "资金状态：暂时无法判断"}</Conclusion>
        {loading
          ? <BlockState state="loading" title="正在读取储备、应付款和覆盖率…" />
          : <BlockState state="error" title="资金数据读取失败，不显示旧数据" detail={bDomain.error ? displayAdminReadError(bDomain.error) : undefined} onRetry={refreshB1} retryLabel="重新读取" />}
        <PendingCommands items={pendingItems} auditReachable={!!reach("/platform/audit")} />
        {dialog}
        {releaseDialog}
        {toastNode}
      </RdPage>
    );
  }

  if (b1DataError) {
    return (
      <RdPage className="b1-page">
        {header(`数据时间 ${timeText(generatedAt)}`)}
        {warningNotice}
        <Conclusion state="unknown" icon={ShieldQuestion}>资金状态：暂时无法判断</Conclusion>
        <BlockState state="error"
          title={b1DataError === "B1_LEDGER_ACCOUNTS_EMPTY" ? "应付款明细是空的，暂时算不出构成" : b1DataError}
          detail={b1DataError === "B1_LEDGER_ACCOUNTS_EMPTY" ? "系统没有返回九类应付款。重读一次；仍是空的请联系值班人员核对账本（B1_LEDGER_ACCOUNTS_EMPTY）。" : "覆盖率走势少于 2 个点。重读一次；仍不足请联系值班人员。"}
          onRetry={refreshB1} retryLabel="重新读取" />
        <PendingCommands items={pendingItems} auditReachable={!!reach("/platform/audit")} />
        {dialog}
        {releaseDialog}
        {toastNode}
      </RdPage>
    );
  }
  return (
    <RdPage className="b1-page">
      {header(<>数据时间 {timeText(generatedAt)} · 打开页面和写入后读取<Explain label="数据时间说明" content="上面的储备、应付款、覆盖率和告警是同一次读取。差额走势是另一次读取，时间写在那一块里；写入后两块都会重读。" /></>, headerActions, readOnly)}
      {warningNotice}
      <PendingCommands items={pendingItems} auditReachable={!!reach("/platform/audit")} />
      {conclusion}
      {stats}
      <div className="rd-split" data-even="">
        {coveragePanel}
        {flowPanel}
      </div>
      {compositionPanel}
      {exposurePanel}
      {dialog}
      {releaseDialog}
      {toastNode}
    </RdPage>
  );
}
