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
    summary: "质押池配置(G1)。锁仓产品、持仓状态监控和单档熔断都从服务端业务表读取。调高年化或调低罚金要先过 B1 覆盖率红线,已锁仓的单子按锁仓时锁定的值结算、不追溯。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/exchange",
    summary: "兑换风控(G2)。NEX 兑换、额度、手续费、拦截、队列、熔断和地区封锁都以服务端实时结果为准。往松了调额度或降手续费要先过 B1 红线;兑换报价取 G3 的服务器实时价。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/market",
    summary: "NEX 行情引擎(G3)。行情曲线、喂价来源、偏离报警和暂停状态都从服务端读取。NEX 现价是 G2 兑换和 G7 复投的定价来源,下游不接客户端报的价。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/genesis",
    summary: "Genesis 创世经济(G4)。节点、排放、转售版税、批量派发和持仓状态都从服务端读取。调高排放率要过 B1 红线并附业务决议出处;市场熔断和地区封锁由 J 域生效。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance-products/repurchase",
    summary: "复投激励(G7)。复投规则、倍率、锁仓和 Genesis 抽奖券联动都从服务端读取。复投动作在服务器一笔完成,要么都成、要么都回滚;调高收益或调低罚金要过 B1 红线。",
    content: PORTED_EMPTY_CONTENT,
  },
];
