"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  createD1VietQrAccount,
  createD1BinLock,
  fetchD1TopupFlows,
  fetchD1TopupOverview,
  listD1PendingTopupCommands,
  loadD1VietQrOverview,
  registerD1VietQrReceipt,
  reconcileD1VietQr,
  refundD1Chargeback,
  retryD1PendingTopupCommand,
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
  type D1Overview,
  type D1PendingTopupCommand,
  type D1VietQrOverview,
  type D1VietQrView,
  type PageResult,
} from "@/lib/admin/d-client";
import type { DCtx } from "./types";

const EMPTY_D1_FLOWS: PageResult<D1DepositFlow> = { total: 0, pageNum: 1, pageSize: 10, records: [] };
const FLOW_TABS = [
  ["", "全部"],
  ["pending", "处理中"],
  ["confirmed", "已入账"],
  ["abnormal", "异常"],
] as const;
const BANK_VIEW_TABS: Array<[D1VietQrView, string]> = [
  ["inflight", "在途意向单"],
  ["matched", "已匹配"],
  ["orphan", "孤儿队列"],
  ["mismatch", "差额队列"],
  ["late", "迟到 / 补充回单"],
];

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
    throw new Error("银行到账时间格式无效，请输入 YYYY-MM-DDTHH:mm:ss；未填写时区时按越南 UTC+7 解释");
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
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "superadmin" || session?.role === "super";
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
      setError(err instanceof Error ? displayAdminError(err) : "D1 数据加载失败");
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
        setNotice(`操作已生效并写入审计，但充值流水刷新失败；请使用“刷新”重新读取 · ${flowError instanceof Error ? flowError.message : "流水读取失败"}`);
      }
    } catch (err) {
      refreshPendingCommands();
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setError(`操作结果未确认，已停止展示旧数据；请先重新读取，勿用新请求重复提交 · ${err instanceof Error ? err.message : "D1 操作失败"}`);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const applyBankWrite = async (task: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError("");
    try {
      await task();
      let next = await loadD1VietQrOverview(bankView, bankPage, bankPageSize);
      if (next.page.items.length === 0 && bankPage > 1 && next.page.total > 0) {
        const fallbackPage = Math.max(1, Math.ceil(next.page.total / bankPageSize));
        next = await loadD1VietQrOverview(bankView, fallbackPage, bankPageSize);
        setBankPage(fallbackPage);
      }
      setVietQr(next);
      toast(ok);
    } catch (err) {
      setVietQr(null);
      setError(`银行轨操作结果未确认，已停止展示旧数据；请重新读取后再判断 · ${err instanceof Error ? err.message : "银行轨操作失败"}`);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const updateChannelNumber = (channel: D1Overview["channels"][number], kind: "fee" | "min" | "max") => {
    const current = kind === "fee"
      ? channel.feeValue
      : kind === "min"
        ? channel.minAmountValue
        : channel.maxAmountValue;
    if (current === null) {
      toast("该通道没有独立单笔上限；银行轨上限请在 VietQR 参数区调整");
      return;
    }
    const unitLabel = kind === "fee" ? (channel.feeUnit === "PERCENT" ? "%" : "USDT 固定手续费") : "USD";
    openActionConfirm({
      action: kind === "fee"
        ? `充值费率调整 · ${channel.id}`
        : kind === "min"
          ? `最小充值额调整 · ${channel.id}`
          : `单笔上限调整 · ${channel.id}`,
      detail: `仅接受数字，单位固定为 ${unitLabel}；保存后只影响新交易。`,
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
          `${channel.id} 已更新`,
        );
      },
    });
  };

  const bankConfigPayload = (
    patch: Partial<Pick<D1VietQrOverview["config"], "toleranceVnd" | "graceMinutes" | "perTxLimitUsd" | "trc20Confirmations" | "erc20Confirmations" | "bep20Confirmations" | "rotationStrategy">>,
  ) => {
    if (!vietQr) throw new Error("银行轨配置尚未加载");
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
      action: `银行轨参数调整 · ${label}`,
      detail: `${label}当前为 ${current} ${unit}，合法范围 ${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}。仅对新回单或新付款单生效。`,
      edit: { kind: "number", current: String(current), unit, min, max, step: 1 },
      run: (reason, value) => {
        const next = Number(value);
        if (!Number.isInteger(next) || next < min || next > max) throw new Error(`${label}必须是合法整数`);
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
      toast(`请求号 ${commandKey} 已按原始参数完成幂等重试`);
      const nextFlows = await fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize });
      setFlows(nextFlows);
    } catch (err) {
      refreshPendingCommands();
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setError(`原请求号重试结果仍未确认，已停止展示旧数据 · ${err instanceof Error ? err.message : "D1 重试失败"}`);
    } finally {
      setBusy(false);
    }
  };

  const pendingCommandPanel = pendingCommands.length > 0 ? (
    <section className="l-card" data-testid="d1-pending-command-panel">
      <div className="l-h"><span className="ttl">待核对的未知结果请求</span></div>
      <div className="l-b">
        <div className="dtint warn">
          以下请求可能已在服务端生效。先刷新核对真值；仍需重发时只能使用原请求号，禁止生成新请求。记录在当前标签页会话内保留 24 小时，可跨刷新与重新登录恢复。
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
              核对后使用原请求号重试
            </button>
          </div>
        ))}
      </div>
    </section>
  ) : null;

  if (loading && !overview) {
    return <section className="l-card"><div className="l-b">D1 数据加载中...</div></section>;
  }

  if (error && !overview) {
    return <>{pendingCommandPanel}<section className="l-card"><div className="l-b"><div className="dtint warn">D1 已停止展示旧数据 · {error}</div><button className="l-btn primary" disabled={loading || busy} style={{ marginTop: 12 }} onClick={() => void refresh()}>重试读取</button></div></section></>;
  }

  return (
    <>
      {pendingCommandPanel}
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D1 数据加载失败 · {error}</div>}
      {notice && <div className="dtint warn" style={{ marginBottom: 12 }}>{notice}</div>}
      {overview && !overview.historicalBackfillComplete && (
        <div className="dtint warn" style={{ marginBottom: 12 }}>
          历史账务证据尚未闭合：共 {overview.historicalBackfillAnomalyCount} 条待处理；
          手续费证据 {overview.feeEvidenceAnomalyCount} 条，D3 储备证据 {overview.treasuryReserveAnomalyCount} 条。
          下方金额仅代表当前可验证部分，不得视为完整历史真值。请在 A2 审计中按 D1_CUMULATIVE_BACKFILL 追踪迁移记录并完成异常核对。
        </div>
      )}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">今日入账金额</div><div className="v">{money(overview?.ledgerTotal ?? 0)}</div><div className="sub">{overview?.ledgerCount ?? 0} 笔来自 D4 钱包账本</div></div>
        <div className="f-stat warn"><div className="k">对账差异</div><div className="v">{overview?.diffCount ?? 0} 项</div><div className="sub">差异金额 {money(overview?.diffAmount ?? 0)}</div></div>
        <div className="f-stat cyan"><div className="k">卡费缓冲</div><div className="v">{money(overview?.feeBufferUsd ?? 0)}</div><div className="sub">{overview?.feeBufferComplete ? "来自独立费率缓冲账户与分录" : "仅当前可验证部分 · 历史证据未闭合"}</div></div>
        <div className="f-stat danger"><div className="k">BIN / IP / 设备锁定</div><div className="v">{overview?.binLockedCount ?? 0}</div><div className="sub">真实风控锁，服务端按到期时间判定</div></div>
      </div>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">充值渠道</span>
            <span className="sub">· 真实配置读取 / 写入服务端配置</span>
            <div className="r">
              <button className="l-btn sm" disabled={loading || busy} onClick={() => void refresh()}>刷新</button>
            </div>
          </div>
          <div className="l-b">
            {(overview?.channels ?? []).map((channel) => (
              <div className="p-row" key={channel.code}>
                <div className="txt">
                  <div className="k">{channel.id}</div>
                  <div className="s">
                    费率 {channel.fee} · 最小充值 {channel.minAmount}
                    {channel.code === "vietqr" && vietQr ? ` · 单笔上限 $${vietQr.config.perTxLimitUsd.toLocaleString("en-US")}` : ""}
                    {channel.maxAmountValue !== null ? ` · 单笔上限 $${channel.maxAmountValue.toLocaleString("en-US")}` : ""}
                  </div>
                </div>
                <span className={`bdg ${channel.enabled ? "ok" : "bad"}`}>{channel.enabled ? "启用" : "停用"}</span>
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "min")}>最小额</button>}
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "fee")}>费率</button>}
                {canManageChannels && channel.maxAmountValue !== null && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "max")}>单笔上限</button>}
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                  action: `${channel.enabled ? "停用" : "启用"}充值渠道 · ${channel.id}`,
                  detail: "渠道状态由后端配置控制，保存后只影响新交易。",
                  run: (reason) => applyOverview(
                    () => updateD1TopupChannelEnabled(channel.code, !channel.enabled, channel.enabled, reason, operator),
                    `${channel.id} 已${channel.enabled ? "停用" : "启用"}`,
                  ),
                })}>{channel.enabled ? "停用" : "启用"}</button>}
              </div>
            ))}
            <div className="dtint" style={{ marginTop: 12 }}>
              当前主 PSP: <b>{overview?.primaryPsp ?? "—"}</b> · 备用: {overview?.backupPsp ?? "—"}
              {canSwitchPsp && <button className="l-btn sm mc" disabled={loading || busy} style={{ marginLeft: 10 }} onClick={() => openActionConfirm({
                action: "主备 PSP 切换",
                detail: `切换到 ${overview?.backupPsp ?? "备用 PSP"}，后端写配置并落审计。`,
                run: (reason) => applyOverview(
                  () => switchD1Psp(overview?.backupPsp ?? "Stripe", overview?.primaryPsp ?? "", reason, operator),
                  "主备 PSP 已切换",
                ),
              })}>切换主备</button>}
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">刷卡风控参数</span>
            <span className="sub">· 后端配置即时生效</span>
          </div>
          <div className="l-b">
            {(overview?.cardParams ?? []).map((param) => (
              <div className="p-row" key={param.key}>
                <div className="txt"><div className="k">{param.name}</div><div className="s">{param.note}</div></div>
                <span className="v">{param.value}</span>
                {canManageConfig && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                  action: `刷卡风控参数 · ${param.name}`,
                  detail: "写入后端配置，D1 概览重新从接口读取。",
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
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">银行转账（VietQR）对账</span>
          <span className="sub">· 五视图 · 单据锁价快照 · 挂账与 D3 第 9 科目同源</span>
          <div className="r">
            <span className="dcode electric">待核实入金 {money(vietQr?.pendingUnverifiedDepositUsdt ?? 0)}</span>
            {canBankReconcile && <button className="l-btn sm mc" disabled={busy || !vietQr?.accounts.length} onClick={() => openActionConfirm({
              action: "登记真实银行回单",
              detail: "银行流水号全局唯一；系统按附言码、收款账户、实收金额和到账时间分类到已匹配、孤儿、差额或迟到队列，不允许页面直接指定用户。",
              businessForm: { kind: "multi-field", fields: [
                {
                  key: "bankAccountId", label: "实际收款账户", inputKind: "select",
                  current: String(vietQr?.accounts[0]?.id ?? ""),
                  options: (vietQr?.accounts ?? []).map((account) => String(account.id)),
                  optionLabels: Object.fromEntries((vietQr?.accounts ?? []).map((account) => [
                    String(account.id), `${account.bankName} · 尾号 ${account.accountLast4}`,
                  ])),
                },
                { key: "paymentReference", label: "银行流水号", inputKind: "text", required: true },
                { key: "memoCode", label: "转账附言码（可空）", inputKind: "text" },
                { key: "receivedVnd", label: "实收金额（VND）", inputKind: "text", required: true },
                { key: "receivedAt", label: "越南银行到账时间（UTC+7）", inputKind: "text", current: vietnamLocalDateTimeNow(), required: true },
                { key: "evidenceRef", label: "银行回单 / 工单凭证", inputKind: "text", required: true },
              ] },
              run: (reason, _value, business) => {
                const bankAccountId = Number(business?.bankAccountId);
                const receivedVnd = Number(business?.receivedVnd);
                if (!Number.isSafeInteger(bankAccountId) || bankAccountId <= 0) throw new Error("请选择真实收款账户");
                if (!Number.isSafeInteger(receivedVnd) || receivedVnd <= 0) throw new Error("实收金额必须是正整数 VND");
                return applyBankWrite(() => registerD1VietQrReceipt({
                  bankAccountId,
                  paymentReference: business?.paymentReference?.trim() ?? "",
                  memoCode: business?.memoCode?.trim() || undefined,
                  receivedVnd,
                  receivedAt: vietQrReceivedAtInstant(business?.receivedAt ?? ""),
                  evidenceRef: business?.evidenceRef?.trim() ?? "",
                  reason,
                  operator,
                }), "银行回单已登记；请切换相应队列完成复核");
              },
            })}>登记银行回单</button>}
          </div>
        </div>
        <div className="l-b" style={{ paddingBottom: 8 }}>
          <div className="chips">
            {BANK_VIEW_TABS.map(([key, label]) => (
              <button key={key} className={`chip${bankView === key ? " sel" : ""}`} disabled={loading || busy} onClick={() => { setBankView(key); setBankPage(1); }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1120 }}>
            <thead><tr><th>回单 / 银行流水 / 到账时间</th><th>用户 / 意向单</th><th className="num">应付 VND</th><th className="num">实收 VND</th><th className="num">锁定牌价</th><th className="num">折算 USDT</th><th>状态</th><th>说明</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {(vietQr?.page.items ?? []).length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "26px 12px" }}>当前视图暂无银行轨记录</td></tr>
              ) : vietQr?.page.items.map((row) => {
                const amount = row.receivedVnd === null ? row.creditedUsdt : row.receivedVnd / row.lockedFxRateVndPerUsdt;
                return (
                  <tr key={row.id}>
                    <td><span className="mono">{row.reconciliationNo}</span><div className="sub mono">{row.paymentReference || "无银行流水号"}</div><div className="sub">{timeText(row.receivedAt)}</div></td>
                    <td><span className="mono">{row.userId ?? "—"}</span><div className="sub">{row.intentNo || "未匹配意向单"}</div></td>
                    <td className="num mono">{vnd(row.payableVnd)}</td>
                    <td className="num mono">{vnd(row.receivedVnd)}</td>
                    <td className="num mono">{vnd(row.lockedFxRateVndPerUsdt)}</td>
                    <td className="num mono">{money(amount)}</td>
                    <td><span className={`bdg ${row.status === "CREDITED" ? "ok" : row.status === "RETURNED" ? "dim" : "warn"}`}>{row.status === "OPEN" ? "待处置" : row.status === "CREDITED" ? "已入账" : row.status === "RETURNED" ? "已退回" : "退回处理中"}</span></td>
                    <td>{row.note || "—"}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canBankReconcile && row.status === "OPEN" && row.viewType === "ORPHAN" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                          action: `手动匹配入账 · ${row.reconciliationNo}`,
                          detail: `实收 ${vnd(row.receivedVnd)} 将按该回单锁定牌价入账，并把第 9 科目等额转为用户可提负债。用户归属由服务端意向单唯一确定，页面不能手工指定入账用户。`,
                          businessForm: { kind: "multi-field", fields: [
                            { key: "intentNo", label: "目标意向单号", inputKind: "text", required: true },
                            { key: "evidenceRef", label: "银行回单 / 工单凭证", inputKind: "text", required: true },
                          ] },
                          run: (reason, _value, business) => {
                            const intentNo = business?.intentNo?.trim() ?? "";
                            const evidenceRef = business?.evidenceRef?.trim() ?? "";
                            if (!intentNo) throw new Error("请输入真实付款意向单号");
                            return applyBankWrite(() => reconcileD1VietQr(row.id, "match-credit", {
                              expectedVersion: row.version, intentNo, evidenceRef, reason, operator,
                            }), "孤儿回单已匹配入账");
                          },
                        })}>手动匹配入账</button>
                      )}
                      {canBankReconcile && row.status === "OPEN" && row.viewType === "MATCHED" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                          action: `确认匹配入账 · ${row.reconciliationNo}`,
                          detail: "服务端以回单登记时冻结的匹配分类为准，再次核对意向单用户、收款账户和锁价快照，并在同一事务中入账；后续调参不会反向卡死已匹配回单，已到账资金也不会因账户日上限被拒绝。",
                          businessForm: { kind: "multi-field", fields: [
                            { key: "evidenceRef", label: "银行回单 / 工单凭证", inputKind: "text", required: true },
                          ] },
                          run: (reason, _value, business) => applyBankWrite(() => reconcileD1VietQr(row.id, "match-credit", {
                            expectedVersion: row.version, intentNo: row.intentNo,
                            evidenceRef: business?.evidenceRef?.trim() ?? "", reason, operator,
                          }), "匹配回单已确认入账"),
                        })}>确认入账</button>
                      )}
                      {canBankReconcile && row.status === "OPEN" && row.viewType === "MISMATCH" && (
                        <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                          action: `按实收核销 · ${row.reconciliationNo}`,
                          detail: `按实收 ${vnd(row.receivedVnd)} 折算入账；第 9 科目等额转为用户可提负债，原应付金额不覆盖实收事实。`,
                          businessForm: { kind: "multi-field", fields: [
                            { key: "evidenceRef", label: "银行回单 / 工单凭证", inputKind: "text", required: true },
                          ] },
                          run: (reason, _value, business) => applyBankWrite(() => reconcileD1VietQr(row.id, "write-off", {
                            expectedVersion: row.version, evidenceRef: business?.evidenceRef?.trim() ?? "", reason, operator,
                          }), "差额回单已按实收核销"),
                        })}>按实收核销</button>
                      )}
                      {canBankReconcile && row.status === "OPEN" && ["ORPHAN", "MISMATCH", "LATE"].includes(row.viewType) && (
                        <button className="l-btn sm mc" style={{ marginLeft: 6 }} disabled={busy} onClick={() => openActionConfirm({
                          action: `登记退回 · ${row.reconciliationNo}`,
                          detail: row.viewType === "LATE"
                            ? "迟到或补充回单不复用原付款单的过期锁价，只允许登记退回；终态回单不可重复处置。"
                            : "登记退回会同时冲减真实储备与第 9 科目；终态回单不可重复处置。",
                          businessForm: { kind: "multi-field", fields: [
                            { key: "evidenceRef", label: "退款凭证 / 工单凭证", inputKind: "text", required: true },
                          ] },
                          run: (reason, _value, business) => applyBankWrite(() => reconcileD1VietQr(row.id, "return", {
                            expectedVersion: row.version, evidenceRef: business?.evidenceRef?.trim() ?? "", reason, operator,
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
            <select
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
      </section>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">收款账户池</span>
            <span className="sub">· 账号只展示尾四位 · 全号加密落库</span>
            {canManageBankAccounts && <div className="r"><button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
              action: "新增 VietQR 收款账户",
              detail: "账户全号只提交给后端加密保存，列表和审计均不得回显全号。",
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
              <div className="dtint">当前没有收款账户。空账户池会使 VietQR 新付款单不可分配，请由具备权限的财务管理员新增真实银行账户。</div>
            ) : vietQr?.accounts.map((account) => (
              <div className="p-row" key={account.id}>
                <div className="txt"><div className="k">{account.bankName} · 尾号 {account.accountLast4}</div><div className="s">{account.holderMasked} · 今日 {vnd(account.receivedTodayVnd)} / 上限 {vnd(account.dailyCapVnd)}{account.fuseReason ? ` · ${account.fuseReason}` : ""}</div></div>
                <span className={`bdg ${account.status === "ACTIVE" ? "ok" : account.status === "FUSED" ? "bad" : "dim"}`}>{account.status === "ACTIVE" ? "启用" : account.status === "FUSED" ? "已熔断" : "停用"}</span>
                {canManageBankAccounts && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                  action: `调整日收上限 · ${account.bankName} 尾号 ${account.accountLast4}`,
                  detail: "日收上限仅影响后续新单分配，不改变已收款事实。",
                  edit: { kind: "number", current: String(account.dailyCapVnd), unit: "VND", min: 1_000_000, max: 10_000_000_000, step: 1 },
                  run: (reason, value) => applyBankWrite(() => updateD1VietQrAccount(account.id, {
                    action: "UPDATE_CAP", dailyCapVnd: Number(value), expectedVersion: account.version, reason, operator,
                  }), "账户日收上限已更新"),
                })}>调上限</button>}
                {canManageBankAccounts && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                  action: `${account.status === "ACTIVE" ? "停用" : account.status === "FUSED" ? "恢复" : "启用"}收款账户 · ${account.bankName} 尾号 ${account.accountLast4}`,
                  detail: "状态通过服务端版本号比较后更新；熔断账户只能走恢复动作。",
                  run: (reason) => applyBankWrite(() => updateD1VietQrAccount(account.id, {
                    action: account.status === "ACTIVE" ? "DISABLE" : account.status === "FUSED" ? "RECOVER" : "ENABLE",
                    expectedVersion: account.version, reason, operator,
                  }), "账户状态已更新"),
                })}>{account.status === "ACTIVE" ? "停用" : account.status === "FUSED" ? "恢复" : "启用"}</button>}
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">银行轨参数</span><span className="sub">· 服务端范围校验 · 仅新单/新回单生效</span></div>
          <div className="l-b">
            {vietQr && [
              ["toleranceVnd", "金额容差", vietQr.config.toleranceVnd, "VND", 0, 5_000],
              ["graceMinutes", "回单宽限", vietQr.config.graceMinutes, "分钟", 0, 60],
              ["perTxLimitUsd", "VietQR 单笔上限", vietQr.config.perTxLimitUsd, "USD", 100, 10_000],
              ["trc20Confirmations", "TRC20 入账确认数", vietQr.config.trc20Confirmations, "确认", 1, 64],
              ["erc20Confirmations", "ERC20 入账确认数", vietQr.config.erc20Confirmations, "确认", 1, 64],
              ["bep20Confirmations", "BEP20 入账确认数", vietQr.config.bep20Confirmations, "确认", 1, 64],
            ].map(([key, label, value, unit, min, max]) => (
              <div className="p-row" key={String(key)}>
                <div className="txt"><div className="k">{label}</div><div className="s">当前服务端版本 v{vietQr.config.version}</div></div>
                <span className="v">{Number(value).toLocaleString("en-US")} {unit}</span>
                {canManageBankConfig && <button className="l-btn sm mc" disabled={busy} onClick={() => editBankNumber(
                  key as "toleranceVnd" | "graceMinutes" | "perTxLimitUsd" | "trc20Confirmations" | "erc20Confirmations" | "bep20Confirmations",
                  String(label), String(unit), Number(min), Number(max),
                )}>调整</button>}
              </div>
            ))}
            {vietQr && <div className="p-row">
              <div className="txt"><div className="k">账户轮换策略</div><div className="s">仅新付款单选择账户时使用</div></div>
              <span className="v">{vietQr.config.rotationStrategy === "ROUND_ROBIN" ? "轮询均匀派发" : "剩余额度优先"}</span>
              {canManageBankConfig && <button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
                action: "收款账户池轮换策略调整",
                detail: "切换后仅影响新付款单，不迁移在途单。",
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
          <span className="sub">· 后端分页 · 支持状态与关键字查询</span>
          <div className="r">
            <div className="chips">
              {FLOW_TABS.map(([key, label]) => (
                <button key={key || "all"} disabled={loading || busy} className={`chip${status === key ? " sel" : ""}`} onClick={() => { setStatus(key); setPage(1); }}>{label}</button>
              ))}
            </div>
            <div className="lookup">
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="充值单 / 用户编号 / 凭证" />
              <button className="l-btn primary" disabled={loading || busy} onClick={() => { if (page === 1) void refresh(); else setPage(1); }}>查询</button>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead><tr><th>充值单</th><th>用户</th><th>通道</th><th className="num">金额</th><th className="num">三方实收</th><th>状态</th><th>凭证</th><th>提交时间</th><th>确认时间</th><th>入账时间</th></tr></thead>
            <tbody>
              {flows.records.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-4)", padding: "26px 12px" }}>暂无充值流水</td></tr>
              ) : flows.records.map((flow) => (
                <tr key={flow.depositNo}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{flow.depositNo}</td>
                  <td className="mono">{flow.userId}</td>
                  <td>{flow.channel} / {flow.asset}</td>
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
            {[10, 20, 50].map((size) => <button key={size} disabled={loading || busy} className={`chip${pageSize === size ? " sel" : ""}`} onClick={() => { setPageSize(size); setPage(1); }}>{size}/页</button>)}
            <button className="chip" disabled={loading || busy || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
            <button className="chip" disabled={loading || busy || page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</button>
          </div>
        </div>
      </section>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">对账差异</span>
            <span className="sub">· 三方记录与账本聚合比对</span>
          </div>
          <div className="l-b">
            {(overview?.reconciliation ?? []).length === 0 ? (
              <div className="dtint">今天还没有支付商结算流水或平台入账分录。支付商流水进入后，系统会与 D4 钱包账本独立比对；空数据不代表已经对平。</div>
            ) : (overview?.reconciliation ?? []).map((row) => (
              <div className="cb-row" key={row.channel}>
                <span className="mono" style={{ fontWeight: 700 }}>{row.channel}</span>
                <span style={{ flex: 1 }}>三方 {row.providerCount} / {money(row.providerAmount)} · 账本 {row.ledgerCount} / {money(row.ledgerAmount)}</span>
                <span className={`bdg ${row.reconciled || !row.diff ? "ok" : "warn"}`}>{row.reconciled ? "已核销" : row.diff || "金额与笔数一致"}</span>
                {canReconcile && !row.reconciled && Boolean(row.diff) && (
                  <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                    action: `核销对账差异 · ${row.channel}`,
                    detail: `差异金额 ${money(row.diffAmount)}。聚合差异只能确认异常挂账，必须填写支付商账单或工单凭证。`,
                    businessForm: { kind: "multi-field", fields: [
                      { key: "method", label: "处理方式", inputKind: "select", current: "CONFIRM_EXCEPTION", options: ["CONFIRM_EXCEPTION"], optionLabels: { CONFIRM_EXCEPTION: "确认异常并挂账" } },
                      { key: "evidenceRef", label: "支付商账单 / 工单凭证", inputKind: "text", placeholder: "如 PSP-STMT-20260720-001", required: true },
                    ] },
                    run: (reason, _value, business) => {
                      const evidenceRef = business?.evidenceRef?.trim() ?? "";
                      return applyOverview(() => writeoffD1Reconciliation(row.channel, "CONFIRM_EXCEPTION", evidenceRef, reason, operator), `${row.channel} 差异已核销`);
                    },
                  })}>核销</button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">BIN / IP / 设备锁定</span>
            <span className="sub">· 24 小时失败聚合 · 到期时间来自服务端</span>
          </div>
          <div className="l-b">
            <div className="lookup" style={{ marginBottom: 10 }}>
              <input value={manualBin} disabled={loading || busy || !canCreateBinLock} onChange={(e) => setManualBin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="输入 6 至 8 位 BIN，如 424242" />
              {canCreateBinLock && <button className="l-btn primary" disabled={loading || busy} onClick={() => {
                const segment = manualBin.trim();
                if (!/^\d{6,8}$/.test(segment)) {
                  toast("请输入 6 至 8 位数字 BIN");
                  return;
                }
                openConfirm({
                  action: `锁定卡段 · ${segment}`,
                  detail: "系统会创建有到期时间的真实 BIN 风控锁，并写入审计。",
                  reason: true,
                  okLabel: "锁定",
                  run: (reason) => applyOverview(() => createD1BinLock(segment, reason, operator), `${segment} 已锁定`),
                });
              }}>手动锁定</button>}
            </div>
            {(overview?.bins ?? []).map((bin) => {
              const [targetType, ...targetParts] = bin.segment.split(":");
              const targetValue = targetParts.join(":");
              const targetLabel = targetType === "BIN" ? "BIN 段" : targetType === "IP" ? "IP" : "设备指纹";
              return <div className="cb-row" key={bin.segment}>
                <span className="mono" style={{ fontWeight: 700 }}>{bin.segment}</span>
                <span style={{ flex: 1 }}>{bin.meta} · 24h 失败 {bin.fails24h} 次 · {bin.note}</span>
                <span className={`bdg ${bin.locked ? "bad" : "ok"}`}>{bin.locked ? "锁定" : "放行"}</span>
                {((bin.locked && canUnlockBin) || (!bin.locked && canLockBin)) && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openConfirm({
                  action: `${bin.locked ? "解锁" : "锁定"}${targetLabel} · ${targetValue}`,
                  detail: `目标类型 ${targetType}，目标值 ${targetValue}。状态写入服务端风控锁表，并保留到期时间与操作审计。`,
                  reason: true,
                  okLabel: bin.locked ? "解锁" : "锁定",
                  run: (reason) => applyOverview(() => setD1BinLock(bin.segment, !bin.locked, reason, operator), `${bin.segment} 已${bin.locked ? "解锁" : "锁定"}`),
                })}>{bin.locked ? "解锁" : "锁定"}</button>}
              </div>;
            })}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">拒付追回</span>
          <span className="sub">· 来源真实支付记录</span>
        </div>
        <div className="dtint warn" style={{ margin: "0 14px 12px" }}>
          拒付追回不足额时，服务端会生成 K 域高风险信号；可前往 <Link href="/risk/multi-account">K1 反多账户中心</Link> 继续追踪关联账户与处置，即使当前暂无拒付案件也可直接进入。
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead><tr><th>案件号</th><th>用户编码</th><th className="num">金额</th><th>原因</th><th>入账状态</th><th>追回状态</th><th>创建时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {(overview?.chargebacks ?? []).length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)", padding: "24px 12px" }}>暂无拒付案件</td></tr>
              ) : overview?.chargebacks.map((row) => (
                <tr key={row.caseNo}>
                  <td className="mono">{row.caseNo}</td>
                  <td className="mono"><Link href={`/risk/multi-account?userId=${row.userId}`}>{row.userCode}</Link></td>
                  <td className="num mono">{money(row.amount)}</td>
                  <td>{row.reasonCode}</td>
                  <td><span className="bdg dim">{d1EnteredStatusText(row.enteredStatus)}</span> <Link href={`/finance/ledger?keyword=${encodeURIComponent(row.caseNo)}`}>查看 D4 分录</Link></td>
                  <td><span className={`bdg ${statusTone(row.status)}`}>{d1StatusText(row.status)}</span></td>
                  <td className="mono">{timeText(row.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {canRecoverChargeback && !["CHARGEBACK_RECOVERED", "CHARGEBACK_PARTIAL"].includes(row.status) && (
                      <button className="l-btn sm mc" disabled={loading || busy} onClick={() => openActionConfirm({
                        action: `拒付追回 · ${row.caseNo}`,
                        detail: `追回 ${money(row.amount)}。服务端将在同一事务中扣用户余额、下调累计充值、生成 D4 分录、扣费率缓冲；不足额会自动生成 K 域风险信号。`,
                        businessForm: { kind: "multi-field", fields: [
                          { key: "evidenceRef", label: "拒付证据 / 工单凭证", inputKind: "text", placeholder: "如 DISPUTE-PROOF-100", required: true },
                        ] },
                        run: (reason, _value, business) => {
                          const evidenceRef = business?.evidenceRef?.trim() ?? "";
                          return applyOverview(() => refundD1Chargeback(row.caseNo, evidenceRef, reason, operator), `${row.caseNo} 已完成追回闭环`);
                        },
                      })}>追回</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
