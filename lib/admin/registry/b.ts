/** 域 B 总览驾驶舱注册表。
 * B 域的业务数值不再由注册表静态提供;真实渲染面统一读取 /api/admin/treasury/b-domain。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const LIVE_B_SOURCE = "/api/admin/treasury/b-domain";
const MYSQL_SEED_POLICY = "缺口配置先写入 MySQL nx_config_item, 再由接口读回";

function liveDashboard(path: string, summary: string, controlLabel: string, controlHref: string): ModuleEntry {
  return {
    path,
    summary,
    content: {
      kind: "dashboard",
      metrics: [
        {
          label: "数据源",
          value: "实时接口",
          sub: LIVE_B_SOURCE,
          accent: "var(--admin-domain-b)",
          hint: "B 域页面统一通过后端聚合接口读取账本、流动性、漏斗、节奏和风险雷达数据。",
        },
        {
          label: "落库策略",
          value: "MySQL",
          sub: "缺口配置先写入再读取",
          accent: "var(--v5-success)",
          hint: MYSQL_SEED_POLICY,
        },
      ],
      controlLink: { label: controlLabel, href: controlHref },
      note: `${MYSQL_SEED_POLICY}; 本注册表只保留模块说明, 不承载 B 域业务数值。`,
    },
  };
}

export const DOMAIN_B: ModuleEntry[] = [
  liveDashboard(
    "/overview/dual-ledger",
    "双账本总览 —— 可用储备、应付负债、覆盖率红线和风险动作。页面读取 B 域后端聚合接口,缺口配置落 MySQL 后读回。",
    "调红线 / 熔断",
    "/overview/dual-ledger",
  ),
  liveDashboard(
    "/overview/liquidity",
    "资金池水位 —— 真实能拿出来的钱和该还给用户的钱之间,实时还差多少、什么时候到期。页面读取 B 域后端聚合接口,缺口配置落 MySQL 后读回。",
    "调资金/提现参数",
    "/finance/params",
  ),
  liveDashboard(
    "/overview/funnel",
    "转化漏斗 —— 用户从注册一路走到提现的跨阶段留存和流失。页面读取 B 域后端聚合接口,缺口配置落 MySQL 后读回。",
    "调 Phase dial",
    "/growth/phase",
  ),
  liveDashboard(
    "/overview/rhythm",
    "节奏状态 —— 12 个月运营节奏当前阶段、进度和预算结构。页面读取 B 域后端聚合接口,缺口配置落 MySQL 后读回。",
    "调 Phase dial",
    "/growth/phase",
  ),
  liveDashboard(
    "/overview/risk-radar",
    "风险雷达 —— 挤兑压力、异常账户、熔断开关和告警分布。页面读取 B 域后端聚合接口,缺口配置落 MySQL 后读回。",
    "Kill-Switch 矩阵",
    "/emergency/kill-switch",
  ),
];
