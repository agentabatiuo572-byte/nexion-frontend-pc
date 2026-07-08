/**
 * 域 G 金融产品 — 注册表。accent=--admin-domain-g。
 * ⚠️ G ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = g-view.tsx + g-tabs/),仅 summary 经 DomainHeader 渲染。
 * 改 G 域数据/动作请改 g-tabs/data.ts 与 lib/mock/admin/design-data.ts(MATURITY/GEOBLOCK/KILLSWITCH),勿在此处改 content。
 * Premium(旧 G5)/ NEX v2 Founders(旧 G6)已于 2026-06-15 下线;NEX 质押档(G1 nex30/90/180/365)已于 2026-06-17 下线、仅留 USDT 质押;G7 复投激励独立成页。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = (note: string): ModuleEntry["content"] => ({ kind: "dashboard", metrics: [], note });

export const DOMAIN_G: ModuleEntry[] = [
  {
    path: "/finance-products/staking",
    summary:
      "质押池配置(G1)。USDT 质押 4 档(年化 12/35/80/180%、提前解锁罚 5/15/30/50%)+ 持仓状态监控 + 单档熔断(带处置方案,联动 J1/B5)。调高年化、调低罚金要先过 B1 覆盖率红线,且高低档之间必须保持顺序(两道硬门)。已锁仓的单子按锁仓时锁定的值结算、不追溯。在锁本金和应付利息分别记入负债科目 #2、#3(NEX 质押已下线,原 NEX 池 #8 转为历史存量)。",
    content: placeholder("死代码:G1 真渲染面在 g-tabs/g1-staking.tsx。"),
  },
  {
    path: "/finance-products/exchange",
    summary:
      "兑换风控(G2)。NEX 换成 USDT 往外流的闸门:三道额度线(单用户每天 $50 / 全平台每天 $2 万 / 累计达 $100 要实名——这条以 K5 为准、本页只读)+ 手续费(当前免费推广期,开收后 30% 进回购销毁池)+ 三类拦截 + 次日队列(可取消,钱不会被锁死)+ 兑换总熔断(和 J1 的兑换闸是同一个开关)+ 地区封锁(以 J2 为准)。往松了调额度、降手续费要先过 B1 红线;兑换报价取 G3 的服务器实时价。",
    content: placeholder("死代码:G2 真渲染面在 g-tabs/g2-exchange.tsx。"),
  },
  {
    path: "/finance-products/market",
    summary:
      "NEX 行情引擎(G3)。定价的底层设施:基准价 $0.171、价格上行概率 0.08、做市波动 ±3%、喂价来源、偏离 5% 报警。NEX 现价是 G2 兑换和 G7 复投唯一的定价来源(下游一律不接客户端报的价)。拉价、调高上行概率会放大往外流出,过 B1 红线时会用拟生效的新价把全部 NEX 计价负债重算一遍。引擎可以暂停、把现价冻住(联动 J1)。",
    content: placeholder("死代码:G3 真渲染面在 g-tabs/g3-market.tsx。"),
  },
  {
    path: "/finance-products/genesis",
    summary:
      "Genesis 创世经济(G4)。1,000 个节点、每个 $9,999 + 每日排放 0.1%/天(已裁定)+ 二级转售版税 2.5%。排放按两套口径算:按当日交易量派发(日交易量 × 0.1% ÷ 1,000 个节点 ≈ $24/节点/天)+ 按保底预提(节点价 × 0.1% 挂在负债科目 #4),超出保底的部分当期消化。上所后(genesisDivOpen M7 开阀)每天 UTC 00:00 批量派发、带防重复;调高排放率要过 B1 红线并附 PM 决议出处。市场熔断、地区封锁在 J1/J2 那边生效;排放权跟着节点 NFT 走。",
    content: placeholder("死代码:G4 真渲染面在 g-tabs/g4-genesis.tsx。"),
  },
  {
    path: "/finance-products/repurchase",
    summary:
      "复投激励(G7)。年化 35% · 锁 90 天 · 培育加成 ×1.5 · 送 Genesis 抽奖券(联动 G4)。复投这个动作 = 扣余额 + 锁仓,在服务器一笔完成(要么都成、要么都回滚)。限时倍率由 H1 派发、本页只是生效的地方(第 5–6 月的窗口已过,现在是 1×)。调高年化、倍率或调低罚金要过 B1 红线;在锁本金记入负债科目 #2。",
    content: placeholder("死代码:G7 真渲染面在 g-tabs/g7-repurchase.tsx。"),
  },
];
