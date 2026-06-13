"use client";

/**
 * 顶栏 — 面包屑 + 服务端权威状态徽标 + UTC 时钟 + 角色切换器(演示 RBAC)。
 * 切角色会即时改变侧栏可见域(superadmin 见全 12 域,其余按 §3.3 权限)。
 */
import { useState } from "react";
import { Check, ChevronDown, LogOut, Search } from "lucide-react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Breadcrumb } from "./breadcrumb";
import { SyncChip } from "./sync-chip";
import { UtcClock } from "./utc-clock";
import { RoleBadge } from "@/app/components/kit/role-badge";
import { CURRENT_PHASE, PHASES } from "@/lib/mock/admin/command-center";
import { PhaseStrip } from "@/app/components/dashboard/phase-strip";
import Link from "next/link";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { fmtPct } from "@/lib/format";
import { NotificationBell } from "./notification-bell";

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

// 当前 12 月运营阶段:顶栏按钮 + 点击下拉(时间线 + 重心)。与首页/H1 同源 CURRENT_PHASE。
function PhaseMenu() {
  const [open, setOpen] = useState(false);
  const p = CURRENT_PHASE;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`第 ${p.month}/${p.total} 月 · ${p.focus}`}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity hover:opacity-90"
        style={{
          background: "color-mix(in srgb, var(--v5-brand-2) 14%, transparent)",
          color: "var(--v5-ink-2)",
          border: "1px solid color-mix(in srgb, var(--v5-brand-2) 28%, transparent)",
        }}
      >
        <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: "var(--v5-brand-2)" }} />
        {p.code} · {p.name} · {p.month}/{p.total} 月
        <ChevronDown size={12} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="关闭节奏面板"
            className="fixed inset-0 cursor-default"
            style={{ zIndex: "var(--admin-z-topbar)" }}
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute right-0 top-full mt-2 w-[440px]"
            style={{ zIndex: "calc(var(--admin-z-topbar) + 1)" }}
            onClick={() => setOpen(false)}
          >
            <PhaseStrip phases={PHASES} current={p} />
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

// 全局搜索框(设计稿顶栏签名元素;原型内为占位 demo,真实接 A4 事件流 / userId 检索)
function SearchBox() {
  return (
    <div
      className="hidden items-center gap-2 rounded-[9px] px-3 py-1.5 lg:flex"
      style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)", width: 240 }}
    >
      <Search size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
      <input
        placeholder="搜索 userId / 工单 / 交易…"
        aria-label="全局搜索"
        className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
        style={{ color: "var(--v5-ink)" }}
      />
      <kbd
        className="font-mono-tabular rounded-[5px] px-1.5 py-0.5 text-[10px]"
        style={{ border: "1px solid var(--v5-border-strong)", color: "var(--v5-ink-4)" }}
      >
        ⌘K
      </kbd>
    </div>
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
        <SearchBox />
      </div>
      <div className="flex items-center gap-3">
        <CoveragePill />
        <span className="hidden h-4 w-px sm:block" style={{ background: "var(--v5-border)" }} />
        <PhaseMenu />
        <span className="hidden h-4 w-px md:block" style={{ background: "var(--v5-border)" }} />
        <span className="hidden md:block"><SyncChip /></span>
        <span className="hidden lg:block"><UtcClock /></span>
        <span className="h-4 w-px" style={{ background: "var(--v5-border)" }} />
        <NotificationBell />
        <RoleSwitcher role={role} operator={operator} />
      </div>
    </header>
  );
}
