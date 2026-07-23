import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const TEMP_INITIAL_PASSWORD = requiredEnv("M5_TEMP_INITIAL_PASSWORD");
const TEMP_FINAL_PASSWORD = requiredEnv("M5_TEMP_FINAL_PASSWORD");
const PREFIX = "M5-20260723";
const SUFFIX = Date.now().toString(36).slice(-7);
const TEMP_USERNAME = `m5-20260723-${SUFFIX}`.slice(0, 32);
const TEMP_DISPLAY_NAME = `${PREFIX}-客服主管-${SUFFIX}`;
const SCRIPT_TEXT = `${PREFIX}-顾问主动话术-${SUFFIX}`;
const TEMPLATE_TEXT = `${PREFIX}-即时回复模板-${SUFFIX}`;
const OPENING_TEXT = `${PREFIX}-M3模板联动会话-${SUFFIX}`;
const EVIDENCE_DIR = path.resolve(process.env.M5_EVIDENCE_DIR ?? "D:/workspace/bug-pic/m-domain-acceptance-20260723/final/M5/evidence/final");
const RESULT_PATH = path.join(EVIDENCE_DIR, "runtime-result.json");
const mfaSecrets = new Map<string, string>();
const usedTotpSteps = new Map<string, number>();

type ResponseLike = { status(): number; text(): Promise<string> };
type Envelope<T> = { code?: number; message?: string; data?: T };
type Overview = {
  categories?: Array<{ type: string; name: string; enabled: boolean; readOnly?: boolean }>;
  advisorPolicy?: { enabled: boolean; delayMs: number; cooldownHours: number; maxPerSession: number; audience: string };
  audienceOptions?: string[];
  scripts?: Array<{ id: string; text: string; status: string; audience: string }>;
  replyTemplates?: Array<{ id: string; type: string; text: string; status: string }>;
};
type SupportOverview = { agents?: Array<{ id: string; adminId: number; name: string; position: string }> };

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off", screenshot: "off" });

test.beforeAll(() => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("M5 visible lifecycle, backend truth, RBAC, concurrency, failure recovery and M1/M3 linkage", async ({ page, browser }) => {
  let accountId = "";
  let adminId = 0;
  let supportAgentId = "";
  let scriptId = "";
  let templateId = "";
  let conversationNo = "";
  let originalAdvisorEnabled = false;
  let originalDelay = 0;
  let originalAudience = "";
  const checks: string[] = [];

  await test.step("anonymous is rejected and root reaches M5 from the visible sidebar", async () => {
    const anonymous = await browser.newContext({ baseURL: BASE_URL });
    const denied = await anonymous.request.get("/api/admin/content/session-templates/overview");
    expect([401, 403]).toContain(denied.status());
    await anonymous.close();

    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const rootAuth = await okEnvelope<{ session?: { role?: string; roleCode?: string; authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
    const rootSession = rootAuth.session ?? {};
    expect([rootSession.role, rootSession.roleCode].some((role) => /super/i.test(role ?? "")) || ["service_m5_read", "service_m5_write"].every((code) => (rootSession.authorities ?? []).includes(code))).toBeTruthy();
    await openModule(page, "/service/scripts");
    await expect(page.getByText("会话类别", { exact: true })).toBeVisible();
    await expect(page.getByText("顾问主动推送策略", { exact: true })).toBeVisible();
    await expect(page.getByText(/mock|localStorage|模拟话术/i)).toHaveCount(0);

    const overview = await getOverview(page);
    expect(overview.audienceOptions).toEqual(["全量用户", "新注册用户", "高价值用户", "活跃设备用户"]);
    expect(overview.categories?.find((row) => row.type === "ai")?.readOnly).toBeTruthy();
    await expect(page.locator('[data-proof="session-cat-toggle-ai"]')).toHaveCount(0);
    originalAdvisorEnabled = Boolean(overview.categories?.find((row) => row.type === "advisor")?.enabled);
    originalDelay = Number(overview.advisorPolicy?.delayMs ?? 0);
    originalAudience = String(overview.advisorPolicy?.audience ?? "");
    checks.push("anonymous-denied", "visible-m5-entry", "root-m5-authority", "server-audience-options", "ai-readonly-boundary");
  });

  await test.step("create one isolated SUPPORT supervisor and prove the M1/M5 seat source is shared", async () => {
    const account = await okEnvelope<{ id: string }>(await page.request.post("/api/admin/platform/accounts", {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-ACCOUNT` },
      data: {
        username: TEMP_USERNAME,
        displayName: TEMP_DISPLAY_NAME,
        email: `m5.${SUFFIX}@nexion.invalid`,
        role: "support",
        initialPassword: TEMP_INITIAL_PASSWORD,
        reason: `${PREFIX}-创建客服主管验收账号`,
        operator: ROOT_USERNAME,
      },
    }));
    accountId = String(account.id);
    adminId = Number(accountId.replace(/\D/g, ""));
    expect(adminId).toBeGreaterThan(0);

    await okEnvelope(await page.request.patch(`/api/admin/content/support-agents/${adminId}/seat-assignment`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-SUPERVISOR-SEAT` },
      data: {
        position: "客服主管",
        serviceTypes: ["support", "advisor"],
        tags: [PREFIX, "验收主管"],
        maxConcurrent: 5,
        enabled: true,
        transferable: true,
        busy: false,
        userIds: [],
        reason: `${PREFIX}-配置客服主管坐席`,
        operator: ROOT_USERNAME,
      },
    }));
    const supportOverview = await okEnvelope<SupportOverview>(await page.request.get("/api/admin/content/support-agents"));
    const createdAgent = (supportOverview.agents ?? []).find((row) => Number(row.adminId) === adminId);
    expect(createdAgent?.position).toBe("客服主管");
    supportAgentId = String(createdAgent?.id ?? "");
    expect(supportAgentId).toBeTruthy();

    await openModule(page, "/service/overview");
    await expect(page.getByText(TEMP_DISPLAY_NAME, { exact: true })).toBeVisible();
    await openModule(page, "/service/scripts");
    await goToLastPage(cardByHeading(page, "客服岗位与专属客服"));
    await expect(cardByHeading(page, "客服岗位与专属客服").getByText(TEMP_DISPLAY_NAME, { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-m1-m5-shared-supervisor-seat.png"), fullPage: true });
    checks.push("support-supervisor-fixture", "m1-m5-shared-seat-truth");
  });

  await test.step("support supervisor can write M5; category failure keeps the dialog and retries with the same key", async () => {
    await logout(page);
    await login(page, TEMP_USERNAME, TEMP_INITIAL_PASSWORD, TEMP_FINAL_PASSWORD);
    const supportAuth = await okEnvelope<{ session?: { authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
    expect(supportAuth.session?.authorities ?? []).toEqual(expect.arrayContaining(["service_m5_read", "service_m5_write"]));
    await openModule(page, "/service/scripts");
    await expect(page.locator('[data-proof="session-policy-enabled"]')).toBeEnabled();

    await page.locator('[data-proof="session-cat-toggle-advisor"] button').click();
    const dialog = await operationDialog(page);
    const reason = dialog.getByLabel(/操作理由/);
    await reason.fill("1234567");
    await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
    const categoryReason = `${PREFIX}-类别失败恢复验收`;
    await reason.fill(categoryReason);
    await expect(dialog.getByRole("button", { name: "确认提交" })).toBeEnabled();

    let failedKey = "";
    const routePattern = "**/api/admin/content/session-templates/categories/advisor";
    await page.route(routePattern, (route) => {
      failedKey = route.request().headers()["idempotency-key"] ?? "";
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "M5_ACCEPTANCE_INJECTED_FAILURE" }) });
    });
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(page.getByText(/写入失败或结果未知/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(reason).toHaveValue(categoryReason);
    expect(failedKey).toBeTruthy();
    expect((await getOverview(page)).categories?.find((row) => row.type === "advisor")?.enabled).toBe(originalAdvisorEnabled);
    await page.unroute(routePattern);

    const retryResponsePromise = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/session-templates/categories/advisor"));
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const retryResponse = await retryResponsePromise;
    await okEnvelope(retryResponse);
    expect(retryResponse.request().headers()["idempotency-key"]).toBe(failedKey);
    expect((await getOverview(page)).categories?.find((row) => row.type === "advisor")?.enabled).toBe(!originalAdvisorEnabled);

    await page.locator('[data-proof="session-cat-toggle-advisor"] button').click();
    await submitDialog(page, `${PREFIX}-恢复会话类别原值`);
    expect((await getOverview(page)).categories?.find((row) => row.type === "advisor")?.enabled).toBe(originalAdvisorEnabled);
    checks.push("support-supervisor-write", "reason-8-boundary", "injected-500-fail-closed", "same-key-visible-retry", "category-restored");
  });

  await test.step("policy and audience use backend truth, idempotent replay and stale-page conflict protection", async () => {
    const newDelay = originalDelay <= 59_800 ? originalDelay + 137 : originalDelay - 137;
    await page.locator('[data-proof="session-policy-delay"]').click();
    const delayDialog = await operationDialog(page);
    await delayDialog.getByLabel("目标新值").fill(String(newDelay));
    await delayDialog.getByLabel(/操作理由/).fill(`${PREFIX}-调整首推延迟并验证并发`);
    const responsePromise = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname.endsWith("/session-templates/advisor-policy/delayMs"));
    await delayDialog.getByRole("button", { name: "确认提交" }).click();
    const changedResponse = await responsePromise;
    await okEnvelope(changedResponse);
    const changedKey = changedResponse.request().headers()["idempotency-key"];
    const changedBody = changedResponse.request().postDataJSON() as Record<string, unknown>;
    expect(Number((await getOverview(page)).advisorPolicy?.delayMs)).toBe(newDelay);

    const replay = await page.request.patch("/api/admin/content/session-templates/advisor-policy/delayMs", {
      headers: { "Idempotency-Key": changedKey },
      data: changedBody,
    });
    await okEnvelope(replay);
    expect(Number((await getOverview(page)).advisorPolicy?.delayMs)).toBe(newDelay);

    const stale = await page.request.patch("/api/admin/content/session-templates/advisor-policy/delayMs", {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-STALE-DELAY` },
      data: { value: String(newDelay + 1), expectedValue: String(originalDelay), reason: `${PREFIX}-旧页面并发覆盖拦截`, operator: TEMP_USERNAME },
    });
    expect(stale.status()).toBe(409);

    const shortReason = await page.request.patch("/api/admin/content/session-templates/advisor-policy/delayMs", {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-SHORT-REASON` },
      data: { value: String(newDelay + 2), expectedValue: String(newDelay), reason: "1234567", operator: TEMP_USERNAME },
    });
    expect(shortReason.status()).toBe(422);

    const unsupportedAudience = await page.request.patch("/api/admin/content/session-templates/advisor-policy/audience", {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-BAD-AUDIENCE` },
      data: { value: `${PREFIX}-前端自造受众`, expectedValue: originalAudience, reason: `${PREFIX}-拒绝非权威受众`, operator: TEMP_USERNAME },
    });
    expect(unsupportedAudience.status()).toBe(422);

    const overview = await getOverview(page);
    const nextAudience = (overview.audienceOptions ?? []).find((item) => item !== originalAudience);
    expect(nextAudience).toBeTruthy();
    await page.locator('[data-proof="session-policy-audience"]').click();
    const audienceDialog = await operationDialog(page);
    await audienceDialog.getByRole("button", { name: nextAudience!, exact: true }).click();
    await audienceDialog.getByLabel(/操作理由/).fill(`${PREFIX}-受众权威选项持久化`);
    await audienceDialog.getByRole("button", { name: "确认提交" }).click();
    await expect(audienceDialog).toBeHidden();
    expect((await getOverview(page)).advisorPolicy?.audience).toBe(nextAudience);

    await restorePolicy(page, "delayMs", String(originalDelay), String(newDelay), `${PREFIX}-恢复首推延迟`);
    await restorePolicy(page, "audience", originalAudience, nextAudience!, `${PREFIX}-恢复受众原值`);
    const restored = await getOverview(page);
    expect(restored.advisorPolicy?.delayMs).toBe(originalDelay);
    expect(restored.advisorPolicy?.audience).toBe(originalAudience);
    checks.push("policy-server-truth", "idempotent-replay", "stale-write-409", "short-reason-422", "unsupported-audience-422", "audience-persisted", "policy-restored");
  });

  await test.step("script and reply template follow draft to published and survive refresh/relogin", async () => {
    await page.locator('[data-proof="session-script-new"]').click();
    let dialog = await operationDialog(page);
    await dialog.getByLabel("目标新值").fill(SCRIPT_TEXT);
    await dialog.getByLabel(/操作理由/).fill(`${PREFIX}-创建话术草稿`);
    const scriptKeys: string[] = [];
    const scriptBodies: string[] = [];
    let scriptAttempt = 0;
    const scriptRoute = "**/api/admin/content/session-templates/scripts";
    await page.route(scriptRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      scriptKeys.push(route.request().headers()["idempotency-key"] ?? "");
      scriptBodies.push(route.request().postData() ?? "");
      scriptAttempt += 1;
      if (scriptAttempt === 1) {
        const upstream = await route.fetch();
        expect(upstream.status()).toBeLessThan(400);
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: 502, message: "M5_SCRIPT_RESPONSE_LOST" }) });
        return;
      }
      await route.continue();
    });
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(page.getByText(/写入失败或结果未知/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("目标新值")).toHaveValue(SCRIPT_TEXT);
    await expect(dialog.getByRole("button", { name: "确认提交" })).toBeEnabled();
    let responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/session-templates/scripts"));
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const script = await okEnvelope<{ id: string; status: string }>(await responsePromise);
    await page.unroute(scriptRoute);
    expect(scriptKeys).toHaveLength(2);
    expect(scriptKeys[0]).toBeTruthy();
    expect(scriptKeys[1]).toBe(scriptKeys[0]);
    expect(scriptBodies[1]).toBe(scriptBodies[0]);
    scriptId = script.id;
    expect(script.status).toBe("draft");
    expect(((await getOverview(page)).scripts ?? []).filter((row) => row.text === SCRIPT_TEXT)).toHaveLength(1);
    await goToLastPage(cardByHeading(page, "顾问主动话术"));
    await expect(cardByHeading(page, "顾问主动话术").getByText(SCRIPT_TEXT, { exact: true })).toBeVisible();

    await page.locator(`[data-proof="session-script-publish-${scriptId}"] button`).click();
    await submitDialog(page, `${PREFIX}-发布话术供顾问使用`);
    expect((await findScript(page, scriptId)).status).toBe("published");

    await page.locator('[data-proof="session-tpl-new"]').click();
    dialog = await operationDialog(page);
    await dialog.getByLabel("目标新值").fill(TEMPLATE_TEXT);
    await dialog.getByLabel(/操作理由/).fill(`${PREFIX}-创建回复模板草稿`);
    const templateKeys: string[] = [];
    const templateBodies: string[] = [];
    let templateAttempt = 0;
    const templateRoute = "**/api/admin/content/session-templates/reply-templates";
    await page.route(templateRoute, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      templateKeys.push(route.request().headers()["idempotency-key"] ?? "");
      templateBodies.push(route.request().postData() ?? "");
      templateAttempt += 1;
      if (templateAttempt === 1) {
        const upstream = await route.fetch();
        expect(upstream.status()).toBeLessThan(400);
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: 502, message: "M5_TEMPLATE_RESPONSE_LOST" }) });
        return;
      }
      await route.continue();
    });
    await dialog.getByRole("button", { name: "确认提交" }).click();
    await expect(page.getByText(/写入失败或结果未知/)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("目标新值")).toHaveValue(TEMPLATE_TEXT);
    await expect(dialog.getByRole("button", { name: "确认提交" })).toBeEnabled();
    responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/session-templates/reply-templates"));
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const template = await okEnvelope<{ id: string; status: string }>(await responsePromise);
    await page.unroute(templateRoute);
    expect(templateKeys).toHaveLength(2);
    expect(templateKeys[0]).toBeTruthy();
    expect(templateKeys[1]).toBe(templateKeys[0]);
    expect(templateBodies[1]).toBe(templateBodies[0]);
    templateId = template.id;
    expect(template.status).toBe("draft");
    expect(((await getOverview(page)).replyTemplates ?? []).filter((row) => row.text === TEMPLATE_TEXT)).toHaveLength(1);
    await goToLastPage(cardByHeading(page, "即时回复模板库"));
    await expect(cardByHeading(page, "即时回复模板库").getByText(TEMPLATE_TEXT, { exact: true })).toBeVisible();

    await page.locator(`[data-proof="session-tpl-publish-${templateId}"] button`).click();
    await submitDialog(page, `${PREFIX}-发布模板供坐席使用`);
    expect((await findReplyTemplate(page, templateId)).status).toBe("published");

    await page.reload({ waitUntil: "domcontentloaded" });
    await goToLastPage(cardByHeading(page, "顾问主动话术"));
    await expect(cardByHeading(page, "顾问主动话术").getByText(SCRIPT_TEXT, { exact: true })).toBeVisible();
    await goToLastPage(cardByHeading(page, "即时回复模板库"));
    await expect(cardByHeading(page, "即时回复模板库").getByText(TEMPLATE_TEXT, { exact: true })).toBeVisible();
    await logout(page);
    await login(page, TEMP_USERNAME, TEMP_FINAL_PASSWORD);
    await openModule(page, "/service/scripts");
    expect((await findScript(page, scriptId)).status).toBe("published");
    expect((await findReplyTemplate(page, templateId)).status).toBe("published");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-script-template-published-after-relogin.png"), fullPage: true });
    checks.push("script-response-lost-same-key-one-row", "script-draft-created", "script-published", "template-response-lost-same-key-one-row", "template-draft-created", "template-published", "refresh-relogin-persistence");
  });

  await test.step("M3 consumes the published M5 template and M1 still exposes the same supervisor", async () => {
    await logout(page);
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    await openModule(page, "/service/sessions");
    await page.locator('[data-proof="session-initiate"]').click();
    const initiateDialog = page.locator('[role="dialog"]:visible').last();
    await expect(initiateDialog.getByText("主动发起会话", { exact: true }).first()).toBeVisible();
    const identity = initiateDialog.locator("select").first();
    const supervisorIdentity = await firstSelectOptionContaining(identity, TEMP_DISPLAY_NAME);
    expect(supervisorIdentity).toBeTruthy();
    await identity.selectOption(supervisorIdentity!);
    await initiateDialog.getByPlaceholder("搜索客户 昵称 / 用户编码 / 地区").fill("");
    const customerButton = initiateDialog.locator("button").filter({ hasText: /U[-\s]?\d+/ }).first();
    await expect(customerButton, "the M3 initiation dialog must expose a real backend user").toBeVisible({ timeout: 20_000 });
    await customerButton.click();
    await initiateDialog.locator("textarea").fill(OPENING_TEXT);
    const createResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/content/conversations");
    await initiateDialog.getByRole("button", { name: /^发起会话/ }).click();
    const created = await okEnvelope<{ conversationNo: string }>(await createResponse);
    conversationNo = created.conversationNo;

    await searchConversation(page, conversationNo);
    await page.getByRole("button", { name: /回复模板/ }).click();
    await expect(page.locator(".sku-pop-item").filter({ hasText: TEMPLATE_TEXT })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-m3-consumes-published-m5-template.png"), fullPage: true });

    await openModule(page, "/service/overview");
    await expect(page.getByText(TEMP_DISPLAY_NAME, { exact: true })).toBeVisible();
    checks.push("m3-published-template-link", "m1-supervisor-link");
  });

  await test.step("archive is terminal and archived content disappears from the M3 picker", async () => {
    await openModule(page, "/service/scripts");
    await goToLastPage(cardByHeading(page, "顾问主动话术"));
    await page.locator(`[data-proof="session-script-publish-${scriptId}"] button`).click();
    await submitDialog(page, `${PREFIX}-归档话术验证终态`);
    expect((await findScript(page, scriptId)).status).toBe("archived");

    await goToLastPage(cardByHeading(page, "即时回复模板库"));
    await page.locator(`[data-proof="session-tpl-publish-${templateId}"] button`).click();
    await submitDialog(page, `${PREFIX}-归档模板验证终态`);
    expect((await findReplyTemplate(page, templateId)).status).toBe("archived");

    const reviveScript = await page.request.patch(`/api/admin/content/session-templates/scripts/${scriptId}/status`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-REVIVE-SCRIPT` },
      data: { status: "published", expectedStatus: "archived", reason: `${PREFIX}-归档终态不可恢复`, operator: TEMP_USERNAME },
    });
    expect(reviveScript.status()).toBe(409);
    const reviveTemplate = await page.request.patch(`/api/admin/content/session-templates/reply-templates/${templateId}/status`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-REVIVE-TEMPLATE` },
      data: { status: "published", expectedStatus: "archived", reason: `${PREFIX}-模板归档终态不可恢复`, operator: TEMP_USERNAME },
    });
    expect(reviveTemplate.status()).toBe(409);

    await openModule(page, "/service/sessions");
    await searchConversation(page, conversationNo);
    await page.getByRole("button", { name: /回复模板/ }).click();
    await expect(page.locator(".sku-pop-item").filter({ hasText: TEMPLATE_TEXT })).toHaveCount(0);
    checks.push("script-archived-terminal", "template-archived-terminal", "terminal-revive-409", "m3-archived-template-removed");
  });

  await test.step("role downgrade keeps read visibility but removes every M5 write path", async () => {
    await logout(page);
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    await okEnvelope(await page.request.patch(`/api/admin/platform/accounts/${accountId}/role`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-ROLE-AUDITOR` },
      data: { role: "auditor", reason: `${PREFIX}-验证只读角色权限边界`, operator: ROOT_USERNAME },
    }));
    await logout(page);
    await login(page, TEMP_USERNAME, TEMP_FINAL_PASSWORD);
    await openModule(page, "/service/scripts");
    await expect(page.getByText(/当前账号只有查看权限/)).toBeVisible();
    await expect(page.locator('[data-proof="session-policy-enabled"]')).toBeDisabled();
    await expect(page.locator('[data-proof="session-script-new"]')).toBeDisabled();
    const forbidden = await page.request.patch("/api/admin/content/session-templates/advisor-policy/delayMs", {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-AUDITOR-WRITE` },
      data: { value: String(originalDelay + 1), expectedValue: String(originalDelay), reason: `${PREFIX}-只读角色尝试写入`, operator: TEMP_USERNAME },
    });
    expect(forbidden.status()).toBe(403);

    await logout(page);
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    await okEnvelope(await page.request.patch(`/api/admin/platform/accounts/${accountId}/status`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-DISABLE` },
      data: { status: "disabled", reason: `${PREFIX}-验收结束停用临时账号`, operator: ROOT_USERNAME },
    }));
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-rbac-and-terminal-state.png"), fullPage: true });
    checks.push("auditor-read-visible", "auditor-controls-disabled", "auditor-api-403", "temporary-account-disabled");
  });

  writeFileSync(RESULT_PATH, JSON.stringify({
    prefix: PREFIX,
    suffix: SUFFIX,
    accountId,
    adminId,
    username: TEMP_USERNAME,
    displayName: TEMP_DISPLAY_NAME,
    supportAgentId,
    scriptId,
    templateId,
    conversationNo,
    originalAdvisorEnabled,
    originalDelay,
    originalAudience,
    checks,
  }, null, 2));
  expect(checks).toHaveLength(36);
});

async function getOverview(page: Page) {
  return okEnvelope<Overview>(await page.request.get("/api/admin/content/session-templates/overview"));
}

async function findScript(page: Page, id: string) {
  const data = await okEnvelope<{ records?: Array<{ id: string; text: string; status: string }> }>(
    await page.request.get(`/api/admin/content/session-templates/scripts?pageNum=1&pageSize=100&keyword=${encodeURIComponent(id)}`),
  );
  const row = (data.records ?? []).find((item) => item.id === id);
  expect(row, `script ${id} must exist in backend truth`).toBeTruthy();
  return row!;
}

async function findReplyTemplate(page: Page, id: string) {
  const data = await okEnvelope<{ records?: Array<{ id: string; text: string; status: string }> }>(
    await page.request.get(`/api/admin/content/session-templates/reply-templates?pageNum=1&pageSize=100&keyword=${encodeURIComponent(id)}`),
  );
  const row = (data.records ?? []).find((item) => item.id === id);
  expect(row, `reply template ${id} must exist in backend truth`).toBeTruthy();
  return row!;
}

async function restorePolicy(page: Page, field: string, value: string, expectedValue: string, reason: string) {
  await okEnvelope(await page.request.patch(`/api/admin/content/session-templates/advisor-policy/${field}`, {
    headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-RESTORE-${field}` },
    data: { value, expectedValue, reason, operator: TEMP_USERNAME },
  }));
}

async function operationDialog(page: Page) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last();
  await expect(dialog).toBeVisible();
  return dialog;
}

async function submitDialog(page: Page, reason: string) {
  const dialog = await operationDialog(page);
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

function cardByHeading(page: Page, heading: string) {
  return page.locator(".card").filter({ has: page.getByText(heading, { exact: true }) }).first();
}

async function goToLastPage(card: Locator) {
  const next = card.getByRole("button", { name: "下一页", exact: true });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await expect(card).toBeVisible();
    if (await next.isDisabled().catch(() => true)) return;
    await next.click();
    await expect(next).toBeEnabled().catch(() => undefined);
  }
  throw new Error("M5 pager did not reach the last page");
}

async function firstSelectOptionContaining(select: Locator, text: string) {
  const options = select.locator("option");
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if ((await option.innerText()).includes(text)) return await option.getAttribute("value");
  }
  return null;
}

async function searchConversation(page: Page, conversationNo: string) {
  const all = page.getByRole("button", { name: "全部", exact: true }).first();
  if (await all.isVisible().catch(() => false)) await all.click();
  const search = page.locator('[data-proof="session-search"]');
  await expect(search).toBeVisible();
  await search.fill(conversationNo);
  const detailNo = page.locator('[data-proof="session-conversation-no"]');
  if (await detailNo.textContent().catch(() => "") !== conversationNo) {
    const row = page.locator(".cv-item").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
  }
  await expect(detailNo).toHaveText(conversationNo, { timeout: 20_000 });
}

async function login(page: Page, username: string, password: string, changedPassword?: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible().catch(() => false)) await logout(page);
  const usernameInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(usernameInput).toBeVisible({ timeout: 15_000 });
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const loginResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status()).toBeLessThan(400);
  const payload = await loginResponse.json().catch(() => ({})) as { data?: { mfa?: { manualKey?: string | null } } };

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      if (!changedPassword) throw new Error(`${username} requires a first-login password change`);
      await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(changedPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
    }
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      const visibleSecret = (await page.locator("code").textContent().catch(() => null))?.trim();
      const secret = payload.data?.mfa?.manualKey ?? visibleSecret ?? mfaSecrets.get(username);
      if (!secret) throw new Error(`${username} requires an unavailable TOTP secret`);
      mfaSecrets.set(username, secret);
      await otp.fill(await freshTotp(username, secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function openModule(page: Page, href: string) {
  const group = page.getByRole("button", { name: /客服.*M|M.*客服/ }).first();
  const link = page.locator(`a[href="${href}"]`).first();
  for (let attempt = 0; attempt < 3 && !await link.isVisible().catch(() => false); attempt += 1) {
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link, `${href} must be reachable from the visible sidebar`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}(?:\\?.*)?$`));
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
}

async function okEnvelope<T = unknown>(response: ResponseLike): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for M5 live acceptance`);
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function freshTotp(username: string, secret: string) {
  const previousStep = usedTotpSteps.get(username);
  let currentStep = Math.floor(Date.now() / 30_000);
  if (previousStep !== undefined && currentStep <= previousStep) {
    await new Promise((resolve) => setTimeout(resolve, ((previousStep + 1) * 30_000) - Date.now() + 1_000));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 4) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  currentStep = Math.floor(Date.now() / 30_000);
  usedTotpSteps.set(username, currentStep);
  return currentTotp(secret);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
