import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { formatAdminApiError, displayAdminError } from "../lib/admin/error-messages.ts";
import { operationConfirmErrorMessage } from "../lib/admin/operation-confirm-error.ts";
import { outcomeStaysUnknown } from "../lib/admin/outcome-classification.ts";

const expected = "所选优惠券现在不能发放，可能还没生效、已失效或已停用。请在「团队等级晋升」核对奖励选的券，并在「代金券」核对券状态和有效期，处理后再审核原申请。";
const source = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("a2-client.ts", source, ts.ScriptTarget.Latest, true);
const declarations = ast.statements.filter(node => node.name && ["a2Request", "A2OutcomeUncertainError"].includes(node.name.text));
const javascript = ts.transpileModule(declarations.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function client(response) {
  const calls = [];
  const request = new Function("exports", "formatAdminApiError", "outcomeStaysUnknown", "guardedFetch",
    `${javascript}; return a2Request;`)({}, formatAdminApiError, outcomeStaysUnknown, async (...args) => {
      calls.push(args); return response;
    });
  return { request, calls };
}

test("real A2 request and persistent confirmation surface the actionable voucher rejection", async () => {
  const state = client(new Response(JSON.stringify({ code: 409, message: "H7_VOUCHER_NOT_GRANTABLE" }), { status: 409 }));
  let error;
  try { await state.request("/operations/original/approve", { method: "POST", body: "{}", commandKey: "same-command" }); }
  catch (cause) { error = cause; }
  assert.ok(error instanceof Error);
  assert.equal(error.name, "Error");
  assert.equal(displayAdminError(error), expected);
  assert.equal(operationConfirmErrorMessage(error), expected);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0][1].headers.get("Idempotency-Key"), "same-command");
  assert.doesNotMatch(error.message, /H7_VOUCHER_|SELECT|Exception|成功|已发放/);
});

test("diagnostic suffix stays out of the voucher message", () => {
  assert.equal(formatAdminApiError("H7_VOUCHER_NOT_GRANTABLE: internal diagnostic", ""), expected);
});

test("unknown upstream outcome still retains its command and uncertain recovery", async () => {
  const state = client(new Response(JSON.stringify({ code: 504, message: "UPSTREAM_OUTCOME_UNKNOWN" }), { status: 504 }));
  await assert.rejects(state.request("/operations/original/approve", { method: "POST", commandKey: "original-command" }), error => {
    assert.equal(error.name, "A2OutcomeUncertainError");
    assert.match(operationConfirmErrorMessage(error), /结果暂未确认/);
    assert.match(operationConfirmErrorMessage(error), /original-command/);
    assert.doesNotMatch(operationConfirmErrorMessage(error), /优惠券/);
    return true;
  });
});
