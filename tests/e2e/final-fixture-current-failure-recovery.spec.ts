import { createHmac, randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

/**
 * UI-only recovery for the one failed FINAL fixture attempt.  It accepts
 * explicit, RunID-scoped identifiers and uses a second, temporary super admin
 * to approve every A2 cleanup proposal; it never calls an admin API directly.
 */
const TARGET_ACCOUNT = required("FINAL_FIXTURE_RECOVERY_ACCOUNT");
const TARGET_ROLE = required("FINAL_FIXTURE_RECOVERY_ROLE");
const TARGET_ROLE_ID = required("FINAL_FIXTURE_RECOVERY_ROLE_ID");
const ADMIN_USERNAME = required("ADMIN_E2E_USERNAME");
const ADMIN_PASSWORD = required("ADMIN_E2E_PASSWORD");
const TOKEN = randomBytes(4).toString("hex");
const REASON = "FINAL_FIXTURE_ADMIN_WINDOW failed attempt recovery through visible A1 A2 A6";

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("A1/A2/A6 recovers failed RunID fixture account and role", async ({ page, browser }) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  const checker = await createRecoveryChecker(page, browser);
  try {
    const accountTicket = await disableAccountUi(page, TARGET_ACCOUNT);
    if (accountTicket) await approveUi(checker.page, accountTicket);
    const roleTicket = await deleteRoleUi(page, TARGET_ROLE, TARGET_ROLE_ID);
    if (roleTicket) await approveUi(checker.page, roleTicket);
    await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    await page.reload();
    const targetRow = await findAccountRow(page, TARGET_ACCOUNT);
    if (targetRow) await expect(targetRow).toContainText("禁用");
    await nav(page, "角色管理 A6", /\/platform\/roles$/);
    await page.reload();
    await expect(page.getByText(TARGET_ROLE, { exact: true })).toHaveCount(0);
    // A failed fixture attempt may leave accounts under a different random
    // suffix.  Reclaim every Run-scoped `ffix.` account through visible A1
    // and the same independent A2 checker; the new checker itself is exempt
    // until it approves the rest and is then disabled below.
    for (const staleUsername of await findAccountUsernames(page, "ffix.")) {
      if (staleUsername === checker.username) continue;
      const staleTicket = await disableAccountUi(page, staleUsername);
      if (staleTicket) await approveUi(checker.page, staleTicket);
    }
    const recoveryTicket = await disableAccountUi(page, checker.username);
    if (recoveryTicket) await approveUi(checker.page, recoveryTicket);
  } finally {
    await checker.context.close();
  }
});

async function createRecoveryChecker(page: Page, browser: Browser) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const create = page.getByRole("dialog").last();
  const username = `ffix.recover.${TOKEN}`;
  await create.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
  await create.getByPlaceholder("姓名,如:张三").fill(`FINAL recovery ${TOKEN}`);
  await create.getByText("超级管理员", { exact: true }).click();
  await create.getByLabel(/操作理由/).fill(REASON);
  const created = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/admin/platform/accounts"));
  await create.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirm = page.getByRole("dialog").last();
  await confirm.getByLabel(/操作理由/).fill(REASON);
  await confirm.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await created).status()).toBe(200);
  const passwordDialog = page.getByRole("dialog").last();
  const temporaryPassword = (await passwordDialog.locator(".mono").last().textContent())?.trim() ?? "";
  expect(temporaryPassword).not.toBe("");
  await passwordDialog.getByText("关闭", { exact: true }).click();
  const context = await browser.newContext();
  const checkerPage = await context.newPage();
  await checkerPage.goto("/");
  await checkerPage.locator('input[autocomplete="username"]').fill(username);
  await checkerPage.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  await checkerPage.getByRole("button", { name: "继续", exact: true }).click();
  const otp = checkerPage.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  const secret = ((await checkerPage.locator("code").first().textContent()) ?? "").trim();
  expect(secret).not.toBe("");
  await otp.fill(totp(secret));
  await checkerPage.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(checkerPage.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();
  const finalPassword = `Nx!Recover${randomBytes(18).toString("base64url")}Aa`;
  await checkerPage.getByLabel("新密码", { exact: true }).fill(finalPassword);
  await checkerPage.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
  await checkerPage.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  await expect(checkerPage.locator("aside")).toBeVisible({ timeout: 30_000 });
  return { context, page: checkerPage, username };
}

async function disableAccountUi(page: Page, username: string) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.reload();
  const row = await findAccountRow(page, username);
  if (!row) return null;
  if (!await row.getByRole("button", { name: "禁用", exact: true }).count()) return null;
  await row.getByRole("button", { name: "禁用", exact: true }).click();
  return submitConfirm(page, (response) => response.request().method() === "POST" && response.url().endsWith("/api/admin/platform/audit/operations"));
}

async function deleteRoleUi(page: Page, roleCode: string, roleId: string) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  if (!await page.getByText(roleCode, { exact: true }).count()) return null;
  await page.getByText(roleCode, { exact: true }).first().click();
  await page.getByRole("button", { name: "删除角色", exact: true }).click();
  return submitConfirm(page, (response) => response.request().method() === "DELETE" && response.url().endsWith(`/api/admin/platform/roles/${roleId}`));
}

async function findAccountRow(page: Page, username: string) {
  await page.locator("select.pager-size").selectOption("50");
  for (let index = 0; index < 20; index += 1) {
    const row = page.locator("tbody tr").filter({ hasText: username });
    if (await row.count()) return row;
    const next = page.locator("button.pager-btn").last();
    if (await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(100);
  }
  return null;
}

async function findAccountUsernames(page: Page, prefix: string) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.reload();
  await page.locator("select.pager-size").selectOption("50");
  const found = new Set<string>();
  for (let index = 0; index < 20; index += 1) {
    for (const text of await page.locator("tbody tr").allTextContents()) {
      const match = text.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9._-]+`));
      if (match) found.add(match[0]);
    }
    const next = page.locator("button.pager-btn").last();
    if (await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(100);
  }
  return [...found];
}

async function submitConfirm(page: Page, predicate: (response: Response) => boolean) {
  const response = page.waitForResponse(predicate);
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel(/操作理由/).fill(REASON);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const body = await (await response).json() as { code?: number; data?: { operationId?: string; id?: string } };
  expect(body.code).toBe(0);
  const operationId = body.data?.operationId ?? body.data?.id;
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId!;
}

async function approveUi(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload();
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`));
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel(/操作理由/).fill(REASON);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/");
  if (await page.locator('input[autocomplete="username"]').isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "继续", exact: true }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function nav(page: Page, name: string, url: RegExp) {
  const dialog = page.getByRole("dialog").last();
  if (await dialog.isVisible().catch(() => false)) {
    const close = dialog.getByRole("button", { name: "关闭", exact: true });
    if (await close.isVisible().catch(() => false)) await close.click();
  }
  const link = page.locator("aside").getByRole("link", { name, exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click();
  await expect(page).toHaveURL(url);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const raw = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase(); let bits = "";
  for (const char of raw) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
