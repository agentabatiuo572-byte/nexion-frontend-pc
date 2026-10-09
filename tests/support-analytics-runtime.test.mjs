import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import { assertRuntimeIdentity, assertActiveRuntimeState, feOwnershipReferences } from "../scripts/lib/support-analytics-evidence.mjs";
import { assertReadOnlyRequest, assertAnalyticsScope, assertHandoffConfig, assertBackendEvidence, assertNumericDom, enterGroupDirectory } from "./support-analytics-handoff-runtime.mjs";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { createServer } from "node:net";
import { chromium } from "playwright";
import { businessData, findPagedAccount, unboundCustomerSnapshot, consoleSidebarRoot, assertUiBinding, assertRequestSeeds, assertResourceBindings, assertManualFeProof, assertFePreload, assertAvatarPolicy, assertAvatarProposal, avatarApprovePath, validateMutation, validateReadback, assertRuntimeReceipt, assertLiveFingerprint, assertBoundFile, sha256, installRenderedBlobObserver, renderedBlobObservation, renderedBlobSha256, waitForRenderedImageMatch, windowsFingerprint, windowsFingerprintBatch } from "../scripts/lib/support-analytics-evidence.mjs";

const repo = resolve(import.meta.dirname, "..");
test("account location uses actual pagination and rejects missing, ambiguous or stalled targets", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(), target = 'button[aria-label="edit seeded account"]';
    const fixture = async (total, position, mode = "normal") => {
      await page.setContent(`<section><span class="pager-info"></span><span class="pager-num"></span><select class="pager-size"><option>10</option><option>50</option></select><div id="rows"></div><button id="next">›</button></section>`);
      await page.evaluate(({ total, position, mode }) => {
        let index = 0, size = 10;
        const render = () => {
          document.querySelector('.pager-info').textContent = `显示 ${total ? index * size + 1 : 0}–${Math.min((index + 1) * size, total)} / ${total}`;
          document.querySelector('.pager-num').textContent = `${index + 1} / ${Math.max(1, Math.ceil(total / size))}`;
          const rows = document.querySelector('#rows'); rows.replaceChildren();
          if (position >= index * size && position < Math.min((index + 1) * size, total)) {
            for (let n = 0; n < (mode === 'duplicate' ? 2 : 1); n++) {
              const button = document.createElement('button'); button.setAttribute('aria-label', 'edit seeded account'); button.textContent = 'Edit'; rows.append(button);
              if (mode === 'hidden') button.style.display = 'none';
            }
          }
          document.querySelector('#next').disabled = mode === 'disabled' || index >= Math.ceil(total / size) - 1;
        };
        document.querySelector('select').onchange = event => { size = Number(event.target.value); index = 0; render(); };
        document.querySelector('#next').onclick = () => { if (mode === 'stalled') return; index++; if (mode === 'drift') total++; render(); };
        render();
      }, { total, position, mode });
      return page.locator('section');
    };
    for (const [total, position, expectedPage] of [[7, 2, 1], [77, 76, 2], [151, 120, 3]]) {
      const result = await findPagedAccount(await fixture(total, position), target);
      assert.equal(result.total, total); assert.equal(result.pages, Math.ceil(total / 50)); assert.equal(result.visited.at(-1), expectedPage);
      assert.equal(await page.locator(target).count(), 1);
    }
    await assert.rejects(findPagedAccount(await fixture(0, -1), target), /not found/);
    await assert.rejects(findPagedAccount(await fixture(77, -1), target), /not found/);
    await assert.rejects(findPagedAccount(await fixture(10, 1, 'duplicate'), target), /ambiguous/);
    await assert.rejects(findPagedAccount(await fixture(10, 1, 'hidden'), target), /not visible/);
    await assert.rejects(findPagedAccount(await fixture(102, 101, 'disabled'), target), /stopped before/);
    await assert.rejects(findPagedAccount(await fixture(102, 101, 'drift'), target), /list changed/);
    await assert.rejects(findPagedAccount(await fixture(77, 76, 'stalled'), target, 300), /Timeout|deadline/);
    const missingNext = await fixture(77, 76);
    await missingNext.getByRole('button', { name: '›', exact: true }).evaluate(element => element.remove());
    page.setDefaultTimeout(5000);
    const started = Date.now();
    await assert.rejects(findPagedAccount(missingNext, target, 300), /Timeout|deadline/);
    assert.ok(Date.now() - started < 2000, 'Missing pagination control escaped the action deadline');
    const card = await fixture(10, 1);
    await card.locator('.pager-info').evaluate(element => { element.textContent = 'unknown'; });
    await assert.rejects(findPagedAccount(card, target), /Invalid account pagination/);
  } finally { await browser.close(); }
});
function run(config, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "support-i0-negative-"));
  const report = join(dir, "report.json");
  const env = { ...process.env, WORKFLOW_TASK_ID: "support-analytics-frontend-20261007-r5", WORKFLOW_STEP_ID: "I0-F", WORKFLOW_CHECK_ID: "runtime", WORKFLOW_RUN_ID: randomUUID(), WORKFLOW_REPO: repo, WORKFLOW_SNAPSHOT_HASH: "a".repeat(64) };
  delete env.SUPPORT_ACCEPTANCE_CONFIG;
  if (options.omitReceipt) delete env.SUPPORT_RUNTIME_RECEIPT;
  if (config) {
    env.SUPPORT_ACCEPTANCE_CONFIG = join(dir, "config.json");
    writeFileSync(env.SUPPORT_ACCEPTANCE_CONFIG, JSON.stringify({ taskId: env.WORKFLOW_TASK_ID, repo, isolatedDatabase: true, ...config }));
  }
  const result = spawnSync(process.execPath, ["scripts/support-analytics-runtime.mjs", "--phase", "I0-F", ...(!options.omitReport ? ["--report", report] : [])], { cwd: repo, env, encoding: "utf8", windowsHide: true, timeout: 20000 });
  return { ...result, report: existsSync(report) ? JSON.parse(readFileSync(report, "utf8")) : undefined };
}

test("missing authorized runtime seed cannot manufacture a baseline PASS", () => {
  const result = run();
  assert.equal(result.status, 1);
  assert.equal(result.report.verdict, "unverified");
  assert.ok(result.report.steps.every(step => step.status !== "pass" && step.evidence.length === 0));
  assert.match(result.report.steps[0].reason, /SUPPORT_ACCEPTANCE_CONFIG/);
});

test("a configured external target is rejected before opening a browser or submitting a write", () => {
  const result = run({ baseUrl: "https://outside.example.invalid" });
  assert.equal(result.status, 1);
  assert.equal(result.report.verdict, "unverified");
  assert.match(result.report.steps[0].reason, /isolated local runtime/);
  assert.ok(result.report.steps.every(step => step.evidence.length === 0));
});

test("omitted report path fails instead of treating argv[0] as an output file", () => {
  const result = run(undefined, { omitReport: true });
  assert.equal(result.status, 1);
  assert.equal(result.report, undefined);
  assert.match(result.stderr, /--report is required/);
});

test("HTTP200 business rejection and missing result data cannot count as a mutation", () => {
  for (const body of [{ code: 409, data: {} }, { code: 0 }, { code: 0, data: null }]) assert.throws(() => businessData(body), /business envelope/);
});

const beforeConversation = { conversation: { conversationNo: "CV-I0", version: 4 }, messages: [] };
const messageMutation = { path: "/api/admin/content/conversations/CV-I0/replies", key: "new-key", input: { clientMessageId: "fresh-id", kind: "TEXT", body: "current-run-message" }, output: { code: 0, data: { conversationNo: "CV-I0" } } };
const freshReadback = () => ({ conversation: { conversationNo: "CV-I0", version: 5 }, messages: [{ id: 21, clientMessageId: "fresh-id", kind: "TEXT", content: "current-run-message" }] });
test("unrelated GET, old version and duplicate persisted message are rejected", () => {
  const unrelated = freshReadback(); unrelated.conversation.conversationNo = "CV-OTHER";
  assert.throws(() => validateReadback("unknown-main", unrelated, messageMutation, beforeConversation), /different conversation/);
  const old = freshReadback(); old.conversation.version = 4;
  assert.throws(() => validateReadback("unknown-main", old, messageMutation, beforeConversation), /old conversation version/);
  const duplicate = freshReadback(); duplicate.messages.push({ ...duplicate.messages[0], id: 22 });
  assert.throws(() => validateReadback("unknown-main", duplicate, messageMutation, beforeConversation), /missing or duplicated/);
  assert.equal(validateReadback("unknown-main", freshReadback(), messageMutation, beforeConversation).id, 21);
});

test("a pre-existing command message cannot be renamed into this run's new write", () => {
  assert.throws(() => validateMutation("unknown-main", messageMutation, { ...beforeConversation, messages: [{ clientMessageId: "fresh-id" }] }, [], { conversationNos: ["CV-I0"] }), /existed before/);
});

test("shell-only evidence and copied main flow cannot sign the dock scenario", () => {
  assert.throws(() => assertUiBinding("unknown-main", { root: "aside", visible: true, submitInside: true }), /different business surface/);
  assert.throws(() => assertUiBinding("unknown-dock", { root: ".m3-stage .m3-col-chat", visible: true, submitInside: true }), /different business surface/);
  assert.throws(() => assertUiBinding("unknown-dock", { root: '[data-proof="session-dock-panel"]', visible: true, submitInside: false }), /submit control/);
});

const avatarBefore = { id: "7", username: "agentb", name: "Agent B", email: "", version: "1", avatarAssetId: "old-avatar", avatarVersion: 1 };
const avatarUpload = { path: "/api/admin/platform/accounts/avatar-assets", output: { code: 0, data: { assetId: "new-avatar", status: "READY" } } };
const avatarPolicy = { operation: "a1_account_update_profile", accountId: "7", makerAdminId: "100", makerUsername: "maker", checkerAdminId: "101", checkerUsername: "checker", approvalPathTemplate: "/api/admin/platform/audit/operations/{currentProposalId}/approve" };
function avatarProposal() { return { path: "/api/admin/platform/audit/operations", key: "new-proposal-key", input: { sourceDomain: "A1", type: "acct", amplifies: false, sos: false, obj: "7", command: { domain: "A", op: "a1_account_update_profile", params: { accountId: "7", username: "agentb", displayName: "Agent B", email: null, expectedVersion: "1", avatarAssetId: "new-avatar" } }, target: { domain: "A", type: "account", id: "7" } }, output: { code: 0, data: { id: "NEW-A2", obj: "7", status: "PENDING" } } }; }
function avatarMutation() { return { path: "/api/admin/platform/audit/operations/NEW-A2/approve", key: "new-approval-key", input: { reason: "本期头像实景独立审批" }, output: { code: 0, data: { id: "NEW-A2", obj: "7", status: "APPROVED" } }, proposal: avatarProposal(), avatarPolicy }; }
test("avatar must use actual A2 approval, this run's READY upload and a new persisted version", () => {
  const mutation = avatarMutation();
  assert.throws(() => validateMutation("avatar", mutation, avatarBefore, [], { accountIds: ["7"] }), /this run's READY upload/);
  validateMutation("avatar", mutation, avatarBefore, [avatarUpload], { accountIds: ["7"] });
  assert.throws(() => validateReadback("avatar", avatarBefore, mutation, avatarBefore));
  validateReadback("avatar", { ...avatarBefore, avatarAssetId: "new-avatar", avatarVersion: 2 }, mutation, avatarBefore);
  const direct = { ...mutation, proposal: undefined, path: "/api/admin/platform/accounts/7/profile" };
  assert.throws(() => validateMutation("avatar", direct, avatarBefore, [avatarUpload], { accountIds: ["7"] }), /direct profile PATCH/);
});
test("avatar maker/checker must match measured sessions and actual checker authorities", () => {
  const maker = { username: "maker", adminId: 100 }, checker = { username: "checker", adminId: 101, authorities: ["platform_a1_write", "platform_a2_operation_approve"] };
  assertAvatarPolicy(avatarPolicy, maker, checker);
  assert.throws(() => assertAvatarPolicy({ ...avatarPolicy, checkerAdminId: "100" }, maker, checker), /different real admins/);
  assert.throws(() => assertAvatarPolicy(avatarPolicy, maker, { ...checker, username: "old-admin" }));
  assert.throws(() => assertAvatarPolicy(avatarPolicy, maker, { ...checker, adminId: 102 }));
  for (const authority of checker.authorities) assert.throws(() => assertAvatarPolicy(avatarPolicy, maker, { ...checker, authorities: [authority] }), /lacks/);
});
test("avatar proposal rejects unrelated operations, accounts, targets, fields and versions before creation", () => {
  const check = proposal => assertAvatarProposal(proposal.input, avatarBefore, [avatarUpload], { accountIds: ["7"] }, avatarPolicy);
  check(avatarProposal());
  for (const alter of [p => p.input.command.op = "a1_account_change_role", p => p.input.command.params.accountId = "8", p => p.input.target.id = "8", p => p.input.targets = [{ domain: "A", type: "account", id: "8" }], p => p.input.command.params.role = "super", p => p.input.command.params.expectedVersion = "0", p => p.input.command.params.avatarAssetId = "old-avatar", p => p.input.command.params.username = "different-login"]) { const p = avatarProposal(); alter(p); assert.throws(() => check(p)); }
});
test("avatar approval cannot select an old, final, wrong-account or failed proposal", () => {
  assert.equal(avatarApprovePath(avatarProposal()), "/api/admin/platform/audit/operations/NEW-A2/approve");
  const final = avatarProposal(); final.output.data.status = "APPROVED"; assert.throws(() => avatarApprovePath(final));
  const wrong = avatarProposal(); wrong.output.data.obj = "8"; assert.throws(() => avatarApprovePath(wrong));
  for (const alter of [m => m.path = "/api/admin/platform/audit/operations/OLD-A2/approve", m => m.output.data.id = "OLD-A2", m => m.output.data.status = "REJECTED", m => m.key = m.proposal.key]) { const m = avatarMutation(); alter(m); assert.throws(() => validateMutation("avatar", m, avatarBefore, [avatarUpload], { accountIds: ["7"] })); }
  const source = readFileSync(join(repo, "scripts/support-analytics-runtime.mjs"), "utf8");
  assert.match(source, /currentAvatarApproval \|\| runtimeReceipt\.authorizedMutationPaths\.includes\(path\)/);
  assert.match(source, /assertAvatarPolicy\(runtimeReceipt\.avatarApproval, makerSession, checkerSession\)/);
});

function receipt() {
  const process = { pid: 7, processStartTime: new Date().toISOString(), commandLineHash: "a".repeat(64) };
  return { taskId: "test", recordedAt: new Date().toISOString(), fe: { ...process, repo, origin: "http://127.0.0.1:33107", backendUrl: "http://127.0.0.1:18161", cookieNamespace: "cs_analytics_20261007", candidateDigest: "candidate" }, be: { ...process, repo: "D:/WORKS/PLAN/.wt/cs-analytics-api-20261007", origin: "http://127.0.0.1:18161" }, resources: { db: { ...process, port: 33337, schema: "cs_analytics_20261007" }, redis: process, s3: process }, allowedSeedObjects: {}, authorizedMutationPaths: ["/authorized"] };
}
const target = { taskId: "test", repo, origin: "http://127.0.0.1:33107", candidateDigest: "candidate" };
test("old local port, changed FE source, wrong BE/DB and stale receipt fail before login", () => {
  const wrongPort = receipt(); wrongPort.fe.origin = "http://127.0.0.1:33041";
  assert.throws(() => assertRuntimeReceipt(wrongPort, target));
  const wrongSource = receipt(); wrongSource.fe.candidateDigest = "old-source";
  assert.throws(() => assertRuntimeReceipt(wrongSource, target), /source changed/);
  const wrongBackend = receipt(); wrongBackend.be.origin = "http://127.0.0.1:18160";
  assert.throws(() => assertRuntimeReceipt(wrongBackend, target));
  const wrongDb = receipt(); wrongDb.resources.db.schema = "old-clone";
  assert.throws(() => assertRuntimeReceipt(wrongDb, target));
  const stale = receipt(); stale.recordedAt = new Date(Date.now() - 16 * 60000).toISOString();
  assert.throws(() => assertRuntimeReceipt(stale, target), /stale/);
});

test("changed listener process, command/config reference or artifact bytes reject the binding", () => {
  const expected = receipt().fe;
  assert.throws(() => assertLiveFingerprint(expected, { ...expected, pid: 8, references: [true] }), /different process/);
  assert.throws(() => assertLiveFingerprint(expected, { ...expected, commandLineHash: "b".repeat(64), references: [true] }), /command changed/);
  assert.throws(() => assertLiveFingerprint(expected, { ...expected, references: [false] }), /does not reference/);
  const artifact = join(mkdtempSync(join(tmpdir(), "support-artifact-")), "artifact");
  writeFileSync(artifact, "current-build");
  assertBoundFile(artifact, sha256(Buffer.from("current-build")));
  assert.throws(() => assertBoundFile(artifact, sha256(Buffer.from("old-build"))), /runtime file changed/);
});

const allowed = { customerIds: ["11", "12", "13"], accountIds: ["7"], conversationNos: ["CV-I0"], skuIds: ["SKU-1"] };
const bulkPreview = ids => ({ path: "/api/admin/content/support-workbench/bulk/preview", output: { code: 0, data: { selectionId: "current-selection", customers: ids.map(id => ({ id })) } } });
const randomPreview = ids => ({ path: "/api/admin/content/support-agents/assignments/random-preview", output: { code: 0, data: { id: "current-preview", rulesVersion: 2, customers: ids.map(id => ({ id })) } } });
test("actual preview bodies reject non-seed and substituted selection before submission", () => {
  const check = (path, body, scope) => assertRequestSeeds(path, body, [], [], allowed, ["11", "12"], scope);
  assert.throws(() => check(bulkPreview([]).path, { selectionMode: "EXPLICIT", customerIds: ["11", "99"] }), /outside/);
  assert.throws(() => check(bulkPreview([]).path, { selectionMode: "EXPLICIT", customerIds: ["11", "13"] }), /exact targets/);
  assert.throws(() => check(bulkPreview([]).path, { selectionMode: "ALL_FILTERED", customerIds: [] }), /complete real/);
  assert.throws(() => check(bulkPreview([]).path, { selectionMode: "ALL_FILTERED", customerIds: [] }, ["11", "99"]), /outside/);
  check(bulkPreview([]).path, { selectionMode: "ALL_FILTERED", customerIds: [] }, allowed.customerIds);
  check(bulkPreview([]).path, { selectionMode: "CROSS_PAGE", customerIds: ["11", "12"] });
  assert.throws(() => check(bulkPreview([]).path, { selectionMode: "CROSS_PAGE", customerIds: ["11", "99"] }), /outside/);
  assert.throws(() => check(bulkPreview([]).path, { selectionMode: "CROSS_PAGE", customerIds: ["11", "13"] }), /exact targets/);
  assert.throws(() => check(randomPreview([]).path, { customers: [{ id: "99" }] }), /outside/);
});
test("previous owned fixtures are allowed only for bulk discovery, never message targets", () => {
  const current = { ...allowed, bulkDiscoveryCustomerIds: ["11", "12", "13", "21"], bulkDiscoveryKeyword: "fixture-current" };
  const check = (path, body, previews = [], scope) => assertRequestSeeds(path, body, previews, [], current, ["11", "12"], scope);
  const discovery = { selectionMode: "ALL_FILTERED", customerIds: [], excludedIds: [], filters: {} };
  check(bulkPreview([]).path, discovery, [], ["11", "12", "13", "21"]);
  check(bulkPreview([]).path, { ...discovery, filters: { keyword: "fixture-current" } }, [], ["11", "12", "13", "21"]);
  assert.throws(() => check(bulkPreview([]).path, discovery, [], ["11", "99"]), /outside/);
  for (const changed of [{ customerIds: ["21"] }, { excludedIds: ["11"] }, { filters: { includeUnknown: true } }, { filters: { keyword: "fixture-previous" } }, { filters: { keyword: "fixture-current", includeUnknown: true } }]) {
    assert.throws(() => check(bulkPreview([]).path, { ...discovery, ...changed }, [], ["11", "21"]));
  }
  for (const filters of [null, undefined, [], "", 0, false]) assert.throws(() => check(bulkPreview([]).path, { ...discovery, filters }, [], ["11", "21"]), /must be an object/);
  for (const selectionMode of ["EXPLICIT", "CROSS_PAGE"]) assert.throws(() => check(bulkPreview([]).path, { selectionMode, customerIds: ["11", "21"] }), /outside/);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "current-selection" }, [bulkPreview(["11", "21"])]), /outside/);
  assert.throws(() => check("/api/admin/content/support-agents/assignments/random-preview", { customers: [{ id: "11" }, { id: "21" }] }), /outside/);
  assert.throws(() => check("/api/admin/content/support-agents/assignments/random", { previewId: "current-preview", expectedRulesVersion: 2 }, [randomPreview(["11", "21"])]), /outside/);
  assert.throws(() => check("/api/admin/content/conversations/attachments", { customerId: "21" }), /outside/);
  assert.throws(() => check("/api/admin/content/conversations/CV-OLD/replies", { kind: "TEXT" }));
  check("/api/admin/content/support-workbench/bulk", { selectionId: "current-selection" }, [bulkPreview(["11", "12"])]);
});
test("bulk and random commits require this run's exact frozen server preview before transmission", () => {
  const check = (path, body, previews) => assertRequestSeeds(path, body, previews, [], allowed, ["11", "12"]);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "old" }, [bulkPreview(["11", "12"])]), /this run/);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "current-selection" }, [bulkPreview(["11", "99"])]), /outside/);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "current-selection" }, [bulkPreview(["11", "13"])]), /exact targets/);
  assert.throws(() => check("/api/admin/content/support-agents/assignments/random", { previewId: "current-preview", expectedRulesVersion: 1 }, [randomPreview(["11", "12"])]));
  check("/api/admin/content/support-agents/assignments/random", { previewId: "current-preview", expectedRulesVersion: 2 }, [randomPreview(["11", "12"])]);
});
test("random baseline requires an exact pool row and complete active bindings, including orphaned advisors", () => {
  const pool = { total: 1, records: [{ customerId: 11, nickname: "Pool customer", version: 1 }] };
  const empty = [{ total: 0, pageNum: 1, pageSize: 100, records: [] }];
  const snapshot = unboundCustomerSnapshot("11", pool, empty);
  assert.deepEqual(snapshot, { ...pool.records[0], agentAdminId: null });
  assert.throws(() => unboundCustomerSnapshot("12", pool, empty), /missing or duplicated/);
  assert.throws(() => unboundCustomerSnapshot("11", { total: 2, records: [...pool.records, ...pool.records] }, empty), /missing or duplicated/);
  assert.throws(() => unboundCustomerSnapshot("11", { ...pool, total: 2 }, empty), /incomplete/);
  assert.throws(() => unboundCustomerSnapshot("11", { ...pool, records: [{ customerId: 11 }] }, empty), /version/);
  const orphan = [{ total: 1, pageNum: 1, pageSize: 100, records: [{ assignmentId: 91, customerId: 11, agentAdminId: 999999 }] }];
  assert.throws(() => unboundCustomerSnapshot("11", pool, orphan), /already has an active binding/);
  assert.throws(() => unboundCustomerSnapshot("11", pool, [{ ...empty[0], total: 1 }]), /incomplete/);
  const first = { total: 101, pageNum: 1, pageSize: 100, records: Array.from({ length: 100 }, (_, i) => ({ assignmentId: i + 1, customerId: i + 100 })) };
  assert.throws(() => unboundCustomerSnapshot("11", pool, [first]), /incomplete/);
  const second = { total: 101, pageNum: 2, pageSize: 100, records: [{ assignmentId: 101, customerId: 200 }] };
  assert.equal(unboundCustomerSnapshot("11", pool, [first, second]).agentAdminId, null);
  assert.throws(() => unboundCustomerSnapshot("11", pool, [first, { ...second, total: 102 }]), /changed/);
  assert.throws(() => unboundCustomerSnapshot("11", pool, [first, { ...second, records: [first.records[0]] }]), /duplicated across pages/);
  assert.throws(() => unboundCustomerSnapshot("11", { ...pool, available: false }, empty));
  assert.throws(() => unboundCustomerSnapshot("11", pool, [{ ...empty[0], available: false }]));

  const preview = { path: "/api/admin/content/support-agents/assignments/random-preview", output: { code: 0, data: { id: "preview", rulesVersion: 2, customers: [{ id: 11, poolVersion: 1 }] } } };
  const mutation = { key: "current-key", input: { previewId: "preview", expectedRulesVersion: 2 }, output: { code: 0, data: { operationId: "operation", customers: [{ customerId: 11, agentAdminId: 7, status: "ASSIGNED" }] } } };
  const permitted = { customerIds: ["11"], eligibleAssignmentAgentIds: ["7"] };
  validateMutation("random", mutation, { "11": snapshot }, [], permitted, [preview], ["11"]);
  assert.throws(() => validateMutation("random", mutation, { "11": { ...snapshot, version: 2 } }, [], permitted, [preview], ["11"]), /measured pool version/);
});
test("all asset/profile/reply writes refuse non-seed targets and unrelated uploaded assets", () => {
  const check = (path, body) => assertRequestSeeds(path, body, [], [], allowed, []);
  assert.throws(() => check("/api/admin/content/conversations/attachments", { customerId: "99" }), /outside/);
  assert.throws(() => check("/api/admin/platform/accounts/8/profile", { avatarAssetId: "old" }));
  assert.throws(() => check("/api/admin/platform/accounts/7/profile", { avatarAssetId: "old" }), /this run/);
  assert.throws(() => check("/api/admin/content/conversations/CV-OTHER/replies", { kind: "TEXT" }));
  assert.throws(() => check(messageMutation.path, { kind: "TEXT", replyTargets: [{ conversationNo: "CV-OTHER" }] }), /non-seed/);
  assert.throws(() => check(messageMutation.path, { kind: "IMAGE", attachmentId: "old" }), /this run/);
  assert.throws(() => check(messageMutation.path, { kind: "SKU", skuId: "SKU-OTHER" }));
  const source = readFileSync(join(repo, "scripts/support-analytics-runtime.mjs"), "utf8");
  assert.match(source, /await authorizeRequest\(route\.request\(\)\);\s+await route\.continue\(\)/);
  assert.match(source, /await authorizeRequest\(route\.request\(\)\);\s+const response = await route\.fetch\(\)/);
  assert.match(source, /dropped\) return route\.fallback\(\)/);
});
const connectionProperties = "spring.datasource.url=jdbc:mysql://127.0.0.1:33337/cs_analytics_20261007?useSSL=false\nspring.data.redis.host=127.0.0.1\nspring.data.redis.port=16343\nspring.data.redis.database=0\nnexion.storage.endpoint=http://127.0.0.1:19043\nnexion.storage.bucket=cs-analytics-20261007-private";
function resourceBindings() {
  return { ownership: { mode: "EXCLUSIVE_ANALYTICS", databaseIdentity: { port: 33337, database: "cs_analytics_20261007" }, resourceIdentity: { databasePort: 33337, database: "cs_analytics_20261007", redisHost: "127.0.0.1", redisPort: 16343, redisDatabase: 0, storageEndpoint: "http://127.0.0.1:19043", storageBucket: "cs-analytics-20261007-private" } }, receipt: { resources: { db: { port: 33337, schema: "cs_analytics_20261007" }, redis: { host: "127.0.0.1", port: 16343, database: 0 }, s3: { endpoint: "http://127.0.0.1:19043", port: 19043, bucket: "cs-analytics-20261007-private" } } } };
}
test("hash-matched loaded config still rejects another DB, Redis or storage target", () => {
  const { ownership, receipt } = resourceBindings();
  assertResourceBindings(connectionProperties, ownership, receipt);
  for (const [from, to] of [["mysql://127.0.0.1", "mysql://localhost"], [":33337/", ":3306/"], ["/cs_analytics_20261007?", "/old?"], ["redis.host=127.0.0.1", "redis.host=localhost"], ["redis.port=16343", "redis.port=6379"], ["redis.database=0", "redis.database=1"], ["http://127.0.0.1:19043", "http://127.0.0.1:9000"], ["bucket=cs-analytics-20261007-private", "bucket=old"]]) assert.throws(() => assertResourceBindings(connectionProperties.replace(from, to), ownership, receipt), /Loaded BE connections/);
});
test("missing, duplicate, unresolved properties and receipt/ownership drift fail closed", () => {
  const { ownership, receipt } = resourceBindings();
  assert.throws(() => assertResourceBindings(connectionProperties.replace(/spring.data.redis.host[^\n]*\n/, ""), ownership, receipt), /Missing/);
  assert.throws(() => assertResourceBindings(`${connectionProperties}\nspring.data.redis.port=16343`, ownership, receipt), /Duplicate/);
  assert.throws(() => assertResourceBindings(`${connectionProperties}\nspring.redis.port=6379`, ownership, receipt), /legacy/);
  assert.throws(() => assertResourceBindings(connectionProperties.replace("redis.database=0", "redis.database=${DB}"), ownership, receipt), /Unresolved/);
  const wrongOwnership = structuredClone(ownership); wrongOwnership.resourceIdentity.storageBucket = "old";
  assert.throws(() => assertResourceBindings(connectionProperties, wrongOwnership, receipt));
  const wrongReceipt = structuredClone(receipt); wrongReceipt.resources.redis.database = 1;
  assert.throws(() => assertResourceBindings(connectionProperties, ownership, wrongReceipt));
});
test("Java alternative property separators, escaped keys and continuation overrides are rejected", () => {
  const { ownership, receipt } = resourceBindings();
  for (const override of ["spring.data.redis.port:6379", "spring.data.redis.port 6379", "spring.data.redis.\\u0070ort=6379", "spring.data.redis.\\port=6379", "ignored.value=other\\\nspring.data.redis.port=6379"]) assert.throws(() => assertResourceBindings(`${connectionProperties}\n${override}`, ownership, receipt), /single-line unescaped/);
  assert.throws(() => assertResourceBindings(`${connectionProperties}\n# comment\rspring.data.redis.port:6379`, ownership, receipt), /single-line unescaped/);
  assert.throws(() => assertResourceBindings(connectionProperties.replace("spring.data.redis.port=", "\u00a0spring.data.redis.port="), ownership, receipt), /single-line unescaped/);
  // Colons and equals in values are legal and must not expose or restrict secrets.
  assertResourceBindings(`${connectionProperties}\n# comment\n\nprivate.secret = value:with=delimiters`, ownership, receipt);
});
function manualFeFixture() {
  const now = Date.now(), iso = offset => new Date(now + offset).toISOString(), r = receipt();
  r.recordedAt = iso(0);
  Object.assign(r.fe, { proofMode: "manual-os-limited", commandLineHash: null, processStartTime: iso(-60000), manualProofPath: "root-measured-proof.json", manualProofSha256: "a".repeat(64), buildIdPath: join(repo, ".next-seven-fixture/BUILD_ID"), buildIdSha256: "b".repeat(64) });
  Object.assign(r.be, { pid: 8, processStartTime: iso(-50000), candidateDigest: "be-source" }); r.avatarApproval = avatarPolicy;
  const actual = { pid: 7, processStartTime: r.fe.processStartTime, commandLineHash: null, references: null, commandLineReadable: false, executablePathReadable: false };
  const proof = { kind: "MANUAL_FE_RUNTIME_BINDING_V1", complete: true, taskId: r.taskId, recordedAt: iso(-100), fe: { ...r.fe, commandLine: null, name: "node.exe" }, be: { ...r.be, references: [true, true] }, build: { buildId: "real-build", buildIdPath: r.fe.buildIdPath, buildIdSha256: r.fe.buildIdSha256, buildSourceHead: "59eadb2195942375bdb5628e0f6ddcb91861de29", buildLogCompletedAt: iso(-120000), changedSinceBuild: ["scripts/lib/support-analytics-evidence.mjs"] }, assets: [{ urlPath: "/_next/static/chunks/login.js", localPath: join(repo, ".next-seven-fixture/static/chunks/login.js"), sha256: "c".repeat(64), bytes: 100 }], auth: { via: r.fe.origin, mfaMode: "VERIFY", adminId: avatarPolicy.makerAdminId, username: avatarPolicy.makerUsername, roleCode: "SUPER_ADMIN", passwordChangeRequired: false, cookieName: "nexion_admin_token__cs_analytics_20261007", httpOnly: true, sameSite: "strict", verifiedAt: iso(-1000) }, connection: { observedAt: iso(-1100), fe: { OwningProcess: 7, LocalAddress: "127.0.0.1", LocalPort: 50123, RemoteAddress: "127.0.0.1", RemotePort: 18161, State: 5 }, be: { OwningProcess: 8, LocalAddress: "127.0.0.1", LocalPort: 18161, RemoteAddress: "127.0.0.1", RemotePort: 50123, State: 5 } }, loggedOut: true, loggedOutSessionStatus: 401 };
  return { r, actual, proof, now };
}
test("unreadable command cannot downgrade without complete bound FE proof or affect other services", () => {
  const missing = receipt(); missing.fe.commandLineHash = null; assert.throws(() => assertRuntimeReceipt(missing, target));
  missing.fe.proofMode = "manual-os-limited"; assert.throws(() => assertRuntimeReceipt(missing, target), /alternative proof/);
  const { r, actual, proof, now } = manualFeFixture();
  assertRuntimeReceipt(r, target, now); assertManualFeProof(r, target, proof, actual, now);
  const wrongBe = structuredClone(r); wrongBe.be.commandLineHash = null; assert.throws(() => assertRuntimeReceipt(wrongBe, target, now));
  for (const kind of ["db", "redis", "s3"]) { const wrong = structuredClone(r); wrong.resources[kind].commandLineHash = null; assert.throws(() => assertRuntimeReceipt(wrong, target, now)); }
  assert.throws(() => assertLiveFingerprint(r.be, { ...actual, pid: 8, processStartTime: r.be.processStartTime }), /Readable command/);
  assert.throws(() => assertLiveFingerprint(r.be, { ...r.be, references: [] }), /does not reference/);
});
test("complete manual FE evidence only accepts actual OS null command and the same source/process", () => {
  const { r, actual, proof, now } = manualFeFixture();
  assertManualFeProof(r, target, proof, actual, now);
  for (const alter of [a => a.pid = 9, a => a.processStartTime = new Date(now - 30000).toISOString(), a => a.commandLineReadable = true, a => a.commandLineHash = "a".repeat(64), a => a.references = []]) { const a = structuredClone(actual); alter(a); assert.throws(() => assertManualFeProof(r, target, proof, a, now)); }
  for (const alter of [p => p.fe.candidateDigest = "old", p => p.be.candidateDigest = "old", p => p.be.pid = 9, p => p.recordedAt = new Date(now - 16 * 60000).toISOString(), p => p.build.changedSinceBuild = ["app/page.tsx"], p => p.build.buildLogCompletedAt = new Date(now).toISOString()]) { const p = structuredClone(proof); alter(p); assert.throws(() => assertManualFeProof(r, target, p, actual, now)); }
});
test("manual FE evidence rejects manifest-only, wrong MFA/seed/cookie, tuple or logout claims", () => {
  const { r, actual, proof, now } = manualFeFixture();
  for (const alter of [p => p.assets[0].urlPath = "/_next/static/real-build/_buildManifest.js", p => p.auth.adminId = "999", p => p.auth.roleCode = "SUPPORT", p => p.auth.mfaMode = "ENROLL", p => p.auth.cookieName = "nexion_admin_token", p => p.auth.httpOnly = false, p => p.connection.fe.RemotePort = 18160, p => p.connection.be.OwningProcess = 9, p => p.connection.be.RemotePort = 50124, p => p.connection.fe.State = 4, p => p.loggedOut = false, p => p.loggedOutSessionStatus = 200]) { const p = structuredClone(proof); alter(p); assert.throws(() => assertManualFeProof(r, target, p, actual, now)); }
});
test("manual FE proof rejects the old build or verify output even when both declarations agree", () => {
  const { r, actual, proof, now } = manualFeFixture();
  assertManualFeProof(r, target, proof, actual, now);
  for (const directory of [".next", ".next-seven-verify"]) {
    const wrongReceipt = structuredClone(r), wrongProof = structuredClone(proof);
    wrongReceipt.fe.buildIdPath = join(repo, directory, "BUILD_ID");
    wrongProof.build.buildIdPath = wrongReceipt.fe.buildIdPath;
    wrongProof.assets[0].localPath = join(repo, directory, "static/chunks/login.js");
    assert.throws(() => assertManualFeProof(wrongReceipt, target, wrongProof, actual, now), /different serving directory/);
    const wrongAsset = structuredClone(proof);
    wrongAsset.assets[0].localPath = join(repo, directory, "static/chunks/login.js");
    assert.throws(() => assertManualFeProof(r, target, wrongAsset, actual, now), /different serving directory/);
  }
});
test("public preload binds the serving fixture separately from verify builds", () => {
  const backendCookie = "process.env.NEXION_BACKEND_URL = 'http://127.0.0.1:18161';\nprocess.env.NEXION_ADMIN_COOKIE_NAMESPACE = 'cs_analytics_20261007';";
  assertFePreload(backendCookie + "\nprocess.env.NEXT_DIST_DIR = '.next-seven-fixture';\n");
  assert.throws(() => assertFePreload(backendCookie), /serving-build binding/);
  for (const directory of [".next", ".next-seven-verify"]) assert.throws(() => assertFePreload(backendCookie + `\nprocess.env.NEXT_DIST_DIR = '${directory}';`), /serving-build binding/);
});

test("r4 runtime profile binds its fixed origin and preload while preserving r3", () => {
  const r3Task = "support-analytics-frontend-20261007-r3", r4Task = "support-analytics-frontend-20261007-r4";
  const backendCookie = "process.env.NEXION_BACKEND_URL = 'http://127.0.0.1:18161';\nprocess.env.NEXION_ADMIN_COOKIE_NAMESPACE = 'cs_analytics_20261007';";
  const preload = directory => backendCookie + `\nprocess.env.NEXT_DIST_DIR = '${directory}';`;
  for (const [taskId, origin, directory] of [[r3Task, "http://127.0.0.1:33107", ".next-seven-fixture"], [r4Task, "http://127.0.0.1:33108", ".next-seven-r4"]]) {
    const r = receipt(); r.taskId = taskId; r.fe.origin = origin;
    const t = { ...target, taskId, origin };
    assertRuntimeReceipt(r, t);
    assertFePreload(preload(directory), taskId);
    for (const wrongOrigin of ["http://127.0.0.1:33041", "http://127.0.0.1:33109", origin.endsWith("33108") ? "http://127.0.0.1:33107" : "http://127.0.0.1:33108"]) {
      const wrong = structuredClone(r); wrong.fe.origin = wrongOrigin;
      assert.throws(() => assertRuntimeReceipt(wrong, { ...t, origin: wrongOrigin }));
    }
    for (const wrongDirectory of [".next", ".next-seven-verify-r4", directory === ".next-seven-r4" ? ".next-seven-fixture" : ".next-seven-r4"]) assert.throws(() => assertFePreload(preload(wrongDirectory), taskId), /serving-build binding/);
  }
  assert.throws(() => assertFePreload(preload(".next-seven-r4")), /serving-build binding/);
  assert.throws(() => assertFePreload(preload(".next-seven-r4"), r4Task + "-copy"), /serving-build binding/);
});

test("r4 manual runtime profile accepts its build and rejects cross-generation receipt or asset paths", () => {
  const { r, actual, proof, now } = manualFeFixture(), taskId = "support-analytics-frontend-20261007-r4";
  r.taskId = proof.taskId = taskId;
  r.fe.origin = proof.fe.origin = proof.auth.via = "http://127.0.0.1:33108";
  r.fe.buildIdPath = proof.build.buildIdPath = join(repo, ".next-seven-r4/BUILD_ID");
  proof.assets[0].localPath = join(repo, ".next-seven-r4/static/chunks/login.js");
  const t = { ...target, taskId, origin: r.fe.origin };
  assertRuntimeReceipt(r, t, now); assertManualFeProof(r, t, proof, actual, now);
  for (const directory of [".next-seven-fixture", ".next-seven-verify", ".next-seven-verify-r4", ".next"]) {
    const wrongReceipt = structuredClone(r), wrongProof = structuredClone(proof);
    wrongReceipt.fe.buildIdPath = wrongProof.build.buildIdPath = join(repo, directory, "BUILD_ID");
    wrongProof.assets[0].localPath = join(repo, directory, "static/chunks/login.js");
    assert.throws(() => assertManualFeProof(wrongReceipt, t, wrongProof, actual, now), /different serving directory/);
    const wrongAsset = structuredClone(proof); wrongAsset.assets[0].localPath = join(repo, directory, "static/chunks/login.js");
    assert.throws(() => assertManualFeProof(r, t, wrongAsset, actual, now), /different serving directory/);
  }
  const wrongOrigin = structuredClone(r), wrongProof = structuredClone(proof);
  wrongOrigin.fe.origin = wrongProof.fe.origin = wrongProof.auth.via = "http://127.0.0.1:33107";
  assert.throws(() => assertManualFeProof(wrongOrigin, { ...t, origin: wrongOrigin.fe.origin }, wrongProof, actual, now));
  const oldTask = { ...t, taskId: "support-analytics-frontend-20261007-r3" };
  assert.throws(() => assertManualFeProof(r, oldTask, proof, actual, now));
});
test("equivalent Windows repository spellings retain ownership while another tree is rejected", () => {
  const { r, actual, proof, now } = manualFeFixture();
  r.fe.repo = repo.replaceAll("\\", "/");
  proof.fe.repo = repo;
  assertRuntimeReceipt(r, target, now);
  assertManualFeProof(r, target, proof, actual, now);
  const wrong = structuredClone(r); wrong.fe.repo = resolve(repo, "../other-worktree");
  assert.throws(() => assertRuntimeReceipt(wrong, target, now));
  const result = run({ repo: repo.replaceAll("\\", "/"), baseUrl: "http://127.0.0.1:33107" }, { omitReceipt: true });
  assert.equal(result.status, 1);
  assert.match(result.report.steps[0].reason, /receipt is required before login or writes/);
});
test("the real sidebar remains unique when M3 also mounts a customer-profile aside", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<aside><a aria-label="UVEL 运营控制台" href="/">控制台</a><nav>菜单</nav></aside><aside class="cv-profile" aria-label="客户资料">客户资料</aside>');
    assert.equal(await page.locator("aside").count(), 2);
    assert.equal(await page.locator(consoleSidebarRoot).count(), 1);
    await page.locator(consoleSidebarRoot).waitFor({ state: "visible" });
  } finally { await browser.close(); }
});

test("actual rendered Blob bytes remain verifiable under CSP without fetching or reusing revoked URLs", async () => {
  const bytes = readFileSync(join(repo, "node_modules/playwright-core/lib/server/chromium/appIcon.png"));
  const expected = sha256(bytes), browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await installRenderedBlobObserver(page);
    await page.route("http://127.0.0.1:33299/blob-csp", route => route.fulfill({
      status: 200, contentType: "text/html", headers: { "content-security-policy": "connect-src 'none'; img-src blob:; script-src 'unsafe-inline'" },
      body: `<img alt="actual fixture"><script>const bytes=Uint8Array.from(atob('${bytes.toString("base64")}'), c=>c.charCodeAt(0));document.querySelector('img').src=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));</script>`,
    }));
    await page.goto("http://127.0.0.1:33299/blob-csp");
    const undecoded = await page.evaluate(`(async () => {
      const observe = ${renderedBlobObservation.toString()};
      const element = document.createElement('img'); document.body.append(element);
      element.style.maxWidth = '320px'; element.style.maxHeight = '260px';
      const content = Uint8Array.from(atob('${bytes.toString("base64")}'), c => c.charCodeAt(0));
      element.src = URL.createObjectURL(new Blob([content], { type: 'image/png' }));
      const before = { connected: element.isConnected, width: element.naturalWidth, height: element.naturalHeight, rectWidth: element.getBoundingClientRect().width, rectHeight: element.getBoundingClientRect().height };
      const observation = await observe(element); URL.revokeObjectURL(element.currentSrc); element.remove();
      return { before, observation };
    })()`);
    assert.deepEqual(undecoded.before, { connected: true, width: 0, height: 0, rectWidth: 0, rectHeight: 0 });
    assert.equal(undecoded.observation.sha256, expected); assert.equal(undecoded.observation.visible, true); assert.equal(undecoded.observation.decoded, true);
    const image = page.getByAltText("actual fixture");
    await image.waitFor({ state: "visible" });
    assert.equal(await image.evaluate(async element => { try { await fetch(element.currentSrc); return false; } catch { return true; } }), true, "The real CSP must reject the original Blob fetch");
    assert.equal(await renderedBlobSha256(image), expected);
    const initialMatch = await waitForRenderedImageMatch(image, expected);
    assert.equal(initialMatch.matched.visible, true); assert.equal(initialMatch.matched.connected, true); assert.equal(initialMatch.matched.decoded, true); assert.equal(initialMatch.matched.sha256, expected);
    await page.reload();
    await image.waitFor({ state: "visible" });
    assert.equal(await renderedBlobSha256(image), expected, "The observer must initialize on reload");
    await image.evaluate(element => { const blob=window.__supportAcceptanceImageBlobs.get(element.currentSrc);element.src=URL.createObjectURL(new Blob([blob,new Uint8Array([1])],{type:'image/png'})); });
    assert.notEqual(await renderedBlobSha256(image), expected, "Identical decoded pixels cannot stand in for the original bytes");
    await assert.rejects(waitForRenderedImageMatch(image, expected), error => {
      assert.match(error.message, /bytes do not match/); assert.equal(error.imageObservations.length, 1);
      assert.equal(error.imageObservations[0].visibleCount, 1); assert.notEqual(error.imageObservations[0].images[0].sha256, expected); return true;
    });
    await image.evaluate(element => URL.revokeObjectURL(element.currentSrc));
    await assert.rejects(renderedBlobSha256(image), /not observed or was revoked/);
    await assert.rejects(waitForRenderedImageMatch(image, expected), /not observed or was revoked/);
    await page.reload(); await image.waitFor({ state: "visible" });
    await image.evaluate(element => {
      const blob = window.__supportAcceptanceImageBlobs.get(element.currentSrc); element.remove();
      setTimeout(() => { const next = document.createElement("img"); next.alt = "actual fixture"; next.src = URL.createObjectURL(blob); document.body.append(next); }, 100);
    });
    const delayed = await waitForRenderedImageMatch(image, expected, { timeoutMs: 2000, pollMs: 25 });
    assert.equal(delayed.observations[0].count, 0); assert.equal(delayed.matched.sha256, expected);
    const oldSource = delayed.matched.src;
    await page.evaluate(() => {
      const original = crypto.subtle.digest.bind(crypto.subtle); let once = false;
      crypto.subtle.digest = async (...args) => {
        if (!once) {
          once = true; const element = document.querySelector('img'), blob = window.__supportAcceptanceImageBlobs.get(element.currentSrc); element.remove();
          setTimeout(() => { const next = document.createElement("img"); next.alt = "actual fixture"; next.src = URL.createObjectURL(blob); document.body.append(next); }, 50);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return original(...args);
      };
    });
    const reattached = await waitForRenderedImageMatch(image, expected, { timeoutMs: 2000, pollMs: 25 });
    assert.ok(reattached.observations.some(row => row.images.some(image => image.reason === "detached" && image.sha256 === expected)), "The old detached image's correct hash must not pass");
    assert.notEqual(reattached.matched.src, oldSource); assert.equal(reattached.matched.connected, true); assert.equal(reattached.matched.visible, true);
    for (const mode of ["late", "never"]) {
      await page.reload(); await image.waitFor({ state: "visible" });
      await image.evaluate(element => element.decode());
      await page.evaluate(mode => {
        const original = crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest = mode === "never" ? () => new Promise(() => {}) : async (...args) => { await new Promise(resolve => setTimeout(resolve, 120)); return original(...args); };
      }, mode);
      const started = Date.now();
      await assert.rejects(waitForRenderedImageMatch(image, expected, { timeoutMs: 30, pollMs: 5 }), error => {
        assert.match(error.message, /observation deadline/); assert.ok(error.imageObservations.some(row => row.reason === "observation-deadline")); return true;
      });
      assert.ok(Date.now() - started < 1000, "A pending observation escaped its bounded deadline");
    }
    for (const change of ["source", "visibility"]) {
      await page.reload(); await image.waitFor({ state: "visible" });
      await page.evaluate(change => {
        const original = crypto.subtle.digest.bind(crypto.subtle); let once = false;
        crypto.subtle.digest = async (...args) => {
          if (!once) {
            once = true; const element = document.querySelector("img");
            if (change === "source") element.src = URL.createObjectURL(window.__supportAcceptanceImageBlobs.get(element.currentSrc));
            else element.style.display = "none";
            await new Promise(resolve => setTimeout(resolve, 80));
          }
          return original(...args);
        };
      }, change);
      await assert.rejects(waitForRenderedImageMatch(image, expected), change === "source" ? /source-changed/ : /not visible/);
    }
    await page.reload(); await image.waitFor({ state: "visible" });
    await image.evaluate(element => element.remove());
    await assert.rejects(waitForRenderedImageMatch(image, expected, { timeoutMs: 150, pollMs: 25 }), error => {
      assert.match(error.message, /observation deadline/); assert.ok(error.imageObservations.length > 1); assert.ok(error.imageObservations.every(row => row.count === 0)); return true;
    });
    await page.reload(); await image.waitFor({ state: "visible" });
    await image.evaluate(element => { element.width = 200; element.height = 200; element.src = URL.createObjectURL(new Blob(["not an image"], { type: "image/png" })); });
    await assert.rejects(waitForRenderedImageMatch(image, expected), error => {
      assert.match(error.message, /decode-error/); assert.equal(error.imageObservations.length, 1); return true;
    });
    const unobserved = await browser.newPage();
    await unobserved.route("http://127.0.0.1:33299/blob-csp", route => route.fulfill({status:200,contentType:"text/html",body:`<img alt="unobserved"><script>document.querySelector('img').src=URL.createObjectURL(new Blob([Uint8Array.from(atob('${bytes.toString("base64")}'),c=>c.charCodeAt(0))],{type:'image/png'}));</script>`}));
    await unobserved.goto("http://127.0.0.1:33299/blob-csp");
    await assert.rejects(renderedBlobSha256(unobserved.getByAltText("unobserved")), /not observed or was revoked/);
    await assert.rejects(waitForRenderedImageMatch(unobserved.getByAltText("unobserved"), expected), /not observed or was revoked/);
  } finally { await browser.close(); }
});
test("fresh asynchronous OS collection preserves real process fields without blocking and rejects a closed listener", async () => {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(servers.map(server => new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); })));
    const bindings = servers.map(server => ({ port: server.address().port, paths: [process.execPath] }));
    let beats = 0;
    const heartbeat = setInterval(() => beats++, 1);
    let batch;
    try { batch = await windowsFingerprintBatch(bindings); } finally { clearInterval(heartbeat); }
    assert.ok(beats > 0, "OS ownership collection blocked the Node event loop");
    assert.equal(batch.length, 2);
    for (const [index, actual] of batch.entries()) {
      assert.equal(actual.pid, process.pid);
      assert.deepEqual(Object.keys(actual).toSorted(), ["pid", "processStartTime", "commandLineHash", "references", "commandLineReadable", "executablePathReadable"].toSorted());
      assert.deepEqual(actual, windowsFingerprint(bindings[index].port, bindings[index].paths), "Asynchronous and compatible synchronous fingerprints disagree");
    }
    await new Promise(resolve => servers[1].close(resolve));
    await assert.rejects(windowsFingerprintBatch(bindings), /Cannot establish live listener\/process ownership/);
    assert.throws(() => windowsFingerprintBatch([{port:0,paths:[process.execPath]}]));
    assert.throws(() => windowsFingerprintBatch([bindings[0], bindings[0]]), /Duplicate listener/);
  } finally { await Promise.all(servers.filter(server => server.listening).map(server => new Promise(resolve => server.close(resolve)))); }
});

test("r5 production profile preserves r3/r4 and rejects dev, manual, stale and cross-generation resources", () => {
  const taskId = "support-analytics-frontend-20261007-r5", r = receipt(), t = { ...target, taskId, origin: "http://127.0.0.1:33108" };
  r.taskId = taskId; r.fe.origin = t.origin;
  r.fe.buildSourceDigest = t.candidateDigest; r.fe.buildSourceHead = "a".repeat(40); r.fe.buildLogPath = join(repo, "fixture-production-build.log"); r.fe.buildLogSha256 = "a".repeat(64); r.fe.envBindingPath = join(repo, "fixture-preload.cjs");
  assertRuntimeReceipt(r, t);
  const references = feOwnershipReferences(t, r), productionCommand = `${process.execPath} --require ${r.fe.envBindingPath} ${join(repo, "node_modules/next/dist/bin/next")} start --hostname 127.0.0.1 --port 33108`;
  assert.ok(references.every(path => productionCommand.includes(path)));
  for (const wrong of [productionCommand.replace("start --", "dev --"), productionCommand.replace("33108", "33107"), productionCommand.replace(join(repo, "node_modules/next/dist/bin/next"), join(repo, "custom-server.mjs"))]) assert.ok(!references.every(path => wrong.includes(path)));
  for (const change of [{ buildSourceDigest: "old-source" }, { buildSourceHead: "old-head" }, { buildLogPath: undefined }, { buildLogSha256: "old-log" }]) assert.throws(() => assertRuntimeReceipt({ ...r, fe: { ...r.fe, ...change } }, t));
  const preload = directory => `process.env.NEXION_BACKEND_URL = 'http://127.0.0.1:18161';\nprocess.env.NEXION_ADMIN_COOKIE_NAMESPACE = 'cs_analytics_20261007';\nprocess.env.NEXT_DIST_DIR = '${directory}';`;
  assertFePreload(preload(".next-seven-r5"), taskId);
  for (const directory of [".next", ".next-seven-r4", ".next-seven-fixture", ".next-verify-r11-current", ".next-seven-verify-r5"]) assert.throws(() => assertFePreload(preload(directory), taskId));
  for (const port of [33107, 33109]) { const wrong = structuredClone(r); wrong.fe.origin = `http://127.0.0.1:${port}`; assert.throws(() => assertRuntimeReceipt(wrong, { ...t, origin: wrong.fe.origin })); }
  for (const proofMode of ["DEV_SOURCE_BOUND", "manual-os-limited"]) { const wrong = structuredClone(r); wrong.fe.proofMode = proofMode; assert.throws(() => assertRuntimeReceipt(wrong, t), /production process/); }
  assert.throws(() => assertRuntimeReceipt({ ...r, recordedAt: new Date(Date.now() - 16 * 60000).toISOString() }, t), /stale/);
  const { proof, actual, now } = manualFeFixture(); assert.throws(() => assertManualFeProof(r, t, proof, actual, now), /MANUAL_FE/);
});

test("formal runtime binds all direct and integration sources without relabelling current identity", () => {
  const identity = { taskId: "support-analytics-frontend-20261007-r5", stepId: "I0-F", checkId: "runtime", runId: randomUUID(), repo, snapshotHash: "a".repeat(64) };
  for (const phase of ["I0-F", "I3-F", "I5R-V"]) assertRuntimeIdentity({ ...identity, stepId: phase }, phase, repo);
  for (const [phase, checkId] of [["I0-F", "step-0-check-3"], ["I3-F", "step-1-check-1"], ["I5R-V", "step-4-check-1"]]) {
    const current = { ...identity, stepId: "integration", checkId }, before = structuredClone(current);
    assertRuntimeIdentity(current, phase, repo); assert.deepEqual(current, before);
    assert.throws(() => assertRuntimeIdentity({ ...current, checkId: "step-3-check-1" }, phase, repo), /mismatch/);
  }
  for (const [phase, checkId] of [["I4-F", "step-2-check-1"], ["I5-F", "step-3-check-1"], ["I5R-F", "step-5-check-1"], ["I6-F", "step-6-check-2"], ["integration", "integration-check-3"]]) assert.throws(() => assertRuntimeIdentity({ ...identity, stepId: "integration", checkId }, phase, repo), /no implemented/);
  for (const change of [{ taskId: identity.taskId + "copy" }, { taskId: "negative-test" }, { runId: "manual" }, { runId: undefined }, { snapshotHash: "old" }, { repo: undefined }, { repo: resolve(repo, "../wrong") }, { stepId: "I3-F" }, { checkId: "manual" }]) assert.throws(() => assertRuntimeIdentity({ ...identity, ...change }, "I0-F", repo));
  assert.throws(() => assertRuntimeIdentity(identity, "invented", repo), /Unknown source/);
  const state = { id: identity.taskId, repo, steps: { "I0-F": { status: "running", activePid: process.pid, runs: [{ id: identity.runId, status: "running", snapshot: { hash: identity.snapshotHash } }] } } };
  assertActiveRuntimeState(identity, state);
  for (const alter of [s => s.steps["I0-F"].activePid++, s => s.steps["I0-F"].status = "passed", s => s.steps["I0-F"].runs[0].id = randomUUID(), s => s.steps["I0-F"].runs[0].snapshot.hash = "b".repeat(64)]) { const wrong = structuredClone(state); alter(wrong); assert.throws(() => assertActiveRuntimeState(identity, wrong)); }
});

test("unknown formal task and integration positions are rejected by the real child-process entry before config or browser", () => {
  const dir = mkdtempSync(join(tmpdir(), "support-formal-negative-"));
  const env = { ...process.env, WORKFLOW_TASK_ID: "support-analytics-frontend-20261007-r5", WORKFLOW_STEP_ID: "integration", WORKFLOW_CHECK_ID: "step-1-check-1", WORKFLOW_RUN_ID: randomUUID(), WORKFLOW_REPO: repo, WORKFLOW_SNAPSHOT_HASH: "a".repeat(64) };
  for (const [change, phase, reason] of [[{ WORKFLOW_TASK_ID: env.WORKFLOW_TASK_ID + "-copy" }, "I3-F", /Unknown formal/], [{ WORKFLOW_CHECK_ID: "step-0-check-3" }, "I3-F", /mismatch/], [{ WORKFLOW_CHECK_ID: "integration-check-3" }, "integration", /no implemented/]]) {
    const report = join(dir, randomUUID() + ".json"), result = spawnSync(process.execPath, ["scripts/support-analytics-runtime.mjs", "--phase", phase, "--report", report], { cwd: repo, env: { ...env, ...change }, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 1); const record = JSON.parse(readFileSync(report, "utf8")); assert.equal(record.verdict, "unverified"); assert.match(record.steps[0].reason, reason); assert.deepEqual(record.steps[0].evidence, []); assert.equal(record.stepId, "integration");
  }
});

test("I3 read-only boundary permits existing auth and denies every business mutation before dispatch", async () => {
  for (const path of ["/api/admin/auth/login", "/api/admin/auth/mfa/verify", "/api/admin/auth/logout", "/api/admin/content/conversations/realtime-ticket"]) assert.equal(assertReadOnlyRequest("POST", path), "readAuth");
  assert.equal(assertReadOnlyRequest("GET", "/api/admin/content/support-workbench/analytics"), "read");
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) for (const path of ["/api/admin/content/support-agents/groups", "/api/admin/content/conversations/1/replies", "/unknown"]) assert.throws(() => assertReadOnlyRequest(method, path), /prohibits/);
  const { parseMContentApiEnvelope } = await import("../lib/admin/m-support-read-contract.ts"), { parseSupportGroup } = await import("../lib/admin/support-group-client.ts");
  const realShape = { id: "4", name: "Controlled group", supervisorAdminId: "2", status: "ENABLED", version: 1 };
  assert.deepEqual(parseMContentApiEnvelope(200, JSON.stringify({ code: 0, data: [realShape] }), true).map(parseSupportGroup), [realShape]);
  for (const body of [{ code: 403, data: [realShape] }, { code: 0 }, { code: 0, data: [{ ...realShape, private: "unknown-field" }] }]) assert.throws(() => parseMContentApiEnvelope(200, JSON.stringify(body), true).map(parseSupportGroup));
});

test("I3 current scope rejects stale version, foreign people/groups and fabricated UNKNOWN totals", () => {
  const accountCase = { mode: "PERSONAL", adminId: "12", groupIds: ["4"] }, now = Date.now(), data = { view: "CUSTOMERS", businessZone: "Asia/Shanghai", asOf: new Date(now).toISOString(), versionState: "READY", queryVersion: `saq-v1:${"b".repeat(64)}`, total: 1, canContinue: false, scopeSummary: { mode: "PERSONAL", groups: [{ groupId: "4" }] }, records: [{ owner: { agentId: "12", groupId: "4" } }] };
  assertAnalyticsScope(data, {}, accountCase, now);
  for (const alter of [d => d.scopeSummary.mode = "ALL", d => d.scopeSummary.groups.push({ groupId: "5" }), d => d.records[0].owner.agentId = "99", d => d.asOf = new Date(now - 16 * 60000).toISOString(), d => d.queryVersion = "old", d => d.versionState = "UNKNOWN"]) { const wrong = structuredClone(data); alter(wrong); assert.throws(() => assertAnalyticsScope(wrong, {}, accountCase, now)); }
  assert.throws(() => assertAnalyticsScope(data, { expectedVersion: `saq-v1:${"c".repeat(64)}` }, accountCase, now));
  const unknown = { ...data, versionState: "UNKNOWN", queryVersion: null, total: null }; assertAnalyticsScope(unknown, {}, accountCase, now);
  const managed = structuredClone(data); managed.scopeSummary.mode = "MANAGED";
  assertAnalyticsScope(managed, {}, { ...accountCase, mode: "MANAGED" }, now); managed.records[0].owner.groupId = "5"; assert.throws(() => assertAnalyticsScope(managed, {}, { ...accountCase, mode: "MANAGED" }, now), /foreign/);
});

test("I3 configuration requires three real seeds and explicit denial authorization without inventing a supervisor", () => {
  const modes = ["PERSONAL", "MANAGED", "ALL"], config = { baseUrl: "http://127.0.0.1:33108", accounts: Object.fromEntries(modes.map(mode => [mode, { username: mode, passwordEnv: "PASSWORD", totpSecretEnv: "TOTP" }])) };
  const receipt = { allowedSeedObjects: { usernames: modes, accountIds: ["1", "2", "3"] }, authorizedReadPaths: ["/api/admin/content/support-agents/groups/999"] };
  const handoff = { backend: {}, cases: modes.map((mode, index) => ({ mode, account: mode, adminId: String(index + 1), groupIds: ["4"], menuCodes: ["service_m1"], authorities: ["service_m1_read"], emptyKeyword: "authorized-empty-query", negativeReads: [{ path: receipt.authorizedReadPaths[0], status: 403 }] })) };
  assertHandoffConfig(handoff, config, receipt);
  for (const alter of [h => h.cases.pop(), h => h.cases[1].account = "missing-supervisor", h => h.cases[1].adminId = "99", h => h.cases[0].groupIds.push("4"), h => h.cases[0].negativeReads[0].path = "/api/admin/content/unprovisioned", h => h.cases[0].negativeReads[0].status = 200, h => h.cases[0].negativeReads = [], h => h.cases[1].account = "PERSONAL", h => h.cases[2].adminId = "1"]) { const wrong = structuredClone(handoff); alter(wrong); assert.throws(() => assertHandoffConfig(wrong, config, receipt)); }
});

test("I3 backend handoff checks every required phase's current evidence and scope rather than an old PASS summary", () => {
  const ids = ["I1-A", "I1-B", "I2-A", "I2-B", "I3-B"], ctx = { plan: { steps: ids.map(id => ({ id })), inputs: [] } }, state = { steps: Object.fromEntries(ids.map(id => [id, { status: "passed", receipt: { scopeHash: "current-scope", scopePaths: [] } }])) }, observed = [];
  const evidence = (_ctx, _state, { only }) => { observed.push(only); return []; };
  assertBackendEvidence(ctx, state, {}, evidence, () => "current-scope"); assert.deepEqual(observed, ids);
  for (const id of ids) { const wrong = structuredClone(state); wrong.steps[id].status = "awaiting_review"; assert.throws(() => assertBackendEvidence(ctx, wrong, {}, evidence, () => "current-scope")); }
  assert.throws(() => assertBackendEvidence(ctx, state, {}, () => ["record/stream/review changed"], () => "current-scope"));
  assert.throws(() => assertBackendEvidence(ctx, state, {}, evidence, () => "drifted-scope"), /scope changed/);
  assert.throws(() => assertBackendEvidence({ plan: { ...ctx.plan, steps: ctx.plan.steps.slice(1) } }, state, {}, evidence, () => "current-scope"), /lost a required/);
});

test("handoff numeric proof uses the actual Numeric renderer and rejects 1/10, currency and UNKNOWN substitutions", async () => {
  const require = createRequire(join(repo, "package.json")), ts = require("typescript"), React = require("react"), jsx = require("react/jsx-runtime");
  const source = readFileSync(join(repo, "app/components/domain-views/m-tabs/m1-analytics-workbench.tsx"), "utf8");
  const ast = ts.createSourceFile("workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const numeric = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Numeric");
  const formatterSource = readFileSync(join(repo, "app/components/domain-views/m-tabs/support-leaderboard.tsx"), "utf8"), formatterAst = ts.createSourceFile("formatter.tsx", formatterSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const formatter = formatterAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "compactSupportBoardValue");
  const code = ts.transpileModule(`${formatter.getText(formatterAst)}\n${numeric.getText(ast)}\nexports.Numeric=Numeric;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {}; runInNewContext(code, { exports, require: id => { assert.equal(id, "react/jsx-runtime"); return jsx; } });
  const render = require("react-dom/server").renderToStaticMarkup, browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const currency of ["USDT", "NEX"]) for (const value of ["1", "10", "1.00", "1000.123456", null]) for (const observed of [value, "10", null]) {
      const label = `本人累充 ${currency}`;
      await page.setContent(render(React.createElement(exports.Numeric, { value, observed, label, kind: "amount", onClick() {} })));
      const numeric = page.locator(".sa-number");
      await assertNumericDom(numeric, { confirmed: value, observed }, label);
      if (value === "1" || value === "10") await assert.rejects(assertNumericDom(numeric, { confirmed: value === "1" ? "10" : "1", observed }, label), /exact numeric/);
      await assert.rejects(assertNumericDom(numeric, { confirmed: value, observed }, `本人累充 ${currency === "USDT" ? "NEX" : "USDT"}`), /identity\/currency/);
      if (value === null) await assert.rejects(assertNumericDom(numeric, { confirmed: "0", observed }, label), /exact numeric/);
    }
    await page.setContent(render(React.createElement(exports.Numeric, { value: "10", observed: "10", label: "专属客服", onClick() {} })));
    await assert.rejects(assertNumericDom(page.locator(".sa-number"), { confirmed: "1", observed: "1" }, "专属客服"), /exact numeric/);
  } finally { await browser.close(); }
});

test("handoff directory behavior executes the real group component for directory and initial member-detail entries", async () => {
  // The existing source harness runs the actual container's hooks/effects/events.
  // Render that real tree into a controlled browser; only transport promises and auth are fixtures.
  const { harness, group, detail } = await import("./helpers.mjs");
  const require = createRequire(join(repo, "package.json")), React = require("react"), render = require("react-dom/server").renderToStaticMarkup;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const initialGroupId of [undefined, "5"]) {
      const groups = [group("5"), group("6")], initialDetail = detail("5");
      const h = harness({ props: { initialGroupId }, implementations: { groups: () => groups, detail: id => detail(id) } });
      const page = await browser.newPage(); let actions = [];
      function dom(node) {
        if (Array.isArray(node)) return node.map((child, index) => { const rendered = dom(child); return React.isValidElement(rendered) ? React.cloneElement(rendered, { key: child.key ?? index }) : rendered; });
        if (!React.isValidElement(node)) return node;
        const props = { ...node.props, key: node.key }, type = typeof node.type === "function" && node.type.name === "Btn" ? "button" : node.type;
        if (props.onClick) { const index = actions.push(props.onClick) - 1; props["data-fixture-action"] = index; delete props.onClick; }
        delete props.variant; return React.createElement(type, props, dom(props.children));
      }
      const update = async () => { await h.flush(); actions = []; await page.setContent(render(dom(h.tree))); await page.evaluate(backs => { window.handoffFixtureFinished = backs === 1; document.querySelectorAll("[data-fixture-action]").forEach(button => button.addEventListener("click", () => void window.handoffFixtureClick(Number(button.dataset.fixtureAction)))); }, h.backs); };
      await page.exposeFunction("handoffFixtureClick", async index => { actions[index](); h.commit(); await update(); });
      try {
        await update(); const root = page.getByRole("region", { name: "客服组管理" });
        if (initialGroupId) { assert.equal(await root.getByRole("button", { name: "管理成员与组资料", exact: true }).count(), 0); assert.equal(h.calls.some(call => call.name === "detail" && call.args[0] === "5"), true); }
        const rows = await enterGroupDirectory(root, groups, initialGroupId ? initialDetail : undefined);
        await rows.first().getByRole("button", { name: "管理成员与组资料", exact: true }).click();
        await root.getByRole("button", { name: "返回组目录", exact: true }).waitFor({ state: "visible" });
        await enterGroupDirectory(root, groups, initialDetail);
        await root.getByRole("button", { name: "返回统计工作台", exact: true }).click();
        await page.waitForFunction(() => window.handoffFixtureFinished === true);
        assert.equal(h.backs, 1); assert.ok(h.calls.every(call => ["groups", "detail", "member"].includes(call.name)), "Directory read-only traversal attempted a business mutation");
      } finally { h.unmount(); await page.close(); }
    }
  } finally { await browser.close(); }
});

test("the actual statistics scope-return effect restores the selected group, dataset, basis and currency", async () => {
  const require = createRequire(join(repo, "package.json")), ts = require("typescript");
  const source = readFileSync(join(repo, "app/components/domain-views/m-tabs/m1-analytics-workbench.tsx"), "utf8"), ast = ts.createSourceFile("workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const resolved = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ResolvedAnalyticsWorkbench");
  const effect = resolved.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect" && node.expression.arguments[1]?.getText(ast) === "[scopeRetry]").expression.arguments[0];
  const helperNames = ["changeAnalyticsQuery", "initialAnalyticsQuery", "analyticsBusinessMonth", "analyticsEntryAgent"];
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text)).map(node => node.getText(ast)).join("\n");
  for (const selectedGroup of [undefined, "5"]) {
    const remembered = { groupId: selectedGroup, view: "CUSTOMERS", basis: "PERIOD_EVENT", currency: "NEX", month: "2026-10", pageNum: 2, expectedVersion: `saq-v1:${"a".repeat(64)}`, category: "ALL", firstState: "ALL", filter: "ALL" };
    const managementReturnQuery = { current: remembered }, queries = []; let restored;
    const noop = () => {}, globals = { exports: {}, AbortController, Date, Intl, URLSearchParams, window: { location: { search: "" } }, managementReturnQuery, supportAnalyticsClient: { query: async query => { queries.push(query); return { scopeSummary: { mode: "MANAGED", groups: [{ groupId: "5" }] } }; } }, setScope: noop, setScopeError: noop, setData: noop, setProfileId: noop, setOperations: noop, setGroupManagement: noop, setPersonalAnalytics: noop, analyticsErrorText: cause => { throw cause; }, setQueryState: value => { restored = value; } };
    const code = ts.transpileModule(`${helpers}\n(${effect.getText(ast)})();`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    runInNewContext(code, globals); await new Promise(resolve => setImmediate(resolve));
    assert.equal(queries[0].view, "OVERVIEW"); assert.equal(restored.groupId, selectedGroup); assert.equal(restored.view, "CUSTOMERS"); assert.equal(restored.basis, "PERIOD_EVENT"); assert.equal(restored.currency, "NEX"); assert.equal(restored.month, "2026-10"); assert.equal(restored.pageNum, 1); assert.equal(restored.expectedVersion, undefined); assert.equal(managementReturnQuery.current, null);
  }
});

test("actual handoff login prelude waits for the TOTP window before arming the default session response timeout", async () => {
  const require = createRequire(join(repo, "package.json")), ts = require("typescript");
  const source = readFileSync(join(repo, "tests/support-analytics-handoff-runtime.mjs"), "utf8"), ast = ts.createSourceFile("handoff.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let statements;
  function visit(node) {
    if (ts.isBlock(node) && node.statements.some(statement => statement.getText(ast).startsWith("const initialSession ="))) statements = node.statements;
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(statements, "The actual produceHandoff login sequence disappeared");
  const wait = statements.findIndex(statement => statement.getText(ast).startsWith("await new Promise(resolve => setTimeout(resolve, 30000 - Date.now() % 30000 + 250))"));
  const listener = statements.findIndex(statement => statement.getText(ast).startsWith("const initialSession ="));
  const request = statements.findIndex(statement => statement.getText(ast).startsWith("const sessionBody = await login("));
  const status = statements.findIndex(statement => statement.getText(ast).startsWith("assert.equal((await initialSession).status(), 401"));
  assert.ok([wait, listener, request, status].every(index => index >= 0));
  const productionPrelude = statements.slice(Math.min(wait, listener, request, status), Math.max(wait, listener, request, status) + 1).map(statement => statement.getText(ast)).join("\n");
  async function execute(initialClock, initialStatus = 401) {
    let now = initialClock, deadline, predicate, resolveResponse; const events = [];
    const response = { url: () => "http://127.0.0.1:33108/api/admin/auth/session", request: () => ({ method: () => "GET" }), status: () => initialStatus };
    const page = { waitForResponse(condition, options) { assert.equal(options, undefined, "Production must retain the default response timeout"); events.push({ kind: "listener", at: now }); deadline = now + 30000; predicate = condition; return new Promise(resolve => { resolveResponse = resolve; }); } };
    const globals = { assert, Promise, URL, Date: { now: () => now }, context: {}, page, config: { baseUrl: "http://127.0.0.1:33108", accounts: { personal: {} } }, accountCase: { account: "personal" }, setTimeout(callback, delay) { events.push({ kind: "sleep", at: now, delay }); now += delay; callback(); }, login: async () => {
      events.push({ kind: "first-request", at: now }); assert.ok(predicate, "First login/goto request escaped before the session listener"); assert.ok(now < deadline, "TOTP sleep consumed the default response timeout before the first request");
      assert.equal(predicate({ ...response, url: () => "http://127.0.0.1:33108/api/admin/auth/login" }), false); assert.equal(predicate({ ...response, request: () => ({ method: () => "POST" }) }), false); assert.equal(predicate(response), true); resolveResponse(response); return {};
    } };
    await runInNewContext(`(async () => { ${productionPrelude} })()`, globals);
    assert.deepEqual(events.map(event => event.kind), ["sleep", "listener", "first-request"]);
    assert.equal(events[0].delay, 30000 - initialClock % 30000 + 250); assert.equal(events[1].at, events[2].at); assert.equal(deadline - events[2].at, 30000);
    return events;
  }
  const opening = await execute(0); assert.equal(opening[0].delay, 30250, "The longest window-opening delay must be exercised");
  await execute(15000); await execute(29999);
  await assert.rejects(execute(0, 200), /unauthenticated initial session/, "A logged-in initial session must still fail the production 401 check");
});
