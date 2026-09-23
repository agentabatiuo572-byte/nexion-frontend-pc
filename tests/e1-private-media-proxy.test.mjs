import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

let sawAuthorization = false;
let storagePort;
let backendPort;
const backend = createServer((req, res) => {
  sawAuthorization ||= req.headers.authorization === 'Bearer test-token';
  const assetId = req.url?.split('/')[5] || 'asset';
  res.setHeader('Content-Type', 'application/json');
  if (req.url?.startsWith('/api/admin/devices/skus')) {
    res.end(JSON.stringify({ code: 0, data: { rows: [{ imageAssetId: 'asset', imagePreviewUrl: 'http://127.0.0.1:9000/private' }] } }));
    return;
  }
  res.end(JSON.stringify({ code: 0, data: {
    assetId,
    objectKey: assetId === 'other' ? 'admin/f/receipt/test.png' : 'admin/e/sku-image/test.png',
    previewUrl: assetId === 'evil'
      ? 'http://example.com/file.png'
      : `http://127.0.0.1:${storagePort}/nexion/admin/e/sku-image/test.png?X-Amz-Signature=test`,
  } }));
}).listen(0, '127.0.0.1');
await new Promise(resolve => backend.once('listening', resolve));
backendPort = backend.address().port;
const storage = createServer((req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Accept-Ranges', 'bytes');
  if (req.headers.range === 'bytes=0-3') {
    res.writeHead(206, { 'Content-Range': 'bytes 0-3/8', 'Content-Length': '4' });
    res.end('fake');
  } else {
    res.writeHead(200, { 'Content-Length': '8' });
    res.end('fake-png');
  }
}).listen(0, '127.0.0.1');
await new Promise(resolve => storage.once('listening', resolve));
storagePort = storage.address().port;
const portLease = createServer().listen(0, '127.0.0.1');
await new Promise(resolve => portLease.once('listening', resolve));
const nextPort = portLease.address().port;
await new Promise(resolve => portLease.close(resolve));
const base = `http://127.0.0.1:${nextPort}/api/admin/media/uploads/`;
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', String(nextPort)], {
  cwd: process.cwd(),
  env: { ...process.env, NEXION_BACKEND_URL: `http://127.0.0.1:${backendPort}`, NEXION_MEDIA_INTERNAL_ORIGIN: `http://127.0.0.1:${storagePort}` },
  stdio: 'ignore',
});

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { await fetch(base + 'asset/content'); ready = true; break; }
    catch { await delay(500); }
  }
  assert(ready, 'Next dev did not start');
  const unauth = await fetch(base + 'asset/content');
  assert.equal(unauth.status, 401);
  const headers = { Cookie: 'nexion_admin_token=test-token' };
  const preview = await fetch(base + 'asset/preview-url', { headers });
  const previewText = await preview.text();
  assert.equal(preview.status, 200);
  assert.equal(JSON.parse(previewText).data.previewUrl, '/api/admin/media/uploads/asset/content');
  assert(!previewText.includes('127.0.0.1'), 'private signed URL leaked to browser');
  const upload = await fetch(base.slice(0, -1), { method: 'POST', headers, body: 'test' });
  const uploadText = await upload.text();
  assert.equal(upload.status, 200);
  assert.equal(JSON.parse(uploadText).data.previewUrl, '/api/admin/media/uploads/asset/content');
  assert(!uploadText.includes('127.0.0.1'), 'upload leaked private signed URL to browser');
  const image = await fetch(base + 'asset/content', { headers });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(await image.text(), 'fake-png');
  const range = await fetch(base + 'asset/content', { headers: { ...headers, Range: 'bytes=0-3' } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-3/8');
  assert.equal(await range.text(), 'fake');
  const evil = await fetch(base + 'evil/content', { headers });
  assert.equal(evil.status, 502);
  const other = await fetch(base + 'other/content', { headers });
  assert.equal(other.status, 403);
  const sku = await fetch(`http://127.0.0.1:${nextPort}/api/admin/e1/skus`, { headers });
  const skuText = await sku.text();
  assert.equal(sku.status, 200);
  assert.equal(JSON.parse(skuText).data.rows[0].imagePreviewUrl, null);
  assert(!skuText.includes('127.0.0.1'), 'persisted SKU preview URL leaked to browser');
  const post = await fetch(base + 'asset/content', { method: 'POST', headers });
  assert.equal(post.status, 405);
  assert(sawAuthorization, 'admin token was not forwarded to backend');
  console.log('PASS unauthorized, sanitized metadata and SKU, image, range, scope, untrusted origin, method, backend auth');
} finally {
  next.kill();
  backend.close();
  storage.close();
}
