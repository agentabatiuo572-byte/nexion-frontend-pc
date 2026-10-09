import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { assertRuntimeIdentity, assertCurrentRuntimeRun, assertBoundFile, businessData, repositoryDigest, sha256, verifyRuntimeOwnership } from "../scripts/lib/support-analytics-evidence.mjs";

const analyticsPath = "/api/admin/content/support-workbench/analytics";
const groupsPath = "/api/admin/content/support-agents/groups";
const requiredBackendSteps = ["I1-A", "I1-B", "I2-A", "I2-B", "I3-B"];
const readAuthPosts = new Set(["/api/admin/auth/login", "/api/admin/auth/mfa/verify", "/api/admin/auth/logout", "/api/admin/content/conversations/realtime-ticket"]);
const readJson = file => JSON.parse(readFileSync(file, "utf8"));
const fileHash = file => sha256(readFileSync(file));
const sortedIds = values => values.map(String).toSorted();
const positiveId = value => typeof value === "string" && /^[1-9]\d*$/.test(value);

export function assertReadOnlyRequest(method, path) {
  assert.ok(method === "GET" || method === "HEAD" || method === "POST" && readAuthPosts.has(path), "I3 prohibits every business mutation and unknown non-GET request");
  return method === "POST" ? "readAuth" : "read";
}

export function assertHandoffConfig(handoff, config, receipt) {
  assert.ok(handoff && handoff.backend && Array.isArray(handoff.cases), "Current backend handoff and three real account cases are required");
  assert.deepEqual(handoff.cases.map(row => row.mode).toSorted(), ["ALL", "MANAGED", "PERSONAL"]);
  assert.equal(new Set(handoff.cases.map(row => row.account)).size, 3, "Three distinct provisioned identities are required");
  for (const row of handoff.cases) {
    const account = config.accounts?.[row.account];
    assert.ok(account?.username && account.passwordEnv && account.totpSecretEnv, "Missing real password/MFA account binding");
    assert.ok(receipt.allowedSeedObjects?.usernames?.includes(account.username), "Account is not an authorized isolated seed");
    assert.ok(positiveId(row.adminId) && receipt.allowedSeedObjects?.accountIds?.map(String).includes(row.adminId), "Account ID is not an authorized isolated seed");
    assert.ok(Array.isArray(row.groupIds) && row.groupIds.every(positiveId) && new Set(row.groupIds).size === row.groupIds.length, "Explicit unique authorized group IDs are required");
    assert.ok(Array.isArray(row.menuCodes) && row.menuCodes.length && Array.isArray(row.authorities) && row.authorities.length, "Explicit session menu/authority expectations are required");
    assert.ok(typeof row.emptyKeyword === "string" && row.emptyKeyword.length > 0 && row.emptyKeyword.length <= 200, "A provisioned real empty query is required");
    assert.ok(Array.isArray(row.negativeReads), "Explicit authorized denial probes are required");
    if (row.mode !== "ALL") assert.ok(row.negativeReads.length, "Restricted identities require a real access-denial probe");
    for (const probe of row.negativeReads) {
      const url = new URL(probe.path, config.baseUrl);
      assert.ok(probe.path.startsWith("/api/admin/content/") && url.origin === config.baseUrl && [401, 403, 404].includes(probe.status), "Invalid read-only denial probe");
      assert.ok(receipt.authorizedReadPaths?.includes(probe.path), "Denial target is not explicitly root-authorized in this receipt");
    }
  }
  assert.equal(new Set(handoff.cases.map(row => row.adminId)).size, 3, "Accounts must not alias one administrator");
}

export function assertAnalyticsScope(data, query, accountCase, now = Date.now()) {
  assert.equal(data.scopeSummary.mode, accountCase.mode, "Analytics scope mode does not belong to this account");
  assert.deepEqual(sortedIds(data.scopeSummary.groups.map(group => group.groupId)), sortedIds(accountCase.groupIds), "Analytics exposed missing or foreign groups");
  assert.equal(data.businessZone, "Asia/Shanghai");
  const age = now - Date.parse(data.asOf);
  assert.ok(age >= -5000 && age <= 15 * 60000, "Analytics observation is stale");
  if (data.versionState === "READY") assert.match(data.queryVersion, /^saq-v1:[a-f0-9]{64}$/);
  else assert.ok(data.queryVersion === null && data.total === null && data.canContinue === false, "UNKNOWN must not invent version, total or continuation");
  if (query.expectedVersion) assert.equal(data.queryVersion, query.expectedVersion, "Continuation reused a different query version");
  if (query.groupId) assert.ok(accountCase.groupIds.includes(query.groupId), "Requested group is outside the authorized scope");
  for (const row of data.records) {
    const groupId = data.view === "AGENTS" ? row.account.groupId : row.owner?.groupId;
    const agentId = data.view === "AGENTS" ? row.accountId : row.owner?.agentId;
    if (accountCase.mode === "MANAGED") assert.ok(groupId !== null && accountCase.groupIds.includes(groupId), "Managed records exposed a foreign or unverified group");
    if (accountCase.mode === "PERSONAL") assert.equal(agentId, accountCase.adminId, "Personal records exposed another advisor");
    if (query.groupId) assert.equal(groupId, query.groupId, "Group-filtered records leaked another group");
    if (query.agentId) assert.equal(agentId, query.agentId, "Agent-filtered records leaked another advisor");
  }
}

export function assertBackendEvidence(ctx, state, live, evidenceProblems, scopeHash) {
  assert.deepEqual(requiredBackendSteps.filter(id => !ctx.plan.steps.some(step => step.id === id)), [], "The current BE plan lost a required handoff phase");
  for (const id of requiredBackendSteps) {
    const spec = ctx.plan.steps.find(step => step.id === id), step = state.steps?.[id];
    assert.equal(step?.status, "passed", `BE ${id} has not passed`);
    assert.deepEqual(evidenceProblems(ctx, state, { only: id }), [], `BE ${id} evidence is missing, changed or inconsistent`);
    assert.equal(scopeHash(live, spec, ctx.plan.inputs, step.receipt?.scopePaths), step.receipt?.scopeHash, `BE ${id} scope changed after acceptance`);
  }
}

async function backendBinding(binding, receipt) {
  assert.ok(binding && isAbsolute(binding.planPath) && resolve(binding.stateDir) === resolve("D:/CodexData/workflow-state"), "BE handoff must identify the physical current plan and D state root");
  assert.ok(/^[a-f0-9]{64}$/i.test(binding.candidateDigest ?? "") && binding.candidateDigest === receipt.be.candidateDigest, "Backend source identity is missing or differs from the live receipt");
  assert.equal(repositoryDigest(receipt.be.repo), binding.candidateDigest, "Backend source changed after handoff");
  assert.ok(Array.isArray(binding.contracts) && binding.contracts.length > 0, "Bound current contracts are required");
  for (const file of binding.contracts) { assert.ok(isAbsolute(file.path)); assertBoundFile(file.path, file.sha256); }
  const workflowRoot = "D:/WORKS/PLAN/scripts/codex-workflow/lib/";
  const [{ context, readState }, { snapshot }, { evidenceProblems }, { scopeHash }] = await Promise.all(["state.mjs", "repository.mjs", "evidence.mjs", "contract.mjs"].map(file => import(pathToFileURL(workflowRoot + file).href)));
  const ctx = context(binding.planPath, binding.stateDir), state = readState(ctx);
  assert.equal(ctx.plan.id, binding.taskId, "Backend task identity changed");
  assert.equal(resolve(ctx.plan.repo), resolve(receipt.be.repo), "Backend plan belongs to another source tree");
  assertBackendEvidence(ctx, state, snapshot(ctx.plan.repo, { inputs: ctx.plan.inputs }), evidenceProblems, scopeHash);
  return { planSha256: fileHash(binding.planPath), stateSha256: fileHash(join(ctx.dir, "state.json")), contracts: binding.contracts.map(file => ({ path: file.path, sha256: fileHash(file.path) })), scopes: requiredBackendSteps.map(id => ({ id, runId: state.steps[id].receipt.runId, scopeHash: state.steps[id].receipt.scopeHash })) };
}

function monthWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find(row => row.type === "year").value), month = Number(parts.find(row => row.type === "month").value);
  return { month: `${year}-${String(month).padStart(2, "0")}`, from: new Date(Date.UTC(year, month - 1, 1) - 8 * 3600000).toISOString(), to: new Date(Date.UTC(year, month, 1) - 8 * 3600000).toISOString() };
}
const expectedQuery = url => ({ view: url.searchParams.get("view"), basis: url.searchParams.get("basis") ?? "CURRENT_CUSTOMER_HISTORY", pageNum: Number(url.searchParams.get("pageNum") ?? 1), pageSize: Number(url.searchParams.get("pageSize") ?? 20), expectedVersion: url.searchParams.get("expectedVersion") ?? undefined });
const conditions = url => Object.fromEntries(url.searchParams);
const waitAnalytics = (page, query) => page.waitForResponse(response => {
  const url = new URL(response.url());
  return response.request().method() === "GET" && url.pathname === analyticsPath && Object.entries(query).every(([key, value]) => (url.searchParams.get(key) ?? (key === "basis" ? "CURRENT_CUSTOMER_HISTORY" : null)) === String(value));
}, { timeout: 30000 });

async function select(page, label, text) {
  const trigger = page.getByRole("button", { name: label, exact: true });
  if ((await trigger.innerText()).includes(text)) return;
  await trigger.click();
  await page.getByRole("listbox", { name: label, exact: true }).getByRole("option", { name: text, exact: true }).click();
}

export async function assertNumericDom(numeric, value, label) {
  const confirmed = value?.confirmed ?? null, observed = value?.observed ?? null;
  const explanation = confirmed === null ? observed === null ? "资料待核实" : `已观测 ${observed}，完整数值待核实` : `已核实 ${confirmed}${observed !== null && observed !== confirmed ? `，已观测 ${observed}` : ""}`;
  assert.equal(await numeric.count(), 1, "Numeric identity/currency is missing or ambiguous");
  assert.equal(await numeric.getAttribute("title"), explanation, "DOM exact numeric explanation differs from the real response");
  assert.equal(await numeric.getAttribute("aria-label"), `${label}：${explanation}；查看明细`, "DOM numeric identity/currency differs from the real response");
  return explanation;
}

export async function enterGroupDirectory(root, groups, initialDetail) {
  if (initialDetail) {
    assert.ok(groups.some(group => group.id === initialDetail.group.id), "Initial group detail is outside the current directory");
    await root.getByRole("heading", { name: initialDetail.group.name, exact: true }).waitFor({ state: "visible" });
    const back = root.getByRole("button", { name: "返回组目录", exact: true });
    await back.waitFor({ state: "visible" });
    assert.equal(await root.locator(".m-admin-table tbody tr").count(), Math.min(20, initialDetail.members.length), "Initial group member table differs from the real detail");
    await back.click();
  }
  await root.getByRole("heading", { name: "组管理", exact: true }).waitFor({ state: "visible" });
  await root.getByRole("navigation", { name: "组分页", exact: true }).waitFor({ state: "visible" });
  assert.equal(await root.getByRole("button", { name: "返回组目录", exact: true }).count(), 0, "Group detail was not left before looking for directory rows");
  const rows = root.locator(".m-admin-table tbody tr");
  assert.equal(await rows.count(), Math.min(20, groups.length), "Current group directory rows differ from the real response");
  for (const [index, group] of groups.slice(0, 20).entries()) assert.equal(await rows.nth(index).locator("td").first().innerText(), group.name, "Directory group identity differs from the real response");
  return rows;
}

async function verifyDom(page, data, query) {
  await page.locator('.sa-metrics[aria-label="所选范围汇总"]').waitFor({ state: "visible" });
  const root = page.locator(".sa-workbench"), rows = root.locator(".sa-table tbody tr"), associations = [];
  const viewName = { OVERVIEW: "总览", AGENTS: "客服", CUSTOMERS: "客户" }[data.view];
  assert.equal(await root.locator(".sa-datasets").getByRole("button", { name: viewName, exact: true }).getAttribute("aria-pressed"), "true", "DOM dataset does not belong to this request");
  assert.ok((await root.getByRole("button", { name: "币种", exact: true }).innerText()).includes(query.currency));
  assert.ok((await root.getByRole("button", { name: "统计口径", exact: true }).innerText()).includes(query.basis === "PERIOD_EVENT" ? "期间业绩" : "当前客户"));
  if (query.groupId) {
    const group = data.scopeSummary.groups.find(row => row.groupId === query.groupId);
    assert.ok(group?.name, "Selected group name must be verifiable");
    assert.equal(await root.locator(".sa-group-tabs").getByRole("button", { name: group.name, exact: true }).getAttribute("aria-pressed"), "true");
  }
  if (data.view === "OVERVIEW") {
    const count = data.scopeSummary.personnel.serviceAccounts;
    const numeric = root.locator('.sa-metrics [aria-label^="专属客服："]');
    await assertNumericDom(numeric, { confirmed: count.confirmed === null ? null : String(count.confirmed), observed: count.observed === null ? null : String(count.observed) }, "专属客服");
    return { personnelCount: await numeric.getAttribute("aria-label"), visibleGroupNames: await root.locator(".sa-group-tabs button").allTextContents() };
  }
  const pager = data.total === null ? `已观测 ${data.observedTotal} 条；完整总数待核实` : `共 ${data.total} 条`;
  await root.locator(".sa-pager p").filter({ hasText: `${pager} · 第 ${data.pageNum} 页` }).waitFor({ state: "visible" });
  assert.equal(await rows.count(), data.records.length, "Main table is not the server query's current rows");
  if (!data.records.length) { await root.locator(".sa-empty").waitFor({ state: "visible" }); return { rows: 0, empty: true, pager }; }
  for (const [index, record] of data.records.entries()) {
    const row = rows.nth(index), text = await row.innerText();
    const name = data.view === "AGENTS" ? record.displayName || "名称待核实" : record.nickname || record.customerNo || `客户 ${record.customerId}`;
    assert.ok(text.includes(name), "Main row identity differs from the real response");
    if (data.view === "AGENTS") {
      const group = data.scopeSummary.groups.find(group => group.groupId === record.account.groupId);
      assert.ok(text.includes(group?.name || (record.account.groupId === null ? "待分组" : "组名待核实")));
    } else assert.ok(text.includes(record.owner.agentName || "归属待核实"));
    const money = data.view === "AGENTS" ? record.current.ownLifetime.find(value => value.currency === query.currency)?.deposits : record.lifetime.find(value => value.currency === query.currency)?.deposits;
    const numeric = row.locator(`[aria-label^="${data.view === "AGENTS" ? "客户累计充值" : "本人累充"} ${query.currency}："]`);
    const title = await assertNumericDom(numeric, money, `${data.view === "AGENTS" ? "客户累计充值" : "本人累充"} ${query.currency}`);
    associations.push({ id: record.accountId ?? record.customerId, name, groupId: record.account?.groupId ?? record.owner?.groupId, amountTitle: title });
  }
  return { rows: data.records.length, pager, associations };
}

export async function produceHandoff({ identity, sourcePhase, reportPath, login }) {
  const evidenceDir = join(dirname(reportPath), `I3-${identity.runId}-${identity.checkId}`);
  mkdirSync(evidenceDir, { recursive: true });
  const step = { id: "FE-API-HANDOFF", status: "unverified", evidence: [], reason: "Not observed in this run" };
  let browser, before, config, configSha256, runtimeReceipt, runtimeTarget, baselineBinding;
  const observations = [], diagnostics = [];
  const save = (name, value) => { const file = join(evidenceDir, name); writeFileSync(file, JSON.stringify(value, null, 2)); return `${file} (sha256 ${fileHash(file)})`; };
  try {
    assertRuntimeIdentity(identity, sourcePhase, resolve(import.meta.dirname, ".."));
    assert.equal(sourcePhase, "I3-F");
    before = repositoryDigest(identity.repo);
    assert.ok(process.env.SUPPORT_ACCEPTANCE_CONFIG, "SUPPORT_ACCEPTANCE_CONFIG is required before I3 login");
    config = readJson(process.env.SUPPORT_ACCEPTANCE_CONFIG);
    configSha256 = fileHash(process.env.SUPPORT_ACCEPTANCE_CONFIG);
    assert.equal(config.taskId, identity.taskId); assert.equal(resolve(config.repo), resolve(identity.repo)); assert.equal(config.isolatedDatabase, true);
    assert.equal(config.baseUrl, "http://127.0.0.1:33108");
    assert.ok(process.env.SUPPORT_RUNTIME_RECEIPT, "Current root-measured startup receipt is required before I3 login");
    runtimeReceipt = readJson(process.env.SUPPORT_RUNTIME_RECEIPT);
    runtimeTarget = { taskId: identity.taskId, repo: identity.repo, origin: config.baseUrl, candidateDigest: before, receiptPath: process.env.SUPPORT_RUNTIME_RECEIPT, receiptSha256: fileHash(process.env.SUPPORT_RUNTIME_RECEIPT) };
    assertHandoffConfig(config.handoff, config, runtimeReceipt);
    await assertCurrentRuntimeRun(identity, sourcePhase);
    await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget);
    baselineBinding = await backendBinding(config.handoff.backend, runtimeReceipt);
    const parserFiles = ["lib/admin/support-analytics-client.ts", "lib/admin/support-group-client.ts", "lib/admin/m-support-enhancements.ts", "lib/admin/m-support-read-contract.ts"];
    const [{ parseSupportAnalyticsResponse }, { parseSupportGroup, parseGroupDetail }, { parseSupportProfile }, { parseMContentApiEnvelope }] = await Promise.all(parserFiles.map(file => import(pathToFileURL(join(identity.repo, file)).href)));
    const parse = async (response, accountCase) => {
      assert.equal(response.status(), 200, "The real authorized GET failed");
      const url = new URL(response.url()), query = conditions(url), expected = expectedQuery(url);
      const body = await response.json(), data = parseSupportAnalyticsResponse(businessData(body), expected);
      assertAnalyticsScope(data, query, accountCase);
      if (query.basis === "PERIOD_EVENT") { const current = monthWindow(); assert.equal(query.from, current.from); assert.equal(query.to, current.to); }
      return { data, query, responseSha256: sha256(JSON.stringify(body)), path: url.pathname, status: response.status(), expected };
    };
    const recheck = async () => { assert.equal(configSha256, fileHash(process.env.SUPPORT_ACCEPTANCE_CONFIG), "Acceptance configuration changed during I3"); assert.equal(before, repositoryDigest(identity.repo)); await verifyRuntimeOwnership(runtimeReceipt, runtimeTarget); assert.deepEqual(await backendBinding(config.handoff.backend, runtimeReceipt), baselineBinding, "BE handoff/state/contracts changed during I3"); };
    browser = await chromium.launch({ headless: true });
    for (const accountCase of config.handoff.cases) {
      await recheck();
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" }), page = await context.newPage();
      const auth = [], network = [], deniedWrites = [], errors = [], captures = []; let abortNext = false, faultUrl;
      try {
        await context.route("**/*", async route => {
          const request = route.request(), url = new URL(request.url());
          if (!["http:", "https:"].includes(url.protocol)) return route.continue();
          try {
            assert.equal(url.origin, config.baseUrl, "I3 browser must not contact an external origin");
            assertReadOnlyRequest(request.method(), url.pathname);
          } catch { deniedWrites.push({ path: url.pathname, method: request.method() }); await route.abort("blockedbyclient"); return; }
          if (abortNext && request.method() === "GET" && url.pathname === analyticsPath) { abortNext = false; faultUrl = request.url(); network.push({ path: url.pathname, method: "GET", kind: "fault-injection", query: conditions(url), transport: "aborted" }); return route.abort("failed"); }
          await route.continue();
        });
        page.on("pageerror", error => errors.push({ type: "pageerror", message: error.name }));
        page.on("console", message => { if (message.type() === "error") errors.push({ type: "console", message: message.text().startsWith("Failed to load resource:") ? "resource-load-error" : "application-console-error", path: new URL(message.location().url || config.baseUrl).pathname }); });
        page.on("response", response => {
          const url = new URL(response.url()), path = url.pathname, method = response.request().method();
          if (path.startsWith("/api/admin/auth/")) {
            captures.push((async () => {
              let mfaMode; if (path === "/api/admin/auth/login" && response.status() === 200) mfaMode = businessData(await response.json()).mfa?.mode;
              auth.push({ path, method, status: response.status(), ...(mfaMode ? { mfaMode } : {}) });
            })().catch(() => errors.push({ type: "auth-envelope", path, message: "Invalid real auth envelope" })));
          } else if (path.startsWith("/api/admin/content/")) network.push({ path, method, status: response.status(), kind: method === "POST" ? "readAuth" : "read", ...(path === analyticsPath ? { query: conditions(url) } : {}) });
        });
        await new Promise(resolve => setTimeout(resolve, 30000 - Date.now() % 30000 + 250));
        const initialSession = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/auth/session" && response.request().method() === "GET");
        const sessionBody = await login(context, page, config.baseUrl, config.accounts[accountCase.account]);
        assert.equal((await initialSession).status(), 401, "A new context must read an unauthenticated initial session");
        await Promise.all(captures);
        assert.ok(auth.some(row => row.path === "/api/admin/auth/login" && row.status === 200 && row.mfaMode === "VERIFY"), "Real password login/MFA challenge was not observed");
        assert.ok(auth.some(row => row.path === "/api/admin/auth/mfa/verify" && row.status === 200), "Real UI MFA verification was not observed");
        const session = businessData(sessionBody).session;
        assert.equal(String(session.adminId), accountCase.adminId);
        for (const code of accountCase.authorities) assert.ok(session.authorities?.includes(code), "Real session lacks required authority");
        for (const code of accountCase.menuCodes) assert.ok((session.menuCodes ?? session.effectiveMenus)?.includes(code), "Real session lacks required menu");
        const scopeResponse = waitAnalytics(page, { view: "OVERVIEW", pageSize: 1 });
        await page.goto(`${config.baseUrl}/service/overview`, { waitUntil: "domcontentloaded" });
        const scope = await parse(await scopeResponse, accountCase);
        if (accountCase.mode === "PERSONAL") await page.getByRole("button", { name: "查看首充、邀请与充值画像", exact: true }).click();
        await page.getByRole("button", { name: "刷新数据", exact: true }).waitFor();
        const caseObservations = [];
        const observe = async (response, requireNonempty = false) => {
          const observation = await parse(response, accountCase), { data, query } = observation;
          const direct = await parse(await context.request.get(`${config.baseUrl}${analyticsPath}?${new URLSearchParams(query)}`), accountCase);
          assert.equal(direct.data.queryVersion, data.queryVersion, "Page/direct GET did not share the current query version");
          assert.deepEqual(direct.data.records, data.records, "Page/direct GET returned different record identities");
          if (requireNonempty) assert.ok(data.records.length > 0, "The current isolated seed lacks a verifiable nonempty main table");
          const dom = await verifyDom(page, data, query);
          const file = join(evidenceDir, `${accountCase.mode}-${caseObservations.length}.png`); await page.screenshot({ path: file, fullPage: true });
          caseObservations.push({ query, responseSha256: observation.responseSha256, directResponseSha256: direct.responseSha256, scopeMode: data.scopeSummary.mode, groupIds: data.scopeSummary.groups.map(row => row.groupId), queryVersion: data.queryVersion, versionState: data.versionState, personnelStatus: data.scopeSummary.personnel.status, dom, screenshot: `${file} (sha256 ${fileHash(file)})` });
          return observation;
        };
        let customerObservation;
        for (const basis of ["CURRENT_CUSTOMER_HISTORY", "PERIOD_EVENT"]) for (const currency of ["USDT", "NEX"]) for (const [view, label] of accountCase.mode === "PERSONAL" ? [["CUSTOMERS", "客户"]] : [["OVERVIEW", "总览"], ["AGENTS", "客服"], ["CUSTOMERS", "客户"]]) {
          await page.getByRole("navigation", { name: "数据视角" }).getByRole("button", { name: label, exact: true }).click();
          await select(page, "统计口径", basis === "PERIOD_EVENT" ? "期间业绩" : "当前客户");
          await select(page, "币种", currency);
          if (basis === "PERIOD_EVENT") await select(page, "自然月", monthWindow().month.replace("-", "年") + "月");
          const query = { view, basis, currency, pageNum: 1 }, response = waitAnalytics(page, query);
          await page.getByRole("button", { name: "刷新数据", exact: true }).click();
          const observation = await observe(await response, view === "CUSTOMERS");
          if (view === "CUSTOMERS") customerObservation = observation;
          if (view !== "OVERVIEW") {
            const next = page.locator(".sa-pager").getByRole("button", { name: "下一页", exact: true });
            assert.equal(await next.isDisabled(), !observation.data.canContinue || observation.data.versionState !== "READY");
            if (observation.data.canContinue && observation.data.versionState === "READY") {
              const continuation = waitAnalytics(page, { ...query, pageNum: 2, expectedVersion: observation.data.queryVersion }); await next.click(); await observe(await continuation);
              const previous = waitAnalytics(page, { ...query, pageNum: 1, expectedVersion: observation.data.queryVersion }); await page.locator(".sa-pager").getByRole("button", { name: "上一页", exact: true }).click(); await observe(await previous);
            }
          }
        }
        assert.ok(customerObservation, "No customer main-table correspondence was observed");
        if (accountCase.mode !== "PERSONAL") {
          const groupId = customerObservation.data.records.find(row => row.owner.groupId !== null)?.owner.groupId;
          const group = customerObservation.data.scopeSummary.groups.find(row => row.groupId === groupId);
          assert.ok(group?.name, "A real authorized group with a nonempty customer table is required");
          const grouped = waitAnalytics(page, { view: "CUSTOMERS", basis: "PERIOD_EVENT", currency: "NEX", groupId: group.groupId, pageNum: 1 });
          await page.locator(".sa-group-tabs").getByRole("button", { name: group.name, exact: true }).click(); customerObservation = await observe(await grouped, true);
        }
        if (accountCase.mode === "PERSONAL") assert.equal(await page.getByRole("button", { name: "分组管理", exact: true }).count(), 0);
        else {
          const directoryResponse = page.waitForResponse(response => new URL(response.url()).pathname === groupsPath && response.request().method() === "GET");
          const initialGroupId = customerObservation.query.groupId;
          const initialDetailResponse = initialGroupId ? page.waitForResponse(response => new URL(response.url()).pathname === `${groupsPath}/${initialGroupId}` && response.request().method() === "GET") : undefined;
          await page.getByRole("button", { name: "分组管理", exact: true }).click();
          const directory = await directoryResponse; assert.equal(directory.status(), 200);
          const groupData = parseMContentApiEnvelope(directory.status(), await directory.text(), true); assert.ok(Array.isArray(groupData), "The real group directory is not an array");
          const groups = groupData.map(parseSupportGroup);
          const directDirectory = await context.request.get(`${config.baseUrl}${groupsPath}`); assert.equal(directDirectory.status(), 200);
          const directGroupData = parseMContentApiEnvelope(directDirectory.status(), await directDirectory.text(), true); assert.ok(Array.isArray(directGroupData)); assert.deepEqual(directGroupData.map(parseSupportGroup), groups, "Page/direct directory reads differ");
          assert.deepEqual(sortedIds(groups.map(group => group.id)), sortedIds(accountCase.groupIds));
          assert.ok(groups.length > 0, "A real managed directory/detail record is required");
          const group = groups[0]; if (accountCase.mode === "MANAGED") for (const row of groups) assert.equal(row.supervisorAdminId, accountCase.adminId);
          const root = page.getByRole("region", { name: "客服组管理" });
          let initialDetail;
          if (initialDetailResponse) {
            const response = await initialDetailResponse; assert.equal(response.status(), 200);
            initialDetail = parseGroupDetail(businessData(await response.json()));
            assert.equal(initialDetail.group.id, initialGroupId, "Initial member detail is not the selected statistics group");
            assert.deepEqual(initialDetail.group, groups.find(row => row.id === initialGroupId), "Initial detail and directory disagree about the selected group");
          }
          const directoryRows = await enterGroupDirectory(root, groups, initialDetail), row = directoryRows.first();
          const detailResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${groupsPath}/${group.id}` && response.request().method() === "GET");
          await row.getByRole("button", { name: "管理成员与组资料", exact: true }).click();
          const detail = await detailResponse; assert.equal(detail.status(), 200); assert.equal(parseGroupDetail(businessData(await detail.json())).group.id, group.id);
          await enterGroupDirectory(root, groups, parseGroupDetail(businessData(await detail.json())));
          const returned = waitAnalytics(page, customerObservation.query); await root.getByRole("button", { name: "返回统计工作台", exact: true }).click();
          const restored = await observe(await returned, true); assert.equal(restored.data.queryVersion, customerObservation.data.queryVersion, "Returning from group management lost the query version");
          customerObservation = restored;
        }
        const selectedRow = page.locator(".sa-table tbody tr").first(), customer = customerObservation.data.records[0];
        const profileResponse = page.waitForResponse(response => new URL(response.url()).pathname === `${customer.profileRef}/360` && response.request().method() === "GET");
        await selectedRow.locator("button.sa-name").click(); const profile = await profileResponse; assert.equal(profile.status(), 200);
        const profileData = parseSupportProfile(businessData(await profile.json())); assert.equal(profileData.identity.status, "READY"); assert.equal(String(profileData.identity.data.customerId), customer.customerId);
        const dialog = page.getByRole("dialog", { name: "客户资料与原业务明细" }); await dialog.locator(".cvp-row").filter({ hasText: "客户 ID" }).filter({ hasText: customer.customerId }).waitFor({ state: "visible" });
        await dialog.getByRole("button", { name: "返回统计列表", exact: true }).click();
        await verifyDom(page, customerObservation.data, customerObservation.query);
        for (const probe of accountCase.negativeReads) {
          const response = await context.request.get(`${config.baseUrl}${probe.path}`); assert.equal(response.status(), probe.status, "A real denial probe exposed an unauthorized object");
          network.push({ path: new URL(probe.path, config.baseUrl).pathname, method: "GET", status: response.status(), kind: "authorized-denial-probe", responseSha256: sha256(await response.body()) });
        }
        const emptyResponse = waitAnalytics(page, { ...customerObservation.query, keyword: accountCase.emptyKeyword, pageNum: 1 });
        await page.getByPlaceholder("客户名称或编码", { exact: true }).fill(accountCase.emptyKeyword); await page.locator(".sa-controls").getByRole("button", { name: "搜索", exact: true }).click();
        const empty = await observe(await emptyResponse); assert.equal(empty.data.records.length, 0, "Provisioned empty query returned real rows");
        const recovered = waitAnalytics(page, customerObservation.query); await page.getByRole("button", { name: "清除客服与客户筛选", exact: true }).click(); const recovery = await observe(await recovered, true);
        const errorCount = errors.length; abortNext = true; await page.getByRole("button", { name: "刷新数据", exact: true }).click();
        await page.locator('.sa-state[role="alert"]').waitFor({ state: "visible" }); assert.equal(abortNext, false, "The one real GET transport fault was never exercised");
        assert.equal(await page.locator(".sa-table tbody tr").count(), 0, "Failed query left stale main rows");
        const retryResponse = waitAnalytics(page, recovery.query); await page.getByRole("button", { name: "重试读取", exact: true }).click(); const retried = await observe(await retryResponse, true);
        assert.equal(retried.data.queryVersion, recovery.data.queryVersion);
        for (const error of errors.slice(errorCount)) if (error.type === "console" && error.message === "resource-load-error" && error.path === new URL(faultUrl).pathname) error.classification = "expected-readonly-GET-abort";
        const unexpectedErrors = errors.filter(error => error.classification !== "expected-readonly-GET-abort");
        assert.deepEqual(deniedWrites, [], "The page attempted a business write during read-only handoff"); assert.deepEqual(unexpectedErrors, [], "Unexpected browser errors must not be reported as console=0");
        await recheck();
        observations.push({ mode: accountCase.mode, adminId: accountCase.adminId, session: { adminId: String(session.adminId), roleCode: session.roleCode ?? session.role, menuCodes: session.menuCodes ?? session.effectiveMenus, authorities: session.authorities }, auth, initialScope: { mode: scope.data.scopeSummary.mode, queryVersion: scope.data.queryVersion }, queries: caseObservations, network, browserErrors: errors, faultInjection: { method: "GET", path: analyticsPath, count: 1, recoveryStatus: retried.status, expectedResourceErrorCount: errors.length, unexpectedErrorCount: unexpectedErrors.length }, businessWrites: 0 });
        save("handoff-observations.partial.json", { runtimeKind: "real-http-and-browser", complete: false, observations });
      } finally { await Promise.all(captures); diagnostics.push({ mode: accountCase.mode, deniedWrites, errors, network }); await context.close(); }
    }
    await recheck();
    step.status = "pass"; delete step.reason;
    step.evidence = [save("handoff-observations.json", { runtimeKind: "real-http-and-browser", complete: true, backend: baselineBinding, parserFiles: parserFiles.map(path => ({ path, sha256: fileHash(join(identity.repo, path)) })), runtimeReceiptSha256: runtimeTarget.receiptSha256, observations })];
  } catch (error) { step.reason = error.message; process.exitCode = 1; console.error(`I3 handoff unverified: ${error.message}`); }
  finally {
    await browser?.close();
    let treeMoved = true; if (before) try { treeMoved = before !== repositoryDigest(identity.repo); } catch { /* Missing source evidence cannot pass. */ }
    if (treeMoved || step.status !== "pass") { step.status = "unverified"; process.exitCode = 1; }
    if (diagnostics.length) save("handoff-diagnostics.json", diagnostics);
    writeFileSync(reportPath, JSON.stringify({ ...identity, sourcePhase, at: new Date().toISOString(), verdict: step.status === "pass" ? "pass" : "unverified", mode: "full", capability: "runtime", innerSkipped: 0, treeMoved, steps: [step] }, null, 2));
  }
}
