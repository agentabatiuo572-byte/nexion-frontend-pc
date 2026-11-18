/**
 * BPageHeader — 域 B(运营总览)B2-B5 共享页头,外观走 rd/PageHeader(CP-22)。
 * 标题 + 说明 + 可选控制入口(controlLink)。域标和模块编号不再显示(DP-30)。
 * 不含设计稿的 B1-B5 分段导航(由 console 外壳承载)与 server-canonical pill
 * (由全局顶栏 SyncChip 承载),避免与外壳重复。样式见 ./b-domain.css(.bpage 作用域)。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/app/components/rd/page-header";

export function BPageHeader({
  id,
  title,
  desc,
  ctaLabel,
  ctaHref,
  ctaAllowed = true,
}: {
  id: string;
  title: string;
  desc: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
  ctaAllowed?: boolean;
}) {
  return (
    <div className="mb-5">
      <PageHeader
        title={title}
        pageId={id}
        summary={desc}
        actions={ctaLabel && ctaHref ? (ctaAllowed ? (
          <Link href={ctaHref} prefetch={false} className="b-cta">
            {ctaLabel} <ArrowRight size={14} aria-hidden />
          </Link>
        ) : (
          <span className="b-cta" aria-disabled="true" data-testid="b-cross-domain-disabled">
            {ctaLabel} · 无权限
          </span>
        )) : undefined}
      />
    </div>
  );
}
