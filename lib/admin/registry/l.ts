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
    summary: "看一批注册用户卡在哪一步、留下多少。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/financial",
    summary: "看这一期进出多少、现在付不付得起、接下来要付多少。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/operations",
    summary: "看设备、任务、团队这段时间怎样，哪个阶段效果好。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/export",
    summary: "按授权导出关键指标、用户转化、财务、运营四类汇总数据、八类账单脱敏明细和当前披露报告。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/behavior-heatmap",
    summary: "看用户在 App 各页面的浏览和点击分布，找出用户最关注和最容易忽略的位置。",
    content: PORTED_EMPTY_CONTENT,
  },
];
