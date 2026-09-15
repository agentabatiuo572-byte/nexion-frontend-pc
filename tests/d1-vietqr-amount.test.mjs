import assert from "node:assert/strict";
import test from "node:test";
import { d1VietQrUsdtAmount } from "../lib/admin/d1-vietqr-amount.ts";

const pending = (changes = {}) => ({ viewType: "INFLIGHT", status: "OPEN",
  payableVnd: 897260, receivedVnd: null, lockedFxRateVndPerUsdt: 26390,
  creditedUsdt: 0, ...changes });

test("unpaid intent displays 34 expected USDT without inventing wallet credit", () => {
  const row = Object.freeze(pending());
  assert.equal(d1VietQrUsdtAmount(row), 34);
  assert.equal(row.creditedUsdt, 0);
  assert.equal(row.receivedVnd, null);
  assert.equal(row.status, "OPEN");
});

test("credited row uses actual credited USDT rather than recalculating a different receipt amount", () => {
  assert.equal(d1VietQrUsdtAmount(pending({ viewType: "MATCHED", status: "CREDITED",
    receivedVnd: 897260, creditedUsdt: 33 })), 33);
  assert.equal(d1VietQrUsdtAmount(pending({ viewType: "MATCHED", status: "CREDITED",
    payableVnd: 870870, receivedVnd: 870870, creditedUsdt: 33 })), 33);
});

test("uncredited receipts convert actual received VND, not requested or credited amounts", () => {
  for (const viewType of ["MATCHED", "ORPHAN", "MISMATCH", "LATE"]) {
    assert.equal(d1VietQrUsdtAmount(pending({ viewType, receivedVnd: 870870 })), 33);
  }
});

test("missing amount is unknown rather than zero or an unrelated requested amount", () => {
  assert.equal(d1VietQrUsdtAmount(pending({ payableVnd: null })), null);
  assert.equal(d1VietQrUsdtAmount(pending({ viewType: "ORPHAN" })), null);
});

test("invalid amounts and exchange rates never render NaN or infinity", () => {
  for (const changes of [{ lockedFxRateVndPerUsdt: 0 }, { lockedFxRateVndPerUsdt: -1 },
    { lockedFxRateVndPerUsdt: NaN }, { payableVnd: -1 }, { payableVnd: Infinity }]) {
    assert.equal(d1VietQrUsdtAmount(pending(changes)), null);
  }
});
