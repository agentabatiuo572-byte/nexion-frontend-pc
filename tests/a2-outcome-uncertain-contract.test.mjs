import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";

const a2Client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const proposer = readFileSync(new URL("../lib/admin/propose-or-execute.ts", import.meta.url), "utf8");
const eView = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const k2View = readFileSync(new URL("../app/components/domain-views/k-tabs/k2-arbitrage.tsx", import.meta.url), "utf8");

// Execute the production JSX and handler, rather than a separate permission model.
function withdrawalFixture(authorities, { role = "auditor", sessionPresent = true } = {}) {
  const view = readFileSync(new URL("../app/components/domain-views/a-tabs/a2-audit.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("a2-audit.tsx", view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const picked = {};
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ["normalizeOperatorIdentity", "isCurrentOperator"].includes(node.name?.text)) {
      picked[node.name.text] = node.getText(source);
    }
    if (ts.isVariableDeclaration(node) && ["principal", "canWithdraw", "withdrawWo"].includes(node.name.getText(source))) {
      picked[node.name.getText(source)] = `const ${node.getText(source)};`;
    }
    if (ts.isConditionalExpression(node) && node.condition.getText(source) === "isFinal" && node.getText(source).includes("withdrawWo(w)")) {
      picked.row = node.getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const key of ["normalizeOperatorIdentity", "isCurrentOperator", "principal", "withdrawWo", "row"]) {
    assert.ok(picked[key], `missing production ${key}`);
  }
  const body = [picked.normalizeOperatorIdentity, picked.isCurrentOperator, picked.principal,
    picked.canWithdraw ?? "", picked.withdrawWo,
    `module.exports = { row: () => (${picked.row}), withdraw: withdrawWo };`].join("\n");
  const compiled = ts.transpileModule(body, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const calls = { confirmations: [], commands: [], toasts: [], keys: 0, reads: 0, approvals: 0, rejections: 0 };
  const row = { id: "WO-OFFLINE-PENDING", operator: "fixture-maker", mine: true, status: "pending", phoneCalibrationError: null };
  const context = {
    module: { exports: {} }, exports: {},
    require: (id) => { assert.equal(id, "react/jsx-runtime"); return jsxRuntime; },
    session: sessionPresent ? { operator: "fixture-maker", username: "fixture-maker", role, authorities } : null,
    operator: "fixture-maker", w: row, isFinal: false, status: "pending",
    canApprove: authorities?.includes("platform_a2_operation_approve") ?? false,
    HIST_TONE: {}, HIST_LABEL: {}, reasonMin: 8,
    approveWo: () => { calls.approvals++; }, rejectWo: () => { calls.rejections++; },
    createA2CommandKey: () => `offline-command-${++calls.keys}`,
    openActionConfirm: (request) => calls.confirmations.push(request),
    withdrawA2Operation: async (...args) => { calls.commands.push(args); if (fixture.error) throw fixture.error; },
    refreshOverview: async () => { calls.reads++; return fixture.readback; },
    toast: (message) => calls.toasts.push(message), displayAdminError: (error) => error.message,
  };
  const fixture = { calls, row, context, error: null, readback: { operationQueue: [{ id: row.id, status: "withdrawn" }], operationHistory: [] } };
  runInNewContext(compiled.outputText, context, { filename: "a2-audit-withdrawal-production.tsx" });
  return { ...fixture, get readback() { return fixture.readback; }, set readback(value) { fixture.readback = value; },
    get error() { return fixture.error; }, set error(value) { fixture.error = value; }, ...context.module.exports };
}

test("A2 same-maker read-only withdrawal is disabled without falling through to self-approval", () => {
  for (const authorities of [["platform_a2_read"], ["platform_a2_read", "platform_a2_write"],
    ["platform_a2_read", "platform_a2_operation_approve"], [], null]) {
    const fixture = withdrawalFixture(authorities);
    const action = fixture.row();
    assert.equal(action.type, "button");
    assert.equal(action.props.children, "撤回本人提案");
    assert.equal(action.props.disabled, true);
    assert.match(renderToStaticMarkup(action), /disabled=""/);
    assert.equal(fixture.calls.approvals, 0);
  }
  assert.equal(withdrawalFixture([], { sessionPresent: false }).row().props.disabled, true);
  assert.equal(withdrawalFixture([], { role: "superadmin" }).row().props.disabled, true, "role alone is not the required grant");
});

test("A2 read-only direct withdrawal handler stops before confirmation or command allocation", () => {
  const fixture = withdrawalFixture(["platform_a2_read"]);
  fixture.withdraw(fixture.context.w);
  assert.equal(fixture.calls.confirmations.length, 0);
  assert.equal(fixture.calls.keys, 0);
  assert.equal(fixture.calls.commands.length, 0);
  assert.equal(fixture.calls.reads, 0);
  assert.equal(fixture.calls.toasts.length, 1);
});

test("A2 proposal-create maker preserves confirmation, exact command and canonical readback", async () => {
  const fixture = withdrawalFixture(["platform_a2_read", "platform_a2_proposal_create"]);
  const action = fixture.row();
  assert.notEqual(action.props.disabled, true);
  let stopped = false;
  action.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
  const confirmation = fixture.calls.confirmations[0];
  assert.equal(confirmation.reasonMin, 8);
  assert.equal(confirmation.reasonMax, 200);
  assert.equal(confirmation.amplifies, false);
  await confirmation.run("offline withdrawal reason");
  assert.deepEqual(fixture.calls.commands, [["WO-OFFLINE-PENDING", "offline withdrawal reason", "fixture-maker", "offline-command-1"]]);
  assert.equal(fixture.calls.reads, 1);
  assert.match(fixture.calls.toasts[0], /已撤回/);
  assert.equal(fixture.calls.approvals + fixture.calls.rejections, 0);
});

test("A2 permitted withdrawal unknown response preserves explicit same-key retry and no false success", async () => {
  const fixture = withdrawalFixture(["platform_a2_proposal_create"]);
  fixture.withdraw(fixture.context.w);
  fixture.error = Object.assign(new Error("UPSTREAM_OUTCOME_UNKNOWN"), { status: 504 });
  const confirmation = fixture.calls.confirmations[0];
  await assert.rejects(confirmation.run("offline withdrawal reason"), (error) => error === fixture.error);
  assert.equal(fixture.calls.commands.length, 1, "no automatic retry");
  assert.equal(fixture.calls.reads, 0);
  assert.match(fixture.calls.toasts[0], /^撤回失败/);
  fixture.error = null;
  await confirmation.run("offline withdrawal reason");
  assert.equal(fixture.calls.commands.length, 2);
  assert.equal(fixture.calls.commands[0][3], fixture.calls.commands[1][3]);
  assert.equal(fixture.calls.keys, 1);
  assert.equal(fixture.calls.reads, 1);
});

test("A2 permitted withdrawal still propagates 403 and rejects unconfirmed readback", async () => {
  const fixture = withdrawalFixture(["platform_a2_proposal_create"]);
  fixture.withdraw(fixture.context.w);
  fixture.error = Object.assign(new Error("FORBIDDEN"), { status: 403 });
  const confirmation = fixture.calls.confirmations[0];
  await assert.rejects(confirmation.run("offline withdrawal reason"), (error) => error === fixture.error);
  assert.equal(fixture.calls.reads, 0);
  fixture.error = null;
  fixture.readback = { operationQueue: [], operationHistory: [] };
  await assert.rejects(confirmation.run("offline withdrawal reason"), /A2_WITHDRAW_WRITE_NOT_CONFIRMED/);
  assert.equal(fixture.calls.toasts.every((message) => message.startsWith("撤回失败")), true);
});

test("A2 terminal and other-maker actions retain their original permission boundaries", () => {
  const fixture = withdrawalFixture(["platform_a2_proposal_create"]);
  fixture.context.isFinal = true;
  fixture.context.status = "withdrawn";
  assert.equal(fixture.row().type, "span");
  assert.equal(fixture.row().props.onClick, undefined);
  fixture.context.isFinal = false;
  fixture.context.w.mine = false;
  fixture.context.w.operator = "fixture-other";
  assert.equal(fixture.row().type, "span");
  fixture.context.canApprove = true;
  const otherMaker = fixture.row();
  otherMaker.props.children[0].props.onClick({ stopPropagation() {} });
  assert.equal(fixture.calls.approvals, 1);
  assert.equal(fixture.calls.confirmations.length, 0);
});

test("A2 classifies transport, upstream-unknown, 5xx and malformed success as uncertain", () => {
  assert.match(a2Client, /catch \(error\)[\s\S]*new A2OutcomeUncertainError/);
  assert.match(a2Client, /X-Nexion-Upstream-Outcome/);
  assert.match(a2Client, /UPSTREAM_OUTCOME_UNKNOWN/);
  assert.match(a2Client, /response\.ok[\s\S]*result\.code === 0[\s\S]*result\.data == null[\s\S]*A2OutcomeUncertainError/);
  // 2026-08-06 补:platform proxy 只在**自己**超时时补 unknown 头,上游返 5xx 时原样透传不回抄。
  // 少这一路,消费方会把 502/504 当确定性失败弃号 → 重试铸新号 → 同一笔资金动作两张待确认票。
  assert.match(a2Client, /if \(!response\.ok \|\| !result \|\| result\.code !== 0\) \{[\s\S]*?outcomeStaysUnknown\(response\.status, result\?\.code\)[\s\S]*?throw new A2OutcomeUncertainError\(/,
    "A2 缺 5xx 分类会让 E 全域与 H8 结算的「结果未知保号」承诺落空");
  assert.doesNotMatch(a2Client, /if \(init\?\.commandKey && outcomeStaysUnknown\(response\.status\)\)/,
    "已解析 code=0 后再只看 HTTP 状态会把真实成功误报为结果未知");
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
