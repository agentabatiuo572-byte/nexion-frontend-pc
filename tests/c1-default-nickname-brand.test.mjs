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
const element = (type, props) => ({ type, props });
const text = node => typeof node === "object" ? text(node.props.children) : String(node);
function fixture(path, kind) {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) { found.push(node); ts.forEachChild(node, visit); }
  visit(ast);
  const helperName = kind === "list" ? "text" : "asText";
  const helper = found.find(node => ts.isFunctionDeclaration(node) && node.name?.text === helperName);
  const jsx = found.find(node => ts.isJsxElement(node) && (kind === "list"
    ? node.openingElement.tagName.getText(ast) === "td" && node.getText(ast).includes("u.nickname")
    : node.openingElement.tagName.getText(ast) === "h1" && node.getText(ast).includes("customer-panorama-name")));
  assert.ok(jsx, `real ${kind} nickname JSX`);
  const declarations = kind === "list" ? [] : found.filter(node => ts.isVariableDeclaration(node)
    && ["nickname", "displayNickname"].includes(node.name.getText(ast))).map(node => `const ${node.getText(ast)};`);
  const reset = found.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === "resetUserNickname");
  const exports = {};
  new Function("require", "exports", "userNicknameText", compile(`${helper.getText(ast)}
    export function render(profile, resetUserNickname) { const u=profile, userId=profile.id, reason="fixture", commandKey="key";
      ${declarations.join("\n")} return { node: (${jsx.getText(ast)}), reset: () => ${reset ? reset.getText(ast) : "null"} }; }`))(
    id => { assert.equal(id, "react/jsx-runtime"); return { jsx: element, jsxs: element }; }, exports, brand.userNicknameText);
  return exports.render;
}
const list = fixture("app/components/domain-views/c-tabs/c1-search.tsx", "list");
const detail = fixture("app/_console/users/search/[id]/page.tsx", "detail");

test("C1 actual list and heading preserve the source default name without mutating DTO", () => {
  for (const suffix of ["1058", "1057", "0001"]) {
    const profile = Object.freeze({ id: 42, nickname: `NexGrid ${suffix}`, phoneMasked: `187****${suffix}` });
    for (const render of [list, detail]) assert.equal(text(render(profile).node), profile.nickname);
    assert.equal(profile.nickname, `NexGrid ${suffix}`);
  }
});

test("C1 retains custom names, mismatches and missing phone evidence", () => {
  for (const [nickname, phoneMasked] of [
    ["NexGrid Fan", "187****1058"], ["My NexGrid 1058", "187****1058"],
    ["NexGrid 1058 custom", "187****1058"], ["NexGrid 1058", "187****1057"],
    ["NexGrid 1058", null], ["NexGrid 1058", "****"], ["UVEL 1058", "187****1058"],
    ["NexGrid 105", "187****0105"], ["NexGrid 10580", "187****0580"], ["Nova Rover 17", "187****1058"],
  ]) for (const render of [list, detail]) assert.equal(text(render({ nickname, phoneMasked }).node), nickname);
});

test("C1 reset sends the original nickname and displays the same source name", () => {
  const calls = [], profile = { id: 42, nickname: "NexGrid 1058", phoneMasked: "187****1058" };
  const page = detail(profile, (...args) => calls.push(args));
  assert.equal(text(page.node), "NexGrid 1058");
  page.reset();
  assert.deepEqual(calls, [[42, "NexGrid 1058", "fixture", undefined, "key"]]);
});

test("the default-name formatter preserves unknown and unrelated source values", () => {
  assert.equal(brand.userNicknameText("NexGrid 1058", "187****1058"), "NexGrid 1058");
  for (const name of ["NexGridFan", "StellarBox collector", "Nexion Fan", "nexgrid 1058"])
    assert.equal(brand.userNicknameText(name, "187****1058"), name);
});

test("system reset and historical phone defaults remain visible while CAS retains raw names", () => {
  for (const [nickname, expected] of [
    ["NexGrid-F343FA44", "NexGrid-F343FA44"], ["Nexion 1058", "Nexion 1058"], ["UVEL 1058", "UVEL 1058"],
  ]) {
    const calls = [], profile = Object.freeze({ id: 42, nickname, phoneMasked: "187****1058" });
    for (const render of [list, detail]) assert.equal(text(render(profile).node), expected);
    detail(profile, (...args) => calls.push(args)).reset();
    assert.equal(calls[0][1], nickname);
    assert.equal(profile.nickname, nickname);
  }
  assert.equal(brand.userNicknameText("NexGrid-F343FA44", null), "NexGrid-F343FA44");
  for (const name of ["NexGrid1058", "Nexion1058", "NexGrid 1058\n", "Nexion 1058\n", "NexGrid-F343FA44\n", "NexGrid-F343FA4", "NexGrid-F343FA444", "NexGrid-f343fa44", "NexGrid-G343FA44", "My NexGrid-F343FA44", "NexGrid-F343FA44 fan"])
    assert.equal(brand.userNicknameText(name, "187****1058"), name);
  assert.equal(brand.userNicknameText("Nexion1058", "187****1057"), "Nexion1058");
  assert.equal(brand.userNicknameText("Nexion1058", null), "Nexion1058");
});
