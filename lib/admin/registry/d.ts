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
    summary: "设置订单付款手续费，核对银行卡（HDPay）和 USDT 链上的充值与付款，处理没对上或异常的款项。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/withdrawals",
    summary: "审核提现申请，查看风险评分和触发的规则。大额提现先看兑付覆盖率；银行提现以支付商付款成功为完成。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/pool",
    summary: "查看可用储备、九类应付款、预计到期金额和资金安全等级。补充储备须上传真实凭证。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/ledger",
    summary: "查用户资金账单，核对充值、提现、收益和人工调整，检查每笔变动后的余额是否与钱包一致。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/params",
    summary: "设置每日提现次数、可提比例、网络费、UVT 抵扣、小额免审和到账时限。放宽限制前先看兑付覆盖率；随运营阶段变化的设置在「运营阶段设置」修改。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/fx-rate",
    summary: "设置 VND/USDT 基准汇率、买入点差和报价有效期。修改只影响新付款单，已创建的按下单时的汇率执行。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/finance/payout-vnd",
    summary: "设置越南盾银行提现的参数，汇率沿用「汇率设置」。银行提现通过 HDPay 审核和付款。",
    content: PORTED_EMPTY_CONTENT,
  },
];
