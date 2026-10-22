import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function picker({ allowed = true, disabled = false } = {}) {
  const states = [], requests = []; let index = 0, loader, enabled, reloads = 0;
  let read = { data: null, error: null, loading: false };
  const ui = Object.fromEntries(['Button', 'Field', 'Notice', 'ReadError'].map(name => [name, () => null]));
  ui.useRead = (load, _deps, active) => { loader = load; enabled = active; return { ...read, reload: () => reloads++ }; };
  const code = ts.transpileModule(readFileSync(new URL('../app/components/domain-views/h-tabs/h4-sample-account-select.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(name => {
    if (name === 'react') return { useState: initial => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], next => states[i] = next]; } };
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('h4-promotion-ui')) return ui;
    if (name.endsWith('promotion-client')) return { promotionRead: async (path, query) => { requests.push({ path, query }); return read.data; } };
    throw Error(name);
  }, module.exports, module);
  const props = { value: '', onChange: id => props.value = id, allowed, disabled };
  const render = () => { index = 0; const nodes = []; const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; nodes.push(node); visit(node.props?.children); }; visit(module.exports.H4SampleAccountSelect(props)); return nodes; };
  const text = value => Array.isArray(value) ? value.map(text).join('') : value?.props ? text(value.props.children) : String(value ?? '');
  return { props, requests, render, ui, enabled: () => enabled, reloads: () => reloads, read: next => { read = next; }, load: () => loader(), button: label => render().find(node => node.type === ui.Button && text(node.props.children) === label), field: label => render().find(node => node.type === ui.Field && node.props.label === label).props.children };
}

test('search reaches a later C1 page and returns its opaque ID without parsing the user code', async () => {
  const p = picker(); p.render(); assert.equal(p.enabled(), false);
  p.button('查找账户').props.onClick(); p.render(); await p.load();
  assert.deepEqual(p.requests[0], { path: '/promotion-account-samples', query: { keyword: '', pageNum: 1 } });
  p.read({ data: { items: [], total: 31, pageNum: 1, pageSize: 20 }, loading: false, error: null });
  p.button('下一页').props.onClick(); p.render(); await p.load(); assert.equal(p.requests[1].query.pageNum, 2);
  p.read({ data: { items: [{ accountId: '29', label: 'U000000029 · sample' }], total: 31, pageNum: 2, pageSize: 20 }, loading: false, error: null });
  p.field('样本账户').props.onChange({ target: { value: '29' } }); assert.equal(p.props.value, '29');
  assert.equal(p.button('下一页').props.disabled, true);
  p.button('查找账户').props.onClick(); p.render(); p.button('查找账户').props.onClick(); assert.equal(p.reloads(), 3);
});
test('permission loss and busy state block the handler; raw-phone keyword stays off the wire', () => {
  for (const props of [{ allowed: false }, { disabled: true }]) { const p = picker(props); p.button('查找账户').props.onClick(); p.render(); assert.equal(p.enabled(), false); assert.equal(p.reloads(), 0); }
  const p = picker(); p.field('用户编码 / 昵称').props.onChange({ target: { value: '13812345678' } }); p.button('查找账户').props.onClick(); p.render(); assert.equal(p.enabled(), false); assert(p.render().some(node => node.type === p.ui.ReadError));
});
test('failed results keep the selected account and expose retry without enabling stale choices', () => {
  const p = picker(); p.props.value = '29'; p.read({ data: { items: [{ accountId: '29', label: 'U29' }], total: 1, pageNum: 1, pageSize: 20 }, loading: false, error: Error('search failed') });
  assert.equal(p.field('样本账户').props.value, '29'); assert.equal(p.field('样本账户').props.disabled, true);
  const error = p.render().find(node => node.type === p.ui.ReadError); error.props.retry(); assert.equal(p.reloads(), 1);
});
