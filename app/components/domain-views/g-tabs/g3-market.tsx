"use client";

/**
 * G3 NEX 行情引擎 — 周曲线关键帧排程器(2026-06-15 升级:从手动设单值 → 配一周曲线自动按日推进生效)。
 * 运营预设 7 天关键帧(每日 目标价/上行概率/波动),保存后 server cron 每日 00:00 UTC 自动推进到下一帧并更新现价。
 * NEX 现价仍是 G2 兑换 / G7 复投的唯一定价源(下游零改);拉价/升上行概率 = 放大流出,
 * B1 红线核验以「周峰值价」重估全量 NEX 计价负债(口径权威 B1)。中性语言铁律(无操纵措辞)。
 * 旧 6 手动控件保留为「手动 override 层」(与自动排程并存:应急直写现价 / 切喂价源 / 暂停)。
 * 引擎 pause 沿用旧真写键 G.market.nexPaused(行情不在 J1 五闸,独立 pause)。
 */
import { LEDGER } from "@/lib/mock/admin/ledger";
import {
  NEX_MARKET, NEX_KLINE,
  CURVE_FIELDS, CURVE_LABELS, CURVE_LOOSEN_DIR, MARKET_CURVE, CURVE_STATE, CURVE_CONTROLS,
} from "./data";
import type { GCtx } from "./types";

export function G3Market({ ctx }: { ctx: GCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const cov = LEDGER.coverageRatio.toFixed(1);

  const paused = pget("G.market.nexPaused") === "true";
  const price = pget("G.market.price") ?? `$${NEX_MARKET.price}`;
  const vol = pget("G.market.volatility") ?? `±${NEX_MARKET.volatility}%`;
  const oracle = pget("G.market.oracle") ?? NEX_MARKET.oracle;
  const dev = pget("G.market.deviation") ?? `${NEX_MARKET.deviationPct}%`;
  const costBasis = pget("G.market.costBasis") ?? `$${NEX_MARKET.costBasis}`;

  const curDay = CURVE_STATE.currentDay;
  const peak = CURVE_STATE.peakPrice;
  const fmtCurveVal = (col: number, raw: string) =>
    col === 0 ? `$${raw}` : col === 2 ? `±${raw}%` : raw;
  const getCurveCell = (d: number, col: number): string =>
    pget(`G.market.curve.d${d}.${CURVE_FIELDS[col]}`) ?? String(MARKET_CURVE[d - 1][col]);

  /* 改关键帧单元格(操作确认 + 显式 edit;升目标价/上行概率过 B1 红线;当日帧同步现价) */
  const openCurveCellMc = (d: number, col: number) => {
    const field = CURVE_FIELDS[col];
    const label = CURVE_LABELS[field];
    const cur = getCurveCell(d, col);
    const amp = !!CURVE_LOOSEN_DIR[field];
    const isCurrentDay = d === curDay;
    openActionConfirm({
      action: `周曲线关键帧 · D${d} · ${label.name}`,
      detail: <>
        <b>D{d} {label.name}</b> · 当前 {fmtCurveVal(col, cur)}({label.unit})。
        {amp
          ? <><b>属放大流出</b>:确认放行时以<b>周峰值价 ${peak}</b> 重估全部 NEX 计价负债(含 NEX v2 在锁本金 USDT 等值)后验备付金红线(当前 {cov}%),低于红线拒(422)。server 收到新值后按实际方向二次精算。</>
          : "做市波动不直接放大流出。"}
        {isCurrentDay && <> 改当日帧同步全站现价 <span className="mono">G.market.price</span>,~60s 全网。</>}
        运营执行门槛:财务主管 / 超管。
      </>,
      amplifies: amp,
      edit: { kind: "text", current: cur },
      run: (reason, v) => {
        if (!v) return;
        setParam(`G.market.curve.d${d}.${field}`, v, { action: `周曲线关键帧 D${d} ${label.name}`, reason });
        // 当日帧的目标价 = 当下生效现价,同步双写现价单源,否则下游展示与曲线脱钩。
        if (isCurrentDay && field === "targetPrice") {
          setParam("G.market.price", `$${v}`, { action: `行情现价同步(当日帧 D${d})`, reason: `${reason}(当日帧同步)` });
        }
        toast(`D${d} ${label.name} 已更新为 ${fmtCurveVal(col, v)}${isCurrentDay ? " · 当日生效,~60s 全网" : " · 待推进到该日生效"}`);
      },
    });
  };

  /* 排程控制 3 类(schedule / pin / loop)— 操作确认,不挂 amplifies(治理类) */
  const openCurveCtlMc = (key: string, name: string, cur: string) => openActionConfirm({
    action: `行情排程控制 · ${name}`,
    detail: <><b>{name}</b> · 当前:{cur}。排程按 server 时间表推进当日生效帧;钉住 / 暂停推进不影响已配置的曲线本身。改排程产 <span className="mono">market.curve_advanced</span> / <span className="mono">market.schedule_changed</span> 审计。运营执行门槛:财务主管 / 超管。</>,
    amplifies: false,
    edit: { kind: "text", current: cur },
    run: (reason, v) => { if (v != null) setParam(`G.market.curve.ctl.${key}`, v, { action: `行情排程控制 ${name}`, reason }); toast(`· ${name} 已更新为 ${v}`); },
  });

  /* 手动 override 层:旧单值控件(应急直写) */
  const adj = (key: string, label: string, seed: string, note: string, amp?: boolean) => {
    const cur = pget(`G.market.${key}`) ?? seed;
    openActionConfirm({
      action: `手动 override · ${label}`,
      detail: <><b>{label}</b> · 当前 {cur} · {note}。{amp && <><b>属放大流出</b>:确认放行时以周峰值价 ${peak} 重估全部 NEX 计价负债后验备付金红线(当前 {cov}%,422)。</>}手动直写 = 临时压过自动排程,下次排程推进会以曲线值覆盖。</>,
      amplifies: !!amp,
      edit: { kind: "text", current: cur },
      run: (reason, v) => { if (v) setParam(`G.market.${key}`, v, { action: `手动 override ${label}`, reason }); toast(`${label} 已更新为 ${v}`); },
    });
  };
  const pauseEngine = () => openActionConfirm({
    action: paused ? "恢复行情引擎" : "暂停行情引擎",
    detail: paused
      ? <>恢复后现价继续按曲线排程推进。恢复 = 价格继续上行预期,确认放行时核验 B1 覆盖率(当前 {cov}%)。行情不在 J1 五闸内,作独立 pause 通知 J1 编排面联动。</>
      : <>暂停后现价冻结在最后值、曲线自动推进暂停,全站 NEX 价格停止更新(监管点名代币定价时用)。风控/合规执行门槛:超管。行情不在 J1 五闸内,作独立 pause 通知 J1 编排面联动。</>,
    amplifies: paused,
    run: (reason) => { setParam("G.market.nexPaused", paused ? "false" : "true", { action: paused ? "行情引擎恢复" : "行情引擎暂停", reason }); toast(`行情引擎已${paused ? "恢复" : "暂停"} · 通知 J1 编排`); },
  });

  /* kline(确定性 48 点) */
  const W = 760, H = 180, P = 30;
  const min = 0.13, max = 0.188;
  const X = (i: number) => P + (i / (NEX_KLINE.length - 1)) * (W - 2 * P);
  const Y = (p: number) => H - 22 - ((p - min) / (max - min)) * (H - 40);
  const path = NEX_KLINE.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p).toFixed(1)}`).join(" ");
  const athY = Y(NEX_MARKET.ath);

  const schedV = pget("G.market.curve.ctl.schedule") ?? CURVE_CONTROLS[0].current;
  const pinV = pget("G.market.curve.ctl.pin") ?? CURVE_CONTROLS[1].current;
  const loopV = pget("G.market.curve.ctl.loop") ?? CURVE_CONTROLS[2].current;
  const ctlVals: Record<string, string> = { schedule: schedV, pin: pinV, loop: loopV };

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">NEX 现价</div><div className="v">{price}</div><div className="sub">24h +{NEX_MARKET.change24h}% · 当日帧 D{curDay} 派发</div></div>
        <div className="f-stat cyan"><div className="k">排程进度</div><div className="v">D{curDay} / 7</div><div className="sub">{schedV} · 周峰值 ${peak}</div></div>
        <div className="f-stat"><div className="k">喂价源</div><div className="v">{oracle}</div><div className="sub">健康 · 偏离 {NEX_MARKET.deviationNow}%(告警线 {dev})</div></div>
        <div className="f-stat warn"><div className="k">引擎状态</div><div className="v" style={{ color: paused ? "var(--danger)" : "var(--success)" }}>{paused ? "已暂停" : "运行中"}</div><div className="sub">暂停即冻结现价 + 停推进</div></div>
      </div>

      {/* 周曲线关键帧排程表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">周曲线关键帧(7 天 × 3 项 · 逐值权威)</span>
          <span className="sub">· 点任意单元格改值(操作确认)· 当前生效日高亮 · 黄色 = 与昨日不同 · ★ 周峰值</span>
          <div className="r"><span className="bdg ok">自动按日推进 · 约 60 秒内全网生效</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dial-tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>生效日</th>
                {CURVE_FIELDS.map((f) => (
                  <th key={f}>{CURVE_LABELS[f].name}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>({CURVE_LABELS[f].unit})</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MARKET_CURVE.map((_row, idx) => {
                const d = idx + 1;
                const isCur = d === curDay;
                return (
                  <tr key={d} className={isCur ? "cur" : undefined}>
                    <td>D{d}{isCur && " · 当前"}</td>
                    {CURVE_FIELDS.map((field, col) => {
                      const cur = getCurveCell(d, col);
                      const prev = d > 1 ? getCurveCell(d - 1, col) : cur;
                      const chg = d > 1 && String(prev) !== String(cur);
                      const isPeak = col === 0 && Math.abs(parseFloat(cur) - peak) < 1e-9;
                      return (
                        <td key={field} className={isPeak ? "peak" : chg ? "chg" : undefined} onClick={() => openCurveCellMc(d, col)} title="点击改值(操作确认)">
                          {fmtCurveVal(col, cur)}{isPeak && " ★"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ttl" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>排程控制</div>
          {CURVE_CONTROLS.map((c) => (
            <div className="p-row" key={c.key}>
              <div className="txt"><div className="k">{c.name}</div><div className="s">{c.sub}</div></div>
              <span className="v">{ctlVals[c.key]}</span>
              <button className="l-btn sm mc" onClick={() => openCurveCtlMc(c.key, c.name, ctlVals[c.key])}>调整</button>
            </div>
          ))}
          <div className="gtint" style={{ marginTop: 10 }}><b>自动生效怎么工作</b> · 排程开后,server cron 每日 00:00 UTC 把「当前生效日」+1、把当日 <b>目标价</b> 写进全站现价单源 <span className="mono">G.market.price</span>(G2 兑换 / G7 复投即时跟随),并产 <span className="mono">market.curve_advanced</span> 审计;跑到 D7 后按 loop 设置回 D1 循环或停在末日值。钉住(pin)= 演示 / 应急时把生效日冻在某天,自动推进暂停。改 <b>目标价 / 上行概率</b> 是放大流出,提交即以周峰值价过 B1 红线。</div>
        </div>
      </section>

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
            <span className="ttl">手动 override 层</span>
            <span className="sub">· 应急直写 · 下次排程推进以曲线值覆盖</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">现价直写(应急)</div><div className="s">绕过曲线临时压价,过红线</div></div><span className="v">{price}</span><button className="l-btn sm mc" onClick={() => adj("price", "现价直写", price, "临时压过自动排程 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">做市波动幅度</div><div className="s">单 tick 的最大波动(曲线未覆盖时兜底)</div></div><span className="v">{vol}</span><button className="l-btn sm mc" onClick={() => adj("volatility", "做市波动幅度", vol, "范围 0–±20%")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">喂价源</div><div className="s">内部做市源 / 外部喂价源 · 外部源 1 tick/4s 同频</div></div><span className="v">{oracle}</span><button className="l-btn sm mc" onClick={() => openActionConfirm({
              action: "切换喂价源",
              detail: <>内部做市源 ↔ 外部喂价源切换。基础设施操作,RBAC 细分前由超管代理执行门槛:超管。</>,
              edit: { kind: "text", current: oracle },
              run: (reason, v) => { if (v) setParam("G.market.oracle", v, { action: "切换喂价源", reason }); toast(`喂价源已切换为 ${v}`); },
            })}>切换源</button></div>
            <div className="p-row"><div className="txt"><div className="k">偏离告警阈值</div><div className="s">现价与喂价源偏离超此即告警</div></div><span className="v">{dev}</span><button className="l-btn sm mc" onClick={() => adj("deviation", "偏离告警阈值", dev, "范围 0–50%")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">成本基准锚(costBasis day-0)</div><div className="s">用户端 PnL 卡的基准价(<span className="mono">pnl = nexBalance × nexPrice − nexBalance × costBasis</span>)· 只展示锚,不参与曲线</div></div><span className="v">{costBasis}</span><button className="l-btn sm mc" onClick={() => openActionConfirm({
              action: "成本基准锚调整 · costBasis day-0",
              detail: <><b>当前 {costBasis}</b> · 仅作 PnL 基准展示,不影响曲线或兑换报价;不属放大流出方向,但作锚定值修改操作确认。</>,
              edit: { kind: "text", current: costBasis },
              run: (reason, v) => { if (v) setParam("G.market.costBasis", v, { action: "成本基准锚调整", reason }); toast(`costBasis 已更新为 ${v}`); },
            })}>调整</button></div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>价格 100% 服务端驱动</b>:运营配的是一周关键帧曲线,server cron 每日自动推进当日生效帧、把目标价写进现价单源;客户端那条本地跳动的价格线只是渲染,真值在服务端。NEX 现价是<b>兑换(G2)报价和复投(G7)定价的单一源</b>,下游取服务端现价、不接客户端价;现价变动即时影响备付金里 NEX 计价负债的折算(含 NEX v2 在锁本金)。改<b>目标价 / 上行概率</b>是放大流出,红线核验以<b>周峰值价</b>重估全部 NEX 计价应付负债后再判——口径由双账本(B1)持有。引擎暂停 = 冻结现价 + 停自动推进,是紧急开关矩阵(J1)的生效面。</p>
    </>
  );
}
