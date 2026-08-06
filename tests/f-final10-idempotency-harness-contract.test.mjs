import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const helper = readFileSync("tests/e2e/helpers/f-acceptance-harness.ts", "utf8");
const f1 = readFileSync("tests/e2e/f-domain-maker-checker-20260728.spec.ts", "utf8");
const f25 = readFileSync("tests/e2e/f25-f2-f5-success-cleanup-20260729.spec.ts", "utf8");

test("F Final10 harness uses a unique bounded case nonce for carrier idempotency keys", () => {
  assert.match(helper, /export function currentFCaseNonce\(\)/);
  assert.match(helper, /export function fAcceptanceIdempotencyKey\(/);
  assert.match(helper, /idempotency key exceeds 128 characters/);

  for (const source of [f1, f25]) {
    assert.match(source, /const CASE_NONCE = currentFCaseNonce\(\);/);
    assert.match(source, /function caseIdempotencyKey\(suffix: string\)/);
    assert.match(source, /assertNoIdempotencyCollision\(\);/);
    assert.match(source, /FROM nx_admin_idempotency_record/);
    assert.match(source, /idempotency collision preflight must be zero/);
    assert.doesNotMatch(source, /DELETE\s+FROM\s+nx_admin_idempotency_record/i);
  }
});

test("F1 replay, mismatch, CAS, approve and reject keys stay case-scoped", () => {
  assert.match(f1, /const idemKey = caseIdempotencyKey\("f-proposal-idempotency"\);/);
  assert.equal(
    (f1.match(/headers: \{ "Idempotency-Key": idemKey \}/g) ?? []).length,
    3,
    "initial request, exact replay, and different-payload reuse must share one key",
  );
  assert.match(f1, /const mismatch = [\s\S]*?"Idempotency-Key": idemKey[\s\S]*?expect\(mismatchBody\.code\)\.toBe\(409\);/);
  assert.match(f1, /caseIdempotencyKey\("f-cas-approve"\)/);
  assert.match(f1, /caseIdempotencyKey\("f-cas-reject"\)/);
  assert.doesNotMatch(
    f1,
    /"Idempotency-Key": `\$\{RUN_ID\}-/,
    "carrier-owned F1 keys must not be scoped by the stable Run ID alone",
  );
});

test("F2-F5 carrier-owned keys also include the case nonce", () => {
  assert.doesNotMatch(
    f25,
    /"Idempotency-Key": `\$\{RUN_ID\}-/,
    "carrier-owned F2-F5 keys must not be scoped by the stable Run ID alone",
  );
  assert.match(f25, /caseIdempotencyKey\(`\$\{module\}-maker-self-approve-\$\{operationId\}`\)/);
  assert.match(f25, /caseIdempotencyKey\(`f25-finally-reject-\$\{operationId\}`\)/);
});
