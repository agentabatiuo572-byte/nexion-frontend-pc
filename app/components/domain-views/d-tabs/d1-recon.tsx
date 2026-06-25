"use client";

import { useEffect, useMemo, useState } from "react";
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

const OPERATOR = "superadmin";
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
  if (["SUCCESS", "CONFIRMED", "CREDITED", "CHARGEBACK_REFUNDED"].includes(s)) return "ok";
  if (["FAILED", "EXPIRED", "REJECTED", "ABNORMAL", "CHARGEBACK_ENTERED"].includes(s)) return "bad";
  return "warn";
}

export function D1Recon({ ctx }: { ctx: DCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [overview, setOverview] = useState<D1Overview | null>(null);
  const [flows, setFlows] = useState<PageResult<D1DepositFlow>>({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [manualBin, setManualBin] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = async () => {
    const next = await fetchD1TopupOverview();
    setOverview(next);
    return next;
  };

  const loadFlows = async () => {
    const next = await fetchD1TopupFlows({ status, keyword, pageNum: page, pageSize });
    setFlows(next);
    return next;
  };

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadOverview(), loadFlows()]);
    } catch (err) {
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
    try {
      const next = await task();
      setOverview(next);
      toast(ok);
      void loadFlows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "D1 操作失败");
    }
  };

  const updateChannelText = (channelCode: string, kind: "fee" | "min", current: string) => {
    openActionConfirm({
      action: kind === "fee" ? `充值费率调整 · ${channelCode}` : `最小充值额调整 · ${channelCode}`,
      detail: "写入 nx_config_item，后端返回最新 D1 概览；已创建的新单不回写。",
      edit: { kind: "text", current },
      run: (reason, value) => {
        if (!value?.trim()) {
          toast("请输入目标值");
          return;
        }
        void applyOverview(
          () => kind === "fee"
            ? updateD1TopupChannelFee(channelCode, value.trim(), reason, OPERATOR)
            : updateD1TopupChannelMin(channelCode, value.trim(), reason, OPERATOR),
          `${channelCode} 已更新`,
        );
      },
    });
  };

  if (loading && !overview) {
    return <section className="l-card"><div className="l-b">D1 数据加载中...</div></section>;
  }

  return (
    <>
      {error && <div className="dtint warn" style={{ marginBottom: 12 }}>D1 数据加载失败 · {error}</div>}

      <div className="f-stats">
        <div className="f-stat ok"><div className="k">今日入账金额</div><div className="v">{money(overview?.ledgerTotal ?? 0)}</div><div className="sub">{overview?.ledgerCount ?? 0} 笔来自真实充值/支付表</div></div>
        <div className="f-stat warn"><div className="k">对账差异</div><div className="v">{overview?.diffCount ?? 0} 项</div><div className="sub">差异金额 {money(overview?.diffAmount ?? 0)}</div></div>
        <div className="f-stat cyan"><div className="k">卡费缓冲</div><div className="v">{money(overview?.feeBufferUsd ?? 0)}</div><div className="sub">按今日刷卡实收和配置计算</div></div>
        <div className="f-stat danger"><div className="k">BIN 锁定</div><div className="v">{overview?.binLockedCount ?? 0}</div><div className="sub">来源: 失败支付 + 手动锁定配置</div></div>
      </div>

      <div className="two-col r11">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">充值渠道</span>
            <span className="sub">· 真实配置读取 / 写入 nx_config_item</span>
            <div className="r">
              <button className="l-btn sm" onClick={() => void refresh()}>刷新</button>
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
                <button className="l-btn sm mc" onClick={() => updateChannelText(channel.code, "min", channel.minAmount)}>最小额</button>
                <button className="l-btn sm mc" onClick={() => updateChannelText(channel.code, "fee", channel.fee)}>费率</button>
                <button className="l-btn sm mc" onClick={() => openActionConfirm({
                  action: `${channel.enabled ? "停用" : "启用"}充值渠道 · ${channel.id}`,
                  detail: "渠道状态由后端配置控制，保存后只影响新交易。",
                  run: (reason) => void applyOverview(
                    () => updateD1TopupChannelEnabled(channel.code, !channel.enabled, reason, OPERATOR),
                    `${channel.id} 已${channel.enabled ? "停用" : "启用"}`,
                  ),
                })}>{channel.enabled ? "停用" : "启用"}</button>
              </div>
            ))}
            <div className="dtint" style={{ marginTop: 12 }}>
              当前主 PSP: <b>{overview?.primaryPsp ?? "—"}</b> · 备用: {overview?.backupPsp ?? "—"}
              <button className="l-btn sm mc" style={{ marginLeft: 10 }} onClick={() => openActionConfirm({
                action: "主备 PSP 切换",
                detail: `切换到 ${overview?.backupPsp ?? "备用 PSP"}，后端写配置并落审计。`,
                run: (reason) => void applyOverview(
                  () => switchD1Psp(overview?.backupPsp ?? "Stripe", reason, OPERATOR),
                  "主备 PSP 已切换",
                ),
              })}>切换主备</button>
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
                <button className="l-btn sm mc" onClick={() => openActionConfirm({
                  action: `刷卡风控参数 · ${param.name}`,
                  detail: "写入后端配置，D1 概览重新从接口读取。",
                  edit: { kind: "text", current: param.value },
                  run: (reason, value) => {
                    if (!value?.trim()) {
                      toast("请输入目标值");
                      return;
                    }
                    void applyOverview(() => updateD1CardRisk(param.key, value.trim(), reason, OPERATOR), `${param.name} 已更新`);
                  },
                })}>调整</button>
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
                <button key={key || "all"} className={`chip${status === key ? " sel" : ""}`} onClick={() => { setStatus(key); setPage(1); }}>{label}</button>
              ))}
            </div>
            <div className="lookup">
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="充值单 / 用户编号 / 凭证" />
              <button className="l-btn primary" onClick={() => { setPage(1); void loadFlows().catch((err) => setError(err.message)); }}>查询</button>
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead><tr><th>充值单</th><th>用户</th><th>通道</th><th className="num">金额</th><th className="num">三方实收</th><th>状态</th><th>凭证</th><th>创建时间</th></tr></thead>
            <tbody>
              {flows.records.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)", padding: "26px 12px" }}>暂无充值流水</td></tr>
              ) : flows.records.map((flow) => (
                <tr key={flow.depositNo}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{flow.depositNo}</td>
                  <td className="mono">{flow.userId}</td>
                  <td>{flow.channel} / {flow.asset}</td>
                  <td className="num mono">{money(flow.amount)}</td>
                  <td className="num mono">{money(flow.providerReceived)}</td>
                  <td><span className={`bdg ${statusTone(flow.status)}`}>{flow.statusLabel}</span></td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{flow.proof}</td>
                  <td className="mono" style={{ color: "var(--ink-4)" }}>{timeText(flow.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span className="sub">共 {flows.total} 条 · 第 {flows.pageNum}/{pages} 页</span>
          <div className="chips">
            {[10, 20, 50].map((size) => <button key={size} className={`chip${pageSize === size ? " sel" : ""}`} onClick={() => { setPageSize(size); setPage(1); }}>{size}/页</button>)}
            <button className="chip" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
            <button className="chip" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>下一页</button>
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
            {(overview?.reconciliation ?? []).map((row) => (
              <div className="cb-row" key={row.channel}>
                <span className="mono" style={{ fontWeight: 700 }}>{row.channel}</span>
                <span style={{ flex: 1 }}>三方 {row.providerCount} / {money(row.providerAmount)} · 账本 {row.ledgerCount} / {money(row.ledgerAmount)}</span>
                <span className={`bdg ${row.reconciled || row.diffAmount === 0 ? "ok" : "warn"}`}>{row.reconciled ? "已核销" : row.diff}</span>
                {!row.reconciled && row.diffAmount !== 0 && (
                  <button className="l-btn sm mc" onClick={() => openConfirm({
                    action: `核销对账差异 · ${row.channel}`,
                    detail: `差异金额 ${money(row.diffAmount)}。确认后写后端配置和审计。`,
                    reason: true,
                    okLabel: "核销",
                    run: (reason) => void applyOverview(() => writeoffD1Reconciliation(row.channel, reason, OPERATOR), `${row.channel} 差异已核销`),
                  })}>核销</button>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">BIN 锁定</span>
            <span className="sub">· 失败支付 + 手动配置</span>
          </div>
          <div className="l-b">
            <div className="lookup" style={{ marginBottom: 10 }}>
              <input value={manualBin} onChange={(e) => setManualBin(e.target.value)} placeholder="输入卡段，如 424242" />
              <button className="l-btn primary" onClick={() => {
                const segment = manualBin.trim();
                if (!segment) {
                  toast("请输入卡段");
                  return;
                }
                openConfirm({
                  action: `锁定卡段 · ${segment}`,
                  detail: "锁定状态写入后端配置，D1 概览重新查询。",
                  reason: true,
                  okLabel: "锁定",
                  run: (reason) => void applyOverview(() => createD1BinLock(segment, reason, OPERATOR), `${segment} 已锁定`),
                });
              }}>手动锁定</button>
            </div>
            {(overview?.bins ?? []).map((bin) => (
              <div className="cb-row" key={bin.segment}>
                <span className="mono" style={{ fontWeight: 700 }}>{bin.segment}</span>
                <span style={{ flex: 1 }}>{bin.meta} · 24h 失败 {bin.fails24h} 次 · {bin.note}</span>
                <span className={`bdg ${bin.locked ? "bad" : "ok"}`}>{bin.locked ? "锁定" : "放行"}</span>
                <button className="l-btn sm mc" onClick={() => openConfirm({
                  action: `${bin.locked ? "解锁" : "锁定"}卡段 · ${bin.segment}`,
                  detail: "状态由后端配置保存，保存后重新查询。",
                  reason: true,
                  okLabel: bin.locked ? "解锁" : "锁定",
                  run: (reason) => void applyOverview(() => setD1BinLock(bin.segment, !bin.locked, reason, OPERATOR), `${bin.segment} 已${bin.locked ? "解锁" : "锁定"}`),
                })}>{bin.locked ? "解锁" : "锁定"}</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">拒付追回</span>
          <span className="sub">· 来源真实支付记录</span>
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
                  <td className="mono">{row.userCode}</td>
                  <td className="num mono">{money(row.amount)}</td>
                  <td>{row.reasonCode}</td>
                  <td><span className="bdg dim">{row.enteredStatus}</span></td>
                  <td><span className={`bdg ${statusTone(row.status)}`}>{row.status}</span></td>
                  <td className="mono">{timeText(row.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.status !== "CHARGEBACK_REFUNDED" && (
                      <button className="l-btn sm mc" onClick={() => openConfirm({
                        action: `拒付追回 · ${row.caseNo}`,
                        detail: `追回 ${money(row.amount)}，后端更新支付记录并重新查询。`,
                        reason: true,
                        okLabel: "确认追回",
                        run: (reason) => void applyOverview(() => refundD1Chargeback(row.caseNo, reason, OPERATOR), `${row.caseNo} 已追回`),
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
