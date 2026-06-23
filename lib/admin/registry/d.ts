/**
 * 域 D 资金管理 — 注册表。accent=--admin-domain-d。
 * ⚠️ D ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = d-view.tsx + d-tabs/),仅 summary 经 DomainHeader 渲染。
 * 改 D 域数据/动作请改 d-tabs/data.ts 与 lib/mock/admin/design-data.ts(WITHDRAWALS/TOPUPS/D_FUND/MATURITY),勿在此处改 content。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { LEDGER } from "@/lib/mock/admin/ledger";

const _cov = LEDGER.coverageRatio.toFixed(1);

const placeholder = (note: string): ModuleEntry["content"] => ({ kind: "dashboard", metrics: [], note });

export const DOMAIN_D: ModuleEntry[] = [
  {
    path: "/finance/recon",
    summary:
      "充值对账中心(D1)。管 5 个充值渠道的手续费率和启停(要确认)+ 主用/备用支付通道(Checkout.com / Stripe)切换 + 把支付商报表和平台自己的入账逐渠道核对(对不上要走确认核销)+ 手续费备付金 + 盗刷探测(锁定要确认、解锁必须填原因)+ 拒付处置(确认后一气呵成三件事:追回这笔入账 + 扣回备付金 + 核减该用户终身入金)。一笔钱到底算不算到账,只认服务器处理完支付商回调 / 链上确认;确认到账后才计入 D3 储备。",
    content: placeholder("死代码:D1 真渲染面在 d-tabs/d1-recon.tsx。"),
  },
  {
    path: "/finance/withdrawals",
    summary:
      "提现审核队列(D2)。三路信号只用、不重算:风险分(来自 K4 同一个分)、命中的规则(来自 K3)、实名状态(来自 C4)。提现状态由服务器统一推进——正常 5 种状态 + 异常 6 种状态。小额(<$1,000)且低风险的,普通确认就能快速放行,守住 48 小时到账承诺;大额要走确认 + 先过 B1 备付金覆盖率预检。被 K5 拉去复审、还没过的单子禁止放行;批量里夹着大额会自动拆成单笔逐一审。放行会实时扣减 D3 储备,并同步给 B1/B5。",
    content: placeholder("死代码:D2 真渲染面在 d-tabs/d2-withdrawals.tsx(队列源 = design-data.WITHDRAWALS)。"),
  },
  {
    path: "/finance/pool",
    summary:
      `资金池水位仪表盘(D3)。储备和负债明细的底层权威账页:真实储备明细(在锁本金的扣减和负债科目 #2 是同一笔,不重复计)+ 8 类应付负债科目(口径和 B2 一致,试用影子收益单独放脚注)+ 到期预测三类叠加(未来 7 天 / 30 天,压力情景默认收起)+ 净敞口曲线。本页不算覆盖率(那个由 B1 裁定,当前 ${_cov}%);注资登记是全后台唯一真正写库的入口(B1 那边只是入口按钮),要确认 + 防重复 + 留凭证。`,
    content: placeholder("死代码:D3 真渲染面在 d-tabs/d3-treasury.tsx(LEDGER/LIABILITIES/MATURITY 单源派生)。"),
  },
  {
    path: "/finance/ledger",
    summary:
      "账本 / 账单审计(D4)。服务器唯一账本的审计页:8 类账单(奖励单独一类,是试用兑换的终态产出;「人工调整」是 C3 调账专用类、不和退款混用)可逐笔查 + 单个用户的滚动余额(对不上就报「账实不符」告警)+ 手动调账是唯一合法的写账路径(要确认 + 防重复 + 留凭证)+ 脱敏导出。保留 13 个月;每个资金事件对应一条账单,和 D3 的储备 / 负债汇总三方对齐。",
    content: placeholder("死代码:D4 真渲染面在 d-tabs/d4-ledger.tsx。"),
  },
  {
    path: "/finance/params",
    summary:
      "提现参数配置(D5)。本页自己说了算的三个参数:每日提现次数(1 次/日)、单次可提余额上限(80%)、NEX 抵扣率($0.40/NEX)——改它们要确认;往松了调还要先过 B1 备付金覆盖率红线(低于 100% 直接拒绝)。另外三项(冷却时间、提现罚金费率、加强合规审查)由 H1 节奏统一派发、本页只能看(想改去 H1,防止两处都能改打架)。提现费规则:不烧 NEX 抵扣就按罚金费率收,烧 NEX 抵扣可一路减免到 0。",
    content: placeholder("死代码:D5 真渲染面在 d-tabs/d5-params.tsx。"),
  },
];
