"use client";

/**
 * G7 复投激励 — 复投 APY/倍率/抽奖券/罚款/preset 配置(原 G5–G7 合页拆分后独立,Premium/NEX v2 已下线)。
 * gate 项(reinvestMultiplier 月5-6 限时倍率)权威归 H1,只读 + 真 Link;升 APY/升倍率/降罚款 = 放大流出过 B1 红线。
 * 真写键沿用旧契约 G.repurchase.*;在锁本金归科目 #2,90 天到期本息喂 B2 到期预测。
 */
import Link from "next/link";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { G7_REPURCHASE } from "./data";
import type { GCtx } from "./types";

export function G7Repurchase({ ctx }: { ctx: GCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const cov = LEDGER.coverageRatio.toFixed(1);

  // newOnly=false → 参数实时生效(培育奖/preset/抽奖券规则等);默认 true(APY/锁期,仅新单)。
  const adj = (key: string, label: string, seed: string, note: string, amp?: boolean, newOnly: boolean = true) => {
    const cur = pget(key) ?? seed;
    openActionConfirm({
      action: `产品参数调整 · ${label}`,
      detail: <><b>{label}</b> · 当前 {cur} · {note}。{amp && <>放大流出方向确认放行时过备付金红线(当前 {cov}%,422)。</>}操作确认,{newOnly ? "只对新单生效" : "实时生效"}。</>,
      amplifies: !!amp,
      edit: { kind: "text", current: cur },
      run: (reason, v) => { if (v) setParam(key, v, { action: `产品参数调整 ${label}`, reason }); toast(`${label} 已更新为 ${v}`); },
    });
  };

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">本月复投单</div><div className="v">{G7_REPURCHASE.ordersMonth.toLocaleString("en-US")}</div><div className="sub">在锁本金 ${(G7_REPURCHASE.principalUsd / 1000).toFixed(0)}K(科目 #2 内)</div></div>
        <div className="f-stat"><div className="k">90 天后到期本息</div><div className="v">${(G7_REPURCHASE.matureUsd / 1000).toFixed(0)}K</div><div className="sub">喂 B2 到期预测</div></div>
        <div className="f-stat cyan"><div className="k">发放 Genesis 抽奖券</div><div className="v">{G7_REPURCHASE.ticketsMonth.toLocaleString("en-US")} 张</div><div className="sub">每月开奖 · 联动 G4</div></div>
        <div className="f-stat"><div className="k">复投率</div><div className="v">{G7_REPURCHASE.reinvestRate}%</div><div className="sub">漏斗复投级 · 非八项 KPI</div></div>
      </div>
      <section className="l-card">
        <div className="l-h"><span className="ttl">复投激励配置</span><span className="sub">· 引导用户把可提现余额重新锁仓</span></div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          <div className="p-row"><div className="txt"><div className="k">年化 APY</div><div className="s">90 天锁仓</div></div><span className="v">{pget("G.repurchase.apy") ?? "35%"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.apy", "复投 APY", "35%", "升 APY 放大流出 · 过红线", true)}>调整</button></div>
          <div className="p-row"><div className="txt"><div className="k">培育奖倍率</div></div><span className="v">{pget("G.repurchase.nurture") ?? "×1.5"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.nurture", "培育奖倍率", "×1.5", "升倍率过红线 · 复投者培育奖计算即用", true, false)}>调整</button></div>
          <div className="p-row"><div className="txt"><div className="k">Genesis 抽奖券</div><div className="s">每复投单发放 · 改规则核对 G4 奖池容量</div></div><span className="v">{pget("G.repurchase.lottery") ?? "+1 张 / 单"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.lottery", "抽奖券发放", "+1 张/单", "联动 G4 奖池核对")}>调整</button></div>
          <div className="p-row"><div className="txt"><div className="k">早赎罚款</div></div><span className="v">{pget("G.repurchase.penalty") ?? "本金 15% + forfeit"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.penalty", "早赎罚款", "本金 15%", "降罚款放大流出 · 过红线", true)}>调整</button></div>
          <div className="p-row"><div className="txt"><div className="k">preset 金额档</div></div><span className="v">{pget("G.repurchase.presets") ?? G7_REPURCHASE.presets}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.presets", "preset 金额档", G7_REPURCHASE.presets, "实时生效", false, false)}>调整</button></div>
          <div className="p-row"><div className="txt"><div className="k">限时复投倍率 <span className="gate">🔒 H1 派发</span></div><div className="s">月 5–6 限时 2×,复投那一刻套用 · 这页是生效面,调整去 H1</div></div><span className="v">{G7_REPURCHASE.multiplierLabel}</span><Link href="/growth/phase" className="l-btn sm">去 H1 →</Link></div>
          <div className="gtint" style={{ marginTop: 10 }}><b>复投是原子组合</b> · 一次复投 = 扣余额 + 锁仓,两步在服务端单事务里一起成,中途崩了不会只成一半。限时倍率(节奏调度器 H1 下发)在复投那一刻套用,这页是生效面。复投资金侧记 <span className="mono">wallet.reinvest</span>,正式启用时双写灰度过渡、对账一致再切主口径,避免漏斗复投级数据断层。</div>
          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>复投单状态机与金额分布</div>
          <div className="sm-strip">
            <span className="st">pending_lock</span><span className="ar">→</span>
            <span className="st ok">active 90 天锁仓</span><span className="ar">到期 →</span>
            <span className="st warn">mature_unclaimed</span><span className="ar">领取 →</span>
            <span className="st ok">claimed</span>
            <span className="ar" style={{ marginLeft: 10 }}>旁路:</span>
            <span className="st bad">early_withdrawn 罚本金 15% + 没收利息/券</span>
          </div>
          <div className="gtint" style={{ marginTop: 10 }}><b>金额分布(本月 {G7_REPURCHASE.ordersMonth.toLocaleString("en-US")} 单)</b> · {G7_REPURCHASE.dist} · 90 天后到期本息 ${(G7_REPURCHASE.matureUsd / 1000).toFixed(0)}K 喂驾驶舱到期预测(B2)。</div>
        </div>
      </section>

      <p className="f-foot"><b>阶段开关与产品参数分两层</b>:「什么时候解锁/限时倍率」(reinvestMultiplier)是节奏调度器(H1)下发的阶段开关,这页只读,调整去 H1;「利率/倍率/罚款/preset」才是这页能改的。所有<b>升利率、升培育奖倍率、降罚款都是放大流出</b>,确认放行时过备付金红线(422),收紧不受限。状态全服务器为准,到期本息/早赎罚款服务端算;到期派发、复投 claim 带防重号,早赎锁定后并发领取返 409。复投熔断是紧急开关矩阵(J1)的生效面。</p>
    </>
  );
}
