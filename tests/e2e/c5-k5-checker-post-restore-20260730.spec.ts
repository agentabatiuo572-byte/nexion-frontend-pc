import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.K_PERMISSION_FIXTURE_PATH;
const EVIDENCE_DIR = process.env.C5_REVIEW_EVIDENCE_DIR;

test("C5/K5 exact restore: original checker role is read-only, then logout", async ({ page }) => {
  if (!FIXTURE_PATH || !EVIDENCE_DIR) {
    throw new Error("K_PERMISSION_FIXTURE_PATH and C5_REVIEW_EVIDENCE_DIR are required");
  }
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    checker: { username: string; password: string; totpSecret: string };
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  await login(page, fixture.checker);
  const sessionResponse = await page.request.get("/api/admin/auth/session");
  expect(sessionResponse.status()).toBe(200);
  const session = await sessionResponse.json();
  expect(session.data?.session?.roleCode).toBe("ACC_CHECKER_114336");

  const k5Read = await page.request.get("/api/admin/risk/kyc-review/overview");
  expect(k5Read.status()).toBe(200);
  const k5Write = await page.request.post(
    "/api/admin/risk/kyc-review/tickets/KR-C5-NOT-EXIST/decision",
    {
      headers: { "Content-Type": "application/json", "Idempotency-Key": "C5-POST-RESTORE-NOWRITE" },
      data: { decision: "passed", expectedVersion: 0, reason: "post restore permission denial probe" },
    },
  );
  expect(k5Write.status()).toBe(403);
  const a2Read = await page.request.get("/api/admin/platform/audit/logs?limit=1");
  expect(a2Read.status()).toBe(200);

  const logoutResponse = await page.request.post("/api/admin/auth/logout");
  expect(logoutResponse.status()).toBe(200);
  const afterLogout = await page.request.get("/api/admin/auth/session");
  expect(afterLogout.status()).toBe(401);

  writeFileSync(path.join(EVIDENCE_DIR, "c5-k5-checker-post-restore.json"), JSON.stringify({
    roleCode: session.data?.session?.roleCode,
    k5ReadStatus: k5Read.status(),
    k5WriteStatus: k5Write.status(),
    a2ReadStatus: a2Read.status(),
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
