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
    summary: "关键指标 —— 目标是承载八项经营指标的当期值、达标状态与趋势。完整统计序列尚未开放时，只展示可核验的累计事实并明确标出降级范围。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/funnel-cohort",
    summary: "漏斗 / 同批用户 / 留存 —— 用同一用户统计规则分析逐级转化、同批用户与多周留存；只有数据不足时才仅显示已核验的独立统计，不把不同统计规则强行换算为转化率。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/financial",
    summary: "财务报表 —— 平台收入、成本、兑付支出和储备与应付款差额的周期汇总。储备 / 应付统计规则和 B1 总账一致(以服务器为准),供财务和决策层评估可持续性、以及兑付安全余量。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/operations",
    summary: "运营报表 —— 在役设备、任务完成和网络增长的运营侧汇总。数据来自 E 域设备台账、用户任务管理和 F 域网络结构,经 A4 事件流汇总,供运营评估履约能力和邀请网络增长质量。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/export",
    summary: "数据导出与监管报告 —— 当前可创建和下载 关键指标、漏斗、财务、运营四类只读聚合快照。账单明细、监管报告与敏感字段导出会明确显示接入状态，不用模拟数据补齐。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/behavior-heatmap",
    summary: "用户行为热力图 —— APP 页面浏览、元素点击事件与埋点目录均已接入服务端聚合；当前筛选没有生产事件时显示真实空态，不生成热力数值，也不开放空结果导出。测试与验收数据与生产聚合严格隔离。",
    content: PORTED_EMPTY_CONTENT,
  },
];
