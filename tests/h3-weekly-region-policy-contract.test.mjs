import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const load = (file, imports) => {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", code)(imports, module.exports, module);
  return module.exports;
};
const initial = () => ({ revision: 0, defaultZoneId: "Asia/Ho_Chi_Minh", mappings: [
  { callingCode: "+84", zoneId: "Asia/Ho_Chi_Minh" }, { callingCode: "+86", zoneId: "Asia/Shanghai" },
], effectiveFrom: null, lastLegacyInstanceKey: null, activation: "NEXT_ACCOUNT_WEEK", source: "DEFAULT",
nextActivation: { effectiveFrom: "2026-10-25T16:00:00Z", lastLegacyInstanceKey: "opaque-legacy-instance" } });
const published = () => ({ ...initial(), revision: 3, source: "PUBLISHED", ...initial().nextActivation, nextActivation: null });
let response = initial(), fetchCalls = [], operator = "operator-a";
const pendingStores = [];
const client = load("lib/admin/h-client.ts", name => {
  if (name.endsWith("error-messages")) return { formatAdminApiError: value => value,
    guardedFetch: async (...args) => { fetchCalls.push(args); return { ok: true, json: async () => ({ code: 0, data: response }) }; } };
  if (name.endsWith("current-operator")) return { currentAdminOperator: () => operator };
  if (name.endsWith("pending-mutation-store")) return { createPendingMutationStore: () => {
    const entries = new Map(); pendingStores.push(entries);
    return { get: key => entries.get(key), remember: (key, value) => entries.set(key, value), forget: key => entries.delete(key) };
  } };
  return {};
});
const registry = load("lib/admin/high-ops-registry.ts", () => ({ accountAvatarFields: () => ({}) }));
const op = registry.findHighOp("h3_weekly_region_policy");

test("policy GET keeps defaults authoritative and rejects malformed or inconsistent responses", async () => {
  response = initial(); fetchCalls = [];
  assert.deepEqual(await client.fetchH3WeeklyRegionPolicy(), response);
  assert.equal(fetchCalls[0][0], "/api/admin/growth/quest-events/weekly-region-policy");
  assert.notEqual(fetchCalls[0][1]?.method, "PATCH");
  for (const patch of [{ revision: -1 }, { revision: "0" }, { defaultZoneId: "Asia/Shanghai" },
    { mappings: [{ callingCode: "+84", zoneId: "UTC" }] }, { mappings: [null] },
    { nextActivation: undefined }, { nextActivation: { effectiveFrom: "2026-10-26T00:00:00", lastLegacyInstanceKey: "old" } },
    { revision: 1 }, { source: "PUBLISHED" }]) {
    assert.throws(() => client.parseH3WeeklyRegionPolicy({ ...initial(), ...patch }));
  }
  assert.deepEqual(client.parseH3WeeklyRegionPolicy(published()), published());
  assert.deepEqual(client.parseH3WeeklyRegionPolicy({ ...initial(), mappings: [] }).mappings, []);
});

test("mapping validation permits unmapped fallback and arbitrary region entries without registration expansion", () => {
  assert.equal(client.validateH3WeeklyRegionMappings([]), null);
  assert.equal(client.validateH3WeeklyRegionMappings([{ callingCode: "+81", zoneId: "Asia/Tokyo" }]), null);
  for (const mappings of [[{ callingCode: "84", zoneId: "Asia/Shanghai" }],
    [{ callingCode: "+084", zoneId: "Asia/Shanghai" }], [initial().mappings[0], initial().mappings[0]],
    [{ callingCode: "+1", zoneId: "+07:00" }], Array.from({ length: 1000 }, () => initial().mappings[0])]) {
    assert.ok(client.validateH3WeeklyRegionMappings(mappings));
  }
});

test("first activation copies opaque server values; later changes cannot replace the frozen cutover", () => {
  const mappings = [{ callingCode: "+86", zoneId: "Asia/Shanghai" }];
  const params = client.h3WeeklyRegionPolicyParams(initial(), mappings);
  assert.deepEqual(params, { expectedRevision: 0, mappings, ...initial().nextActivation });
  assert.deepEqual(op.buildCommand(params), { domain: "H", op: "h3_weekly_region_policy", params });
  assert.deepEqual(op.buildTarget(params), { domain: "H", type: "config", id: "growth.h3.weekly-region-policy" });
  assert.equal(op.type, "acct"); assert.equal(op.amplifies, true);
  assert.deepEqual(op.buildCommand({ ...params, expectedRevision: 3 }).params, { expectedRevision: 3, mappings });
  assert.deepEqual(client.h3WeeklyRegionPolicyParams(published(), mappings), { expectedRevision: 3, mappings });
  assert.throws(() => client.h3WeeklyRegionPolicyParams({ ...initial(), nextActivation: null }, mappings));
  mappings[0].zoneId = "Asia/Tokyo";
  assert.equal(params.mappings[0].zoneId, "Asia/Shanghai");
});

test("unknown proposals retain a stable command key scoped to operator, body and reason", async () => {
  const params = client.h3WeeklyRegionPolicyParams(initial(), []), keys = [];
  const fail = async key => { keys.push(key); throw new Error("unknown result"); };
  await assert.rejects(client.withH3WeeklyRegionProposalKey(params, "same reason", fail));
  await assert.rejects(client.withH3WeeklyRegionProposalKey(params, "same reason", fail));
  assert.equal(keys[0], keys[1]);
  operator = "operator-b";
  await assert.rejects(client.withH3WeeklyRegionProposalKey(params, "same reason", fail));
  assert.notEqual(keys[0], keys[2]); operator = "operator-a";
  await client.withH3WeeklyRegionProposalKey(params, "same reason", async key => keys.push(key));
  assert.equal(keys[0], keys[3]);
});

function panel({ canRead = true, canWrite = true, canReadA2 = true, policy = initial() } = {}) {
  const slots = [], effects = [], proposals = [], dialogs = [];
  let cursor = 0, current = policy, readError = null, reviewError = null, reviewRows = [], reviewReads = 0;
  const state = value => { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value;
    return [slots[index], next => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; };
  const component = load("app/components/domain-views/h-tabs/h3-quest-events.tsx", name => {
    if (name === "react") return { useState: state, useRef: value => state({ current: value })[0], useMemo: fn => fn(),
      useEffect: fn => { const index = cursor++; if (!(index in slots)) { slots[index] = true; effects.push(fn); } } };
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith("h-client")) return { ...client, fetchH3WeeklyRegionPolicy: async () => {
      if (readError) throw readError; return current;
    } };
    if (name.endsWith("a2-client")) return { fetchA2Overview: async filter => {
      reviewReads++; assert.deepEqual(filter, { object: "growth.h3.weekly-region-policy" });
      if (reviewError) throw reviewError;
      return { operationQueue: reviewRows };
    } };
    if (name.endsWith("use-propose")) return { usePropose: () => async (_toast, spec) => {
      proposals.push(spec); reviewRows = [{ obj: spec.obj, status: "pending" }]; return "proposed";
    } };
    if (name.endsWith("high-ops-registry")) return registry;
    if (name.endsWith("error-messages")) return { displayAdminError: value => String(value) };
    return {};
  });
  const ctx = { can: name => name === "growth_h3_read" ? canRead : name === "platform_a2_read" ? canReadA2 : canWrite, toast: () => {}, openActionConfirm: value => dialogs.push(value) };
  const render = () => { cursor = 0; return component.H3WeeklyRegionPolicyPanel({ ctx }); };
  const text = node => node == null ? "" : Array.isArray(node) ? node.map(text).join("") : node.props ? text(node.props.children) : typeof node === "object" ? "" : String(node);
  const nodes = (node = render(), result = []) => { if (Array.isArray(node)) node.forEach(item => nodes(item, result));
    else if (node?.props) { result.push(node); if (node.props.children !== undefined) nodes(node.props.children, result); } return result; };
  const button = label => nodes().find(node => node.type === "button" && text(node) === label);
  const click = label => { const node = button(label); assert.ok(node, label); assert.ok(!node.props.disabled, label); node.props.onClick(); };
  const flush = async () => { effects.splice(0).forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)); };
  render();
  return { render, text, nodes, button, click, flush, dialogs, proposals,
    setServer: value => { current = value; }, failRead: () => { readError = new Error("offline"); },
    setReview: (status, obj = "growth.h3.weekly-region-policy") => { reviewRows = [{ obj, status }]; reviewError = null; },
    failReview: () => { reviewError = new Error("offline"); }, reviewReads: () => reviewReads };
}

test("real panel submits first A2 proposal and keeps published/default table unchanged until publication", async () => {
  const view = panel(); await view.flush(); view.click("编辑地区映射"); view.click("提交 A2 审批");
  await view.dialogs[0].run("review regional policy");
  const spec = view.proposals[0];
  assert.equal(spec.sourceDomain, "H"); assert.equal(spec.type, "acct"); assert.equal(spec.amplifies, true);
  assert.equal(spec.obj, "growth.h3.weekly-region-policy");
  assert.deepEqual(spec.command.params, { expectedRevision: 0, mappings: initial().mappings, ...initial().nextActivation });
  assert.match(view.text(view.render()), /当前默认规则/);
  assert.match(view.text(view.render()), /等待 A2 审批/);
  assert.ok(view.button("编辑地区映射").props.disabled);
  view.setServer(published()); view.setReview("approved"); view.click("刷新地区规则"); await view.flush();
  assert.match(view.text(view.render()), /已发布规则 · 版本 3/);
  assert.doesNotMatch(view.text(view.render()), /等待 A2 审批/);
});

test("real panel hides writes from read-only users and blocks missing first boundary or failed read", async () => {
  const readonly = panel({ canWrite: false }); await readonly.flush(); assert.equal(readonly.button("编辑地区映射"), undefined);
  const noAccess = panel({ canRead: false }); await noAccess.flush(); assert.equal(noAccess.render(), null);
  const noBoundary = panel({ policy: { ...initial(), nextActivation: null } }); await noBoundary.flush();
  assert.ok(noBoundary.button("编辑地区映射").props.disabled);
  const failed = panel(); failed.failRead(); await failed.flush();
  assert.match(failed.text(failed.render()), /读取失败/); assert.equal(failed.button("编辑地区映射"), undefined);
});

test("refresh preserves edited rows and original revision; stale refresh cannot silently authorize a new base", async () => {
  const view = panel(); await view.flush(); view.click("编辑地区映射"); view.click("删除 +84");
  view.setServer(published()); view.click("刷新地区规则"); await view.flush();
  assert.ok(view.button("提交 A2 审批").props.disabled);
  assert.match(view.text(view.render()), /草稿已保留/);
  assert.equal(view.nodes().filter(node => node.type === "input").length, 2);
  assert.equal(view.proposals.length, 0);
});

for (const status of ["rejected", "withdrawn", "expired"]) {
  test(`real refresh restores same-revision editing after A2 ${status}`, async () => {
    const view = panel(); await view.flush(); view.click("编辑地区映射"); view.click("提交 A2 审批");
    await view.dialogs[0].run("review regional policy");
    assert.ok(view.button("编辑地区映射").props.disabled);
    view.setReview(status); view.click("刷新地区规则"); await view.flush();
    assert.doesNotMatch(view.text(view.render()), /等待 A2 审批/);
    assert.ok(!view.button("编辑地区映射").props.disabled);
    view.click("编辑地区映射"); view.click("提交 A2 审批");
    await view.dialogs[1].run("revised regional policy");
    assert.equal(view.proposals[1].command.params.expectedRevision, 0);
  });
}

test("pending or unreadable A2 state never unlocks a submitted same-revision policy", async () => {
  const view = panel(); await view.flush(); view.click("编辑地区映射"); view.click("提交 A2 审批");
  await view.dialogs[0].run("review regional policy");
  view.click("刷新地区规则"); await view.flush();
  assert.ok(view.button("编辑地区映射").props.disabled);
  assert.match(view.text(view.render()), /等待 A2 审批/);
  view.failReview(); view.click("刷新地区规则"); await view.flush();
  assert.ok(view.button("编辑地区映射").props.disabled);
  assert.match(view.text(view.render()), /审批进度读取失败/);
  view.setReview("rejected"); view.click("刷新地区规则"); await view.flush();
  assert.ok(!view.button("编辑地区映射").props.disabled);
});

test("A2 lookup blocks only the exact target and H3-only maker receives no new read permission", async () => {
  const view = panel(); view.setReview("pending", "another-policy"); await view.flush();
  assert.ok(!view.button("编辑地区映射").props.disabled);
  const maker = panel({ canReadA2: false }); await maker.flush(); maker.click("编辑地区映射"); maker.click("提交 A2 审批");
  await maker.dialogs[0].run("review regional policy");
  maker.setReview("rejected"); maker.click("刷新地区规则"); await maker.flush();
  assert.equal(maker.reviewReads(), 0);
  assert.ok(maker.button("编辑地区映射").props.disabled);
  assert.match(maker.text(maker.render()), /当前账号没有审批查看权限/);
});
