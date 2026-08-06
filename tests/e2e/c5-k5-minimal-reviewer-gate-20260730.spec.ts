import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.K_PERMISSION_FIXTURE_PATH;
const EXPECTED_ROLE = "ACC_C5K5_RV_114336";

const DENIED = [
  ["K1", "/risk/multi-account", "/api/admin/risk/multi-account/overview",
    "PATCH", "/api/admin/risk/multi-account/params/sharedIpAccounts", { value: "3", expectedVersion: -1, reason: "C5 gate no mutation" }],
  ["K2", "/risk/abuse", "/api/admin/risk/arbitrage/overview",
    "PATCH", "/api/admin/risk/arbitrage/params/trial.cycleThreshold", { value: "3", expectedVersion: -1, reason: "C5 gate no mutation" }],
  ["K3", "/risk/withdrawal-rules", "/api/admin/risk/withdraw-rules/overview",
    "POST", "/api/admin/risk/withdraw-rules/dry-runs", { reason: "C5 gate no mutation" }],
  ["K4", "/risk/scoring", "/api/admin/risk/scoring/overview",
    "PUT", "/api/admin/risk/scoring/model/draft", { expectedVersion: -1, reason: "C5 gate no mutation" }],
  ["K6", "/risk/janus-c2", "/api/admin/janus/dashboard",
    "POST", "/api/admin/janus/devices/UNKNOWN/status", { status: "disabled", expectedVersion: -1, reason: "C5 gate no mutation" }],
] as const;

test("C5 temporary K5 reviewer is strictly K/K5 and fails closed elsewhere", async ({ page }) => {
  if (!FIXTURE_PATH) throw new Error("K_PERMISSION_FIXTURE_PATH is required");
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    checker: { username: string; password: string; totpSecret: string };
  };
  await login(page, fixture.checker);
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const session = await response.json();
  expect(session.data?.session?.roleCode).toBe(EXPECTED_ROLE);

  const serialized = JSON.stringify(session.data?.session);
  const kAuthorities = Array.from(new Set(
    [...serialized.matchAll(/risk_k[1-6]_[a-z0-9_]+/g)].map((match) => match[0]),
  )).sort();
  expect(kAuthorities).toEqual([
    "risk_k5_read",
    "risk_k5_ticket_pass",
    "risk_k5_ticket_reject",
    "risk_k5_write",
  ]);

  for (const [module, path, readPath, method, writePath, body] of DENIED) {
    expect(await page.locator(`aside a[href="${path}"]`).count(), `${module} menu`).toBe(0);
    const read = await page.request.get(readPath);
    expect(read.status(), `${module} read`).toBe(403);
    const write = await page.request.fetch(writePath, { method, data: body });
    expect(write.status(), `${module} write`).toBe(403);
  }

  const k5 = page.locator('aside a[href="/risk/kyc-review"]');
  const kGroup = page.getByRole("button", { name: /风控与反作弊.*K/ }).first();
  await expect(kGroup).toBeVisible();
  await kGroup.click();
  await expect(k5).toBeVisible();
  await k5.click();
  await expect(page).toHaveURL(/\/risk\/kyc-review/);
  expect((await page.request.get("/api/admin/risk/kyc-review/overview")).status()).toBe(200);
  await expect(page.getByRole("button", { name: "手动补触发", exact: true })).toHaveCount(0);
  await page.request.post("/api/admin/auth/logout");
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
    const verification = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify"
      && candidate.request().method() === "POST");
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
  if (remaining < 2_000) await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  return currentTotp(secret);
}
