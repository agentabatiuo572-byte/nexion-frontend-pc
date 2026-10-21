import assert from "node:assert/strict";
import test from "node:test";
import { formatD4Remark, formatD4Subtype } from "../lib/admin/d4-ledger-display.ts";

test("staking principal return has an explicit redemption subtype", () => {
  assert.equal(formatD4Subtype("STAKING_EARLY_WITHDRAW"), "质押提前赎回");
});

test("repurchase principal return has an explicit exit subtype", () => {
  assert.equal(formatD4Subtype("repurchase_early_withdraw"), "复投提前退出");
});

test("staking return remark explains principal and forfeited interest while preserving source", () => {
  const raw = "G1 early withdrawal net principal; unearned interest forfeited";
  assert.deepEqual(formatD4Remark(raw), {
    label: "质押提前赎回 · 返还扣除罚金后的本金，未获得的利息作废",
    technical: raw,
  });
});

test("repurchase return remark explains principal and forfeited benefits while preserving source", () => {
  const raw = "G7 early withdrawal net principal; interest and tickets forfeited";
  assert.deepEqual(formatD4Remark(raw), {
    label: "复投提前退出 · 返还扣除罚金后的本金，利息与抽奖券作废",
    technical: raw,
  });
});

test("ordinary withdrawal and refund retain their existing labels", () => {
  assert.equal(formatD4Subtype("withdrawal"), "提现");
  assert.equal(formatD4Subtype("withdraw_refund"), "提现退款");
  assert.equal(formatD4Remark("D2 withdrawal net principal").label, "提现 · 净额本金");
});

test("unknown event identifiers are not guessed as principal returns", () => {
  assert.equal(formatD4Subtype("OTHER_EARLY_WITHDRAW"), "其他业务");
  assert.notEqual(formatD4Remark("G7 unknown event").label, "复投提前退出");
});
