// WD01 is closed only when both controls are editable and consumed by the real withdrawal state machine.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const client = read("lib/admin/d-client.ts");
const page = read("app/components/domain-views/d-tabs/d5-params.tsx");
const registry = read("lib/admin/registry/d.ts");

test("WD01 server projection remains strict and never falls back to browser defaults", () => {
  assert.match(client, /smallAmountThresholdUsd: d5Number\(raw\.smallAmountThresholdUsd/);
  assert.match(client, /payoutSlaHours: d5Integer\(raw\.payoutSlaHours/);
  assert.doesNotMatch(client, /D5_DEFAULT_SMALL_AMOUNT_THRESHOLD/);
  assert.doesNotMatch(client, /D5_DEFAULT_PAYOUT_SLA_HOURS/);
});

test("WD01 exposes validated controls backed by the server-owned fields", () => {
  assert.match(page, /aria-label="小额免审线目标值"/);
  assert.match(page, /aria-label="到账时效目标值"/);
  assert.match(page, /submit\("小额免审线"/);
  assert.match(page, /submit\("到账时效"/);
});

test("WD01 visible page explains the real execution and production finality boundary", () => {
  assert.match(page, /小额免审与到账时效已进入真实提现状态机/);
  assert.match(page, /没有链上终局证明时保留资金/);
  assert.doesNotMatch(page, /尚未形成真实业务闭环|不提供修改|不会显示“已生效”/);
});

test("WD01 registry and H1 copy describe the completed control boundary", () => {
  assert.match(registry, /小额免审.*到账时效.*真实提现状态机/s);
  assert.match(page, /到账审查窗口/);
  assert.doesNotMatch(page.replace(/\/\*[\s\S]*?\*\//g, ""), /提现冷却/);
});

test("WD01 server-origin markers remain available for diagnostics", () => {
  assert.match(client, /"smallAmountThresholdUsd", "payoutSlaHours"/);
  const ownedChanges = client.match(/export type D5OwnedChanges[\s\S]*?;\r?\n/)?.[0] ?? "";
  assert.match(ownedChanges, /smallAmountThresholdUsd/);
  assert.match(ownedChanges, /payoutSlaHours/);
});
