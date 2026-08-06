import assert from "node:assert/strict";
import test from "node:test";

import { operationConfirmErrorMessage } from "../lib/admin/operation-confirm-error.ts";

test("OperationConfirmModal surfaces a concrete callback error", () => {
  assert.equal(
    operationConfirmErrorMessage(new Error("参数值未变化，本次未提交")),
    "参数值未变化，本次未提交",
  );
});

test("OperationConfirmModal keeps the generic fallback for blank or unknown failures", () => {
  const fallback = "提交未完成，当前输入已保留，请根据页面提示处理后重试。";

  assert.equal(operationConfirmErrorMessage(new Error("   ")), fallback);
  assert.equal(operationConfirmErrorMessage("network rejected"), fallback);
  assert.equal(operationConfirmErrorMessage(null), fallback);
});

test("A2 uncertain outcomes remain actionable in the persistent confirmation error", () => {
  const error = Object.assign(new Error("UPSTREAM_OUTCOME_UNKNOWN"), {
    name: "A2OutcomeUncertainError",
    commandKey: "e3-command-1",
  });
  assert.match(operationConfirmErrorMessage(error), /结果暂不确定/);
  assert.match(operationConfirmErrorMessage(error), /保留当前弹窗与输入/);
  assert.match(operationConfirmErrorMessage(error), /同一命令号.*e3-command-1/);
  assert.match(operationConfirmErrorMessage(error), /A2 审计/);
});

test("A2 uncertain outcomes survive a duplicated module or serialization boundary", () => {
  const error = Object.assign(new Error("transport wrapper"), {
    name: "A2OutcomeUncertainError",
    commandKey: "shared-command-2",
  });
  assert.match(operationConfirmErrorMessage(error), /同一命令号.*shared-command-2/);
});

test("非 A2 的 *OutcomeUncertainError 也拿到人话指引,但不承诺自动去重", () => {
  // F1 直写 / H8 / K1 / K6 都是这一族。命令号必须给到运营(核对审计要用)。
  for (const name of ["F1OutcomeUncertainError", "H8OutcomeUncertainError", "K1OutcomeUncertainError"]) {
    const error = Object.assign(new Error("F1_REQUEST_FAILED_503"), { name, commandKey: `${name}-k1` });
    const message = operationConfirmErrorMessage(error);
    assert.match(message, /结果暂不确定/);
    assert.match(message, /核对审计记录/);
    assert.match(message, new RegExp(`命令号：${name}-k1`));
    // A3/A1 也带 commandKey 却每次现铸,对全族承诺「系统会复用同一命令号」就是骗运营重试。
    assert.doesNotMatch(message, /系统会复用同一命令号/);
  }
});

test("名字像但没带命令号的错误落回 message 分支(j-client 的应急面就是这形状)", () => {
  const error = Object.assign(new Error("止血指令下发结果未知，请到 J 域核对"), {
    name: "EmergencyOutcomeUncertainError",
  });
  assert.equal(operationConfirmErrorMessage(error), "止血指令下发结果未知，请到 J 域核对");
});
