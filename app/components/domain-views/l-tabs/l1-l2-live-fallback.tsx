"use client";

import type { L1LiveMetric, L2LiveStage } from "./l1-l2-live-data";

export function L1LiveTotals({ metrics }: { metrics: L1LiveMetric[] }) {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const highlights = ["users", "orders", "walletLedgerRows", "auditLogs"]
    .map((key) => byKey.get(key))
    .filter((metric): metric is L1LiveMetric => Boolean(metric));

  return (
    <div>
      <div className="f-stats">
        {highlights.map((metric, index) => (
          <div key={metric.key} className={`f-stat ${index === 0 ? "cyan" : index === 2 ? "ok" : ""}`}>
            <div className="k">{metric.label}</div>
            <div className="v">{metric.value.toLocaleString("zh-CN")}</div>
            <div className="sub">实时累计 · {metric.sourceLabel}</div>
          </div>
        ))}
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">实时数据 · 当前累计</span>
          <span className="sub">· 当前可核验的业务计数</span>
          <div className="r"><span className="lcode electric">实时汇总</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>指标</th><th className="num">当前值</th><th>业务含义</th><th>数据源</th></tr></thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.key}>
                  <td style={{ fontWeight: 600, color: "var(--ink)" }}>{metric.label}</td>
                  <td className="num mono" style={{ color: "var(--cyan)" }}>{metric.value.toLocaleString("zh-CN")}</td>
                  <td>{metric.description}</td>
                  <td><span className="lcode">{metric.sourceLabel}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-b">
          <div className="ltint warn" style={{ fontSize: 12 }}>
            <b>8 项关键指标的详细数据还没开放</b> · 目前只有累计数，还算不出比率和周趋势，页面不会拿累计数冒充比率。数据准备好后，会显示目标线、达标状态和明细。
          </div>
        </div>
      </section>

      <p className="f-foot"><b>这页只能查看</b>：目前可以导出上面的累计数；8 项关键指标准备好之前，不显示估算值。</p>
    </div>
  );
}

export function L2LiveStages({ stages }: { stages: L2LiveStage[] }) {
  const maxCount = Math.max(...stages.map((stage) => stage.count), 1);
  const highlights = stages.slice(0, 4);

  return (
    <div>
      <div className="f-stats">
        {highlights.map((stage, index) => (
          <div key={stage.key} className={`f-stat ${index === 0 ? "cyan" : index === 3 ? "ok" : ""}`}>
            <div className="k">{stage.label}</div>
            <div className="v">{stage.count.toLocaleString("zh-CN")}</div>
            <div className="sub">单独计数 · {stage.sourceLabel}</div>
          </div>
        ))}
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">各阶段人数</span>
          <span className="sub">· 各行是独立累计量，不直接相除为转化率</span>
          <div className="r"><span className="lcode electric">实时汇总</span></div>
        </div>
        <div className="l-b">
          <div className="fn-wrap" style={{ maxWidth: "none" }}>
            {stages.map((stage) => (
              <div key={stage.key} className="fn-row" style={{ cursor: "default" }}>
                <div className="lbl">
                  <span className="nm">{stage.label}</span>
                  <span className="ev">{stage.description}</span>
                </div>
                <div className="barzone">
                  <div className="bar" style={{ width: `${Math.max((stage.count / maxCount) * 100, stage.count === 0 ? 0 : 4)}%`, background: "var(--cyan)" }}>
                    {stage.count > 0 && <span>{stage.count.toLocaleString("zh-CN")}</span>}
                  </div>
                </div>
                <div className="cvr"><span className="lcode">{stage.sourceLabel}</span></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-b">
          <div className="ltint warn" style={{ fontSize: 12 }}>
            <b>同批用户、留存与逐级转化暂不可计算</b> · 订单行数、账户数和钱包记录数不是同一去重用户集合，直接相除会产生伪转化率。当前也没有注册周同期群、次日/7 日/30 日活跃或阶段、地区、渠道切片；同一用户统计规则的统计完成后，才会启用留存矩阵与路径查看明细。
          </div>
        </div>
      </section>

      <p className="f-foot"><b>这页只能查看</b>：目前可以导出上面的各阶段人数；完整漏斗准备好之前，不会拼凑转化率。</p>
    </div>
  );
}
