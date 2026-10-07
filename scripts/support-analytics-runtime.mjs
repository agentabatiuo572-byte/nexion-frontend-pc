import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { sha256, repositoryDigest as digestRepository, businessData, conversationFeatures, consoleSidebarRoot, businessRoots, assertUiBinding, assertRequestSeeds, assertAvatarPolicy, assertAvatarProposal, avatarProposalPath, avatarApprovePath, validateMutation, validateReadback, verifyRuntimeOwnership, installRenderedBlobObserver, renderedBlobSha256 } from "./lib/support-analytics-evidence.mjs";

const features = ["avatar", "sku", "attachment", "bulk", "random", "cookie", "unknown-main", "unknown-dock"];
const usedTotpSteps = new Map();
const mutationTargets = {
  avatar: /^\/api\/admin\/platform\/audit\/operations$/,
  sku: /^\/api\/admin\/content\/conversations\/[^/]+\/replies$/,
  attachment: /^\/api\/admin\/content\/conversations\/[^/]+\/replies$/,
  bulk: /^\/api\/admin\/content\/support-workbench\/bulk$/,
  random: /^\/api\/admin\/content\/support-agents\/assignments\/random$/,
  "unknown-main": /^\/api\/admin\/content\/conversations\/[^/]+\/replies$/,
  "unknown-dock": /^\/api\/admin\/content\/conversations\/[^/]+\/replies$/,
};
const argument = name => {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--"), `${name} is required`);
  return process.argv[index + 1];
};
const phase = argument("--phase"), reportPath = resolve(argument("--report"));
assert.equal(phase, "I0-F", "Only the restored I0 baseline is implemented; later acceptance needs its own producer");
const identity = Object.fromEntries(["taskId", "stepId", "checkId", "runId", "repo", "snapshotHash"].map(key => [key, process.env[`WORKFLOW_${key.replace(/[A-Z]/g, letter => `_${letter}`).toUpperCase()}`]]));
const evidenceDir = join(dirname(reportPath), `I0-${identity.runId ?? "manual"}`);
mkdirSync(evidenceDir, { recursive: true });
const steps = ["DES-01", "DES-02", "DES-03", "FE-BASELINE"].map(id => ({ id, status: "unverified", evidence: [], reason: "Not observed in this run" }));
const hash = sha256;
const evidence = file => `${file} (sha256 ${hash(readFileSync(file))})`;
const save = (name, value) => {
  const file = join(evidenceDir, name);
  writeFileSync(file, JSON.stringify(value, null, 2));
  return evidence(file);
};
const localUrl = value => {
  const url = new URL(value);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Acceptance may only target the isolated local runtime");
  assert.ok(["http:", "https:"].includes(url.protocol));
  return url.origin;
};
const leaf = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
const verifyFields = (body, expected) => {
  assert.ok(expected && Object.keys(expected).length, "Readback must compare explicit business fields");
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(leaf(body, field), value, `Readback mismatch: ${field}`);
};
const repositoryDigest = () => digestRepository(identity.repo);
async function actions(page, sequence) {
  assert.ok(Array.isArray(sequence) && sequence.length, "An actual visible UI flow is required");
  for (const action of sequence) {
    assert.ok(action.selector, "Each UI action needs an observed selector");
    const locator = page.locator(action.selector);
    if (action.kind === "click") await locator.click();
    else if (action.kind === "fill") await locator.fill(action.value);
    else if (action.kind === "select") await locator.selectOption(action.value);
    else if (action.kind === "file") await locator.setInputFiles(action.path);
    else if (action.kind === "press") await locator.press(action.value);
    else if (action.kind === "visible") await locator.waitFor({ state: "visible" });
    else if (action.kind === "text") {
      await locator.filter({ hasText: action.value }).waitFor({ state: "visible" });
      assert.ok((await locator.innerText()).includes(action.value));
    } else throw new Error(`Unsupported UI operation ${action.kind}`);
  }
}
async function getData(context, path) {
  const response = await context.request.get(path);
  assert.equal(response.status(), 200);
  return businessData(await response.json());
}
async function beforeWrite(context, scenario) {
  if (conversationFeatures.has(scenario.id)) return getData(context, scenario.mutation.path.slice(0, -"/replies".length));
  if (scenario.id === "avatar") {
    const id = String(scenario.accountId);
    const row = (await getData(context, "/api/admin/platform/accounts/overview")).operators.find(operator => String(operator.id) === id);
    assert.ok(row, "Authorized avatar account was not found in the actual current overview");
    return row;
  }
  if (scenario.id === "bulk") return getData(context, "/api/admin/content/support-workbench/bulk?pageNum=1&pageSize=100");
  const rows = {};
  assert.ok(scenario.customerIds?.length, "Random scenario must identify the exact isolated pool customers");
  for (const id of scenario.customerIds) rows[id] = (await getData(context, `/api/admin/content/support-workbench/customers/${encodeURIComponent(id)}`)).customer;
  return rows;
}
async function currentBusinessState(context, scenario, mutation) {
  const data = businessData(mutation.output);
  if (conversationFeatures.has(scenario.id)) return getData(context, `/api/admin/content/conversations/${encodeURIComponent(data.conversationNo)}`);
  if (scenario.id === "avatar") return (await getData(context, "/api/admin/platform/accounts/overview")).operators.find(row => String(row.id) === String(mutation.proposal.input.command.params.accountId));
  if (scenario.id === "bulk") return getData(context, `/api/admin/content/support-workbench/bulk/${encodeURIComponent(data.batchId)}`);
  const rows = {};
  for (const row of data.customers) rows[String(row.customerId)] = (await getData(context, `/api/admin/content/support-workbench/customers/${encodeURIComponent(row.customerId)}`)).customer;
  return rows;
}
async function requireBusinessUi(page, scenario, mutation, state, before) {
  const output = businessData(mutation.output);
  if (conversationFeatures.has(scenario.id)) {
    const root = page.locator(businessRoots[scenario.id]);
    await root.waitFor({ state: "visible" });
    const message = state.messages.find(row => row.clientMessageId === mutation.input.clientMessageId);
    if (scenario.id === "attachment") {
      const expected = await page.request.get(`/api/admin/content/conversations/attachments/${encodeURIComponent(message.attachmentId)}/content`);
      assert.equal(expected.status(), 200);
      const expectedHash = hash(await expected.body());
      const images = root.locator('img[alt="会话图片"]');
      let matched = false;
      for (const image of await images.all()) if (await image.isVisible()) {
        const actualHash = await renderedBlobSha256(image);
        assert.ok(await image.evaluate(async element => { try { await element.decode(); return element.naturalWidth > 0; } catch { return false; } }), "Attachment image was not actually decoded");
        matched ||= actualHash === expectedHash;
      }
      assert.ok(matched, "The reloaded business UI did not render this attachment's bytes");
    } else await root.getByText(message.content, { exact: true }).waitFor({ state: "visible" });
    if (scenario.id === "sku") await root.getByText(`商品编号：${message.skuId}`, { exact: true }).waitFor({ state: "visible" });
  } else if (scenario.id === "avatar") {
    const response = await page.request.get(`/api/admin/platform/accounts/${encodeURIComponent(state.id)}/avatar`);
    assert.equal(response.status(), 200);
    const expectedHash = hash(await response.body());
    const image = page.getByAltText(`${state.name}头像`, { exact: true });
    await image.waitFor({ state: "visible" });
    assert.ok(await image.evaluate(async element => { try { await element.decode(); return element.naturalWidth > 0; } catch { return false; } }), "Avatar image was not actually decoded");
    const actualHash = await renderedBlobSha256(image);
    assert.equal(actualHash, expectedHash, "The reloaded UI is showing a different avatar");
  } else if (scenario.id === "bulk") {
    const dialog = page.getByRole("dialog", { name: "圈选客户群发", exact: true });
    await dialog.getByText(new RegExp(output.batchId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first().waitFor({ state: "visible" });
    await dialog.getByText(`已提交 ${state.counts.sent}`, { exact: true }).waitFor({ state: "visible" });
  } else {
    const pool = page.locator('section[aria-label="待绑定客户池"]');
    await pool.waitFor({ state: "visible" });
    for (const row of output.customers) assert.equal(await pool.getByText(before[String(row.customerId)].displayName, { exact: true }).count(), 0, "Assigned customer still appears in the reloaded unbound pool");
  }
}
async function login(context, page, origin, account) {
  const password = process.env[account.passwordEnv];
  assert.ok(account.username && password, "An explicitly provisioned account and secret environment variable are required");
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/admin/auth/login" && r.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await response;
  assert.equal(loginResponse.status(), 200, "The seeded account must already be ready for acceptance");
  const challenge = businessData(await loginResponse.json()).mfa;
  if (challenge) {
    const secret = process.env[account.totpSecretEnv];
    assert.ok(secret && challenge.mode !== "ENROLL", "Provision the isolated account's MFA before baseline acceptance");
    const step = Math.floor(Date.now() / 30000);
    if (usedTotpSteps.get(account.username) === step) await new Promise(resolve => setTimeout(resolve, 30000 - Date.now() % 30000 + 250));
    usedTotpSteps.set(account.username, Math.floor(Date.now() / 30000));
    await page.getByLabel("一次性验证码").fill(totp(secret));
    const verified = page.waitForResponse(result => new URL(result.url()).pathname === "/api/admin/auth/mfa/verify" && result.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    assert.equal((await verified).status(), 200, "MFA verification failed");
  }
  await page.locator(consoleSidebarRoot).waitFor({ state: "visible" });
  const session = await context.request.get(`${origin}/api/admin/auth/session`);
  assert.equal(session.status(), 200);
  const body = await session.json();
  const current = businessData(body).session;
  assert.equal(current.username, account.username, "The UI session belongs to a different seeded account");
  verifyFields(body, account.expectedSession);
  return body;
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.toUpperCase().replace(/=+$/, "")) {
    assert.ok(alphabet.includes(character), "Invalid TOTP seed encoding");
    bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
let browser, before;
try {
  assert.ok(Object.values(identity).every(Boolean), "Run through the workflow CLI so task/run/snapshot identities are supplied");
  assert.equal(identity.stepId, phase);
  before = repositoryDigest();
  assert.ok(process.env.SUPPORT_ACCEPTANCE_CONFIG, "SUPPORT_ACCEPTANCE_CONFIG must name the isolated seed and explicit authorized UI flows");
  const config = JSON.parse(readFileSync(process.env.SUPPORT_ACCEPTANCE_CONFIG, "utf8").replaceAll("{{runId}}", identity.runId));
  assert.equal(resolve(config.repo), resolve(identity.repo));
  assert.equal(config.taskId, identity.taskId);
  assert.equal(config.isolatedDatabase, true);
  const origin = localUrl(config.baseUrl);
  assert.ok(process.env.SUPPORT_RUNTIME_RECEIPT, "A root-measured startup/resource receipt is required before login or writes");
  const runtimeReceiptPath = process.env.SUPPORT_RUNTIME_RECEIPT;
  const runtimeReceipt = JSON.parse(readFileSync(runtimeReceiptPath, "utf8"));
  const runtimeTarget = { taskId: identity.taskId, repo: identity.repo, origin, candidateDigest: before, receiptPath: runtimeReceiptPath, receiptSha256: hash(readFileSync(runtimeReceiptPath)) };
  await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget);
  browser = await chromium.launch({ headless: true });

  // Design review is a separate signed observation. It cannot stand in for a product write.
  const review = JSON.parse(readFileSync(config.designReview, "utf8"));
  assert.ok(review.reviewer && review.reviewer !== config.implementationOwner, "Design semantics need an independent reviewer");
  assert.equal(review.taskId, identity.taskId);
  assert.equal(review.verdict, "pass");
  for (const id of ["DES-01", "DES-03"]) {
    const row = review.steps.find(item => item.id === id);
    assert.equal(row?.status, "pass");
    assert.ok(row.files?.length, "Independent review must identify the exact documents/images read");
    for (const file of row.files) assert.equal(hash(readFileSync(file.path)), file.sha256, "Design input changed after review");
    Object.assign(steps.find(item => item.id === id), { status: "pass", reason: undefined, evidence: [evidence(config.designReview), ...row.files.map(file => evidence(file.path))] });
  }

  const design = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const prototype = resolve(identity.repo, "docs/design/support-analytics-20261006/prototype.html");
  await design.goto(pathToFileURL(prototype).href);
  const designObserved = [];
  for (const role of ["agent", "supervisor", "admin"]) {
    await design.locator("#role").selectOption(role);
    await design.locator('nav.primary-nav [data-page="home"]').click();
    for (const flow of config.designFlows.filter(item => item.role === role)) {
      await actions(design, flow.actions);
      designObserved.push(`${role}/${flow.id}`);
    }
    for (const state of ["empty", "loading", "error"]) {
      await design.locator("#viewState").selectOption(state);
      await design.locator('.state-panel [data-action="retry"]').click();
      assert.equal(await design.locator("#viewState").inputValue(), "default");
    }
    const file = join(evidenceDir, `design-${role}.png`);
    await design.screenshot({ path: file, fullPage: true });
    steps[1].evidence.push(evidence(file));
  }
  for (const role of ["agent", "supervisor", "admin"]) for (const id of ["customers-detail-return", "session-profile-return", "scope-filter"]) assert.ok(designObserved.includes(`${role}/${id}`), `Missing design click flow ${role}/${id}`);
  Object.assign(steps[1], { status: "pass", reason: undefined });
  steps[1].evidence.push(save("design-flows.json", { prototype: evidence(prototype), designOnly: true, flows: designObserved }));
  await design.close();

  assert.deepEqual(config.scenarios.map(item => item.id).toSorted(), features.toSorted(), "Every restored enhancement needs exactly one scenario");
  const observations = [];
  const operationKeys = new Set();
  for (const scenario of config.scenarios) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin });
    let page = await context.newPage(), approvalContext;
    await installRenderedBlobObserver(page);
    try {
      assert.ok(runtimeReceipt.allowedSeedObjects.usernames.includes(config.accounts[scenario.account]?.username), "This login is not an authorized isolated seed");
      await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget);
      const makerSession = businessData(await login(context, page, origin, config.accounts[scenario.account])).session;
      let checkerSession, priorState;
      if (scenario.id === "avatar") {
        assertAvatarPolicy(runtimeReceipt.avatarApproval, makerSession);
        assert.equal(String(scenario.accountId), String(runtimeReceipt.avatarApproval.accountId));
      }
      assert.ok(scenario.path.startsWith("/") && !scenario.path.startsWith("//"));
      const uploads = [], previews = [], avatarProposals = [], uploadCaptures = [], uploadErrors = [];
      page.on("response", response => {
        const path = new URL(response.url()).pathname;
        if (response.request().method() === "POST" && ["/api/admin/platform/accounts/avatar-assets", "/api/admin/content/conversations/attachments"].includes(path)) uploadCaptures.push((async () => {
          assert.equal(response.status(), 200);
          const output = await response.json();
          businessData(output);
          uploads.push({ path, output });
        })().catch(error => uploadErrors.push(error)));
        if (response.request().method() === "POST" && ["/api/admin/content/support-workbench/bulk/preview", "/api/admin/content/support-agents/assignments/random-preview"].includes(path)) uploadCaptures.push((async () => {
          assert.equal(response.status(), 200);
          const output = await response.json(); businessData(output);
          previews.push({ path, output });
        })().catch(error => uploadErrors.push(error)));
        if (scenario.id === "avatar" && path === avatarProposalPath && response.request().method() === "POST") uploadCaptures.push((async () => {
          assert.equal(response.status(), 200);
          const proposal = { path, input: response.request().postDataJSON(), key: response.request().headers()["idempotency-key"], output: await response.json() };
          assertAvatarProposal(proposal.input, priorState, uploads, runtimeReceipt.allowedSeedObjects, runtimeReceipt.avatarApproval);
          avatarApprovePath(proposal);
          avatarProposals.push(proposal);
        })().catch(error => uploadErrors.push(error)));
      });
      const authorizeRequest = async request => {
        const path = new URL(request.url()).pathname;
        const currentAvatarApproval = scenario.id === "avatar" && avatarProposals.length === 1 && path === avatarApprovePath(avatarProposals[0]);
        assert.ok(currentAvatarApproval || runtimeReceipt.authorizedMutationPaths.includes(path), "The UI attempted a mutation outside the root-authorized seed paths");
        await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget);
        // Drain actual server receipts before allowing a write that references them.
        await Promise.all(uploadCaptures);
        if (uploadErrors.length) throw uploadErrors[0];
        let input = {};
        if (request.headers()["content-type"]?.includes("application/json")) input = request.postDataJSON();
        else if (path.endsWith("/conversations/attachments")) {
          const ids = [...(request.postData() ?? "").matchAll(/name="customerId"\r\n\r\n([^\r\n]*)/g)];
          assert.equal(ids.length, 1, "Attachment request must have exactly one actual customer field");
          input.customerId = ids[0][1];
        }
        if (scenario.id === "avatar" && path === avatarProposalPath) {
          assert.ok(!checkerSession && avatarProposals.length === 0, "Avatar checker cannot create another proposal");
          assertAvatarPolicy(runtimeReceipt.avatarApproval, makerSession);
          assertAvatarProposal(input, priorState, uploads, runtimeReceipt.allowedSeedObjects, runtimeReceipt.avatarApproval);
        }
        if (currentAvatarApproval) {
          assert.ok(checkerSession, "The avatar must be approved through a different real checker session");
          assertAvatarPolicy(runtimeReceipt.avatarApproval, makerSession, checkerSession);
          assertAvatarProposal(avatarProposals[0].input, priorState, uploads, runtimeReceipt.allowedSeedObjects, runtimeReceipt.avatarApproval);
          const queue = (await getData(approvalContext, "/api/admin/platform/audit/overview")).operationQueue;
          const ticket = queue.find(row => String(row.id) === String(businessData(avatarProposals[0].output).id));
          assert.ok(ticket && String(ticket.status).toUpperCase() === "PENDING" && String(ticket.obj) === String(runtimeReceipt.avatarApproval.accountId), "The current avatar proposal is missing, final or belongs to another account");
        }
        let completeScopeIds;
        if (path.endsWith("/bulk/preview") && input.selectionMode === "ALL_FILTERED") {
          const scope = (await getData(context, "/api/admin/content/support-workbench/customers?pageNum=1&pageSize=100")).customers;
          assert.ok(scope.available && Array.isArray(scope.records) && Number(scope.total) === scope.records.length, "Filtered preview owner scope is incomplete");
          completeScopeIds = scope.records.map(row => String(row.customerId));
        }
        assertRequestSeeds(path, input, previews, uploads, runtimeReceipt.allowedSeedObjects, scenario.customerIds ?? [], completeScopeIds);
      };
      const guard = async route => {
        if (["GET", "HEAD"].includes(route.request().method())) return route.continue();
        try {
          await authorizeRequest(route.request());
          await route.continue();
        } catch (error) { uploadErrors.push(error); await route.abort("blockedbyclient"); }
      };
      await page.route("**/api/admin/**", guard);
      await page.goto(`${origin}${scenario.path}`, { waitUntil: "domcontentloaded" });
      if (scenario.id !== "cookie") {
        assert.ok(mutationTargets[scenario.id].test(scenario.mutation.path));
        assert.ok(runtimeReceipt.authorizedMutationPaths.includes(scenario.mutation.path));
        if (conversationFeatures.has(scenario.id)) assert.ok(runtimeReceipt.allowedSeedObjects.conversationNos.includes(decodeURIComponent(scenario.mutation.path.split("/")[5])));
        if (scenario.id === "avatar") assert.ok(runtimeReceipt.allowedSeedObjects.accountIds.includes(String(scenario.accountId)));
        if (["random", "bulk"].includes(scenario.id)) assert.ok(scenario.customerIds?.length && scenario.customerIds.every(id => runtimeReceipt.allowedSeedObjects.customerIds.includes(String(id))));
        priorState = await beforeWrite(context, scenario);
      }
      if (scenario.id === "avatar") {
        assert.ok(Array.isArray(scenario.prepare) && scenario.prepare.length > 1, "Avatar preparation and its final confirmation must be explicit");
        const confirmation = scenario.prepare.at(-1);
        assert.equal(confirmation.kind, "click", "The final avatar proposal action must be a confirmation click");
        await actions(page, scenario.prepare.slice(0, -1));
        await Promise.all(uploadCaptures);
        if (uploadErrors.length) throw uploadErrors[0];
        const proposed = page.waitForResponse(response => new URL(response.url()).pathname === avatarProposalPath && response.request().method() === "POST", { timeout: 30000 });
        await Promise.all([proposed, actions(page, [confirmation])]);
      } else await actions(page, scenario.prepare);
      await Promise.all(uploadCaptures);
      if (uploadErrors.length) throw uploadErrors[0];
      if (scenario.id === "avatar") {
        assert.equal(avatarProposals.length, 1, "Only one actual avatar proposal from this run may be approved");
        assert.ok(!operationKeys.has(avatarProposals[0].key)); operationKeys.add(avatarProposals[0].key);
        const checker = config.accounts[scenario.checkerAccount];
        assert.ok(checker && runtimeReceipt.allowedSeedObjects.usernames.includes(checker.username));
        assert.equal(checker.username, runtimeReceipt.avatarApproval.checkerUsername);
        assert.notEqual(checker.username, makerSession.username);
        await page.close();
        approvalContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: origin });
        page = await approvalContext.newPage();
        await installRenderedBlobObserver(page);
        await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget);
        checkerSession = businessData(await login(approvalContext, page, origin, checker)).session;
        assertAvatarPolicy(runtimeReceipt.avatarApproval, makerSession, checkerSession);
        await page.route("**/api/admin/**", guard);
        assert.ok(scenario.approvalPath?.startsWith("/") && !scenario.approvalPath.startsWith("//"));
        await page.goto(`${origin}${scenario.approvalPath}`, { waitUntil: "domcontentloaded" });
        await actions(page, scenario.approvalPrepare);
      }
      const actualMutationPath = scenario.id === "avatar" ? avatarApprovePath(avatarProposals[0]) : scenario.mutation?.path;
      const mutations = [], requests = [], reads = [], commandReads = [], captures = [], captureErrors = [];
      page.on("request", request => { if (new URL(request.url()).origin === origin) requests.push({ path: new URL(request.url()).pathname, method: request.method() }); });
      if (scenario.id === "cookie") {
        const expected = `nexion_admin_token__${config.cookieNamespace}`;
        assert.ok((await context.cookies()).some(cookie => cookie.name === expected && cookie.httpOnly));
        for (const path of ["/service/overview", "/service/sessions", "/platform/rbac"]) {
          await page.goto(`${origin}${path}`);
          await page.locator(consoleSidebarRoot).waitFor({ state: "visible" });
          assert.equal(await page.getByText("404", { exact: true }).count(), 0);
        }
        const anonymous = await browser.newContext();
        const rejected = await anonymous.request.get(`${origin}/api/admin/content/support-workbench/customers?pageNum=1&pageSize=1`);
        assert.ok([401, 403].includes(rejected.status()));
        await anonymous.close();
      } else {
        assert.ok(runtimeReceipt.authorizedMutationPaths.includes(scenario.mutation.path), "Mutation target was not explicitly authorized by the root seed receipt");
        assert.ok(mutationTargets[scenario.id].test(scenario.mutation.path), "The mutation is not the restored feature's real business endpoint");
        assert.ok(["POST", "PATCH", "PUT"].includes(scenario.mutation.method));
        if (scenario.id === "sku") assert.equal(scenario.mutation.expectedInput.kind, "SKU");
        if (scenario.id === "attachment") assert.equal(scenario.mutation.expectedInput.kind, "IMAGE");
        const rootSelector = businessRoots[scenario.id];
        const businessRoot = page.locator(rootSelector);
        await businessRoot.waitFor({ state: "visible" });
        if (scenario.id === "bulk") await page.getByRole("dialog", { name: "圈选客户群发", exact: true }).waitFor({ state: "visible" });
        if (scenario.id === "random") await page.getByRole("dialog", { name: "明确处理历史待绑定客户", exact: true }).waitFor({ state: "visible" });
        const submitControl = scenario.submit.findLast(action => action.kind === "click" || action.kind === "press");
        assert.ok(submitControl, "A real business submit control is required");
        assertUiBinding(scenario.id, { root: rootSelector, visible: await businessRoot.isVisible(), submitInside: await page.locator(submitControl.selector).evaluate((element, selector) => Boolean(element.closest(selector)), rootSelector) });
        const capture = async response => {
          const request = response.request();
          if (new URL(response.url()).pathname.startsWith("/api/admin/content/support-workbench/commands/") && request.method() === "GET") {
            assert.equal(response.status(), 200);
            const body = await response.json(); businessData(body);
            commandReads.push({ path: new URL(response.url()).pathname, body });
          }
          if (new URL(response.url()).pathname === actualMutationPath && request.method() === scenario.mutation.method) {
            assert.ok(response.status() >= 200 && response.status() < 300, "Actual mutation failed");
            const input = request.postDataJSON();
            verifyFields(input, scenario.mutation.expectedInput);
            const output = await response.json(); businessData(output);
            mutations.push({ path: actualMutationPath, status: response.status(), input, key: request.headers()["idempotency-key"], output, ...(scenario.id === "avatar" ? { proposal: avatarProposals[0], avatarPolicy: runtimeReceipt.avatarApproval } : {}) });
          }
        };
        const unknown = scenario.id.startsWith("unknown-");
        let droppedDone;
        if (unknown) {
          assert.ok(scenario.mutation.commandIdField && scenario.recovery?.length, "Unknown status must recover the original command");
          let dropped = false;
          let finished;
          droppedDone = new Promise(resolve => { finished = resolve; });
          await page.route(`**${scenario.mutation.path}`, async route => {
            if (route.request().method() !== scenario.mutation.method || dropped) return route.fallback();
            // Send to the real server first; only lose the transport response, never fabricate a receipt.
            dropped = true;
            try {
              await authorizeRequest(route.request());
              const response = await route.fetch();
              assert.ok(response.status() >= 200 && response.status() < 300);
              const input = route.request().postDataJSON();
              verifyFields(input, scenario.mutation.expectedInput);
              const output = await response.json(); businessData(output);
              mutations.push({ path: scenario.mutation.path, status: response.status(), input, key: route.request().headers()["idempotency-key"], output, transportResponseDropped: true });
            } catch (error) { captureErrors.push(error); }
            finally { await route.abort("failed"); finished(); }
          });
        }
        page.on("response", response => captures.push(capture(response).catch(error => { captureErrors.push(error); })));
        if (unknown) {
          await actions(page, scenario.submit);
          let timer;
          try { await Promise.race([droppedDone, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The submitted mutation was never observed")), 15000); })]); }
          finally { clearTimeout(timer); }
          const recovered = page.waitForResponse(response => new URL(response.url()).pathname === `/api/admin/content/support-workbench/commands/${encodeURIComponent(mutations[0]?.key)}`, { timeout: 15000 });
          await Promise.all([recovered, actions(page, scenario.recovery)]);
        } else {
          const received = page.waitForResponse(response => new URL(response.url()).pathname === actualMutationPath && response.request().method() === scenario.mutation.method, { timeout: 15000 });
          await Promise.all([received, actions(page, scenario.submit)]);
        }
        await Promise.all(captures);
        if (captureErrors.length) throw captureErrors[0];
        assert.ok(mutations.length, "No actual successful mutation was observed");
        if (scenario.id.startsWith("unknown-")) {
          const commandIds = mutations.map(item => leaf(item.input, scenario.mutation.commandIdField));
          assert.ok(commandIds[0]);
          assert.ok(commandIds.every(id => id === commandIds[0]), "Recovery generated a different command ID");
          const key = mutations[0].key;
          assert.ok(key && requests.some(request => request.method === "GET" && request.path === `/api/admin/content/support-workbench/commands/${encodeURIComponent(key)}`), "Recovery did not query the original idempotency key");
          assert.ok(commandReads.some(read => read.path.endsWith(`/${encodeURIComponent(key)}`) && read.body?.data?.status === "SUCCEEDED"), "The original command did not return an authoritative success");
          assert.ok(mutations.every(item => item.key === key), "Recovery used a different idempotency key");
        }
        const mutation = mutations[0];
        assert.ok(!operationKeys.has(mutation.key), "Another feature reused this operation's key");
        operationKeys.add(mutation.key);
        await Promise.all(uploadCaptures);
        if (uploadErrors.length) throw uploadErrors[0];
        validateMutation(scenario.id, mutation, priorState, uploads, runtimeReceipt.allowedSeedObjects, previews, scenario.customerIds);
        if (["sku", "unknown-main", "unknown-dock"].includes(scenario.id)) assert.ok(mutation.input.body.includes(identity.runId), "Message content must include the current unique run marker");
        if (scenario.id === "bulk") assert.ok(mutation.input.content.includes(identity.runId), "Bulk content must identify this current run");
        let state = await currentBusinessState(context, scenario, mutation);
        if (scenario.id === "bulk") {
          const deadline = Date.now() + 15000;
          while (state.counts.pending > 0 && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 500)); state = await currentBusinessState(context, scenario, mutation); }
        }
        validateReadback(scenario.id, state, mutation, priorState);
        if (scenario.id === "avatar") mutation.firstAvatarRead = { id: state.id, avatarAssetId: state.avatarAssetId, avatarVersion: state.avatarVersion };
        if (scenario.id === "bulk") {
          const recipients = await getData(context, `/api/admin/content/support-workbench/bulk/${encodeURIComponent(state.batchId)}/recipients?pageNum=1&pageSize=100`);
          assert.deepEqual(recipients.records.map(row => String(row.customerId)).toSorted(), scenario.customerIds.map(String).toSorted());
          for (const recipient of recipients.records) {
            assert.equal(recipient.state, "SENT"); assert.equal(recipient.resultCertainty, "KNOWN");
            assert.ok(recipient.conversationNo);
            const detail = await getData(context, `/api/admin/content/conversations/${encodeURIComponent(recipient.conversationNo)}`);
            assert.equal(detail.messages.filter(message => message.content === mutation.input.content).length, 1, "The frozen recipient did not have exactly one actual committed bulk message");
          }
          reads.push(recipients);
        }
        reads.push(state);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await actions(page, scenario.afterReload);
      if (scenario.id !== "cookie") {
        const state = await currentBusinessState(context, scenario, mutations[0]);
        validateReadback(scenario.id, state, mutations[0], priorState);
        await requireBusinessUi(page, scenario, mutations[0], state, priorState);
        reads.push(state);
      }
      const file = join(evidenceDir, `${scenario.id}.png`);
      await page.screenshot({ path: file, fullPage: true });
      if (uploadErrors.length) throw uploadErrors[0];
      await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget);
      observations.push({ id: scenario.id, role: scenario.account, priorState, uploads, previews, mutations, commandReads, reads, screenshot: evidence(file), persistedAfterReload: true });
    } finally { await approvalContext?.close(); await context.close(); }
  }
  Object.assign(steps[3], { status: "pass", reason: undefined, evidence: [evidence(runtimeReceiptPath), save("baseline-observations.json", { runtimeKind: "real-http-and-browser", baseUrl: origin, runtimeReceiptSha256: runtimeTarget.receiptSha256, observations })] });
} catch (error) {
  const pending = steps.find(step => step.status !== "pass");
  if (pending) pending.reason = error.message;
  console.error(`I0 runtime unverified: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
  let treeMoved = true;
  if (before) try { treeMoved = before !== repositoryDigest(); } catch { /* An unreadable snapshot cannot pass. */ }
  const pass = steps.every(step => step.status === "pass") && !treeMoved;
  if (!pass) process.exitCode = 1;
  writeFileSync(reportPath, JSON.stringify({ ...identity, at: new Date().toISOString(), verdict: pass ? "pass" : "unverified", mode: "full", capability: "runtime", treeMoved, innerSkipped: 0, steps }, null, 2));
  console.log(`I0 real runtime ${steps.filter(step => step.status === "pass").length}/${steps.length}; missing or failed observations never pass`);
}
