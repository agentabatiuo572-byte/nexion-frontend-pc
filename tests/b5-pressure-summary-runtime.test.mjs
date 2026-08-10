import assert from "node:assert/strict";
import test from "node:test";

import { summarizePressureHistory } from "../lib/admin/b5-pressure-summary.ts";

test("B5 最新窗口不可计算时不能把旧窗口冒充当前值", () => {
  assert.deepEqual(
    summarizePressureHistory(
      [
        { label: "W-2", ratio: 0.5 },
        { label: "W-1", ratio: 0.625 },
        { label: "当前", ratio: null },
      ],
      null,
    ),
    { latestPct: null, previousComparablePct: 62.5 },
  );
});

test("B5 当前窗口可计算时只与此前最近的可计算窗口比较", () => {
  assert.deepEqual(
    summarizePressureHistory(
      [
        { label: "W-2", ratio: 0.625 },
        { label: "W-1", ratio: null },
        { label: "当前", ratio: 0.7 },
      ],
      0.7,
    ),
    { latestPct: 70, previousComparablePct: 62.5 },
  );
});

test("B5 没有历史窗口时才回退到当前快照", () => {
  assert.deepEqual(
    summarizePressureHistory([], 0.42),
    { latestPct: 42, previousComparablePct: null },
  );
});
