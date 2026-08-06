import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../tests/e2e/d-domain-nonowner-c-final6-core-20260730.spec.ts", import.meta.url),
  "utf8",
);

test("D Final6 非 Owner 核心包将浏览器异常信号分为预期故障与非预期失败", () => {
  assert.match(source, /function assertNoUnexpectedSignals\(/);
  assert.match(source, /consoleErrors:/);
  assert.match(source, /requestFailures:/);
  assert.match(source, /requestFailureEvents/);
  assert.match(source, /responseEvents/);
  assert.match(source, /expectedRequestFailures/);
  assert.match(source, /summarizeRequestFailures\(/);
  assert.match(source, /00-final75-d-cross-gate-signals\.json/);
  assert.match(source, /final75.*assertNoUnexpectedSignals/s);
  assert.match(source, /首次用户.*assertNoUnexpectedSignals/s);
  assert.match(source, /D5.*expectedRequestFailures/s);
  assert.match(source, /faults.*assertNoUnexpectedSignals/s);
});
