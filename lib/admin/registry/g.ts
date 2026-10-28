/**
 * 域 G 已 port 视图注册表。
 * 真渲染面在 g-view.tsx / g-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_G: ModuleEntry[] = [
  {
    path: "/finance-products/staking",
    summary: "配置质押产品、监控持仓，可单独暂停某一档。调高年化或降低提前赎回罚金需先通过兑付覆盖率检查；已锁仓的订单按锁仓时的条件结算。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/exchange",
    summary: "设置 UVT 兑换的额度、手续费、拦截规则和排队，可紧急暂停或按地区封锁。放宽额度或降手续费需先通过兑付覆盖率检查；兑换价取自「UVT价格管理」。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/market",
    summary: "管理 UVT 价格：走势、价格来源、偏离告警和暂停状态。兑换和复投都按这里的价格计算。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/genesis",
    summary: "管理创世节点的销售、奖励产出、转售分成、批量派发和持仓。调高奖励产出需先通过兑付覆盖率检查，并注明决策依据。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/repurchase",
    summary: "设置复投规则、奖励倍率、锁仓期和创世节点抽奖券。调高收益或降低罚金需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
];
