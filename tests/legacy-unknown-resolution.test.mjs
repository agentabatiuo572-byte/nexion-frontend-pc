import assert from "node:assert/strict";
import { register } from "node:module";
import test, { afterEach } from "node:test";
import { parseLegacyUnknownCandidate, sameLegacyUnknownProof } from "../lib/admin/legacy-unknown-resolution.ts";
register("./e5-client-test-loader.mjs", import.meta.url);
const { fetchLegacyUnknownCandidate, proposeLegacyUnknownCancellation } = await import("../lib/admin/e5-client.ts");
const { E5OutcomeUncertainError } = await import("../lib/admin/e5-stable-device-command.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const candidate = () => ({ eligible: true, reason: null, deviceId: 42, caseId: "case-synthetic", taskNo: "CTA-SYNTHETIC", ownerId: 7,
  instanceNo: "DEVICE-SYNTHETIC", requestGeneration: 1, requestKeyHash: "a".repeat(64), requestBodyHash: "b".repeat(64),
  caseSetSha256: "c".repeat(64), backendInstanceId: "synthetic-backend-epoch", proofSha: "d".repeat(64), status: "ELIGIBLE", resolution: null });
const parsed = () => parseLegacyUnknownCandidate(candidate(), 42);
const ok = data => Response.json({ code: 0, data });

test("only a backend eligible decision with complete exact-device proof is actionable", () => {
  assert.equal(parsed().eligible, true);
  assert.equal(parseLegacyUnknownCandidate({ ...candidate(), reason: "" }, 42).eligible, true);
  assert.deepEqual(parseLegacyUnknownCandidate({ eligible: false, reason: "LEGACY_UNKNOWN_CASE_NOT_AUTHORIZED", deviceId: 42 }, 42),
    { eligible: false, reason: "LEGACY_UNKNOWN_CASE_NOT_AUTHORIZED", deviceId: 42 });
  for (const patch of [{ eligible: "true" }, { deviceId: 43 }, { requestGeneration: 2 }, { proofSha: null }, { proofSha: "bad" },
    { backendInstanceId: null }, { requestBodyHash: "bad" }, { status: "QUIESCENCE_REQUIRED" }, { ownerId: 0 }]) {
    assert.throws(() => parseLegacyUnknownCandidate({ ...candidate(), ...patch }, 42), /RESPONSE_INVALID/);
  }
});

test("resolved means canonical cancelled and credited false, never a fabricated completion", () => {
  const saved = { resolutionId: 17, caseId: "case-synthetic", taskNo: "CTA-SYNTHETIC", deviceId: 42,
    outcome: "ZERO_CREDIT_CANCELLED", taskStatus: "CANCELLED", credited: false, a2OperationId: "A2-1", resolvedAt: "2026-11-01T14:00:00Z" };
  const row = { ...candidate(), eligible: false, status: "RESOLVED", proofSha: null, resolution: saved };
  assert.equal(parseLegacyUnknownCandidate(row, 42).resolution.credited, false);
  assert.equal(parseLegacyUnknownCandidate(row, 42).resolution.resolutionId, "17");
  for (const patch of [{ credited: true }, { taskStatus: "COMPLETED" }, { deviceId: 43 }, { taskNo: "ANOTHER" }, { a2OperationId: "" }])
    assert.throws(() => parseLegacyUnknownCandidate({ ...row, resolution: { ...saved, ...patch } }, 42), /RESPONSE_INVALID/);
});

test("backend epoch or any case binding change requires a new explicit review", () => {
  const before = parsed();
  assert.equal(sameLegacyUnknownProof(before, parsed()), true);
  for (const patch of [{ proofSha: "e".repeat(64) }, { backendInstanceId: "new-epoch" }, { taskNo: "ANOTHER" }, { ownerId: "8" },
    { instanceNo: "OTHER" }, { caseId: "OTHER" }, { requestBodyHash: "f".repeat(64) }, { eligible: false }])
    assert.equal(sameLegacyUnknownProof(before, { ...before, ...patch }), false);
});

test("candidate read uses the existing E5 endpoint and does not hide auth or service failures", async () => {
  const abort = new AbortController();
  globalThis.fetch = async (path, init) => {
    assert.equal(path, "/api/admin/devices/legacy-unknown-resolutions/42");
    assert.equal(init.signal, abort.signal); assert.equal(init.body, undefined);
    return ok(candidate());
  };
  assert.equal((await fetchLegacyUnknownCandidate(42, abort.signal)).eligible, true);
  for (const status of [401, 403, 503]) {
    globalThis.fetch = async () => Response.json({ code: status, message: "UNAVAILABLE" }, { status });
    await assert.rejects(fetchLegacyUnknownCandidate(42));
  }
});

test("maker posts only reason and proofSha and receives an A2 ticket, without executing cancellation", async () => {
  const calls = [];
  globalThis.fetch = async (path, init) => { calls.push({ path, init }); return ok({ id: "A2-synthetic" }); };
  const result = await proposeLegacyUnknownCancellation(parsed(), "依据已核对的真实退出证据");
  assert.equal(result.id, "A2-synthetic");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/admin/devices/legacy-unknown-resolutions/42/proposals");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { reason: "依据已核对的真实退出证据", proofSha: "d".repeat(64) });
  assert.ok(calls[0].init.headers.get("Idempotency-Key"));
});

test("lost proposal response retains the key even if a changed reason is rejected by payload binding", async () => {
  const keys = [];
  globalThis.fetch = async (_path, init) => { keys.push(init.headers.get("Idempotency-Key")); throw new TypeError("network lost"); };
  await assert.rejects(proposeLegacyUnknownCancellation(parsed(), "第一次真实审查提交理由"), E5OutcomeUncertainError);
  globalThis.fetch = async (_path, init) => { keys.push(init.headers.get("Idempotency-Key"));
    return Response.json({ code: 409, message: "IDEMPOTENCY_PAYLOAD_CHANGED" }, { status: 409 }); };
  await assert.rejects(proposeLegacyUnknownCancellation(parsed(), "补充但不改变原处置意图的理由"));
  globalThis.fetch = async (_path, init) => { keys.push(init.headers.get("Idempotency-Key")); return ok({ id: "A2-original" }); };
  assert.equal((await proposeLegacyUnknownCancellation(parsed(), "第一次真实审查提交理由")).id, "A2-original");
  assert.equal(new Set(keys).size, 1);
});

test("missing ticket response stays uncertain and noneligible cases never post", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return ok({}); };
  const current = { ...parsed(), caseId: "another-synthetic-case" };
  await assert.rejects(proposeLegacyUnknownCancellation(current, "足够长度的真实操作理由"), E5OutcomeUncertainError);
  await assert.rejects(proposeLegacyUnknownCancellation({ ...current, eligible: false }, "足够长度的真实操作理由"), /PROPOSAL_INVALID/);
  assert.equal(calls, 1);
});
