"use client";

/**
 * 面包屑 — usePathname() → nav 查表 → 「UVEL 运营控制台 / 域 / L2」。
 * 根路径 / 显示「今日概览」。未匹配路径回退展示原始 segment。域字母和页面编号不显示(DP-30)。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { findByPath } from "@/lib/nav/console-nav";

export function Breadcrumb() {
  const pathname = usePathname() ?? "";
  const crumbs: { label: string }[] = [{ label: "UVEL 运营控制台" }];

  if (pathname === "/" || pathname === "") {
    crumbs.push({ label: "今日概览" });
  } else if (/^\/service\/customers\/[1-9]\d*\/?$/.test(pathname)) {
    const parent = findByPath("/service/overview");
    if (parent) crumbs.push({ label: parent.domain.name });
    crumbs.push({ label: "完整客户档案" });
  } else {
    const match = findByPath(pathname);
    if (match) {
      crumbs.push({ label: match.domain.name });
      crumbs.push({ label: match.l2.name });
    } else {
      // L3 详情:用父路径(去末段)匹配 L2,末段作详情面包屑
      const parts = pathname.split("/").filter(Boolean);
      const parent = findByPath("/" + parts.slice(0, -1).join("/"));
      if (parent) {
        crumbs.push({ label: parent.domain.name });
        crumbs.push({ label: parent.l2.name });
        crumbs.push({ label: decodeURIComponent(parts[parts.length - 1]) });
      } else {
        parts.forEach((seg) => crumbs.push({ label: decodeURIComponent(seg) }));
      }
    }
  }

  return (
    <nav aria-label="面包屑" className="admin-topbar-breadcrumb flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className={`admin-topbar-crumb ${last ? "admin-topbar-crumb-current flex shrink-0 min-w-0" : "admin-topbar-crumb-ancestor hidden min-w-0 xl:flex"} items-center gap-1.5`} style={last ? { maxWidth: "18em" } : undefined}>
            {i > 0 && (
              <ChevronRight size={13} className="shrink-0" style={{ color: "var(--rd-text-3)" }} aria-hidden />
            )}
            {i === 0 ? (
              <Link
                href="/"
                prefetch={false}
                className="admin-topbar-crumb-label rd-crumb truncate"
                title={c.label}
                data-current={last ? "" : undefined}
              >
                {c.label}
              </Link>
            ) : (
              <span className="admin-topbar-crumb-label rd-crumb truncate" title={c.label} aria-current={last ? "page" : undefined} data-current={last ? "" : undefined}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
