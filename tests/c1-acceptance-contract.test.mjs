import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
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
const fixtureSource = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helpers.includes(node.name?.text))
  .map(node => node.getText(ast)).join("\n")
  + `\nexport function Fixture({ detail }) { const canWriteC2 = false; return (<>{${sections.join("}{")}}</>); }`;
const fixture = {};
const scope = { ...format, ...labels };
new Function("require", "exports", ...Object.keys(scope), compile(fixtureSource))(
  createRequire(import.meta.url), fixture, ...Object.values(scope));
const historicalDevice = { id: 1158, instanceNo: "fixture-history", name: "S1", productTier: "S1",
  status: "DEACTIVATED", runtimeStatus: "OFFLINE", dailyUsdt: 1, dailyNex: 1 };
function renderDaily(records, overrides = {}) {
  return renderToStaticMarkup(fixture.Fixture({ detail: {
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
