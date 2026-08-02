import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response as PlaywrightResponse } from "@playwright/test";

const FIXTURE = process.env.A_PERMISSION_FIXTURE_PATH;
const USER_ID = process.env.C5_REVIEW_USER_ID ?? "990000151024";
const USER_NO = process.env.C5_REVIEW_USER_NO ?? "U990000151024";
const EVIDENCE_DIR = process.env.C5_REVIEW_EVIDENCE_DIR;

type Account = { username: string; password: string; totpSecret: string };
type Fixture = { accounts?: { maker?: Account } };
type Envelope = { code?: number; message?: string; data?: Record<string, unknown> | null };

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("C5 从可见侧栏提交 K5 实名二验；PENDING KYC 必须失败关闭且不改安全状态", async ({ browser }) => {
  expect(FIXTURE, "A_PERMISSION_FIXTURE_PATH is required").toBeTruthy();
  if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
  const maker = (JSON.parse(readFileSync(FIXTURE!, "utf8")) as Fixture).accounts?.maker;
  expect(maker, "C maker fixture is required").toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  const run = `C5-K5-${Date.now()}-${randomUUID().slice(0, 8)}`;

  try {
    await loginAccount(page, maker!);
    const c5 = page.locator('aside a[href="/users/security"]').first();
    if (!(await c5.isVisible({ timeout: 1_000 }).catch(() => false))) {
      const group = page.locator("aside button").filter({ hasText: /用户与账户/ }).first();
      await expect(group, "C group toggle must be visible in the maker sidebar").toBeVisible();
      await group.click();
    }
    await expect(c5, "C5 must be visible in the maker sidebar").toBeVisible();
    const overview = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/users/security/overview" && response.request().method() === "GET");
    await c5.click();
    expect((await overview).status()).toBe(200);
    await expect(page).toHaveURL(/\/users\/security/);

    const lookup = page.getByPlaceholder("搜索用户编码 / 用户名 / 推荐码 / 手机号");
    await lookup.fill(USER_NO);
    const option = page.locator("button").filter({ hasText: USER_NO }).last();
    await expect(option, "C5 must expose the isolated user in the visible lookup").toBeVisible();
    const selected = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/users/security/overview" && response.request().method() === "GET");
    await option.click();
    expect((await selected).status()).toBe(200);
    await expect(page.getByText(new RegExp(`2FA 状态`))).toBeVisible();

    const before = await envelope(await page.request.get(`/api/admin/users/security/overview?userKey=${USER_NO}&pageNum=1&pageSize=10`));
    expect(before.status).toBe(200);
    expect(before.body.code).toBe(0);
    const beforeSecurity = securityProjection(before.body.data);

    const requestButton = page.getByRole("button", { name: "密码重置（实名二验）", exact: true });
    await expect(requestButton, "C5 password-reset reverification entry must be available").toBeEnabled();
    await requestButton.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("当前操作只创建复审任务，不会改变用户安全状态");
    await dialog.getByLabel(/操作理由/).fill(`${run} PENDING KYC fail-closed evidence`);

    const requestResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/admin/users/profiles/${USER_ID}/security/kyc-reverification`
      && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "提交复审申请", exact: true }).click();
    const firstResponse = await requestResponse;
    const first = await envelope(firstResponse);
    expect(first.status).toBe(422);
    expect(first.body.message).toBe("KYC_REVERIFY_REQUIRED");

    const after = await envelope(await page.request.get(`/api/admin/users/security/overview?userKey=${USER_NO}&pageNum=1&pageSize=10`));
    expect(after.status).toBe(200);
    expect(after.body.code).toBe(0);
    expect(securityProjection(after.body.data)).toEqual(beforeSecurity);
    await page.screenshot({ path: path.join(EVIDENCE_DIR ?? "test-results", "c5-kyc-reverify-pending.png"), fullPage: true });
    writeEvidence({ run, beforeSecurity, first, afterSecurity: securityProjection(after.body.data) });
  } finally {
    await context.close();
  }
});

async function loginAccount(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const login = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await login).status()).toBe(200);
  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([shell.waitFor({ state: "visible", timeout: 30_000 }), otp.waitFor({ state: "visible", timeout: 30_000 })]);
  if (!(await shell.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await otp.fill(await freshTotp(account.totpSecret));
    const verify = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verify).status()).toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
  const session = await envelope(await page.request.get("/api/admin/auth/session"));
  expect(session.status).toBe(200);
  expect(session.body.code).toBe(0);
}

async function envelope(response: APIResponse | PlaywrightResponse) {
  const raw = await response.text();
  return { status: response.status(), body: JSON.parse(raw) as Envelope };
}

function securityProjection(data: Record<string, unknown> | null | undefined) {
  const selected = (data?.selectedUser ?? {}) as Record<string, unknown>;
  return {
    userId: String(selected.userId ?? selected.id ?? ""),
    twoFactorEnabled: selected.twoFactorEnabled ?? null,
    passwordResetRequired: selected.passwordResetRequired ?? null,
    loginFailCount: selected.loginFailCount ?? null,
  };
}

function writeEvidence(value: Record<string, unknown>) {
  if (EVIDENCE_DIR) writeFileSync(path.join(EVIDENCE_DIR, "c5-k5-reverification.json"), JSON.stringify(value, null, 2));
}

async function freshTotp(secret: string) {
  const remaining = 30_000 - (Date.now() % 30_000);
  await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}
