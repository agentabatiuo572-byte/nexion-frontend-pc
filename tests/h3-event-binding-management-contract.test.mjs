import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = read("lib/admin/h-client.ts");
const page = read("app/components/domain-views/h-tabs/h3-quest-events.tsx");

test("H3 binding management offers structured creation and rebinding controls", () => {
  assert.match(page, /createH3QuestEventBinding/);
  assert.match(page, /openCreateBinding/);
  assert.match(page, /openBindingEdit/);
  assert.match(page, /\+ 新增绑定/);
  assert.match(page, />改绑</);
  assert.match(page, /kind: "multi-field"/);
  assert.match(page, /key: "eventType"[\s\S]*?inputKind: "select"/);
  assert.match(page, /key: "questCode"[\s\S]*?inputKind: "select"/);
  assert.match(page, /key: "userIdField"[\s\S]*?inputKind: "select"/);
  assert.match(page, /disabled=\{!canModuleWrite\}/);
  assert.doesNotMatch(page, /DAY_ONE[\s\S]{0,80}(?:completed|已完成)|(?:completed|已完成)[\s\S]{0,80}DAY_ONE/);
});

test("H3 binding commands retain an idempotency key for unknown outcomes and then read back H3 tasks", () => {
  assert.match(client, /createPendingMutationStore/);
  assert.match(client, /nexion-admin-h3-binding-commands-v1/);
  assert.match(client, /H3BindingOutcomeUncertainError/);
  assert.match(client, /outcomeStaysUnknown\(status, apiCode\)/);
  assert.match(client, /h3BindingCommands\.remember/);
  assert.match(client, /h3BindingCommands\.forget/);
  assert.match(client, /fetchH3QuestEvents\("tasks"\)/);
  assert.match(page, /isH3BindingOutcomeUncertainError/);
  assert.match(page, /写入结果未知；已回读当前服务端状态/);
  for (const fn of ["createH3QuestEventBinding", "updateH3QuestEventBinding", "deleteH3QuestEventBinding"]) {
    assert.match(client, new RegExp(`export function ${fn}\\b`));
  }
  assert.match(client, /expectedProducer/);
  assert.match(client, /expectedEventType/);
  assert.match(client, /expectedQuestCode/);
  assert.match(client, /expectedUserIdField/);
  assert.match(client, /expectedEnabled/);
  assert.match(client, /reason/);
});

test("H3 threshold events are selectable SYSTEM events with the event user as the default field", () => {
  const thresholdEvents = [
    ["H3_STOREFRONT_THREE_PRODUCTS_VIEWED", "浏览3个不同商品"],
    ["H3_GENESIS_SECONDARY_MARKET_VIEWED", "查看Genesis二级市场"],
    ["H3_COMPUTE_COMPLETED_50", "完成50笔已验证AI任务"],
  ];

  assert.match(page, /const H3_BINDING_EVENT_OPTIONS = Object\.keys\(H3_BINDING_EVENT_PRODUCERS\)/);
  assert.match(page, /const H3_BINDING_USER_FIELDS = \["user_id", "inviter_user_id"\]/);
  assert.match(page, /binding\?\.userIdField \?\? "user_id"/);
  assert.match(client, /producer: "ORDER" \| "REFERRAL" \| "LEARNING" \| "DEVICE" \| "COMMISSION" \| "SYSTEM"/);

  for (const [eventType, label] of thresholdEvents) {
    assert.match(page, new RegExp(`${eventType}:\\s*"SYSTEM"`));
    assert.match(page, new RegExp(`${eventType}:\\s*"${label}"`));
  }
});

test("H3 referral and exchange tasks only offer their confirmed SYSTEM events", () => {
  const confirmedEvents = [
    ["H3_REFERRAL_REGISTERED", "有效邀请注册"],
    ["H3_EXCHANGE_COMPLETED", "完成一次兑换"],
  ];

  assert.match(page, /const H3_BINDING_EVENT_OPTIONS = Object\.keys\(H3_BINDING_EVENT_PRODUCERS\)/);
  assert.match(page, /binding\?\.userIdField \?\? "user_id"/);
  for (const [eventType, label] of confirmedEvents) {
    assert.match(page, new RegExp(`${eventType}:\\s*"SYSTEM"`));
    assert.match(page, new RegExp(`${eventType}:\\s*"${label}"`));
  }
  assert.doesNotMatch(page, /referral\.bound|exchange\.swapped/);
});

test("H3 offers the published Day One source contracts", () => {
  const dayOneEvents = [
    ["H3_DAY_ONE_EARN_PAGE_VIEWED", "查看收益页（Day One）"],
    ["H3_DAY_ONE_STORE_PAGE_VIEWED", "查看商城页（Day One）"],
    ["H3_DAY_ONE_S1_ROI_VIEWED", "查看 StellarBox S1 收益估算（Day One）"],
  ];

  for (const [eventType, label] of dayOneEvents) {
    assert.match(page, new RegExp(`${eventType}:\\s*"SYSTEM"`));
    assert.match(page, new RegExp(`${eventType}:\\s*"${label}"`));
  }
  assert.doesNotMatch(page, /H3_BINDING_DEFERRED_APP_EVENTS|H3_BINDING_APP_OBSERVATION_UNAVAILABLE/);
  assert.match(page, /H3_DAY_ONE_PROFILE_SAVED: "SYSTEM"/);
  assert.match(page, /H3_DAY_ONE_CARD_BOUND: "SYSTEM"/);
});
