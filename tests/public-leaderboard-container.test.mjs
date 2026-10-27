import { displayCopyModules } from "./display-copy-fixture.mjs";
import * as businessTime from "../lib/admin/business-time.ts";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, ".."), fe = process.env.LEADERBOARD_FE_ROOT || root;
const require = createRequire(path.join(fe, "package.json")), ts = require("typescript");
const VERSION = "slb-v1:" + "a".repeat(64);
function load(file, dependencies, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, require: name => displayCopyModules[name] ?? (name in dependencies ? dependencies[name] : require(name)), URL, URLSearchParams, AbortController, Intl, Date, console, ...globals }); return module.exports;
}
const nav = load("lib/nav/console-nav.ts", { "lucide-react": new Proxy({}, { get: () => () => null }) });
const shellAuthorities = load("lib/admin/shell-authorities.ts", {});
const SupportLeaderboard = () => null, Modal = () => null, Btn = () => null;
const display = load("app/components/domain-views/m-tabs/support-leaderboard.tsx", { "./support-leaderboard.css": {}, "lucide-react": new Proxy({}, { get: () => () => null }) });
const { renderToStaticMarkup } = require("react-dom/server"), { createElement } = require("react");
const tick = () => new Promise(resolve => setImmediate(resolve));
function pending() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const amount = { value: "123.456789", currency: "USDT", periodLabel: "2026-10", sourceVersion: "source", coverage: "complete", reason: "" };
const row = id => ({ id, name: "真实客服" + id, groupName: "第一组", rank: 1, isTied: true, rankStatus: "confirmed", amount, firstPayment: { value: "2", coverage: "complete" }, customers: { value: "10", coverage: "complete" }, movement: { kind: "unavailable", explanation: "暂无基准" }, avatarUrl: `/api/admin/content/support-workbench/leaderboard/${id}/avatar`, canViewCustomers: false });
function page(id = "17", extra = {}) { return { viewVersion: VERSION, queryVersion: VERSION, sourceVersion: "source", definitionVersion: "support-leaderboard-v1", board: "netContribution", rankMonth: "2026-10", referenceMonth: "2026-10", currency: "USDT", scope: "all", businessZone: "Asia/Shanghai", asOf: "2026-10-09T01:00:00Z", state: "COMPLETE", candidateCoverage: "COMPLETE", stale: false, refreshFailed: false, selectableMonths: ["2026-10", "2026-09"], currencies: ["USDT", "NEX"], scopeOptions: [{ scope: "all", groups: [] }, { scope: "ownGroup", groups: [{ id: "5", name: "第一组" }] }, { scope: "managedGroups", groups: [{ id: "5", name: "第一组" }] }], rows: [row(id)], self: { row: row(id), gap: "0", reason: "已达到榜首", pageNum: 3 }, total: 41, matched: 41, pageNum: 1, pageSize: 20, ...extra }; }
function find(tree, predicate) { if (!tree || typeof tree !== "object") return undefined; if (predicate(tree)) return tree; for (const child of [tree.props?.children, tree.props?.search, tree.props?.notice].flat(Infinity)) { const found = find(child, predicate); if (found) return found; } }

// Runs this component's hook/effect and event code with controlled promises. This is not a browser or React DOM acceptance test.
function harness(permission = "m3", options = {}) {
  const cells = []; let cursor = 0, dirty = true, effects = [], tree, component;
  let auth = { isAuthenticated: true, authEpoch: 1, logoutPending: false, logoutUnknown: false, session: { adminId: 17, role: "support", authorities: [`service_${permission}_read`], menuCodes: [permission.toUpperCase()], supportReadModes: Object.hasOwn(options, "supportReadModes") ? options.supportReadModes : ["PERSONAL"] } };
  const pages = [], details = [], avatars = [], revoked = [], created = [], routes = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial; return [cells[i], next => { const value = typeof next === "function" ? next(cells[i]) : next; if (!Object.is(cells[i], value)) { cells[i] = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(run, deps) { const i = cursor++, old = cells[i]; if (!old || deps.some((dep, j) => !Object.is(dep, old.deps[j]))) effects.push(() => { old?.cleanup?.(); cells[i] = { deps, cleanup: run() }; }); },
  };
  const dependencies = {
    react: hooks, "next/navigation": { useRouter: () => ({ push: url => routes.push(url) }) }, "@/lib/store/admin-auth": { useAdminAuth: selector => selector(auth) },
    "@/lib/admin/shell-authorities": shellAuthorities,
    "@/lib/admin/business-time": businessTime,
    "@/lib/nav/console-nav": nav, "../design-kit": { Btn, Modal }, "./support-leaderboard": { SupportLeaderboard, NumberValue: display.NumberValue }, "./m6-leaderboard.css": {},
    "@/lib/admin/support-leaderboard-client": { supportLeaderboardClient: {
      page(query, signal) { const p = pending(); pages.push({ ...p, query, signal }); return p.promise; },
      detail(agentId, query, signal) { const p = pending(); details.push({ ...p, agentId, query, signal }); return p.promise; },
    }, fetchLeaderboardAvatar(url, agentId, query, version, signal) { const p = pending(); avatars.push({ ...p, url, agentId, query, version, signal }); return p.promise; },
    locateLeaderboardSelf: (data, query) => data.self.pageNum === null ? null : ({ ...query, keyword: undefined, pageNum: data.self.pageNum, expectedVersion: data.viewVersion }), },
  };
  class LocalURL extends URL { static createObjectURL() { const url = `blob:test-${created.length + 1}`; created.push(url); return url; } static revokeObjectURL(url) { revoked.push(url); } }
  component = load("app/components/domain-views/m-tabs/m6-leaderboard.tsx", dependencies, { URL: LocalURL }).M6Leaderboard;
  function commit() { let count = 0; do { dirty = false; cursor = 0; effects = []; tree = component(); for (const effect of effects) effect(); if (++count > 20) throw new Error("hook simulation loop"); } while (dirty); return tree; }
  const h = { pages, details, avatars, revoked, created, routes, commit, async flush() { await tick(); commit(); await tick(); if (dirty) commit(); }, board: () => find(tree, node => node.type === SupportLeaderboard).props, modal: () => find(tree, node => node.type === Modal),
    changeAuth(next) { auth = { ...auth, ...next }; dirty = true; commit(); }, setKeyword(value) { find(tree, node => node.type === "input").props.onChange({ target: { value } }); commit(); }, search() { find(tree, node => node.type === "form").props.onSubmit({ preventDefault() {} }); commit(); },
    unmount() { for (const cell of cells) cell?.cleanup?.(); }, get auth() { return auth; }, get tree() { return tree; } };
  if (options.denied) auth.session.menuCodes = []; commit(); return h;
}

test("M6-only load calls public page and deduplicates row/self avatar; query change revokes Blob", async () => {
  const h = harness(); assert.equal(h.pages.length, 1); h.pages[0].resolve(page()); await h.flush(); assert.equal(h.avatars.length, 1);
  h.avatars[0].resolve(new Blob(["png"])); await h.flush(); assert.equal(h.board().rows[0].avatarUrl, "blob:test-1"); assert.equal(h.board().self.row.avatarUrl, "blob:test-1");
  h.board().onQueryChange({ ...h.board().query, currency: "NEX" }); h.commit(); assert.equal(h.board().rows.length, 0); assert.equal(h.pages.at(-1).query.currency, "NEX"); assert.equal(h.pages.at(-1).query.pageNum, 1); assert.equal(h.pages.at(-1).query.expectedVersion, undefined); assert.deepEqual(h.revoked, ["blob:test-1"]); h.unmount();
});

test("M6 starts on net contribution and offers three distinct metric tabs", async () => {
  const h = harness();
  assert.equal(h.pages[0].query.board, "netContribution");
  h.pages[0].resolve(page("17", { board: "netContribution" })); await h.flush();
  const markup = renderToStaticMarkup(createElement(display.SupportLeaderboard, h.board()));
  assert.equal((markup.match(/role="tab"/g) || []).length, 3);
  assert.match(markup, /净贡献额/); assert.match(markup, /首充人数/); assert.match(markup, /客户规模/);
  assert.doesNotMatch(markup, /充值贡献|购机贡献/);
  h.unmount();
});

test("locate self waits for the accepted page before scrolling and focusing its row", async () => {
  const h = harness(), actions = [];
  h.tree.props.ref.current = { querySelector: () => ({ scrollIntoView: () => actions.push("scroll"), querySelector: () => ({ focus: () => actions.push("focus") }) }) };
  h.pages[0].resolve(page()); await h.flush();
  h.board().onLocateSelf(); h.commit(); assert.deepEqual(actions, []);
  assert.equal(h.pages.at(-1).query.pageNum, 3);
  h.pages.at(-1).resolve(page("17", { pageNum: 3 })); await h.flush();
  assert.deepEqual(actions, ["scroll", "focus"]); h.commit(); assert.equal(actions.length, 2); h.unmount();
});

test("an abandoned self lookup cannot steal focus after query change or denied read", async () => {
  for (const change of ["query", "denied"]) {
    const h = harness(), actions = [];
    h.tree.props.ref.current = { querySelector: () => ({ scrollIntoView: () => actions.push("scroll"), querySelector: () => ({ focus: () => actions.push("focus") }) }) };
    h.pages[0].resolve(page()); await h.flush(); h.board().onLocateSelf(); h.commit(); const old = h.pages.at(-1);
    if (change === "query") { h.setKeyword("另一位客服"); h.search(); old.resolve(page("17", { pageNum: 3 })); h.pages.at(-1).resolve(page("17", { matched: 0, rows: [] })); }
    else old.reject({ status: 403 });
    await h.flush(); assert.deepEqual(actions, []); h.unmount();
  }
});

test("real M6 keeps its search inside the shared heading without preview navigation", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush();
  assert.equal(h.board().navigation, undefined);
  const markup = renderToStaticMarkup(createElement(display.SupportLeaderboard, h.board()));
  assert.match(markup, /<header class="sl-heading">[\s\S]*<form class="m6-leaderboard-search"[\s\S]*<\/form><\/header>/);
  assert.doesNotMatch(markup, /data-preview|sl-navigation|演示数据/);
  h.setKeyword("客服姓名"); h.search();
  assert.equal(h.pages.at(-1).query.keyword, "客服姓名");
  h.unmount();
});

test("real M6 filters retain complete month, scope and long-group accessible labels", async () => {
  const h = harness(), groupName = "华东区域专属客服服务第一组";
  h.pages[0].resolve(page("17", { scopeOptions: [{ scope: "all", groups: [] }, { scope: "managedGroups", groups: [{ id: "5", name: groupName }] }] })); await h.flush();
  for (const [scope, label] of [["all", "全员榜"], ["managedGroups", "负责组榜"], ["managedGroups:5", groupName]]) {
    const props = h.board(), markup = renderToStaticMarkup(createElement(display.SupportLeaderboard, { ...props, query: { ...props.query, scope } }));
    assert.match(markup, /<select aria-label="币种" title="USDT"/);
    assert.match(markup, /<select aria-label="月份" title="2026\.10"/);
    assert.ok(markup.includes(`<select aria-label="榜单范围" title="${label}"`));
    assert.ok(markup.includes(`>${label}</option>`));
  }
  h.unmount();
});

test("actual self panel respects an unknown self reason even on a complete publication", async () => {
  for (const [state, reason, expected] of [["PROVISIONAL", "本人成绩暂不可用", "本人成绩暂不可用"], ["COMPLETE", "本人成绩暂不可用", "本人成绩暂不可用"], ["COMPLETE", "当前账号未参榜", "当前账号未参榜"]]) {
    const h = harness(); h.pages[0].resolve(page("17", { state, candidateCoverage: state === "PROVISIONAL" ? "UNKNOWN" : "COMPLETE", rows: [], self: { row: null, gap: null, reason, pageNum: null }, total: 0, matched: 0 })); await h.flush();
    const markup = renderToStaticMarkup(createElement(display.SupportLeaderboard, h.board()));
    assert.match(markup, new RegExp(`<p>${expected}</p>`));
    if (reason !== "当前账号未参榜") assert.doesNotMatch(markup, /当前账号未参榜/);
    if (state === "PROVISIONAL") assert.doesNotMatch(markup, /共 0 人/);
    h.unmount();
  }
});

test("actual public summary uses shared compact values, exact tooltips and dash for missing metrics", async () => {
  for (const values of [["12345.6789", "12000", "50"], [null, null, null], ["invalid", "1.5", "-1"]]) {
    const h = harness(); const p = page(); p.rows[0].amount = { ...amount, value: values[0], reason: "" }; p.self.row = p.rows[0];
    h.pages[0].resolve(p); await h.flush(); h.board().onViewPerformance("17"); h.commit();
    const r = { ...row("17"), amount: { ...amount, value: values[0], reason: "" }, firstPayment: { value: values[1], coverage: "complete", reason: "" }, customers: { value: values[2], coverage: "complete", reason: "" } };
    h.details[0].resolve({ ...p, row: r }); await h.flush();
    const markup = renderToStaticMarkup(createElement("div", null, h.modal().props.children));
    if (values[0] === "12345.6789") { assert.match(markup, /<strong>12\.3K<\/strong>/); assert.match(markup, /<strong>12K<\/strong>/); assert.match(markup, /12345\.6789 USDT/); }
    else { assert.equal((markup.match(/<strong>-<\/strong>/g) ?? []).length, 3); assert.doesNotMatch(markup, /待核实|<strong>0<\/strong>/); }
    assert.doesNotMatch(markup, /来源|不授予/); assert.equal(h.routes.length, 0); h.unmount();
  }
});

test("customer board requests omit month while search, paging and locate preserve hidden historical selection", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush();
  h.board().onQueryChange({ ...h.board().query, month: "2026-09" }); h.commit(); h.pages.at(-1).resolve(page("17", { rankMonth: "2026-09", referenceMonth: "2026-09" })); await h.flush();
  h.board().onQueryChange({ ...h.board().query, board: "customers" }); h.commit();
  const resolveCustomers = async () => { assert.equal(h.pages.at(-1).query.month, undefined); h.pages.at(-1).resolve(page("17", { board: "customers", rankMonth: null })); await h.flush(); };
  await resolveCustomers(); h.setKeyword("客服"); h.search(); await resolveCustomers();
  h.board().page.onChange(2); h.commit(); await resolveCustomers();
  h.board().page.onPageSizeChange(10); h.commit(); await resolveCustomers();
  h.board().onLocateSelf(); h.commit(); await resolveCustomers();
  h.board().onViewAllRankings(); h.commit(); await resolveCustomers();
  h.board().onQueryChange({ ...h.board().query, board: "firstPayment" }); h.commit(); assert.equal(h.pages.at(-1).query.month, "2026-09");
  h.changeAuth({ authEpoch: 2, session: { ...h.auth.session, adminId: 18 } }); assert.equal(h.pages.at(-1).query.month, undefined);
  h.pages.at(-1).resolve(page("18")); await h.flush(); h.board().onQueryChange({ ...h.board().query, board: "customers" }); h.commit();
  h.pages.at(-1).resolve(page("18", { board: "customers", rankMonth: null })); await h.flush();
  h.board().onQueryChange({ ...h.board().query, board: "netContribution" }); h.commit(); assert.equal(h.pages.at(-1).query.month, "2026-10"); h.unmount();
});
test("explicit menu denial makes zero API calls", () => { const h = harness("m3", { denied: true }); assert.equal(h.pages.length, 0); assert.equal(h.board().status, "error"); h.unmount(); });
test("unknown or empty support qualification makes zero public or private API calls", () => {
  for (const supportReadModes of [undefined, []]) {
    const h = harness("m3", { supportReadModes });
    assert.equal(h.pages.length, 0); assert.equal(h.board().status, "error");
    h.board().onViewPerformance("17"); h.board().onViewCustomers("17");
    assert.equal(h.details.length, 0); assert.equal(h.avatars.length, 0); assert.equal(h.routes.length, 0);
    h.unmount();
  }
});
test("qualification revoked without an epoch change aborts the old page and rejects late data", async () => {
  const h = harness(); const old = h.pages[0];
  h.changeAuth({ session: { ...h.auth.session, supportReadModes: [] } });
  assert.equal(old.signal.aborted, true); assert.equal(h.pages.length, 1); assert.equal(h.board().status, "error");
  old.resolve(page()); await h.flush(); assert.equal(h.board().rows.length, 0); assert.equal(h.avatars.length, 0);
  h.unmount();
});

test("off-page podium uses the same public avatar and detail lifecycle without private authority", async () => {
  const h = harness(); assert.equal(h.pages[0].query.pageSize, 5);
  const p = page(); p.podium = { total: 1, rows: [row("18")] }; h.pages[0].resolve(p); await h.flush();
  assert.equal(h.avatars.length, 2); assert.equal(h.board().podium.rows[0].id, "18");
  h.board().onViewPerformance("18"); h.commit(); assert.equal(h.details[0].agentId, "18"); assert.equal(h.details[0].query.expectedVersion, VERSION);
  h.board().onViewCustomers("18"); assert.equal(h.routes.length, 0);
  h.board().page.onPageSizeChange(10); h.commit(); assert.equal(h.pages.at(-1).query.pageSize, 10); assert.equal(h.pages.at(-1).query.pageNum, 1); assert.equal(h.pages.at(-1).query.expectedVersion, VERSION);
  assert.equal(h.board().podium, undefined); assert.equal(h.avatars[1].signal.aborted, true); h.unmount();
});
test("wrong self identity fails closed before displaying personal score", async () => { const h = harness(); h.pages[0].resolve(page("18")); await h.flush(); assert.equal(h.board().rows.length, 0); assert.equal(h.board().self, undefined); assert.equal(h.board().status, "error"); h.unmount(); });
test("switching identity hides rows before effects and late responses cannot replace the new identity", async () => {
  const h = harness(); const old = h.pages[0]; h.changeAuth({ authEpoch: 2, session: { ...h.auth.session, adminId: 18 } }); assert.equal(old.signal.aborted, true); assert.equal(h.board().rows.length, 0);
  old.resolve(page("17")); await h.flush(); assert.equal(h.board().rows.length, 0); h.pages.at(-1).resolve(page("18")); await h.flush(); assert.equal(h.board().rows[0].id, "18"); h.unmount();
});
test("revocation with unchanged authEpoch cancels requests and clears rows, details and Blob", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush(); h.avatars[0].resolve(new Blob(["png"])); await h.flush(); h.board().onViewPerformance("17"); h.commit(); const late = h.details[0];
  h.changeAuth({ session: { ...h.auth.session, authorities: [] } }); assert.equal(h.board().rows.length, 0); assert.equal(h.modal(), undefined); assert.equal(late.signal.aborted, true); assert.deepEqual(h.revoked, ["blob:test-1"]); late.resolve({ ...page(), row: row("17") }); await h.flush(); assert.equal(h.modal(), undefined); h.unmount();
});
test("page 409 clears old version and retry reads first page without expectedVersion", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush(); h.board().page.onChange(2); h.commit(); assert.equal(h.pages.at(-1).query.expectedVersion, VERSION); assert.equal(h.pages.at(-1).query.pageNum, 2);
  h.pages.at(-1).reject({ status: 409 }); await h.flush(); assert.equal(h.board().rows.length, 0); assert.match(h.board().statusMessage, /重新读取第一页/); h.board().onRetry(); h.commit(); assert.equal(h.pages.at(-1).query.pageNum, 1); assert.equal(h.pages.at(-1).query.expectedVersion, undefined); h.unmount();
});
test("search and locate use whole-board self page, clear keyword and keep exact version", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush(); h.setKeyword("重名客服"); h.search(); assert.equal(h.pages.at(-1).query.keyword, "重名客服"); assert.equal(h.pages.at(-1).query.pageNum, 1); h.pages.at(-1).resolve(page("17", { matched: 1 })); await h.flush();
  h.board().onLocateSelf(); h.commit(); const query = h.pages.at(-1).query; assert.equal(query.keyword, undefined); assert.equal(query.pageNum, 3); assert.equal(query.expectedVersion, VERSION); h.unmount();
});
test("public summary click uses version-bound public detail, denied private customers never navigate", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush(); h.board().onViewPerformance("17"); h.commit(); assert.equal(h.details[0].agentId, "17"); assert.equal(h.details[0].query.expectedVersion, VERSION); assert.ok(h.modal());
  h.details[0].resolve({ ...page(), row: row("17") }); await h.flush(); assert.match(JSON.stringify(h.modal().props.children), /客户明细查看权限/); h.board().onViewCustomers("17"); assert.equal(h.routes.length, 0); h.unmount();
});
test("authorized private customer entry still requires row grant and M1 menu", async () => {
  const h = harness("m1"); const p = page(); p.rows[0].canViewCustomers = true; h.pages[0].resolve(p); await h.flush(); h.board().onViewCustomers("17"); assert.deepEqual(h.routes, ["/service/overview?agentId=17"]); h.unmount();
  const denied = harness("m3"); denied.pages[0].resolve(p); await denied.flush(); assert.equal(denied.board().rows[0].canViewCustomers, false); denied.board().onViewCustomers("17"); assert.equal(denied.routes.length, 0); denied.unmount();
});
test("detail 409 closes summary and discards expired rows; detail late close cannot reopen", async () => {
  const h = harness(); h.pages[0].resolve(page()); await h.flush(); h.board().onViewPerformance("17"); h.commit(); h.details[0].reject({ status: 409 }); await h.flush(); assert.equal(h.modal(), undefined); assert.equal(h.board().rows.length, 0); h.board().onRetry(); h.commit(); h.pages.at(-1).resolve(page()); await h.flush(); h.board().onViewPerformance("17"); h.commit(); const late = h.details.at(-1); h.modal().props.onClose(); h.commit(); late.resolve({ ...page(), row: row("17") }); await h.flush(); assert.equal(h.modal(), undefined); h.unmount();
});
test("avatar 403 revokes prior public Blob and clears sensitive page and modal", async () => {
  const h = harness(); const p = page(); p.rows.push(row("18")); h.pages[0].resolve(p); await h.flush(); assert.equal(h.avatars.length, 2); h.avatars[0].resolve(new Blob(["png"])); await h.flush(); h.board().onViewPerformance("17"); h.commit(); h.avatars[1].reject({ status: 403 }); await h.flush(); assert.equal(h.board().rows.length, 0); assert.equal(h.modal(), undefined); assert.deepEqual(h.revoked, ["blob:test-1"]); assert.equal(h.details[0].signal.aborted, true); h.unmount();
});
test("unmount aborts late avatar and revokes every created Blob; stale timestamp stays factual", async () => {
  const h = harness(); h.pages[0].resolve(page("17", { stale: true, refreshFailed: true })); await h.flush(); assert.match(h.board().updatedAt, /2026\/10\/9/); assert.doesNotMatch(h.board().updatedAt, /正在/); h.avatars[0].resolve(new Blob(["png"])); await h.flush(); h.unmount(); assert.equal(h.avatars[0].signal.aborted, true); assert.deepEqual(h.revoked, ["blob:test-1"]);
  const late = harness(); late.pages[0].resolve(page()); await late.flush(); late.unmount(); late.avatars[0].resolve(new Blob(["png"])); await tick(); assert.equal(late.created.length, 0);
});
test("uncertified empty publication stays ready with incomplete-data explanation rather than certified zero", async () => {
  for (const candidateCoverage of ["PARTIAL", "UNKNOWN"]) {
    const h = harness(); h.pages[0].resolve(page("17", { state: "PROVISIONAL", candidateCoverage, rows: [], self: { row: null, gap: null, reason: "资料待核实", pageNum: null }, total: 0, matched: 0 })); await h.flush();
    assert.equal(h.board().status, "ready"); assert.equal(h.board().rows.length, 0); assert.match(h.board().candidateReason, /待核实/);
    const notice = find(h.tree, node => node.type === "p" && node.props.children?.includes?.("参榜资料待核实"));
    assert.ok(notice); assert.equal(h.avatars.length, 0); h.unmount();
  }
  const h = harness(); h.pages[0].resolve(page("17", { rows: [], self: { row: null, gap: null, reason: "未参榜", pageNum: null }, total: 0, matched: 0 })); await h.flush();
  assert.equal(h.board().candidateReason, undefined); assert.ok(find(h.tree, node => node.type === "p" && node.props.children === "当前范围暂无参榜客服。")); h.unmount();
});
