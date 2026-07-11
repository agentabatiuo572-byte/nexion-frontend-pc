import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  formatNovaDuration,
  parseNovaDuration,
  validateNovaCadence,
} from "../lib/admin/nova-cadence.ts";

test("Nova duration formatting keeps the backend-compatible unit syntax", () => {
  assert.equal(formatNovaDuration("15", "minutes"), "15 min");
  assert.equal(formatNovaDuration("8", "seconds"), "8s");
  assert.equal(formatNovaDuration("24", "hours"), "24h");
  assert.equal(formatNovaDuration("7", "days"), "7d");
});

test("legacy Nova duration text is parsed into a structured value and unit", () => {
  assert.deepEqual(parseNovaDuration("注册 8s", "minutes"), { value: "8", unit: "seconds" });
  assert.deepEqual(parseNovaDuration("15 min", "hours"), { value: "15", unit: "minutes" });
  assert.deepEqual(parseNovaDuration("24小时", "minutes"), { value: "24", unit: "hours" });
  assert.deepEqual(parseNovaDuration("每 25 任务", "minutes"), { value: "", unit: "minutes" });
});

test("Nova cadence requires positive integers and per-user cooldown not shorter than scan interval", () => {
  assert.equal(validateNovaCadence("", "minutes", "24", "hours"), "请填写检查间隔");
  assert.equal(validateNovaCadence("1.5", "hours", "2", "hours"), "检查间隔必须是正整数");
  assert.equal(validateNovaCadence("60", "minutes", "30", "minutes"), "同一用户最短推送间隔不能小于检查间隔");
  assert.equal(validateNovaCadence("10", "minutes", "24", "hours"), null);
});

test("Nova channel drawer uses explicit cadence copy and structured time controls", () => {
  const source = readFileSync(new URL("../app/components/domain-views/i-tabs/i2-nova.tsx", import.meta.url), "utf8");

  assert.match(source, /检查间隔（多久执行一次扫描）/);
  assert.match(source, /同一用户最短推送间隔/);
  assert.match(source, /NOVA_TIME_UNITS\.map/);
  assert.match(source, /CTR 无需填写/);
  assert.doesNotMatch(source, /推完歇多久|每 25 任务|CTR\(%,可留空\)/);
});
