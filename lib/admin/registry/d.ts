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
    summary: "充值对账中心(D1)。除银行卡、链上和支付商通道外，新增 VietQR 银行轨的在途、已匹配、孤儿、差额、过期后到账五个真实视图，以及收款账户池、熔断和轮换配置。人工匹配、按实收核销、登记退回都必须携带版本、幂等键、证据与理由；未处置到账统一进入 D3 第 9 类“待核实入金”。一笔钱是否到账只认服务端回单、回调或链上确认。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/withdrawals",
    summary: "提现审核队列(D2)。三路信号只用、不重算:风险分(来自 K4 同一个分)、命中的规则(来自 K3)、实名状态(来自 C4)。提现状态由服务器统一推进——正常 5 种状态 + 异常 6 种状态。小额(<$1,000)且低风险的,普通确认就能快速放行,守住 48 小时到账承诺;大额要走确认 + 先过 B1 备付金覆盖率预检。被 K5 拉去复审、还没过的单子禁止放行;批量里夹着大额会自动拆成单笔逐一审。放行会实时扣减 D3 储备,并同步给 B1/B5。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/pool",
    summary: "资金池水位仪表盘(D3)。作为储备和负债的底层权威账页，展示四档资金水位、真实储备明细、固定 8 类既有应付负债，加上由 D1 未处置银行回单实时汇总的第 9 类“待核实入金”，以及 7/30 天到期预测和 7/30/90 天净敞口；本页不计算 B1 覆盖率。注资必须填写唯一真实凭证，所有写操作均落审计和事件。",
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
  {
    path: "/finance/fx-rate",
    summary: "汇率牌价(D6)。展示并调整 VND/USDT 基准价、买入点差与锁价窗口；报价由服务端计算并按 10 VND 收敛，修改必须携带版本、幂等键和理由。新牌价只影响随后创建的意向单，已经创建的在途单继续使用其锁定快照。",
    content: PORTED_EMPTY_CONTENT,
  },
];
