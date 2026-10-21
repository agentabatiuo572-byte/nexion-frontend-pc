import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("app/components/domain-views/d-tabs/d2-withdrawals.tsx", "utf8");
const ast = ts.createSourceFile("d2.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["statusLabel", "historyStatusLabel", "withdrawalHistoryText", "statusHistoryText"];
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
assert.equal(functions.length, names.length);
const code = ts.transpileModule(functions.map(node => node.getText(ast)).join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const context = vm.createContext({});
vm.runInContext(code, context);

test("mixed withdrawal history uses each order channel, without changing order evidence", () => {
  const input = "WD-B/BANK-VND/SENT/20.000000 USDT@2026-10-16 16:51 | WD-C/TRC20/SENT/21.000000 USDT@2026-09-17 12:13 | WD-F/BANK-VND/TX_FAILED/30.000000 USDT@2026-09-16 18:52";
  assert.equal(context.withdrawalHistoryText(input), input.replace("BANK-VND/SENT", "BANK-VND/银行处理中").replace("TRC20/SENT", "TRC20/已广播").replace("BANK-VND/TX_FAILED", "BANK-VND/代付失败"));
  assert.equal(context.withdrawalHistoryText("WD-O/BANK-VND/TX_ORPHANED/1 USDT@time"), "WD-O/BANK-VND/人工核对/1 USDT@time");
  const orphanedHistory = context.withdrawalHistoryText("WD-C/TRC20/TX_ORPHANED/1 USDT@time");
  assert.equal(orphanedHistory, "WD-C/TRC20/交易处理异常，需人工核对/1 USDT@time");
  assert.doesNotMatch(orphanedHistory, /已退款|已到账|已确认/);
});

test("legacy history never guesses channel from the currently open order", () => {
  assert.equal(context.withdrawalHistoryText("WD-B/SENT/20 USDT@time"), "WD-B/已派发（渠道未提供）/20 USDT@time");
  assert.equal(context.withdrawalHistoryText("WD-B//SENT/20 USDT@time"), "WD-B//已派发（渠道未提供）/20 USDT@time");
  assert.equal(context.withdrawalHistoryText(undefined), "—");
});

test("bank status history distinguishes dispatch from chain submission, including old responses", () => {
  for (const field of ["payout", "chain"]) {
    const actual = context.statusHistoryText(`created:2026-10-16 16:51; status:SENT; ${field}:2026-10-16 16:52; updated:2026-10-16 16:52`, "BANK-VND");
    assert.equal(actual, "提交时间：2026-10-16 16:51；状态：银行处理中；银行派发时间：2026-10-16 16:52；更新时间：2026-10-16 16:52");
    assert.doesNotMatch(actual, /已广播|链上|完成|到账/);
  }
  assert.equal(context.statusHistoryText("status:SENT; chain:time", "TRC20"), "状态：已广播；链上提交时间：time");
  assert.equal(context.statusHistoryText(undefined, "BANK-VND"), "—");
});

test("detail rendering uses dedicated history formatting and channel-aware filter copy", () => {
  assert.match(source, /v=\{withdrawalHistoryText\(detail.withdrawalHistory\)\}/);
  assert.match(source, /v=\{statusHistoryText\(detail.statusHistory, detail.chain\)\}/);
  assert.match(source, /\["SENT", "银行处理中 \/ 链上已广播"\]/);
});
