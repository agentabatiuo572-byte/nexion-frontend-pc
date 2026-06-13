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
      "充值对账中心(D1)。五渠道费率/启停(操作确认)+ 主备 PSP(Checkout.com/Stripe)切换 + 支付商报表 vs 平台入账逐渠道对账(差异核销 操作确认)+ fee_buffer 备付金 + BIN 攻击监控(锁仍需操作确认/解锁强制原因)+ 拒付处置(操作确认,三连原子:追回入账 + 备付金扣回 + 终身入金核减);入账唯一真相 = server 处理 PSP 回调/链上确认,确认入账喂 D3 储备。",
    content: placeholder("死代码:D1 真渲染面在 d-tabs/d1-recon.tsx。"),
  },
  {
    path: "/finance/withdrawals",
    summary:
      "提现审核队列(D2)。三路信号只消费不重算:风险分(K4 同分单源)/ 命中规则(K3)/ 实名态(C4);正常 5 态 + 异常 6 态 server-canonical 状态机;小额(<$1,000)低风险普通确认快速放行保 48h SLA,大额 操作确认 + B1 覆盖率预检;K5 复审 hold 的单复审未过禁放;批量含大额自动分拣转单笔;放行实时核减 D3 储备 → 喂 B1/B5。",
    content: placeholder("死代码:D2 真渲染面在 d-tabs/d2-withdrawals.tsx(队列源 = design-data.WITHDRAWALS)。"),
  },
  {
    path: "/finance/pool",
    summary:
      `资金池水位仪表盘(D3)。储备/负债明细的底层账本权威页(§3.14):真实储备明细(在锁本金扣减与科目 #2 同笔不双计)+ 8 类负债科目(镜像 B2,trial shadow 脚注外置)+ 到期预测三类叠加(7d/30d,压力层默认关)+ 净敞口曲线;本页不算覆盖率(裁决归 B1,当前 ${_cov}%);注资登记 = 全后台唯一 server 实现(B1 仅 UI 入口),操作确认 + 幂等 + 凭证。`,
    content: placeholder("死代码:D3 真渲染面在 d-tabs/d3-treasury.tsx(LEDGER/LIABILITIES/MATURITY 单源派生)。"),
  },
  {
    path: "/finance/ledger",
    summary:
      "账本/账单审计(D4)。server 唯一账本的审计面:8 类账单(独立 bonus 类,试用兑换终态产;adjustment = C3 人工调整专类,不复用 refund)逐笔可查 + 单用户滚动余额(断点 = 账实不符告警)+ 手动调账 = 唯一合法写账路径(操作确认 + 幂等 + 凭证,产 admin.bill_adjusted)+ 脱敏导出;保留期 13 月;每个资金事件 ↔ 一条账单,与 D3 储备/负债聚合三方对齐。",
    content: placeholder("死代码:D4 真渲染面在 d-tabs/d4-ledger.tsx。"),
  },
  {
    path: "/finance/params",
    summary:
      "提现参数配置(D5)。本页 owns 三个非节奏参数:日限次数(1 次/日)/ 余额上限(80%)/ 网络费(2% min$1 max$20),操作确认 + 放松方向 B1 覆盖率红线核验(<100% 拒绝,422);冷却/积分/增强合规审查三项为 H1 Phase 派发只读(PUT 携带返 422 PHASE_PARAM_READONLY,跳 H1 调整),防 H1+D5 双源。",
    content: placeholder("死代码:D5 真渲染面在 d-tabs/d5-params.tsx。"),
  },
];
