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
    summary: "KPI 看板 —— 目标是承载八项经营指标的当期值、达标状态与趋势。完整统计序列尚未开放时，只展示可核验的累计事实并明确标出降级范围。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/funnel-cohort",
    summary: "漏斗 / 同期群 / 留存 —— 用同一用户口径分析逐级转化、同期群与多周留存；只有数据不足时才安全降级为独立事实计数，不把不同口径强行换算为转化率。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/financial",
    summary: "财务报表 —— 平台收入、成本、兑付支出和净敞口的周期汇总。储备 / 应付口径和 B1 总账一致(以服务器为准),供财务和决策层评估可持续性、以及离挤兑还有多少安全余量。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/operations",
    summary: "运营报表 —— 在役设备、任务完成和网络增长的运营侧汇总。数据来自 E 域设备台账、任务引擎和 F 域网络结构,经 A4 事件流汇总,供运营评估履约能力和裂变质量。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/export",
    summary: "导出 & 监管报告 —— 当前可创建和下载 KPI、漏斗、财务、运营四类只读聚合快照。账单明细、监管报告与敏感字段导出会明确显示接入状态，不用模拟数据补齐。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/behavior-heatmap",
    summary: "用户行为热力图 —— 需要 APP 页面浏览与元素点击事件及埋点目录共同支撑。数据源未接入前只展示真实接入状态，不生成热力数值，也不开放导出。",
    content: PORTED_EMPTY_CONTENT,
  },
];
