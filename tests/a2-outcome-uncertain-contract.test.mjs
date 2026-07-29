import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const a2Client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const proposer = readFileSync(new URL("../lib/admin/propose-or-execute.ts", import.meta.url), "utf8");
const eView = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const k2View = readFileSync(new URL("../app/components/domain-views/k-tabs/k2-arbitrage.tsx", import.meta.url), "utf8");

test("A2 classifies transport, explicit upstream-unknown and malformed success as uncertain", () => {
  assert.match(a2Client, /catch \(error\)[\s\S]*new A2OutcomeUncertainError/);
  assert.match(a2Client, /X-Nexion-Upstream-Outcome/);
  assert.match(a2Client, /UPSTREAM_OUTCOME_UNKNOWN/);
  assert.match(a2Client, /response\.ok[\s\S]*result\.code === 0[\s\S]*result\.data == null[\s\S]*A2OutcomeUncertainError/);
});

test("shared proposer uses the boundary-safe uncertain predicate", () => {
  assert.match(proposer, /isA2OutcomeUncertainError\(error\)/);
  assert.doesNotMatch(proposer, /error instanceof A2OutcomeUncertainError/);
  assert.match(proposer, /结果暂不确定/);
  assert.match(proposer, /同一命令号/);
  assert.match(proposer, /A2 审计/);
});

test("E3 and another A2 caller preserve one command key while the confirmation stays open", () => {
  assert.match(eView, /spec\.commandKey \?\? mc\?\.commandKey/);
  assert.match(eView, /setActionConfirm\(\{ \.\.\.spec, commandKey: spec\.commandKey \?\? createA2CommandKey/);
  assert.match(k2View, /commandAttempt/);
  assert.match(k2View, /isA2OutcomeUncertainError/);
});
