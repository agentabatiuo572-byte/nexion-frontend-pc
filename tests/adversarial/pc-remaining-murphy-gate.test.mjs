import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  resolveNexionAppRoot,
  resolveNexionBackendRoot,
} from "../../scripts/lib/nexion-workspace-paths.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BACKEND = resolveNexionBackendRoot({ adminRoot: ROOT });
const APP = resolveNexionAppRoot({ adminRoot: ROOT });
const MATRIX_PATH = join(ROOT, "tests/adversarial/pc-remaining-murphy.matrix.json");
const LEDGER_PATH = join(ROOT, "adversarial-evidence/pc-remaining-20260810/script-files.sha256");
const matrix = JSON.parse(readFileSync(MATRIX_PATH, "utf8"));

const expectedIds = [
  "OPS-A-07a", "OPS-A-07b", "OPS-A-09", "OPS-A-12", "OPS-A-27",
  "OPS-B-13", "OPS-B-14", "OPS-C-02a", "OPS-C-21", "OPS-C-23", "OPS-C-34",
  "OPS-D-15", "OPS-D-19", "OPS-D-21", "OPS-D-22", "OPS-E-16", "OPS-E-18",
  "OPS-E-19", "OPS-E-20", "OPS-F-04", "OPS-F-07", "OPS-F-07a", "OPS-F-08",
  "OPS-F-09", "OPS-F-11", "OPS-F-12", "OPS-F-13", "OPS-F-14", "OPS-F-15",
  "OPS-F-16", "OPS-F-17", "OPS-F-18", "OPS-F-19", "OPS-F-26", "OPS-G-14",
  "OPS-H-12", "OPS-I-14", "OPS-I-15", "OPS-I-16", "OPS-K-16", "OPS-K-17",
  "OPS-L-08", "OPS-L-09", "OPS-L-10", "OPS-M-17", "OPS-M-19", "OPS-M-20",
  "OPS-M-21", "OPS-M-22", "OPS-M-23", "OPS-M-24",
];

const read = (base, relative) => readFileSync(join(base, ...relative.split("/")), "utf8");

test("the independent attack matrix locks all fifty-one debt IDs and all Murphy dimensions", () => {
  assert.deepEqual(matrix.cases.map((item) => item.id).sort(), [...expectedIds].sort());
  assert.equal(new Set(matrix.cases.map((item) => item.id)).size, 51);
  const dimensions = new Set(matrix.globalDimensions);
  assert.deepEqual([...dimensions].sort(), [
    "authorization", "mock-boundary", "operator-truth", "partial-success",
    "race", "replay", "worst-case",
  ]);
  for (const item of matrix.cases) {
    assert.ok(item.focus.length >= 2, `${item.id} needs at least two focused attack dimensions`);
    assert.ok(item.focus.every((dimension) => dimensions.has(dimension)), `${item.id} has an unknown dimension`);
    assert.ok(item.fault.length >= 20, `${item.id} needs a concrete injected fault`);
    assert.ok(item.oracle.length >= 30, `${item.id} needs an authoritative pass oracle`);
  }
});

test("F26 has a real service-under-test carrier for Nth-item failure and a source uniqueness guard", () => {
  const atomicity = read(BACKEND, "src/test/java/ffdd/opsconsole/team/application/F5CommissionReissueAtomicityTest.java");
  const migration = read(BACKEND, "src/test/java/ffdd/opsconsole/team/application/F5CommissionReissueAtomicityMigrationContractTest.java");
  assert.match(atomicity, /new F5CommissionService\(/);
  assert.match(atomicity, /laterMissingSourceFailsBeforeTheBatchWritesAnyPrefix/);
  assert.match(atomicity, /CM-41[\s\S]*CM-42/);
  assert.match(atomicity, /verify\(mapper, never\(\)\)\.insertReissueFromOriginal/);
  assert.match(atomicity, /operationEvidenceWriteFailureAbortsInsteadOfReturningSuccess/);
  assert.match(migration, /UNIQUE KEY uk_commission_reissue_source \(reissue_source_commission_id\)/);
  const runner = read(ROOT, "scripts/run-pc-remaining-murphy-adversarial.mjs");
  assert.match(runner, /F5CommissionReissueAtomicityMySqlIntegrationTest/);
  assert.match(runner, /real MySQL transaction rollback/);
});

test("adversarial receipts exclude their generated run directory from candidate fingerprints", () => {
  const runner = read(ROOT, "scripts/run-pc-remaining-murphy-adversarial.mjs");
  assert.match(runner, /excludedGeneratedEvidence/);
  assert.match(runner, /adversarial-evidence\/pc-remaining-20260810\/runs\//);
  assert.match(runner, /\["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z", "HEAD"\]/);
  assert.match(runner, /\["ls-files", "-o", "--exclude-standard", "-z"\]/);
  assert.doesNotMatch(runner, /update\(`HEAD\\0\$\{head\}\\0STATUS\\0`\)\.update\(status\)/);
});

test("C34, D22 and K17 keep local fixtures behind explicit production-off boundaries", () => {
  const c34 = read(BACKEND, "src/test/java/ffdd/opsconsole/finance/application/AppPaymentMethodServiceTest.java");
  const d22 = read(BACKEND, "src/test/java/ffdd/opsconsole/finance/application/PayoutVndConfigServiceTest.java");
  const k17 = read(APP, "scripts/kl-sandbox-executor-contract.test.mjs");
  assert.match(c34, /productionService/);
  assert.match(c34, /forged-local-token|forgedLocalToken|idem-forged-local-token/);
  assert.match(c34, /assertThatThrownBy/);
  assert.match(c34, /LOCAL_SANDBOX/);
  assert.match(d22, /providerReady/);
  assert.match(d22, /providerStatusAvailable/);
  assert.match(d22, /D7_PROVIDER_(?:NOT_READY|STATUS_UNAVAILABLE)/);
  assert.match(k17, /production remote mode never falls back to sandbox/);
  assert.match(k17, /JANUS_REMOTE_EXECUTOR_REQUIRED/);
});

test("compound writes and profile updates have independent partial-success and stale-CAS carriers", () => {
  const support = read(BACKEND, "src/test/java/ffdd/opsconsole/content/application/OpsSupportAgentServiceTest.java");
  const client = read(ROOT, "lib/admin/m-client.ts");
  assert.match(support, /batchAdvisorAssignmentValidatesEveryUserBeforeWritingAnything/);
  assert.match(support, /assertThat\(fake\.assignments\)\.isEmpty\(\)/);
  assert.match(support, /batchAdvisorAssignmentWritesEveryUserThroughOneIdempotentCommand/);
  assert.match(support, /profileUpdateRejectsAStaleVersionBeforeMutation/);
  assert.match(client, /expectedVersion/);
  assert.doesNotMatch(
    client,
    /async assignAdvisorUsers[\s\S]{0,900}for \(const userId of normalizedUserIds\)/,
    "M17 must not regress to client-side sequential POSTs",
  );
});

test("M24 treats authorization failure as terminal instead of blind SSE retry", () => {
  const stream = read(ROOT, "lib/admin/use-conversation-stream.ts");
  assert.match(stream, /401|403|UNAUTHORIZED|FORBIDDEN/);
  assert.match(stream, /fatal|terminal|auth/i);
  assert.doesNotMatch(stream, /\?token=/, "SSE JWTs must never be placed in URLs");
  assert.match(stream, /fetch\("\/api\/admin\/auth\/session"[\s\S]{0,500}credentials:\s*"same-origin"/);
  assert.match(stream, /response\.status\s*===\s*401\s*\|\|\s*response\.status\s*===\s*403[\s\S]{0,260}return/);
  assert.match(stream, /Math\.min\([^)]*MAX_RECONNECT_DELAY_MS/);
  assert.match(stream, /setTimeout\(connect,[^)]*delay/);
  assert.doesNotMatch(stream, /es\.onerror[\s\S]{0,250}setTimeout\(connect/,
    "EventSource errors must revalidate the same-origin session before reconnecting");
});

test("outcome-unknown coverage exercises same-key replay rather than copy-only anchors", () => {
  const f = read(ROOT, "tests/f1-direct-pending-store-contract.test.mjs");
  const m1 = read(ROOT, "tests/m1-acceptance-contract.test.mjs");
  const classification = read(ROOT, "tests/outcome-classification-contract.test.mjs");
  assert.match(f, /结果未知|OutcomeUncertain/);
  assert.match(f, /assert\.equal\(seen\[1\], seen\[0\]/);
  assert.match(m1, /reuse the same idempotency key after an unknown outcome/);
  assert.match(classification, /status of \[400, 401, 403, 404, 409, 422, 429, 499\]/);
  assert.match(classification, /status of \[500, 502, 503, 504, 599\]/);
  assert.match(classification, /outcomeStaysUnknown\(0\)/);
});

test("the adversarial script ledger matches every locked test asset", () => {
  assert.ok(existsSync(LEDGER_PATH), "missing adversarial script SHA ledger");
  const entries = readFileSync(LEDGER_PATH, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  assert.equal(entries.length, 3);
  for (const line of entries) {
    const match = line.match(/^([0-9a-f]{64}) \*(.+)$/);
    assert.ok(match, `invalid SHA ledger line: ${line}`);
    const absolute = resolve(ROOT, match[2]);
    assert.ok(existsSync(absolute), `locked adversarial asset is missing: ${absolute}`);
    const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    assert.equal(actual, match[1], `adversarial asset drifted: ${absolute}`);
  }
});
