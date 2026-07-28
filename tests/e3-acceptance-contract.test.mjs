import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const e3 = readFileSync(new URL("../app/components/domain-views/e-tabs/e3-lifecycle.tsx", import.meta.url), "utf8");
const manual = readFileSync(new URL("../app/components/domain-views/e-tabs/e3-manual.tsx", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e3-client.ts", import.meta.url), "utf8");
const l4 = readFileSync(new URL("../app/components/domain-views/l-tabs/l4-live-data.ts", import.meta.url), "utf8");

test("E3 treats every FEAT-DEV02 trade-in control as required server-canonical data", () => {
  for (const key of [
    "E.tradein.eligibility",
    "E.tradein.enabled",
    "E.tradein.ladder.cut1",
    "E.tradein.ladder.credit5",
    "E.tradein.requireHigherPrice",
    "E.tradein.maxDevicesPerOrder",
  ]) {
    assert.match(e3, new RegExp(`REQUIRED_E3_KEYS[\\s\\S]*${key.replaceAll(".", "\\.")}`));
  }
  assert.match(e3, /E3 配置不完整/);
  assert.match(client, /tradeinLadderCredit5: "E\.tradein\.ladder\.credit5"/);
});

test("E3 does not expose retired promotion controls as if they changed canonical quotes", () => {
  for (const staleLabel of ["置换活动倍率", "置换弹窗节奏", "库存软上限告警"]) {
    assert.doesNotMatch(e3, new RegExp(staleLabel));
    assert.doesNotMatch(manual, new RegExp(staleLabel));
  }
  assert.doesNotMatch(e3, /E\.tradein\.promo/);
  assert.doesNotMatch(e3, /E\.tradein\.inventorySoftMax/);
});

test("E3 scalar and grouped editors reject no-op and invalid boundary input", () => {
  assert.match(e3, /disallowCurrent: true/);
  assert.match(e3, /current: pE\(key\)/);
  assert.match(e3, /requireAnyChange: true/);
  assert.match(designKit, /requireAnyChange\?: boolean/);
  assert.match(designKit, /至少一个字段须发生变化/);
  assert.match(e3, /min\?: number; max\?: number; step\?: number/);
});

test("E3 D4 failure trace is a real filtered navigation", () => {
  assert.match(e3, /href="\/finance\/ledger\?keyword=tradein&status=FAILED"/);
  assert.doesNotMatch(e3, /打开 D4 bill · 跳转失败 tx 详情/);
});

test("L4 exposes real E3 configuration and trade-in result facts", () => {
  assert.match(l4, /e3ConfigChanges/);
  assert.match(l4, /tradeinApplications/);
  assert.match(l4, /completedTradeins/);
});
