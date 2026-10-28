import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { formatBusinessTime } from "../lib/admin/business-time.ts";
import { createElement, useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { supportObject, parseSupportId } from "../lib/admin/m-support-client.ts";
import { nexGridBrandText } from "../lib/admin/brand-copy.ts";
import { formatD4Subtype } from "../lib/admin/d4-ledger-display.ts";

const search = readFileSync(new URL("../app/components/domain-views/c-tabs/c1-search.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/_console/users/search/[id]/page.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const usersProxy = readFileSync(new URL("../app/api/admin/users/[...path]/route.ts", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");

test("C1 preserves safe search context and disables stale rows while loading", () => {
  assert.match(search, /window\.history\.replaceState/);
  assert.match(search, /returnTo/);
  assert.match(search, /loading \? undefined : \(\) => openProfile/);
  assert.match(search, /C1_RAW_PHONE_SEARCH_FORBIDDEN/);
  assert.match(errorMessages, /为保护用户隐私，不支持按原始手机号检索；请使用脱敏手机号或手机号哈希/);
});

test("C1 exposes all PRD search dimensions and 20-200 page sizes", () => {
  for (const field of ["tier", "vRank", "referralCode", "depositMin", "depositMax", "usdtMin", "usdtMax", "nexMin", "nexMax", "riskBand", "joinedFrom", "joinedTo"]) {
    assert.match(search, new RegExp(field));
    assert.match(client, new RegExp(field));
  }
  assert.match(search, /pageSizeOptions=\{\[20, 50, 100, 200\]\}/);
});

test("C1 is read-only outside the explicitly approved payment and nickname actions", () => {
  assert.doesNotMatch(detail, /usePropose|findHighOp|doFreeze|c2_account_freeze|c2_session_revoke_all|c2_impersonate_start|c5_password_reset/);
  assert.match(detail, /pathname: "\/users\/actions"/);
  assert.match(detail, /pathname: "\/users\/security"/);
  assert.match(detail, /reasonMax=\{200\}/);
  assert.match(detail, /这部分资料加载失败，请刷新重试/);
  assert.match(detail, /刷新页面重试/);
});

test("C1 masked export requires a reasoned confirmation and a retry-stable idempotency key", () => {
  assert.match(search, /exportUserProfilesCsv/);
  assert.match(search, /exportKeyRef/);
  assert.match(search, /exportingRef\.current/);
  assert.match(search, /exportCooldownUntilRef/);
  assert.match(search, /Date\.now\(\) \+ 1_000/);
  assert.match(search, /ctx\.openConfirm\(\{/);
  assert.match(search, /reason: true/);
  assert.match(search, /runExport\(reason\)/);
  assert.match(client, /reason\.trim\(\)/);
  assert.match(client, /\.csv/);
  assert.match(client, /exportKey/);
});

test("C1 renders unavailable when the current K4 score authority is absent", () => {
  assert.match(detail, /riskAuthorityReady/);
  assert.match(detail, /risk\?\.sourceStatus === "READY"/);
  assert.match(detail, /暂无风险分/);
  assert.doesNotMatch(detail, /summary\.riskScore \?\? profile\?\.riskScore/);
});

test("C1 proxy fails closed when upstream phone masking violates the public contract", () => {
  assert.match(usersProxy, /MASKED_PHONE_PATTERN = \/\^\[0-9\]\{3\}\\\*\{4\}\[0-9\]\{4\}\$\//);
  assert.match(usersProxy, /key === "phoneMasked"/);
  assert.match(usersProxy, /sanitizePhoneMasked\(JSON\.parse/);
  assert.match(usersProxy, /USERS_RESPONSE_INVALID/);
});

test("C1 overview request is explicitly forwarded to the authoritative backend route", () => {
  assert.match(usersProxy, /parts\.length === 1 && parts\[0\] === "overview"/);
  assert.match(usersProxy, /return "\/api\/admin\/users\/overview"/);
});

// Render the production device/earnings JSX and helpers; no page fetch or write action runs.
const ast = ts.createSourceFile("page.tsx", detail, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
test("support customer breadcrumbs name the business page instead of exposing raw route segments", () => {
  const source = ts.createSourceFile("breadcrumb.tsx", readFileSync(new URL("../app/components/shell/breadcrumb.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Breadcrumb");
  const body = fn.body.statements.filter(node => !ts.isReturnStatement(node)).map(node => node.getText(source)).join("\n");
  const executable = ts.transpileModule(`${body}\nreturn crumbs;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const crumbsFor = new Function("usePathname", "findByPath", executable);
  const parent = { domain: { code: "M", name: "客服中心", accentVar: "--admin-domain-m" }, l2: { id: "M1", name: "客服总览" } };
  for (const pathname of ["/service/customers/2005", "/service/customers/2005/"]) {
    assert.deepEqual(crumbsFor(() => pathname, path => path === "/service/overview" ? parent : null).map(crumb => crumb.label), ["UVEL 运营控制台", "M 客服中心", "客户全景档案"]);
  }
  assert.equal(crumbsFor(() => "/service/overview", () => parent).at(-1).label, "M1 客服总览");
  assert.equal(crumbsFor(() => null, () => null).at(-1).label, "运营总览");
});
const sections = [];
function collectSections(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "HubSection"
    && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
      && ((attr.name.text === "id" && attr.initializer?.text === "hub-devices")
        || (attr.name.text === "title" && attr.initializer?.text === "收益明细")))) sections.push(node.getText(ast));
  ts.forEachChild(node, collectSections);
}
collectSections(ast);
assert.equal(sections.length, 2, "actual C1 device and earnings sections");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const format = {}, labels = {};
new Function("exports", compile(readFileSync(new URL("../lib/format.ts", import.meta.url), "utf8")))(format);
new Function("exports", compile(readFileSync(new URL("../lib/admin/c1-detail-display.ts", import.meta.url), "utf8")))(labels);
const helpers = ["asText", "asNumber", "asArray", "rows", "money", "numberLabel", "formatDate", "displayValue",
  "sectionFailed", "Section", "Row", "DataTable", "HubSection"];
const designKit = ts.createSourceFile("design-kit.tsx", readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pagerSource = designKit.statements.filter(node =>
  (ts.isFunctionDeclaration(node) && ["useDataListPager", "DataListPager"].includes(node.name?.text))
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(designKit) === "DEFAULT_PAGE_SIZE_OPTIONS")))
  .map(node => node.getText(designKit)).join("\n");
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "UserDetailPage");
const earningsDeclarations = page.body.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => ["earningsRecords", "earningsPager"].includes(declaration.name.getText(ast))))
  .map(node => node.getText(ast)).join("\n");
const fixtureSource = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helpers.includes(node.name?.text))
  .map(node => node.getText(ast)).join("\n")
  + `\nexport {money,numberLabel,HubSection};\n${pagerSource}\nexport function Fixture({ detail, userKey = "fixture-user" }) { const canWriteC2 = false; ${earningsDeclarations} return (<>{${sections.join("}{")}}</>); }`;
const fixture = {};
const scope = { ...format, ...labels, useEffect, useMemo, useState, formatBusinessTime, nexGridBrandText, formatD4Subtype };
new Function("require", "exports", ...Object.keys(scope), compile(fixtureSource))(
  createRequire(import.meta.url), fixture, ...Object.values(scope));

test("shared full-profile numbers preserve unknown values and confirmed zero", () => {
  for (const value of [null, undefined, "", "invalid", NaN, Infinity, true, []]) {
    assert.equal(fixture.money(value), "-"); assert.equal(fixture.numberLabel(value), "-");
  }
  assert.equal(fixture.money("0"), "$0.00"); assert.equal(fixture.numberLabel(0), "0");
});

test("full-profile unavailable sections offer retry without empty or stale records", () => {
  for (const sourceStatus of ["ERROR", "UNKNOWN", "UNAVAILABLE"]) {
    const html = renderToStaticMarkup(createElement(fixture.HubSection, {
      title: "充值记录", section: { sourceStatus, records: [{ id: "STALE_PRIVATE" }] },
      columns: [{ key: "id", label: "订单" }], children: "STALE_SUMMARY",
    }));
    assert.match(html, /这部分资料加载失败/); assert.match(html, /刷新页面重试/);
    assert.doesNotMatch(html, /暂无记录|STALE_PRIVATE|STALE_SUMMARY/);
  }
  const empty = renderToStaticMarkup(createElement(fixture.HubSection, { title: "充值记录", section: { sourceStatus: "READY", records: [] }, columns: [{ key: "id", label: "订单" }] }));
  assert.match(empty, /暂无记录/); assert.doesNotMatch(empty, /刷新页面重试/);
});

test("support full-profile client uses only the scoped endpoint, validates identity and removes HIDDEN or failed data", async () => {
  const clientAst = ts.createSourceFile("client.ts", client, ts.ScriptTarget.Latest, true);
  const source = clientAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fetchSupportCustomerFullProfile").getText(clientAst);
  const exports = {}, requests = []; let response = { profile: { id: 7 }, devices: { sourceStatus: "READY", records: [{ id: 8 }] }, risk: { sourceStatus: "HIDDEN", records: [{ secret: true }] }, financial: { sourceStatus: "ERROR", wallet: { usdt: "123" } } };
  const supportRequest = async (url, parse, init) => { requests.push({ url, init }); return parse(response); };
  new Function("exports", "supportRequest", "supportObject", "parseSupportId", compile(source))(exports, supportRequest, supportObject, parseSupportId);
  const controller = new AbortController(), result = await exports.fetchSupportCustomerFullProfile("7", controller.signal);
  assert.equal(requests[0].url, "/support-workbench/customers/7/full-profile"); assert.equal(requests[0].init.signal, controller.signal);
  assert.equal(result.risk, null); assert.deepEqual(result.financial, { sourceStatus: "ERROR" }); assert.equal(result.devices.records[0].id, 8);
  response = { profile: { id: 8 } }; await assert.rejects(exports.fetchSupportCustomerFullProfile("7"), /CUSTOMER_MISMATCH/);
  const count = requests.length; await assert.rejects(exports.fetchSupportCustomerFullProfile("../8")); assert.equal(requests.length, count);
});

function fullProfileLoadFixture(supportScope = true, readKey = "fixture", existing) {
  const state = existing?.state ?? { detail: "OLD_PRIVATE", paymentMethods: "OLD_PRIVATE", error: "OLD_ERROR" }, requests = existing?.requests ?? [];
  const currentReadKey = existing?.currentReadKey ?? { current: readKey }, requestGeneration = existing?.requestGeneration ?? { current: 0 };
  const declaration = page.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === "load"));
  const context = { useCallback: fn => fn, supportScope, readKey, currentReadKey, requestGeneration, userKey: "7", errorMessage: error => error.message };
  for (const field of ["Loading", "Error", "Detail", "PaymentMethods", "ActionConfirm", "NotificationEvidence", "DetailKey"]) context[`set${field}`] = value => { state[field[0].toLowerCase() + field.slice(1)] = value; };
  for (const [name, scope] of [["fetchUser360", "c1"], ["fetchSupportCustomerFullProfile", "support"]]) context[name] = (...args) => new Promise((resolve, reject) => requests.push({ scope, args, resolve, reject }));
  const load = new Function(...Object.keys(context), compile(declaration.getText(ast)) + "\nreturn load;")(...Object.values(context));
  return { state, requests, load, currentReadKey, requestGeneration };
}

test("support full-profile clears old data while loading and after 403, retries only the scoped read", async () => {
  const h = fullProfileLoadFixture(), first = h.load();
  assert.equal(h.state.detail, null); assert.equal(h.state.paymentMethods, null); assert.equal(h.state.loading, true);
  h.requests[0].reject(Object.assign(new Error("denied"), { status: 403 })); await first;
  assert.equal(h.state.detail, null); assert.equal(h.state.loading, false); assert.equal(h.state.error, "denied");
  const retry = h.load(); h.requests[1].resolve({ profile: { id: 7 } }); await retry;
  assert.equal(h.state.detail.profile.id, 7); assert.ok(h.requests.every(request => request.scope === "support"));
});

test("full-profile ignores prior identity reads and invalidated in-flight results, while C1 keeps its original loader", async () => {
  const h = fullProfileLoadFixture(), old = h.load(); h.currentReadKey.current = "new-actor";
  const next = fullProfileLoadFixture(true, "new-actor", h), current = next.load();
  h.requests[0].resolve({ profile: { id: 7 }, private: "OLD" }); await old; assert.equal(h.state.detail, null);
  h.requestGeneration.current++; h.requests[1].resolve({ profile: { id: 7 }, private: "REVOKED" }); await current; assert.equal(h.state.detail, null);
  const c1 = fullProfileLoadFixture(false), original = c1.load(); assert.equal(c1.requests[0].scope, "c1"); c1.requests[0].resolve({ profile: { id: 7 } }); await original;
});

test("support scope suppresses writes and extra C1 reads even for superadmin", async () => {
  const declarations = page.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const declared = name => `const ${declarations.find(node => node.name.getText(ast) === name).getText(ast)};`;
  const allowed = new Function("supportScope", "session", compile(["canWriteC1", "canWriteC2", "canReadNotificationEvidence"].map(declared).join("\n")) + "\nreturn [canWriteC1,canWriteC2,canReadNotificationEvidence];");
  assert.deepEqual(allowed(true, { role: "superadmin", authorities: [] }), [false, false, false]);
  let requests = 0;
  const load = new Function("useCallback", "supportScope", "userId", "includeUnbound", "paymentPage", "fetchUserPaymentMethods", compile(declared("loadPaymentMethods")) + "\nreturn loadPaymentMethods;")(fn => fn, true, 7, false, 1, () => { requests++; });
  await load(); assert.equal(requests, 0);
});

test("support full-profile return uses the encoded original conversation or workbench and ignores supplied returnTo", () => {
  const declarations = page.body.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations]);
  const source = ["requestedReturnTo", "conversationNo", "returnTo", "returnLabel"].map(name => `const ${declarations.find(node => node.name.getText(ast) === name).getText(ast)};`).join("\n");
  const destination = new Function("supportScope", "searchParams", compile(source) + "\nreturn [returnTo,returnLabel];");
  for (const conversationNo of ["", "C-7 &next=https://other.invalid"]) {
    const result = destination(true, { get: key => key === "conversationNo" ? conversationNo : "//other.invalid" });
    assert.deepEqual(result, conversationNo ? [`/service/sessions?conversationNo=${encodeURIComponent(conversationNo)}`, "返回原会话"] : ["/service/overview", "返回工作台"]);
  }
});
const historicalDevice = { id: 1158, instanceNo: "fixture-history", name: "S1", productTier: "S1",
  status: "DEACTIVATED", runtimeStatus: "OFFLINE", dailyUsdt: 1, dailyNex: 1 };
function renderDaily(records, overrides = {}) {
  return renderToStaticMarkup(createElement(fixture.Fixture, { detail: {
    devices: { sourceStatus: "READY", records, onlineCount: 0, activeCount: 0, dailyUsdt: 1, dailyNex: 1 },
    earnings: { sourceStatus: "READY", records: [], totalUsdt: 0, totalNex: 10, deviceDailyUsdt: 1, deviceDailyNex: 1 },
    ...overrides,
  } }));
}
const plain = html => html.replace(/<[^>]*>/g, "");

test("C1 labels all listed device configuration values separately from actual earnings", () => {
  const html = renderDaily([historicalDevice]);
  const text = plain(html);
  assert.match(html, /<th[^>]*>设定日收益 USDT<\/th>/);
  assert.match(html, /<th[^>]*>设定日收益 UVT<\/th>/);
  assert.equal(text.match(/设定日收益合计（含已停用设备）/g)?.length, 2);
  assert.equal(text.match(/这是设定值，不是今天实际到账的收益/g)?.length, 2);
  assert.match(text, /收益合计\$0\.00 · 10 UVT/);
  assert.equal(text.match(/设定日收益合计（含已停用设备）\$1\.00 · 1 UVT/g)?.length, 2);
  assert.doesNotMatch(text, /设备日产出|在线 \/ 活跃0 \/ 0日产出/);
});

test("C1 keeps inactive history visible and renders backend totals without recalculation", () => {
  const records = [historicalDevice, { ...historicalDevice, id: 1159, instanceNo: "fixture-active", status: "ACTIVE", runtimeStatus: "ONLINE", dailyUsdt: 7, dailyNex: 8 }];
  const html = renderDaily(records, { devices: { sourceStatus: "READY", records, activeCount: 1, onlineCount: 1, dailyUsdt: 123.45, dailyNex: 67 } });
  const text = plain(html);
  assert.match(text, /fixture-history/);
  assert.match(text, /fixture-active/);
  assert.match(text, /在线 \/ 活跃1 \/ 1/);
  assert.match(text, /设定日收益合计（含已停用设备）\$123\.45 · 67 UVT/);
  assert.match(text, /收益合计\$0\.00 · 10 UVT/);
  assert.match(html, /<tbody><tr[\s\S]*?fixture-history[\s\S]*?<\/tr><tr[\s\S]*?fixture-active/);
});

test("C1 retains missing-section and source-error behavior alongside the configuration explanation", () => {
  assert.doesNotMatch(plain(renderDaily([], { devices: undefined, earnings: undefined })), /设备明细|收益明细/);
  const text = plain(renderDaily([], { devices: { sourceStatus: "ERROR", records: [], dailyUsdt: 0, dailyNex: 0 }, earnings: undefined }));
  assert.match(text, /这部分资料加载失败/);
  assert.match(text, /刷新页面重试/);
  assert.doesNotMatch(text, /暂无记录|设备配置日产基准|\$0\.00/);
});

// Exercise the actual earnings JSX and shared pager without a browser or network.
const element = (type, props) => ({ type, props });
const expand = node => node == null || typeof node === "boolean" ? null : Array.isArray(node) ? node.map(expand)
  : typeof node !== "object" ? node : typeof node.type === "function" ? expand(node.type(node.props))
    : { ...node, props: { ...node.props, children: expand(node.props.children) } };
const text = node => node == null ? "" : Array.isArray(node) ? node.map(text).join("")
  : typeof node === "object" ? text(node.props.children) : String(node);
const nodes = tree => tree == null || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props.children)];
const earningsSample = count => Array.from({ length: count }, (_, i) => ({ id: i + 1, bizNo: `earning-${i + 1}`, asset: "USDT", amount: 1 }));
function earningsHarness(records) {
  const state = [], previousEffects = [];
  let cursor, effectCursor, changed, effects, tree, userKey = "fixture-user";
  const exports = {};
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [state[i], value => { const next = typeof value === "function" ? value(state[i]) : value;
        changed ||= next !== state[i]; state[i] = next; }];
    },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const i = effectCursor++, before = previousEffects[i];
      if (!before || deps.some((value, j) => value !== before[j])) effects.push(fn);
      previousEffects[i] = deps;
    },
  };
  const harnessScope = { ...scope, ...hooks };
  new Function("require", "exports", ...Object.keys(harnessScope), compile(fixtureSource))(
    id => { assert.equal(id, "react/jsx-runtime"); return { jsx: element, jsxs: element }; }, exports, ...Object.values(harnessScope));
  function render() {
    let attempts = 0;
    do {
      assert.ok(++attempts < 4, "earnings pagination settles after records or user changes");
      cursor = effectCursor = 0; changed = false; effects = [];
      tree = expand(exports.Fixture({ userKey, detail: { earnings: { sourceStatus: "READY", records, totalUsdt: 12345.67, totalNex: 98 } } }));
      for (const effect of effects) effect();
    } while (changed);
  }
  render();
  return {
    text: () => text(tree),
    button: label => nodes(tree).find(node => node.type === "button" && node.props["aria-label"] === `收益明细 ${label}`),
    rows: () => nodes(tree).filter(node => node.type === "tbody").flatMap(node => nodes(node)
      .filter(child => child.type === "tr").map(row => text(nodes(row).find(child => child.type === "td")))),
    click(label) { const button = this.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, label); button.props.onClick(); render(); },
    resize(size) { nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: String(size) } }); render(); },
    refresh(next) { records = next; render(); },
    changeUser(next) { userKey = next; render(); },
  };
}

test("C1 earnings renders twenty of 10,385 records while preserving backend totals and record order", () => {
  const records = earningsSample(10385);
  const page = earningsHarness(records);
  assert.deepEqual(page.rows(), records.slice(0, 20).map(row => row.bizNo));
  assert.match(page.text(), /筛选后 10385 条/);
  assert.match(page.text(), /第 1 \/ 520 页/);
  assert.match(page.text(), /收益合计\$12,345\.67 · 98 UVT/);
  assert.equal(page.button("上一页").props.disabled, true);
  page.click("下一页");
  assert.deepEqual(page.rows(), records.slice(20, 40).map(row => row.bizNo));
  page.click("上一页");
  assert.equal(page.rows()[0], "earning-1");
  const visited = [...page.rows()];
  while (!page.button("下一页").props.disabled) {
    page.click("下一页");
    assert.ok(page.rows().length <= 20);
    visited.push(...page.rows());
  }
  assert.deepEqual(visited, records.map(row => row.bizNo));
  assert.match(page.text(), /第 520 \/ 520 页/);
  assert.equal(page.rows().length, 5);
  assert.match(page.text(), /收益合计\$12,345\.67 · 98 UVT/);
  assert.equal(records.length, 10385);
});

test("C1 earnings keeps the final page, page sizes, empty refresh and user switch reachable", () => {
  const page = earningsHarness(earningsSample(45));
  page.click("下一页"); page.click("下一页");
  assert.deepEqual(page.rows(), ["earning-41", "earning-42", "earning-43", "earning-44", "earning-45"]);
  assert.equal(page.button("下一页").props.disabled, true);
  page.refresh(earningsSample(3));
  assert.equal(page.rows().length, 3);
  assert.match(page.text(), /第 1 \/ 1 页/);
  page.refresh(earningsSample(45)); page.click("下一页");
  page.changeUser("next-user");
  assert.equal(page.rows()[0], "earning-1");
  page.resize(10);
  assert.equal(page.rows().length, 10);
  page.click("下一页"); page.resize(50);
  assert.equal(page.rows().length, 45);
  assert.equal(page.rows()[0], "earning-1");
  page.refresh([]);
  assert.equal(page.rows().length, 0);
  assert.match(page.text(), /暂无记录/);
  assert.match(page.text(), /显示 0-0/);
  assert.equal(page.button("上一页").props.disabled, true);
  assert.equal(page.button("下一页").props.disabled, true);
});
