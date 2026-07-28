"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * G2 兑换风控 — 数据来自后端 /api/admin/market/exchange;空库返回空态。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import {
  cancelG2ExchangeQueueOrder,
  fetchG2ExchangeOverview,
  processG2ExchangeQueue,
  triggerG2ExchangeKycReview,
  updateG2ExchangeParam,
  updateG2ExchangeSwapStatus,
  type G2Cap,
  type G2ExchangeOrder,
  type G2Overview,
} from "@/lib/admin/g2-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const OPERATOR = currentAdminOperator;
type GateKey = "kyc" | "user" | "platform" | "geo";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fmtUsdK(value: number) {
  return `$${(value / 1000).toFixed(1).replace(/\.0$/, "")}K`;
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

function meterWidth(value: number | undefined) {
  if (value === undefined) return "0%";
  return `${Math.max(0, Math.min(100, value))}%`;
}

function capEditValue(cap: G2Cap) {
  return cap.key === "queueMode" ? cap.displayValue : cap.value || cap.displayValue;
}

function normalizeCapSubmitValue(cap: G2Cap, value: string | undefined) {
  if (!value) return "";
  if (cap.key !== "queueMode") return value;
  return value === "拒绝" || value.toUpperCase() === "REJECT" ? "REJECT" : "QUEUE";
}

function toneClass(tone: string) {
  if (tone === "danger" || tone === "bad") return "bad";
  if (tone === "warn" || tone === "ok" || tone === "dim") return tone;
  return "dim";
}

export function G2Exchange({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuper = session?.role === "super" || session?.role === "superadmin";
  const allowed = (authority: string) => isSuper || authorities.includes(authority);
  const capAuthority = (key: string) => key === "userDailyCap" ? "finprod_g2_cap_user_write"
    : key === "platformDailyCap" ? "finprod_g2_cap_platform_write"
      : key === "fee" || key === "feeMin" ? "finprod_g2_fee_rate_write" : "finprod_g2_write";
  const [overview, setOverview] = useState<G2Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [gateDrawer, setGateDrawer] = useState<GateKey | null>(null);
  const [queueDrawer, setQueueDrawer] = useState<string | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      setOverview(await fetchG2ExchangeOverview());
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const next = await fetchG2ExchangeOverview();
        if (!cancelled) setOverview(next);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (key: string, action: () => Promise<G2Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      setOverview(await action());
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`G2 操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G2 兑换风控</span><span className="sub">· 正在读取真实接口数据</span></div>
        <div className="l-b"><div className="gtint">G2 数据加载中...</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G2 兑换风控</span><span className="sub">· 真实接口数据</span></div>
        <div className="l-b">
          <div className="gtint">G2 数据加载失败 · {error || "UNKNOWN_ERROR"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const { stats, coverage, swap, caps, queue, gateDetails, geoBlocked } = overview;
  const busy = !!busyKey;
  const cov = coverage.coverageRatio.toFixed(1);
  const redline = coverage.redlinePct.toFixed(1);
  const totalGate = stats.gateKyc + stats.gateUser + stats.gatePlatform + stats.gateGeo;
  const selectedQueue = queueDrawer ? queue.find((row) => row.exchangeNo === queueDrawer) : null;
  const gateTiles: { key: GateKey; label: string; count: number; tone?: "warn" | "danger" }[] = [
    { key: "kyc", label: "需实名(kyc-required)", count: stats.gateKyc, tone: "warn" },
    { key: "user", label: "单用户超限(user-cap)", count: stats.gateUser },
    { key: "platform", label: "平台超限(platform-cap)", count: stats.gatePlatform, tone: "danger" },
    { key: "geo", label: "地域封锁(geo-blocked)", count: stats.gateGeo, tone: "danger" },
  ];

  const adjCap = (cap: G2Cap) => {
    const isQueueMode = cap.key === "queueMode";
    openActionConfirm({
      action: `兑换${isQueueMode ? "队列策略" : "参数"}调整 · ${cap.name}`,
      detail: <>
        <b>{cap.name}</b> · 当前 {cap.displayValue} · {cap.note}。
        <div className="gtint" data-proof="g2-cap-preview" style={{ marginTop: 10 }}>
          <div><b>放行 / 排队 / 拒绝影响预览</b></div>
          <div>当前额度占用:{cap.meterPct !== undefined ? `${cap.meterPct}%` : "—"} · 今日兑换成交 {fmtUsdK(stats.todayUsd)}(占日池 {stats.poolPct}%)</div>
          <div>次日队列:{fmtCount(queue.length)} 单在队({fmtCount(stats.queueDepth)} 深度) · 今日拦截 {fmtCount(stats.gateUser + stats.gatePlatform)} 次</div>
          <div>调高 cap → 释放排队单加速放行(pass↑、queue↓);调低 → 更多转排队 / 拒绝(queue/reject↑),抑制 USDT 净流出。</div>
          <div>B1 兑付覆盖率:{cov}% · 红线 {redline}%</div>
        </div>
        {cap.loosen
          ? <>放宽是放大 USDT 流出,确认放行时服务器验备付金覆盖率红线(低于红线 422 拒);收紧不受限。</>
          : isQueueMode
            ? <>从「排队」改为「拒绝」= 收紧方向。执行门槛:运营主管。</>
            : "随费率启用生效。"}
      </>,
      amplifies: cap.loosen,
      edit: isQueueMode
        ? { kind: "select", current: cap.displayValue, options: ["排队", "拒绝"] }
        : { kind: "number", current: capEditValue(cap), min: cap.key === "kycThreshold" ? 1 : 0,
            max: cap.key === "userDailyCap" ? 10000 : cap.key === "platformDailyCap" ? 10000000 : cap.key === "fee" ? 10 : cap.key === "feeMin" ? 5 : 1000000,
            step: cap.key === "fee" ? 0.01 : 0.1 },
      run: async (reason, value) => {
        const nextValue = normalizeCapSubmitValue(cap, value);
        if (!nextValue) return;
        await mutate(`param:${cap.key}`, () => updateG2ExchangeParam(cap.key, nextValue, reason, OPERATOR()), `${cap.name}已立即生效`);
      },
    });
  };

  const toggleSwap = () => {
    if (!swap.enabled) return;
    openActionConfirm({
      action: "swap 全局熔断",
      detail: <>立即停止全平台所有 NEX↔USDT 兑换并同步 J1。G2 只提供止血入口;恢复必须前往 J1 完成跨域前置核验。</>,
      amplifies: false,
      businessForm: { kind: "multi-field", title: "结构化暂停上下文", fields: [
        { key: "triggerBasis", label: "触发依据", current: "PRICE_ANOMALY", inputKind: "select", options: ["REGULATORY", "PRICE_ANOMALY", "SECURITY_INCIDENT", "OTHER"], required: true },
        { key: "geoBlock", label: "涉及国家(可选,逗号分隔)", current: "", inputKind: "text", required: false },
      ] },
      run: async (reason, _value, businessValue) => {
        const countries = (businessValue?.geoBlock ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await mutate("swap:pause", () => updateG2ExchangeSwapStatus(false, reason, OPERATOR(), {
          geoBlock: countries, triggerBasis: businessValue?.triggerBasis,
        }), "swap 已立即熔断");
      },
    });
  };

  const cancelQueue = (order: G2ExchangeOrder) => {
    setQueueDrawer(null);
    openActionConfirm({
      action: `强制取消排队单 · ${order.exchangeNo}`,
      detail: <>取消该兑换排队单,{order.exchangeAmountDisplay} 排队阶段未扣余额,取消只终止后续成交。常用于地域封锁/风控命中;确认后立即执行并写入 A2 审计。</>,
      run: async (reason) => {
        await mutate(`cancel:${order.exchangeNo}`, () => cancelG2ExchangeQueueOrder(order.exchangeNo, reason, OPERATOR()), "排队单已立即取消");
      },
    });
  };

  const triggerKycReview = (order: G2ExchangeOrder) => {
    setQueueDrawer(null);
    openActionConfirm({
      action: `提交 KYC 复审 · ${order.exchangeNo}`,
      detail: <>将该兑换单送入 K5 大额/KYC 复审,服务端会更新兑换状态并写入复审票据。适用于实名状态、累计兑换或人工风控需要复核的排队单;确认后立即执行。</>,
      run: async (reason) => {
        await mutate(`kyc:${order.exchangeNo}`, () => triggerG2ExchangeKycReview(order.exchangeNo, reason, OPERATOR()), "KYC 复审已立即提交");
      },
    });
  };

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>G2 操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat"><div className="k">今日兑换成交</div><div className="v">{fmtUsdK(stats.todayUsd)}</div><div className="sub">占平台日池 {stats.poolPct}%</div></div>
        <div className="f-stat warn"><div className="k">次日队列深度</div><div className="v">{fmtCount(stats.queueDepth)} 单</div><div className="sub">超 cap 排队 · 可取消</div></div>
        <div className="f-stat"><div className="k">今日拦截</div><div className="v">{fmtCount(totalGate)} 次</div><div className="sub">实名 {stats.gateKyc} · 单用户 {stats.gateUser} · 平台 {stats.gatePlatform} · 地域 {stats.gateGeo}</div></div>
        <div className="f-stat danger"><div className="k">swap 全局熔断</div><div className="v">{swap.enabled ? "未启用" : "已熔断"}</div><div className="sub">监管点名时一键停 · 联动 {swap.linkedDomain}</div></div>
      </div>

      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">三道额度线 + 费率</span>
            <span className="sub">· 放宽要操作确认 + 过红线</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {caps.map((cap) => (
              <div className="cap-row" key={cap.key}>
                <div className="txt">
                  <div className="k">{cap.name}</div>
                  <div className="s">{cap.sub}</div>
                  {cap.meterPct !== undefined && <div className="meter"><i style={{ width: meterWidth(cap.meterPct), background: "var(--warning)" }} /></div>}
                </div>
                <span className="v">{cap.displayValue}</span>
                {allowed(capAuthority(cap.key)) && <button className="l-btn sm mc" disabled={busy || (!swap.enabled && !["fee", "feeMin"].includes(cap.key))}
                  title={!swap.enabled && !["fee", "feeMin"].includes(cap.key) ? "swap 已熔断；额度与队列策略暂不可调整" : undefined}
                  onClick={() => adjCap(cap)}>调整 {cap.name}</button>}
              </div>
            ))}
            <div className="gtint" style={{ marginTop: 10 }}><b>手续费去向</b> · 当前推广期取后端配置;开费后兑换抽成里 30% 进 NEX 回购销毁池(G3),70% 进 fee_buffer 备付金(D1)。降费 = 放大流出,改动操作确认并留痕。</div>
            <div className="gtint" style={{ marginTop: 10 }}><b>实名触发线的归属</b> · 命中后联动实名台账(C4)升级复审;拦截单进「需实名」清单,过实名后自动放行。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">拦截命中与队列</span>
            <span className="sub">· 服务端拦截 + 数据库队列</span>
          </div>
          <div className="l-b">
            <div className="gate-tiles">
              {gateTiles.map((tile) => (
                <div className="t click" key={tile.key} onClick={() => setGateDrawer(tile.key)}>
                  <div className="k">{tile.label} <span className="more">看清单›</span></div>
                  <div className="v" style={tile.tone === "warn" ? { color: "var(--warning)" } : tile.tone === "danger" ? { color: "var(--danger)" } : undefined}>{fmtCount(tile.count)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>次日队列(超 cap 排队)</span>
              {allowed("finprod_g2_write") && <button className="l-btn sm mc" disabled={busy || queue.length === 0} onClick={() => openActionConfirm({
                action: "处理今日兑换队列批次",
                detail: <>按服务器实时 G3 价格、G2 caps、C4 KYC、J2 地域和钱包余额逐单重新校验;同一事务写订单、钱包、D4 账本及 exchange.swapped 事件。</>,
                edit: { kind: "number", current: String(Math.min(queue.length, 50)), min: 1, max: 100, step: 1 },
                run: async (reason, value) => mutate("queue:batch", () => processG2ExchangeQueue(Number(value || 50), reason, OPERATOR()), "今日队列批次处理完成"),
              })}>处理今日批次</button>}
            </div>
            {queue.length === 0 && <div className="gtint">暂无排队兑换单。</div>}
            {queue.map((order) => (
              <div className="q-row click" key={order.exchangeNo} onClick={() => setQueueDrawer(order.exchangeNo)} style={busy ? { pointerEvents: "none", opacity: 0.65 } : undefined}>
                <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{order.userNo} <span className="more">详情›</span></span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{order.directionLabel}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{order.amountUsdtDisplay}</span>
                <span style={{ flex: 1, fontSize: 12, color: "var(--ink-4)" }}>{order.gateReason}</span>
                <span className="bdg warn">{order.etaLabel} 处理</span>
              </div>
            ))}
            <div className="gtint" style={{ marginTop: 10 }}><b>排队 vs 拒绝</b> · 默认超 cap 进次日队列(用户可在到期前取消),也可改成直接拒绝。排队阶段不扣用户余额;地域封锁后,该国已在队列里的单子转取消,不会发生后续成交。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全局熔断与地域封锁</span>
          <span className="sub">· 监管点名 / 合规事件时止血 · 联动 J1 矩阵</span>
          <div className="r">
            {swap.enabled && allowed("finprod_g2_swap_toggle") && <button className="l-btn mc" disabled={busy} onClick={toggleSwap}>swap 全局熔断(立即执行)</button>}
            {!swap.enabled && <Link href="/emergency/kill-switch" className="l-btn mc">前往 J1 核验并恢复 →</Link>}
            <Link href="/emergency/geo-block" className="l-btn">地域封锁(J2 权威)→</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="gtint"><b>地域封锁现状</b> · 当前封锁 {geoBlocked.length ? geoBlocked.map((row) => row.cc).join(" / ") : "无"}(J2 权威下发,本页只读)。封锁按边缘 IP 判定,命中的兑换归「被拦」(子类 geo-blocked),不另立终态;该国已在队列的单子转取消,且排队阶段本就不扣用户余额。</div>
        </div>
      </section>

      <p className="f-foot"><b>拦截判定 100% 在服务器</b>:三类拦截、实名校验都服务端执行,客户端改本地状态无效。<b>放宽额度受备付金红线强约束</b>:升单用户/平台日额度提交即验覆盖率,低于红线拒绝(422);收紧不受限。成交 exchange.swapped → 账本(D4)+ 资金池(D3,NEX→USDT 减 USDT 储备)。数据源: {overview.sources.join(" / ")}。</p>

      {gateDrawer && (() => {
        const detail = gateDetails[gateDrawer];
        return (
          <Drawer title={`拦截命中清单 · ${detail.title}`} sub={detail.note} onClose={() => setGateDrawer(null)}
            footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setGateDrawer(null)}>关闭</button>}>
            <table className="l-tbl">
              <thead><tr><th>用户编码</th><th>兑换单</th><th>金额</th><th>说明</th></tr></thead>
              <tbody>
                {detail.rows.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-3)", textAlign: "center", padding: 18 }}>暂无命中记录</td></tr>}
                {detail.rows.map((row) => (
                  <tr key={row.exchangeNo}>
                    <td className="mono">{row.userNo}</td>
                    <td className="mono">{row.exchangeNo}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{row.amountUsdtDisplay}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{row.gateReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · 拦截由服务端按额度线执行;要调额度去左侧参数,单用户豁免去信任名单(C2)。</div>
          </Drawer>
        );
      })()}

      {selectedQueue && (
        <Drawer title={`次日队列单 · ${selectedQueue.exchangeNo}`} sub={`${selectedQueue.userNo} · ${selectedQueue.exchangeAmountDisplay} · ${selectedQueue.etaLabel} 自动出队成交`} onClose={() => setQueueDrawer(null)}
          footer={<>
            {allowed("finprod_g2_write") && <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={() => triggerKycReview(selectedQueue)}>提交 KYC 复审</button>}
            {allowed("finprod_g2_queue_cancel") && <button className="l-btn mc" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={() => cancelQueue(selectedQueue)}>强制取消此单 →</button>}
          </>}>
          <div className="kv2"><span className="k">用户编码</span><span className="v mono">{selectedQueue.userNo}</span></div>
          <div className="kv2"><span className="k">用户名</span><span className="v">{selectedQueue.nickname}</span></div>
          <div className="kv2"><span className="k">方向</span><span className="v">{selectedQueue.directionLabel}</span></div>
          <div className="kv2"><span className="k">金额</span><span className="v mono">{selectedQueue.exchangeAmountDisplay}</span></div>
          <div className="kv2"><span className="k">排队原因</span><span className="v">{selectedQueue.gateReason}</span></div>
          <div className="kv2"><span className="k">预计成交</span><span className="v">{selectedQueue.etaLabel}</span></div>
          <div className="kv2"><span className="k">状态</span><span className="v"><span className={`bdg ${toneClass(selectedQueue.statusTone)}`}>{selectedQueue.statusLabel}</span></span></div>
          <div className="gtint" style={{ marginTop: 12 }}><b>处置</b> · 超 cap 排队 vs 直接拒绝的策略在额度区配;兑换真值与扣款在服务端原子执行。</div>
        </Drawer>
      )}
    </>
  );
}
