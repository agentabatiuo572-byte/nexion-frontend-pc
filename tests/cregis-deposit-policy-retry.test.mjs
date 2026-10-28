import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("policy.tsx", readFileSync(new URL("../app/components/domain-views/d-tabs/cregis-deposit-policy.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let retry;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "retry") retry = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(retry);
const js = ts.transpileModule(`${retry}\nmodule.exports = retry;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture(overrides = {}) {
  const input = { reason: "original reason", command: { params: { expectedVersion: 7, feeUsdt: "0" } } };
  const pending = { input, commandKey: "original-key", fingerprint: "1|original-key", createdAt: 1000, expiresAt: 86401000 };
  const calls = [], remembered = [], forgotten = [], errors = [], messages = [];
  const context = { module: { exports: {} }, pending, owner: 1, RETRY_WINDOW_MS: 600000, canManage: true, mutation: { current: false },
    owns: () => true, Date: { now: () => 1000 }, useAdminAuth: { getState: () => ({ session: { role: "superadmin", authorities: [] } }) },
    setBusy: () => {}, setError: value => errors.push(value), setMessage: value => messages.push(value), syncPending: () => {},
    proposals: { remember: (...args) => remembered.push(args), forget: (...args) => forgotten.push(args) }, refresh: async () => {},
    createA2OperationProposal: async (...args) => { calls.push(args); return { id: "ticket" }; }, ...overrides };
  runInNewContext(js, context);
  return { retry: context.module.exports, context, pending, calls, remembered, forgotten, errors, messages };
}

test("retry uses original request and key, then retains the returned ticket", async () => {
  const f = fixture(); await f.retry();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], f.pending.input); assert.equal(f.calls[0][1], f.pending.commandKey); assert.equal(f.calls[0][2], true);
  assert.equal(f.remembered[0][2].ticketId, "ticket"); assert.equal(f.remembered[0][2].input, f.pending.input);
});

test("only definitive policy rejections release the pending request", async () => {
  for (const [status, backendMessage] of [[409, "CREGIS_DEPOSIT_POLICY_VERSION_CONFLICT"], [422, "CREGIS_DEPOSIT_POLICY_INVALID"]]) {
    const f = fixture({ createA2OperationProposal: async () => { throw { status, backendMessage }; } });
    await f.retry();
    assert.deepEqual(f.forgotten, [[f.pending.fingerprint, f.pending.commandKey]]);
    assert.match(f.messages.at(-1), /未创建/);
  }
  for (const [status, backendMessage] of [[409, "IDEMPOTENCY_REQUEST_IN_PROGRESS"], [409, "IDEMPOTENCY_RESULT_UNKNOWN"], [422, "OTHER_ERROR"]]) {
    const f = fixture({ createA2OperationProposal: async () => { throw { status, backendMessage }; } });
    await f.retry();
    assert.equal(f.forgotten.length, 0);
    assert.match(f.errors.at(-1), /待核实/);
  }
});

test("failure preserves original record and concurrent, unauthorized or expired retries do not send", async () => {
  const f = fixture({ createA2OperationProposal: async () => { throw new Error("in progress"); } }); await f.retry();
  assert.equal(f.remembered.length, 0); assert.match(f.errors.at(-1), /待核实/);
  for (const override of [{ Date: { now: () => 601000 } }, { Date: { now: () => 999 } }, { canManage: false }, { owns: () => false }, { mutation: { current: true } }]) {
    const blocked = fixture(override); await blocked.retry(); assert.equal(blocked.calls.length, 0);
  }
  for (const property of ["ticketId", "terminal"]) {
    const blocked = fixture(); blocked.pending[property] = "known"; await blocked.retry(); assert.equal(blocked.calls.length, 0);
  }
});
