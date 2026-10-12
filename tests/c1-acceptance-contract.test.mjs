import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { createElement, useEffect, useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
  assert.match(detail, /本卡片数据读取失败，其他画像卡片不受影响/);
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
  assert.match(detail, /风险评分不可用/);
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
  "sectionStatus", "sectionFailed", "Section", "Row", "DataTable", "HubSection"];
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
  + `\n${pagerSource}\nexport function Fixture({ detail, userKey = "fixture-user" }) { const canWriteC2 = false; ${earningsDeclarations} return (<>{${sections.join("}{")}}</>); }`;
const fixture = {};
const scope = { ...format, ...labels, useEffect, useMemo, useState };
new Function("require", "exports", ...Object.keys(scope), compile(fixtureSource))(
  createRequire(import.meta.url), fixture, ...Object.values(scope));
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
  assert.match(html, /<th[^>]*>配置日产基准 USDT<\/th>/);
  assert.match(html, /<th[^>]*>配置日产基准 NEX<\/th>/);
  assert.equal(text.match(/设备配置日产基准（所列记录合计）/g)?.length, 2);
  assert.equal(text.match(/含已停用历史记录的配置值，不代表今日实际收益或钱包入账/g)?.length, 2);
  assert.match(text, /收益合计\$0\.00 · 10 NEX/);
  assert.equal(text.match(/设备配置日产基准（所列记录合计）\$1\.00 · 1 NEX/g)?.length, 2);
  assert.doesNotMatch(text, /设备日产出|在线 \/ 活跃0 \/ 0日产出/);
});

test("C1 keeps inactive history visible and renders backend totals without recalculation", () => {
  const records = [historicalDevice, { ...historicalDevice, id: 1159, instanceNo: "fixture-active", status: "ACTIVE", runtimeStatus: "ONLINE", dailyUsdt: 7, dailyNex: 8 }];
  const html = renderDaily(records, { devices: { sourceStatus: "READY", records, activeCount: 1, onlineCount: 1, dailyUsdt: 123.45, dailyNex: 67 } });
  const text = plain(html);
  assert.match(text, /fixture-history/);
  assert.match(text, /fixture-active/);
  assert.match(text, /在线 \/ 活跃1 \/ 1/);
  assert.match(text, /设备配置日产基准（所列记录合计）\$123\.45 · 67 NEX/);
  assert.match(text, /收益合计\$0\.00 · 10 NEX/);
  assert.match(html, /<tbody><tr[\s\S]*?fixture-history[\s\S]*?<\/tr><tr[\s\S]*?fixture-active/);
});

test("C1 retains missing-section and source-error behavior alongside the configuration explanation", () => {
  assert.doesNotMatch(plain(renderDaily([], { devices: undefined, earnings: undefined })), /设备明细|收益明细/);
  const text = plain(renderDaily([], { devices: { sourceStatus: "ERROR", records: [], dailyUsdt: 0, dailyNex: 0 } }));
  assert.match(text, /本卡片数据读取失败/);
  assert.match(text, /暂无记录/);
  assert.match(text, /设备配置日产基准（所列记录合计）\$0\.00 · 0 NEX/);
  assert.match(text, /含已停用历史记录的配置值，不代表今日实际收益或钱包入账/);
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
  assert.match(page.text(), /收益合计\$12,345\.67 · 98 NEX/);
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
  assert.match(page.text(), /收益合计\$12,345\.67 · 98 NEX/);
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
