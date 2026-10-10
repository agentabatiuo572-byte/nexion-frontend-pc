import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import { SupportClientError } from "../lib/admin/m-support-client.ts";
import { displayAdminError } from "../lib/admin/error-messages.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(process.env.SUPPORT_PROFILE_DEPENDENCY_ROOT || root, "package.json"));
const ts = require("typescript"), React = require("react"), jsx = require("react/jsx-runtime");
const { renderToStaticMarkup } = require("react-dom/server");
const source = readFileSync(process.env.SUPPORT_PROFILE_SOURCE || path.join(root, "app/components/domain-views/m-tabs/m3-customer-profile.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const group = (data = {}, status = "READY") => ({ status, data, evaluatedAt: "2026-10-11T00:00:00Z" });
const profile = (name = "当前客户") => ({ identity: group({ nickname: name, userNo: "U-7" }), finance: group({ byCurrency: [] }), devices: group(), risk: group(), annotations: group({ customTags: [name], notes: [] }), service: group({ conversationCount: 0 }), actions: {} });
const maintenance = { cycles: [], executions: [], totalCycles: 0, totalExecutions: 0 };
const tick = () => new Promise(resolve => setImmediate(resolve));

// Execute the real component with deferred reads. No server or browser transport is used.
function harness(props = {}) {
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
  const modules = {
    react: hooks, "react/jsx-runtime": jsx,
    "@/lib/store/admin-auth": { useAdminAuth: selector => selector(auth) },
    "@/lib/admin/m-support-enhancements": { supportEnhancements: { profile: transport("profile"), devices: transport("devices"), flows: transport("flows") } },
    "@/lib/admin/m-support-client": { SupportClientError, supportClient: { maintenanceHistory: transport("maintenance") } },
    "@/lib/admin/error-messages": { displayAdminError },
    "../design-kit": { Modal: props => React.createElement("aside", {}, props.children) },
    "./support-avatar": { SupportAvatar: () => null, customerAvatarPath: id => id, advisorAvatarPath: id => id },
  };
  const context = { exports: {}, AbortController, Date, Intl, JSON, window, require: name => { assert.ok(Object.hasOwn(modules, name), name); return modules[name]; } };
  vm.runInNewContext(compiled, context);
  const render = () => {
    let count = 0;
    while (pending) {
      assert.ok(++count < 20, "profile render/effect loop"); pending = false; cursor = 0;
      tree = context.exports.M3CustomerProfile(currentProps);
      effects.splice(0).forEach(run => run());
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
  if (Array.isArray(node)) { node.forEach(child => elements(child, result)); return result; }
  if (node.props) { result.push(node); elements(node.props.children, result); }
  return result;
}
const content = node => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(content).join("") : node?.props ? content(node.props.children) : "";
function button(tree, text) { const matches = elements(tree).filter(node => node.type === "button" && content(node) === text); assert.equal(matches.length, 1, text); return matches[0]; }
function succeed(requests, name = "当前客户") { requests.forEach(request => request.resolve(request.kind === "profile" ? profile(name) : request.kind === "maintenance" ? maintenance : group({ records: [], total: 0 }))); }
const deleteTag = h => elements(h.render()).find(node => node.type === "button" && node.props["aria-label"]?.startsWith("删除标签 "));

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

test("ordinary profile failure gives all five groups a final state and recovers through the real retry button", async () => {
  const h = harness(); h.render();
  h.requests[0].reject(new SupportClientError(503, 503, "BACKEND_UNAVAILABLE"));
  succeed(h.requests.slice(1)); await h.settle();
  assert.equal((h.html().match(/>读取失败<\/div>/g) || []).length, 5);
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
