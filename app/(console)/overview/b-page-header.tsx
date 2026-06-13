/**
 * BPageHeader — 域 B(总览驾驶舱)B2-B5 共享页头。
 * 域标 pill + 模块编号 + 标题 + 说明 + 可选控制入口(controlLink)。
 * 不含设计稿的 B1-B5 分段导航(由 console 外壳承载)与 server-canonical pill
 * (由全局顶栏 SyncChip 承载),避免与外壳重复。样式见 ./b-domain.css(.bpage 作用域)。
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

export function BPageHeader({
  id,
  title,
  desc,
  ctaLabel,
  ctaHref,
}: {
  id: string;
  title: string;
  desc: ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <header>
      <div className="b-bar">
        <span className="b-pill">
          <span className="dot green pulse" /> 域 B · 总览驾驶舱
        </span>
        <span className="b-tag">{id}</span>
      </div>
      <div className="b-titlerow">
        <div className="b-titlemain">
          <h1 className="b-title">{title}</h1>
          <p className="b-desc">{desc}</p>
        </div>
        {ctaLabel && ctaHref && (
          <Link href={ctaHref} prefetch={false} className="b-cta">
            {ctaLabel} <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
    </header>
  );
}
