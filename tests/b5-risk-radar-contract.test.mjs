import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatB5RiskLight,
  formatB5WithdrawalState,
} from "../lib/admin/b5-display-labels.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const client = read("../lib/admin/b5-client.ts");
const contract = read("../lib/admin/b5-radar-contract.ts");
const page = read("../app/_console/overview/risk-radar/page.tsx");

test("B5 uses its independent fail-closed API and fixed e(t) redline", () => {
  assert.match(client, /\/api\/admin\/risk\/radar/);
  assert.match(client, /normalizeB5Radar, PRESSURE_RED_LINE/);
  assert.match(contract, /PRESSURE_RED_LINE\s*=\s*0\.7/);
  assert.match(client, /setData\(null\)/);
  assert.match(contract, /B5_RESPONSE_INVALID/);
  assert.doesNotMatch(page, /useBDomainDashboard/);
});

test("B5 validates all five canonical dimensions and excludes geo-block", () => {
  for (const state of ["submitted", "review-passed", "processing"]) {
    assert.match(contract, new RegExp(`"${state}"`));
  }
  for (const gate of ["withdraw", "staking", "genesis", "exchange", "trial"]) {
    assert.match(contract, new RegExp(`"${gate}"`));
  }
  assert.match(contract, /geo-block/);
  assert.match(contract, /invalid\("killSwitches"\)/);
  for (const label of ["挤兑预警", "异常账户", "提现队列积压", "功能闸", "兑付覆盖率"]) {
    assert.match(page, new RegExp(label));
  }
});

test("B5 exposes threshold preview, optimistic version, audit triage and persistent subscriptions", () => {
  assert.match(client, /\/api\/admin\/risk\/bankrun-thresholds\/preview/);
  assert.match(client, /expectedVersion/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /\/api\/admin\/risk\/radar\/triage/);
  assert.match(client, /\/api\/admin\/risk\/alert-subscription/);
  for (const channel of ["inApp", "email", "webhook"]) {
    assert.match(page, new RegExp(channel));
  }
  assert.match(page, /reason\.trim\(\)\.length\s*>=\s*8/);
  assert.match(page, /redPct\s*>\s*yellowPct/);
});

test("B5 exhaustively localizes risk lights and D2 states without leaking unknown internal codes", () => {
  assert.deepEqual(
    ["green", "yellow", "red"].map(formatB5RiskLight),
    ["正常", "关注", "告警"],
  );
  assert.deepEqual(
    ["submitted", "review-passed", "processing"].map(formatB5WithdrawalState),
    ["已提交", "审核通过", "处理中"],
  );
  assert.equal(formatB5RiskLight("future-light"), "未知");
  assert.equal(formatB5RiskLight(null), "未知");
  assert.equal(formatB5WithdrawalState("future-state"), "不可用");
  assert.equal(formatB5WithdrawalState(undefined), "不可用");

  assert.match(page, /formatB5RiskLight\(data\.bankrun\.light\)/);
  assert.match(page, /formatB5RiskLight\(data\.coverage\.light\)/);
  assert.match(page, /formatB5WithdrawalState\(item\.state\)/);
  assert.doesNotMatch(page, />\{data\.bankrun\.light\}</);
  assert.doesNotMatch(page, />\{data\.coverage\.light\}</);
  assert.doesNotMatch(page, />\{item\.state\}</);
});

test("B5 threshold preview reuses the fail-closed risk-light label instead of exposing server codes", () => {
  assert.match(
    page,
    /新阈值下灯色为\s*<b>\{formatB5RiskLight\(preview\.light\)\}<\/b>/,
  );
  assert.doesNotMatch(
    page,
    /新阈值下灯色为\s*<b>\{preview\.light\}<\/b>/,
  );
});
