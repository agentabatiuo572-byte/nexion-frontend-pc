import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

type Account = {
  accountId?: string;
  id?: string;
  username: string;
  password: string;
  totpSecret: string;
  createdForRun?: boolean;
};

type Manifest = {
  runId?: string;
  createdForRun?: boolean;
  account?: Account;
  maker?: Account;
  checker?: Account;
  accounts?: { maker?: Account; checker?: Account; m_checker?: Account };
  finalAccounts?: { m_checker?: Account };
};

type Session = {
  username?: string;
  role?: string;
  roleCode?: string;
  adminId?: number;
  authorities?: string[];
  effectiveMenus?: string[];
};

type Envelope<T> = { code?: number; message?: string; data: T };
type Conversation = {
  conversationNo: string;
  status: string;
  version: number;
  ownerAgentId?: string;
  ownerAgentName?: string;
  transferToId?: string;
  archived?: boolean;
  lastMessage?: string;
};
type ConversationDetail = { conversation: Conversation; messages?: Array<{ content?: string }> };
type Ticket = { ticketNo: string; status: string; version: number; archived?: boolean; title?: string };
type TicketDetail = { ticket: Ticket };
type SupportAgent = {
  id?: string;
  adminId?: number;
  name?: string;
  serviceTypes?: string[];
  enabled?: boolean;
  transferable?: boolean;
  busy?: boolean;
};
type SupportOverview = { agents?: SupportAgent[] };

const RUN_ID = process.env.M_FINAL2_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const BUILD_ID = process.env.M_FINAL2_EXPECTED_PC_BUILD_ID ?? "";
const JAR_SHA256 = (process.env.M_FINAL2_EXPECTED_BACKEND_JAR_SHA256 ?? "").toUpperCase();
const PC_PID = Number(process.env.M_FINAL2_PC_PID ?? 0);
const BACKEND_PID = Number(process.env.M_FINAL2_BACKEND_PID ?? 0);
const MAKER_PATH = restrictedPath("M3_FINAL3_SUPPORT_OWNER_PATH");
const CHECKER_PATH = restrictedPath("M3_FINAL3_SUPPORT_RECEIVER_PATH");
const EVIDENCE_DIR = restrictedPath("M3_FINAL3_EVIDENCE_DIR");
const PREFIX = process.env.M3_FINAL3_PREFIX ?? `M3-FINAL3-${Date.now()}`;
const makerManifest = JSON.parse(readFileSync(MAKER_PATH, "utf8")) as Manifest;
const checkerManifest = JSON.parse(readFileSync(CHECKER_PATH, "utf8")) as Manifest;
const maker = makerManifest.account ?? makerManifest.maker ?? makerManifest.accounts?.maker;
const checker = checkerManifest.account
  ?? checkerManifest.checker
  ?? checkerManifest.accounts?.checker
  ?? checkerManifest.accounts?.m_checker
  ?? checkerManifest.finalAccounts?.m_checker;

const REQUIRED_SUPPORT_AUTHORITIES = [
  "service_m1_read",
  "service_m2_read",
  "service_m2_write",
  "service_m3_read",
  "service_m3_write",
];
const REQUIRED_SUPPORT_MENUS = ["M1", "M2", "M3"];
const usedTotpCounters = new Map<string, number>();

test.describe.configure({ mode: "serial", timeout: 420_000 });

test.beforeAll(() => {
  expect(new URL(BASE_URL).port).toBe("3002");
  expect(process.env.M_FINAL2_MFA_BYPASS).toBe("false");
  const controlToken = process.env.M_WRITE_CONTROL_TOKEN?.trim();
  expect(controlToken, "M_WRITE_CONTROL_TOKEN must contain the main-agent-issued R2 token").toBeTruthy();
  expect(process.env.M_WRITE_TOKEN?.trim()).toBe(controlToken);
  expect(process.env.M234_OBJECT_LOCK).toBe(`${RUN_ID}:M234`);
  expect(PC_PID).toBeGreaterThan(0);
  expect(BACKEND_PID).toBeGreaterThan(0);
  expect(() => process.kill(PC_PID, 0)).not.toThrow();
  expect(() => process.kill(BACKEND_PID, 0)).not.toThrow();
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim()).toBe(BUILD_ID);
  const jarPath = process.env.M_FINAL2_BACKEND_JAR_PATH?.trim();
  expect(jarPath).toBeTruthy();
  expect(sha256File(path.resolve(jarPath!))).toBe(JAR_SHA256);
  expect(makerManifest.runId).toBe(RUN_ID);
  expect(checkerManifest.runId).toBe(RUN_ID);
  expect(maker).toBeTruthy();
  expect(checker).toBeTruthy();
  expect(
    makerManifest.createdForRun === true || maker?.createdForRun === true,
    "M3 owner SUPPORT must be dedicated to this Run",
  ).toBe(true);
  expect(
    checkerManifest.createdForRun === true || checker?.createdForRun === true,
    "M3 receiver SUPPORT must be dedicated to this Run",
  ).toBe(true);
  expect(maker!.username).not.toBe(checker!.username);
  expect(String(maker!.accountId ?? maker!.id ?? "")).toMatch(/^\d+$/);
  expect(String(checker!.accountId ?? checker!.id ?? "")).toMatch(/^\d+$/);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("M3 visible initiate, cross-seat transfer/accept, M2 conversion, refresh/relogin and exact cleanup", async ({ browser }) => {
  let makerOperator: Awaited<ReturnType<typeof login>> | undefined;
  let checkerOperator: Awaited<ReturnType<typeof login>> | undefined;
  let conversationNo = "";
  let ticketNo = "";
  let conversationWriteAttempted = false;
  let ticketWriteAttempted = false;
  const cleanupErrors: string[] = [];
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    prefix: PREFIX,
    candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256, pcPid: PC_PID, backendPid: BACKEND_PID },
    manifests: { maker: sha256File(MAKER_PATH), checker: sha256File(CHECKER_PATH) },
    accountHashes: { maker: sha256(maker!.username), checker: sha256(checker!.username) },
    mfaBypass: false,
    startedAt: new Date().toISOString(),
  };

  try {
    makerOperator = await login(browser, maker!);
    checkerOperator = await login(browser, checker!);
    expect(sorted(makerOperator.session.authorities)).toEqual(sorted(checkerOperator.session.authorities));
    expect(sorted(makerOperator.session.effectiveMenus)).toEqual(sorted(checkerOperator.session.effectiveMenus));
    await expectHighRiskWriteForbidden(makerOperator.page.request, "OWNER");
    await expectHighRiskWriteForbidden(checkerOperator.page.request, "RECEIVER");
    evidence.rbac = {
      role: "SUPPORT",
      authoritySetHash: sha256(sorted(makerOperator.session.authorities).join("\n")),
      effectiveMenuSetHash: sha256(sorted(makerOperator.session.effectiveMenus).join("\n")),
      exactCrossSeatMatch: true,
      requiredAuthoritiesPresent: REQUIRED_SUPPORT_AUTHORITIES,
      requiredMenusPresent: REQUIRED_SUPPORT_MENUS,
      nonPermittedHighRiskWriteCode: 403,
    };
    await openM3(makerOperator.page);
    await openM3(checkerOperator.page);

    const supportOverview = await ok<SupportOverview>(
      await makerOperator.page.request.get("/api/admin/content/support-agents"),
    );
    const makerAgent = findAgent(supportOverview, maker!);
    const checkerAgent = findAgent(supportOverview, checker!);
    expect(makerAgent.id).not.toBe(checkerAgent.id);
    expect(makerAgent.enabled).toBe(true);
    expect(makerAgent.transferable).toBe(true);
    expect(checkerAgent.enabled).toBe(true);
    expect(checkerAgent.transferable).toBe(true);

    const opening = `${PREFIX}-首次用户可见发起`;
    await makerOperator.page.locator('[data-proof="session-initiate"]').click();
    const initiate = makerOperator.page.locator('[role="dialog"]:visible').last();
    await expect(initiate.getByText("主动发起会话", { exact: true }).first()).toBeVisible();
    const identity = initiate.locator("select").first();
    await expect(identity, "SUPPORT owner identity selector must be visible").toBeVisible();
    const option = identity.locator("option").filter({ hasText: makerAgent.name ?? "" }).first();
    await expect(option, "SUPPORT owner must initiate only as its exact support-agent identity").toHaveCount(1);
    await identity.selectOption(await option.getAttribute("value") ?? "");
    const customerSearch = initiate.getByPlaceholder("搜索客户 昵称 / 用户编码 / 地区");
    await customerSearch.fill("");
    const customer = initiate.locator("button").filter({ hasText: /U[-\s]?\d+/ }).first();
    await expect(customer, "M3 must load a real customer row").toBeVisible({ timeout: 20_000 });
    await customer.click();
    await initiate.locator("textarea").fill(opening);
    const createResponse = makerOperator.page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/content/conversations");
    conversationWriteAttempted = true;
    await initiate.getByRole("button", { name: /^发起会话/ }).click();
    const created = await ok<Conversation>(await createResponse);
    conversationNo = created.conversationNo;
    expect(conversationNo).toMatch(/^CV-/);
    expect(String(created.ownerAgentId)).toBe(String(makerAgent.id));
    await expect(initiate).toBeHidden({ timeout: 20_000 });
    await searchConversation(makerOperator.page, conversationNo);
    await expect(makerOperator.page.getByText(opening, { exact: true })).toBeVisible();
    await makerOperator.page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-initiate.png"), fullPage: true });

    const selfTransfer = await makerOperator.page.request.post(
      `/api/admin/content/conversations/${conversationNo}/transfer`,
      {
        headers: { "Idempotency-Key": `${PREFIX}-SELF-TRANSFER-DENIED` },
        data: {
          targetType: "agent",
          targetId: makerAgent.id,
          targetName: makerAgent.name,
          expectedStatus: created.status,
          expectedVersion: created.version,
          reason: `${PREFIX}-不得把会话转交给当前坐席自己`,
        },
      },
    );
    expect(selfTransfer.status(), "M3 self-transfer must fail closed").toBe(422);
    expect(await apiCode(selfTransfer)).toBe(422);

    await makerOperator.page.locator('[data-proof="session-transfer"]').click();
    const transfer = makerOperator.page.locator('[role="dialog"]:visible').last();
    const sameNameTargets = (supportOverview.agents ?? []).filter((agent) =>
      agent.enabled
      && agent.transferable
      && !agent.busy
      && agent.id !== makerAgent.id
      && agent.name === checkerAgent.name);
    const targetButtons = transfer.getByRole("button").filter({ hasText: checkerAgent.name ?? "" });
    await expect(targetButtons, "M003 regression requires more than one same-name visible target")
      .toHaveCount(sameNameTargets.length);
    const target = transfer.getByRole("button", { name: `坐席ID ${checkerAgent.id}` });
    await expect(target, "stable visible seat ID must resolve exactly one transfer target").toHaveCount(1);
    await expect(target, "exact checker support-agent profile must be selectable").toBeVisible({ timeout: 20_000 });
    await expect(target, "every selectable same-name support-agent target must expose a stable unique visible ID")
      .toContainText(`坐席ID ${checkerAgent.id}`);
    await target.click();
    await transfer.locator("textarea").fill(`${PREFIX}-转交独立坐席接续处理`);
    const transferResponse = makerOperator.page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/transfer`);
    await transfer.locator('[data-proof="session-transfer-submit"]').click();
    const rawTransferResponse = await transferResponse;
    const transferBody = rawTransferResponse.request().postDataJSON() as Record<string, unknown>;
    expect(String(transferBody.targetId), "M003 write contract must preserve the selected unique agentId")
      .toBe(String(checkerAgent.id));
    expect(transferBody.targetName).toBe(checkerAgent.name);
    const transferred = await ok<Conversation>(rawTransferResponse);
    expect(transferred.status).toBe("TRANSFERRED");
    expect(String(transferred.transferToId)).toBe(String(checkerAgent.adminId));

    const nonTarget = await makerOperator.page.request.post(
      `/api/admin/content/conversations/${conversationNo}/transfer/accept`,
      {
        headers: { "Idempotency-Key": `${PREFIX}-NON-TARGET-ACCEPT` },
        data: {
          reason: `${PREFIX}-非目标坐席必须失败关闭`,
          operator: maker!.username,
          expectedStatus: transferred.status,
          expectedVersion: transferred.version,
        },
      },
    );
    expect(await apiCode(nonTarget)).toBe(403);
    await makerOperator.page.reload({ waitUntil: "domcontentloaded" });
    await searchConversation(makerOperator.page, conversationNo);
    await expect(makerOperator.page.locator('[data-proof="session-transfer-accept"]')).toBeDisabled();

    await searchConversation(checkerOperator.page, conversationNo);
    const accept = checkerOperator.page.locator('[data-proof="session-transfer-accept"]');
    await expect(accept).toBeEnabled();
    const acceptResponse = checkerOperator.page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/transfer/accept`);
    await accept.click();
    const accepted = await ok<Conversation>(await acceptResponse);
    expect(accepted.status).toBe("OPEN");
    expect(String(accepted.ownerAgentId)).toBe(String(checkerAgent.id));
    expect(accepted.ownerAgentName).toBe(checkerAgent.name);

    const reply = `${PREFIX}-目标坐席接单后回复`;
    await checkerOperator.page.locator('[data-proof="session-reply"]').fill(reply);
    const replyResponse = checkerOperator.page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/replies`);
    await checkerOperator.page.locator('[data-proof="session-reply-save"]').click();
    await ok(await replyResponse);
    await checkerOperator.page.reload({ waitUntil: "domcontentloaded" });
    await searchConversation(checkerOperator.page, conversationNo);
    await expect(checkerOperator.page.getByText(reply, { exact: true })).toBeVisible();
    const acceptedRefresh = await ok<ConversationDetail>(
      await checkerOperator.page.request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
    );
    expect(String(acceptedRefresh.conversation.ownerAgentId)).toBe(String(checkerAgent.id));
    expect(acceptedRefresh.conversation.ownerAgentName).toBe(checkerAgent.name);

    const conversionResponse = checkerOperator.page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/admin/content/conversations/${conversationNo}/ticket`);
    await checkerOperator.page.locator('[data-proof="session-to-ticket"]').click();
    const confirmation = checkerOperator.page.locator('[role="dialog"]:visible').last();
    await confirmation.locator("textarea").fill(`${PREFIX}-跨班次继续追踪`);
    ticketWriteAttempted = true;
    await confirmation.getByRole("button", { name: /确认提交|确认执行/ }).click();
    const converted = await ok<{
      conversation: Conversation;
      ticket: { ticket?: { ticketNo?: string }; ticketNo?: string };
    }>(await conversionResponse);
    ticketNo = String(converted.ticket.ticket?.ticketNo ?? converted.ticket.ticketNo ?? "");
    expect(ticketNo).toMatch(/^TK-/);
    expect(converted.conversation.status).toBe("CLOSED");

    await openM2(checkerOperator.page);
    await checkerOperator.page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
    const row = checkerOperator.page.locator("tbody tr").filter({ hasText: ticketNo }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(
      checkerOperator.page.getByRole("link", { name: new RegExp(`查看会话 ${escapeRegExp(conversationNo)}`) }),
    ).toBeVisible();

    await logout(checkerOperator.page);
    await checkerOperator.context.close();
    checkerOperator = undefined;
    checkerOperator = await login(browser, checker!);
    await openM3(checkerOperator.page);
    await checkerOperator.page.getByRole("button", { name: /^归档(?:\s|$)/ }).click();
    await searchConversation(checkerOperator.page, conversationNo, "归档");
    await expect(checkerOperator.page.locator('[data-proof="session-conversation-no"]')).toHaveText(conversationNo);
    await checkerOperator.page.screenshot({ path: path.join(EVIDENCE_DIR, "02-transfer-accept-convert-relogin.png"), fullPage: true });

    evidence.flow = {
      conversationNo,
      ticketNo,
      makerAgentAdminId: makerAgent.adminId,
      checkerAgentAdminId: checkerAgent.adminId,
      selfTransferCode: 422,
      uniqueTargetIdPreserved: true,
      nonTargetAcceptCode: 403,
      acceptedStatus: accepted.status,
      convertedStatus: converted.conversation.status,
      reloginStable: true,
    };
  } finally {
    const request = checkerOperator && !checkerOperator.page.isClosed()
      ? checkerOperator.page.request
      : makerOperator && !makerOperator.page.isClosed()
        ? makerOperator.page.request
        : undefined;
    if (request) {
      const recovery = await recoverIds(
        request,
        conversationNo,
        ticketNo,
        conversationWriteAttempted,
        ticketWriteAttempted,
      ).catch((error) => ({
        conversationNo,
        ticketNo,
        errors: [`RECOVERY:${String(error)}`],
      }));
      conversationNo = recovery.conversationNo;
      ticketNo = recovery.ticketNo;
      cleanupErrors.push(...recovery.errors);
      evidence.recovery = recovery;
      await cleanupTicket(request, ticketNo).catch((error) => cleanupErrors.push(`M2:${String(error)}`));
      await cleanupConversation(request, conversationNo).catch((error) => cleanupErrors.push(`M3:${String(error)}`));
    } else if (conversationWriteAttempted || ticketWriteAttempted || conversationNo || ticketNo) {
      cleanupErrors.push("no authenticated request context for created objects");
    }
    evidence.cleanup = { ticketNo, conversationNo, errors: cleanupErrors };
    evidence.finishedAt = new Date().toISOString();
    writeFileSync(
      path.join(EVIDENCE_DIR, "m3-final3-transfer-result.restricted.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    if (makerOperator) await logout(makerOperator.page).catch(() => undefined);
    if (checkerOperator) await logout(checkerOperator.page).catch(() => undefined);
    if (makerOperator) await makerOperator.context.close().catch(() => undefined);
    if (checkerOperator) await checkerOperator.context.close().catch(() => undefined);
  }

  expect(cleanupErrors, "M3/M2 transfer carrier must leave no mutable object residue").toEqual([]);
});

async function recoverIds(
  request: APIRequestContext,
  currentConversationNo: string,
  currentTicketNo: string,
  conversationWriteAttempted: boolean,
  ticketWriteAttempted: boolean,
) {
  let recoveredConversationNo = currentConversationNo;
  let recoveredTicketNo = currentTicketNo;
  const errors: string[] = [];
  if (!recoveredConversationNo && conversationWriteAttempted) {
    try {
      const matches = await pollUniqueMatches(
        async () => {
          const page = await ok<{ records?: Conversation[] }>(
            await request.get(
              `/api/admin/content/conversations?pageNum=1&pageSize=100&keyword=${encodeURIComponent(PREFIX)}`,
            ),
          );
          return (page.records ?? []).filter((row) => String(row.lastMessage ?? "").includes(PREFIX));
        },
        "Run-scoped M3 recovery",
      );
      recoveredConversationNo = matches[0].conversationNo;
    } catch (error) {
      errors.push(`M3:${String(error)}`);
    }
  }
  if (!recoveredTicketNo && ticketWriteAttempted && recoveredConversationNo) {
    try {
      const matches = await pollUniqueMatches(
        async () => {
          const page = await ok<{ records?: Ticket[] }>(
            await request.get(
              `/api/admin/content/tickets?pageNum=1&pageSize=100&keyword=${encodeURIComponent(recoveredConversationNo)}`,
            ),
          );
          return (page.records ?? []).filter((row) => String(row.title ?? "").includes(recoveredConversationNo));
        },
        "M3-to-M2 recovery",
      );
      recoveredTicketNo = matches[0].ticketNo;
    } catch (error) {
      errors.push(`M2:${String(error)}`);
    }
  } else if (!recoveredTicketNo && ticketWriteAttempted && !recoveredConversationNo) {
    errors.push("M2:ticket write was attempted but its parent conversation could not be recovered");
  }
  return { conversationNo: recoveredConversationNo, ticketNo: recoveredTicketNo, errors };
}

async function pollUniqueMatches<T>(query: () => Promise<T[]>, label: string) {
  let matches: T[] = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    matches = await query();
    if (matches.length === 1) return matches;
    if (matches.length > 1) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(matches.length, `${label} must recover exactly one committed object`).toBe(1);
  return matches;
}

async function login(
  browser: Browser,
  account: Account,
): Promise<{ context: BrowserContext; page: Page; session: Session }> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await waitForLoginHydration(page);
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await loginResponse).status()).toBe(200);
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 20_000 });
    await otp.fill(await generateFreshTotp(account.totpSecret));
    const mfaResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await mfaResponse).status()).toBe(200);
    await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
    const session = await ok<{ session?: Session }>(await page.request.get("/api/admin/auth/session"));
    expect(session.session?.username).toBe(account.username);
    expect(
      [session.session?.role, session.session?.roleCode].some((role) => String(role ?? "").toLowerCase() === "support"),
      "M3 positive actor must have the real SUPPORT admin role",
    ).toBe(true);
    expect(session.session?.authorities ?? []).toEqual(expect.arrayContaining(REQUIRED_SUPPORT_AUTHORITIES));
    expect(session.session?.effectiveMenus ?? []).toEqual(expect.arrayContaining(REQUIRED_SUPPORT_MENUS));
    return { context, page, session: session.session! };
  } catch (error) {
    if (await page.locator("aside").isVisible().catch(() => false)) {
      await logout(page).catch(() => undefined);
    }
    await context.close().catch(() => undefined);
    throw error;
  }
}

async function waitForLoginHydration(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form
      ? Object.keys(form).some((key) => key.startsWith("__reactProps$"))
      : false;
  }, undefined, { timeout: 20_000 });
}

async function openM3(page: Page) {
  await openModule(page, "/service/sessions");
  await expect(page.getByText("会话收件箱", { exact: true })).toBeVisible();
}

async function openM2(page: Page) {
  await openModule(page, "/service/tickets");
  await expect(page.locator('[data-proof="support-ticket-search"]')).toBeVisible();
}

async function openModule(page: Page, href: string) {
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === href);
}

async function searchConversation(page: Page, conversationNo: string, segment: "全部" | "归档" = "全部") {
  const segmentButton = page.getByRole("button", { name: segment, exact: true }).first();
  if (await segmentButton.isVisible().catch(() => false)) await segmentButton.click();
  const search = page.locator('[data-proof="session-search"]');
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(conversationNo);
  const row = page.locator(".cv-item").filter({ hasText: conversationNo }).first();
  if (await row.isVisible().catch(() => false)) await row.click();
  await expect(page.locator('[data-proof="session-conversation-no"]')).toHaveText(conversationNo, { timeout: 20_000 });
}

function findAgent(overview: SupportOverview, account: Account) {
  const adminId = Number(account.accountId ?? account.id ?? 0);
  const agent = (overview.agents ?? []).find((row) => Number(row.adminId) === adminId);
  expect(agent, `support-agent profile for admin ${adminId} is required`).toBeTruthy();
  expect(agent?.name).toBeTruthy();
  expect(agent?.id).toBeTruthy();
  expect(agent?.serviceTypes ?? []).toContain("support");
  return agent!;
}

async function cleanupTicket(request: APIRequestContext, ticketNo: string) {
  if (!ticketNo) return;
  let detail = await ok<TicketDetail>(await request.get(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}`));
  if (!detail.ticket.archived && !["RESOLVED", "CLOSED"].includes(detail.ticket.status)) {
    detail = await ok<TicketDetail>(await request.patch(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}/status`, {
      headers: { "Idempotency-Key": `${PREFIX}-CLEANUP-M2-RESOLVE` },
      data: {
        status: "RESOLVED",
        expectedStatus: detail.ticket.status,
        expectedVersion: detail.ticket.version,
        reason: `${PREFIX}-精确清理转单工单`,
      },
    }));
  }
  if (!detail.ticket.archived) {
    await ok(await request.patch(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}/archive`, {
      headers: { "Idempotency-Key": `${PREFIX}-CLEANUP-M2-ARCHIVE` },
      data: {
        archived: true,
        expectedStatus: detail.ticket.status,
        expectedVersion: detail.ticket.version,
        reason: `${PREFIX}-精确归档转单工单`,
      },
    }));
  }
  const after = await ok<TicketDetail>(await request.get(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}`));
  expect(after.ticket.archived).toBe(true);
}

async function cleanupConversation(request: APIRequestContext, conversationNo: string) {
  if (!conversationNo) return;
  let detail = await ok<ConversationDetail>(
    await request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
  );
  if (detail.conversation.status === "TRANSFERRED") {
    await ok<Conversation>(
      await request.post(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}/transfer/return`, {
        headers: { "Idempotency-Key": `${PREFIX}-CLEANUP-M3-TRANSFER-RETURN` },
        data: {
          expectedStatus: detail.conversation.status,
          expectedVersion: detail.conversation.version,
          target: "from",
          reason: `${PREFIX}-精确退回未完成转交`,
        },
      }),
    );
    detail = await ok<ConversationDetail>(
      await request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
    );
  }
  if (detail.conversation.status === "OPEN") {
    await ok<Conversation>(
      await request.patch(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}/status`, {
        headers: { "Idempotency-Key": `${PREFIX}-CLEANUP-M3-CLOSE` },
        data: {
          status: "RESOLVED",
          expectedStatus: detail.conversation.status,
          expectedVersion: detail.conversation.version,
          reason: `${PREFIX}-精确解决跨坐席会话`,
        },
      }),
    );
    detail = await ok<ConversationDetail>(
      await request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
    );
  }
  if (detail.conversation.status === "RESOLVED") {
    await ok<Conversation>(await request.patch(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}/archive`, {
      headers: { "Idempotency-Key": `${PREFIX}-CLEANUP-M3-ARCHIVE` },
      data: {
        archived: true,
        expectedStatus: detail.conversation.status,
        expectedVersion: detail.conversation.version,
        reason: `${PREFIX}-精确归档跨坐席会话`,
      },
    }));
  }
  const after = await ok<ConversationDetail>(
    await request.get(`/api/admin/content/conversations/${encodeURIComponent(conversationNo)}`),
  );
  expect(after.conversation.status).toBe("CLOSED");
}

async function ok<T = unknown>(response: { status(): number; text(): Promise<string> }): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data;
}

async function apiCode(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  const payload = JSON.parse(raw) as { code?: number };
  return payload.code ?? response.status();
}

async function expectHighRiskWriteForbidden(request: APIRequestContext, actor: string) {
  const response = await request.post("/api/admin/platform/accounts/0/sessions/revoke", {
    headers: { "Idempotency-Key": `${PREFIX}-${actor}-HIGH-RISK-DENIED` },
    data: { reason: `${PREFIX}-SUPPORT角色不得撤销平台账号会话` },
  });
  expect(response.status()).toBe(403);
  expect(await apiCode(response)).toBe(403);
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  if (!await account.isVisible().catch(() => false)) return;
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

function generateTotp(secret: string, now = Date.now()) {
  const normalized = secret.replace(/\s+/g, "").toUpperCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Math.floor(now / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function generateFreshTotp(secret: string) {
  const normalized = secret.replace(/\s+/g, "").toUpperCase();
  const previousCounter = usedTotpCounters.get(normalized);
  let now = Date.now();
  let counter = Math.floor(now / 30_000);
  if (previousCounter !== undefined && counter <= previousCounter) {
    const waitMs = ((previousCounter + 1) * 30_000) - now + 750;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    now = Date.now();
    counter = Math.floor(now / 30_000);
  }
  usedTotpCounters.set(normalized, counter);
  return generateTotp(secret, now);
}

function restrictedPath(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  const resolved = path.resolve(value);
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(resolved)) throw new Error(`${name}_MUST_BE_RESTRICTED`);
  return resolved;
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sorted(values: string[] | undefined) {
  return [...(values ?? [])].sort((left, right) => left.localeCompare(right));
}
