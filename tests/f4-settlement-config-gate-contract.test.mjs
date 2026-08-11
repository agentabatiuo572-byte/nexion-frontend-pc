import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validateF4SettlementConfig } from "../lib/admin/f4-settlement-config.ts";

const validConfig = {
  status: "READY",
  unavailableKey: "",
  configVersion: "7",
  ratio: "5%",
  monthlyCap: "$5,000",
  unlockVRank: "V3",
  settleCron: "0 59 23 * * 0",
};

test("F4 settlement gate rejects every missing backend-guard key", () => {
  const backendKeys = {
    configVersion: "F.pool.configVersion",
    ratio: "F.pool.ratio",
    monthlyCap: "F.pool.monthlyCap",
    unlockVRank: "F.pool.unlockVRank",
    settleCron: "F.pool.settleCron",
  };
  for (const [key, unavailableKey] of Object.entries(backendKeys)) {
    const candidate = { ...validConfig, status: "HOLD", unavailableKey, [key]: "" };
    const result = validateF4SettlementConfig(candidate);
    assert.equal(result.ready, false, `${key} missing must hold settlement`);
    assert.ok(result.issues.some((issue) => issue.key === key));
  }
});

test("F4 settlement gate rejects polluted values using backend guard boundaries", () => {
  const polluted = {
    configVersion: ["0", "-1", "1.5", "legacy"],
    ratio: ["1x3", "31%", "6%%", "1e1"],
    monthlyCap: ["-1", "five thousand", "__UNCONFIGURED__"],
    unlockVRank: ["V0", "V13", "V3+", "__UNCONFIGURED__"],
    settleCron: ["not-a-cron", "0 99 * * * *", "*/0 * * * * *", "__UNCONFIGURED__"],
  };

  const backendKeys = {
    configVersion: "F.pool.configVersion",
    ratio: "F.pool.ratio",
    monthlyCap: "F.pool.monthlyCap",
    unlockVRank: "F.pool.unlockVRank",
    settleCron: "F.pool.settleCron",
  };

  for (const [key, values] of Object.entries(polluted)) {
    for (const value of values) {
      const result = validateF4SettlementConfig({
        ...validConfig,
        status: "HOLD",
        unavailableKey: backendKeys[key],
        [key]: value,
      });
      assert.equal(result.ready, false, `${key}=${value} must hold settlement`);
      assert.ok(result.issues.some((issue) => issue.key === key));
    }
  }
});

test("F4 settlement gate recovers only after all five authoritative values are valid", () => {
  const blocked = validateF4SettlementConfig({
    ...validConfig,
    status: "HOLD",
    unavailableKey: "F.pool.settleCron",
    settleCron: "",
  });
  const recovered = validateF4SettlementConfig(validConfig);

  assert.equal(blocked.ready, false);
  assert.equal(recovered.ready, true);
  assert.deepEqual(recovered.issues, []);
});

test("first-time operator sees an in-place repair and refresh contract", () => {
  const tab = readFileSync(
    new URL("../app/components/domain-views/f-tabs/f4-ops.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(tab, /F\.pool\.settleCron"\]\s*\?\?\s*"0 23 \* \* 0"/);
  assert.doesNotMatch(tab, /F\.pool\.unlockVRank"\]\s*\?\?\s*"V3"/);
  assert.match(tab, /领导奖池结算配置不可用/);
  assert.match(tab, /配置入口就在本卡片下方/);
  assert.match(tab, /重新读取配置/);
  assert.match(tab, /刷新失败.*旧配置/s);
  assert.match(
    tab,
    /disabled=\{!settlementOperable\}[^>]*onClick=\{\(\) => ctx\.openActionConfirm\(\{\s*name: "提前结算本周领导奖池"/s,
  );
  assert.match(tab, /void ctx\.refreshF4\(\)/);
});
