import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Fixture = { accounts: { maker?: Account } };

const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const maker: Account = requireMaker(fixture.accounts.maker);

const MODULES = [
  ["J1", "/emergency/kill-switch", /Kill-Switch/],
  ["J2", "/emergency/geo-block", /Geo-block/],
  ["J3", "/emergency/tamper", /篡改防御/],
  ["J4", "/emergency/sop", /应急 SOP|执行追溯/],
] as const;

test("J maker：从可见登录和侧栏无写遍历 J1-J4，刷新和重登保持权限", async ({ page }) => {
  const mutations: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/admin/")
      && !path.startsWith("/api/admin/auth/")
      && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      mutations.push(`${request.method()} ${path}`);
    }
  });

  await login(page);
  for (const [id, path, title] of MODULES) {
    await openFromSidebar(page, path);
    await expect(page.getByText(title).first(), `${id} visible title`).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(title).first(), `${id} survives refresh`).toBeVisible();
  }
  await logout(page);
  await login(page);
  for (const [id, path, title] of MODULES) {
    await openFromSidebar(page, path);
    await expect(page.getByText(title).first(), `${id} survives relogin`).toBeVisible();
  }
  expect(mutations, "maker no-write walkthrough must not send a business command").toEqual([]);
  expect(pageErrors).toEqual([]);
});

async function login(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside");
    if (await shell.isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await page.locator('input[autocomplete="username"]').fill(maker.username);
    await page.locator('input[autocomplete="current-password"]').fill(maker.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    if (await shell.isVisible({ timeout: 5_000 }).catch(() => false)) return;
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 10_000 });
    await otp.fill(freshTotp(maker.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify",
    );
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { code?: number; message?: string } | null;
    if (response.status() === 200 && (payload?.code === undefined || payload.code === 0)) {
      await expect(shell).toBeVisible({ timeout: 20_000 });
      return;
    }
    if (payload?.message !== "ADMIN_MFA_CODE_REPLAYED" || attempt === 1) {
      throw new Error(`maker MFA rejected: HTTP ${response.status()} ${payload?.message ?? "no-message"}`);
    }
    // The server consumes the password challenge even when a valid TOTP step was
    // already used. Wait only for the next standards-defined 30 s step, then
    // create a new password challenge instead of weakening replay protection.
    const untilNextTotpStepMs = 30_000 - (Date.now() % 30_000) + 1_000;
    await page.waitForTimeout(untilNextTotpStepMs);
  }
  throw new Error("maker MFA did not establish a session");
}

async function openFromSidebar(page: Page, path: string) {
  const link = page.locator(`aside a[href="${path}"]`).first();
  if (!(await link.isVisible({ timeout: 1_000 }).catch(() => false))) {
    const group = page.getByRole("button", { name: /紧急与合规控制\s+J|J\s+紧急与合规控制/ }).first();
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
}

async function logout(page: Page) {
  const button = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await button.isVisible({ timeout: 2_000 }).catch(() => false)) await button.click();
  else {
    await page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first().click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

function freshTotp(secret: string) {
  const counter = Math.floor(Date.now() / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/\s+/gu, "").replace(/=+$/gu, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < key.length; index += 1) {
    key[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String(((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

function requireMaker(account: Account | undefined): Account {
  if (!account) throw new Error("J maker account is required");
  return account;
}
