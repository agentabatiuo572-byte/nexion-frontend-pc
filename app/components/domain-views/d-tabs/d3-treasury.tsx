"use client";

/**
 * D3 资金池水位仪表盘 — 储备/负债明细的底层账本权威页(§3.14)。
 * 数字全部 LEDGER/LIABILITIES/MATURITY 单源派生(B1 分子 / B2 概览 / B5 挤兑分母引用同账);
 * 本页不算覆盖率(裁决归 B1);注资登记是全后台唯一 server 实现(B1 仅 UI 入口);
 * 口径开关日批生效(UTC 00:00 不追溯);压力测试层默认 OFF 不进覆盖率分母。
 */
import { useState } from "react";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { LIABILITIES, MATURITY, MAT_7D, RESERVE_COVER_DAYS, TREASURY, fmtM } from "@/lib/mock/admin/design-data";
import { RESERVE_ROWS, LIAB_META, STRESS_DAILY_USD, DAILY_DUE_ALERT_USD } from "./data";
import type { DCtx } from "./types";

const LIAB_TOTAL = LIABILITIES.reduce((s, l) => s + l.amount, 0);

export function D3HeaderActions({ ctx }: { ctx: DCtx }) {
  const { setParam, logAudit, toast, openActionConfirm, openConfirm } = ctx;
  return (
    <>
      <button className="f-cta" onClick={() => openConfirm({
        action: "对账导出",
        detail: "内容:储备 vs 负债快照、8 类科目分解、到期预测、净敞口序列(CSV)。全部为聚合金额,无用户明细。",
        okLabel: "导出",
        run: () => { logAudit({ actor: "总管理员", action: "对账导出(储备 vs 负债全量快照 CSV)", target: "D3-reconciliation" }); toast("对账快照已导出 · 落审计"); },
      })}>对账导出</button>
      <button className="l-btn mc" onClick={() => openActionConfirm({
        action: "手动储备注入登记",
        detail: <>登记平台向储备账本注资的事实(链上或银行入账<b>凭证号必须写进原因</b>)。<b>只记账,不触发任何用户侧资金动作</b>;带防重号,同一笔凭证不会登记两次。这是该登记在全后台的唯一入口实现,双账本页(B1)上的按钮也调到这里。</>,
        edit: { kind: "text", current: "—", unit: "USDT" },
        run: (reason, v) => { if (v) setParam("D.reserveInjection", v, { action: `储备注入登记 ${v} USDT`, reason }); toast(`储备注入 ${v ?? ""} USDT 已确认生效 · 凭证留痕`); },
      })}>+ 储备注入登记(操作确认)</button>
    </>
  );
}

export function D3Treasury({ ctx }: { ctx: DCtx }) {
  const { setParam, logAudit, toast, openActionConfirm, openConfirm } = ctx;
  const [win, setWin] = useState<"7d" | "30d">("7d");
  const [stress, setStress] = useState(false);
  const [expWin, setExpWin] = useState("30d");

  const lmax = Math.max(...LIABILITIES.map((l) => l.amount));
  const dailyAvg = (MAT_7D.withdraw + MAT_7D.interest + MAT_7D.genesis) / 7;

  /* 到期预测柱图(7d 真值;30d 以 7d 序列波动延拓,仅视图) */
  const days = win === "7d" ? 7 : 30;
  const colors = ["var(--success)", "#B6A4FF", "var(--warning)"];
  const W = 1100, H = 230, P = 40;
  const maxV = 140_000;
  const bw = Math.min(34, ((W - 2 * P) / days) * 0.55);
  const bars: { x: number; segs: { y: number; h: number; c: string; t: string }[]; label?: string }[] = [];
  for (let d = 0; d < days; d++) {
    const base = MATURITY[d % 7];
    const mul = win === "30d" ? 0.9 + 0.2 * Math.abs(Math.sin(d + 1)) : 1;
    const vals = [base.withdraw * mul, base.interest * mul, base.genesis * mul];
    let y = H - 30;
    const segs = vals.map((v, s) => {
      const h = (v / maxV) * (H - 64);
      y -= h;
      return { y, h, c: colors[s], t: `D+${d + 1} · $${(v / 1000).toFixed(1)}K` };
    });
    if (stress) {
      const sh = (STRESS_DAILY_USD / maxV) * (H - 64);
      y -= sh;
      segs.push({ y, h: sh, c: "var(--danger)", t: `压力层:试用潜在兑换 $${(STRESS_DAILY_USD / 1000).toFixed(0)}K(不进覆盖率)` });
    }
    bars.push({ x: P + (d + 0.5) * ((W - 2 * P) / days), segs, label: days === 7 || d % 5 === 0 ? `D+${d + 1}` : undefined });
  }
  const alertY = H - 30 - (DAILY_DUE_ALERT_USD / maxV) * (H - 64);

  /* 净敞口曲线(TREASURY.exposureSeries = coverageSeries 派生,8 个统计窗 ≈ 90d 粒度;
     30d = 末 4 窗确定性内插 / 7d = 末窗邻域小幅波动 —— 窗口切换真改数据,声明=实现) */
  const expBase = TREASURY.exposureSeries;
  const exp = (() => {
    if (expWin === "90d") return expBase;
    if (expWin === "30d") {
      const tail = expBase.slice(-4);
      const out: number[] = [];
      for (let i = 0; i < tail.length - 1; i++) { out.push(tail[i], Math.round((tail[i] + tail[i + 1]) / 2)); }
      out.push(tail[tail.length - 1]);
      return out; // 7 点
    }
    const last = expBase[expBase.length - 1];
    return Array.from({ length: 7 }, (_, i) => Math.round(last * (1 + 0.012 * Math.sin(i + 1)))); // 7d:末值 ±1.2% 确定性波动
  })();
  const expCaption = expWin === "90d" ? "近 90 天(8 个统计窗)" : expWin === "30d" ? "近 30 天(末 4 窗内插)" : "近 7 天(末窗邻域)";
  const eMin = Math.min(...exp) * 0.9, eMax = Math.max(...exp) * 1.08;
  const EW = 1100, EH = 210, EP = 40;
  const X = (i: number) => EP + (i / (exp.length - 1)) * (EW - 2 * EP);
  const Y = (v: number) => EH - 26 - ((v - eMin) / (eMax - eMin)) * (EH - 50);
  const expPath = exp.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">真实储备</div><div className="v">{fmtM(LEDGER.reserveUsd)}</div><div className="sub">充值累计 + 注入 − 已出金 − 在锁本金</div></div>
        <div className="f-stat"><div className="k">应付负债(8 科目)</div><div className="v">{fmtM(LIAB_TOTAL)}</div><div className="sub">明细喂 B1 负债账本(分母裁决归 B1)</div></div>
        <div className="f-stat cyan"><div className="k">净敞口</div><div className="v">+{fmtM(LEDGER.reserveUsd - LIAB_TOTAL)}</div><div className="sub">储备 − 负债 · 转负即红</div></div>
        <div className="f-stat warn"><div className="k">储备可覆盖到期</div><div className="v">{RESERVE_COVER_DAYS} 天</div><div className="sub">储备 ÷ 日均到期 ${(dailyAvg / 1000).toFixed(1)}K(静态测算)</div></div>
      </div>

      <div className="two-col">
        {/* 储备明细 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">真实储备明细</span>
            <span className="sub">· 实际可兑付资产</span>
            <div className="r"><span className="dcode electric">唯一储备账本 · B1/B2/B5 引用</span></div>
          </div>
          <div className="l-b">
            {RESERVE_ROWS.map((r) => (
              <div className="res-row" key={r.nm}>
                <span className="nm" style={r.neg ? { color: "var(--ink-4)" } : undefined}>{r.nm}<small>{r.sub}</small></span>
                <span className="v" style={r.neg ? { color: "var(--negative)" } : undefined}>{r.neg ? `−${fmtM(-r.v)}(已扣)` : fmtM(r.v)}</span>
              </div>
            ))}
            <div className="res-row" style={{ borderTop: "1px dashed var(--border)" }}>
              <span className="nm" style={{ fontWeight: 600, color: "var(--ink)" }}>储备合计</span>
              <span className="v" style={{ fontSize: 16, color: "var(--success)" }}>{fmtM(LEDGER.reserveUsd)}</span>
            </div>
            <div className="dtint" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}><b>口径开关</b> · 储备/负债科目的纳入口径按日批生效(UTC 00:00,不追溯历史快照),调整要操作确认。</span>
              <button className="l-btn sm mc" onClick={() => openActionConfirm({
                action: "储备 / 负债口径配置",
                detail: <>科目级开关(某项资产是否计入储备、某科目是否纳入负债)+ 利息计提方式(线性 / 到期一次性,切换时附预测差值给执行门槛)。<b>改口径直接影响覆盖率分子分母,操作确认</b>;按日批生效(UTC 00:00),不追溯历史快照。</>,
                edit: { kind: "text", current: "全部纳入 · 利息线性计提" },
                run: (reason, v) => { if (v) setParam("D.scope", v, { action: "储备/负债口径配置", reason }); toast("口径配置已确认生效 · 下一日批生效"); },
              })}>调整口径</button>
            </div>
          </div>
        </section>

        {/* 8 科目 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">应付负债 · 8 类科目</span>
            <span className="sub">· 和驾驶舱水位卡(B2)同一套定义</span>
            <div className="r"><button className="l-btn sm" onClick={() => openConfirm({
              action: "负债科目分解导出",
              detail: "仅导出 8 类科目分解明细(驾驶舱水位卡的同源数据)。聚合金额,无用户明细。",
              okLabel: "导出",
              run: () => { logAudit({ actor: "总管理员", action: "负债科目分解导出(8 类明细)", target: "D3-liabilities" }); toast("科目分解已导出 · 落审计"); },
            })}>科目导出</button></div>
          </div>
          <div className="l-b">
            {LIABILITIES.map((l, i) => (
              <div className="liab-row" key={l.id} title={`${LIAB_META[i].desc} · 事件源:${LIAB_META[i].src}`}>
                <span className="nm"><i style={{ background: l.color }} />{l.id} {l.name}</span>
                <span className="track"><i style={{ width: `${(l.amount / lmax) * 100}%`, background: l.color }} /></span>
                <span className="amt">{fmtM(l.amount)}</span>
              </div>
            ))}
            <div className="liab-row" style={{ borderTop: "1px dashed var(--border)", marginTop: 4, paddingTop: 9 }}>
              <span className="nm" style={{ fontWeight: 600, color: "var(--ink)" }}>合计(喂 B1 负债账本)</span>
              <span />
              <span className="amt" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmtM(LIAB_TOTAL)}</span>
            </div>
            <div className="dtint" style={{ marginTop: 12 }}><b>试用影子收益不在这八类里</b> · 试用攒的影子收益只有走完「兑换入账」终态才成为真负债,中途取消/失败全部归零、平台无兑付义务——所以不进硬负债,只在到期预测的压力测试层可选叠加(默认关,也不进覆盖率分母)。</div>
          </div>
        </section>
      </div>

      {/* 到期预测 */}
      <section className="l-card" style={{ marginTop: 16 }}>
        <div className="l-h">
          <span className="ttl">到期负债预测</span>
          <span className="sub">· 三类叠加:提现冷却解锁 + 锁仓利息到期 + Genesis 日分红(按服务端 0.1%/日)</span>
          <div className="r">
            <div className="chips">
              <button className={`chip${win === "7d" ? " sel" : ""}`} onClick={() => setWin("7d")}>未来 7 天</button>
              <button className={`chip${win === "30d" ? " sel" : ""}`} onClick={() => setWin("30d")}>未来 30 天</button>
            </div>
            <div className="chips"><span style={{ fontSize: 12, color: "var(--ink-4)" }}>压力测试层</span>
              <button className={`chip${stress ? " sel" : ""}`} onClick={() => { setStress(!stress); toast(`压力测试层 ${!stress ? "已叠加(只作观察,不进覆盖率分母)" : "已关闭"}`); }}>{stress ? "开" : "关"}</button>
            </div>
          </div>
        </div>
        <div className="l-b">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 230, display: "block" }}>
            {bars.map((b, i) => (
              <g key={i}>
                {b.segs.map((s, j) => (
                  <rect key={j} x={b.x - bw / 2} y={s.y} width={bw} height={s.h} rx={2} fill={s.c} opacity={0.88}><title>{s.t}</title></rect>
                ))}
                {b.label && <text x={b.x} y={H - 10} fontSize={11} fill="var(--ink-4)" textAnchor="middle" fontFamily="var(--mono)">{b.label}</text>}
              </g>
            ))}
            <line x1={P} y1={alertY} x2={W - P} y2={alertY} stroke="var(--danger)" strokeWidth={1.2} strokeDasharray="5 4" />
            <text x={W - P} y={alertY - 5} fontSize={11} fill="var(--danger)" textAnchor="end" fontFamily="var(--mono)">{`单日兑付预警线 $${Math.round(DAILY_DUE_ALERT_USD / 1000)}K(储备 2%/日)`}</text>
          </svg>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--ink-3)", marginTop: 10 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--success)", display: "inline-block" }} />提现冷却解锁(7d ${(MAT_7D.withdraw / 1000).toFixed(0)}K)</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: "#B6A4FF", display: "inline-block" }} />锁仓利息到期(7d ${(MAT_7D.interest / 1000).toFixed(0)}K)</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: "var(--warning)", display: "inline-block" }} />Genesis 日分红(7d ${(MAT_7D.genesis / 1000).toFixed(1)}K)</span>
            <span style={{ marginLeft: "auto", color: "var(--ink-4)" }}>NEX v2 到期在 24 个月锁期之外,不在本图内</span>
          </div>
          <div className="dtint warn" style={{ marginTop: 12 }}><b>预警联动</b> · 某天的到期兑付额逼近储备可覆盖上限时,会喂挤兑雷达(B5)并提示去提现队列(D2)/提现参数(D5)调节奏——本页只出账和预警,不直接动任何开关。</div>
        </div>
      </section>

      {/* 净敞口 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">净敞口曲线</span>
          <span className="sub">· 储备 − 负债的时间序列 · 转负区段标红 · 双账本(B1)的净敞口卡用的就是这份数</span>
          <div className="r"><div className="chips">
            {["7d", "30d", "90d"].map((wk) => (
              <button key={wk} className={`chip${expWin === wk ? " sel" : ""}`} onClick={() => { setExpWin(wk); toast(`窗口已切换:${wk}`); }}>{wk === "7d" ? "7 天" : wk === "30d" ? "30 天" : "90 天"}</button>
            ))}
          </div></div>
        </div>
        <div className="l-b">
          <svg viewBox={`0 0 ${EW} ${EH}`} style={{ width: "100%", height: 210, display: "block" }}>
            {exp.map((_, i) => (
              <line key={i} x1={X(i)} y1={14} x2={X(i)} y2={EH - 26} stroke="var(--border)" />
            ))}
            <path d={`${expPath} L${X(exp.length - 1)} ${EH - 26} L${X(0)} ${EH - 26} Z`} fill="var(--success)" opacity={0.07} />
            <path d={expPath} fill="none" stroke="var(--success)" strokeWidth={2.2} />
            {exp.map((v, i) => (
              <g key={i}>
                <circle cx={X(i)} cy={Y(v)} r={3} fill="var(--bg)" stroke="var(--success)" strokeWidth={2} />
                {(i % 2 === 0 || i === exp.length - 1) && <text x={X(i)} y={Y(v) - 9} fontSize={11} fill="var(--ink-3)" textAnchor="middle" fontFamily="var(--mono)">{`+$${Math.round(v / 1000)}K`}</text>}
              </g>
            ))}
            <text x={EP} y={EH - 8} fontSize={11} fill="var(--ink-4)" fontFamily="var(--mono)">{expCaption} · 与覆盖率序列同源 · 全程为正,无标红区段</text>
          </svg>
        </div>
      </section>

      <p className="f-foot"><b>分工说清楚</b>:储备底账归本页(全平台唯一,B1 拿去当覆盖率分子、B2 做驾驶舱概览、B5 当挤兑分母);负债作为覆盖率分母的裁决权归 B1(本页提供明细输入);<b>覆盖率本身不在这里算</b>。锁仓本金的处理:在锁本金从储备里扣掉、同时挂在负债科目 #2 里——保证同一笔钱不会两头都算。科目之和与 B1/B2 汇总对不上时自动产对账告警(喂 B5 和财务报表)。储备注入登记的服务端实现只有这一处,双账本页(B1)上那个按钮也是调到这里来。</p>
    </>
  );
}
