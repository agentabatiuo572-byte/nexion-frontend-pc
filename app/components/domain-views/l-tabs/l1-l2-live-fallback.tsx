"use client";

import { ListChecks, ScrollText, ShoppingCart, Users, Wallet } from "lucide-react";
import { Cell, Conclusion, Panel, Stat, StatBand, Table, Td, Th, Tr } from "@/app/components/rd";
import { SMALL_SAMPLE_LABEL, type L1LiveMetric, type L2LiveStage } from "./l1-l2-live-data";

export function L1LiveTotals({ metrics }: { metrics: L1LiveMetric[] }) {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const highlights = ["users", "orders", "walletLedgerRows", "auditLogs"]
    .map((key) => byKey.get(key))
    .filter((metric): metric is L1LiveMetric => Boolean(metric));
  const tones = ["role-3", "role-2", "role-1", "role-other"] as const;
  const icons = [Users, ShoppingCart, Wallet, ScrollText];

  return (
    <>
      <Conclusion state="unknown" hint="8 项关键指标的详细数据还没开放，目前只有累计数，算不出比率和趋势，页面不会拿累计数冒充比率。">关键指标：暂时无法判断</Conclusion>
      <StatBand label="当前累计">
        {highlights.map((metric, index) => (
          <Stat key={metric.key} label={metric.label} value={metric.value.toLocaleString("zh-CN")} sub={`当前累计 · ${metric.sourceLabel}`} tone={tones[index]} icon={icons[index]} />
        ))}
      </StatBand>
      <Panel title="当前累计" sub="当前可核验的业务计数" icon={ListChecks} tone="role-2" flush>
        <Table label="当前累计">
          <thead><tr><Th>指标</Th><Th align="right">当前值</Th><Th>业务含义</Th><Th>数据源</Th></tr></thead>
          <tbody>
            {metrics.map((metric) => (
              <Tr key={metric.key}>
                <Td><Cell main={metric.label} /></Td>
                <Td align="right"><Cell num main={metric.value.toLocaleString("zh-CN")} /></Td>
                <Td><Cell main={metric.description} title={metric.description} /></Td>
                <Td><Cell main={metric.sourceLabel} /></Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

export function L2LiveStages({ stages }: { stages: L2LiveStage[] }) {
  const maxCount = Math.max(...stages.map((stage) => stage.count ?? 0), 1);
  const highlights = stages.slice(0, 4);

  return (
    <div>
      <div className="f-stats">
        {highlights.map((stage, index) => (
          <div key={stage.key} className={`f-stat ${index === 0 ? "cyan" : index === 3 ? "ok" : ""}`}>
            <div className="k">{stage.label}</div>
            <div className="v">{stage.suppressed ? SMALL_SAMPLE_LABEL : stage.count?.toLocaleString("zh-CN")}</div>
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
                  {stage.count == null ? SMALL_SAMPLE_LABEL : <div className="bar" style={{ width: `${Math.max((stage.count / maxCount) * 100, stage.count === 0 ? 0 : 4)}%`, background: "var(--cyan)" }}>
                    {stage.count > 0 && <span>{stage.count.toLocaleString("zh-CN")}</span>}
                  </div>}
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
