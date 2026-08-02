import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE_PATH;
const EVIDENCE_DIR = process.env.C_NONOWNER_EVIDENCE_DIR;
const USER_ID = process.env.C_NONOWNER_USER_ID || "990000151024";
const ADJUSTMENT_NO = process.env.C3_ADJUSTMENT_NO;

test("C3 exact-restore: original role, C business read, A2 row visibility, logout", async ({ page }) => {
  if (!FIXTURE_PATH || !EVIDENCE_DIR || !ADJUSTMENT_NO) {
    throw new Error("A_PERMISSION_FIXTURE_PATH, C_NONOWNER_EVIDENCE_DIR and C3_ADJUSTMENT_NO are required");
  }
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    accounts: { maker: { username: string; password: string; totpSecret: string } };
  };
  const maker = fixture.accounts.maker;
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  await login(page, maker);
  const sessionResponse = await page.request.get("/api/admin/auth/session");
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  expect(session.data?.session?.roleCode).toBe("ACC_C_MK_114336");
  expect(JSON.stringify(session.data?.session)).toContain("user_c3_adjust_create");

  const contextResponse = await page.request.get(
    `/api/admin/users/profiles/${USER_ID}/asset-adjustment-context`,
  );
  expect(contextResponse.status()).toBe(200);
  const context = await contextResponse.json();
  expect(Number(findKey(context.data, "walletUsdt"))).toBe(0);

  const auditResponse = await page.request.get(
    `/api/admin/platform/audit/logs?bizNo=${encodeURIComponent(ADJUSTMENT_NO)}&limit=200`,
  );
  expect(auditResponse.status()).toBe(200);
  const audit = await auditResponse.json();
  expect(JSON.stringify(audit.data)).toContain(ADJUSTMENT_NO);

  const logoutResponse = await page.request.post("/api/admin/auth/logout");
  expect(logoutResponse.status()).toBe(200);
  const afterLogout = await page.request.get("/api/admin/auth/session");
  expect(afterLogout.status()).toBe(401);

  writeFileSync(path.join(EVIDENCE_DIR, "c3-post-restore-authority.json"), JSON.stringify({
    roleCode: session.data?.session?.roleCode,
    c3ReadStatus: contextResponse.status(),
    walletUsdt: Number(findKey(context.data, "walletUsdt")),
    a2Status: auditResponse.status(),
    a2Rows: Array.isArray(audit.data) ? audit.data.length : null,
    adjustmentNo: ADJUSTMENT_NO,
    logoutStatus: logoutResponse.status(),
    afterLogoutStatus: afterLogout.status(),
  }, null, 2));
});

async function login(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/auth/login"
    && response.request().method() === "POST");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await loginResponse).status()).toBe(200);
  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 30_000 }),
    otp.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (!(await shell.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await otp.fill(await freshTotp(account.totpSecret));
    const verification = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verification).status()).toBe(200);
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

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
    return (value as Record<string, unknown>)[key];
  }
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}
