import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/domain-views/f-tabs/f1-vrank.tsx", import.meta.url), "utf8");

function renderF1(ctx) {
  const output = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const tree = (type, props, key) => ({ type, props: { ...props, key } });
  const exports = {};
  new Function("require", "exports", "module", output)((name) => {
    if (name === "react") return { useState: (value) => [value, () => undefined] };
    if (name === "react/jsx-runtime") return { jsx: tree, jsxs: tree, Fragment: Symbol("Fragment") };
    if (name.endsWith("design-kit")) return { CodeTag: () => null };
    if (name.endsWith("published-content-editor")) return { PublishedContentEditor: () => null };
    return {};
  }, exports, { exports });
  return exports.F1Vrank({ ctx });
}

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

test("F1 rendered totals use every V-Rank row, not the leadership-pool qualifier slice", () => {
  const tree = renderF1({
    vrankRows: [
      { v: "V0", label: "V0", pop: 5, peerBonusRate: 0, votes: 0, visible: true },
      { v: "V2", label: "V2", pop: 2, peerBonusRate: 0, votes: 0, visible: true },
      { v: "V3", label: "V3", pop: 1, peerBonusRate: 0, votes: 1, visible: true },
      { v: "V4", label: "V4", pop: 1, peerBonusRate: 0, votes: 1, visible: true },
    ],
    leadership: { totalMembers: 2, qualifiers: 0, unlockRank: 8, topN: 10, ranks: [], topConcentrationPct: 0 },
    can: () => false,
    f1Loading: false, f1Error: null, f1ConfigValues: {}, rewards: {},
    voucherOptions: [], voucherLabels: {}, skuOptions: [], skuLabels: {},
    promotionTotal: 0, promotionRecords: [], promotionNextCursor: null, promotionLoading: false, promotionError: null,
    payoutTotal: 0, payoutRecords: [], payoutNextCursor: null, f1PayoutLoading: false, f1PayoutError: null,
    openActionConfirm: () => undefined, addReward: async () => undefined, updateReward: async () => undefined,
    removeReward: async () => undefined, updateF1Config: async () => undefined, proposeVRankOverride: async () => undefined,
    proposePayoutAction: async () => undefined, queryPromotions: async () => undefined, queryPayouts: async () => undefined,
    refreshF1: async () => undefined, run: async () => undefined, toast: () => undefined,
  });

  const text = textOf(tree);
  assert.match(text, /总会员9含 V0 5/);
  assert.match(text, /V3\+ 高价值2≈ 22\.22%/);
});
