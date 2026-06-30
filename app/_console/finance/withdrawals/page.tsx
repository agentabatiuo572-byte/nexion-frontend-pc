/**
 * D2 提现审核队列 — 渲染设计稿 D 域内容视图(D2),与 D 域其余子页统一布局。
 */
import { DomainViewSwitch } from "@/app/components/domain-views/registry";
import { buildDomainViewMeta } from "@/app/components/domain-views/ported";

export default function WithdrawalsPage() {
  const meta = buildDomainViewMeta("/finance/withdrawals");
  return meta ? <DomainViewSwitch code="D" meta={meta} /> : null;
}
