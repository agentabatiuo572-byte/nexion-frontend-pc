import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canonicalE3ConfigTargetId, findHighOp } from "../lib/admin/high-ops-registry.ts";

const e3 = readFileSync(new URL("../app/components/domain-views/e-tabs/e3-lifecycle.tsx", import.meta.url), "utf8");
const eView = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const eTypes = readFileSync(new URL("../app/components/domain-views/e-tabs/types.ts", import.meta.url), "utf8");
const manual = readFileSync(new URL("../app/components/domain-views/e-tabs/e3-manual.tsx", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e3-client.ts", import.meta.url), "utf8");
const l4 = readFileSync(new URL("../app/components/domain-views/l-tabs/l4-live-data.ts", import.meta.url), "utf8");
const backendE3 = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/device/application/OpsDeviceService.java", import.meta.url),
  "utf8",
);

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

test("E3 write controls require the exact device_e3_write authority", () => {
  assert.match(eView, /authorities\.includes\("device_e3_write"\)/);
  assert.match(eTypes, /canWriteE3: boolean/);
  assert.match(e3, /ctx\.canWriteE3[\s\S]*?<button className=\{`adj/);
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

test("E3 A2 object locks use the same canonical key as backend direct-write checks", () => {
  const scalar = findHighOp("e3_config");
  const batch = findHighOp("e3_config_batch");
  assert.ok(scalar);
  assert.ok(batch);

  const frontendKey = "E.device.capacity.subsidyDays";
  const canonicalKey = "capacitySubsidyDays";
  assert.equal(canonicalE3ConfigTargetId(frontendKey), canonicalKey);
  assert.equal(scalar.buildTarget({ key: frontendKey }).id, canonicalKey);
  assert.deepEqual(
    batch.buildTargets?.({
      values: {
        "E.tradein.ladder.cut1": "24",
        [frontendKey]: "31",
      },
    }).map((target) => target.id),
    [canonicalKey, "tradeinLadderCut1"],
  );
  assert.equal(
    batch.buildTarget({ values: { [frontendKey]: "31" } }).id,
    canonicalKey,
  );

  assert.match(
    backendE3,
    /key = normalizeE3Key\(request\.key\(\)\);[\s\S]*countActiveByTarget\("E", "device_e3_config", key\)[\s\S]*ApiResult\.fail\(409, "OBJECT_LOCKED_BY_A2"\)/,
  );
  for (const target of [
    scalar.buildTarget({ key: frontendKey }),
    ...(batch.buildTargets?.({ values: { [frontendKey]: "31" } }) ?? []),
  ]) {
    assert.doesNotMatch(target.id, /^E\.(?:device|tradein|release)\./);
  }
});

test("E3 operator copy stays in business language and does not expose implementation details", () => {
  for (const source of [e3, manual]) {
    assert.doesNotMatch(source, /server-canonical/i);
    assert.doesNotMatch(source, /nx_user_device/);
    assert.doesNotMatch(source, /\/api\/admin\//);
  }
  assert.match(e3, /当前在网设备平均使用时长/);
  assert.match(e3, /升级置换运行记录/);
  assert.match(e3, /所有步骤一起完成，失败时不会留下半成品/);
});
