import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertG2AcceptanceSandboxContract,
  classifyCommandOutcome,
} from "../lib/admin/g2-acceptance-sandbox.ts";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("G2 acceptance sandbox must identify mock/SANDBOX and completed/skipped evidence", () => {
  const sandbox = assertG2AcceptanceSandboxContract({
    source: "mock",
    sourceEnvironment: "SANDBOX",
    evidenceComplete: true,
    batch: { batchNo: "SBX-G2-1", status: "QUEUED", replayed: false },
    orders: [
      { exchangeNo: "SBX-G2-1-C", status: "COMPLETED", reasonCode: "", reason: "", amountUsdt: 12.5, sandboxLedgerEntries: 2 },
      { exchangeNo: "SBX-G2-1-S", status: "SKIPPED", reasonCode: "INACTIVE_ATTRIBUTION", reason: "fixture inactive attribution", amountUsdt: 7.5, sandboxLedgerEntries: 0 },
    ],
    ledgerSummary: { completedLedgerEntries: 2, skippedLedgerEntries: 0, productionWalletTouched: false, productionLedgerTouched: false },
  });

  assert.equal(sandbox.sourceEnvironment, "SANDBOX");
  assert.equal(sandbox.orders.filter((row) => row.status === "COMPLETED").length, 1);
  assert.equal(sandbox.orders.filter((row) => row.status === "SKIPPED").length, 1);
});

test("G2 sandbox UI remains absent unless the backend proof is complete", () => {
  assert.throws(() => assertG2AcceptanceSandboxContract({ source: "mock", sourceEnvironment: "SANDBOX" }), /G2_ACCEPTANCE_SANDBOX_RESPONSE_INVALID/);
  const page = read("app/components/domain-views/g-tabs/g2-exchange.tsx");
  const client = read("lib/admin/g2-acceptance-sandbox.ts");
  const route = read("app/api/admin/market/[...path]/route.ts");
  assert.match(page, /Acceptance Sandbox/);
  assert.match(page, /生成验收批次/);
  assert.match(page, /幂等重放/);
  assert.match(client, /sourceEnvironment/);
  assert.match(route, /exchange\/acceptance/);
  assert.match(client, /import \{ guardedFetch \} from "\.\/error-messages\.ts"/);
  assert.doesNotMatch(client, /await fetch\(/, "G2 sandbox 请求必须经 guardedFetch 中文错误咽喉");
});

test("G2 sandbox keeps its command key for every outcome that might have committed", () => {
  assert.equal(classifyCommandOutcome(400), "deterministic-rejection");
  assert.equal(classifyCommandOutcome(200, 1001), "deterministic-rejection");
  assert.equal(classifyCommandOutcome(500), "outcome-unknown");
  assert.equal(classifyCommandOutcome(200), "outcome-unknown");
  assert.equal(classifyCommandOutcome(0), "outcome-unknown");

  const client = read("lib/admin/g2-acceptance-sandbox.ts");
  assert.match(client, /import \{ isDeterministicRejection, outcomeStaysUnknown \} from "\.\/outcome-classification\.ts"/);
  assert.match(client, /if \(result\.outcome === "deterministic-rejection"\) \{\s*replayCommandKey = null;/);
});
