import { createHmac } from "node:crypto";
import { expect, request, test, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "";
const TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim() || "";

const READ_ENDPOINTS = [
  "/api/admin/risk/multi-account/overview",
  "/api/admin/risk/arbitrage/overview",
  "/api/admin/risk/withdraw-rules/overview",
  "/api/admin/risk/scoring/overview",
  "/api/admin/risk/kyc-review/overview",
  "/api/admin/janus/dashboard",
];

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("K1-K6 匿名读取 401，已认证不存在资源 404，且不触发成功写", async ({ page }) => {
  const anonymous = await request.newContext({ baseURL: BASE_URL });
  try {
    for (const endpoint of READ_ENDPOINTS) {
      const response = await anonymous.get(endpoint);
      expect(response.status(), `anonymous ${endpoint}`).toBe(401);
    }
  } finally {
    await anonymous.dispose();
  }

  await login(page);
  const missing = await page.request.get(`/api/admin/risk/__nonexistent_nonowner_j_${Date.now()}`);
  expect(missing.status()).toBe(404);
});

async function login(page: Page) {
  expect(USERNAME, "ADMIN_E2E_USERNAME is required").not.toBe("");
  expect(PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.locator('input[autocomplete="username"]').fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await loginResponse).status()).toBe(200);
    const otp = page.getByLabel("一次性验证码");
    if (!await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      return;
    }
    expect(TOTP_SECRET, "ADMIN_E2E_TOTP_SECRET is required for an MFA-bound K reviewer").not.toBe("");
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining < 5_000) await page.waitForTimeout(remaining + 500);
    await otp.fill(currentTotp(TOTP_SECRET));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { code?: number; message?: string } | null;
    const hasAuthenticatedCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (payload?.code === 0 || hasAuthenticatedCookie)) {
      await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
      return;
    }
    if (attempt === 0 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.context().clearCookies();
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`K security-boundary MFA failed: HTTP ${response.status()} ${payload?.message ?? "unknown"}`);
  }
  throw new Error("K security-boundary login did not reach the authenticated shell");
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
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
