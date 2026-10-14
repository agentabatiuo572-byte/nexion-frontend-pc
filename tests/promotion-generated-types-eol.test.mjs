import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const generator = readFileSync('scripts/generate-promotion-types.mjs', 'utf8').replace(/^import[^\n]*\n/gm, '');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function checkInMemory(source, target) {
  const messages = [];
  vm.runInNewContext(generator, {
    process: { env: { PROMOTION_OPENAPI: 'approved-openapi.json' }, argv: ['node', 'generator', '--check'] },
    path, createHash,
    readFileSync: file => file === 'approved-openapi.json' ? source : target,
    writeFileSync() { throw new Error('Contract check must not write types'); },
    console: { log: message => messages.push(message) },
  });
  return messages;
}

test('approved types accept LF/CRLF but reject real enum changes without rewriting types', () => {
  const actual = spawnSync(process.execPath, ['scripts/generate-promotion-types.mjs', '--check'], {
    cwd: process.cwd(), env: process.env, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(actual.status, 0, actual.stderr || actual.stdout || actual.error?.message);

  const source = JSON.stringify({ components: { schemas: { State: { enum: ['ACTIVE', 'PAUSED'] } } } }, null, 2) + '\n';
  const target = '// Generated from the reviewed promotion OpenAPI; run scripts/generate-promotion-types.mjs.\n'
    + `// Source SHA256: ${sha256(source)}\nexport type State = "ACTIVE" | "PAUSED";\n`;
  for (const sourceText of [source, source.replaceAll('\n', '\r\n')]) {
    for (const targetText of [target, target.replaceAll('\n', '\r\n')]) {
      assert.deepEqual(checkInMemory(sourceText, targetText), [`Promotion types checked: ${sha256(source)}`]);
    }
  }
  const changed = source.replace('"PAUSED"', '"DISABLED"');
  assert.throws(() => checkInMemory(changed, target), /Promotion types differ/);
  assert.throws(() => checkInMemory(changed, target.replace(sha256(source), sha256(changed))), /Promotion types differ/);
});
