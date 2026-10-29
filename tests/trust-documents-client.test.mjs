import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import test from 'node:test';

register('./e5-client-test-loader.mjs', import.meta.url);
const {
  normalizeTrustDocument, restoreTrustDocument, trustDocumentPreviewHref, uploadTrustDocument, TRUST_DOCUMENT_NAMES,
} = await import('../lib/admin/trust-documents-client.ts');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const row = { slot: 'whitepaper', source: 'DEFAULT', version: 'v1.3', language: 'English', referenceNo: null, verifyUrl: null,
  fileName: 'uvel-whitepaper-v1.3-en.pdf', sizeBytes: 524389, pageCount: 21, sha256: 'a'.repeat(64), fileUrl: '/x', updatedBy: null, updatedAt: null };

test('documents keep only the published fields and reject unknown slots or sources', () => {
  assert.deepEqual(normalizeTrustDocument(row), { slot: 'whitepaper', source: 'DEFAULT', version: 'v1.3', language: 'English',
    referenceNo: null, verifyUrl: null, fileName: 'uvel-whitepaper-v1.3-en.pdf', sizeBytes: 524389, pageCount: 21, sha256: 'a'.repeat(64),
    updatedBy: null, updatedAt: null });
  assert.throws(() => normalizeTrustDocument({ ...row, slot: 'passport' }), /TRUST_DOCUMENT_RESPONSE_INVALID/);
  assert.throws(() => normalizeTrustDocument({ ...row, source: 'DRAFT' }), /TRUST_DOCUMENT_RESPONSE_INVALID/);
  assert.equal(trustDocumentPreviewHref(row), '/api/admin/content/trust-documents/whitepaper/file?v=aaaaaaaaaaaa');
  assert.deepEqual(Object.keys(TRUST_DOCUMENT_NAMES), ['whitepaper', 'incorporation', 'msb', 'ein']);
});

test('upload and restore send the hash the operator saw with a fresh idempotency key', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ code: 0, data: { ...row, source: 'UPLOADED', version: 'v1.4' } }), { status: 200 });
  });
  const current = normalizeTrustDocument(row);
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'paper.pdf', { type: 'application/pdf' });
  const uploaded = await uploadTrustDocument(current, file, { version: ' v1.4 ', language: '', referenceNo: '', verifyUrl: '', reason: 'publish v1.4 paper' });
  await restoreTrustDocument({ ...current, source: 'UPLOADED' }, ' back to default ');

  assert.equal(uploaded.version, 'v1.4');
  assert.equal(calls[0].url, '/api/admin/content/trust-documents/whitepaper');
  const form = calls[0].init.body;
  assert.equal(form.get('version'), 'v1.4');
  assert.equal(form.get('expectedSha256'), 'a'.repeat(64));
  assert.equal(form.has('language'), false);
  assert.equal(form.get('file').name, 'paper.pdf');
  assert.equal(calls[1].url, '/api/admin/content/trust-documents/whitepaper/restore-default');
  assert.deepEqual(JSON.parse(calls[1].init.body), { reason: 'back to default', expectedSha256: 'a'.repeat(64) });
  const keys = calls.map((call) => new Headers(call.init.headers).get('Idempotency-Key'));
  assert.ok(keys.every(Boolean));
  assert.notEqual(keys[0], keys[1]);
});

test('the content proxy forwards uploads and PDF previews as binary, and I4 shows the card', () => {
  const proxy = read('app/api/admin/content/[...path]/route.ts');
  const card = read('app/components/domain-views/trust-documents-card.tsx');
  const trust = read('app/components/domain-views/i-tabs/i4-trust.tsx');
  assert.match(proxy, /"trust-documents"/);
  assert.match(proxy, /path\.length === 2 && path\[0\] === "trust-documents"\)/);
  assert.match(proxy, /documentContent = request\.method === "GET" && path\.length === 3 && path\[0\] === "trust-documents" && path\[2\] === "file"/);
  assert.match(proxy, /!== "application\/pdf"\) return jsonError\(502, "TRUST_DOCUMENT_TYPE_INVALID"\)/);
  assert.match(card, /content_i4_publish_standard/);
  assert.match(card, /content_i4_trust_section_manage/);
  assert.match(card, /操作原因至少 8 个字/);
  assert.match(trust, /view === "trust" && <TrustDocumentsCard \/>/);
});
