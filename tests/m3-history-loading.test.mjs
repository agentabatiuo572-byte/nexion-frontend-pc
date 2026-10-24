import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("chat.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "CustomerHistoryMessages");
const permission = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === "lostPermission"));
const main = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "M3DedicatedChat");
let gate;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "loadEnabled") gate = node.initializer.expression;
  ts.forEachChild(node, visit);
}
visit(main);
const candidateEffect = main.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect"
  && node.getText(ast).includes("loadConversationDetail(closedCandidateMissing[0]"));
const ready = main.body.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => node.name.getText(ast) === "closedCandidatesReady");
assert.ok(component && permission && gate && candidateEffect && ready, "execute the production history component and parent gates");
const compile = text => ts.transpileModule(text, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const code = compile(`${permission.getText(ast)}\n${component.getText(ast)}\nglobalThis.Component=CustomerHistoryMessages;`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = id => ({ id, customerId: "42", version: 1, messages: [], detailReady: false });
const enabled = (selected, customerHistory, row) => vm.runInNewContext(gate.getText(ast), { selected, customerHistory, row });
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree)
  ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];

// The production hooks run with deferred transports; nothing opens a server or browser.
function harness(initial) {
  const slots = [], effects = [], requests = [], invalidations = [], readRequests = [];
  let cursor = 0, props, tree;
  const ctx = {
    loadConversationDetail: (id, signal) => new Promise((resolve, reject) => requests.push({ id, signal, resolve, reject })),
    invalidateScope: (...args) => invalidations.push(args),
  };
  const sandbox = {
    exports: {},
    AbortController,
    require: name => {
      assert.equal(name, "react/jsx-runtime");
      return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    },
    displayAdminError: cause => cause.message,
    markMConversationRead: async (...args) => { readRequests.push(args); },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        slots[index] = { deps, cleanup: previous?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); });
      }
    },
  };
  vm.runInNewContext(code, sandbox);
  function render(patch = {}) {
    props = { ...props, ...patch }; cursor = 0;
    tree = sandbox.Component(props);
    effects.splice(0).forEach(effect => effect());
    return tree;
  }
  render({ conversation: initial, ctx, customerName: "Customer", loadEnabled: false });
  return { requests, invalidations, readRequests, render,
    error: () => slots[0].value,
    retry: () => { const button = nodes(render()).find(node => node.type === "button"); assert.ok(button); button.props.onClick(); render(); },
    unmount: () => slots.forEach(slot => slot.cleanup?.()),
  };
}

test("disabled history gate and already hydrated rows do not start detail requests", () => {
  const h = harness(row("old"));
  assert.equal(h.requests.length, 0);
  h.render({ conversation: { ...row("old"), detailReady: true }, loadEnabled: true });
  assert.equal(h.requests.length, 0);
  assert.equal(h.readRequests.length, 0);
  h.unmount();
});

test("actual parent gate waits for primary detail and releases ten historical segments one at a time", async () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(`history-${i}`));
  const children = rows.map(item => harness(item));
  const selected = { detailReady: false };
  const render = () => children.forEach((child, i) => child.render({ conversation: rows[i], loadEnabled: enabled(selected, rows, rows[i]) }));
  render();
  assert.equal(children.flatMap(child => child.requests).length, 0);
  selected.detailReady = true;
  for (let i = 0; i < rows.length; i++) {
    render();
    assert.deepEqual(children.map(child => child.requests.length), rows.map((_, index) => index <= i ? 1 : 0));
    children[i].requests[0].resolve(); await tick();
    rows[i] = { ...rows[i], detailReady: true };
  }
  render();
  assert.equal(children.flatMap(child => child.requests).length, 10);
  children.forEach(child => child.unmount());
});

test("a failed historical segment stays retryable and does not release later segments prematurely", async () => {
  const rows = [row("first"), row("second")], selected = { detailReady: true };
  const first = harness(rows[0]), second = harness(rows[1]);
  first.render({ loadEnabled: enabled(selected, rows, rows[0]) });
  first.requests[0].reject(new Error("detail timed out")); await tick();
  assert.equal(first.error(), "detail timed out");
  second.render({ loadEnabled: enabled(selected, rows, rows[1]) });
  assert.equal(second.requests.length, 0);
  first.retry(); assert.equal(first.requests.length, 2);
  assert.equal(first.error(), "");
  first.requests[1].resolve(); await tick(); rows[0] = { ...rows[0], detailReady: true };
  first.render({ conversation: rows[0], loadEnabled: enabled(selected, rows, rows[0]) });
  second.render({ loadEnabled: enabled(selected, rows, rows[1]) });
  assert.equal(second.requests.length, 1);
  first.unmount(); second.unmount();
});

for (const boundary of ["disabled", "new-version", "unmount"]) {
  test(`${boundary} cancels the old read and suppresses a late permission failure`, async () => {
    const h = harness(row("old")); h.render({ loadEnabled: true });
    const previous = h.requests[0];
    if (boundary === "disabled") h.render({ loadEnabled: false });
    else if (boundary === "new-version") h.render({ conversation: { ...row("old"), version: 2 } });
    else h.unmount();
    assert.equal(previous.signal.aborted, true);
    previous.reject({ status: 403, message: "late forbidden" }); await tick();
    assert.equal(h.error(), ""); assert.deepEqual(h.invalidations, []);
    assert.equal(h.requests.length, boundary === "new-version" ? 2 : 1);
    h.unmount();
  });
}

for (const status of [403, 404]) {
  test(`current ${status} revokes the whole customer scope instead of retaining stale history`, async () => {
    const h = harness(row("old")); h.render({ loadEnabled: true });
    h.requests[0].reject({ status, message: "permission changed" }); await tick();
    assert.deepEqual(h.invalidations, [["old", "42"]]);
    assert.equal(h.error(), ""); h.unmount();
  });
}

test("selected conversation disables the duplicate candidate loader but preserves first-contact loading", () => {
  for (const selected of [{ id: "current" }, null]) {
    const calls = [], context = { selected, replyCustomerId: "42", conversationsAvailable: true,
      closedCandidateMissing: ["old"], closedCandidateError: "", authEpoch: 1, closedCandidateRetry: 0,
      loadConversationDetail: (...args) => { calls.push(args); return Promise.resolve(); },
      AbortController, useEffect: effect => effect() };
    vm.runInNewContext(compile(candidateEffect.getText(ast)), context);
    assert.equal(calls.length, selected ? 0 : 1);
  }
});

test("a stale candidate-loader error cannot lock a loaded selected conversation or bypass missing history", () => {
  const evaluate = patch => vm.runInNewContext(ready.initializer.getText(ast), {
    selected: { id: "current" }, closedCandidateMissing: [], closedCandidateError: "previous failure",
    selectedClosedIds: new Set(), closedReplyCandidates: [], ...patch,
  });
  assert.equal(evaluate({}), true);
  assert.equal(evaluate({ closedCandidateMissing: ["old"] }), false);
  assert.equal(evaluate({ selected: null }), false);
  assert.equal(evaluate({ selectedClosedIds: new Set(["old"]) }), false);
});
