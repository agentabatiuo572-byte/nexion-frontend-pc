/** 域 B 总览驾驶舱注册表。 */
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
    "双账本总览 —— 可用储备、应付负债、覆盖率红线和风险动作。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/liquidity",
    "资金池水位 —— 真实能拿出来的钱和该还给用户的钱之间,实时还差多少、什么时候到期。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/funnel",
    "转化漏斗 —— 用户从注册一路走到提现的跨阶段留存和流失。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/rhythm",
    "节奏状态 —— 12 个月运营节奏当前阶段、进度和预算结构。页面读取 B 域后端聚合接口。",
  ),
  liveDashboard(
    "/overview/risk-radar",
    "风险雷达 —— 挤兑压力、异常账户、熔断开关和告警分布。页面读取 B 域后端聚合接口。",
  ),
];
