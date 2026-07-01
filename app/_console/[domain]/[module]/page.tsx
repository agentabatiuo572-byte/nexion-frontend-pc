/**
 * 动态 catch-all — 覆盖全部非旗舰 L2(零手写每页)。
 * 命中注册表 → ModulePage(archetype 真实页);未命中 → ScaffoldPage(规格就绪占位)。
 * 🔴 Next 16:params 是 Promise,必须 await。显式旗舰路由(文件夹)优先于本动态段。
 */
import { notFound } from "next/navigation";
import { findBySlugs } from "@/lib/nav/console-nav";
import { findModuleEntry } from "@/lib/admin/registry";
import { ModulePage } from "@/app/components/archetypes/module-page";
import { ScaffoldPage } from "@/app/components/scaffold/scaffold-page";
import { PORTED_DOMAINS } from "@/app/components/domain-views/ported";
import { DomainViewSwitch } from "@/app/components/domain-views/registry";

export default async function CatchAllScaffold({
  params,
}: {
  params: Promise<{ domain: string; module: string }>;
}) {
  const { domain, module: moduleSlug } = await params;
  const match = findBySlugs(domain, moduleSlug);
  if (!match) notFound();

  const entry = findModuleEntry(match.l2.path);

  // 已 port 设计稿内容视图的域 → 渲染域整页(与 B 域同款 DomainHeader + 富内容);导航栏不变。
  if (PORTED_DOMAINS.has(match.domain.code)) {
    return (
      <DomainViewSwitch
        code={match.domain.code}
        meta={{
          domainCode: match.domain.code,
          domainName: match.domain.name,
          accentVar: match.domain.accentVar,
          l2Id: match.l2.id,
          l2Name: match.l2.name,
          summary: entry?.summary ?? "",
          batch: match.l2.batch,
        }}
      />
    );
  }

  if (entry) {
    return (
      <ModulePage
        meta={{
          domainCode: match.domain.code,
          domainName: match.domain.name,
          accentVar: match.domain.accentVar,
          l2Id: match.l2.id,
          l2Name: match.l2.name,
          batch: match.l2.batch,
        }}
        summary={entry.summary}
        content={entry.content}
      />
    );
  }

  return <ScaffoldPage domain={match.domain} l2={match.l2} />;
}
