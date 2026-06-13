"use client";

/**
 * L2 · 漏斗 / Cohort / 留存 — 五级漏斗逐级下钻 + cohort 留存热力矩阵 + 多维交叉。
 * 漏斗各级 users/cvr/色 join 自 FUNNEL(与 B3 驾驶舱同口径单一源);复投级挂「V1 降级口径」badge。
 * 全页只读下钻;导出为聚合序列(仍需操作确认 落审计)。
 */
import { useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { confirm } from "@/lib/store/ui";
import { PaginationExemptionList } from "../design-kit";
import { FUNNEL, KPIS } from "@/lib/mock/admin/design-data";
import { FUNNEL_EXT, TRIAL_STEPS, COHORTS, CURVES, XD } from "./data";
import type { LCtx } from "./types";

const STAGE_EV = ["auth.register_completed", "kyc.express_verified", "checkout.completed", "checkout.completed ×2", "withdraw.submitted"];
const fullCvr = ((FUNNEL[4].users / FUNNEL[0].users) * 100).toFixed(1);
const trialBuy = ((TRIAL_STEPS[2].n / TRIAL_STEPS[1].n) * 100).toFixed(1);
const day7 = KPIS[1];

/** cohort 热力格:紫系浓度四档(--cyan 族),深格切暗字。 */
function heatStyle(v: number | null): React.CSSProperties {
  if (v == null) return { background: "var(--surface-2)", color: "var(--ink-4)" };
  const a = v >= 62 ? 70 : v >= 59 ? 45 : v >= 56 ? 25 : 10;
  return { background: `color-mix(in srgb, var(--cyan) ${a}%, transparent)`, color: a >= 45 ? "#0A0A0A" : "var(--ink-2)" };
}

export function L2HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportFunnel = async () => {
    const ok = await confirm({
      title: "导出 cohort / 漏斗序列 CSV",
      message: "内容:漏斗各级去重人数 + 转化率 + 各 cohort 留存率序列(按当前切片与留存窗)。全部是聚合计数,不含手机号、地址等明文。仍需操作确认,落 admin.report_exported 审计。",
      confirmLabel: "导出",
    });
    if (!ok) return;
    ctx.logAudit({ actor: "总管理员", action: "导出 cohort/漏斗序列 CSV(聚合 · 无 PII)", target: "admin.report_exported", after: "export_type=funnel_cohort" });
    ctx.toast("已导出 cohort/漏斗序列 CSV · 落 admin.report_exported 审计");
  };
  return (
    <>
      <span className="f-ro"><span className="d" />只读下钻 · 漏斗怎么定义这里改不了</span>
      <button className="f-cta" onClick={exportFunnel}>导出 cohort / 漏斗序列</button>
    </>
  );
}

export function L2Funnel({ ctx }: { ctx: LCtx }) {
  const [selStage, setSelStage] = useState(2);
  const [selCohort, setSelCohort] = useState(4);
  const [cmp, setCmp] = useState<"W18" | "W20" | "none">("W18");
  const [metric, setMetric] = useState<"cvr" | "ret" | "trial">("cvr");
  const [wins, setWins] = useState<string[]>(["Day1", "Day7", "Day30"]);
  const [slice, setSlice] = useState(0);
  const [gran, setGran] = useState(0);

  const maxUsers = FUNNEL[0].users;
  const s = FUNNEL[selStage];
  const ext = FUNNEL_EXT[selStage];
  const dwellMax = Math.max(...ext.dwell);
  const xd = XD[metric];

  /* ---- 留存衰减曲线(W21 形状为基,按所选 cohort Day7 平移;虚线为对比 cohort) ---- */
  const curveChart = () => {
    const W = 560, H = 200, P = 30;
    const base = COHORTS[selCohort].d7 ?? 58;
    const scaled = CURVES.W21.map(([d, v]) => [d, d === 0 ? 100 : v + (base - 58)] as [number, number]);
    const X = (d: number) => P + (d / 30) * (W - P - 14);
    const Y = (v: number) => H - 24 - ((v - 30) / 70) * (H - 44);
    const mp = scaled.map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
    const cp = cmp !== "none" ? CURVES[cmp].map(([d, v], i) => `${i ? "L" : "M"}${X(d).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ") : null;
    return (
      <svg className="curve-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`留存衰减曲线 ${COHORTS[selCohort].w}`}>
        {[1, 7, 14, 30].map((d) => (
          <g key={d}>
            <line x1={X(d)} y1={14} x2={X(d)} y2={H - 24} stroke="var(--border)" />
            <text x={X(d)} y={H - 8} fontSize={11} fill="var(--ink-4)" textAnchor="middle">D{d}</text>
          </g>
        ))}
        <line x1={P} y1={Y(60)} x2={W - 14} y2={Y(60)} stroke="var(--success)" strokeWidth={1.2} strokeDasharray="4 4" />
        <text x={W - 14} y={Y(60) - 5} fontSize={11} fill="var(--success)" textAnchor="end">Day7 目标 60%</text>
        {cp && <path d={cp} fill="none" stroke="var(--ink-4)" strokeWidth={1.6} strokeDasharray="5 4" />}
        <path d={`${mp} L${X(30)} ${H - 24} L${X(0)} ${H - 24} Z`} fill="var(--cyan)" opacity={0.08} />
        <path d={mp} fill="none" stroke="var(--cyan)" strokeWidth={2.2} />
        {scaled.filter(([d]) => [1, 7, 30].includes(d)).map(([d, v]) => (
          <g key={d}>
            <circle cx={X(d)} cy={Y(v)} r={3.2} fill="#0A0A0A" stroke="var(--cyan)" strokeWidth={2} />
            <text x={X(d)} y={Y(v) - 8} fontSize={11} fill="var(--ink-2)" textAnchor="middle">{v}%</text>
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat cyan"><div className="k">本周注册 cohort</div><div className="v">2026-W22</div><div className="sub">{COHORTS[5].size.toLocaleString("en-US")} 新注册 · 按注册周分组</div></div>
        <div className="f-stat"><div className="k">全漏斗转化(注册→提现)</div><div className="v">{fullCvr}%</div><div className="sub">注册 cohort 中最终发起提现的比例</div></div>
        <div className="f-stat warn"><div className="k">Day7 留存(W21 cohort)</div><div className="v">{day7.value}%</div><div className="sub">目标 &gt; {day7.target}% · 连续 3 周未达(黄灯)</div></div>
        <div className="f-stat ok"><div className="k">trial→购买率</div><div className="v">{trialBuy}%</div><div className="sub">L3→L4 子路径 · 并列独立计量</div></div>
      </div>

      {/* view slice bar */}
      <div className="view-bar">
        <div className="chips"><span className="lb">切片</span>
          {["全量", "Phase P1–P6", "locale", "渠道 ref"].map((c, i) => (
            <button key={c} className={"chip" + (i === slice ? " sel" : "")} onClick={() => { setSlice(i); ctx.toast(`切片已切换:${c} · 仅视图,实时生效`); }}>{c}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">cohort 粒度</span>
          {["注册周 YYYY-Www", "注册月"].map((c, i) => (
            <button key={c} className={"chip" + (i === gran ? " sel" : "")} onClick={() => { setGran(i); ctx.toast(`切片已切换:${c} · 仅视图,实时生效`); }}>{c}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">留存窗</span>
          {["Day1", "Day7", "Day14", "Day30", "Day60"].map((w) => (
            <button key={w} className={"chip" + (wins.includes(w) ? " sel" : "")} onClick={() => {
              setWins((p) => (p.includes(w) ? p.filter((x) => x !== w) : [...p, w]));
              ctx.toast(`留存窗:${w} ${wins.includes(w) ? "已移除" : "已加入"}`);
            }}>{w}</button>
          ))}
        </div>
        <button className="l-btn sm" style={{ marginLeft: "auto" }} onClick={() => ctx.toast("当前切片+留存窗组合已保存为视图 · 不改算法,普通确认批")}>保存为视图</button>
      </div>

      {/* (a) 完整漏斗下钻 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">完整漏斗下钻 · 五级</span>
          <span className="sub">· <AutoGloss>点击任意一级展开「流入 / 转化 / 流失去向 / 停留时长」 · L1–L5 编号是内部生命周期标注,不对用户展示</AutoGloss></span>
          <div className="r"><span className="lcode lock" title="漏斗定义权威:§2.4.7">🔒 漏斗定义锁定</span><span className="lcode electric">和驾驶舱漏斗是同一份数字</span></div>
        </div>
        <div className="l-b">
          <div className="fn-wrap">
            {FUNNEL.map((f, i) => {
              const w = Math.max((f.users / maxUsers) * 100, 4);
              const ex = FUNNEL_EXT[i];
              return (
                <button key={f.stage} className={"fn-row" + (i === selStage ? " sel" : "")} onClick={() => setSelStage(i)}>
                  <div className="lbl">
                    <span className="nm"><AutoGloss>{f.stage}</AutoGloss><span className="lc">{f.lc}</span>{ex.v1 && <span className="bdg dim" style={{ fontSize: 10.5 }}>暂用二次下单口径</span>}</span>
                    <span className="ev" title={STAGE_EV[i]}><AutoGloss>{ex.plain}</AutoGloss></span>
                  </div>
                  <div className="barzone"><div className="bar" style={{ width: `${w}%`, background: f.color }}><span>{f.users.toLocaleString("en-US")}</span></div></div>
                  <div className="cvr">{f.cvr != null ? <><span className="pc">{f.cvr}%</span><span className="tg">{ex.tg ? `目标 ${ex.tg}` : "上级转化"}</span></> : <span className="tg">漏斗顶</span>}</div>
                </button>
              );
            })}
          </div>
          <div className="stage-x">
            <div className="hd">
              <span className="t"><AutoGloss>{s.stage}</AutoGloss> 级展开</span>
              <span className="lcode">{STAGE_EV[selStage]}</span>
              {ext.tg && <span className="bdg ok">目标 {ext.tg}</span>}
              <span style={{ marginLeft: "auto" }} />
              <button className="l-btn sm" onClick={() => ctx.toast(`路径分析:「${s.stage}未转化」用户规模与特征已生成 · admin.bi_query_run`)}>路径分析</button>
            </div>
            <div className="stage-x-grid">
              <div className="cell"><div className="k">上级流入</div><div className="v">{ext.inflow}</div></div>
              <div className="cell"><div className="k">本级转化</div><div className="v" style={{ color: "var(--cyan)" }}>{s.cvr != null ? `${s.cvr}%` : "—"}</div><div className="s">{s.users.toLocaleString("en-US")} 人到达本级</div></div>
              <div className="cell"><div className="k">流失去向</div><div className="s" style={{ marginTop: 6 }}><AutoGloss>{ext.lost}</AutoGloss></div></div>
              <div className="cell"><div className="k">本级停留时长分布</div><div className="dwell">{ext.dwell.map((d, i) => <i key={i} style={{ height: `${(d / dwellMax) * 100}%` }} />)}</div><div className="s">0h → 7d+ 八档</div></div>
            </div>
            <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>解读</b> · <AutoGloss>{ext.note}</AutoGloss></div>
            {ext.trial && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginTop: 14 }}>
                  trial 子漏斗 · 首购前的试用路径 <span className="lcode" style={{ marginLeft: 6 }} title="口径权威 H2">试用规则归 H2,这里只看</span> <span className="bdg dim" style={{ marginLeft: 4 }}>单独计算 · 不算进首购转化率</span>
                </div>
                <div className="trial-strip">
                  {TRIAL_STEPS.map((t, i) => (
                    <div key={t.e} className="trial-step">
                      <div className="bx"><div className="e">{t.e}</div><div className="n">{t.n.toLocaleString("en-US")}</div></div>
                      {i < TRIAL_STEPS.length - 1
                        ? <div className="arr"><b>{TRIAL_STEPS[i + 1].arr}</b>{TRIAL_STEPS[i + 1].arrLb}</div>
                        : <div className="arr" style={{ color: "var(--ink-4)" }}>终态产 bonus<br />账单归 D4</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* (b) cohort 留存矩阵 + 曲线 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Cohort 留存矩阵</span>
          <span className="sub">· <AutoGloss>注册周分组 × 留存窗 · 每格 = 该批用户到那天还有多少在用 app · 点格子换右侧曲线</AutoGloss></span>
          <div className="r"><div className="ret-legend">
            <span>低</span>
            {[10, 25, 45, 70].map((a) => <i key={a} style={{ background: `color-mix(in srgb, var(--cyan) ${a}%, transparent)` }} />)}
            <span>高</span>
          </div></div>
        </div>
        <div className="ret-grid">
          <div>
            <table className="l-tbl ret-tbl">
              <thead><tr><th>注册 cohort</th><th className="num">规模</th><th style={{ textAlign: "center" }}>Day1</th><th style={{ textAlign: "center" }}>Day7</th><th style={{ textAlign: "center" }}>Day30</th><th style={{ textAlign: "center" }}>对比</th></tr></thead>
              <tbody>
                {COHORTS.map((c, i) => (
                  <tr key={c.w}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{c.w}{i === selCohort && <span className="bdg cyan" style={{ fontSize: 10.5, marginLeft: 4 }}>曲线</span>}</td>
                    <td className="num mono">{c.size.toLocaleString("en-US")}</td>
                    {[c.d1, c.d7, c.d30].map((v, j) => (
                      <td key={j} className="cellv" style={heatStyle(v)} onClick={() => { setSelCohort(i); ctx.toast(`切换曲线 cohort → ${c.w}`); }} title={`${c.w} · Day${[1, 7, 30][j]}`}>{v == null ? "—" : `${v}%`}</td>
                    ))}
                    <td style={{ textAlign: "center" }}><button className="l-btn sm" onClick={() => { setSelCohort(i); ctx.toast(`切换曲线 cohort → ${c.w}`); }}>曲线</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>读法</b> · <AutoGloss>横向看单个 cohort 的衰减;纵向看产品迭代 / Phase 切换对同一留存窗的影响。W20 起 Day7 整列转暗(P3 扩张拉新期),Day1 未受影响——流失发生在第 2–7 天,指向推送节奏而非首日体验。</AutoGloss></div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>留存衰减曲线 · {COHORTS[selCohort].w}</div>
            <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginBottom: 10 }}>该 cohort 留存率随天数衰减 · 虚线为对比 cohort</div>
            {curveChart()}
            <div className="chips" style={{ marginTop: 10 }}><span className="lb">对比</span>
              {([["W18", "vs W18(P2 期)"], ["W20", "vs W20"], ["none", "关闭对比"]] as const).map(([v, lb]) => (
                <button key={v} className={"chip" + (cmp === v ? " sel" : "")} onClick={() => setCmp(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* (c) 多维交叉 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">多维交叉分析</span>
          <span className="sub">· <AutoGloss>phase × locale × 渠道任意交叉 · 定位「P3 某渠道首购转化骤降」类信号</AutoGloss></span>
          <div className="r"><div className="chips"><span className="lb">指标</span>
            {([["cvr", "首购 CVR(L3→L4)"], ["ret", "Day7 留存"], ["trial", "trial→购买率"]] as const).map(([v, lb]) => (
              <button key={v} className={"chip" + (metric === v ? " sel" : "")} onClick={() => setMetric(v)}>{lb}</button>
            ))}
          </div></div>
        </div>
        <div className="l-b">
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl xd-tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>渠道 ref \ locale</th><th style={{ textAlign: "center" }}>en</th><th style={{ textAlign: "center" }}>zh</th><th style={{ textAlign: "center" }}>es</th><th style={{ textAlign: "center" }}>pt</th><th style={{ textAlign: "center" }}>行均值</th></tr></thead>
              <tbody>
                {xd.rows.map((r, ri) => (
                  <tr key={r[0]}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{r[0]}</td>
                    {r.slice(1, 5).map((v, ci) => (
                      <td key={ci} className={"xv" + (ri === xd.alert[0] && ci === xd.alert[1] - 1 ? " alert" : "")}>{v}{xd.unit}</td>
                    ))}
                    <td className="xv" style={{ color: "var(--ink-3)" }}>{r[5]}{xd.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="xd-foot">
            <span className="ltint warn" style={{ flex: 1, minWidth: 260 }}><b>{xd.msg.pre.split("·")[0].trim()}</b> · <AutoGloss>{xd.msg.pre.split("·").slice(1).join("·")}</AutoGloss><b>{xd.msg.bold}</b><AutoGloss>{xd.msg.post}</AutoGloss></span>
            {[["B4 节奏", "跳 B4 节奏状态(Phase 效果归因)"], ["H1 Phase", "跳 H1 Phase 调度(节奏参数在那里调)"], ["I 域文案", "跳 I 域转化文案(es 文案 A/B)"], ["F 域渠道", "跳 F 域渠道(ref 质量)"]].map(([lb, msg]) => (
              <button key={lb} className="l-btn sm" onClick={() => ctx.toast(`${msg} · 原型占位`)}>{lb}</button>
            ))}
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L2 没有任何「写数据」动作</b>:<AutoGloss>漏斗与留存怎么算由事件中台治理,这里只做下钻查询、视图配置与聚合导出。</AutoGloss><b>关于复投这一级</b>:<AutoGloss>钱包复投事件还没上线,目前先拿「第二次下单」来算复投,和驾驶舱算法完全一致,等事件上线后两个口径一起看——这里绝不会出现和驾驶舱不一样的复投数字。导出为聚合计数(各级去重用户 / CVR / 留存率),</AutoGloss><b>不含手机号、地址等明文</b>,<AutoGloss>仍需操作确认但每次都落</AutoGloss> <b>admin.report_exported</b> <AutoGloss>审计;下钻查询可选落</AutoGloss> <b>admin.bi_query_run</b>。</p>
      <PaginationExemptionList
        items={[
          {
            label: "Cohort 留存矩阵",
            kind: "fixed-matrix",
            maxRows: 6,
            reason: "留存 cohort 固定六行,需同屏比较 Day1/7/30",
          },
          {
            label: "多维交叉分析",
            maxRows: 4,
            reason: "交叉分析固定四个渠道样本,完整查询走 BI 下钻",
          },
        ]}
      />
    </div>
  );
}
