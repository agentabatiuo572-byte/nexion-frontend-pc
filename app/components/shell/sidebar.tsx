"use client";

/**
 * 侧边栏 — 品牌标 + 指挥台 + 授权域分组导航 + 计数和折叠开关。
 * 折叠/展开、分组展开态由 ConsoleShell 经 props 下传(mounted 门控,避免 hydration 抖动)。
 */
import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, LayoutGrid } from "lucide-react";
import type { AdminRole, NavDomain } from "@/lib/nav/console-nav";
import { useAdminUi } from "@/lib/store/admin-ui";
import { IconTile } from "@/app/components/rd/icon-tile";
import { SidebarGroup } from "./sidebar-group";

function LogoMark() {
  return (
    <>
      <span className="uvel-logo-mark rd-logo-dark" aria-hidden>
        <Image src="/uvel-mark-dark.png" width={30} height={30} alt="" />
      </span>
      <span className="uvel-logo-mark rd-logo-symbol" aria-hidden>
        <Image src="/uvel-symbol.png" width={30} height={22} alt="" />
      </span>
    </>
  );
}

export function Sidebar({
  role,
  domains,
  collapsed,
  expanded,
  servicePending,
  mobile = false,
  onMobileOpenChange,
}: {
  role: AdminRole;
  domains: NavDomain[];
  collapsed: boolean;
  expanded: string[];
  servicePending: number;
  mobile?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // 用户主动滚动(wheel/touch)时记录 nav scrollTop;Next.js 导航 scroll-to-top 是 programmatic,
  // 不走 onWheel,故不会被覆盖。pathname 变后双 rAF 等 Next.js 滚完再恢复,避免点后排菜单后侧栏跳回顶。
  const persistSidebarScroll = () => {
    const nav = navRef.current;
    if (nav) {
      try {
        sessionStorage.setItem("nexion-sidebar-scroll", String(nav.scrollTop));
      } catch {
        // sessionStorage 不可用时静默降级(无持久化,但不报错)
      }
    }
  };
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let saved = 0;
    try {
      saved = Number(sessionStorage.getItem("nexion-sidebar-scroll") ?? 0);
    } catch {
      saved = 0;
    }
    if (!(saved > 0)) return;
    // Next.js 导航的 scroll-to-top 时机不确定(commit 后异步,常晚于 rAF),
    // 用 scroll 事件捕获 + 定时兜底:一旦检测到 nav 被滚到顶(0),立即恢复用户上次位置,只恢复一次。
    let restored = false;
    const apply = () => {
      if (restored || !navRef.current || navRef.current.scrollTop !== 0) return;
      navRef.current.scrollTop = saved;
      restored = true;
      navRef.current.removeEventListener("scroll", onScroll);
    };
    const onScroll = () => apply();
    apply();
    nav.addEventListener("scroll", onScroll, { passive: true });
    const t1 = setTimeout(onScroll, 60);
    const t2 = setTimeout(onScroll, 200);
    return () => {
      nav.removeEventListener("scroll", onScroll);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [pathname]);
  const toggleGroup = useAdminUi((s) => s.toggleGroup);
  const setExpanded = useAdminUi((s) => s.setExpanded);
  const setSidebar = useAdminUi((s) => s.setSidebar);
  const toggleSidebar = useAdminUi((s) => s.toggleSidebar);
  const visibleL2Count = domains.reduce((total, domain) => total + domain.l2.length, 0);
  const showHomeEntry = role !== "support";
  const badges: Record<string, number> = servicePending > 0 ? { "/service/sessions": servicePending } : {};

  const onCollapsedOpen = (code: string) => {
    if (mobile) { onMobileOpenChange?.(true); setExpanded([code]); return; }
    setSidebar(false);
    setExpanded([code]);
  };

  return (
    <aside className="rd-side flex h-full flex-col">
      {/* 品牌标 */}
      <Link
        href="/"
        prefetch={false}
        onClick={() => setExpanded([])}
        aria-label="UVEL 运营控制台"
        className="rd-side-brand"
      >
        <LogoMark />
        {!collapsed && (
          <>
            <Image className="rd-logo-lockup" src="/uvel-lockup-on-light.png" width={86} height={30} alt="" aria-hidden />
            <span className="flex flex-col leading-tight">
              <span className="font-display rd-side-name">UVEL</span>
              <span className="text-[10px] rd-side-role">运营控制台</span>
            </span>
          </>
        )}
      </Link>

      {/* 导航(可滚动) */}
      <nav
        ref={navRef}
        onWheel={persistSidebarScroll}
        onTouchMove={persistSidebarScroll}
        className={`rd-side-nav flex-1 overflow-y-auto ${collapsed ? "px-2" : "px-2.5"} flex flex-col gap-0.5`}
      >
        {/* 指挥台入口(首页) */}
        {showHomeEntry && (() => {
          const homeActive = pathname === "/";
          if (collapsed) {
            return (
              <Link
                href="/"
                prefetch={false}
                onClick={() => setExpanded([])}
                title="指挥台"
                aria-label="指挥台"
                className="rd-nav-rail"
                data-active={homeActive ? "" : undefined}
              >
                <IconTile tone="system" icon={LayoutGrid} size={22} />
              </Link>
            );
          }
          return (
            <Link
              href="/"
              prefetch={false}
              onClick={() => setExpanded([])}
              className="rd-nav-item"
              aria-current={homeActive ? "page" : undefined}
              data-active={homeActive ? "" : undefined}
            >
              <IconTile tone="system" icon={LayoutGrid} size={22} />
              <span className="flex-1">指挥台</span>
              {homeActive && <span className="rd-nav-dot" data-current="" aria-hidden />}
            </Link>
          );
        })()}
        {domains.map((d) => {
          const isOpen = !collapsed && expanded[0] === d.code;
          return (
            <SidebarGroup
              key={d.code}
              domain={d}
              collapsed={collapsed}
              isOpen={isOpen}
              badges={badges}
              onToggle={collapsed ? () => onCollapsedOpen(d.code) : () => toggleGroup(d.code)}
            />
          );
        })}
      </nav>

      {/* 底部:统计 + 折叠开关 */}
      <div className="rd-side-foot">
        {!collapsed && (
          <span className="font-mono-tabular rd-side-count">
            {domains.length} 个模块 · {visibleL2Count} 个页面
          </span>
        )}
        <button
          type="button"
          onClick={mobile ? () => onMobileOpenChange?.(collapsed) : toggleSidebar}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          className={`rd-iconbtn ${collapsed ? "mx-auto" : ""}`}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
}
