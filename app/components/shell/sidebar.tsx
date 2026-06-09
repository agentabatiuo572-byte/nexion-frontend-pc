"use client";

/**
 * 侧边栏 — 品牌标 + 12 域(按角色过滤)分组导航 + 折叠开关。
 * 折叠/展开、分组展开态由 ConsoleShell 经 props 下传(mounted 门控,避免 hydration 抖动)。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, LayoutDashboard } from "lucide-react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { visibleDomains, DOMAIN_COUNT, L2_COUNT } from "@/lib/nav/console-nav";
import { useAdminUi } from "@/lib/store/admin-ui";
import { SidebarGroup } from "./sidebar-group";

function LogoMark() {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-[9px] font-display"
      style={{
        width: 30,
        height: 30,
        background: "linear-gradient(135deg, var(--v5-brand) 0%, #9B89E0 130%)",
        color: "var(--v5-on-brand)",
        fontWeight: 700,
        fontSize: 16,
        boxShadow: "var(--v5-spotlight-brand)",
      }}
      aria-hidden
    >
      N
    </span>
  );
}

export function Sidebar({
  role,
  collapsed,
  expanded,
}: {
  role: AdminRole;
  collapsed: boolean;
  expanded: string[];
}) {
  const pathname = usePathname();
  const toggleGroup = useAdminUi((s) => s.toggleGroup);
  const setSidebar = useAdminUi((s) => s.setSidebar);
  const toggleSidebar = useAdminUi((s) => s.toggleSidebar);
  const domains = visibleDomains(role);

  const onCollapsedOpen = (code: string) => {
    setSidebar(false);
    if (!expanded.includes(code)) toggleGroup(code);
  };

  return (
    <aside
      className="flex h-full flex-col"
      style={{
        background: "var(--v5-surface)",
        borderRight: "1px solid var(--v5-border)",
      }}
    >
      {/* 品牌标 */}
      <Link
        href="/"
        prefetch={false}
        className="flex items-center gap-2.5 px-3.5"
        style={{ height: "var(--admin-topbar-h)", borderBottom: "1px solid var(--v5-border)" }}
      >
        <LogoMark />
        {!collapsed && (
          <>
            <span className="flex flex-col leading-tight">
              <span className="font-display text-[13.5px]" style={{ color: "var(--v5-ink)" }}>
                NEXION
              </span>
              <span className="text-[10px]" style={{ color: "var(--v5-ink-3)" }}>
                运营控制台
              </span>
            </span>
            <span className="font-mono-tabular ml-auto self-start text-[9px]" style={{ color: "var(--v5-ink-4)" }}>
              v1·console
            </span>
          </>
        )}
      </Link>

      {/* 导航(可滚动) */}
      <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? "px-2" : "px-2.5"} flex flex-col gap-0.5`}>
        {/* 运营总览 入口(首页 · 指挥台)— 标准 Dashboard 首项 */}
        {(() => {
          const homeActive = pathname === "/";
          if (collapsed) {
            return (
              <Link
                href="/"
                prefetch={false}
                title="运营总览 · 指挥台"
                aria-label="运营总览"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors hover:bg-[var(--v5-surface-2)]"
                style={{ background: homeActive ? "var(--v5-surface-2)" : "transparent" }}
              >
                <LayoutDashboard size={18} style={{ color: homeActive ? "var(--v5-brand)" : "var(--v5-ink-3)" }} />
              </Link>
            );
          }
          return (
            <Link
              href="/"
              prefetch={false}
              className="relative flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-[var(--v5-surface-2)]"
              style={{ background: homeActive ? "var(--v5-surface-2)" : "transparent" }}
            >
              {homeActive && (
                <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full" style={{ background: "var(--v5-brand)" }} />
              )}
              <LayoutDashboard size={17} style={{ color: "var(--v5-brand)" }} />
              <span className="flex-1 text-[13px]" style={{ color: homeActive ? "var(--v5-ink)" : "var(--v5-ink-2)", fontWeight: homeActive ? 600 : 400 }}>
                运营总览
              </span>
              <span className="font-mono-tabular text-[9px] uppercase tracking-wide" style={{ color: "var(--v5-brand)" }}>指挥台</span>
            </Link>
          );
        })()}
        <div className="my-1.5" style={{ height: 1, background: "var(--v5-border)" }} />
        {domains.map((d) => {
          const groupActive = d.l2.some((l2) => l2.path === pathname);
          const isOpen = !collapsed && (expanded.includes(d.code) || groupActive);
          return (
            <SidebarGroup
              key={d.code}
              domain={d}
              collapsed={collapsed}
              isOpen={isOpen}
              onToggle={collapsed ? () => onCollapsedOpen(d.code) : () => toggleGroup(d.code)}
            />
          );
        })}
      </nav>

      {/* 底部:统计 + 折叠开关 */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderTop: "1px solid var(--v5-border)" }}
      >
        {!collapsed && (
          <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>
            {DOMAIN_COUNT} 域 · {L2_COUNT} 模块
          </span>
        )}
        <button
          type="button"
          onClick={toggleSidebar}
          title={collapsed ? "展开侧栏" : "收起侧栏"}
          aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
          className={`flex h-8 items-center justify-center rounded-[8px] transition-colors hover:bg-[var(--v5-surface-2)] ${collapsed ? "mx-auto w-8" : "w-8"}`}
          style={{ color: "var(--v5-ink-3)" }}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
    </aside>
  );
}
