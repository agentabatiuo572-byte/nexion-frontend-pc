"use client";

/**
 * G3 NEX 行情引擎 — 定价基础设施(基准价/上行概率/波动/oracle)。中性语言铁律(无操纵措辞)。
 * NEX 现价是 G2 兑换 / G7 复投的唯一定价源;拉价/升上行概率 = 放大流出,
 * B1 红线核验以「拟生效新价」重估全量 NEX 计价负债(口径权威 B1)。
 * 引擎 pause 沿用旧真写键 G.market.nexPaused(行情不在 J1 七闸,独立 pause)。
 */
import { LEDGER } from "@/lib/mock/admin/ledger";
import { NEX_MARKET, NEX_KLINE } from "./data";
import type { GCtx } from "./types";

export function G3Market({ ctx }: { ctx: GCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const cov = LEDGER.coverageRatio.toFixed(1);

  const paused = pget("G.market.nexPaused") === "true";
  const price = pget("G.market.price") ?? `$${NEX_MARKET.price}`;
  const pump = pget("G.market.pump") ?? `${NEX_MARKET.pump}`;
  const vol = pget("G.market.volatility") ?? `±${NEX_MARKET.volatility}%`;
  const oracle = pget("G.market.oracle") ?? NEX_MARKET.oracle;
  const dev = pget("G.market.deviation") ?? `${NEX_MARKET.deviationPct}%`;
  const costBasis = pget("G.market.costBasis") ?? `$${NEX_MARKET.costBasis}`;

  const adjCurve = (key: string, label: string, cur: string, note: string, isPrice: boolean) => openActionConfirm({
    action: `行情参数调整 · ${label}`,
    detail: <><b>{label}</b> · 当前 {cur} · {note}。{isPrice ? <><b>属放大流出</b>:确认放行时以拟生效新价重估全部 NEX 计价负债(含 NEX v2 在锁本金 USDT 等值)后验备付金红线(当前 {cov}%),低于红线拒(422)。</> : "做市波动不直接放大流出。"}运营执行门槛:财务主管/超管。</>,
    amplifies: isPrice,
    edit: { kind: "text", current: cur },
    run: (reason, v) => { if (v) setParam(`G.market.${key}`, v, { action: `行情参数调整 ${label}`, reason }); toast(`${label} 已更新为 ${v}`); },
  });
  const pauseEngine = () => openActionConfirm({
    action: paused ? "恢复行情引擎" : "暂停行情引擎",
    detail: paused
      ? <>恢复后现价继续按曲线更新。恢复 = 价格继续上行预期,确认放行时核验 B1 覆盖率(当前 {cov}%)。行情不在 J1 七闸内,作独立 pause 通知 J1 编排面联动。</>
      : <>暂停后现价冻结在最后值,全站 NEX 价格停止更新(监管点名代币定价时用)。风控/合规执行门槛:超管。行情不在 J1 七闸内,作独立 pause 通知 J1 编排面联动。</>,
    amplifies: paused, // 恢复方向 = 放大
    run: (reason) => { setParam("G.market.nexPaused", paused ? "false" : "true", { action: paused ? "行情引擎恢复" : "行情引擎暂停", reason }); toast(`行情引擎已${paused ? "恢复" : "暂停"} · 通知 J1 编排`); },
  });

  /* kline(确定性 48 点) */
  const W = 760, H = 180, P = 30;
  const min = 0.13, max = 0.188;
  const X = (i: number) => P + (i / (NEX_KLINE.length - 1)) * (W - 2 * P);
  const Y = (p: number) => H - 22 - ((p - min) / (max - min)) * (H - 40);
  const path = NEX_KLINE.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(" ");
  const athY = Y(NEX_MARKET.ath);

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">NEX 现价</div><div className="v">{price}</div><div className="sub">24h +{NEX_MARKET.change24h}%</div></div>
        <div className="f-stat"><div className="k">价格上行概率</div><div className="v">{pump}</div><div className="sub">做市波动 {vol}</div></div>
        <div className="f-stat cyan"><div className="k">喂价源</div><div className="v">{oracle}</div><div className="sub">健康 · 偏离 {NEX_MARKET.deviationNow}%(告警线 {dev})</div></div>
        <div className="f-stat"><div className="k">引擎状态</div><div className="v" style={{ color: paused ? "var(--danger)" : "var(--success)" }}>{paused ? "已暂停" : "运行中"}</div><div className="sub">暂停即冻结现价</div></div>
      </div>

      <div className="two-col r13" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">行情走势</span>
            <span className="sub">· 近 24h · ATH ${NEX_MARKET.ath}</span>
            <div className="r"><button className="l-btn mc" onClick={pauseEngine}>{paused ? "恢复引擎(操作确认)" : "暂停引擎(操作确认)"}</button></div>
          </div>
          <div className="l-b">
            <div className="price-hero"><span className="big">{price}</span><span className="chg">+{NEX_MARKET.change24h}%</span>{paused && <span className="bdg bad">已冻结</span>}</div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 180, display: "block" }}>
              <line x1={P} y1={athY} x2={W - P} y2={athY} stroke="var(--ink-4)" strokeWidth={1} strokeDasharray="4 4" />
              <text x={W - P} y={athY - 5} fontSize={10.5} fill="var(--ink-4)" textAnchor="end" fontFamily="var(--mono)">{`ATH $${NEX_MARKET.ath}`}</text>
              <path d={`${path} L${X(NEX_KLINE.length - 1)} ${H - 22} L${X(0)} ${H - 22} Z`} fill="var(--admin-domain-g)" opacity={0.08} />
              <path d={path} fill="none" stroke="var(--admin-domain-g)" strokeWidth={2} />
              <circle cx={X(47)} cy={Y(NEX_KLINE[47])} r={3.5} fill="var(--bg)" stroke="var(--admin-domain-g)" strokeWidth={2} />
            </svg>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">引擎参数</span>
            <span className="sub">· 改价相关参数过红线 + 操作确认</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">基准现价</div><div className="s">全站 NEX 价格、兑换汇率、复投定价的源头</div></div><span className="v">{price}</span><button className="l-btn sm mc" onClick={() => adjCurve("price", "基准现价", price, "拉高现价放大流出 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">价格上行概率</div><div className="s">走势上行的概率系数</div></div><span className="v">{pump}</span><button className="l-btn sm mc" onClick={() => adjCurve("pump", "价格上行概率", pump, "范围 0–1 · 提高即拉升预期,过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">做市波动幅度</div><div className="s">单 tick 的最大波动</div></div><span className="v">{vol}</span><button className="l-btn sm mc" onClick={() => adjCurve("volatility", "做市波动幅度", vol, "范围 0–±20%", false)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">喂价源</div><div className="s">内部做市源 / 外部喂价源 · 外部源 1 tick/4s 同频</div></div><span className="v">{oracle}</span><button className="l-btn sm mc" onClick={() => openActionConfirm({
              action: "切换喂价源",
              detail: <>内部做市源 ↔ 外部喂价源切换。基础设施操作,RBAC 细分前由超管代理执行门槛:超管。</>,
              edit: { kind: "text", current: oracle },
              run: (reason, v) => { if (v) setParam("G.market.oracle", v, { action: "切换喂价源", reason }); toast(`喂价源已切换为 ${v}`); },
            })}>切换源</button></div>
            <div className="p-row"><div className="txt"><div className="k">偏离告警阈值</div><div className="s">现价与喂价源偏离超此即告警</div></div><span className="v">{dev}</span><button className="l-btn sm mc" onClick={() => adjCurve("deviation", "偏离告警阈值", dev, "范围 0–50%", false)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">成本基准锚(costBasis day-0)</div><div className="s">用户端 PnL 卡的基准价(<span className="mono">pnl = nexBalance × nexPrice − nexBalance × costBasis</span>)· 只展示锚,不参与价格曲线</div></div><span className="v">{costBasis}</span><button className="l-btn sm mc" onClick={() => openActionConfirm({
              action: "成本基准锚调整 · costBasis day-0",
              detail: <><b>当前 {costBasis}</b> · 仅作 PnL 基准展示,不影响价格曲线或兑换报价;不属放大流出方向,但作锚定值修改操作确认。</>,
              edit: { kind: "text", current: costBasis },
              run: (reason, v) => { if (v) setParam("G.market.costBasis", v, { action: "成本基准锚调整", reason }); toast(`costBasis 已更新为 ${v}`); },
            })}>调整</button></div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>价格 100% 服务端驱动</b>:客户端那条本地跳动的价格线只是渲染,真值在服务端喂价;客户端改本地行情不影响兑换/复投计价(服务器重算)。NEX 现价是<b>兑换(G2)报价和复投(G7)定价的单一源</b>,下游取服务端现价、不接客户端价;现价变动即时影响备付金里 NEX 计价负债的折算(含 NEX v2 在锁本金)。改价相关参数的红线核验,是以「拟生效新价」重估全部 NEX 计价应付负债后再判——口径由双账本(B1)持有。引擎暂停是紧急开关矩阵(J1)的生效面。</p>
    </>
  );
}
