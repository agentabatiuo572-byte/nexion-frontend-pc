"use client";

/**
 * DomainHeader — 旧页面的页头入口,外观走 rd/PageHeader(CP-22)。
 * 域标签和模块编号不再显示,域名只留在面包屑(DP-30)。对外用法不变,页面文件不用改。
 */
import type { ReactNode } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { PageHeader } from "@/app/components/rd/page-header";

/** 路由 → 域视图的页头元信息(catch-all/旗舰路由按命中模块提供)。 */
export interface DomainViewMeta {
  domainCode: string;
  domainName: string;
  accentVar: string;
  l2Id: string;
  l2Name: string;
  summary: string;
  batch: string;
}

export function DomainHeader({
  l2Id,
  l2Name,
  summary,
  right,
  back,
}: {
  domainCode: string;
  domainName: string;
  accentVar: string;
  l2Id: string;
  l2Name: string;
  summary: string;
  batch?: string;
  right?: ReactNode;
  /** A return link shown above the title (e.g. M3 opened from the M1 customer list). */
  back?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <PageHeader title={l2Name} pageId={l2Id} summary={summary ? <AutoGloss>{summary}</AutoGloss> : undefined} actions={right} back={back} />
    </div>
  );
}
