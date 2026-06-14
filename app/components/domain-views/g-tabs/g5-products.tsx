"use client";

/**
 * G5–G7 订阅/锁仓/复投 — nav G5/G6/G7 三独立入口,本组件按 initialSeg 渲染对应子段(URL 派生 · 无页内 tab)。
 * gate 三项(premiumSubAvailable 月7+ / nexV2LockAvailable 月11+ / reinvestMultiplier 月5-6)权威归 H1,只读 + 真 Link;
 * 升 APY/升权益/升倍率/降罚款 = 放大流出过 B1 红线;premium/nexv2 熔断 = J.killswitch.* J1 同键。
 * 演示态:月 7(PHASE 单源)→ premium 刚解锁(首月口径);nexv2 月 11+ 未全量(Founders 邀请制预售,
 * 在锁 = 科目#5 反推);复投倍率窗口(月 5-6)已过 = 1×。
 */
import Link from "next/link";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { fmtM } from "@/lib/mock/admin/design-data";
import { G5_PREMIUM, G6_NEXV2, G7_REPURCHASE } from "./data";
import type { GCtx } from "./types";

type Seg = "g5" | "g6" | "g7";

export function G5Products({ ctx, initialSeg }: { ctx: GCtx; initialSeg: Seg }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const seg = initialSeg;
  const cov = LEDGER.coverageRatio.toFixed(1);

  const premiumOn = (pget("J.killswitch.premium") ?? "on") === "on";
  const nexv2On = (pget("J.killswitch.nexv2") ?? "on") === "on";

  // newOnly=false → 参数实时生效(培育奖/preset/抽奖券规则等);默认 true(APY/锁期/最小额/权益,仅新单)。
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
  const kill = (prod: "premium" | "nexv2") => {
    const on = prod === "premium" ? premiumOn : nexv2On;
    const name = prod === "premium" ? "Premium" : "NEX v2";
    openActionConfirm({
      action: `${name} ${on ? "熔断" : "恢复"}`,
      detail: on
        ? <>立即下架该产品。{prod === "nexv2" && <>在锁单的处置方案随提案提交(写进原因)。</>}风控/合规执行门槛:超管,联动紧急开关矩阵(J1 {prod} 闸)。</>
        : <>恢复 {name} 产品上架 = 恢复资金沉淀产品流入流出,确认放行时核验 B1 覆盖率(当前 {cov}%),同步 J1。</>,
      amplifies: !on,
      run: (reason) => { setParam(`J.killswitch.${prod}`, on ? "off" : "on", { action: `${name} ${on ? "熔断" : "恢复"}`, reason }); toast(`${name} 已${on ? "熔断" : "恢复"} · 同步 J1`); },
    });
  };

  return (
    <>
      {seg === "g5" && <>
        <div className="f-stats">
          <div className="f-stat ok"><div className="k">活跃订阅</div><div className="v">{G5_PREMIUM.active}</div><div className="sub">首月新增 {G5_PREMIUM.newMonth} · 退款窗取消 {G5_PREMIUM.refundWindowCancel}</div></div>
          <div className="f-stat"><div className="k">月经常性收入</div><div className="v">${(G5_PREMIUM.mrr / 1000).toFixed(1)}K</div><div className="sub">首月折扣价口径 · 运营内部口径非 KPI</div></div>
          <div className="f-stat cyan"><div className="k">解锁阶段(H1 派发)</div><div className="v">月 7+ 开</div><div className="sub">premiumSubAvailable · 只读 · 当前月 7 已解锁</div></div>
          <div className="f-stat warn"><div className="k">熔断</div><div className="v">{premiumOn ? "未启用" : "已熔断"}</div><div className="sub">联动 J1</div></div>
        </div>
        <section className="l-card">
          <div className="l-h"><span className="ttl">Premium 配置</span><span className="sub">· 价格/折扣/权益可改 · 解锁阶段只读</span>
            <div className="r"><button className="l-btn mc" onClick={() => kill("premium")}>{premiumOn ? "premium 熔断" : "恢复 premium"}</button></div></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">月费</div></div><span className="v">{pget("G.premium.price") ?? "$99"}</span><button className="l-btn sm mc" onClick={() => adj("G.premium.price", "月费", "$99", "只对新订阅/下个计费周期")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">首月折扣</div><div className="s">首月 $50</div></div><span className="v">{pget("G.premium.disc") ?? "50%"}</span><button className="l-btn sm mc" onClick={() => adj("G.premium.disc", "首月折扣", "50%", "只对新订阅")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">NEX 收益加成(权益)</div><div className="s">叠加每台设备基础费率</div></div><span className="v">{pget("G.premium.yield") ?? "+2%"}</span><button className="l-btn sm mc" onClick={() => adj("G.premium.yield", "NEX 收益加成", "+2%", "升加成放大流出 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">解锁阶段 <span className="gate">🔒 H1 派发</span></div><div className="s">premiumSubAvailable · 月 7+ 自动开,调整去 H1</div></div><span className="v">{G5_PREMIUM.gateLabel}</span><Link href="/growth/phase" className="l-btn sm">去 H1 →</Link></div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>订阅状态机与监控</div>
            <div className="sm-strip">
              <span className="st">none 未订</span><span className="ar">首月折扣 →</span>
              <span className="st ok">subscribed 订阅中</span><span className="ar">续费 →</span>
              <span className="st ok">renewed 已续</span>
              <span className="ar" style={{ marginLeft: 10 }}>取消:</span>
              <span className="st warn">cancelled · 7 天退款窗内退费 / 窗外到期止续</span>
            </div>
            <div className="gtint" style={{ marginTop: 10 }}><b>首月监控</b> · 月 7 刚解锁:新增 {G5_PREMIUM.newMonth} · 退款窗内取消 {G5_PREMIUM.refundWindowCancel}(退费记账本 D4)· 活跃 {G5_PREMIUM.active}。订阅台账服务器单源,退费窗判定在服务端。</div>
          </div>
        </section>
      </>}

      {seg === "g6" && <>
        <div className="f-stats">
          <div className="f-stat ok"><div className="k">在锁本金</div><div className="v">${(G6_NEXV2.lockedPrincipalUsd / 1000).toFixed(0)}K</div><div className="sub">NEX 计价 · 按行情现价折算(G3)</div></div>
          <div className="f-stat"><div className="k">在锁 position</div><div className="v">{G6_NEXV2.positions}</div><div className="sub">24 月后到期批次(最早月 35)</div></div>
          <div className="f-stat danger"><div className="k">到期应付(matureValue)</div><div className="v">{fmtM(G6_NEXV2.matureValueUsd)}</div><div className="sub">×{G6_NEXV2.multiple} · 科目 #5 一次性登账</div></div>
          <div className="f-stat cyan"><div className="k">解锁阶段(H1)</div><div className="v">月 11+ 开</div><div className="sub">nexV2LockAvailable · 只读 · 当前邀请制预售</div></div>
        </div>
        <section className="l-card">
          <div className="l-h"><span className="ttl">NEX v2 Founders Vault 配置</span><span className="sub">· 250% 是监管最敏感的高息档</span>
            <div className="r"><button className="l-btn mc" onClick={() => kill("nexv2")}>{nexv2On ? "NEX v2 熔断" : "恢复 NEX v2"}</button></div></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">年化 APY</div><div className="s">到期一次性兑付,不线性计提</div></div><span className="v" style={{ color: "var(--warning)" }}>{pget("G.nexv2.apy") ?? "250%"}</span><button className="l-btn sm mc" onClick={() => adj("G.nexv2.apy", "NEX v2 APY", "250%", "高息档 · 升 APY 过红线 + 附风控意见", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">锁仓期</div></div><span className="v">{pget("G.nexv2.months") ?? "24 个月"}</span><button className="l-btn sm mc" onClick={() => adj("G.nexv2.months", "锁仓期", "24 个月", "只对新锁仓")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">最小锁仓量</div></div><span className="v">{pget("G.nexv2.min") ?? "1,000 NEX"}</span><button className="l-btn sm mc" onClick={() => adj("G.nexv2.min", "最小锁仓量", "1,000 NEX", "只对新锁仓")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">到期价值公式</div><div className="s">单利:本金 × (1 + 2.5 × 24/12) = ×6</div></div><span className="v">×6</span></div>
            <div className="p-row"><div className="txt"><div className="k">解锁阶段 <span className="gate">🔒 H1 派发</span></div><div className="s">nexV2LockAvailable · 月 11+ 自动开 · 当前为 Founders 邀请制预售批次</div></div><span className="v">{G6_NEXV2.gateLabel}</span><Link href="/growth/phase" className="l-btn sm">去 H1 →</Link></div>
            <div className="gtint" style={{ marginTop: 10 }}><b>负债登账口径</b> · 锁仓本金是「已收资金」,但 24 月后要付到期价值(×6)——开锁那一刻就按到期应付额<b>一次性全额登账</b>到负债科目 5(区别于 USDT staking 按已锁天数线性计提)。NEX 计价部分按行情引擎(G3)现价折 USDT。升 APY 的红线核验以拟生效新价重估全部 NEX 计价负债。</div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>锁仓状态机与到期日历</div>
            <div className="sm-strip">
              <span className="st">pending_lock 待确认</span><span className="ar">→</span>
              <span className="st ok">locked 24 月锁仓 · 月度结算记账</span><span className="ar">到期 →</span>
              <span className="st ok">matured 释放 ×6</span>
              <span className="ar" style={{ marginLeft: 10 }}>旁路:</span>
              <span className="st bad">early_forfeit 提前解锁 · 没收全部增益</span>
              <span className="st">refunded 锁失败退本</span>
            </div>
            <div className="gtint" style={{ marginTop: 10 }}><b>到期日历</b> · 当前 Founders 邀请制预售批次(最早开锁月 7)→ 最早到期落在月 31(月 7 + 24 月锁期);月 11+ gate 全量开放后的批次最早到期月 35。两批均超出本运营周期,期内到期应付 = 0;到期批次喂驾驶舱负债预测(B2),但不进 7/30 天近窗。月度结算和到期释放都带防重号;早赎/熔断锁定后并发领取返 409。</div>
          </div>
        </section>
      </>}

      {seg === "g7" && <>
        <div className="f-stats">
          <div className="f-stat ok"><div className="k">本月复投单</div><div className="v">{G7_REPURCHASE.ordersMonth.toLocaleString("en-US")}</div><div className="sub">在锁本金 ${(G7_REPURCHASE.principalUsd / 1000).toFixed(0)}K(科目 #2 内)</div></div>
          <div className="f-stat"><div className="k">90 天后到期本息</div><div className="v">${(G7_REPURCHASE.matureUsd / 1000).toFixed(0)}K</div><div className="sub">喂 B2 到期预测</div></div>
          <div className="f-stat cyan"><div className="k">发放 Genesis 抽奖券</div><div className="v">{G7_REPURCHASE.ticketsMonth.toLocaleString("en-US")} 张</div><div className="sub">每月开奖 · 联动 G4</div></div>
          <div className="f-stat"><div className="k">复投率</div><div className="v">{G7_REPURCHASE.reinvestRate}%</div><div className="sub">漏斗复投级 · 非八项 KPI</div></div>
        </div>
        <section className="l-card">
          <div className="l-h"><span className="ttl">复投激励配置</span><span className="sub">· 引导积分不足的用户重投</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">年化 APY</div><div className="s">90 天锁仓</div></div><span className="v">{pget("G.repurchase.apy") ?? "35%"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.apy", "复投 APY", "35%", "升 APY 放大流出 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">积分倍率</div><div className="s">每 $100 给多少积分(影响提现额度)</div></div><span className="v">{pget("G.repurchase.points") ?? "+50 / $100"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.points", "积分倍率", "+50 / $100", "升倍率放大流出 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">培育奖倍率</div></div><span className="v">{pget("G.repurchase.nurture") ?? "×1.5"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.nurture", "培育奖倍率", "×1.5", "升倍率过红线 · 复投者培育奖计算即用", true, false)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">Genesis 抽奖券</div><div className="s">每复投单发放 · 改规则核对 G4 奖池容量</div></div><span className="v">{pget("G.repurchase.lottery") ?? "+1 张 / 单"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.lottery", "抽奖券发放", "+1 张/单", "联动 G4 奖池核对")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">早赎罚款</div></div><span className="v">{pget("G.repurchase.penalty") ?? "本金 15% + forfeit"}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.penalty", "早赎罚款", "本金 15%", "降罚款放大流出 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">preset 金额档</div></div><span className="v">{pget("G.repurchase.presets") ?? G7_REPURCHASE.presets}</span><button className="l-btn sm mc" onClick={() => adj("G.repurchase.presets", "preset 金额档", G7_REPURCHASE.presets, "实时生效", false, false)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">限时复投倍率 <span className="gate">🔒 H1 派发</span></div><div className="s">月 5–6 限时 2×,复投那一刻套用 · 这页是生效面,调整去 H1</div></div><span className="v">{G7_REPURCHASE.multiplierLabel}</span><Link href="/growth/phase" className="l-btn sm">去 H1 →</Link></div>
            <div className="gtint" style={{ marginTop: 10 }}><b>复投是原子组合</b> · 一次复投 = 扣余额 + 给积分 + 锁仓,三步在服务端单事务里一起成,中途崩了不会只成一半。限时倍率(节奏调度器 H1 下发)在复投那一刻套用,这页是生效面。复投资金侧记 <span className="mono">wallet.reinvest</span>,正式启用时双写灰度过渡、对账一致再切主口径,避免漏斗复投级数据断层。</div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>复投单状态机与金额分布</div>
            <div className="sm-strip">
              <span className="st">pending_lock</span><span className="ar">→</span>
              <span className="st ok">active 90 天锁仓</span><span className="ar">到期 →</span>
              <span className="st warn">mature_unclaimed</span><span className="ar">领取 →</span>
              <span className="st ok">claimed</span>
              <span className="ar" style={{ marginLeft: 10 }}>旁路:</span>
              <span className="st bad">early_withdrawn 罚本金 15% + 没收利息/积分/券</span>
            </div>
            <div className="gtint" style={{ marginTop: 10 }}><b>金额分布(本月 {G7_REPURCHASE.ordersMonth.toLocaleString("en-US")} 单)</b> · {G7_REPURCHASE.dist} · 90 天后到期本息 ${(G7_REPURCHASE.matureUsd / 1000).toFixed(0)}K 喂驾驶舱到期预测(B2)。</div>
          </div>
        </section>
      </>}

      <p className="f-foot"><b>阶段开关与产品参数分两层</b>:「什么时候解锁」(premiumSubAvailable / nexV2LockAvailable / 复投倍率)是节奏调度器(H1)下发的阶段开关,这页只读,调整去 H1;「价格/利率/权益」才是这页能改的。所有<b>升利率、升收益权益、升积分倍率、降罚款都是放大流出</b>,确认放行时过备付金红线(422),收紧不受限。状态全服务器为准,到期本息/早赎罚款服务端算;到期派发、复投 claim 带防重号,熔断/早赎锁定后并发领取返 409。订阅/锁仓/复投熔断都是紧急开关矩阵(J1)的生效面。</p>
    </>
  );
}
