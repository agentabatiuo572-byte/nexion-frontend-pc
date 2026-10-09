import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const fe = process.env.LEADERBOARD_FE_ROOT || root;
const require = createRequire(path.join(fe, "package.json"));
const ts = require("typescript");
function load(relative, dependencies) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(code, { module, exports: module.exports, require: name => name in dependencies ? dependencies[name] : require(name), URL, URLSearchParams, AbortController, Blob, Response, Headers, console }); return module.exports;
}
let calls = [], responseBody, fetchResponse;
const client = load("lib/admin/support-leaderboard-client.ts", {
  "./m-support-client.ts": { supportRequest: async (url, parse, init) => { calls.push({ url, init }); return parse(responseBody); } },
  "./error-messages.ts": { guardedFetch: async (url, init) => { calls.push({ url, init }); return fetchResponse; } },
});
const VERSION = "slb-v1:" + "a".repeat(64);
const q = { board: "deposit", month: "2026-10", currency: "USDT", scope: "all", pageNum: 1, pageSize: 20 };
const metric = (value, coverage = "COMPLETE", reason = "NONE") => ({ value, coverage, reason });
function row(id = "17") { return { agentId: id, name: "真实客服", groupName: "第一组", qualification: "ACTIVE", avatarUrl: null, rank: 1, isTied: true, rankMetricCoverage: "COMPLETE", firstPayment: metric(9007199254740991), customers: metric(100), amount: { ...metric("9007199254740991.123456789"), currency: "USDT", month: "2026-10", kind: "DEPOSIT" }, movement: { kind: "UNAVAILABLE", places: null, previousRank: null, baselineAt: null, baselineVersion: null, reason: "NO_BASELINE" }, canViewCustomers: false }; }
function page() { return { viewVersion: VERSION, queryVersion: VERSION, sourceVersion: "source-actual", definitionVersion: "support-leaderboard-v1", board: "deposit", rankMonth: "2026-10", referenceMonth: "2026-10", currency: "USDT", scope: "all", businessZone: "Asia/Shanghai", asOf: "2026-10-09T01:00:00Z", publishedAt: "2026-10-09T01:00:01Z", state: "COMPLETE", candidateCoverage: "COMPLETE", stale: false, refreshFailed: false, selectableMonths: ["2026-10", "2026-09"], currencies: ["NEX", "USDT"], scopeOptions: [{ scope: "all", groups: [] }, { scope: "ownGroup", groups: [{ id: "5", name: "第一组" }] }, { scope: "managedGroups", groups: [{ id: "5", name: "第一组" }, { id: "6", name: "第二组" }] }], total: 41, ranked: 41, unranked: 0, matched: 1, pageNum: 1, pageSize: 20, rows: [row()], self: { row: row(), gap: "0", reason: "LEADER", pageNum: 3 } }; }
const clone = value => structuredClone(value);
test("malformed queries and detail without version perform zero fetch", async () => {
  calls = [];
  for (const extra of [{ view: "CUSTOMERS" }, { board: "bogus" }, { scope: "mine" }, { month: "2026-13" }, { currency: "BTC" }, { groupId: "5" }, { keyword: "abc\n" }, { pageNum: 2 }, { pageSize: 101 }, { expectedVersion: "saq-v1:bad" }, { pageNum: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => client.supportLeaderboardClient.page({ ...q, ...extra }));
  assert.throws(() => client.supportLeaderboardClient.detail("17", q)); assert.equal(calls.length, 0);
});
test("whitelisted page transport preserves exact money, safe counts, server ties and self", async () => {
  responseBody = page(); calls = []; const result = await client.supportLeaderboardClient.page(q);
  assert.equal(result.rows[0].amount.value, "9007199254740991.123456789"); assert.equal(result.rows[0].firstPayment.value, "9007199254740991"); assert.equal(result.rows[0].rank, 1); assert.equal(result.rows[0].isTied, true); assert.equal(result.rows[0].rankStatus, "confirmed"); assert.equal(result.self.pageNum, 3); assert.equal(result.matched, 1);
  assert.match(calls[0].url, /^\/support-workbench\/leaderboard\?board=deposit&scope=all&month=2026-10&currency=USDT&pageNum=1&pageSize=20$/);
});
test("real supportRequest/guardedFetch preserve envelope, same-origin credentials and HTTP 409/403", async () => {
  const actualSupport = await import(pathToFileURL(path.join(fe, "lib/admin/m-support-client.ts")).href);
  const actualGuard = await import(pathToFileURL(path.join(fe, "lib/admin/error-messages.ts")).href);
  const real = load("lib/admin/support-leaderboard-client.ts", { "./m-support-client.ts": actualSupport, "./error-messages.ts": actualGuard });
  const original = globalThis.fetch, seen = []; let upstream = new Response(JSON.stringify({ code: 0, message: "OK", data: page() }), { status: 200, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return upstream; };
  try {
    const controller = new AbortController(); const result = await real.supportLeaderboardClient.page(q, controller.signal);
    assert.equal(result.rows[0].amount.value, "9007199254740991.123456789"); assert.equal(seen[0].init.credentials, "same-origin"); assert.equal(seen[0].init.cache, "no-store"); assert.equal(seen[0].init.signal, controller.signal); assert.match(seen[0].url, /^\/api\/admin\/content\/support-workbench\/leaderboard\?/);
    for (const status of [409, 403]) { upstream = new Response(JSON.stringify({ code: status, message: status === 409 ? "SUPPORT_LEADERBOARD_VERSION_CHANGED" : "SUPPORT_SCOPE_FORBIDDEN", data: null }), { status }); await assert.rejects(real.supportLeaderboardClient.page(q), error => error instanceof actualSupport.SupportClientError && error.status === status); }
  } finally { globalThis.fetch = original; }
});
test("incomplete candidates and metric states never award ranks or fabricate zeros", () => {
  for (const coverage of ["PARTIAL", "UNKNOWN", "FAILED"]) { const input = page(); input.state = "PROVISIONAL"; input.candidateCoverage = coverage; input.ranked = 0; input.unranked = 41; input.self.gap = null;
    for (const r of [input.rows[0], input.self.row]) { r.rank = null; r.isTied = false; r.rankMetricCoverage = coverage; r.amount.coverage = coverage; r.amount.reason = coverage === "FAILED" ? "SOURCE_FAILED" : "METRIC_INCOMPLETE"; r.amount.value = coverage === "PARTIAL" ? "12.50" : null; }
    const result = client.parseLeaderboardPage(input, q); assert.notEqual(result.rows[0].rankStatus, "confirmed"); assert.equal(result.rows[0].amount.value, coverage === "PARTIAL" ? "12.50" : null); assert.equal(result.rows[0].amount.coverage, coverage === "PARTIAL" ? "partial" : "unavailable");
  }
});
test("malformed output, identity, amount period, currency and versions fail closed", () => {
  for (const mutate of [p => p.privateCustomerId = "1", p => p.rows[0].contact = "secret", p => p.self.row.agentId = "0", p => p.rows[0].firstPayment.value = 9007199254740992, p => p.rows[0].amount.currency = "NEX", p => p.rows[0].amount.month = "2026-09", p => p.queryVersion = "slb-v1:" + "b".repeat(64), p => p.rows[0].rank = 0, p => p.rows[0].rank = 42, p => p.rows[0].amount.value = 1.23, p => p.rows[0].rankMetricCoverage = "UNKNOWN", p => p.asOf = "2026-02-31T01:00:00Z", p => p.pageNum = 2]) { const p = page(); mutate(p); assert.throws(() => client.parseLeaderboardPage(p, q)); }
});
test("all four boards, both currencies and only server scopes share legal contract", () => {
  for (const board of ["firstPayment", "deposit", "purchase", "customers"]) for (const currency of ["USDT", "NEX"]) for (const scope of ["all", "ownGroup", "managedGroups"]) {
    const input = page(), query = { ...q, board, currency, scope, month: board === "customers" ? undefined : "2026-10", groupId: scope === "managedGroups" ? "6" : undefined };
    input.board = board; input.currency = currency; input.scope = scope; if (board === "customers") input.rankMonth = null;
    for (const r of [input.rows[0], input.self.row]) { r.amount.currency = currency; r.amount.kind = board === "purchase" ? "PURCHASE" : "DEPOSIT"; }
    assert.equal(client.parseLeaderboardPage(input, query).board, board); assert.match(client.leaderboardQueryString(query), new RegExp(`scope=${scope}`));
    if (board === "customers") assert.doesNotMatch(client.leaderboardQueryString(query), /month=/);
  }
  assert.throws(() => client.parseLeaderboardPage(page(), { ...q, scope: "managedGroups", groupId: "999" }));
  assert.throws(() => client.leaderboardQueryString({ ...q, board: "customers", month: "" }));
});
test("search never recomputes server rank; locating clears keyword and uses full-board self page/version", () => {
  const input = page(); input.rows[0].rank = 17; input.rows[0].isTied = false; input.self.row = row("18");
  const query = { ...q, keyword: "姓名" }, result = client.parseLeaderboardPage(input, query), located = client.locateLeaderboardSelf(result, query);
  assert.equal(result.rows[0].rank, 17); assert.equal(located.keyword, undefined); assert.equal(located.pageNum, 3); assert.equal(located.expectedVersion, VERSION);
});
test("server SAME zero-place, UP/DOWN and NEW movement use truthful baseline; invented movement is rejected", () => {
  for (const [kind, places, previousRank, rank] of [["SAME", 0, 1, 1], ["UP", 2, 3, 1], ["DOWN", 2, 1, 3], ["NEW", null, null, 1]]) {
    const input = page(); const movement = { kind, places, previousRank, baselineAt: "2026-10-08T01:00:00Z", baselineVersion: "slb-v1:" + "b".repeat(64), reason: "NONE" };
    for (const r of [input.rows[0], input.self.row]) { r.rank = rank; r.movement = movement; }
    assert.equal(client.parseLeaderboardPage(input, q).rows[0].movement.kind, kind.toLowerCase());
    input.rows[0].movement = { ...movement, places: 99 }; assert.throws(() => client.parseLeaderboardPage(input, q));
  }
});
test("same-page self must match public row and complete counts require verified reasons", () => {
  const input = page(); input.self.row.amount.value = "9"; assert.throws(() => client.parseLeaderboardPage(input, q));
  const unverified = page(); unverified.rows[0].firstPayment.reason = "HISTORY_UNKNOWN"; assert.throws(() => client.parseLeaderboardPage(unverified, q));
});
test("stale refresh failure preserves source asOf and publication state", () => {
  const input = page(); input.stale = true; input.refreshFailed = true; const result = client.parseLeaderboardPage(input, q);
  assert.equal(result.asOf, input.asOf); assert.equal(result.stale, true); assert.equal(result.refreshFailed, true); assert.equal(result.viewVersion, VERSION);
});
test("public summary binds identity and same expected version, excludes private fields", async () => {
  const p = page(); for (const key of ["total", "ranked", "unranked", "matched", "pageNum", "pageSize", "rows", "self"]) delete p[key]; p.row = row(); responseBody = p;
  const result = await client.supportLeaderboardClient.detail("17", { ...q, expectedVersion: VERSION }); assert.equal(result.row.id, "17");
  assert.throws(() => client.parseLeaderboardDetail(p, { ...q, expectedVersion: VERSION }, "18")); const leaked = clone(p); leaked.row.orders = []; assert.throws(() => client.parseLeaderboardDetail(leaked, { ...q, expectedVersion: VERSION }, "17"));
  assert.throws(() => client.parseLeaderboardDetail(p, { ...q, expectedVersion: "slb-v1:" + "b".repeat(64) }, "17"));
});
test("public avatar path is query/version/agent bound; bad input makes zero request", async () => {
  const url = "/api/admin/content/support-workbench/leaderboard/17/avatar" + client.leaderboardQueryString({ board: q.board, scope: q.scope, currency: q.currency, month: q.month, expectedVersion: VERSION });
  assert.equal(client.publicLeaderboardAvatar(url, "17", q, VERSION), url);
  calls = [];
  for (const bad of ["https://evil.test" + url, url.replace("/17/", "/18/"), url + "&assetVersion=1", url + "&board=deposit", url.replace("currency=USDT", "currency=NEX"), url.replace("month=2026-10", "month=2026-09"), url + "#bad", url.replace("scope=all", "scope=ownGroup")]) await assert.rejects(client.fetchLeaderboardAvatar(bad, "17", q, VERSION, new AbortController().signal));
  assert.equal(calls.length, 0);
  fetchResponse = new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }); const controller = new AbortController(); const blob = await client.fetchLeaderboardAvatar(url, "17", q, VERSION, controller.signal); assert.equal(blob.size, 4); assert.equal(calls[0].init.signal, controller.signal);
  fetchResponse = new Response("json", { status: 403 }); await assert.rejects(client.fetchLeaderboardAvatar(url, "17", q, VERSION, controller.signal), error => error.status === 403);
  fetchResponse = new Response("json", { headers: { "Content-Type": "application/json" } }); await assert.rejects(client.fetchLeaderboardAvatar(url, "17", q, VERSION, controller.signal));
});
test("M6 compatibility preserves explicit menu denials and private M1/M3 rights", () => {
  const nav = load("lib/nav/console-nav.ts", { "lucide-react": new Proxy({}, { get: () => () => null }) });
  const allowed = session => nav.resolveVisibleDomains({ role: "support", ...session }); const access = (session, target = "/service/leaderboard") => nav.canAccessResolvedPath(allowed(session), target);
  for (const code of ["m1", "m3"]) { const session = { authorities: [`service_${code}_read`], menuCodes: [code.toUpperCase()] }; assert.equal(access(session), true); assert.equal(access(session, code === "m3" ? "/service/overview" : "/service/sessions"), false); }
  for (const session of [{ authorities: [], menuCodes: ["M1", "M6"] }, { authorities: ["service_m1_read"], menuCodes: [] }, { authorities: ["service_m3_read"], menuCodes: ["M6"] }, { authorities: ["service_m1_read"], menuCodes: ["M1"], menuNodes: [] }, { authorities: ["service_m1_read"], menuCodes: ["M1"], menuNodes: [{ menuCode: "M1", routePath: "/wrong", parentCode: "M" }] }]) assert.equal(access(session), false);
  assert.equal(access({ authorities: ["service_m3_read"] }), true); assert.equal(nav.canAccessResolvedPath(nav.resolveVisibleDomains({ role: "superadmin" }), "/service/leaderboard"), false);
  const valid = { authorities: ["service_m3_read"], menuCodes: ["M3"], menuNodes: [{ menuCode: "M3", routePath: "/service/sessions", parentCode: "M" }] }; assert.equal(access(valid), true);
});
test("binary BFF returns exact public PNG bytes, denies MIME and HTTP errors; old avatars retain policy", async () => {
  let upstream; const originalFetch = globalThis.fetch;
  const routeSource = fs.readFileSync(path.join(root, "app/api/admin/content/[...path]/route.ts"), "utf8");
  const code = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }, transport = [];
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name === "next/headers" ? { cookies: async () => ({ get: () => ({ value: "token" }) }) } : name.includes("require-password") ? { ADMIN_TOKEN_COOKIE: "admin", requirePasswordChangeCleared: () => null } : name.includes("support-image-proxy") ? { boundedUpload: async response => response.arrayBuffer() } : require(name), process: { env: {} }, Response, Headers, Request, URL, AbortSignal, ReadableStream, Uint8Array, fetch: async (url, init) => { transport.push({ url, init }); return upstream; } });
  const get = parts => module.exports.GET(new Request("http://localhost/api/admin/content/" + parts.join("/")), { params: Promise.resolve({ path: parts }) });
  const parts = ["support-workbench", "leaderboard", "17", "avatar"];
  upstream = new Response(new Uint8Array([137,80,78,71,0,255]), { headers: { "Content-Type": "image/png" } }); const response = await get(parts); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137,80,78,71,0,255]); assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff"); assert.equal(response.headers.get("Cache-Control"), "no-store");
  upstream = new Response("bad", { status: 403, headers: { "Content-Type": "image/png" } }); assert.equal((await get(parts)).status, 403);
  upstream = new Response("bad", { headers: { "Content-Type": "image/webp" } }); assert.equal((await get(parts)).status, 502);
  upstream = new Response("old", { headers: { "Content-Type": "image/webp" } }); assert.equal((await get(["support-workbench", "customers", "17", "avatar"])).status, 200);
  assert.equal(globalThis.fetch, originalFetch); assert.equal(transport[0].init.headers.get("Authorization"), "Bearer token");
});
