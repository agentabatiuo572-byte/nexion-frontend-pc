/**
 * 域 D 已 port 视图注册表。
 * 真渲染面在 d-view.tsx / d-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_D: ModuleEntry[] = [
  {
    path: "/finance/recon",
    summary: "充值对账中心(D1)。管 5 个充值渠道的手续费率和启停(要确认)+ 主用/备用支付通道(Checkout.com / Stripe)切换 + 把支付商报表和平台自己的入账逐渠道核对(对不上要走确认核销)+ 手续费备付金 + 盗刷探测(锁定要确认、解锁必须填原因)+ 拒付处置(确认后一气呵成三件事:追回这笔入账 + 扣回备付金 + 核减该用户终身入金)。一笔钱到底算不算到账,只认服务器处理完支付商回调 / 链上确认;确认到账后才计入 D3 储备。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/withdrawals",
    summary: "提现审核队列(D2)。三路信号只用、不重算:风险分(来自 K4 同一个分)、命中的规则(来自 K3)、实名状态(来自 C4)。提现状态由服务器统一推进——正常 5 种状态 + 异常 6 种状态。小额(<$1,000)且低风险的,普通确认就能快速放行,守住 48 小时到账承诺;大额要走确认 + 先过 B1 备付金覆盖率预检。被 K5 拉去复审、还没过的单子禁止放行;批量里夹着大额会自动拆成单笔逐一审。放行会实时扣减 D3 储备,并同步给 B1/B5。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/pool",
    summary: "资金池水位仪表盘(D3)。作为储备和负债的底层权威账页，展示四档资金水位、真实储备明细、固定 8 类应付负债、7/30 天到期预测及 7/30/90 天净敞口；本页不计算 B1 覆盖率。注资必须填写唯一真实凭证，预测口径按权限调整并于下一 UTC 日 00:00 生效，所有写操作均落审计和事件。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/ledger",
    summary: "资金账单与余额核对。可按业务号、账户和账单类型逐笔查询，查看单个用户的滚动余额；余额纠错产生的关联账单可从余额调整历史精确定位。该页面只负责核对，余额纠错与补偿统一从余额调整入口办理。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/params",
    summary: "提现参数配置(D5)。D5 统一管理四组非 Phase 参数:每日提现次数、余额可提上限、网络费率+min/max、NEX 抵扣率；变更基于版本号原子提交并留审计，放大资金流出方向还要先过 B1 覆盖率红线。冷却时间、提现惩罚费率、加强合规审查由 H1 Phase 单一派发，本页只读展示并提供 H1 跳转。",
    content: PORTED_EMPTY_CONTENT,
  },
];
