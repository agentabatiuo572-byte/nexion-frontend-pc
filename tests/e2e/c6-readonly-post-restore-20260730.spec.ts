import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.C_PERMISSION_FIXTURE_PATH;
const EVIDENCE_DIR = process.env.C6_OWNER_EVIDENCE_DIR;

test("C6 exact restore: original C readonly role, no write, logout", async ({ page }) => {
  if (!FIXTURE_PATH || !EVIDENCE_DIR) {
    throw new Error("C_PERMISSION_FIXTURE_PATH and C6_OWNER_EVIDENCE_DIR are required");
  }
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    accounts: { readonly: { username: string; password: string; totpSecret: string } };
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await login(page, fixture.accounts.readonly);

  const sessionResponse = await page.request.get("/api/admin/auth/session");
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  expect(session.data?.session?.roleCode).toBe("ACC_C_RO_114336");

  const overviewResponse = await page.request.get("/api/admin/users/registration-risk/overview");
  expect(overviewResponse.status()).toBe(200);
  const overview = await overviewResponse.json();
  const shortLock = overview.data?.params?.find((row: { key: string }) => row.key === "lockShort");
  expect(shortLock?.value).toBe("5 次 / 30 分钟");

  const writeResponse = await page.request.patch(
    "/api/admin/users/registration-risk/params/lockShort",
    {
      headers: { "Content-Type": "application/json", "Idempotency-Key": "C6-POST-RESTORE-NOWRITE" },
      data: {
        value: shortLock.value,
        reason: "post restore permission denial probe",
        operator: fixture.accounts.readonly.username,
        expectedVersion: overview.data?.configVersion,
      },
    },
  );
  expect(writeResponse.status()).toBe(403);

  const link = page.locator('aside a[href="/users/reg-risk"]').first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    await page.locator("aside button").filter({ hasText: /用户与账户/ }).first().click();
  }
  await link.click();
  await expect(page).toHaveURL(/\/users\/reg-risk$/);
  await expect(page.getByRole("button", { name: "只读", exact: true }).first()).toBeDisabled();

  const logoutResponse = await page.request.post("/api/admin/auth/logout");
  expect(logoutResponse.status()).toBe(200);
  expect((await page.request.get("/api/admin/auth/session")).status()).toBe(401);

  writeFileSync(path.join(EVIDENCE_DIR, "c6-readonly-post-restore.json"), JSON.stringify({
    roleCode: session.data?.session?.roleCode,
    overviewStatus: overviewResponse.status(),
    lockShort: shortLock?.value,
    writeStatus: writeResponse.status(),
    logoutStatus: logoutResponse.status(),
    afterLogoutStatus: 401,
  }, null, 2));
});

async function login(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 30_000 }),
    otp.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (!(await shell.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await otp.fill(await freshTotp(account.totpSecret));
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify"
      && candidate.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await response).status()).toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
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

async function freshTotp(secret: string) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 2_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  }
  return currentTotp(secret);
}
