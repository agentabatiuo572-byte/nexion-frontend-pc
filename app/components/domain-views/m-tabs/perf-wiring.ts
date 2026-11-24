/**
 * 客服业绩额的接线占位。后端新合同（B80）交付、核定字段名后，由 Codex 按合同替换这里的函数；显示件（perf-view.tsx 和各页）不用改。
 *
 * 现在 PC 照旧只发旧请求（不带 metricVersion），旧回包里的「净贡献」是旧算法，不能当业绩额显示（交接 §2.4 第 3 条）。
 * 所以这里一律返回「业绩数据暂不可用」，导出入口和「导出记录」页签不显示；新数据只有开发夹具给（perf-fixture.ts）。
 */
import type { LeaderboardPage } from "@/lib/admin/support-leaderboard-client";
import { PERF_UNAVAILABLE, PERF_UNAVAILABLE_VALUE, type AnalyticsPerf, type PerfExportPorts, type PerfTotals, type PerfValue } from "./perf-view";

/** 业绩榜各行的三项合计。接线：新版 page / detail 行里的 performance（业绩额、入金合计、提现合计），按 agentId 取。 */
export type BoardPerf = { kind: "ready"; byAgent: Record<string, PerfTotals> } | { kind: "unavailable"; reason: string };
export function leaderboardPerf(_page: LeaderboardPage): BoardPerf {
  return { kind: "unavailable", reason: PERF_UNAVAILABLE };
}

/**
 * 客服工作台各处的业绩额。接线：新版 analytics 回包的 performanceWindow、scopeSummary.financial.performance、groups[].period / current.performance、
 * AGENTS.records[].current.performance、客户记录的 performance、仅超管的 scopeSummary.performanceAttribution，以及 PERFORMANCE_EVENTS 视图（交接 §2.2）。
 */
export function analyticsPerf(): AnalyticsPerf {
  const none = PERF_UNAVAILABLE_VALUE;
  return { period: { unavailable: PERF_UNAVAILABLE }, customers: {}, agents: {}, groups: {}, scope: { period: { amount: none, inflow: none, withdrawal: none }, current: none } };
}

/** 客户资料：累计业绩额和首充来源。接线：/customers/{id} 与 /360 新版统计组、资金组各自的 performance（同版本同范围），首付的 channel。 */
export function profilePerf(): { cumulative: PerfValue; firstSource?: string } {
  return { cumulative: PERF_UNAVAILABLE_VALUE };
}

/**
 * 导出和审批。接线：新 client 走交接 §2.3 的 E 路由（options、preview、提交、列表、详情、decision、withdraw、download-token + file），
 * 申请键和结果未知的恢复照 OP-91–96。没接线前返回 null：页头不出「导出业绩」，客服工作台不出「导出记录」页签。
 */
export function exportPorts(): PerfExportPorts | null {
  return null;
}
