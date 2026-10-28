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
    "平台储备够不够付用户的钱：可用储备、应付款、兑付覆盖率和红线，跌破时在这里处理。",
  ),
  liveDashboard(
    "/overview/liquidity",
    "现在能动用的钱和要付给用户的钱：还差多少、什么时候到期。",
  ),
  liveDashboard(
    "/overview/funnel",
    "用户从注册到提现，每一步留下多少、流失多少。",
  ),
  liveDashboard(
    "/overview/rhythm",
    "12 个月运营计划走到了哪个阶段，进度和预算情况如何。",
  ),
  liveDashboard(
    "/overview/risk-radar",
    "集中查看提现压力、异常账户、紧急开关和各类告警。",
  ),
];
