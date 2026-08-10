import assert from "node:assert/strict";
import test from "node:test";

import { normalizeC3Adjustment } from "../lib/admin/c3-adjustment-contract.ts";

const valid = {
  adjustmentNo: "ADJ-20260808-1",
  userId: 9,
  asset: "USDT",
  direction: "DEBIT",
  amount: 12.5,
  status: "PENDING_REVIEW",
  credit: false,
};

test("C3 接受与查询状态一致的权威调整记录", () => {
  assert.equal(normalizeC3Adjustment(valid, "PENDING_REVIEW").adjustmentNo, valid.adjustmentNo);
});

test("C3 拒绝空标识、无效用户、负数金额、旧资产/方向/状态", () => {
  for (const mutate of [
    (value) => { value.adjustmentNo = ""; },
    (value) => { value.userId = ""; },
    (value) => { value.userId = 0; },
    (value) => { value.amount = -1; },
    (value) => { value.amount = true; },
    (value) => { value.asset = "OLD"; },
    (value) => { value.direction = "BROKEN"; },
    (value) => { value.status = "UNKNOWN"; },
    (value) => { value.credit = true; },
  ]) {
    const value = { ...valid };
    mutate(value);
    assert.throws(() => normalizeC3Adjustment(value), /C3_RESPONSE_INVALID/);
  }
});

test("C3 拒绝筛选为待复核却混入已批准记录", () => {
  assert.throws(
    () => normalizeC3Adjustment({ ...valid, status: "APPROVED" }, "PENDING_REVIEW"),
    /C3_RESPONSE_INVALID:statusFilter/,
  );
});
