import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i2-nova.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");

test("I2 manages verified event rows instead of editable pool counts", () => {
  assert.match(client, /NovaSocialEventView/);
  assert.match(client, /socialEvents:/);
  assert.match(view, /真实事件明细/);
  assert.match(view, /来源系统/);
  assert.match(view, /来源事件ID/);
  assert.match(view, /脱敏展示/);
  assert.match(view, /到期时间/);
  assert.doesNotMatch(view, /social 池条目数编辑/);
  assert.doesNotMatch(view, /actions\.updateI2Pool/);
});

test("I2 exposes sync, preview, disable and delete workflows for real events", () => {
  assert.match(client, /syncI2SocialEvents/);
  assert.match(client, /previewI2SocialEvent/);
  assert.match(client, /updateI2SocialEventStatus/);
  assert.match(client, /deleteI2SocialEvent/);
  assert.match(client, /\/nova\/social-events\/sync/);
  assert.match(client, /\/nova\/social-events\/sample/);
  assert.match(view, /同步真实事件/);
  assert.match(view, /预览抽样/);
  assert.match(view, /没有有效真实事件时不推送/);
});

test("I2 event filtering uses structured backend catalogs and Chinese states", () => {
  assert.match(client, /socialEventTypes/);
  assert.match(client, /socialEventStatuses/);
  assert.match(view, /全部事件类型/);
  assert.match(view, /全部状态/);
  assert.match(view, /已验证/);
  assert.match(view, /已停用/);
  assert.match(view, /已过期/);
  assert.doesNotMatch(view, /人工填写真实事件/);
});

test("I2 guards probability, multilingual preview, expiry and growing event lists", () => {
  assert.match(view, /Number\.isInteger/);
  assert.match(view, /value >= 0 && value <= 100/);
  assert.match(view, /预览语言/);
  assert.match(view, /越南语/);
  assert.match(view, /已到期不可恢复/);
  assert.match(view, /EVENT_PAGE_SIZE = 20/);
  assert.match(client, /listI2SocialEvents/);
  assert.match(client, /pageSize/);
  assert.match(view, /setEventTotal\(result\.total\)/);
  assert.match(view, /上一页/);
  assert.match(view, /同步完成：发现/);
});
