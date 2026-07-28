import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pcRoot = "D:/workspace/nexion-ops-console";
const backendRoot = "D:/workspace/nexion-backend";
const appRoot = "D:/workspace/NX1.0";
const read = (root, path) => readFileSync(`${root}/${path}`, "utf8");

test("I3 CAP command carries the visible expected value and parses decorated low-tier labels", () => {
  const page = read(pcRoot, "app/components/domain-views/i-tabs/i3-campaign.tsx");
  const registry = read(pcRoot, "lib/admin/high-ops-registry.ts");
  const client = read(pcRoot, "lib/admin/i-client.ts");
  const modal = read(pcRoot, "app/components/domain-views/design-kit.tsx");

  assert.match(page, /current:\s*cap\.match\(\/\\d\+\/\)\?\.\[0\]\s*\?\?\s*""/);
  assert.match(page, /buildCommand\(\{\s*tier,\s*cap:\s*v,\s*expectedCap:\s*cap\s*\}\)/);
  assert.match(page, /createA2CommandKey\("i3-cap-adjust"\)/);
  assert.match(page, /await propose\([\s\S]*commandKey,/);
  assert.match(page, /A2OutcomeUncertainError/);
  assert.match(registry, /op:\s*"i3_cap_adjust"[\s\S]*expectedCap:\s*String\(ctx\.expectedCap\)/);
  assert.match(client, /updateI3Cap:\s*\(tier,\s*cap,\s*expectedCap,\s*reason\)[\s\S]*\{\s*cap,\s*expectedCap\s*\}/);
  assert.match(modal, /if\s*\(!\/\^\[\+\-\]\?\(\?:\\d\+/);
});

test("backend I3 CAP update is stale-safe and draft edits share create length limits", () => {
  const dto = read(backendRoot, "src/main/java/ffdd/opsconsole/content/dto/NotificationCapUpdateRequest.java");
  const service = read(backendRoot, "src/main/java/ffdd/opsconsole/content/application/OpsNotificationCampaignService.java");
  const mapper = read(backendRoot, "src/main/java/ffdd/opsconsole/content/mapper/NotificationCapRuleMapper.java");
  const replay = read(backendRoot, "src/main/java/ffdd/opsconsole/content/application/OpsTrustDisclosureService.java");

  assert.match(dto, /String expectedCap/);
  assert.match(service, /NOTIFICATION_CAP_EXPECTED_REQUIRED/);
  assert.match(service, /NOTIFICATION_CAP_STALE_VERSION/);
  assert.match(service, /updateCapRuleIfCurrent/);
  assert.match(service, /requireDraft[\s\S]*NOTIFICATION_CAMPAIGN_TEXT_TOO_LONG/);
  assert.match(mapper, /WHERE tier = #\{tier\}[\s\S]*cap_label = #\{expectedCap\}[\s\S]*locked = 0/);
  assert.match(replay, /str\(p,\s*"expectedCap"\)/);
});

test("App notification feed paginates, fails visibly, and navigates only to the canonical server route", () => {
  const store = read(appRoot, "src/store/notifications.ts");
  const api = read(appRoot, "src/api/notification-api.ts");
  const page = read(appRoot, "src/pages/me/notifications.vue");
  const drawer = read(appRoot, "src/components/message-drawer.vue");
  const backend = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/application/AppNotificationService.java",
  );

  assert.match(store, /const nextCursor = ref<string \| null>/);
  assert.match(store, /async function loadMoreRemote/);
  assert.match(store, /NOTIFICATION_PAGE_CURSOR_OVERLAP/);
  assert.match(store, /return result\.route/);
  assert.match(api, /NOTIFICATION_ACTION_RESPONSE_MISMATCH/);
  assert.match(backend, /NOTIFICATION_READ_FACT_MISMATCH/);
  assert.match(
    backend,
    /if\s*\(!recorded\)\s*\{[\s\S]*findNotificationActionReceipt\(key\)[\s\S]*NOTIFICATION_ACTION_RECEIPT_MISMATCH/,
  );
  assert.match(
    backend,
    /findNotificationActionReceipt\(key\)[\s\S]*if\s*\(replay\s*!=\s*null\)[\s\S]*lockNotificationEventFact/,
  );
  assert.match(backend, /replay\.route\(\)\.trim\(\)/);
  assert.match(backend, /matches\(raced,[\s\S]*IDEMPOTENCY_KEY_CONFLICT/);
  assert.match(page, /data-testid="notification-error"/);
  assert.match(page, /const canonicalRoute = await notifs\.recordCta/);
  assert.match(drawer, /data-testid="drawer-notification-retry"/);
  assert.match(drawer, /navTo\(canonicalRoute\)/);
});
