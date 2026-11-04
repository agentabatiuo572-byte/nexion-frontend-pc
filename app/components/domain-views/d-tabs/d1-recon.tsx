"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useEffect, useMemo, useState } from "react";
import { TabGroup } from "@/app/components/kit/tab-group";
import { displayAdminError } from "@/lib/admin/error-messages";
import { adminAuthLifecycleEpoch, AdminAuthEpochChangedError } from "@/lib/admin/auth-lifecycle";
import { CregisStatus, type D1CregisActivity } from "./cregis-status";
import { D1BankOrders, orderStatusText } from "./d1-bank-orders";
import { D1OrderPayments, type D1PaymentActivity } from "./d1-order-payments";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  fetchD1TopupFlows,
  fetchD1TopupOverview,
  listD1PendingTopupCommands,
  isDOutcomeUnknownError,
  loadD1VietQrOverview,
  manualCreditD1BankOrder,
  retryD1PendingTopupCommand,
  retryD1PendingBankOrderCommand,
  updateD1TopupChannelEnabled,
  updateD1TopupChannelFee,
  updateD1TopupChannelMax,
  updateD1VietQrConfig,
  writeoffD1Reconciliation,
  type D1DepositFlow,
  type D1BankOrder,
  type D1Overview,
  type D1PendingTopupCommand,
  type D1VietQrOverview,
  type PageResult,
} from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const depositChannelText = (value: string) => ({vietqr:"银行卡支付",bank:"银行转账",card:"国际卡刷卡",trc20:"USDT（TRC20）",bep20:"USDT（BEP20）",erc20:"USDT（ERC20）",hdpay:"银行卡支付",cregis:"USDT 链上充值"} as Record<string,string>)[value.toLowerCase()] ?? value;
const EMPTY_D1_FLOWS: PageResult<D1DepositFlow> = { total: 0, pageNum: 1, pageSize: 10, records: [] };
const FLOW_TABS = [
  ["", "全部"],
  ["pending", "处理中"],
  ["confirmed", "已入账"],
  ["abnormal", "异常"],
] as const;

function money(value: number, digits = 2) {
  return `$${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
}

function timeText(value?: string) {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 19);
}

function statusTone(status: string) {
  const s = status.toUpperCase();
  if (["SUCCESS", "CONFIRMED", "CREDITED", "CHARGEBACK_RECOVERED", "RECOVERED"].includes(s)) return "ok";
  if (["FAILED", "EXPIRED", "REJECTED", "ABNORMAL", "CHARGEBACK_ENTERED", "CHARGEBACK_PARTIAL", "PARTIAL_ANOMALY"].includes(s)) return "bad";
  return "warn";
}

function vietQrReceivedAtInstant(value: string) {
  const normalized = value.trim().replace(" ", "T");
  const parts = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?$/);
  if (!parts) {
    throw new Error("到账时间格式不对，请按 YYYY-MM-DDTHH:mm:ss 填写（默认按越南时间 UTC+7）");
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

function vnd(value: number | null) {
  return value === null ? "—" : `${Number(value).toLocaleString("en-US")}₫`;
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
  return D1_STATUS_LABELS[status.toUpperCase()] ?? "未知状态";
}

export function D1Recon({ ctx }: { ctx: DCtx }) {
  const owner = useAdminAuth(state => state.session?.adminId), epoch = useAdminAuth(state => state.authEpoch);
  if (owner == null) return null;
  return <D1Workspace key={`${owner}:${epoch}`} ctx={ctx} />;
}

function D1Workspace({ ctx }: { ctx: DCtx }) {
  const [section, setSection] = useState<"payments" | "bank" | "usdt" | "ledger">("payments");
  const [paymentActivity, setPaymentActivity] = useState<D1PaymentActivity>({ dirtyChannels: 0, pendingCommands: 0 }), [rechargePending, setRechargePending] = useState(0);
  const [usdtActivity, setUsdtActivity] = useState<D1CregisActivity>({ pendingCommands: 0, needsAttention: false, proposalUnknown: 0, proposalPending: 0 });
  const usdtNeedsAttention = usdtActivity.pendingCommands > 0 || usdtActivity.needsAttention || usdtActivity.proposalUnknown > 0 || usdtActivity.proposalPending > 0;
  return <>
    <TabGroup label="D1 业务分区" value={section} items={["payments", "bank", "usdt", "ledger"] as const} onSelect={setSection} className="chips d1-business-tabs" itemClassName={(_value, selected) => `chip${selected ? " sel" : ""}`}>
      {value => ({ payments: "订单付款", bank: "银行卡充值", usdt: "USDT 充值", ledger: "充值流水与对账" })[value]}
    </TabGroup>
    {(paymentActivity.dirtyChannels > 0 || paymentActivity.pendingCommands > 0 || rechargePending > 0 || usdtNeedsAttention) && <div className="dtint warn d1-workspace-alerts" role="status" aria-label="D1 待处理提醒">
      {(paymentActivity.dirtyChannels > 0 || paymentActivity.pendingCommands > 0) && <div className="p-row"><div className="txt">{paymentActivity.dirtyChannels > 0 && <div>订单付款有 {paymentActivity.dirtyChannels} 个渠道尚未保存。</div>}{paymentActivity.pendingCommands > 0 && <div>订单付款有 {paymentActivity.pendingCommands} 次操作结果待核对，请保留原请求。</div>}</div>{section !== "payments" && <button className="l-btn sm" onClick={() => setSection("payments")}>返回订单付款</button>}</div>}
      {rechargePending > 0 && <div className="p-row"><div className="txt">充值操作有 {rechargePending} 次结果待核对，请保留原请求。</div>{section !== "bank" && <button className="l-btn sm" onClick={() => setSection("bank")}>返回银行卡充值</button>}</div>}
      {usdtNeedsAttention && <div className="p-row"><div className="txt">
        {usdtActivity.pendingCommands > 0 && <div>USDT 充值有 {usdtActivity.pendingCommands} 次操作结果待核对，请保留原请求。</div>}
        {usdtActivity.proposalUnknown > 0 && <div>USDT 共同充值规则有 {usdtActivity.proposalUnknown} 项提案结果待核对。</div>}
        {usdtActivity.proposalPending > 0 && <div>USDT 共同充值规则有 {usdtActivity.proposalPending} 项提案待审批或处理。</div>}
        {(usdtActivity.proposalUnknown > 0 || usdtActivity.proposalPending > 0) && <div className="sub">请在「USDT 充值 → 充值与地址设置」查询原提案。</div>}
        {usdtActivity.needsAttention && <div>USDT 状态读取或操作反馈需要查看。</div>}
      </div>{section !== "usdt" && <button className="l-btn sm" onClick={() => setSection("usdt")}>返回 USDT 充值</button>}</div>}
    </div>}
    <div hidden={section !== "payments"}><D1OrderPayments ctx={ctx} onActivityChange={setPaymentActivity} /></div>
    <div hidden={section === "payments"}><D1RechargeRecon ctx={ctx} section={section} onUsdt={() => setSection("usdt")} onPendingChange={setRechargePending} onUsdtActivity={setUsdtActivity} /></div>
  </>;
}

function D1RechargeRecon({ ctx, section, onUsdt, onPendingChange, onUsdtActivity }: { ctx: DCtx; section: "payments" | "bank" | "usdt" | "ledger"; onUsdt: () => void; onPendingChange: (count: number) => void; onUsdtActivity: (activity: D1CregisActivity) => void }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
  const canReadCregis = isSuper || authorities.includes("finance_d1_read");
  const operator = session?.operator || session?.username || "";
  const canManageChannels = isSuper || authorities.includes("finance_d1_channel_manage");
  const canReconcile = isSuper || authorities.includes("finance_d1_reconcile");
  const canBankReconcile = isSuper || authorities.includes("finance_d1_bank_reconcile");
  const canManageBankConfig = isSuper || authorities.includes("finance_d1_bank_config_manage");
  const [overview, setOverview] = useState<D1Overview | null>(null);
  const [vietQr, setVietQr] = useState<D1VietQrOverview | null>(null);
  const [flows, setFlows] = useState<PageResult<D1DepositFlow>>(EMPTY_D1_FLOWS);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingCommands, setPendingCommands] = useState<D1PendingTopupCommand[]>([]);
  const [bankPending, setBankPending] = useState(0);
  useEffect(() => { onPendingChange(pendingCommands.length + bankPending); }, [onPendingChange, pendingCommands.length, bankPending]);

  const refreshPendingCommands = () => {
    setPendingCommands(listD1PendingTopupCommands());
  };

  const refresh = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    refreshPendingCommands();
    try {
      const [nextOverview, nextFlows, nextVietQr] = await Promise.all([
        fetchD1TopupOverview(),
        fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize }),
        loadD1VietQrOverview("inflight"),
      ]);
      setOverview(nextOverview);
      setFlows(nextFlows);
      setVietQr(nextVietQr);
    } catch (err) {
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setVietQr(null);
      setError(err instanceof Error ? displayAdminError(err) : "加载失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize]);

  const pages = useMemo(() => Math.max(1, Math.ceil(flows.total / flows.pageSize)), [flows.total, flows.pageSize]);

  const applyOverview = async (task: () => Promise<D1Overview>, ok: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await task();
      setOverview(next);
      refreshPendingCommands();
      toast(ok);
      try {
        const nextFlows = await fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize });
        setFlows(nextFlows);
      } catch (flowError) {
        setFlows(EMPTY_D1_FLOWS);
        setNotice(`操作已生效，但充值流水没刷新出来，请点「刷新」 · ${flowError instanceof Error ? flowError.message : "流水加载失败"}`);
      }
    } catch (err) {
      refreshPendingCommands();
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setError(`操作结果未确认，已暂停显示旧数据。请先刷新查看，不要重复提交 · ${err instanceof Error ? err.message : "操作失败"}`);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const applyBankWrite = async (task: () => Promise<unknown>, ok: string, bankManualAuthEpoch?: number) => {
    const checkAuth = () => {
      if (bankManualAuthEpoch !== undefined && bankManualAuthEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
    };
    checkAuth();
    setBusy(true);
    setError("");
    try {
      try {
        await task();
      } catch (err) {
        checkAuth();
        const detail = err instanceof Error ? displayAdminError(err) : "银行卡支付渠道操作失败";
        setError(isDOutcomeUnknownError(err)
          ? `操作结果暂未确认，请先刷新核对；需要重试时请在下方「待核对的请求」里重试 · ${detail}`
          : `操作没有成功，未入账，可以按提示修改后重试 · ${detail}`);
        throw err;
      }
      checkAuth();
      try {
        const next = await loadD1VietQrOverview("inflight", 1, 20, bankManualAuthEpoch);
        checkAuth();
        setVietQr(next);
        toast(ok);
      } catch (readbackError) {
        checkAuth();
        const detail = readbackError instanceof Error ? displayAdminError(readbackError) : "列表加载失败";
        setError(`操作已提交，但列表没刷新出来，请先刷新查看，不要重复提交 · ${detail}`);
        return;
      }
    } finally {
      setBusy(false);
    }
  };

  const openBankManualCredit = (order: D1BankOrder, onSettled: () => void | Promise<void>) => {
    const providerVersion = order.providerVersion;
    if (!canBankReconcile || !order.manualCreditAllowed || order.paymentRail !== "HDPAY"
        || order.creditedUsdt > 0 || providerVersion === null) return;
    const authEpoch = adminAuthLifecycleEpoch();
    openActionConfirm({
      action: `人工确认入账 · ${order.intentNo}`,
      detail: `用户 ${order.userId} · ${orderStatusText(order.status)} → 人工入账。请先核实已实际到账 ${vnd(order.payableVnd)}，确认后按下单时的金额入账 ${order.requestedUsdt} USDT。已入账的订单不会重复入账。`,
      businessForm: { kind: "multi-field", fields: [
        { key: "paymentReference", label: "实际收款交易参考号", inputKind: "text", required: true,
          minLength: 6, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
          help: "照抄银行或支付商收款凭证上的交易参考号，不是付款单号或附言码。" },
        { key: "receivedAt", label: "实际到账时间（越南 UTC+7）", inputKind: "text", required: true,
          current: "", help: "填收款凭证上的到账时间，不是现在的时间。" },
        VIETQR_ACTION_EVIDENCE_FIELD,
      ] },
      run: async (reason, _value, business) => {
        if (authEpoch !== adminAuthLifecycleEpoch()) throw new AdminAuthEpochChangedError();
        const paymentReference = business?.paymentReference?.trim() ?? "";
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/.test(paymentReference)
            || paymentReference === order.intentNo || paymentReference === order.memoCode) throw new Error("请填写收款凭证上的交易参考号");
        const receivedAt = vietQrReceivedAtInstant(business?.receivedAt ?? "");
        const evidenceRef = vietQrActionEvidenceRef(business?.evidenceAssetId);
        try {
          await applyBankWrite(() => manualCreditD1BankOrder(order.intentNo, {
            expectedVersion: order.version, providerVersion,
            receivedVnd: order.payableVnd, paymentReference, receivedAt, evidenceRef, reason, operator,
          }), "人工入账已提交，请核对订单和用户钱包", authEpoch);
        } finally { if (authEpoch === adminAuthLifecycleEpoch()) await onSettled(); }
      },
    });
  };

  const updateChannelNumber = (channel: D1Overview["channels"][number], kind: "fee" | "max") => {
    const current = kind === "fee" ? channel.feeValue : channel.maxAmountValue;
    if (current === null) {
      toast("这个渠道没有单独的单笔上限；银行卡支付的单笔上限在下方「银行卡支付参数」调整");
      return;
    }
    const unitLabel = kind === "fee" ? (channel.feeUnit === "PERCENT" ? "%" : "USDT 固定手续费") : "USD";
    openActionConfirm({
      action: kind === "fee"
        ? `充值费率调整 · ${depositChannelText(channel.code) ?? channel.id}`
        : `单笔上限调整 · ${depositChannelText(channel.code) ?? channel.id}`,
      detail: `单位：${unitLabel}。只影响之后的新交易。`,
      edit: {
        kind: "number",
        current: String(current),
        unit: unitLabel,
        min: kind === "fee" ? 0 : 0.01,
        max: kind === "fee" ? (channel.feeUnit === "PERCENT" ? 10 : 100) : 100000,
        step: 0.01,
      },
      run: (reason, value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          toast("请输入有效数字");
          return;
        }
        return applyOverview(
          () => kind === "fee"
            ? updateD1TopupChannelFee(channel.code, numericValue, channel.feeUnit, current, reason, operator)
            : updateD1TopupChannelMax(channel.code, numericValue, current, reason, operator),
          `${depositChannelText(channel.code) ?? channel.id} 已更新`,
        );
      },
    });
  };

  const editPerTxLimit = () => {
    if (!vietQr) return;
    const current = vietQr.config.perTxLimitUsd;
    openActionConfirm({
      action: "调整银行卡支付参数 · 单笔上限",
      detail: `单笔上限当前为 ${current} USD，可设 100–10,000。只对之后的新付款单生效。`,
      edit: { kind: "number", current: String(current), unit: "USD", min: 100, max: 10_000, step: 1 },
      run: (reason, value) => {
        const next = Number(value);
        if (!Number.isInteger(next) || next < 100 || next > 10_000) throw new Error("单笔上限须为范围内的整数");
        // 后端仍要求整组配置必填，其他字段按读回值原样提交。
        const { toleranceVnd, graceMinutes, trc20Confirmations, erc20Confirmations, bep20Confirmations, rotationStrategy, version } = vietQr.config;
        return applyBankWrite(
          () => updateD1VietQrConfig({ toleranceVnd, graceMinutes, perTxLimitUsd: next, trc20Confirmations, erc20Confirmations, bep20Confirmations, rotationStrategy, version }, reason, operator),
          "单笔上限已更新",
        );
      },
    });
  };

  const retryPendingCommand = async (commandKey: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = await retryD1PendingTopupCommand(commandKey);
      setOverview(next);
      refreshPendingCommands();
      toast(`请求 ${commandKey} 已重试`);
      const nextFlows = await fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize });
      setFlows(nextFlows);
    } catch (err) {
      refreshPendingCommands();
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setError(`重试结果仍未确认，已暂停显示旧数据 · ${err instanceof Error ? err.message : "重试失败"}`);
    } finally {
      setBusy(false);
    }
  };

  const pendingCommandPanel = pendingCommands.length > 0 ? (
    <section className="l-card" data-testid="d1-pending-command-panel">
      <div className="l-h"><span className="ttl">待核对的请求</span></div>
      <div className="l-b">
        <div className="dtint warn">
          以下请求结果暂未确认，可能已经生效。请先刷新核对；确实没成功再点「重试」，不要重新提交新的操作。记录保留 24 小时。
        </div>
        {pendingCommands.map((command) => (
          <div className="p-row" key={command.commandKey}>
            <div className="txt">
              <div className="k">请求号 {command.commandKey}</div>
              <div className="s">{command.path} · {timeText(new Date(command.createdAt).toISOString())}</div>
            </div>
            <button
              className="l-btn sm mc"
              disabled={busy}
              onClick={() => void retryPendingCommand(command.commandKey)}
            >
              重试
            </button>
          </div>
        ))}
      </div>
    </section>
  ) : null;

  // HDPay 订单有独立接口，概览加载中或失败时也照常显示。
  const hdpayOrders = <section hidden={section !== "bank"} className="l-card" id="d1-hdpay-orders"><D1BankOrders canManage={canBankReconcile} busy={busy} onPendingChange={setBankPending}
    refreshKey={vietQr?.asOf ?? ""} onManualCredit={openBankManualCredit}
    onRetry={(commandKey) => applyBankWrite(() => retryD1PendingBankOrderCommand(commandKey), "人工入账已重试，请核对订单和用户钱包", adminAuthLifecycleEpoch())} /></section>;
  const cregisStatus = canReadCregis && <div hidden={section !== "usdt"} id="d1-collection-reconcile"><CregisStatus canManage={canManageChannels} openActionConfirm={openActionConfirm} onActivityChange={onUsdtActivity} /></div>;

  if (loading && !overview) {
    return <>{hdpayOrders}{cregisStatus}<section className="l-card"><div className="l-b">正在加载…</div></section></>;
  }

  if (error && !overview) {
    return <>{hdpayOrders}{pendingCommandPanel}{cregisStatus}<section className="l-card"><div className="l-b"><div className="dtint warn">充值对账已停止展示旧数据 · {error}</div><button className="l-btn primary" disabled={loading || busy} style={{ marginTop: 12 }} onClick={() => void refresh()}>重试</button></div></section></>;
  }

  return (
    <>
      {hdpayOrders}
      {pendingCommandPanel}
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>加载失败 · {error}</div>}
      {notice && <div className="dtint warn" style={{ marginBottom: 12 }}>{notice}</div>}
      {overview && !overview.historicalBackfillComplete && (
        <div className="dtint warn" style={{ marginBottom: 12 }}>
          历史账目还有 {overview.historicalBackfillAnomalyCount} 条没核对完：
          手续费 {overview.feeEvidenceAnomalyCount} 条，储备 {overview.treasuryReserveAnomalyCount} 条。
          下方金额只包含已核对的部分，不是完整的历史总额。请在「操作记录与审批」中查询相关记录并完成核对。
        </div>
      )}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">今日入账金额</div><div className="v">{money(overview?.ledgerTotal ?? 0)}</div><div className="sub">共 {overview?.ledgerCount ?? 0} 笔</div></div>
        <div className="f-stat warn"><div className="k">对账差异</div><div className="v">{overview?.diffCount ?? 0} 项</div><div className="sub">差异金额 {money(overview?.diffAmount ?? 0)}</div></div>
      </div>

      <div hidden={section !== "bank"}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">充值渠道</span>
            <span className="sub">· 链上收款详情见「USDT 充值」</span>
            <div className="r">
              <button className="l-btn sm" disabled={loading || busy} onClick={() => void refresh()}>刷新</button>
            </div>
          </div>
          <div className="l-b">
            <div className="p-row">
              <div className="txt">
                <div className="k">USDT 链上充值（BEP20 / ERC20）</div>
                <div className="s">收款地址分配、入账和异常处理由 Cregis 开关控制。</div>
              </div>
              <button className="l-btn sm" onClick={onUsdt}>查看实际状态</button>
            </div>
            {(overview?.channels ?? []).filter((channel) => ["vietqr", "hdpay"].includes(channel.code)).map((channel) => (
              <div className="p-row" key={channel.code}>
                <div className="txt">
                  <div className="k">{depositChannelText(channel.code) ?? channel.id}</div>
                  <div className="s">
                    费率 {channel.fee} · 最低充值金额见「订单付款」
                    {channel.code === "vietqr" && vietQr ? ` · 单笔上限 $${vietQr.config.perTxLimitUsd.toLocaleString("en-US")}` : ""}
                    {channel.maxAmountValue !== null ? ` · 单笔上限 $${channel.maxAmountValue.toLocaleString("en-US")}` : ""}
                  </div>
                </div>
                <span className={`bdg ${channel.enabled ? "ok" : "bad"}`}>{channel.enabled ? "启用" : "停用"}</span>
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "fee")}>费率</button>}
                {canManageChannels && channel.maxAmountValue !== null && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "max")}>单笔上限</button>}
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                  action: `${channel.enabled ? "停用" : "启用"}充值渠道 · ${depositChannelText(channel.code) ?? channel.id}`,
                  detail: "只影响之后的新交易。",
                  run: (reason) => applyOverview(
                    () => updateD1TopupChannelEnabled(channel.code, !channel.enabled, channel.enabled, reason, operator),
                    `${depositChannelText(channel.code) ?? channel.id} 已${channel.enabled ? "停用" : "启用"}`,
                  ),
                })}>{channel.enabled ? "停用" : "启用"}</button>}
              </div>
            ))}
          </div>
        </section>

      </div>

      {cregisStatus}

      <div hidden={section !== "bank"}>

        <section className="l-card">
          <div className="l-h"><span className="ttl">银行卡支付参数</span><span className="sub">· 只对之后的新付款单生效</span></div>
          <div className="l-b">
            {vietQr && <div className="p-row">
              <div className="txt"><div className="k">单笔上限</div></div>
              <span className="v">{vietQr.config.perTxLimitUsd.toLocaleString("en-US")} USD</span>
              {canManageBankConfig && <button className="l-btn sm mc" disabled={busy} onClick={editPerTxLimit}>调整</button>}
            </div>}
          </div>
        </section>
      </div>

      <section hidden={section !== "ledger"} className="l-card">
        <div className="l-h">
          <span className="ttl">充值流水</span>
          <span className="sub">· 可按状态和关键字查询</span>
          <div className="r">
            <TabGroup label="充值流水状态" value={status} items={FLOW_TABS.map(([key]) => key)}
              onSelect={(key) => { setStatus(key); setPage(1); }} className="chips" disabled={() => loading || busy}
              itemClassName={(_key, selected) => `chip${selected ? " sel" : ""}`}>
              {(key) => FLOW_TABS.find(([value]) => value === key)?.[1]}
            </TabGroup>
            <div className="lookup" style={{ width: 380 }}>
              <label className="sub" htmlFor="d1-flow-keyword" style={{ whiteSpace: "nowrap" }}>查询关键字</label>
              <input className="ui-control"
                id="d1-flow-keyword"
                value={keyword}
                aria-label="充值流水查询关键字：充值单号 / 用户编号 / 交易号"
                placeholder="充值单号 / 用户编号 / 交易号"
                onChange={(e) => setKeyword(e.target.value)}
              />
              <button className="l-btn primary" disabled={loading || busy} onClick={() => { if (page === 1) void refresh(); else setPage(1); }}>查询</button>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead><tr><th>充值单</th><th>用户</th><th>通道</th><th className="num">金额</th><th className="num">支付商实收</th><th>状态</th><th>交易号</th><th>提交时间</th><th>确认时间</th><th>入账时间</th></tr></thead>
            <tbody>
              {flows.records.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-4)", padding: "26px 12px" }}>暂无充值流水</td></tr>
              ) : flows.records.map((flow) => (
                <tr key={flow.depositNo}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{flow.depositNo}</td>
                  <td className="mono">{flow.userId}</td>
                  <td>{depositChannelText(flow.channel)} / {nexGridBrandText(flow.asset)}</td>
                  <td className="num mono">{money(flow.amount)}</td>
                  <td className="num mono">{money(flow.providerReceived)}</td>
                  <td><span className={`bdg ${statusTone(flow.status)}`}>{d1StatusText(flow.status)}</span></td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{flow.proof}</td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{timeText(flow.createdAt)}</td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{flow.confirmedAt ? timeText(flow.confirmedAt) : "尚未确认"}</td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{flow.creditedAt ? timeText(flow.creditedAt) : "尚未入账"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="sub">共 {flows.total} 条 · 第 {flows.pageNum}/{pages} 页</span>
          <div className="chips">
            <TabGroup label="充值流水每页条数" value={pageSize} items={[10, 20, 50]}
              onSelect={(size) => { setPageSize(size); setPage(1); }} className="chips" disabled={() => loading || busy}
              itemClassName={(_size, selected) => `chip${selected ? " sel" : ""}`}>
              {(size) => `${size}/页`}
            </TabGroup>
            <button className="chip" disabled={loading || busy || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
            <button className="chip" disabled={loading || busy || page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</button>
          </div>
        </div>
      </section>

      <div hidden={section !== "ledger"}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">对账差异</span>
            <span className="sub">· 支付商记录和平台账目对比</span>
          </div>
          <div className="l-b">
            {(overview?.reconciliation ?? []).length === 0 ? (
              <div className="dtint">今天还没有支付商流水或入账记录。有数据后会自动对比；没有数据不代表已经对上。</div>
            ) : (overview?.reconciliation ?? []).map((row) => (
              <div className="cb-row" key={row.channel}>
                <span className="mono" style={{ fontWeight: 700 }}>{depositChannelText(row.channel)}</span>
                <span style={{ flex: 1 }}>支付商 {row.providerCount} 笔 / {money(row.providerAmount)} · 平台 {row.ledgerCount} 笔 / {money(row.ledgerAmount)}</span>
                <span className={`bdg ${row.reconciled || !row.diff ? "ok" : "warn"}`}>{row.reconciled ? "已核销" : row.diff || "金额与笔数一致"}</span>
                {canReconcile && !row.reconciled && Boolean(row.diff) && (
                  <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                    action: `核销对账差异 · ${depositChannelText(row.channel)}`,
                    detail: `差异金额 ${money(row.diffAmount)}。只能标记为异常并挂账，须填写支付商账单或工单号。`,
                    businessForm: { kind: "multi-field", fields: [
                      { key: "method", label: "处理方式", inputKind: "select", current: "CONFIRM_EXCEPTION", options: ["CONFIRM_EXCEPTION"], optionLabels: { CONFIRM_EXCEPTION: "确认异常并挂账" } },
                      { key: "evidenceRef", label: "支付商账单号或工单号", inputKind: "text", placeholder: "如 PSP-STMT-20260720-001", required: true },
                    ] },
                    run: (reason, _value, business) => {
                      const evidenceRef = business?.evidenceRef?.trim() ?? "";
                      return applyOverview(() => writeoffD1Reconciliation(row.channel, "CONFIRM_EXCEPTION", evidenceRef, reason, operator), `${depositChannelText(row.channel)} 差异已核销`);
                    },
                  })}>核销</button>
                )}
              </div>
            ))}
          </div>
        </section>

      </div>

    </>
  );
}
