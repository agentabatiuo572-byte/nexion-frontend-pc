import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { nexGridBrandText, platformAssetText} from "../lib/admin/brand-copy.ts";
import { ALL_L2, resolveVisibleDomains } from "../lib/nav/console-nav.ts";
import { formToSku, skuToForm } from "../app/components/domain-views/e-tabs/data.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const expression = (path, name) => {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) result = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(result, name);
  return ts.transpileModule(`module.exports = ${result}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
};

test("platform token display changes units while preserving platform/product brands and unrelated assets", () => {
  assert.equal(nexGridBrandText("NEX / nex / 1 NEX"), "UVT / UVT / 1 UVT");
  assert.equal(nexGridBrandText("UVEL · NexGridBox S1 · USDT · BNB · BSC"), "UVEL · UVELBox S1 · USDT · BNB · BSC");
  for (const raw of ["UVT", "nex", "UVEL", "UVT"]) assert.equal(platformAssetText(raw), "UVT");
  for (const raw of ["USDT", "BNB", "BSC", "UVELBox S1", "NEX_MARKET", "My UVEL reward"]) assert.equal(platformAssetText(raw), raw);
  assert.equal(({ kind: "TEXT", text: "100 UVEL · My NEX story" }).text, "100 UVEL · My NEX story");
});

test("legacy server navigation labels resolve to UVT while custom menus and grants remain intact", () => {
  for (const [id, domain, oldNames, expected] of [
    ["G3", "G", ["NEX 行情引擎", "NEX 价格管理", "UVEL价格管理"], "UVT价格管理"],
    ["H5", "H", ["签到 & NEX", "签到与UVEL奖励"], "签到与UVT奖励"],
  ]) {
    for (const old of [...oldNames, "自定义菜单"]) {
      const menus = [{ menuCode: domain, menuName: "" }, { menuCode: id, menuName: old, parentCode: domain, routePath: ALL_L2.find(item => item.id === id).path }];
      const resolved = resolveVisibleDomains({ role: "superadmin", menuCodes: [id], menuNodes: menus });
      assert.equal(resolved.flatMap(d => d.l2).find(item => item.id === id)?.name, old === "自定义菜单" ? old : expected);
    }
  }
  assert.deepEqual(resolveVisibleDomains({ role: "superadmin", menuCodes: [] }), []);
});

test("F1 historical payout assets and H8 adjustment units display UVT without changing stored symbols", () => {
  const module = { exports: undefined };
  new Function("module", "platformAssetText", "safeCustomLabel", expression("app/components/domain-views/f-tabs/f1-vrank.tsx", "rewardPayoutLabel"))(module, platformAssetText, value => value);
  for (const rewardType of ["UVT", "UVEL", "UVT", "USDT"]) {
    const row = Object.freeze({ rewardType, amount: 100 });
    assert.equal(module.exports(row), `100 ${rewardType === "USDT" ? "USDT" : "UVT"}`);
    assert.equal(row.rewardType, rewardType);
  }
  assert.equal(module.exports({ rewardType: "CUSTOM", customLabel: "UVEL 品牌礼物" }), "UVEL 品牌礼物");
  new Function("module", expression("app/components/domain-views/h-tabs/h8-referral-rewards.tsx", "PARAMS"))(module);
  const tokenParams = module.exports.filter(row => row.key.endsWith(".nex"));
  assert.deepEqual(tokenParams.map(row => row.label), ["新人 UVT", "邀请人 UVT"]);
  assert.deepEqual(tokenParams.map(row => nexGridBrandText(row.unit)), ["UVT", "UVT"]);
  assert.deepEqual(tokenParams.map(row => row.unit), ["UVT", "UVT"]);
});

test("E1 keeps serialized legacy baseRate unchanged during an unrelated edit", () => {
  const sku = { id: "stellarbox-pro-v2", name: "UVELBox Pro v2", tier: "Entry", price: 1499, dailyEarn: 1, dailyEarnNEX: 2, baseRate: "1 USDT / 2 NEX", inventoryMode: "FINITE", stock: 1, unlock: "", tag: "", status: "ACTIVE" };
  const result = formToSku({ ...skuToForm(sku), name: "UVELBox Pro v2 新版" }, sku);
  assert.equal(result.baseRate, sku.baseRate);
  assert.equal(result.dailyEarnNEX, 2);
  assert.equal(result.name, "UVELBox Pro v2 新版");
});
