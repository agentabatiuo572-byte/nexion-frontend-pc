"use client";

/**
 * 面包屑 — usePathname() → nav 查表 → 「运营控制台 / 域 / L2」。
 * 根路径 / 显示「总览驾驶舱」。未匹配路径回退展示原始 segment。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { findByPath } from "@/lib/nav/console-nav";

export function Breadcrumb() {
  const pathname = usePathname();
  const crumbs: { label: string; accent?: string }[] = [{ label: "运营控制台" }];

  if (pathname === "/" || pathname === "") {
    crumbs.push({ label: "总览驾驶舱" });
  } else {
    const match = findByPath(pathname);
    if (match) {
      crumbs.push({ label: `${match.domain.code} ${match.domain.name}`, accent: `var(${match.domain.accentVar})` });
      crumbs.push({ label: `${match.l2.id} ${match.l2.name}` });
    } else {
      // L3 详情:用父路径(去末段)匹配 L2,末段作详情面包屑
      const parts = pathname.split("/").filter(Boolean);
      const parent = findByPath("/" + parts.slice(0, -1).join("/"));
      if (parent) {
        crumbs.push({ label: `${parent.domain.code} ${parent.domain.name}`, accent: `var(${parent.domain.accentVar})` });
        crumbs.push({ label: parent.l2.name });
        crumbs.push({ label: decodeURIComponent(parts[parts.length - 1]) });
      } else {
        parts.forEach((seg) => crumbs.push({ label: decodeURIComponent(seg) }));
      }
    }
  }

  return (
    <nav aria-label="面包屑" className="flex items-center gap-1.5 text-[12.5px]">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRight size={13} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
            )}
            {c.accent && (
              <span
                className="inline-block rounded-full"
                style={{ width: 6, height: 6, background: c.accent }}
              />
            )}
            {i === 0 ? (
              <Link
                href="/"
                prefetch={false}
                className="transition-colors hover:opacity-80"
                style={{ color: last ? "var(--v5-ink)" : "var(--v5-ink-3)", fontWeight: last ? 600 : 400 }}
              >
                {c.label}
              </Link>
            ) : (
              <span style={{ color: last ? "var(--v5-ink)" : "var(--v5-ink-3)", fontWeight: last ? 600 : 400 }}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
