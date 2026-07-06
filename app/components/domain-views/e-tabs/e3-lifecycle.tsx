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
  "E.device.capacity.band1DeltaPct",
  "E.device.capacity.band2DeltaPct",
  "E.device.capacity.band3DeltaPct",
  "E.device.stageEarlyEnd",
  "E.device.stageMidEnd",
  "E.device.cycleMonths",
  "E.device.capacity.floorPct",
  "E.device.capacity.subsidyDays",
  "E.tradein.enabled",
  "E.tradein.ladder.cut1",
  "E.tradein.ladder.credit1",
  "E.tradein.requireHigherPrice",
  "E.tradein.promoMult",
];

// FEAT-DEV01: 参与任务递减(每 SKU 开关)· 值=参与递减/免递减 · 与 uniapp CAPACITY_EXEMPT_KINDS 镜像(canon 哨兵对账)
const APPLY_TO_SKUS: { kind: string; label: string }[] = [
  { kind: "phone", label: "手机" },
  { kind: "cloud-share", label: "Cloud Share" },
  { kind: "pc-gpu", label: "电脑共享" },
  { kind: "stellarbox-s1", label: "NexionBox S1" },
  { kind: "stellarbox-pro", label: "NexionBox Pro" },
  { kind: "stellarbox-pro-v2", label: "NexionBox Pro v2" },
  { kind: "stellarrack-p1", label: "NexionRack P1" },
  { kind: "stellarrack-p2", label: "NexionRack P2" },
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

  const early = num(pE("E.device.capacity.band1DeltaPct"), -4);
  const mid = num(pE("E.device.capacity.band2DeltaPct"), -6);
  const late = num(pE("E.device.capacity.band3DeltaPct"), -23.7);
  const s1 = Math.max(1, Math.round(num(pE("E.device.stageEarlyEnd"), 3)));
  const s2 = Math.max(s1 + 1, Math.round(num(pE("E.device.stageMidEnd"), 8)));
  const cyc = Math.max(s2 + 1, Math.round(num(pE("E.device.cycleMonths"), 12)));
  const floorPct = Math.max(0, Math.min(99, num(pE("E.device.capacity.floorPct"), 22)));
  const exemptCount = APPLY_TO_SKUS.filter((s) => pE(`E.device.capacity.applyTo.${s.kind}`) === "免递减").length;
  // FEAT-DEV02 置换阶梯:界点 4 + 抵扣率 5(区间左闭右开,连续性由构造保证)。
  const ladderCuts = [1, 2, 3, 4].map((i) => pE(`E.tradein.ladder.cut${i}`));
  const ladderCredits = [1, 2, 3, 4, 5].map((i) => pE(`E.tradein.ladder.credit${i}`));
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
      detail: detail ?? `${label} · server-canonical,改后对全网任务产能曲线 / 估值器生效,不回溯已生效报价`,
    });
  // editKind="select" 时传 options → 弹窗渲染勾选 chips(能枚举的值不让手输,最高设计铁律)
  const Adj = ({ label, k, unit, amplify = false, editKind = "number", detail, options }: { label: string; k: string; unit: string; amplify?: boolean; editKind?: "number" | "text" | "select"; detail?: string; options?: string[] }) =>
    <button className={`adj${amplify ? " amp" : ""}`} onClick={() => adj(label, k, unit, amplify, editKind, detail, options)}>调整</button>;

  // 多字段调参:一个「调整」按钮 → 操作确认弹窗里 N 个带标签输入,每字段写各自的 param key
  // (各值独立 backend-replaceable,不挤一个框)。current 实时从 pE(paramKey) 预填。
  type MFField = { key: string; paramKey: string; label: string; placeholder?: string; inputKind?: "number" | "text" | "select"; options?: string[]; wide?: boolean; warnAbove?: number; warnText?: string };
  const adjMulti = (title: string, fields: MFField[], opts: { ascending?: boolean; hint?: string; amplify?: boolean; detail?: string } = {}) =>
    ctx.openActionConfirm({
      name: `${title} 调整`, op: "param-multi", amplify: opts.amplify,
      businessForm: {
        kind: "multi-field", title: `目标新值 · ${title}`, ascending: opts.ascending, hint: opts.hint,
        fields: fields.map((f) => ({ key: f.key, label: f.label, current: pE(f.paramKey), placeholder: f.placeholder, inputKind: f.inputKind, options: f.options, wide: f.wide, warnAbove: f.warnAbove, warnText: f.warnText })),
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
        { k: `m${s2 + 1}+ 晚段低产能设备`, v: countText(stats.cliffDeviceCount), sub: "进入深降段", tone: "danger" },
        { k: "Trade-in 本月", v: `${countText(stats.tradeinMonthCount)} 次`, sub: `折抵 ${moneyText(stats.tradeinDiscountUsdt)}`, tone: "cyan" },
        { k: "K2 套利簇命中", v: `${countText(stats.k2ArbitrageHits)} 账户`, sub: "风险簇拦截", tone: "warn" },
      ]} />

      {/* 三段衰减曲线 hero */}
      <section className="curve-card">
        <div className="curve-h">
          <span className="ttl">任务产能曲线</span>
          <span className="sub">AI 任务池升级 · 低阶任务量随月龄递减 · {cyc} 月视窗 · server-canonical(与前端配置同源)</span>
          <span className="r"><CodeTag tone="electric">E.device.capacity.*</CodeTag></span>
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
          <div className="stage-tag early"><div className="nm">段1 · m1–{s1}</div><div className="ct">{early}% / 月 · 平缓</div></div>
          <div className="stage-tag mid"><div className="nm">段2 · m{s1 + 1}–{s2}</div><div className="ct">{mid}% / 月 · 中速递减</div></div>
          <div className="stage-tag late"><div className="nm">段3 · m{s2 + 1}+</div><div className="ct">{late}% / 月 · 深降 · 驱动升级置换</div></div>
        </div>
      </section>

      {/* 双列参数卡 */}
      <div className="params-grid">
        {/* 左:任务产能节奏(FEAT-DEV01 · 等效换皮:数值=原三段曲线,叙事改任务产能) */}
        <section className="param-card">
          <div className="param-h"><span className="ic life"><LifeIcon /></span><div className="t"><div className="nm">任务产能节奏</div><div className="s">AI 任务池升级 · 三段产能递减 · server 权威</div></div><span className="tag">E.device.capacity.*</span></div>
          <div className="pkv"><Lbl zh={`段1 产能变化(m1–${s1})`} code="band1DeltaPct" desc="平缓段 · 每月可接任务量变化幅度 · 不刺激置换" /><span className="v ok">{pE("E.device.capacity.band1DeltaPct")}%</span><Adj label="段1 产能变化" k="E.device.capacity.band1DeltaPct" unit="%" /></div>
          <div className="pkv"><Lbl zh={`段2 产能变化(m${s1 + 1}–${s2})`} code="band2DeltaPct" desc="中速段 · 可接任务量边际下降" /><span className="v warn">{pE("E.device.capacity.band2DeltaPct")}%</span><Adj label="段2 产能变化" k="E.device.capacity.band2DeltaPct" unit="%" /></div>
          <div className="pkv"><Lbl zh={`段3 产能变化(m${s2 + 1} 起)`} code="band3DeltaPct" desc="深降段 · 驱动升级置换 · 加深幅度=加快换机现金流(放大资金流出)" hot /><span className="v danger">{pE("E.device.capacity.band3DeltaPct")}%</span><Adj label="段3 产能变化" k="E.device.capacity.band3DeltaPct" unit="%" amplify detail="段3 深降产能变化 · 加深幅度加快置换节奏(更多 Trade-in 现金流),晚段收益下挫 · 放大资金流出须操作确认 + B1 覆盖率" /></div>
          <div className="pkv"><Lbl zh="产能下限" code="floorPct" desc="设备可接任务产能降至此值即不再下降(地板线)" /><span className="v">{pE("E.device.capacity.floorPct")}%</span><Adj label="产能下限" k="E.device.capacity.floorPct" unit="%" /></div>
          <div className="pkv"><Lbl zh="新机任务补贴天数" code="subsidyDays" desc="新激活设备的任务补贴期 · 补贴期内前端只显示补贴标注、不显示产能百分比 · 纯展示层,不进结算" /><span className="v cyan">{pE("E.device.capacity.subsidyDays")} 天</span><Adj label="新机任务补贴天数" k="E.device.capacity.subsidyDays" unit="天" detail="新机任务补贴天数 · 纯展示层参数(前端标注窗口),不进入结算公式 · 改后对新渲染生效" /></div>
          <div className="pkv"><Lbl zh="产能分段周期" code="stageEarlyEnd / stageMidEnd / cycleMonths" desc={`三段分界月份与曲线视窗 · 段1[1–${s1}] 段2[${s1 + 1}–${s2}] 段3[${s2 + 1}+ 开区间] · 一处调齐,改后曲线重算`} /><span className="v" style={{ fontSize: 13 }}>段1末 m{s1} · 段2末 m{s2} · 视窗 {cyc}月</span><AdjMulti title="产能分段周期" ascending hint="三段产能节奏的分界:段1[1–段1末]、段2[段1末+1–段2末]、段3[段2末+1 起,开区间到产能下限触底];视窗月数只决定曲线图表范围。须 段1末 < 段2末 < 视窗月数。改后全曲线 / 估值器重算。" detail="产能三段周期(段1末 / 段2末 / 视窗月数)· server-canonical · 改后对全网任务产能曲线 / 估值器生效,不回溯已生效报价" fields={[
            { key: "early", paramKey: "E.device.stageEarlyEnd", label: "段1 末月(m)", inputKind: "number", placeholder: "3" },
            { key: "mid", paramKey: "E.device.stageMidEnd", label: "段2 末月(m)", inputKind: "number", placeholder: "8" },
            { key: "total", paramKey: "E.device.cycleMonths", label: "曲线视窗月数(m)", inputKind: "number", placeholder: "12" },
          ]} /></div>
          <div className="pkv"><Lbl zh="任务锁定月度损失阈" code="taskLock.s1 / .pro / .rack" desc="§6.7 banner 触发依据 · S1 / Pro / Rack 三阶月度损失阈(USDT)" /><span className="v" style={{ fontSize: 13 }}>${pE("E.device.taskLock.s1")} / ${pE("E.device.taskLock.pro")} / ${pE("E.device.taskLock.rack")}</span><AdjMulti title="任务锁定月度损失阈" hint="三档设备(S1 / Pro / Rack)各自的月度损失阈(USDT),达阈触发 §6.7 任务锁定 banner。" detail="任务锁定月度损失阈(S1 / Pro / Rack)· server-canonical · 改后对新触发判定生效" fields={[
            { key: "s1", paramKey: "E.device.taskLock.s1", label: "S1 阈(USDT)", inputKind: "number", placeholder: "40" },
            { key: "pro", paramKey: "E.device.taskLock.pro", label: "Pro 阈(USDT)", inputKind: "number", placeholder: "140" },
            { key: "rack", paramKey: "E.device.taskLock.rack", label: "Rack 阈(USDT)", inputKind: "number", placeholder: "450" },
          ]} /></div>
          <div className="pkv"><Lbl zh="参与任务递减(SKU)" code="applyTo.*" desc="逐 SKU 控制是否参与产能递减 · 免递减 = 恒 100% 产能(入门引流设备默认免)" /><span className="v" style={{ fontSize: 13 }}>{exemptCount} 免 / {APPLY_TO_SKUS.length - exemptCount} 参与</span><AdjMulti title="参与任务递减(SKU)" hint="逐 SKU 勾选:参与递减 = 按产能节奏逐月递减;免递减 = 恒 100% 产能(手机 / Cloud Share / 电脑共享默认免,保护入门体验)。改后对该 SKU 全网设备生效。" detail="参与任务递减(每 SKU 开关)· server-canonical · 与前端豁免清单镜像对账 · 改后对该 SKU 全网设备生效" fields={APPLY_TO_SKUS.map((s) => ({ key: s.kind, paramKey: `E.device.capacity.applyTo.${s.kind}`, label: s.label, inputKind: "select" as const, options: ["参与递减", "免递减"] }))} /></div>
          <div className="param-foot"><span className="ic"><AlertIcon /></span><span><b>「段3 产能变化」是高敏参数</b>:加深幅度加快置换节奏(更多 Trade-in 现金流),但晚段收益预期下挫会触发用户负面信号;放缓则延后置换、减少现金流。<b>各段月份在「产能分段周期」一行一次调齐</b>;各段行只改每月变化幅度%。<b>「新机任务补贴」是纯展示层</b>——只控制前端补贴标注窗口,结算数学始终按产能曲线连续计算。</span></div>
        </section>

        {/* 右:升级置换阶梯(FEAT-DEV02 · 无代际,随时下架,产出阶梯抵扣) */}
        <section className="param-card">
          <div className="param-h"><span className="ic trade"><TradeIcon /></span><div className="t"><div className="nm">升级置换阶梯</div><div className="s">产出阶梯折抵 · 随时置换</div></div><span className="tag">E.tradein.*</span></div>
          <div className="pkv"><Lbl zh="置换总开关" code="enabled" desc="关闭后前端全部置换入口隐藏(设备列表/结算拦截同步失效)" hot /><span className="v" style={{ fontSize: 13, fontWeight: 600 }}>{pE("E.tradein.enabled")}</span><Adj label="置换总开关" k="E.tradein.enabled" unit="" editKind="select" options={["开", "关"]} detail="置换总开关 · 关闭=前端全部置换入口隐藏 · 改后对新渲染生效" /></div>
          <div className="pkv"><Lbl zh="当前阶梯一览" desc="抵扣率 = 实付价 × 档位比例;档位按「累计产出 ÷ 实付价」落档,产出越多抵扣越小" /><span className="v" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{ladderCredits.join(" / ")}%(界点 {ladderCuts.join("/")}%)</span><span /></div>
          <div className="pkv"><Lbl zh="阶梯分档界点(4)" code="ladder.cut1–4" desc="产出比的 4 个分档界点(%)· 区间左闭右开、由构造连续无重叠" /><span className="v" style={{ fontSize: 13 }}>{ladderCuts.map((c) => `${c}%`).join(" · ")}</span><AdjMulti title="阶梯分档界点" ascending hint="按「该设备累计产出 ÷ 实付价」的百分比分 5 档:第1档 [0,界点1),第2档 [界点1,界点2)……第5档 [界点4,∞)。须严格递增。改后对新报价生效。" detail="阶梯分档界点(4 值)· server-canonical · 与前端阶梯字面量三端对账 · 改后对新报价生效" fields={[
            { key: "cut1", paramKey: "E.tradein.ladder.cut1", label: "界点1(%)", inputKind: "number", placeholder: "25" },
            { key: "cut2", paramKey: "E.tradein.ladder.cut2", label: "界点2(%)", inputKind: "number", placeholder: "50" },
            { key: "cut3", paramKey: "E.tradein.ladder.cut3", label: "界点3(%)", inputKind: "number", placeholder: "75" },
            { key: "cut4", paramKey: "E.tradein.ladder.cut4", label: "界点4(%)", inputKind: "number", placeholder: "100" },
          ]} /></div>
          <div className="pkv"><Lbl zh="各档抵扣率(5)" code="ladder.credit1–5" desc="5 档抵扣比例(按实付价的 %)· 须逐档递减(产出越多抵扣越小)" hot /><span className="v danger">{ladderCredits.map((c) => `${c}%`).join(" · ")}</span><AdjMulti title="各档抵扣率" amplify hint="第1档(产出比最低)抵扣最高,逐档递减到第5档(已回本)。上调任一档=放大资金流出。哨兵校验:递减、(0,100]。" detail="各档抵扣率(5 值)· 放大资金流出须操作确认 + B1 覆盖率 · 与前端阶梯字面量三端对账 · 改后对新报价生效" fields={[
            { key: "credit1", paramKey: "E.tradein.ladder.credit1", label: "第1档 <界点1(%)", inputKind: "number", placeholder: "75", warnAbove: 75, warnText: "超过 75%:显著提高置换让利,确认前请核 B1 覆盖率" },
            { key: "credit2", paramKey: "E.tradein.ladder.credit2", label: "第2档(%)", inputKind: "number", placeholder: "60", warnAbove: 75, warnText: "超过 75%:显著提高置换让利,确认前请核 B1 覆盖率" },
            { key: "credit3", paramKey: "E.tradein.ladder.credit3", label: "第3档(%)", inputKind: "number", placeholder: "45", warnAbove: 75, warnText: "超过 75%:显著提高置换让利,确认前请核 B1 覆盖率" },
            { key: "credit4", paramKey: "E.tradein.ladder.credit4", label: "第4档(%)", inputKind: "number", placeholder: "30", warnAbove: 75, warnText: "超过 75%:显著提高置换让利,确认前请核 B1 覆盖率" },
            { key: "credit5", paramKey: "E.tradein.ladder.credit5", label: "第5档 ≥界点4(%)", inputKind: "number", placeholder: "15", warnAbove: 75, warnText: "超过 75%:显著提高置换让利,确认前请核 B1 覆盖率" },
          ]} /></div>
          <div className="pkv"><Lbl zh="仅限升级更高价设备" code="requireHigherPrice" desc="开=置换目标必须严格高于本机实付价(抵扣只服务升级,不做平换/降换)" /><span className="v" style={{ fontSize: 13, fontWeight: 600 }}>{pE("E.tradein.requireHigherPrice")}</span><Adj label="仅限升级更高价设备" k="E.tradein.requireHigherPrice" unit="" editKind="select" options={["开", "关"]} detail="仅限升级更高价设备 · 关闭后允许平换(抵扣可能逼近应付款,请先核 B1 覆盖率) · 改后对新置换请求生效" /></div>
          <div className="pkv"><Lbl zh="单笔最多抵扣台数" code="maxDevicesPerOrder" desc="一笔升级订单最多可用几台旧机抵扣" /><span className="v">{pE("E.tradein.maxDevicesPerOrder")} 台</span><Adj label="单笔最多抵扣台数" k="E.tradein.maxDevicesPerOrder" unit="台" detail="单笔最多抵扣台数 · 改后对新置换请求生效" /></div>
          <div className="pkv"><Lbl zh="置换资格门槛" code="eligibility" desc="谁可发起置换(持有等级门槛)· 运营可调" /><span className="v" style={{ fontSize: 13, fontFamily: "var(--font-v5)", fontWeight: 500 }}>{pE("E.tradein.eligibility")}</span><Adj label="置换资格门槛" k="E.tradein.eligibility" unit="" editKind="select" options={["全部用户", "L2+ 持有者", "L3+ 持有者", "L4+ 持有者", "L5+ 持有者", "L6+ 持有者"]} detail="置换资格门槛 · 谁可发起置换(持有等级)· 勾选目标等级 · 改后对新置换请求生效" /></div>
          <div className="pkv"><Lbl zh="置换活动倍率" code="promoMult" desc="置换活动加成倍率 · 改后对新报价生效" /><span className="v">{pE("E.tradein.promoMult")}×</span><AdjMulti title="置换活动倍率" amplify detail="置换活动倍率 · 放大资金流出须操作确认 + B1 覆盖率 · 改后对新报价生效" fields={[
            { key: "promoMult", paramKey: "E.tradein.promoMult", label: "促销乘数(×)", inputKind: "number", placeholder: "1.0", warnAbove: 1.5, warnText: "超过 1.5×:显著放大置换让利,确认前请核 B1 覆盖率" },
          ]} /></div>
          <div className="pkv"><Lbl zh="置换弹窗节奏(5 参)" code="promo.cooldownDays / maxPerSession / delaySec / minAgeDays / routes" desc="置换升级弹窗的 冷却 / 频次 / 延迟 / 设备最低龄 / 入口路由" /><span className="v" style={{ fontSize: 13, color: "var(--ink-3)" }}>冷却{pE("E.tradein.promo.cooldownDays")}d · {pE("E.tradein.promo.maxPerSession")}/会话 · 延迟{pE("E.tradein.promo.delaySec")}s · 龄≥{pE("E.tradein.promo.minAgeDays")}d</span><AdjMulti title="置换弹窗节奏(5 参)" hint="设备龄 ≥ 最低龄后,弹窗按 冷却天数 + 每会话上限 节流,延迟 N 秒于指定入口路由展示。改后对新弹窗节奏生效。" detail="置换弹窗节奏 5 参 · server-canonical · 改后对新弹窗节奏生效" fields={[
            { key: "cooldownDays", paramKey: "E.tradein.promo.cooldownDays", label: "冷却天数(d)", inputKind: "number", placeholder: "14" },
            { key: "maxPerSession", paramKey: "E.tradein.promo.maxPerSession", label: "每会话上限(次)", inputKind: "number", placeholder: "1" },
            { key: "delaySec", paramKey: "E.tradein.promo.delaySec", label: "延迟(秒)", inputKind: "number", placeholder: "6" },
            { key: "minAgeDays", paramKey: "E.tradein.promo.minAgeDays", label: "设备最低龄(d)", inputKind: "number", placeholder: "30" },
            { key: "routes", paramKey: "E.tradein.promo.routes", label: "入口路由(勾选页面)", inputKind: "select", options: ["/me/devices", "/me", "/store", "/earn", "全部页面"], wide: true },
          ]} /></div>
          <div className="pkv"><Lbl zh="库存软上限告警" code="inventory.softMax" desc="回收旧机库存软上限 · 超过即告警 · 0 = 禁用" /><span className="v">{pE("E.tradein.inventorySoftMax")} 台</span><Adj label="库存软上限告警" k="E.tradein.inventorySoftMax" unit="台" /></div>
          <div className="pkv"><Lbl zh="本月置换笔数" desc={`折抵总额 ${moneyText(stats.tradeinDiscountUsdt)}`} /><span className="v cyan">{countText(stats.tradeinMonthCount)}</span><span /></div>
          <div className="pkv"><Lbl zh="K2 套利簇命中" desc="风险簇拦截" /><span className="v warn">{countText(stats.k2ArbitrageHits)}</span><span /></div>
          <div className="param-foot cyan"><span className="ic"><ShieldIcon /></span><span><b>阶梯天然抗套利</b>:抵扣仅在结算时抵减升级应付款、<b>永不进入余额</b>,且默认仅限升级更高价设备 — 每笔置换平台都净收新款,「随时下架」无需最短持有闸门。高抵扣档(新设备早升级)正是运营期望的行为。「各档抵扣率」与「置换活动倍率」为<b>放大资金流出</b>动作(带 ⚡),须操作确认 + B1 覆盖率核验;K2 风险簇监控保留(异常批量置换仍会命中)。</span></div>
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
              <div className="nm">暂无 tx 指标<span className="endpoint">GET /api/admin/devices/e3/tradein/overview</span></div>
              <div className="latest"><div className="k">后端暂无记录</div><div className="vrow"><span className="dot ok" /><span className="reason">等待业务表产生 Trade-in 操作样本</span></div></div>
            </div>
          ) : e3Operations.map((t) => (
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
      <p className="f-foot">任务产能节奏 + Trade-in 折抵定价<b>共同构成用户升级节奏</b>:段3 深降把用户推向置换决策点,折抵力度决定置换吸引力。两者改动会影响:① 硬件 GMV(置换新单)② D4 资金应付(置换补差)③ K2 套利风险。任一参数调整后<b>立即对前端 / 估值器生效</b>(不回溯已生效报价)。</p>
    </>
  );
}
