import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("G7 APY caption follows the current lock term while existing orders retain their snapshot", () => {
  const path = "../app/components/domain-views/g-tabs/g7-repurchase.tsx";
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const production = ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node => node.getText(ast)).join("\n");
  let slots = [];
  let cursor = 0;
  const context = {
    require: createRequire(import.meta.url), exports: {},
    useAdminAuth: selector => selector({ session: null }),
    useState: () => [slots[cursor++], () => {}],
    useRef: value => ({ current: value }), useCallback: callback => callback, useEffect() {},
    Link: ({ children }) => React.createElement("a", null, children),
  };
  runInNewContext(ts.transpileModule(production, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, context);
  for (const lockDays of [1, 30, 90, 3650, 1]) {
    const overview = {
      stats: { ordersMonth: 1, principalUsd: 100, matureUsd: 108.63, ticketsMonth: 1, lockDays },
      params: [
        { key: "apy", value: "35" },
        { key: "lockDays", value: String(lockDays) },
      ],
      coverage: { coverageRatio: 133.3 }, phaseGate: { linkedDomain: "H1", value: "×1" },
      g4Capacity: { monthlyCapacity: 100000, ticketsIssuedThisMonth: 1 },
      stateMachine: [], statusBreakdown: [], amountDistribution: "-", sources: [],
    };
    const order = { orderNo: "existing-order", nickname: "用户", userNo: "U1", amountUsdt: 100,
      apyPct: 35, lockDays: 90, estimatedInterestUsdt: 8.63, status: "ACTIVE" };
    slots = [overview, [order], false, "", null, null, false, false];
    cursor = 0;
    const html = renderToStaticMarkup(React.createElement(context.exports.G7Repurchase, { ctx: {} }));
    assert.ok(html.includes(`${lockDays} 天锁仓 · 只对新单生效`));
    if (lockDays !== 90) assert.ok(!html.includes("90 天锁仓 · 只对新单生效"));
    assert.ok(html.includes(`>${lockDays} 天</span>`), "lock term row uses current config");
    assert.ok(html.includes("35% / 90 天</td>"), "historical order keeps its original term");
  }
});
