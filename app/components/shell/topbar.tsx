"use client";

/**
 * 顶栏 — 面包屑 + 服务端权威状态徽标 + UTC 时钟 + 角色切换器(演示 RBAC)。
 * 切角色会即时改变侧栏可见域(superadmin 见全 12 域,其余按 §3.3 权限)。
 */
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Headset, LogOut, Search } from "lucide-react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL, canSee } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Breadcrumb } from "./breadcrumb";
import { SyncChip } from "./sync-chip";
import { UtcClock } from "./utc-clock";
import { RoleBadge } from "@/app/components/kit/role-badge";
import Link from "next/link";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { fmtPct } from "@/lib/format";
import { NotificationBell } from "./notification-bell";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { SESSION_CONVOS } from "@/app/components/domain-views/m-tabs/data";
import { CommandPalette } from "@/app/components/command-palette";

const ROLES: AdminRole[] = [
  "superadmin",
  "finance",
  "risk",
  "growth",
  "content",
  "support",
  "auditor",
];

function RoleSwitcher({ role, operator }: { role: AdminRole; operator: string }) {
  const [open, setOpen] = useState(false);
  const setRole = useAdminAuth((s) => s.setRole);
  const signOut = useAdminAuth((s) => s.signOut);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-[9px] py-1 pl-2 pr-1.5 transition-colors hover:bg-[var(--v5-surface-2)]"
      >
        <span className="text-[12.5px]" style={{ color: "var(--v5-ink-2)" }}>
          {operator}
        </span>
        <RoleBadge role={role} size="sm" />
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
              切换角色(演示 RBAC)
            </p>
            {ROLES.map((r) => {
              const active = r === role;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setRole(r);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]"
                  style={{ color: "var(--v5-ink-2)" }}
                >
                  <span className="flex items-center gap-2">
                    <RoleBadge role={r} size="sm" />
                  </span>
                  {active && <Check size={14} style={{ color: "var(--v5-brand)" }} />}
                </button>
              );
            })}
            <div className="my-1 h-px" style={{ background: "var(--v5-border)" }} />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]"
              style={{ color: "var(--v5-ink-3)" }}
            >
              <LogOut size={13} />
              退出登录
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// 常驻兑付覆盖率(设计稿 topbar coverage pill)— 任何页都可见的平台健康度,点击进双账本。
function CoveragePill() {
  const cov = LEDGER.coverageRatio;
  const zoneVar = cov < LEDGER.redlinePct ? "var(--v5-danger)" : cov < LEDGER.healthyPct ? "var(--v5-warning)" : "var(--v5-success)";
  return (
    <Link
      href="/overview/dual-ledger"
      prefetch={false}
      title="兑付覆盖率 = 储备 ÷ 应付负债 · 点击进双账本"
      className="inline-flex items-center gap-2 rounded-[9px] px-3 py-1.5 text-[12px] transition-opacity hover:opacity-90"
      style={{ background: `color-mix(in srgb, ${zoneVar} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${zoneVar} 35%, transparent)` }}
    >
      <span className="hidden md:inline" style={{ color: "var(--v5-ink-3)" }}>兑付覆盖率</span>
      <span className="font-mono-tabular" style={{ color: zoneVar, fontWeight: 600 }}>{fmtPct(cov)}</span>
    </Link>
  );
}

// 全局命令面板触发器(设计稿顶栏签名元素)。点击或 ⌘K/Ctrl+K 打开 shadcn(cmdk)命令面板,
// 跳转到任意运营模块(消费 IA 单源 visibleDomains)。真实可再接 A4 事件流 / userId 检索。
function SearchBox({ role }: { role: AdminRole }) {
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
        aria-label="打开全局命令面板"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden items-center gap-2 rounded-[9px] px-3 py-1.5 text-left transition-opacity hover:opacity-90 lg:flex"
        style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)", width: 240 }}
      >
        <Search size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--v5-ink-4)" }}>
          搜索 userId / 工单 / 交易…
        </span>
        <kbd
          className="font-mono-tabular rounded-[5px] px-1.5 py-0.5 text-[10px]"
          style={{ border: "1px solid var(--v5-border-strong)", color: "var(--v5-ink-4)" }}
        >
          ⌘K
        </kbd>
      </button>
      <CommandPalette role={role} open={open} onOpenChange={setOpen} />
    </>
  );
}

// 客服中心快捷入口 — 坐席切到别的页面时仍能看到「有客户在等回复」并一键回即时会话台(Q2 续聊提醒)。
// 待回复数与 M1 客服总览同源派生自 I.session.convos(open 且末条为用户发言),无第二份 mock。
function SupportInboxPill() {
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const pending = useMemo(() => {
    let list: Array<{ status: string; messages: Array<{ sender: string }> }> = SESSION_CONVOS;
    const raw = hydrated ? (params?.["I.session.convos"] as string | undefined) : undefined;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed;
      } catch {
        /* 解析失败回退种子 */
      }
    }
    return list.filter((c) => c.status === "open" && c.messages[c.messages.length - 1]?.sender === "user").length;
  }, [params, hydrated]);
  return (
    <Link
      href="/service/sessions"
      prefetch={false}
      title="客服中心 · 待坐席回复的即时会话"
      className="relative inline-flex items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[12px] transition-opacity hover:opacity-90"
      style={{
        background: "color-mix(in srgb, var(--admin-domain-m) 12%, transparent)",
        border: "1px solid color-mix(in srgb, var(--admin-domain-m) 32%, transparent)",
      }}
    >
      <Headset size={14} style={{ color: "var(--admin-domain-m)" }} aria-hidden />
      <span className="hidden md:inline" style={{ color: "var(--v5-ink-3)" }}>客服</span>
      {pending > 0 && (
        <span
          className="font-mono-tabular inline-flex items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold"
          style={{ minWidth: 16, height: 16, background: "var(--admin-domain-m)", color: "#0A0A0A" }}
        >
          {pending}
        </span>
      )}
    </Link>
  );
}

export function TopBar({ role, operator }: { role: AdminRole; operator: string }) {
  return (
    <header
      className="flex items-center justify-between gap-4 px-5"
      style={{
        height: "var(--admin-topbar-h)",
        background: "var(--v5-surface)",
        borderBottom: "1px solid var(--v5-border)",
      }}
    >
      <div className="flex min-w-0 items-center gap-4">
        <Breadcrumb />
        <SearchBox role={role} />
      </div>
      <div className="flex items-center gap-3">
        <CoveragePill />
        <span className="hidden h-4 w-px sm:block" style={{ background: "var(--v5-border)" }} />
        <span className="hidden md:block"><SyncChip /></span>
        <span className="hidden lg:block"><UtcClock /></span>
        <span className="h-4 w-px" style={{ background: "var(--v5-border)" }} />
        {canSee(role, ["support", "risk"]) && <SupportInboxPill />}
        <NotificationBell />
        <RoleSwitcher role={role} operator={operator} />
      </div>
    </header>
  );
}
