import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function inputCallbacks(file) {
  const source = readFileSync(new URL(`../app/components/domain-views/h-tabs/${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let input, dateInput;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input"
      && node.attributes.properties.some(attr => attr.name?.getText(ast) === "type" && attr.initializer?.text === "datetime-local")) input = node;
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "dateInput") dateInput = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(input, `Missing date input in ${file}`);
  const expression = name => input.attributes.properties.find(attr => attr.name?.getText(ast) === name)?.initializer.expression.getText(ast);
  const evaluate = (body, bindings = {}) => new Function(...Object.keys(bindings), ts.transpileModule(`return (${body});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText)(...Object.values(bindings));
  return {
    change: bindings => evaluate(expression("onChange"), bindings),
    display: bindings => evaluate(expression("value"), { ...bindings, dateInput: dateInput ? evaluate(dateInput) : undefined }),
    step: evaluate(expression("step")),
  };
}

for (const [file, keys, cleared] of [
  ["h4-genesis-raffle.tsx", ["startsAt", "drawAt"], ""],
  ["h4-event-rules.tsx", ["startsAt", "endsAt"], null],
]) test(`${file} keeps minute/second input in UTC and preserves cleared fields`, () => {
  const input = inputCallbacks(file);
  assert.equal(input.step, 1);
  for (const key of keys) {
    let draft = { startsAt: "2026-10-25T04:35:00.000Z", [keys[1]]: "2026-10-25T04:50:00.000Z", titleZh: "原有草稿" };
    for (const value of ["2026-10-25T04:40", "2026-10-25T04:40:00", "2026-10-25T04:40:27", ""]) {
      input.change({ draft, key, setDraft: value => { draft = value; } })({ target: { value } });
      const expected = !value ? cleared : `${value.length === 16 ? `${value}:00` : value}.000Z`;
      assert.equal(draft[key], expected);
      assert.equal(input.display({ draft, key }), value ? expected.slice(0, 19) : "");
      assert.equal(draft.titleZh, "原有草稿");
    }
  }
});
