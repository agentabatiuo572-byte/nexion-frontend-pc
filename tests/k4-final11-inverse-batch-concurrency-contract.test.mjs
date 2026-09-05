import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/k4-final11-inverse-batch-concurrency.spec.ts", import.meta.url),
  "utf8",
);

test("K4 Final11 inverse-order carrier binds two MFA operators and the frozen candidate", () => {
  for (const name of [
    "K4_FINAL11_CONCURRENCY_RUN_ID", "K4_FINAL11_CONCURRENCY_LOCK",
    "K4_FINAL11_CONCURRENCY_BASE_URL", "K4_FINAL11_CONCURRENCY_EVIDENCE_DIR",
    "K4_FINAL11_CONCURRENCY_RESTRICTED_DIR", "K4_FINAL11_CONCURRENCY_MANIFEST",
    "K4_FINAL11_CONCURRENCY_EXPECTED_BUILD_ID", "K4_FINAL11_CONCURRENCY_BUILD_ID_PATH",
    "K4_FINAL11_CONCURRENCY_CANDIDATE_JAR", "K4_FINAL11_CONCURRENCY_EXPECTED_JAR_SHA256",
    "K4_FINAL11_CONCURRENCY_DB_NAME", "K4_FINAL11_CONCURRENCY_DB_PASSWORD",
    "K4_FINAL11_CONCURRENCY_USER_NOS",
  ]) assert.match(source, new RegExp(`required\\(\\"${name}\\"\\)`), name);
  assert.match(source, /loginWithNormalMfa/);
  assert.match(source, /risk_k4_user_recompute/);
  assert.match(source, /verifyCandidate/);
});

test("K4 Final11 carrier attacks inverse user order without treating CAS as a deadlock", () => {
  assert.match(source, /Promise\.all/);
  assert.match(source, /\[userNos\[0\], userNos\[1\]\]/);
  assert.match(source, /\[userNos\[1\], userNos\[0\]\]/);
  assert.match(source, /statuses\.every\(\(status\) => \[200, 409\]\.includes\(status\)\)/);
  assert.match(source, /statuses\.some\(\(status\) => status === 200\)/);
  assert.match(source, /LATEST DETECTED DEADLOCK/);
  assert.match(source, /replaceAll\("\\\\n", "\\n"\)/);
  assert.match(source, /containsK4ModelOrScoreTables/);
  assert.match(source, /nx_admin_risk_score_(?:model|user|override|contribution)/);
  assert.match(source, /DELETE FROM nx_admin_idempotency_record/);
  assert.match(source, /idempotencyResidue/);
  assert.match(source, /expect\(outboxRows\)\.toBe\(0\)/);
  assert.match(source, /successfulNavigationPaths/);
  assert.match(source, /cancelledNavigationPaths/);
  assert.match(source, /unexpectedBrowserFaults/);
  assert.doesNotMatch(source, /Admin@[0-9]{6,}|A123456789Z/);
});
