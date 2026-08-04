import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const pcRoot = process.cwd();
const backendRoot = path.resolve(pcRoot, "..", "nexion-backend");
const appRoot = path.resolve(pcRoot, "..", "NX1.0");
const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

test("remote App consumes the canonical notification ledger and suppresses local simulations", () => {
  const bubble = read(appRoot, "src/components/nova/nova-bubble.vue");
  const store = read(appRoot, "src/store/notifications.ts");
  const api = read(appRoot, "src/api/notification-api.ts");

  assert.match(bubble, /if \(remoteApiEnabled\) \{[\s\S]*notifications\.refreshRemote\(\)[\s\S]*return;/);
  assert.match(store, /if \(remoteApiEnabled\) return;[\s\S]*Client simulations and local timers/);
  assert.match(api, /path: `\/api\/notifications\?\$\{params\.toString\(\)\}`/);
  assert.match(api, /\/api\/notifications\/\$\{expectedId\}\/actions/);
  assert.match(api, /idempotencyKey: requiredKey\(idempotencyKey\)/);
});

test("social dispatch becomes visible before commit and emits server-authoritative KPI events", () => {
  const mapper = read(backendRoot, "src/main/java/ffdd/opsconsole/content/mapper/NovaSocialRuntimeMapper.java");
  const runtime = read(backendRoot, "src/main/java/ffdd/opsconsole/content/application/NovaSocialRuntimeService.java");
  const clicks = read(backendRoot, "src/main/java/ffdd/opsconsole/content/application/AppNotificationService.java");

  assert.match(mapper, /SET push_status = 'DELIVERED'/);
  assert.match(runtime, /NOVA_SOCIAL_DELIVERY_COUNT_MISMATCH/);
  assert.match(runtime, /"nova\.push_sent"/);
  assert.match(runtime, /"notification\.delivered"/);
  assert.match(clicks, /"nova\.push_clicked"/);
  assert.match(clicks, /novaRuntimeRepository\.ensureRuntimeTables\(\)/);
});

test("I2 writes preserve server CTR, reject illegal template transitions and reuse uncertain keys", () => {
  const service = read(backendRoot, "src/main/java/ffdd/opsconsole/content/application/OpsNovaService.java");
  const client = read(pcRoot, "lib/admin/i-client.ts");

  assert.match(service, /current\.get\(\)\.ctr\(\),[\s\S]*operator\(request\.operator\(\)\)/);
  assert.match(service, /NOVA_TEMPLATE_NOT_DRAFT/);
  assert.match(service, /NOVA_TEMPLATE_TRANSITION_INVALID/);
  assert.match(service, /NOVA_CHANNEL_CONCURRENT_MODIFICATION/);
  assert.match(service, /NOVA_TEMPLATE_CONCURRENT_MODIFICATION/);
  assert.match(service, /NOVA_SOCIAL_DISTRIBUTION_CONCURRENT_MODIFICATION/);
  assert.match(service, /NOVA_SOCIAL_EVENT_CONCURRENT_MODIFICATION/);
  // 命令号落共享持久化 store(sessionStorage):刷新后重试仍是同一号,后端才能去重。
  assert.match(client, /const uncertainCommandKeys = createPendingMutationStore\(\{/);
  assert.doesNotMatch(client, /const uncertainCommandKeys = new Map/);
  assert.match(client, /uncertainCommandKeys\.get\(commandFingerprint\) \?\? idempotencyKey\(\)/);
  assert.match(client, /uncertainCommandKeys\.remember\(commandFingerprint, stableKey\)/);
});

test("all nine non-social channels share one replay-safe server fact gate", () => {
  const runtime = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/application/NovaBusinessRuntimeService.java",
  );
  const mapper = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/mapper/NovaSocialRuntimeMapper.java",
  );
  const scheduler = read(
    backendRoot,
    "src/main/java/ffdd/opsconsole/content/application/NovaSocialRuntimeScheduler.java",
  );

  for (const channel of [
    "welcome",
    "market",
    "upgrade",
    "dailySummary",
    "tradein",
    "eventClaim",
    "wrapped",
    "taskLockMonthly",
    "quest",
  ]) {
    assert.match(runtime, new RegExp(`adapters\\.put\\("${channel}"`));
  }
  assert.match(runtime, /"tradein\.eligible"/);
  assert.doesNotMatch(runtime, /targeted\("tradein", "tradein\.completed"\)/);
  assert.match(runtime, /"NO_REAL_FACT:" \+ String\.join/);
  assert.match(runtime, /runtimeRepository\.claimBusinessFact/);
  assert.match(runtime, /runtimeRepository\.completeBusinessFact/);
  assert.match(runtime, /effectiveCooldown\(adapter\.channel\(\), channel\.cooldown\(\), currentPhase\)/);
  assert.match(mapper, /UNIQUE KEY uk_nova_business_event \(channel_key, source_event_id\)/);
  assert.match(mapper, /e\.is_server_authoritative = 1/);
  assert.match(mapper, /e\.analytics_event = 0 OR e\.schema_registered = 1/);
  assert.match(scheduler, /businessRuntimeService\.channelKeys\(\)/);
});
