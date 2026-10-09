import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/_console/users/search/[id]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "UserDetailPage");
const declarations = statements => statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : []);
const top = declarations(ast.statements);
const local = declarations(page.body.statements);
const declaration = (nodes, name) => {
  const node = nodes.find(node => node.name.getText(ast) === name);
  assert.ok(node, `production declaration ${name}`);
  return `const ${node.getText(ast)};`;
};
let section;
function findSection(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "Section"
    && node.openingElement.attributes.properties.some(attr => ts.isJsxAttribute(attr)
      && attr.name.text === "title" && attr.initializer?.text === "安全 & 会话")) section = node;
  ts.forEachChild(node, findSection);
}
findSection(page);
assert.ok(section, "actual C1 session JSX section");
const reset = page.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect"
  && node.expression.arguments[0].getText(ast).includes("setSessionPage"));
assert.ok(reset, "actual filter/user pagination reset effect");
const names = ["asText", "asNumber", "asArray", "numberLabel", "formatDate", "displayValue", "Section", "DataTable"];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast));
const fixture = [
  ...functions,
  declaration(top, "C1_SESSION_PAGE_SIZE"), declaration(top, "C1_SESSION_STATUS_FILTERS"),
  "export function Fixture({ detail, userKey }) { const summary = detail.summary;",
  declaration(local, "[sessionPage, setSessionPage]"), declaration(local, "[sessionStatusFilter, setSessionStatusFilter]"),
  ...["sessions", "filteredSessions", "sessionPageCount", "visibleSessions"].map(name => declaration(local, name)),
  reset.getText(ast), `return (${section.getText(ast)}); }`,
].join("\n");
const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const labels = {};
new Function("exports", compile(readFileSync(new URL("../lib/admin/c1-detail-display.ts", import.meta.url), "utf8")))(labels);
const element = (type, props) => ({ type, props });
const expand = node => node == null || typeof node === "boolean" ? null : Array.isArray(node) ? node.map(expand)
  : typeof node !== "object" ? node : typeof node.type === "function" ? expand(node.type(node.props))
    : { ...node, props: { ...node.props, children: expand(node.props.children) } };
const text = node => node == null ? "" : Array.isArray(node) ? node.map(text).join("")
  : typeof node === "object" ? text(node.props.children) : String(node);
function nodes(tree) {
  if (tree == null || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props.children)];
}
function harness(sessions) {
  const state = [], previousEffects = [];
  let cursor, effectCursor, changed, effects, tree;
  const scope = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [state[i], value => { const next = typeof value === "function" ? value(state[i]) : value;
        changed ||= next !== state[i]; state[i] = next; }];
    },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const i = effectCursor++, before = previousEffects[i];
      if (!before || deps.some((value, j) => value !== before[j])) effects.push(fn);
      previousEffects[i] = deps;
    },
    fmtNum: String,
    formatC1SessionStatus: labels.formatC1SessionStatus,
    KpiStatCard: props => element("span", { children: [props.label, props.value] }),
    StatusPill: props => element("span", { children: props.label }),
    TabGroup: props => element("div", { children: props.items.map(value => element("button", {
      children: props.children(value), onClick: () => props.onSelect(value),
    })) }),
  };
  const exports = {};
  new Function("require", "exports", ...Object.keys(scope), compile(fixture))(
    id => { assert.equal(id, "react/jsx-runtime"); return { jsx: element, jsxs: element }; }, exports, ...Object.values(scope));
  function render() {
    let attempts = 0;
    do {
      assert.ok(++attempts < 4, "pagination reset settles");
      cursor = effectCursor = 0; changed = false; effects = [];
      tree = expand(exports.Fixture({ detail: { sessions, summary: { activeSessionCount: 1 } }, userKey: "fixture-user" }));
      for (const effect of effects) effect();
    } while (changed);
    return tree;
  }
  render();
  return {
    text: () => text(tree),
    button: label => nodes(tree).find(node => node.type === "button" && text(node) === label),
    click(label) { const button = this.button(label); assert.ok(button, label); assert.ok(!button.props.disabled, label); button.props.onClick(); render(); },
    devices: () => nodes(tree).filter(node => node.type === "tbody").flatMap(node => nodes(node)
      .filter(child => child.type === "tr").map(row => text(nodes(row).find(child => child.type === "td")))),
  };
}
const sample = count => Array.from({ length: count }, (_, i) => ({ id: i + 1, deviceName: `device-${i + 1}`,
  status: i % 5 === 0 ? "ACTIVE" : i % 2 === 0 ? "REVOKED" : "EXPIRED" }));

for (const count of [0, 7, 50]) test(`recent sample scope stays explicit for ${count} returned sessions`, () => {
  const page = harness(sample(count));
  assert.match(page.text(), /最近最多50条会话样本/);
  assert.match(page.text(), new RegExp(`筛选后 ${count} 条`));
  assert.doesNotMatch(page.text(), /已截断|用户共有|用户总数/);
  assert.match(page.text(), new RegExp(`第 1/${Math.max(1, Math.ceil(count / 5))} 页`));
  assert.equal(page.devices().length, Math.min(5, count));
  if (!count) assert.match(page.text(), /暂无会话/);
});

test("actual five-row pagination and all four filters remain bounded to the returned sample", () => {
  const page = harness(sample(50));
  assert.deepEqual(page.devices(), ["device-1", "device-2", "device-3", "device-4", "device-5"]);
  assert.equal(page.button("上一页").props.disabled, true);
  for (let i = 1; i < 10; i++) page.click("下一页");
  assert.match(page.text(), /第 10\/10 页/);
  assert.deepEqual(page.devices(), ["device-46", "device-47", "device-48", "device-49", "device-50"]);
  assert.equal(page.button("下一页").props.disabled, true);
  page.click("上一页"); assert.match(page.text(), /第 9\/10 页/);
  for (const [label, total, first] of [["活跃", 10, "device-1"], ["已撤销", 20, "device-3"], ["已过期", 20, "device-2"], ["全部", 50, "device-1"]]) {
    page.click(label);
    assert.match(page.text(), new RegExp(`第 1/${total / 5} 页`));
    assert.equal(page.devices().length, 5);
    assert.equal(page.devices()[0], first);
    page.click("下一页");
  }
  const empty = harness([{ id: 1, deviceName: "device-1", status: "ACTIVE" }]);
  empty.click("已撤销"); assert.match(empty.text(), /当前筛选下没有会话/);
  assert.equal(empty.devices().length, 0);
  assert.equal(empty.button("下一页"), undefined);
});
