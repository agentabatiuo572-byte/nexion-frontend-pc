import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/components/domain-views/h-tabs/h3-quest-events.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;

function render(patch = {}, writable = true, client = {}) {
  const model = { dayOneTasks: [], weeklyTier1: [], weeklyTier2: [], monthlyMissions: [], events: [], ...patch };
  const dialogs = [], toasts = [], writes = [];
  let state = 0;
  const module = { exports: {} };
  new Function("require", "exports", "module", compiled)(name => {
    if (name === "react") return { useState: () => [[model, false, null][state++], () => {}], useEffect: () => {}, useMemo: fn => fn() };
    if (name === "react/jsx-runtime") return require(name);
    if (name.endsWith("design-kit")) return { PaginationExemptionList: () => null };
    if (name.endsWith("error-messages")) return { displayAdminError: e => String(e) };
    if (name.endsWith("h-client")) return new Proxy({
      updateH3QuestConfig: async (...args) => { writes.push(args); return model; },
      createH3QuestEventBinding: async (...args) => { writes.push(args); return model; },
      updateH3QuestEventBinding: async (...args) => { writes.push(args); return model; },
      deleteH3QuestEventBinding: async (...args) => { writes.push(args); return model; },
      ...client,
    }, { get: (obj, key) => obj[key] ?? (() => assert.fail(`unexpected client call ${String(key)}`)) });
    assert.fail(`unexpected import ${name}`);
  }, module.exports, module);
  const tree = module.exports.H3QuestEvents({ ctx: {
    can: () => writable, toast: value => toasts.push(value),
    openActionConfirm: value => dialogs.push(value), openConfirm: value => dialogs.push(value),
  } });
  const nodes = [];
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    nodes.push(node); walk(node.props?.children);
  };
  walk(tree);
  const text = node => Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : String(node ?? "");
  const buttons = label => nodes.filter(node => node.type === "button" && text(node) === label);
  const click = (label, index = 0) => {
    const button = buttons(label)[index]; assert.ok(button, `button ${label}`);
    assert.equal(Boolean(button.props.disabled), false); button.props.onClick();
    return dialogs.at(-1);
  };
  return { model, tree, text, buttons, click, dialogs, toasts, writes };
}

test("new paused tasks are bindable, archived and identifier-less tasks are excluded, events never become IDs", () => {
  const view = render({ dayOneTasks: [
    { taskCode: "visit_earn", completionEvent: "H3_DAY_ONE_EARN_PAGE_VIEWED", status: "paused", task: "收益页" },
    { missionCode: "weekly_exchange", completionEvent: "H3_EXCHANGE_COMPLETED", status: "active" },
    { taskCode: "retired", status: "archived" },
    { completionEvent: "EVENT_IS_NOT_A_MISSION", status: "active" },
  ], weeklyTier1: [{ taskCode: "visit_earn", status: "active" }] });
  const dialog = view.click("+ 新增绑定");
  const field = dialog.businessForm.fields.find(field => field.key === "questCode");
  assert.deepEqual(field.options, ["visit_earn", "weekly_exchange"]);
  assert.match(field.optionLabels.visit_earn, /待启用/);
  assert.equal(view.writes.length, 0);
});

test("each weekly reward button sends the mission code and original CAS reward through the real dialog callback", async () => {
  const view = render({
    weeklyTier1: [{ taskCode: "weekly_exchange", completionEvent: "H3_EXCHANGE_COMPLETED", cond: "兑换", reward: "25 NEX", status: "active" }],
    weeklyTier2: [{ missionCode: "weekly_referral", completionEvent: "H3_REFERRAL_REGISTERED", cond: "邀请", reward: "80 NEX", status: "paused" }],
  });
  await view.click("改奖励", 0).run("fixture review reason", "30");
  await view.click("改奖励", 1).run("fixture review reason", "85");
  assert.deepEqual(view.writes, [
    ["mission.weekly_exchange.reward", "30", "fixture review reason", "25"],
    ["mission.weekly_referral.reward", "85", "fixture review reason", "80"],
  ]);
});

test("five available SYSTEM events generate typed binding requests without changing mission identity", async () => {
  const events = ["H3_STOREFRONT_THREE_PRODUCTS_VIEWED", "H3_GENESIS_SECONDARY_MARKET_VIEWED", "H3_COMPUTE_COMPLETED_50", "H3_REFERRAL_REGISTERED", "H3_EXCHANGE_COMPLETED"];
  const view = render({ dayOneTasks: [{ taskCode: "visit_earn", status: "paused" }] });
  const dialog = view.click("+ 新增绑定");
  assert.ok(dialog, "paused task must open the binding form");
  const fields = dialog.businessForm.fields;
  assert.equal(fields.find(f => f.key === "userIdField").current, "user_id");
  for (const eventType of events) {
    assert.ok(fields.find(f => f.key === "eventType").options.includes(eventType));
    await dialog.run("fixture binding reason", undefined, { bindingCode: "FIXTURE", eventType, questCode: "visit_earn", userIdField: "user_id", enabled: "false" });
    assert.deepEqual(view.writes.at(-1), ["FIXTURE", { producer: "SYSTEM", eventType, questCode: "visit_earn", userIdField: "user_id", enabled: false, reason: "fixture binding reason" }]);
  }
});

test("read-only users see disabled mutation controls and unknown completion kinds remain unbound", () => {
  const view = render({ weeklyTier1: [{ taskCode: "weekly_exchange", cond: "兑换", reward: "25 NEX", status: "paused", completionType: "unknown" }] }, false);
  for (const label of ["+ 新增绑定", "改奖励", "编辑", "启用"]) {
    const buttons = view.buttons(label); assert.ok(buttons.length, label);
    assert.ok(buttons.every(button => button.props.disabled), label);
  }
  assert.match(view.text(view.tree), /待绑定规范事件/);
  assert.deepEqual(view.writes, []);
});

const deferred = ["H3_DAY_ONE_EARN_PAGE_VIEWED", "H3_DAY_ONE_STORE_PAGE_VIEWED", "H3_DAY_ONE_S1_ROI_VIEWED"];
for (const eventType of deferred) {
  test(`${eventType} cannot be created or enabled, but existing bindings remain recoverable`, async () => {
    const mission = { taskCode: "visit_earn", status: "paused" };
    const view = render({ dayOneTasks: [mission] });
    const create = view.click("+ 新增绑定");
    assert.ok(!create.businessForm.fields.find(f => f.key === "eventType").options.includes(eventType));
    const form = { bindingCode: "EXISTING", eventType, questCode: "visit_earn", userIdField: "user_id", enabled: "true" };
    for (const enabled of ["true", "false"]) {
      await assert.rejects(create.run("fixture", undefined, { ...form, enabled }), /H3_BINDING_APP_OBSERVATION_UNAVAILABLE/);
    }
    assert.deepEqual(view.writes, []);
    const binding = { bindingCode: "EXISTING", producer: "SYSTEM", eventType, questCode: "visit_earn", userIdField: "user_id", status: 0 };
    const paused = render({ eventBindings: [binding] });
    assert.equal(paused.buttons("启用")[0].props.disabled, true);
    // Exercise the actual callback as well as the UI disabled state.
    paused.buttons("启用")[0].props.onClick();
    await assert.rejects(paused.dialogs.at(-1).run("fixture"), /H3_BINDING_APP_OBSERVATION_UNAVAILABLE/);
    const edit = paused.click("改绑");
    assert.ok(edit.businessForm.fields.find(f => f.key === "eventType").options.includes(eventType));
    await assert.rejects(edit.run("fixture", undefined, form), /H3_BINDING_APP_OBSERVATION_UNAVAILABLE/);
    assert.deepEqual(paused.writes, []);
    await edit.run("fixture", undefined, { ...form, enabled: "false" });
    assert.equal(paused.writes.at(-1)[1].enabled, false);
    await edit.run("fixture", undefined, { ...form, eventType: "H3_EXCHANGE_COMPLETED" });
    assert.equal(paused.writes.at(-1)[1].eventType, "H3_EXCHANGE_COMPLETED");
    const active = render({ eventBindings: [{ ...binding, status: 1 }] });
    await active.click("停用").run("fixture");
    assert.equal(active.writes.at(-1)[1].enabled, false);
    assert.equal(active.writes.at(-1)[1].expectedEnabled, true);
    await active.click("删除").run("fixture");
    assert.equal(active.writes.length, 2);
  });
}
