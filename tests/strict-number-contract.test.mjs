import assert from "node:assert/strict";
import test from "node:test";

import { parseStrictFiniteNumber } from "../lib/admin/strict-number.ts";

test("严格数值解析只接受 JSON 数值和非空十进制字符串", () => {
  assert.equal(parseStrictFiniteNumber(5), 5);
  assert.equal(parseStrictFiniteNumber("5"), 5);
  assert.equal(parseStrictFiniteNumber("-1.25"), -1.25);
  assert.equal(parseStrictFiniteNumber(" 0.5 "), 0.5);
});

test("严格数值解析拒绝会被 Number 静默强转的类型和值", () => {
  for (const value of [null, undefined, true, false, "", " ", [], {}, "Infinity", "NaN", "1e3"]) {
    assert.equal(parseStrictFiniteNumber(value), null, `unexpectedly accepted ${JSON.stringify(value)}`);
  }
});
