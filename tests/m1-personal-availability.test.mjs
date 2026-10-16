import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/domain-views/m-tabs/m1-personal-workbench.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("personal.tsx", source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const declarations = new Map();
let customerView;
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["rows", "listRecords", "totalPages"].includes(node.name.getText(ast))) declarations.set(node.name.getText(ast), node.getText(ast));
  if (ts.isBinaryExpression(node) && node.left.getText(ast) === 'view === "customers"') customerView = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(customerView);
const context = {
  React, view: "customers", page: 1, keyword: "", keywordDraft: "", filter: "ACTIVE", filters: [],
  Search: () => null, ChevronLeft: () => null, ChevronRight: () => null,
  setPage() {}, setKeyword() {}, setKeywordDraft() {}, setFilter() {}, setRowsRefresh() {}, openDetail() {}, openChat() {},
  CustomerRows: ({ rows, loading, error }) => React.createElement("div", { "data-record-count": rows.length }, loading ? "加载中" : error ?? "名单已读取"),
};
const body = [...declarations.values()].map(value => `const ${value};`).join("\n");
runInNewContext(ts.transpileModule(`render = (snapshot, rowsLoading = false, rowsError = null) => { ${body} return (${customerView}); };`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
}).outputText, context);
const page = (available, total) => ({ customers: { available, total, pageNum: 1, pageSize: 10, records: total ? [{ customerId: "53009" }] : [] } });
const render = (...args) => renderToStaticMarkup(context.render(...args));

test("unavailable filters never present placeholder zero or stale totals as known customer counts", () => {
  for (const total of [0, 21]) {
    const html = render(page(false, total), false, "当前筛选条件暂不可用，请调整服务规则后重试。");
    assert.match(html, /总数待确认/);
    assert.doesNotMatch(html, /共 \d+ 位|s5a-pager/);
    assert.match(html, /data-record-count="0"/);
    assert.match(html, /当前筛选条件暂不可用/);
  }
});

test("confirmed empty and populated results retain their exact count and pagination", () => {
  assert.match(render(page(true, 0)), /共 0 位/);
  const html = render(page(true, 21));
  assert.match(html, /共 21 位/);
  assert.match(html, /s5a-pager/);
  assert.match(html, /data-record-count="1"/);
});

test("initial load and read failure keep the total unknown", () => {
  for (const html of [render(null, true), render(null, false, "读取失败")]) {
    assert.match(html, /总数待确认/);
    assert.doesNotMatch(html, /共 \d+ 位|s5a-pager/);
  }
});

test("a subsequent available snapshot restores totals after unavailable filtering", () => {
  assert.match(render(page(true, 3)), /共 3 位/);
  assert.match(render(page(false, 0)), /总数待确认/);
  assert.match(render(page(true, 3)), /共 3 位/);
});
