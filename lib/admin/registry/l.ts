/**
 * 域 L 已 port 视图注册表。
 * 真渲染面在 l-view.tsx / l-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_L: ModuleEntry[] = [
  {
    path: "/analytics/kpi",
    summary: "查看八项经营指标的当前值、是否达标和变化趋势。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/funnel-cohort",
    summary: "看用户一步步的转化、同一批注册用户的后续表现和每周留存。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/financial",
    summary: "按周期汇总平台收入、成本、兑付支出和储备缺口，判断平台能否持续兑付。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/operations",
    summary: "汇总在线设备、任务完成和邀请网络的增长情况。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/export",
    summary: "导出关键指标、用户转化、财务、运营四类汇总数据。账单明细和监管报告暂未开放。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/behavior-heatmap",
    summary: "看用户在 App 各页面的浏览和点击分布，找出用户最关注和最容易忽略的位置。",
    content: PORTED_EMPTY_CONTENT,
  },
];
