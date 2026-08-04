import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ui = readFileSync(resolve("app/components/domain-views/h-tabs/h2-trial.tsx"), "utf8");
const growthService = readFileSync(
  resolve("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java"),
  "utf8",
);
const trialService = readFileSync(
  resolve("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/AppTrialLifecycleService.java"),
  "utf8",
);
const trialMapper = readFileSync(
  resolve("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/GrowthQuestEventMapper.java"),
  "utf8",
);
const lifecycleMapper = readFileSync(
  resolve("../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/AppTrialLifecycleMapper.java"),
  "utf8",
);
const scheduler = readFileSync(
  resolve("../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/TrialLifecycleScheduler.java"),
  "utf8",
);

test("H2 visible offset cap uses the writable Model A policy and read errors can retry", () => {
  assert.match(ui, /param\.key === "trialOffsetCapUSD"/);
  assert.match(ui, />重试<\/button>/);
  assert.match(growthService, /"trialOffsetCapUSD"/);
  assert.match(growthService, /"discountCapUSD", "trialOffsetCapUSD"/);
});

test("H2 failed is terminal and all admin interventions delegate to the canonical lifecycle", () => {
  assert.match(ui, /\["cancelled", "redeemed", "failed"\]/);
  assert.match(ui, /<th>试用业务号<\/th>/);
  assert.doesNotMatch(ui, /<th>卡 token<\/th>/);
  assert.match(growthService, /Set\.of\("cancelled", "redeemed", "failed"\)/);
  assert.match(growthService, /appTrialLifecycleService\.cancel\(userId, "explicit", idempotencyKey\)/);
  assert.match(growthService, /appTrialLifecycleService\.charge\(userId, idempotencyKey\)/);
});

test("H2 time projection and rewards use real elapsed or settled values", () => {
  assert.match(trialMapper, /expires_at <= NOW\(\) THEN 'grace'/);
  assert.match(trialMapper, /COALESCE\(shadow_accrued_usdt, 0\)/);
  assert.match(trialMapper, /TIMESTAMPDIFF\(SECOND, claimed_at, LEAST\(NOW\(\), expires_at\)\)/);
  assert.match(trialService, /private String effectiveState/);
  assert.match(trialService, /Math\.max\(1, row\.durationDays\(\)/);
  assert.match(trialService, /result\.put\("config", safePolicy\(policy\)\)/);
  assert.doesNotMatch(trialService.match(/private Map<String, Object> safePolicy[\s\S]*?return result;/)?.[0] ?? "", /chargeFailRate/);
});

test("H2 due settlement is server-driven and survives a closed App client", () => {
  assert.match(lifecycleMapper, /List<DueTrialRow> dueTrials/);
  assert.match(lifecycleMapper, /TIMESTAMPADD\(/);
  assert.match(scheduler, /@Scheduled/);
  assert.match(scheduler, /lifecycle\.settleDue/);
  // FEAT-TRIAL02(Signed 2026-07-31)无卡化后自动扣款整链下线 → 不再要求后端实现
  // autoChargeAtEnd 闸门。到期结算本身仍是服务端职责(到点把试用推进到终态,零扣款零下单),
  // 故 cancelOnce("auto_end") 断言保留。
  assert.match(trialService, /cancelOnce\(userId, "auto_end"\)/);
});
