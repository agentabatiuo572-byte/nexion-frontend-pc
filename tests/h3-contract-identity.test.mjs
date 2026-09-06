import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

const source = readFileSync(new URL('../app/components/domain-views/h-tabs/h3-quest-events.tsx', import.meta.url), 'utf8');
const fn = source.slice(source.indexOf('function contractForTask('), source.indexOf('function statusOptions('));
const resolve = new Function(ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\nreturn contractForTask;')();
test('task code is authoritative even across legacy off-by-one ids', () => {
  const rows = [{ taskId: 10, taskKey: 'previous' }, { taskId: 11, taskKey: 'current' }];
  assert.equal(resolve({ id: 10, taskCode: 'current' }, rows, 0).taskKey, 'current');
  assert.deepEqual(resolve({ id: 10, taskCode: 'missing' }, rows, 0), {});
});
test('id fallback never invents an identity from array position', () => {
  const rows = [{ taskId: 10, taskKey: 'current' }];
  assert.equal(resolve({ id: 10 }, rows, 0).taskKey, 'current');
  assert.deepEqual(resolve({}, rows, 10), {});
});
