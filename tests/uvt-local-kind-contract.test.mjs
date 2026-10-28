import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('actual H5 daily milestone kind presentation consumes canonical uvt without a nex asset alias', () => {
  const source = readFileSync(new URL('../app/components/domain-views/h-tabs/h5-daily-milestones.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('h5.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let labels;
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && node.properties.some(p => p.name?.getText(ast) === 'uvt')) labels = node.getText(ast);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(labels);
  const map = new Function(`return (${labels})`)();
  assert.equal(map.uvt, 'UVT奖励');
  assert.equal(map.UVT, 'UVT奖励');
  assert.equal(map.usdt, 'USDT奖励');
  assert.equal(map.nex, undefined);
});
