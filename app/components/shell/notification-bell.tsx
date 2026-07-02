"use client";

/**
 * 顶栏消息入口(设计稿 admin-shell 的 bell → Drawer 侧滑抽屉,非下拉)。
 * 右侧滑入、整高;标题「告警 & 待办」,两段:风险雷达告警(B5)+ 操作确认 待确认(A2);
 * 底部 CTA「前往 A2 审计中心」。B5 告警取 B 域真实聚合接口;A2 待办取审计待确认队列。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, X, AlertTriangle, ChevronRight } from "lucide-react";
import { RoleBadge } from "@/app/components/kit/role-badge";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { fetchA2Overview, type A2OperationRow } from "@/lib/admin/a2-client";
import type { AdminRole } from "@/lib/nav/console-nav";
import { fmtPct } from "@/lib/format";

type AlertLevel = "high" | "mid" | "low";
interface ShellAlert {
  id: string;
  level: AlertLevel;
  text: string;
  href: string;
}

const LEVEL: Record<AlertLevel, { color: string; label: string }> = {
  high: { color: "var(--v5-danger)", label: "高危" },
  mid: { color: "var(--v5-warning)", label: "关注" },
  low: { color: "var(--v5-ink-4)", label: "正常" },
};

function severityLevel(sev: string): AlertLevel {
  if (sev === "p0" || sev === "p1") return "high";
  if (sev === "p2") return "mid";
  return "low";
}

function roleForA2Operation(row: A2OperationRow): AdminRole | null {
  const gate = `${row.roleGate} ${row.operatorRole}`.toLowerCase();
  if (gate.includes("财务") || gate.includes("finance")) return "finance";
  if (gate.includes("风控") || gate.includes("risk")) return "risk";
  if (gate.includes("内容") || gate.includes("content")) return "content";
  if (gate.includes("增长") || gate.includes("growth")) return "growth";
  if (gate.includes("客服") || gate.includes("support")) return "support";
  if (gate.includes("审计") || gate.includes("auditor")) return "auditor";
  if (row.type === "fund") return "finance";
  if (row.type === "sos") return "risk";
  return null;
}

function operationDetail(row: A2OperationRow) {
  const delta = row.before !== "—" || row.after !== "—" ? `${row.before} → ${row.after}` : row.reason;
  return `${row.obj} · ${delta}`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [pendingOperations, setPendingOperations] = useState<A2OperationRow[]>([]);
  const [a2Error, setA2Error] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchA2Overview()
      .then((overview) => {
        if (!alive) return;
        setPendingOperations(overview.operationQueue.filter((item) => item.status === "pending"));
        setA2Error(null);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setPendingOperations([]);
        setA2Error(error instanceof Error ? error.message : "A2_OVERVIEW_LOAD_FAILED");
      });
    return () => {
      alive = false;
    };
  }, []);
  const bDomain = useBDomainDashboard();
  const alerts: ShellAlert[] = (() => {
    if (bDomain.error) {
      return [{ id: "b-sync", level: "high", text: `B 域风险雷达同步失败: ${bDomain.error}`, href: "/overview/risk-radar" }];
    }
    if (!bDomain.hasData) {
      return bDomain.loading ? [{ id: "b-sync", level: "low", text: "B 域风险雷达同步中", href: "/overview/risk-radar" }] : [];
    }
    const coverageLevel: AlertLevel =
      bDomain.ledger.coverageRatio < bDomain.ledger.redlinePct
        ? "high"
        : bDomain.ledger.coverageRatio < bDomain.ledger.healthyPct
          ? "mid"
          : "low";
    const coverageText =
      coverageLevel === "high"
        ? `兑付覆盖率 ${fmtPct(bDomain.ledger.coverageRatio)} 已跌破红线 ${fmtPct(bDomain.ledger.redlinePct)}`
        : coverageLevel === "mid"
          ? `兑付覆盖率 ${fmtPct(bDomain.ledger.coverageRatio)} 低于健康线 ${fmtPct(bDomain.ledger.healthyPct)}`
          : `兑付覆盖率 ${fmtPct(bDomain.ledger.coverageRatio)} · 风险雷达同步`;
    return [
      { id: "b-coverage", level: coverageLevel, text: coverageText, href: "/overview/dual-ledger" },
      ...bDomain.riskRadar.feed.slice(0, 5).map((item, index) => ({
        id: `b-feed-${index}-${item.sev}`,
        level: severityLevel(item.sev),
        text: item.t,
        href: item.href || "/overview/risk-radar",
      })),
    ];
  })();
  const badge = alerts.filter((a) => a.level !== "low").length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`告警与待办${badge > 0 ? ` · ${badge} 条待处理` : ""}`}
        className="relative grid h-9 w-9 place-items-center rounded-[9px] transition-colors hover:bg-[var(--v5-surface-2)]"
        style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}
      >
        <Bell size={16} aria-hidden />
        {badge > 0 && (
          <span
            className="font-mono-tabular absolute -right-1.5 -top-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full px-1 text-[10px]"
            style={{ background: "var(--v5-danger)", color: "#fff", border: "2px solid var(--v5-surface)", fontWeight: 600 }}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>
      {open && <NotificationDrawer alerts={alerts} pendingOperations={pendingOperations} a2Error={a2Error} onClose={() => setOpen(false)} />}
    </>
  );
}

function NotificationDrawer({
  alerts,
  pendingOperations,
  a2Error,
  onClose,
}: {
  alerts: ShellAlert[];
  pendingOperations: A2OperationRow[];
  a2Error: string | null;
  onClose: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0"
        style={{ background: "rgba(0,0,0,0.5)", zIndex: "var(--admin-z-drawer)", opacity: shown ? 1 : 0, transition: "opacity .2s ease" }}
        onClick={onClose}
        aria-hidden
      />
      {/* 右侧滑入抽屉 */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="告警与待办"
        className="fixed right-0 top-0 flex h-screen w-full max-w-[420px] flex-col"
        style={{
          background: "var(--v5-surface)",
          borderLeft: "1px solid var(--v5-border-strong)",
          boxShadow: "-16px 0 48px rgba(0,0,0,0.55)",
          zIndex: "calc(var(--admin-z-drawer) + 1)",
          transform: shown ? "translateX(0)" : "translateX(100%)",
          transition: "transform .26s cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        {/* 头部 */}
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: "1px solid var(--v5-border)" }}>
          <div className="min-w-0">
            <p className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}>告警 &amp; 待办</p>
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}>{alerts.length} 条告警 · {pendingOperations.length} 项待确认</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto grid h-8 w-8 place-items-center rounded-[9px] transition-colors hover:bg-[var(--v5-surface-2)]"
            style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}
          >
            <X size={15} aria-hidden />
          </button>
        </div>

        {/* 主体(滚动)*/}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 风险雷达告警 B5 */}
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--v5-ink-3)" }}>风险雷达告警 · B5</p>
          <div className="flex flex-col gap-2">
            {alerts.map((a) => {
              const lv = LEVEL[a.level];
              return (
                <Link
                  key={a.id}
                  href={a.href}
                  prefetch={false}
                  onClick={onClose}
                  className="flex items-start gap-2.5 rounded-[10px] p-3 transition-colors hover:bg-[var(--v5-surface-2)]"
                  style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}
                >
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-[7px]" style={{ background: `color-mix(in srgb, ${lv.color} 14%, transparent)` }}>
                    <AlertTriangle size={13} style={{ color: lv.color }} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px]" style={{ color: "var(--v5-ink-2)", fontWeight: 500 }}>{a.text}</span>
                    <span className="mt-0.5 block text-[11px]" style={{ color: lv.color }}>{lv.label}</span>
                  </span>
                  <ChevronRight size={14} style={{ color: "var(--v5-ink-4)", marginTop: 2 }} aria-hidden />
                </Link>
              );
            })}
          </div>

          {/* 操作确认 待确认 A2 */}
          <p className="mb-2.5 mt-5 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--v5-ink-3)" }}>操作确认 待确认 · A2</p>
          <div className="flex flex-col gap-2">
            {a2Error && (
              <Link
                href="/platform/audit"
                prefetch={false}
                onClick={onClose}
                className="block rounded-[10px] p-3 transition-colors hover:bg-[var(--v5-surface-3)]"
                style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px]" style={{ color: "var(--v5-ink)", fontWeight: 600 }}>A2 审计队列同步失败</span>
                </div>
                <p className="mt-1 text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}>{a2Error}</p>
              </Link>
            )}
            {!a2Error && pendingOperations.length === 0 && (
              <div
                className="rounded-[10px] p-3 text-[12px]"
                style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}
              >
                A2 当前没有待确认操作。
              </div>
            )}
            {pendingOperations.map((a) => {
              const operationRole = roleForA2Operation(a);
              return (
                <Link
                  key={a.id}
                  href="/platform/audit"
                  prefetch={false}
                  onClick={onClose}
                  className="block rounded-[10px] p-3 transition-colors hover:bg-[var(--v5-surface-3)]"
                  style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]" style={{ color: "var(--v5-ink)", fontWeight: 600 }}>{a.action}</span>
                    {operationRole && <span className="ml-auto"><RoleBadge role={operationRole} size="sm" /></span>}
                  </div>
                  <p className="mt-1 text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}>{operationDetail(a)}</p>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 底部 CTA */}
        <div className="px-5 py-4" style={{ borderTop: "1px solid var(--v5-border)", background: "var(--v5-surface-2)" }}>
          <Link
            href="/platform/audit"
            prefetch={false}
            onClick={onClose}
            className="flex items-center justify-center gap-1.5 rounded-[10px] py-2.5 text-[13px] font-medium transition-opacity hover:opacity-90"
            style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
          >
            前往 A2 审计中心 <ChevronRight size={14} aria-hidden />
          </Link>
        </div>
      </aside>
    </>
  );
}
