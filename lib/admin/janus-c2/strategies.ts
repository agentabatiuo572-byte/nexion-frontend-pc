import type { RuleGroup, Strategy, StrategyAction, StrategySafeguards } from "./types";

export function primaryActiveStrategy(strategies: Strategy[]): Strategy | undefined {
  return strategies.filter((strategy) => strategy.status === "active").sort((a, b) => b.priority - a.priority)[0];
}

export interface StrategyTemplate {
  key: string;
  name: string;
  description: string;
  action: StrategyAction;
  ruleTree: RuleGroup;
  safeguards: StrategySafeguards;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    key: "manual_pilot",
    name: "手动试点",
    description: "所有设备只进入建议,由运营逐台确认。",
    action: { type: "RECOMMEND" },
    ruleTree: { mode: "ALL", rules: [{ field: "activated", op: "=", value: false, label: "尚未激活" }] },
    safeguards: { maxDailyRecommendations: 100 },
  },
  {
    key: "maturity_recommend",
    name: "成熟度自动建议",
    description: "成熟度达标、低风险设备进入建议队列。",
    action: { type: "RECOMMEND" },
    ruleTree: {
      mode: "ALL",
      rules: [
        { field: "environmentRiskScore", op: "<", value: 50, label: "环境风险低于 50" },
        { field: "maturityScore", op: ">=", value: 60, label: "成熟度分不低于 60" },
      ],
    },
    safeguards: { maxDailyRecommendations: 300, requireFreshReportMinutes: 10 },
  },
  {
    key: "environment_protect",
    name: "环境保护",
    description: "高风险环境自动过滤,不下发。",
    action: { type: "ENV_FILTER" },
    ruleTree: {
      mode: "ANY",
      rules: [
        { field: "isHeadless", op: "=", value: true, label: "疑似无头浏览器" },
        { field: "environmentRiskScore", op: ">=", value: 80, label: "环境风险不低于 80" },
      ],
    },
    safeguards: {},
  },
];

export const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function strategyFromTemplate(template: StrategyTemplate, id: string, owner: string, at: number): Strategy {
  return {
    strategyId: id,
    name: template.name,
    description: template.description,
    status: "draft",
    version: 1,
    priority: 100,
    owner,
    scope: {},
    ruleTree: deepClone(template.ruleTree),
    action: { ...template.action },
    safeguards: { ...template.safeguards },
    templateKey: template.key,
    versions: [],
    createdAt: at,
  };
}

export function blankStrategy(id: string, owner: string, at: number): Strategy {
  return {
    strategyId: id,
    name: "",
    description: "",
    status: "draft",
    version: 1,
    priority: 100,
    owner,
    scope: {},
    ruleTree: { mode: "ALL", rules: [] },
    action: { type: "RECOMMEND" },
    safeguards: {},
    versions: [],
    createdAt: at,
  };
}
