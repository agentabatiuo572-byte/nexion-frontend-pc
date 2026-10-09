import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { after } from "node:test";

// Actual D2 React/DOM lifecycle, offline. No server, real session or business API.
const require = createRequire(import.meta.url);
const ts = require("typescript"), { chromium } = require("@playwright/test");
const modules = Object.fromEntries([
  ["react", "react", "react.development.js"],
  ["react/jsx-runtime", "react", "react-jsx-runtime.development.js"],
  ["react-dom", "react-dom", "react-dom.development.js"],
  ["react-dom/client", "react-dom", "react-dom-client.development.js"],
  ["scheduler", "scheduler", "scheduler.development.js"],
].map(([id, pkg, file]) => [id, fs.readFileSync(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), "cjs", file), "utf8")]));
for (const [id, file] of [
  ["d2", process.env.D2_FOCUS_SOURCE_FILE || "app/components/domain-views/d-tabs/d2-withdrawals.tsx"],
  ["@/app/components/kit/tab-group", "app/components/kit/tab-group.tsx"],
  ["./tab-group-keyboard", "app/components/kit/tab-group-keyboard.ts"],
  ["@/lib/admin/pending-mutation-store", "lib/admin/pending-mutation-store.ts"],
  ["@/lib/admin/bank-payout-evidence", "lib/admin/bank-payout-evidence.ts"],
  ["./strict-number.ts", "lib/admin/strict-number.ts"],
]) modules[id] = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
modules["@/lib/store/admin-auth"] = `exports.useAdminAuth=selector=>selector({session:{authorities:["finance_d2_withdrawal_batch","finance_d2_withdrawal_approve","finance_d2_withdrawal_delay","finance_d2_withdrawal_freeze","finance_d2_withdrawal_reject"]}});`;
modules["@/lib/admin/current-operator"] = `exports.currentAdminOperator=()=>window.__d2.forbid("operator");`;
modules["@/lib/admin/error-messages"] = `exports.displayAdminError=error=>error.message;`;
modules["../design-kit"] = `exports.Drawer=()=>window.__d2.forbid("drawer");exports.KV=()=>window.__d2.forbid("detail");`;
modules["@/lib/admin/d-client"] = `
  exports.fetchD2Withdrawals=params=>new Promise((resolve,reject)=>window.__d2.rows.push({params,resolve,reject}));
  exports.fetchD5WithdrawalParams=()=>new Promise((resolve,reject)=>window.__d2.limits.push({resolve,reject}));
  for(const name of ["fetchD2DevelopmentCapabilities","fetchD2WithdrawalDetail","fetchD2BankPayout","requeryD2BankPayout","reviewD2Withdrawal","reviewD2WithdrawalsBatch","simulateD2CooldownExpiry"])
    exports[name]=()=>window.__d2.forbid(name);
  exports.isDOutcomeUnknownError=()=>false;
`;
let browser;
after(async () => { await browser?.close(); });
async function offlineD2() {
  browser ??= await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => console.error("Offline D2 fixture error:", error.message));
  let networkRequests = 0;
  await page.route("**/*", route => { networkRequests++; return route.abort(); });
  await page.setContent('<main></main>');
  await page.addScriptTag({ content: `
    const sources=${JSON.stringify(modules)},cache={};
    function load(id){if(cache[id])return cache[id].exports;if(!sources[id])throw Error("Unexpected offline module: "+id);const module={exports:{}};cache[id]=module;new Function("module","exports","require","process",sources[id])(module,module.exports,load,{env:{NODE_ENV:"development"}});return module.exports;}
    window.__d2={rows:[],limits:[],forbidden:[],nodes:{},forbid(name){this.forbidden.push(name);throw Error("Offline fixture forbids "+name);}};
    const React=load("react"),D2=load("d2").D2Withdrawals;
    load("react-dom/client").createRoot(document.querySelector("main")).render(React.createElement(D2,{ctx:{toast:()=>window.__d2.forbid("toast"),openActionConfirm:()=>window.__d2.forbid("confirmation")}}));
  ` });
  await requests(page, 1);
  return { page, async close() {
    assert.equal(networkRequests, 0, "Offline D2 attempted a network request");
    assert.deepEqual(await page.evaluate(() => window.__d2.forbidden), [], "Unexpected detail/financial command");
    await page.close();
  } };
}
async function requests(page, count) {
  await page.waitForFunction(n => window.__d2.rows.length === n && window.__d2.limits.length === n, count);
  await page.waitForFunction(() => document.querySelector("main").textContent.includes("D2 数据加载中..."));
}
async function settle(page, index, records = [], rejectLimits = false) {
  await page.evaluate(({ index, records, rejectLimits }) => {
    window.__d2.rows[index].resolve({ total: records.length, pageNum: 1, pageSize: 10, records });
    if (rejectLimits) window.__d2.limits[index].reject(new Error("Offline D5 fixture failure"));
    else window.__d2.limits[index].resolve({ dailyLimitCount: 3 });
  }, { index, records, rejectLimits });
  await page.waitForFunction(() => !document.querySelector("main").textContent.includes("D2 数据加载中..."));
}
async function remember(page, key, locator) {
  await locator.evaluate((element, key) => { window.__d2.nodes[key] = element; }, key);
  await locator.focus();
}
async function retained(page, key, phase, t) {
  const state = await page.evaluate(key => {
    const node = window.__d2.nodes[key];
    return { connected: node.isConnected, focused: document.activeElement === node,
      sameNode: node === (key === "status" ? document.querySelector(".d2-search-toolbar select") : [...document.querySelectorAll("button")].find(b => b.textContent === "查询")),
      activeTag: document.activeElement.tagName };
  }, key);
  t.diagnostic(JSON.stringify({ phase, control: key, ...state }));
  assert.equal(state.connected, true, `${phase}: original ${key} was unmounted`);
  assert.equal(state.sameNode, true, `${phase}: ${key} was replaced`);
  assert.equal(state.focused, true, `${phase}: ${key} lost focus`);
}
const fixtureRow = { withdrawalNo: "OFFLINE-WD-1", userNo: "OFFLINE-U-1", nickname: "合成用户", asset: "USDT", chain: "BEP20", amount: 10, netReceive: 9, actualFee: 1, status: "REVIEW_PENDING", riskScore: 10, routingPriority: "LOW", k3RiskRoute: "pass", userStatus: "active", withdrawalCount24h: 1, previousStatus: "SUBMITTED", createdAt: "2026-10-09T00:00:00" };

test("D2 empty status reload retains the same native select and focus through pending and settled", { timeout: 30000 }, async t => {
  const fixture = await offlineD2(), { page } = fixture;
  try {
    await settle(page, 0);
    const status = page.locator(".d2-search-toolbar select");
    await remember(page, "status", status);
    await page.keyboard.press("ArrowDown");
    await requests(page, 2);
    await retained(page, "status", "empty-to-pending", t);
    assert.deepEqual(await page.locator(".f-stats .v").allTextContents(), ["—", "—", "—", "—"]);
    await settle(page, 1);
    await retained(page, "status", "empty-settled", t);
    assert.equal(await status.inputValue(), "SUBMITTED");
    await page.keyboard.press("Home");
    await requests(page, 3);
    await retained(page, "status", "home-all-pending", t);
    await settle(page, 2, [fixtureRow]);
    await retained(page, "status", "all-nonempty-settled", t);
    assert.equal(await status.inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "打开提现单 OFFLINE-WD-1 的详情", exact: true }).count(), 1);
  } finally { await fixture.close(); }
});

test("D2 Query Enter from an empty result keeps its DOM node and focus after success and failure", { timeout: 30000 }, async t => {
  const fixture = await offlineD2(), { page } = fixture;
  try {
    await settle(page, 0);
    const query = page.getByRole("button", { name: "查询", exact: true });
    await remember(page, "query", query);
    await page.keyboard.press("Enter");
    await requests(page, 2);
    await retained(page, "query", "query-enter-pending", t);
    await settle(page, 1);
    await retained(page, "query", "query-enter-settled", t);
    await page.keyboard.press("Enter");
    await requests(page, 3);
    await settle(page, 2, [], true);
    await retained(page, "query", "query-d5-failure", t);
    assert.match(await page.locator("main").textContent(), /D2 数据加载失败.*写操作已关闭/);
    assert.equal(await page.getByRole("button", { name: "批量执行", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.locator(".f-stats .v").allTextContents(), ["—", "—", "—", "—"]);
    await page.keyboard.press("Enter");
    await requests(page, 4);
    await settle(page, 3);
    await retained(page, "query", "query-retry-settled", t);
  } finally { await fixture.close(); }
});

test("D2 pending reads do not publish zero statistics or enable writes, and stale responses cannot replace latest rows", { timeout: 30000 }, async () => {
  const fixture = await offlineD2(), { page } = fixture;
  try {
    assert.deepEqual(await page.locator(".f-stats .v").allTextContents(), ["—", "—", "—", "—"]);
    assert.doesNotMatch(await page.locator("main").textContent(), /共 0 条|暂无提现记录/);
    await page.evaluate(record => window.__d2.rows[0].resolve({ total: 1, pageNum: 1, pageSize: 10, records: [record] }), fixtureRow);
    assert.equal(await page.getByRole("button", { name: "批量执行", exact: true }).isDisabled(), true);
    assert.deepEqual(await page.locator(".f-stats .v").allTextContents(), ["—", "—", "—", "—"]);
    await settle(page, 0, [fixtureRow]);
    const query = page.getByRole("button", { name: "查询", exact: true });
    await query.press("Enter"); await requests(page, 2);
    await page.locator(".d2-search-toolbar select").press("ArrowDown"); await requests(page, 3);
    await settle(page, 2);
    await settle(page, 1, [fixtureRow], true);
    assert.equal(await page.getByRole("button", { name: "打开提现单 OFFLINE-WD-1 的详情", exact: true }).count(), 0);
    assert.equal(await page.locator(".f-stat").first().locator(".v").textContent(), "0");
    assert.doesNotMatch(await page.locator("main").textContent(), /D2 数据加载失败/);
  } finally { await fixture.close(); }
});

const page = fs.readFileSync("app/components/domain-views/d-tabs/d2-withdrawals.tsx", "utf8");
const d5Page = fs.readFileSync("app/components/domain-views/d-tabs/d5-params.tsx", "utf8");
const client = fs.readFileSync("lib/admin/d-client.ts", "utf8");
const dCss = fs.readFileSync("app/components/domain-views/d-domain.css", "utf8");
const financeRoute = fs.readFileSync("app/api/admin/finance/[...path]/route.ts", "utf8");

test("D2 uses direct business confirmation with exact authority rendering", () => {
  assert.doesNotMatch(page, /usePropose|进入 A2 待确认队列|findHighOp/);
  assert.match(page, /useAdminAuth/);
  for (const authority of [
    "finance_d2_withdrawal_approve",
    "finance_d2_withdrawal_delay",
    "finance_d2_withdrawal_freeze",
    "finance_d2_withdrawal_unfreeze",
    "finance_d2_withdrawal_reject",
    "finance_d2_withdrawal_refund",
    "finance_d2_withdrawal_batch",
  ]) assert.match(page, new RegExp(authority));
});

test("D2 exposes detail, structured lifecycle forms and batch splitting UI", () => {
  assert.match(page, /单笔详情/);
  assert.match(page, /批量执行/);
  assert.match(page, /等待天数/);
  assert.match(page, /责任人/);
  assert.match(page, /复查时间/);
  assert.match(page, /冻结期限/);
  assert.match(page, /手动退款/);
  assert.match(page, /inputKind: "datetime-local"/);
  assert.match(page, /addressVerified/);
  assert.match(page, /IP 段/);
  assert.match(page, /排序字段/);
  assert.match(page, /毛手续费/);
  assert.match(page, /费用减免/);
  assert.match(page, /NEX抵扣率/);
  assert.match(page, /K4 评分明细/);
  assert.match(page, /全部提现历史/);
  assert.match(client, /reviewD2WithdrawalsBatch/);
  assert.match(client, /fetchD2WithdrawalDetail/);
});

test("D2 presents an immediately visible drawer with compact Chinese operations copy", () => {
  assert.match(page, /import \{ Drawer, KV,/);
  assert.match(page, /<Drawer[\s\S]*title=\{`单笔详情/);
  assert.match(page, /详情中查看完整费用/);
  assert.match(page, /H1_COOLDOWN_FAST_TRACK:\s*"低风险提现冷却中，到期后系统自动复查"/);
  assert.doesNotMatch(page, /延长持有\(extended-hold\)/);
  assert.doesNotMatch(page, /已提交\(submitted\)/);
  assert.match(dCss, /\.ddom \.d2-fee-summary/);
  assert.match(dCss, /\.ddom \.d2-detail-grid/);
});

test("D2 truncates long withdrawal and asset-chain labels while exposing the full value", () => {
  assert.match(page, /className="l-btn sm d2-withdrawal-link"/);
  assert.match(page, /title=\{row\.withdrawalNo\}/);
  assert.match(page, /aria-label=\{`打开提现单 \$\{row\.withdrawalNo\} 的详情`\}/);
  assert.match(page, /className="d2-cell-ellipsis">\{row\.withdrawalNo\}<\/span>/);
  assert.match(page, /title=\{`\$\{row\.asset\} \/ \$\{row\.chain\}`\}/);
  assert.match(page, /aria-label=\{`资产与渠道：\$\{row\.asset\} \/ \$\{row\.chain\}`\}/);
  assert.match(dCss, /\.ddom \.d2-cell-ellipsis\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(dCss, /\.ddom \.d2-withdrawal-link\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
});

test("D2 lets operators select rows before choosing a permitted batch action", () => {
  assert.doesNotMatch(page, /if \(!action\) return false/);
  assert.match(page, /availableBatchActions/);
  assert.match(page, /可先勾选提现单，再选择批量动作/);
  assert.match(page, /已勾选 \{selectedRows\.length\} 笔/);
  assert.match(page, /batchTargets\(visibleRows, current, "", availableBatchActions\)/);
  assert.doesNotMatch(page, /batchTargets\(visibleRows, current, batchAction, availableBatchActions\)/);
  assert.match(page, /当前批量动作“\$\{actionLabel\(batchAction\)\}”不适用于该状态/);
  assert.match(page, /disabled=\{!selectable && !selectedNow\}/);
  assert.match(dCss, /\.ddom \.d2-selection-note/);
});

test("D2 separates the primary search bar from advanced filters", () => {
  assert.match(page, /d2-search-toolbar/);
  assert.match(page, /高级筛选/);
  assert.match(page, /d2-advanced-filters/);
  assert.match(dCss, /\.ddom \.d2-search-toolbar/);
  assert.match(dCss, /\.ddom \.d2-advanced-filters/);
  assert.match(page, /void load\(1, \{[\s\S]*minAmount: "", maxAmount: "", minRiskScore: ""/);
});

test("D2 detail fetch is latest-only and fails closed before any write", () => {
  assert.match(page, /const detailRequestSeq = useRef\(0\)/);
  assert.match(page, /const seq = \+\+detailRequestSeq\.current/);
  assert.match(page, /if \(seq === detailRequestSeq\.current\) \{ setDetail\(latest\); setBankDetail\(bank\); \}/);
  assert.match(page, /detailRequestSeq\.current \+= 1/);
  assert.match(page, /setDetailError\(message\)/);
  assert.match(page, /detailLoading \|\| !!detailError/);
  assert.match(page, /为避免按旧数据处置，写操作已关闭/);
});

test("D2 exposes an order-scoped development cooldown simulation without client time travel", () => {
  assert.match(client, /fetchD2DevelopmentCapabilities/);
  assert.match(client, /simulateD2CooldownExpiry/);
  assert.match(client, /\/withdrawals\/development\/capabilities/);
  assert.match(client, /\/withdrawals\/development\/\$\{encodeURIComponent\(withdrawalNo\)\}\/simulate-cooldown-expiry/);
  assert.match(financeRoute, /parts\.length === 3[\s\S]*parts\[0\] === "withdrawals"[\s\S]*parts\[1\] === "development"[\s\S]*parts\[2\] === "capabilities"/);
  assert.match(financeRoute, /parts\.length === 4[\s\S]*parts\[0\] === "withdrawals"[\s\S]*parts\[1\] === "development"[\s\S]*parts\[3\] === "simulate-cooldown-expiry"/);
  assert.match(financeRoute, /return null;/);
  assert.doesNotMatch(financeRoute, /parts\[1\] === "development"[\s\S]{0,160}return `\/api\/admin\/finance\/withdrawals\/development\/\$\{parts\.slice/s);
  assert.match(page, /模拟冷却到期/);
  assert.match(page, /仅开发环境/);
  assert.match(page, /按真实到期状态机重新检查 K3、K4、B1/);
  assert.match(page, /developmentSimulationScope/);
  assert.match(page, /row\.status\.toUpperCase\(\) === "EXTENDED_HOLD"/);
  assert.match(page, /row\.previousStatus\.toUpperCase\(\) === "REVIEW_PASSED"/);
  assert.match(page, /pendingKeys\.remember\(scope, key\)/);
  assert.doesNotMatch(client, /targetTime|effectiveNow|requestedAt/);
  assert.doesNotMatch(page, /simulateD2CooldownExpiry\([^)]*Date\./s);
});

test("D2 localizes unknown machine values instead of exposing raw codes", () => {
  assert.match(page, /\^\[A-Z0-9_.:-\]\+\$\/i/);
  assert.match(page, /未识别路由/);
  assert.match(page, /未识别账户状态/);
  assert.match(page, /未识别期限/);
  assert.match(page, /ruleSummary\(row\.hitRules\)/);
  assert.match(page, /userStatusLabel\(row\.userStatus\)/);
});

test("D2 blocks SENT freeze and keeps idempotency keys below the server limit", () => {
  assert.doesNotMatch(page, /\["REVIEW_PASSED",\s*"PENDING_CHAIN",\s*"PROCESSING",\s*"SENT",\s*"CHAIN_SUBMITTED"\]/);
  assert.match(page, /scope\.replace\([^)]*\)\.slice\(0,\s*12\)/);
  assert.match(page, /uuid\.replaceAll\("-", ""\)\.slice\(0, 16\)/);
  assert.doesNotMatch(page, /\$\{Date\.now\(\)\}/);
});

test("D2 fails closed when persisted fee snapshot facts are absent", () => {
  assert.match(client, /function d2Number\(/);
  // FEAT-WD02 双形态:共享费字段仍必填解析;旧模型六字段改为可空解析(新单后端序列化 null,
  // 必填会把 100% 新单打成 invalid),各形态缺自家字段的 fail-closed 在 financialInvariants 分支验
  // (行为固定靶见 tests/wd02-network-confirm-fee-contract.test.mjs 三态测试)。
  for (const field of ["nexBurned", "nexFeeOffsetRate", "feeWaived", "actualFee", "netReceive"]) {
    assert.match(client, new RegExp(`${field}: d2Number\\(row\\.${field}`));
  }
  for (const field of ["networkFeeRate", "networkFeeMin", "networkFeeMax", "networkFee", "penaltyFeeRate", "grossFee"]) {
    assert.match(client, new RegExp(`${field}: d2NullableNumber\\(row\\.${field}`));
  }
  // 判型键 + 双形态分支存在
  assert.match(client, /networkConfirmUsd = d2NullableNumber\(row\.networkConfirmUsd/);
  assert.match(client, /feeModel: networkConfirmUsd !== null \? "confirm" : "legacy"/);
  assert.match(client, /d2Invalid\("withdrawal\.feeModel"\)/);
});

test("D2 fails closed on dependent facts and reuses a stable command key", () => {
  assert.doesNotMatch(page, /fetchD5WithdrawalParams\(\)\.catch\(\(\) => null\)/);
  assert.match(page, /setRows\([^)]*records:\s*\[\]/s);
  assert.match(page, /writesEnabled/);
  assert.match(client, /idempotencyKey/);
});

test("D2 preserves a missing K4 score as unavailable and blocks approval", () => {
  assert.match(client, /riskScore: number \| null/);
  assert.match(client, /riskScore: d2NullableNumber\(row\.riskScore\)/);
  assert.match(client, /routingPriority: "ESCALATED" \| "HIGH" \| "NORMAL" \| "LOW" \| "UNAVAILABLE"/);
  assert.match(page, /K4 风险评分不可用/);
  assert.match(page, /action === "APPROVE" && routingUnavailable\(row\)/);
  assert.match(page, /按当前生效 K4 模型动态路由/);
  assert.match(page, /row\.k4AutoEscalateScore/);
  assert.doesNotMatch(page, /riskScore\s*>?=\s*70/);
  assert.doesNotMatch(page, /K4 风险分 ≥ 70/);
  assert.doesNotMatch(page, /K4 风险分 \$\{row\.riskScore\}/);
});

test("D5 exposes the canonical NEX fee offset that D2 snapshots", () => {
  assert.match(client, /nexFeeOffsetRate: d5Number\(raw\.nexFeeOffsetRate/);
  assert.match(client, /"nexFeeOffsetRate"/);
  assert.match(d5Page, /NEX 抵扣率/);
  assert.match(d5Page, /\{ nexFeeOffsetRate: nex \}/);
  assert.match(d5Page, /nexFeeOffsetRate\.toFixed\(2\)\}\/NEX/);
});

test("D5 renders each write control only for its exact authority", () => {
  assert.match(d5Page, /useAdminAuth/);
  assert.match(d5Page, /finance_d5_daily_limit_write/);
  assert.match(d5Page, /finance_d5_balance_max_write/);
  assert.match(d5Page, /finance_d5_fee_write/);
  assert.match(d5Page, /canDailyWrite\s*&&/);
  assert.match(d5Page, /canBalanceWrite\s*&&/);
  assert.match(d5Page, /canFeeWrite\s*&&/);
});

test("D2 probes development capability only in a private local dev detail", () => {
  assert.match(page, /process\.env\.NODE_ENV !== "development"/);
  assert.match(page, /\["localhost", "127\.0\.0\.1", "::1"\]\.includes\(window\.location\.hostname\)/);
  assert.match(page, /developmentCapabilitiesProbed/);
  assert.match(page, /!detail \|\| developmentCapabilitiesProbed\.current\) return;/);
  assert.match(page, /\}, \[detail\]\);/);
  assert.match(page, /\.catch\(\(\) => \{ if \(active\) setDevelopmentCapabilities\(null\); \}\)/);
});
