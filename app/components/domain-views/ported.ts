/**
 * 已移植设计稿内容视图的域代码集合(server 安全:纯常量,无 client 依赖)。
 * catch-all 路由据此决定渲染「设计稿域视图」还是回退「archetype ModulePage」。
 * 逐域 port 后在此追加域代码。
 */
import { findByPath } from "@/lib/nav/console-nav";
import { findModuleEntry } from "@/lib/admin/registry";
import type { DomainViewMeta } from "./domain-header";

export const PORTED_DOMAINS = new Set<string>([
  "A", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
]);

/** 按路由构建域视图页头 meta(供显式旗舰路由复用;catch-all 直接用 match 内联)。server 安全。 */
export function buildDomainViewMeta(path: string): DomainViewMeta | null {
  const m = findByPath(path);
  if (!m) return null;
  const entry = findModuleEntry(path);
  return {
    domainCode: m.domain.code,
    domainName: m.domain.name,
    accentVar: m.domain.accentVar,
    l2Id: m.l2.id,
    l2Name: m.l2.name,
    summary: entry?.summary ?? "",
    batch: m.l2.batch,
  };
}
