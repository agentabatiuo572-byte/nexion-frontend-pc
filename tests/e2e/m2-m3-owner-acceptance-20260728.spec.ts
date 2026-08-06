import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type RestrictedOwnerFixture = {
  runId?: string;
  account?: { username: string; password: string; totpSecret: string };
  maker?: { username: string; password: string; totpSecret: string };
  accounts?: {
    maker?: { username: string; password: string; totpSecret: string };
  };
};

const FINAL2_RUN_ID = process.env.M_FINAL2_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FINAL2_OWNER_FIXTURE_PATH = process.env.M2_OWNER_FIXTURE_PATH?.trim();
const FINAL2_OWNER_FIXTURE = FINAL2_OWNER_FIXTURE_PATH
  ? JSON.parse(readFileSync(restrictedFinal2Path(FINAL2_OWNER_FIXTURE_PATH), "utf8")) as RestrictedOwnerFixture
  : undefined;
const FINAL2_MAKER = FINAL2_OWNER_FIXTURE?.account
  ?? FINAL2_OWNER_FIXTURE?.maker
  ?? FINAL2_OWNER_FIXTURE?.accounts?.maker;
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const FINAL2_PC_BUILD_ID_PATH = path.resolve(process.env.M_FINAL2_PC_BUILD_ID_PATH?.trim() || ".next/BUILD_ID");
const USERNAME = FINAL2_MAKER?.username ?? process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const PASSWORD = FINAL2_MAKER?.password ?? process.env.ADMIN_E2E_PASSWORD ?? "";
const TOTP_SECRET = FINAL2_MAKER?.totpSecret ?? process.env.ADMIN_E2E_TOTP_SECRET?.trim() ?? "";
const PREFIX = process.env.M2_FIXTURE_PREFIX ?? "M2-ACC-151023";
const EVIDENCE_DIR = process.env.M2_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/M/M2-final";
const RESULT_PATH = path.join(EVIDENCE_DIR, "runtime-result.json");
const MFA_SECRETS = new Map<string, string>();

type Envelope<T> = { code: number; message?: string; data: T };
type Ticket = { ticketNo: string; status: string; version: number; archived?: boolean; title?: string };
type TicketDetail = { ticket: Ticket; messages?: Array<{ content?: string }> };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test.beforeAll(() => {
  expect(PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  if (FINAL2_OWNER_FIXTURE_PATH) {
    expect(FINAL2_OWNER_FIXTURE?.runId).toBe(FINAL2_RUN_ID);
    expect(process.env.M_FINAL2_MFA_BYPASS).toBe("false");
    const writeControlToken = process.env.M_WRITE_CONTROL_TOKEN?.trim();
    expect(writeControlToken, "M_WRITE_CONTROL_TOKEN is required").toBeTruthy();
    expect(process.env.M_WRITE_TOKEN?.trim()).toBe(writeControlToken);
    expect(process.env.M234_OBJECT_LOCK).toBe(`${FINAL2_RUN_ID}:M234`);
    expect(readFileSync(FINAL2_PC_BUILD_ID_PATH, "utf8").trim()).toBe(
      process.env.M_FINAL2_EXPECTED_PC_BUILD_ID ?? "xNJR-cEeID2fPRwrRvOrb",
    );
    const jarPath = process.env.M_FINAL2_BACKEND_JAR_PATH?.trim();
    expect(jarPath, "M_FINAL2_BACKEND_JAR_PATH is required").toBeTruthy();
    expect(sha256File(path.resolve(jarPath!))).toBe(
      (process.env.M_FINAL2_EXPECTED_BACKEND_JAR_SHA256
        ?? "B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B").toUpperCase(),
    );
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("M2/M3 初始加载期间严格失败关闭，真实数据到达后才开放写入口", async ({ page }) => {
  await login(page);
  await assertDelayedModule(page, {
    href: "/service/tickets",
    routePattern: "**/api/admin/content/tickets**",
    readyText: /工单台/,
    writeControl: page.locator('[data-proof="support-ticket-create"]'),
    screenshot: "00-m2-loading-fails-closed.png",
  });
  await assertDelayedModule(page, {
    href: "/service/sessions",
    routePattern: "**/api/admin/content/conversations**",
    readyText: /会话收件箱/,
    writeControl: page.locator('[data-proof="session-initiate"]'),
    screenshot: "01-m3-loading-fails-closed.png",
  });
  await logout(page);
});

test("M2 从可见侧栏完成真实工单、幂等/CAS/异常、审计及刷新重登闭环", async ({ page, browser }) => {
  const anonymous = await browser.newContext({ baseURL: BASE_URL });
  expect((await anonymous.request.get("/api/admin/content/tickets?pageNum=1&pageSize=1")).status()).toBe(401);
  await anonymous.close();

  await login(page);
  await openVisibleModule(page, "/service/tickets");
  await expect(page.getByRole("heading", { name: "工单台", exact: true })).toBeVisible();
  await cleanupInterruptedTickets(page);
  const title = `${PREFIX}-真实工单-${Date.now()}`;
  const body = `${PREFIX}-用户反馈提现状态需要核对。`;
  const replyText = `${PREFIX}-客服已核对并回复用户。`;

  await page.locator('[data-proof="support-ticket-create"]').click();
  const createDialog = page.getByRole("dialog", { name: "新建客服工单" });
  await createDialog.locator("select").nth(0).selectOption("withdrawal");
  await createDialog.locator("select").nth(1).selectOption("high");
  await createDialog.locator('[data-proof="support-ticket-create-title"]').fill(title);
  await createDialog.locator('[data-proof="support-ticket-create-body"]').fill(body);
  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/content/tickets");
  await createDialog.locator('[data-proof="support-ticket-create-save"]').click();
  const created = await envelope<TicketDetail>(await createdResponse);
  const ticketNo = created.data.ticket.ticketNo;
  expect(ticketNo).toMatch(/^TK-/);
  await expect(createDialog).toBeHidden();

  await page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
  const row = page.locator("tbody tr").filter({ hasText: ticketNo }).first();
  await expect(row).toBeVisible();
  await row.click();
  await page.locator('[data-proof="support-ticket-reply"]').fill(replyText);
  const repliedResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === `/api/admin/content/tickets/${ticketNo}/replies`);
  await page.locator('[data-proof="support-ticket-reply-save"]').click();
  expect((await repliedResponse).status()).toBe(200);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-m2-created-and-replied.png"), fullPage: true });

  const beforeNote = await getTicket(page, ticketNo);
  const idempotencyKey = `${PREFIX}-note-${ticketNo}`;
  const notePayload = {
    body: `${PREFIX}-内部备注仅客服可见`,
    expectedStatus: beforeNote.ticket.status,
    expectedVersion: beforeNote.ticket.version,
    reason: `${PREFIX}-幂等与并发验收`,
    operator: USERNAME,
  };
  const noteA = await page.request.post(`/api/admin/content/tickets/${ticketNo}/internal-notes`, {
    headers: { "Idempotency-Key": idempotencyKey },
    data: notePayload,
  });
  const noteB = await page.request.post(`/api/admin/content/tickets/${ticketNo}/internal-notes`, {
    headers: { "Idempotency-Key": idempotencyKey },
    data: notePayload,
  });
  expect(noteA.status()).toBe(200);
  expect(noteB.status()).toBe(200);
  const afterNote = await getTicket(page, ticketNo);
  expect(afterNote.messages?.filter((message) => message.content === notePayload.body)).toHaveLength(1);

  const sameKeyDifferentPayload = await page.request.post(`/api/admin/content/tickets/${ticketNo}/internal-notes`, {
    headers: { "Idempotency-Key": idempotencyKey },
    data: { ...notePayload, body: `${notePayload.body}-DIFFERENT` },
  });
  await expectApiCode(sameKeyDifferentPayload, 409);
  const stale = await page.request.patch(`/api/admin/content/tickets/${ticketNo}/priority`, {
    headers: { "Idempotency-Key": `${PREFIX}-stale-${ticketNo}` },
    data: {
      priority: "NORMAL",
      expectedStatus: beforeNote.ticket.status,
      expectedVersion: beforeNote.ticket.version,
      reason: `${PREFIX}-陈旧版本不得覆盖`,
      operator: USERNAME,
    },
  });
  await expectApiCode(stale, 409);
  await expectApiCode(await page.request.get("/api/admin/content/tickets/TK-ACCEPTANCE-NOT-FOUND"), 404);
  await expectApiCode(await page.request.post("/api/admin/content/tickets", {
    headers: { "Idempotency-Key": `${PREFIX}-invalid-create` },
    data: {},
  }), 422);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
  await expect(page.locator("tbody tr").filter({ hasText: ticketNo }).first()).toBeVisible();
  const latest = await getTicket(page, ticketNo);
  const resolved = latest.ticket.status === "RESOLVED"
    ? latest
    : await mutateTicket(page, ticketNo, "status", {
        status: "RESOLVED",
        expectedStatus: latest.ticket.status,
        expectedVersion: latest.ticket.version,
        reason: `${PREFIX}-验收清理为已解决`,
        operator: USERNAME,
      });
  const archived = resolved.ticket.archived
    ? resolved
    : await mutateTicket(page, ticketNo, "archive", {
        archived: true,
        expectedStatus: resolved.ticket.status,
        expectedVersion: resolved.ticket.version,
        reason: `${PREFIX}-验收清理归档`,
        operator: USERNAME,
      });
  expect(archived.ticket.archived).toBe(true);

  const audit = await page.request.get(`/api/admin/platform/audit/logs?keyword=${encodeURIComponent(ticketNo)}&limit=200`);
  const events = await page.request.get("/api/admin/platform/events/overview");
  expect(audit.status()).toBe(200);
  expect([200, 403]).toContain(events.status());

  await logout(page);
  await login(page);
  await openVisibleModule(page, "/service/tickets");
  await page.getByRole("button", { name: /已归档/ }).click();
  await page.locator('[data-proof="support-ticket-search"]').fill(ticketNo);
  await expect(page.locator("tbody tr").filter({ hasText: ticketNo }).first()).toContainText(title);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-m2-relogin-archived-readback.png"), fullPage: true });
  writeFileSync(RESULT_PATH, JSON.stringify({
    prefix: PREFIX,
    ticketNo,
    finalStatus: archived.ticket.status,
    archived: archived.ticket.archived,
    cleanup: "terminal archived fixture; exact DB cleanup after independent review",
    checks: ["anonymous-401", "visible-sidebar", "ui-create-reply", "same-key-idempotent", "same-key-different-payload-409", "stale-cas-409", "404", "422", "a2", "a4", "refresh", "relogin"],
  }, null, 2));
  await logout(page);
});

async function assertDelayedModule(
  page: Page,
  input: {
    href: string;
    routePattern: string;
    readyText: RegExp;
    writeControl: ReturnType<Page["locator"]>;
    screenshot: string;
  },
) {
  let release!: () => void;
  let intercepted!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const firstIntercepted = new Promise<void>((resolve) => { intercepted = resolve; });
  let count = 0;
  await page.route(input.routePattern, async (route) => {
    count += 1;
    if (count === 1) intercepted();
    await released;
    await route.continue().catch((error: Error) => {
      if (!/already handled|target page, context or browser has been closed/i.test(error.message)) throw error;
    });
  });
  try {
    await openVisibleModule(page, input.href, false);
    await firstIntercepted;
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(input.href)}(?:\\?.*)?$`));
    await expect(input.writeControl).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, input.screenshot), fullPage: true });
    release();
    await expect(page.getByText(input.readyText).first()).toBeVisible({ timeout: 30_000 });
    await expect(input.writeControl).toBeVisible();
  } finally {
    release?.();
    await page.unroute(input.routePattern).catch(() => undefined);
  }
}

async function getTicket(page: Page, ticketNo: string) {
  const response = await page.request.get(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}`);
  return (await envelope<TicketDetail>(response)).data;
}

async function cleanupInterruptedTickets(page: Page) {
  const response = await page.request.get(`/api/admin/content/tickets?pageNum=1&pageSize=100&keyword=${encodeURIComponent(PREFIX)}`);
  const pageData = (await envelope<{ records?: Ticket[] }>(response)).data;
  for (const row of pageData.records ?? []) {
    let detail = await getTicket(page, row.ticketNo);
    if (detail.ticket.archived) continue;
    if (detail.ticket.status !== "RESOLVED") {
      detail = await mutateTicket(page, row.ticketNo, "status", {
        status: "RESOLVED",
        expectedStatus: detail.ticket.status,
        expectedVersion: detail.ticket.version,
        reason: `${PREFIX}-清理上次中断工单为已解决`,
        operator: USERNAME,
      });
    }
    await mutateTicket(page, row.ticketNo, "archive", {
      archived: true,
      expectedStatus: detail.ticket.status,
      expectedVersion: detail.ticket.version,
      reason: `${PREFIX}-清理上次中断工单归档`,
      operator: USERNAME,
    });
  }
}

async function mutateTicket(
  page: Page,
  ticketNo: string,
  action: "status" | "archive",
  data: Record<string, unknown>,
) {
  const response = await page.request.patch(`/api/admin/content/tickets/${encodeURIComponent(ticketNo)}/${action}`, {
    headers: { "Idempotency-Key": `${PREFIX}-${action}-${ticketNo}-${Date.now()}` },
    data,
  });
  return (await envelope<TicketDetail>(response)).data;
}

async function envelope<T>(response: APIResponse | import("@playwright/test").Response) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code, raw).toBe(0);
  return payload;
}

async function expectApiCode(
  response: APIResponse | import("@playwright/test").Response,
  expectedCode: number,
) {
  const raw = await response.text();
  let payload: { code?: number } | undefined;
  try {
    payload = JSON.parse(raw) as { code?: number };
  } catch {
    payload = undefined;
  }
  expect(payload?.code ?? response.status(), raw).toBe(expectedCode);
}

async function openVisibleModule(page: Page, href: string, waitForM = true) {
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  const link = page.locator(`a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false) && await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}(?:\\?.*)?$`));
  if (waitForM) await expect(page.locator(".mdom")).toBeVisible({ timeout: 30_000 });
}

async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) await logout(page);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    page.locator("aside").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    otp.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await page.locator("aside").isVisible().catch(() => false)) return;
  const displayed = (await page.locator("code").first().textContent().catch(() => ""))?.trim() ?? "";
  const secret = displayed || MFA_SECRETS.get(USERNAME) || TOTP_SECRET;
  expect(secret).not.toBe("");
  MFA_SECRETS.set(USERNAME, secret);
  await otp.fill(await freshTotp(secret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restrictedFinal2Path(value: string) {
  const resolved = path.resolve(value);
  const root = path.resolve("D:/workspace/bug-pic/.restricted", FINAL2_RUN_ID);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`M2_OWNER_FIXTURE_PATH must stay under ${root}`);
  }
  return resolved;
}

function sha256File(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex").toUpperCase();
}
