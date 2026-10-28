"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * G2 兑换风险规则 — 数据来自后端 /api/admin/market/exchange;空库返回空态。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import {
  cancelG2ExchangeQueueOrder,
  fetchG2ExchangeOverview,
  processG2ExchangeQueue,
  updateG2ExchangeParam,
  updateG2ExchangeSwapStatus,
  type G2Cap,
  type G2ExchangeOrder,
  type G2Overview,
} from "@/lib/admin/g2-client";
import type { GCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { classifyStableMutationFailure } from "@/lib/admin/stable-mutation";
import { summarizeG2BatchResult, type G2BatchResult } from "@/lib/admin/g2-batch-result";

const OPERATOR = currentAdminOperator;
type GateKey = "user" | "platform" | "geo";

function messageOf(error: unknown) {
  return displayAdminError(error);
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
  const [batchResult, setBatchResult] = useState<G2BatchResult | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      setOverview(await fetchG2ExchangeOverview());
    } catch (err) {
      setOverview(null);
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
        if (!cancelled) {
          setOverview(next);
        }
      } catch (err) {
        if (!cancelled) {
          setOverview(null);
          setError(messageOf(err));
        }
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
      toast(`操作失败 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  const processQueueBatch = useCallback(async (limit: number, reason: string) => {
    setBusyKey("queue:batch");
    setError("");
    setBatchResult(null);
    try {
      const result = await processG2ExchangeQueue(limit, reason, OPERATOR());
      setOverview(result.overview);
      setBatchResult(result.batch);
      toast(summarizeG2BatchResult(result.batch));
    } catch (err) {
      const unknown = classifyStableMutationFailure(err) === "outcome-unknown";
      if (unknown) {
        try {
          setOverview(await fetchG2ExchangeOverview());
        } catch {
          // POST 的原始错误仍是主证据；回读失败不能改写成确定失败。
        }
        const message = "处理结果暂未确认。请在当前确认框直接重试（沿用同一命令号），不会重复处理。";
        setError(message);
        toast(message);
        throw new Error(message);
      }
      const message = messageOf(err);
      setError(message);
      toast(`批次没有处理 · ${message}`);
      throw err;
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">兑换规则</span><span className="sub">· 加载中</span></div>
        <div className="l-b"><div className="gtint">兑换数据加载中…</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">兑换规则</span></div>
        <div className="l-b">
          <div className="gtint">兑换数据加载失败 · {error || "没有收到数据，请重试；一直失败请联系值班同事。"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const { stats, coverage, swap, caps, queue, gateDetails, geoBlocked } = overview;
  const busy = !!busyKey;
  const cov = coverage.coverageRatio.toFixed(1);
  const redline = coverage.redlinePct.toFixed(1);
  const totalGate = stats.gateUser + stats.gatePlatform + stats.gateGeo;
  const selectedQueue = queueDrawer ? queue.find((row) => row.exchangeNo === queueDrawer) : null;
  const gateTiles: { key: GateKey; label: string; count: number; tone?: "warn" | "danger" }[] = [
    { key: "user", label: "个人额度超限", count: stats.gateUser },
    { key: "platform", label: "平台额度超限", count: stats.gatePlatform, tone: "danger" },
    { key: "geo", label: "地域封锁", count: stats.gateGeo, tone: "danger" },
  ];

  const adjCap = (cap: G2Cap) => {
    const isQueueMode = cap.key === "queueMode";
    openActionConfirm({
      action: `调整兑换${isQueueMode ? "超额处理方式" : "参数"} · ${operatorCopyText(cap.name)}`,
      detail: <>
        <b>{operatorCopyText(cap.name)}</b> · 当前 {cap.displayValue} · {operatorCopyText(cap.note)}。
        <div className="gtint" data-proof="g2-cap-preview" style={{ marginTop: 10 }}>
          <div><b>影响预览</b></div>
          <div>额度已用：{cap.meterPct !== undefined ? `${cap.meterPct}%` : "—"} · 今日已兑换 {fmtUsdK(stats.todayUsd)}（占平台每日额度 {stats.poolPct}%）</div>
          <div>排队到明天：{fmtCount(stats.queueDepth)} 单 · 今日超额拦截 {fmtCount(stats.gateUser + stats.gatePlatform)} 次</div>
          <div>调高额度：更多兑换马上成交，排队变少。调低额度：更多兑换要排队或被拒绝，USDT 流出变少。</div>
          <div>兑付覆盖率：{cov}% · 红线 {redline}%</div>
        </div>
        {cap.loosen
          ? <>放宽额度会让更多 USDT 流出，覆盖率低于红线时无法保存；收紧不受限制。</>
          : isQueueMode
            ? <>从「排队」改成「拒绝」是收紧。需要运营主管操作。</>
            : "保存后马上生效。"}
      </>,
      amplifies: cap.loosen,
      edit: isQueueMode
        ? { kind: "select", current: cap.displayValue, options: ["排队", "拒绝"] }
        : { kind: "number", current: capEditValue(cap), min: 0,
            max: cap.key === "userDailyCap" ? 10000 : cap.key === "platformDailyCap" ? 10000000 : cap.key === "fee" ? 10 : cap.key === "feeMin" ? 5 : 1000000,
            step: cap.key === "fee" ? 0.01 : 0.1 },
      run: async (reason, value) => {
        const nextValue = normalizeCapSubmitValue(cap, value);
        if (!nextValue) return;
        await mutate(`param:${cap.key}`, () => updateG2ExchangeParam(cap.key, nextValue, reason, OPERATOR()), `${operatorCopyText(cap.name)}已立即生效`);
      },
    });
  };

  const toggleSwap = () => {
    if (!swap.enabled) return;
    openActionConfirm({
      action: "紧急暂停全部兑换",
      detail: <>马上停止全平台所有 UVT↔USDT 兑换，并同步到「紧急停用开关」。恢复要去「紧急停用开关」页面操作。</>,
      amplifies: false,
      businessForm: { kind: "multi-field", title: "暂停原因", fields: [
        { key: "triggerBasis", label: "原因", current: "PRICE_ANOMALY", inputKind: "select", options: ["REGULATORY", "PRICE_ANOMALY", "SECURITY_INCIDENT", "OTHER"], optionLabels: { REGULATORY: "监管要求", PRICE_ANOMALY: "价格异常", SECURITY_INCIDENT: "安全事件", OTHER: "其他" }, required: true },
        { key: "geoBlock", label: "涉及国家（可选，用逗号分隔）", current: "", inputKind: "text", required: false },
      ] },
      run: async (reason, _value, businessValue) => {
        const countries = (businessValue?.geoBlock ?? "").split(",").map((value) => value.trim()).filter(Boolean);
        await mutate("swap:pause", () => updateG2ExchangeSwapStatus(false, reason, OPERATOR(), {
          geoBlock: countries, triggerBasis: businessValue?.triggerBasis,
        }), "兑换已紧急暂停");
      },
    });
  };

  const cancelQueue = (order: G2ExchangeOrder) => {
    setQueueDrawer(null);
    openActionConfirm({
      action: `取消排队中的兑换 · ${order.exchangeNo}`,
      detail: <>取消这笔排队中的兑换，冻结的 {order.exchangeAmountDisplay} 会原路退回用户钱包，之后不会再成交。常用于地区封锁或风险命中，确认后马上执行。</>,
      run: async (reason) => {
        await mutate(`cancel:${order.exchangeNo}`, () => cancelG2ExchangeQueueOrder(order.exchangeNo, reason, OPERATOR()), "已取消");
      },
    });
  };

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat"><div className="k">今日兑换成交</div><div className="v">{fmtUsdK(stats.todayUsd)}</div><div className="sub">占平台每日额度 {stats.poolPct}%</div></div>
        <div className="f-stat warn"><div className="k">排队到明天</div><div className="v">{fmtCount(stats.queueDepth)} 单</div><div className="sub">超出额度的兑换 · 可取消</div></div>
        <div className="f-stat"><div className="k">今日拦截</div><div className="v">{fmtCount(totalGate)} 次</div><div className="sub">个人 {stats.gateUser} · 平台 {stats.gatePlatform} · 地区 {stats.gateGeo}</div></div>
        <div className="f-stat danger"><div className="k">兑换紧急暂停</div><div className="v">{swap.enabled ? "未暂停" : "已暂停"}</div><div className="sub">出现监管或安全事件时一键停</div></div>
      </div>

      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">兑换额度与手续费</span>
            <span className="sub">· 放宽额度要求覆盖率不低于红线</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {caps.map((cap) => (
              <div className="cap-row" key={cap.key}>
                <div className="txt">
                  <div className="k">{operatorCopyText(cap.name)}</div>
                  <div className="s">{operatorCopyText(cap.sub)}</div>
                  {cap.meterPct !== undefined && <div className="meter"><i style={{ width: meterWidth(cap.meterPct), background: "var(--warning)" }} /></div>}
                </div>
                <span className="v">{cap.displayValue}</span>
                {allowed(capAuthority(cap.key)) && <button className="l-btn sm mc" disabled={busy || (!swap.enabled && !["fee", "feeMin"].includes(cap.key))}
                  title={!swap.enabled && !["fee", "feeMin"].includes(cap.key) ? "兑换已紧急暂停，额度和超额处理方式暂时不能改" : undefined}
                  onClick={() => adjCap(cap)}>调整 {operatorCopyText(cap.name)}</button>}
              </div>
            ))}
            <div className="gtint" style={{ marginTop: 10 }}><b>手续费去向</b> · 推广期按当前设置收费。收费后 30% 用于 UVT 回购销毁，70% 进入兑付储备。降低手续费会少收钱。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">拦截与排队</span>
            <span className="sub">· 超额或被封锁的兑换</span>
          </div>
          <div className="l-b">
            <div className="gate-tiles">
              {gateTiles.map((tile) => (
                <div className="t click" key={tile.key} onClick={() => setGateDrawer(tile.key)}>
                  <div className="k">{operatorCopyText(tile.label)} <span className="more">看清单›</span></div>
                  <div className="v" style={tile.tone === "warn" ? { color: "var(--warning)" } : tile.tone === "danger" ? { color: "var(--danger)" } : undefined}>{fmtCount(tile.count)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>排队到明天的兑换</span>
              {allowed("finprod_g2_write") && <button className="l-btn sm mc" disabled={busy || queue.length === 0} onClick={() => openActionConfirm({
                action: "处理今天的排队兑换",
                detail: <>按当前 UVT 价格、每日额度、地区封锁和用户余额逐单检查，符合条件的马上成交。</>,
                edit: { kind: "number", current: String(Math.min(queue.length, 50)), min: 1, max: 100, step: 1 },
                run: async (reason, value) => processQueueBatch(Number(value || 50), reason),
              })}>处理今天的排队</button>}
            </div>
            {batchResult && (
              <div className="gtint" data-proof="g2-batch-result" style={{ marginBottom: 12 }}>
                <div><b>处理结果 · {summarizeG2BatchResult(batchResult)}</b></div>
                {batchResult.completed.length > 0 && <div>已成交：{batchResult.completed.map((row) => `${row.exchangeNo} · 已成交`).join(" / ")}</div>}
                {batchResult.skipped.length > 0 && <div><b>跳过</b>：{batchResult.skipped.map((row) => `${row.exchangeNo} · ${row.reason} · 订单${row.orderStatus === "CANCELLED" ? "已取消" : "仍在队列"}`).join("; ")}</div>}
                {batchResult.failed.length > 0 && <div><b>失败</b>：{batchResult.failed.map((row) => `${row.exchangeNo} · ${row.reason} · 订单仍在队列`).join("; ")}</div>}
                <div>还在排队：{batchResult.remainingQueuedCount} 单。</div>
                <div>列表已刷新。</div>
              </div>
            )}
            {queue.length === 0 && <div className="gtint">没有排队中的兑换。</div>}
            {queue.map((order) => (
              <div className="q-row click" key={order.exchangeNo} onClick={() => setQueueDrawer(order.exchangeNo)} style={busy ? { pointerEvents: "none", opacity: 0.65 } : undefined}>
                <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{order.userNo} <span className="more">详情›</span></span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{operatorCopyText(order.directionLabel)}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{order.amountUsdtDisplay}</span>
                <span style={{ flex: 1, fontSize: 12, color: "var(--ink-4)" }}>{order.gateReason}</span>
                <span className="bdg warn">{order.etaLabel} 处理</span>
              </div>
            ))}
            <div className="gtint" style={{ marginTop: 10 }}><b>排队与拒绝</b> · 超出额度的兑换默认排到明天（用户可以自己取消），也可以改成直接拒绝。排队时不扣用户余额；某个国家被封锁后，该国排队中的兑换会自动取消。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">紧急暂停与地区封锁</span>
          <span className="sub">· 出现监管或合规事件时使用</span>
          <div className="r">
            {swap.enabled && allowed("finprod_g2_swap_toggle") && <button className="l-btn mc" disabled={busy} onClick={toggleSwap}>紧急暂停全部兑换</button>}
            {!swap.enabled && <Link href="/emergency/kill-switch" className="l-btn mc">去「紧急停用开关」恢复 →</Link>}
            <Link href="/emergency/geo-block" className="l-btn">地区访问限制 →</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="gtint"><b>当前封锁的地区</b> · {geoBlocked.length ? geoBlocked.map((row) => row.cc).join(" / ") : "无"}（在「地区访问限制」页修改，这里只能查看）。按用户 IP 判断，被封锁地区的兑换会被拦截；已在排队的会自动取消。</div>
        </div>
      </section>

      <p className="f-foot">额度、地区和风险拦截都由系统自动执行。<b>放宽额度要求覆盖率不低于红线</b>：调高个人或平台每日额度时，覆盖率低于红线无法保存；收紧不受限制。成交后自动记入资金账本。</p>
      <details className="f-foot"><summary>技术信息（数据来源）</summary>{overview.sources.join(" / ")} · exchange.swapped</details>

      {gateDrawer && (() => {
        const detail = gateDetails[gateDrawer];
        return (
          <Drawer title={`拦截记录 · ${detail.title}`} sub={detail.note} onClose={() => setGateDrawer(null)}
            footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setGateDrawer(null)}>关闭</button>}>
            <table className="l-tbl">
              <thead><tr><th>用户编码</th><th>兑换单</th><th>金额</th><th>说明</th></tr></thead>
              <tbody>
                {detail.rows.length === 0 && <tr><td colSpan={4} style={{ color: "var(--ink-3)", textAlign: "center", padding: 18 }}>暂无拦截记录</td></tr>}
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
            <div className="gtint" style={{ marginTop: 12 }}><b>只能查看</b> · 要调额度用左侧参数；要给某个用户放行，去「账户操作」的信任名单。</div>
          </Drawer>
        );
      })()}

      {selectedQueue && (
        <Drawer title={`排队中的兑换 · ${selectedQueue.exchangeNo}`} sub={`${selectedQueue.userNo} · ${operatorCopyText(selectedQueue.exchangeAmountDisplay)} · ${selectedQueue.etaLabel} 自动成交`} onClose={() => setQueueDrawer(null)}
          footer={<>
            {allowed("finprod_g2_queue_cancel") && <button className="l-btn mc" style={{ flex: 1, justifyContent: "center" }} disabled={busy} onClick={() => cancelQueue(selectedQueue)}>取消这笔兑换 →</button>}
          </>}>
          <div className="kv2"><span className="k">用户编码</span><span className="v mono">{selectedQueue.userNo}</span></div>
          <div className="kv2"><span className="k">用户名</span><span className="v">{operatorNicknameText(selectedQueue.nickname)}</span></div>
          <div className="kv2"><span className="k">方向</span><span className="v">{operatorCopyText(selectedQueue.directionLabel)}</span></div>
          <div className="kv2"><span className="k">金额</span><span className="v mono">{operatorCopyText(selectedQueue.exchangeAmountDisplay)}</span></div>
          <div className="kv2"><span className="k">排队原因</span><span className="v">{selectedQueue.gateReason}</span></div>
          <div className="kv2"><span className="k">预计成交</span><span className="v">{selectedQueue.etaLabel}</span></div>
          <div className="kv2"><span className="k">状态</span><span className="v"><span className={`bdg ${toneClass(selectedQueue.statusTone)}`}>{operatorCopyText(selectedQueue.statusLabel)}</span></span></div>
          <div className="gtint" style={{ marginTop: 12 }}><b>说明</b> · 超额时排队还是直接拒绝，在左侧额度区设置。</div>
        </Drawer>
      )}
    </>
  );
}
