import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("learning observer shows every downstream production delta and never renders a violation as green", async () => {
  const page = await readFile(
    new URL("../app/_console/overview/learning-acceptance/page.tsx", import.meta.url),
    "utf8",
  );

  for (const field of ["progress", "event", "reward", "earningsRelease", "walletLedger", "outbox", "adminIdempotency", "catalogVersion", "catalogAdminIdempotency", "catalogAudit", "catalogOutbox"]) {
    assert.match(page, new RegExp(`\\b${field}\\??:`));
    assert.match(page, new RegExp(`productionDelta\\.${field}`));
  }
  assert.match(page, /productionDelta\.status === "VERIFIED_ZERO"/);
  assert.match(page, /Production delta \{state\.productionDelta\.status\}/);
  assert.match(page, /LEARNING_ACCEPTANCE_PROOF_INVALID/);
  assert.match(page, /candidate\.runId !== runId/);
  assert.match(page, /candidate\.source !== "mock"/);
  assert.match(page, /candidate\.sourceEnvironment !== "SANDBOX"/);
  assert.match(page, /candidate\.productionDelta\?\.\[field\] !== 0/);
});

test("learning acceptance catalog publishes only a run-scoped sandbox definition", async () => {
  const page = await readFile(
    new URL("../app/_console/overview/learning-acceptance/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(page, /learning-acceptance\/catalog/);
  assert.match(page, /runId=\$\{encodeURIComponent\(runId\)\}/);
  assert.match(page, /mock\/SANDBOX/);
  assert.match(page, /Publish acceptance course/);
  assert.match(page, /Idempotency-Key/);
  assert.match(page, /localStorage\.getItem/);
  assert.match(page, /catalog\/command-result/);
  assert.match(page, /durable command receipt/);
  assert.match(page, /receiptFor\(saveKey,/);
  assert.match(page, /receiptFor\(publishKey,/);
  assert.match(page, /outer\.data\?\.committed === true/);
  assert.match(page, /outer\.data\?\.succeeded === true/);
  assert.match(page, /successfulReceipt\(publishReceipt\) && published/);
  assert.match(page, /LEARNING_SANDBOX_CATALOG_PUBLISH_PROOF_MISSING/);
  assert.match(page, /failedReceipt\(publishReceipt\)/);
  assert.match(page, /localStorage\.removeItem\(`learning-acceptance:\$\{runId\}:publish`\)/);
  assert.match(page, /expectedRevision=\$\{revision\}/);
  assert.match(page, /LEARNING_SANDBOX_CATALOG_REVISION_UNAVAILABLE/);
  assert.match(page, /LEARNING_SANDBOX_CATALOG_PUBLISH_FAILED/);
  assert.doesNotMatch(page, /i18n-learning/);
});

test("learning acceptance observer is reachable through the public console route", async () => {
  const route = await readFile(
    new URL("../app/acceptance/learning/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /ConsoleLayout/);
  assert.match(route, /LearningAcceptanceObservationPage/);
  assert.match(route, /<LearningAcceptanceObservationPage\s*\/>/);
});
