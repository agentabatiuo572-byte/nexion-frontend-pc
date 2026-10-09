import test from "node:test";
import assert from "node:assert/strict";
import { harness, makeClient, storage, group, text, why } from "./helpers.mjs";

test("reviewer: repeated old CREATE callback never redispatches after wall clock rollback", async () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const h = harness({ clock: Clock, implementations: { createSupportGroup() { throw new Error("unknown"); } } });
  await h.flush(); h.click("创建组"); h.input("独立时钟组"); h.reason();
  const oldConfirm = h.button("确认并提交").props.onClick;
  h.click("确认并提交"); await h.flush();
  const record = structuredClone(h.store.list()[0]);
  now += 25 * 60 * 60 * 1000;
  now -= 2 * 60 * 60 * 1000;
  assert.equal(makeClient().canReplayGroupCommand(record, now), true);
  for (let i = 0; i < 3; i++) { oldConfirm(); h.commit(); await h.flush(); }
  assert.equal(h.calls.filter(c => c.name === "createSupportGroup").length, 1);
  assert.deepEqual(structuredClone(h.store.list()[0]), record);
  assert.doesNotMatch(text(h.tree), /使用原资料与命令重试/);
  h.unmount();
});

test("reviewer: old qualification callback also cannot redispatch a saved intent at client 23h", async () => {
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const h = harness({ qualification: true, clock: Clock, implementations: { setSupportQualification() { throw new Error("unknown"); } } });
  await h.flush(); h.reason();
  const oldConfirm = h.button("确认并提交").props.onClick;
  h.click("确认并提交"); await h.flush();
  const record = structuredClone(h.store.list()[0]);
  now += 25 * 60 * 60 * 1000;
  now -= 2 * 60 * 60 * 1000;
  oldConfirm(); h.commit(); await h.flush();
  assert.equal(h.calls.filter(c => c.name === "setSupportQualification").length, 1);
  assert.deepEqual(structuredClone(h.store.list()[0]), record);
  h.unmount();
});

test("reviewer: lost group ownership hides pending target while another group remains readable", async () => {
  const persisted = storage(), client = makeClient({}, persisted);
  client.groupPendingCommands.remember("group-management:17", "old-rename-command", {
    actorId: 17, label: "重命名 · 原来负责的敏感组", intent: { kind: "RENAME", targetId: "5", payload: { name: "原来负责的敏感组", expectedVersion: 3, reason: why } },
  });
  const h = harness({ storage: persisted, implementations: { groups: () => [group("6", "17")], command: () => Promise.reject({ status: 403 }) } });
  await h.flush();
  assert.equal(h.store.list().length, 1);
  assert.doesNotMatch(text(h.tree), /原来负责的敏感组|按已确认安排调整/);
  h.unmount();
});
