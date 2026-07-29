import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const PREFIX = process.env.M35_FIXTURE_PREFIX ?? `L2M-FINAL-M35-${Date.now()}`;
const EVIDENCE_DIR = path.resolve(process.env.M35_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/M-review-L/final/write/M35");
const A_FIXTURE_PATH = process.env.M35_CHECKER_FIXTURE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/A/permission-fixtures.json";
const RESULT_PATH = path.join(EVIDENCE_DIR, "runtime-result.json");
const PC_BUILD_ID = process.env.M35_PC_BUILD_ID ?? "zfPfSm8yHDpNEEN8zcqdN";
const PC_PID = Number(process.env.M35_PC_PID ?? "13288");
const BACKEND_JAR_SHA = process.env.M35_BACKEND_JAR_SHA
  ?? "F1DF14205D3FC6809376135735F1A7907D64271F2CDE121590DCA3FDE8B1A260";
const BACKEND_PID = Number(process.env.M35_BACKEND_PID ?? "21012");
const TEMPLATE_TEXT = `${PREFIX}-即时回复模板`;
const OPENING_TEXT = `${PREFIX}-真实用户主动会话`;
const LOST_REPLY_TEXT = `${PREFIX}-结果未知同键回复`;
const CONCURRENT_ROOT_TEXT = `${PREFIX}-双运营员-root`;
const CONCURRENT_CHECKER_TEXT = `${PREFIX}-双运营员-checker`;
const usedTotpSteps = new Map<string, number>();
const mfaSecrets = new Map<string, string>();

type ResponseLike = { status(): number; text(): Promise<string> };
type Envelope<T> = { code?: number; message?: string; data?: T };
type Overview = {
  advisorPolicy?: { delayMs: number; audience: string };
  replyTemplates?: Array<{ id: string; type: string; text: string; status: string }>;
};
type ConversationView = {
  conversationNo: string;
  status: string;
  version: number;
  archived?: boolean;
};
type ConversationDetail = {
  conversation: ConversationView;
  messages: Array<{ id: number; content: string; receiptStatus?: string }>;
};
type TicketView = { ticketNo: string; status: string; version: number; archived?: boolean };
type TicketDetail = { ticket: TicketView };
type CheckerFixture = {
  username: string;
  password: string;
  totpSecret: string;
};

test.describe.configure({ mode: "serial", timeout: 360_000 });

test.beforeAll(() => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("M3/M5 非 Owner 双运营员、幂等 CAS、跨域与精确终态闭环", async ({ page, browser }) => {
  const checkerFixture = loadCheckerFixture();
  mfaSecrets.set(checkerFixture.username, checkerFixture.totpSecret);
  let checkerContext: BrowserContext | null = null;
  let checkerPage: Page | null = null;
  let templateId = "";
  let i18nKey = "";
  let i18nVersion = "";
  let conversationNo = "";
  let ticketNo = "";
  let selectedUserId = 0;
  let rootReady = false;
  const checks: string[] = [];

  try {
    const anonymous = await browser.newContext({ baseURL: BASE_URL });
    expect([401, 403]).toContain((await anonymous.request.get("/api/admin/content/session-templates/overview")).status());
    expect([401, 403]).toContain((await anonymous.request.get("/api/admin/content/conversations?pageNum=1&pageSize=1")).status());
    await anonymous.close();

    await login(page, ROOT_USERNAME, ROOT_PASSWORD);
    rootReady = true;
    checkerContext = await browser.newContext({ baseURL: BASE_URL });
    checkerPage = await checkerContext.newPage();
    await login(checkerPage, checkerFixture.username, checkerFixture.password);
    const checkerSession = await okEnvelope<{ session?: { authorities?: string[] } }>(
      await checkerPage.request.get("/api/admin/auth/session"),
    );
    expect(checkerSession.session?.authorities ?? []).toEqual(expect.arrayContaining([
      "service_m3_write",
      "service_m5_write",
      "content_i6_write",
    ]));
    checks.push("anonymous-denied", "independent-checker-authorized");

    await test.step("M5 从可见侧栏创建模板，成功响应丢失后同键同载荷只创建一条", async () => {
      await openModule(page, "/service/scripts");
      await expect(page.getByText("会话类别", { exact: true })).toBeVisible();
      await expect(page.getByText("即时回复模板库", { exact: true })).toBeVisible();
      const overview = await getOverview(page);
      expect(overview.replyTemplates?.some((row) => row.text === TEMPLATE_TEXT)).toBeFalsy();

      await page.locator('[data-proof="session-tpl-new"]').click();
      const dialog = await operationDialog(page);
      await dialog.getByLabel("目标新值").fill(TEMPLATE_TEXT);
      await dialog.getByLabel(/操作理由/).fill(`${PREFIX}-创建模板并验证结果未知`);

      const capturedKeys: string[] = [];
      const capturedBodies: string[] = [];
      let attempt = 0;
      const routePattern = "**/api/admin/content/session-templates/reply-templates";
      await page.route(routePattern, async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        capturedKeys.push(route.request().headers()["idempotency-key"] ?? "");
        capturedBodies.push(route.request().postData() ?? "");
        attempt += 1;
        if (attempt === 1) {
          const upstream = await route.fetch();
          expect(upstream.status(), await upstream.text()).toBeLessThan(400);
          await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ code: 502, message: "M5_TEMPLATE_RESPONSE_LOST" }),
          });
          return;
        }
        await route.continue();
      });

      await dialog.getByRole("button", { name: "确认提交" }).click();
      await expect(page.getByText(/写入失败或结果未知/)).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("目标新值")).toHaveValue(TEMPLATE_TEXT);
      const retry = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname.endsWith("/session-templates/reply-templates"));
      await dialog.getByRole("button", { name: "确认提交" }).click();
      const created = await okEnvelope<{ id: string; status: string }>(await retry);
      templateId = created.id;
      expect(created.status).toBe("draft");
      await expect(dialog).toBeHidden();
      await page.unroute(routePattern);
      expect(capturedKeys).toHaveLength(2);
      expect(capturedKeys[0]).toBeTruthy();
      expect(capturedKeys[1]).toBe(capturedKeys[0]);
      expect(capturedBodies[1]).toBe(capturedBodies[0]);
      expect((await getOverview(page)).replyTemplates?.filter((row) => row.id === templateId)).toHaveLength(1);

      const conflict = await page.request.post("/api/admin/content/session-templates/reply-templates", {
        headers: { "Idempotency-Key": capturedKeys[0] },
        data: {
          ...(JSON.parse(capturedBodies[0]) as Record<string, unknown>),
          text: `${TEMPLATE_TEXT}-different`,
        },
      });
      expect(conflict.status()).toBe(409);
      checks.push("m5-visible-create", "m5-lost-response-same-key", "m5-one-row", "m5-same-key-different-payload-409");
    });

    await test.step("独立 checker 创建 I6 镜像，root 发布 M5 模板并完成双运营员 CAS", async () => {
      expect(checkerPage).not.toBeNull();
      const mirror = await publishI18nMirror(checkerPage!, checkerFixture.username, templateId, TEMPLATE_TEXT);
      i18nKey = mirror.messageKey;
      i18nVersion = mirror.version;

      await goToLastPage(cardByHeading(page, "即时回复模板库"));
      await page.locator(`[data-proof="session-tpl-publish-${templateId}"] button`).click();
      await submitDialog(page, `${PREFIX}-发布模板供 M3 使用`);
      expect(await findTemplateStatus(page, templateId)).toBe("published");

      const rootBaseline = await getOverview(page);
      const checkerBaseline = await getOverview(checkerPage!);
      const originalDelay = Number(rootBaseline.advisorPolicy?.delayMs ?? 0);
      expect(checkerBaseline.advisorPolicy?.delayMs).toBe(originalDelay);
      const nextDelay = originalDelay <= 59_800 ? originalDelay + 131 : originalDelay - 131;

      await page.locator('[data-proof="session-policy-delay"]').click();
      const delayDialog = await operationDialog(page);
      await delayDialog.getByLabel("目标新值").fill(String(nextDelay));
      await delayDialog.getByLabel(/操作理由/).fill(`${PREFIX}-root 修改策略供 checker 竞争`);
      await delayDialog.getByRole("button", { name: "确认提交" }).click();
      await expect(delayDialog).toBeHidden();
      expect((await getOverview(page)).advisorPolicy?.delayMs).toBe(nextDelay);

      const stale = await checkerPage!.request.patch("/api/admin/content/session-templates/advisor-policy/delayMs", {
        headers: { "Idempotency-Key": `${PREFIX}-checker-stale-delay` },
        data: {
          value: String(nextDelay + 1),
          expectedValue: String(originalDelay),
          reason: `${PREFIX}-checker 陈旧页面覆盖必须失败`,
          operator: checkerFixture.username,
        },
      });
      expect(stale.status()).toBe(409);

      await okEnvelope(await checkerPage!.request.patch("/api/admin/content/session-templates/advisor-policy/delayMs", {
        headers: { "Idempotency-Key": `${PREFIX}-checker-restore-delay` },
        data: {
          value: String(originalDelay),
          expectedValue: String(nextDelay),
          reason: `${PREFIX}-checker 使用最新值精确恢复`,
          operator: checkerFixture.username,
        },
      }));
      expect((await getOverview(page)).advisorPolicy?.delayMs).toBe(originalDelay);
      checks.push("m5-i6-publish-gate", "m5-published", "m5-two-operator-stale-cas-409", "m5-policy-restored");
    });

    await test.step("M3 从可见侧栏使用 M5 模板发起真实用户会话", async () => {
      await openModule(page, "/service/sessions");
      await expect(page.getByText("会话收件箱", { exact: true })).toBeVisible();
      await page.locator('[data-proof="session-initiate"]').click();
      const dialog = page.locator('[role="dialog"]:visible').last();
      await expect(dialog.getByText("主动发起会话", { exact: true }).first()).toBeVisible();
      const identity = dialog.locator("select").first();
      const supportOption = await firstOptionContaining(identity, "普通客服");
      if (supportOption) await identity.selectOption(supportOption);
      await dialog.getByPlaceholder("搜索客户 昵称 / 用户编码 / 地区").fill("");
      const customer = dialog.locator("button").filter({ hasText: /U[-\s]?\d+/ }).first();
      await expect(customer).toBeVisible({ timeout: 20_000 });
      const customerText = await customer.innerText();
      selectedUserId = Number(customerText.match(/U[-\s]?(\d+)/)?.[1] ?? 0);
      expect(selectedUserId).toBeGreaterThan(0);
      await customer.click();
      await dialog.locator("textarea").fill(OPENING_TEXT);
      const response = page.waitForResponse((item) => item.request().method() === "POST"
        && new URL(item.url()).pathname === "/api/admin/content/conversations");
      await dialog.getByRole("button", { name: /^发起会话/ }).click();
      const created = await okEnvelope<ConversationView>(await response);
      conversationNo = created.conversationNo;
      expect(conversationNo).toMatch(/^CV-/);
      await expect(dialog).toBeHidden();

      await searchConversation(page, conversationNo);
      await page.getByRole("button", { name: /回复模板/ }).click();
      const templateChoice = page.locator(".m3-tpl-item, .tpl-item, .sku-pop-item, button")
        .filter({ hasText: TEMPLATE_TEXT }).first();
      await expect(templateChoice).toBeVisible();
      await templateChoice.click();
      await expect(page.locator('[data-proof="session-reply"]')).toHaveValue(new RegExp(escapeRegExp(TEMPLATE_TEXT)));
      await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-m3-consumes-m5-template.png"), fullPage: true });
      checks.push("m3-visible-initiate", "m3-real-user", "m3-consumes-m5-template");
    });

    await test.step("M3 成功响应丢失同键重试、异载荷冲突和双运营员 CAS", async () => {
      const replyBox = page.locator('[data-proof="session-reply"]');
      await replyBox.fill(LOST_REPLY_TEXT);
      const routePattern = `**/api/admin/content/conversations/${conversationNo}/replies`;
      const lostKeys: string[] = [];
      const lostBodies: string[] = [];
      let attempt = 0;
      await page.route(routePattern, async (route) => {
        if (route.request().method() !== "POST") {
          await route.continue();
          return;
        }
        lostKeys.push(route.request().headers()["idempotency-key"] ?? "");
        lostBodies.push(route.request().postData() ?? "");
        attempt += 1;
        if (attempt === 1) {
          const upstream = await route.fetch();
          expect(upstream.status(), await upstream.text()).toBeLessThan(400);
          await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ code: 502, message: "M3_REPLY_RESPONSE_LOST" }),
          });
          return;
        }
        await route.continue();
      });
      await page.locator('[data-proof="session-reply-save"]').click();
      await expect(page.getByText(/写入失败(?:,数据未改变|或结果未知)/)).toBeVisible();
      await expect(replyBox).toHaveValue(LOST_REPLY_TEXT);
      const retry = page.waitForResponse((item) => item.request().method() === "POST"
        && new URL(item.url()).pathname === `/api/admin/content/conversations/${conversationNo}/replies`);
      await page.locator('[data-proof="session-reply-save"]').click();
      await okEnvelope(await retry);
      await page.unroute(routePattern);
      expect(lostKeys).toHaveLength(2);
      expect(lostKeys[1]).toBe(lostKeys[0]);
      expect(lostBodies[1]).toBe(lostBodies[0]);
      expect((await conversationDetail(page, conversationNo)).messages.filter((row) => row.content === LOST_REPLY_TEXT)).toHaveLength(1);

      const different = await page.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
        headers: { "Idempotency-Key": lostKeys[0] },
        data: { ...(JSON.parse(lostBodies[0]) as Record<string, unknown>), body: `${LOST_REPLY_TEXT}-different` },
      });
      expect(different.status()).toBe(409);

      const latest = await conversationDetail(page, conversationNo);
      const rootKey = `${PREFIX}-root-concurrent`;
      const checkerKey = `${PREFIX}-checker-concurrent`;
      const [rootWrite, checkerWrite] = await Promise.all([
        page.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
          headers: { "Idempotency-Key": rootKey },
          data: {
            body: CONCURRENT_ROOT_TEXT,
            expectedStatus: latest.conversation.status,
            expectedVersion: latest.conversation.version,
            reason: `${PREFIX}-root 双运营员竞争写`,
            operator: ROOT_USERNAME,
          },
        }),
        checkerPage!.request.post(`/api/admin/content/conversations/${conversationNo}/replies`, {
          headers: { "Idempotency-Key": checkerKey },
          data: {
            body: CONCURRENT_CHECKER_TEXT,
            expectedStatus: latest.conversation.status,
            expectedVersion: latest.conversation.version,
            reason: `${PREFIX}-checker 双运营员竞争写`,
            operator: checkerFixture.username,
          },
        }),
      ]);
      expect([rootWrite.status(), checkerWrite.status()].sort()).toEqual([200, 409]);
      const afterRace = await conversationDetail(page, conversationNo);
      const raceCount = afterRace.messages.filter((row) =>
        row.content === CONCURRENT_ROOT_TEXT || row.content === CONCURRENT_CHECKER_TEXT).length;
      expect(raceCount).toBe(1);
      expect((await page.request.get("/api/admin/content/conversations/CV-L2M-NOT-FOUND")).status()).toBe(404);
      checks.push("m3-lost-response-same-key", "m3-one-message", "m3-same-key-different-payload-409", "m3-two-operator-one-winner-cas", "m3-404");
    });

    await test.step("M5 归档终态从 M3 选择器消失，M3 原子转 M2 并核对 M1/A2/A4", async () => {
      await openModule(page, "/service/scripts");
      await goToLastPage(cardByHeading(page, "即时回复模板库"));
      await page.locator(`[data-proof="session-tpl-publish-${templateId}"] button`).click();
      await submitDialog(page, `${PREFIX}-归档模板并验证终态`);
      expect(await findTemplateStatus(page, templateId)).toBe("archived");
      await archiveI18nMirror(checkerPage!, checkerFixture.username, i18nKey, i18nVersion);

      const revive = await page.request.patch(`/api/admin/content/session-templates/reply-templates/${templateId}/status`, {
        headers: { "Idempotency-Key": `${PREFIX}-template-revive` },
        data: {
          status: "published",
          expectedStatus: "archived",
          reason: `${PREFIX}-归档终态不得复活`,
          operator: ROOT_USERNAME,
        },
      });
      expect(revive.status()).toBe(409);

      await openModule(page, "/service/sessions");
      await searchConversation(page, conversationNo);
      await page.getByRole("button", { name: /回复模板/ }).click();
      await expect(page.locator(".m3-tpl-item, .tpl-item, .sku-pop-item, button")
        .filter({ hasText: TEMPLATE_TEXT })).toHaveCount(0);
      await page.keyboard.press("Escape");

      const convertResponse = page.waitForResponse((item) => item.request().method() === "POST"
        && new URL(item.url()).pathname === `/api/admin/content/conversations/${conversationNo}/ticket`);
      await page.locator('[data-proof="session-to-ticket"]').click();
      const confirmation = page.locator('[role="dialog"]:visible').last();
      await confirmation.locator("textarea").fill(`${PREFIX}-跨班次继续追踪`);
      await confirmation.getByRole("button", { name: /确认提交|确认执行/ }).click();
      const converted = await okEnvelope<{
        conversation: ConversationView;
        ticket: { ticket?: { ticketNo?: string }; ticketNo?: string };
      }>(await convertResponse);
      ticketNo = String(converted.ticket.ticket?.ticketNo ?? converted.ticket.ticketNo ?? "");
      expect(ticketNo).toMatch(/^TK-/);
      expect(converted.conversation.status).toBe("CLOSED");

      await openModule(page, "/service/tickets");
      await page.getByRole("button", { name: "全部", exact: true }).click();
      await page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
      const ticketRow = page.locator("tbody tr").filter({ hasText: ticketNo }).first();
      await expect(ticketRow).toBeVisible();
      await ticketRow.click();
      await expect(page.getByRole("link", { name: new RegExp(`查看会话 ${escapeRegExp(conversationNo)}`) })).toBeVisible();

      await openModule(page, "/service/overview");
      await expect(page.getByText(/工单\s+\d+\s+·\s+会话\s+\d+/).first()).toBeVisible();
      expect((await page.request.get(`/api/admin/platform/audit/logs?keyword=${encodeURIComponent(conversationNo)}&limit=200`)).status()).toBe(200);
      expect((await page.request.get(`/api/admin/platform/audit/logs?keyword=${encodeURIComponent(ticketNo)}&limit=200`)).status()).toBe(200);
      expect((await page.request.get("/api/admin/platform/events/overview")).status()).toBe(200);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-m3-m2-m1-audit-event-cross-domain.png"), fullPage: true });
      checks.push("m5-archive-terminal", "m5-removed-from-m3", "m3-to-m2-atomic", "m2-source-link", "m1-counters", "a2-audit", "a4-events");
    });

    await test.step("刷新、退出重登后读取终态，再以 CAS 归档并交给精确 DB 清理", async () => {
      await logout(page);
      rootReady = false;
      await login(page, ROOT_USERNAME, ROOT_PASSWORD);
      rootReady = true;
      await openModule(page, "/service/tickets");
      await expect(page.getByRole("heading", { name: "工单台", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "全部", exact: true }).click();
      await page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
      await expect(page.locator("tbody tr").filter({ hasText: ticketNo }).first()).toBeVisible();

      const conversation = await conversationDetail(page, conversationNo);
      if (!conversation.conversation.archived) {
        await okEnvelope(await page.request.patch(`/api/admin/content/conversations/${conversationNo}/archive`, {
          headers: { "Idempotency-Key": `${PREFIX}-conversation-archive` },
          data: {
            archived: true,
            expectedStatus: conversation.conversation.status,
            expectedVersion: conversation.conversation.version,
            reason: `${PREFIX}-验收终态归档会话`,
            operator: ROOT_USERNAME,
          },
        }));
      }

      let ticket = await getTicket(page, ticketNo);
      if (ticket.ticket.status !== "RESOLVED") {
        ticket = await mutateTicket(page, ticketNo, "status", {
          status: "RESOLVED",
          expectedStatus: ticket.ticket.status,
          expectedVersion: ticket.ticket.version,
          reason: `${PREFIX}-验收终态解决工单`,
          operator: ROOT_USERNAME,
        });
      }
      if (!ticket.ticket.archived) {
        ticket = await mutateTicket(page, ticketNo, "archive", {
          archived: true,
          expectedStatus: ticket.ticket.status,
          expectedVersion: ticket.ticket.version,
          reason: `${PREFIX}-验收终态归档工单`,
          operator: ROOT_USERNAME,
        });
      }
      expect(ticket.ticket.archived).toBe(true);
      checks.push("refresh-relogin", "conversation-terminal-archive", "ticket-terminal-archive");
    });

    writeFileSync(RESULT_PATH, JSON.stringify({
      prefix: PREFIX,
      candidate: {
        pcBuildId: PC_BUILD_ID,
        pcPid: PC_PID,
        backendJarSha: BACKEND_JAR_SHA,
        backendPid: BACKEND_PID,
      },
      checkerAccountId: "99366",
      templateId,
      i18nKey,
      conversationNo,
      ticketNo,
      selectedUserId,
      checks,
      cleanup: "terminal fixtures; exact DB and idempotency cleanup follows",
    }, null, 2));
    expect(checks.length).toBeGreaterThanOrEqual(25);
  } finally {
    if (checkerContext) await checkerContext.close().catch(() => undefined);
    if (rootReady) await logout(page).catch(() => undefined);
  }
});

function loadCheckerFixture(): CheckerFixture {
  const parsed = JSON.parse(readFileSync(A_FIXTURE_PATH, "utf8")) as {
    accounts?: { d_checker?: CheckerFixture };
  };
  const checker = parsed.accounts?.d_checker;
  if (!checker?.username || !checker.password || !checker.totpSecret) {
    throw new Error("A d_checker fixture is unavailable");
  }
  return checker;
}

async function publishI18nMirror(page: Page, operator: string, contentId: string, canonicalZh: string) {
  const messageKey = `conversation.template.${contentId.toLowerCase()}`;
  const body = {
    zh: canonicalZh,
    en: `Acceptance template ${contentId}`,
    vi: `Nghiem thu template ${contentId}`,
    reason: `${PREFIX}-checker 创建中英越镜像`,
    operator,
  };
  const draft = await okEnvelope<{ version: string }>(await page.request.patch(
    `/api/admin/content/i18n-learning/messages/${encodeURIComponent(messageKey)}/draft`,
    {
      headers: { "Idempotency-Key": `${PREFIX}-i18n-draft` },
      data: body,
    },
  ));
  const published = await okEnvelope<{ version: string }>(await page.request.post(
    `/api/admin/content/i18n-learning/messages/${encodeURIComponent(messageKey)}/publish`,
    {
      headers: { "Idempotency-Key": `${PREFIX}-i18n-publish` },
      data: { ...body, expectedVersion: draft.version },
    },
  ));
  return { messageKey, version: published.version };
}

async function archiveI18nMirror(page: Page, operator: string, messageKey: string, expectedVersion: string) {
  await okEnvelope(await page.request.delete(
    `/api/admin/content/i18n-learning/messages/${encodeURIComponent(messageKey)}`,
    {
      headers: { "Idempotency-Key": `${PREFIX}-i18n-archive` },
      data: {
        expectedVersion,
        reason: `${PREFIX}-checker 归档多语镜像`,
        operator,
      },
    },
  ));
}

async function getOverview(page: Page) {
  return okEnvelope<Overview>(await page.request.get("/api/admin/content/session-templates/overview"));
}

async function findTemplateStatus(page: Page, templateId: string) {
  const data = await okEnvelope<{ records?: Array<{ id: string; status: string }> }>(
    await page.request.get(`/api/admin/content/session-templates/reply-templates?pageNum=1&pageSize=100&keyword=${encodeURIComponent(templateId)}`),
  );
  const row = (data.records ?? []).find((item) => item.id === templateId);
  expect(row).toBeTruthy();
  return row!.status;
}

async function conversationDetail(page: Page, conversationNo: string) {
  return okEnvelope<ConversationDetail>(
    await page.request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
  );
}

async function getTicket(page: Page, ticketNo: string) {
  return okEnvelope<TicketDetail>(
    await page.request.get(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}`),
  );
}

async function mutateTicket(
  page: Page,
  ticketNo: string,
  action: "status" | "archive",
  data: Record<string, unknown>,
) {
  return okEnvelope<TicketDetail>(await page.request.patch(
    `/api/admin/content/tickets/${encodeURIComponent(ticketNo)}/${action}`,
    {
      headers: { "Idempotency-Key": `${PREFIX}-ticket-${action}` },
      data,
    },
  ));
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
  }
  throw new Error("M5 pager did not reach the last page");
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

async function firstOptionContaining(select: Locator, text: string) {
  const options = select.locator("option");
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    if ((await option.innerText()).includes(text)) return await option.getAttribute("value");
  }
  return null;
}

async function login(page: Page, username: string, password: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible().catch(() => false)) await logout(page);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await responsePromise;
  expect(loginResponse.status()).toBeLessThan(400);
  const payload = await loginResponse.json().catch(() => ({})) as {
    data?: { mfa?: { manualKey?: string | null } };
  };

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      const visible = (await page.locator("code").first().textContent().catch(() => ""))?.trim() ?? "";
      const secret = payload.data?.mfa?.manualKey ?? (visible || mfaSecrets.get(username) || "");
      expect(secret, `MFA secret unavailable for ${username}`).not.toBe("");
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
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
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

async function okEnvelope<T = unknown>(response: ResponseLike | APIResponse): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

async function freshTotp(username: string, secret: string) {
  const previousStep = usedTotpSteps.get(username);
  let currentStep = Math.floor(Date.now() / 30_000);
  if (previousStep !== undefined && currentStep <= previousStep) {
    await new Promise((resolve) => setTimeout(resolve, ((previousStep + 1) * 30_000) - Date.now() + 750));
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
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
