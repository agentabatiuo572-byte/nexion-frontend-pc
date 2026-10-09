import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPendingMutationStore } from '../lib/admin/pending-mutation-store.ts';
import { privateMessageRecovery } from '../lib/admin/m-support-enhancements.ts';

const source = readFileSync(new URL('../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  const canReadTimeout =');
const handlers = source.slice(start, source.indexOf('\n  return <section', start));
const stores = source.slice(source.indexOf('const pendingMessages ='), source.indexOf('export const validCustomerId ='));
const legacyKey = 'nexion-admin-m3-private-pending-v1';
const currentKey = 'nexion-admin-m3-timeout-pending-v1';
const slot = 'nexion-m3-timeout:12';
const policy = { policyKey: 'GLOBAL', warnMinutes: 2, closeMinutes: 9, version: 7 };
const input = { warnMinutes: 3, closeMinutes: 10, reason: '调整会话超时策略' };
const original = { key: 'original-pre-upgrade-key', policy, input, operator: '总管' };
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(run) {
  const previous = globalThis.window, values = new Map(), calls = [];
  let quota = false, failedWrites = 0, unreadable = false, commandStatus = 'UNKNOWN';
  const window = { sessionStorage: {
    getItem(key) { if (unreadable) throw new Error('storage read denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (quota || failedWrites-- > 0) throw new Error('quota'); values.set(key, value); },
    removeItem(key) { values.delete(key); },
  } };
  globalThis.window = window;
  const context = {
    window, createPendingMutationStore,
    session: { role: 'superadmin', authorities: ['service_m3_read', 'service_m3_timeout_manage'], operator: '总管' },
    adminId: 12, timeoutPolicy: policy, timeoutInput: input, timeoutSaving: false,
    timeoutPending: null, timeoutConflict: false, timeoutLatest: null, timeoutReadOnly: false,
    timeoutIdentityRef: { current: 'epoch-1' }, useEffect() {},
    newKey() { calls.push(['MINT']); return 'fresh-key'; },
    parseMConversationTimeoutPolicy(value) {
      assert.equal(value.policyKey, 'GLOBAL'); assert.ok(Number.isSafeInteger(value.version)); return value;
    },
    fetchMConversationTimeoutPolicy: async () => { calls.push(['GET']); return { ...policy, version: 8 }; },
    updateMConversationTimeoutPolicy: async (...args) => { calls.push(['PUT', ...args]); throw { unknown: true }; },
    isIndeterminateSupportError: cause => Boolean(cause.unknown), displayAdminError: () => '读取失败',
    supportClient: { command: async key => { calls.push(['COMMAND', key]); return { status: commandStatus }; } },
  };
  for (const name of ['Open', 'Policy', 'Input', 'Saving', 'Pending', 'Conflict', 'Latest', 'ReadOnly', 'Error']) {
    context['setTimeout' + name] = value => { context['timeout' + name] = value; };
  }
  runInNewContext(ts.transpileModule(stores + handlers + '\nglobalThis.actions={openTimeout,saveTimeout,checkTimeoutPending};globalThis.stores={legacy:pendingMessages,current:pendingTimeoutPolicies};', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const seed = (store, command = original, fingerprint = slot) => store.remember(fingerprint, command.key, { payload: JSON.stringify(command) });
  try { await run({ context, actions: context.actions, legacy: context.stores.legacy, current: context.stores.current, seed, values, calls, failNextWrites: value => { failedWrites = value; }, setQuota: value => { quota = value; }, setUnreadable: value => { unreadable = value; }, setStatus: value => { commandStatus = value; } }); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}

test('legacy timeout restores exact original key/input/version, queries original and never mints or PUTs', async () => fixture(async h => {
  h.seed(h.legacy); const before = h.values.get(legacyKey);
  await h.actions.openTimeout(); assert.deepEqual(plain(h.context.timeoutPending), original);
  for (const status of ['UNKNOWN', 'PROCESSING', 'PENDING']) {
    h.setStatus(status); await h.actions.checkTimeoutPending();
    assert.equal(h.values.get(legacyKey), before); assert.equal(h.values.has(currentKey), false);
    assert.equal(await h.actions.saveTimeout({ ...input, reason: '禁止另发修改理由' }), false);
  }
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
  assert.deepEqual(h.calls.filter(x => x[0] === 'COMMAND'), Array(3).fill(['COMMAND', original.key]));
}));

for (const status of ['SUCCEEDED', 'FAILED']) test(`legacy ${status} cleans only matching old command, preserving private messages and another actor`, async () => fixture(async h => {
  h.seed(h.legacy); h.seed(h.legacy, { key: 'private-original', body: '私信草稿' }, 'nexion-m3-dedicated-pending:12');
  h.seed(h.legacy, { ...original, key: 'other-admin-key' }, 'nexion-m3-timeout:13');
  const unrelated = h.legacy.list().filter(x => x.fingerprint !== slot).map(plain);
  await h.actions.openTimeout(); h.setStatus(status); await h.actions.checkTimeoutPending();
  assert.equal(h.legacy.list().some(x => x.fingerprint === slot), false);
  assert.deepEqual(h.legacy.list().map(plain), unrelated);
  assert.equal(h.context.timeoutPending, null);
  assert.equal(h.context.timeoutConflict, status === 'FAILED');
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
  assert.equal(h.calls.at(-1)[0], 'GET');
}));

test('identical original command in both tables is recovered and cleaned only after terminal readback', async () => fixture(async h => {
  h.seed(h.legacy); h.seed(h.current);
  await h.actions.openTimeout(); await h.actions.checkTimeoutPending();
  assert.equal(h.legacy.list().length, 1); assert.equal(h.current.list().length, 1);
  h.setStatus('SUCCEEDED'); await h.actions.checkTimeoutPending();
  assert.equal(h.legacy.list().length, 0); assert.equal(h.current.list().length, 0);
  assert.ok(h.calls.filter(x => x[0] === 'COMMAND').every(x => x[1] === original.key));
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

test('a conflicting payload added while the original query is in flight cannot be silently retired', async () => fixture(async h => {
  h.seed(h.legacy); await h.actions.openTimeout();
  h.context.supportClient.command = async key => {
    h.calls.push(['COMMAND', key]); h.seed(h.current, { ...original, input: { ...input, closeMinutes: 11 } });
    return { status: 'SUCCEEDED' };
  };
  await h.actions.checkTimeoutPending();
  assert.equal(h.legacy.list().length, 1); assert.equal(h.current.list().length, 1);
  assert.equal(h.context.timeoutPending.key, original.key);
  assert.equal(await h.actions.saveTimeout(input), false);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

for (const patch of [{ key: 'different-key' }, { input: { ...input, closeMinutes: 11 } }, { policy: { ...policy, version: 6 } }]) {
  test('conflicting old/new command records fail closed without altering either table: ' + JSON.stringify(patch), async () => fixture(async h => {
    h.seed(h.legacy); h.seed(h.current, { ...original, ...patch });
    const before = [...h.values]; await h.actions.openTimeout();
    assert.equal(h.context.timeoutPolicy, null); assert.ok(h.context.timeoutError);
    h.context.timeoutPolicy = policy; assert.equal(await h.actions.saveTimeout(input), false);
    assert.deepEqual([...h.values], before);
    assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT' || x[0] === 'COMMAND').length, 0);
  }));
}

test('quota failure retains legacy UNKNOWN and failed terminal cleanup blocks fresh writes until storage recovers', async () => fixture(async h => {
  h.seed(h.legacy); h.seed(h.legacy, { key: 'private-original', body: '私信草稿' }, 'nexion-m3-dedicated-pending:12');
  const before = h.values.get(legacyKey); h.setQuota(true);
  await h.actions.openTimeout(); await h.actions.checkTimeoutPending();
  assert.equal(h.values.get(legacyKey), before); assert.equal(h.context.timeoutPending.key, original.key);
  h.setStatus('SUCCEEDED'); await h.actions.checkTimeoutPending();
  assert.equal(h.values.get(legacyKey), before); assert.equal(h.context.timeoutPending.key, original.key);
  assert.equal(await h.actions.saveTimeout(input), false);
  h.setQuota(false); await h.actions.checkTimeoutPending();
  assert.equal(h.legacy.list().some(x => x.fingerprint === slot), false);
  assert.equal(h.legacy.list()[0].commandKey, 'private-original');
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

test('unreadable storage cannot overwrite or replace an original command', async () => fixture(async h => {
  h.seed(h.legacy); const before = [...h.values]; h.setUnreadable(true);
  assert.equal(await h.actions.saveTimeout(input), false);
  assert.deepEqual([...h.values], before);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

for (const mutate of [
  command => ({ ...command, key: 'bad key\n' }),
  command => ({ ...command, input: { ...input, warnMinutes: 1.5 } }),
]) test('invalid legacy command remains fenced and cannot generate a fresh request', async () => fixture(async h => {
  h.seed(h.legacy, mutate(original)); const before = [...h.values];
  assert.equal(await h.actions.saveTimeout(input), false);
  assert.deepEqual([...h.values], before);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

test('legacy persisted key/payload mismatch is preserved and rejected before lookup or new PUT', async () => fixture(async h => {
  h.legacy.remember(slot, 'stored-row-key', { payload: JSON.stringify(original) }); const before = [...h.values];
  await h.actions.openTimeout(); assert.equal(h.context.timeoutPolicy, null);
  h.context.timeoutPolicy = policy; assert.equal(await h.actions.saveTimeout(input), false);
  assert.deepEqual([...h.values], before); assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT' || x[0] === 'COMMAND').length, 0);
}));

test('malformed legacy row is fenced before the shared store can prune it', async () => fixture(async h => {
  const row = { fingerprint: slot, commandKey: original.key, createdAt: Date.now(), expiresAt: Number.MAX_SAFE_INTEGER, payload: null };
  h.values.set(legacyKey, JSON.stringify({ [original.key]: row })); const before = [...h.values];
  assert.equal(await h.actions.saveTimeout(input), false); assert.deepEqual([...h.values], before);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

function actualRevoke(h) {
  const ast = ts.createSourceFile('chat.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'revokeCustomer') callback = node.initializer.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(callback);
  Object.assign(h.context, { qualificationUnknown: false, authEpoch: 1, scopeGeneration: { current: 0 }, identityRef: { current: 'epoch-1' },
    all: [{ id: 'CV-7', customerId: '7' }], selected: { id: 'CV-7', customerId: '7' }, pending: null, firstPending: null, requestedCustomerId: null,
    customerIdOf: row => row.customerId, pendingKey: id => `nexion-m3-dedicated-pending:${id}`, recoveryKey: (id, key) => `nexion-m3-dedicated-pending:${id}:recovery:${key}`,
    privateMessageRecovery, sessionStorage: h.context.window.sessionStorage, readRecoveries() {}, sendAdminTyping() {}, watchAdminConversation() {}, clearAttachment() {},
    setRecoveryError: value => { h.context.recoveryError = value; },
  });
  for (const match of callback.matchAll(/\b(set[A-Z]\w*)\(/g)) if (!(match[1] in h.context)) h.context[match[1]] = () => {};
  runInNewContext(ts.transpileModule(`globalThis.revoke=(${callback});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, h.context);
}

function seedRevoke(h) {
  h.seed(h.legacy); h.seed(h.legacy, { ...original, key: 'other-admin-timeout' }, 'nexion-m3-timeout:13');
  h.seed(h.legacy, { key: 'private-12', clientMessageId: 'client-12', conversationId: 'CV-7', body: '撤权后必须清除的正文' }, 'nexion-m3-dedicated-pending:12');
  h.seed(h.legacy, { key: 'private-13', clientMessageId: 'client-13', conversationId: 'CV-8', body: '另一账号的草稿' }, 'nexion-m3-dedicated-pending:13');
  actualRevoke(h); return JSON.parse(h.values.get(legacyKey));
}

test('actual customer revocation quota fallback scrubs only affected private body and keeps legacy timeout lineage', async () => fixture(async h => {
  const before = seedRevoke(h); h.failNextWrites(2); h.context.revoke('7', true);
  const after = JSON.parse(h.values.get(legacyKey));
  assert.deepEqual(after[original.key], before[original.key]);
  assert.deepEqual(after['other-admin-timeout'], before['other-admin-timeout']); assert.deepEqual(after['private-13'], before['private-13']);
  const locator = JSON.parse(after['private-12'].payload);
  assert.equal(locator.body, undefined); assert.equal(locator.readOnlyRecovery, true);
  assert.equal(locator.key, 'private-12'); assert.equal(after['private-12'].createdAt, before['private-12'].createdAt);
  await h.actions.openTimeout(); await h.actions.checkTimeoutPending();
  assert.equal(h.context.timeoutPending.key, original.key); assert.equal(await h.actions.saveTimeout(input), false);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

test('fully unwritable revocation erases private bodies and keeps original timeout fenced only in this page', async () => fixture(async h => {
  seedRevoke(h); h.setQuota(true); h.context.revoke('7', true);
  assert.equal(h.values.has(legacyKey), false); assert.equal(h.values.has(currentKey), false);
  assert.match(h.context.recoveryError, /仅保留在本页/);
  await h.actions.openTimeout(); await h.actions.checkTimeoutPending();
  assert.equal(h.context.timeoutPending.key, original.key); assert.equal(await h.actions.saveTimeout(input), false);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
  assert.equal(h.legacy.isDurablyStored(slot, original.key), false);
  h.setQuota(false); await h.actions.checkTimeoutPending();
  assert.equal(h.legacy.isDurablyStored(slot, original.key), true);
  assert.equal(JSON.parse(JSON.parse(h.values.get(legacyKey))['private-12'].payload).body, undefined);
}));

test('quota freed by privacy erasure durably preserves exact legacy timeout metadata without private bodies', async () => fixture(async h => {
  const before = seedRevoke(h); h.failNextWrites(4); h.context.revoke('7', true);
  assert.equal(h.values.has(legacyKey), false);
  const migrated = JSON.parse(h.values.get(currentKey));
  assert.deepEqual(migrated[original.key], before[original.key]);
  assert.deepEqual(migrated['other-admin-timeout'], before['other-admin-timeout']);
  assert.ok(Object.values(migrated).every(row => row.fingerprint.startsWith('nexion-m3-timeout:')));
  assert.match(h.context.recoveryError, /原策略命令已保留/);
  await h.actions.openTimeout(); await h.actions.checkTimeoutPending();
  assert.equal(h.context.timeoutPending.key, original.key);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT').length, 0);
}));

test('invalid legacy command cannot prevent privacy erasure or mint a replacement after revocation', async () => fixture(async h => {
  seedRevoke(h);
  h.seed(h.legacy, { ...original, input: { ...input, warnMinutes: 1.5 } });
  h.setQuota(true); h.context.revoke('7', true);
  assert.equal(h.values.has(legacyKey), false); assert.equal(h.values.has(currentKey), false);
  assert.match(h.context.recoveryError, /仅保留在本页/);
  h.setQuota(false);
  await h.actions.openTimeout(); assert.equal(h.context.timeoutPolicy, null);
  h.context.timeoutPolicy = policy; assert.equal(await h.actions.saveTimeout(input), false);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT' || x[0] === 'COMMAND').length, 0);
  assert.equal(JSON.parse(JSON.parse(h.values.get(legacyKey))['private-12'].payload).body, undefined);
}));

test('malformed legacy payload remains fenced when the private store is read during actual revocation', async () => fixture(async h => {
  h.seed(h.legacy, { key: 'private-12', clientMessageId: 'client-12', conversationId: 'CV-7', body: '撤权后必须清除的正文' }, 'nexion-m3-dedicated-pending:12');
  const table = JSON.parse(h.values.get(legacyKey));
  table[original.key] = { fingerprint: slot, commandKey: original.key, createdAt: Date.now(), expiresAt: Number.MAX_SAFE_INTEGER, payload: null };
  h.values.set(legacyKey, JSON.stringify(table)); actualRevoke(h);
  h.setQuota(true); h.context.revoke('7', true);
  assert.equal(h.values.has(legacyKey), false);
  h.setQuota(false); await h.actions.openTimeout();
  h.context.timeoutPolicy = policy; assert.equal(await h.actions.saveTimeout(input), false);
  assert.equal(h.calls.filter(x => x[0] === 'PUT' || x[0] === 'MINT' || x[0] === 'COMMAND').length, 0);
  assert.equal(h.context.timeoutPending, null);
  assert.equal(JSON.parse(JSON.parse(h.values.get(legacyKey))['private-12'].payload).body, undefined);
}));
