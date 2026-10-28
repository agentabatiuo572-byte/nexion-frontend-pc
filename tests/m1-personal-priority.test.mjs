import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const analytics = read("app/components/domain-views/m-tabs/m1-analytics-workbench.tsx");
const personal = read("app/components/domain-views/m-tabs/m1-personal-workbench.tsx");
const ast = ts.createSourceFile("analytics.tsx", analytics, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const transpile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let periodEffect, scopeEffect, refresh, drillBody, browse;
const summaryClicks = [];
function find(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("setPersonalPeriod(null)")) periodEffect = node.getText(ast);
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" && node.arguments[0]?.getText(ast).includes("managementReturnQuery.current = null")) scopeEffect = node.getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "refreshScope") refresh = node.getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "drill") drillBody = node.initializer.getText(ast);
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onClick" && node.initializer?.expression?.getText(ast).startsWith("() => drill({")) summaryClicks.push(node.initializer.expression.getText(ast));
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onBrowseCustomers") browse = node.initializer.expression.getText(ast);
  ts.forEachChild(node, find);
}
find(ast);
const flush = () => new Promise(resolve => setImmediate(resolve));

test("personal period uses explicit month/currency, clears missing data and rejects late responses", async () => {
  assert.ok(periodEffect);
  for (const mode of ["PERSONAL", "MANAGED", "ALL"]) {
    const calls = []; let resolve;
    const context = { scope: { scopeSummary: { mode } }, queryState: { month: "2026-09", currency: "UVT" }, AbortController,
      analyticsMonthWindow: month => { assert.equal(month, "2026-09"); return { from: "2026-08-31T16:00:00Z", to: "2026-09-30T16:00:00Z" }; },
      supportAnalyticsClient: { query: options => { calls.push(options); return new Promise(done => { resolve = done; }); } },
      setPersonalPeriod: value => { context.period = value; }, setPersonalPeriodError: value => { context.error = value; }, analyticsErrorText: () => "期间读取失败",
      useEffect: callback => { context.cleanup = callback(); },
    };
    runInNewContext(transpile(periodEffect), context);
    assert.equal(context.period, null);
    if (mode !== "PERSONAL") { assert.equal(calls.length, 0); context.cleanup(); continue; }
    assert.equal(calls[0].basis, "PERIOD_EVENT"); assert.equal(calls[0].currency, "UVT"); assert.equal(calls[0].from, "2026-08-31T16:00:00Z");
    context.cleanup(); resolve({ scopeSummary: { mode: "PERSONAL" }, asOf: "old" }); await flush();
    assert.equal(context.period, null, "an aborted old period cannot become visible");
  }
});

test("scope refresh and failed-period retry retain the personal dashboard or the open customer view", async () => {
  for (const visible of [false, true]) {
    // M-41: one section state replaces the personalAnalytics / operations / groupManagement switches.
    const context = { section: visible ? "stats" : "personal", managementReturnQuery: { current: null }, managementCustomerGroup: { current: null }, queryState: { view: "CUSTOMERS", month: "2026-10", filter: "ALL", sortKey: "TEAM_DEPOSIT" },
      scopeControllerRef: { current: null }, controllerRef: { current: null }, generation: { current: 1 }, AbortController, scopeRetry: 0,
      changeAnalyticsQuery: (state, changes) => ({ ...state, ...changes }),
      supportAnalyticsClient: { query: async () => ({ scopeSummary: { mode: "PERSONAL", groups: [] } }) },
      analyticsEntryAgent: () => undefined, initialAnalyticsQuery: () => { throw new Error("refresh must restore the query"); },
      window: { location: { search: "" } }, URLSearchParams,
      setSection: value => { context.section = typeof value === "function" ? value(context.section) : value; }, setPersonalView() {}, entryTab: () => "home",
      setQueryState: value => { context.query = value; },
      setScopeRetry: callback => { context.scopeRetry = callback(context.scopeRetry); },
      setScope() {}, setScopeError() {}, setData() {}, setProfileId() {}, setError() {}, setKeyword() {},
      useEffect: callback => { context.cleanup = callback(); }, analyticsErrorText: () => "读取失败",
    };
    runInNewContext(transpile(`${refresh}; refreshScope();`), context);
    runInNewContext(transpile(scopeEffect), context); await flush();
    assert.equal(context.section, visible ? "stats" : "personal", "scope reread must preserve the page that triggered refresh");
    assert.equal(context.query.sortKey, "TEAM_DEPOSIT"); context.cleanup();
  }
});

test("all summary drilldowns discard unrelated customer filters while period first keeps CONFIRMED", () => {
  assert.equal(summaryClicks.length, 5, "four primary metrics and the mapped source entry");
  for (let index = 0; index < summaryClicks.length; index++) {
    const context = { queryState: { keyword: "old customer", firstState: "UNKNOWN", filter: "DORMANT", agentId: "22", groupId: "33", category: "PENDING", direction: "ASC", sortKey: "TEAM_DEPOSIT" },
      setSection() {}, setKeyword: value => { context.keywordDraft = value; }, change: changes => { context.query = { ...context.queryState, ...changes }; },
    };
    runInNewContext(transpile(`const drill = ${drillBody}; const click = ${summaryClicks[index]}; click();`), context);
    for (const key of ["keyword", "groupId", "agentId", "direction", "sortKey"]) assert.equal(context.query[key], undefined, key);
    assert.equal(context.keywordDraft, ""); assert.equal(context.query.category, index <= 1 ? "BOUND" : "ALL");
    assert.equal(context.query.firstState, index === 2 ? "CONFIRMED" : "ALL");
    assert.equal(context.query.filter, index === 1 ? "WINDOW_ACTIVE" : "ALL");
  }
});

test("PERSONAL retains ACTIVE and TODO selection and labels without expanding managed filters", () => {
  const declarations = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => ["FILTER_OPTIONS", "PERSONAL_FILTER_OPTIONS"].includes(item.name.getText(ast)))).map(node => node.getText(ast));
  const conditions = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "activeAnalyticsConditions");
  const context = {};
  runInNewContext(transpile(`${declarations.join("\n")}\n${conditions.getText(ast)}\nresult = ["ACTIVE","TODO"].map(filter => ({ option: PERSONAL_FILTER_OPTIONS.find(item => item.value === filter), label: activeAnalyticsConditions({ filter }, [], true)[0].label, managed: FILTER_OPTIONS.some(item => item.value === filter) }));`), context);
  assert.deepEqual(Array.from(context.result, row => row.label), ["服务：当前活跃", "服务：全部待办"]);
  for (const row of context.result) { assert.ok(row.option); assert.equal(row.managed, false); }
  assert.match(analytics, /options=\{isPersonal \? PERSONAL_FILTER_OPTIONS : FILTER_OPTIONS\}/);
  assert.match(analytics, /期间首充（含付费购机）/);
  assert.doesNotMatch(analytics, /期间首充（含实际付费消费）/);
});

test("period failures stay unknown and can retry; lifetime values never supply the period metrics", async () => {
  const context = { scope: { scopeSummary: { mode: "PERSONAL" } }, queryState: { month: "2026-10", currency: "USDT" }, AbortController,
    analyticsMonthWindow: () => ({ from: "start", to: "end" }), supportAnalyticsClient: { query: async () => { throw new Error("unavailable"); } },
    setPersonalPeriod: value => { context.period = value; }, setPersonalPeriodError: value => { context.error = value; }, analyticsErrorText: () => "期间读取失败",
    useEffect: callback => { context.cleanup = callback(); },
  };
  runInNewContext(transpile(periodEffect), context); await flush();
  assert.equal(context.period, null); assert.equal(context.error, "期间读取失败"); context.cleanup();
  const summary = analytics.slice(analytics.indexOf("primarySummary="), analytics.indexOf('{!isPersonal && section === "pool"'));
  assert.match(summary, /当前本人绑定/); assert.match(summary, /当前统计期活跃/); assert.match(summary, /期间首充/); assert.match(summary, /期间净贡献/);
  assert.doesNotMatch(summary, /ownLifetime|firstConfirmed|\?\? 0/);
  assert.match(summary, /firstCandidates \?\? \{ observed: null, confirmed: null, status: "UNKNOWN" \}/);
  assert.match(summary, /firstSources/); assert.match(summary, /"deposits", "purchases"/);
});

test("customer entry reuses the detailed list and preserves unchanged category, sorting and page on return", () => {
  assert.ok(browse);
  const calls = [], context = { queryState: { view: "CUSTOMERS", basis: "CURRENT_CUSTOMER_HISTORY", filter: "ALL", category: "BOUND", sortKey: "TEAM_DEPOSIT", pageNum: 3 }, setSection: value => { context.visible = value === "stats"; }, drill: value => calls.push(value) };
  runInNewContext(`${transpile(`const browse = ${browse};`)} browse("ALL");`, context);
  assert.equal(context.visible, true); assert.equal(calls.length, 0); assert.equal(context.queryState.sortKey, "TEAM_DEPOSIT"); assert.equal(context.queryState.pageNum, 3);
  runInNewContext(`${transpile(`const open = ${browse};`)} open("WAITING_REPLY");`, context);
  assert.equal(calls[0].filter, "WAITING_REPLY"); assert.equal(calls[0].category, "BOUND");
  assert.match(personal, /if \(onBrowseCustomers\) \{ onBrowseCustomers\(next\); return; \}/);
  for (const key of ["boundCustomers", "windowActiveCustomers", "dormantCustomers", "dueMaintenanceCustomers", "waitingReplyCustomers", "firstContactCustomers"]) assert.match(personal, new RegExp(key));
  // M-41: 我的数据 is a tab; there is no "返回我的工作台" button any more.
  assert.match(analytics, /"my-data": "我的数据"/);
});
