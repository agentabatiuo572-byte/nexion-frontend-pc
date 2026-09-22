import test from "node:test";
import assert from "node:assert/strict";

import { maskAuditActor } from "../lib/admin/audit-actor.ts";

/**
 * zentao #229:C1 用户画像的审计时间线以行为主体显示了**未脱敏完整手机号**。
 *
 * 成因是审计主体被写成了用户手机号(用户令牌的 username claim 装的是手机号),
 * 写入侧已改为只写 `user:<id>`。但审计是 append-only —— 库里已有的历史行仍是手机号,
 * 改写入侧修不好过去,所以展示边界必须自己兜住。
 */
test("masks a phone number so the audit timeline cannot show a full one", () => {
  assert.equal(maskAuditActor("13800000007"), "138****07");
  assert.equal(maskAuditActor("+8613800000007"), "+861****07");
  assert.equal(maskAuditActor("138 0000 0007"), "138****07");
});

test("keeps non-phone actor identities readable", () => {
  // 这些是本仓真实存在的审计主体写法,不能被误打码 —— 打码过度会让审计失去可追溯性。
  for (const actor of [
    "user:7",
    "admin:42",
    "suadmin",
    "system",
    "payment-gateway",
    "payment-gateway:stripe",
    "janus-carrier",
    "conversation-idle-timeout-scheduler",
    "development-baseline",
  ]) {
    assert.equal(maskAuditActor(actor), actor, actor);
  }
});

test("does not treat a short or over-long digit run as a phone number", () => {
  assert.equal(maskAuditActor("12345"), "12345");
  assert.equal(maskAuditActor("1234567890123456"), "1234567890123456");
});

test("the shared timeline renders the masked actor, not the raw one", () => {
  // 渲染边界只有一个:所有消费方(C1/D2/E1)都从这里取主体名。
  const source = readSource("app/components/kit/audit-timeline.tsx");
  assert.match(source, /maskAuditActor\(e\.actor\)/);
  assert.doesNotMatch(source, /\{e\.actor\}/);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function readSource(relative) {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", relative), "utf8");
}
