import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as form from '../lib/admin/promotion-form.ts';
import * as client from '../lib/admin/promotion-client.ts';
import { displayCopyModules } from './display-copy-fixture.mjs';

const require = createRequire(import.meta.url);

// Keep the date and sample controls real while the owning harness controls reads.
export function promotionFieldModule(name, ui) {
  if (!['./h4-date-time-field', './h4-sample-account-select'].includes(name)) return undefined;
  const file = new URL('../app/components/domain-views/h-tabs/' + name.slice(2) + '.tsx', import.meta.url);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'exports', 'module', code)(dependency => {
    if (dependency.startsWith('react')) return require(dependency);
    if (dependency in displayCopyModules) return displayCopyModules[dependency];
    if (dependency === '@/lib/admin/promotion-form') return form;
    if (dependency === '@/lib/admin/promotion-client') return client;
    if (dependency === './h4-promotion-ui') return ui;
    throw new Error('Unknown promotion field dependency ' + dependency);
  }, module.exports, module);
  return module.exports;
}
