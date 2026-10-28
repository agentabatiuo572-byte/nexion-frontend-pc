import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const uiFile = "app/components/domain-views/d-tabs/d2-withdrawals.tsx";
function declarations(file, names) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Map();
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && names.includes(node.name?.text))
      found.set(node.name.text, node.getText(source).replace(/^export /, ""));
    if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(source)))
      found.set(node.name.getText(source), `const ${node.getText(source)};`);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const name of names) assert.ok(found.has(name), `Missing actual declaration: ${name}`);
  return names.map(name => found.get(name)).join("\n");
}
function execute(code, context) {
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));
const cid = "9223372036854775807";
const row = { withdrawalNo: "WD-RECOVER1", chain: "USDT-BEP20", status: "TX_ORPHANED" };
const snapshot = { withdrawalNo: row.withdrawalNo, source: "provider", providerCid: null,
  state: "TX_ORPHANED", canRecover: true };

test("actual action policy fails closed without facts, preserves legacy and BANK actions", () => {
  const actual = execute(declarations(uiFile, ["actionCandidates"]), {});
  for (const status of ["PROCESSING", "SENT", "TX_ORPHANED", "FAILED", "TX_FAILED", "ADDRESS_INVALID"]) {
    const target = { ...row, status };
    assert.deepEqual(plain(actual.actionCandidates(target)), []);
    assert.deepEqual(plain(actual.actionCandidates(target, snapshot)), []);
    assert.deepEqual(plain(actual.actionCandidates(target, { ...snapshot, withdrawalNo: "WD-OTHER" })), []);
  }
  for (const source of [null, "mock", "dev-simulator"]) {
    const legacy = { ...snapshot, source, canRecover: false };
    assert.deepEqual(plain(actual.actionCandidates(row, legacy)), ["REFUND"]);
    assert.deepEqual(plain(actual.actionCandidates({ ...row, status: "PROCESSING" }, legacy)), ["FREEZE"]);
  }
  assert.deepEqual(plain(actual.actionCandidates({ ...row, chain: "BANK-VND" })), []);
  assert.deepEqual(plain(actual.actionCandidates({ ...row, chain: "BANK-VND", status: "REVIEW_PENDING" })),
    ["APPROVE", "DELAY", "FREEZE", "REJECT"]);
});

function clientHarness(reply) {
  const fixture = { reply, calls: [] };
  const context = { fixture, formatAdminApiError: code => code,
    apiRequest: async (...args) => { fixture.calls.push(args); return fixture.reply; } };
  execute(declarations("lib/admin/d-client.ts", ["DOutcomeUnknownError", "d2Invalid", "d2Object", "d2String",
    "d2CregisCid", "fetchD2CregisPayout", "recoverD2CregisPayout"]), context);
  return { fixture, ...context };
}

test("actual client preserves full long CID, exact target, reason and idempotency key", async () => {
  const h = clientHarness({ withdrawalNo: row.withdrawalNo, providerCid: cid, state: "SENT" });
  const result = await h.recoverD2CregisPayout(row.withdrawalNo, cid, "  核实供应商原订单后继续处理  ", "original-command");
  assert.equal(result.providerCid, cid);
  const [base, path, request] = h.fixture.calls[0];
  assert.equal(base, "finance"); assert.equal(path, `/withdrawals/${row.withdrawalNo}/cregis/recover`);
  assert.equal(request.method, "POST"); assert.equal(request.idempotencyKey, "original-command");
  assert.deepEqual(JSON.parse(request.body), { providerCid: cid, reason: "核实供应商原订单后继续处理" });
  for (const invalid of ["0", "-1", "1.1", "01", "9223372036854775808", 9007199254740993])
    await assert.rejects(h.recoverD2CregisPayout(row.withdrawalNo, invalid, "核实供应商原订单后继续处理", "key"), /CREGIS_PAYOUT_RECOVERY_REQUEST_INVALID/);
  await assert.rejects(h.recoverD2CregisPayout(row.withdrawalNo, cid, "太短", "key"), /CREGIS_PAYOUT_RECOVERY_REQUEST_INVALID/);
  assert.equal(h.fixture.calls.length, 1, "Invalid command reached transport");
});

test("actual snapshot client rejects missing/contradictory facts and keeps explicit null source", async () => {
  const h = clientHarness(snapshot);
  assert.deepEqual(plain(await h.fetchD2CregisPayout(row.withdrawalNo)), snapshot);
  h.fixture.reply = { ...snapshot, source: null, canRecover: false };
  assert.equal((await h.fetchD2CregisPayout(row.withdrawalNo)).source, null);
  for (const bad of [{ ...snapshot, source: undefined }, { ...snapshot, source: "unexpected" },
    { ...snapshot, withdrawalNo: "WD-OTHER" }, { ...snapshot, providerCid: 123 },
    { ...snapshot, canRecover: "true" }, { ...snapshot, source: null }, { ...snapshot, state: "SENT" }]) {
    h.fixture.reply = bad;
    await assert.rejects(h.fetchD2CregisPayout(row.withdrawalNo), /D2_RESPONSE_INVALID/);
  }
});

test("unreadable successful recovery response remains outcome unknown with the original key", async () => {
  for (const bad of [null, { withdrawalNo: row.withdrawalNo, providerCid: 12, state: "SENT" },
    { withdrawalNo: "WD-OTHER", providerCid: cid, state: "SENT" },
    { withdrawalNo: row.withdrawalNo, providerCid: cid, state: "PROCESSING" }]) {
    const h = clientHarness(bad);
    await assert.rejects(h.recoverD2CregisPayout(row.withdrawalNo, cid, "核实供应商原订单后继续处理", "retained-key"),
      error => error.name === "DOutcomeUnknownError" && error.commandKey === "retained-key");
  }
});

function commandHarness(authorities = ["finance_d2_read", "finance_d2_withdrawal_approve"]) {
  const calls = { dialogs: [], submitted: [], refreshed: [], keys: new Map(), failure: null, toast: [] };
  const context = { calls, hasAuthority: authority => authorities.includes(authority),
    openActionConfirm: dialog => calls.dialogs.push(dialog),
    pendingKeys: { get: scope => calls.keys.get(scope), remember: (scope, key) => calls.keys.set(scope, key),
      forget: scope => calls.keys.delete(scope) },
    setSubmitting: () => {}, toast: text => calls.toast.push(text), displayAdminError: error => error.message,
    isDOutcomeUnknownError: error => error.name === "DOutcomeUnknownError",
    load: async () => calls.refreshed.push("list"), openDetail: async () => calls.refreshed.push("detail"),
    recoverD2CregisPayout: async (...args) => { calls.submitted.push(args); if (calls.failure) throw calls.failure; } };
  execute(declarations(uiFile, ["operationKey", "confirmCregisRecovery"])
    + "\nglobalThis.confirmRecovery = confirmCregisRecovery;", context);
  return { calls, ...context };
}

test("actual recovery confirmation enforces permissions and uses normal text BusinessForm", () => {
  for (const authorities of [[], ["finance_d2_read"], ["finance_d2_withdrawal_approve"]]) {
    const h = commandHarness(authorities); h.confirmRecovery(row, snapshot);
    assert.equal(h.calls.dialogs.length, 0);
  }
  const h = commandHarness();
  h.confirmRecovery(row, { ...snapshot, canRecover: false });
  h.confirmRecovery(row, { ...snapshot, source: null });
  assert.equal(h.calls.dialogs.length, 0);
  h.confirmRecovery(row, snapshot);
  const dialog = h.calls.dialogs[0];
  assert.equal(dialog.reasonMin, 10); assert.equal(dialog.reasonMax, 300);
  assert.equal(dialog.businessForm.kind, "multi-field");
  assert.equal(dialog.businessForm.fields[0].inputKind, "text", "Numeric input loses long CID precision");
  assert.match(dialog.detail, /不会重新打款/);
});

test("actual recovery command refreshes detail/list and retains the same key across unknown retry", async () => {
  const h = commandHarness(); h.confirmRecovery(row, snapshot);
  const dialog = h.calls.dialogs[0];
  const unknown = new Error("upstream unknown"); unknown.name = "DOutcomeUnknownError";
  h.calls.failure = unknown;
  await assert.rejects(dialog.run("核实供应商原订单后继续处理", undefined, { providerCid: cid }), /upstream unknown/);
  assert.equal(h.calls.keys.size, 1);
  h.calls.failure = null;
  await dialog.run("核实供应商原订单后继续处理", undefined, { providerCid: cid });
  assert.equal(h.calls.submitted[0][1], cid);
  assert.equal(h.calls.submitted[0][3], h.calls.submitted[1][3]);
  assert.deepEqual(h.calls.refreshed, ["list", "detail", "list", "detail"]);
  assert.equal(h.calls.keys.size, 0);
  h.calls.failure = new Error("deterministic refusal");
  await assert.rejects(dialog.run("核实供应商原订单后继续处理", undefined, { providerCid: cid }), /deterministic refusal/);
  assert.equal(h.calls.keys.size, 0);
});

test("actual finance proxy admits only the two Cregis routes and restricts their methods", async () => {
  const calls = [];
  const context = { Response, Headers, URL, AbortSignal, BACKEND_BASE_URL: "https://backend.test",
    IDEMPOTENCY_KEY_HEADER: "Idempotency-Key", ADMIN_TOKEN_COOKIE: "token",
    cookies: async () => ({ get: () => ({ value: "offline-token" }) }), requirePasswordChangeCleared: () => null,
    fetch: async (...args) => { calls.push(args); return Response.json({ code: 0, data: snapshot }); } };
  execute(declarations("lib/admin/cregis-exception-routes.ts", ["cregisExceptionRoute"])
    + declarations("app/api/admin/finance/[...path]/route.ts", ["jsonError", "isText", "backendPath", "proxy"]), context);
  const base = ["withdrawals", row.withdrawalNo, "cregis"];
  assert.equal(context.backendPath(base), `/api/admin/finance/withdrawals/${row.withdrawalNo}/cregis`);
  assert.equal(context.backendPath([...base, "recover"]), `/api/admin/finance/withdrawals/${row.withdrawalNo}/cregis/recover`);
  assert.equal(context.backendPath([...base, "create"]), null);
  for (const [path, method] of [[base, "POST"], [[...base, "recover"], "GET"]]) {
    const response = await context.proxy(new Request("https://admin.test/api", { method }), { params: Promise.resolve({ path }) });
    assert.equal(response.status, 405);
  }
  assert.equal(calls.length, 0);
  const response = await context.proxy(new Request("https://admin.test/api", { method: "POST",
    headers: { "Idempotency-Key": "original-key" }, body: "{}" }),
    { params: Promise.resolve({ path: [...base, "recover"] }) });
  assert.equal(response.status, 200); assert.equal(calls[0][1].headers.get("Idempotency-Key"), "original-key");
});
