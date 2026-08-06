import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const a2Client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const proposer = readFileSync(new URL("../lib/admin/propose-or-execute.ts", import.meta.url), "utf8");
const eView = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const k2View = readFileSync(new URL("../app/components/domain-views/k-tabs/k2-arbitrage.tsx", import.meta.url), "utf8");

test("A2 classifies transport, upstream-unknown, 5xx and malformed success as uncertain", () => {
  assert.match(a2Client, /catch \(error\)[\s\S]*new A2OutcomeUncertainError/);
  assert.match(a2Client, /X-Nexion-Upstream-Outcome/);
  assert.match(a2Client, /UPSTREAM_OUTCOME_UNKNOWN/);
  assert.match(a2Client, /response\.ok[\s\S]*result\.code === 0[\s\S]*result\.data == null[\s\S]*A2OutcomeUncertainError/);
  // 2026-08-06 补:platform proxy 只在**自己**超时时补 unknown 头,上游返 5xx 时原样透传不回抄。
  // 少这一路,消费方会把 502/504 当确定性失败弃号 → 重试铸新号 → 同一笔资金动作两张待确认票。
  assert.match(a2Client, /if \(init\?\.commandKey && response\.status >= 500\) \{\s*throw new A2OutcomeUncertainError\(/,
    "A2 缺 5xx 分类会让 E 全域与 H8 结算的「结果未知保号」承诺落空");
  // 命令号已持久化 24h 且 sessionStorage 是 per-tab 的,铸号必须带随机段且兜底 secure context。
  assert.match(a2Client, /typeof crypto\.randomUUID === "function"[\s\S]{0,120}Math\.random\(\)/);
});

test("platform proxy 回抄上游的结果未知标记(A2 全域走这条路)", () => {
  const route = readFileSync(
    new URL("../app/api/admin/platform/[...path]/route.ts", import.meta.url), "utf8");
  // finance / risk / users / janus 四个 proxy 都回抄;platform 此前只 copy Content-Type/Disposition/Length,
  // 于是后端用「200 或 4xx + 该头」表达未知时,客户端恒判确定性失败 → 弃号 → 重试铸新号 → 双票。
  assert.match(route, /const upstreamOutcome = upstream\.headers\.get\("X-Nexion-Upstream-Outcome"\);/);
  assert.match(route, /responseHeaders\.set\("X-Nexion-Upstream-Outcome", upstreamOutcome\)/);
});

test("F 域 toast 路径认「结果未知」族,不把它降级成通用失败文案", () => {
  const fView = readFileSync(
    new URL("../app/components/domain-views/f-view.tsx", import.meta.url), "utf8");
  // F 直写的错误走 toast(不是弹窗),裸 error.message 会上机器码,通用兜底文案更会诱导
  // 运营「检查输入内容后重试」—— 改输入 = 换命令号 = 真的再打一次款。
  assert.match(fView, /error\.name\.endsWith\("OutcomeUncertainError"\)[\s\S]{0,80}operationConfirmErrorMessage\(error\)/);
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
