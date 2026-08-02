"use client";

/**
 * ConsoleShell — 后台框架外壳(唯一 client 边界)。
 * CSS Grid:[侧栏跨两行 | 顶栏 / 主区]。主区独立滚动。
 *
 * mounted 门控:后台权限不从 localStorage 恢复,每次挂载先向服务端 session 端点校验。
 * 服务端会话确认前只渲染校验壳,避免登录框或默认角色后台闪现。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { currentAdminSession } from "@/lib/admin/auth-client";
import { fetchA3RuntimeFlags } from "@/lib/admin/a3-client";
import { installAdminAuthFetchLifecycle } from "@/lib/admin/auth-lifecycle";
import { adminShellSessionKey, M_CONTENT_READ_AUTHORITIES } from "@/lib/admin/shell-authorities";
import { canAccessResolvedPath, resolveVisibleDomains, type NavDomain } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { DEFAULT_EXPANDED_GROUPS, useAdminUi } from "@/lib/store/admin-ui";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { PageTransition } from "./page-transition";
import { LoginGate } from "./login-gate";
import { useServicePendingCount } from "./use-service-badges";

const SUPPORT_HOME_PATH = "/service/overview";
const SESSION_REFRESH_MS = 60_000;
type AdminBootstrapState = "checking" | "authenticated" | "anonymous" | "error";

installAdminAuthFetchLifecycle();

function defaultPathForDomains(domains: NavDomain[]) {
  return domains[0]?.l2[0]?.path ?? "/";
}

function AdminLogoutGate() {
  return (
    <div
      aria-busy="true"
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: "var(--v5-bg)", color: "var(--v5-ink-3)" }}
    >
      正在安全退出…
    </div>
  );
}

function AdminRouteRedirectGate() {
  return (
    <div
      aria-busy="true"
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: "var(--v5-bg)", color: "var(--v5-ink-3)" }}
    >
      正在进入有权限的页面…
    </div>
  );
}

function AdminSessionBootstrapGate() {
  return (
    <div
      aria-busy="true"
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: "var(--v5-bg)", color: "var(--v5-ink-3)" }}
    >
      正在验证登录状态…
    </div>
  );
}

function AdminSessionRecoveryGate({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex h-screen w-screen flex-col items-center justify-center gap-4"
      style={{ background: "var(--v5-bg)", color: "var(--v5-ink-3)" }}
    >
      <strong style={{ color: "var(--v5-ink)" }}>登录状态校验失败</strong>
      <span className="text-[13px]">服务端会话暂时无法确认，已停止进入后台。</span>
      <button
        type="button"
        className="rounded-[8px] px-4 py-2 text-[13px] font-medium"
        style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
        onClick={onRetry}
      >
        重新校验
      </button>
    </div>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [bootstrapState, setBootstrapState] = useState<AdminBootstrapState>("checking");
  const [maintenanceBanner, setMaintenanceBanner] = useState(false);
  const bootstrapAttemptRef = useRef(0);
  useEffect(() => setMounted(true), []);
  const pathname = usePathname();
  const router = useRouter();

  const isAuthenticated = useAdminAuth((s) => s.isAuthenticated);
  const authRole = useAdminAuth((s) => s.role);
  const session = useAdminAuth((s) => s.session);
  const sessionResolution = useAdminAuth((s) => s.sessionResolution);
  const authEpoch = useAdminAuth((s) => s.authEpoch);
  const logoutPending = useAdminAuth((s) => s.logoutPending);
  const logoutUnknown = useAdminAuth((s) => s.logoutUnknown);
  const operatorRaw = useAdminAuth((s) => s.operator);
  const signIn = useAdminAuth((s) => s.signIn);
  const signOut = useAdminAuth((s) => s.signOut);
  const collapsedRaw = useAdminUi((s) => s.sidebarCollapsed);
  const expandedRaw = useAdminUi((s) => s.expandedGroups);
  const authorities = session?.authorities ?? [];
  const canReadA3 = authorities.includes("platform_a3_read");
  const canReadMContent = M_CONTENT_READ_AUTHORITIES.every((authority) => authorities.includes(authority));
  const servicePending = useServicePendingCount(canReadMContent);
  const sessionKey = adminShellSessionKey(session, authEpoch);
  const observedAuthEpochRef = useRef(authEpoch);

  const restoreAdminSession = useCallback(async (signal?: AbortSignal) => {
    const attempt = ++bootstrapAttemptRef.current;
    setBootstrapState("checking");
    try {
      const auth = await currentAdminSession({ signal });
      if (signal?.aborted || attempt !== bootstrapAttemptRef.current) return;
      if (auth) {
        signIn(auth);
        setBootstrapState("authenticated");
      } else {
        signOut();
        setBootstrapState("anonymous");
      }
    } catch {
      if (signal?.aborted || attempt !== bootstrapAttemptRef.current) return;
      // Do not turn transport failures or malformed 200s into an anonymous
      // session. Protected content and the login form both stay closed.
      setBootstrapState("error");
    }
  }, [signIn, signOut]);

  useEffect(() => {
    if (observedAuthEpochRef.current === authEpoch) return;
    observedAuthEpochRef.current = authEpoch;
    bootstrapAttemptRef.current += 1;
    if (sessionResolution === "anonymous") setBootstrapState("anonymous");
  }, [authEpoch, sessionResolution]);

  useEffect(() => {
    if (!mounted) return;
    const controller = new AbortController();
    window.localStorage.removeItem("nexion-admin-auth-v2");
    // 清理退役的本地业务态;平台配置、券、奖励、审计不得从浏览器持久层恢复。
    window.localStorage.removeItem("nexion-admin-platform-v1");
    void restoreAdminSession(controller.signal);
    return () => {
      controller.abort();
      bootstrapAttemptRef.current += 1;
    };
  }, [mounted, restoreAdminSession]);

  useEffect(() => {
    if (!mounted) return;
    const revalidate = () => void restoreAdminSession();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) revalidate();
    };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("popstate", revalidate);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("popstate", revalidate);
    };
  }, [mounted, restoreAdminSession]);

  // A6/A7 changes must reach an already-open console without requiring a full reload.
  // Focus refresh handles operators returning to the tab; the interval closes the long-open-tab gap.
  useEffect(() => {
    if (!mounted || bootstrapState !== "authenticated" || !isAuthenticated) return;
    let disposed = false;
    let refreshing = false;
    const refreshSession = async () => {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        const auth = await currentAdminSession();
        if (disposed) return;
        if (auth) signIn(auth);
        else {
          signOut();
          setBootstrapState("anonymous");
        }
      } catch {
        // Keep the current session on transient network errors; protected APIs remain server-authoritative.
      } finally {
        refreshing = false;
      }
    };
    const onFocus = () => void refreshSession();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => void refreshSession(), SESSION_REFRESH_MS);
    return () => {
      disposed = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [bootstrapState, isAuthenticated, mounted, signIn, signOut]);

  useEffect(() => {
    if (!mounted || bootstrapState !== "authenticated" || !isAuthenticated || !canReadA3) {
      setMaintenanceBanner(false);
      return;
    }
    let disposed = false;
    const refreshRuntimeFlags = async () => {
      try {
        const flags = await fetchA3RuntimeFlags();
        if (!disposed) setMaintenanceBanner(flags.configured && flags.maintenanceBanner);
      } catch {
        if (!disposed) setMaintenanceBanner(false);
      }
    };
    const onChanged = () => void refreshRuntimeFlags();
    void refreshRuntimeFlags();
    window.addEventListener("a3:runtime-flags-changed", onChanged);
    return () => {
      disposed = true;
      window.removeEventListener("a3:runtime-flags-changed", onChanged);
    };
  }, [bootstrapState, canReadA3, isAuthenticated, mounted]);

  const role = mounted ? authRole : "auditor";
  const operator = mounted ? operatorRaw : "总管理员";
  const collapsed = mounted ? collapsedRaw : false;
  const expanded = mounted ? expandedRaw : DEFAULT_EXPANDED_GROUPS;
  const domains = useMemo(() => resolveVisibleDomains({
    role,
    menuCodes: session?.menuCodes,
    menuNodes: session?.menuNodes,
    authorities: session?.authorities ?? [],
  }), [role, session?.authorities, session?.menuCodes, session?.menuNodes]);
  const shouldRedirectHome = role === "support" && pathname === "/";
  const shouldRedirectForbidden = !canAccessResolvedPath(domains, pathname);
  const redirecting = isAuthenticated && (shouldRedirectHome || shouldRedirectForbidden);

  useEffect(() => {
    if (!mounted || bootstrapState !== "authenticated" || !isAuthenticated) return;
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
    bootstrapState,
    domains,
    router,
    shouldRedirectForbidden,
    shouldRedirectHome,
  ]);

  if (logoutPending) return <AdminLogoutGate />;
  if (logoutUnknown) return <AdminSessionRecoveryGate onRetry={() => void restoreAdminSession()} />;
  if (sessionResolution === "anonymous") return <LoginGate onAuthenticated={() => setBootstrapState("authenticated")} />;
  if (!mounted || bootstrapState === "checking") return <AdminSessionBootstrapGate />;
  if (bootstrapState === "error") return <AdminSessionRecoveryGate onRetry={() => void restoreAdminSession()} />;
  if (bootstrapState === "anonymous") return <LoginGate onAuthenticated={() => setBootstrapState("authenticated")} />;
  if (!isAuthenticated) return <LoginGate onAuthenticated={() => setBootstrapState("authenticated")} />;
  if (redirecting) return <AdminRouteRedirectGate />;

  return (
    <div
      key={sessionKey}
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
        <Sidebar
          role={role}
          domains={domains}
          collapsed={collapsed}
          expanded={expanded}
          servicePending={servicePending}
        />
      </div>
      <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0 }}>
        <TopBar
          role={role}
          operator={operator}
          domains={domains}
          authorities={authorities}
          servicePending={servicePending}
        />
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
          {maintenanceBanner && (
            <div
              role="status"
              style={{
                marginBottom: 12,
                padding: "10px 14px",
                border: "1px solid color-mix(in srgb, var(--warning) 52%, transparent)",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--warning) 10%, var(--surface))",
                color: "var(--ink)",
                fontSize: 12.5,
              }}
            >
              <b>平台维护提示已开启</b> · 当前后台可能正在进行维护操作，请谨慎提交高风险变更。
            </div>
          )}
          <PageTransition>{children}</PageTransition>
        </div>
      </main>
    </div>
  );
}
