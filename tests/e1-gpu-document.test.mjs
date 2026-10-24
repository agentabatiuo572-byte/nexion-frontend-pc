import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_SKU_FORM, skuToForm, formToSku, validateSkuSpecs } from '../app/components/domain-views/e-tabs/data.ts';
import { summarizeSkuProposal } from '../lib/admin/e1-a2-proposal-summary.ts';

test('GPU quantity round trips existing specifications without multiplying twice', () => {
  for (const gpu of ['4× RTX 4090', '4*4090', '8x RTX 4090']) {
    const form = skuToForm({ ...formToSku(EMPTY_SKU_FORM), gpu });
    assert.equal(validateSkuSpecs(form), null);
    const saved = formToSku(form);
    assert.equal(skuToForm(saved).gpuCount, form.gpuCount);
    assert.equal(skuToForm(saved).gpu, form.gpu);
  }
  const form = skuToForm({ ...formToSku(EMPTY_SKU_FORM), gpu: 'RTX 4090' });
  assert.equal(form.gpuCount, '');
  assert.equal(formToSku(form).gpu, 'RTX 4090');
  assert.equal(formToSku({ ...form, gpuCount: '4' }).gpu, '4× RTX 4090');
  for (const gpuCount of ['0', '-1', '1.5', '1025', '2e1']) assert.ok(validateSkuSpecs({ ...form, gpuCount }));
});

test('SKU documents survive editing and appear in approval summaries; unsafe or incomplete links fail', () => {
  const form = { ...EMPTY_SKU_FORM, gpu: 'RTX 4090', gpuCount: '4', specDocumentTitle: 'NVIDIA GeForce RTX 4090', specDocumentUrl: 'https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/' };
  assert.equal(validateSkuSpecs(form), null);
  const saved = formToSku(form);
  assert.equal(skuToForm(saved).specDocumentUrl, form.specDocumentUrl);
  assert.ok(summarizeSkuProposal(formToSku(EMPTY_SKU_FORM), saved).changedFields.includes('资料链接'));
  for (const specDocumentUrl of ['', 'javascript:alert(1)', 'http://example.com', 'https://user:secret@example.com']) assert.ok(validateSkuSpecs({ ...form, specDocumentUrl }));
  assert.equal(validateSkuSpecs({ ...form, specDocumentTitle: '', specDocumentUrl: '' }), null);
});
