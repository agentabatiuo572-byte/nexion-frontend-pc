import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "";
const FIXTURE_PATH = process.env.L_PERMISSION_FIXTURE_PATH;
const OWNER = FIXTURE_PATH
  ? (JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      accounts: { maker: { username: string; password: string; totpSecret: string } };
    }).accounts.maker
  : null;

test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeEach(async ({ page }) => {
  if (!OWNER) expect(PASSWORD, "ADMIN_E2E_PASSWORD or L_PERMISSION_FIXTURE_PATH is required").not.toBe("");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(OWNER?.username ?? USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(OWNER?.password ?? PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  if (OWNER) {
    const otp = page.getByLabel("一次性验证码");
    await expect.poll(async () => (await otp.isVisible()) || (await page.locator("aside").isVisible()), {
      timeout: 10_000,
    }).toBe(true);
    if (await otp.isVisible()) {
      await otp.fill(await freshTotp(OWNER.totpSecret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
});

test("L5 畸形 HTTP 200 必须失败关闭且不得暴露写入口", async ({ page }) => {
  await page.route("**/api/admin/bi/export/overview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: {} }),
  }));

  await openFromSidebar(page, "/analytics/export");
  await expect(page.getByText(/L5 数据加载失败/)).toBeVisible();
  await expect(page.getByRole("button", { name: "发起聚合快照" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "导出七类账单明细" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成监管报告" })).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("l5-malformed-200-fail-closed.png"),
    fullPage: true,
  });
});

test("L4 畸形 HTTP 200 必须判定为后端异常且禁用导出", async ({ page }) => {
  await page.route("**/api/admin/bi/operations/overview?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: {} }),
  }));

  await openFromSidebar(page, "/analytics/operations");
  await expect(page.getByText(/L4 数据加载失败/)).toBeVisible();
  await expect(page.getByRole("button", { name: "导出运营报表 CSV" })).toBeDisabled();
});

test("L6 畸形 HTTP 200 必须判定为后端异常且禁用导出", async ({ page }) => {
  await page.route("**/api/admin/bi/behavior?*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: {} }),
  }));

  await openFromSidebar(page, "/analytics/behavior-heatmap");
  await expect(page.getByText(/用户行为热力图 · 加载失败/)).toBeVisible();
  await expect(page.getByRole("button", { name: "行为数据未接入" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /导出.*行为/ })).toHaveCount(0);
});

async function openFromSidebar(page: Page, route: string) {
  const group = page.getByRole("button", { name: /数据与分析 BI/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.locator(`aside a[href="${route}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route)}(?:\\?.*)?$`));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret);
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
