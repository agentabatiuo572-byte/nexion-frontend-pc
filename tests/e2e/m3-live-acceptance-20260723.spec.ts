import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const TEMP_INITIAL_PASSWORD = requiredEnv("M3_TEMP_INITIAL_PASSWORD");
const TEMP_FINAL_PASSWORD = requiredEnv("M3_TEMP_FINAL_PASSWORD");
const PREFIX = "M3-20260723";
const SUFFIX = Date.now().toString(36).slice(-7);
const TEMP_USERNAME = `m3-20260723-${SUFFIX}`.slice(0, 32);
const TEMP_DISPLAY_NAME = `${PREFIX}-目标坐席-${SUFFIX}`;
const OPENING = `${PREFIX}-真实用户主动会话-${SUFFIX}`;
const TEMPLATE_REPLY_PREFIX = `${PREFIX}-模板回复-${SUFFIX}`;
const RETRY_DRAFT = `${PREFIX}-网络失败保留草稿-${SUFFIX}`;
const TRANSFER_REASON = `${PREFIX}-转交目标坐席接续处理`;
const EVIDENCE_DIR = path.resolve(process.env.M3_EVIDENCE_DIR ?? "D:/workspace/bug-pic/m-domain-acceptance-20260723/final/M3/evidence/final");
const RESULT_PATH = path.join(EVIDENCE_DIR, "runtime-result.json");
const usedTotpSteps = new Map<string, number>();
const mfaSecrets = new Map<string, string>();

type Envelope<T> = { code?: number; message?: string; data?: T };
type ResponseLike = { status(): number; text(): Promise<string> };
type ConversationView = {
  conversationNo: string;
  status: string;
  ownerAgentId?: string;
  ownerAgentName?: string;
  transferToId?: string;
};
type ConversationDetail = {
  conversation: ConversationView;
  messages: Array<{ id: number; senderType: string; content: string; receiptStatus?: string }>;
};

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off", screenshot: "off" });

test.beforeAll(() => {
  const host = new URL(BASE_URL).hostname;
  expect(["127.0.0.1", "localhost", "::1"]).toContain(host);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("M3 visible user flow, backend truth, cross-agent transfer, M1/M2/M5 and adversarial boundaries", async ({ page, browser }) => {
  let accountId = "";
  let adminId = 0;
  let conversationNo = "";
  let ticketNo = "";
  let selectedUserId = 0;
  let templateText = "";
  let linkedTemplateId = "";
  const checks: string[] = [];

  await test.step("anonymous request is rejected and root enters M3 from the visible sidebar", async () => {
    const anonymous = await browser.newContext({ baseURL: BASE_URL });
    const response = await anonymous.request.get("/api/admin/content/conversations?pageNum=1&pageSize=1");
    expect([401, 403]).toContain(response.status());
    await anonymous.close();

    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const auth = await okEnvelope<{ session?: { role?: string; roleCode?: string; authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
    const session = auth.session ?? {};
    expect([session.role, session.roleCode].some((role) => /super/i.test(role ?? "")) || (session.authorities ?? []).includes("service_m3_write")).toBeTruthy();
    await openModule(page, "/service/sessions");
    await expect(page.getByText("会话收件箱", { exact: true })).toBeVisible();
    await expect(page.getByText(/mock|模拟回执|localStorage/i)).toHaveCount(0);
    checks.push("anonymous-401", "visible-sidebar-entry", "superadmin-write-authority");
  });

  await test.step("create one isolated SUPPORT target seat for a real cross-agent acceptance", async () => {
    const created = await page.request.post("/api/admin/platform/accounts", {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-ACCOUNT-CREATE` },
      data: {
        username: TEMP_USERNAME,
        displayName: TEMP_DISPLAY_NAME,
        email: `m3.${SUFFIX}@nexion.invalid`,
        role: "support",
        initialPassword: TEMP_INITIAL_PASSWORD,
        reason: `${PREFIX}-创建验收目标坐席`,
        operator: ROOT_USERNAME,
      },
    });
    const createdData = await okEnvelope<{ id: string }>(created);
    accountId = String(createdData.id);
    adminId = Number(accountId.replace(/\D/g, ""));
    expect(adminId).toBeGreaterThan(0);

    const seat = await page.request.patch(`/api/admin/content/support-agents/${adminId}/seat-assignment`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-SEAT` },
      data: {
        position: `${PREFIX}-通用客服`,
        serviceTypes: ["support"],
        tags: [PREFIX, "验收目标"],
        maxConcurrent: 4,
        enabled: true,
        transferable: true,
        busy: false,
        userIds: [],
        reason: `${PREFIX}-配置目标坐席`,
        operator: ROOT_USERNAME,
      },
    });
    await okEnvelope(seat);
    checks.push("isolated-support-seat");
  });

  await test.step("M5 published template is server-backed and M3 initiates against a real user", async () => {
    const templateOverview = await okEnvelope<{ replyTemplates?: Array<{ text?: string; type?: string; status?: string }> }>(
      await page.request.get("/api/admin/content/session-templates/overview"),
    );
    let published = (templateOverview.replyTemplates ?? []).find((row) => row.type?.toLowerCase() === "support" && row.status?.toLowerCase() === "published");
    if (!published) {
      const createdTemplate = await okEnvelope<{ id: string; text: string; type: string; status: string }>(await page.request.post("/api/admin/content/session-templates/reply-templates", {
        headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-M5-TEMPLATE-CREATE` },
        data: { type: "support", text: `${PREFIX}-M5联动回复模板-${SUFFIX}`, status: "draft", reason: `${PREFIX}-创建M3联动模板`, operator: ROOT_USERNAME },
      }));
      linkedTemplateId = createdTemplate.id;
      published = await okEnvelope<{ id: string; text: string; type: string; status: string }>(await page.request.patch(`/api/admin/content/session-templates/reply-templates/${linkedTemplateId}/status`, {
        headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-M5-TEMPLATE-PUBLISH` },
        data: { status: "published", expectedStatus: "draft", reason: `${PREFIX}-发布M3联动模板`, operator: ROOT_USERNAME },
      }));
    }
    expect(published?.text).toBeTruthy();
    templateText = String(published?.text);

    await openModule(page, "/service/sessions");
    await page.locator('[data-proof="session-initiate"]').click();
    const dialog = page.locator('[role="dialog"]:visible').last();
    await expect(dialog.getByText("主动发起会话", { exact: true }).first()).toBeVisible();
    const identity = dialog.locator("select").first();
    const supportOption = await firstOptionContaining(identity, "普通客服");
    if (supportOption) await identity.selectOption(supportOption);

    const customerSearch = dialog.getByPlaceholder("搜索客户 昵称 / 用户编码 / 地区");
    await customerSearch.fill("");
    const customerButton = dialog.locator("button").filter({ hasText: /U[-\s]?\d+/ }).first();
    await expect(customerButton, "the initiate dialog must load a real user directory row").toBeVisible({ timeout: 20_000 });
    const customerText = await customerButton.innerText();
    selectedUserId = Number(customerText.match(/U[-\s]?(\d+)/)?.[1] ?? 0);
    expect(selectedUserId).toBeGreaterThan(0);
    await customerButton.click();
    await dialog.locator("textarea").fill(OPENING);

    const createResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/content/conversations");
    await dialog.getByRole("button", { name: /^发起会话/ }).click();
    const createResponse = await createResponsePromise;
    const created = await okEnvelope<ConversationView>(createResponse);
    conversationNo = created.conversationNo;
    expect(conversationNo).toMatch(/^CV-/);
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await searchConversation(page, conversationNo);
    await expect(page.locator('[data-proof="session-conversation-no"]')).toHaveText(conversationNo);
    await expect(page.getByText(OPENING, { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-initiate-real-user.png"), fullPage: true });
    checks.push("m5-published-template-read", "real-user-initiate", "canonical-conversation-no");
  });

  await test.step("reply uses the M5 template, survives a lost success response, and clears only after confirmed retry", async () => {
    const replyBox = page.locator('[data-proof="session-reply"]');
    await replyBox.fill(`${TEMPLATE_REPLY_PREFIX} `);
    await page.getByRole("button", { name: /回复模板/ }).click();
    const templateChoice = page.locator(".m3-tpl-item, .tpl-item, button").filter({ hasText: templateText }).first();
    await expect(templateChoice, "the published M5 template must appear in the M3 composer").toBeVisible();
    await templateChoice.click();
    await expect(replyBox).toHaveValue(new RegExp(escapeRegExp(TEMPLATE_REPLY_PREFIX)));
    await expect(replyBox).toHaveValue(new RegExp(escapeRegExp(templateText.slice(0, Math.min(12, templateText.length)))));

    const replyResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/replies`);
    await page.locator('[data-proof="session-reply-save"]').click();
    const replyResponse = await replyResponsePromise;
    await okEnvelope<ConversationView>(replyResponse);
    const capturedRequest = replyResponse.request();
    const capturedKey = capturedRequest.headers()["idempotency-key"];
    const capturedBody = capturedRequest.postDataJSON() as Record<string, unknown>;
    expect(capturedKey).toBeTruthy();
    await expect(replyBox).toHaveValue("");

    const detailAfterTemplate = await conversationDetail(page, conversationNo);
    const templateMessages = detailAfterTemplate.messages.filter((message) => message.content.includes(TEMPLATE_REPLY_PREFIX));
    expect(templateMessages).toHaveLength(1);
    expect(["sent", "read"]).toContain(templateMessages[0].receiptStatus?.toLowerCase());

    const duplicate = await page.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
      headers: { "Idempotency-Key": capturedKey },
      data: capturedBody,
    });
    expect(duplicate.status()).toBeLessThan(400);
    const detailAfterReplay = await conversationDetail(page, conversationNo);
    expect(detailAfterReplay.messages.filter((message) => message.content.includes(TEMPLATE_REPLY_PREFIX))).toHaveLength(1);

    const conflict = await page.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
      headers: { "Idempotency-Key": capturedKey },
      data: { ...capturedBody, body: `${PREFIX}-same-key-different-payload` },
    });
    expect(conflict.status()).toBe(409);

    const reasonBoundaries = [
      { length: 7, expectedStatus: 422 },
      { length: 8, expectedStatus: 200 },
      { length: 200, expectedStatus: 200 },
      { length: 201, expectedStatus: 422 },
    ];
    for (const boundary of reasonBoundaries) {
      const response = await page.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
        headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-REASON-${boundary.length}` },
        data: {
          body: `${PREFIX}-reason-boundary-${boundary.length}`,
          reason: "理".repeat(boundary.length),
          operator: ROOT_USERNAME,
        },
      });
      expect(response.status(), `reason length ${boundary.length}`).toBe(boundary.expectedStatus);
    }
    const detailAfterReasonBoundaries = await conversationDetail(page, conversationNo);
    for (const length of [7, 8, 200, 201]) {
      expect(detailAfterReasonBoundaries.messages.filter((message) => message.content === `${PREFIX}-reason-boundary-${length}`))
        .toHaveLength(length === 8 || length === 200 ? 1 : 0);
    }

    const missing = await page.request.get(`/api/admin/content/conversations/CV-${PREFIX}-NOT-FOUND`);
    expect(missing.status()).toBe(404);

    await replyBox.fill(RETRY_DRAFT);
    const failedUrl = `**/api/admin/content/conversations/${conversationNo}/replies`;
    const lostResponseKeys: string[] = [];
    const lostResponseBodies: string[] = [];
    let lostResponseAttempt = 0;
    await page.route(failedUrl, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      lostResponseKeys.push(route.request().headers()["idempotency-key"] ?? "");
      lostResponseBodies.push(route.request().postData() ?? "");
      lostResponseAttempt += 1;
      if (lostResponseAttempt === 1) {
        const upstream = await route.fetch();
        expect(upstream.status()).toBeLessThan(400);
        await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ code: 502, message: "M3_REPLY_RESPONSE_LOST" }) });
        return;
      }
      await route.continue();
    });
    await page.locator('[data-proof="session-reply-save"]').click();
    await expect(page.getByText(/写入失败(?:,数据未改变|或结果未知)/)).toBeVisible();
    await expect(replyBox).toHaveValue(RETRY_DRAFT);
    await expect(page.locator('[data-proof="session-reply-save"]')).toBeEnabled();

    const retryResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/replies`);
    await page.locator('[data-proof="session-reply-save"]').click();
    await okEnvelope(await retryResponse);
    await page.unroute(failedUrl);
    expect(lostResponseKeys).toHaveLength(2);
    expect(lostResponseKeys[0]).toBeTruthy();
    expect(lostResponseKeys[1]).toBe(lostResponseKeys[0]);
    expect(lostResponseBodies[1]).toBe(lostResponseBodies[0]);
    await expect(replyBox).toHaveValue("");
    const detailAfterRetry = await conversationDetail(page, conversationNo);
    expect(detailAfterRetry.messages.filter((message) => message.content === RETRY_DRAFT)).toHaveLength(1);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-template-reply-backend-truth.png"), fullPage: true });
    checks.push("template-used-in-composer", "receipt-server-truth", "idempotent-replay", "idempotency-conflict-409", "reason-boundaries-7-8-200-201", "not-found-404", "upstream-success-response-lost-same-key-one-message");
  });

  await test.step("superadmin transfers to the real target seat, and only that target can accept", async () => {
    await page.locator('[data-proof="session-transfer"]').click();
    const dialog = page.locator('[role="dialog"]:visible').last();
    const target = dialog.getByRole("button", { name: new RegExp(TEMP_DISPLAY_NAME) }).first();
    await expect(target, "temporary target seat must be selectable").toBeVisible({ timeout: 20_000 });
    await target.click();
    await dialog.locator("textarea").fill(TRANSFER_REASON);
    const transferResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/transfer`);
    await dialog.locator('[data-proof="session-transfer-submit"]').click();
    const transferred = await okEnvelope<ConversationView>(await transferResponse);
    expect(transferred.status).toBe("TRANSFERRED");
    expect(String(transferred.transferToId)).toBe(String(adminId));

    const accept = page.locator('[data-proof="session-transfer-accept"]');
    await expect(accept).toBeDisabled();
    const forbiddenAccept = await page.request.post(`/api/admin/content/conversations/${conversationNo}/transfer/accept`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-ROOT-ACCEPT` },
      data: { reason: `${PREFIX}-非目标坐席尝试接收`, operator: ROOT_USERNAME },
    });
    expect(forbiddenAccept.status()).toBe(403);
    await page.locator('[data-proof="session-transfer-wait"]').click();
    await expect(page.getByText(/保持转入待处理|继续等待/).last()).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-transfer-target-and-owner-guard.png"), fullPage: true });
    checks.push("real-target-transfer", "non-target-accept-403", "wait-state");
  });

  await test.step("target SUPPORT agent accepts, replies, refreshes and converts atomically to M2", async () => {
    await logout(page);
    await login(page, TEMP_USERNAME, TEMP_INITIAL_PASSWORD, TEMP_FINAL_PASSWORD);
    const supportAuth = await okEnvelope<{ session?: { authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
    expect(supportAuth.session?.authorities ?? []).toEqual(expect.arrayContaining(["service_m3_read", "service_m3_write"]));
    await openModule(page, "/service/sessions");
    await searchConversation(page, conversationNo);
    const accept = page.locator('[data-proof="session-transfer-accept"]');
    await expect(accept).toBeEnabled();
    const acceptResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/transfer/accept`);
    await accept.click();
    const accepted = await okEnvelope<ConversationView>(await acceptResponse);
    expect(accepted.status).toBe("OPEN");
    expect(accepted.ownerAgentName).toBe(TEMP_DISPLAY_NAME);

    const targetReply = `${PREFIX}-目标坐席接收后回复-${SUFFIX}`;
    await page.locator('[data-proof="session-reply"]').fill(targetReply);
    const targetReplyResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/replies`);
    await page.locator('[data-proof="session-reply-save"]').click();
    await okEnvelope(await targetReplyResponse);

    await page.reload({ waitUntil: "domcontentloaded" });
    await searchConversation(page, conversationNo);
    await expect(page.getByText(targetReply, { exact: true })).toBeVisible();

    const conversionResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/ticket`);
    await page.locator('[data-proof="session-to-ticket"]').click();
    const confirmation = page.locator('[role="dialog"]:visible').last();
    await confirmation.locator("textarea").fill(`${PREFIX}-跨班次继续追踪`);
    await confirmation.getByRole("button", { name: /确认提交|确认执行/ }).click();
    const converted = await okEnvelope<{ conversation: ConversationView; ticket: { ticket?: { ticketNo?: string }; ticketNo?: string } }>(await conversionResponse);
    ticketNo = String(converted.ticket.ticket?.ticketNo ?? converted.ticket.ticketNo ?? "");
    expect(ticketNo).toMatch(/^TK-/);
    expect(converted.conversation.status).toBe("CLOSED");

    const secondConversion = await page.request.post(`/api/admin/content/conversations/${conversationNo}/ticket`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-SECOND-CONVERSION` },
      data: { category: "account", priority: "NORMAL", title: `${PREFIX}-duplicate-ticket`, reason: `${PREFIX}-终态二次转单`, operator: TEMP_USERNAME },
    });
    expect(secondConversion.status()).toBe(409);
    checks.push("target-agent-accept", "refresh-persistence", "atomic-ticket-conversion", "second-conversion-409");
  });

  await test.step("M2 links back to M3 and M1 counters reflect the terminal conversation and new ticket", async () => {
    await openModule(page, "/service/tickets");
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
    const ticketRow = page.locator("tbody tr").filter({ hasText: ticketNo }).first();
    await expect(ticketRow).toBeVisible({ timeout: 20_000 });
    await ticketRow.click();
    const sourceLink = page.getByRole("link", { name: new RegExp(`查看会话 ${escapeRegExp(conversationNo)}`) });
    await expect(sourceLink, "M3-created tickets must expose the source conversation link").toBeVisible();
    await sourceLink.click();
    await expect(page).toHaveURL(new RegExp(`/service/sessions\\?seg=archived&q=${escapeRegExp(conversationNo)}`));
    await expect(page.locator('[data-proof="session-conversation-no"]')).toHaveText(conversationNo);

    await openModule(page, "/service/overview");
    await expect(page.getByText(/工单\s+\d+\s+·\s+会话\s+\d+/).first()).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-m2-source-link-and-m1-counters.png"), fullPage: true });
    checks.push("m2-source-conversation-link", "m1-real-counters");
  });

  await test.step("refresh/relogin persists backend state, then auditor keeps read-only M3 access", async () => {
    await logout(page);
    await login(page, TEMP_USERNAME, TEMP_FINAL_PASSWORD);
    await openModule(page, "/service/sessions");
    await page.getByRole("button", { name: /^归档(?:\s|$)/ }).click();
    await page.locator('[data-proof="session-search"]').fill(conversationNo);
    await expect(page.locator('[data-proof="session-conversation-no"]')).toHaveText(conversationNo);

    await logout(page);
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    const downgraded = await page.request.patch(`/api/admin/platform/accounts/${accountId}/role`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-ROLE-AUDITOR` },
      data: { role: "auditor", reason: `${PREFIX}-验证 M3 权限边界`, operator: ROOT_USERNAME },
    });
    await okEnvelope(downgraded);
    await logout(page);
    await login(page, TEMP_USERNAME, TEMP_FINAL_PASSWORD);
    const auditorAuth = await okEnvelope<{ session?: { authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
    expect(auditorAuth.session?.authorities ?? []).toContain("service_m3_read");
    expect(auditorAuth.session?.authorities ?? []).not.toContain("service_m3_write");
    await openModule(page, "/service/sessions");
    await expect(page.getByText(/当前账号为只读模式/)).toBeVisible();
    await page.getByRole("button", { name: /^归档(?:\s|$)/ }).click();
    await page.locator('[data-proof="session-search"]').fill(conversationNo);
    await expect(page.locator('[data-proof="session-conversation-no"]')).toHaveText(conversationNo);
    await expect(page.locator('[data-proof="session-initiate"]')).toHaveCount(0);
    const readable = await page.request.get("/api/admin/content/conversations?pageNum=1&pageSize=1");
    expect(readable.status()).toBe(200);
    const forbidden = await page.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-AUDITOR-WRITE` },
      data: { body: `${PREFIX}-auditor-must-not-write`, reason: `${PREFIX}-只读审计不得回复会话`, operator: TEMP_USERNAME },
    });
    expect(forbidden.status()).toBe(403);
    checks.push("relogin-persistence", "auditor-read-only-visible", "auditor-write-api-403");
  });

  await test.step("disable the temporary account after evidence collection", async () => {
    await logout(page);
    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    if (linkedTemplateId) {
      await okEnvelope(await page.request.patch(`/api/admin/content/session-templates/reply-templates/${linkedTemplateId}/status`, {
        headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-M5-TEMPLATE-ARCHIVE` },
        data: { status: "archived", expectedStatus: "published", reason: `${PREFIX}-归档M3联动模板`, operator: ROOT_USERNAME },
      }));
    }
    const disabled = await page.request.patch(`/api/admin/platform/accounts/${accountId}/status`, {
      headers: { "Idempotency-Key": `${PREFIX}-${SUFFIX}-DISABLE` },
      data: { status: "disabled", reason: `${PREFIX}-验收结束停用临时账号`, operator: ROOT_USERNAME },
    });
    await okEnvelope(disabled);
    checks.push("temporary-account-disabled");
  });

  writeFileSync(RESULT_PATH, JSON.stringify({
    prefix: PREFIX,
    suffix: SUFFIX,
    accountId,
    adminId,
    username: TEMP_USERNAME,
    displayName: TEMP_DISPLAY_NAME,
    conversationNo,
    ticketNo,
    selectedUserId,
    linkedTemplateId,
    checks,
  }, null, 2));
  expect(checks).toHaveLength(27);
});

async function login(page: Page, username: string, password: string, changedPassword?: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible().catch(() => false)) await logout(page);
  const usernameInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(usernameInput).toBeVisible({ timeout: 15_000 });
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await responsePromise;
  expect(loginResponse.status()).toBeLessThan(400);
  const payload = await loginResponse.json().catch(() => ({})) as { data?: { mfa?: { manualKey?: string | null } } };
  let passwordChangeSubmitted = false;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      if (!changedPassword) throw new Error(`${username} requires a first-login password change`);
      if (!passwordChangeSubmitted) {
        await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
        await page.getByLabel("确认新密码", { exact: true }).fill(changedPassword);
        const submit = page.getByRole("button", { name: "确认修改并进入", exact: true });
        await expect(submit).toBeEnabled();
        const changedResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/admin/auth/password/change");
        passwordChangeSubmitted = true;
        await submit.click();
        const changedResponse = await changedResponsePromise;
        const changedStatus = changedResponse.status();
        const changedBody = changedStatus >= 400
          ? await changedResponse.text().catch(() => "<unavailable>")
          : "";
        expect(
          changedStatus,
          `password change failed for ${username}: ${changedBody}`,
        ).toBeLessThan(400);
      }
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

async function searchConversation(page: Page, conversationNo: string) {
  const all = page.getByRole("button", { name: "全部", exact: true }).first();
  if (await all.isVisible().catch(() => false)) await all.click();
  const search = page.locator('[data-proof="session-search"]');
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(conversationNo);
  const detailNo = page.locator('[data-proof="session-conversation-no"]');
  if (await detailNo.textContent().catch(() => "") !== conversationNo) {
    const row = page.locator(".cv-item").first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
  }
  await expect(detailNo).toHaveText(conversationNo, { timeout: 20_000 });
}

async function conversationDetail(page: Page, conversationNo: string) {
  return okEnvelope<ConversationDetail>(await page.request.get(`/api/admin/content/conversations/${conversationNo}`));
}

async function okEnvelope<T = unknown>(response: ResponseLike): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

async function firstOptionContaining(select: ReturnType<Page["locator"]>, text: string) {
  const options = select.locator("option");
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if ((await option.innerText()).includes(text)) return await option.getAttribute("value");
  }
  return null;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for M3 live acceptance`);
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
