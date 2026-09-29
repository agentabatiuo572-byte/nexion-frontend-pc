import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { supportClient, SupportClientError } from "../lib/admin/m-support-client.ts";

const envelope = (data, status = 200) => new Response(JSON.stringify({ code: status === 200 ? 0 : status, data, message: status === 200 ? "OK" : "unavailable" }), { status, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;

test("overview preserves unknown counts and rejects a fabricated zero", async () => {
  try {
    globalThis.fetch = async () => envelope({
      evaluatedAt: "2026-09-29T00:00:00Z", rulesVersion: 1, scope: "SELF",
      counts: { boundCustomers: 5, windowActiveCustomers: null, dormantCustomers: null, dueMaintenanceCustomers: null, waitingReplyCustomers: 2, firstContactCustomers: 1 },
      knownActiveCount: 3, unknownWindowCount: 2,
    });
    const overview = await supportClient.overview();
    assert.equal(overview.counts.windowActiveCustomers, null);
    assert.equal(overview.unknownWindowCount, 2);
    globalThis.fetch = async () => envelope({ evaluatedAt: "2026-09-29T00:00:00Z", rulesVersion: 1, scope: "SELF", counts: {} });
    await assert.rejects(supportClient.overview(), /SUPPORT_CONTRACT_MALFORMED/);
  } finally { globalThis.fetch = originalFetch; }
});

test("missing target endpoint stays an error, and same-origin writes preserve the caller key", async () => {
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => { seen.push({ url, init }); return envelope(null, 404); };
    await assert.rejects(supportClient.bindingPool({ pageNum: 1, pageSize: 20 }), (error) => error instanceof SupportClientError && error.status === 404);
    assert.match(seen[0].url, /^\/api\/admin\/content\/support-agents\/binding-pool\?/);
    assert.equal(seen[0].init.credentials, "same-origin");
    assert.equal(seen[0].init.cache, "no-store");
    await assert.rejects(supportClient.setMaintenance("7", { enabled: false, reason: "八个字的停用维护原因", expectedVersion: 2, expectedAssignmentId: "9" }, "stable-key-123"), SupportClientError);
    assert.equal(seen[1].init.headers.get("Idempotency-Key"), "stable-key-123");
    assert.deepEqual(JSON.parse(seen[1].init.body), { enabled: false, reason: "八个字的停用维护原因", expectedVersion: 2, expectedAssignmentId: 9 });
  } finally { globalThis.fetch = originalFetch; }
});

test("rules keep independently unconfigured values and reject invalid inheritance", async () => {
  try {
    globalThis.fetch = async () => envelope({ version: 3, dormantDays: null, maintenanceDays: 7, activityWindowDays: null, inheritanceMode: "UNCONFIGURED", maxInheritanceDepth: null });
    assert.equal((await supportClient.rules()).maintenanceDays, 7);
    assert.equal((await supportClient.rules()).dormantDays, null);
    globalThis.fetch = async () => envelope({ version: 3, dormantDays: null, maintenanceDays: null, activityWindowDays: null, inheritanceMode: "LIMITED", maxInheritanceDepth: null });
    await assert.rejects(supportClient.rules(), /SUPPORT_CONTRACT_MALFORMED/);
  } finally { globalThis.fetch = originalFetch; }
});

test("customer detail requires current owner and preference version while keeping unknown activity", async () => {
  try {
    const detail = { customerId: 7, assignmentId: 9, agentAdminId: 12, version: 4, maintenanceVersion: 2, maintenanceEnabled: false, maintenanceStatus: "STOPPED", accountState: "UNKNOWN", lastEffectiveAt: null, nextMaintenanceAt: null };
    globalThis.fetch = async () => envelope(detail);
    assert.deepEqual({ owner: (await supportClient.customerDetail("7")).agentAdminId, activity: (await supportClient.customerDetail("7")).lastEffectiveAt }, { owner: 12, activity: null });
    globalThis.fetch = async () => envelope({ ...detail, maintenanceVersion: undefined });
    await assert.rejects(supportClient.customerDetail("7"), /SUPPORT_CONTRACT_MALFORMED/);
  } finally { globalThis.fetch = originalFetch; }
});

test("pool message count stays unknown when absent", async () => {
  try {
    const item = { customerId: 7, reason: "NO_INVITER", enteredAt: "2026-09-29T00:00:00Z", version: 1 };
    globalThis.fetch = async () => envelope({ records: [item], total: 1, pageNum: 1, pageSize: 20 });
    assert.equal((await supportClient.bindingPool({ pageNum: 1, pageSize: 20 })).records[0].pendingMessageCount, undefined);
    globalThis.fetch = async () => envelope({ records: [{ ...item, pendingMessageCount: 0 }], total: 1, pageNum: 1, pageSize: 20 });
    assert.equal((await supportClient.bindingPool({ pageNum: 1, pageSize: 20 })).records[0].pendingMessageCount, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("transfer rejects a partial success response", async () => {
  try {
    globalThis.fetch = async () => envelope([]);
    await assert.rejects(supportClient.transfer({ targetAgentAdminId: 12, customers: [{ id: "7", expectedAssignmentId: null, expectedVersion: 1 }], reason: "八个字的正式转绑原因" }, "transfer-key-123"), /SUPPORT_CONTRACT_MALFORMED/);
  } finally { globalThis.fetch = originalFetch; }
});

test("transfer sends safe JSON integer IDs and reads the S3 assignment list", async () => {
  const seen = [];
  try {
    globalThis.fetch = async (_url, init) => { seen.push(JSON.parse(init.body)); return envelope([{ id: 99, customerId: 7, agentAdminId: 12, version: 2 }]); };
    const result = await supportClient.transfer({ targetAgentAdminId: 12, customers: [{ id: "7", expectedAssignmentId: "9", expectedVersion: 1 }], reason: "八个字的正式转绑原因" }, "transfer-key-123");
    assert.deepEqual(seen[0].customers, [{ id: 7, expectedAssignmentId: 9, expectedVersion: 1 }]);
    assert.equal(result.assignments[0].assignmentId, "99");
    assert.throws(() => supportClient.transfer({ targetAgentAdminId: 12, customers: [{ id: "9007199254740992", expectedAssignmentId: null, expectedVersion: 1 }], reason: "八个字的正式转绑原因" }, "transfer-key-123"), /SUPPORT_CONTRACT_MALFORMED/);
    assert.equal(seen.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("attachment upload retains FormData boundary handling and content bytes", async () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0xff]);
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url, init });
      if (String(url).endsWith("/content")) return new Response(bytes, { headers: { "Content-Type": "image/png" }, status: 206 });
      return envelope({ id: "file-15-uuid", customerId: "7", mime: "image/png", bytes: bytes.length, width: 1, height: 1, state: "READY", expiresAt: "2026-09-30T00:00:00Z" });
    };
    const uploaded = await supportClient.uploadAttachment({ file: new File([bytes], "a.png", { type: "image/png" }), customerId: "7", clientUploadId: "upload-1", expectedAssignmentId: "9" }, "upload-key-123");
    assert.equal(uploaded.state, "READY");
    assert.equal(seen[0].init.body.get("expectedAssignmentId"), "9");
    assert.equal(seen[0].init.headers.get("Content-Type"), null);
    assert.equal(seen[0].init.headers.get("Idempotency-Key"), "upload-key-123");
    const image = await supportClient.attachmentContent("file-15-uuid", undefined, "bytes=0-5");
    assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
    assert.equal(seen[1].init.headers.get("Range"), "bytes=0-5");
    assert.equal(supportClient.attachmentContentUrl("file-15-uuid"), "/api/admin/content/conversations/attachments/file-15-uuid/content");
  } finally { globalThis.fetch = originalFetch; }
});

test("content proxy keeps auth, multipart bytes, private range and byte response paths", () => {
  const source = readFileSync(new URL("../app/api/admin/content/[...path]/route.ts", import.meta.url), "utf8");
  assert.match(source, /ADMIN_TOKEN_COOKIE/);
  assert.match(source, /attachmentUpload \? uploadBody : await request\.text\(\)/);
  assert.match(source, /reader\.read\(\)/);
  assert.match(source, /size > maxBytes/);
  assert.match(source, /CONTENT_ATTACHMENT_TOO_LARGE/);
  assert.match(source, /if \(attachmentContent\) \{[\s\S]*?headers\.set\("Range", range\)/);
  assert.match(source, /if \(!upstream\.ok\) return jsonError\(upstream\.status, "CONTENT_ATTACHMENT_READ_FAILED"\)/);
  assert.match(source, /if \(first\.done\) return jsonError\(502, "CONTENT_ATTACHMENT_EMPTY"\)/);
  assert.match(source, /new Response\(imageBody, \{ status: upstream\.status, headers: responseHeaders \}\)/);
  assert.match(source, /redirect: "manual"/);
  assert.match(source, /"Cache-Control": "no-store"/);
});
