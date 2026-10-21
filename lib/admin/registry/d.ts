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
    summary: "核对银行转账、支付商及链上充值记录，处理未匹配、信息不符和逾期到账的银行回单。入账或退回款项前须核实证据并填写理由；待核实款项同步到资金储备页面。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/withdrawals",
    summary: "查看提现申请、风险评分与命中规则，按权限审核和处理异常。大额提现须先核对资金覆盖率；银行提现在确认支付商付款成功后完成资金结算。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/pool",
    summary: "查看可用储备、九类应付款、预计到期金额和资金安全等级，调整应付款预测范围。补充储备须填写真实且唯一的凭证，所有修改均保存操作记录。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/ledger",
    summary: "查询用户资金账单，核对充值、提现、收益和人工调整记录，检查每笔变动后的余额与钱包是否一致。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/params",
    summary: "设置每日提现次数、余额比例、网络费用、UVEL 抵扣、小额免审和到账时限。保存时检查修改冲突并记录操作；增加资金支出时须核对覆盖率。运营阶段相关设置在 H1 修改。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/fx-rate",
    summary: "设置 VND/USDT 基准汇率、买入点差和报价有效期。修改仅影响新建付款单；已创建的付款单沿用下单时锁定的汇率，所有调整均可追溯。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/payout-vnd",
    summary: "设置越南盾提现参数，基准汇率沿用 D6 设置。银行提现通过 HDPay 审核与付款，订单、资金账单和支付结果相互关联。",
    content: PORTED_EMPTY_CONTENT,
  },
];
