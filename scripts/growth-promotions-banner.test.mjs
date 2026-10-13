import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, imports) {
  const code = ts.transpileModule(readFileSync(new URL('../' + file, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(imports, module.exports, module);
  return module.exports;
}
function stateHooks() {
  const states = []; let index = 0;
  return {
    reset() { index = 0; },
    useState(initial) { const key = index++; if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial; return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }]; },
    useRef(initial) { const key = index++; return states[key] ??= { current: initial }; },
    useEffect(fn, deps) { const key = index++, previous = states[key]; if (!previous || !deps || deps.some((dep, i) => !Object.is(dep, previous[i]))) { states[key] = deps; fn(); } },
  };
}
function nodes(tree) {
  const result = [];
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); walk(node.props?.children); };
  walk(tree); return result;
}
const text = node => Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : String(node ?? '');
const settle = () => new Promise(resolve => setImmediate(resolve));
function uploader(upload, field = {}) {
  const hooks = stateHooks(); let value = { bannerAssetId: 'original' }; const calls = [], changes = [], states = [];
  const { BusinessFormBlock } = load('app/components/domain-views/design-kit.tsx', name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('media-client')) return { uploadAdminMedia: (file, options) => { calls.push({ file, options }); return upload(file); } };
    if (name.endsWith('error-messages')) return { displayAdminError: () => '图片上传未完成，请重试。' };
    return {};
  });
  const props = { spec: { kind: 'multi-field', fields: [{ key: 'bannerAssetId', label: '宣传图', inputKind: 'asset-upload', required: false, uploadDomain: 'growth', uploadUsage: 'promotion-banner', accept: 'image/jpeg,image/png', ...field }] }, onChange: next => { value = next; changes.push(next.bannerAssetId); }, onUploadStateChange: (_, state) => states.push(state) };
  const render = () => { hooks.reset(); return nodes(BusinessFormBlock({ ...props, value })); };
  const choose = file => render().find(node => node.type === 'input').props.onChange({ target: { files: file ? [file] : [], value: file?.name || '' } });
  return { render, choose, calls, changes, states, value: () => value.bannerAssetId };
}
test('shared image upload names identify the field separately from help and removal', () => {
  for (const field of [{ label: '上传宣传图', required: false }, { label: '替换宣传图', required: false }, { label: '关联证据图片', required: true }, { label: '银行回单图片', required: true }, { label: '银行回单图片（选填）', required: false }]) {
    const form = uploader(() => assert.fail('naming check must not upload'), { ...field, help: 'JPEG 或 PNG，最大 10 MB。' });
    const rendered = form.render(), input = rendered.find(node => node.type === 'input' && node.props.type === 'file');
    assert.equal(input.props['aria-label'], field.label);
    assert.equal(input.props['aria-required'], field.required);
    assert(rendered.some(node => node.type === 'button' && text(node) === (field.required ? '清除图片并重新上传' : '移除图片')));
    assert(rendered.some(node => node.type === 'span' && text(node) === 'JPEG 或 PNG，最大 10 MB。'));
  }
});

test('failed image replacement keeps the original; the same file can retry and explicit removal clears', async () => {
  let succeed = false;
  const form = uploader(() => succeed ? Promise.resolve({ assetId: 'replacement' }) : Promise.reject(Error('MEDIA_STORAGE_UNAVAILABLE')));
  const file = { name: 'banner.png', type: 'image/png', size: 20 };
  form.choose(file); assert.equal(form.value(), 'original'); assert.equal(form.states.at(-1), 'uploading');
  await settle(); assert.equal(form.value(), 'original'); assert.deepEqual(form.changes, []); assert.equal(form.states.at(-1), 'failed');
  assert(form.render().some(node => node.props?.role === 'alert' && text(node).includes('图片上传未完成')));
  succeed = true; form.choose(file); await settle(); assert.equal(form.value(), 'replacement'); assert.equal(form.states.at(-1), undefined);
  assert.deepEqual(form.calls[1].options, { domain: 'growth', usage: 'promotion-banner', entityType: 'MEDIA_ASSET', operator: undefined });
  form.render().find(node => node.type === 'button' && text(node) === '移除图片').props.onClick({ preventDefault() {} });
  assert.equal(form.value(), '');
});
test('cancel, unsupported type and oversized images retain the saved reference without uploading', () => {
  const form = uploader(() => assert.fail('invalid input reached upload'));
  form.choose(null);
  for (const file of [{ name: 'banner.gif', type: 'image/gif', size: 20 }, { name: 'banner.webp', type: 'image/webp', size: 20 }, { name: 'banner.png', type: 'image/png', size: 10 * 1024 * 1024 + 1 }]) form.choose(file);
  assert.equal(form.value(), 'original'); assert.equal(form.calls.length, 0); assert.equal(form.states.at(-1), 'failed');
});
test('read-only saved banners reload via the existing preview route, stale responses stay hidden, removal maps to null', async () => {
  const hooks = stateHooks(), calls = [], changes = [], states = []; let reading = { data: { assetId: 'saved', previewUrl: '/api/admin/media/uploads/saved/content' }, loading: false, error: null };
  const BusinessFormBlock = () => null, Button = () => null, ReadError = () => null;
  const { PromotionBanner, PromotionBannerPreview } = load('app/components/domain-views/h-tabs/h4-promotion-banner.tsx', name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('design-kit')) return { BusinessFormBlock };
    if (name.endsWith('media-client')) return { refreshAdminMediaPreviewUrl: async assetId => { calls.push(assetId); return reading.data; } };
    if (name.endsWith('h4-promotion-ui')) return { Button, ReadError, useRead: (loader, deps) => { calls.push({ loader, deps }); return { ...reading, reload: () => calls.push('retry') }; } };
    assert.fail(name);
  });
  let props = { assetId: 'saved', readOnly: true, onChange: id => changes.push(id), onUploading: busy => states.push(busy) };
  const render = () => { hooks.reset(); return [...nodes(PromotionBanner(props)), ...nodes(PromotionBannerPreview({ assetId: props.assetId }))]; };
  const current = render(); assert(current.some(node => node.type === 'fieldset' && node.props.disabled)); assert.equal(current.find(node => node.type === 'img').props.src, '/api/admin/media/uploads/saved/content');
  assert.equal(current.find(node => node.type === BusinessFormBlock).props.spec.fields[0].accept, 'image/jpeg,image/png');
  await calls[0].loader(); assert(calls.includes('saved'));
  current.find(node => node.type === BusinessFormBlock).props.onChange({ bannerAssetId: 'unexpected' }); assert.deepEqual(changes, []);
  props = { ...props, readOnly: false, assetId: 'new' }; assert(!render().some(node => node.type === 'img'));
  const input = render().find(node => node.type === BusinessFormBlock); input.props.onChange({ bannerAssetId: '' }); assert.deepEqual(changes, [null]);
  input.props.onUploadStateChange('bannerAssetId', 'uploading'); input.props.onUploadStateChange('bannerAssetId', 'failed'); assert.deepEqual(states, [true, false]);
  reading = { ...reading, error: Error('preview failed') }; const error = render().find(node => node.type === ReadError); assert(error); error.props.retry(); assert(calls.includes('retry'));
});
test('activity detail exposes both saved version images to readers and the review keeps the candidate image', () => {
  const hooks = stateHooks(), PromotionBannerPreview = () => null, widgets = new Map();
  const current = { version: 2, state: 'DRAFT', draft: { bannerAssetId: 'candidate-image' }, policyResolutionErrors: [] };
  const published = { version: 1, state: 'PUBLISHED', draft: { bannerAssetId: 'published-image' } };
  const ui = new Proxy({ useRead: () => ({ data: { items: [published, current] }, loading: false }), limitText: () => '', formatTime: () => '', labelState: () => '', rewardText: () => '' }, { get: (obj, key) => { if (key in obj) return obj[key]; if (!widgets.has(key)) widgets.set(key, () => null); return widgets.get(key); } });
  const Review = load('app/components/domain-views/h-tabs/h4-promotion-review.tsx', name => {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('h4-promotion-banner')) return { PromotionBannerPreview };
    if (name.endsWith('h4-promotion-ui') || name.endsWith('promotion-form')) return ui;
    if (name.endsWith('promotion-client')) return {};
    assert.fail(name);
  }).default;
  const props = { activity: { activityId: 'A1', current, activeVersion: 1, draftVersion: 2, impact: {} }, catalog: { ranks: [] }, can: () => false };
  const images = review => { hooks.reset(); return nodes(Review({ ...props, review })).filter(node => node.type === PromotionBannerPreview).map(node => node.props.assetId); };
  assert.deepEqual(images(false), ['published-image', 'candidate-image']); assert.deepEqual(images(true), ['candidate-image']);
});
test('Admin content proxy permits only managed promotion images, keeps E1 scope and rejects evidence, arbitrary origins and video', async () => {
  const previousOrigin = process.env.NEXION_MEDIA_INTERNAL_ORIGIN;
  process.env.NEXION_MEDIA_INTERNAL_ORIGIN = 'http://127.0.0.1:9000';
  const route = load('app/api/admin/media/[...path]/route.ts', name => name === 'next/headers' ? { cookies: async () => ({ get: () => ({ value: 'token' }) }) } : { ADMIN_TOKEN_COOKIE: 'token', requirePasswordChangeCleared: () => null });
  if (previousOrigin === undefined) delete process.env.NEXION_MEDIA_INTERNAL_ORIGIN; else process.env.NEXION_MEDIA_INTERNAL_ORIGIN = previousOrigin;
  const key = 'admin/growth/promotion-banner/20261011/12345678-1234-4123-8123-123456789abc.png';
  const previousFetch = globalThis.fetch;
  try {
    for (const [objectKey, contentType, origin, expected] of [[key, 'image/png', 'http://127.0.0.1:9000', 200], ['admin/e/sku-image/test.png', 'image/png', 'http://127.0.0.1:9000', 200], ['admin/growth/promotion-evidence/20261011/test.png', 'image/png', 'http://127.0.0.1:9000', 403], [key.replace('.png', '.gif'), 'image/gif', 'http://127.0.0.1:9000', 403], [key, 'video/mp4', 'http://127.0.0.1:9000', 502], [key, 'image/png', 'https://example.com', 502]]) {
      const calls = [];
      globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return calls.length === 1 ? Response.json({ code: 0, data: { objectKey, previewUrl: origin + '/private.png' } }) : new Response('png', { headers: { 'Content-Type': contentType } }); };
      const response = await route.GET(new Request('http://localhost/api/admin/media/uploads/saved/content'), { params: Promise.resolve({ path: ['uploads', 'saved', 'content'] }) });
      assert.equal(response.status, expected, objectKey + ':' + contentType); assert.equal(calls[0].init.headers.get('Authorization'), 'Bearer token');
      if (expected === 200) { assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.equal(await response.text(), 'png'); } else assert.equal(calls.length, origin === 'https://example.com' || expected === 403 ? 1 : 2);
    }
  } finally { globalThis.fetch = previousFetch; }
});
