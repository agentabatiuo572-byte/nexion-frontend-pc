import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("B dashboard hook is disabled until the current session owns the full B read contract", () => {
  const client = source("lib/admin/b-client.ts");
  const home = source("app/_console/page.tsx");
  const bell = source("app/components/shell/notification-bell.tsx");
  const topbar = source("app/components/shell/topbar.tsx");

  assert.match(client, /export function useBDomainDashboard\(enabled = true\)/);
  assert.match(client, /if \(!enabled\)[\s\S]{0,300}setSnapshot\(\{ sessionKey, data: null \}\)/);
  assert.match(home, /const canReadBDomain = B_DASHBOARD_READ_AUTHORITIES\.every/);
  assert.match(home, /useBDomainDashboard\(canReadBDomain\)/);
  assert.match(bell, /const canReadBDomain = B_DASHBOARD_READ_AUTHORITIES\.every/);
  assert.match(bell, /useBDomainDashboard\(canReadBDomain\)/);
  assert.match(topbar, /const canReadBDomain = B_DASHBOARD_READ_AUTHORITIES\.every/);
  assert.match(topbar, /canReadBDomain && <CoveragePill enabled/);
});

test("home A2 and L prefetches require their exact read authorities", () => {
  const home = source("app/_console/page.tsx");

  assert.match(home, /const canReadA2 = authorities\.includes\("platform_a2_read"\)/);
  assert.match(home, /const canReadLBi = L_BI_READ_AUTHORITIES\.every/);
  assert.match(home, /if \(canReadA2\)[\s\S]{0,500}fetchA2Overview\(\)/);
  assert.match(home, /if \(canReadLBi\)[\s\S]{0,500}fetchLBiOverviews\(\)/);
  assert.match(home, /\}, \[canReadA2, canReadLBi\]\)/);
});

test("M badges and shell alerts do not call domains absent from the session", () => {
  const badges = source("app/components/shell/use-service-badges.ts");
  const sidebar = source("app/components/shell/sidebar.tsx");
  const shell = source("app/components/shell/console-shell.tsx");
  const topbar = source("app/components/shell/topbar.tsx");
  const bell = source("app/components/shell/notification-bell.tsx");
  const authorities = source("lib/admin/shell-authorities.ts");

  assert.match(badges, /useServicePendingCount\(enabled = true\)/);
  assert.match(badges, /if \(!enabled\)[\s\S]{0,160}setPending\(0\)/);
  assert.match(shell, /const canReadMContent = M_CONTENT_READ_AUTHORITIES\.every/);
  assert.match(shell, /const servicePending = useServicePendingCount\(canReadMContent\)/);
  assert.match(shell, /<Sidebar[\s\S]{0,220}servicePending=\{servicePending\}/);
  assert.match(shell, /<TopBar[\s\S]{0,220}servicePending=\{servicePending\}/);
  assert.match(sidebar, /servicePending > 0 \? \{ "\/service\/sessions": servicePending \} : \{\}/);
  assert.doesNotMatch(sidebar, /useNavBadges|useServicePendingCount/);
  assert.doesNotMatch(topbar, /useServicePendingCount/);
  assert.match(topbar, /<SupportInboxPill pending=\{servicePending\}/);
  assert.match(bell, /const session = useAdminAuth\(\(state\) => state\.session\)/);
  assert.match(bell, /const hasAdminSession = session != null/);
  assert.match(bell, /useJ1DutyAlerts\(hasAdminSession\)/);
  assert.match(authorities, /export function canReadC2HighRiskAlerts/);
  assert.match(authorities, /authorities\.includes\("user_c2_read"\)/);
  assert.match(authorities, /roleCode === "SUPER_ADMIN" \|\| roleCode === "RISK"/);
  assert.match(bell, /const canReadC2Alerts = canReadC2HighRiskAlerts\(session\)/);
  assert.doesNotMatch(bell, /const canReadC2Alerts = authorities\.includes\("user_c2_read"\)/);
  assert.match(bell, /if \(!canReadA2\)[\s\S]{0,180}setPendingOperations\(\[\]\)/);
});

test("runtime flags and topbar aggregate widgets require their complete server contracts", () => {
  const shell = source("app/components/shell/console-shell.tsx");
  const topbar = source("app/components/shell/topbar.tsx");

  assert.match(shell, /const canReadA3 = authorities\.includes\("platform_a3_read"\)/);
  assert.match(shell, /!isAuthenticated \|\| !canReadA3/);
  assert.match(shell, /<TopBar[\s\S]{0,180}authorities=\{authorities\}/);
  assert.match(topbar, /const canReadMContent = M_CONTENT_READ_AUTHORITIES\.every/);
  assert.match(topbar, /canReadMContent && <SupportInboxPill pending=\{servicePending\}/);
});

test("permission redirects hide the interactive shell until the replacement route settles", () => {
  const shell = source("app/components/shell/console-shell.tsx");

  assert.match(shell, /function AdminRouteRedirectGate\(\)/);
  assert.match(shell, /if \(redirecting\) return <AdminRouteRedirectGate \/>/);
  assert.match(shell, /aria-busy="true"/);
});

test("D4 cross-domain evidence links never prefetch routes the operator did not choose", () => {
  const ledger = source("app/components/domain-views/d-tabs/d4-ledger.tsx");

  for (const href of [
    "/users/assets",
    "/finance/recon",
    "/finance/withdrawals",
    "/finance/pool",
    "/platform/audit",
    "/platform/events",
    "/analytics/export",
  ]) {
    assert.match(
      ledger,
      new RegExp(`<Link\\s+className="chip"\\s+href="${href.replaceAll("/", "\\/")}"\\s+prefetch=\\{false\\}`),
    );
  }
});

test("shell and B aggregate data are partitioned by authenticated identity and permission fingerprint", () => {
  const shell = source("app/components/shell/console-shell.tsx");
  const authorities = source("lib/admin/shell-authorities.ts");
  const client = source("lib/admin/b-client.ts");
  const auth = source("lib/store/admin-auth.ts");

  assert.match(authorities, /export function adminShellSessionKey/);
  assert.match(authorities, /session\.adminId/);
  assert.match(authorities, /authEpoch/);
  assert.match(authorities, /authorities[\s\S]{0,220}\.sort\(\)/);
  assert.match(authorities, /menuCodes[\s\S]{0,220}\.sort\(\)/);
  assert.match(auth, /authEpoch: number/);
  assert.match(auth, /authEpoch: identityChanged \? state\.authEpoch \+ 1 : state\.authEpoch/);
  assert.match(auth, /authEpoch: state\.authEpoch \+ 1/);
  assert.match(shell, /const authEpoch = useAdminAuth/);
  assert.match(shell, /const sessionKey = adminShellSessionKey\(session, authEpoch\)/);
  assert.match(shell, /key=\{sessionKey\}/);
  assert.match(client, /const cachedDashboards = new Map<string, BDomainDashboard>\(\)/);
  assert.match(client, /const inflightDashboards = new Map<string, Promise<BDomainDashboard>>\(\)/);
  assert.match(client, /useAdminAuth\.subscribe\(\(state, previous\)/);
  assert.match(client, /state\.authEpoch === previous\.authEpoch/);
  assert.match(client, /cachedDashboards\.clear\(\)/);
  assert.match(client, /inflightDashboards\.clear\(\)/);
  assert.match(client, /if \(sessionKey !== currentSessionKey\(\)\) return/);
  assert.match(client, /adminShellSessionKey\(state\.session, state\.authEpoch\)/);
  assert.match(client, /const authEpoch = useAdminAuth/);
  assert.match(client, /adminShellSessionKey\(session, authEpoch\)/);
  assert.match(client, /publishDashboard\(sessionKey, dashboard\)/);
  assert.doesNotMatch(client, /let cachedDashboard:/);
  assert.doesNotMatch(client, /let inflightDashboard:/);
});
