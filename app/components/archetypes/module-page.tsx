"use client";

/**
 * ModulePage — 注册表驱动的真实模块页统一外壳。catch-all(server)按 path 命中注册表后渲染本壳。
 * 共享页头(域 chip + 模块码 + 标题 + 口径副标 + 状态) + 按 content.kind 切 archetype。
 * props 全部可序列化(server→client 安全;不传 LucideIcon)。
 */
import type { ModuleContent } from "@/lib/admin/module-content";
import { DomainHeader } from "@/app/components/domain-views/domain-header";
import { ListArchetype } from "./list-archetype";
import { ConfigArchetype } from "./config-archetype";
import { DashboardArchetype } from "./dashboard-archetype";

export interface ModuleMeta {
  domainCode: string;
  domainName: string;
  accentVar: string;
  l2Id: string;
  l2Name: string;
  batch: string;
}

export function ModulePage({ meta, summary, content }: { meta: ModuleMeta; summary: string; content: ModuleContent }) {
  const accent = `var(${meta.accentVar})`;
  return (
    <div className="w-full">
      <DomainHeader
        domainCode={meta.domainCode}
        domainName={meta.domainName}
        accentVar={meta.accentVar}
        l2Id={meta.l2Id}
        l2Name={meta.l2Name}
        summary={summary}
        batch={meta.batch}
      />

      {content.kind === "list" && <ListArchetype spec={content} accent={accent} />}
      {content.kind === "config" && <ConfigArchetype spec={content} accent={accent} />}
      {content.kind === "dashboard" && <DashboardArchetype spec={content} accent={accent} />}
    </div>
  );
}
