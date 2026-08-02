import { createHmac, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

const ADMIN_USERNAME = required("ADMIN_E2E_USERNAME");
const ADMIN_PASSWORD = required("ADMIN_E2E_PASSWORD");
const TOKEN = randomBytes(4).toString("hex");
const REASON = "pc-full-acceptance-20260729-114336 R3 failed-window residual fixture recovery";

test.describe.configure({ mode: "serial", timeout: 600_000 });

/**
 * Repairs only currently-enabled ffix accounts found in visible A1 rows.
 * For every target it visibly disables the account (which revokes its
 * sessions), then gets an independent A2 approval and reads the final state
 * back.  Retained R3 roles are not
 * touched: they are intentionally reused/regranted by the next provisioner.
 */
test("R3 residual accounts are visibly unassigned, MFA-reset, disabled and A2-approved", async ({ page, browser }, testInfo) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  const checker = await createRecoveryChecker(page, browser);
  const recovered: string[] = [];
  try {
    const targets = await listEnabledFixtureUsers(page);
    expect(targets.length, "precondition: failed R3 window left enabled ffix targets").toBeGreaterThan(0);
    for (const username of targets.filter((value) => value !== checker.username)) {
      await disableUi(page, username, checker.page);
      await assertDisabledReadback(page, username);
      recovered.push(username);
    }
    // This short-lived approver itself must not outlive the recovery window.
    await disableUi(page, checker.username, checker.page);
    await assertDisabledReadback(page, checker.username);
    await writeFile(testInfo.outputPath("r3-residual-recovery.json"), JSON.stringify({
      runId: "pc-full-acceptance-20260729-114336", recovered, recoveryChecker: checker.username,
      readback: "A1 status=已禁用,sessions=0; disabled accounts cannot retain backend access",
    }, null, 2));
  } finally {
    await checker.context.close();
  }
});

async function createRecoveryChecker(page: Page, browser: Browser) {
  await navA1(page);
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  const username = `ffix.recover.${TOKEN}`;
  await dialog.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
  await dialog.getByPlaceholder("姓名,如:张三").fill(`FINAL residual recovery ${TOKEN}`);
  await dialog.getByText("超级管理员", { exact: true }).click();
  await dialog.getByLabel(/操作理由/).fill(REASON);
  const created = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/accounts"));
  await dialog.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirm = page.getByRole("dialog").last();
  await confirm.getByLabel(/操作理由/).fill(REASON);
  await confirm.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await created).status()).toBe(200);
  const passwordDialog = page.getByRole("dialog").last();
  const temporaryPassword = (await passwordDialog.locator(".mono").last().textContent())?.trim() ?? "";
  expect(temporaryPassword).not.toBe("");
  await passwordDialog.getByText("关闭", { exact: true }).click();
  const context = await browser.newContext(); const checkerPage = await context.newPage();
  await checkerPage.goto("/");
  await checkerPage.locator('input[autocomplete="username"]').fill(username);
  await checkerPage.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  await checkerPage.getByRole("button", { name: "继续", exact: true }).click();
  const otp = checkerPage.getByLabel("一次性验证码"); await expect(otp).toBeVisible();
  const secret = ((await checkerPage.locator("code").first().textContent()) ?? "").trim(); expect(secret).not.toBe("");
  await otp.fill(totp(secret)); await checkerPage.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(checkerPage.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();
  const password = `Nx!Recover${randomBytes(18).toString("base64url")}Aa`;
  await checkerPage.getByLabel("新密码", { exact: true }).fill(password);
  await checkerPage.getByLabel("确认新密码", { exact: true }).fill(password);
  await checkerPage.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  await expect(checkerPage.locator("aside")).toBeVisible({ timeout: 30_000 });
  return { context, page: checkerPage, username };
}

async function listEnabledFixtureUsers(page: Page) {
  await navA1(page); await page.reload(); await page.locator("select.pager-size").selectOption("50");
  const users = new Set<string>();
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    for (const row of await page.locator("tbody tr").all()) {
      const text = await row.innerText(); const username = text.match(/ffix\.[A-Za-z0-9._-]+/)?.[0];
      const status = (await row.locator("td").nth(3).innerText()).trim();
      if (username && status === "启用") users.add(username);
    }
    const next = page.locator("button.pager-btn").last(); if (await next.isDisabled()) break;
    await next.click(); await page.waitForTimeout(100);
  }
  return [...users];
}

async function changeRoleToUnassignedUi(page: Page, username: string, approver: Page) {
  const row = await findRow(page, username); await row.getByRole("button", { name: "改角色", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('select[data-proof="role-select-target"]').selectOption("unassigned");
  const operationId = await submit(page, (r) => r.url().endsWith("/api/admin/platform/audit/operations"));
  await approve(approver, operationId);
}

async function resetMfaUi(page: Page, username: string, approver: Page) {
  const row = await findRow(page, username); await row.getByRole("button", { name: "重置 2FA", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.locator('input[type="datetime-local"]').fill("2026-07-29T22:00");
  await dialog.getByLabel(/来源工单号/).fill(`SEC-R3-${TOKEN}`);
  await dialog.locator('[data-proof="identity-ack"]').check();
  const operationId = await submit(page, (r) => r.url().endsWith("/api/admin/platform/audit/operations"));
  await approve(approver, operationId);
}

async function disableUi(page: Page, username: string, approver: Page) {
  const row = await findRow(page, username); const button = row.getByRole("button", { name: "禁用", exact: true });
  if (!await button.count()) return;
  await button.click(); const operationId = await submit(page, (r) => r.url().endsWith("/api/admin/platform/audit/operations"));
  await approve(approver, operationId);
}

async function submit(page: Page, predicate: (response: Response) => boolean) {
  const response = page.waitForResponse((r) => r.request().method() === "POST" && predicate(r));
  const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill(REASON);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const body = await (await response).json() as { code?: number; data?: { operationId?: string; id?: string } };
  if (body.code !== 0) throw new Error(`A1_SUBMIT_REJECTED:${JSON.stringify(body)}`);
  const operationId = body.data?.operationId ?? body.data?.id; expect(operationId).toMatch(/^(?:WO|OP)-/); return operationId!;
}

async function approve(page: Page, operationId: string) {
  await navA2(page); await page.reload(); const row = page.locator("tbody tr").filter({ hasText: operationId }); await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`));
  const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill(REASON); await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function assertRecoveredReadback(page: Page, username: string) {
  const row = await findRow(page, username); const cells = row.locator("td");
  await expect(cells.nth(1)).toContainText("暂未分配"); await expect(cells.nth(2)).toContainText("未绑定");
  await expect(cells.nth(3)).toContainText("已禁用"); await expect(cells.nth(5)).toContainText("0");
}
async function assertDisabledReadback(page: Page, username: string) { const row = await findRow(page, username); await expect(row.locator("td").nth(3)).toContainText("已禁用"); await expect(row.locator("td").nth(5)).toContainText("0"); }
async function findRow(page: Page, username: string) {
  await navA1(page); await page.reload(); await page.locator("select.pager-size").selectOption("50");
  for (let index = 0; index < 20; index += 1) { const row = page.locator("tbody tr").filter({ hasText: username }); if (await row.count()) return row; const next = page.locator("button.pager-btn").last(); if (await next.isDisabled()) break; await next.click(); await page.waitForTimeout(100); }
  throw new Error(`A1_ACCOUNT_NOT_FOUND:${username}`);
}
async function login(page: Page, username: string, password: string) { await page.goto("/"); if (await page.locator('input[autocomplete="username"]').isVisible({ timeout: 5_000 }).catch(() => false)) { await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[autocomplete="current-password"]').fill(password); await page.getByRole("button", { name: "继续", exact: true }).click(); } await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); }
async function dismissBlockingDialog(page: Page) { const dialog = page.getByRole("dialog").last(); if (await dialog.isVisible().catch(() => false)) { const close = dialog.getByRole("button", { name: "关闭", exact: true }); if (await close.isVisible().catch(() => false)) await close.click(); } }
async function navA1(page: Page) { await dismissBlockingDialog(page); const link = page.locator("aside").getByRole("link", { name: "运营账号 & RBAC A1", exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(/\/platform\/rbac$/); }
async function navA2(page: Page) { await dismissBlockingDialog(page); const link = page.locator("aside").getByRole("link", { name: "审计 & 操作确认 A2", exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(/\/platform\/audit$/); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const raw = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase(); let bits = ""; for (const char of raw) bits += alphabet.indexOf(char).toString(2).padStart(5, "0"); const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 0x0f; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
