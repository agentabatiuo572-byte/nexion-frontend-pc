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
