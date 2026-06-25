"use client";

/**
 * G2 兑换风控 — 数据来自后端 /api/admin/market/exchange。
 * 后端空库时先写入 nx_exchange_order 示例兑换单，再返回真实查询结果。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import {
  cancelG2ExchangeQueueOrder,
  fetchG2ExchangeOverview,
  updateG2ExchangeParam,
  updateG2ExchangeSwapStatus,
  type G2Cap,
  type G2ExchangeOrder,
  type G2Overview,
} from "@/lib/admin/g2-client";
import type { GCtx } from "./types";

const OPERATOR = "superadmin";
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
  const { toast, openActionConfirm, openConfirm } = ctx;
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
      edit: isQueueMode ? { kind: "select", current: cap.displayValue, options: ["排队", "拒绝"] } : { kind: "text", current: capEditValue(cap) },
      run: (reason, value) => {
        const nextValue = normalizeCapSubmitValue(cap, value);
        if (!nextValue) return;
        void mutate(
          `param-${cap.key}`,
          () => updateG2ExchangeParam(cap.key, nextValue, reason, OPERATOR),
          `${cap.name} 已更新为 ${value}`,
        );
      },
    });
  };

  const toggleSwap = () => {
    const nextEnabled = !swap.enabled;
    openActionConfirm({
      action: swap.enabled ? "swap 全局熔断" : "恢复 swap 兑换",
      detail: swap.enabled
        ? <>立即停止全平台所有 NEX↔USDT 兑换,用于监管点名/合规事件止血。风控/合规执行门槛:超管,同步紧急开关矩阵(J1 exchange 闸)。</>
        : <>恢复全平台兑换 = 恢复 NEX→USDT 流出,确认放行时核验 B1 覆盖率(当前 {cov}%,红线 {redline}%),同步 J1。</>,
      amplifies: nextEnabled,
      run: (reason) => {
        void mutate(
          "swap",
          () => updateG2ExchangeSwapStatus(nextEnabled, reason, OPERATOR),
          `swap 已${nextEnabled ? "恢复" : "熔断"} · 同步 J1`,
        );
      },
    });
  };

  const cancelQueue = (order: G2ExchangeOrder) => {
    setQueueDrawer(null);
    openConfirm({
      action: `强制取消排队单 · ${order.exchangeNo}`,
      detail: <>取消该兑换排队单,{order.exchangeAmountDisplay} 退回用户余额。常用于地域封锁/风控命中,写原因留痕。</>,
      chips: [["退回不锁死", "done"], ["落审计", "ready"]],
      reason: true,
      okLabel: "确认取消",
      run: (reason) => {
        void mutate(
          `cancel-${order.exchangeNo}`,
          () => cancelG2ExchangeQueueOrder(order.exchangeNo, reason, OPERATOR),
          `${order.exchangeNo} 排队单已取消 · 退回余额 · 留痕`,
        );
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
                <button className="l-btn sm mc" disabled={busy} onClick={() => adjCap(cap)}>调整</button>
              </div>
            ))}
            <div className="cap-row">
              <div className="txt">
                <div className="k">累计实名触发线 <span className="bdg dim">K5 权威(V1)</span></div>
                <div className="s">终身累计兑换过线就要实名 · V1 阶段在大额复审(K5)配,这里只读;V3 落地后移交 G2</div>
              </div>
              <span className="v">$100</span>
              <Link href="/risk/kyc-review" className="l-btn sm">去 K5 调整 →</Link>
            </div>
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
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>次日队列(超 cap 排队)</div>
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
            <div className="gtint" style={{ marginTop: 10 }}><b>排队 vs 拒绝</b> · 默认超 cap 进次日队列(用户可在到期前取消),也可改成直接拒绝。地域封锁后,该国已在队列里的单子转取消,钱退回不锁死。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全局熔断与地域封锁</span>
          <span className="sub">· 监管点名 / 合规事件时止血 · 联动 J1 矩阵</span>
          <div className="r">
            <button className="l-btn mc" disabled={busy} onClick={toggleSwap}>{swap.enabled ? "swap 全局熔断(操作确认)" : "恢复 swap(操作确认)"}</button>
            <Link href="/emergency/geo-block" className="l-btn">地域封锁(J2 权威)→</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="gtint"><b>地域封锁现状</b> · 当前封锁 {geoBlocked.length ? geoBlocked.map((row) => row.cc).join(" / ") : "无"}(J2 权威下发,本页只读)。封锁按边缘 IP 判定,命中的兑换归「被拦」(子类 geo-blocked),不另立终态;该国已在队列的单子转取消、退回不锁死。</div>
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
          footer={<button className="l-btn mc" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={() => cancelQueue(selectedQueue)}>强制取消此单 →</button>}>
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
