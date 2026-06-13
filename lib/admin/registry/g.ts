/**
 * 域 G 金融产品 — 注册表。accent=--admin-domain-g。
 * ⚠️ G ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = g-view.tsx + g-tabs/),仅 summary 经 DomainHeader 渲染。
 * 改 G 域数据/动作请改 g-tabs/data.ts 与 lib/mock/admin/design-data.ts(MATURITY/GEOBLOCK/KILLSWITCH),勿在此处改 content。
 * nav G5/G6/G7 三路由折叠进同一合并页(segmented 三子段,按 l2Id 预选)。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = (note: string): ModuleEntry["content"] => ({ kind: "dashboard", metrics: [], note });

export const DOMAIN_G: ModuleEntry[] = [
  {
    path: "/finance-products/staking",
    summary:
      "Staking 池配置(G1)。双产品 4 档(USDT 12/35/80/180% 罚 5/15/30/50;NEX 5/12/20/35%)+ position 状态机监控 + 单档熔断(附处置方案,联动 J1/B5);升 APY/降罚款过 B1 覆盖率红线(422)+ 跨档保序校验双硬门;在锁单按开锁锁定值结算不追溯;在锁本金/应付利息 = 负债科目 #2/#3/#8 同源。",
    content: placeholder("死代码:G1 真渲染面在 g-tabs/g1-staking.tsx。"),
  },
  {
    path: "/finance-products/exchange",
    summary:
      "兑换风控(G2)。NEX→USDT 流出闸门:三阈值(用户日 $50 / 平台日 $20K / 累计实名 $100——V1 权威在 K5 只读引用)+ 费率(当前免费推广期,开费后 30% 进回购销毁池)+ 三类拦截 + 次日队列(可取消,钱不锁死)+ swap 全局熔断(J1 exchange 闸同键)+ 地域封锁(J2 权威);放宽 caps/降费过 B1 红线;兑换报价取 G3 服务端现价。",
    content: placeholder("死代码:G2 真渲染面在 g-tabs/g2-exchange.tsx。"),
  },
  {
    path: "/finance-products/market",
    summary:
      "NEX 行情引擎(G3)。定价基础设施:基准价 $0.171 / 价格上行概率 0.08 / 做市波动 ±3% / 喂价源 / 偏离告警 5%;NEX 现价是 G2 兑换与 G7 复投的唯一定价源(下游不接客户端价);拉价/升上行概率 = 放大流出,B1 红线核验以拟生效新价重估全量 NEX 计价负债;引擎可暂停冻结现价(联动 J1)。中性运营语言。",
    content: placeholder("死代码:G3 真渲染面在 g-tabs/g3-market.tsx。"),
  },
  {
    path: "/finance-products/genesis",
    summary:
      "Genesis 经济(G4)。1,000 节点 $9,999 + 每日分红率 0.1%/日(已裁定)+ 二级版税 2.5%;分红双口径:基数口径派发(日交易量 × 0.1% ÷ 1,000 slot = $24/slot/日)+ 保底口径预提(节点价 × 0.1% 挂科目 #4),超出保底当期化;每日 00:00 UTC 批次派发带防重号;升分红率过 B1 红线 + 附 PM 决议引用;市场熔断/地域封锁 = J1/J2 生效面;分红跟随 NFT。",
    content: placeholder("死代码:G4 真渲染面在 g-tabs/g4-genesis.tsx。"),
  },
  {
    path: "/finance-products/premium",
    summary:
      "Premium 订阅(G5)。$99/月 · 首月 5 折 · +2% NEX 收益权益;解锁阶段 premiumSubAvailable 归 H1 派发只读(月 7+,当前月 7 已解锁);升权益过 B1 红线;熔断 = J1 premium 闸同键;订阅台账 server 单源,7 天退款窗服务端判定。",
    content: placeholder("死代码:G5 真渲染面在 g-tabs/g5-products.tsx(premium 段)。"),
  },
  {
    path: "/finance-products/nex-v2",
    summary:
      "NEX v2 Founders Vault(G6)。250% APY · 24 月锁 · min 1,000 NEX · 到期 ×6 一次性兑付;开锁即按到期应付额一次性全额登账科目 #5(区别 USDT staking 线性计提),NEX 计价按 G3 现价折算;gate nexV2LockAvailable 归 H1(月 11+,当前 Founders 邀请制预售);升 APY 过 B1 红线 + 附风控意见;熔断 = J1 nexv2 闸同键。",
    content: placeholder("死代码:G6 真渲染面在 g-tabs/g5-products.tsx(nexv2 段)。"),
  },
  {
    path: "/finance-products/repurchase",
    summary:
      "复投激励(G7)。35% APY · 90 天锁 · +50 积分/$100 · 培育 ×1.5 · Genesis 抽奖券联动 G4;复投 = 扣余额 + 给积分 + 锁仓服务端单事务原子;限时倍率 reinvestMultiplier 归 H1 派发生效面(月 5–6 窗口已过 = 1×);升 APY/倍率/降罚款过 B1 红线;在锁本金归科目 #2;wallet.reinvest 双写灰度切口径。",
    content: placeholder("死代码:G7 真渲染面在 g-tabs/g5-products.tsx(repurchase 段)。"),
  },
];
