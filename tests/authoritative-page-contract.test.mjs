import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAuthoritativePage } from "../lib/admin/authoritative-page-contract.ts";

test("权威分页接受真实第 2 页和数据收缩后的空第 2 页", () => {
  assert.deepEqual(
    normalizeAuthoritativePage({ total: 6, pageNum: 2, pageSize: 5, records: [{ id: 6 }] }, 2, 5),
    { total: 6, pageNum: 2, pageSize: 5, records: [{ id: 6 }] },
  );
  assert.deepEqual(
    normalizeAuthoritativePage({ total: 0, pageNum: 2, pageSize: 5, records: [] }, 2, 5),
    { total: 0, pageNum: 2, pageSize: 5, records: [] },
  );
});

test("权威分页拒绝缺失、负数、小数和与请求不一致的页码", () => {
  assert.throws(() => normalizeAuthoritativePage({ total: 1, pageSize: 5, records: [] }, 1, 5), /pageNum/);
  assert.throws(() => normalizeAuthoritativePage({ total: -1, pageNum: 1, pageSize: 5, records: [] }, 1, 5), /total/);
  assert.throws(() => normalizeAuthoritativePage({ total: 1.5, pageNum: 1, pageSize: 5, records: [] }, 1, 5), /total/);
  assert.throws(() => normalizeAuthoritativePage({ total: 1, pageNum: 2, pageSize: 5, records: [] }, 1, 5), /pageNum/);
});

test("权威分页拒绝 null、布尔值和空字符串伪装成合法整数", () => {
  assert.throws(() => normalizeAuthoritativePage({ total: null, pageNum: 1, pageSize: 5, records: [] }, 1, 5), /total/);
  assert.throws(() => normalizeAuthoritativePage({ total: 0, pageNum: true, pageSize: 5, records: [] }, 1, 5), /pageNum/);
  assert.throws(() => normalizeAuthoritativePage({ total: 0, pageNum: 1, pageSize: "", records: [] }, 1, 5), /pageSize/);
});

test("权威分页拒绝一页越限、记录数大于总数和过页造数", () => {
  assert.throws(
    () => normalizeAuthoritativePage({ total: 6, pageNum: 1, pageSize: 5, records: Array.from({ length: 6 }) }, 1, 5),
    /records/,
  );
  assert.throws(() => normalizeAuthoritativePage({ total: 0, pageNum: 1, pageSize: 5, records: [{}] }, 1, 5), /records/);
  assert.throws(() => normalizeAuthoritativePage({ total: 1, pageNum: 2, pageSize: 5, records: [{}] }, 2, 5), /records/);
});

test("权威分页拒绝把漏行或空的有效页伪装成完整分页", () => {
  assert.throws(
    () => normalizeAuthoritativePage({ total: 6, pageNum: 1, pageSize: 5, records: [{}] }, 1, 5),
    /records/,
  );
  assert.throws(
    () => normalizeAuthoritativePage({ total: 6, pageNum: 2, pageSize: 5, records: [] }, 2, 5),
    /records/,
  );
});
