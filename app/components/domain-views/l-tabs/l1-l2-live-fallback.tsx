"use client";

import { ListChecks, ScrollText, ShoppingCart, Users, Wallet } from "lucide-react";
import { Cell, Conclusion, Panel, Stat, StatBand, Table, Td, Th, Tr } from "@/app/components/rd";
import type { L1LiveMetric } from "./l1-l2-live-data";

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
