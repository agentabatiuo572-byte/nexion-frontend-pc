import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url), ts = require("typescript");
const jsx = require("react/jsx-runtime");
const HDSelectStub = () => null;
const rules = { version: 7, dormantDays: null, maintenanceDays: 2, activityWindowDays: null, inheritanceMode: "UNCONFIGURED", maxInheritanceDepth: null, unboundAssignmentMode: "SUPERVISOR" };
const all = (tree, predicate) => {
  if (!tree || typeof tree !== "object") return [];
  return [...(predicate(tree) ? [tree] : []), ...[tree.props?.children].flat(Infinity).flatMap(child => all(child, predicate))];
};

// Execute actual component hooks and handlers without a browser, server or writes.
function harness(file, name, initialProps, dependencies = {}) {
  const cells = []; let cursor = 0, effects = [], dirty = true, tree, props = initialProps;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial; return [cells[i], next => { const value = typeof next === "function" ? next(cells[i]) : next; if (!Object.is(value, cells[i])) { cells[i] = value; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; return cells[i] ??= { current: initial }; },
    useMemo(calculate) { return calculate(); },
    useEffect(run, deps) { const i = cursor++, old = cells[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) effects.push(() => { old?.cleanup?.(); cells[i] = { deps, cleanup: run() }; }); },
  };
  const auth = { session: { adminId: 7 }, authEpoch: 1 };
  const useAdminAuth = selector => selector(auth); useAdminAuth.getState = () => auth;
  const modules = {
    react: hooks, "react/jsx-runtime": jsx,
    "../design-kit": { Modal: () => null, Icon: () => null },
    "./m-avatar": { MAvatar: () => null, avInitials: () => "" },
    "./hd-select.css": {}, "./m-support-admin.css": {}, "./hd-ui": { HDSelect: HDSelectStub },
    "../../../../lib/admin/m-support-client": { supportClient: { rules: async () => rules }, isIndeterminateSupportError: () => false },
    "../../../../lib/admin/pending-mutation-store": { createPendingMutationStore: () => ({ list: () => [] }) },
    "../../../../lib/admin/shell-authorities": { adminShellSessionKey: () => "7" },
    "../../../../lib/store/admin-auth": { useAdminAuth },
    // D-3 / M-18: the 待分配客户 policy panel renders separately and is not under test here.
    "./m5-unbound-policy": { M5UnboundPolicy: () => null }, ...dependencies,
  };
  const code = ts.transpileModule(readFileSync(new URL(`../app/components/domain-views/m-tabs/${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, AbortController, queueMicrotask, document: { addEventListener() {}, removeEventListener() {} }, require: key => { assert.ok(Object.hasOwn(modules, key), key); return modules[key]; } };
  vm.runInNewContext(code, context);
  function render(next = props) {
    props = next; let iterations = 0;
    do { dirty = false; cursor = 0; effects = []; tree = context.exports[name](props); for (const run of effects) run(); assert.ok(++iterations < 20, "stable render"); } while (dirty);
    return tree;
  }
  render();
  return { render, get tree() { return tree; }, async flush() { for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } } };
}

test("HDSelect labels its real trigger and disabling an open selector closes it", () => {
  const props = { id: "rule-mode", value: "UNCONFIGURED", options: [{ value: "UNCONFIGURED", label: "未配置" }], onChange() {} };
  const h = harness("hd-ui.tsx", "HDSelect", props);
  let trigger = all(h.tree, node => node.type === "button")[0];
  assert.equal(trigger.props.id, "rule-mode"); assert.equal(trigger.props.disabled, false);
  trigger.props.onClick(); h.render();
  assert.equal(all(h.tree, node => node.props.role === "listbox").length, 1);
  h.render({ ...props, disabled: true });
  trigger = all(h.tree, node => node.type === "button")[0];
  assert.equal(trigger.props.disabled, true); assert.equal(trigger.props["aria-expanded"], false);
  trigger.props.onClick(); h.render({ ...props, disabled: false });
  assert.equal(all(h.tree, node => node.props.role === "listbox").length, 0);
});

test("HDSelect's default enabled option still delivers the value and closes", () => {
  const selected = [];
  const h = harness("hd-ui.tsx", "HDSelect", { value: "A", options: [{ value: "A", label: "甲" }, { value: "B", label: "乙" }], onChange: value => selected.push(value) });
  all(h.tree, node => node.props["aria-haspopup"])[0].props.onClick(); h.render();
  all(h.tree, node => node.props.role === "option")[1].props.onClick(); h.render();
  assert.deepEqual(selected, ["B"]); assert.equal(all(h.tree, node => node.props.role === "listbox").length, 0);
});

test("M5 supervisor selector remains disabled and cannot mutate the loaded rule", async () => {
  const h = harness("m5-service-rules.tsx", "M5ServiceRules", { permission: "supervisor" }); await h.flush();
  const select = all(h.tree, node => node.type === HDSelectStub)[0];
  assert.equal(select.props.id, "m-rule-inheritanceMode"); assert.equal(select.props.disabled, true);
  select.props.onChange("UNLIMITED"); h.render();
  assert.equal(all(h.tree, node => node.type === HDSelectStub)[0].props.value, "UNCONFIGURED");
  assert.equal(all(h.tree, node => node.type === "input" && node.props.type === "number").every(node => node.props.disabled), true);
});

test("M5 admin retains unconfigured fields and zero finite depth when switching modes", async () => {
  const h = harness("m5-service-rules.tsx", "M5ServiceRules", { permission: "superadmin" }); await h.flush();
  const select = () => all(h.tree, node => node.type === HDSelectStub)[0];
  assert.equal(select().props.disabled, false); assert.equal(select().props.value, "UNCONFIGURED");
  assert.equal(all(h.tree, node => node.props.id === "m-rule-dormantDays")[0].props.value, "");
  select().props.onChange("LIMITED"); h.render();
  all(h.tree, node => node.props.id === "m-rule-maxInheritanceDepth")[0].props.onChange({ target: { value: "0" } }); h.render();
  select().props.onChange("LIMITED"); h.render();
  assert.equal(all(h.tree, node => node.props.id === "m-rule-maxInheritanceDepth")[0].props.value, "0");
  select().props.onChange("UNLIMITED"); h.render();
  assert.equal(all(h.tree, node => node.props.id === "m-rule-maxInheritanceDepth").length, 0);
  select().props.onChange("LIMITED"); h.render();
  assert.equal(all(h.tree, node => node.props.id === "m-rule-maxInheritanceDepth")[0].props.value, "");
});
