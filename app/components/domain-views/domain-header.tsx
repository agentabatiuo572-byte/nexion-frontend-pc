"use client";

/**
 * DomainHeader — 全站统一页头(与 B 域 ModulePage 表头完全一致)。
 * 彩色「域 X · 域名」chip + 淡灰模块编号 + 标题(模块名)+ 口径副标 + 右侧运营操作位(right)。
 * B 域(ModulePage)与 11 个设计视图共用本组件,保证表头样式一致。
 */
import type { ReactNode } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";

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
  domainCode,
  domainName,
  accentVar,
  l2Id,
  l2Name,
  summary,
  batch = "V1",
  right,
}: {
  domainCode: string;
  domainName: string;
  accentVar: string;
  l2Id: string;
  l2Name: string;
  summary: string;
  batch?: string;
  right?: ReactNode;
}) {
  const accent = `var(${accentVar})`;
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)` }}
          >
            <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: accent }} />
            域 {domainCode} · {domainName}
          </span>
          <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>{l2Id}</span>
        </div>
        <h1 className="font-display mt-2 text-[24px]" style={{ color: "var(--v5-ink)" }}>{l2Name}</h1>
        {summary && <p className="mt-1.5 max-w-[760px] text-[13px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{summary}</AutoGloss></p>}
      </div>
      {right && <div className="flex items-center gap-2 self-end">{right}</div>}
    </header>
  );
}
