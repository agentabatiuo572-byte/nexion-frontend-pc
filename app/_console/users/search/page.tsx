/**
 * C1 用户检索 & 画像 — 渲染设计稿 C 域内容视图(C1),与 C 域其余子页统一布局。
 * 深度用户档案仍可经 /users/search/[id] 深链访问。
 */
import { DomainViewSwitch } from "@/app/components/domain-views/registry";
import { buildDomainViewMeta } from "@/app/components/domain-views/ported";

export default function UsersSearchPage() {
  const meta = buildDomainViewMeta("/users/search");
  return meta ? <DomainViewSwitch code="C" meta={meta} /> : null;
}
