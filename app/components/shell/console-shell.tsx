"use client";

/**
 * ConsoleShell — 后台框架外壳(唯一 client 边界)。
 * CSS Grid:[侧栏跨两行 | 顶栏 / 主区]。主区独立滚动。
 *
 * mounted 门控:后台权限不从 localStorage 恢复,每次挂载先向服务端 session 端点校验。
 * mount 前只渲染登录壳,避免用客户端默认角色渲染后台内容。
 */
import { useEffect, useState } from "react";
import { currentAdminSession } from "@/lib/admin/auth-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useAdminUi } from "@/lib/store/admin-ui";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { PageTransition } from "./page-transition";
import { LoginGate } from "./login-gate";

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [restoreChecked, setRestoreChecked] = useState(false);
  useEffect(() => setMounted(true), []);

  const isAuthenticated = useAdminAuth((s) => s.isAuthenticated);
  const authRole = useAdminAuth((s) => s.role);
  const operatorRaw = useAdminAuth((s) => s.operator);
  const signIn = useAdminAuth((s) => s.signIn);
  const signOut = useAdminAuth((s) => s.signOut);
  const collapsedRaw = useAdminUi((s) => s.sidebarCollapsed);
  const expandedRaw = useAdminUi((s) => s.expandedGroups);

  useEffect(() => {
    if (!mounted) return;
    let cancelled = false;
    window.localStorage.removeItem("nexion-admin-auth-v2");
    // 清理退役的本地业务态;平台配置、券、奖励、审计不得从浏览器持久层恢复。
    window.localStorage.removeItem("nexion-admin-platform-v1");
    currentAdminSession()
      .then((auth) => {
        if (cancelled) return;
        if (auth) {
          signIn(auth);
        } else {
          signOut();
        }
      })
      .catch(() => {
        if (!cancelled) signOut();
      })
      .finally(() => {
        if (!cancelled) setRestoreChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [mounted, signIn, signOut]);

  const role = mounted ? authRole : "auditor";
  const operator = mounted ? operatorRaw : "总管理员";
  const collapsed = mounted ? collapsedRaw : false;
  const expanded = mounted ? expandedRaw : ["B"];

  if (!mounted) return <LoginGate />;

  if (!isAuthenticated && restoreChecked) return <LoginGate />;
  if (!isAuthenticated) return <LoginGate />;

  return (
    <div
      className="grid h-screen w-screen overflow-hidden"
      style={{
        gridTemplateColumns: `${
          collapsed ? "var(--admin-sidebar-w-collapsed)" : "var(--admin-sidebar-w)"
        } 1fr`,
        gridTemplateRows: "var(--admin-topbar-h) 1fr",
        background: "var(--v5-bg)",
        transition: "grid-template-columns 200ms ease",
      }}
    >
      <div style={{ gridColumn: 1, gridRow: "1 / span 2", minWidth: 0 }}>
        <Sidebar role={role} collapsed={collapsed} expanded={expanded} />
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
