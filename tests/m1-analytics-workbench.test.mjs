import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import * as systemBrand from "../lib/admin/brand-copy.ts";
import "./support-compact-empty.test.mjs";

const frontend = process.env.SUPPORT_ANALYTICS_FE_ROOT || fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(frontend, "package.json")), ts = require("typescript"), React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const jsxRuntime = require("react/jsx-runtime");
const stage = fileURLToPath(new URL("../", import.meta.url));
const componentPath = path.join(process.env.SUPPORT_ANALYTICS_SOURCE_ROOT || (existsSync(path.join(stage, "app/components/domain-views/m-tabs/m1-analytics-workbench.tsx")) ? stage : frontend), "app/components/domain-views/m-tabs/m1-analytics-workbench.tsx");
const baseView = path.join(frontend, "app/components/domain-views/m-view.tsx");
const clientPath = path.join(frontend, "lib/admin/support-analytics-client.ts");
const { SupportClientError } = await import(pathToFileURL(path.join(frontend, "lib/admin/m-support-client.ts")).href);
const businessTime = await import(pathToFileURL(path.join(frontend, "lib/admin/business-time.ts")).href);
const clientSource = ts.transpileModule(readFileSync(clientPath, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2017 } }).outputText;
const nativeClientSource = clientSource.replace(/from "\.\/(m-support-client|business-time)\.ts"/g, (_, name) => `from ${JSON.stringify(pathToFileURL(path.join(frontend, "lib/admin", `${name}.ts`)).href)}`);
const { supportAnalyticsClient: nativeClient } = await import(`data:text/javascript;base64,${Buffer.from(nativeClientSource).toString("base64")}`);
let driver, auth = { session: { adminId: 12, authorities: ["service_m1_read"], menuCodes: [], role: "support" }, authEpoch: 1 };
const requests = [], navigations = [];
const calendar = [
  { month: "2026-10", from: "2026-09-30T16:00:00Z", to: "2026-10-31T16:00:00Z" },
  { month: "2026-09", from: "2026-08-31T16:00:00Z", to: "2026-09-30T16:00:00Z" },
];
let forcedQueryError;
let calendarReply = async () => calendar;
const calendarCalls = [];
const scopeEvents = new EventTarget();
const context = vm.createContext({ console, AbortController, URL, URLSearchParams, Date, Intl, Number, Object, Math, queueMicrotask, window: { location: new URL("https://fixture.invalid/service/workbench"), history: { replaceState(_state, _unused, url) { context.window.location.href = String(url); } }, addEventListener: scopeEvents.addEventListener.bind(scopeEvents), removeEventListener: scopeEvents.removeEventListener.bind(scopeEvents) } });
const synthetic = (values) => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
// Execute the actual client's sanitizer before every component fixture transport call.
// No hand-copied enum/default validation can mask an invalid UI-generated payload.
const validatorModule = new vm.SourceTextModule(`${clientSource}\nexport { query as validateQuery };`, { context });
await validatorModule.link(name => synthetic(name === "./business-time.ts" ? businessTime : { supportRequest() { throw new Error("validator must not perform transport"); } }));
await validatorModule.evaluate();
const formatterSource = ts.transpileModule(readFileSync(path.join(existsSync(path.join(stage, "app/components/domain-views/m-tabs/support-leaderboard.tsx")) ? stage : frontend, "app/components/domain-views/m-tabs/support-leaderboard.tsx"), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 } }).outputText;
const formatterModule = new vm.SourceTextModule(formatterSource, { context });
await formatterModule.link(name => synthetic(name === "@/lib/admin/brand-copy" ? systemBrand : name === "react" ? React : name === "react/jsx-runtime" ? jsxRuntime : name === "lucide-react" ? Object.fromEntries(["ArrowRight", "ChevronDown", "Home", "Users", "MessageSquareMore", "ChartNoAxesColumn", "LayoutGrid", "FileText", "MapPin"].map(key => [key, require("lucide-react")[key]])) : {}));
await formatterModule.evaluate();
const mocks = {
  "@/lib/admin/brand-copy": systemBrand,
  "@/lib/admin/business-time": businessTime,
  react: { ...React, useState: (...args) => driver.useState(...args), useRef: (...args) => driver.useRef(...args), useEffect: (...args) => driver.useEffect(...args) },
  "react/jsx-runtime": jsxRuntime,
  "next/navigation": { useRouter: () => ({ push: href => navigations.push(href) }) },
  "next/dynamic": { default: loader => { const source = loader.toString(); return mocks[source.match(/import\("([^"]+)"\)/)[1]][source.match(/\.then\(\(?\w+\)?\s*=>\s*\w+\.(\w+)/)[1]]; } },
  "../domain-module-state": { DomainModuleLoading: () => React.createElement("p", { role: "status" }, "正在加载页面功能…") },
  "@/lib/admin/support-analytics-client": { supportAnalyticsClient: { months: signal => { calendarCalls.push(signal); return calendarReply(signal); }, query: options => { validatorModule.namespace.validateQuery(options); if (forcedQueryError) throw forcedQueryError; return new Promise((resolve, reject) => requests.push({ options, resolve, reject })); } } },
  "@/lib/admin/m-support-client": { SupportClientError },
  "@/lib/admin/shell-authorities": { adminShellSessionKey: (s, e) => `${e}:${s?.adminId}:${s?.authorities.join(",")}` },
  "@/lib/store/admin-auth": { useAdminAuth: selector => selector(auth) },
  "../design-kit": { Modal: props => React.createElement("aside", { role: "dialog" }, props.children) },
  "./hd-ui": { HDSelect: props => React.createElement("div", { "data-house-select": props.value }, props.options.map(o => React.createElement("span", { key: o.value }, o.label))) },
  "./m1-personal-workbench": { SupportSeatRolesButton: () => null, M1PersonalWorkbench: props => React.createElement("section", { "data-personal-workbench": true }, props.primarySummary, "原服务待办", React.createElement("button", { type: "button", onClick: () => props.onBrowseCustomers?.("ALL") }, "我的客户")) },
  "./m1-supervisor-pool": { M1SupervisorPool: props => React.createElement("section", { "data-supervisor-pool": props.permission }) },
  "./m1-live-service": { M1LiveService: () => React.createElement("section", { "data-live-service": true }) },
  "./m1-group-management": { M1GroupManagement: props => React.createElement("section", { "data-group-management": props.mode }, "分组管理") },
  "./m3-customer-profile": { M3CustomerProfile: props => React.createElement("section", { "data-profile": props.customerId }, "原客户资料权限") },
  "./support-avatar": { SupportAvatar: props => React.createElement("span", { "data-avatar-path": props.path }, props.name) },
  "./support-leaderboard": { compactSupportBoardValue: formatterModule.namespace.compactSupportBoardValue },
  "./analytics-freshness": { AnalyticsFreshness: props => React.createElement("span", { "data-statistics-asof": props.asOf }) },
  "./m1-analytics-workbench.css": {},
  "./m1-personal-priority.css": {},
};
const compiled = ts.transpileModule(readFileSync(componentPath, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2017 } }).outputText;
const module = new vm.SourceTextModule(`${compiled}\nexport { ResolvedAnalyticsWorkbench };`, { context });
await module.link(specifier => { assert.ok(Object.hasOwn(mocks, specifier), specifier); return synthetic(mocks[specifier]); });
await module.evaluate();
const { initialAnalyticsQuery, changeAnalyticsQuery, nextAnalyticsPage, analyticsWireQuery, analyticsMonthWindow, analyticsBusinessMonth, analyticsMonths, analyticsOptionIndex, analyticsEntryAgent, AnalyticsTable, M1AnalyticsWorkbench, ResolvedAnalyticsWorkbench, analyticsErrorText } = module.namespace;

class HookDriver {
  slots = []; cursor = 0; effects = []; pending = true; tree; entrySearch = context.window.location.search;
  useState(initial) {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = typeof initial === "function" ? initial() : initial;
    return [this.slots[index], value => { const next = typeof value === "function" ? value(this.slots[index]) : value; if (!Object.is(next, this.slots[index])) { this.slots[index] = next; this.pending = true; } }];
  }
  useRef(initial) { const index = this.cursor++; return this.slots[index] ??= { current: initial }; }
  useEffect(callback, dependencies) {
    const index = this.cursor++, old = this.slots[index];
    if (!old || dependencies.some((x, i) => !Object.is(x, old.dependencies[i]))) this.effects.push(() => { old?.cleanup?.(); this.slots[index] = { dependencies, cleanup: callback() }; });
  }
  render() { driver = this; let count = 0; while (this.pending) { assert.ok(++count < 20, "effect loop"); this.pending = false; this.cursor = 0; this.tree = ResolvedAnalyticsWorkbench({ permission: "agent", ctx: {} }); const effects = this.effects.splice(0); effects.forEach(run => run()); } return this.tree; }
  async settle() { await new Promise(resolve => setImmediate(resolve)); return this.render(); }
  unmount() { this.slots.forEach(slot => slot?.cleanup?.()); context.window.location.search = this.entrySearch; }
}
function elements(node, result = []) {
  if (!node || typeof node !== "object") return result;
  if (node.props?.hidden) return result;
  if (Array.isArray(node)) { node.forEach(x => elements(x, result)); return result; }
  if (node.props) { result.push(node); elements(node.props.children, result); if (node.type === mocks["./m1-personal-workbench"].M1PersonalWorkbench) elements(node.type(node.props), result); }
  return result;
}
function content(node) { return typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(content).join("") : node?.props ? content(node.props.children) : ""; }
function button(tree, label) { const matches = elements(tree).filter(x => x.type === "button" && content(x) === label); assert.equal(matches.length, 1, label); return matches[0]; }
test("support leaderboard loading controls lock every tab and empty filter until ready", () => {
  const option = [{ value: "USDT", label: "USDT" }];
  for (const status of ["loading", "error", "empty", "ready"]) {
    for (const board of ["netContribution", "firstPayment", "customers"]) {
      const html = renderToStaticMarkup(React.createElement(formatterModule.namespace.SupportLeaderboard, {
        query: { board, month: "2026-10", scope: "all", currency: "USDT" }, status,
        monthOptions: status === "ready" ? [{ value: "2026-10", label: "2026.10" }] : [],
        scopeOptions: status === "ready" ? [{ value: "all", label: "全员榜" }] : [],
        currencyOptions: status === "ready" ? option : [], rows: [],
        currentMonth: "2026-10", periodLabel: "2026-10", updatedAt: "尚未读取", disclosure: "公开成绩",
        onQueryChange() {}, onRetry() {}, onLocateSelf() {}, onViewPerformance() {},
      }));
      const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
      assert.equal(tabs.length, 3);
      assert.equal(tabs.filter(tab => /aria-selected="true"/.test(tab)).length, 1);
      assert.equal(tabs.filter(tab => /tabindex="0"/.test(tab)).length, 1);
      for (const tab of tabs) {
        assert.equal(/\bdisabled=""/.test(tab), status !== "ready", `${status}/${board}: tab availability`);
        if (status !== "ready") assert.match(tab, /title="[^"]+(切换|不可用)/);
      }
      const filters = [...html.matchAll(/<select\b[^>]*>/g)].map(match => match[0]);
      assert.equal(filters.length, board === "customers" ? 2 : 3);
      for (const select of filters) assert.equal(/\bdisabled=""/.test(select), status !== "ready", `${status}/${board}: empty filter availability`);
      if (status === "loading") assert.match(html, /加载完成后切换榜单/);
      if (status === "error") { assert.match(html, /重试后切换榜单/); assert.match(html, />重试<\/button>/); }
      if (status === "empty") assert.match(html, /暂不能切换/);
      if (status === "ready") { assert.match(html, /<table/); assert.doesNotMatch(html, /加载完成后切换榜单|重试后切换榜单|暂不能切换/); }
    }
  }
});
const version = `saq-v1:${"a".repeat(64)}`;
const count = (n = 1) => ({ observed: n, confirmed: n, status: "AVAILABLE" });
const unknown = () => ({ observed: null, confirmed: null, status: "UNKNOWN" });
const money = () => ({ observed: "999999999999.123456", confirmed: null, status: "PARTIAL" });
const current = () => ({ firstConfirmed: count(), firstNone: count(0), firstUnknown: count(0), ownLifetime: [{ currency: "USDT", deposits: money() }], devices: { held: count() }, activity: { active: count(), status: "AVAILABLE", window: { days: 7, from: "2026-10-02T00:00:00Z", through: "2026-10-09T00:00:00Z", status: "AVAILABLE" } } });
const personnel = () => ({ serviceAccounts: count(), supervisors: unknown(), groups: count() });
const funds = () => ({ balanceStatus: "UNAVAILABLE", withdrawalStatus: "UNAVAILABLE" });
function fixture(view = "OVERVIEW", mode = "MANAGED") {
  const customer = { customerId: "12", nickname: "很长的客户显示名称用于截断测试", customerNo: "C012", avatar: "/api/admin/content/support-workbench/customers/12/avatar", owner: { agentName: "专属客服" }, first: { state: "UNKNOWN", kind: null }, invitations: { direct: unknown(), descendants: unknown(), deposits: [] }, lifetime: [{ currency: "USDT", deposits: money() }], activity: { state: "UNKNOWN", lastEffectiveAt: null }, task: { status: "UNAVAILABLE" } };
  const agent = { accountId: "7", displayName: "客服A", avatar: null, avatarRef: null, account: { groupId: "4", serviceAccount: true, supervisorAccount: false, accountState: "ENABLED", serviceQualification: "ENABLED", handoverRequired: false }, current: current(), funds: funds() };
  const financial = { firstCandidates: count(), currencies: [{ currency: "USDT", deposits: money(), purchases: money(), net: { observed: null, confirmed: null, status: "UNKNOWN" } }] };
  return { view, basis: "CURRENT_CUSTOMER_HISTORY", asOf: "2026-10-09T00:00:00Z", selectedCurrent: current(), selectedCustomerCount: 1, scopeSummary: { mode, bound: 1, pending: 0, anomaly: 0, current: current(), financial, personnel: personnel(), groups: [{ groupId: "4", name: "甲组", total: 1, current: current(), personnel: personnel() }, { groupId: "5", name: "乙组", total: 1, current: current(), personnel: personnel() }] }, funds: { ...funds(), groups: [] }, records: [view === "AGENTS" ? agent : view === "FINANCE" ? { customerId: "12", nickname: "客户", customerNo: "C012", kind: "DEPOSIT", currency: "USDT", amount: "3.123456", succeededAt: "2026-10-09T00:00:00Z", historyStatus: "UNKNOWN", orderNo: null } : view === "DEVICES" ? { deviceId: "9", customerId: "12", deviceType: null, hashrate: null, holdingStatus: "UNKNOWN", connectionStatus: "NOT_APPLICABLE", acquisition: "UNKNOWN" } : customer], versionState: "READY", queryVersion: version, canContinue: false, pageNum: 1, pageSize: 20, total: 1, observedTotal: 1, recordsStatus: "READY" };
}
async function resolveScope(mode = "MANAGED") { const d = new HookDriver(); d.render(); requests.at(-1).resolve(fixture("OVERVIEW", mode)); await d.settle(); return d; }

test("global default entry renders its authorized USDT response once, while explicit refresh reads again", async () => {
  const before = requests.length, d = await resolveScope("ALL");
  try {
    assert.equal(requests.length, before + 1, "scope and default statistics share one request");
    assert.equal(requests.at(-1).options.currency, "USDT");
    assert.match(content(d.tree), /平台运营总览/);
    assert.doesNotMatch(content(d.tree), /正在加载当前范围的数据/);
    button(d.tree, "刷新").props.onClick(); d.render();
    assert.equal(requests.length, before + 2);
    requests.at(-1).resolve(fixture("OVERVIEW", "ALL")); await d.settle();
    assert.equal(requests.length, before + 2, "new authorized response also serves refreshed default statistics");
  } finally { d.unmount(); }
});

test("current-customer statistics do not request an unused month calendar", async () => {
  const beforeCalendar = calendarCalls.length;
  const d = await resolveScope("MANAGED");
  try {
    const current = requests.at(-1), before = requests.length;
    await d.settle();
    assert.equal(calendarCalls.length, beforeCalendar);
    assert.equal(requests.length, before);
    assert.equal(current.options.signal.aborted, false);
    current.resolve(fixture("AGENTS")); await d.settle();
    assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 1);
  } finally { d.unmount(); }
});

test("statistics freshness uses the displayed response timestamp and manual refresh reads a newly completed version", async () => {
  const d = await resolveScope("ALL");
  try {
    await d.settle();
    const stamp = () => elements(d.tree).find(x => x.type === mocks["./analytics-freshness"].AnalyticsFreshness);
    assert.equal(stamp().props.asOf, fixture("OVERVIEW", "ALL").asOf);
    const before = requests.length; stamp().props.onRefresh(); d.render();
    assert.equal(requests.length, before + 1);
    assert.equal(stamp(), undefined, "a pending permission check must not retain the old statistics stamp");
    const next = fixture("OVERVIEW", "ALL"); next.asOf = "2026-10-29T01:01:59.123456Z";
    requests.at(-1).resolve(next); await d.settle(); await d.settle();
    assert.equal(stamp().props.asOf, next.asOf);
    assert.equal(requests.length, before + 1, "refresh reuses the completed identical query without a second computation request");
    assert.equal(Object.hasOwn(requests.at(-1).options, "forceRefresh"), false);
  } finally { d.unmount(); }
});

test("current MANAGED session hint starts AGENTS and reuses the fully authorized identical response", async () => {
  auth.session.supportReadModes = ["MANAGED"];
  const before = requests.length, d = new HookDriver(); d.render();
  try {
    assert.equal(requests.at(-1).options.view, "AGENTS");
    assert.match(content(d.tree), /正在核对/);
    requests.at(-1).resolve(fixture("AGENTS", "MANAGED")); await d.settle(); await d.settle();
    assert.equal(requests.length, before + 1);
    assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 1);
    button(d.tree, "刷新").props.onClick(); d.render();
    assert.equal(requests.length, before + 2, "manual refresh still checks current server authority");
  } finally { d.unmount(); delete auth.session.supportReadModes; }
});

test("stale MANAGED hint cannot reuse AGENTS rows after the response resolves PERSONAL scope", async () => {
  auth.session.supportReadModes = ["MANAGED"];
  const before = requests.length, d = new HookDriver(); d.render();
  try {
    requests.at(-1).resolve(fixture("AGENTS", "PERSONAL")); await d.settle();
    assert.doesNotMatch(content(d.tree), /我的分组数据|平台运营总览|客服与分组/);
    button(d.tree, "我的数据").props.onClick(); d.render();
    assert.equal(requests.at(-1).options.view, "CUSTOMERS");
    assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
    assert.ok(requests.length > before + 1);
  } finally { d.unmount(); delete auth.session.supportReadModes; }
});

test("a denied stale hinted projection rechecks universal overview; a second denial stays closed", async () => {
  auth.session.supportReadModes = ["MANAGED"];
  const d = new HookDriver(); d.render();
  try {
    requests.at(-1).reject(new SupportClientError(403)); await d.settle();
    assert.equal(requests.at(-1).options.view, "OVERVIEW");
    assert.match(content(d.tree), /正在核对/);
    requests.at(-1).reject(new SupportClientError(403)); await d.settle();
    assert.match(content(d.tree), /当前范围已无查看权限/);
    assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
  } finally { d.unmount(); delete auth.session.supportReadModes; }
});

test("period calendar failure remains unknown, retries, and only then requests exact server boundaries", async () => {
  calendarReply = async () => { throw new SupportClientError(503); };
  const d = await resolveScope("MANAGED");
  try {
    elements(d.tree).find(x => x.props?.label === "统计规则").props.onChange("PERIOD_EVENT"); d.render();
    const before = requests.length; await d.settle();
    assert.match(content(d.tree), /统计来源暂不可用/);
    assert.equal(requests.length, before);
    assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
    calendarReply = async () => calendar;
    button(d.tree, "重试读取月份").props.onClick(); d.render(); await d.settle();
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).options.from, calendar[0].from);
  } finally { d.unmount(); calendarReply = async () => calendar; }
});

test("entering the pool cannot retain an old scope response for a later statistics visit", async () => {
  context.window.location.search = "?view=pool";
  const before = requests.length, d = await resolveScope("ALL");
  try {
    assert.equal(requests.length, before + 1);
    button(d.tree, "数据").props.onClick(); d.render();
    assert.equal(requests.length, before + 2, "returning to statistics requires a current response");
  } finally { d.unmount(); context.window.location.search = ""; }
});

test("scope invalidation closes group management and rechecks permitted groups", async () => {
  const d = await resolveScope();
  try {
    button(d.tree, "甲组").props.onClick(); d.render();
    const stale = requests.at(-1);
    button(d.tree, "客服与分组").props.onClick(); d.render();
    assert.ok(elements(d.tree).some(x => x.type === mocks["./m1-group-management"].M1GroupManagement));
    scopeEvents.dispatchEvent(new Event("support-scope-invalidated")); d.render();
    assert.equal(stale.options.signal.aborted, true);
    assert.ok(!elements(d.tree).some(x => x.type === mocks["./m1-group-management"].M1GroupManagement));
    assert.match(content(d.tree), /正在核对当前可见范围/);
    const fresh = requests.at(-1), next = fixture(); next.scopeSummary.groups = next.scopeSummary.groups.slice(1);
    stale.resolve(fixture("AGENTS")); await d.settle();
    assert.match(content(d.tree), /正在核对当前可见范围/);
    fresh.resolve(next); await d.settle();
    assert.doesNotMatch(content(d.tree), /甲组/); button(d.tree, "数据").props.onClick(); d.render(); button(d.tree, "乙组");
    assert.equal(requests.at(-1).options.groupId, undefined);
    assert.equal(requests.at(-1).options.agentId, undefined);
  } finally { d.unmount(); }
});

test("scope invalidation rejects a late initial scope response", async () => {
  const d = new HookDriver(); d.render();
  try {
    const stale = requests.at(-1);
    scopeEvents.dispatchEvent(new Event("support-scope-invalidated")); d.render();
    const fresh = requests.at(-1); assert.notEqual(fresh, stale); assert.equal(stale.options.signal.aborted, true);
    fresh.resolve(fixture("OVERVIEW", "PERSONAL")); await d.settle();
    stale.resolve(fixture("OVERVIEW", "ALL")); await d.settle();
    assert.doesNotMatch(content(d.tree), /平台运营总览|我的分组数据|分组管理/);
  } finally { d.unmount(); }
});

test("manual scope refresh updates group tabs as well as table data", async () => {
  const d = await resolveScope();
  try {
    elements(d.tree).find(x => x.props?.label === "排序").props.onChange("BOUND_CUSTOMER_COUNT"); d.render();
    elements(d.tree).find(x => x.props?.label === "顺序").props.onChange("ASC"); d.render();
    button(d.tree, "刷新").props.onClick(); d.render();
    assert.equal(requests.at(-1).options.view, "OVERVIEW");
    const next = fixture(); next.scopeSummary.groups[0].name = "接管的新组";
    requests.at(-1).resolve(next); await d.settle();
    button(d.tree, "接管的新组"); assert.doesNotMatch(content(d.tree), /甲组/);
    assert.equal(requests.at(-1).options.sortKey, "BOUND_CUSTOMER_COUNT");
    assert.equal(requests.at(-1).options.direction, "ASC");
  } finally { d.unmount(); }
});

test("actual customer and advisor tables display signed NET while keeping recharge and first-payment columns",()=>{
  for(const view of ["CUSTOMERS","AGENTS"]) {
    const data=fixture(view), totals=view==="CUSTOMERS"?data.records[0].lifetime:data.records[0].current.ownLifetime;
    totals[0].net={observed:"-123456.000001",confirmed:"-123456.000001",status:"AVAILABLE"};
    const html=renderToStaticMarkup(React.createElement(AnalyticsTable,{data,currency:"USDT",drill(){},openProfile(){}}));
    assert.match(html,/累计净贡献/);assert.match(html,/-123456\.000001/);assert.match(html,view==="CUSTOMERS"?/本人累充/:/客户累计充值/);assert.match(html,/首充/);
    totals[0].net={observed:null,confirmed:null,status:"UNKNOWN"};
    const missing=renderToStaticMarkup(React.createElement(AnalyticsTable,{data,currency:"USDT",drill(){},openProfile(){}}));
    assert.doesNotMatch(missing,/-123456\.000001/);assert.match(missing,/累计净贡献[^>]*：资料未同步/);
  }
});
test("actual finance table labels general paid consumption without calling it a refund",()=>{
  const data=fixture("FINANCE");data.records[0].kind="CONSUMPTION";
  const html=renderToStaticMarkup(React.createElement(AnalyticsTable,{data,currency:"USDT",drill(){},openProfile(){}}));
  assert.match(html,/付费消费/);assert.doesNotMatch(html,/购机退款/);
});

test("activity coverage preserves observed zero, unavailable state and trustworthy zero in summary and agents", async () => {
  // Bug527's natural selectedCurrent.activity (PARTIAL + UNKNOWN window).
  const naturalActivity = { active: { observed: 0, confirmed: 0, status: "PARTIAL" }, inactive: { observed: 0, confirmed: 0, status: "PARTIAL" }, unknown: { observed: 0, confirmed: 0, status: "AVAILABLE" }, status: "PARTIAL", window: { days: null, from: null, through: "2026-10-11T06:23:01.011944Z", status: "UNKNOWN" } };
  const naturalFirstConfirmed = count(0);
  if (process.env.SUPPORT_ACTIVITY_NATURAL_EVIDENCE) {
    const live = JSON.parse(readFileSync(process.env.SUPPORT_ACTIVITY_NATURAL_EVIDENCE, "utf8")).body.data;
    assert.deepEqual(live.selectedCurrent.activity, naturalActivity, "the regression must use the current natural DTO");
    assert.deepEqual(live.selectedCurrent.firstConfirmed, naturalFirstConfirmed, "preserve the natural AVAILABLE zero from another count in the same response");
    assert.equal(live.versionState, "UNKNOWN"); assert.equal(live.total, null);
  }
  const cases = [
    [naturalActivity, /已观测 0，完整数值仍在统计/, /已核实 0|资料暂不可用/],
    [{ ...naturalActivity, active: count(0) }, /已观测 0，完整数值仍在统计/, /已核实 0/],
    [{ ...current().activity, status: "PARTIAL", active: count(0) }, /已观测 0，完整数值仍在统计/, /已核实 0/],
    [{ ...naturalActivity, active: unknown(), status: "UNKNOWN" }, /资料未同步/, /已核实 0|已观测 0|资料暂不可用/],
    [{ ...current().activity, active: { observed: null, confirmed: null, status: "UNAVAILABLE" }, status: "UNAVAILABLE" }, /资料暂不可用/, /已核实 0|已观测 0/],
    [{ ...current().activity, status: "FAILED", active: count(0) }, /资料暂不可用/, /已核实 0/],
    [{ ...current().activity, active: count(0), window: { ...current().activity.window, status: "UNAVAILABLE" } }, /资料暂不可用/, /已核实 0/],
    [{ ...current().activity, active: count(0) }, /已核实 0/, /待核实|资料暂不可用/],
  ];
  for (const [activity, expected, forbidden] of cases) {
    const data = fixture("AGENTS"); data.selectedCurrent.activity = activity; data.selectedCurrent.firstConfirmed = naturalFirstConfirmed; data.records[0].current.activity = activity;
    const d = await resolveScope();
    try {
      requests.at(-1).resolve(data); await d.settle();
      const html = renderToStaticMarkup(React.createElement("div", null, elements(d.tree).find(x => x.props?.["aria-label"] === "所选范围汇总")));
      assert.match(html, /aria-label="当前客户已首充：已核实 0；查看明细"/);
      const labels = [...html.matchAll(/aria-label="当前统计期活跃：([^"]+)"/g)].map(match => match[1]);
      const table = renderToStaticMarkup(React.createElement(AnalyticsTable, { data, currency: "USDT", drill() {}, openProfile() {} }));
      labels.push(...[...table.matchAll(/aria-label="当前统计期活跃：([^"]+)"/g)].map(match => match[1]));
      assert.equal(labels.length, 2, "both activity count surfaces must be checked");
      for (const label of labels) { assert.match(label, expected); assert.doesNotMatch(label, forbidden); }
    } finally { d.unmount(); }
  }
});

test("stage strict TS checks candidate and exact m-view delta against actual installed modules", () => {
  const config = ts.readConfigFile(path.join(frontend, "tsconfig.json"), ts.sys.readFile);
  const options = { ...ts.parseJsonConfigFileContent(config.config, ts.sys, frontend).options, incremental: false, noEmit: true, baseUrl: frontend, paths: { "@/*": ["./*"] } };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containing) => names.map(name => {
    let reference = containing;
    if (containing.startsWith(stage.replaceAll("\\", "/"))) {
      const staged = name.startsWith(".") ? path.resolve(path.dirname(containing), name) : "";
      if (!staged || ![".ts", ".tsx"].some(ext => ts.sys.fileExists(staged + ext))) reference = containing.replace(stage.replaceAll("\\", "/"), frontend.replaceAll("\\", "/") + "/");
    }
    return ts.resolveModuleName(name, reference, options, host).resolvedModule;
  });
  const program = ts.createProgram([componentPath, path.join(stage, "app/components/domain-views/m-view.tsx"), path.join(stage, "app/components/domain-views/registry.tsx"), path.join(frontend, "node_modules/next/types/global.d.ts")], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => frontend, getCanonicalFileName: x => x, getNewLine: () => "\n" }));
  const original = readFileSync(baseView, "utf8").replaceAll("\r\n", "\n"), staged = readFileSync(path.join(stage, "app/components/domain-views/m-view.tsx"), "utf8").replaceAll("\r\n", "\n");
  assert.equal(staged, original.replace('import { M1PersonalWorkbench } from "./m-tabs/m1-personal-workbench";', 'import { M1AnalyticsWorkbench } from "./m-tabs/m1-analytics-workbench";').replace('<M1PersonalWorkbench key={authEpoch} permission={permission} ctx={ctx} />', '<M1AnalyticsWorkbench key={authEpoch} permission={permission} ctx={ctx} />'));
});
test("server scope alone picks personal, managed or global initial view", () => {
  assert.equal(initialAnalyticsQuery("PERSONAL").view, "CUSTOMERS"); assert.equal(initialAnalyticsQuery("MANAGED").view, "AGENTS"); assert.equal(initialAnalyticsQuery("ALL").view, "OVERVIEW");
  for (const mode of ["PERSONAL", "MANAGED", "ALL"]) assert.equal(initialAnalyticsQuery(mode).groupId, undefined);
});
test("every query edit clears page/version; group edits additionally clear old agent selection", () => {
  const state = { ...initialAnalyticsQuery("MANAGED"), pageNum: 3, expectedVersion: version, agentId: "7" };
  for (const change of [{ groupId: "5" }, { groupId: undefined }, { month: "2026-09" }, { currency: "UVT" }, { sortKey: "DEVICE_COUNT" }, { direction: "ASC" }, { basis: "PERIOD_EVENT" }, { view: "CUSTOMERS" }, { keyword: "test" }, { filter: "DUE" }]) { const next = changeAnalyticsQuery(state, change); assert.equal(next.pageNum, 1); assert.equal(next.expectedVersion, undefined); }
  assert.equal(changeAnalyticsQuery(state, { groupId: "5" }).agentId, undefined);
  assert.equal(changeAnalyticsQuery(state, { currency: "UVT" }).agentId, "7");
});
test("NET sort uses the current-customer selector and clears when switching basis", async () => {
  const d = await resolveScope("ALL");
  try {
    button(d.tree, "客户").props.onClick(); d.render();
    const select = () => elements(d.tree).find(x => x.props?.label === "排序");
    assert.ok(select().props.options.some(x => x.value === "NET_CONTRIBUTION" && x.label === "净贡献额"));
    select().props.onChange("NET_CONTRIBUTION"); d.render();
    assert.equal(requests.at(-1).options.sortKey, "NET_CONTRIBUTION");
    assert.equal(requests.at(-1).options.currency, "USDT");
    assert.equal(requests.at(-1).options.pageNum, 1);
    assert.equal(requests.at(-1).options.expectedVersion, undefined);
    for (const basis of ["PERIOD_EVENT", "CURRENT_ASSET"]) {
      elements(d.tree).find(x => x.props?.label === "统计规则").props.onChange(basis); d.render(); await d.settle();
      assert.equal(requests.at(-1).options.sortKey, undefined);
      assert.ok(!select().props.options.some(x => x.value === "NET_CONTRIBUTION"));
    }
  } finally { d.unmount(); }
});
test("paging uses only READY signed version and never fabricates continuation", () => {
  const state = initialAnalyticsQuery("MANAGED"), data = fixture("AGENTS");
  assert.equal(nextAnalyticsPage(state, data, 2), null);
  const next = nextAnalyticsPage(state, { ...data, canContinue: true }, 2);
  assert.equal(next.pageNum, 2); assert.equal(next.expectedVersion, version); assert.equal(next.view, "AGENTS");
  assert.equal(nextAnalyticsPage(state, { ...data, canContinue: true, versionState: "UNKNOWN", queryVersion: null }, 2), null);
  assert.equal(nextAnalyticsPage(next, data, 1).pageNum, 1); assert.equal(nextAnalyticsPage(state, { ...data, canContinue: true }, 99), null);
});
test("month windows come from the server calendar, so months on either side of a zone change keep their own zone", () => {
  assert.equal(analyticsBusinessMonth(new Date("2026-09-30T16:00:00Z")), "2026-10");
  const calendar = [
    { month: "2026-12", from: "2026-11-30T15:00:00Z", to: "2026-12-31T15:00:00Z" },
    { month: "2026-11", from: "2026-10-31T16:00:00Z", to: "2026-11-30T15:00:00Z" },
    { month: "2024-02", from: "2024-01-31T16:00:00Z", to: "2024-02-29T16:00:00Z" },
  ];
  assert.deepEqual({ ...analyticsMonthWindow("2026-12", calendar) }, { from: "2026-11-30T15:00:00Z", to: "2026-12-31T15:00:00Z" });
  const period = analyticsMonthWindow("2024-02", calendar); assert.equal(period.from, "2024-01-31T16:00:00Z"); assert.equal(period.to, "2024-02-29T16:00:00Z");
  assert.deepEqual(Array.from(analyticsMonths(calendar), x => x.value), ["2026-12", "2026-11", "2024-02"]); assert.equal(analyticsMonths(calendar)[0].label, "2026年12月");
  assert.throws(() => analyticsMonthWindow("2026-13", calendar)); assert.throws(() => analyticsMonthWindow("2025-01", calendar));
  assert.equal(analyticsWireQuery(initialAnalyticsQuery("MANAGED"), calendar).from, undefined);
  const wire = analyticsWireQuery({ ...initialAnalyticsQuery("MANAGED", "2024-02"), basis: "PERIOD_EVENT", groupId: "5", currency: "UVT" }, calendar);
  assert.equal(wire.groupId, "5"); assert.equal(wire.from, period.from); assert.equal(wire.month, undefined); assert.equal(wire.mode, undefined);
});
test("period queries wait for the server calendar and keep UVT with that month's exact boundaries", async () => {
  let resolveCalendar;
  calendarReply = () => new Promise(resolve => { resolveCalendar = resolve; });
  const d = await resolveScope();
  try {
    const before = requests.length;
    elements(d.tree).find(x => x.props?.label === "统计规则").props.onChange("PERIOD_EVENT"); d.render();
    elements(d.tree).find(x => x.props?.label === "币种").props.onChange("UVT"); d.render();
    assert.equal(requests.length, before, "no period query may invent boundaries before the calendar resolves");
    const month = initialAnalyticsQuery("MANAGED").month;
    const settledMonth = { month, from: "2026-09-30T15:00:00Z", to: "2026-10-31T15:00:00Z" };
    resolveCalendar([settledMonth]); await d.settle();
    assert.equal(requests.length, before + 1);
    const query = requests.at(-1).options;
    assert.equal(query.currency, "UVT"); assert.equal(query.basis, "PERIOD_EVENT");
    assert.equal(query.from, settledMonth.from); assert.equal(query.to, settledMonth.to);
    assert.equal(query.month, undefined);
  } finally { d.unmount(); calendarReply = async () => calendar; }
});

test("initial render is fail-closed until private OVERVIEW resolves; personal keeps original component", async () => {
  const d = new HookDriver(); const initial = d.render(); assert.match(content(initial), /正在核对/); assert.equal(requests.at(-1).options.view, "OVERVIEW");
  requests.at(-1).resolve(fixture("OVERVIEW", "PERSONAL")); await d.settle();
  assert.ok(elements(d.tree).some(x => x.type === mocks["./m1-personal-workbench"].M1PersonalWorkbench)); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0); d.unmount();
});
test("managed view queries AGENTS despite legacy permission=agent; group change aborts/ignores old result", async () => {
  const d = await resolveScope(); const older = requests.at(-1); assert.equal(older.options.view, "AGENTS");
  button(d.tree, "乙组").props.onClick(); d.render(); const selected = requests.at(-1); assert.equal(selected.options.groupId, "5"); assert.equal(selected.options.pageNum, 1); assert.equal(selected.options.expectedVersion, undefined); assert.equal(selected.options.mode, undefined); assert.equal(older.options.signal.aborted, true);
  older.resolve(fixture("AGENTS")); await d.settle(); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
  selected.resolve(fixture("AGENTS")); await d.settle(); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 1); d.unmount();
});
test("group management replaces the statistics list and rechecks scope before returning", async () => {
  const d = await resolveScope();
  button(d.tree, "乙组").props.onClick(); d.render();
  const stale = requests.at(-1);
  button(d.tree, "客服与分组").props.onClick(); d.render();
  assert.equal(stale.options.signal.aborted, true);
  const editor = elements(d.tree).find(x => x.type === mocks["./m1-group-management"].M1GroupManagement);
  assert.equal(editor.props.mode, "MANAGED"); assert.equal(editor.props.initialGroupId, "5");
  assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
  editor.props.onChanged(); button(d.tree, "数据").props.onClick(); d.render();
  const refreshed = requests.at(-1); assert.equal(refreshed.options.view, "OVERVIEW");
  stale.resolve(fixture("AGENTS")); await d.settle(); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
  const freshScope = fixture(); freshScope.scopeSummary.groups = freshScope.scopeSummary.groups.filter(g => g.groupId !== "5");
  refreshed.resolve(freshScope); await d.settle();
  assert.equal(requests.at(-1).options.pageNum, 1); assert.equal(requests.at(-1).options.groupId, undefined);
  assert.equal(requests.at(-1).options.agentId, undefined); assert.equal(requests.at(-1).options.expectedVersion, undefined);
  d.unmount();
});
test("managed pending-pool operations use the actual scope despite an obsolete agent role hint", async () => {
  const d = await resolveScope();
  button(d.tree, "待分配").props.onClick(); d.render();
  const service = elements(d.tree).find(x => x.type === mocks["./m1-supervisor-pool"].M1SupervisorPool);
  assert.equal(service.props.permission, "supervisor");
  assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
  d.unmount();
});
test("directory customer counts reauthorize and open the selected group and category", async () => {
  for (const category of ["BOUND", "PENDING"]) {
    const d=await resolveScope(); button(d.tree,"客服与分组").props.onClick(); d.render();
    const editor=elements(d.tree).find(x=>x.type===mocks["./m1-group-management"].M1GroupManagement);
    editor.props.onViewCustomers("5",category);d.render(); assert.equal(requests.at(-1).options.view,"OVERVIEW");
    requests.at(-1).resolve(fixture());await d.settle();
    const q=requests.at(-1).options;assert.equal(q.view,"CUSTOMERS");assert.equal(q.groupId,"5");assert.equal(q.category,category);
    assert.equal(q.basis,"CURRENT_CUSTOMER_HISTORY","customer drill must keep first-payment and lifetime-funds fields available");assert.equal(q.agentId,undefined);assert.equal(q.filter,"ALL");assert.equal(q.pageNum,1);assert.equal(q.expectedVersion,undefined);d.unmount();
  }
});
test("a directory customer drill loses access without silently opening every remaining group", async () => {
  const d=await resolveScope();button(d.tree,"客服与分组").props.onClick();d.render();
  const editor=elements(d.tree).find(x=>x.type===mocks["./m1-group-management"].M1GroupManagement);
  editor.props.onViewCustomers("5","BOUND");d.render();const reads=requests.length;
  const next=fixture();next.scopeSummary.groups=next.scopeSummary.groups.filter(g=>g.groupId!=="5");requests.at(-1).resolve(next);await d.settle();
  assert.match(content(d.tree),/无查看权限/);assert.equal(requests.length,reads);assert.equal(elements(d.tree).filter(x=>x.type===AnalyticsTable).length,0);d.unmount();
});
test("cancelled reads ignore late responses and expose retry with preserved conditions", async () => {
  const d = await resolveScope(), pending = requests.at(-1); button(d.tree, "取消读取").props.onClick(); d.render(); assert.equal(pending.options.signal.aborted, true);
  pending.resolve(fixture("AGENTS")); await d.settle(); assert.match(content(d.tree), /已取消加载，筛选条件不变/); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
  button(d.tree, "重试").props.onClick(); d.render(); assert.equal(requests.at(-1).options.view, "AGENTS"); d.unmount();
});
test("409 discards page and exposes first-page refresh; 403 clears all private scope display", async () => {
  const d = await resolveScope(); requests.at(-1).reject(new SupportClientError(409)); await d.settle(); assert.match(content(d.tree), /第一页/);
  button(d.tree, "从第一页重新加载").props.onClick(); d.render(); assert.equal(requests.at(-1).options.pageNum, 1); assert.equal(requests.at(-1).options.expectedVersion, undefined);
  requests.at(-1).reject(new SupportClientError(403)); await d.settle(); assert.match(content(d.tree), /无查看权限/); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0); assert.ok(!content(d.tree).includes("甲组")); d.unmount();
});
test("identity changes replace subtree key and old scope requests are aborted on unmount", () => {
  const first = M1AnalyticsWorkbench({ permission: "agent", ctx: {} }); auth = { ...auth, session: { ...auth.session, adminId: 18 } }; const second = M1AnalyticsWorkbench({ permission: "superadmin", ctx: {} }); assert.notEqual(first.key, second.key);
  const d = new HookDriver(); d.render(); const pending = requests.at(-1); d.unmount(); assert.equal(pending.options.signal.aborted, true);
});
test("all six table view renderings preserve exact tooltip values, unknown text and one table", () => {
  for (const view of ["OVERVIEW", "AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"]) {
    const html = renderToStaticMarkup(React.createElement(AnalyticsTable, { data: fixture(view), currency: "USDT", drill() {}, openProfile() {} }));
    assert.equal((html.match(/<table/g) ?? []).length, 1); assert.match(html, view === "FINANCE" ? /首充历史未同步/ : /aria-label="[^"]*(?:资料未同步|资料暂不可用|已观测 [^"]+，完整数值仍在统计)/); assert.ok(!html.includes("sourceEnvironment"));
    if (["CUSTOMERS", "ACTIVITY", "OVERVIEW", "AGENTS"].includes(view)) { assert.match(html, /999999999999\.123456/); assert.match(html, /已观测/); }
    if (view === "DEVICES") { assert.match(html, /不适用/); assert.ok(!html.includes("离线")); }
  }
});
test("error copy is operator-readable across denied, missing and unavailable service states", () => { for (const status of [401, 403, 404, 409, 503]) { const message = analyticsErrorText(new SupportClientError(status)); assert.ok(!message.includes("SUPPORT_")); assert.ok(message.length > 5); } });

test("device and finance clicks preserve scope conditions and issue only native legal queries", async () => {
  const d = await resolveScope("ALL");
  try {
    button(d.tree, "乙组").props.onClick(); d.render(); requests.at(-1).resolve(fixture("OVERVIEW", "ALL")); await d.settle();
    // M-41 moved pending customers to the dedicated pool; keep that navigation and scope check explicit.
    const pendingMetric = elements(d.tree).find(x => x.props?.label === "待分配客户，打开待分配客户池");
    assert.ok(pendingMetric); pendingMetric.props.onClick(); d.render();
    assert.equal(elements(d.tree).find(x => x.type === mocks["./m1-supervisor-pool"].M1SupervisorPool).props.permission, "superadmin");
    assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0);
    button(d.tree, "数据").props.onClick(); d.render(); requests.at(-1).resolve(fixture("OVERVIEW", "ALL")); await d.settle();
    const anomalyMetric = elements(d.tree).find(x => x.props?.label === "归属异常");
    assert.ok(anomalyMetric); anomalyMetric.props.onClick(); d.render();
    assert.equal(requests.at(-1).options.category, "ANOMALY");
    const filterSelect = elements(d.tree).find(x => x.props?.label === "服务状态");
    filterSelect.props.onChange("DUE"); d.render();
    button(d.tree, "数据").props.onClick(); d.render();
    const beforeDevices = requests.length;
    button(d.tree, "设备").props.onClick(); d.render();
    assert.equal(requests.length, beforeDevices + 1, "legal device request reaches transport");
    const deviceQuery = requests.at(-1).options;
    assert.equal(deviceQuery.view, "DEVICES"); assert.equal(deviceQuery.basis, "CURRENT_ASSET"); assert.equal(deviceQuery.sortKey, "LAST_ACTIVE_AT");
    assert.equal(deviceQuery.groupId, "5"); assert.equal(deviceQuery.category, "ANOMALY"); assert.equal(deviceQuery.filter, "DUE");
    const beforeFinance = requests.length;
    button(d.tree, "资金").props.onClick(); d.render();
    assert.equal(requests.length, beforeFinance + 1);
    const financeQuery = requests.at(-1).options;
    assert.equal(financeQuery.view, "FINANCE"); assert.equal(financeQuery.basis, "CURRENT_CUSTOMER_HISTORY");
    assert.equal(financeQuery.category, "ANOMALY"); assert.equal(financeQuery.filter, "DUE"); assert.equal(financeQuery.groupId, "5");
    const basisSelect = elements(d.tree).find(x => x.props?.label === "统计规则");
    assert.ok(!basisSelect.props.options.some(x => x.value === "CURRENT_ASSET"));
    assert.equal(financeQuery.pageNum, 1); assert.equal(financeQuery.expectedVersion, undefined);
  } finally { d.unmount(); }
});

test("all exposed dataset transitions satisfy actual client basis/filter/category/sort invariants", () => {
  for (const category of ["ALL", "BOUND", "PENDING", "ANOMALY"]) for (const filter of ["ALL", "WINDOW_ACTIVE", "WAITING_REPLY", "DUE", "FIRST_CONTACT", "DORMANT", "UNKNOWN", "STOPPED"]) for (const firstState of ["ALL", "CONFIRMED", "NONE", "UNKNOWN"]) for (const basis of ["CURRENT_CUSTOMER_HISTORY", "PERIOD_EVENT", "CURRENT_ASSET"]) for (const currency of ["USDT", "UVT"]) {
    const state = { ...initialAnalyticsQuery("ALL", "2026-10"), category, filter, firstState, basis, currency, agentId: "7", groupId: "5", pageNum: 3, expectedVersion: version };
    for (const view of ["OVERVIEW", "AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"]) {
      const next = changeAnalyticsQuery(state, { view, ...(view === "DEVICES" ? { basis: "CURRENT_ASSET" } : {}) });
      assert.doesNotThrow(() => validatorModule.namespace.validateQuery(analyticsWireQuery(next, [{ month: next.month, from: "2026-09-30T16:00:00Z", to: "2026-10-31T16:00:00Z" }])), `${view}/${basis}/${category}/${filter}/${firstState}/${currency}`);
      assert.equal(next.view, view); assert.equal(next.category, category); assert.equal(next.filter, filter); assert.equal(next.agentId, "7"); assert.equal(next.groupId, "5");
    }
  }
});

test("native client rejects illegal combinations before any fetch", () => {
  const originalFetch = globalThis.fetch; let fetches = 0;
  globalThis.fetch = async () => { fetches++; throw new Error("unexpected transport"); };
  try {
    for (const query of [{ view: "DEVICES", category: "PENDING", basis: "CURRENT_ASSET" }, { view: "DEVICES", filter: "DUE", basis: "CURRENT_ASSET" }, { view: "FINANCE", basis: "CURRENT_ASSET" }, { view: "DEVICES", sortKey: "AMOUNT", currency: "USDT" }]) assert.throws(() => nativeClient.query(query), /CONTRACT_MALFORMED/);
    assert.equal(fetches, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("synchronous and asynchronous failures render retry instead of escaping effects", async () => {
  forcedQueryError = new Error("unexpected synchronous client failure");
  const scopeDriver = new HookDriver();
  try {
    assert.doesNotThrow(() => scopeDriver.render()); await scopeDriver.settle(); assert.match(content(scopeDriver.tree), /统计资料暂时无法确认，请重试。/);
    forcedQueryError = undefined; button(scopeDriver.tree, "重新核对范围").props.onClick(); scopeDriver.render();
    requests.at(-1).resolve(fixture("OVERVIEW", "MANAGED")); await scopeDriver.settle();
    forcedQueryError = new Error("unexpected synchronous query failure");
    const countBefore = requests.length; button(scopeDriver.tree, "设备").props.onClick(); assert.doesNotThrow(() => scopeDriver.render()); await scopeDriver.settle();
    assert.equal(requests.length, countBefore); assert.match(content(scopeDriver.tree), /统计资料暂时无法确认，请重试。/); assert.equal(elements(scopeDriver.tree).filter(x => x.type === AnalyticsTable).length, 0);
    forcedQueryError = undefined; button(scopeDriver.tree, "重试").props.onClick(); scopeDriver.render();
    requests.at(-1).reject(new Error("unexpected asynchronous transport failure")); await scopeDriver.settle(); assert.match(content(scopeDriver.tree), /统计资料暂时无法确认，请重试。/);
    button(scopeDriver.tree, "重试").props.onClick(); scopeDriver.render(); assert.equal(requests.at(-1).options.view, "DEVICES");
  } finally { forcedQueryError = undefined; scopeDriver.unmount(); }
});

test("wire projection throws inside the protected effect and cannot reach transport", async () => {
  const d = await resolveScope();
  try {
    const select = elements(d.tree).find(x => x.props?.label === "统计规则"); select.props.onChange("PERIOD_EVENT"); d.render();
    const monthSelect = elements(d.tree).find(x => x.props?.label === "自然月"); monthSelect.props.onChange("2026-13");
    const before = requests.length; assert.doesNotThrow(() => d.render()); await d.settle(); await d.settle(); assert.equal(requests.length, before); assert.match(content(d.tree), /统计资料暂时无法确认，请重试。/);
  } finally { d.unmount(); }
});

test("house picker keyboard index covers empty/single/many first arrows and wrap/Home/End", () => {
  for (const key of ["ArrowUp", "ArrowDown", "Home", "End"]) assert.equal(analyticsOptionIndex(key, -1, 0), -1);
  for (const key of ["ArrowUp", "ArrowDown", "Home", "End"]) assert.equal(analyticsOptionIndex(key, -1, 1), 0);
  assert.equal(analyticsOptionIndex("ArrowUp", -1, 4), 3); assert.equal(analyticsOptionIndex("ArrowDown", -1, 4), 0);
  assert.equal(analyticsOptionIndex("Home", 2, 4), 0); assert.equal(analyticsOptionIndex("End", 1, 4), 3);
  assert.equal(analyticsOptionIndex("ArrowUp", 0, 4), 3); assert.equal(analyticsOptionIndex("ArrowDown", 3, 4), 0);
  assert.equal(analyticsOptionIndex("ArrowUp", 2, 4), 1); assert.equal(analyticsOptionIndex("ArrowDown", 2, 4), 3);
});

test("long authorized group tabs expose the complete native name by tooltip and accessible label", async () => {
  const d = new HookDriver(); d.render();
  const payload = fixture("OVERVIEW", "MANAGED"), fullName = "负责组完整名称很长并且包含需要核对的后半段信息";
  payload.scopeSummary.groups[0].name = fullName;
  try {
    requests.at(-1).resolve(payload); await d.settle();
    const group = button(d.tree, fullName); assert.equal(group.props.title, fullName); assert.equal(group.props["aria-label"], fullName);
    group.props.onClick(); d.render(); assert.equal(requests.at(-1).options.groupId, "4");
  } finally { d.unmount(); }
});

test("every dataset discloses retained customer predicates and single removal resets query paging", async () => {
  const d = await resolveScope("ALL");
  const removeButton = label => {
    const matches = elements(d.tree).filter(x => x.type === "button" && x.props["aria-label"] === `移除${label}`);
    assert.equal(matches.length, 1, label); assert.equal(matches[0].props.title, label); return matches[0];
  };
  try {
    requests.at(-1).resolve(fixture("OVERVIEW", "ALL")); await d.settle();
    elements(d.tree).find(x => x.props?.label === "当前绑定客户").props.onClick(); d.render();
    elements(d.tree).find(x => x.props?.label === "首充状态").props.onChange("CONFIRMED"); d.render();
    elements(d.tree).find(x => x.props?.label === "服务状态").props.onChange("DUE"); d.render();
    for (const [label, view] of [["客服", "AGENTS"], ["资金", "FINANCE"], ["总览", "OVERVIEW"], ["客户", "CUSTOMERS"], ["活跃", "ACTIVITY"]]) {
      if (label !== "客户") { button(d.tree, "数据").props.onClick(); d.render(); }
      button(d.tree, label).props.onClick(); d.render();
      const query = requests.at(-1).options; assert.equal(query.view, view); assert.equal(query.category, "BOUND"); assert.equal(query.firstState, "CONFIRMED"); assert.equal(query.filter, "DUE");
      for (const active of ["客户类别：已绑定", "首充：已首充", "服务：待维护"]) removeButton(active);
    }
    // Start with a signed second page so removing one chip proves real page/version reset.
    requests.at(-1).resolve({ ...fixture("ACTIVITY", "ALL"), canContinue: true }); await d.settle();
    button(d.tree, "下一页").props.onClick(); d.render(); assert.equal(requests.at(-1).options.pageNum, 2); assert.equal(requests.at(-1).options.expectedVersion, version);
    removeButton("首充：已首充").props.onClick(); d.render();
    let query = requests.at(-1).options; assert.equal(query.pageNum, 1); assert.equal(query.expectedVersion, undefined); assert.equal(query.firstState, "ALL"); assert.equal(query.filter, "DUE"); assert.equal(query.category, "BOUND");
    assert.ok(!elements(d.tree).some(x => x.props?.["aria-label"] === "移除首充：已首充")); removeButton("服务：待维护");
    button(d.tree, "设备").props.onClick(); d.render(); query = requests.at(-1).options; assert.equal(query.firstState, "ALL"); assert.equal(query.filter, "DUE"); assert.equal(query.category, "BOUND"); removeButton("服务：待维护"); removeButton("客户类别：已绑定");
    removeButton("服务：待维护").props.onClick(); d.render(); query = requests.at(-1).options; assert.equal(query.filter, "ALL"); assert.equal(query.category, "BOUND"); assert.equal(query.view, "DEVICES"); assert.equal(query.sortKey, "LAST_ACTIVE_AT");
    removeButton("客户类别：已绑定").props.onClick(); d.render(); assert.equal(requests.at(-1).options.category, "ALL");
  } finally { d.unmount(); }
});

test("group/agent/search/direction chips show actual conditions and remove only their own predicate", async () => {
  const d = new HookDriver(); d.render();
  const payload = fixture("OVERVIEW", "MANAGED"), groupName = "负责组完整名称很长并包含末尾需要人工区分的信息";
  payload.scopeSummary.groups[0].name = groupName;
  const findRemoval = label => elements(d.tree).find(x => x.type === "button" && x.props["aria-label"] === `移除${label}`);
  try {
    requests.at(-1).resolve(payload); await d.settle(); button(d.tree, groupName).props.onClick(); d.render();
    assert.equal(findRemoval(`负责组：${groupName}`).props.title, `负责组：${groupName}`);
    requests.at(-1).resolve(fixture("AGENTS", "MANAGED")); await d.settle();
    const tableElement = elements(d.tree).find(x => x.type === AnalyticsTable), table = AnalyticsTable(tableElement.props);
    button(table, "客服A").props.onClick(); d.render(); assert.equal(requests.at(-1).options.agentId, "7"); assert.ok(findRemoval("当前客服：账号 7"));
    const keyword = "长搜索条件需要完整披露并且包含最后区分字符";
    elements(d.tree).find(x => x.type === "input").props.onChange({ target: { value: keyword } }); d.render();
    elements(d.tree).find(x => x.type === "form").props.onSubmit({ preventDefault() {} }); d.render();
    assert.equal(findRemoval(`搜索：${keyword}`).props.title, `搜索：${keyword}`);
    elements(d.tree).find(x => x.props?.label === "顺序").props.onChange("ASC"); d.render();
    button(d.tree, "数据").props.onClick(); d.render(); button(d.tree, "总览").props.onClick(); d.render(); assert.ok(findRemoval("顺序：从低到高 / 从早到晚"));
    findRemoval("当前客服：账号 7").props.onClick(); d.render(); let query = requests.at(-1).options;
    assert.equal(query.agentId, undefined); assert.equal(query.groupId, "4"); assert.equal(query.keyword, keyword); assert.equal(query.direction, "ASC"); assert.equal(query.pageNum, 1); assert.equal(query.expectedVersion, undefined);
    findRemoval(`搜索：${keyword}`).props.onClick(); d.render(); query = requests.at(-1).options; assert.equal(query.keyword, undefined); assert.equal(query.groupId, "4");
    findRemoval("顺序：从低到高 / 从早到晚").props.onClick(); d.render(); assert.equal(requests.at(-1).options.direction, undefined);
    findRemoval(`负责组：${groupName}`).props.onClick(); d.render(); assert.equal(requests.at(-1).options.groupId, undefined);
    button(d.tree, "客户").props.onClick(); d.render(); assert.equal(elements(d.tree).find(x => x.type === "input").props.value, "");
  } finally { d.unmount(); }
});

test("leaderboard entry IDs match the actual private request bound and preserve decimal strings", () => {
  assert.equal(analyticsEntryAgent(""), undefined); assert.equal(analyticsEntryAgent("?view=pool"), undefined);
  for (const value of ["1", "1234567890123456", "9007199254740991"]) {
    const agentId = analyticsEntryAgent(`?agentId=${value}`); assert.equal(agentId, value); assert.equal(typeof agentId, "string");
    assert.doesNotThrow(() => validatorModule.namespace.validateQuery({ view: "CUSTOMERS", category: "BOUND", agentId }));
  }
  for (const search of ["?agentId=", "?agentId=0", "?agentId=01", "?agentId=-1", "?agentId=1.5", "?agentId=1e3", "?agentId=%201", "?agentId=%2B1", "?agentId=9007199254740992", "?agentId=9223372036854775807", "?agentId=7&agentId=7"]) assert.throws(() => analyticsEntryAgent(search), /客服入口参数无效/);
});

test("leaderboard entry probes real scope then requests that agent's bound customers; 403 never falls back", async () => {
  const oldSearch = context.window.location.search;
  context.window.location.search = "?agentId=1234567890123456";
  try {
    for (const mode of ["PERSONAL", "MANAGED", "ALL"]) {
      const before = requests.length, d = new HookDriver(); d.render();
      const probe = requests.at(-1); assert.equal(requests.length, before + 1); assert.equal(probe.options.view, "OVERVIEW"); assert.equal(probe.options.agentId, undefined);
      try {
        probe.resolve(fixture("OVERVIEW", mode)); await d.settle();
        const selected = requests.at(-1), query = selected.options;
        assert.equal(query.view, "CUSTOMERS"); assert.equal(query.category, "BOUND"); assert.equal(query.basis, "CURRENT_CUSTOMER_HISTORY"); assert.equal(query.agentId, "1234567890123456");
        assert.equal(query.firstState, "ALL"); assert.equal(query.filter, "ALL"); assert.equal(query.groupId, undefined); assert.equal(query.pageNum, 1); assert.equal(query.expectedVersion, undefined); assert.equal(query.mode, undefined);
        assert.ok(elements(d.tree).some(x => x.props?.["aria-label"] === "移除当前客服：账号 1234567890123456"));
        const data = fixture("CUSTOMERS", mode); data.records[0].nickname = "授权客户资料"; selected.resolve(data); await d.settle(); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 1);
        button(d.tree, "刷新").props.onClick(); d.render(); requests.at(-1).reject(new SupportClientError(403)); await d.settle();
        assert.match(content(d.tree), /无查看权限/); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0); assert.ok(!content(d.tree).includes("甲组"));
        const deniedCount = requests.length; d.render(); assert.equal(requests.length, deniedCount, "denial must not silently query someone else");
        button(d.tree, "重新核对范围").props.onClick(); d.render(); requests.at(-1).resolve(fixture("OVERVIEW", mode)); await d.settle(); assert.equal(requests.at(-1).options.agentId, query.agentId, "explicit retry keeps requested agent");
      } finally { d.unmount(); }
    }
  } finally { context.window.location.search = oldSearch; }
});

test("invalid leaderboard entry is a readable zero-fetch failure, and current workbench tabs navigate to the board", async () => {
  const oldSearch = context.window.location.search;
  try {
    for (const search of ["?agentId=0", "?agentId=9007199254740992", "?agentId=7&agentId=8"]) {
      context.window.location.search = search; const before = requests.length, d = new HookDriver();
      try { d.render(); await d.settle(); assert.equal(requests.length, before); assert.match(content(d.tree), /客服入口参数无效/); assert.equal(elements(d.tree).filter(x => x.type === AnalyticsTable).length, 0); button(d.tree, "查看业绩榜").props.onClick(); assert.equal(navigations.at(-1), "/service/leaderboard"); assert.equal(requests.length, before); }
      finally { d.unmount(); }
    }
    context.window.location.search = "";
    const personal = await resolveScope("PERSONAL");
    try {
      button(personal.tree, "业绩榜").props.onClick(); assert.equal(navigations.at(-1), "/service/leaderboard");
      const tabs = elements(personal.tree).find(x => x.type === "nav" && x.props["aria-label"] === "客服工作台");
      button(tabs, "我的客户").props.onClick(); personal.render();
      button(personal.tree, "业绩榜").props.onClick(); assert.equal(navigations.at(-1), "/service/leaderboard");
    } finally { personal.unmount(); }
    const managed = await resolveScope("MANAGED");
    try { button(managed.tree, "业绩榜").props.onClick(); assert.equal(navigations.at(-1), "/service/leaderboard"); }
    finally { managed.unmount(); }
  } finally { context.window.location.search = oldSearch; }
});

test("rendered table layout fixture keeps numeric font equality, readable units and local scrolling", async () => {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const css = readFileSync(path.join(stage, "app/components/domain-views/m-tabs/m1-analytics-workbench.css"), "utf8");
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => route.abort());
    for (const width of [1200, 360]) {
      await page.setViewportSize({ width, height: 800 });
      for (const view of ["AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"]) {
        const html = renderToStaticMarkup(React.createElement(AnalyticsTable, { data: fixture(view), currency: "USDT", drill() {}, openProfile() {} }));
        await page.setContent(`<style>:root{--font-v5:Arial,sans-serif;--v5-bg:#0a0a0a;--v5-surface:#121214;--v5-surface-2:#17171b;--v5-ink:#eee;--v5-ink-3:#aaa;--v5-border:#333;--admin-domain-m:#38bdf8}body{margin:8px;background:var(--v5-bg)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}${css}</style><main class="sa-workbench">${html}</main>`);
        const result = await page.evaluate(() => ({ pageOverflows: document.documentElement.scrollWidth > innerWidth, fonts: [...document.querySelectorAll(".sa-number")].map(x => { const s = getComputedStyle(x); return [s.fontSize, s.lineHeight, s.fontWeight]; }), names: [...document.querySelectorAll(".sa-name")].map(x => { const s = getComputedStyle(x); return { ellipsis: s.textOverflow, width: x.getBoundingClientRect().width }; }), tableCount: document.querySelectorAll("table").length }));
        assert.equal(result.pageOverflows, false, `${view}/${width}: whole-page horizontal overflow`);
        assert.equal(result.tableCount, 1);
        for (const font of result.fonts) assert.deepEqual(font, ["14px", "21px", "500"], `${view}/${width}: numeric font mismatch`);
        for (const name of result.names) { assert.equal(name.ellipsis, "ellipsis"); assert.ok(name.width <= 180); }
      }
    }
  } finally { await browser.close(); }
});
