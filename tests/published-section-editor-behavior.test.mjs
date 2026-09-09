import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/components/domain-views/published-content-editor.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(`${source}\nexport { RankLocaleEditor };`, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
new Function("require", "exports", output)((name) => {
  if (name === "react/jsx-runtime") return require(name);
  if (name.endsWith(".module.css")) return { default: {} };
  if (name === "react" || name.startsWith("@/lib/")) return {};
  throw new Error(`Unexpected import ${name}`);
}, exports);

function editor(ids) {
  let value = { hero: "Reviewed draft", sections: ids.map((id, order) => ({ id, order, title: `Title ${id}`, body: `Body ${id}` })) };
  const original = structuredClone(value);
  function nodes(node) {
    if (Array.isArray(node)) return node.flatMap(nodes);
    if (!node || typeof node !== "object") return [];
    return [node, ...nodes(node.props?.children)];
  }
  function click(label, index = 0) {
    const tree = exports.RankLocaleEditor({ value, disabled: false, onChange: next => { value = next; } });
    const buttons = nodes(tree).filter(node => node.type === "button" && node.props.children === label);
    assert.ok(buttons[index], `Missing ${label} ${index}`);
    buttons[index].props.onClick();
  }
  return { click, read: () => value, original };
}

test("delete a middle section then add without duplicating a surviving ID", () => {
  const ui = editor(["section-1", "section-2", "section-3"]);
  ui.click("删除段落", 1);
  ui.click("新增段落");
  const rows = ui.read().sections;
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.deepEqual(rows.slice(0, 2), [ui.original.sections[0], ui.original.sections[2]]);
  assert.equal(rows[2].title, "");
  assert.equal(rows[2].body, "");
});

test("repeated additions skip manually assigned and noncontiguous occupied IDs", () => {
  const ui = editor(["custom-policy", "section-4", "section-5"]);
  ui.click("新增段落");
  ui.click("新增段落");
  const rows = ui.read().sections;
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.deepEqual(rows.slice(0, 3), ui.original.sections);
  assert.deepEqual(ui.original.sections.map(row => row.id), ["custom-policy", "section-4", "section-5"]);
});

test("an empty document can add its first section", () => {
  const ui = editor([]);
  ui.click("新增段落");
  assert.equal(ui.read().sections.length, 1);
  assert.equal(ui.read().sections[0].id, "section-1");
  assert.equal(ui.read().hero, "Reviewed draft");
});

test("new IDs stay unique after the rank policy server trims existing IDs", () => {
  const ui = editor(["intro", " section-3 \t"]);
  ui.click("新增段落");
  const rows = ui.read().sections;
  assert.equal(new Set(rows.map(row => row.id.trim())).size, rows.length);
  assert.deepEqual(rows.slice(0, 2), ui.original.sections);
});
