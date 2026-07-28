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
