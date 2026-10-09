import test from "node:test";
import assert from "node:assert/strict";
import { harness, text, why } from "./helpers.mjs";

test("M1 pending command label and reason are hidden after same actor loses M1 authority", async () => {
  const h = harness({ implementations: { createSupportGroup() { throw new Error("unknown"); } } });
  await h.flush(); h.click("创建组"); h.input("待定敏感组名"); h.reason(); h.click("确认并提交"); await h.flush();
  h.changeAuth({ session: { ...h.auth.session, authorities: [] } }); await h.flush();
  assert.equal(h.store.list().length, 1);
  assert.doesNotMatch(text(h.tree), /待定敏感组名|按已确认安排调整/);
  h.unmount();
});

test("M1 failed directory read is not displayed as a confirmed empty group directory", async () => {
  const h = harness({ implementations: { groups() { throw new Error("upstream unavailable"); } } });
  await h.flush();
  assert.doesNotMatch(text(h.tree), /当前没有负责组/);
  h.unmount();
});
