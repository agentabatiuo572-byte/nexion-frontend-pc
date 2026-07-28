"use client";

import type { L3FinanceSnapshot, L3LiveFact } from "./l3-live-data";

function usd(value: number | undefined) {
  return value === undefined ? "—" : `${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

export function L3LiveFacts({ facts, snapshot }: { facts: L3LiveFact[]; snapshot: L3FinanceSnapshot | null }) {
  const headline = snapshot ? [
    { key: "reserve", label: "真实储备", value: usd(snapshot.reserveUsd), sub: "资金池总账" },
    { key: "liability", label: "应付负债", value: usd(snapshot.liabilitiesUsd), sub: "负债账本" },
    { key: "coverage", label: "兑付覆盖率", value: snapshot.coverageRatio === undefined ? "—" : `${snapshot.coverageRatio.toFixed(2)}%`, sub: snapshot.redlinePct === undefined ? "服务器当前值" : `红线 ${snapshot.redlinePct.toFixed(2)}%` },
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
              <b>当前估值不可靠</b> · 服务器未能取得完整的资产价格，覆盖率和应付负债不能作为决策依据；请先处理估值数据后再核账或导出。
            </div></div></section>
          )}
          <section className="l-card">
            <div className="l-h">
              <span className="ttl">负债科目</span>
              <span className="sub">· 当前应付负债的服务器分解</span>
              <div className="r"><span className="lcode electric">负债账本</span></div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 620 }}>
                <thead><tr><th>负债科目</th><th className="num">当前金额</th><th>数据源</th></tr></thead>
                <tbody>{snapshot.accounts.map((account) => (
                  <tr key={account.key}><td style={{ fontWeight: 600 }}>{account.label}</td><td className="num mono">{usd(account.amount)}</td><td><span className="lcode">负债账本</span></td></tr>
                ))}</tbody>
              </table>
              {snapshot.accounts.length === 0 && <div className="ltint warn" style={{ margin: 12 }}>服务器尚未返回负债科目分解。</div>}
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
          <span className="ttl">当前可核验的财务事实</span>
          <span className="sub">· 按钱包账单类别汇总</span>
          <div className="r"><span className="lcode electric">服务器实时汇总</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead><tr><th>财务事实</th><th className="num">当前累计</th><th>业务含义</th><th>数据源</th></tr></thead>
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
            <b>部分周期统计尚未接入</b> · 当前可以核验资金池、负债科目、七日到期排程和钱包账单事实；收入金额分解、兑付率历史与多周期趋势仍缺少同口径序列。页面不会用账单数量换算金额或比率，也不展示推算值。
          </div>
          <div className="ltint" style={{ fontSize: 12, marginTop: 10 }}>
            <b>导出范围</b> · “财务当前汇总”包含本页当前资金池、负债科目、七日到期排程和钱包账单事实，不含用户级资金明细。有财务明细权限的角色可按当前服务端周期申请脱敏资金明细，并须通过字段白名单、行数上限、L5 审批与限时下载令牌校验。
          </div>
        </div>
      </section>

      <p className="f-foot"><b>L3 仍为只读分析面</b>：当前财务事实来自服务器资金池、负债账本、到期排程和钱包流水；缺失的周期序列保持明确降级。</p>
    </div>
  );
}
