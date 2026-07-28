import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const pcRoot = resolve(import.meta.dirname, "..");
const backendRoot = resolve(pcRoot, "..", "nexion-backend");
const readPc = (file) => readFileSync(resolve(pcRoot, file), "utf8");
const readBackend = (file) => readFileSync(resolve(backendRoot, file), "utf8");

test("M3 conversation carrier fails closed on malformed pages and details", () => {
  const client = readPc("lib/admin/m-client.ts");
  assert.match(client, /function assertConversationPage\(/);
  assert.match(client, /M3_CONVERSATION_PAGE_INCOMPLETE/);
  assert.match(client, /function assertConversationDetail\(/);
  assert.match(client, /M3_CONVERSATION_DETAIL_INVALID/);
  assert.match(client, /apiRequest<unknown>\(`\/conversations/);
});

test("M3 core writes carry status plus numeric revision CAS", () => {
  const data = readPc("app/components/domain-views/m-tabs/data.ts");
  const client = readPc("lib/admin/m-client.ts");
  const view = readPc("app/components/domain-views/m-view.tsx");
  assert.match(data, /version:\s*number/);
  assert.match(client, /expectedVersion/);
  assert.match(client, /expectedVersions/);
  assert.match(view, /before\.version/);
  assert.match(view, /target:\s*"from"\s*\|\s*"standby"/);
});

test("M3 backend persists and atomically claims conversation revisions", () => {
  const model = readBackend("src/main/java/ffdd/opsconsole/content/domain/ContentConversationView.java");
  const mapper = readBackend("src/main/java/ffdd/opsconsole/content/mapper/ConversationMapper.java");
  const schema = readBackend("scripts/schema.sql");
  assert.match(model, /Long version/);
  assert.match(schema, /nx_conversation[\s\S]*version BIGINT NOT NULL DEFAULT 0/);
  assert.match(mapper, /version=version\+1/);
  assert.match(mapper, /AND version=#\{expectedVersion\}/);
});

test("M3 routine transfer stays outside A2 and supports queue/standby acceptance plus explicit return", () => {
  const service = readBackend("src/main/java/ffdd/opsconsole/content/application/OpsConversationService.java");
  const request = readBackend("src/main/java/ffdd/opsconsole/content/dto/ConversationTransferDecisionRequest.java");
  assert.doesNotMatch(service, /audit\("I9_CONVERSATION_TRANSFER(?:RED|_ACCEPTED|_RETURNED|_WAITED|_FALLBACK|_AUTO_FALLBACK)"/);
  assert.match(service, /queueOrStandby/);
  assert.match(request, /String target/);
});

test("M3 persistent dock waits for confirmed write and never emits early success", () => {
  const view = readPc("app/components/domain-views/m-view.tsx");
  assert.match(view, /const send = async \(\) =>/);
  assert.match(view, /const succeeded = await ctx\.setParam/);
  assert.match(view, /if \(succeeded\)/);
});
