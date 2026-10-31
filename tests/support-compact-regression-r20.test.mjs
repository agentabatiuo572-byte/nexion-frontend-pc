import * as systemBrand from "../lib/admin/brand-copy.ts";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as businessTime from "../lib/admin/business-time.ts";
const { formatBusinessTime } = businessTime;
import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
const require = createRequire(import.meta.url);
const root = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const read = file => fs.readFileSync(process.env.SUPPORT_COMPACT_SOURCE_ROOT && fs.existsSync(path.join(process.env.SUPPORT_COMPACT_SOURCE_ROOT, file)) ? path.join(process.env.SUPPORT_COMPACT_SOURCE_ROOT, file) : path.join(root, file), "utf8");
const component = name => read(`app/components/domain-views/m-tabs/${name}.tsx`);
function evaluate(source, bindings = {}, dependencies = {}) {
  dependencies = { "@/app/components/payment-security/payment-security-card": { PaymentSecurityCard: () => null },
    "@/lib/admin/payment-password-client": { paymentSecurityPorts: { support: userId => ({ key: `support:${userId}`, userId }) } },
    "@/lib/admin/shell-authorities": { adminShellSessionKey: () => "1:12" }, ...dependencies };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { module, exports: module.exports, AbortController, ...bindings, require: id => id === "@/lib/admin/brand-copy" ? systemBrand : Object.hasOwn(dependencies, id) ? dependencies[id] : id.endsWith(".css") ? {} : require(id) });
  return module.exports;
}
const compactSupportBoardValue = evaluate(component("support-leaderboard")).compactSupportBoardValue;
const group = data => ({ status: "READY", data, evaluatedAt: "2026-10-10T00:00:00Z" });
const financeKeys = ["netContributionTotal", "creditedDepositTotal", "successfulWithdrawalPrincipalTotal", "successfulWithdrawalFeeTotal", "successfulWithdrawalNetTotal", "processingWithdrawalPrincipalTotal", "balance", "availableBalance"];
const profile = (status = "UNKNOWN") => ({ identity: group({ nickname: "私有旧资料" }), finance: group({ byCurrency: [{ currency: "USDT", ...Object.fromEntries(financeKeys.map(key => [key, key === "balance" ? "42.5" : null])), fieldStatuses: Object.fromEntries(financeKeys.map(key => [key, key === "balance" ? "READY" : status])) }] }), devices: group({}), risk: group({}), annotations: group({ customTags: [], notes: [] }), service: group({}), actions: {} });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const nodes = x => Array.isArray(x) ? x.flatMap(nodes) : x && typeof x === "object" && !x.props?.hidden ? [x, ...nodes(x.props?.children)] : [];
const text = x => Array.isArray(x) ? x.map(text).join("") : x && typeof x === "object" ? text(x.props?.children) : x == null ? "" : String(x);
function hooks() {
  const states = [], refs = [], effects = [], pending = [];
  let stateIndex, refIndex, effectIndex, writes = 0;
  return { states, get writes() { return writes; }, reset() { stateIndex = refIndex = effectIndex = 0; },
    react: { useState(initial) { const i = stateIndex++; if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial; return [states[i], value => { writes++; states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
      useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; }, useMemo(fn) { return fn(); },
      useEffect(fn, deps) { const i = effectIndex++; if (!effects[i] || deps.some((value, index) => !Object.is(value, effects[i].deps[index]))) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); } },
    hasPendingEffects() { return pending.length > 0; }, runEffects() { pending.splice(0).forEach(fn => fn()); }, unmount() { effects.forEach(effect => effect.cleanup?.()); } };
}
function profileHarness(initial = profile()) {
  const h = hooks(), requests = [], props = { customerId: "101", scopeVersion: 1, conversation: { id: "CV-101", ownerAdminId: 12 }, onHistory() {}, onRetryMessages() {}, ctx: { pget: () => "[]", invalidateScope() {}, addCustomerTag: async () => true } };
  const listeners = new Set(), window = { addEventListener: (_type, listener) => listeners.add(listener), removeEventListener: (_type, listener) => listeners.delete(listener) };
  const exports = evaluate(component("m3-customer-profile"), { window, document: { querySelectorAll: () => [] } }, {
    "@/lib/admin/business-time": businessTime,
    react: h.react, "@/lib/store/admin-auth": { useAdminAuth: selector => selector({ authEpoch: 1, session: { adminId: 12, role: "super", authorities: ["service_m3_write"] } }) },
    "@/lib/admin/m-support-enhancements": { supportEnhancements: { profile() { const request = deferred(); requests.push(request); return request.promise; }, devices: async () => group({ total: 0, heldCount: 0, fieldStatuses: { heldCount: "READY" }, onlineCount: 0, records: [] }), flows: async () => group({ total: 0, records: [] }) } },
    "@/lib/admin/m-support-client": { supportClient: { maintenanceHistory: async () => ({ totalExecutions: 0, totalCycles: 0, cycles: [], executions: [] }) }, SupportClientError: class extends Error {} },
    "@/lib/admin/error-messages": { displayAdminError: () => "加载失败" }, "../design-kit": { Modal: props => React.createElement("div", {}, props.children), Icon: () => null },
    "./hd-ui": { HDSelect: () => null },
    "./support-avatar": { SupportAvatar: () => null, customerAvatarPath: () => "", advisorAvatarPath: () => "" }, "./support-leaderboard": { compactSupportBoardValue },
  });
  const render = (detail = true) => { h.reset(); let tree = exports.M3CustomerProfile(props); if (detail && !nodes(tree).some(node => node.props?.title === "客户服务 360")) { nodes(tree).find(node => node.type === "button" && node.props.children === "说明").props.onClick(); h.reset(); tree = exports.M3CustomerProfile(props); } return tree; };
  render(false); h.runEffects(); h.states[0] = initial;
  return { ...h, h, props, requests, render, html: (detail = true) => { const tree = render(detail); return renderToStaticMarkup(nodes(tree).find(node => node.props?.title === "客户服务 360") ?? tree); }, seed: value => { h.states[0] = value; } };
}
test("R20CE-01 actual finance retry clears 42.5 before request and after rejection", async () => {
  const h = profileHarness(); assert.match(h.html(), /42\.5 USDT/);
  nodes(h.render()).find(node => node.type === "button" && text(node) === "重新加载资金").props.onClick();
  assert.doesNotMatch(h.html(), /42\.5 USDT/);
  h.requests.at(-1).reject(new Error("failed")); await flush();
  assert.equal(h.h.states[0].finance.status, "ERROR"); assert.equal(h.h.states[0].finance.data, null);
  assert.doesNotMatch(h.html(), /42\.5 USDT/); assert.match(h.html(), /加载失败/);
});
test("R20CE-03 actual READY finance distinguishes field permissions, failure and unknown with valid next step", () => {
  for (const [status, reason, retry] of [["FORBIDDEN", "无查看权限，请联系管理员核对权限", false], ["ERROR", "加载失败", true], ["UNKNOWN", "暂时无法确认", true]]) {
    const h = profileHarness(profile(status)), html = h.html();
    assert.match(html, new RegExp(reason)); assert.equal(html.includes("重新加载资金"), retry);
    assert.match(html, /42\.5 USDT/); assert.equal((html.match(/<span class="v">-<\/span>/g) ?? []).length, 7);
    assert.doesNotMatch(html, /FORBIDDEN|UNKNOWN|API|数据库|fieldStatuses/);
  }
});
test("R20CE-PARTIAL actual finance shows partial amounts and keeps complete NET distinct", () => {
  const value=profile();const usd=value.finance.data.byCurrency[0];
  Object.assign(usd,{creditedDepositTotal:"749",successfulWithdrawalPrincipalTotal:"100",netContributionTotal:"849"});
  Object.assign(usd.fieldStatuses,{creditedDepositTotal:"PARTIAL",successfulWithdrawalPrincipalTotal:"PARTIAL",netContributionTotal:"READY"});
  const nex=structuredClone(usd);Object.assign(nex,{currency:"UVT",creditedDepositTotal:"12.000001",successfulWithdrawalPrincipalTotal:null,netContributionTotal:"-12.000001",balance:"0"});
  nex.fieldStatuses.successfulWithdrawalPrincipalTotal="UNKNOWN";value.finance.data.byCurrency.push(nex);
  const html=profileHarness(value).html();
  assert.match(html,/749 USDT（部分统计）/);assert.match(html,/100 USDT（部分统计）/);assert.match(html,/12\.000001 UVT（部分统计）/);
  assert.match(html,/849 USDT<\/span>/);assert.match(html,/-12\.000001 UVT<\/span>/);assert.match(html,/0 UVT<\/span>/);
  assert.doesNotMatch(html.replace(/<[^>]*>/g,""),/PARTIAL|fieldStatuses|API|数据库|聚合|投影|夹具|验收/);
  assert.doesNotMatch(html,/累计成功充值实际入账暂时无法确认/);
});
test("R20CE-04 actual formatter and numeric Row preserve finite scientific number and exact decimal string", () => {
  for (const value of [1e-8, "0.00000001", Number.MIN_VALUE]) assert.equal(compactSupportBoardValue(value), "<0.01");
  assert.equal(compactSupportBoardValue(-1e-8), ">-0.01"); assert.equal(compactSupportBoardValue(1e21), "1000000000T");
  assert.equal(compactSupportBoardValue("1e-8"), "-");
  const h = profileHarness(); h.h.states[6] = group({ total: 0, onlineCount: 0, hashrateTotal: 1e-8, records: [{ id: "1", dailyUsdt: 1e-8, hashrate: "9007199254740993.12345678" }] });
  assert.match(h.html(), /实际收益<\/span><span class="v">1e-8/); assert.match(h.html(), /9007199254740993\.12345678/);
});
test("R20CE-05 actual device and maintenance count rows reject negative/fraction and retain real zero", () => {
  const h = profileHarness();
  h.h.states[6] = group({ total: -1, heldCount: -1, fieldStatuses: { heldCount: "READY" }, onlineCount: 0.5, records: [] });
  h.h.states[20] = { totalExecutions: -1, totalCycles: 0.5, cycles: [], executions: [] };
  for (const label of ["持有设备", "在网设备", "维护执行次数", "维护周期总数"]) assert.match(h.html(), new RegExp(`${label}</span><span class="v">-</span>`));
  h.h.states[6] = group({ total: 0, heldCount: 0, fieldStatuses: { heldCount: "READY" }, onlineCount: 0, records: [] });
  h.h.states[20] = { totalExecutions: 0, totalCycles: 0, cycles: [], executions: [] };
  for (const label of ["持有设备", "在网设备", "维护执行次数", "维护周期总数"]) assert.match(h.html(), new RegExp(`${label}</span><span class="v">0</span>`));
});
test("R20CE-DEVICE actual current holding stays separate from refund history in sidebar and full profile", () => {
  const h = profileHarness();
  h.h.states[6] = group({ total: 1, heldCount: 0, fieldStatuses: { heldCount: "READY" }, onlineCount: 0,
    records: [{ id: "93", name: "S1", instanceNo: "refunded-history", status: "DEACTIVATED" }] });
  for (const full of [false, true]) {
    h.h.states[3] = full;
    const html = h.html(full);
    assert.match(html,/持有设备<\/span><span class="v">0<\/span>/);
    if (full) { assert.match(html,/设备记录（含历史）/);assert.match(html,/refunded-history/);assert.match(html,/1 条/); }
    else assert.doesNotMatch(html,/refunded-history|设备记录（含历史）/);
    assert.doesNotMatch(html,/没有设备记录|当前没有持有设备/);
  }
  for (const status of ["UNKNOWN", "ERROR", undefined]) {
    h.h.states[6] = group({ total: 21, heldCount: 999, fieldStatuses: { heldCount: status }, records: [{ id: "93", name: "S1" }] });
    const html = h.html();assert.match(html,/持有设备<\/span><span class="v">-<\/span>/);assert.match(html,/21 条/);
    assert.doesNotMatch(html,/999/);
    const next = nodes(h.render()).filter(node => node.type === "button" && text(node) === "下一页");
    assert.ok(next.some(node => node.props.disabled === false),"history pagination uses 21 records despite unknown current holding");
  }
});
for (const action of ["retry", "annotate"]) for (const lifecycle of ["scope", "unmount"]) test(`R20CE-06 actual ${action} reread rejects ${lifecycle}`, async () => {
    const h = profileHarness(); h.h.states[14] = "标签";
    const tree = h.render(), button = nodes(tree).find(node => node.type === "button" && text(node) === (action === "retry" ? "重新加载资金" : "添加标签"));
    button.props.onClick(); await flush(); const old = h.requests.at(-1);
    assert.equal(h.requests.length, 2, `${action}: actual read started`);
    if (lifecycle === "scope") { h.props.scopeVersion = 2; h.render(); h.h.runEffects(); assert.equal(h.h.states[0], null); }
    else h.h.unmount();
    const annotationScope = action === "annotate" && lifecycle === "scope";
    const tagInput = () => nodes(nodes(h.render()).find(node => node.type === "label" && text(node).startsWith("新标签"))).find(node => node.type === "input");
    if (annotationScope) {
      const current = profile(); current.identity.data.nickname = "当前范围资料";
      h.requests.at(-1).resolve(current); await flush();
      assert.equal(tagInput().props.disabled, true, "scope refresh must retain the in-flight annotation lock");
    }
    await flush(); const writes = h.h.writes; old.resolve(profile()); await flush();
    if (annotationScope) {
      assert.match(h.html(), /当前范围资料/); assert.doesNotMatch(h.html(), /私有旧资料/);
      assert.equal(tagInput().props.disabled, false, "the settled annotation must release its own lock");
    } else {
      assert.equal(h.h.writes, writes, `${action}/${lifecycle}: no stale state setter`);
      if (lifecycle === "scope") assert.equal(h.h.states[0], null);
    }
});
function declarations(source, names) {
  return ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText()).join("\n");
}
test("M5 actual agent parser rejects missing/null/empty/negative/fraction/unsafe assigned count and malformed preview list", async () => {
  const source = read("lib/admin/m-client.ts"), support = read("lib/admin/m-support-client.ts");
  const exports = evaluate(declarations(support, ["count", "malformed"]) + declarations(source, ["str", "num", "bool", "asArray", "asStringArray", "supportServiceType", "adaptSupportAgent", "adaptAdvisorAssignment", "fetchMSupportAgentsPage"]) + "\nconst parseSupportCount=count; export {adaptSupportAgent,fetchMSupportAgentsPage};", { apiRequest: async () => payload });
  const valid = { id: "12", adminId: 12, name: "客服", enabled: true, status: "enabled", assignmentEligible: true, assignedUserCount: 0 };
  for (const value of [undefined, null, "", " ", "0", -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) assert.throws(() => exports.adaptSupportAgent({ ...valid, assignedUserCount: value }), undefined, String(value));
  for (const value of [0, 4, Number.MAX_SAFE_INTEGER]) assert.equal(exports.adaptSupportAgent({ ...valid, assignedUserCount: value }).assignedUserCount, value);
  let payload = { records: [valid], total: 1, advisorAssignments: [] };
  assert.equal((await exports.fetchMSupportAgentsPage()).records[0].assignedUserCount, 0);
  for (const missing of [undefined, null]) { payload = { records: [valid], total: 1, advisorAssignments: missing }; await assert.rejects(exports.fetchMSupportAgentsPage()); }
  for (const total of [undefined, null, "", -1, 0.5]) { payload = { records: [], total, advisorAssignments: [] }; await assert.rejects(exports.fetchMSupportAgentsPage()); }
});
function m5Harness() {
  const h = hooks(), requests = [], auth = { authEpoch: 1, session: { adminId: 12, role: "superadmin", authorities: [] } }, useAdminAuth = selector => selector(auth); useAdminAuth.getState = () => auth;
  const agent = { id: "12", adminId: 12, name: "旧客服", adminRole: "SUPPORT_INTERNAL_ENUM", enabled: true, busy: false, position: "专属客服", serviceTypes: ["advisor"], maxConcurrent: 5, assignedUserCount: 9 };
  const assignments = [1, 2].map(id => ({ id: String(id), agentAdminId: 12, status: "ACTIVE", nickname: `私有客户${id}`, userNo: `U-${id}` }));
  const params = { "I.support.agentsAvailable": "1", "I.support.agents": JSON.stringify([agent]), "I.support.advisorAssignments": JSON.stringify(assignments), "I.session.templatesAvailable": "1", "I.session.categories": JSON.stringify([{ type: "advisor", name: "专属客服", enabled: true, managedBy: "会话类别由 M1 创建，M5 配置" }]) };
  const exports = evaluate(component("m5-scripts"), {}, {
    react: h.react, "@/lib/store/admin-auth": { useAdminAuth }, "@/lib/admin/shell-authorities": { adminShellSessionKey: value => String(value?.adminId) },
    "@/lib/admin/m-client": { fetchMSupportAgentsPage(pageNum) { const request = deferred(); request.pageNum = pageNum; requests.push(request); return request.promise; } },
    "@/lib/admin/support-analytics-client": { supportAnalyticsClient: { query: async () => ({ scopeSummary: { mode: "ALL" } }) } },
    "@/lib/admin/error-messages": { displayAdminError: () => "加载失败" }, "../design-kit": { Icon: () => null, Toggle: () => null, Modal: () => null },
    "./support-leaderboard": { compactSupportBoardValue },
  });
  const render = () => { h.reset(); return exports.M5Scripts({ ctx: { params, pget: key => params[key], toast() {}, setParam() {}, openActionConfirm() {} } }); };
  return { h, agent, assignments, params, requests, render, html: () => renderToStaticMarkup(render()) };
}
test("M5 actual service-user metric uses scoped assignedUserCount instead of preview-list length", async () => {
  const h = m5Harness(); h.render(); h.h.runEffects(); h.requests[0].resolve({ total: 6, records: [h.agent], advisorAssignments: h.assignments }); await flush();
  assert.match(h.html(), /服务用户 9 \/ 接派单上限 5/); assert.doesNotMatch(h.html(), /服务用户 2 \/ 接派单上限/);
});
test("M5 actual formal rows omit internal provenance and raw roles while keeping account and unavailable email", async () => {
  const h = m5Harness(); h.render(); h.h.runEffects(); h.requests[0].resolve({ total: 1, records: [h.agent], advisorAssignments: [] }); await flush();
  const html = h.html(); assert.doesNotMatch(html, /名单来自|A1#|SUPPORT_INTERNAL_ENUM|会话类别由 M1|M5 配置/);
  assert.match(html, /账号 #12/); assert.match(html, />- · <span class="mono">账号 #12/);
  const source = component("m5-scripts"); assert.doesNotMatch(source, /agent\.email \|\| agent\.adminRole|A1#|先在 A1|A1 账号管理|c\.managedBy\}/);
});
test("R20CE-02 actual M5 page reread hides stale rows/chips and retains failure retry and real zero", async () => {
  const h = m5Harness(); h.render(); h.h.runEffects(); h.requests[0].resolve({ total: 6, records: [h.agent], advisorAssignments: h.assignments }); await flush();
  assert.match(h.html(), /旧客服/);
  const pager = nodes(h.render()).find(node => typeof node.type === "function" && node.type.name === "Pager" && node.props.pageSize === 5);
  pager.props.onPage(2); h.render(); h.h.runEffects();
  assert.doesNotMatch(h.html(), /旧客服|私有客户|服务用户 9/); h.requests.at(-1).reject(new Error("page failed")); await flush();
  const failed = h.html(); assert.doesNotMatch(failed, /旧客服|私有客户|服务用户 9|暂无客服管理员/); assert.match(failed, /重新加载客服/); assert.match(failed, />- 名客服/);
  nodes(h.render()).find(node => node.type === "button" && text(node) === "重新加载客服").props.onClick(); h.render(); h.h.runEffects();
  h.requests.at(-1).resolve({ total: 1, records: [{ ...h.agent, assignedUserCount: 0 }], advisorAssignments: [] }); await flush(); assert.match(h.html(), /服务用户 0 \/ 接派单上限 5/);
});
test("R20FIX2-01 actual M5 converged effects retain page2 during loading/failure/retry and clamp only a successful shrink", async () => {
  const h = m5Harness();
  const settle = () => {
    for (let i = 0; i < 10; i++) { const tree = h.render(); if (!h.h.hasPendingEffects()) return tree; h.h.runEffects(); }
    assert.fail("actual render/effect sequence did not converge");
  };
  const pager = () => nodes(settle()).find(node => typeof node.type === "function" && node.type.name === "Pager" && node.props.pageSize === 5);
  const requestPages = () => h.requests.map(request => request.pageNum);
  settle(); assert.equal(pager().props.page, 1); assert.deepEqual(requestPages(), [1]);
  const records = Array.from({ length: 5 }, (_, i) => ({ ...h.agent, id: String(12 + i), adminId: 12 + i }));
  h.requests[0].resolve({ total: 6, pageNum: 1, pageSize: 5, records, advisorAssignments: [] }); await flush(); settle();
  pager().props.onPage(2); settle();
  assert.equal(pager().props.page, 2); assert.deepEqual(requestPages(), [1, 2]);
  assert.match(h.html(), /正在加载客服…/); assert.doesNotMatch(h.html(), /旧客服|服务用户 9/); settle();
  h.requests.at(-1).reject(new Error("page2 failed")); await flush(); settle();
  assert.equal(pager().props.page, 2); assert.deepEqual(requestPages(), [1, 2]);
  nodes(settle()).find(node => node.type === "button" && text(node) === "重新加载客服").props.onClick(); settle();
  assert.equal(pager().props.page, 2); assert.deepEqual(requestPages(), [1, 2, 2]);
  h.requests.at(-1).resolve({ total: 6, pageNum: 2, pageSize: 5, records: [h.agent], advisorAssignments: [] }); await flush(); settle();
  assert.equal(pager().props.page, 2); assert.deepEqual(requestPages(), [1, 2, 2]);
  h.params["I.support.agents"] = JSON.stringify([{ ...h.agent, assignedUserCount: 10 }]); settle();
  assert.equal(pager().props.page, 2); assert.deepEqual(requestPages(), [1, 2, 2, 2]);
  h.requests.at(-1).resolve({ total: 1, pageNum: 2, pageSize: 5, records: [], advisorAssignments: [] }); await flush(); settle();
  assert.equal(pager().props.page, 1); assert.deepEqual(requestPages(), [1, 2, 2, 2, 1]);
  h.requests.at(-1).resolve({ total: 1, pageNum: 1, pageSize: 5, records: [{ ...h.agent, assignedUserCount: 0 }], advisorAssignments: [] }); await flush(); settle();
  assert.equal(pager().props.page, 1); assert.deepEqual(requestPages(), [1, 2, 2, 2, 1]); assert.match(h.html(), /服务用户 0 \/ 接派单上限 5/);
});
