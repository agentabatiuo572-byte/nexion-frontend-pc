"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  createD1BinLock,
  fetchD1TopupFlows,
  fetchD1TopupOverview,
  refundD1Chargeback,
  setD1BinLock,
  switchD1Psp,
  updateD1CardRisk,
  updateD1TopupChannelEnabled,
  updateD1TopupChannelFee,
  updateD1TopupChannelMin,
  writeoffD1Reconciliation,
  type D1DepositFlow,
  type D1Overview,
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
  const [overview, setOverview] = useState<D1Overview | null>(null);
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

  const refresh = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [nextOverview, nextFlows] = await Promise.all([
        fetchD1TopupOverview(),
        fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize }),
      ]);
      setOverview(nextOverview);
      setFlows(nextFlows);
    } catch (err) {
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setError(err instanceof Error ? err.message : "D1 数据加载失败");
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
      toast(ok);
      try {
        const nextFlows = await fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize });
        setFlows(nextFlows);
      } catch (flowError) {
        setFlows(EMPTY_D1_FLOWS);
        setNotice(`操作已生效并写入审计，但充值流水刷新失败；请使用“刷新”重新读取 · ${flowError instanceof Error ? flowError.message : "流水读取失败"}`);
      }
    } catch (err) {
      setOverview(null);
      setFlows(EMPTY_D1_FLOWS);
      setError(`操作结果未确认，已停止展示旧数据；请先重新读取，勿用新请求重复提交 · ${err instanceof Error ? err.message : "D1 操作失败"}`);
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const updateChannelNumber = (channel: D1Overview["channels"][number], kind: "fee" | "min") => {
    const current = kind === "fee" ? channel.feeValue : channel.minAmountValue;
    const unitLabel = kind === "fee" ? (channel.feeUnit === "PERCENT" ? "%" : "USDT 固定手续费") : "USD";
    openActionConfirm({
      action: kind === "fee" ? `充值费率调整 · ${channel.id}` : `最小充值额调整 · ${channel.id}`,
      detail: `仅接受数字，单位固定为 ${unitLabel}；保存后只影响新交易。`,
      edit: { kind: "number", current: String(current), unit: unitLabel, min: 0, max: kind === "fee" ? (channel.feeUnit === "PERCENT" ? 10 : 100) : 100000, step: 0.01 },
      run: (reason, value) => {
        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
          toast("请输入有效数字");
          return;
        }
        return applyOverview(
          () => kind === "fee"
            ? updateD1TopupChannelFee(channel.code, numericValue, channel.feeUnit, current, reason, operator)
            : updateD1TopupChannelMin(channel.code, numericValue, current, reason, operator),
          `${channel.id} 已更新`,
        );
      },
    });
  };

  if (loading && !overview) {
    return <section className="l-card"><div className="l-b">D1 数据加载中...</div></section>;
  }

  if (error && !overview) {
    return <section className="l-card"><div className="l-b"><div className="dtint warn">D1 已停止展示旧数据 · {error}</div><button className="l-btn primary" disabled={loading || busy} style={{ marginTop: 12 }} onClick={() => void refresh()}>重试读取</button></div></section>;
  }

  return (
    <>
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
                  <div className="s">费率 {channel.fee} · 最小充值 {channel.minAmount}</div>
                </div>
                <span className={`bdg ${channel.enabled ? "ok" : "bad"}`}>{channel.enabled ? "启用" : "停用"}</span>
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "min")}>最小额</button>}
                {canManageChannels && <button className="l-btn sm mc" disabled={loading || busy} onClick={() => updateChannelNumber(channel, "fee")}>费率</button>}
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
