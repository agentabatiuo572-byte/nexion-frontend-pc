"use client";

/**
 * G2 兑换风控 — NEX→USDT 流出闸门:三阈值 caps + 费率(当前免费推广期)+ 三类拦截 + 次日队列
 * + swap 全局熔断(J.killswitch.exchange 与 J1 同键真联动)+ 地域封锁(GEOBLOCK J2 权威只读)。
 * 放宽 caps/降费 = 放大流出过 B1 红线;累计实名线 V1 权威在 K5(只读 + 真 Link)。
 */
import { useState } from "react";
import Link from "next/link";
import { Drawer } from "../design-kit";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { GEOBLOCK } from "@/lib/mock/admin/design-data";
import { G2_CAPS, G2_STATS, G2_QUEUE, G2_GATE_DETAIL } from "./data";
import type { GCtx } from "./types";

export function G2Exchange({ ctx }: { ctx: GCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [gateDrawer, setGateDrawer] = useState<string | null>(null);
  const [queueDrawer, setQueueDrawer] = useState<number | null>(null);
  const cov = LEDGER.coverageRatio.toFixed(1);

  const swapOn = (pget("J.killswitch.exchange") ?? "on") === "on";
  const cancelled = (i: number) => pget(`G.exchange.queue.${i}`) === "cancelled";
  const queueLive = G2_QUEUE.filter((_, i) => !cancelled(i));
  // 地域封锁 = J2 GEOBLOCK 权威(blocked 态国家),G2 只读引用
  const geoBlocked = GEOBLOCK.filter((g) => g.status === "blocked").map((g) => g.cc);

  const adjCap = (c: (typeof G2_CAPS)[number]) => {
    const cur = pget(`G.exchange.${c.key}`) ?? c.cur;
    const isQueueMode = c.key === "queueMode";
    openActionConfirm({
      action: `兑换${isQueueMode ? "队列策略" : "额度"}调整 · ${c.name}`,
      detail: <><b>{c.name}</b> · 当前 {cur} · {c.note}。{c.loosen ? <>放宽是放大 USDT 流出,确认放行时服务器验备付金覆盖率红线(当前 {cov}% &gt; {LEDGER.redlinePct});收紧不受限。</> : isQueueMode ? <>从「排队」改为「拒绝」= 收紧方向(超 cap 用户立即被拒,资金不锁死)。执行门槛:运营主管(`admin.exchange_queue_config_changed`)。</> : "随费率启用生效。"}</>,
      amplifies: c.loosen,
      edit: { kind: "text", current: cur },
      run: (reason, v) => { if (v) setParam(`G.exchange.${c.key}`, v, { action: `兑换${isQueueMode ? "队列策略" : "额度"}调整 ${c.name}`, reason }); toast(`${c.name} 已更新为 ${v}`); },
    });
  };
  const pauseSwap = () => openActionConfirm({
    action: swapOn ? "swap 全局熔断" : "恢复 swap 兑换",
    detail: swapOn
      ? <>立即停止全平台所有 NEX↔USDT 兑换,用于监管点名/合规事件止血。风控/合规执行门槛:超管,同步紧急开关矩阵(J1 exchange 闸)。</>
      : <>恢复全平台兑换 = 恢复 NEX→USDT 流出,确认放行时核验 B1 覆盖率(当前 {cov}%),同步 J1。</>,
    amplifies: !swapOn,
    run: (reason) => { setParam("J.killswitch.exchange", swapOn ? "off" : "on", { action: swapOn ? "swap 全局熔断" : "swap 恢复", reason }); toast(`swap 已${swapOn ? "熔断" : "恢复"} · 同步 J1`); },
  });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">今日兑换成交</div><div className="v">${(G2_STATS.todayUsd / 1000).toFixed(1)}K</div><div className="sub">占平台日池 {G2_STATS.poolPct}%</div></div>
        <div className="f-stat warn"><div className="k">次日队列深度</div><div className="v">{G2_STATS.queueDepth} 单</div><div className="sub">超 cap 排队 · 可取消</div></div>
        <div className="f-stat"><div className="k">今日拦截</div><div className="v">{G2_STATS.gateKyc + G2_STATS.gateUser + G2_STATS.gatePlatform} 次</div><div className="sub">实名 {G2_STATS.gateKyc} · 单用户超限 {G2_STATS.gateUser} · 平台超限 {G2_STATS.gatePlatform}</div></div>
        <div className="f-stat danger"><div className="k">swap 全局熔断</div><div className="v">{swapOn ? "未启用" : "已熔断"}</div><div className="sub">监管点名时一键停 · 联动 J1</div></div>
      </div>

      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">三道额度线 + 费率</span>
            <span className="sub">· 放宽要操作确认 + 过红线</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {G2_CAPS.map((c) => (
              <div className="cap-row" key={c.key}>
                <div className="txt">
                  <div className="k">{c.name}</div>
                  <div className="s">{c.sub}</div>
                  {c.meterPct !== undefined && <div className="meter"><i style={{ width: `${c.meterPct}%`, background: "var(--warning)" }} /></div>}
                </div>
                <span className="v">{pget(`G.exchange.${c.key}`) ?? c.cur}</span>
                <button className="l-btn sm mc" onClick={() => adjCap(c)}>调整</button>
              </div>
            ))}
            <div className="cap-row">
              <div className="txt">
                <div className="k">累计实名触发线 <span className="bdg dim">🔒 K5 权威(V1)</span></div>
                <div className="s">终身累计兑换过线就要实名 · V1 阶段在大额复审(K5)配,这里只读;V3 落地后移交 G2</div>
              </div>
              <span className="v">$100</span>
              <Link href="/risk/kyc-review" className="l-btn sm">去 K5 调整 →</Link>
            </div>
            <div className="gtint" style={{ marginTop: 10 }}><b>手续费去向</b> · 当前免费推广期(费率 0%,对齐用户端「Fee: Free」);开费后兑换抽成里 30% 进 NEX 回购销毁池(对应行情引擎 G3 的回购量)、70% 进 fee_buffer 备付金(D1)。降费 = 放大流出,改动操作确认并留痕。</div>
            <div className="gtint" style={{ marginTop: 10 }}><b>实名触发线的归属</b> · 命中后联动实名台账(C4)升级复审;拦截单进「需实名」清单,过实名后自动放行。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">拦截命中与队列</span>
            <span className="sub">· 三类拦截 + 次日队列</span>
          </div>
          <div className="l-b">
            <div className="gate-tiles">
              <div className="t click" onClick={() => setGateDrawer("kyc")}><div className="k">需实名(kyc-required) <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--warning)" }}>{G2_STATS.gateKyc}</div></div>
              <div className="t click" onClick={() => setGateDrawer("user")}><div className="k">单用户超限(user-cap) <span className="more">看清单›</span></div><div className="v">{G2_STATS.gateUser}</div></div>
              <div className="t click" onClick={() => setGateDrawer("platform")}><div className="k">平台超限(platform-cap) <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--danger)" }}>{G2_STATS.gatePlatform}</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>次日队列(超 cap 排队)</div>
            {G2_QUEUE.map((q, i) => cancelled(i) ? (
              <div className="q-row" key={i} style={{ opacity: 0.5 }}>
                <span className="mono" style={{ fontWeight: 600 }}>{q[0]}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{q[1]}</span>
                <span className="mono" style={{ fontWeight: 700, textDecoration: "line-through" }}>{q[2]}</span>
                <span style={{ flex: 1 }} /><span className="bdg dim">已取消 · 退回余额</span>
              </div>
            ) : (
              <div className="q-row click" key={i} onClick={() => setQueueDrawer(i)}>
                <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{q[0]} <span className="more">详情›</span></span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{q[1]}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{q[2]}</span>
                <span style={{ flex: 1, fontSize: 12, color: "var(--ink-4)" }}>{q[3]}</span>
                <span className="bdg warn">{q[4]} 处理</span>
              </div>
            ))}
            <div className="gtint" style={{ marginTop: 10 }}><b>排队 vs 拒绝</b> · 默认超 cap 进次日队列(用户可在到期前取消),也可改成直接拒绝。新增地域封锁后,该国已在队列里的单子转取消(不继续成交),钱退回不锁死。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全局熔断与地域封锁</span>
          <span className="sub">· 监管点名 / 合规事件时止血 · 联动 J1 矩阵</span>
          <div className="r">
            <button className="l-btn mc" onClick={pauseSwap}>{swapOn ? "swap 全局熔断(操作确认)" : "恢复 swap(操作确认)"}</button>
            <Link href="/emergency/geo-block" className="l-btn">地域封锁(J2 权威)→</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="gtint"><b>地域封锁现状</b> · 当前封锁 {geoBlocked.length ? geoBlocked.join(" / ") : "无"}(制裁名单,J2 权威下发,本页只读)。封锁按边缘 IP 判定,命中的兑换归「被拦」(子类 geo-blocked),不另立终态;该国已在队列的单子转取消、退回不锁死。封锁清单调整去 J2,与全局熔断由紧急开关矩阵(J1)统一编排。</div>
        </div>
      </section>

      <p className="f-foot"><b>拦截判定 100% 在服务器</b>:三类拦截、实名校验都服务端执行,客户端把本地实名状态改成「已验证」无效——兑换接口会二次核验。<b>放宽额度受备付金红线强约束</b>:升单用户/平台日额度提交即验覆盖率,低于红线拒绝(422);收紧不受限。累计兑换过实名线 → 联动 K5 复审 + C4 台账;成交 <b>exchange.swapped</b> → 账本(D4)+ 资金池(D3,NEX→USDT 减 USDT 储备)。NEX 兑换报价取行情引擎(G3)的服务端现价,不接受客户端传价。</p>

      {gateDrawer && (() => { const M = G2_GATE_DETAIL[gateDrawer]; return (
        <Drawer title={`拦截命中清单 · ${M.t}`} sub={M.n} onClose={() => setGateDrawer(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setGateDrawer(null)}>关闭</button>}>
          <table className="l-tbl">
            <thead><tr><th>用户</th><th>金额</th><th>说明</th></tr></thead>
            <tbody>{M.r.map((r) => (
              <tr key={r[0]}><td className="mono">{r[0]}</td><td className="mono" style={{ fontWeight: 700 }}>{r[1]}</td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{r[2]}</td></tr>
            ))}</tbody>
          </table>
          <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · 拦截由服务端按额度线执行;要调额度去左侧参数,单用户豁免去信任名单(C2)。</div>
        </Drawer>
      ); })()}
      {queueDrawer !== null && (() => { const q = G2_QUEUE[queueDrawer]; return (
        <Drawer title={`次日队列单 · ${q[0]}`} sub={`${q[1]} · ${q[2]} · 超${q[3]},${q[4]} 自动出队成交`} onClose={() => setQueueDrawer(null)}
          footer={<button className="l-btn mc" style={{ flex: 1, justifyContent: "center" }} onClick={() => {
            const i = queueDrawer;
            setQueueDrawer(null);
            openConfirm({
              action: `强制取消排队单 · ${q[0]}`,
              detail: <>取消该兑换排队单,{q[2]} 退回用户余额(本未扣款,不锁死)。常用于地域封锁/风控命中。写原因留痕。</>,
              chips: [["退回不锁死", "done"], ["落审计", "ready"]], reason: true, okLabel: "确认取消",
              run: (reason) => { setParam(`G.exchange.queue.${i}`, "cancelled", { action: `强制取消兑换排队单 ${q[0]}`, reason }); toast(`${q[0]} 排队单已取消 · 退回余额 · 留痕`); },
            });
          }}>强制取消此单 →</button>}>
          <div className="kv2"><span className="k">用户</span><span className="v mono">{q[0]}</span></div>
          <div className="kv2"><span className="k">方向</span><span className="v">{q[1]}</span></div>
          <div className="kv2"><span className="k">金额</span><span className="v mono">{q[2]}</span></div>
          <div className="kv2"><span className="k">排队原因</span><span className="v">{q[3]}</span></div>
          <div className="kv2"><span className="k">预计成交</span><span className="v">{q[4]}</span></div>
          <div className="kv2"><span className="k">状态</span><span className="v">queued · 未扣款(出队才成交)</span></div>
          <div className="gtint" style={{ marginTop: 12 }}><b>处置</b> · 超 cap 排队 vs 直接拒绝的策略在额度区配;兑换真值与扣款在服务端原子执行。</div>
        </Drawer>
      ); })()}
    </>
  );
}
