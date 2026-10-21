/** 域 B 运营总览注册表。 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";

function liveDashboard(path: string, summary: string): ModuleEntry {
  return {
    path,
    summary,
    content: PORTED_EMPTY_CONTENT,
  };
}

export const DOMAIN_B: ModuleEntry[] = [
  liveDashboard(
    "/overview/dual-ledger",
    "资金与应付款总览 —— 可用储备、应付负债、覆盖率红线和风险动作。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/liquidity",
    "可用资金与应付款 —— 真实能拿出来的钱和该还给用户的钱之间,实时还差多少、什么时候到期。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/funnel",
    "用户转化分析 —— 用户从注册一路走到提现的跨阶段留存和流失。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/rhythm",
    "运营阶段状态 —— 12 个月运营节奏当前阶段、进度和预算结构。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/risk-radar",
    "风险提醒 —— 挤兑压力、异常账户、熔断开关和告警分布。页面读取 B 域后端聚合接口。",
  ),
];
