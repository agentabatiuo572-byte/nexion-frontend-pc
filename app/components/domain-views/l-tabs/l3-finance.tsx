"use client";

/**
 * L3 · 财务报表 — 收入结构 / 兑付 / 净敞口 / 负债到期 四类周期核账报表。
 * 不另立财务账本:覆盖率/红黄线/储备/负债 = LEDGER·TREASURY 单源,8 科目 = LIABILITIES(B2 定义),
 * 7d 到期 = MATURITY 聚合;收入金额 = REVENUE。本页只读聚合;含资金明细导出 = 操作确认。
 */
import { useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { confirm } from "@/lib/store/ui";
import { TREASURY, LIABILITIES, REVENUE, fmtM } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { REV_EXT, REDEMPTION, COVERAGE_12W, COVERAGE_WKS, BREACHES, MATURITY_WIN, MAT_SCHEDULE, RESERVE_COVER_DAYS } from "./data";
import type { LCtx } from "./types";

const revTotal = REV_EXT.reduce((s, r) => s + r.amt, 0);
const redRate = ((REDEMPTION.confirmed / REDEMPTION.submitted) * 100).toFixed(1);
const liabTotal = LIABILITIES.reduce((s, l) => s + l.amount, 0);

export function L3HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportAgg = async () => {
    const ok = await confirm({
      title: "导出聚合财务汇总 CSV",
      message: "内容:收入结构 / 兑付 / 敞口 / 负债到期四类报表的聚合金额与比率(按当前报表周期)。不含任何用户级明细——要导用户级资金明细请走「操作确认」入口。",
      confirmLabel: "导出",
    });
    if (!ok) return;
    ctx.logAudit({ actor: "总管理员", action: "导出聚合财务汇总 CSV(无用户明细)", target: "admin.report_exported", after: "export_type=finance_agg · 2026-05" });
    ctx.toast("已导出聚合财务汇总 CSV · 落 admin.report_exported 审计");
  };
  const exportDetail = () => ctx.openActionConfirm({
    action: "财务报表导出 · 含资金明细",
    detail: <><b>数据出境敏感动作</b> · 导出范围:2026-05 收入/兑付/敞口/负债到期 + 用户级资金明细 · 行数预估 <b>48,210</b>(未超 100 万行上限)· 脱敏策略:<b>默认脱敏</b>(手机号 hash / 卡 token 掩码后 4 位 / 地址截断至行政区,L5 字段级规则表)· 操作链:财务(操作员)→ 超管(执行门槛)· 下载链接限时 24h · 落 admin.report_exported(含 operator / role_gate/字段清单/行数)。</>,
    run: (reason) => {
      ctx.setParam("L.export.financeDetail", "requested", { action: "财务含资金明细导出任务(操作确认 · 默认脱敏)", reason });
      ctx.logAudit({ actor: "总管理员", action: "财务含资金明细导出任务创建", target: "admin.report_exported", after: "export_type=finance_detail · rows≈48,210 · masking=默认脱敏", reason });
      ctx.toast("含资金明细导出任务已创建 · 待操作确认(L5 导出任务管理可跟踪)");
    },
  });
  return (
    <>
      <span className="f-ro"><span className="d" />只读聚合 · 数字引自双账本 / 资金池</span>
      <button className="f-cta" onClick={exportAgg}>导出聚合汇总</button>
      <button className="l-btn mc" onClick={exportDetail}>导出含资金明细(操作确认)</button>
    </>
  );
}

export function L3Finance({ ctx }: { ctx: LCtx }) {
  const [matWin, setMatWin] = useState<"7d" | "30d">("7d");
  const [period, setPeriod] = useState(2);
  const [term, setTerm] = useState(2);
  const m = MATURITY_WIN[matWin];

  /* ---- 净敞口 / 覆盖率走势(12 周 + 红黄线 LEDGER 持有 + breach 事件标注) ---- */
  const expChart = () => {
    const W = 1240, H = 250, P = 46;
    const cov = COVERAGE_12W;
    const min = 95, max = 125;
    const X = (i: number) => P + (i / (cov.length - 1)) * (W - 2 * P);
    const Y = (v: number) => H - 28 - ((v - min) / (max - min)) * (H - 52);
    const path = cov.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
    return (
      <svg className="exp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="兑付覆盖率 12 周走势">
        {cov.map((_, i) => (
          <g key={i}>
            <line x1={X(i)} y1={14} x2={X(i)} y2={H - 28} stroke="var(--border)" />
            <text x={X(i)} y={H - 10} fontSize={11} fill="var(--ink-4)" textAnchor="middle">{COVERAGE_WKS[i]}</text>
          </g>
        ))}
        <rect x={P} y={Y(TREASURY.yellowLine)} width={W - 2 * P} height={Y(TREASURY.redLine) - Y(TREASURY.yellowLine)} fill="var(--warning)" opacity={0.05} />
        <rect x={P} y={Y(TREASURY.redLine)} width={W - 2 * P} height={H - 28 - Y(TREASURY.redLine)} fill="var(--danger)" opacity={0.06} />
        <line x1={P} y1={Y(TREASURY.redLine)} x2={W - P} y2={Y(TREASURY.redLine)} stroke="var(--danger)" strokeWidth={1.4} strokeDasharray="5 4" />
        <text x={W - P} y={Y(TREASURY.redLine) + 13} fontSize={11} fill="var(--danger)" textAnchor="end">红线 {TREASURY.redLine}%(低于此线,服务器拒绝放大资金流出)</text>
        <line x1={P} y1={Y(TREASURY.yellowLine)} x2={W - P} y2={Y(TREASURY.yellowLine)} stroke="var(--warning)" strokeWidth={1.2} strokeDasharray="4 4" />
        <text x={W - P} y={Y(TREASURY.yellowLine) - 5} fontSize={11} fill="var(--warning)" textAnchor="end">黄线 {TREASURY.yellowLine}%</text>
        <path d={`${path} L${X(cov.length - 1)} ${H - 28} L${X(0)} ${H - 28} Z`} fill="var(--brand)" opacity={0.06} />
        <path d={path} fill="none" stroke="var(--brand)" strokeWidth={2.2} />
        {cov.map((v, i) => (
          <g key={i}>
            <circle cx={X(i)} cy={Y(v)} r={3} fill="#0A0A0A" stroke="var(--brand)" strokeWidth={2} />
            {(i % 2 === 0 || i === cov.length - 1) && <text x={X(i)} y={Y(v) - 9} fontSize={11} fill="var(--ink-3)" textAnchor="middle">{v}%</text>}
          </g>
        ))}
        {BREACHES.map((b) => {
          const c = b.type === "cov" ? "var(--danger)" : "var(--warning)";
          return (
            <g key={b.i}>
              <circle cx={X(b.i)} cy={Y(cov[b.i])} r={7} fill="none" stroke={c} strokeWidth={2}><title>{b.label}</title></circle>
              <circle cx={X(b.i)} cy={Y(cov[b.i])} r={3} fill={c}><title>{b.label}</title></circle>
            </g>
          );
        })}
      </svg>
    );
  };

  /* ---- 到期排程(30d 分周 grouped bars) ---- */
  const matChart = () => {
    const W = 560, H = 180, P = 34;
    const colors = ["var(--cyan)", "var(--brand)", "var(--warning)"];
    const max = Math.max(...MAT_SCHEDULE.data.flat()) * 1.15;
    const bw = 18, gap = 5;
    return (
      <svg className="mat-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="负债到期 30 天排程">
        {MAT_SCHEDULE.weeks.map((wk, g) => {
          const gx = P + (g + 0.5) * ((W - 2 * P) / 4); // 四组中心均匀分布,右组不触边
          return (
            <g key={wk}>
              {MAT_SCHEDULE.data[g].map((v, s) => {
                const bh = (v / max) * (H - 50);
                return <rect key={s} x={gx + s * (bw + gap) - (bw * 3 + gap * 2) / 2} y={H - 26 - bh} width={bw} height={bh} rx={3} fill={colors[s]} opacity={0.85}><title>{`${wk} · ${fmtM(v)}`}</title></rect>;
              })}
              <text x={gx} y={H - 8} fontSize={11} fill="var(--ink-4)" textAnchor="middle">{wk}</text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat"><div className="k">本期总收入(2026-05)</div><div className="v">{fmtM(revTotal)}</div><div className="sub">四条收入流 · 环比 +7.5%</div></div>
        <div className="f-stat ok"><div className="k">兑付率(本期)</div><div className="v">{redRate}%</div><div className="sub">已兑付 ÷ 已提交 · 慢性核账指标</div></div>
        <div className="f-stat ok"><div className="k">兑付覆盖率(来自双账本)</div><div className="v">{TREASURY.coverageRatio}%</div><div className="sub">红线 {TREASURY.redLine} / 黄线 {TREASURY.yellowLine} · 这里只展示</div></div>
        <div className="f-stat cyan"><div className="k">储备可覆盖到期</div><div className="v">{RESERVE_COVER_DAYS} 天</div><div className="sub">够付未来几天的到期款 · 来自资金池水位</div></div>
      </div>

      {/* period bar */}
      <div className="view-bar">
        <div className="chips"><span className="lb">报表周期</span>
          {["日", "周", "月度(核账周期)", "季", "自定义"].map((c, i) => (
            <button key={c} className={"chip" + (i === period ? " sel" : "")} onClick={() => { setPeriod(i); ctx.toast(`报表周期已切换:${c} · 仅视图,实时生效`); }}>{c}</button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips"><span className="lb">期</span>
          {["2026-03", "2026-04", "2026-05"].map((c, i) => (
            <button key={c} className={"chip" + (i === term ? " sel" : "")} onClick={() => { setTerm(i); ctx.toast(`报表期已切换:${c}`); }}>{c}</button>
          ))}
        </div>
        <button className="l-btn sm" style={{ marginLeft: "auto" }} onClick={() => ctx.toast("当前周期与展示组合已保存为视图 · 不动任何财务算法,普通确认批")}>保存为视图</button>
        <span className="lcode lock" title="财务口径权威:B1 / D3 / B2">🔒 财务算法锁定 · 双账本与资金池持有</span>
      </div>

      <div className="two-col">
        {/* (a) 收入结构 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">收入结构报表</span>
            <span className="sub">· 平台四条收入来源 · 按资金事件聚合</span>
            <div className="r"><span className="lcode">2026-05</span></div>
          </div>
          <div className="l-b">
            <div className="rev-stack">{REV_EXT.map((r) => <i key={r.nm} style={{ width: `${(r.amt / revTotal) * 100}%`, background: r.color }} title={r.nm} />)}</div>
            {REV_EXT.map((r) => (
              <div key={r.nm} className="rev-row">
                <span className="rsw" style={{ background: r.color }} />
                <span className="nm"><AutoGloss>{r.nm}</AutoGloss><span className="src">{r.src}</span></span>
                <span className="amt">{fmtM(r.amt)}</span>
                <span className="sh">{((r.amt / revTotal) * 100).toFixed(1)}%</span>
                <span className={"mom " + (r.up ? "up" : "dn")}>{r.mom}</span>
              </div>
            ))}
            <div className="ltint" style={{ marginTop: 13, fontSize: 12 }}><b>说明</b> · <AutoGloss>每条收入怎么定义由对应业务域说了算(设备 GMV 归 E、佣金归 F、代币归 G),本表只汇总;个别还没正式登记的新事件,先按业务含义归进对应收入条目,不漏记。</AutoGloss></div>
          </div>
        </section>

        {/* (b) 兑付报表 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">兑付报表</span>
            <span className="sub">· <AutoGloss>提现提交后兑付得怎么样 · 全部服务端事件</AutoGloss></span>
            <div className="r"><span className="lcode electric">本页新增观察指标 · 不属八项 KPI</span></div>
          </div>
          <div className="l-b">
            <div className="red-tiles">
              <div className="t"><div className="k">提现申请</div><div className="v">{REDEMPTION.submitted.toLocaleString("en-US")}</div><div className="s">withdraw.submitted</div></div>
              <div className="t"><div className="k">已兑付</div><div className="v" style={{ color: "var(--success)" }}>{REDEMPTION.confirmed.toLocaleString("en-US")}</div><div className="s">withdraw.confirmed</div></div>
              <div className="t"><div className="k">兑付率</div><div className="v" style={{ color: "var(--success)" }}>{redRate}%</div><div className="s">confirmed ÷ submitted</div></div>
              <div className="t"><div className="k">平均兑付时延</div><div className="v">{REDEMPTION.avgLatency}</div><div className="s">submitted → confirmed</div></div>
              <div className="t"><div className="k">驳回</div><div className="v">{REDEMPTION.rejected}</div><div className="s">withdraw.rejected</div></div>
              <div className="t"><div className="k">延迟</div><div className="v" style={{ color: "var(--warning)" }}>{REDEMPTION.delayed}</div><div className="s">withdraw.delayed · 计入分母</div></div>
              <div className="t"><div className="k">冻结</div><div className="v" style={{ color: "var(--danger)" }}>{REDEMPTION.frozen}</div><div className="s">withdraw.frozen · 计入分母</div></div>
              <div className="t"><div className="k">环比 Δ</div><div className="v" style={{ color: "var(--success)" }}>+{(parseFloat(redRate) - REDEMPTION.prevRate).toFixed(1)}pt</div><div className="s">vs {REDEMPTION.prevLabel}({REDEMPTION.prevRate}%)</div></div>
            </div>
            <div className="ltint" style={{ fontSize: 12, marginBottom: 8 }}><b>与 B2 科目 6 的区别</b> · <AutoGloss>同源 submitted/confirmed 两事件,但本表算「比率」(兑付健康度),B2 科目 6 算「在途余额」(负债额)——不是同一个数,互不替代。</AutoGloss></div>
            <div className="ltint warn" style={{ fontSize: 12 }}><b>告警归属</b> · <AutoGloss>兑付率只作周期核账观察,L3 不设独立告警线;急性提现安全信号以</AutoGloss> <b>B5 雷达</b><AutoGloss>的覆盖率破线 + 挤兑比率破线为准(下方敞口图已标注 breach 事件)。处置入口归 D2 提现审核队列。</AutoGloss></div>
          </div>
        </section>
      </div>

      {/* (c) 净敞口 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">净敞口报表</span>
          <span className="sub">· <AutoGloss>净敞口 = 真实储备 − 应付负债 · 覆盖率走势 · 读引用 B1 coverage(红黄线由 B1 持有,本页只读展示)</AutoGloss></span>
          <div className="r">
            <span className="lcode">reserve {fmtM(LEDGER.reserveUsd)}</span>
            <span className="lcode">liability {fmtM(LEDGER.liabilitiesUsd)}</span>
            <span className="lcode electric">netExposure +{fmtM(TREASURY.netExposure)}</span>
          </div>
        </div>
        <div className="l-b">
          {expChart()}
          <div className="exp-legend">
            <span className="it"><span className="lsw" style={{ background: "var(--brand)" }} />兑付覆盖率(储备 ÷ 负债)</span>
            <span className="it" style={{ color: "var(--danger)" }}><span className="lsw" style={{ background: "var(--danger)" }} />红线 {TREASURY.redLine}%(B1 持有)</span>
            <span className="it" style={{ color: "var(--warning)" }}><span className="lsw" style={{ background: "var(--warning)" }} />黄线 {TREASURY.yellowLine}%(B1 持有)</span>
            <span className="it"><span className="ldot" style={{ background: "var(--danger)" }} />breach 事件标注(覆盖率破线 · B1/B2 产)</span>
            <span className="it"><span className="ldot" style={{ background: "var(--warning)" }} />breach 事件标注(挤兑比率破线 · B5 产)</span>
          </div>
          <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>破线区段由事件流标注,不靠轮询</b> · <AutoGloss>图中两处标记分别为 3/16 覆盖率瞬时跌破黄线(coverage_threshold_breached,2.1h 后回升)与 4/08 24h 提现 ÷ 储备触发挤兑预警(bankrun_threshold_breached,B5 雷达已联动)——这两类预警是兑付安全最核心的信号,所以直接标进报表。</AutoGloss></div>
        </div>
      </section>

      {/* (d) 负债到期 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">负债到期报表</span>
          <span className="sub">· <AutoGloss>接下来要付的钱什么时候到期 · 数字直接取自资金池水位,科目定义跟负债看板一致</AutoGloss></span>
          <div className="r"><div className="chips">
            {(["7d", "30d"] as const).map((w) => (
              <button key={w} className={"chip" + (matWin === w ? " sel" : "")} onClick={() => { setMatWin(w); ctx.toast(`到期窗口 → ${w} · D3 maturity-forecast`); }}>{w === "7d" ? "未来 7 天" : "未来 30 天"}</button>
            ))}
          </div></div>
        </div>
        <div className="l-b">
          <div className="mat-grid">
            <div className="t"><div className="k">提现到期</div><div className="e">withdrawDueUsdt</div><div className="v">{fmtM(m.withdraw)}</div></div>
            <div className="t"><div className="k">利息到期(staking 本息)</div><div className="e">interestDueUsdt</div><div className="v">{fmtM(m.interest)}</div></div>
            <div className="t"><div className="k">Genesis 日分红到期</div><div className="e">genesisDividendUsdt · 服务端 0.1%/日</div><div className="v">{fmtM(m.genesis)}</div></div>
          </div>
          <div className="ltint cyan" style={{ fontSize: 12, marginBottom: 16 }}><b>Genesis 日分红怎么算</b> · <AutoGloss>到期分红 = 持有量 × 服务端下发的日分红率(当前</AutoGloss> <b>0.1%/日</b><AutoGloss>)——比例</AutoGloss><b>不写死在页面里</b>,<AutoGloss>永远以服务端字段为准,和资金池看板是同一个数;字段名</AutoGloss> <span className="lcode">genesisDividendUsdt</span>。</div>
          <div className="liab-split">
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>8 类负债科目分解 <span className="lcode" style={{ marginLeft: 6 }}>读引用 D3 liabilities · 定义归 B2</span></div>
              {LIABILITIES.map((l) => (
                <div key={l.id} className="liab-row">
                  <span className="nm"><i style={{ background: l.color }} /><AutoGloss>{l.name}</AutoGloss></span>
                  <span className="track"><i style={{ width: `${(l.amount / Math.max(...LIABILITIES.map((x) => x.amount))) * 100}%`, background: l.color }} /></span>
                  <span className="amt">{fmtM(l.amount)}</span>
                </div>
              ))}
              <div className="liab-row" style={{ borderTop: "1px dashed var(--border)", marginTop: 4, paddingTop: 9 }}>
                <span className="nm" style={{ fontWeight: 600, color: "var(--ink-2)" }}>合计(B1 负债账本输入)</span><span />
                <span className="amt" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmtM(liabTotal)}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>到期排程(30d) <span className="lcode" style={{ marginLeft: 6 }}>数字取自资金池水位</span></div>
              {matChart()}
              <div className="exp-legend" style={{ marginTop: 6 }}>
                <span className="it"><span className="lsw" style={{ background: "var(--cyan)" }} />提现到期</span>
                <span className="it"><span className="lsw" style={{ background: "var(--brand)" }} />利息到期</span>
                <span className="it"><span className="lsw" style={{ background: "var(--warning)" }} />Genesis 日分红</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L3 没有任何「写数据」动作</b>:<AutoGloss>财务数字怎么算全部由双账本、资金池、负债科目三个权威看板持有,这里只读聚合与导出;手工账单调整(各域唯一合法账本写入)只作为审计事件被本页消费对账,绝不在此写账本。</AutoGloss><b>导出分两档</b>:<AutoGloss>聚合级汇总(无用户明细)仍需操作确认、仍落审计;</AutoGloss><b>含资金明细的批量导出 = 数据出境敏感</b>,<AutoGloss>必须操作确认(财务执行门槛:超管)+ 默认脱敏(用户级明细按 L5 字段级脱敏规则表执行),每次导出落</AutoGloss> <b>admin.report_exported</b>(<AutoGloss>含 操作员 / 执行门槛 / 行数 / 字段清单</AutoGloss>),<AutoGloss>进 A2 只追加审计。Genesis 财务(#8)与提现兑付的 KPI 下钻从 L1 跳转至此;监管财务报送喂 L5。</AutoGloss></p>
    </div>
  );
}
