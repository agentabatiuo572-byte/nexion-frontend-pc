import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const brand = {};
new Function("exports", compile(read("lib/admin/brand-copy.ts")))(brand);
function nodes(path) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), result = [];
  const visit = node => { result.push(node); ts.forEachChild(node, visit); };
  visit(ast);
  return { ast, result };
}
function execute(source, bindings) {
  const exports = {};
  new Function("exports", "require", ...Object.keys(bindings), compile(source))(
    exports, id => { assert.equal(id, "react/jsx-runtime"); return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }; }, ...Object.values(bindings));
  return exports.render;
}
const content = node => Array.isArray(node) ? node.map(content).join("") : node == null ? "" : typeof node === "object" ? content(node.props?.children) : String(node);

test("C2 actual account label and list cell share the formatter without changing source values", () => {
  const { ast, result } = nodes("app/components/domain-views/c-tabs/c2-actions.tsx");
  const declarations = ["text", "displayAccount"].map(name => result.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(ast));
  const cell = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "td" && n.getText(ast).includes("account.nickname"));
  const render = execute(`${declarations.join("\n")} export function render(account) { return [displayAccount(account), (${cell.getText(ast)})]; }`, brand);
  for (const [nickname, expected] of [["Nexion 3778", "UVEL 3778"], ["NexGrid-F343FA44", "UVEL-F343FA44"], ["NexGrid Fan", "NexGrid Fan"]]) {
    const account = Object.freeze({ userNo: "60723153007", nickname, phoneMasked: "187****3778" });
    const [label, cell] = render(account);
    assert.equal(label, `60723153007 · ${expected}`);
    assert.equal(content(cell), expected);
    assert.equal(account.nickname, nickname);
  }
});

test("shared M1/M3/bulk actual SKU picker displays official brand and preserves selected product ID", () => {
  const { ast, result } = nodes("app/components/domain-views/m-tabs/support-content-tools.tsx");
  const button = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "button" && n.getText(ast).includes('skuId:s.id'));
  assert.ok(button);
  const render = execute(`export function render(s,onSelect) { const disabled=false, setPicker=()=>{}, Icon="icon"; return (${button.getText(ast)}); }`, brand);
  for (const [id, name, expected] of [["stellarbox-s1", "NexGridBox S1", "UVELBox S1"], ["stellarbox-pro", "StellarBox Pro", "UVELBox Pro"], ["custom", "NexGridBox S1", "NexGridBox S1"]]) {
    const row = Object.freeze({ id, name }), calls = [], node = render(row, c => calls.push(c));
    assert.ok(content(node).includes(expected));
    node.props.onClick();
    assert.deepEqual(calls, [{ kind: "SKU", skuId: id, name: expected }]);
    assert.equal(row.name, name);
  }
});

test("actual M3 historical SKU card title uses official ID/name while free text remains untouched", () => {
  const { ast, result } = nodes("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
  const title = result.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(ast) === "strong" && n.getText(ast).includes("message.skuName"));
  assert.ok(title);
  const render = execute(`export function render(message) { return (${title.getText(ast)}); }`, brand);
  const message = Object.freeze({ skuId: "stellarbox-s1", skuName: "NexGridBox S1", text: "My NexGrid story", clientMessageId: "original-command" });
  assert.equal(content(render(message)), "UVELBox S1");
  assert.equal(message.skuName, "NexGridBox S1");
  assert.equal(message.text, "My NexGrid story");
  assert.equal(message.clientMessageId, "original-command");
  assert.equal(content(render({ ...message, skuId: "custom" })), "NexGridBox S1");
});

test("legacy M3 session body uses the same exact SKU-caption rule", () => {
  const { ast, result } = nodes("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const body = result.find(n => ts.isPropertyAssignment(n) && n.name.getText(ast) === "body" && n.initializer.getText(ast).includes("supportMessageBrandText"));
  assert.ok(body);
  const render = execute(`export function render(m) { return ${body.initializer.getText(ast)}; }`, brand);
  const message = Object.freeze({ kind: "SKU", skuId: "stellarbox-s1", skuName: "NexGridBox S1", text: "NexGridBox S1" });
  assert.equal(render(message), "UVELBox S1");
  assert.equal(render({ ...message, text: "My NexGrid story" }), "My NexGrid story");
  assert.equal(render({ ...message, kind: "TEXT" }), "NexGridBox S1");
  assert.equal(render({ ...message, skuId: "custom" }), "NexGridBox S1");
  assert.equal(message.text, "NexGridBox S1");
});
