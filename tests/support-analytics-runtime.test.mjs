import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { businessData, assertUiBinding, assertRequestSeeds, assertResourceBindings, assertAvatarPolicy, assertAvatarProposal, avatarApprovePath, validateMutation, validateReadback, assertRuntimeReceipt, assertLiveFingerprint, assertBoundFile, sha256 } from "../scripts/lib/support-analytics-evidence.mjs";

const repo = resolve(import.meta.dirname, "..");
function run(config, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), "support-i0-negative-"));
  const report = join(dir, "report.json");
  const env = { ...process.env, WORKFLOW_TASK_ID: "negative-test", WORKFLOW_STEP_ID: "I0-F", WORKFLOW_CHECK_ID: "runtime", WORKFLOW_RUN_ID: "negative-test", WORKFLOW_REPO: repo, WORKFLOW_SNAPSHOT_HASH: "negative-only" };
  delete env.SUPPORT_ACCEPTANCE_CONFIG;
  if (config) {
    env.SUPPORT_ACCEPTANCE_CONFIG = join(dir, "config.json");
    writeFileSync(env.SUPPORT_ACCEPTANCE_CONFIG, JSON.stringify({ taskId: "negative-test", repo, isolatedDatabase: true, ...config }));
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
test("bulk and random commits require this run's exact frozen server preview before transmission", () => {
  const check = (path, body, previews) => assertRequestSeeds(path, body, previews, [], allowed, ["11", "12"]);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "old" }, [bulkPreview(["11", "12"])]), /this run/);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "current-selection" }, [bulkPreview(["11", "99"])]), /outside/);
  assert.throws(() => check("/api/admin/content/support-workbench/bulk", { selectionId: "current-selection" }, [bulkPreview(["11", "13"])]), /exact targets/);
  assert.throws(() => check("/api/admin/content/support-agents/assignments/random", { previewId: "current-preview", expectedRulesVersion: 1 }, [randomPreview(["11", "12"])]));
  check("/api/admin/content/support-agents/assignments/random", { previewId: "current-preview", expectedRulesVersion: 2 }, [randomPreview(["11", "12"])]);
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
