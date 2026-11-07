"use client";

/**
 * 顶栏 — 面包屑 + UTC 时钟 + 主题开关 + 当前登录账号菜单。
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Gauge, Headset, LogOut, Search, UserRound } from "lucide-react";
import { roleLabel, type AdminRole, type NavDomain } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Breadcrumb } from "./breadcrumb";
import { UtcClock } from "./utc-clock";
import Link from "next/link";
import { fmtPct } from "@/lib/format";
import { NotificationBell } from "./notification-bell";
import { CommandPalette } from "@/app/components/command-palette";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { displayAdminError, guardedFetch } from "@/lib/admin/error-messages";
import { useServicePendingCount } from "./use-service-badges";
import { useSupportUnreadTotal } from "@/lib/admin/support-alerts";
import { B_DASHBOARD_READ_AUTHORITIES, M_CONTENT_READ_AUTHORITIES } from "@/lib/admin/shell-authorities";
import { requestAdminLogout } from "@/lib/admin/logout-request";
import { currentAdminSession } from "@/lib/admin/auth-client";
import { supportIdentityLabel } from "@/lib/admin/session-role";
import { ThemeToggle } from "@/app/components/rd/theme-switch";
import { b0Blocks, b0HasAnyBlock } from "@/lib/admin/b0-access";
import "./topbar.css";

function RoleSwitcher({ role, operator }: { role: AdminRole; operator: string }) {
  const supportReadModes = useAdminAuth((s) => s.session?.supportReadModes);
  const supportLabel = supportIdentityLabel(role, supportReadModes);
  const identityLabel = (supportLabel && role !== "support" ? `${roleLabel(role)} · ${supportLabel}` : supportLabel) ?? roleLabel(role);
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutAttemptRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const logoutError = useAdminAuth((s) => s.logoutError);
  const beginLogout = useAdminAuth((s) => s.beginLogout);
  const cancelLogout = useAdminAuth((s) => s.cancelLogout);
  const beginLogoutVerification = useAdminAuth((s) => s.beginLogoutVerification);
  const failLogoutUnknown = useAdminAuth((s) => s.failLogoutUnknown);
  const signOut = useAdminAuth((s) => s.signOut);

  useEffect(() => {
    if (logoutError) setOpen(true);
  }, [logoutError]);

  async function handleSignOut() {
    if (logoutAttemptRef.current) return;
    logoutAttemptRef.current = true;
    setLoggingOut(true);
    beginLogout();
    try {
      await requestAdminLogout();
      signOut();
    } catch {
      beginLogoutVerification();
      try {
        const auth = await currentAdminSession();
        if (auth) cancelLogout("退出未完成，请重试");
        else {
          signOut();
        }
      } catch {
        failLogoutUnknown("退出结果暂无法确认，已停止进入后台");
      }
    } finally {
      logoutAttemptRef.current = false;
      setLoggingOut(false);
    }
  }

  return (
    <div
      className="relative"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`当前登录账号 ${operator}，打开账号菜单`}
        className="admin-topbar-account rd-top-item flex items-center gap-2 whitespace-nowrap"
      >
        <span className="admin-topbar-operator hidden sm:inline" title={operator}>
          {operator}
        </span>
        <UserRound className="admin-topbar-account-icon" size={17} aria-hidden />
        <span className="admin-topbar-account-role rd-role">{identityLabel}</span>
        <ChevronDown size={13} aria-hidden />
      </button>

      {open && (
        <>
          <div
            aria-hidden
            className="fixed inset-0 cursor-default"
            style={{ zIndex: "var(--admin-z-topbar)" }}
            onClick={() => setOpen(false)}
          />
          <div className="rd-account-menu absolute right-0 top-full mt-2 w-56 overflow-hidden" style={{ zIndex: "calc(var(--admin-z-topbar) + 1)" }}>
            <p className="rd-account-caption">当前登录账号</p>
            <div className="rd-account-who">
              <div className="whitespace-normal break-words">{operator}</div>
              <span className="rd-role">{identityLabel}</span>
            </div>
            <button type="button" onClick={handleSignOut} disabled={loggingOut} className="rd-account-action">
              <LogOut size={14} aria-hidden />
              {loggingOut ? "正在退出登录…" : "退出登录"}
            </button>
            {logoutError && (
              <p className="rd-account-error" role="alert">
                {logoutError}；你仍处于登录状态。
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// 常驻兑付覆盖率(设计稿 topbar coverage pill)— 任何页都可见的平台健康度,点击进双账本。
function CoveragePill({ enabled }: { enabled: boolean }) {
  const bDomain = useBDomainDashboard(enabled);
  const cov = bDomain.ledger.coverageRatio;
  const redline = bDomain.ledger.redlinePct;
  const healthy = bDomain.ledger.healthyPct;
  const unavailable = !bDomain.hasData || !!bDomain.error;
  // 读不到不等于危险（VS-107）：没有数时不上状态色。
  const zone = unavailable
    ? "done"
    : cov < redline
      ? "danger"
      : cov < healthy
        ? "warn"
        : "ok";
  const label = unavailable ? "—" : fmtPct(cov);
  const statusLabel = bDomain.loading && !bDomain.hasData ? "正在读取" : unavailable ? "暂不可用" : label;
  return (
    <Link
      href="/overview/dual-ledger"
      prefetch={false}
      title={unavailable ? "兑付覆盖率暂不可用，点击查看资金总览" : "兑付覆盖率 = 可用储备 ÷ 应付款，点击查看资金总览"}
      aria-label={`兑付覆盖率：${statusLabel}，查看资金与应付款`}
      className="admin-topbar-coverage rd-top-item inline-flex shrink-0 items-center gap-2 whitespace-nowrap"
      data-tone={zone}
      data-zone={zone}
    >
      <span className="admin-topbar-coverage-label hidden xl:inline">兑付覆盖率</span>
      <Gauge className="admin-topbar-coverage-icon" size={17} aria-hidden />
      <span className="admin-topbar-coverage-value font-mono-tabular">{label}</span>
    </Link>
  );
}

// 全局命令面板触发器(设计稿顶栏签名元素)。点击或 ⌘K/Ctrl+K 打开 shadcn(cmdk)命令面板,
// 跳转到任意运营模块(消费 IA 统一来源 visibleDomains)。真实可再接 A4 事件流 / userId 检索。
function SearchBox({ domains, showHome }: { domains: NavDomain[]; showHome: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开查找功能页面"
        aria-keyshortcuts="Meta+K Control+K"
        className="admin-topbar-search rd-top-item inline-flex shrink-0 items-center gap-2 text-left"
      >
        <Search size={15} aria-hidden />
        <span className="admin-topbar-search-label min-w-0 flex-1 truncate">
          搜索功能页面…
        </span>
        <kbd className="admin-topbar-search-shortcut font-mono-tabular">⌘K</kbd>
      </button>
      <CommandPalette domains={domains} showHome={showHome} open={open} onOpenChange={setOpen} />
    </>
  );
}

// 客服中心快捷入口（M-24）：未读消息数进会话台，待办客户数进工作台，两个数字分开显示。
// 未读来自客服页已加载的会话（不在客服页时不显示）；待办来自 M1 TODO 分页的服务端 total，按客户去重。
function SupportInboxPill({ pending }: { pending: number }) {
  const unread = useSupportUnreadTotal();
  return (
    <span className="admin-topbar-support rd-top-item relative inline-flex items-center gap-2">
      <Link href="/service/sessions" prefetch={false} title="专属会话 · 未读消息" aria-label={unread > 0 ? `专属会话，${unread} 条未读` : "专属会话"} className="rd-top-link inline-flex items-center gap-1.5">
        <Headset size={14} aria-hidden />
        <span className="hidden md:inline">客服</span>
        {unread > 0 && <span className="admin-topbar-support-count rd-top-count font-mono-tabular inline-flex items-center justify-center">{unread}</span>}
      </Link>
      {pending > 0 && (
        <Link href="/service/overview" prefetch={false} title="待办客户：待回复、待首次联系、待维护" aria-label={`${pending} 位待办客户`} className="rd-top-link hidden md:inline-flex items-center gap-1">
          待办 <span className="rd-top-count font-mono-tabular">{pending}</span>
        </Link>
      )}
    </span>
  );
}

export function TopBar({
  role,
  operator,
  domains,
  authorities,
  servicePending,
}: {
  role: AdminRole;
  operator: string;
  domains: NavDomain[];
  authorities: string[];
  servicePending: number;
}) {
  const supportOnly = role === "support";
  const adminId = useAdminAuth((s) => s.session?.adminId);
  const canReadBDomain = B_DASHBOARD_READ_AUTHORITIES.every((authority) => authorities.includes(authority));
  const canReadMContent = M_CONTENT_READ_AUTHORITIES.every((authority) => authorities.includes(authority));
  return (
    <header
      className="admin-topbar rd-top flex items-center justify-between gap-4 px-3 sm:px-5"
      style={{ height: "var(--admin-topbar-h)" }}
    >
      <div className="admin-topbar-location flex min-w-0 flex-1 items-center gap-4">
        <Breadcrumb />
        <SearchBox domains={domains} showHome={b0HasAnyBlock(b0Blocks(authorities))} />
      </div>
      <div className="admin-topbar-actions flex shrink-0 items-center gap-2 whitespace-nowrap">
        {!supportOnly && canReadBDomain && <CoveragePill enabled />}
        <span className="admin-topbar-clock hidden xl:block"><UtcClock /></span>
        <ThemeToggle adminId={adminId} />
        {canReadMContent && <SupportInboxPill pending={servicePending} />}
        {!supportOnly && <NotificationBell />}
        <RoleSwitcher role={role} operator={operator} />
      </div>
    </header>
  );
}
