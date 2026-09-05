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
