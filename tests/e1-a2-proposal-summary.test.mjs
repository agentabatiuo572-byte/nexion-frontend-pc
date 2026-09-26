import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { summarizeSkuCreation, summarizeSkuProposal } from "../lib/admin/e1-a2-proposal-summary.ts";
import { fromPurchaseGate, toPurchaseGate } from "../lib/admin/e1-purchase-gate.ts";
import { formToSku, skuToForm, validateGateForm } from "../app/components/domain-views/e-tabs/data.ts";

function sku(overrides = {}) {
  return {
    id: "stellarbox-s1",
    name: "NexGridBox S1",
    price: 1299,
    dailyEarn: 0.06,
    dailyEarnNEX: 0,
    inventoryMode: "FINITE",
    stock: 0,
    trialEligible: true,
    unlock: "",
    tag: "",
    status: "ACTIVE",
    ...overrides,
  };
}

test("E1 库存提案在 A2 显示字段名和真实前后值", () => {
  const summary = summarizeSkuProposal(sku(), sku({ stock: 10000 }));

  assert.deepEqual(summary, {
    before: "库存：0",
    after: "库存：10,000",
    changedFields: ["库存"],
    omittedFields: [],
  });
});

test("多字段变更只展示变化项，并优先保留库存", () => {
  const summary = summarizeSkuProposal(
    sku(),
    sku({ stock: 10000, price: 1399, trialEligible: false }),
  );

  assert.equal(summary.before, "库存：0；价格：$1,299；允许试用：是");
  assert.equal(summary.after, "库存：10,000；价格：$1,399；允许试用：否");
  assert.deepEqual(summary.changedFields, ["库存", "价格", "允许试用"]);
  assert.deepEqual(summary.omittedFields, []);
});

test("未变化时不生成误导性提案摘要", () => {
  assert.equal(summarizeSkuProposal(sku(), sku()), null);
});

test("A2 存储值始终限制在 128 字符内", () => {
  const before = sku({
    stock: 1,
    name: "旧商品名称".repeat(20),
    tagline: "旧卖点".repeat(20),
    datacenter: "旧数据中心".repeat(20),
  });
  const after = sku({
    stock: 2,
    name: "新商品名称".repeat(20),
    tagline: "新卖点".repeat(20),
    datacenter: "新数据中心".repeat(20),
  });
  const summary = summarizeSkuProposal(before, after);

  assert.ok(summary);
  assert.ok(summary.before.length <= 128, summary.before);
  assert.ok(summary.after.length <= 128, summary.after);
  assert.match(summary.after, /^库存：2/);
  assert.ok(summary.omittedFields.length > 0);
});

test("有限库存切换为无限库存时显示业务语义而非漏填", () => {
  const summary = summarizeSkuProposal(
    sku({ tier: "Share", productType: "SHARE", stock: 47 }),
    sku({ tier: "Share", productType: "SHARE", stock: undefined, inventoryMode: "UNLIMITED" }),
  );

  assert.ok(summary);
  assert.match(summary.before, /库存：47/);
  assert.match(summary.after, /库存：∞（不适用）/);
  assert.match(summary.before, /库存模式：有限库存/);
  assert.match(summary.after, /库存模式：无限库存/);
});

test("AI-only 变更不能被当成 no-op", () => {
  const summary = summarizeSkuProposal(
    sku({ aiImageGenPerMin: 1 }),
    sku({ aiImageGenPerMin: 999999 }),
  );

  assert.ok(summary);
  assert.equal(summary.before, "图像生成性能：1");
  assert.equal(summary.after, "图像生成性能：999,999");
  assert.deepEqual(summary.omittedFields, []);
});

test("库存变更不能夹带未显示的 AI 配额变更", () => {
  const summary = summarizeSkuProposal(
    sku({ aiLlmTokensPerSec: 50, aiVideoMinPerHour: 18, aiFineTuneMins: 6, aiUnlocks: "TK-1" }),
    sku({ stock: 10000, aiLlmTokensPerSec: 500, aiVideoMinPerHour: 180, aiFineTuneMins: 60, aiUnlocks: "TK-9" }),
  );

  assert.ok(summary);
  assert.deepEqual(summary.changedFields, ["库存", "LLM 推理性能", "视频渲染性能", "LoRA 微调性能", "解锁算力池"]);
  assert.equal(summary.omittedFields.length, 0);
  assert.match(summary.after, /库存：10,000/);
  assert.match(summary.after, /LLM 推理性能：500/);
  assert.match(summary.after, /解锁算力池：TK-9/);
});

test("替换产品图以完整对象键展示前后资产，不占用两份 A2 容量", () => {
  const oldKey = "admin/e/sku-image/20260925/6315ec9b-61fc-4e1c-9fb9-0a9aba089835.png";
  const newKey = "admin/e/sku-image/20260926/1315ec9b-61fc-4e1c-9fb9-0a9aba089835.png";
  const before = sku({ imageAssetId: Buffer.from(oldKey).toString("base64url"), imageObjectKey: oldKey });
  const after = sku({ imageAssetId: Buffer.from(newKey).toString("base64url"), imageObjectKey: newKey });
  const summary = summarizeSkuProposal(before, after);

  assert.deepEqual(summary, {
    before: `产品图对象键：${oldKey}`,
    after: `产品图对象键：${newKey}`,
    changedFields: ["产品图对象键"],
    omittedFields: [],
  });
  assert.ok(summary.before.length <= 128 && summary.after.length <= 128);
});

test("不匹配的产品图标识不能靠对象键压缩后混入 A2", () => {
  const objectKey = "admin/e/sku-image/20260926/1315ec9b-61fc-4e1c-9fb9-0a9aba089835.png";
  const summary = summarizeSkuProposal(
    sku({ imageAssetId: Buffer.from(objectKey).toString("base64url"), imageObjectKey: objectKey }),
    sku({ imageAssetId: "x".repeat(129), imageObjectKey: objectKey }),
  );

  assert.deepEqual(summary.changedFields, ["产品图对象键"]);
  assert.deepEqual(summary.omittedFields, ["产品图对象键"]);
});

test("Pro v2 无锁额等级门往返不制造购买限制变更，换图只审图片", () => {
  const oldKey = "admin/e/sku-image/20260925/6315ec9b-61fc-4e1c-9fb9-0a9aba089835.png";
  const newKey = "admin/e/sku-image/20260926/1315ec9b-61fc-4e1c-9fb9-0a9aba089835.png";
  const existing = sku({
    id: "stellarbox-pro-v2",
    name: "UVELBox Pro v2",
    productType: "DEVICE",
    baseRate: "$0.06/d · 0 NEX",
    unlock: "P3",
    purchaseGate: fromPurchaseGate({ rankMin: 2, mode: "all", quotaCap: null, quotaPeriod: null, enforce: true }),
    imageAssetId: Buffer.from(oldKey).toString("base64url"),
    imageObjectKey: oldKey,
  });
  const roundTripped = {
    ...formToSku(skuToForm(existing), existing),
    imageAssetId: existing.imageAssetId,
    imageObjectKey: existing.imageObjectKey,
  };
  assert.deepEqual(roundTripped.purchaseGate, existing.purchaseGate);
  assert.equal(toPurchaseGate(roundTripped.purchaseGate).quotaPeriod, null);
  assert.equal(summarizeSkuProposal(existing, roundTripped), null);

  const imageOnly = { ...roundTripped, imageAssetId: Buffer.from(newKey).toString("base64url"), imageObjectKey: newKey };
  const summary = summarizeSkuProposal(existing, imageOnly);
  assert.deepEqual(summary.changedFields, ["产品图对象键"]);
  assert.deepEqual(summary.omittedFields, []);
});

test("锁额周期仍为 lifetime，历史 month 仍在编辑器中可识别", () => {
  assert.equal(fromPurchaseGate({ rankMin: 2, quotaCap: 50, quotaSold: 3 }).quotaPeriod, "lifetime");
  const legacy = fromPurchaseGate({ rankMin: 2, quotaPeriod: "month" });
  assert.equal(legacy.quotaPeriod, "month");
  assert.match(validateGateForm(skuToForm(sku({ unlock: "P3", purchaseGate: legacy }))), /历史按月周期暂不可用/);
});

test("缺少历史 baseRate 的 SKU 原样回填不制造 no-op 提案", () => {
  const existing = sku({ tier: "Entry", productType: "SERVER", baseRate: undefined });
  const roundTripped = formToSku(skuToForm(existing), existing);

  assert.equal(roundTripped.baseRate, undefined);
  assert.equal(summarizeSkuProposal(existing, roundTripped), null);
});

test("E1 把累计销量视为订单运行态计数，编辑往返不得提交或提案修改它", () => {
  const existing = sku({
    sold: 1245, stock: 3, tier: "Entry", productType: "DEVICE",
    baseRate: "$0.06/d · 0 NEX",
  });
  const roundTripped = formToSku(skuToForm(existing), existing);
  const e1Source = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");

  assert.equal(Object.hasOwn(skuToForm(existing), "sold"), false);
  assert.equal(roundTripped.sold, 1245);
  assert.equal(summarizeSkuProposal(existing, roundTripped), null);
  assert.doesNotMatch(e1Source, /SkuFld label="累计销量"/);
  assert.match(e1Source, /累计销量由成功支付订单累计/);
});

test("新建 SKU 展示核心业务字段而非只有商品名称", () => {
  const summary = summarizeSkuCreation(sku({ tier: "Entry", productType: "SERVER", stock: 10000 }));

  assert.ok(summary);
  assert.match(summary.before, /库存：未设置/);
  assert.match(summary.after, /库存：10,000/);
  assert.match(summary.after, /价格：\$1,299/);
  assert.match(summary.after, /商品名称：NexGridBox S1/);
  assert.deepEqual(summary.omittedFields, []);
});

test("E1 提交链路使用字段级摘要，A2 明示变更前后", () => {
  const e1Source = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
  const a2Source = readFileSync(new URL("../app/components/domain-views/a-tabs/a2-audit.tsx", import.meta.url), "utf8");

  assert.match(e1Source, /summarizeSkuProposal\(ex, sku\)/);
  assert.match(e1Source, /summarizeSkuCreation\(sku\)/);
  assert.match(e1Source, /summary\?\.omittedFields\.length/);
  assert.match(e1Source, /previewSummary\?\.omittedFields\.length[\s\S]*?openActionConfirm\([\s\S]*?setSkuDrawer\(false\)/);
  assert.doesNotMatch(e1Source, /before:\s*editSkuId\s*\?\s*["']编辑前 SKU["']/);
  assert.doesNotMatch(e1Source, /JSON\.stringify\(form\)\s*!==\s*JSON\.stringify\(skuToForm/);
  assert.match(e1Source, /disabled=\{Boolean\(editSkuId\)\}/);
  assert.match(e1Source, /if \(!sku\.imageAssetId \|\| !sku\.imageObjectKey\) return null/);
  assert.match(e1Source, /src: sku\.imagePreviewUrl \?\? ""/);
  assert.doesNotMatch(e1Source, /if \(!sku\.imagePreviewUrl \|\| !sku\.imageAssetId/);
  assert.match(a2Source, /<th>变更内容<\/th>/);
  assert.match(a2Source, />变更前<\/span><span className="o">/);
  assert.match(a2Source, />变更后<\/span><span className="n">/);
});
