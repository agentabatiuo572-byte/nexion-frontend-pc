import * as systemBrand from "../lib/admin/brand-copy.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { SupportClientError } from "../lib/admin/m-support-client.ts";
import { formatBusinessTime } from "../lib/admin/business-time.ts";
import { displayAdminError } from "../lib/admin/error-messages.ts";
import { parseSupportProfile } from "../lib/admin/m-support-enhancements.ts";
import { MDomainLoadCoordinator } from "../lib/admin/m-content-load-coordinator.ts";
import { MContentReadError } from "../lib/admin/m-support-read-contract.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(process.env.SUPPORT_PROFILE_DEPENDENCY_ROOT || root, "package.json"));
const ts = require("typescript"), React = require("react"), jsx = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(process.env.SUPPORT_PROFILE_SOURCE || path.join(root, "app/components/domain-views/m-tabs/m3-customer-profile.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const leaderboardExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(path.join(root, "app/components/domain-views/m-tabs/support-leaderboard.tsx"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, {
  exports: leaderboardExports,
  require: name => name === "@/lib/admin/brand-copy" ? systemBrand : name === "./support-leaderboard.css" ? {} : require(name),
  Intl,
});
const group = (data = {}, status = "READY") => ({ status, data, evaluatedAt: "2026-10-11T00:00:00Z" });
const profile = (name = "当前客户") => ({ identity: group({ nickname: name, userNo: "U-7" }), finance: group({ byCurrency: [] }), devices: group(), risk: group(), annotations: group({ customTags: [name], notes: [] }), service: group({ conversationCount: 0 }), statistics: group(null, "UNKNOWN"), actions: {} });
const statistics = () => {
  const money = amount => ({ observed: amount, confirmed: amount, observedEvents: 1, confirmedEvents: 1, observedCustomers: 1, status: "AVAILABLE" });
  return { first: { state: "CONFIRMED", status: "AVAILABLE", kind: "DEVICE_PURCHASE", currency: "USDT", amount: "649.123456", succeededAt: "2026-10-12T00:00:00Z" }, lifetime: ["USDT", "NEX"].map(currency=>({currency,deposits:money(currency==="USDT"?"1000":"12"),purchases:money("649.123456"),net:money("900")})), lifetimeStatus: "AVAILABLE", invitations: { direct: { observed: 2, confirmed: 2, status: "AVAILABLE" }, descendants: { observed: 4, confirmed: 4, status: "AVAILABLE" }, status: "AVAILABLE", deposits: ["USDT", "NEX"].map(currency=>({currency,deposits:money(currency==="USDT"?"2000":"24")})) }, activity: { state: "ACTIVE", status: "AVAILABLE", lastEffectiveAt: "2026-10-12T00:00:00Z" } };
};
const maintenance = { cycles: [], executions: [], totalCycles: 0, totalExecutions: 0 };
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the real component with deferred reads. No server or browser transport is used.
function harness(props = {}, detail = true) {
  const slots = [], requests = [], invalidations = [], writes = [], listeners = new Set();
  let cursor = 0, pending = true, effects = [], tree;
  let auth = { authEpoch: 1, session: { adminId: 12, role: "support", authorities: ["service_m3_write"] } };
  const transport = kind => (...args) => new Promise((resolve, reject) => requests.push({ kind, args, resolve, reject }));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { const next = typeof value === "function" ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; pending = true; } }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useEffect(callback, dependencies) {
      const index = cursor++, old = slots[index];
      if (!old || dependencies.some((value, i) => !Object.is(value, old.dependencies[i]))) effects.push(() => { old?.cleanup?.(); slots[index] = { dependencies, cleanup: callback() }; });
    },
  };
  const window = { addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) };
  const ctx = { pget: () => "[]", removeCustomerTag: (...args) => new Promise((resolve, reject) => writes.push({ args, resolve, reject })), invalidateScope: (...args) => { invalidations.push(args); listeners.forEach(listener => listener({ detail: { conversationNo: args[0], customerId: args[1] } })); } };
  let currentProps = { ctx, customerId: "7", onHistory() {}, onRetryMessages() {}, ...props };
  const modules = { "@/lib/admin/brand-copy": systemBrand,
    react: hooks, "react/jsx-runtime": jsx,
    "@/lib/store/admin-auth": { useAdminAuth: selector => selector(auth) },
    "@/lib/admin/m-support-enhancements": { supportEnhancements: { profile: transport("profile"), devices: transport("devices"), flows: transport("flows") } },
    "@/lib/admin/m-support-client": { SupportClientError, supportClient: { maintenanceHistory: transport("maintenance") } },
    "@/lib/admin/error-messages": { displayAdminError },
    "../design-kit": { Modal: props => React.createElement("aside", {}, props.children), Icon: props => React.createElement("svg", {"data-icon":props.name,width:props.size,height:props.size}) },
    "./hd-ui": { HDSelect: () => null },
    "./support-avatar": { SupportAvatar: () => null, customerAvatarPath: id => id, advisorAvatarPath: id => id },
    "./support-leaderboard": leaderboardExports,
    "@/lib/admin/business-time": { formatBusinessTime },
    "./m3-customer-profile.css": {},
  };
  const context = { exports: {}, AbortController, Date, Intl, JSON, window, document: { querySelectorAll: () => [] }, require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } };
  vm.runInNewContext(compiled, context);
  const render = () => {
    let count = 0;
    while (pending) {
      assert.ok(++count < 20, "profile render/effect loop"); pending = false; cursor = 0;
      tree = context.exports.M3CustomerProfile(currentProps);
      effects.splice(0).forEach(run => run());
      if (detail && !elements(tree).some(node => node.type === modules["../design-kit"].Modal)) elements(tree).find(node => node.type === "button" && node.props.children === "说明")?.props.onClick();
    }
    return tree;
  };
  return {
    requests, invalidations, writes, ctx, render,
    html: () => renderToStaticMarkup(render()),
    async settle() { await tick(); return render(); },
    update(patch) { currentProps = { ...currentProps, ...patch }; pending = true; return render(); },
    auth(patch) { auth = { ...auth, ...patch }; pending = true; return render(); },
    invalidate(detail) { listeners.forEach(listener => listener({ detail })); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
function elements(node, result = []) {
  if (!node || typeof node !== "object") return result;
  if (node.props?.hidden) return result;
  if (Array.isArray(node)) { node.forEach(child => elements(child, result)); return result; }
  if (node.props) { result.push(node); elements(node.props.children, result); }
  return result;
}
const content = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(content).join("") : node?.props ? content(node.props.children) : "";
function button(tree, text) { const matches = elements(tree).filter(node => node.type === "button" && content(node) === text); assert.equal(matches.length, 1, text); return matches[0]; }
function succeed(requests, name = "当前客户") { requests.forEach(request => request.resolve(request.kind === "profile" ? profile(name) : request.kind === "maintenance" ? maintenance : group({ records: [], total: 0 }))); }
const deleteTag = h => elements(h.render()).find(node => node.type === "button" && node.props["aria-label"]?.startsWith("删除标签 "));

// Execute the production write callbacks and snapshot coordinator together with
// the actual profile component. Only transport and React scheduling are fake.
function annotationWorkbench() {
  const parentSource = readFileSync(path.join(root, "app/components/domain-views/m-view.tsx"), "utf8");
  const ast = ts.createSourceFile("m-view.tsx", parentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["reloadMContent", "reconcileConversationSnapshot", "runM3DirectWrite", "addCustomerTag", "removeCustomerTag", "addCustomerNote", "removeCustomerNote"];
  const declarations = new Map(); let confirmHandler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) declarations.set(node.name.getText(ast), node.getText(ast));
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onConfirm" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression?.getText(ast).includes("mc.run(reason")) confirmHandler = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); names.forEach(name => assert.ok(declarations.has(name), name)); assert.ok(confirmHandler);
  const requests = [], writes = [], receipts = new Map(), toasts = [];
  const identity = { authEpoch: 1, session: { adminId: 12, role: "support", authorities: ["service_m3_write"] } };
  let currentConversation = { id: "CV-7", customerId: "7", ownerAdminId: 12, assignmentId: "15", version: 1, messages: [], detailReady: true };
  let h, fullLoads = 0, unmounts = 0, mc = null, data = { conversations: [currentConversation], conversationsAvailable: true };
  const defer = (kind, args) => new Promise((resolve, reject) => requests.push({ kind, args, resolve, reject }));
  const writesApi = Object.fromEntries(names.filter(name => /Customer/.test(name)).map(name => [name, (...args) => new Promise((resolve, reject) => writes.push({ name, args, resolve, reject }))]));
  const context = {
    exports: {}, AbortController, Date, Math, crypto: globalThis.crypto,
    useCallback: callback => callback, authEpoch: 1, currentAuthEpoch: { current: 1 }, mDataAuthEpoch: { current: 1 },
    mLoadCoordinator: { current: new MDomainLoadCoordinator() }, liveSnapshotController: { current: null },
    setMError() {}, setMLoading() {}, setToast: message => toasts.push(message), displayAdminError, MContentReadError,
    invalidateScope: () => { h?.invalidate({}); context.mLoadCoordinator.current.beginConversationSnapshot(); },
    preserveVerifiedSupportAgentsDuringReload: (_old, next) => next, failClosedSupportAgentsAfterReload: old => old,
    fetchMContentData: async progress => {
      fullLoads++;
      // The existing progressive transport publishes another group's result
      // before conversations, including its initial empty conversations array.
      progress({ conversations: [], conversationsAvailable: false });
      return { conversations: [currentConversation], conversationsAvailable: true };
    },
    fetchMConversationSnapshot: signal => defer("snapshot", [signal]),
    setMData: update => {
      data = typeof update === "function" ? update(data) : update;
      const selected = data?.conversations.find(row => row.id === currentConversation.id);
      if (!selected) { h?.unmount(); h = null; unmounts++; }
      else {
        currentConversation = selected;
        if (!h) mount();
        else h.update({ conversation: selected, scopeVersion: selected.version });
      }
    },
    directWriteSlot: value => value,
    mCommands: { list: () => [...receipts.values()], remember: (fingerprint, commandKey, rest) => receipts.set(fingerprint, { fingerprint, commandKey, ...rest }), forget: slot => receipts.delete(slot) },
    mContentActions: writesApi, actionConfirmRunRef: { current: null },
    setActionConfirm: update => { mc = typeof update === "function" ? update(mc) : update; context.mc = mc; },
  };
  const code = names.map(name => `const ${declarations.get(name)};`).join("\n") + `\nexports.commands = {addCustomerTag, removeCustomerTag, addCustomerNote, removeCustomerNote}; exports.confirm = ${confirmHandler};`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  function mount() {
    h = harness({ customerId: currentConversation.customerId, conversation: currentConversation, scopeVersion: currentConversation.version }, false);
    Object.assign(h.ctx, context.exports.commands, { openActionConfirm: request => { mc = request; context.mc = mc; } });
    h.render();
    const initial = profile(); initial.annotations.data.notes = [{ id: "NOTE-1", text: "已保存备注" }];
    h.requests[0].resolve(initial); succeed(h.requests.slice(1));
  }
  mount();
  return {
    requests, writes, receipts, toasts, get h() { return h; }, get fullLoads() { return fullLoads; }, get unmounts() { return unmounts; }, get confirmation() { return mc; },
    async settle() { await tick(); h?.render(); },
    async open() { await this.settle(); button(h.render(), "查看与编辑").props.onClick(); h.render(); },
    confirm: () => context.exports.confirm("测试删除理由足够长度"),
    snapshot(row = currentConversation) { const request = requests.find(r => r.kind === "snapshot" && !r.resolved); request.resolved = true; request.resolve(row ? [row] : []); },
    change(patch) { currentConversation = { ...currentConversation, ...patch }; h.update({ customerId: currentConversation.customerId, conversation: currentConversation, scopeVersion: currentConversation.version }); },
    epoch() { identity.authEpoch++; context.currentAuthEpoch.current = identity.authEpoch; context.mDataAuthEpoch.current = identity.authEpoch; h.auth(identity); },
  };
}
const editor = (h, type) => elements(h.render()).find(node => node.type === type && node.props.maxLength === (type === "input" ? 30 : 1000));
const setDraft = (h, type, value) => { editor(h, type).props.onChange({ target: { value } }); h.render(); };

for (const [action, submitted, retained] of [["添加标签", "input", "textarea"], ["保存备注", "textarea", "input"]]) {
  test(`annotation ${action} retains the other draft and 360 through slow snapshot/profile reads`, async () => {
    const w = annotationWorkbench(); await w.open(); setDraft(w.h, "input", "新标签"); setDraft(w.h, "textarea", "未提交备注");
    const other = editor(w.h, retained).props.value;
    button(w.h.render(), action).props.onClick(); w.h.render(); w.writes[0].resolve({}); await w.settle();
    assert.equal(w.fullLoads, 0, "annotation must not run the destructive progressive whole-domain reload");
    assert.equal(editor(w.h, retained).props.value, other); assert.equal(button(w.h.render(), action).props.disabled, true);
    w.snapshot(); await w.settle(); assert.equal(editor(w.h, submitted).props.value, ""); assert.equal(editor(w.h, retained).props.value, other);
    succeed(w.h.requests.slice(4)); await w.settle(); assert.equal(w.unmounts, 0); assert.equal(editor(w.h, retained).props.value, other); assert.equal(w.receipts.size, 0); w.h.unmount();
  });
}

test("annotation transport failure retains both drafts and original command key", async () => {
  const w = annotationWorkbench(); await w.open(); setDraft(w.h, "input", "新标签"); setDraft(w.h, "textarea", "未提交备注");
  button(w.h.render(), "添加标签").props.onClick(); w.writes[0].reject(new Error("network")); await w.settle();
  assert.equal(editor(w.h, "input").props.value, "新标签"); assert.equal(editor(w.h, "textarea").props.value, "未提交备注");
  assert.equal(w.requests.length, 0); assert.equal(w.receipts.size, 1);
  button(w.h.render(), "添加标签").props.onClick(); assert.equal(w.writes[1].args.at(-1), w.writes[0].args.at(-1)); w.writes[1].reject(new Error("network")); await w.settle(); w.h.unmount();
});

test("successful delete closes the actual global confirmation even when ordinary conversation version advances", async () => {
  const w = annotationWorkbench(); await w.open(); setDraft(w.h, "input", "保留标签"); setDraft(w.h, "textarea", "保留备注");
  button(w.h.render(), "删除备注").props.onClick(); const completion = w.confirm(); w.writes[0].resolve({}); await w.settle();
  assert.equal(w.fullLoads, 0); w.change({ version: 2 }); w.snapshot(); await w.settle();
  succeed(w.h.requests.slice(4)); await completion; await w.settle(); assert.equal(w.confirmation, null);
  assert.equal(editor(w.h, "input").props.value, "保留标签"); assert.equal(editor(w.h, "textarea").props.value, "保留备注"); w.h.unmount();
});

test("confirmed annotation with failed snapshot is not retained as an unknown write", async () => {
  const w = annotationWorkbench(); await w.open(); setDraft(w.h, "input", "新标签"); setDraft(w.h, "textarea", "保留备注");
  button(w.h.render(), "添加标签").props.onClick(); w.writes[0].resolve({}); await w.settle(); assert.equal(w.fullLoads, 0);
  w.requests[0].reject(new Error("read failed")); await w.settle(); succeed(w.h.requests.slice(4)); await w.settle();
  assert.equal(w.receipts.size, 0); assert.equal(editor(w.h, "input").props.value, ""); assert.equal(editor(w.h, "textarea").props.value, "保留备注");
  assert.ok(w.toasts.some(message => message.includes("已保存"))); w.h.unmount();
});

test("delete receipt closes confirmation after its profile refresh fails, without resubmitting", async () => {
  const w = annotationWorkbench(); await w.open(); setDraft(w.h, "textarea", "仍需保留的备注草稿");
  button(w.h.render(), "删除备注").props.onClick(); const completion = w.confirm(); w.writes[0].resolve({}); await w.settle();
  w.snapshot(); await w.settle(); w.h.requests[4].reject(new Error("profile unavailable")); await completion; await w.settle();
  assert.equal(w.confirmation, null); assert.equal(w.receipts.size, 0); assert.equal(w.writes.length, 1);
  assert.equal(editor(w.h, "textarea").props.value, "仍需保留的备注草稿"); assert.match(w.h.html(), /已保存，资料刷新失败/); w.h.unmount();
});

test("authoritative empty conversation snapshot still unmounts inaccessible customer", async () => {
  const w = annotationWorkbench(); await w.open(); setDraft(w.h, "textarea", "不可留给其他客户");
  button(w.h.render(), "删除备注").props.onClick(); const completion = w.confirm(); w.writes[0].resolve({}); await w.settle();
  w.snapshot(null); await completion; await w.settle(); assert.equal(w.h, null); assert.equal(w.unmounts, 1); assert.equal(w.fullLoads, 0);
});

test("forbidden snapshot revokes the profile instead of keeping editable stale scope", async () => {
  const w = annotationWorkbench(); await w.open(); setDraft(w.h, "input", "旧标签"); setDraft(w.h, "textarea", "旧备注");
  button(w.h.render(), "添加标签").props.onClick(); w.writes[0].resolve({}); await w.settle();
  w.requests[0].reject(new MContentReadError(403, 403, "SUPPORT_SCOPE_FORBIDDEN")); await w.settle();
  assert.match(w.h.html(), /客户资料暂时无法读取/); assert.doesNotMatch(w.h.html(), /value="旧标签"|>旧备注<\/textarea>/); assert.equal(w.receipts.size, 0); w.h.unmount();
});

for (const change of ["customer", "epoch", "assignment", "revoke"]) {
  test(`pending annotation cannot clear or refresh another ${change} scope`, async () => {
    const w = annotationWorkbench(); await w.open(); setDraft(w.h, "input", "旧标签"); setDraft(w.h, "textarea", "旧备注");
    button(w.h.render(), "添加标签").props.onClick();
    if (change === "customer") w.change({ id: "CV-8", customerId: "8" });
    else if (change === "epoch") w.epoch();
    else if (change === "assignment") w.change({ assignmentId: "16", version: 2 });
    else w.h.invalidate({ customerId: "7" });
    const readCount = w.h.requests.length; w.writes[0].resolve({}); await w.settle();
    if (w.requests.length) w.requests[0].reject(new Error("scope superseded")); await w.settle();
    assert.equal(w.h.requests.length, readCount, "old write cannot issue a profile request in the new scope");
    if (change === "customer" || change === "epoch" || change === "revoke") assert.doesNotMatch(w.h.html(), /value="旧标签"|>旧备注<\/textarea>/);
    w.h.unmount();
  });
}

test("full-profile navigation carries the current customer and encoded original conversation without opening another modal", () => {
  for (const conversation of [undefined, { id: "C-7 &next=/users/search" }]) {
    const h = harness({ conversation }, false), tree = h.render();
    const link = elements(tree).find(node => node.props?.className === "m3-profile-open");
    assert.equal(link.type, "a");
    assert.equal(link.props.href, `/service/customers/7${conversation ? `?conversationNo=${encodeURIComponent(conversation.id)}` : ""}`);
    assert.equal(link.props.onClick, undefined);
    h.invalidate({ customerId: "7" });
    assert.equal(elements(h.render()).some(node => node.props?.className === "m3-profile-open"), false);
    h.unmount();
  }
});

test("360 statistics shares strict M1 parsing and never upgrades unknown observations", () => {
  const input = profile(); input.statistics = group(statistics());
  const result = parseSupportProfile({profile:input});
  assert.equal(result.statistics.data.first.amount, "649.123456");
  assert.deepEqual(result.statistics.data.lifetime.map(row=>row.currency), ["USDT", "NEX"]);
  const bad = structuredClone(input); bad.statistics.data.invitations.direct = {observed:2,confirmed:2,status:"UNKNOWN"};
  assert.throws(()=>parseSupportProfile({profile:bad}), /countCoverage/);
  bad.statistics.data.invitations.direct.confirmed = null;
  assert.equal(parseSupportProfile({profile:bad}).statistics.data.invitations.direct.confirmed, null);
  bad.statistics.data.first.amount = 0.1;
  assert.throws(()=>parseSupportProfile({profile:bad}), /decimal/);
  delete input.statistics;
  assert.equal(parseSupportProfile({profile:input}).statistics.status, "UNKNOWN");
});

test("sidebar keeps original sections and opens exact first-payment plus invitation statistics without another request", async () => {
  const h = harness({}, false); h.render(); const initial = profile(); initial.statistics = group(statistics());
  Object.assign(initial.statistics.data.invitations.deposits[0].deposits, {status:"PARTIAL",observed:"2400"});
  h.requests[0].resolve(initial); succeed(h.requests.slice(1)); await h.settle();
  const sidebar = h.html(); assert.match(sidebar,/已首充/); assert.match(sidebar,/直属邀请（人）/); assert.match(sidebar,/全部下级邀请用户（人）/); assert.match(sidebar,/邀请累充（USDT）/); assert.match(sidebar,/2K（部分统计）/);
  assert.ok(sidebar.indexOf("快捷操作") < sidebar.indexOf("首充与邀请"), "new statistics follow the preserved original sections");
  button(h.render(), "统计明细 →").props.onClick(); h.render();
  const detail=h.html(); assert.match(detail,/首充来源<\/span><span class="v">购机/); assert.match(detail,/649\.123456 USDT/); assert.match(detail,/UVT · 累计/); assert.match(detail,/下级邀请用户包含直属邀请/);
  assert.match(detail,/data-exact="2000（部分统计） USDT" aria-label="2000（部分统计） USDT" tabindex="0"/);
  assert.equal(h.requests.length,4); h.invalidate({customerId:"7"}); assert.doesNotMatch(h.html(),/649\.123456|邀请后代充值/); h.unmount();
});

test("unknown first candidate is not shown as a confirmed payment and detail filters use the house select", async () => {
  const h=harness(); h.render(); const initial=profile(); const stats=statistics();
  stats.first.state="UNKNOWN"; stats.first.status="UNKNOWN"; stats.invitations.direct={observed:2,confirmed:null,status:"UNKNOWN"}; initial.statistics=group(stats);
  h.requests[0].resolve(initial); succeed(h.requests.slice(1)); await h.settle();
  const detail=h.html(); assert.doesNotMatch(detail, /649\.123456 USDT|首充来源<\/span><span class="v">购机/); assert.match(detail,/首充状态<\/span><span class="v">待核实/);
  assert.doesNotMatch(source, /<select\b/);
  const filters=elements(h.render()).find(node=>node.props?.["aria-label"]==="流水币种");
  const picker=elements(filters).find(node=>typeof node.props?.onChange==="function"); picker.props.onChange("NEX"); h.render();
  assert.equal(h.requests.at(-1).kind,"flows"); assert.equal(h.requests.at(-1).args[1].currency,"NEX"); assert.equal(h.requests.at(-1).args[1].pageNum,1); h.unmount();
});

test("actual sidebar restores bounded identity, two-currency 2x2 funds and shortcuts while full editing remains in 360", async () => {
  const h = harness({}, false); h.render(); const initial = profile("当前客户");
  Object.assign(initial.identity.data, { level: "V3", phoneMasked: "138****0000", region: "已记录地区" });
  initial.risk = group({ level: "LOW", serviceExplanation: "已核实风险说明" });
  initial.service.data.ticketCount = 1;
  initial.annotations.data.notes = [{ text: "较旧备注", createdAt: "2026-10-11T01:00:00Z" }, { text: "最新备注", createdAt: "2026-10-12T01:00:00Z" }];
  initial.finance.data.byCurrency = [{ currency: "USDT", creditedDepositTotal: "12400", successfulWithdrawalPrincipalTotal: "6200", balance: "4820", fieldStatuses: { creditedDepositTotal: "READY", successfulWithdrawalPrincipalTotal: "READY", balance: "READY" } }, { currency: "NEX", creditedDepositTotal: "0", successfulWithdrawalPrincipalTotal: null, balance: "9007199254740993.12345678", fieldStatuses: { creditedDepositTotal: "READY", successfulWithdrawalPrincipalTotal: "UNKNOWN", balance: "PARTIAL" } }];
  h.requests[0].resolve(initial); succeed(h.requests.slice(1)); await h.settle();
  const sidebar = h.html(); assert.match(sidebar, /UID U-7/); assert.match(sidebar, /V3/); assert.match(sidebar, /低风险/);
  assert.match(sidebar, /最新备注/); assert.doesNotMatch(sidebar, /较旧备注|<textarea|type="date"|设备记录（含历史）|KYC|闲置/);
  const grid = elements(h.render()).find(node => node.props?.className === "m3-profile-funds");
  assert.equal(elements(grid).filter(node => node.type === "button").length, 4);
  const currency = elements(h.render()).find(node => node.props?.className === "m3-profile-currency");
  assert.equal(currency.props["aria-label"], "资金摘要币种");
  const selector = elements(currency).find(node => typeof node.props?.onChange === "function");
  assert.equal(selector.props.width, 92); assert.deepEqual(Array.from(selector.props.options, option => option.value), ["USDT", "NEX"]);
  selector.props.onChange("NEX");
  const shortcuts = elements(h.render()).find(node => node.props?.className === "m3-profile-shortcuts");
  assert.deepEqual(elements(shortcuts).filter(node => node.props?.size === 15).map(node => node.props.name), ["clock", "doc", "lock", "wallet", "doc"]);
  const nex = h.html(); assert.match(nex, />0<small>UVT/); assert.match(nex, /9007199254740993\.12345678 UVT/); assert.match(nex, /部分统计/); assert.doesNotMatch(nex, /12400 USDT/);
  assert.equal(h.requests.length, 4, "currency summary uses already loaded facts without another read");
  button(h.render(), "明细 →").props.onClick(); h.render();
  const detail = h.html(); assert.match(detail, /资金流水/); assert.match(detail, /type="date"/); assert.match(detail, /新标签/); assert.match(detail, /新内部备注/); assert.match(detail, /历史会话/); assert.match(detail, /关联工单/); assert.match(detail, /账户操作/);
  assert.equal(elements(h.render()).filter(node => node.props?.className === "m3-profile-open").length, 1, "the opener survives the modal render");
  assert.equal(h.requests.length, 4, "360 reuses the same body and data"); h.unmount();
});

test("403/404 from each profile read settles once, clears siblings and only retries explicitly", async () => {
  for (const status of [403, 404]) for (const kind of ["profile", "devices", "flows", "maintenance"]) {
    const h = harness({ scopeVersion: 1 }); h.render(); const first = h.requests.slice();
    assert.equal(first.length, 4);
    first.find(request => request.kind === kind).reject(new SupportClientError(status, status, "SUPPORT_CUSTOMER_NOT_FOUND"));
    await h.settle(); succeed(first.filter(request => request.kind !== kind), "OLD_SCOPE_PRIVATE"); await h.settle();
    assert.match(h.html(), /role="alert"/); assert.match(h.html(), /重新读取资料/);
    assert.doesNotMatch(h.html(), /正在读取|OLD_SCOPE_PRIVATE|重新登录|登录已过期/);
    assert.deepEqual(h.invalidations, [[undefined, "7"]]);
    h.update({ scopeVersion: 2 }); await h.settle();
    assert.equal(h.requests.length, 4, "scope refresh must not start an automatic denial loop");
    button(h.render(), "重新读取资料").props.onClick(); h.render();
    assert.equal(h.requests.length, 8, "one explicit retry reloads all read sections");
    succeed(h.requests.slice(4), "重试核实客户"); await h.settle();
    assert.match(h.html(), /重试核实客户/); assert.doesNotMatch(h.html(), /正在读取|OLD_SCOPE_PRIVATE|客户资料暂时无法读取/);
    assert.match(h.html(), /尚未建立服务会话，标签与备注只读/);
    h.unmount();
  }
});

test("ordinary profile failure gives all six groups a final state and recovers through the real retry button", async () => {
  const h = harness(); h.render();
  h.requests[0].reject(new SupportClientError(503, 503, "BACKEND_UNAVAILABLE"));
  succeed(h.requests.slice(1)); await h.settle();
  assert.equal((h.html().match(/>读取失败<\/div>/g) || []).length, 6);
  assert.doesNotMatch(h.html(), /正在读取/); assert.equal(h.invalidations.length, 0);
  button(h.render(), "重新读取资料").props.onClick(); h.render();
  succeed(h.requests.slice(4), "恢复后客户"); await h.settle();
  assert.match(h.html(), /恢复后客户/); assert.doesNotMatch(h.html(), /读取失败|正在读取/); h.unmount();
});

test("customer, auth and scope-version changes ignore old successes and old denials", async () => {
  for (const change of [h => h.update({ customerId: "8" }), h => h.auth({ authEpoch: 2 }), h => h.update({ scopeVersion: 2 })]) {
    const h = harness({ scopeVersion: 1 }); h.render(); const old = h.requests.slice();
    change(h); const current = h.requests.slice(4); assert.equal(current.length, 4);
    succeed(current, "CURRENT_SCOPE_ONLY"); await h.settle();
    old[0].resolve(profile("OLD_SCOPE_PRIVATE"));
    old[1].reject(new SupportClientError(404, 404, "SUPPORT_CUSTOMER_NOT_FOUND"));
    succeed(old.slice(2)); await h.settle();
    assert.match(h.html(), /CURRENT_SCOPE_ONLY/); assert.doesNotMatch(h.html(), /OLD_SCOPE_PRIVATE|客户资料暂时无法读取/);
    assert.equal(h.invalidations.length, 0); h.unmount();
  }
});

test("external scope revocation removes loaded data and prevents a pending group retry from reviving it", async () => {
  const h = harness({ conversation: { id: "CV-7", ownerAdminId: 12, messages: [], detailReady: true } }); h.render(); const initial = profile("OLD_SCOPE_PRIVATE"); initial.identity = group(null, "ERROR");
  h.requests[0].resolve(initial); succeed(h.requests.slice(1)); await h.settle();
  const oldDelete = elements(h.render()).find(node => node.type === "button" && node.props["aria-label"] === "删除标签 OLD_SCOPE_PRIVATE");
  assert.equal(oldDelete.props.disabled, false);
  const retry = elements(h.render()).find(node => typeof node.type === "function" && node.props.title === "基本信息").props.retry;
  retry(); assert.equal(h.requests.length, 5);
  h.invalidate({ customerId: "other" }); assert.doesNotMatch(h.html(), /客户资料暂时无法读取/);
  h.invalidate({ customerId: "7" });
  assert.match(h.html(), /客户资料暂时无法读取/); assert.doesNotMatch(h.html(), /OLD_SCOPE_PRIVATE|正在读取/);
  h.requests[4].resolve(profile("REVIVED_PRIVATE")); await h.settle();
  retry(); assert.equal(h.requests.length, 5, "a stale group retry cannot bypass the revoked scope");
  oldDelete.props.onClick(); await h.settle(); assert.equal(h.writes.length, 0, "revocation blocks an already captured write control");
  assert.doesNotMatch(h.html(), /REVIVED_PRIVATE|OLD_SCOPE_PRIVATE/); h.unmount();
  const changed = harness(); changed.render(); changed.requests[0].resolve(initial); succeed(changed.requests.slice(1)); await changed.settle();
  const oldGroupRetry = elements(changed.render()).find(node => typeof node.type === "function" && node.props.title === "基本信息").props.retry;
  changed.update({ customerId: "8" }); succeed(changed.requests.slice(4), "CURRENT_SCOPE_ONLY"); await changed.settle();
  oldGroupRetry(); assert.equal(changed.requests.length, 8, "an old customer's control cannot read into the new scope");
  assert.match(changed.html(), /CURRENT_SCOPE_ONLY/); changed.unmount();
});

test("an in-flight annotation releases its own busy state after scopeVersion refresh for true, false and rejected outcomes", async () => {
  for (const outcome of [true, false, new SupportClientError(503, 503, "BACKEND_UNAVAILABLE")]) {
    const h = harness({ scopeVersion: 1, conversation: { id: "CV-7", ownerAdminId: 12, messages: [], detailReady: true } });
    h.render(); succeed(h.requests); await h.settle();
    deleteTag(h).props.onClick(); h.render(); assert.equal(h.writes.length, 1); assert.equal(deleteTag(h).props.disabled, true);
    h.update({ scopeVersion: 2 }); succeed(h.requests.slice(4), "CURRENT_SCOPE_ONLY"); await h.settle();
    assert.equal(deleteTag(h).props.disabled, true, "the original write remains in flight");
    if (outcome instanceof Error) h.writes[0].reject(outcome); else h.writes[0].resolve(outcome);
    await h.settle();
    assert.equal(deleteTag(h).props.disabled, false, `settled write must release busy state: ${String(outcome)}`);
    assert.match(h.html(), /CURRENT_SCOPE_ONLY/); assert.equal(h.requests.length, 8, "an old write must not refresh over newer profile data");
    h.unmount();
  }
});

test("an old annotation finally cannot release a newer write after customer change or explicit revoked-scope recovery", async () => {
  for (const change of ["customer", "revoked"]) {
    const h = harness({ conversation: { id: "CV-7", ownerAdminId: 12, messages: [], detailReady: true } });
    h.render(); succeed(h.requests); await h.settle(); deleteTag(h).props.onClick(); h.render();
    if (change === "customer") h.update({ customerId: "8", conversation: { id: "CV-8", ownerAdminId: 12, messages: [], detailReady: true } });
    else { h.invalidate({ customerId: "7" }); button(h.render(), "重新读取资料").props.onClick(); h.render(); }
    succeed(h.requests.slice(4), "NEW_WRITE_SCOPE"); await h.settle();
    assert.equal(deleteTag(h).props.disabled, false); deleteTag(h).props.onClick(); h.render(); assert.equal(h.writes.length, 2);
    h.writes[0].resolve(true); await h.settle();
    assert.equal(deleteTag(h).props.disabled, true, "old finally must preserve the newer write lock");
    h.writes[1].resolve(false); await h.settle();
    assert.equal(deleteTag(h).props.disabled, false); assert.match(h.html(), /NEW_WRITE_SCOPE/); h.unmount();
  }
});
