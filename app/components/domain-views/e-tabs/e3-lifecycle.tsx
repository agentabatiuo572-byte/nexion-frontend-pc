import { CodeTag } from "../design-kit";
import type { EViewCtx } from "./types";
import { effCurve } from "./data";
import { EStats } from "./stats";

const LifeIcon = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>;
const TradeIcon = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3" /></svg>;
const AlertIcon = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4l9 16H3z" /><path d="M12 10v5M12 18h.01" /></svg>;
const ShieldIcon = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;

const TX = [
  { nm: "recycle", endpoint: "POST /tradein/recycle", ok: 218, fail: 2, roll: 2, k: "最近失败", dot: "fail", ts: "14:22", reason: "salvage 估值不足 minHoldingMonths · 拒接 · 已回滚" },
  { nm: "replace", endpoint: "POST /tradein/replace", ok: 156, fail: 1, roll: 1, k: "最近失败", dot: "fail", ts: "09:08", reason: "D4 bill 写入失败 · 设备 + 余额 + bill 三部分全回滚" },
  { nm: "deactivate", endpoint: "POST /tradein/deactivate", ok: 38, fail: 0, roll: 0, k: "最新成功", dot: "ok", ts: "14:31", reason: "u-83271 · stellarbox-s1 (m11) · generation lineage 已归档" },
];

export function E3Lifecycle({ ctx }: { ctx: EViewCtx }) {
  const { pE } = ctx;
  const early = parseFloat(pE("E.device.degradeEarly"));
  const mid = parseFloat(pE("E.device.degradeMid"));
  const late = parseFloat(pE("E.device.degradeLate"));
  const s1 = parseInt(pE("E.device.stageEarlyEnd"), 10);
  const s2 = parseInt(pE("E.device.stageMidEnd"), 10);
  const cyc = parseInt(pE("E.device.cycleMonths"), 10);
  const floorPct = parseFloat(pE("E.device.minEfficiency"));
  const curve = effCurve(early, mid, late, s1, s2, cyc, floorPct);

  const px = (i: number) => (i / cyc) * 700;
  const py = (v: number) => 4 + ((100 - v) / (100 - floorPct)) * 183;
  const pathOf = (from: number, to: number) =>
    curve.slice(from, to + 1).map((v, j) => `${j ? "L" : "M"}${px(from + j).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const emphasized = [0, s1, s2, cyc];
  const dotColor = (i: number) => (i <= s1 ? "var(--success)" : i <= s2 ? "var(--warning)" : "var(--brand-2)");

  // 调参按钮:走 操作确认 param(显式 edit 契约),真写 setParam → 曲线/估值器据 pE 重算
  const adj = (label: string, key: string, unit: string, amplify: boolean, editKind: "number" | "text" = "number", detail?: string) =>
    ctx.openActionConfirm({
      name: `${label} 调整`, op: "param", paramKey: key, amplify,
      edit: { kind: editKind, current: `${pE(key)}${editKind === "number" ? unit : ""}`, unit },
      detail: detail ?? `${label} · server-canonical,改后对全网衰减曲线 / 估值器生效,不回溯已生效报价`,
    });
  const Adj = ({ label, k, unit, amplify = false, editKind = "number", detail }: { label: string; k: string; unit: string; amplify?: boolean; editKind?: "number" | "text"; detail?: string }) =>
    <button className={`adj${amplify ? " amp" : ""}`} onClick={() => adj(label, k, unit, amplify, editKind, detail)}>调整</button>;

  return (
    <>
      <EStats items={[
        { k: "在网设备平均龄", v: "5.2 月", sub: "87% 在早/中期" },
        { k: "m9–12 断崖设备", v: "3,184", sub: "≈ 7.7% · 进入晚期", tone: "danger" },
        { k: "Trade-in 本月", v: "412 次", sub: "折抵 $284k", tone: "cyan" },
        { k: "K2 套利簇命中", v: "12 账户", sub: "CL-318 · 最短持有拦截", tone: "warn" },
      ]} />

      {/* 三段衰减曲线 hero */}
      <section className="curve-card">
        <div className="curve-h">
          <span className="ttl">设备效率衰减曲线</span>
          <span className="sub">三段非线性 · {cyc} 月 · server-canonical(镜像产品 device-lifecycle.ts)</span>
          <span className="r"><CodeTag tone="electric">E.device.*</CodeTag></span>
        </div>
        <div className="curve-wrap">
          <div className="curve-y">{[100, 80, 60, 40, floorPct].map((y) => <span key={y}>{y}%</span>)}</div>
          <div className="canvas">
            <svg viewBox="0 0 700 240" preserveAspectRatio="none">
              <rect className="zone-early" x="0" y="0" width={px(s1)} height="240" />
              <rect className="zone-mid" x={px(s1)} y="0" width={px(s2) - px(s1)} height="240" />
              <rect className="zone-late" x={px(s2)} y="0" width={700 - px(s2)} height="240" />
              {[48, 96, 144, 192].map((y) => <line key={y} x1="0" y1={y} x2="700" y2={y} stroke="rgba(255,255,255,.05)" strokeWidth="1" />)}
              <line x1="0" y1={py(floorPct)} x2="700" y2={py(floorPct)} stroke="var(--brand-2)" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
              <line x1={px(s1)} y1="0" x2={px(s1)} y2="240" stroke="rgba(255,255,255,.08)" strokeWidth="1" strokeDasharray="3 3" />
              <line x1={px(s2)} y1="0" x2={px(s2)} y2="240" stroke="rgba(255,255,255,.08)" strokeWidth="1" strokeDasharray="3 3" />
              <defs>
                <linearGradient id="eCurveGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.5" />
                  <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={`${pathOf(0, cyc)} L700 240 L0 240 Z`} fill="url(#eCurveGrad)" opacity="0.22" />
              <path d={pathOf(0, s2 + 1)} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d={pathOf(s2 + 1, cyc)} fill="none" stroke="var(--brand-2)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {/* 数据点用 HTML overlay 正圆(SVG preserveAspectRatio=none 会把 <circle> 拉成椭圆,故移出 SVG)*/}
            {curve.map((v, i) => {
              const emp = emphasized.includes(i);
              const d = emp ? 12 : 6;
              return <div key={i} className="curve-dot" style={{ left: `${(px(i) / 700) * 100}%`, top: `${(py(v) / 240) * 100}%`, width: d, height: d, background: dotColor(i), border: `${emp ? 2 : 1}px solid var(--bg)` }} />;
            })}
            {emphasized.map((i) => {
              const cls = i === 0 ? "left" : i === cyc ? "right" : "";
              return <div key={i} className={`curve-label ${cls}`} style={{ left: `${(px(i) / 700) * 100}%`, top: `${(py(curve[i]) / 240) * 100}%`, color: dotColor(i) }}>m{i} · {curve[i].toFixed(1)}%</div>;
            })}
          </div>
          <div className="curve-floor" style={{ top: `${(py(floorPct) / 240) * 100}%` }}>FLOOR {floorPct}%</div>
          <div className="curve-x">{Array.from({ length: Math.floor(cyc / 2) + 1 }, (_, j) => <span key={j}>m{j * 2}</span>)}</div>
        </div>
        <div className="stage-lbl">
          <div className="stage-tag early"><div className="nm">EARLY · m1–{s1}</div><div className="ct">{early}% / 月 · 平缓</div></div>
          <div className="stage-tag mid"><div className="nm">MID · m{s1 + 1}–{s2}</div><div className="ct">{mid}% / 月 · 中速衰减</div></div>
          <div className="stage-tag late"><div className="nm">LATE · m{s2 + 1}–{cyc}</div><div className="ct">{late}% / 月 · 断崖 · 驱动置换</div></div>
        </div>
      </section>

      {/* 双列参数卡 */}
      <div className="params-grid">
        {/* 左:设备生命周期 */}
        <section className="param-card">
          <div className="param-h"><span className="ic life"><LifeIcon /></span><div className="t"><div className="nm">设备生命周期</div><div className="s">三段非线性衰减 · server 权威</div></div><span className="tag">E.device.*</span></div>
          <div className="pkv"><div className="lhs">早期(m1–{s1})衰减/月<div className="desc">平缓段 · 不刺激置换</div></div><span className="v ok">{pE("E.device.degradeEarly")}%</span><Adj label="早期衰减率" k="E.device.degradeEarly" unit="%" /></div>
          <div className="pkv"><div className="lhs">中期(m{s1 + 1}–{s2})衰减/月<div className="desc">中速段 · 收益边际下降</div></div><span className="v warn">{pE("E.device.degradeMid")}%</span><Adj label="中期衰减率" k="E.device.degradeMid" unit="%" /></div>
          <div className="pkv warn-row"><div className="lhs"><b>晚期(m{s2 + 1}–{cyc})衰减/月</b><div className="desc">断崖段 · 驱动置换冲动</div></div><span className="v danger">{pE("E.device.degradeLate")}%</span><Adj label="晚期衰减率" k="E.device.degradeLate" unit="%" amplify detail="晚期断崖衰减率 · 上调加快置换节奏(更多 Trade-in 现金流),m9-12 收益下挫 · 放大资金流出须操作确认 + B1 覆盖率" /></div>
          <div className="pkv"><div className="lhs">最低效能 floor<div className="desc">达此值即停止衰减</div></div><span className="v">{pE("E.device.minEfficiency")}%</span><Adj label="最低效能 floor" k="E.device.minEfficiency" unit="%" /></div>
          <div className="pkv"><div className="lhs">衰减周期<div className="desc">达 floor 月数 · 须对齐 12 月</div></div><span className="v">{pE("E.device.cycleMonths")} 月</span><Adj label="衰减周期" k="E.device.cycleMonths" unit="月" /></div>
          <div className="pkv"><div className="lhs">段边界(早末 / 中末)<div className="desc">m{s1} 早末 · m{s2} 中末</div></div><span className="v" style={{ fontSize: 13 }}>m{s1} / m{s2}</span><span style={{ display: "flex", gap: 6 }}><Adj label="早期段末月" k="E.device.stageEarlyEnd" unit="" /><Adj label="中期段末月" k="E.device.stageMidEnd" unit="" /></span></div>
          <div className="pkv"><div className="lhs"><b>任务锁定月度损失阈</b><div className="desc">§6.7 banner 触发依据 · S1 / Pro / Rack 三阶</div></div><span className="v" style={{ fontSize: 13 }}>{pE("E.device.taskLockThresholds")}</span><Adj label="任务锁定阈" k="E.device.taskLockThresholds" unit="USDT" editKind="text" /></div>
          <div className="pkv"><div className="lhs">豁免规则<div className="desc">不衰减的设备类型</div></div><span className="v" style={{ fontFamily: "var(--font-v5)", fontSize: 12, fontWeight: 500, color: "var(--ink-3)" }}>手机 + Cloud Share 免衰减</span><span /></div>
          <div className="param-foot"><span className="ic"><AlertIcon /></span><span><b>晚期衰减率为高敏参数</b>:上调加快置换节奏(更多 Trade-in 现金流),但 m9-12 收益预期下挫会触发用户负面信号;下调延后置换、减少现金流。</span></div>
        </section>

        {/* 右:Trade-in 置换配置 */}
        <section className="param-card">
          <div className="param-h"><span className="ic trade"><TradeIcon /></span><div className="t"><div className="nm">Trade-in 置换配置</div><div className="s">折抵定价 · 套利防控</div></div><span className="tag">E.tradein.*</span></div>
          <div className="pkv"><div className="lhs">salvage 残值率<div className="desc">置换折抵基准 · 与 m 龄复合</div></div><span className="v cyan">{pE("E.tradein.salvagePct")}%</span><Adj label="Trade-in 残值率" k="E.tradein.salvagePct" unit="%" amplify detail="置换残值率 · 放大资金流出(更高折抵)须操作确认 + B1 覆盖率 · 改后对新报价生效" /></div>
          <div className="pkv"><div className="lhs">decay 衰减<div className="desc">残值随设备龄三段衰减</div></div><span className="v" style={{ fontSize: 13, color: "var(--ink-3)" }}>随三段 · {cyc} 月</span><span /></div>
          <div className="pkv warn-row"><div className="lhs"><b>minHoldingMonths</b><div className="desc">套利窗口闸门 · 不足月不得置换</div></div><span className="v warn">{pE("E.tradein.minHoldingMonths")} 月</span><Adj label="最短持有月数" k="E.tradein.minHoldingMonths" unit="月" detail="套利窗口闸门 · 调高收紧 CL-318 拦截、牺牲合法置换体验,调低放大套利风险" /></div>
          <div className="pkv"><div className="lhs">eligibility<div className="desc">置换资格门槛</div></div><span className="v" style={{ fontSize: 13, fontFamily: "var(--font-v5)", fontWeight: 500 }}>L4+ 持有者</span><span /></div>
          <div className="pkv"><div className="lhs">promo 倍率<div className="desc">置换活动加成 · 改后对新报价生效</div></div><span className="v">{pE("E.tradein.promoMult")}×</span><Adj label="Trade-in promo 倍率" k="E.tradein.promoMult" unit="×" amplify detail="置换活动倍率 · 放大资金流出须操作确认 + B1 覆盖率 · 改后对新报价生效" /></div>
          <div className="pkv"><div className="lhs">promo 节奏代参<div className="desc">cooldown 14d · max/sess 1 · delay 6s · minAge 30d · routes /me/devices</div></div><span className="v" style={{ fontSize: 13, color: "var(--ink-3)" }}>5 个参数</span><Adj label="Trade-in promo 节奏全集" k="E.tradein.promo.rhythm" unit="" editKind="text" detail="promo 节奏 5 参一锁(cooldown / maxPerSession / delay / minAge / routes)· 一次写入 · 改后对新弹窗节奏生效" /></div>
          <div className="pkv"><div className="lhs">inventory.softMax<div className="desc">库存软上限告警 · 0 = 禁用</div></div><span className="v">{pE("E.tradein.inventorySoftMax")} 台</span><Adj label="inventory.softMax" k="E.tradein.inventorySoftMax" unit="台" /></div>
          <div className="pkv"><div className="lhs">本月 Trade-in 笔数<div className="desc">折抵总额 $284k</div></div><span className="v cyan">412</span><span /></div>
          <div className="pkv"><div className="lhs">K2 套利簇命中<div className="desc">CL-318 · 12 账户 · 已拦截</div></div><span className="v warn">12</span><span /></div>
          <div className="param-foot cyan"><span className="ic"><ShieldIcon /></span><span><b>K2 监控</b>:minHoldingMonths 是套利窗口闸门 — 调低风险簇 CL-318(短持有 → 置换 → 反手买入)放大,调高牺牲合法置换体验。salvage 与 promo 为<b>放大资金流出</b>动作,须操作确认 + B1 覆盖率核验。</span></div>
        </section>
      </div>

      {/* 原子换机 tx 监控 */}
      <section className="tx-card">
        <div className="tx-h">
          <span className="ttl">原子换机 tx 监控</span>
          <span className="sub">· server 单事务 · 任一步失败全回滚(设备数组 + 余额 + bill)· 防 half-completed replace</span>
          <span className="r"><CodeTag tone="electric">A2 审计</CodeTag><span>24h · 成功率 <span style={{ color: "var(--success)" }}>99.6%</span></span></span>
        </div>
        <div className="tx-grid">
          {TX.map((t) => (
            <div className="tx-col" key={t.nm}>
              <div className="nm">{t.nm}<span className="endpoint">{t.endpoint}</span></div>
              <div className="stats">
                <div className="s ok"><div className="k">24h 成功</div><div className="v">{t.ok}</div></div>
                <div className="s fail"><div className="k">失败</div><div className="v">{t.fail}</div></div>
                <div className="s roll"><div className="k">回滚</div><div className="v">{t.roll}</div></div>
              </div>
              <div className="latest">
                <div className="k">{t.k}</div>
                <div className="vrow"><span className={`dot ${t.dot}`} /><span className="ts">{t.ts}</span><span className="reason">{t.reason}</span></div>
              </div>
            </div>
          ))}
        </div>
        <div className="tx-foot">
          <span><b>原子事务</b> · 任一 endpoint 任一步失败 · server 全回滚到调用前(§7.5.3 M1)</span>
          <span className="sep">·</span>
          <span><b>generation lineage</b> 由 server 在 replace 原子事务内写入 · 不受 client 控制</span>
          <span className="sep">·</span>
          <span>失败样本 → <a style={{ color: "var(--cyan)", cursor: "pointer" }} onClick={() => ctx.toast("打开 D4 bill · 跳转失败 tx 详情")}>查 D4 bill · 轨迹</a></span>
        </div>
      </section>
      <p className="f-foot">设备衰减曲线 + Trade-in 残值率<b>共同构成用户置换节奏</b>:晚期断崖把用户推向置换决策点,残值率决定置换吸引力。两者改动会影响:① 硬件 GMV(置换新单)② D4 资金应付(置换补差)③ K2 套利风险。任一参数调整后<b>立即对前端 / 估值器生效</b>(不回溯已生效报价)。</p>
    </>
  );
}
