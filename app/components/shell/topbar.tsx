"use client";

/**
 * 顶栏 — 面包屑 + UTC 时钟 + 当前登录账号菜单。
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Gauge, Headset, LogOut, Search, UserRound } from "lucide-react";
import { roleLabel, type AdminRole, type NavDomain } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Breadcrumb } from "./breadcrumb";
import { UtcClock } from "./utc-clock";
import { RoleBadge } from "@/app/components/kit/role-badge";
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
import "./topbar.css";

function RoleSwitcher({ role, operator }: { role: AdminRole; operator: string }) {
  const supportReadModes = useAdminAuth((s) => s.session?.supportReadModes);
  const supportLabel = supportIdentityLabel(role, supportReadModes);
  const identityLabel = supportLabel && role !== "support" ? `${roleLabel(role)} · ${supportLabel}` : supportLabel;
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutAttemptRef = useRef(false);
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
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`当前登录账号 ${operator}，打开账号菜单`}
        className="admin-topbar-account flex items-center gap-2 whitespace-nowrap rounded-[9px] py-1 pl-2 pr-1.5 transition-colors hover:bg-[var(--v5-surface-2)]"
      >
        <span className="admin-topbar-operator hidden text-[12.5px] sm:inline" title={operator} style={{ color: "var(--v5-ink-2)" }}>
          {operator}
        </span>
        <UserRound className="admin-topbar-account-icon" size={17} aria-hidden />
        <span className="admin-topbar-account-role"><RoleBadge role={role} label={identityLabel} size="sm" /></span>
        <ChevronDown size={13} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="关闭菜单"
            className="fixed inset-0 cursor-default"
            style={{ zIndex: "var(--admin-z-topbar)" }}
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-[12px] py-1.5"
            style={{
              background: "var(--v5-surface)",
              border: "1px solid var(--v5-border-strong)",
              boxShadow: "var(--v5-card-shadow-lift-strong)",
              zIndex: "calc(var(--admin-z-topbar) + 1)",
            }}
          >
            <p
              className="px-3 py-1.5 text-[10.5px] uppercase tracking-[0.14em]"
              style={{ color: "var(--v5-ink-4)" }}
            >
              当前登录账号
            </p>
            <div className="px-3 py-2">
              <div className="whitespace-normal break-words text-[13px] font-medium" style={{ color: "var(--v5-ink)" }}>
                {operator}
              </div>
              <div className="mt-1">
                <RoleBadge role={role} label={identityLabel} size="sm" />
              </div>
            </div>
            <div className="my-1 h-px" style={{ background: "var(--v5-border)" }} />
            <button
              type="button"
              onClick={handleSignOut}
              disabled={loggingOut}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]"
              style={{ color: "var(--v5-ink-3)" }}
            >
              <LogOut size={13} />
              {loggingOut ? "正在退出登录…" : "退出登录"}
            </button>
            {logoutError && (
              <p className="px-3 py-1.5 text-[11px]" role="alert" style={{ color: "var(--v5-danger)" }}>
                {logoutError}；当前登录凭据已保留。
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
  const zoneVar = unavailable
    ? bDomain.error
      ? "var(--v5-danger)"
      : "var(--v5-warning)"
    : cov < redline
      ? "var(--v5-danger)"
      : cov < healthy
        ? "var(--v5-warning)"
        : "var(--v5-success)";
  const label = unavailable ? "-" : fmtPct(cov);
  const statusLabel = bDomain.loading && !bDomain.hasData ? "正在读取" : unavailable ? "暂不可用" : label;
  return (
    <Link
      href="/overview/dual-ledger"
      prefetch={false}
      title={unavailable ? "兑付覆盖率暂不可用 · 查看资金与应付款" : "兑付覆盖率 = 储备 ÷ 应付负债 · 点击进双账本"}
      aria-label={`兑付覆盖率：${statusLabel}，查看资金与应付款`}
      className="admin-topbar-coverage inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[12px] transition-opacity hover:opacity-90"
      style={{ background: `color-mix(in srgb, ${zoneVar} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${zoneVar} 35%, transparent)` }}
    >
      <span className="admin-topbar-coverage-label hidden xl:inline" style={{ color: "var(--v5-ink-3)" }}>兑付覆盖率</span>
      <Gauge className="admin-topbar-coverage-icon" size={17} style={{ color: zoneVar }} aria-hidden />
      <span className="admin-topbar-coverage-value font-mono-tabular" style={{ color: zoneVar, fontWeight: 600 }}>{label}</span>
    </Link>
  );
}

// 全局命令面板触发器(设计稿顶栏签名元素)。点击或 ⌘K/Ctrl+K 打开 shadcn(cmdk)命令面板,
// 跳转到任意运营模块(消费 IA 统一来源 visibleDomains)。真实可再接 A4 事件流 / userId 检索。
function SearchBox({ domains }: { domains: NavDomain[] }) {
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
        className="admin-topbar-search inline-flex shrink-0 items-center gap-2 rounded-[9px] px-3 py-1.5 text-left transition-opacity hover:opacity-90"
        style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}
      >
        <Search size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
        <span className="admin-topbar-search-label min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--v5-ink-4)" }}>
          搜索功能页面…
        </span>
        <kbd
          className="admin-topbar-search-shortcut font-mono-tabular rounded-[5px] px-1.5 py-0.5 text-[10px]"
          style={{ border: "1px solid var(--v5-border-strong)", color: "var(--v5-ink-4)" }}
        >
          ⌘K
        </kbd>
      </button>
      <CommandPalette domains={domains} open={open} onOpenChange={setOpen} />
    </>
  );
}

// 客服中心快捷入口（M-24）：未读消息数进会话台，待办客户数进工作台，两个数字分开显示。
// 未读来自客服页已加载的会话（不在客服页时不显示）；待办来自 M1 TODO 分页的服务端 total，按客户去重。
function SupportInboxPill({ pending }: { pending: number }) {
  const unread = useSupportUnreadTotal();
  const badge = { minWidth: 16, height: 16, color: "#0A0A0A" } as const;
  return (
    <span
      className="admin-topbar-support relative inline-flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12px]"
      style={{
        background: "color-mix(in srgb, var(--admin-domain-m) 12%, transparent)",
        border: "1px solid color-mix(in srgb, var(--admin-domain-m) 32%, transparent)",
      }}
    >
      <Link href="/service/sessions" prefetch={false} title="专属会话 · 未读消息" aria-label={unread > 0 ? `专属会话，${unread} 条未读` : "专属会话"} className="inline-flex items-center gap-1.5 hover:opacity-90">
        <Headset size={14} style={{ color: "var(--admin-domain-m)" }} aria-hidden />
        <span className="hidden md:inline" style={{ color: "var(--v5-ink-3)" }}>客服</span>
        {unread > 0 && <span className="admin-topbar-support-count font-mono-tabular inline-flex items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold" style={{ ...badge, background: "var(--admin-domain-m)" }}>{unread}</span>}
      </Link>
      {pending > 0 && (
        <Link href="/service/overview" prefetch={false} title="工作台 · 待办客户（待回复、首次联系、待维护）" aria-label={`${pending} 位待办客户`} className="hidden md:inline-flex items-center gap-1 hover:opacity-90" style={{ color: "var(--v5-ink-3)" }}>
          待办 <span className="font-mono-tabular">{pending}</span>
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
  const canReadBDomain = B_DASHBOARD_READ_AUTHORITIES.every((authority) => authorities.includes(authority));
  const canReadMContent = M_CONTENT_READ_AUTHORITIES.every((authority) => authorities.includes(authority));
  return (
    <header
      className="admin-topbar flex items-center justify-between gap-4 px-3 sm:px-5"
      style={{
        height: "var(--admin-topbar-h)",
        background: "var(--v5-surface)",
        borderBottom: "1px solid var(--v5-border)",
      }}
    >
      <div className="admin-topbar-location flex min-w-0 flex-1 items-center gap-4">
        <Breadcrumb />
        <SearchBox domains={domains} />
      </div>
      <div className="admin-topbar-actions flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-3">
        {!supportOnly && canReadBDomain && <CoveragePill enabled />}
        {!supportOnly && <span className="hidden h-4 w-px sm:block" style={{ background: "var(--v5-border)" }} />}
        <span className="admin-topbar-clock hidden 2xl:block"><UtcClock /></span>
        <span className="h-4 w-px" style={{ background: "var(--v5-border)" }} />
        {canReadMContent && <SupportInboxPill pending={servicePending} />}
        {!supportOnly && <NotificationBell />}
        <RoleSwitcher role={role} operator={operator} />
      </div>
    </header>
  );
}
