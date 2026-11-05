"use client";

/**
 * 顶栏消息入口(设计稿 admin-shell 的 bell → Drawer 侧滑抽屉,非下拉)。
 * 右侧滑入、整高,两段:风险与应急告警 + 操作确认 待确认(A2);底部 CTA「查看全部操作记录」。
 * 告警取 B 域与 J 域真实接口;A2 待办取审计待确认队列。
 * 只放要处理的事(DP-65):覆盖率正常、风险结论行这类正常状态不进列表。铃铛数字 = 列表里的告警 + 待确认,两边一致。
 */
import { useReach } from "@/lib/nav/use-reach";
import { useEffect, useState, type ReactNode } from "react";
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
import { isRiskConclusion, riskFeedTitle } from "@/lib/admin/risk-feed";
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

/** 铃铛的目标里默认读权表没有的两页。其余目标按表判断。 */
const ALERT_READ: Record<string, string> = { "/emergency/geo-block": "emergency_j2_read", "/users/actions": "user_c2_read" };

/** 告警不能隐藏（DP-03）：目标页进不去时这一行照样显示，只是不能点（X03）。 */
function AlertRow({ href, tone, onClose, children }: { href?: string; tone?: string; onClose: () => void; children: ReactNode }) {
  return href
    ? <Link href={href} prefetch={false} onClick={onClose} className="rd-alert" data-tone={tone}>{children}</Link>
    : <div className="rd-alert" data-tone={tone}>{children}</div>;
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
    if (!bDomain.hasData) return [];
    const { coverageRatio, redlinePct, healthyPct } = bDomain.ledger;
    const coverage: ShellAlert[] = coverageRatio < redlinePct
      ? [{ id: "b-coverage", level: "high", text: `兑付覆盖率 ${fmtPct(coverageRatio)} 已跌破红线 ${fmtPct(redlinePct)}`, href: "/overview/dual-ledger" }]
      : coverageRatio < healthyPct
        ? [{ id: "b-coverage", level: "mid", text: `兑付覆盖率 ${fmtPct(coverageRatio)} 低于健康线 ${fmtPct(healthyPct)}`, href: "/overview/dual-ledger" }]
        : [];
    return [
      ...coverage,
      ...bDomain.riskRadar.feed.filter((item) => !isRiskConclusion(item)).slice(0, 5).map((item, index) => ({
        id: `b-feed-${index}-${item.sev}`,
        level: severityLevel(item.sev),
        text: riskFeedTitle(item.t),
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
  const alerts = [...j1Alerts, ...bAlerts].filter((a) => a.level !== "low");
  const badge = alerts.length + pendingOperations.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`告警和待确认操作${badge > 0 ? ` · ${badge} 条` : ""}`}
        className="rd-top-item rd-bell"
      >
        <Bell size={16} aria-hidden />
        {badge > 0 && <span className="rd-top-count font-mono-tabular">{badge > 9 ? "9+" : badge}</span>}
      </button>
      <NotificationDrawer open={open} alerts={alerts} alertsLoading={bDomain.loading && !bDomain.hasData} pendingOperations={pendingOperations} a2Error={a2Error} onClose={() => setOpen(false)} />
    </>
  );
}

function NotificationDrawer({
  open,
  alerts,
  alertsLoading,
  pendingOperations,
  a2Error,
  onClose,
}: {
  open: boolean;
  alerts: ShellAlert[];
  alertsLoading: boolean;
  pendingOperations: A2OperationRow[];
  a2Error: string | null;
  onClose: () => void;
}) {
  const reach = useReach();
  const canOpenAudit = reach("/platform/audit", "platform_a2_read");
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="告警和待确认操作"
      sub={`${alerts.length} 条告警 · ${pendingOperations.length} 项待确认`}
      aria-label="告警和待确认操作"
      footer={canOpenAudit ? (
        <Link href="/platform/audit" prefetch={false} onClick={onClose} className="rd-btn rd-alert-cta" data-variant="primary">
          <span className="rd-btn-face">查看全部操作记录 <ChevronRight size={14} aria-hidden /></span>
        </Link>
      ) : undefined}
    >
      {/* 风险与应急告警 */}
      <h3 className="rd-alert-heading">风险与应急告警</h3>
      <div className="rd-alert-list">
        {alerts.length === 0 && <div className="rd-alert-empty">{alertsLoading ? "正在读取告警…" : "现在没有要处理的告警。"}</div>}
        {alerts.map((a) => {
          const lv = LEVEL[a.level];
          const reachable = reach(a.href, ALERT_READ[a.href]);
          return (
            <AlertRow key={a.id} href={reachable ? a.href : undefined} tone={lv.tone} onClose={onClose}>
              <AlertTriangle className="rd-alert-icon" size={14} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="rd-alert-text">{a.text}</span>
                <span className="rd-alert-level">{lv.label}</span>
              </span>
              {reachable && <ChevronRight className="rd-alert-go" size={14} aria-hidden />}
            </AlertRow>
          );
        })}
      </div>

      {/* 待确认的操作 */}
      <h3 className="rd-alert-heading">待确认的操作</h3>
      <div className="rd-alert-list">
        {a2Error && (
          <AlertRow href={canOpenAudit ? "/platform/audit" : undefined} tone="danger" onClose={onClose}>
            <span className="min-w-0 flex-1">
              <span className="rd-alert-text">待确认操作加载失败</span>
              <span className="rd-alert-note">{a2Error}</span>
            </span>
          </AlertRow>
        )}
        {!a2Error && pendingOperations.length === 0 && <div className="rd-alert-empty">暂无待确认的操作。</div>}
        {pendingOperations.map((a) => {
          const operationRole = roleForA2Operation(a);
          return (
            <AlertRow key={a.id} href={canOpenAudit ? "/platform/audit" : undefined} onClose={onClose}>
              <span className="min-w-0 flex-1">
                <span className="rd-alert-text">{a2ActionText(a.action)}</span>
                <span className="rd-alert-note">{operationDetail(a)}</span>
              </span>
              {operationRole && <span className="rd-role">{roleLabel(operationRole)}</span>}
            </AlertRow>
          );
        })}
      </div>
    </Drawer>
  );
}
