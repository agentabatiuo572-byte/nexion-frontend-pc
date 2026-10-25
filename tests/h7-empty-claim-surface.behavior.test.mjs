import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
function load(path, names, bindings = {}) {
  const source = read(path), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(declarations.length, names.length);
  const code = ts.transpileModule(declarations.map(n => n.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), code + '\nreturn {' + names.join(',') + '};')(...Object.values(bindings));
}
const { initBusinessForm, missingBusinessFields } = load('app/components/domain-views/design-kit.tsx', ['initBusinessForm', 'missingBusinessFields']);
const { parseVoucher, surfacesText } = load('app/components/domain-views/h-tabs/h7-voucher-config.tsx', ['toMs', 'parseVoucher', 'surfacesText'], {
  SURFACE_LABEL: { home: '首页', store: '商城', me: '我的', earn: '收益' },
});
const spec = { kind: 'voucher-config', currentName: 'TEST unrestricted', currentType: 'fixed', currentAmountUSD: '1', currentAudience: 'all', currentStatus: 'paused', currentIssuanceLimit: '2' };

test('actual H7 form accepts and serializes an unrestricted voucher with no selected surface', () => {
  const state = initBusinessForm(spec);
  assert.equal(state.claimSurfaces, '');
  assert.deepEqual(missingBusinessFields(spec, state), []);
  assert.deepEqual(parseVoucher(state, 'TEST-639').claimSurfaces, []);
  assert.equal(surfacesText({ claimSurfaces: [] }), '不限入口');
});
test('explicit H7 surfaces stay scoped and unknown surfaces remain invalid', () => {
  const state = { ...initBusinessForm(spec), claimSurfaces: 'store' };
  assert.deepEqual(missingBusinessFields(spec, state), []);
  assert.deepEqual(parseVoucher(state, 'TEST-639').claimSurfaces, ['store']);
  assert.equal(surfacesText({ claimSurfaces: ['store'] }), '商城');
  assert.ok(missingBusinessFields(spec, { ...state, claimSurfaces: 'admin' }).some(s => s.includes('领取入口')));
});

test('H7 fixed amounts outside the backend range block both new and existing forms', () => {
  for (const currentAmountUSD of ['', '1']) {
    const state = initBusinessForm({ ...spec, currentAmountUSD });
    for (const amountUSD of ['0.01', '0', '-1', '', 'NaN', 'Infinity', '1000000.000001']) {
      const missing = missingBusinessFields(spec, { ...state, amountUSD });
      assert.ok(missing.some(s => s.includes('满减面值')), `${currentAmountUSD}/${amountUSD}`);
      assert.ok(missing.some(s => s.includes('1–1,000,000')), 'failure must explain the allowed range');
    }
  }
});

test('H7 fixed range endpoints and fractional amounts are preserved; percent validation stays independent', () => {
  const state = initBusinessForm(spec);
  for (const amountUSD of ['1', '1.01', '999999.999999', '1000000']) {
    const values = { ...state, amountUSD };
    assert.deepEqual(missingBusinessFields(spec, values), [], amountUSD);
    assert.equal(parseVoucher(values, 'TEST-face-range').amountUSD, Number(amountUSD));
  }
  assert.deepEqual(missingBusinessFields(spec, { ...state, type: 'percent', percent: '20', amountUSD: '0.01' }), []);
  assert.ok(missingBusinessFields(spec, { ...state, type: 'percent', percent: '101' }).some(s => s.includes('折扣率')));
});
