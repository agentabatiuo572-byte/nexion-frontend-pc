"use client";

/**
 * 面包屑 — usePathname() → nav 查表 → 「UVEL 运营控制台 / 域 / L2」。
 * 根路径 / 显示「今日概览」。未匹配路径回退展示原始 segment。域字母和页面编号不显示(DP-30)。
 */
import { useLayoutEffect, useRef } from "react";
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

  // 中间段放不下时，先把顶栏搜索收成图标给面包屑让地方（data-crumb-room，和 1280 以下搜索的样子一样）；还放不下才整组收起中间段（data-compact），
  // 不截成半截，和窄宽时四段面包屑的做法一样；首段和末段写全（PG-10、BUG-643、BUG-773：1440 宽超管多一个客服入口时三级照样写全）。
  // 每次先放开再量，宽了能重新显示；顶栏右边的项变宽、字体加载完都会改可用宽度，所以跟着导航自己的宽度重量。
  const navRef = useRef<HTMLElement>(null);
  const labels = crumbs.map((crumb) => crumb.label).join("\n");
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const bar = nav.closest<HTMLElement>(".admin-topbar");
    const cut = () => [...nav.querySelectorAll<HTMLElement>(".admin-topbar-crumb-ancestor:not(:first-child) > .admin-topbar-crumb-label")]
      .some((label) => label.scrollWidth > label.clientWidth + 1);
    const fit = () => {
      nav.removeAttribute("data-compact");
      bar?.removeAttribute("data-crumb-room");
      if (!cut()) return;
      bar?.setAttribute("data-crumb-room", "");
      if (!cut()) return;
      // 搜索收成图标也放不下：搜索照常写全，只收中间段。
      bar?.removeAttribute("data-crumb-room");
      nav.setAttribute("data-compact", "");
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(nav);
    void document.fonts?.ready.then(fit);
    return () => { observer.disconnect(); bar?.removeAttribute("data-crumb-room"); };
  }, [labels]);

  return (
    <nav ref={navRef} aria-label="面包屑" className="admin-topbar-breadcrumb flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className={`admin-topbar-crumb ${last ? "admin-topbar-crumb-current flex min-w-0" : "admin-topbar-crumb-ancestor hidden min-w-0 xl:flex"} items-center gap-1.5`} style={last ? { maxWidth: "18em" } : undefined}>
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
