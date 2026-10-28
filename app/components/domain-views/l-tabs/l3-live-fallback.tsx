"use client";

import type { L3FinanceSnapshot, L3LiveFact } from "./l3-live-data";

function usd(value: number | undefined) {
  return value === undefined ? "—" : `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

export function L3LiveFacts({ facts, snapshot }: { facts: L3LiveFact[]; snapshot: L3FinanceSnapshot | null }) {
  const headline = snapshot ? [
    { key: "reserve", label: "实际储备", value: usd(snapshot.reserveUsd), sub: "资金池总额" },
    { key: "liability", label: "应付负债", value: usd(snapshot.liabilitiesUsd), sub: "负债账本" },
    { key: "coverage", label: "兑付覆盖率", value: snapshot.coverageRatio === undefined ? "—" : `${snapshot.coverageRatio.toFixed(2)}%`, sub: snapshot.redlinePct === undefined ? "当前值" : `红线 ${snapshot.redlinePct.toFixed(2)}%` },
    { key: "queue", label: "待处理提现", value: snapshot.queueBacklogCount === undefined ? "—" : `${snapshot.queueBacklogCount.toLocaleString("zh-CN")} 笔`, sub: usd(snapshot.queueBacklogUsd) },
  ] : facts.slice(0, 4).map((fact) => ({ key: fact.key, label: fact.label, value: fact.value.toLocaleString("zh-CN"), sub: `实时累计 · ${fact.sourceLabel}` }));
  return (
    <div>
      <div className="f-stats">
        {headline.map((item, index) => (
          <div key={item.key} className={`f-stat ${index === 0 ? "cyan" : index === 2 ? "ok" : ""}`}>
            <div className="k">{item.label}</div>
            <div className="v">{item.value}</div>
            <div className="sub">{item.sub}</div>
          </div>
        ))}
      </div>

      {snapshot && (
        <>
          {snapshot.valuationReliable === false && (
            <section className="l-card"><div className="l-b"><div className="ltint warn" style={{ fontSize: 12 }}>
              <b>当前估值不可靠</b> · 部分资产价格拿不到，覆盖率和应付款暂时不能作为决策依据；请先处理价格问题再核账或导出。
            </div></div></section>
          )}
          <section className="l-card">
            <div className="l-h">
              <span className="ttl">负债科目</span>
              <span className="sub">· 当前应付款明细</span>
              <div className="r"><span className="lcode electric">负债账本</span></div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 620 }}>
                <thead><tr><th>负债科目</th><th className="num">当前金额</th><th>数据源</th></tr></thead>
                <tbody>{snapshot.accounts.map((account) => (
                  <tr key={account.key}><td style={{ fontWeight: 600 }}>{account.label}</td><td className="num mono">{usd(account.amount)}</td><td><span className="lcode">负债账本</span></td></tr>
                ))}</tbody>
              </table>
              {snapshot.accounts.length === 0 && <div className="ltint warn" style={{ margin: 12 }}>暂无应付款明细。</div>}
            </div>
          </section>

          <section className="l-card">
            <div className="l-h">
              <span className="ttl">未来七日到期排程</span>
              <span className="sub">· 提现与利息应付款</span>
              <div className="r"><span className="lcode electric">到期排程</span></div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 620 }}>
                <thead><tr><th>日期</th><th className="num">提现到期</th><th className="num">利息到期</th></tr></thead>
                <tbody>{snapshot.maturity7d.map((item) => (
                  <tr key={item.day}><td>{item.day}</td><td className="num mono">{usd(item.withdrawUsd)}</td><td className="num mono">{usd(item.interestUsd)}</td></tr>
                ))}</tbody>
              </table>
              {snapshot.maturity7d.length === 0 && <div className="ltint" style={{ margin: 12 }}>未来七日暂无到期记录。</div>}
            </div>
          </section>
        </>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">当前财务数据</span>
          <span className="sub">· 按钱包账单类别汇总</span>
          <div className="r"><span className="lcode electric">实时汇总</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead><tr><th>项目</th><th className="num">当前累计</th><th>业务含义</th><th>数据源</th></tr></thead>
            <tbody>
              {facts.map((fact) => (
                <tr key={fact.key}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{fact.label}</td>
                  <td className="num mono" style={{ color: "var(--cyan)" }}>{fact.value.toLocaleString("zh-CN")}</td>
                  <td>{fact.description}</td>
                  <td><span className="lcode">{fact.sourceLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-b">
          <div className="ltint warn" style={{ fontSize: 12 }}>
            <b>部分统计还没接入</b> · 现在能看资金池、应付款明细、7 天内到期和钱包账单；收入明细、兑付率历史和多周期趋势还没有，页面不会估算这些数字。
          </div>
          <div className="ltint" style={{ fontSize: 12, marginTop: 10 }}>
            <b>导出范围</b> · 「财务汇总」包含本页的资金池、应付款明细、7 天内到期和钱包账单，不含用户级明细。有权限的人可以申请资金明细（已隐藏隐私），需要审批，下载链接限时有效。
          </div>
        </div>
      </section>

      <p className="f-foot"><b>这页只能查看</b>：数据来自资金池、应付款账本、到期计划和钱包流水；还没接入的统计会明确标出。</p>
    </div>
  );
}
