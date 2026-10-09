import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";

const frontend = process.env.SUPPORT_ANALYTICS_FE_ROOT || fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(frontend, "package.json"));
const ts = require("typescript");
const sourcePath = fileURLToPath(new URL("../lib/admin/support-analytics-client.ts", import.meta.url));
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const moduleText = compiled.outputText.replace(/from "\.\/(m-support-client|business-time)\.ts"/g, (_, name) => `from ${JSON.stringify(pathToFileURL(path.join(frontend, "lib/admin", `${name}.ts`)).href)}`);
const { supportAnalyticsClient } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
const { SupportClientError } = await import(pathToFileURL(path.join(frontend, "lib/admin/m-support-client.ts")).href);

const version = `saq-v1:${"a".repeat(64)}`;
const at = "2026-10-08T01:02:03.123456Z";
const unknownCount = () => ({ observed: null, confirmed: null, status: "UNKNOWN" });
const exactCount = (n = 1) => ({ observed: n, confirmed: n, status: "AVAILABLE" });
const money = () => ({ observed: "123456789012345678.123456", confirmed: null, observedEvents: 1, confirmedEvents: null, observedCustomers: 1, status: "PARTIAL" });
const customerMoney = (currency = "USDT") => ({ currency, deposits: money(), purchases: money() });
const devices = () => ({ held: unknownCount(), unknownHolding: exactCount(), status: "UNKNOWN", partitions: [{ dimension: "CONNECTION", value: "UNKNOWN", devices: exactCount() }] });
const current = () => ({ lifetimeBasis: "CURRENT_CUSTOMER_HISTORY", status: "PARTIAL", ownLifetime: [customerMoney(), customerMoney("NEX")], firstConfirmed: unknownCount(), firstNone: unknownCount(), firstUnknown: exactCount(), devices: devices(), activity: { active: unknownCount(), inactive: unknownCount(), unknown: exactCount(), status: "UNKNOWN", window: { days: null, from: null, through: null, status: "UNAVAILABLE" } } });
const personnel = () => ({ status: "PARTIAL", serviceAccounts: exactCount(), groupMembers: exactCount(), supervisors: unknownCount(), people: { observed: 1, confirmed: null, status: "PARTIAL" }, groups: exactCount(), partitions: [{ dimension: "MEMBERSHIP", value: "UNKNOWN", accounts: exactCount() }] });
const financial = () => ({ status: "PARTIAL", firstCandidates: unknownCount(), currencies: [{ currency: "USDT", deposits: money(), purchases: money(), purchaseRefunds: money(), net: { observed: null, confirmed: null, observedEvents: null, confirmedEvents: null, observedCustomers: null, status: "UNKNOWN" } }], firstSources: [customerMoney()] });
const unavailableFunds = () => ({ balanceStatus: "UNAVAILABLE", withdrawalStatus: "UNAVAILABLE" });
const observed = (amount = null) => ({ observedAmount: amount, confirmedAmount: null });
const funds = () => ({ scope: "SELECTED_CURRENT_CUSTOMERS", customerCount: 1, balanceStatus: "PARTIAL", withdrawalStatus: "UNKNOWN", balances: [{ currency: "USDT", ...observed("999999999999.123456") }, { currency: "NEX", ...observed(null) }], sourceObservationStatus: "UNKNOWN", walletReadStatus: "PARTIAL", walletReadReasons: ["WALLET_MISSING"], withdrawalReadStatus: "READY", withdrawalReadReasons: [], withdrawalReadScope: "CURRENT_CUSTOMER_RAW_ROWS", historicalEnvironmentStatus: "UNKNOWN", eventOwnershipStatus: "UNKNOWN", withdrawals: [{ currency: "USDT", successPrincipal: observed("7"), successActualFee: observed(), successNet: observed(), processingPrincipal: observed("5.000001") }] });
const customer = () => ({ customerId: "9223372036854775807", customerNo: "C-001", nickname: "测试客户", avatar: null, level: null, customTags: ["需回访"], systemTags: [], systemTagsStatus: "PARTIAL", profileRef: "/api/admin/content/support-workbench/customers/9223372036854775807", registeredAt: at, assignedAt: null, category: "BOUND", placement: "UNKNOWN", handoverRequired: true, owner: { agentId: "12", groupId: null, agentName: "客服", advisorAvatar: null, advisorAvatarRef: null }, first: { state: "UNKNOWN", status: "UNKNOWN", kind: null, currency: null, amount: null, succeededAt: null }, lifetime: [customerMoney()], lifetimeStatus: "PARTIAL", invitations: { direct: unknownCount(), descendants: unknownCount(), status: "UNKNOWN", deposits: [{ currency: "NEX", deposits: money() }] }, devices: devices(), activity: { state: "UNKNOWN", status: "UNKNOWN", lastEffectiveAt: null }, task: { status: "UNAVAILABLE" }, funds: funds() });
const agent = () => ({ accountId: "12", displayName: "客服", avatar: { assetId: "12345678-1234-1234-1234-123456789abc", version: 3 }, avatarRef: "/api/admin/content/support-agents/12/avatar", account: { serviceAccount: true, supervisorAccount: false, serviceCategoryStatus: "AVAILABLE", supervisorCategoryStatus: "UNKNOWN", accountState: "DISABLED", serviceQualification: "REMOVED", supervisorQualification: "UNKNOWN", receptionEligibility: "UNKNOWN", memberState: "UNGROUPED", groupId: null, handoverRequired: true, status: "PARTIAL" }, current: current(), funds: unavailableFunds() });
const financeRow = () => ({ customerId: "12", customerNo: null, nickname: null, kind: "DEPOSIT", currency: "USDT", amount: "999999999999999.123456", succeededAt: at, orderNo: null, historyStatus: "UNKNOWN" });
const deviceRow = () => ({ deviceId: "9", customerId: "12", deviceType: "CUSTOM", hashrate: null, holdingStatus: "UNKNOWN", connectionStatus: "NOT_APPLICABLE", acquisition: "UNKNOWN", activatedAt: null, deactivatedAt: null });
const payload = (view = "CUSTOMERS") => ({ view, basis: "CURRENT_CUSTOMER_HISTORY", businessZone: "Asia/Shanghai", asOf: "2026-10-08T01:02:03.123456789Z", pageNum: 1, pageSize: 20, total: view === "AGENTS" ? null : 1, observedTotal: 1, records: [view === "AGENTS" ? agent() : view === "FINANCE" ? financeRow() : view === "DEVICES" ? deviceRow() : customer()], versionState: "READY", queryVersion: version, canContinue: false, recordsStatus: view === "AGENTS" ? "PARTIAL" : "READY", selectedCustomerCount: 1, selectedCurrent: current(), scopeSummary: { mode: "PERSONAL", total: 1, bound: 1, pending: 0, anomaly: 0, status: "AVAILABLE", current: current(), financial: financial(), restrictedSummary: { customers: unknownCount(), firstCandidates: unknownCount() }, personnel: personnel(), groups: [{ groupId: "4", name: null, total: 1, current: current(), period: financial(), personnel: personnel() }] }, funds: { ...funds(), groups: [{ groupId: "4", funds: unavailableFunds() }] } });
const originalFetch = globalThis.fetch;
const envelope = (data, status = 200) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, message: status === 200 ? "OK" : status === 403 ? "SUPPORT_SCOPE_FORBIDDEN" : "SUPPORT_ANALYTICS_QUERY_CHANGED", data }), { status });
const query = (options = {}) => supportAnalyticsClient.query({ view: "CUSTOMERS", ...options });
const mock = async (data, action, status = 200) => {
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url: new URL(url, "http://localhost"), init }; return envelope(data, status); };
  try { return await action(() => seen); } finally { globalThis.fetch = originalFetch; }
};

test("staged candidate passes strict TypeScript against read-only existing imports", () => {
  const options = { target: ts.ScriptTarget.ES2017, lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options);
  host.resolveModuleNames = (names, containingFile) => names.map(name => {
    const target = containingFile.replaceAll("\\", "/") === sourcePath.replaceAll("\\", "/") && ["./m-support-client.ts", "./business-time.ts"].includes(name) ? path.join(frontend, "lib/admin", name.slice(2)).replaceAll("\\", "/") : name;
    return ts.resolveModuleName(target, containingFile, options, host).resolvedModule;
  });
  const program = ts.createProgram([sourcePath], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => frontend, getCanonicalFileName: x => x, getNewLine: () => "\n" }));
});

for (const view of ["OVERVIEW", "AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"]) test(`real projection ${view} parses through existing fetch/envelope`, async () => {
  await mock(payload(view), async seen => {
    const result = await query({ view });
    assert.equal(result.view, view);
    assert.equal(result.records.length, 1);
    assert.equal(result.funds.balances[1].observedAmount, null);
    assert.equal(result.selectedCurrent.ownLifetime[0].deposits.observed, "123456789012345678.123456");
    assert.equal(result.scopeSummary.mode, "PERSONAL");
    assert.equal(seen().url.pathname, "/api/admin/content/support-workbench/analytics");
    assert.equal(seen().url.searchParams.has("mode"), false);
    assert.equal(seen().init.cache, "no-store");
    assert.equal(seen().init.credentials, "same-origin");
  });
});

test("exact decimals, nullable coverage, tags, identity and authorized asset references survive", async () => {
  const data = payload();
  data.records[0].avatar = `${data.records[0].profileRef}/avatar`;
  data.records[0].owner.advisorAvatarRef = `/api/admin/content/support-agents/12/avatar?customerId=${data.records[0].customerId}`;
  await mock(data, async () => {
    const r = await query();
    assert.equal(r.records[0].customerId, "9223372036854775807");
    assert.equal(r.records[0].avatar, data.records[0].avatar);
    assert.equal(r.records[0].owner.advisorAvatarRef, data.records[0].owner.advisorAvatarRef);
    assert.deepEqual(r.records[0].customTags, ["需回访"]);
    assert.equal(r.records[0].first.state, "UNKNOWN");
    assert.equal(r.records[0].first.amount, null);
    assert.equal(r.funds.withdrawals[0].successPrincipal.confirmedAmount, null);
    assert.equal(r.funds.eventOwnershipStatus, "UNKNOWN");
    assert.equal(r.funds.groups[0].funds.balanceStatus, "UNAVAILABLE");
  });
});

test("UNKNOWN version keeps observed totals but cannot continue", async () => {
  const data = { ...payload(), total: null, versionState: "UNKNOWN", queryVersion: null, canContinue: false, recordsStatus: "UNKNOWN" };
  await mock(data, async () => { const r = await query(); assert.equal(r.total, null); assert.equal(r.observedTotal, 1); assert.equal(r.canContinue, false); });
  for (const invalid of [{ canContinue: true }, { total: 1 }, { queryVersion: version }]) await mock({ ...data, ...invalid }, async () => assert.rejects(query(), /SUPPORT_CONTRACT_MALFORMED/));
});

test("READY personnel partial coverage remains total-null and uses server paging version", async () => {
  const data = { ...payload("AGENTS"), total: null, observedTotal: 2, pageSize: 1, canContinue: true };
  await mock(data, async () => { const r = await query({ view: "AGENTS", pageSize: 1 }); assert.equal(r.total, null); assert.equal(r.recordsStatus, "PARTIAL"); assert.equal(r.canContinue, true); });
  const second = { ...data, pageNum: 2, canContinue: false };
  await mock(second, async seen => { assert.equal((await query({ view: "AGENTS", pageSize: 1, pageNum: 2, expectedVersion: version })).queryVersion, version); assert.equal(seen().url.searchParams.get("expectedVersion"), version); });
  await mock({ ...second, queryVersion: `saq-v1:${"b".repeat(64)}` }, async () => assert.rejects(query({ view: "AGENTS", pageSize: 1, pageNum: 2, expectedVersion: version }), /versionMismatch/));
});

test("request whitelist, defaults, safe scoped IDs and period microseconds", async () => {
  const data = { ...payload(), basis: "PERIOD_EVENT" };
  const signal = new AbortController().signal;
  await mock(data, async seen => {
    await query({ basis: "PERIOD_EVENT", from: "2026-10-01T00:00:00.000001Z", to: "2026-10-01T00:00:00.000002Z", groupId: "9007199254740991", agentId: 12, keyword: " 测试 ", currency: "NEX", signal });
    assert.equal(seen().url.searchParams.get("groupId"), "9007199254740991");
    assert.equal(seen().url.searchParams.get("from"), "2026-10-01T00:00:00.000001Z");
    assert.equal(seen().url.searchParams.get("sortKey"), "LAST_ACTIVE_AT");
    assert.equal(seen().url.searchParams.get("businessZone"), "Asia/Shanghai");
    assert.equal(seen().url.searchParams.get("keyword"), "测试");
    assert.equal(seen().init.signal, signal);
  });
});

test("invalid query combinations fail before any request", async () => {
  const bad = [
    { mode: "ALL" }, { role: "superadmin" }, { scope: "ALL" }, { view: "ALL" }, { basis: "MONTH" }, { filter: "NEW" }, { category: "OTHER" }, { firstState: "READY" }, { direction: "DOWN" }, { currency: "USD" }, { keyword: "x".repeat(201) },
    { groupId: 0 }, { agentId: "9007199254740992" }, { groupId: Number.MAX_SAFE_INTEGER + 1 }, { pageNum: 2 }, { pageSize: 101 }, { pageNum: 1.5 }, { pageNum: null }, { expectedVersion: "stale" }, { businessZone: "UTC" },
    { view: "AGENTS", sortKey: "LAST_ACTIVE_AT" }, { view: "FINANCE", basis: "CURRENT_ASSET" }, { basis: "CURRENT_ASSET", firstState: "CONFIRMED" }, { sortKey: "PERSONAL_DEPOSIT" }, { sortKey: "NEXT_DUE_AT", filter: "ALL" }, { sortKey: "WAITING_SINCE_AT", filter: "DUE" }, { sortKey: "STATE_CHANGED_AT", filter: "DUE" }, { sortKey: "POOL_ENTERED_AT", category: "BOUND" },
    { from: at }, { basis: "PERIOD_EVENT" }, { basis: "PERIOD_EVENT", from: at, to: at }, { basis: "PERIOD_EVENT", from: "2026-02-30T00:00:00Z", to: at }, { basis: "PERIOD_EVENT", from: "2026-10-01T00:00:00.0000001Z", to: at }, { basis: "PERIOD_EVENT", from: "0999-01-01T00:00:00Z", to: at }, { basis: "PERIOD_EVENT", from: "2000-01-01T00:00:00Z", to: at },
  ];
  let calls = 0;
  globalThis.fetch = async () => { calls++; return envelope(payload()); };
  try { for (const options of bad) await assert.rejects(async () => query(options), /SUPPORT_CONTRACT_MALFORMED/, JSON.stringify(options)); assert.equal(calls, 0); } finally { globalThis.fetch = originalFetch; }
});

test("filter-specific defaults match backend and do not add arbitrary parameters", async () => {
  for (const [options, sortKey, direction] of [[{ category: "PENDING" }, "POOL_ENTERED_AT", "ASC"], [{ firstState: "CONFIRMED" }, "FIRST_SUCCEEDED_AT", "DESC"], [{ firstState: "NONE" }, "REGISTERED_AT", "ASC"], [{ filter: "WAITING_REPLY" }, "WAITING_SINCE_AT", "ASC"], [{ filter: "FIRST_CONTACT" }, "ASSIGNED_AT", "ASC"], [{ filter: "DUE" }, "NEXT_DUE_AT", "ASC"], [{ filter: "STOPPED" }, "STATE_CHANGED_AT", "DESC"], [{ view: "FINANCE", sortKey: "AMOUNT", currency: "USDT" }, "AMOUNT", "DESC"]]) {
    await mock(payload(options.view), async seen => { await query(options); assert.equal(seen().url.searchParams.get("sortKey"), sortKey); assert.equal(seen().url.searchParams.get("direction"), direction); });
  }
});

for (const status of [401, 403, 404, 409, 503]) test(`HTTP ${status} stays existing classified error before response projection`, async () => {
  await mock({ ...payload(), queryVersion: "stale", records: [{ email: "private@example.test" }] }, async () => assert.rejects(query(), error => error instanceof SupportClientError && error.status === status && error.apiCode === status), status);
});

test("malformed envelope remains an error and network failure cannot turn into an empty result", async () => {
  globalThis.fetch = async () => new Response("{", { status: 200 });
  try { await assert.rejects(query(), /CONTENT_API_MALFORMED_RESPONSE/); } finally { globalThis.fetch = originalFetch; }
  globalThis.fetch = async () => { throw new TypeError("fetch failed"); };
  try { await assert.rejects(query(), Error); } finally { globalThis.fetch = originalFetch; }
});

test("missing fields, unsafe numbers, unknown states and unexpected private/raw evidence reject", async () => {
  const mutations = [
    d => { delete d.selectedCurrent; }, d => { delete d.funds.balances[0].confirmedAmount; }, d => { d.versionState = "FAILED"; }, d => { d.records[0].activity.state = "COMPLETE"; }, d => { d.scopeSummary.personnel.partitions[0].value = "MYSTERY"; }, d => { d.records[0].first.state = "MYSTERY"; },
    d => { d.records[0].customerId = Number.MAX_SAFE_INTEGER + 1; }, d => { d.records[0].customerId = "9223372036854775808"; }, d => { d.records[0].lifetime[0].deposits.observed = 3.2; }, d => { d.records[0].lifetime[0].deposits.observed = "1e6"; },
    d => { d.records[0].email = "private@example.test"; }, d => { d.records[0].invitations.descendantIds = [77]; }, d => { d.originalGrant = {}; }, d => { d.scopeSummary.restrictedSummary.customerIds = [7]; }, d => { d.records[0].avatar = "https://external.test/raw-avatar"; }, d => { d.records[0].profileRef = "/api/admin/content/users/12"; },
    d => { d.records[0].owner.advisorAvatarRef = "/api/admin/content/support-agents/13/avatar"; }, d => { d.funds.withdrawals[0].successPrincipal.confirmedAmount = "0"; }, d => { d.funds.balances[0].confirmedAmount = "0"; }, d => { d.funds.balances[1].currency = "USDT"; },
    d => { d.records = []; }, d => { d.canContinue = true; }, d => { d.total = 0; }, d => { d.view = "ACTIVITY"; }, d => { d.pageSize = 1; }, d => { d.records[0].registeredAt = "2026-02-30T00:00:00Z"; },
    d => { d.selectedCurrent.firstConfirmed.confirmed = 0; }, d => { d.scopeSummary.financial.currencies[0].net.confirmed = "0"; },
  ];
  for (const mutate of mutations) { const d = payload(); mutate(d); await mock(d, async () => assert.rejects(query(), /SUPPORT_CONTRACT_MALFORMED/)); }
});

test("task unknown nullable flags, unavailable funds and empty groups stay honest", async () => {
  const d = payload();
  d.records[0].task = { status: "UNKNOWN", enabled: null, due: null, waitingReply: null, firstContact: null, nextDueAt: null, waitingSinceAt: null };
  d.funds = { ...unavailableFunds(), groups: [] };
  await mock(d, async () => { const r = await query(); assert.equal(r.records[0].task.due, null); assert.deepEqual(r.funds, d.funds); });
});

test("period upper day boundary and current asset queries match actual DTO policy", async () => {
  await mock({ ...payload(), basis: "PERIOD_EVENT" }, async () => {
    await query({ basis: "PERIOD_EVENT", from: "2010-01-01T00:00:00Z", to: new Date(Date.parse("2010-01-01T00:00:00Z") + (3660 * 24 + 23) * 3600000).toISOString() });
    await assert.rejects(async () => query({ basis: "PERIOD_EVENT", from: "2010-01-01T00:00:00Z", to: new Date(Date.parse("2010-01-01T00:00:00Z") + 3661 * 86400000).toISOString() }), /queryPeriod/);
  });
  await mock({ ...payload("DEVICES"), basis: "CURRENT_ASSET" }, async seen => { const r = await query({ view: "DEVICES", basis: "CURRENT_ASSET", sortKey: "HASHRATE" }); assert.equal(r.basis, "CURRENT_ASSET"); assert.equal(seen().url.searchParams.has("from"), false); });
});

test("all row families reject unknown states, missing fields and raw backend identities", async () => {
  for (const [view, mutate] of [["AGENTS", d => { d.records[0].account.receptionEligibility = "ONLINE"; }], ["AGENTS", d => { d.records[0].rawRoleIds = [1]; }], ["FINANCE", d => { delete d.records[0].historyStatus; }], ["FINANCE", d => { d.records[0].factId = "internal-evidence"; }], ["DEVICES", d => { d.records[0].connectionStatus = "READY"; }], ["DEVICES", d => { d.records[0].sourceEnvironment = "SANDBOX"; }], ["ACTIVITY", d => { d.records[0].activity.status = "READY"; }], ["OVERVIEW", d => { d.records[0].funds.withdrawalReadReasons = ["INVENTED"]; }]]) {
    const d = payload(view); mutate(d); await mock(d, async () => assert.rejects(query({ view }), /SUPPORT_CONTRACT_MALFORMED/));
  }
  for (const mutate of [d => { d.total = null; }, d => { d.recordsStatus = "AVAILABLE"; }]) { const d = payload(); mutate(d); await mock(d, async () => assert.rejects(query(), /recordsCoverage/)); }
});
