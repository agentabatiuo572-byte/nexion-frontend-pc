import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../app/components/domain-views/h-tabs/h1-phase.tsx", import.meta.url),
  "utf8",
);

test("H1 当前节奏位置只提交真实变化字段，避免重复审计与事件", () => {
  assert.match(page, /const currentMonthChanged =/);
  assert.match(page, /const progressChanged =/);
  assert.match(page, /if \(!currentMonthChanged && !progressChanged\)/);
  assert.match(page, /当前节奏位置未变化，本次未提交/);
  assert.match(page, /if \(currentMonthChanged\)[\s\S]*?updateH1RhythmParam\("currentMonth"/);
  assert.match(page, /if \(progressChanged\)[\s\S]*?updateH1RhythmParam\("phaseProgressPct"/);
});

test("H1 月度旋钮按方向识别资金放大，合规开关只在关闭时提示", () => {
  assert.match(page, /const amplifiesWhen: "decrease" \| "increase"/);
  assert.match(page, /\["withdrawCooldownDays", "withdrawPenaltyFeeRate"\]\.includes\(key\)/);
  assert.match(page, /amplifies: isComplianceToggle && current === "是"/);
  assert.match(page, /\{ kind: "text", current, amplifiesWhen \}/);
});
