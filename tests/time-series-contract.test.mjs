import assert from "node:assert/strict";
import test from "node:test";

import {
  isConsecutiveDayLabels,
  isConsecutiveMonthLabels,
  isIncreasingIsoWeekLabels,
} from "../lib/admin/time-series-contract.ts";

test("时间序列接受跨月、跨年连续日和月标签", () => {
  assert.equal(isConsecutiveDayLabels(["12-30", "12-31", "01-01"]), true);
  assert.equal(isConsecutiveDayLabels(["2026-07-31", "2026-08-01"]), true);
  assert.equal(isConsecutiveMonthLabels(["2025-12", "2026-01", "2026-02"]), true);
});

test("时间序列拒绝非法日期、乱序、重复和断档", () => {
  assert.equal(isConsecutiveDayLabels(["02-30", "03-01"]), false);
  assert.equal(isConsecutiveDayLabels(["08-02", "08-01"]), false);
  assert.equal(isConsecutiveDayLabels(["2026-08-01", "2026-08-03"]), false);
  assert.equal(isConsecutiveMonthLabels(["2026-01", "2026-03"]), false);
});

test("ISO 周标签必须真实且严格递增，允许无注册周形成空档", () => {
  assert.equal(isIncreasingIsoWeekLabels(["2025-W52", "2026-W01", "2026-W03"]), true);
  assert.equal(isIncreasingIsoWeekLabels(["2026-W02", "2026-W01"]), false);
  assert.equal(isIncreasingIsoWeekLabels(["2026-W54"]), false);
});
