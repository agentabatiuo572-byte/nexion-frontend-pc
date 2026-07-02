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
    summary: "KPI 看板 —— 八项验收指标的当期值、是否达标和趋势。所有指标都来自 A4 事件流(以服务器为准),是决策层判断核心健康度的统一口径,和 B 域驾驶舱一致。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/funnel-cohort",
    summary: "漏斗 / 同期群 / 留存 —— 用户从注册(L1)到提现(L5)每一步的转化与流失,再叠加首次购机那批人的多周留存矩阵。指标来自 A4 事件流,帮增长团队找出漏斗瓶颈和留存下滑的拐点。",
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
    summary: "导出 & 监管报告 —— 标准报表和监管报送的生成、周期和下载管理。报告内容是从 A4 事件流和结算账本截取的快照;导出敏感报告要经 A2 审计留痕,生成任务不可篡改。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/analytics/behavior-heatmap",
    summary: "用户行为热力图 —— 前端各页面的浏览、点击、停留与跳出按页面级别聚合成热力矩阵,可设置统计粒度(全部 / 一级 / 二级 / 三级页面),并点页下钻到单页点击坐标热力,帮产品/运营定位「哪些页面最热、用户在页内点哪、哪些页面留不住人」。只读报表域,不改任何业务规则。",
    content: PORTED_EMPTY_CONTENT,
  },
];
