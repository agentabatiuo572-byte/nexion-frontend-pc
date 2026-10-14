import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import * as nav from "../lib/nav/console-nav.ts";

const require = createRequire(import.meta.url);
const shell = readFileSync(new URL("../app/components/shell/console-shell.tsx", import.meta.url), "utf8");

test("customer full profile uses M1 or M3 menus without granting global C1 search", () => {
  for (const code of ["M1", "M3", "M2", "M4", "M5"]) {
    const domains = nav.resolveVisibleDomains({ role: "support", menuCodes: [code], authorities: [`service_${code.toLowerCase()}_read`], supportReadModes: ["PERSONAL"] });
    assert.equal(nav.canAccessResolvedPath(domains, "/service/customers/7"), code === "M1" || code === "M3");
    assert.equal(nav.canAccessResolvedPath(domains, "/users/search/7"), false);
  }
  assert.equal(nav.canAccessResolvedPath([], "/service/customers/7"), false);
});

test("missing or empty grants never recover static pages for builtin or custom accounts", () => {
  for (const role of ["superadmin", "support", "finance", "config", "risk", "content", "growth", "auditor", "PARTNER_REVIEWER"]) {
    for (const grants of [{}, { authorities: [] }, { menuCodes: [] }, { menuCodes: [], authorities: ["platform_a6_read"] }]) {
      const domains = nav.resolveVisibleDomains({ role, ...grants });
      assert.equal(domains.length, 0, `${role}/${JSON.stringify(grants)}`);
      assert.equal(nav.canAccessResolvedPath(domains, "/"), false);
      assert.equal(nav.canAccessResolvedPath(domains, "/overview/dual-ledger"), false);
    }
  }
});

test("support landing chooses only an actually granted page in M1 M3 M2 order", () => {
  for (const [menuCodes, expected] of [[[], null], [["M2"], "/service/tickets"], [["M2", "M3"], "/service/sessions"], [["M1", "M2", "M3"], "/service/overview"]]) {
    const domains = nav.resolveVisibleDomains({ role: "support", menuCodes, supportReadModes: ["PERSONAL"] });
    assert.equal(nav.defaultConsolePath("support", domains), expected);
    if (expected) assert.equal(nav.canAccessResolvedPath(domains, expected), true);
  }
});

test("other accounts use granted menus while the authorized administrator home remains available", () => {
  const finance = nav.resolveVisibleDomains({ role: "finance", menuCodes: ["D6"] });
  assert.equal(nav.defaultConsolePath("finance", finance), "/finance/fx-rate");
  assert.equal(nav.defaultConsolePath("CUSTOM", finance), "/finance/fx-rate");
  assert.equal(nav.defaultConsolePath("superadmin", finance), "/");
  assert.equal(nav.canAccessResolvedPath(finance, "/"), true);
  assert.equal(nav.defaultConsolePath("superadmin", []), null);
});

test("effective menu metadata cannot broaden a landing to an unmatched route", () => {
  const domains = nav.resolveVisibleDomains({ role: "support", menuCodes: ["M1"], supportReadModes: ["PERSONAL"], menuNodes: [{ menuCode: "M1", menuName: "Invalid", routePath: "/platform/roles", parentCode: "M" }] });
  assert.deepEqual(domains, []);
  assert.equal(nav.defaultConsolePath("support", domains), null);
  const inferred = nav.resolveVisibleDomains({ role: "CUSTOM", authorities: ["platform_a6_read"] });
  assert.equal(nav.defaultConsolePath("CUSTOM", inferred), "/platform/roles");
});

test("support qualification is required for private pages but cannot bypass menu grants", () => {
  for (const supportReadModes of [undefined, []]) {
    const domains = nav.resolveVisibleDomains({ role: "support", supportReadModes, menuCodes: ["M1", "M2", "M3", "M4", "M5"], authorities: ["service_m1_read", "service_m3_read"] });
    assert.deepEqual(domains.flatMap(domain => domain.l2.map(item => item.id)), ["M4", "M5"]);
    assert.equal(nav.defaultConsolePath("support", domains), "/service/kb-sla");
    assert.equal(nav.canAccessResolvedPath(domains, "/service/leaderboard"), false);
  }
  assert.deepEqual(nav.resolveVisibleDomains({ role: "support", supportReadModes: ["ALL"], menuCodes: [], authorities: ["service_m1_read"] }), []);
  const finance = nav.resolveVisibleDomains({ role: "finance", menuCodes: ["D6", "M3"] });
  assert.equal(nav.canAccessResolvedPath(finance, "/service/sessions"), true);
});

function shellAst() {
  return ts.createSourceFile("shell.tsx", shell, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

test("actual shell decisions stop empty-grant redirects and settle on the granted landing", () => {
  const component = shellAst().statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ConsoleShell");
  const names = ["landingPath", "shouldRedirectHome", "shouldRedirectForbidden", "redirecting"];
  const declarations = component.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText()))).map(node => node.getText()).join("\n");
  const decide = (role, domains, pathname) => {
    const context = { role, domains, pathname, isAuthenticated: true, defaultConsolePath: nav.defaultConsolePath, canAccessResolvedPath: nav.canAccessResolvedPath };
    runInNewContext(ts.transpileModule(`${declarations}\nglobalThis.decision = { landingPath, redirecting };`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    return context.decision;
  };
  assert.equal(decide("support", [], "/").redirecting, false);
  assert.equal(decide("support", [], "/service/overview").landingPath, null);
  const domains = nav.resolveVisibleDomains({ role: "support", menuCodes: ["M3"], supportReadModes: ["PERSONAL"] });
  assert.equal(decide("support", domains, "/").landingPath, "/service/sessions");
  assert.equal(decide("support", domains, "/").redirecting, true);
  assert.equal(decide("support", domains, "/service/sessions").redirecting, false);
  assert.equal(decide("support", domains, "/service/overview").redirecting, true);
});

test("actual scope invalidation listener rechecks the session and unregisters on cleanup", async () => {
  const ast = shellAst();
  let found;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes('window.addEventListener("support-scope-invalidated"')) found = node.getText(ast);
    else ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(found);
  const events = new EventTarget(), calls = [], context = { mounted: true, window: events, restoreAdminSession: async () => calls.push("session"), useEffect: callback => { context.cleanup = callback(); } };
  runInNewContext(ts.transpileModule(found, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  events.dispatchEvent(new Event("support-scope-invalidated"));
  assert.deepEqual(calls, ["session"]);
  context.cleanup(); events.dispatchEvent(new Event("support-scope-invalidated"));
  assert.deepEqual(calls, ["session"]);
});

test("the actual no-access gate keeps retry and logout available without redirecting", () => {
  const ast = shellAst();
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AdminSessionRecoveryGate");
  const context = { require, exports: {} };
  runInNewContext(ts.transpileModule(`${declaration.getText(ast)}\nglobalThis.gate = AdminSessionRecoveryGate;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const calls = [], tree = context.gate({ noAccess: true, onRetry: () => calls.push("retry"), onLogout: () => calls.push("logout") });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /当前账号没有可访问的后台页面/);
  assert.match(html, /重新读取权限/);
  assert.match(html, /退出登录/);
  const buttons = tree.props.children.filter(node => node?.type === "button");
  buttons.forEach(button => button.props.onClick());
  assert.deepEqual(calls, ["retry", "logout"]);
});

test("the actual no-access logout preserves uncertain server outcomes and blocks duplicate attempts", async () => {
  const ast = shellAst(); let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "logoutWithoutAccess") declaration = node.getText(ast);
    else ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(declaration);
  for (const outcome of ["success", "still-authenticated", "signed-out", "unknown", "pending"]) {
    const calls = [], auth = { logoutPending: outcome === "pending", beginLogout: () => calls.push("begin"), beginLogoutVerification: () => calls.push("verify"), cancelLogout: () => calls.push("cancel"), failLogoutUnknown: () => calls.push("unknown") };
    const context = { useAdminAuth: { getState: () => auth }, signOut: () => calls.push("signOut"), requestAdminLogout: async () => { calls.push("request"); if (outcome !== "success") throw new Error("network"); }, currentAdminSession: async () => { if (outcome === "unknown") throw new Error("network"); return outcome === "still-authenticated" ? {} : null; } };
    runInNewContext(ts.transpileModule(`${declaration}\nglobalThis.logout = logoutWithoutAccess;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await context.logout();
    assert.deepEqual(calls, outcome === "pending" ? [] : outcome === "success" ? ["begin", "request", "signOut"] : ["begin", "request", "verify", outcome === "unknown" ? "unknown" : outcome === "still-authenticated" ? "cancel" : "signOut"]);
  }
});
