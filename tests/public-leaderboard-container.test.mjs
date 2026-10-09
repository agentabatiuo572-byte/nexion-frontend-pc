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
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, require: name => name in dependencies ? dependencies[name] : require(name), URL, URLSearchParams, AbortController, Intl, Date, console, ...globals }); return module.exports;
}
const nav = load("lib/nav/console-nav.ts", { "lucide-react": new Proxy({}, { get: () => () => null }) });
const SupportLeaderboard = () => null, Modal = () => null, Btn = () => null;
const tick = () => new Promise(resolve => setImmediate(resolve));
function pending() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const amount = { value: "123.456789", currency: "USDT", periodLabel: "2026-10", sourceVersion: "source", coverage: "complete", reason: "来源已核实" };
const row = id => ({ id, name: "真实客服" + id, groupName: "第一组", rank: 1, isTied: true, rankStatus: "confirmed", amount, firstPayment: { value: "2", coverage: "complete" }, customers: { value: "10", coverage: "complete" }, movement: { kind: "unavailable", explanation: "暂无基准" }, avatarUrl: `/api/admin/content/support-workbench/leaderboard/${id}/avatar`, canViewCustomers: false });
function page(id = "17", extra = {}) { return { viewVersion: VERSION, queryVersion: VERSION, sourceVersion: "source", definitionVersion: "support-leaderboard-v1", board: "firstPayment", rankMonth: "2026-10", referenceMonth: "2026-10", currency: "USDT", scope: "all", businessZone: "Asia/Shanghai", asOf: "2026-10-09T01:00:00Z", state: "COMPLETE", candidateCoverage: "COMPLETE", stale: false, refreshFailed: false, selectableMonths: ["2026-10", "2026-09"], currencies: ["USDT", "NEX"], scopeOptions: [{ scope: "all", groups: [] }, { scope: "ownGroup", groups: [{ id: "5", name: "第一组" }] }, { scope: "managedGroups", groups: [{ id: "5", name: "第一组" }] }], rows: [row(id)], self: { row: row(id), gap: "0", reason: "已达到榜首", pageNum: 3 }, total: 41, matched: 41, pageNum: 1, pageSize: 20, ...extra }; }
function find(tree, predicate) { if (!tree || typeof tree !== "object") return undefined; if (predicate(tree)) return tree; for (const child of [tree.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; } }

// Runs this component's hook/effect and event code with controlled promises. This is not a browser or React DOM acceptance test.
function harness(permission = "m3", options = {}) {
  const cells = []; let cursor = 0, dirty = true, effects = [], tree, component;
  let auth = { isAuthenticated: true, authEpoch: 1, logoutPending: false, logoutUnknown: false, session: { adminId: 17, role: "support", authorities: [`service_${permission}_read`], menuCodes: [permission.toUpperCase()] } };
  const pages = [], details = [], avatars = [], revoked = [], created = [], routes = [];
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial; return [cells[i], next => { const value = typeof next === "function" ? next(cells[i]) : next; if (!Object.is(cells[i], value)) { cells[i] = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in cells)) cells[i] = { current: initial }; return cells[i]; },
    useEffect(run, deps) { const i = cursor++, old = cells[i]; if (!old || deps.some((dep, j) => !Object.is(dep, old.deps[j]))) effects.push(() => { old?.cleanup?.(); cells[i] = { deps, cleanup: run() }; }); },
  };
  const dependencies = {
    react: hooks, "next/navigation": { useRouter: () => ({ push: url => routes.push(url) }) }, "@/lib/store/admin-auth": { useAdminAuth: selector => selector(auth) },
    "@/lib/admin/shell-authorities": { adminShellSessionKey: (session, epoch) => `${epoch}|${session?.adminId}|${[...(session?.authorities ?? [])].sort()}|${[...(session?.menuCodes ?? [])].sort()}` },
    "@/lib/nav/console-nav": nav, "../design-kit": { Btn, Modal }, "./support-leaderboard": { SupportLeaderboard }, "./m6-leaderboard.css": {},
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
test("explicit menu denial makes zero API calls", () => { const h = harness("m3", { denied: true }); assert.equal(h.pages.length, 0); assert.equal(h.board().status, "error"); h.unmount(); });
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
  h.details[0].resolve({ ...page(), row: row("17") }); await h.flush(); assert.match(JSON.stringify(h.modal().props.children), /不能查看这位客服的客户明细/); h.board().onViewCustomers("17"); assert.equal(h.routes.length, 0); h.unmount();
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
    assert.equal(h.board().status, "ready"); assert.equal(h.board().rows.length, 0); assert.match(h.board().candidateReason, /尚未完整核实/);
    const notice = find(h.tree, node => node.type === "p" && node.props.children?.includes?.("这不代表客服或业绩为零"));
    assert.ok(notice); assert.equal(h.avatars.length, 0); h.unmount();
  }
  const h = harness(); h.pages[0].resolve(page("17", { rows: [], self: { row: null, gap: null, reason: "未参榜", pageNum: null }, total: 0, matched: 0 })); await h.flush();
  assert.equal(h.board().candidateReason, undefined); assert.ok(find(h.tree, node => node.type === "p" && node.props.children === "当前范围暂无参榜客服。")); h.unmount();
});
