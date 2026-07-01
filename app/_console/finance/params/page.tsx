/**
 * D5 提现参数配置 — 渲染设计稿 D 域内容视图(D5),与 D 域其余子页统一布局。
 */
import { DomainViewSwitch } from "@/app/components/domain-views/registry";
import { buildDomainViewMeta } from "@/app/components/domain-views/ported";

export default function WithdrawParamsPage() {
  const meta = buildDomainViewMeta("/finance/params");
  return meta ? <DomainViewSwitch code="D" meta={meta} /> : null;
}
