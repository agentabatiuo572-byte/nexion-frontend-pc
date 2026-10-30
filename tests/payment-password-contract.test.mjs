import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parsePaymentPolicy, parsePaymentStatus, parsePaymentAttempts, parsePaymentReceipt } from "../lib/admin/payment-password-contract.ts";
import { paymentPasswordRoute, paymentPasswordSupportRoute } from "../lib/admin/payment-password-routes.ts";
import * as contract from "../lib/admin/payment-password-contract.ts";
import { outcomeStaysUnknown } from "../lib/admin/outcome-classification.ts";

const values = { maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 };
const policy = { version: 1, values, constraints: { maxAttempts: { min: 1, max: 10 }, windowMinutes: { min: 1, max: 60 }, lockMinutes: { min: 1, max: 60 } }, effectDescription: "后续验证使用新规则，已有锁定保持原结束时间。", editable: true, updatedAt: null, updatedBy: null };
test("policy accepts only complete server values and server-owned constraints", () => {
  assert.equal(parsePaymentPolicy(policy).values.maxAttempts, 5);
  assert.equal(parsePaymentPolicy({ ...policy, constraints: null, effectDescription: null }).constraints, null);
  for (const invalid of [{}, { ...policy, version: "1" }, { ...policy, values: { ...values, maxAttempts: 0 } }, { ...policy, constraints: { ...policy.constraints, maxAttempts: { min: 1, max: 3 } } }]) assert.throws(() => parsePaymentPolicy(invalid));
});
test("unknown states, account mismatch and incomplete lock times cannot appear as unset", () => {
  const row = { userId: "12", state: "LOCKED", updatedAt: "2026-10-30T06:00:00Z", observedAt: "2026-10-30T06:00:00Z", lockedUntil: "2026-10-30T06:15:00Z" };
  assert.equal(parsePaymentStatus(row, "12").state, "LOCKED");
  for (const invalid of [{ ...row, state: "UNKNOWN" }, { ...row, userId: "13" }, { ...row, lockedUntil: null }, { ...row, observedAt: "invalid" }, { ...row, lockedUntil: "10/30/2026" }, { ...row, observedAt: "2026-10-30T06:00:00" }]) assert.throws(() => parsePaymentStatus(invalid, "12"));
  assert.equal(parsePaymentStatus({ ...row, lockedUntil: "2026-10-30T14:15:00+08:00" }, "12").lockedUntil, "2026-10-30T14:15:00+08:00");
});
test("attempts project only safe fields and reject wrong-user or malformed pagination", () => {
  const raw = { userId: "12", records: [{ id: "1", occurredAt: "2026-10-30T06:00:00Z", purpose: "PAYMENT", result: "INCORRECT", channel: "H5", clientIpMasked: null, paymentPassword: "SECRET_MUST_NOT_PROJECT" }], total: 1, pageNum: 1, pageSize: 10 };
  assert.equal(JSON.stringify(parsePaymentAttempts(raw, "12")).includes("SECRET_MUST_NOT_PROJECT"), false);
  assert.throws(() => parsePaymentAttempts(raw, "13"));
  assert.throws(() => parsePaymentAttempts({ ...raw, total: 0 }, "12"));
  assert.throws(() => parsePaymentAttempts({ ...raw, records: [{ ...raw.records[0], result: "INTERNAL_CODE" }] }, "12"));
  assert.throws(() => parsePaymentAttempts({ ...raw, records: [{ ...raw.records[0], clientIpMasked: "203.0.113.12" }] }, "12"));
});
test("saved success needs an exact command and complete audit readback", () => {
  const receipt = { commandKey: "policy-1", status: "APPLIED", auditId: "A2-12", changedAt: "2026-10-30T06:00:00Z", changedBy: "审核员", reason: "根据已批准安全方案调整", oldValues: values, newValues: { ...values, maxAttempts: 6 }, effectDescription: policy.effectDescription };
  assert.equal(parsePaymentReceipt(receipt, "policy-1").auditId, "A2-12");
  assert.throws(() => parsePaymentReceipt(receipt, "policy-2"));
  for (const key of ["auditId", "changedAt", "changedBy", "effectDescription"]) assert.throws(() => parsePaymentReceipt({ ...receipt, [key]: null }, "policy-1"));
});
test("frontend proxy exposes exact allowed endpoints and no user credential mutations", () => {
  assert.deepEqual(paymentPasswordRoute(["security", "payment-password-policy"])?.methods, ["GET", "POST"]);
  assert.deepEqual(paymentPasswordRoute(["profiles", "12", "security", "payment-password"])?.methods, ["GET"]);
  assert.deepEqual(paymentPasswordRoute(["profiles", "12", "security", "payment-password", "attempts"])?.methods, ["GET"]);
  for (const action of ["unlock", "reset", "setup", "clear", "change"]) assert.equal(paymentPasswordRoute(["profiles", "12", "security", "payment-password", action]), null);
  assert.equal(paymentPasswordRoute(["security", "payment-password-policy", "commands", "../escape"]), null);
});

const ts = createRequire(import.meta.url)("typescript");
function clientWithResponses(responses, options = {}) {
  let rows = [], counter = 0;
  const calls = [];
  const store = { list: () => rows, remember: (fingerprint, commandKey, extra) => rows.push({ fingerprint, commandKey, ...extra }), isDurablyStored: () => options.durable !== false, forget: (fingerprint, commandKey) => { rows = rows.filter(row => row.fingerprint !== fingerprint || row.commandKey !== commandKey); } };
  const dependencies = {
    "@/lib/admin/error-messages": { guardedFetch: async (path, init) => { calls.push({ path, init }); const next = responses.shift(); if (next instanceof Error) throw next; return new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers }); } },
    "@/lib/admin/auth-session": { isAdminAuthFailure: status => status === 401, resetAdminSession() {} },
    "@/lib/admin/outcome-classification": { outcomeStaysUnknown },
    "@/lib/admin/a2-client": { createA2CommandKey: () => `policy-${++counter}` },
    "@/lib/admin/pending-mutation-store": { createPendingMutationStore: () => store },
    "@/lib/admin/payment-password-contract": contract,
  };
  const source = readFileSync(new URL("../lib/admin/payment-password-client.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", code)(name => dependencies[name], module.exports, module);
  return { client: module.exports, calls };
}
test("real client preserves unknown POSTs but releases deterministic rejection for retry", async () => {
  for (const status of [400, 403, 409, 422]) {
    const { client } = clientWithResponses([{ status, body: { code: status, data: null } }]);
    await assert.rejects(client.submitPaymentPolicy(12, values, 1, "依据已批准的安全方案调整"));
    assert.equal(client.pendingPaymentPolicy(12), null, `${status} must allow a new intentional retry`);
  }
  for (const response of [{ status: 503, body: { code: 503, data: null } }, new TypeError("network"), { status: 200, body: { code: 0, data: null } }, { status: 409, headers: { "X-Nexion-Upstream-Outcome": "unknown" }, body: { code: 409 } }, { status: 401, headers: { "X-Nexion-Upstream-Outcome": "unknown" }, body: { code: 401 } }]) {
    const { client, calls } = clientWithResponses([response]);
    await assert.rejects(client.submitPaymentPolicy(12, values, 1, "依据已批准的安全方案调整"));
    assert.equal(client.pendingPaymentPolicy(12).commandKey, "policy-1");
    await assert.rejects(client.submitPaymentPolicy(12, values, 1, "依据已批准的安全方案调整"));
    assert.equal(calls.length, 1, "An unresolved command cannot generate another POST");
  }
});

const lock = { id: "lock-12", userId: "12", userLabel: "验收用户", version: 4, type: "PAYMENT_PASSWORD_LOCK", state: "ACTIVE", reason: "支付密码连续输错", startedAt: "2026-10-31T06:00:00Z", lockedUntil: "2026-10-31T06:15:00Z", failedAttempts: 5, windowMinutes: 15, capabilities: { releaseAllowed: true, disabledReason: null, effectDescription: "只结束本次支付密码锁定并清空对应错误窗口，登录状态不变。" } };
const releaseReceipt = (status = "APPLIED") => ({ commandKey: "policy-1", status, userId: "12", recordId: lock.id, operation: "RELEASE_LOCK", auditId: status === "APPLIED" ? "A2-release" : null, changedAt: status === "APPLIED" ? "2026-10-31T06:03:00Z" : null, changedBy: status === "APPLIED" ? "验收管理员" : null, reason: status === "APPLIED" ? "核对用户身份和异常后解除" : null, record: status === "APPLIED" ? { ...lock, version: 5, state: "RELEASED", capabilities: { ...lock.capabilities, releaseAllowed: false } } : null });
test("payment record capability fails closed on unsupported type, unknown state, missing version/effect", () => {
  assert.equal(contract.parsePaymentSecurityRecord(lock, "12").capabilities.releaseAllowed, true);
  for (const value of [{ ...lock, type: "LOGIN_PASSWORD_LOCK" }, { ...lock, state: "UNKNOWN" }, { ...lock, version: undefined }, { ...lock, capabilities: null }, { ...lock, capabilities: { releaseAllowed: true, effectDescription: null } }]) assert.equal(contract.parsePaymentSecurityRecord(value, "12").capabilities.releaseAllowed, false);
  assert.throws(() => contract.parsePaymentSecurityRecord(lock, "13"));
  assert.throws(() => contract.parsePaymentSecuritySummary({ userId: "12", observedAt: "2026-10-31T06:00:00Z", record: { ...lock, userId: "13" } }, "12"));
  const projected = contract.parsePaymentSecurityRecord({ ...lock, paymentPassword: "DO_NOT_PROJECT", proof: "DO_NOT_PROJECT" });
  assert.equal(JSON.stringify(projected).includes("DO_NOT_PROJECT"), false);
});
test("release audit readback binds original command, user, record and operation", () => {
  const expected = { commandKey: "policy-1", userId: "12", recordId: lock.id, operation: "RELEASE_LOCK" };
  assert.equal(contract.parsePaymentReleaseReceipt(releaseReceipt(), expected).record.state, "RELEASED");
  for (const field of ["commandKey", "userId", "recordId", "operation"]) assert.throws(() => contract.parsePaymentReleaseReceipt({ ...releaseReceipt(), [field]: "other" }, expected));
  for (const field of ["auditId", "changedAt", "changedBy", "reason", "record"]) assert.throws(() => contract.parsePaymentReleaseReceipt({ ...releaseReceipt(), [field]: null }, expected));
  assert.throws(() => contract.parsePaymentReleaseReceipt({ ...releaseReceipt(), record: lock }, expected));
  assert.throws(() => contract.parsePaymentReleaseReceipt({ ...releaseReceipt(), record: { ...lock, type: "LOGIN_PASSWORD_LOCK", state: "RELEASED" } }, expected));
});
test("payment routes separate support ownership and allow only explicit release", () => {
  assert.deepEqual(paymentPasswordRoute(["security", "payment-password-records", "lock-12", "release"])?.methods, ["POST"]);
  assert.deepEqual(paymentPasswordSupportRoute(["support-workbench", "customers", "12", "payment-password", "records", "lock-12", "release"])?.methods, ["POST"]);
  assert.deepEqual(paymentPasswordSupportRoute(["support-workbench", "customers", "12", "payment-password", "summary"])?.methods, ["GET"]);
  for (const action of ["unlock", "reset", "setup", "clear", "change"]) {
    assert.equal(paymentPasswordRoute(["security", "payment-password-records", "lock-12", action]), null);
    assert.equal(paymentPasswordSupportRoute(["support-workbench", "customers", "12", "payment-password", "records", "lock-12", action]), null);
  }
  assert.equal(paymentPasswordSupportRoute(["support-workbench", "customers", "../12", "payment-password", "summary"]), null);
});
test("release stores one command before POST, sends CAS, and unknown only queries original scoped command", async () => {
  const { client, calls } = clientWithResponses([{ status: 503, body: { code: 503 } }, { status: 200, body: { code: 0, data: releaseReceipt("NOT_FOUND") } }, { status: 200, body: { code: 0, data: releaseReceipt("PENDING") } }, { status: 200, body: { code: 0, data: releaseReceipt() } }]);
  const port = client.paymentSecurityPorts.support("12");
  await assert.rejects(client.submitPaymentRelease(12, port, lock, "核对用户身份和异常后解除"));
  assert.equal(client.pendingPaymentRelease(12, "12").commandKey, "policy-1");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.expectedVersion, 4); assert.equal(body.confirmed, true); assert.equal(body.operation, "RELEASE_LOCK");
  await assert.rejects(client.submitPaymentRelease(12, client.paymentSecurityPorts.global("12"), lock, "核对用户身份和异常后解除"));
  await assert.rejects(client.queryPaymentRelease(12, client.paymentSecurityPorts.global("12")));
  assert.equal(calls.length, 1, "A second entry cannot bypass the pending scoped command");
  for (const status of ["NOT_FOUND", "PENDING"]) { assert.equal((await client.queryPaymentRelease(12, port)).status, status); assert.ok(client.pendingPaymentRelease(12, "12")); }
  assert.equal((await client.queryPaymentRelease(12, port)).status, "APPLIED");
  assert.equal(client.pendingPaymentRelease(12, "12"), null);
  assert.equal(calls.filter(call => call.init.method === "POST").length, 1);
  assert.ok(calls.every(call => call.path.startsWith("/api/admin/content/support-workbench/customers/12/payment-password/records/")));
});
test("release rejection clears only definitive outcomes; explicit unknown 401 retains original key", async () => {
  for (const status of [400, 403, 409, 422]) {
    const { client } = clientWithResponses([{ status, body: { code: status } }]);
    await assert.rejects(client.submitPaymentRelease(12, client.paymentSecurityPorts.global("12"), lock, "核对用户身份和异常后解除"));
    assert.equal(client.pendingPaymentRelease(12, "12"), null);
  }
  const { client } = clientWithResponses([{ status: 401, headers: { "X-Nexion-Upstream-Outcome": "unknown" }, body: { code: 401 } }]);
  await assert.rejects(client.submitPaymentRelease(12, client.paymentSecurityPorts.global("12"), lock, "核对用户身份和异常后解除"));
  assert.ok(client.pendingPaymentRelease(12, "12"));
});
test("missing durable storage or server capability stops release before any POST", async () => {
  const { client, calls } = clientWithResponses([], { durable: false });
  const port = client.paymentSecurityPorts.global("12");
  await assert.rejects(client.submitPaymentRelease(12, port, lock, "核对用户身份和异常后解除"), /未提交解除/);
  assert.equal(calls.length, 0); assert.equal(client.pendingPaymentRelease(12, "12"), null);
  await assert.rejects(client.submitPaymentRelease(12, port, { ...lock, capabilities: { ...lock.capabilities, releaseAllowed: false } }, "核对用户身份和异常后解除"));
  assert.equal(calls.length, 0);
});
