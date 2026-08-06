import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type Fixture = { account?: FixtureAccount; accounts?: { maker?: FixtureAccount } };

const baseUrl = process.env.ADMIN_BASE_URL?.trim() || "http://127.0.0.1:3102";
const fixturePath = required("M_FINAL12_FIXTURE_PATH");
const evidenceDir = path.resolve(required("M_FINAL12_EVIDENCE_DIR"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const makerCandidate = fixture.account ?? fixture.accounts?.maker;
if (!makerCandidate) throw new Error("M_FINAL12_MAKER_REQUIRED");
const maker: FixtureAccount = makerCandidate;
const usedSteps = new Set<number>();

test("M-FINAL12-001: M5 refresh and MFA relogin reload the M3 authoritative initiate identity", async ({ page }) => {
  const supportAgentStatuses: number[] = [];
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/admin/content/support-agents") supportAgentStatuses.push(response.status());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await login(page);
  await openVisibleModule(page, "/service/scripts");
  await expect(page.getByText("会话类别", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("会话类别", { exact: true })).toBeVisible();

  await logout(page);
  await login(page);
  await openVisibleModule(page, "/service/sessions");
  const start = page.getByRole("button", { name: "主动发起会话", exact: true });
  await expect(start).toBeVisible();
  await start.click();
  const dialog = page.getByRole("dialog").last();
  const identity = dialog.locator("select").first();
  await expect(identity).toBeVisible();
  await expect.poll(async () => identity.locator("option").count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect(identity.locator("option").first()).not.toHaveText("暂无可发起身份");
  await expect.poll(() => supportAgentStatuses.filter((status) => status === 200).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, "m5-refresh-relogin-m3-identity.png"), fullPage: true });
  writeFileSync(path.join(evidenceDir, "runtime-result.json"), JSON.stringify({
    baseUrl,
    supportAgentStatuses,
    pageErrors,
    consoleErrors,
    identity: await identity.locator("option").first().innerText(),
  }, null, 2));
  expect(pageErrors).toEqual([]);
});

test("M-005: M3 keeps the initiate identity fail-closed for 401, 500, timeout and malformed 200, then recovers only from a new authoritative read", async ({ page }) => {
  await login(page);
  await openVisibleModule(page, "/service/sessions");
  const start = page.getByRole("button", { name: "主动发起会话", exact: true });
  await expect(start).toBeVisible();

  const cases: Array<[string, (route: Route) => Promise<void>]> = [
    ["401", async (route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: 401, message: "AUTH_REQUIRED" }) })],
    ["500", async (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "FAILED" }) })],
    ["timeout", async (route) => route.abort("timedout")],
    ["malformed-200", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{malformed" })],
  ];

  for (const [name, handler] of cases) {
    await page.route("**/api/admin/content/support-agents", handler);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(start).toBeVisible();
    await start.click();
    const identity = page.getByRole("dialog").last().locator("select").first();
    await expect(identity.locator("option").first(), `${name} must never retain a prior identity`).toHaveText("暂无可发起身份");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.unrouteAll({ behavior: "wait" });
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(start).toBeVisible();
  await start.click();
  const recoveredIdentity = page.getByRole("dialog").last().locator("select").first().locator("option").first();
  await expect(recoveredIdentity).not.toHaveText("暂无可发起身份");
});

async function openVisibleModule(page: Page, href: string) {
  const link = page.locator(`aside a[href="${href}"]`).first();
  const group = page.locator("aside").getByRole("button", { name: /客服.*M|M.*客服/ }).first();
  if (!await link.isVisible().catch(() => false)) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}(?:\\?.*)?$`));
}

async function login(page: Page) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(maker.username);
  await page.locator('input[autocomplete="current-password"]').fill(maker.password);
  const passwordLogin = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await passwordLogin).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const step = Math.floor(Date.now() / 30_000);
    const remaining = 30_000 - (Date.now() % 30_000);
    if (usedSteps.has(step) || remaining < 3_000) await page.waitForTimeout(remaining + 600);
    usedSteps.add(Math.floor(Date.now() / 30_000));
    await otp.fill(totp(maker.totpSecret));
    const verified = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    if ((await verified).status() === 200) break;
    if (attempt === 2) throw new Error("M_FINAL12_MFA_LOGIN_FAILED");
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  const accountMenu = page.locator('header button[aria-haspopup="menu"]').last();
  await accountMenu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
