"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TabGroup } from "@/app/components/kit/tab-group";
import { displayAdminError } from "@/lib/admin/error-messages";
import { adminAuthLifecycleEpoch, AdminAuthEpochChangedError } from "@/lib/admin/auth-lifecycle";
import { d1VietQrUsdtAmount } from "@/lib/admin/d1-vietqr-amount";
import { formatD1FuseReason, requiresReprovision } from "@/lib/admin/d1-account-display";
import { CregisStatus } from "./cregis-status";
import { D1BankOrders, orderStatusText } from "./d1-bank-orders";
import { D1OrderPayments } from "./d1-order-payments";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  createD1VietQrAccount,
  createD1BinLock,
  fetchD1TopupFlows,
  fetchD1TopupOverview,
  listD1PendingTopupCommands,
  isDOutcomeUnknownError,
  loadD1VietQrOverview,
  manualCreditD1BankOrder,
  registerD1VietQrReceipt,
  reconcileD1VietQr,
  refundD1Chargeback,
  retryD1PendingTopupCommand,
  retryD1PendingBankOrderCommand,
  setD1BinLock,
  switchD1Psp,
  updateD1CardRisk,
  updateD1TopupChannelEnabled,
  updateD1TopupChannelFee,
  updateD1TopupChannelMax,
  updateD1TopupChannelMin,
  updateD1VietQrAccount,
  updateD1VietQrConfig,
  writeoffD1Reconciliation,
  type D1DepositFlow,
  type D1BankOrder,
  type D1Overview,
  type D1PendingTopupCommand,
  type D1VietQrOverview,
  type D1VietQrRow,
  type D1VietQrView,
  type PageResult,
} from "@/lib/admin/d-client";
import type { DCtx } from "./types";

// 人工银行转账和国际卡刷卡暂不使用，PC 先隐藏（2026-10-31）。代码和后端保留，改为 true 即恢复。
// 注意：HDPay 充值走 vietqr 渠道开关，这一行不能隐藏。
const LEGACY_CHANNELS_VISIBLE = false;

const depositChannelText = (value: string) => ({vietqr:LEGACY_CHANNELS_VISIBLE ? "银行转账（VietQR）" : "银行卡支付",bank:"银行转账",card:"国际卡刷卡",trc20:"USDT（TRC20）",bep20:"USDT（BEP20）",erc20:"USDT（ERC20）",hdpay:"银行卡支付",cregis:"USDT 链上充值"} as Record<string,string>)[value.toLowerCase()] ?? value;
const EMPTY_D1_FLOWS: PageResult<D1DepositFlow> = { total: 0, pageNum: 1, pageSize: 10, records: [] };
const FLOW_TABS = [
  ["", "全部"],
  ["pending", "处理中"],
  ["confirmed", "已入账"],
  ["abnormal", "异常"],
] as const;
const BANK_VIEW_META: Record<D1VietQrView, { label: string; description: string; next: string }> = {
  inflight: {
    label: "待付款单",
    description: "用户已生成付款单，银行回单尚未登记。",
    next: "收到银行回单后，从对应付款单右侧登记，可自动带入附言、应收金额和付款单分配账户。",
  },
  matched: {
    label: "已匹配回单",
    description: "银行回单已与付款单对上；HDPay 已入账的记录也在这里，只能查看。",
    next: "待处理的回单可以复核入账；HDPay 记录只用于查询。",
  },
  orphan: {
    label: "未找到付款单",
    description: "银行回单找不到对应付款单，当前不会给任何用户入账。",
    next: "核对附言后匹配到真实付款单；确实无法认领则登记退回。",
  },
  mismatch: {
    label: "信息不一致",
    description: "已找到付款单，但收款账户或金额与付款单不一致。",
    next: "只有金额不一致才可按实收核销；收款账户不一致的回单不能按实收核销，应核对凭证并登记退回。",
  },
  late: {
    label: "逾期 / 重复回单",
    description: "银行到账晚于付款宽限期，或同一付款单已存在另一张回单。",
    next: "为防重复入账，此类回单不能入账，只能登记退回。",
  },
};

const BANK_VIEW_TABS: Array<[D1VietQrView, string]> = (Object.keys(BANK_VIEW_META) as D1VietQrView[])
  .map((key) => [key, BANK_VIEW_META[key].label]);

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

function vietnamLocalDateTimeNow() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19);
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

const D1_ENTERED_STATUS_LABELS: Record<string, string> = {
  "已入账": "已入账",
  "未找到入账分录": "未找到入账分录",
  CREDITED: "已入账",
  SUCCESS: "已入账",
};

function d1EnteredStatusText(status: string) {
  return D1_ENTERED_STATUS_LABELS[status] ?? "入账状态未知";
}

export function D1Recon({ ctx }: { ctx: DCtx }) {
  return <><D1OrderPayments ctx={ctx} /><D1RechargeRecon ctx={ctx} /></>;
}

function D1RechargeRecon({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
  const canReadCregis = isSuper || authorities.includes("finance_d1_read");
  const operator = session?.operator || session?.username || "";
  const canManageChannels = isSuper || authorities.includes("finance_d1_channel_manage");
  const canSwitchPsp = isSuper || authorities.includes("finance_d1_psp_switch");
  const canManageConfig = isSuper || authorities.includes("finance_d1_config_manage");
  const canReconcile = isSuper || authorities.includes("finance_d1_reconcile");
  const canCreateBinLock = isSuper || authorities.includes("finance_d1_bin_manual_lock");
  const canLockBin = isSuper || authorities.includes("finance_d1_bin_lock");
  const canUnlockBin = isSuper || authorities.includes("finance_d1_bin_unlock");
  const canRecoverChargeback = isSuper || authorities.includes("finance_d1_chargeback_refund");
  const canBankReconcile = isSuper || authorities.includes("finance_d1_bank_reconcile");
  const canManageBankAccounts = isSuper || authorities.includes("finance_d1_bank_account_manage");
  const canManageBankConfig = isSuper || authorities.includes("finance_d1_bank_config_manage");
  const [overview, setOverview] = useState<D1Overview | null>(null);
  const [vietQr, setVietQr] = useState<D1VietQrOverview | null>(null);
  const [bankView, setBankView] = useState<D1VietQrView>("inflight");
  const [reconciliationType, setReconciliationType] = useState<"bank" | "cregis">("bank");
  const [bankPage, setBankPage] = useState(1);
  const [bankPageSize, setBankPageSize] = useState(20);
  const [flows, setFlows] = useState<PageResult<D1DepositFlow>>(EMPTY_D1_FLOWS);
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [manualBin, setManualBin] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingCommands, setPendingCommands] = useState<D1PendingTopupCommand[]>([]);

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
        loadD1VietQrOverview(bankView, bankPage, bankPageSize),
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
  }, [status, page, pageSize, bankView, bankPage, bankPageSize]);

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
        const detail = err instanceof Error ? displayAdminError(err) : "银行转账渠道操作失败";
        setError(isDOutcomeUnknownError(err)
          ? `操作结果暂未确认，请先刷新核对；需要重试时请在下方「待核对的请求」里重试 · ${detail}`
          : `操作没有成功，未入账，可以按提示修改后重试 · ${detail}`);
        throw err;
      }
      checkAuth();
      try {
        let next = await loadD1VietQrOverview(bankView, bankPage, bankPageSize, bankManualAuthEpoch);
        checkAuth();
        if (next.page.items.length === 0 && bankPage > 1 && next.page.total > 0) {
          const fallbackPage = Math.max(1, Math.ceil(next.page.total / bankPageSize));
          next = await loadD1VietQrOverview(bankView, fallbackPage, bankPageSize, bankManualAuthEpoch);
          checkAuth();
          setBankPage(fallbackPage);
        }
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

  const openReceiptRegistration = (source?: Pick<D1VietQrRow, "intentNo" | "memoCode" | "payableVnd" | "bankAccountId">) => {
    if (!vietQr) return;
    const accounts = [...vietQr.accounts].sort((left, right) => {
      const rank = (status: D1VietQrOverview["accounts"][number]["status"]) => status === "ACTIVE" ? 0 : status === "FUSED" ? 1 : 2;
      return rank(left.status) - rank(right.status) || left.id - right.id;
    });
    const selectedAccount = source?.bankAccountId ? String(source.bankAccountId) : "";
    const statusLabel: Record<D1VietQrOverview["accounts"][number]["status"], string> = {
      ACTIVE: "启用",
      FUSED: "已暂停（只能核对历史回单）",
      DISABLED: "已停用（只能核对历史回单）",
    };
    openActionConfirm({
      action: source ? `登记这笔付款的银行回单 · ${source.intentNo}` : "登记银行回单",
      detail: source
        ? `已自动带入附言、应收金额和收款账户，请逐项对照银行回单核对。交易参考号要照抄回单，不是付款单号。`
        : "请逐项照抄银行回单，交易参考号不是付款单号。找不到付款单的到账也可以登记，会归到「未找到付款单」等待认领。",
      businessForm: {
        kind: "multi-field",
        title: "银行回单信息",
        hint: "交易参考号填回单上的 Transaction ID / Reference No. / FT 号，不能重复。实际收款账户和付款单分配的账户不一致时不会入账。",
        fields: [
          {
            key: "bankAccountId", label: "实际收款账户", inputKind: "select", required: true,
            current: selectedAccount,
            options: ["", ...accounts.map((account) => String(account.id))],
            optionLabels: Object.fromEntries([
              ["", "请选择银行回单上显示的实际收款账户"],
              ...accounts.map((account) => [
                String(account.id),
                `${account.bankName} · 尾号 ${account.accountLast4} · ${statusLabel[account.status]}${source?.bankAccountId === account.id ? " · 付款单分配账户" : ""}`,
              ]),
            ]),
            help: "必须和银行回单上的收款账户一致，不要直接用默认值。",
          },
          {
            key: "paymentReference", label: "银行交易参考号", inputKind: "text", required: true,
            placeholder: "例如银行回单上的 Transaction ID / Reference No. / FT 号",
            minLength: 6, maxLength: 128,
            pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
            patternMessage: "银行交易参考号只能包含字母、数字及 . _ : / -",
            help: "用来防止重复入账；不要填付款单号、附言码或随手编的数字。",
          },
          {
            key: "memoCode", label: "UVEL 转账附言码", inputKind: "text", required: false,
            current: source?.memoCode ?? "", placeholder: "例如 NX-1234ABCD",
            maxLength: 32, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
            patternMessage: "转账附言码只能包含字母、数字、下划线和连字符",
            help: "没有附言或看不清时可留空，回单会归到「未找到付款单」。",
          },
          {
            key: "receivedVnd", label: "银行实收金额（VND）", inputKind: "number", required: true,
            current: source?.payableVnd ? String(source.payableVnd) : "", min: 1, max: 10_000_000_000, step: 1,
          },
          {
            key: "receivedAt", label: "越南银行到账时间（UTC+7）", inputKind: "text", required: true,
            current: vietnamLocalDateTimeNow(), help: "填回单上的到账时间，不是现在的时间。",
          },
          {
            key: "evidenceAssetId", label: "银行回单图片（选填）", inputKind: "asset-upload", required: false, wide: true,
            uploadPurpose: "vietqr-receipt",
            accept: "image/jpeg,image/png",
            help: "可以不上传直接登记；上传支持 JPG、PNG，最大 10 MB。",
          },
        ],
      },
      run: (reason, _value, business) => {
        const bankAccountId = Number(business?.bankAccountId);
        const receivedVnd = Number(business?.receivedVnd);
        const paymentReference = business?.paymentReference?.trim() ?? "";
        const evidenceAssetId = business?.evidenceAssetId?.trim() ?? "";
        if (!Number.isSafeInteger(bankAccountId) || bankAccountId <= 0) throw new Error("请选择银行回单上的实际收款账户");
        if (!Number.isSafeInteger(receivedVnd) || receivedVnd <= 0) throw new Error("实收金额必须是正整数 VND");
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/.test(paymentReference)) throw new Error("请照抄银行回单上的交易参考号（6–128 位）");
        return applyBankWrite(() => registerD1VietQrReceipt({
          bankAccountId,
          paymentReference,
          memoCode: business?.memoCode?.trim() || undefined,
          receivedVnd,
          receivedAt: vietQrReceivedAtInstant(business?.receivedAt ?? ""),
          evidenceRef: evidenceAssetId ? `media:${evidenceAssetId}` : undefined,
          reason,
          operator,
        }), "银行回单已登记并自动分类");
      },
    });
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

  const updateChannelNumber = (channel: D1Overview["channels"][number], kind: "fee" | "min" | "max") => {
    const current = kind === "fee"
      ? channel.feeValue
      : kind === "min"
        ? channel.minAmountValue
        : channel.maxAmountValue;
    if (current === null) {
      toast("这个渠道没有单独的单笔上限；银行转账的上限在下方「银行转账渠道参数」调整");
      return;
    }
    const unitLabel = kind === "fee" ? (channel.feeUnit === "PERCENT" ? "%" : "USDT 固定手续费") : "USD";
    openActionConfirm({
      action: kind === "fee"
        ? `充值费率调整 · ${depositChannelText(channel.code) ?? channel.id}`
        : kind === "min"
          ? `最小充值额调整 · ${depositChannelText(channel.code) ?? channel.id}`
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
            : kind === "min"
              ? updateD1TopupChannelMin(channel.code, numericValue, current, reason, operator)
              : updateD1TopupChannelMax(channel.code, numericValue, current, reason, operator),
          `${depositChannelText(channel.code) ?? channel.id} 已更新`,
        );
      },
    });
  };

  const bankConfigPayload = (
    patch: Partial<Pick<D1VietQrOverview["config"], "toleranceVnd" | "graceMinutes" | "perTxLimitUsd" | "trc20Confirmations" | "erc20Confirmations" | "bep20Confirmations" | "rotationStrategy">>,
  ) => {
    if (!vietQr) throw new Error("银行转账设置还没加载完，请稍后");
    return {
      toleranceVnd: patch.toleranceVnd ?? vietQr.config.toleranceVnd,
      graceMinutes: patch.graceMinutes ?? vietQr.config.graceMinutes,
      perTxLimitUsd: patch.perTxLimitUsd ?? vietQr.config.perTxLimitUsd,
      trc20Confirmations: patch.trc20Confirmations ?? vietQr.config.trc20Confirmations,
      erc20Confirmations: patch.erc20Confirmations ?? vietQr.config.erc20Confirmations,
      bep20Confirmations: patch.bep20Confirmations ?? vietQr.config.bep20Confirmations,
      rotationStrategy: patch.rotationStrategy ?? vietQr.config.rotationStrategy,
      version: vietQr.config.version,
    };
  };

  const editBankNumber = (
    key: "toleranceVnd" | "graceMinutes" | "perTxLimitUsd" | "trc20Confirmations" | "erc20Confirmations" | "bep20Confirmations",
    label: string,
    unit: string,
    min: number,
    max: number,
  ) => {
    if (!vietQr) return;
    const current = vietQr.config[key];
    openActionConfirm({
      action: `调整银行转账参数 · ${label}`,
      detail: `${label}当前为 ${current} ${unit}，可设 ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}。只对之后的新回单和新付款单生效。`,
      edit: { kind: "number", current: String(current), unit, min, max, step: 1 },
      run: (reason, value) => {
        const next = Number(value);
        if (!Number.isInteger(next) || next < min || next > max) throw new Error(`${label}须为范围内的整数`);
        return applyBankWrite(
          () => updateD1VietQrConfig(bankConfigPayload({ [key]: next }), reason, operator),
          `${label}已更新`,
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
  const bankOrders = <D1BankOrders canManage={canBankReconcile} busy={busy} hdpayOnly={!LEGACY_CHANNELS_VISIBLE}
    canRegisterReceipt={!!vietQr?.accounts.length} refreshKey={vietQr?.asOf ?? ""}
    onRegister={(order) => openReceiptRegistration(order)} onManualCredit={openBankManualCredit}
    onRetry={(commandKey) => applyBankWrite(() => retryD1PendingBankOrderCommand(commandKey), "人工入账已重试，请核对订单和用户钱包", adminAuthLifecycleEpoch())} />;

  const hdpayOrders = !LEGACY_CHANNELS_VISIBLE && <section className="l-card" id="d1-hdpay-orders">{bankOrders}</section>;

  if (loading && !overview) {
    return <>{hdpayOrders}{canReadCregis && <CregisStatus canManage={canManageChannels} openActionConfirm={openActionConfirm} />}<section className="l-card"><div className="l-b">正在加载…</div></section></>;
  }

  if (error && !overview) {
    return <>{hdpayOrders}{pendingCommandPanel}{canReadCregis && <CregisStatus canManage={canManageChannels} openActionConfirm={openActionConfirm} />}<section className="l-card"><div className="l-b"><div className="dtint warn">充值对账已停止展示旧数据 · {error}</div><button className="l-btn primary" disabled={loading || busy} style={{ marginTop: 12 }} onClick={() => void refresh()}>重试</button></div></section></>;
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
        {LEGACY_CHANNELS_VISIBLE && <><div className="f-stat cyan"><div className="k">卡费缓冲</div><div className="v">{money(overview?.feeBufferUsd ?? 0)}</div><div className="sub">{overview?.feeBufferComplete ? "用来抵扣刷卡手续费" : "只含已核对部分，历史还没核对完"}</div></div>
        <div className="f-stat danger"><div className="k">卡段 / IP / 设备锁定</div><div className="v">{overview?.binLockedCount ?? 0}</div><div className="sub">到期自动解锁</div></div></>}
      </div>

      <div className={LEGACY_CHANNELS_VISIBLE ? "two-col r11" : undefined}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">充值渠道</span>
            <span className="sub">· 链上收款详情见下方「USDT 资金状态」</span>
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
              <button className="l-btn sm" onClick={() => {
                setReconciliationType("cregis");
                document.getElementById("d1-collection-reconcile")?.scrollIntoView({ behavior: "smooth" });
              }}>查看实际状态</button>
            </div>
            {(overview?.channels ?? []).filter((channel) => !["trc20", "bep20", "erc20"].includes(channel.code) && (LEGACY_CHANNELS_VISIBLE || ["vietqr", "hdpay"].includes(channel.code))).map((channel) => (
              <div className="p-row" key={channel.code}>
                <div className="txt">
                  <div className="k">{depositChannelText(channel.code) ?? channel.id}</div>
                  <div className="s">
                    费率 {channel.fee} · {["vietqr", "hdpay"].includes(channel.code) ? "最低充值金额见上方「订单付款与手续费」" : `最小充值 ${channel.minAmount}`}
                    {channel.code === "vietqr" && vietQr ? ` · 单笔上限 $${vietQr.config.perTxLimitUsd.toLocaleString("en-US")}` : ""}
                    {channel.maxAmountValue !== null ? ` · 单笔上限 $${channel.maxAmountValue.toLocaleString("en-US")}` : ""}
                  </div>
                </div>
                <span className={`bdg ${channel.enabled ? "ok" : "bad"}`}>{channel.enabled ? "启用" : "停用"}</span>
                {canManageChannels && !["vietqr", "hdpay"].includes(channel.code) && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "min")}>最小额</button>}
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
            {LEGACY_CHANNELS_VISIBLE && <div className="dtint" style={{ marginTop: 12 }}>
              当前主要支付商: <b>{overview?.primaryPsp ?? "—"}</b> · 备用: {overview?.backupPsp ?? "—"}
              {canSwitchPsp && <button className="l-btn sm mc" disabled={loading || busy} style={{ marginLeft: 10 }} onClick={() => openActionConfirm({
                action: "切换主要与备用支付商",
                detail: `切换到 ${overview?.backupPsp ?? "备用支付商"}，之后的新交易走新的主要支付商。`,
                run: (reason) => applyOverview(
                  () => switchD1Psp(overview?.backupPsp ?? "Stripe", overview?.primaryPsp ?? "", reason, operator),
                  "主要与备用支付商已切换",
                ),
              })}>切换主备</button>}
            </div>}
          </div>
        </section>

        {LEGACY_CHANNELS_VISIBLE && <section className="l-card">
          <div className="l-h">
            <span className="ttl">刷卡风控参数</span>
            <span className="sub">· 修改立即生效</span>
          </div>
          <div className="l-b">
            {(overview?.cardParams ?? []).map((param) => (
              <div className="p-row" key={param.key}>
                <div className="txt"><div className="k">{param.name}</div><div className="s">{param.note}</div></div>
                <span className="v">{param.value}</span>
                {canManageConfig && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                  action: `调整刷卡风控 · ${param.name}`,
                  detail: "修改立即生效。",
                  edit: { kind: "number", current: String(param.numericValue), unit: param.unit === "USD" ? "USD" : param.unit === "COUNT" ? "次" : "小时", min: param.minValue, max: param.maxValue, step: param.unit === "USD" ? 0.01 : 1 },
                  run: (reason, value) => {
                    const numericValue = Number(value);
                    if (!Number.isFinite(numericValue)) {
                      toast("请输入有效数字");
                      return;
                    }
                    return applyOverview(() => updateD1CardRisk(param.key, numericValue, param.unit, param.numericValue, reason, operator), `${param.name} 已更新`);
                  },
                })}>调整</button>}
              </div>
            ))}
          </div>
        </section>}
      </div>

      {!LEGACY_CHANNELS_VISIBLE && canReadCregis && <div id="d1-collection-reconcile"><CregisStatus canManage={canManageChannels} openActionConfirm={openActionConfirm} /></div>}
      {LEGACY_CHANNELS_VISIBLE && <section className="l-card" id="d1-collection-reconcile">
        <div className="l-h">
          <span className="ttl">充值收款对账</span>
          <span className="sub">· 银行转账订单、回单处理和链上收款</span>
        </div>
        <div className="l-b" style={{ paddingBottom: 8 }}>
          <TabGroup label="收款类型" value={reconciliationType} items={canReadCregis ? ["bank", "cregis"] : ["bank"]}
            onSelect={setReconciliationType} className="chips" disabled={() => loading || busy}
            itemClassName={(_key, selected) => `chip${selected ? " sel" : ""}`}>
            {(key) => key === "bank" ? "银行转账（VietQR）/ HDPay" : "USDT（BEP20 / ERC20）"}
          </TabGroup>
        </div>
        {reconciliationType === "cregis" && canReadCregis ? (
          <CregisStatus canManage={canManageChannels} openActionConfirm={openActionConfirm} embedded />
        ) : <>
        {bankOrders}
        <div className="l-h">
          <span className="ttl">银行回单处理与已入账记录</span>
          <span className="sub">· 按下单时的汇率折算 · 待核实的款项会计入资金储备</span>
          <div className="r">
            <span className="dcode electric">待核实充值 {money(vietQr?.pendingUnverifiedDepositUsdt ?? 0)}</span>
            {canBankReconcile && <button className="l-btn sm mc" disabled={busy || !vietQr?.accounts.length} onClick={() => openReceiptRegistration()}>登记未归属回单</button>}
          </div>
        </div>
        <div className="l-b" style={{ paddingBottom: 8 }}>
          <div className="dtint" style={{ marginBottom: 12 }}>
            上面是所有银行转账和 HDPay 订单，HDPay 的人工确认在订单行操作；下面按五类处理银行回单，HDPay 已入账记录只用于查询。登记回单时图片可不传。
          </div>
          <TabGroup label="回单分类" value={bankView} items={BANK_VIEW_TABS.map(([key]) => key)}
            onSelect={(key) => { setBankView(key); setBankPage(1); }} className="chips" disabled={() => loading || busy}
            itemClassName={(_key, selected) => `chip${selected ? " sel" : ""}`}>
            {(key) => BANK_VIEW_META[key].label}
          </TabGroup>
          <div className="dtint" style={{ marginTop: 12 }} role="status">
            <b>{BANK_VIEW_META[bankView].label}</b> · {BANK_VIEW_META[bankView].description}
            <div className="sub" style={{ marginTop: 4 }}>下一步：{BANK_VIEW_META[bankView].next}</div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1120 }}>
            <thead><tr><th>类型</th><th>回单 / 银行流水 / 到账时间</th><th>用户 / 意向单</th><th className="num">应付 VND</th><th className="num">实收 VND</th><th className="num">锁定牌价</th><th className="num">折算 USDT</th><th>状态</th><th>说明</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {(vietQr?.page.items ?? []).length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-4)", padding: "26px 12px" }}>当前视图暂无银行转账或 HDPay 记录</td></tr>
              ) : vietQr?.page.items.map((row) => {
                const amount = d1VietQrUsdtAmount(row);
                const canWriteBankRow = canBankReconcile && row.paymentRail === "VIETQR";
                return (
                  <tr key={row.id}>
                    <td><span className="bdg dim">{row.paymentRail === "HDPAY" ? "HDPay" : "银行转账 · VietQR"}</span></td>
                    <td><span className="mono">{row.reconciliationNo}</span><div className="sub mono">{row.paymentReference || "无银行流水号"}</div><div className="sub">{timeText(row.receivedAt)}</div></td>
                    <td><span className="mono">{row.userId ?? "—"}</span><div className="sub">{row.intentNo || "未匹配付款单"}</div><div className="sub mono">{row.memoCode || "无附言"}</div></td>
                    <td className="num mono">{vnd(row.payableVnd)}</td>
                    <td className="num mono">{vnd(row.receivedVnd)}</td>
                    <td className="num mono">{vnd(row.lockedFxRateVndPerUsdt)}</td>
                    <td className="num mono">{amount === null ? "—" : money(amount)}<div className="sub">{amount === null ? "金额未确认" : row.status === "CREDITED" ? "实际入账" : row.viewType === "INFLIGHT" ? "预计折算" : "按实收折算"}</div></td>
                    <td><span className={`bdg ${row.status === "CREDITED" ? "ok" : row.status === "RETURNED" ? "dim" : "warn"}`}>{row.status === "OPEN" ? "待处置" : row.status === "CREDITED" ? "已入账" : row.status === "RETURNED" ? "已退回" : "退回处理中"}</span></td>
                    <td>{row.viewType === "MISMATCH"
                      ? row.mismatchReason === "BANK_ACCOUNT"
                        ? "收款账户与付款单分配账户不一致"
                        : row.mismatchReason === "BANK_ACCOUNT_AND_AMOUNT"
                          ? "收款账户和实收金额都与付款单不一致"
                          : row.mismatchReason === "UNKNOWN"
                            ? "缺少历史账户信息，无法判断，不能核销"
                            : "实收金额与付款单不一致"
                      : row.note || "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canWriteBankRow && row.status === "OPEN" && row.viewType === "INFLIGHT" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openReceiptRegistration(row)}>登记这笔回单</button>
                      )}
                      {canWriteBankRow && row.status === "OPEN" && row.viewType === "ORPHAN" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                          action: `手动匹配入账 · ${row.reconciliationNo}`,
                          detail: `实收 ${vnd(row.receivedVnd)} 按这张回单的锁定汇率入账给对应用户。入账用户由付款单决定，不能手动指定。`,
                          businessForm: { kind: "multi-field", fields: [
                            { key: "intentNo", label: "付款单号", inputKind: "text", required: true },
                            VIETQR_ACTION_EVIDENCE_FIELD,
                          ] },
                          run: (reason, _value, business) => {
                            const intentNo = business?.intentNo?.trim() ?? "";
                            const evidenceRef = vietQrActionEvidenceRef(business?.evidenceAssetId);
                            if (!intentNo) throw new Error("请输入付款单号");
                            return applyBankWrite(() => reconcileD1VietQr(row.id, "match-credit", {
                              expectedVersion: row.version, intentNo, evidenceRef, reason, operator,
                            }), "未找到付款单的回单已匹配入账");
                          },
                        })}>手动匹配入账</button>
                      )}
                      {canWriteBankRow && row.status === "OPEN" && row.viewType === "MATCHED" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                          action: `确认匹配入账 · ${row.reconciliationNo}`,
                          detail: "系统会再核对一次用户、收款账户和汇率，然后入账。已到账的钱不会因账户日收上限被拒。",
                          businessForm: { kind: "multi-field", fields: [
                            VIETQR_ACTION_EVIDENCE_FIELD,
                          ] },
                          run: (reason, _value, business) => applyBankWrite(() => reconcileD1VietQr(row.id, "match-credit", {
                            expectedVersion: row.version, intentNo: row.intentNo,
                            evidenceRef: vietQrActionEvidenceRef(business?.evidenceAssetId), reason, operator,
                          }), "匹配回单已确认入账"),
                        })}>确认入账</button>
                      )}
                      {canWriteBankRow && row.status === "OPEN" && row.viewType === "MISMATCH" && row.mismatchReason === "AMOUNT" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                          action: `按实收核销 · ${row.reconciliationNo}`,
                          detail: `按实际收到的 ${vnd(row.receivedVnd)} 折算入账，而不是付款单上的应付金额。`,
                          businessForm: { kind: "multi-field", fields: [
                            VIETQR_ACTION_EVIDENCE_FIELD,
                          ] },
                          run: (reason, _value, business) => applyBankWrite(() => reconcileD1VietQr(row.id, "write-off", {
                            expectedVersion: row.version, evidenceRef: vietQrActionEvidenceRef(business?.evidenceAssetId), reason, operator,
                          }), "差额回单已按实收核销"),
                        })}>按实收核销</button>
                      )}
                      {canWriteBankRow && row.status === "OPEN" && row.viewType === "MISMATCH" && row.mismatchReason !== "AMOUNT" && (
                        <span className="bdg bad" title={row.mismatchReason === "UNKNOWN"
                          ? "缺少历史付款单或账户信息，无法判断，只能人工核对后登记退回。"
                          : "收款账户不一致，不能按实收核销；请核对回单，确认到账后登记退回。"}>
                          {row.mismatchReason === "UNKNOWN" ? "信息缺失 · 不能核销" : "账户不一致 · 不能核销"}
                        </span>
                      )}
                      {canWriteBankRow && row.status === "OPEN" && ["ORPHAN", "MISMATCH", "LATE"].includes(row.viewType) && (
                        <button className="l-btn sm mc" style={{ marginLeft: 6 }} disabled={busy} onClick={() => openActionConfirm({
                          action: `登记退回 · ${row.reconciliationNo}`,
                          detail: row.viewType === "LATE"
                            ? "逾期或重复的回单不能按原付款单入账，只能登记退回；已处理的回单不能再处理。"
                            : "登记退回后，这笔钱会从储备中扣除；已处理的回单不能再处理。",
                          businessForm: { kind: "multi-field", fields: [
                            { ...VIETQR_ACTION_EVIDENCE_FIELD, label: "银行退款回单图片", help: "上传清晰的 JPG / PNG 银行退款回单图片，最大 10 MB，上传完成后再确认。" },
                          ] },
                          run: (reason, _value, business) => applyBankWrite(() => reconcileD1VietQr(row.id, "return", {
                            expectedVersion: row.version, evidenceRef: vietQrActionEvidenceRef(business?.evidenceAssetId), reason, operator,
                          }), "回单已登记退回"),
                        })}>登记退回</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="sub">共 {(vietQr?.page.total ?? 0).toLocaleString("en-US")} 条 · 第 {bankPage} / {Math.max(1, Math.ceil((vietQr?.page.total ?? 0) / bankPageSize))} 页</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select className="ui-control"
              value={bankPageSize}
              disabled={loading || busy}
              onChange={(event) => { setBankPageSize(Number(event.target.value)); setBankPage(1); }}
              aria-label="VietQR 每页数量"
            >
              {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size} 条/页</option>)}
            </select>
            <button className="l-btn sm" disabled={loading || busy || bankPage <= 1} onClick={() => setBankPage((value) => Math.max(1, value - 1))}>上一页</button>
            <button className="l-btn sm" disabled={loading || busy || bankPage >= Math.max(1, Math.ceil((vietQr?.page.total ?? 0) / bankPageSize))} onClick={() => setBankPage((value) => value + 1)}>下一页</button>
          </div>
        </div>
        </>}
      </section>}

      <div className={LEGACY_CHANNELS_VISIBLE ? "two-col r11" : undefined}>
        {LEGACY_CHANNELS_VISIBLE && <section className="l-card">
          <div className="l-h">
            <span className="ttl">收款账户池</span>
            <span className="sub">· 只显示账号后四位</span>
            {canManageBankAccounts && <div className="r"><button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
              action: "新增 VietQR 收款账户",
              detail: "完整账号会加密保存，之后只显示后四位。",
              businessForm: { kind: "multi-field", fields: [
                { key: "bankCode", label: "银行代码", inputKind: "text", required: true },
                { key: "bankName", label: "银行名称", inputKind: "text", required: true },
                { key: "accountHolder", label: "账户户名", inputKind: "text", required: true },
                { key: "accountNumber", label: "银行账号", inputKind: "text", required: true },
                { key: "dailyCapVnd", label: "日收上限（VND）", inputKind: "text", required: true },
              ] },
              run: (reason, _value, business) => {
                const dailyCapVnd = Number(business?.dailyCapVnd);
                return applyBankWrite(() => createD1VietQrAccount({
                  bankCode: business?.bankCode?.trim() ?? "",
                  bankName: business?.bankName?.trim() ?? "",
                  accountHolder: business?.accountHolder?.trim() ?? "",
                  accountNumber: business?.accountNumber?.trim() ?? "",
                  dailyCapVnd, reason, operator,
                }), "收款账户已新增");
              },
            })}>新增账户</button></div>}
          </div>
          <div className="l-b">
            {(vietQr?.accounts ?? []).length === 0 ? (
              <div className="dtint">还没有收款账户，用户暂时无法用银行转账充值。请财务管理员添加收款账户。</div>
            ) : vietQr?.accounts.map((account) => {
              const fuseReason = formatD1FuseReason(account.fuseReason);
              // 密文解不开的历史账户:状态动作一律无意义(恢复/启用只会把它放回派单池然后
              // 必然失败),唯一出口是重新录入收款信息。故禁用状态按钮并给出重配入口。
              const needsReprovision = requiresReprovision(account.fuseReason);
              return (
              <div className="p-row" key={account.id}>
                <div className="txt"><div className="k">{account.bankName} · 尾号 {account.accountLast4}</div><div className="s">{account.holderMasked} · 今日 {vnd(account.receivedTodayVnd)} / 上限 {vnd(account.dailyCapVnd)}{fuseReason.label ? ` · ${fuseReason.label}` : ""}</div></div>
                <span className={`bdg ${account.status === "ACTIVE" ? "ok" : account.status === "FUSED" ? "bad" : "dim"}`}>{account.status === "ACTIVE" ? "启用" : account.status === "FUSED" ? "已暂停收款" : "停用"}</span>
                {canManageBankAccounts && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                  action: `调整日收上限 · ${account.bankName} 尾号 ${account.accountLast4}`,
                  detail: "只影响之后的新付款单，已收到的款不受影响。",
                  edit: { kind: "number", current: String(account.dailyCapVnd), unit: "VND", min: 1_000_000, max: 10_000_000_000, step: 1 },
                  run: (reason, value) => applyBankWrite(() => updateD1VietQrAccount(account.id, {
                    action: "UPDATE_CAP", dailyCapVnd: Number(value), expectedVersion: account.version, reason, operator,
                  }), "账户日收上限已更新"),
                })}>调上限</button>}
                {canManageBankAccounts && needsReprovision && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                  action: `重新配置收款信息 · ${account.bankName} 尾号 ${account.accountLast4}`,
                  detail: "这个账户保存的账号无法读取，需要重新填写银行代码、名称、户名和完整账号。保存后账户会恢复启用。",
                  businessForm: { kind: "multi-field", fields: [
                    { key: "bankCode", label: "银行代码", inputKind: "text", required: true, current: account.bankCode },
                    { key: "bankName", label: "银行名称", inputKind: "text", required: true, current: account.bankName },
                    { key: "accountHolder", label: "账户户名", inputKind: "text", required: true },
                    { key: "accountNumber", label: "银行账号（完整）", inputKind: "text", required: true },
                  ] },
                  run: (reason, _value, business) => {
                    const bankCode = business?.bankCode?.trim() ?? "";
                    const bankName = business?.bankName?.trim() ?? "";
                    const accountHolder = business?.accountHolder?.trim() ?? "";
                    const accountNumber = business?.accountNumber?.trim() ?? "";
                    if (!bankCode || !bankName || !accountHolder || !accountNumber) {
                      throw new Error("请完整填写银行代码、银行名称、账户户名与银行账号");
                    }
                    return applyBankWrite(() => updateD1VietQrAccount(account.id, {
                      action: "REPROVISION", bankCode, bankName, accountHolder, accountNumber,
                      expectedVersion: account.version, reason, operator,
                    }), "收款账户已重新配置");
                  },
                })}>重新配置收款信息</button>}
                {canManageBankAccounts && <button className="l-btn sm mc" disabled={busy || needsReprovision} title={needsReprovision ? "账号无法读取，请先重新配置收款信息" : undefined} onClick={() => openActionConfirm({
                  action: `${account.status === "ACTIVE" ? "停用" : account.status === "FUSED" ? "恢复" : "启用"}收款账户 · ${account.bankName} 尾号 ${account.accountLast4}`,
                  detail: "已暂停收款的账户需点「恢复」重新启用。",
                  run: (reason) => applyBankWrite(() => updateD1VietQrAccount(account.id, {
                    action: account.status === "ACTIVE" ? "DISABLE" : account.status === "FUSED" ? "RECOVER" : "ENABLE",
                    expectedVersion: account.version, reason, operator,
                  }), "账户状态已更新"),
                })}>{account.status === "ACTIVE" ? "停用" : account.status === "FUSED" ? "恢复" : "启用"}</button>}
              </div>
              );
            })}
          </div>
        </section>}

        <section className="l-card">
          <div className="l-h"><span className="ttl">{LEGACY_CHANNELS_VISIBLE ? "银行转账渠道参数" : "银行卡支付参数"}</span><span className="sub">{LEGACY_CHANNELS_VISIBLE ? "· 只对新付款单和新回单生效" : "· 只对之后的新付款单生效"}</span></div>
          <div className="l-b">
            {vietQr && [
              ["toleranceVnd", "金额容差", vietQr.config.toleranceVnd, "VND", 0, 5_000],
              ["graceMinutes", "回单宽限", vietQr.config.graceMinutes, "分钟", 0, 60],
              ["perTxLimitUsd", LEGACY_CHANNELS_VISIBLE ? "VietQR 单笔上限" : "单笔上限", vietQr.config.perTxLimitUsd, "USD", 100, 10_000],
            ].filter(([key]) => LEGACY_CHANNELS_VISIBLE || key === "perTxLimitUsd").map(([key, label, value, unit, min, max]) => (
              <div className="p-row" key={String(key)}>
                <div className="txt"><div className="k">{label}</div></div>
                <span className="v">{Number(value).toLocaleString("en-US")} {unit}</span>
                {canManageBankConfig && <button className="l-btn sm mc" disabled={busy} onClick={() => editBankNumber(
                  key as "toleranceVnd" | "graceMinutes" | "perTxLimitUsd" | "trc20Confirmations" | "erc20Confirmations" | "bep20Confirmations",
                  String(label), String(unit), Number(min), Number(max),
                )}>调整</button>}
              </div>
            ))}
            {LEGACY_CHANNELS_VISIBLE && vietQr && <div className="p-row">
              <div className="txt"><div className="k">账户轮换策略</div><div className="s">新付款单按这个规则分配收款账户</div></div>
              <span className="v">{vietQr.config.rotationStrategy === "ROUND_ROBIN" ? "轮询均匀派发" : "剩余额度优先"}</span>
              {canManageBankConfig && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                action: "调整收款账户分配规则",
                detail: "只影响之后的新付款单。",
                run: (reason) => applyBankWrite(() => updateD1VietQrConfig(
                  bankConfigPayload({ rotationStrategy: vietQr.config.rotationStrategy === "ROUND_ROBIN" ? "REMAINING_CAPACITY" : "ROUND_ROBIN" }),
                  reason, operator,
                ), "账户轮换策略已更新"),
              })}>切换策略</button>}
            </div>}
          </div>
        </section>
      </div>

      <section className="l-card">
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

      <div className={LEGACY_CHANNELS_VISIBLE ? "two-col r11" : undefined}>
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

        {LEGACY_CHANNELS_VISIBLE && <section className="l-card">
          <div className="l-h">
            <span className="ttl">卡段 / IP / 设备锁定</span>
            <span className="sub">· 按 24 小时内的支付失败次数</span>
          </div>
          <div className="l-b">
            <div className="lookup" style={{ marginBottom: 10, width: 380 }}>
              <label className="sub" htmlFor="d1-manual-lock" style={{ whiteSpace: "nowrap" }}>手动锁定卡段</label>
              <input className="ui-control"
                id="d1-manual-lock"
                value={manualBin}
                disabled={loading || busy || !canCreateBinLock}
                aria-label="手动锁定标识：BIN 卡段(6 至 8 位数字) / IP / 设备指纹"
                onChange={(e) => setManualBin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="输入 6 至 8 位 BIN，如 424242"
              />
              {canCreateBinLock && <button className="l-btn primary" disabled={loading || busy} onClick={() => {
                const segment = manualBin.trim();
                if (!/^\d{6,8}$/.test(segment)) {
                  toast("请输入 6 至 8 位数字 BIN");
                  return;
                }
                openConfirm({
                  action: `锁定卡段 · ${segment}`,
                  detail: "用这个卡段的银行卡将无法支付，到期自动解锁。",
                  reason: true,
                  okLabel: "锁定",
                  run: (reason) => applyOverview(() => createD1BinLock(segment, reason, operator), `${segment} 已锁定`),
                });
              }}>手动锁定</button>}
            </div>
            {(overview?.bins ?? []).map((bin) => {
              const [targetType, ...targetParts] = bin.segment.split(":");
              const targetValue = targetParts.join(":");
              const targetLabel = targetType === "BIN" ? "卡段" : targetType === "IP" ? "IP" : "设备";
              return <div className="cb-row" key={bin.segment}>
                <span className="mono" style={{ fontWeight: 700 }}>{bin.segment}</span>
                <span style={{ flex: 1 }}>{bin.meta} · 24h 失败 {bin.fails24h} 次 · {bin.note}</span>
                <span className={`bdg ${bin.locked ? "bad" : "ok"}`}>{bin.locked ? "锁定" : "放行"}</span>
                {((bin.locked && canUnlockBin) || (!bin.locked && canLockBin)) && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openConfirm({
                  action: `${bin.locked ? "解锁" : "锁定"}${targetLabel} · ${targetValue}`,
                  detail: `${targetLabel}：${targetValue}。`,
                  reason: true,
                  okLabel: bin.locked ? "解锁" : "锁定",
                  run: (reason) => applyOverview(() => setD1BinLock(bin.segment, !bin.locked, reason, operator), `${bin.segment} 已${bin.locked ? "解锁" : "锁定"}`),
                })}>{bin.locked ? "解锁" : "锁定"}</button>}
              </div>;
            })}
          </div>
        </section>}
      </div>

      {LEGACY_CHANNELS_VISIBLE && <section className="l-card">
        <div className="l-h">
          <span className="ttl">拒付追回</span>
          <span className="sub">· 用户刷卡后被银行退款</span>
        </div>
        <div className="dtint warn" style={{ margin: "0 14px 12px" }}>
          拒付追回金额不足时，系统会生成风险提醒；可前往 <Link href="/risk/multi-account">多账户风险排查</Link> 查看关联账户并处理。
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead><tr><th>案件号</th><th>用户编码</th><th className="num">金额</th><th>原因</th><th>入账状态</th><th>追回状态</th><th>创建时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {(overview?.chargebacks ?? []).length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)", padding: "24px 12px" }}>暂无拒付案件</td></tr>
              ) : overview?.chargebacks.map((row) => (
                <tr key={row.caseNo}>
                  <td className="mono">{row.caseNo}</td>
                  <td className="mono"><Link href={`/risk/multi-account?userId=${row.userId}`}>{row.userCode}</Link></td>
                  <td className="num mono">{money(row.amount)}</td>
                  <td>{row.reasonCode}</td>
                  <td><span className="bdg dim">{d1EnteredStatusText(row.enteredStatus)}</span> <Link href={`/finance/ledger?keyword=${encodeURIComponent(row.caseNo)}`}>查看账单</Link></td>
                  <td><span className={`bdg ${statusTone(row.status)}`}>{d1StatusText(row.status)}</span></td>
                  <td className="mono">{timeText(row.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {canRecoverChargeback && !["CHARGEBACK_RECOVERED", "CHARGEBACK_PARTIAL"].includes(row.status) && (
                      <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                        action: `拒付追回 · ${row.caseNo}`,
                        detail: `追回 ${money(row.amount)}：从用户余额中扣回并减少累计充值。余额不够扣时会自动生成风险提醒。`,
                        businessForm: { kind: "multi-field", fields: [
                          { key: "evidenceRef", label: "拒付证据 / 工单凭证", inputKind: "text", placeholder: "如 DISPUTE-PROOF-100", required: true },
                        ] },
                        run: (reason, _value, business) => {
                          const evidenceRef = business?.evidenceRef?.trim() ?? "";
                          return applyOverview(() => refundD1Chargeback(row.caseNo, evidenceRef, reason, operator), `${row.caseNo} 已追回`);
                        },
                      })}>追回</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>}
    </>
  );
}
