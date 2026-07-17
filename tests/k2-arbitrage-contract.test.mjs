import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k2-arbitrage.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const highOps = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const a2Client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");

test("K2 fails closed on stale data and only reloads its own overview", () => {
  const body = component.slice(component.indexOf("export function K2Arbitrage"));
  assert.match(body, /if \(ctx\.contentError\)/);
  assert.ok(body.indexOf("if (ctx.contentError)") < body.lastIndexOf("return ("));
  assert.match(client, /fetchK2ArbitrageOverview/);
  assert.match(kView, /tab === "K2"[\s\S]*fetchK2ArbitrageOverview/);
});

test("K2 exact permissions guard every visible write action", () => {
  assert.match(component, /useAdminAuth/);
  assert.match(component, /risk_k2_write/);
  assert.match(component, /risk_k2_row_flag/);
  assert.match(component, /risk_k2_row_freeze/);
  assert.match(component, /risk_k2_row_blockgift/);
  assert.match(component, /risk_k2_row_boardflag/);
  assert.match(component, /未知动作/);
});

test("K2 direct preventive actions and K1-linked freeze use the correct lifecycle", () => {
  assert.match(component, /executeK2Action\(r\.rowId, "flag"/);
  assert.match(component, /executeK2Action\(r\.rowId, "blockgift"/);
  assert.match(component, /executeK2Action\(r\.rowId, "boardflag"/);
  assert.match(component, /proposeK2Freeze/);
  assert.match(highOps, /k2_row_freeze[\s\S]*clusterExpectedVersion/);
});

test("K2 keeps confirmation open, preserves uncertain command keys, and separates refresh failures", () => {
  assert.doesNotMatch(component, /void runAction/);
  assert.doesNotMatch(component, /void propose\(/);
  assert.match(component, /commandAttempt/);
  assert.match(component, /K1OutcomeUncertainError/);
  assert.match(component, /A2OutcomeUncertainError/);
  assert.match(component, /已写入，但 K2 最新数据回读失败/);
  assert.match(client, /updateK2Param:[\s\S]*commandKey/);
  assert.match(client, /RISK_RESPONSE_BODY_MISSING[\s\S]*K1OutcomeUncertainError/);
  assert.match(a2Client, /!result[\s\S]*A2OutcomeUncertainError\("A2_RESPONSE_UNREADABLE"/);
  assert.match(client, /executeK2Action:[\s\S]*expectedVersion/);
});

test("K2 removes retired holding gates and declares exact OTP boundaries", () => {
  assert.doesNotMatch(component, /minHoldingMonths|最小持仓月份|没满最短持有月|残值 \$0/);
  assert.match(component, /高频下架置换/);
  assert.match(component, /礼金\/返佣叠加/);
  assert.match(component, /min: 30, max: 300/);
  assert.match(component, /min: 1, max: 10/);
  assert.match(component, /min: 60, max: 900, step: 60/);
  assert.match(component, /只影响后续发送/);
  assert.match(component, /已签发验证码/);
  assert.match(component, /updateK2Param\(p\.key, nextValue, p\.version/);
  assert.match(component, /updateK2Param\(definition\.key, backendValue, param\.version/);
  assert.match(client, /withReason\(\{ value, expectedVersion \}, reason\)/);
  assert.match(designKit, /\(numeric - base\) \/ spec\.step/);
  assert.match(designKit, /catch \{[\s\S]*当前输入已保留/);
});

test("K2 headers have one owner and unknown row actions do not default to another action", () => {
  assert.match(component, /current\?\.head/);
  assert.match(component, /action === "boardflag"/);
  assert.doesNotMatch(component, /: <button[^\n]*boardFlag\(r\)/);
});
