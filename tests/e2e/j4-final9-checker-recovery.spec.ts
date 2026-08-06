import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
const runId = "pc-full-acceptance-20260729-114336";
const artifactRoot = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/final9/checker-recovery";
const bootstrapPath = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/final9/bootstrap/temporary-super-credentials.restricted.json";
const fixturePath = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/J.json";
const pendingReset = "WO-260801182127958-300";
const checkerUsername = "acc_j4_checker_114336_0801";
const permissions = ["platform_a2_read", "platform_a2_operation_approve", "emergency_j4_read", "emergency_j4_playbook_execute"];

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("J Final9 resolves dedicated checker fixture through two independent normal-MFA supers", async ({ browser }) => {
  const bootstrap = JSON.parse(readFileSync(bootstrapPath, "utf8")) as { accounts: Account[] };
  expect(bootstrap.accounts).toHaveLength(2);
  mkdirSync(artifactRoot, { recursive: true });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const checker = await checkerContext.newPage();
  try {
    await loginMfa(first, bootstrap.accounts[0], "j-final9-super-1");
    await loginMfa(second, bootstrap.accounts[1], "j-final9-super-2");
    await approveIfPending(second, pendingReset, "approve dedicated J4 checker 2FA reset before password reset");
    const temporaryPassword = await resetPassword(first);
    const password = `Nx!J4C${randomBytes(16).toString("base64url")}Aa9`;
    const totpSecret = await enroll(checker, checkerUsername, temporaryPassword, password);
    await logout(checker);
    await loginMfa(checker, { username: checkerUsername, password, totpSecret }, "j-final9-dedicated-checker-1");
    await assertScope(checker);
    await logout(checker);
    await loginMfa(checker, { username: checkerUsername, password, totpSecret }, "j-final9-dedicated-checker-2");
    await assertScope(checker);
    await checker.screenshot({ path: `${artifactRoot}/dedicated-checker-normal-mfa-2of2.png`, fullPage: true });
    const current = JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
    current.checker = { username: checkerUsername, password, totpSecret, roleCode: "ACC_J4_CK_114336_0801", authorities: permissions, normalMfaVerified: true, loginCycles: 2, fixturePreparationOnly: true };
    current.cleanup = [...(Array.isArray(current.cleanup) ? current.cleanup : []), { username: checkerUsername, roleCode: "ACC_J4_CK_114336_0801", action: "visible A1 disable then reset MFA during final cleanup" }];
    writeFileSync(fixturePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    writeFileSync(`${artifactRoot}/recovery-summary.json`, `${JSON.stringify({ runId, pendingReset, checkerUsername, normalMfaCycles: 2, permissions, containsSecrets: false, status: "passed" }, null, 2)}\n`, "utf8");
  } finally {
    await firstContext.close();
    await secondContext.close();
    await checkerContext.close();
  }
});

async function loginMfa(page: Page, account: Account, key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByLabel("账号", { exact: true }).fill(account.username);
    await page.getByLabel("密码", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码", { exact: true });
    await expect(otp).toBeVisible({ timeout: 30_000 });
    await otp.fill(await freshTotp(key, account.totpSecret));
    const pending = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    if ((await pending).status() === 200) { await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); return; }
    await wait(30_500 - Date.now() % 30_000);
  }
  throw new Error(`MFA_LOGIN_FAILED:${key}`);
}

async function nav(page: Page, name: string, url: RegExp) {
  const link = page.locator("aside").getByRole("link", { name, exact: true }).first();
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first().click();
  await link.click();
  await expect(page).toHaveURL(url);
}

async function approveIfPending(page: Page, operation: string, reason: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operation }).first();
  if (!await row.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) return;
  if (!await row.getByRole("button", { name: "执行", exact: true }).count()) { await expect(row).toContainText(/已执行|已批准/); return; }
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last();
  await dialog.getByLabel(/操作理由/).fill(`${runId} ${reason}`);
  const response = page.waitForResponse((value) => value.request().method() === "POST" && new URL(value.url()).pathname === `/api/admin/platform/audit/operations/${operation}/approve`);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await ok(await response);
}

async function resetPassword(page: Page) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("select.pager-size").selectOption("50");
  const next = page.locator(".pager-btn").last();
  for (let index = 0; index < 20; index += 1) {
    const row = page.locator("tbody tr").filter({ hasText: checkerUsername }).first();
    if (await row.count()) {
      await row.getByRole("button", { name: "重置密码", exact: true }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-business-form="identity-verify"]') }).last();
      await dialog.getByLabel("核验时间 verified at", { exact: true }).fill("2026-08-01T18:10");
      await dialog.getByLabel("来源工单号 ticket", { exact: true }).fill("FIXTURE-J4-FINAL9-RESET");
      await dialog.locator('[data-proof="identity-ack"]').check();
      await dialog.getByLabel(/操作理由/).fill(`${runId} reset dedicated J4 checker password after approved 2FA reset`);
      const response = page.waitForResponse((value) => value.request().method() === "POST" && /\/api\/admin\/platform\/accounts\/\d+\/password\/reset$/.test(new URL(value.url()).pathname));
      await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
      await ok(await response);
      const credential = page.getByRole("dialog").last();
      await expect(credential.getByText("临时密码", { exact: true })).toBeVisible({ timeout: 30_000 });
      const password = (await credential.locator(".mono").last().textContent())?.trim() ?? "";
      expect(password).not.toBe("");
      await credential.getByText("关闭", { exact: true }).click();
      return password;
    }
    if (await next.isDisabled()) break;
    await next.click();
  }
  throw new Error("DEDICATED_CHECKER_NOT_FOUND");
}

async function resetMfa(page: Page) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.locator("select.pager-size").selectOption("50");
  const next = page.locator(".pager-btn").last();
  for (let index = 0; index < 20; index += 1) {
    const row = page.locator("tbody tr").filter({ hasText: checkerUsername }).first();
    if (await row.count()) {
      await row.getByRole("button", { name: "重置 2FA", exact: true }).click();
      const dialog = page.getByRole("dialog").filter({ has: page.locator('[data-business-form="identity-verify"]') }).last();
      await dialog.getByLabel("核验时间 verified at", { exact: true }).fill("2026-08-01T18:18");
      await dialog.getByLabel("来源工单号 ticket", { exact: true }).fill("FIXTURE-J4-FINAL9-REENROLL");
      await dialog.locator('[data-proof="identity-ack"]').check();
      await dialog.getByLabel(/操作理由/).fill(`${runId} create fresh CAS-safe J4 checker MFA reset`);
      const response = page.waitForResponse((value) => value.request().method() === "POST" && new URL(value.url()).pathname === "/api/admin/platform/audit/operations");
      await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
      const data = await ok<{ operationId?: string; id?: string }>(await response);
      const operation = String(data.operationId ?? data.id ?? "");
      expect(operation).toMatch(/^(?:WO|OP)-/);
      return operation;
    }
    if (await next.isDisabled()) break;
    await next.click();
  }
  throw new Error("DEDICATED_CHECKER_NOT_FOUND_FOR_MFA_RESET");
}

async function enroll(page: Page, username: string, temporary: string, password: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码", { exact: true });
  await expect(otp).toBeVisible({ timeout: 30_000 });
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).not.toBe("");
  await otp.fill(await freshTotp("j-final9-checker-enroll", secret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认新密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return secret;
}

async function assertScope(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  const data = await ok<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { code?: string }> } }>(response);
  expect([...(data.session?.authorities ?? [])].sort()).toEqual([...permissions].sort());
  expect((data.session?.effectiveMenus ?? []).map((item) => typeof item === "string" ? item : item.code)).toEqual(expect.arrayContaining(["J", "J4", "A2"]));
  const group = page.locator("aside").getByRole("button", { name: /紧急与合规控制.*J|J.*紧急与合规控制/ }).first();
  if (!await page.locator('a[href="/emergency/sop"]').isVisible().catch(() => false)) await group.click();
  await expect(page.locator('a[href="/emergency/sop"]')).toBeVisible();
}

async function logout(page: Page) { await page.request.post("/api/admin/auth/logout").catch(() => undefined); await page.context().clearCookies(); await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => undefined); }
async function ok<T>(response: Response | Awaited<ReturnType<Page["request"]["get"]>>) { const payload = await response.json() as Envelope<T>; expect(response.status(), JSON.stringify(payload)).toBe(200); expect(payload.code, JSON.stringify(payload)).toBe(0); return payload.data as T; }
const lastStep = new Map<string, number>();
async function freshTotp(key: string, secret: string) { let step = Math.floor(Date.now() / 30_000); if (step <= (lastStep.get(key) ?? -1) || 30_000 - Date.now() % 30_000 < 3_000) await wait(30_500 - Date.now() % 30_000); step = Math.floor(Date.now() / 30_000); lastStep.set(key, step); return totp(secret); }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const bits = secret.replace(/=+$/, " ").replace(/\s+/g, "").toUpperCase().split("").map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join(""); const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let i = 0; i < bytes.length; i += 1) bytes[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", bytes).update(counter).digest(); const offset = digest[digest.length - 1] & 15; const value = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255); return String(value % 1_000_000).padStart(6, "0"); }
