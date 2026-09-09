import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = read("lib/admin/a4-client.ts");
const page = read("app/components/domain-views/a-tabs/a4-events.tsx");
const proxy = read("app/api/admin/platform/[...path]/route.ts");

const H3_REDRIVABLE_TYPES = [
  "H3_STOREFRONT_THREE_PRODUCTS_VIEWED",
  "H3_GENESIS_SECONDARY_MARKET_VIEWED",
  "H3_COMPUTE_COMPLETED_50",
  "H3_REFERRAL_REGISTERED",
  "H3_EXCHANGE_COMPLETED",
];

test("H3 DEAD recovery previews one operator-entered event ID and never creates a list or payload editor", () => {
  assert.match(page, /redriveEventId/);
  assert.match(page, /fetchH3DeadOutboxRedrivePreview/);
  assert.match(page, /核验事件/);
  assert.match(page, /失败摘要/);
  assert.doesNotMatch(page, /(?:map|flatMap)\([^)]*redrive.*event/i);
  assert.doesNotMatch(page, /redrive[\s\S]{0,250}(?:payload|source)\s*:/i);
});

test("the confirmation freezes both DEAD layers and their attempt-count CAS values", () => {
  assert.match(page, /const snapshot = redrivePreview/);
  assert.match(page, /snapshot\.status !== "DEAD"/);
  assert.match(page, /snapshot\.deliveryStatus !== "DEAD"/);
  assert.match(page, /redriveAuditedH3DeadOutboxEvent\(\s*snapshot\.eventId,\s*snapshot\.retryCount,\s*snapshot\.deliveryStatus,\s*snapshot\.deliveryAttemptCount,\s*command\.reason,\s*command\.commandKey,\s*\)/);
  assert.match(page, /snapshot\.eventId/);
  assert.match(page, /snapshot\.eventType/);
  assert.match(page, /snapshot\.status/);
  assert.match(page, /snapshot\.retryCount/);
  assert.match(page, /snapshot\.deliveryStatus/);
  assert.match(page, /snapshot\.deliveryAttemptCount/);
  assert.match(page, /reasonMin: a2ReasonMin/);
  assert.match(page, /reasonMax: 200/);
});

test("the client has separate read-only preview and a two-layer CAS redrive command", () => {
  assert.match(client, /export async function fetchH3DeadOutboxRedrivePreview/);
  assert.match(client, /\/events\/outbox\/\$\{encodeURIComponent\(eventId\)\}\/redrive-preview/);
  assert.match(client, /export async function redriveAuditedH3DeadOutboxEvent/);
  assert.match(client, /body: JSON\.stringify\(\{ reason, expectedRetryCount, expectedDeliveryStatus, expectedDeliveryAttemptCount \}\)/);
  assert.match(client, /deliveryStatus: "DEAD"/);
  assert.match(client, /deliveryStatus: "FAILED"/);
  assert.doesNotMatch(client, /redriveAuditedH3DeadOutboxEvent[\s\S]{0,700}(?:payload|source|eventTs|lastError|publishedAt)\s*:/);
});

test("changing the event input clears the live command, while a same-ID preview preserves it for retry", () => {
  const resetStart = page.indexOf("const resetRedriveTarget");
  const resetEnd = page.indexOf("const previewH3DeadEvent");
  const previewStart = resetEnd;
  const previewEnd = page.indexOf("const redriveAuditedH3DeadEvent");
  assert.ok(resetStart >= 0 && resetEnd > resetStart && previewEnd > previewStart, "expected bounded redrive handlers");
  assert.match(page.slice(resetStart, resetEnd), /redriveCommandRef\.current = null/);
  assert.match(page.slice(resetStart, resetEnd), /setRedriveCommand\(null\)/);
  assert.doesNotMatch(page.slice(previewStart, previewEnd), /redriveCommandRef\.current = null/);
  assert.match(page, /runH3DeadOutboxRedriveCommand\(/);
  assert.match(page, /redriveCommandRef/);
  assert.match(page, /原 H3 事实重投结果未确认/);
  assert.match(page, /请核对当前状态后再操作/);
});

test("one captured confirmation callback retries its uncertain command, rotates changed reason, and keeps identity after close/reopen", async () => {
  const { runH3DeadOutboxRedriveCommand } = await import("../lib/admin/a4-redrive-command.ts");
  const snapshot = { eventId: "fddbdea83e5a47e3a26b27e8cfb0d959", retryCount: 4, deliveryStatus: "DEAD", deliveryAttemptCount: 7 };
  const holder = { current: null };
  let issued = 0;
  const submitted = [];
  const submitAndLoseResponse = async (command) => {
    submitted.push({ commandKey: command.commandKey, reason: command.reason });
    throw new Error("transport uncertain");
  };
  // OperationConfirmModal retains this callback after its rejected promise.
  const capturedRun = (reason) => runH3DeadOutboxRedriveCommand(holder, snapshot, reason, () => `key-${++issued}`, submitAndLoseResponse);
  await assert.rejects(capturedRun("  original reason  "), /transport uncertain/);
  await assert.rejects(capturedRun("original reason"), /transport uncertain/);
  // Closing/reopening creates a callback again, while the page's live ref remains for this unchanged command.
  const reopenedRun = (reason) => runH3DeadOutboxRedriveCommand(holder, snapshot, reason, () => `key-${++issued}`, submitAndLoseResponse);
  await assert.rejects(reopenedRun("original reason"), /transport uncertain/);
  await assert.rejects(reopenedRun("corrected reason"), /transport uncertain/);
  assert.deepEqual(submitted, [
    { commandKey: "key-1", reason: "original reason" },
    { commandKey: "key-1", reason: "original reason" },
    { commandKey: "key-1", reason: "original reason" },
    { commandKey: "key-2", reason: "corrected reason" },
  ]);
});
test("the proxy exposes only exact preview and redrive routes, with server-owned H3 eligibility", () => {
  assert.match(proxy, /parts\[1\] === "outbox"[\s\S]{0,400}parts\[3\] === "redrive-preview"/);
  assert.match(proxy, /parts\[1\] === "outbox"[\s\S]{0,400}parts\[3\] === "redrive"/);
  assert.doesNotMatch(proxy, /events\/outbox\/\$\{[^}]+\}\/search/);
  assert.match(page, /const H3_DEAD_REDRIVABLE_EVENT_TYPES = \[/);
  for (const eventType of H3_REDRIVABLE_TYPES) assert.match(page, new RegExp(eventType));
});

test("every controlled H3 redrive outcome has accurate operator guidance instead of the generic retry fallback", async () => {
  const { displayAdminError } = await import("../lib/admin/error-messages.ts");
  const messages = new Map([
    ["A4_H3_OUTBOX_REDRIVE_PREVIEW_MISMATCH", /核验结果与输入的事件编号不一致/],
    ["A4_H3_OUTBOX_REDRIVE_NOT_ELIGIBLE", /不处于可恢复失败状态[\s\S]*无需重投/],
    ["A4_H3_OUTBOX_REDRIVE_STATE_STALE", /状态或尝试次数已变化[\s\S]*重投未执行/],
    ["A4_H3_OUTBOX_EVENT_ID_INVALID", /ID 格式无效[\s\S]*未进行核验或重投/],
    ["A4_H3_OUTBOX_RETRY_COUNT_INVALID", /原事实的核验尝试次数无效[\s\S]*重投未执行/],
    ["A4_H3_OUTBOX_DELIVERY_ATTEMPT_COUNT_INVALID", /投递层的核验尝试次数无效[\s\S]*重投未执行/],
    ["A4_H3_OUTBOX_DELIVERY_STATUS_INVALID", /投递层状态不再是可恢复的 DEAD[\s\S]*重投未执行/],
    ["A4_H3_OUTBOX_REDRIVE_HASH_FAILED", /审计命令摘要[\s\S]*状态转换未执行/],
    ["ACCESS_DENIED", /没有执行此操作的权限/],
    ["ADMIN_PERMISSION_DENIED", /没有查看或操作此功能的权限/],
  ]);
  for (const [code, expected] of messages) {
    const shown = displayAdminError(new Error(code));
    assert.match(shown, expected, `${code} must retain its distinct operator guidance`);
    assert.doesNotMatch(shown, /操作未完成,请刷新页面核对最新状态后重试/, `${code} must not use the generic retry fallback`);
  }
  assert.equal(displayAdminError(new Error("REASON_TOO_SHORT_MIN_8")), "操作理由至少填写 8 个可见字符。");
  assert.equal(displayAdminError(new Error("REASON_TOO_LONG_MAX_200")), "操作理由不能超过 200 个可见字符。");
});
