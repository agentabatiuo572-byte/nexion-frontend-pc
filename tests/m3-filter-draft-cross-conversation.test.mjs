import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const component = fs.readFileSync(new URL('../app/components/domain-views/m-tabs/m3-sessions.tsx', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../lib/admin/m3-composer-state.ts', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module });
const { m3ApplyReplyInput, m3ClearDeliveredDraft, m3DerivedSelected, m3ReplySubmission, m3VisibleReplyBody } = module.exports;

test('M3 keeps a reply draft bound to its conversation when filters change the derived selection', () => {
  assert.match(component, /m3VisibleReplyBody\(replyDraft,selected\?\.id\)/);
  assert.match(component, /m3DerivedSelected\(selectedId, filtered\)/);
  assert.match(component, /m3ApplyReplyInput\(selected\.id,body\)/);
  assert.match(component, /m3ReplySubmission\(replyDraft,selected\.id\)/);
  assert.match(component, /m3ClearDeliveredDraft\(current,recipient,body\)/);
  const draftedForA = m3ApplyReplyInput('A', 'reply intended for A');
  const derivedB = m3DerivedSelected('A', [{ id: 'B' }]);
  assert.equal(derivedB?.id, 'B');
  assert.equal(m3ReplySubmission(draftedForA, derivedB?.id), null);
  assert.equal(m3VisibleReplyBody(draftedForA, 'B'), '');
  assert.equal(m3VisibleReplyBody(draftedForA, 'A'), 'reply intended for A');
  assert.equal(m3ReplySubmission(draftedForA, 'B'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(m3ReplySubmission(draftedForA, 'A'))), { recipient: 'A', body: 'reply intended for A' });
  const draftedForBWhileAIsPending = m3ApplyReplyInput('B', 'reply drafted for B');
  assert.deepEqual(JSON.parse(JSON.stringify(m3ClearDeliveredDraft(draftedForBWhileAIsPending, 'A', 'reply intended for A'))), JSON.parse(JSON.stringify(draftedForBWhileAIsPending)));
  assert.deepEqual(JSON.parse(JSON.stringify(m3ClearDeliveredDraft(draftedForA, 'A', 'reply intended for A'))), { conversationNo: 'A', body: '' });
});
