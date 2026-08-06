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

/**
 * 2026-08-06:E 域从「弹窗打开时铸号存组件态」(`spec.commandKey ?? mc?.commandKey`)迁到共享
 * SlotAttemptStore。原断言钉的是那个被替换掉的半措施,意图不变但更强 —— 命令号现在落
 * sessionStorage,一次确认里的重试复用同号,**刷新页面后仍然复用**。
 * 逐点接线细节见 tests/e-pending-store-contract.test.mjs,这里只守「E 与另一个 A2 调用方都用
 * 持久 store + 边界安全判据」这条跨域不变量。
 */
test("E3 and another A2 caller preserve one command key across retries and reloads", () => {
  assert.match(eView, /createSlotAttemptStore\(\{ storageKey: "nexion-admin-e-domain-commands-v1" \}\)/);
  assert.match(eView, /commandAttempts\.resolve\(slot, fingerprint,/);
  assert.match(eView, /isA2OutcomeUncertainError\(error\)/);
  assert.doesNotMatch(eView, /error instanceof A2OutcomeUncertainError/);
  // 弹窗态命令号不得回潮:setActionConfirm 再挂 commandKey 就是刷新即丢的老形态。
  assert.doesNotMatch(eView, /setActionConfirm\(\{ \.\.\.spec, commandKey/);
  assert.match(k2View, /commandAttempt/);
  assert.match(k2View, /isA2OutcomeUncertainError/);
});
