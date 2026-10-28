import Link from "next/link";
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
        {code ? <span title={`技术字段：${code}`} aria-label={`技术字段：${code}`} /> : null}
        {hot ? <span className="hot" title="敏感参数：会影响平台支出或被人钻空子，修改前请慎重">敏感</span> : null}
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
  "E.device.capacity.applyTo.phone",
  "E.device.capacity.applyTo.cloud-share",
  "E.device.capacity.applyTo.pc-gpu",
  "E.device.capacity.applyTo.stellarbox-s1",
  "E.device.capacity.applyTo.stellarbox-pro",
  "E.device.capacity.applyTo.stellarbox-pro-v2",
  "E.device.capacity.applyTo.stellarrack-p1",
  "E.device.capacity.applyTo.stellarrack-p2",
  "E.device.taskLock.s1",
  "E.device.taskLock.pro",
  "E.device.taskLock.rack",
  "E.tradein.enabled",
  "E.tradein.ladder.cut1",
  "E.tradein.ladder.cut2",
  "E.tradein.ladder.cut3",
  "E.tradein.ladder.cut4",
  "E.tradein.ladder.credit1",
  "E.tradein.ladder.credit2",
  "E.tradein.ladder.credit3",
  "E.tradein.ladder.credit4",
  "E.tradein.ladder.credit5",
  "E.tradein.requireHigherPrice",
  "E.tradein.maxDevicesPerOrder",
  "E.tradein.eligibility",
];

// FEAT-DEV01: 参与任务递减(每 SKU 开关)· 值=参与递减/免递减 · 与 uniapp CAPACITY_EXEMPT_KINDS 镜像(canon 哨兵对账)
const APPLY_TO_SKUS: { kind: string; label: string }[] = [
  { kind: "phone", label: "手机" },
  { kind: "cloud-share", label: "云端共享份额" },
  { kind: "pc-gpu", label: "电脑共享" },
  { kind: "stellarbox-s1", label: "UVELBox S1" },
  { kind: "stellarbox-pro", label: "UVELBox Pro" },
  { kind: "stellarbox-pro-v2", label: "UVELBox Pro v2" },
  { kind: "stellarrack-p1", label: "UVELRack P1" },
  { kind: "stellarrack-p2", label: "UVELRack P2" },
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
        <div className="param-h"><span className="ic life"><LifeIcon /></span><div className="t"><div className="nm">设置加载不完整</div><div className="s">{e3Loading ? "正在加载…" : e3Error || "部分设置没有加载出来"}</div></div></div>
        <div className="param-foot"><span className="ic"><AlertIcon /></span><span>{e3Error ? `加载失败：${e3Error}` : "正在加载…"}</span></div>
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
  // 分母为 0 时成功率不可计算,不是 0%。此前把「24h 内一次事务都没有」渲染成
  // 「成功率 0.0%」,读起来就是「事务全部失败」——与旁边三列全 0 的事实互相矛盾。
  const txSampleSize = totalTxSuccess + totalTxFailure;
  const txSuccessRate = txSampleSize > 0 ? (totalTxSuccess / txSampleSize) * 100 : null;

  const px = (i: number) => (i / cyc) * 700;
  const py = (v: number) => 4 + ((100 - v) / (100 - floorPct)) * 183;
  const pathOf = (from: number, to: number) =>
    curve.slice(from, to + 1).map((v, j) => `${j ? "L" : "M"}${px(from + j).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");
  const emphasized = [0, s1, s2, cyc];
  const dotColor = (i: number) => (i <= s1 ? "var(--success)" : i <= s2 ? "var(--warning)" : "var(--brand-2)");

  // 调参按钮:走 操作确认 param(显式 edit 契约),真写后端 E3 配置接口 → 曲线/估值器据 pE 重算
  const numericBounds = (key: string): { min?: number; max?: number; step?: number } => {
    if (/capacity\.band\dDeltaPct$/.test(key)) return { min: -100, max: 100, step: 0.01 };
    if (/capacity\.floorPct$|ladder\.(cut|credit)\d$/.test(key)) return { min: 0, max: 100, step: 0.01 };
    if (/stageEarlyEnd|stageMidEnd|cycleMonths|maxDevicesPerOrder/.test(key)) return { min: 1, max: 1000000, step: 1 };
    return { min: 0, max: 1000000, step: 1 };
  };
  const adj = (label: string, key: string, unit: string, amplify: boolean, editKind: "number" | "text" | "select" = "number", detail?: string, options?: string[]) =>
    ctx.openActionConfirm({
      name: `${label} 调整`, op: "param", paramKey: key, amplify,
      edit: { kind: editKind, current: pE(key), unit, options, disallowCurrent: true, ...(editKind === "number" ? numericBounds(key) : {}) },
      detail: detail ?? `${label}：修改后对所有设备的产能和以旧换新估价生效，已给出的报价不变。`,
    });
  // editKind="select" 时传 options → 弹窗渲染勾选 chips(能枚举的值不让手输,最高设计铁律)
  const Adj = ({ label, k, unit, amplify = false, editKind = "number", detail, options }: { label: string; k: string; unit: string; amplify?: boolean; editKind?: "number" | "text" | "select"; detail?: string; options?: string[] }) =>
    ctx.canWriteE3
      ? <button className={`adj${amplify ? " amp" : ""}`} onClick={() => adj(label, k, unit, amplify, editKind, detail, options)}>调整</button>
      : null;

  // 多字段调参:一个「调整」按钮 → 操作确认弹窗里 N 个带标签输入,每字段写各自的 param key
  // (各值独立 backend-replaceable,不挤一个框)。current 实时从 pE(paramKey) 预填。
  type MFField = { key: string; paramKey: string; label: string; placeholder?: string; inputKind?: "number" | "text" | "select"; options?: string[]; min?: number; max?: number; step?: number; wide?: boolean; warnAbove?: number; warnText?: string };
  const adjMulti = (title: string, fields: MFField[], opts: { ascending?: boolean; hint?: string; amplify?: boolean; detail?: string } = {}) =>
    ctx.openActionConfirm({
      name: `${title} 调整`, op: "param-multi", amplify: opts.amplify,
      businessForm: {
        kind: "multi-field", title, ascending: opts.ascending, hint: opts.hint, requireAnyChange: true,
        fields: fields.map((f) => {
          const bounds = f.inputKind === "number" ? numericBounds(f.paramKey) : {};
          return { key: f.key, label: f.label, current: pE(f.paramKey), placeholder: f.placeholder, inputKind: f.inputKind, options: f.options, min: f.min ?? bounds.min, max: f.max ?? bounds.max, step: f.step ?? bounds.step, wide: f.wide, warnAbove: f.warnAbove, warnText: f.warnText };
        }),
      },
      paramKeys: fields.map((f) => ({ key: f.key, paramKey: f.paramKey })),
      detail: opts.detail ?? `${title}：修改后对所有设备生效，已给出的报价不变。`,
    });
  const AdjMulti = ({ title, fields, ascending, hint, amplify = false, detail }: { title: string; fields: MFField[]; ascending?: boolean; hint?: string; amplify?: boolean; detail?: string }) =>
    ctx.canWriteE3
      ? <button className={`adj${amplify ? " amp" : ""}`} onClick={() => adjMulti(title, fields, { ascending, hint, amplify, detail })}>调整</button>
      : null;

  return (
    <>
      <EStats items={[
        { k: "当前在网设备平均使用时长", v: `${num(String(stats.averageAgeMonths), 0).toFixed(1)} 月`, sub: "按当前在网设备汇总" },
        { k: `第 ${s2 + 1} 月起的低产能设备`, v: countText(stats.cliffDeviceCount), sub: "产能快速下降中", tone: "danger" },
        { k: "以旧换新 本月", v: `${countText(stats.tradeinMonthCount)} 次`, sub: `折抵 ${moneyText(stats.tradeinDiscountUsdt)}`, tone: "cyan" },
        { k: "疑似套利被拦截", v: `${countText(stats.k2ArbitrageHits)} 个账户`, sub: "来自异常套利排查", tone: "warn" },
      ]} />

      {/* 三段衰减曲线 hero */}
      <section className="curve-card">
        <div className="curve-h">
          <span className="ttl">任务产能曲线</span>
          <span className="sub">设备用得越久，能接的低阶任务越少 · 显示前 {cyc} 个月</span>
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
          <div className="curve-floor" style={{ top: `${(py(floorPct) / 240) * 100}%` }}>最低产能 {floorPct}%</div>
          <div className="curve-x">{Array.from({ length: Math.floor(cyc / 2) + 1 }, (_, j) => <span key={j}>m{j * 2}</span>)}</div>
        </div>
        <div className="stage-lbl">
          <div className="stage-tag early"><div className="nm">前期 · 第 1–{s1} 月</div><div className="ct">{early}% / 月 · 缓慢下降</div></div>
          <div className="stage-tag mid"><div className="nm">中期 · 第 {s1 + 1}–{s2} 月</div><div className="ct">{mid}% / 月 · 中速下降</div></div>
          <div className="stage-tag late"><div className="nm">后期 · 第 {s2 + 1} 月起</div><div className="ct">{late}% / 月 · 快速下降 · 促使用户换新</div></div>
        </div>
      </section>

      {/* 双列参数卡 */}
      <div className="params-grid">
        {/* 左:任务产能节奏(FEAT-DEV01 · 等效换皮:数值=原三段曲线,叙事改任务产能) */}
        <section className="param-card">
          <div className="param-h"><span className="ic life"><LifeIcon /></span><div className="t"><div className="nm">任务产能节奏</div><div className="s">设备产能分三段逐月下降</div></div><span className="tag">设备产能设置</span></div>
          <div className="pkv"><Lbl zh={`前期每月变化（第 1–${s1} 月）`} code="band1DeltaPct" desc="前期每月下降多少，降得慢，不会促使换新" /><span className="v ok">{pE("E.device.capacity.band1DeltaPct")}%</span><Adj label="前期每月变化" k="E.device.capacity.band1DeltaPct" unit="%" /></div>
          <div className="pkv"><Lbl zh={`中期每月变化（第 ${s1 + 1}–${s2} 月）`} code="band2DeltaPct" desc="中期每月下降多少" /><span className="v warn">{pE("E.device.capacity.band2DeltaPct")}%</span><Adj label="中期每月变化" k="E.device.capacity.band2DeltaPct" unit="%" /></div>
          <div className="pkv"><Lbl zh={`后期每月变化（第 ${s2 + 1} 月起）`} code="band3DeltaPct" desc="后期每月下降多少，降得越快，用户越早换新" hot /><span className="v danger">{pE("E.device.capacity.band3DeltaPct")}%</span><Adj label="后期每月变化" k="E.device.capacity.band3DeltaPct" unit="%" amplify detail="后期降得越快，用户越早以旧换新，但老设备收益下降会让用户不满。提交时会检查兑付覆盖率。" /></div>
          <div className="pkv"><Lbl zh="产能下限" code="floorPct" desc="产能降到这里就不再下降" /><span className="v">{pE("E.device.capacity.floorPct")}%</span><Adj label="产能下限" k="E.device.capacity.floorPct" unit="%" /></div>
          <div className="pkv"><Lbl zh="新机任务补贴天数" code="subsidyDays" desc="新设备激活后的这些天里，App 只显示「补贴中」，不显示产能百分比；不影响收益计算" /><span className="v cyan">{pE("E.device.capacity.subsidyDays")} 天</span><Adj label="新机任务补贴天数" k="E.device.capacity.subsidyDays" unit="天" detail="只影响 App 上的显示，不影响收益计算。" /></div>
          <div className="pkv"><Lbl zh="产能分段周期" code="stageEarlyEnd / stageMidEnd / cycleMonths" desc={`三段的分界月份：前期第 1–${s1} 月，中期第 ${s1 + 1}–${s2} 月，后期第 ${s2 + 1} 月起`} /><span className="v" style={{ fontSize: 13 }}>前期到第 {s1} 月 · 中期到第 {s2} 月 · 显示 {cyc} 个月</span><AdjMulti title="产能分段周期" ascending hint="须满足：前期截止月 < 中期截止月 < 曲线显示月数。曲线显示月数只影响图表范围。" detail="修改后所有设备的产能曲线和以旧换新估价随之更新，已给出的报价不变。" fields={[
            { key: "early", paramKey: "E.device.stageEarlyEnd", label: "前期截止月", inputKind: "number", placeholder: "3" },
            { key: "mid", paramKey: "E.device.stageMidEnd", label: "中期截止月", inputKind: "number", placeholder: "8" },
            { key: "total", paramKey: "E.device.cycleMonths", label: "曲线显示月数", inputKind: "number", placeholder: "12" },
          ]} /></div>
          <div className="pkv"><Lbl zh="提示升级的月损失金额" code="taskLock.s1 / .pro / .rack" desc="设备每月少赚多少时，在 App 提示用户升级（入门 / 专业 / 机柜）" /><span className="v" style={{ fontSize: 13 }}>${pE("E.device.taskLock.s1")} / ${pE("E.device.taskLock.pro")} / ${pE("E.device.taskLock.rack")}</span><AdjMulti title="提示升级的月损失金额" hint="设备因任务锁定每月少赚超过这个金额时，App 会提示用户升级。" detail="修改后对之后的提示生效。" fields={[
            { key: "s1", paramKey: "E.device.taskLock.s1", label: "入门设备（USDT）", inputKind: "number", placeholder: "40" },
            { key: "pro", paramKey: "E.device.taskLock.pro", label: "UVELBox Pro（USDT）", inputKind: "number", placeholder: "140" },
            { key: "rack", paramKey: "E.device.taskLock.rack", label: "UVELRack（USDT）", inputKind: "number", placeholder: "450" },
          ]} /></div>
          <div className="pkv"><Lbl zh="产能是否逐月下降（按商品）" code="applyTo.*" desc="哪些商品的产能会逐月下降；不下降的始终 100%（入门设备默认不下降）" /><span className="v" style={{ fontSize: 13 }}>{exemptCount} 个不下降 / {APPLY_TO_SKUS.length - exemptCount} 个下降</span><AdjMulti title="产能是否逐月下降（按商品）" hint="参与下降：按上面的节奏逐月下降；不下降：始终 100%（手机、云端共享份额、电脑共享默认不下降）。" detail="修改后对该商品的所有设备生效。" fields={APPLY_TO_SKUS.map((s) => ({ key: s.kind, paramKey: `E.device.capacity.applyTo.${s.kind}`, label: s.label, inputKind: "select" as const, options: ["参与递减", "免递减"] }))} /></div>
          <div className="param-foot"><span className="ic"><AlertIcon /></span><span><b>后期下降速度最敏感</b>：降得快，用户换新更积极，但老设备收益下降会引起不满；降得慢，换新会延后。<b>各段的月份在「产能分段周期」一起改</b>，各段只改每月下降多少。<b>新机任务补贴只影响显示</b>，不影响收益计算。</span></div>
        </section>

        {/* 右:升级置换阶梯(FEAT-DEV02 · 随时下架,产出阶梯抵扣) */}
        <section className="param-card">
          <div className="param-h"><span className="ic trade"><TradeIcon /></span><div className="t"><div className="nm">升级置换阶梯</div><div className="s">按已赚回的比例决定抵扣多少，随时可换</div></div><span className="tag">以旧换新</span></div>
          <div className="pkv"><Lbl zh="以旧换新开关" code="enabled" desc="关闭后 App 上所有以旧换新入口都会隐藏" hot /><span className="v" style={{ fontSize: 13, fontWeight: 600 }}>{pE("E.tradein.enabled")}</span><Adj label="以旧换新开关" k="E.tradein.enabled" unit="" editKind="select" options={["开", "关"]} detail="关闭后 App 上所有以旧换新入口立即隐藏。" /></div>
          <div className="pkv"><Lbl zh="当前阶梯一览" desc="抵扣金额 = 买入价 × 档位比例；旧机已赚回的越多，抵扣越少" /><span className="v" style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{ladderCredits.join(" / ")}%(界点 {ladderCuts.join("/")}%)</span><span /></div>
          <div className="pkv"><Lbl zh="分档界线（4 个）" code="ladder.cut1–4" desc="按「已赚回金额 ÷ 买入价」分成 5 档的 4 条界线" /><span className="v" style={{ fontSize: 13 }}>{ladderCuts.map((c) => `${c}%`).join(" · ")}</span><AdjMulti title="分档界线" ascending hint="按「已赚回金额 ÷ 买入价」分 5 档：低于界线 1 为第 1 档，以此类推，超过界线 4 为第 5 档。须从小到大。" detail="修改后对之后的新报价生效。" fields={[
            { key: "cut1", paramKey: "E.tradein.ladder.cut1", label: "界线 1（%）", inputKind: "number", placeholder: "25" },
            { key: "cut2", paramKey: "E.tradein.ladder.cut2", label: "界线 2（%）", inputKind: "number", placeholder: "50" },
            { key: "cut3", paramKey: "E.tradein.ladder.cut3", label: "界线 3（%）", inputKind: "number", placeholder: "75" },
            { key: "cut4", paramKey: "E.tradein.ladder.cut4", label: "界线 4（%）", inputKind: "number", placeholder: "100" },
          ]} /></div>
          <div className="pkv"><Lbl zh="各档抵扣比例（5 档）" code="ladder.credit1–5" desc="每档抵扣买入价的百分之几，须逐档递减" hot /><span className="v danger">{ladderCredits.map((c) => `${c}%`).join(" · ")}</span><AdjMulti title="各档抵扣比例" amplify hint="第 1 档（赚回最少）抵扣最多，逐档递减到第 5 档（已回本）。调高任一档平台都会多让利。须在 0–100% 之间且逐档递减。" detail="调高抵扣平台会多让利，提交时检查兑付覆盖率。只对之后的新报价生效。" fields={[
            { key: "credit1", paramKey: "E.tradein.ladder.credit1", label: "第 1 档（低于界线 1，%）", inputKind: "number", placeholder: "75", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
            { key: "credit2", paramKey: "E.tradein.ladder.credit2", label: "第 2 档（%）", inputKind: "number", placeholder: "60", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
            { key: "credit3", paramKey: "E.tradein.ladder.credit3", label: "第 3 档（%）", inputKind: "number", placeholder: "45", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
            { key: "credit4", paramKey: "E.tradein.ladder.credit4", label: "第 4 档（%）", inputKind: "number", placeholder: "30", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
            { key: "credit5", paramKey: "E.tradein.ladder.credit5", label: "第 5 档（超过界线 4，%）", inputKind: "number", placeholder: "15", warnAbove: 75, warnText: "超过 75% 让利很大，提交前请看一下兑付覆盖率" },
          ]} /></div>
          <div className="pkv"><Lbl zh="仅限升级更高价设备" code="requireHigherPrice" desc="开启后，只能换比旧机更贵的新机" /><span className="v" style={{ fontSize: 13, fontWeight: 600 }}>{pE("E.tradein.requireHigherPrice")}</span><Adj label="仅限升级更高价设备" k="E.tradein.requireHigherPrice" unit="" editKind="select" options={["开", "关"]} detail="关闭后允许换同价设备，抵扣可能接近新机价格，请先看兑付覆盖率。只对之后的换新生效。" /></div>
          <div className="pkv"><Lbl zh="单笔最多抵扣台数" code="maxDevicesPerOrder" desc="一笔升级订单最多可用几台旧机抵扣" /><span className="v">{pE("E.tradein.maxDevicesPerOrder")} 台</span><Adj label="单笔最多抵扣台数" k="E.tradein.maxDevicesPerOrder" unit="台" detail="只对之后的换新生效。" /></div>
          <div className="pkv"><Lbl zh="谁能以旧换新" code="eligibility" desc="哪些等级的用户可以以旧换新" /><span className="v" style={{ fontSize: 13, fontFamily: "var(--font-v5)", fontWeight: 500 }}>{pE("E.tradein.eligibility")}</span><Adj label="谁能以旧换新" k="E.tradein.eligibility" unit="" editKind="select" options={["全部用户", "L2+ 持有者", "L3+ 持有者", "L4+ 持有者", "L5+ 持有者", "L6+ 持有者"]} detail="勾选可以以旧换新的等级，只对之后的换新生效。" /></div>
          <div className="pkv"><Lbl zh="本月以旧换新" desc={`折抵总额 ${moneyText(stats.tradeinDiscountUsdt)}`} /><span className="v cyan">{countText(stats.tradeinMonthCount)}</span><span /></div>
          <div className="pkv"><Lbl zh="疑似套利被拦截" desc="来自异常套利排查" /><span className="v warn">{countText(stats.k2ArbitrageHits)}</span><span /></div>
          <div className="param-foot cyan"><span className="ic"><ShieldIcon /></span><span><b>不怕被套利</b>：抵扣只能用来买新机，<b>不会变成余额</b>，且默认只能换更贵的机型，每笔换新平台都有净收入。鼓励新设备早升级。调高「各档抵扣比例」会让平台多让利，提交时检查兑付覆盖率；异常的批量换新仍会被风控发现。</span></div>
        </section>
      </div>

      {/* 原子换机 tx 监控 */}
      <section className="tx-card">
        <div className="tx-h">
          <span className="ttl">换机处理情况</span>
          <span className="sub">· 设备回收 / 以旧换新 / 设备停用</span>
          <span className="r"><CodeTag tone="electric">操作记录</CodeTag><span>24 小时 · 成功率 <span style={{ color: txSuccessRate === null ? "var(--ink-3)" : "var(--success)" }}>{txSuccessRate === null ? "暂无（24 小时内没有处理）" : `${txSuccessRate.toFixed(1)}%`}</span></span></span>
        </div>
        <div className="tx-grid">
          {e3Operations.length === 0 ? (
            <div className="tx-col">
              <div className="nm">暂无升级置换运行记录</div>
              <div className="latest"><div className="k">暂无记录</div><div className="vrow"><span className="dot ok" /><span className="reason">还没有以旧换新的处理记录</span></div></div>
            </div>
          ) : e3Operations.map((t) => (
            <div className="tx-col" key={t.nm}>
              <div className="nm">{t.nm}</div>
              <div className="stats">
                <div className="s ok"><div className="k">24 小时 成功</div><div className="v">{t.ok}</div></div>
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
          <span><b>要么全成功，要么全撤回</b> · 任何一步失败都会恢复原状</span>
          <span className="sep">·</span>
          <span>设备换机关系由系统自动记录，运营人员无需手工维护</span>
          <span className="sep">·</span>
          <span>失败样本 → <Link href="/finance/ledger?keyword=tradein&status=FAILED" style={{ color: "var(--cyan)", cursor: "pointer" }}>查看相关账单</Link></span>
        </div>
      </section>
      <p className="f-foot">产能下降节奏和以旧换新抵扣<b>一起决定用户多快升级</b>：后期产能降得快，用户会考虑换新；抵扣越多，换新越有吸引力。修改会影响换新销量、平台让利和套利风险，<b>立即生效</b>（已给出的报价不变）。</p>
    </>
  );
}
