import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pcClientPath = new URL("../lib/admin/h-client.ts", import.meta.url);
const pcViewPath = new URL("../app/components/domain-views/h-tabs/h3-quest-events.tsx", import.meta.url);
const pcDesignKitPath = new URL("../app/components/domain-views/design-kit.tsx", import.meta.url);
const backendControllerPath = new URL(
  "../../nexion-backend/src/main/java/ffdd/opsconsole/growth/web/AppGrowthEngagementController.java",
  import.meta.url,
);
const backendServicePath = new URL(
  "../../nexion-backend/src/main/java/ffdd/opsconsole/growth/application/OpsGrowthService.java",
  import.meta.url,
);
const backendMapperPath = new URL(
  "../../nexion-backend/src/main/java/ffdd/opsconsole/growth/mapper/GrowthQuestEventMapper.java",
  import.meta.url,
);
const appEventStorePath = new URL("../../NX1.0/src/store/event-quest.ts", import.meta.url);
const appSpinStorePath = new URL("../../NX1.0/src/store/lucky-spin.ts", import.meta.url);
const appEventsApiPath = new URL("../../NX1.0/src/api/events-api.ts", import.meta.url);

test("H4 PC commands carry stale-write evidence and use the H4 wheel guard contract", async () => {
  const [client, view, designKit] = await Promise.all([
    readFile(pcClientPath, "utf8"),
    readFile(pcViewPath, "utf8"),
    readFile(pcDesignKitPath, "utf8"),
  ]);

  assert.match(client, /updateH4EventReward[\s\S]*expectedValue/);
  assert.match(client, /updateH4EventStatus[\s\S]*expectedValue/);
  assert.match(client, /updateH4EventFeatured[\s\S]*expectedValue/);
  assert.match(client, /createH4WheelTier[\s\S]*expectedSignature/);
  assert.match(client, /updateH4WheelProbabilities[\s\S]*expectedSignature/);
  assert.match(client, /deleteH4WheelTier[\s\S]*expectedSignature/);
  assert.match(client, /\/quest-events\/wheel-guards\//);
  assert.match(view, /updateH4WheelGuard\(guard\.key, value, current, reason\)/);
  assert.match(view, /rewardAmount/);
  assert.match(view, /dailyStock/);
  assert.match(view, /guard\.key === "cap"/);
  assert.match(view, /历史只读/);
  assert.match(designKit, /\["budget", "kill"\]/);
  assert.doesNotMatch(designKit, /\["budget", "cap", "kill"\]/);
});

test("H4 backend exposes canonical App events and protects wheel governance with real fields and CAS", async () => {
  const [controller, service, mapper] = await Promise.all([
    readFile(backendControllerPath, "utf8"),
    readFile(backendServicePath, "utf8"),
    readFile(backendMapperPath, "utf8"),
  ]);

  assert.match(controller, /@GetMapping\("\/api\/events"\)/);
  assert.match(controller, /service\.eventState\(userId\)/);
  assert.match(service, /request\.expectedSignature\(\)/);
  assert.match(service, /lockWheelMutation\(\)/);
  assert.match(service, /updateWheelGuardValue\(key, oldValue, value\)/);
  assert.match(service, /WHEEL_CONFIG_STALE/);
  assert.match(service, /EVENT_STATUS_TRANSITION_INVALID/);
  assert.match(service, /EVENT_WHEEL_REWARD_MANAGED_BY_POOL/);
  assert.match(service, /EVENT_WHEEL_SINGLETON/);
  assert.match(service, /WHEEL_CAP_DERIVED_FROM_TIER_STOCK/);
  assert.match(mapper, /reward_amount AS amount/);
  assert.match(mapper, /daily_stock AS dailyStock/);
  assert.match(mapper, /guard_value=#\{expectedValue\}/);
});

test("H4 App remote mode consumes canonical state and server spin results", async () => {
  const [eventStore, spinStore, eventsApi] = await Promise.all([
    readFile(appEventStorePath, "utf8"),
    readFile(appSpinStorePath, "utf8"),
    readFile(appEventsApiPath, "utf8"),
  ]);

  assert.match(eventStore, /eventsApi\.state\(\)/);
  assert.match(eventStore, /eventsApi\.join\(/);
  assert.match(eventStore, /eventsApi\.claim\(/);
  assert.match(eventStore, /pendingKeys/);
  assert.match(spinStore, /spinRemote/);
  assert.match(spinStore, /eventsApi\.spin\(/);
  assert.match(spinStore, /pendingSpinKey/);
  assert.match(eventsApi, /path: "\/api\/events"/);
  assert.match(eventsApi, /EVENT_FEATURED_DUPLICATED/);
  assert.match(eventsApi, /EVENT_CODE_DUPLICATED/);
});
