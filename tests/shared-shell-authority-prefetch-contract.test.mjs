import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const compile = (text) => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const badgeOutput = compile(source("app/components/shell/use-service-badges.ts"));
const shellSource = ts.createSourceFile("console-shell.tsx", source("app/components/shell/console-shell.tsx"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const shellFunction = shellSource.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConsoleShell");
function shellDeclaration(name) {
  const node = shellFunction?.body?.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name);
  assert.ok(node, "Missing production shell declaration: " + name);
  return "const " + node.getText(shellSource) + ";";
}
const shellBadge = new Function("authorities", "authRole", "sessionKey", "useServicePendingCount",
  compile(shellDeclaration("canReadMContent") + "\n" + shellDeclaration("servicePending")) + "\nreturn servicePending;");
const authorityExports = {};
new Function("exports", compile(source("lib/admin/shell-authorities.ts")))(authorityExports);

// Execute the production hook with isolated React lifecycle, transport and window.
// Effects run cleanup before their replacement; no real network, timer or DOM is used.
function badgeHarness() {
  const slots = [], effects = [], requests = [], updates = [], clearedTimers = [];
  const timers = new Map(), listeners = new Map();
  let cursor = 0, timerId = 0, rendering = false, rerender = false, mounted = true;
  let invoke, pending;
  function render() {
    if (!mounted) return;
    if (rendering) { rerender = true; return; }
    let rounds = 0;
    do {
      assert.ok(++rounds < 20, "Unexpected repeated production hook effects");
      rerender = false; rendering = true; cursor = 0;
      pending = invoke();
      for (const job of effects.splice(0)) {
        slots[job.id].cleanup?.();
        slots[job.id].cleanup = job.effect();
      }
      rendering = false;
    } while (rerender);
  }
  const react = {
    useState(initial) {
      const id = cursor++;
      if (!(id in slots)) slots[id] = { value: initial };
      return [slots[id].value, next => {
        const value = typeof next === "function" ? next(slots[id].value) : next;
        updates.push(value);
        if (!Object.is(value, slots[id].value)) { slots[id].value = value; render(); }
      }];
    },
    useEffect(effect, deps) {
      const id = cursor++, previous = slots[id];
      const same = previous?.deps && deps && previous.deps.length === deps.length && deps.every((value, index) => Object.is(value, previous.deps[index]));
      if (!same) {
        slots[id] = { deps: deps && [...deps], cleanup: previous?.cleanup };
        effects.push({ id, effect });
      }
    },
  };
  const window = {
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearInterval(id) { clearedTimers.push(id); timers.delete(id); },
    addEventListener(name, callback) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
    removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const exports = {};
  new Function("require", "exports", "window", badgeOutput)(name => {
    if (name === "react") return react;
    if (name === "@/lib/admin/m-support-client") return { supportClient: {
      customers(options) {
        let resolve, reject;
        const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
        requests.push({ options: structuredClone(options), resolve, reject });
        return promise;
      },
    } };
    throw new Error("Unexpected production hook import: " + name);
  }, exports, window);
  const hook = exports.useServicePendingCount;
  const api = {
    requests, updates, timers, clearedTimers,
    count: () => pending,
    listenerCount: () => [...listeners.values()].reduce((total, values) => total + values.size, 0),
    render(enabled, sessionKey) { invoke = () => hook(enabled, sessionKey); render(); },
    renderSession(session, authRole = "agent", authEpoch = 1) {
      const sessionKey = authorityExports.adminShellSessionKey(session, authEpoch);
      invoke = () => shellBadge(session?.authorities ?? [], authRole, sessionKey, hook);
      render();
    },
    tick() { for (const timer of [...timers.values()]) timer.callback(); },
    changed() { for (const callback of [...(listeners.get("support-todo-changed") ?? [])]) callback(); },
    async resolve(index, total) {
      requests[index].resolve({ records: [], total, pageNum: 1, pageSize: 1 });
      await new Promise(resolve => setImmediate(resolve));
    },
    async reject(index) { requests[index].reject(new Error("Controlled badge read failure")); await new Promise(resolve => setImmediate(resolve)); },
    unmount() { for (const slot of slots) slot.cleanup?.(); mounted = false; },
  };
  return api;
}
const todoRequest = { pageNum: 1, pageSize: 1, filter: "TODO" };
const m1Session = (adminId = 17) => ({ adminId, authorities: ["service_m1_read"], menuCodes: ["M1"] });

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

  assert.match(badges, /useServicePendingCount\(enabled = true, sessionKey = ""\)/);
  assert.match(badges, /setPending\(0\);\s*if \(!enabled\)\s*\{\s*return undefined;/);
  assert.match(shell, /const canReadMContent = authorities\.includes\("service_m1_read"\) \|\| authRole === "superadmin" \|\| authRole === "super"/);
  assert.match(shell, /const servicePending = useServicePendingCount\(canReadMContent, sessionKey\)/);
  assert.match(shell, /<Sidebar[\s\S]{0,220}servicePending=\{servicePending\}/);
  assert.match(shell, /<TopBar[\s\S]{0,220}servicePending=\{servicePending\}/);
  assert.match(sidebar, /servicePending > 0 \? \{ "\/service\/sessions": servicePending \} : \{\}/);
  assert.doesNotMatch(sidebar, /useNavBadges|useServicePendingCount/);
  assert.doesNotMatch(topbar, /useServicePendingCount\s*\(/);
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

test("production shell enables the TODO badge only for M1 read or its verified super roles", () => {
  const cases = [
    { name: "anonymous", session: null, role: "auditor", allowed: false },
    { name: "no M read", session: { authorities: [], adminId: 17 }, role: "agent", allowed: false },
    { name: "M1 write only", session: { authorities: ["service_m1_write"], adminId: 17 }, role: "agent", allowed: false },
    { name: "M3 read only", session: { authorities: ["service_m3_read"], adminId: 17 }, role: "agent", allowed: false },
    { name: "other M reads", session: { authorities: ["service_m2_read", "service_m4_read", "service_m5_read"], adminId: 17 }, role: "agent", allowed: false },
    { name: "M1 read without other M reads", session: m1Session(), role: "agent", allowed: true },
    { name: "superadmin", session: { authorities: [], adminId: 1 }, role: "superadmin", allowed: true },
    { name: "super alias", session: { authorities: [], adminId: 1 }, role: "super", allowed: true },
  ];
  for (const row of cases) {
    const ui = badgeHarness();
    try {
      ui.renderSession(row.session, row.role);
      assert.equal(ui.requests.length, Number(row.allowed), row.name);
      assert.equal(ui.timers.size, Number(row.allowed), row.name);
      assert.equal(ui.listenerCount(), Number(row.allowed), row.name);
      if (row.allowed) assert.deepEqual(ui.requests[0].options, todoRequest, row.name);
    } finally {
      ui.unmount();
      assert.equal(ui.timers.size, 0, row.name);
      assert.equal(ui.listenerCount(), 0, row.name);
    }
  }
});

test("disabled production badge makes no reads and installs no refresh timer or listener", () => {
  const ui = badgeHarness();
  try {
    ui.render(false, "disabled-session");
    ui.tick(); ui.changed();
    assert.equal(ui.count(), 0);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.timers.size, 0);
    assert.equal(ui.listenerCount(), 0);
  } finally { ui.unmount(); }
});

test("authorized production badge reads the backend TODO total and refreshes on timer and event", async () => {
  const ui = badgeHarness();
  try {
    ui.renderSession(m1Session());
    assert.deepEqual(ui.requests[0].options, todoRequest);
    assert.deepEqual([...ui.timers.values()].map(timer => timer.delay), [30_000]);
    await ui.resolve(0, 4079);
    assert.equal(ui.count(), 4079, "Use page.total, not the empty fixture records length");
    ui.renderSession(m1Session());
    assert.equal(ui.requests.length, 1, "The same identity must not restart its effect");
    ui.tick();
    assert.deepEqual(ui.requests[1].options, todoRequest);
    await ui.resolve(1, 0);
    assert.equal(ui.count(), 0);
    ui.changed();
    assert.deepEqual(ui.requests[2].options, todoRequest);
    await ui.resolve(2, 23);
    assert.equal(ui.count(), 23);
  } finally { ui.unmount(); }
});

test("session change clears the old badge and ignores both old success and old failure", async () => {
  const ui = badgeHarness();
  try {
    ui.renderSession(m1Session(17));
    await ui.resolve(0, 11);
    ui.tick(); ui.changed();
    const oldTimer = [...ui.timers.keys()][0];
    ui.renderSession(m1Session(18));
    assert.equal(ui.count(), 0);
    assert.equal(ui.requests.length, 4, "Changed sessionKey must start the new identity read");
    assert.deepEqual(ui.clearedTimers, [oldTimer]);
    assert.equal(ui.timers.size, 1);
    assert.equal(ui.listenerCount(), 1);
    await ui.resolve(3, 22);
    assert.equal(ui.count(), 22);
    const publications = ui.updates.length;
    await ui.resolve(1, 999);
    await ui.reject(2);
    assert.equal(ui.count(), 22);
    assert.equal(ui.updates.length, publications, "Old callbacks must not publish even a zero value");
  } finally { ui.unmount(); }
});

test("revoking enabled access clears the badge and removes refresh resources before old replies", async () => {
  const ui = badgeHarness();
  try {
    ui.render(true, "same-session-key");
    await ui.resolve(0, 11);
    ui.tick(); ui.changed();
    const oldTimer = [...ui.timers.keys()][0];
    ui.render(false, "same-session-key");
    assert.equal(ui.count(), 0, "enabled must be a dependency independently of sessionKey");
    assert.deepEqual(ui.clearedTimers, [oldTimer]);
    assert.equal(ui.timers.size, 0);
    assert.equal(ui.listenerCount(), 0);
    const publications = ui.updates.length;
    await ui.resolve(1, 999);
    await ui.reject(2);
    ui.tick(); ui.changed();
    assert.equal(ui.requests.length, 3);
    assert.equal(ui.count(), 0);
    assert.equal(ui.updates.length, publications);
  } finally { ui.unmount(); }
});

test("unmount cleans the production badge timer and listener and suppresses pending results", async () => {
  const ui = badgeHarness();
  ui.render(true, "unmounted-session");
  const oldTimer = [...ui.timers.keys()][0];
  ui.unmount();
  assert.deepEqual(ui.clearedTimers, [oldTimer]);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.listenerCount(), 0);
  const publications = ui.updates.length;
  await ui.resolve(0, 999);
  ui.tick(); ui.changed();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.updates.length, publications);
});
