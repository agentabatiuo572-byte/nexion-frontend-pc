import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { EViewCtx } from "./types";
import { effCurve } from "./data";
import { EStats } from "./stats";

const LifeIcon = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>;
const TradeIcon = () => <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3l4 4-4 4M3 7h18M7 21l-4-4 4-4M21 17H3" /></svg>;
const AlertIcon = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4l9 16H3z" /><path d="M12 10v5M12 18h.01" /></svg>;
const ShieldIcon = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;

// 参数行标签:中文主标(运营可读)+ 可选英文代号(降 mono 副标,保后台契约可读)+ 可选「高敏」标(把琥珀高亮的语义从"选中态"明示为"高敏参数");
// desc 接 AutoGloss,给词典里的术语(套利/残值/折抵/衰减…)加虚线下划线 + hover 通俗注释。
function Lbl({ zh, code, desc, hot }: { zh: string; code?: string; desc: string; hot?: boolean }) {
  return (
    <div className="lhs">
      <span className="zh">
        {zh}
        {code ? <code className="code">{code}</code> : null}
        {hot ? <span className="hot" title="高敏参数:本页风险最高的杠杆,改动影响资金流出 / 套利风险,请重点关注">高敏</span> : null}
      </span>
      <div className="desc"><AutoGloss>{desc}</AutoGloss></div>
    </div>
  );
}

const REQUIRED_E3_KEYS = [
  "E.device.degradeEarly",
  "E.device.degradeMid",
  "E.device.degradeLate",
  "E.device.stageEarlyEnd",
  "E.device.stageMidEnd",
  "E.device.cycleMonths",
  "E.device.minEfficiency",
  "E.tradein.salvagePct",
  "E.tradein.minHoldingMonths",
  "E.tradein.promoMult",
];

const num = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const countText = (value: number) => new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.round(value)));
const moneyText = (value: number) => `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, value))}`;

export function E3Lifecycle({ ctx }: { ctx: EViewCtx }) {
  const { pE, e3Loading, e3Error, e3Ready, e3Stats, e3Operations } = ctx;
  const hasRequiredConfig = REQUIRED_E3_KEYS.every((key) => pE(key) !== "—");
  if (!e3Ready || !hasRequiredConfig) {
    return (
      <section className="param-card">
        <div className="param-h"><span className="ic life"><LifeIcon /></span><div className="t"><div className="nm">E3 后端配置</div><div className="s">{e3Loading ? "正在读取 MySQL 配置" : e3Error || "后端配置未完整返回"}</div></div></div>
        <div className="param-foot"><span className="ic"><AlertIcon /></span><span>{e3Error ? `接口读取失败:${e3Error}` : "等待 /api/admin/devices/e3/overview 返回生命周期与 Trade-in 配置。"}</span></div>
        <button className="adj" onClick={() => void ctx.refreshE3()}>刷新</button>
      </section>
    );
  }

  const early = num(pE("E.device.degradeEarly"), -4);
  const mid = num(pE("E.device.degradeMid"), -6);
  const late = num(pE("E.device.degradeLate"), -23.7);
  const s1 = Math.max(1, Math.round(num(pE("E.device.stageEarlyEnd"), 3)));
  const s2 = Math.max(s1 + 1, Math.round(num(pE("E.device.stageMidEnd"), 8)));
  const cyc = Math.max(s2 + 1, Math.round(num(pE("E.device.cycleMonths"), 12)));
  const floorPct = Math.max(0, Math.min(99, num(pE("E.device.minEfficiency"), 22)));
  const curve = effCurve(early, mid, late, s1, s2, cyc, floorPct);
  const stats = e3Stats ?? { averageAgeMonths: 0, cliffDeviceCount: 0, tradeinMonthCount: 0, tradeinDiscountUsdt: 0, k2ArbitrageHits: 0 };
  const totalTxSuccess = e3Operations.reduce((sum, item) => sum + item.ok, 0);
  const totalTxFailure = e3Operations.reduce((sum, item) => sum + item.fail, 0);
  const txSuccessRate = totalTxSuccess + totalTxFailure > 0 ? (totalTxSuccess / (totalTxSuccess + totalTxFailure)) * 100 : 0;

  const px = (i: number) => (i / cyc) * 700;
  const py = (v: number) => 4 + ((100 - v) / (100 - floorPct)) * 183;
  const pathOf = (from: number, to: number) =>
    curve.slice(from, to + 1).map((v, j) => `${j ? "L" : "M"}${px(from + j).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const emphasized = [0, s1, s2, cyc];
  const dotColor = (i: number) => (i <= s1 ? "var(--success)" : i <= s2 ? "var(--warning)" : "var(--brand-2)");

  // 调参按钮:走 操作确认 param(显式 edit 契约),真写后端 E3 配置接口 → 曲线/估值器据 pE 重算
  const adj = (label: string, key: string, unit: string, amplify: boolean, editKind: "number" | "text" | "select" = "number", detail?: string, options?: string[]) =>
    ctx.openActionConfirm({
      name: `${label} 调整`, op: "param", paramKey: key, amplify,
      edit: { kind: editKind, current: `${pE(key)}${editKind === "number" ? unit : ""}`, unit, options },
      detail: detail ?? `${label} · server-canonical,改后对全网衰减曲线 / 估值器生效,不回溯已生效报价`,
    });
  // editKind="select" 时传 options → 弹窗渲染勾选 chips(能枚举的值不让手输,最高设计铁律)
  const Adj = ({ label, k, unit, amplify = false, editKind = "number", detail, options }: { label: string; k: string; unit: string; amplify?: boolean; editKind?: "number" | "text" | "select"; detail?: string; options?: string[] }) =>
    <button className={`adj${amplify ? " amp" : ""}`} onClick={() => adj(label, k, unit, amplify, editKind, detail, options)}>调整</button>;

  // 多字段调参:一个「调整」按钮 → 操作确认弹窗里 N 个带标签输入,每字段写各自的 param key
  // (各值独立 backend-replaceable,不挤一个框)。current 实时从 pE(paramKey) 预填。
  type MFField = { key: string; paramKey: string; label: string; placeholder?: string; inputKind?: "number" | "text" | "select"; options?: string[]; wide?: boolean };
  const adjMulti = (title: string, fields: MFField[], opts: { ascending?: boolean; hint?: string; amplify?: boolean; detail?: string } = {}) =>
    ctx.openActionConfirm({
      name: `${title} 调整`, op: "param-multi", amplify: opts.amplify,
      businessForm: {
        kind: "multi-field", title: `目标新值 · ${title}`, ascending: opts.ascending, hint: opts.hint,
        fields: fields.map((f) => ({ key: f.key, label: f.label, current: pE(f.paramKey), placeholder: f.placeholder, inputKind: f.inputKind, options: f.options, wide: f.wide })),
      },
      paramKeys: fields.map((f) => ({ key: f.key, paramKey: f.paramKey })),
      detail: opts.detail ?? `${title} · server-canonical,改后对全网生效,不回溯已生效报价`,
    });
  const AdjMulti = ({ title, fields, ascending, hint, amplify = false, detail }: { title: string; fields: MFField[]; ascending?: boolean; hint?: string; amplify?: boolean; detail?: string }) =>
    <button className={`adj${amplify ? " amp" : ""}`} onClick={() => adjMulti(title, fields, { ascending, hint, amplify, detail })}>调整</button>;

  return (
    <>
      <EStats items={[
        { k: "在网设备平均龄", v: `${num(String(stats.averageAgeMonths), 0).toFixed(1)} 月`, sub: "来自 nx_user_device" },
        { k: `m${s2 + 1}–${cyc} 断崖设备`, v: countText(stats.cliffDeviceCount), sub: "进入晚期", tone: "danger" },
        { k: "Trade-in 本月", v: `${countText(stats.tradeinMonthCount)} 次`, sub: `折抵 ${moneyText(stats.tradeinDiscountUsdt)}`, tone: "cyan" },
        { k: "K2 套利簇命中", v: `${countText(stats.k2ArbitrageHits)} 账户`, sub: "最短持有拦截", tone: "warn" },
      ]} />

      {/* 三段衰减曲线 hero */}
      <section className="curve-card">
        <div className="curve-h">
          <span className="ttl">设备效率衰减曲线</span>
          <span className="sub">三段非线性 · {cyc} 月</span>
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
          <div className="param-h"><span className="ic life"><LifeIcon /></span><div className="t"><div className="nm">设备生命周期</div><div className="s">三段非线性衰减</div></div></div>
          <div className="pkv"><Lbl zh={`早期衰减率(m1–${s1})`} code="degradeEarly" desc="平缓段 · 不刺激置换 · 每月效率下降幅度" /><span className="v ok">{pE("E.device.degradeEarly")}%</span><Adj label="早期衰减率" k="E.device.degradeEarly" unit="%" /></div>
          <div className="pkv"><Lbl zh={`中期衰减率(m${s1 + 1}–${s2})`} code="degradeMid" desc="中速段 · 收益边际下降 · 每月效率下降幅度" /><span className="v warn">{pE("E.device.degradeMid")}%</span><Adj label="中期衰减率" k="E.device.degradeMid" unit="%" /></div>
          <div className="pkv"><Lbl zh={`晚期衰减率(m${s2 + 1}–${cyc})`} code="degradeLate" desc="断崖段 · 驱动置换冲动 · 上调=加快换机现金流(放大资金流出)" hot /><span className="v danger">{pE("E.device.degradeLate")}%</span><Adj label="晚期衰减率" k="E.device.degradeLate" unit="%" amplify detail="晚期断崖衰减率 · 上调加快置换节奏(更多 Trade-in 现金流),m9-12 收益下挫 · 放大资金流出须操作确认 + B1 覆盖率" /></div>
          <div className="pkv"><Lbl zh="最低效能下限" code="minEfficiency · floor" desc="设备效率衰减到此值即不再下降(地板线)" /><span className="v">{pE("E.device.minEfficiency")}%</span><Adj label="最低效能下限" k="E.device.minEfficiency" unit="%" /></div>
          <div className="pkv"><Lbl zh="衰减分段周期" code="stageEarlyEnd / stageMidEnd / cycleMonths" desc={`三段分界月份与总周期 · 早期[1–${s1}] 中期[${s1 + 1}–${s2}] 晚期[${s2 + 1}–${cyc}] · 一处调齐,改后曲线重算`} /><span className="v" style={{ fontSize: 13 }}>早末 m{s1} · 中末 m{s2} · 周期 {cyc}月</span><AdjMulti title="衰减分段周期" ascending hint="三段非线性的分界:早期[1–早末]、中期[早末+1–中末]、晚期[中末+1–总月数];总月数 = 晚期止月(floor 触底)。须 早末 < 中末 < 总月数。改后全曲线 / 估值器重算。" detail="衰减三段周期(早末 / 中末 / 总月数)· server-canonical · 改后对全网衰减曲线 / 估值器生效,不回溯已生效报价" fields={[
            { key: "early", paramKey: "E.device.stageEarlyEnd", label: "早期段末月(m)", inputKind: "number", placeholder: "3" },
            { key: "mid", paramKey: "E.device.stageMidEnd", label: "中期段末月(m)", inputKind: "number", placeholder: "8" },
            { key: "total", paramKey: "E.device.cycleMonths", label: "总周期月数(m)", inputKind: "number", placeholder: "12" },
          ]} /></div>
          <div className="pkv"><Lbl zh="任务锁定月度损失阈" code="taskLock.s1 / .pro / .rack" desc="§6.7 banner 触发依据 · S1 / Pro / Rack 三阶月度损失阈(USDT)" /><span className="v" style={{ fontSize: 13 }}>${pE("E.device.taskLock.s1")} / ${pE("E.device.taskLock.pro")} / ${pE("E.device.taskLock.rack")}</span><AdjMulti title="任务锁定月度损失阈" hint="三档设备(S1 / Pro / Rack)各自的月度损失阈(USDT),达阈触发 §6.7 任务锁定 banner。" detail="任务锁定月度损失阈(S1 / Pro / Rack)· server-canonical · 改后对新触发判定生效" fields={[
            { key: "s1", paramKey: "E.device.taskLock.s1", label: "S1 阈(USDT)", inputKind: "number", placeholder: "40" },
            { key: "pro", paramKey: "E.device.taskLock.pro", label: "Pro 阈(USDT)", inputKind: "number", placeholder: "140" },
            { key: "rack", paramKey: "E.device.taskLock.rack", label: "Rack 阈(USDT)", inputKind: "number", placeholder: "450" },
          ]} /></div>
          <div className="pkv"><Lbl zh="豁免规则" desc="不参与衰减的设备类型" /><span className="v" style={{ fontFamily: "var(--font-v5)", fontSize: 12, fontWeight: 500, color: "var(--ink-3)" }}>手机 + Cloud Share 免衰减</span><span /></div>
          <div className="param-foot"><span className="ic"><AlertIcon /></span><span><b>「晚期衰减率」是高敏参数</b>:上调加快置换节奏(更多 Trade-in 现金流),但 m9-12 收益预期下挫会触发用户负面信号;下调延后置换、减少现金流。<b>各段月份在「衰减分段周期」一行一次调齐</b>(早末 / 中末 / 总月数);衰减率行只改各段速率%。</span></div>
        </section>

        {/* 右:Trade-in 置换配置 */}
        <section className="param-card">
          <div className="param-h"><span className="ic trade"><TradeIcon /></span><div className="t"><div className="nm">Trade-in 置换配置</div><div className="s">折抵定价 · 套利防控</div></div></div>
          <div className="pkv"><Lbl zh="残值率" code="salvage" desc="置换折抵基准 · 旧机残值 = 原价 × 此比例,再与设备月龄复合衰减" /><span className="v cyan">{pE("E.tradein.salvagePct")}%</span><Adj label="残值率" k="E.tradein.salvagePct" unit="%" amplify detail="置换残值率 · 放大资金流出(更高折抵)须操作确认 + B1 覆盖率 · 改后对新报价生效" /></div>
          <div className="pkv"><Lbl zh="残值衰减" code="decay" desc={`旧机残值随设备月龄按三段衰减 · ${cyc} 月触底`} /><span className="v" style={{ fontSize: 13, color: "var(--ink-3)" }}>随三段 · {cyc} 月</span><span /></div>
          <div className="pkv"><Lbl zh="最短持有月数" code="minHoldingMonths" desc="套利窗口闸门 · 设备买后须满此月数才可置换,防快进快出刷折抵" hot /><span className="v warn">{pE("E.tradein.minHoldingMonths")} 月</span><Adj label="最短持有月数" k="E.tradein.minHoldingMonths" unit="月" detail="套利窗口闸门 · 调高收紧 CL-318 拦截、牺牲合法置换体验,调低放大套利风险" /></div>
          <div className="pkv"><Lbl zh="置换资格门槛" code="eligibility" desc="谁可发起置换(持有等级门槛)· 运营可调" /><span className="v" style={{ fontSize: 13, fontFamily: "var(--font-v5)", fontWeight: 500 }}>{pE("E.tradein.eligibility")}</span><Adj label="置换资格门槛" k="E.tradein.eligibility" unit="" editKind="select" options={["全部用户", "L2+ 持有者", "L3+ 持有者", "L4+ 持有者", "L5+ 持有者", "L6+ 持有者"]} detail="置换资格门槛 · 谁可发起置换(持有等级)· 勾选目标等级 · 改后对新置换请求生效" /></div>
          <div className="pkv"><Lbl zh="置换活动倍率" code="promoMult" desc="置换活动加成倍率 · 改后对新报价生效" /><span className="v">{pE("E.tradein.promoMult")}×</span><Adj label="置换活动倍率" k="E.tradein.promoMult" unit="×" amplify detail="置换活动倍率 · 放大资金流出须操作确认 + B1 覆盖率 · 改后对新报价生效" /></div>
          <div className="pkv"><Lbl zh="置换弹窗节奏(5 参)" code="promo.cooldownDays / maxPerSession / delaySec / minAgeDays / routes" desc="置换升级弹窗的 冷却 / 频次 / 延迟 / 设备最低龄 / 入口路由" /><span className="v" style={{ fontSize: 13, color: "var(--ink-3)" }}>冷却{pE("E.tradein.promo.cooldownDays")}d · {pE("E.tradein.promo.maxPerSession")}/会话 · 延迟{pE("E.tradein.promo.delaySec")}s · 龄≥{pE("E.tradein.promo.minAgeDays")}d</span><AdjMulti title="置换弹窗节奏(5 参)" hint="设备龄 ≥ 最低龄后,弹窗按 冷却天数 + 每会话上限 节流,延迟 N 秒于指定入口路由展示。改后对新弹窗节奏生效。" detail="置换弹窗节奏 5 参 · server-canonical · 改后对新弹窗节奏生效" fields={[
            { key: "cooldownDays", paramKey: "E.tradein.promo.cooldownDays", label: "冷却天数(d)", inputKind: "number", placeholder: "14" },
            { key: "maxPerSession", paramKey: "E.tradein.promo.maxPerSession", label: "每会话上限(次)", inputKind: "number", placeholder: "1" },
            { key: "delaySec", paramKey: "E.tradein.promo.delaySec", label: "延迟(秒)", inputKind: "number", placeholder: "6" },
            { key: "minAgeDays", paramKey: "E.tradein.promo.minAgeDays", label: "设备最低龄(d)", inputKind: "number", placeholder: "30" },
            { key: "routes", paramKey: "E.tradein.promo.routes", label: "入口路由(勾选页面)", inputKind: "select", options: ["/me/devices", "/me", "/store", "/earn", "全部页面"], wide: true },
          ]} /></div>
          <div className="pkv"><Lbl zh="库存软上限告警" code="inventory.softMax" desc="回收旧机库存软上限 · 超过即告警 · 0 = 禁用" /><span className="v">{pE("E.tradein.inventorySoftMax")} 台</span><Adj label="库存软上限告警" k="E.tradein.inventorySoftMax" unit="台" /></div>
          <div className="pkv"><Lbl zh="本月置换笔数" desc={`折抵总额 ${moneyText(stats.tradeinDiscountUsdt)}`} /><span className="v cyan">{countText(stats.tradeinMonthCount)}</span><span /></div>
          <div className="pkv"><Lbl zh="K2 套利簇命中" desc="最短持有拦截" /><span className="v warn">{countText(stats.k2ArbitrageHits)}</span><span /></div>
          <div className="param-foot cyan"><span className="ic"><ShieldIcon /></span><span><b>K2 监控</b>:「最短持有月数」是套利窗口闸门 — 调低风险簇 CL-318(短持有 → 置换 → 反手买入)放大,调高牺牲合法置换体验。「残值率」与「置换活动倍率」为<b>放大资金流出</b>动作(带 ⚡),须操作确认 + B1 覆盖率核验。</span></div>
        </section>
      </div>

      {/* 原子换机 tx 监控 */}
      <section className="tx-card">
        <div className="tx-h">
          <span className="ttl">原子换机 tx 监控</span>
          <span className="sub">· server 单事务 · 任一步失败全回滚(设备数组 + 余额 + bill)· 防 half-completed replace</span>
          <span className="r"><CodeTag tone="electric">A2 审计</CodeTag><span>24h · 成功率 <span style={{ color: "var(--success)" }}>{txSuccessRate.toFixed(1)}%</span></span></span>
        </div>
        <div className="tx-grid">
          {e3Operations.length === 0 ? (
            <div className="tx-col">
              <div className="nm">暂无 tx 指标</div>
              <div className="latest"><div className="k">后端暂无记录</div><div className="vrow"><span className="dot ok" /><span className="reason">等待业务表产生 Trade-in 操作样本</span></div></div>
            </div>
          ) : e3Operations.map((t) => (
            <div className="tx-col" key={t.nm}>
              <div className="nm">{t.nm}</div>
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
      </section>
      <p className="f-foot">设备衰减曲线 + Trade-in 残值率<b>共同构成用户置换节奏</b>:晚期断崖把用户推向置换决策点,残值率决定置换吸引力。两者改动会影响:① 硬件 GMV(置换新单)② D4 资金应付(置换补差)③ K2 套利风险。任一参数调整后<b>立即对前端 / 估值器生效</b>(不回溯已生效报价)。</p>
    </>
  );
}
