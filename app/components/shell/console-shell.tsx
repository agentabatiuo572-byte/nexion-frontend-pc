"use client";

/**
 * ConsoleShell — 后台框架外壳(唯一 client 边界)。
 * CSS Grid:[侧栏跨两行 | 顶栏 / 主区]。主区独立滚动。
 *
 * mounted 门控:后台权限不从 localStorage 恢复,每次挂载先向服务端 session 端点校验。
 * mount 前只渲染登录壳,避免用客户端默认角色渲染后台内容。
 */
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { currentAdminSession } from "@/lib/admin/auth-client";
import { canAccessResolvedPath, resolveVisibleDomains, type NavDomain } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { DEFAULT_EXPANDED_GROUPS, useAdminUi } from "@/lib/store/admin-ui";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { PageTransition } from "./page-transition";
import { LoginGate } from "./login-gate";

const SUPPORT_HOME_PATH = "/service/overview";

function defaultPathForDomains(domains: NavDomain[]) {
  return domains[0]?.l2[0]?.path ?? "/";
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [restoreChecked, setRestoreChecked] = useState(false);
  useEffect(() => setMounted(true), []);
  const pathname = usePathname();
  const router = useRouter();

  const isAuthenticated = useAdminAuth((s) => s.isAuthenticated);
  const authRole = useAdminAuth((s) => s.role);
  const session = useAdminAuth((s) => s.session);
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
  const expanded = mounted ? expandedRaw : DEFAULT_EXPANDED_GROUPS;
  const domains = useMemo(() => resolveVisibleDomains({
    role,
    menuCodes: session?.menuCodes,
    authorities: session?.authorities ?? [],
  }), [role, session?.authorities, session?.menuCodes]);
  const shouldRedirectHome = role === "support" && pathname === "/";
  const shouldRedirectForbidden = !canAccessResolvedPath(domains, pathname);
  const redirecting = isAuthenticated && (shouldRedirectHome || shouldRedirectForbidden);

  useEffect(() => {
    if (!mounted || !isAuthenticated) return;
    if (shouldRedirectHome) {
      router.replace(SUPPORT_HOME_PATH);
      return;
    }
    if (shouldRedirectForbidden) {
      router.replace(defaultPathForDomains(domains));
    }
  }, [
    isAuthenticated,
    mounted,
    domains,
    router,
    shouldRedirectForbidden,
    shouldRedirectHome,
  ]);

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
        <Sidebar role={role} domains={domains} collapsed={collapsed} expanded={expanded} />
      </div>
      <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0 }}>
        <TopBar role={role} operator={operator} domains={domains} />
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
          <PageTransition>{redirecting ? null : children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
