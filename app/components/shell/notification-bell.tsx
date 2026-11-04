"use client";

/**
 * 顶栏消息入口(设计稿 admin-shell 的 bell → Drawer 侧滑抽屉,非下拉)。
 * 右侧滑入、整高;标题「告警 & 待办」,两段:风险与应急告警 + 操作确认 待确认(A2);
 * 底部 CTA「前往 A2 审计中心」。告警取 B 域与 J 域真实接口;A2 待办取审计待确认队列。
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, ChevronRight } from "lucide-react";
import { Drawer } from "@/app/components/rd/overlay";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { fetchA2Overview, type A2OperationRow } from "@/lib/admin/a2-client";
import { opsAlertHref, useC2HighRiskAlerts, useJ1DutyAlerts, useJ2GeoAlerts, useJ3TamperConfigAlerts } from "@/lib/admin/ops-dashboard-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel, type AdminRole } from "@/lib/nav/console-nav";
import { fmtPct } from "@/lib/format";
import { displayAdminError } from "@/lib/admin/error-messages";
import { a2ActionText } from "@/lib/admin/operator-copy";
import { B_DASHBOARD_READ_AUTHORITIES, canReadC2HighRiskAlerts } from "@/lib/admin/shell-authorities";

type AlertLevel = "high" | "mid" | "low";
interface ShellAlert {
  id: string;
  level: AlertLevel;
  text: string;
  href: string;
}

const LEVEL: Record<AlertLevel, { tone: "danger" | "warn" | "done"; label: string }> = {
  high: { tone: "danger", label: "高危" },
  mid: { tone: "warn", label: "关注" },
  low: { tone: "done", label: "正常" },
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
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const hasAdminSession = session != null;
  const isSuperAdmin = session?.role === "superadmin";
  const canReadA2 = authorities.includes("platform_a2_read");
  const canReadBDomain = B_DASHBOARD_READ_AUTHORITIES.every((authority) => authorities.includes(authority));
  const canReadC2Alerts = canReadC2HighRiskAlerts(session);
  const canReadJ3Alerts = authorities.includes("emergency_j3_alert_config");
  const { alerts: opsAlerts, error: opsAlertError } = useJ1DutyAlerts(hasAdminSession);
  const { alerts: j2Alerts, error: j2AlertError } = useJ2GeoAlerts(isSuperAdmin);
  const { alerts: j3Alerts, error: j3AlertError } = useJ3TamperConfigAlerts(canReadJ3Alerts);
  const { alerts: c2Alerts, error: c2AlertError } = useC2HighRiskAlerts(canReadC2Alerts);
  useEffect(() => {
    if (!canReadA2) {
      setPendingOperations([]);
      setA2Error(null);
      return undefined;
    }
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
        setA2Error(displayAdminError(error));
      });
    return () => {
      alive = false;
    };
  }, [canReadA2]);
  const bDomain = useBDomainDashboard(canReadBDomain);
  const bAlerts: ShellAlert[] = (() => {
    if (bDomain.error) {
      return [{ id: "b-sync", level: "high", text: `风险提醒加载失败：${bDomain.error}`, href: "/overview/risk-radar" }];
    }
    if (!bDomain.hasData) {
      return bDomain.loading ? [{ id: "b-sync", level: "low", text: "正在加载风险提醒", href: "/overview/risk-radar" }] : [];
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
          : `兑付覆盖率 ${fmtPct(bDomain.ledger.coverageRatio)} · 正常`;
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
  const j1Alerts: ShellAlert[] = [...c2Alerts, ...opsAlerts, ...j2Alerts, ...j3Alerts]
    .map((alert) => ({
      id: `ops-${alert.id}`,
      level: alert.level,
      text: `${alert.title} · ${alert.hint}`,
      href: opsAlertHref(alert),
    }));
  if (opsAlertError) {
    j1Alerts.push({
      id: "ops-dashboard-sync",
      level: "high",
      text: `紧急开关告警加载失败：${opsAlertError}`,
      href: "/emergency/kill-switch",
    });
  }
  if (j2AlertError) {
    j1Alerts.push({
      id: "j2-alert-sync",
      level: "high",
      text: `地区访问限制告警加载失败：${j2AlertError}`,
      href: "/emergency/geo-block",
    });
  }
  if (j3AlertError) {
    j1Alerts.push({
      id: "j3-alert-sync",
      level: "high",
      text: `篡改监控告警加载失败：${j3AlertError}`,
      href: "/emergency/tamper",
    });
  }
  if (c2AlertError) {
    j1Alerts.push({
      id: "c2-alert-sync",
      level: "high",
      text: `高风险账户告警加载失败：${c2AlertError}`,
      href: "/users/actions",
    });
  }
  const alerts = [...j1Alerts, ...bAlerts];
  const badge = alerts.filter((a) => a.level !== "low").length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`告警与待办${badge > 0 ? ` · ${badge} 条待处理` : ""}`}
        className="rd-top-item rd-bell"
      >
        <Bell size={16} aria-hidden />
        {badge > 0 && <span className="rd-top-count font-mono-tabular">{badge > 9 ? "9+" : badge}</span>}
      </button>
      <NotificationDrawer open={open} alerts={alerts} pendingOperations={pendingOperations} a2Error={a2Error} onClose={() => setOpen(false)} />
    </>
  );
}

function NotificationDrawer({
  open,
  alerts,
  pendingOperations,
  a2Error,
  onClose,
}: {
  open: boolean;
  alerts: ShellAlert[];
  pendingOperations: A2OperationRow[];
  a2Error: string | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="告警 & 待办"
      sub={`${alerts.length} 条告警 · ${pendingOperations.length} 项待确认`}
      aria-label="告警与待办"
      footer={
        <Link href="/platform/audit" prefetch={false} onClick={onClose} className="rd-btn rd-alert-cta" data-variant="primary">
          <span className="rd-btn-face">查看全部操作记录 <ChevronRight size={14} aria-hidden /></span>
        </Link>
      }
    >
      {/* 风险与应急告警 */}
      <h3 className="rd-alert-heading">风险与应急告警</h3>
      <div className="rd-alert-list">
        {alerts.map((a) => {
          const lv = LEVEL[a.level];
          return (
            <Link key={a.id} href={a.href} prefetch={false} onClick={onClose} className="rd-alert" data-tone={lv.tone}>
              <AlertTriangle className="rd-alert-icon" size={14} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="rd-alert-text">{a.text}</span>
                <span className="rd-alert-level">{lv.label}</span>
              </span>
              <ChevronRight className="rd-alert-go" size={14} aria-hidden />
            </Link>
          );
        })}
      </div>

      {/* 待确认的操作 */}
      <h3 className="rd-alert-heading">待确认的操作</h3>
      <div className="rd-alert-list">
        {a2Error && (
          <Link href="/platform/audit" prefetch={false} onClick={onClose} className="rd-alert" data-tone="danger">
            <span className="min-w-0 flex-1">
              <span className="rd-alert-text">待确认操作加载失败</span>
              <span className="rd-alert-note">{a2Error}</span>
            </span>
          </Link>
        )}
        {!a2Error && pendingOperations.length === 0 && <div className="rd-alert-empty">暂无待确认的操作。</div>}
        {pendingOperations.map((a) => {
          const operationRole = roleForA2Operation(a);
          return (
            <Link key={a.id} href="/platform/audit" prefetch={false} onClick={onClose} className="rd-alert">
              <span className="min-w-0 flex-1">
                <span className="rd-alert-text">{a2ActionText(a.action)}</span>
                <span className="rd-alert-note">{operationDetail(a)}</span>
              </span>
              {operationRole && <span className="rd-role">{roleLabel(operationRole)}</span>}
            </Link>
          );
        })}
      </div>
    </Drawer>
  );
}
