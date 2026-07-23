"use client";

/**
 * L3 · 财务报表 — 收入结构 / 兑付 / 净敞口 / 负债到期 四类周期核账报表。
 * 不另立财务账本:覆盖率/红黄线/储备/负债 = LEDGER·TREASURY 单源,8 科目 = LIABILITIES(B2 定义),
 * 7d 到期 = MATURITY 聚合;收入金额 = REVENUE。本页只读聚合;含资金明细导出 = 操作确认。
 */
import { useRef, useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { formatReserveCoverDays } from "@/lib/admin/treasury-cover-days";
import { LDataState, fmtM, num, rec, rows, strings } from "./live-data";
import { readL3FinanceSnapshot, readL3LiveFacts } from "./l3-live-data";
import { L3LiveFacts } from "./l3-live-fallback";
import type { LCtx } from "./types";

type LiabilityRow = { id: number; name: string; amount: number; color: string };
type RevenueExtRow = { nm: string; src: string; amt: number; mom: string; up: boolean; color: string };
type BreachRow = { i: number; type: string; label: string };

function currentMonthRange() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(new Date(year, month + 1, 0).getDate())}`,
  };
}

export function L3HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const liveFacts = readL3LiveFacts(ctx.biData?.l3);
  const financeSnapshot = readL3FinanceSnapshot(ctx.biData?.l3);
  const exportable = liveFacts.length > 0 || financeSnapshot !== null;
  const exportAgg = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      await ctx.biActions?.createReport({
        exportType: "财务当前汇总",
        timeRange: String(ctx.biData?.l3?.periodLabel ?? "当前周期"),
        fields: "资金池概览/负债科目/七日到期排程/钱包账单分类计数",
        piiLevel: "NONE",
        maskPolicy: "NONE",
        recipient: "财务管理员",
        ticket: "L3-FINANCE",
      }, "导出 L3 当前可核验财务事实用于财务核对");
      await ctx.reloadBi?.();
      ctx.toast("财务当前汇总已生成 · 已记录导出范围与操作者");
    } catch (error) {
      ctx.toast(error instanceof Error ? `导出任务提交失败 · ${error.message}` : "导出任务提交失败 · 请稍后重试");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };
  return (
    <>
      <span className="f-ro"><span className="d" />只读财务事实 · 不修改账本</span>
      {!ctx.canExport && <span className="f-ro">当前角色仅可查看 · 导出需报表管理权限</span>}
      <button
        className="f-cta"
        onClick={exportAgg}
        disabled={exporting || !ctx.canExport || !exportable || ctx.biLoading || Boolean(ctx.biError)}
        aria-busy={exporting}
        title={!ctx.canExport ? "当前角色没有报表导出权限" : !exportable ? "尚未返回可导出的 L3 财务事实" : ctx.biError ? "数据读取失败，不能导出旧快照" : undefined}
      >
        {exporting ? "正在生成财务汇总..." : "导出财务当前汇总 CSV"}
      </button>
      <span className="f-ro" title="用户级资金明细数据源和审批链尚未接入本页">用户级资金明细暂不可导出</span>
    </>
  );
}

export function L3Finance({ ctx }: { ctx: LCtx }) {
  const [matWin, setMatWin] = useState<"7d" | "30d">("7d");
  const defaultCustomRange = currentMonthRange();
  const [customFrom, setCustomFrom] = useState(ctx.l3Query?.from ?? defaultCustomRange.from);
  const [customTo, setCustomTo] = useState(ctx.l3Query?.to ?? defaultCustomRange.to);

  const data = ctx.biData?.l3;
  if (!data) return <LDataState ctx={ctx} label="L3" />;
  const liveFacts = readL3LiveFacts(data);
  const financeSnapshot = readL3FinanceSnapshot(data);
  const ledgerRaw = rec(data.ledger);
  const treasuryRaw = rec(data.treasury);
  const revenueRaw = rec(data.revenue);
  const redemptionRaw = rec(data.redemption);
  const maturityRaw = rec(data.maturityWindow);
  const mRaw = rec(maturityRaw[matWin]);
  const maturity7Raw = rec(maturityRaw["7d"]);
  const maturity30Raw = rec(maturityRaw["30d"]);
  const scheduleRaw = rec(data.maturitySchedule);
  const LEDGER = {
    reserveUsd: num(ledgerRaw.reserveUsd),
    liabilitiesUsd: num(ledgerRaw.liabilitiesUsd),
  };
  const TREASURY = {
    coverageRatio: num(treasuryRaw.coverageRatio),
    redLine: num(treasuryRaw.redLine, 100),
    yellowLine: num(treasuryRaw.yellowLine, 110),
    netExposure: num(treasuryRaw.netExposure),
  };
  const LIABILITIES = rows<LiabilityRow>(data.liabilities);
  const REV_EXT = rows<RevenueExtRow>(data.revenueExt);
  const REDEMPTION = {
    submitted: num(redemptionRaw.submitted),
    confirmed: num(redemptionRaw.confirmed),
    avgLatency: String(redemptionRaw.avgLatency ?? "—"),
    rejected: num(redemptionRaw.rejected),
    delayed: num(redemptionRaw.delayed),
    frozen: num(redemptionRaw.frozen),
    prevRate: num(redemptionRaw.prevRate),
    prevLabel: String(redemptionRaw.prevLabel ?? "上期"),
  };
  const COVERAGE_12W = rows<number>(data.coverage12w);
  const COVERAGE_WKS = strings(data.coverageWeeks);
  const BREACHES = rows<BreachRow>(data.coverageBreaches);
  const MAT_SCHEDULE = {
    weeks: strings(scheduleRaw.weeks),
    data: rows<number[]>(scheduleRaw.data),
  };
  const m = {
    withdraw: num(mRaw.withdraw),
    interest: num(mRaw.interest),
    genesis: num(mRaw.genesis),
  };
  const maturity30DueUsdt = ["withdraw", "interest", "genesis"]
    .reduce((sum, key) => sum + num(maturity30Raw[key]), 0);
  const RESERVE_COVER_DAYS = num(data.reserveCoverDays);
  const reserveCoverDaysCopy = formatReserveCoverDays(maturity30DueUsdt, RESERVE_COVER_DAYS);
  const reserveCoverDaysValue = maturity30DueUsdt === 0
    ? "不计算"
    : reserveCoverDaysCopy.replace("可覆盖 ", "");
  const revTotal = REV_EXT.reduce((sum, row) => sum + row.amt, 0);
  const redRate = REDEMPTION.submitted ? ((REDEMPTION.confirmed / REDEMPTION.submitted) * 100).toFixed(1) : "0.0";
  const liabTotal = LIABILITIES.reduce((sum, row) => sum + row.amount, 0);
  const validBreaches = BREACHES.filter((item) => Number.isInteger(item.i) && item.i >= 0 && item.i < COVERAGE_12W.length);
  const hasNumber = (record: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(record, key) && Number.isFinite(Number(record[key]));
  const fullContractReady = REV_EXT.length > 0
    && REV_EXT.every((row) => Number.isFinite(row.amt) && row.amt >= 0)
    && LIABILITIES.length > 0
    && LIABILITIES.every((row) => Number.isFinite(row.amount) && row.amount >= 0)
    && COVERAGE_12W.length >= 2
    && COVERAGE_WKS.length === COVERAGE_12W.length
    && COVERAGE_12W.every(Number.isFinite)
    && ["reserveUsd", "liabilitiesUsd"].every((key) => hasNumber(ledgerRaw, key))
    && ["coverageRatio", "redLine", "yellowLine", "netExposure"].every((key) => hasNumber(treasuryRaw, key))
    && ["submitted", "confirmed", "rejected", "delayed", "frozen", "prevRate"].every((key) => hasNumber(redemptionRaw, key))
    && [maturity7Raw, maturity30Raw].every((window) => ["withdraw", "interest", "genesis"].every((key) => hasNumber(window, key)))
    && MAT_SCHEDULE.weeks.length > 0
    && MAT_SCHEDULE.weeks.length === MAT_SCHEDULE.data.length
    && MAT_SCHEDULE.data.every((group) => Array.isArray(group) && group.length === 3 && group.every(Number.isFinite))
    && Object.prototype.hasOwnProperty.call(data, "reserveCoverDays")
    && Number.isFinite(Number(data.reserveCoverDays));
  if (!fullContractReady) {
    return liveFacts.length > 0 || financeSnapshot ? <L3LiveFacts facts={liveFacts} snapshot={financeSnapshot} /> : <LDataState ctx={ctx} label="L3" />;
  }
  const revenueDivisor = revTotal > 0 ? revTotal : 1;
  const selectPeriod = (period: "day" | "week" | "month" | "quarter" | "custom") => {
    if (!ctx.setL3Query) return;
    ctx.setL3Query(period === "custom"
      ? { ...ctx.l3Query, period, from: customFrom, to: customTo }
      : { period, cohort: ctx.l3Query?.cohort });
  };

  /* ---- 净敞口 / 覆盖率走势(12 周 + 红黄线 LEDGER 持有 + breach 事件标注) ---- */
  const expChart = () => {
    const W = 1240, H = 250, P = 46;
    const cov = COVERAGE_12W;
    const scaleValues = [...cov, TREASURY.redLine, TREASURY.yellowLine];
    const rawMin = Math.min(...scaleValues);
    const rawMax = Math.max(...scaleValues);
    const padding = Math.max((rawMax - rawMin) * 0.08, 1);
    const min = Math.max(0, rawMin - padding), max = rawMax + padding;
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
        {validBreaches.map((b) => {
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
    const values = MAT_SCHEDULE.data.flat();
    const max = Math.max(...(values.length ? values : [1])) * 1.15;
    const bw = 18, gap = 5;
    return (
      <svg className="mat-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="负债到期 30 天排程">
        {MAT_SCHEDULE.weeks.map((wk, g) => {
          const gx = P + (g + 0.5) * ((W - 2 * P) / 4); // 四组中心均匀分布,右组不触边
          const group = MAT_SCHEDULE.data[g] ?? [0, 0, 0];
          return (
            <g key={wk}>
              {group.map((v, s) => {
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
        <div className="f-stat"><div className="k">本期总收入</div><div className="v">{fmtM(revTotal)}</div><div className="sub">按服务器当前报表周期汇总</div></div>
        <div className="f-stat ok"><div className="k">兑付率(本期)</div><div className="v">{redRate}%</div><div className="sub">已兑付 ÷ 已提交 · 慢性核账指标</div></div>
        <div className="f-stat ok"><div className="k">兑付覆盖率(来自权威账本)</div><div className="v">{TREASURY.coverageRatio}%</div><div className="sub">红线 {TREASURY.redLine} / 黄线 {TREASURY.yellowLine} · 只读展示</div></div>
        <div className="f-stat cyan"><div className="k">储备可覆盖到期</div><div className="v">{reserveCoverDaysValue}</div><div className="sub">{reserveCoverDaysCopy} · 来自资金池水位</div></div>
      </div>

      {/* period context */}
      <div className="view-bar">
        <span className="lb">报表周期</span>
        <div className="chips">
          {([[
            "day", "日",
          ], ["week", "周"], ["month", "月"], ["quarter", "季"], ["custom", "自定义"]] as const).map(([value, label]) => (
            <button
              key={value}
              className={`chip${(ctx.l3Query?.period ?? "month") === value ? " sel" : ""}`}
              disabled={ctx.biLoading}
              onClick={() => selectPeriod(value)}
            >{label}</button>
          ))}
        </div>
        {(ctx.l3Query?.period ?? "month") === "custom" && (
          <>
            <input aria-label="自定义开始日期" type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} />
            <span>至</span>
            <input aria-label="自定义结束日期" type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} />
            <button className="chip" disabled={!customFrom || !customTo || customFrom > customTo || ctx.biLoading} onClick={() => selectPeriod("custom")}>应用日期</button>
          </>
        )}
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span className="lb">用户 cohort</span>
          <input
            aria-label="用户 cohort"
            type="month"
            value={ctx.l3Query?.cohort ?? ""}
            onChange={(event) => ctx.setL3Query?.({ ...(ctx.l3Query ?? { period: "month" }), cohort: event.target.value || undefined })}
          />
        </label>
        <span className="lcode electric">{String(data.periodLabel ?? "服务器当前周期")}</span>
        <span className="lcode lock" style={{ marginLeft: "auto" }} title="页面只展示服务器计算结果，不在浏览器重新计算财务口径">🔒 财务口径由服务器统一计算</span>
      </div>

      <div className="two-col">
        {/* (a) 收入结构 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">收入结构报表</span>
            <span className="sub">· 平台四条收入来源 · 按资金事件聚合</span>
            <div className="r"><span className="lcode">{String(data.periodLabel ?? "当前周期")}</span></div>
          </div>
          <div className="l-b">
            <div className="rev-stack">{REV_EXT.map((r) => <i key={r.nm} style={{ width: `${(r.amt / revenueDivisor) * 100}%`, background: r.color }} title={r.nm} />)}</div>
            {REV_EXT.map((r) => (
              <div key={r.nm} className="rev-row">
                <span className="rsw" style={{ background: r.color }} />
                <span className="nm"><AutoGloss>{r.nm}</AutoGloss><span className="src">{r.src}</span></span>
                <span className="amt">{fmtM(r.amt)}</span>
                <span className="sh">{revTotal > 0 ? `${((r.amt / revTotal) * 100).toFixed(1)}%` : "—"}</span>
                <span className={"mom " + (r.up ? "up" : "dn")}>{r.mom}</span>
              </div>
            ))}
            <div className="ltint" style={{ marginTop: 13, fontSize: 12 }}><b>说明</b> · <AutoGloss>每条收入按服务器业务账本的权威分类汇总；本页不重新定义收入，也不会把未登记的记录自动归类。</AutoGloss></div>
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
               <div className="t"><div className="k">提现申请</div><div className="v">{REDEMPTION.submitted.toLocaleString("zh-CN")}</div><div className="s">本期已提交申请</div></div>
               <div className="t"><div className="k">已兑付</div><div className="v" style={{ color: "var(--success)" }}>{REDEMPTION.confirmed.toLocaleString("zh-CN")}</div><div className="s">本期已完成兑付</div></div>
               <div className="t"><div className="k">兑付率</div><div className="v" style={{ color: "var(--success)" }}>{redRate}%</div><div className="s">已兑付占提现申请的比例</div></div>
               <div className="t"><div className="k">平均兑付时延</div><div className="v">{REDEMPTION.avgLatency}</div><div className="s">从申请到完成的平均耗时</div></div>
               <div className="t"><div className="k">驳回</div><div className="v">{REDEMPTION.rejected}</div><div className="s">本期已驳回申请</div></div>
               <div className="t"><div className="k">延迟</div><div className="v" style={{ color: "var(--warning)" }}>{REDEMPTION.delayed}</div><div className="s">计入本期申请总数</div></div>
               <div className="t"><div className="k">冻结</div><div className="v" style={{ color: "var(--danger)" }}>{REDEMPTION.frozen}</div><div className="s">计入本期申请总数</div></div>
               <div className="t"><div className="k">较上期变化</div><div className="v" style={{ color: "var(--success)" }}>+{(parseFloat(redRate) - REDEMPTION.prevRate).toFixed(1)} 个百分点</div><div className="s">{REDEMPTION.prevLabel}为 {REDEMPTION.prevRate}%</div></div>
            </div>
            <div className="ltint" style={{ fontSize: 12, marginBottom: 8 }}><b>比率与余额不可混用</b> · <AutoGloss>兑付率衡量本期申请完成比例；在途余额衡量尚未完成的应付款。两者同源但含义不同。</AutoGloss></div>
            <div className="ltint warn" style={{ fontSize: 12 }}><b>告警归属</b> · <AutoGloss>兑付率用于周期核账；急性提现安全信号以覆盖率和挤兑比率越线记录为准。需要处置时请进入提现审核队列。</AutoGloss></div>
          </div>
        </section>
      </div>

      {/* (c) 净敞口 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">净敞口报表</span>
          <span className="sub">· <AutoGloss>净敞口 = 真实储备 − 应付负债 · 覆盖率走势与红黄线均由服务器权威账本提供</AutoGloss></span>
          <div className="r">
             <span className="lcode">真实储备 {fmtM(LEDGER.reserveUsd)}</span>
             <span className="lcode">应付负债 {fmtM(LEDGER.liabilitiesUsd)}</span>
             <span className="lcode electric">净敞口 +{fmtM(TREASURY.netExposure)}</span>
          </div>
        </div>
        <div className="l-b">
          {expChart()}
          <div className="exp-legend">
            <span className="it"><span className="lsw" style={{ background: "var(--brand)" }} />兑付覆盖率(储备 ÷ 负债)</span>
            <span className="it" style={{ color: "var(--danger)" }}><span className="lsw" style={{ background: "var(--danger)" }} />红线 {TREASURY.redLine}%</span>
            <span className="it" style={{ color: "var(--warning)" }}><span className="lsw" style={{ background: "var(--warning)" }} />黄线 {TREASURY.yellowLine}%</span>
             <span className="it"><span className="ldot" style={{ background: "var(--danger)" }} />覆盖率阈值越线记录</span>
             <span className="it"><span className="ldot" style={{ background: "var(--warning)" }} />挤兑比率阈值越线记录</span>
          </div>
          <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}><b>越线区段来自服务器告警记录</b> · <AutoGloss>图上只标注当前响应中实际存在的覆盖率或挤兑比率越线记录；没有记录时不生成示例标记。</AutoGloss></div>
        </div>
      </section>

      {/* (d) 负债到期 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">负债到期报表</span>
          <span className="sub">· <AutoGloss>接下来要付的钱什么时候到期 · 数字直接取自资金池水位,科目定义跟负债看板一致</AutoGloss></span>
          <div className="r"><div className="chips">
            {(["7d", "30d"] as const).map((w) => (
               <button key={w} className={"chip" + (matWin === w ? " sel" : "")} onClick={() => { setMatWin(w); ctx.toast(`到期窗口已切换为${w === "7d" ? "未来 7 天" : "未来 30 天"}`); }}>{w === "7d" ? "未来 7 天" : "未来 30 天"}</button>
            ))}
          </div></div>
        </div>
        <div className="l-b">
          <div className="mat-grid">
             <div className="t"><div className="k">提现到期</div><div className="e">未来窗口内应付的提现金额</div><div className="v">{fmtM(m.withdraw)}</div></div>
             <div className="t"><div className="k">利息到期(质押本息)</div><div className="e">未来窗口内应付的质押本息</div><div className="v">{fmtM(m.interest)}</div></div>
             <div className="t"><div className="k">Genesis 日排放到期</div><div className="e">按服务器当前日排放率计算</div><div className="v">{fmtM(m.genesis)}</div></div>
          </div>
           <div className="ltint cyan" style={{ fontSize: 12, marginBottom: 16 }}><b>Genesis 日排放怎么算</b> · <AutoGloss>到期排放 = 持有量 × 服务器下发的当前日排放率。页面不写死比例，始终展示服务器计算结果。</AutoGloss></div>
          <div className="liab-split">
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>负债科目分解 <span className="lcode" style={{ marginLeft: 6 }}>来自权威负债账本</span></div>
              {LIABILITIES.map((l) => (
                <div key={l.id} className="liab-row">
                  <span className="nm"><i style={{ background: l.color }} /><AutoGloss>{l.name}</AutoGloss></span>
                  <span className="track"><i style={{ width: `${(l.amount / Math.max(...LIABILITIES.map((x) => x.amount))) * 100}%`, background: l.color }} /></span>
                  <span className="amt">{fmtM(l.amount)}</span>
                </div>
              ))}
              <div className="liab-row" style={{ borderTop: "1px dashed var(--border)", marginTop: 4, paddingTop: 9 }}>
                <span className="nm" style={{ fontWeight: 600, color: "var(--ink-2)" }}>应付负债合计</span><span />
                <span className="amt" style={{ fontWeight: 700, color: "var(--ink)" }}>{fmtM(liabTotal)}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>到期排程(30d) <span className="lcode" style={{ marginLeft: 6 }}>数字取自资金池水位</span></div>
              {matChart()}
              <div className="exp-legend" style={{ marginTop: 6 }}>
                <span className="it"><span className="lsw" style={{ background: "var(--cyan)" }} />提现到期</span>
                <span className="it"><span className="lsw" style={{ background: "var(--brand)" }} />利息到期</span>
                <span className="it"><span className="lsw" style={{ background: "var(--warning)" }} />Genesis 日排放</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L3 没有任何写账动作</b>：<AutoGloss>财务数字由服务器权威账本和资金池统一计算，本页只读展示与导出。聚合汇总不含用户明细，导出会生成可追溯记录；用户级资金明细只有在真实数据源和审批链接入后才会开放。</AutoGloss></p>
    </div>
  );
}
