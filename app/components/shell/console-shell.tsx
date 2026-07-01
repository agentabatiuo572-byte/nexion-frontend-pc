"use client";

/**
 * ConsoleShell — 后台框架外壳(唯一 client 边界)。
 * CSS Grid:[侧栏跨两行 | 顶栏 / 主区]。主区独立滚动。
 *
 * mounted 门控:persist 在浏览器同步 rehydrate,首帧若直接读持久值会与 SSR 默认不一致
 * → hydration error。故 mount 前一律用 SSR 安全默认(superadmin / 展开 / B 组开),
 * mount 后再切到持久值,grid 宽度 200ms 过渡吸收视觉变化。
 */
import { useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useAdminUi } from "@/lib/store/admin-ui";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { PageTransition } from "./page-transition";
import { LoginGate } from "./login-gate";

const LOCAL_PREVIEW = process.env.NEXT_PUBLIC_ADMIN_AUTH_BYPASS === "1";

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const isAuthenticated = useAdminAuth((s) => s.isAuthenticated);
  const authRole = useAdminAuth((s) => s.role);
  const operatorRaw = useAdminAuth((s) => s.operator);
  const collapsedRaw = useAdminUi((s) => s.sidebarCollapsed);
  const expandedRaw = useAdminUi((s) => s.expandedGroups);

  const role = LOCAL_PREVIEW ? "superadmin" : mounted ? authRole : "superadmin";
  const operator = LOCAL_PREVIEW ? "本地预览" : mounted ? operatorRaw : "总管理员";
  const collapsed = mounted ? collapsedRaw : false;
  const effectiveCollapsed = narrow ? true : collapsed;
  const expanded = mounted ? expandedRaw : ["B"];

  if (!LOCAL_PREVIEW && !mounted) return <LoginGate />;

  if (!LOCAL_PREVIEW && !isAuthenticated) return <LoginGate />;

  return (
    <div
      className="grid h-screen w-screen overflow-hidden"
      style={{
        gridTemplateColumns: `${
          effectiveCollapsed ? "var(--admin-sidebar-w-collapsed)" : "var(--admin-sidebar-w)"
        } 1fr`,
        gridTemplateRows: "var(--admin-topbar-h) 1fr",
        background: "var(--v5-bg)",
        transition: "grid-template-columns 200ms ease",
      }}
    >
      <div style={{ gridColumn: 1, gridRow: "1 / span 2", minWidth: 0 }}>
        <Sidebar role={role} collapsed={effectiveCollapsed} expanded={expanded} />
      </div>
      <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0 }}>
        <TopBar role={role} operator={operator} />
      </div>
      <main
        style={{
          gridColumn: 2,
          gridRow: 2,
          minWidth: 0,
          overflowY: "auto",
          padding: "var(--admin-gutter)",
        }}
      >
        <div className="content-shell">
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
