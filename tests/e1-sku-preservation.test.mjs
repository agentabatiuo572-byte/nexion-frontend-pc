import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { skuToForm, formToSku } from '../app/components/domain-views/e-tabs/data.ts';
import { fromPurchaseGate, toPurchaseGate } from '../lib/admin/e1-purchase-gate.ts';
import { findHighOp } from '../lib/admin/high-ops-registry.ts';

// Execute the real client mapping without its HTTP/media dependencies.
const source = readFileSync(new URL('../lib/admin/e1-client.ts', import.meta.url), 'utf8');
const ast = ts.createSourceFile('client.ts', source, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n)
  && ['toNumber', 'toOptionalNumber', 'fromSku', 'toSkuPayload'].includes(n.name?.text));
const js = ts.transpileModule(functions.map(n => n.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const { fromSku, toSkuPayload } = new Function('fromPurchaseGate', 'toPurchaseGate',
  js + ';return {fromSku,toSkuPayload};')(fromPurchaseGate, toPurchaseGate);
const base = { skuId: 'stellarbox-pro', name: 'StellarBox Pro', tier: 'Pro', price: 2999,
  dailyEarn: 4, dailyEarnNex: 10, stock: '292', sold: 187, inventoryMode: 'FINITE',
  productType: 'DEVICE', trialEligible: false, lifecycle: 'active', status: 'on',
  unlockPhase: 'seed', updatedAt: '2026-10-25T10:15:20.123456',
  imageAssetId: 'asset', imageObjectKey: 'key', imagePreviewUrl: 'https://preview/temporary',
};
const hiddenKeys = ['rating', 'reviews', 'generation', 'supersededBy', 'tradeinDiscount'];
for (const hidden of [
  { rating: 4.7, reviews: 91, generation: 3, supersededBy: 'pro-next', tradeinDiscount: 0.15 },
  { rating: 0, reviews: 0, generation: 1, supersededBy: '', tradeinDiscount: 0 },
]) test('stock edit preserves server metadata through catalog, form and A2 ' + hidden.generation, () => {
  const sku = fromSku({ ...base, ...hidden });
  const form = skuToForm(sku);
  form.stock = '291';
  const edited = formToSku(form, sku);
  const params = findHighOp('e1_sku_update').buildCommand({ skuId: sku.id, ...edited }).params;
  for (const key of hiddenKeys) assert.equal(params[key], hidden[key], key);
  assert.equal(params.stock, 291);
  assert.equal(params.expectedUpdatedAt, base.updatedAt);
  assert.equal(Object.hasOwn(params, 'sold'), false);
  assert.equal(Object.hasOwn(params, 'imagePreviewUrl'), false);
  assert.equal(sku.sold, 187);
  assert.equal(sku.stock, '292');
  assert.equal(Object.hasOwn(form, 'rating'), false);
  assert.equal(Object.hasOwn(form, 'generation'), false);
});

test('direct SKU payload also preserves hidden values without writing order sales', () => {
  const hidden = { rating: 4.6, reviews: 33, generation: 2, supersededBy: 'next', tradeinDiscount: 0.2 };
  const payload = toSkuPayload(fromSku({ ...base, ...hidden }), '库存恢复', 'operator');
  for (const key of hiddenKeys) assert.equal(payload[key], hidden[key], key);
  assert.equal(Object.hasOwn(payload, 'sold'), false);
  assert.equal(payload.imagePreviewUrl, null);
});

test('new SKU keeps the existing internal generation default and absent metadata stays empty', () => {
  const sku = fromSku(base);
  const params = findHighOp('e1_sku_create').buildCommand({ skuId: sku.id, ...formToSku(skuToForm(sku)) }).params;
  assert.equal(params.generation, 1);
  for (const key of hiddenKeys.filter(k => k !== 'generation')) assert.equal(params[key], undefined);
  assert.equal(Object.hasOwn(params, 'sold'), false);
});
