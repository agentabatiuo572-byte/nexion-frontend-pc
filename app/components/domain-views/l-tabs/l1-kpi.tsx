"use client";

/**
 * L1 · KPI 看板 — 8 KPI 卡矩阵 + 单 KPI 下钻 + 趋势/阈值叠加 + 口径锁定表。
 * 数值/目标/spark 全部 join 自 KPIS(B 域同口径单一源);口径与目标只读锁定,页面无修改入口。
 * 视图参数(时间窗/粒度/Phase 叠加/黄灯偏移)普通确认批实时生效;导出为聚合 CSV(仍需操作确认,落审计)。
 */
import { useState } from "react";
import Link from "next/link";
import { AutoGloss } from "@/app/components/kit/gloss";
import { confirm } from "@/lib/store/ui";
import { PaginationExemptionList } from "../design-kit";
import { KPIS } from "@/lib/mock/admin/design-data";
import { CURRENT_PHASE } from "@/lib/mock/admin/command-center";
import { WEEKS, PHASE_SWITCH_IDX, KPI_COLORS, KPI_PLAIN, KPI_EXT, kpiState } from "./data";
import { ViewParamModal, type ViewParamReq } from "./view-param-modal";
import type { LCtx } from "./types";

type Kpi = (typeof KPIS)[number];
const LED_COLOR = { g: "var(--success)", y: "var(--warning)", r: "var(--danger)" } as const;

function sparkPath(series: readonly number[], w: number, h: number): string {
  const min = Math.min(...series), max = Math.max(...series), rng = max - min || 1;
  return series.map((v, i) => `${i ? "L" : "M"}${((i / (series.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - min) / rng) * (h - 6)).toFixed(1)}`).join(" ");
}
const tgtLabel = (k: Kpi) => ("band" in k && k.dir === "band" ? `健康带 ${k.band[0]}–${k.band[1]}${k.unit}` : `目标 ${k.dir === "lte" ? "< " : "> "}${k.target}${k.unit}`);
const tgtValue = (k: Kpi) => ("band" in k && k.dir === "band" ? k.band[0] : k.target);

export function L1HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportKpi = async () => {
    const ok = await confirm({
      title: "导出 KPI 序列 CSV",
      message: "内容:8 项 KPI 的当前值 + 目标 + 环比序列(按当前时间窗与 cohort 粒度)。全部是聚合比率,不含任何用户个人信息。仍需操作确认,导出落 admin.report_exported 审计。",
      confirmLabel: "导出",
    });
    if (!ok) return;
    ctx.logAudit({ actor: "总管理员", action: "导出 KPI 序列 CSV(聚合 · 无 PII)", target: "admin.report_exported", after: "export_type=kpi_series · 8 KPI × 7 周" });
    ctx.toast("已导出 8 项 KPI 序列 CSV · 落 admin.report_exported 审计");
  };
  return (
    <>
      <span className="f-ro"><span className="d" />只读报表域 · 不改任何业务规则</span>
      <button className="f-cta" onClick={exportKpi}>导出 KPI 序列 CSV</button>
    </>
  );
}

/** fx 公式渲染:fxBold 词高亮(cyan b),其余纯文本。 */
function renderFx(fx: string, bold: string[]) {
  if (!bold.length) return fx;
  const re = new RegExp(`(${bold.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return fx.split(re).map((part, i) => (bold.includes(part) ? <b key={i}>{part}</b> : <span key={i}>{part}</span>));
}

export function L1Kpi({ ctx }: { ctx: LCtx }) {
  const [selKpi, setSelKpi] = useState(1); // index → #2(最弱预警项)
  const [ylOffset, setYlOffset] = useState(10);
  const [phaseOn, setPhaseOn] = useState(true);
  const [ovlSel, setOvlSel] = useState<number[]>([1, 2, 3]);
  const [vp, setVp] = useState<ViewParamReq | null>(null);
  const [win, setWin] = useState("7d");
  const [gran, setGran] = useState("week");
  const [slice, setSlice] = useState(0);

  const states = KPIS.map((k) => kpiState(k, ylOffset));
  const green = states.filter((s) => s === "g").length;
  const yellow = states.filter((s) => s === "y").length;
  const red = states.filter((s) => s === "r").length;
  const redNames = KPIS.filter((_, i) => states[i] === "r").map((k) => `#${k.n}`).join(" ");
  const k = KPIS[selKpi];
  const ext = KPI_EXT[k.n];

  const toggleOvl = (i: number) => setOvlSel((p) => (p.includes(i) ? (p.length > 1 ? p.filter((x) => x !== i) : p) : [...p, i]));

  /* ---- 下钻图(cohort 周序列 + 目标线 + 黄线 + Phase 标记;固定 viewBox 等比缩放) ---- */
  const drillChart = () => {
    const W = 860, H = 260, P = 36;
    const s = [...k.spark];
    const tgt = tgtValue(k);
    const yl = k.dir === "lte" ? k.target * (1 + ylOffset / 100) : tgt * (1 - ylOffset / 100);
    const all = [...s, tgt, yl];
    const min = Math.min(...all) * 0.97, max = Math.max(...all) * 1.03, rng = max - min || 1;
    const X = (i: number) => P + (i / (s.length - 1)) * (W - 2 * P);
    const Y = (v: number) => H - 26 - ((v - min) / rng) * (H - 56);
    const path = s.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
    return (
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`KPI #${k.n} cohort 周序列趋势`}>
        {s.map((_, i) => (
          <g key={i}>
            <line x1={X(i)} y1={18} x2={X(i)} y2={H - 26} stroke="var(--border)" strokeWidth={1} />
            <text x={X(i)} y={H - 8} fontSize={11} fill="var(--ink-4)" textAnchor="middle">{WEEKS[i]}</text>
          </g>
        ))}
        {phaseOn && (
          <g>
            <rect x={X(PHASE_SWITCH_IDX) - 1} y={18} width={2} height={H - 44} fill="var(--cyan)" opacity={0.45} />
            <text x={X(PHASE_SWITCH_IDX) + 5} y={30} fontSize={11} fill="var(--cyan)">P2 → P3</text>
          </g>
        )}
        <line x1={P} y1={Y(tgt)} x2={W - P} y2={Y(tgt)} stroke="var(--success)" strokeWidth={1.4} strokeDasharray="5 4" />
        <text x={W - P} y={Y(tgt) - 5} fontSize={11} fill="var(--success)" textAnchor="end">目标 {tgt}{k.unit}</text>
        <line x1={P} y1={Y(yl)} x2={W - P} y2={Y(yl)} stroke="var(--warning)" strokeWidth={1.2} strokeDasharray="3 4" />
        <text x={W - P} y={Y(yl) + 13} fontSize={11} fill="var(--warning)" textAnchor="end">黄灯 {yl.toFixed(1)}{k.unit}</text>
        <path d={`${path} L${X(s.length - 1)} ${H - 26} L${X(0)} ${H - 26} Z`} fill="var(--cyan)" opacity={0.07} />
        <path d={path} fill="none" stroke="var(--cyan)" strokeWidth={2.2} />
        {s.map((v, i) => (
          <g key={i}>
            <circle cx={X(i)} cy={Y(v)} r={3.4} fill="#0A0A0A" stroke="var(--cyan)" strokeWidth={2} />
            <text x={X(i)} y={Y(v) - 9} fontSize={11} fill="var(--ink-3)" textAnchor="middle">{v}</text>
          </g>
        ))}
      </svg>
    );
  };

  /* ---- 趋势叠加(指数化:实际 ÷ 目标 → 达标线 100) ---- */
  const ovlChart = () => {
    const W = 1240, H = 230, P = 40, min = 80, max = 125;
    const X = (i: number) => P + (i / (WEEKS.length - 1)) * (W - 2 * P);
    const y100 = H - 24 - ((100 - min) / (max - min)) * (H - 44);
    return (
      <svg className="ovl-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="多 KPI 指数化叠加趋势">
        {WEEKS.map((w, i) => (
          <g key={w}>
            <line x1={X(i)} y1={14} x2={X(i)} y2={H - 24} stroke="var(--border)" />
            <text x={X(i)} y={H - 6} fontSize={11} fill="var(--ink-4)" textAnchor="middle">{w}</text>
          </g>
        ))}
        {phaseOn && (
          <g>
            <rect x={X(PHASE_SWITCH_IDX) - 1} y={14} width={2} height={H - 38} fill="var(--cyan)" opacity={0.45} />
            <text x={X(PHASE_SWITCH_IDX) + 5} y={26} fontSize={11} fill="var(--cyan)">P2 → P3 切换</text>
          </g>
        )}
        {ovlSel.map((i) => {
          const kk = KPIS[i];
          const tgt = tgtValue(kk);
          const idx = kk.spark.map((v) => (kk.dir === "lte" ? (tgt / v) * 100 : (v / tgt) * 100));
          const path = idx.map((v, j) => {
            const y = H - 24 - ((Math.min(Math.max(v, min), max) - min) / (max - min)) * (H - 44);
            return `${j ? "L" : "M"}${X(j).toFixed(1)} ${y.toFixed(1)}`;
          }).join(" ");
          return <path key={i} d={path} fill="none" stroke={KPI_COLORS[i]} strokeWidth={2} />;
        })}
        <line x1={P} y1={y100} x2={W - P} y2={y100} stroke="var(--success)" strokeWidth={1.4} strokeDasharray="5 4" />
        <text x={W - P} y={y100 - 5} fontSize={11} fill="var(--success)" textAnchor="end">达标线 = 各自目标值(指数 100)</text>
      </svg>
    );
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">达标 KPI</div><div className="v">{green} / {KPIS.length}</div><div className="sub">绿灯 · 高于目标线</div></div>
        <div className="f-stat warn"><div className="k">预警 KPI</div><div className="v">{yellow}</div><div className="sub">黄灯 · 距目标 −{ylOffset}% 区间内</div></div>
        <div className="f-stat danger"><div className="k">未达 KPI</div><div className="v">{red}</div><div className="sub">红灯 · {redNames || "—"}</div></div>
        <div className="f-stat cyan"><div className="k">当前 Phase</div><div className="v">{CURRENT_PHASE.code} · 月 {CURRENT_PHASE.month}</div><div className="sub">趋势图已叠加 Phase 切换标记</div></div>
      </div>

      {/* view params bar(全部仅视图 · 实时生效 · 普通确认批) */}
      <div className="view-bar">
        <div className="chips"><span className="lb">时间窗</span>
          {[["1d", "当日"], ["7d", "滚动 7d"], ["30d", "滚动 30d"], ["custom", "自定义"]].map(([v, lb]) => (
            <button key={v} className={"chip" + (win === v ? " sel" : "")} onClick={() => { setWin(v); ctx.toast(`视图已切换:${lb} · 仅视图参数,实时生效`); }}>{lb}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">cohort 粒度</span>
          {[["week", "注册周 YYYY-Www"], ["month", "注册月"]].map(([v, lb]) => (
            <button key={v} className={"chip" + (gran === v ? " sel" : "")} onClick={() => { setGran(v); ctx.toast(`视图已切换:${lb} · 仅视图参数,实时生效`); }}>{lb}</button>
          ))}
        </div>
        <div className="sep" />
        <button className={"toggle" + (phaseOn ? " on" : "")} onClick={() => { setPhaseOn(!phaseOn); ctx.toast(`Phase 效果叠加:${!phaseOn ? "开启" : "关闭"}`); }}>
          <span className="tk" />Phase 效果叠加
        </button>
        <div className="sep" />
        <div className="chips"><span className="lb">黄灯预警偏移</span>
          <span className="lcode">目标 −{ylOffset}%</span>
          <button className="l-btn sm" onClick={() => setVp({
            title: "黄灯预警偏移",
            detail: "状态灯黄线 = 目标值 − N%。落在「目标 − N%」与目标之间的 KPI 标黄灯(预警),低于黄线标红灯(未达)。只影响看板状态灯与图上黄线位置。",
            current: ylOffset, unit: "%", min: 5, max: 20,
            onApply: (n) => { setYlOffset(n); ctx.toast(`黄灯预警偏移 → 目标 −${n}% · 仅视图参数`); },
          })}>调整</button>
        </div>
        <button className="l-btn sm" style={{ marginLeft: "auto" }} onClick={() => ctx.toast("当前时间窗+粒度+叠加组合已保存为视图 · 不改算法,普通确认批")}>保存为视图</button>
        <span className="lcode lock" title="口径与目标值只读;以上仅为视图参数,实时生效不落确认">视图参数 · 实时生效 · 普通确认批</span>
      </div>

      {/* (a) 8-KPI matrix */}
      <div className="kpi-grid">
        {KPIS.map((kk, i) => {
          const st = states[i];
          const ex = KPI_EXT[kk.n];
          const dUp = !ex.delta.startsWith("-");
          const goodUp = kk.dir !== "lte";
          return (
            <button key={kk.n} className={"kpi-card" + (i === selKpi ? " sel" : "")} onClick={() => setSelKpi(i)} title="点击下钻">
              <div className="top"><span className="n">#{kk.n}</span><span className="nm"><AutoGloss>{kk.name}</AutoGloss></span><span className={"led " + st} /></div>
              <div className="vrow">
                <span className="v">{kk.value}<span className="u">{kk.unit}</span></span>
                <span className="tgt">{tgtLabel(kk)}</span>
                <span className={"delta " + (dUp === goodUp ? "up" : "dn")}>{dUp ? "▲" : "▼"} {ex.delta.replace("-", "")}</span>
              </div>
              <svg className="spark" viewBox="0 0 150 30" preserveAspectRatio="none" aria-hidden>
                <path d={sparkPath(kk.spark, 150, 30)} fill="none" stroke={LED_COLOR[st]} strokeWidth={1.8} />
              </svg>
              <div className="ft"><span className="ev" title={ex.fx}><AutoGloss>{KPI_PLAIN[kk.n]}</AutoGloss></span><span className="ph">{CURRENT_PHASE.code}</span><span className="lat">~2min</span></div>
            </button>
          );
        })}
      </div>

      {/* (b) 单 KPI 下钻 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">单 KPI 下钻 · #{k.n} {k.name}</span>
          <span className="sub">· 口径公式 / 分子分母 / 切片 / 趋势</span>
          <div className="r"><div className="chips"><span className="lb">切片</span>
            {["全量", "cohort 2026-W22", "Phase P3", "locale en", "渠道 ref NX-*"].map((s, i) => (
              <button key={s} className={"chip" + (i === slice ? " sel" : "")} onClick={() => { setSlice(i); ctx.toast(`切片已切换:${s} · 仅视图,实时生效`); }}>{s}</button>
            ))}
          </div></div>
        </div>
        <div className="drill">
          <div className="meta">
            <div className="formula">
              <div className="lb" title="口径锚点:PRD §2.4.6"><AutoGloss>这项指标怎么算 · 算法锁定在事件中台,这里只能看不能改</AutoGloss></div>
              <div className="plain"><AutoGloss>{KPI_PLAIN[k.n]}</AutoGloss></div>
              <div className="fx">{renderFx(ext.fx, ext.fxBold)}</div>
              <div className="anchor">口径编号 #{k.n} · 数据批次 {k.vis}</div>
            </div>
            <div className="nd">
              <div className="it"><div className="k">分子(实时)</div><div className="v" style={{ color: "var(--cyan)" }}>{ext.num}</div></div>
              <div className="it"><div className="k">分母(实时)</div><div className="v">{ext.den}</div></div>
              <div className="it"><div className="k">当前值</div><div className="v" style={{ color: "var(--success)" }}>{k.value}{k.unit}</div></div>
              <div className="it"><div className="k">目标值</div><div className="v" style={{ color: "var(--ink-3)" }}>{tgtLabel(k).replace("目标 ", "").replace("健康带 ", "")}</div></div>
            </div>
            <div className="ltint" style={{ fontSize: 12 }}><b>解读</b> · <AutoGloss>{ext.note}</AutoGloss></div>
            <div className="jump">
              {ext.jump.map((j) => j.href
                ? <Link key={j.label} className="l-btn sm" href={j.href}>{j.label} →</Link>
                : <button key={j.label} className="l-btn sm" onClick={() => ctx.toast(`跨域归因入口(原型占位):${j.label}`)}>{j.label} →</button>)}
            </div>
          </div>
          <div className="chart-pane">
            {drillChart()}
            <div className="legend">
              <span className="it"><span className="lsw" style={{ background: "var(--cyan)" }} />cohort 周序列</span>
              <span className="it" style={{ color: "var(--success)" }}><span className="lsw dash" />目标线</span>
              <span className="it" style={{ color: "var(--warning)" }}><span className="lsw dash" />黄灯预警线(目标 −{ylOffset}%)</span>
              <span className="it" style={{ color: "var(--ink-4)" }}><span className="lsw" style={{ width: 8, height: 10 }} />Phase 切换标记(P2→P3)</span>
            </div>
          </div>
        </div>
      </section>

      {/* (c) 趋势 & 阈值叠加 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">趋势 &amp; 阈值视图</span>
          <span className="sub">· <AutoGloss>多 KPI cohort 周序列叠加 · 观察 Phase 切换对 KPI 的影响 · 归因跳 B4 / H1</AutoGloss></span>
          <div className="r"><span className="lcode electric" title="事件通用属性 §2.4.4">按事件自带的 Phase 标记聚合</span></div>
        </div>
        <div className="l-b">
          <div className="ovl-picks">
            {KPIS.map((kk, i) => {
              const on = ovlSel.includes(i);
              return <button key={kk.n} className={"chip" + (on ? " sel" : "")} style={on ? { background: KPI_COLORS[i], color: "#0A0A0A" } : undefined} onClick={() => toggleOvl(i)}>#{kk.n} {kk.name}</button>;
            })}
          </div>
          {ovlChart()}
          <div className="legend">
            {ovlSel.map((i) => <span key={i} className="it"><span className="lsw" style={{ background: KPI_COLORS[i] }} />#{KPIS[i].n} {KPIS[i].name}</span>)}
            <span className="it" style={{ color: "var(--ink-4)" }}>纵轴 = 实际值 ÷ 目标值(达标线 100)</span>
          </div>
        </div>
      </section>

      {/* 口径锁定表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">KPI 口径锁定表</span>
          <span className="sub">· <AutoGloss>每项 KPI 怎么算一目了然 · 要改算法须走事件中台治理 + 操作确认,本页改不了</AutoGloss></span>
          <div className="r"><span className="lcode lock" title="口径权威:§2.4.6">🔒 算法锁定</span><span className="lcode lock" title="目标权威:§18.2">🔒 目标锁定</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 900 }}>
            <thead><tr><th>#</th><th>KPI</th><th>怎么算(服务端口径 · 只读)</th><th className="num">目标</th><th>落地批次</th><th>状态</th></tr></thead>
            <tbody>
              {KPIS.map((kk, i) => {
                const st = states[i];
                return (
                  <tr key={kk.n}>
                    <td className="mono">{kk.n}</td>
                    <td style={{ fontWeight: 600, color: "var(--ink)" }}><AutoGloss>{kk.name}</AutoGloss></td>
                    <td><div style={{ color: "var(--ink-2)" }}><AutoGloss>{KPI_PLAIN[kk.n]}</AutoGloss></div><div className="mono fx" style={{ color: "var(--ink-4)", fontSize: 11.5, marginTop: 3 }}>{renderFx(KPI_EXT[kk.n].fx, KPI_EXT[kk.n].fxBold)}</div></td>
                    <td className="num mono" style={{ color: "var(--ink)" }}>{"band" in kk && kk.dir === "band" ? `${kk.band[0]}–${kk.band[1]}${kk.unit}` : `${kk.dir === "lte" ? "< " : "> "}${kk.target}${kk.unit}`}</td>
                    <td><span className="lcode">{kk.vis}</span></td>
                    <td>{st === "g" ? <span className="bdg ok">达标</span> : st === "y" ? <span className="bdg warn">预警</span> : <span className="bdg bad">未达</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ltint" style={{ fontSize: 12 }}><b>三点说明</b> · <AutoGloss>① #5 是推广率不是收入:算的是发出过邀请的设备持有者占比(不是收入指标);② #6 Nova:推送事件早已登记,数据一直是全的;③ #7 刚补齐:依赖团队分销关系树,早期只有粗略计数,本看板(V4)起完整下钻。</AutoGloss></div>
        </div>
      </section>

      <p className="f-foot"><b>L1 没有任何「写数据」动作</b>:<AutoGloss>KPI 怎么算由事件中台治理,目标值由验收表持有,这里只配置呈现、下钻查询与聚合导出。导出内容为 8 项 KPI 的比率序列(聚合计数,</AutoGloss><b>不含任何用户隐私明文</b>),<AutoGloss>仍需操作确认但每次导出都落</AutoGloss> <b>admin.report_exported</b> <AutoGloss>审计。异常 KPI 的归因下钻:转化类(#1–#4)跳 L2 漏斗,财务类(#8 / 提现兑付)跳 L3 报表,团队类(#5/#7)跳 L4 网络报表。</AutoGloss></p>
      <PaginationExemptionList
        items={[
          {
            label: "KPI 口径锁定表",
            kind: "reference-catalog",
            maxRows: 8,
            reason: "八项 KPI 为固定验收口径,需要同屏锁定算式和状态",
          },
        ]}
      />

      {vp && <ViewParamModal req={vp} onClose={() => setVp(null)} />}
    </div>
  );
}
