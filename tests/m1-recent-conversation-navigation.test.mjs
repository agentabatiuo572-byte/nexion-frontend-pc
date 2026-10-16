import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const parse = (file) => ts.createSourceFile(file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const m1 = parse("app/components/domain-views/m-tabs/m1-personal-workbench.tsx");
const m3 = parse("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
function find(root, predicate) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (node) => find(node, predicate));
}
const recent = find(m1, (node) => ts.isCallExpression(node) && node.expression.getText(m1) === "recent.map");
const click = find(recent, (node) => ts.isJsxAttribute(node) && node.name.text === "onClick").initializer.expression.getText(m1);
const openChat = find(m1, (node) => ts.isVariableDeclaration(node) && node.name.getText(m1) === "openChat").initializer.getText(m1);
const routeEffect = find(m3, (node) => ts.isCallExpression(node) && node.expression.getText(m3) === "useEffect" && node.arguments[0]?.getText(m3).includes('params.get("conversationNo")')).arguments[0].getText(m3);
const evaluate = (source, context) => runInNewContext(ts.transpileModule(`(${source})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);

test("recent entries open their exact history segment even when the customer has several closed conversations", () => {
  const routes = [];
  const context = { router: { push: (url) => routes.push(url) }, encodeURIComponent };
  context.openChat = evaluate(openChat, context);
  for (const conversationNo of ["CV-APP-20261016142158154-1a9534bb", "CV-OLDER-53024"]) {
    context.item = { customerId: "60723153024", conversationNo, lastMessage: "会话已转工单" };
    evaluate(click, context)();
    const url = new URL(routes.at(-1), "https://test.invalid");
    assert.equal(url.pathname, "/service/sessions");
    assert.equal(url.searchParams.get("conversationNo"), conversationNo);
    assert.equal(url.searchParams.has("customerId"), false);
  }
  assert.notEqual(routes[0], routes[1]);
});

test("recent route escapes its conversation identifier and M3 selects history instead of first contact", () => {
  const context = { item: { customerId: "60723153024", conversationNo: "CV/history?x=1&y=2" }, encodeURIComponent, router: { push: (url) => { context.url = url; } } };
  context.openChat = evaluate(openChat, context);
  evaluate(click, context)();
  const route = { URLSearchParams, window: { location: { search: new URL(context.url, "https://test.invalid").search } }, selectionRestored: { current: false },
    setRequestedCustomerId: (value) => { route.customer = value; }, setSelectedId: (value) => { route.conversation = value; }, setScreen: (value) => { route.screen = value; } };
  evaluate(routeEffect, route)();
  assert.equal(route.customer, null);
  assert.equal(route.conversation, context.item.conversationNo);
  assert.equal(route.screen, "chat");
  assert.equal(route.selectionRestored.current, true);
});

test("the separate contact-customer action keeps the current or first-contact route", () => {
  const routes = [], context = { router: { push: (url) => routes.push(url) }, encodeURIComponent };
  evaluate(openChat, context)("60723153024");
  assert.deepEqual(routes, ["/service/sessions?customerId=60723153024"]);
});
