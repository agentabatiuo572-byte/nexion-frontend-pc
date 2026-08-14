import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const USERNAME = requiredEnv("ADMIN_E2E_USERNAME");
const PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const EVIDENCE_DIR = requiredEnv("D7_EVIDENCE_DIR");

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /^(登录|继续)$/ }).click();
  expect((await responsePromise).status()).toBeLessThan(400);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openSandbox(page: Page) {
  await page.goto("/finance/payout-vnd", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("隔离 Mock / Sandbox 出款验证", { exact: false })).toBeVisible({ timeout: 20_000 });
  await page.getByText("沙箱用户 ID", { exact: true }).locator("xpath=../..").locator("input").fill("52");
  await page.getByRole("button", { name: "刷新恢复", exact: true }).click();
}

test("D7 visible sandbox action persists through refresh and re-login", async ({ page }) => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const network: Array<{ method: string; path: string; status: number }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/admin/finance/payout-vnd")) {
      network.push({ method: response.request().method(), path: url.pathname, status: response.status() });
    }
  });

  await login(page);
  await openSandbox(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "00-sandbox-visible.png"), fullPage: true });

  const createResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/finance/payout-vnd/sandbox/orders"
      && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建 100,000₫ 沙箱单", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("D7 acceptance isolated sandbox order");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBeLessThan(400);
  const createBody = await createResponse.json();
  const orderNo = String(createBody?.data?.orderNo ?? createBody?.orderNo ?? "");
  expect(orderNo).toMatch(/^PVN-MOCK-[A-F0-9]+$/);
  await expect(page.getByText(new RegExp(`${escaped(orderNo)}\\s*·\\s*PENDING`))).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-created-pending.png"), fullPage: true });

  const callbackResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/payout-vnd/sandbox/callbacks")
      && response.request().method() === "POST");
  await page.locator(".p-row").filter({ hasText: orderNo })
    .getByRole("button", { name: "模拟签名成功回调", exact: true }).click();
  expect((await callbackResponsePromise).status()).toBeLessThan(400);
  await expect(page.getByText(new RegExp(`${escaped(orderNo)}\\s*·\\s*COMPLETED`))).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-completed.png"), fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await openSandbox(page);
  await expect(page.getByText(new RegExp(`${escaped(orderNo)}\\s*·\\s*COMPLETED`))).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-after-refresh.png"), fullPage: true });

  await page.locator('header button[aria-haspopup="menu"]').first().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
  await login(page);
  await openSandbox(page);
  await expect(page.getByText(new RegExp(`${escaped(orderNo)}\\s*·\\s*COMPLETED`))).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-after-relogin.png"), fullPage: true });

  const summary = {
    orderNo,
    source: "mock",
    sandbox: true,
    completedAfterRefresh: true,
    completedAfterRelogin: true,
    refreshVerified: true,
    reloginVerified: true,
    network,
  };
  fs.writeFileSync(path.join(EVIDENCE_DIR, "action-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  expect(network).toEqual(expect.arrayContaining([
    expect.objectContaining({ method: "POST", path: "/api/admin/finance/payout-vnd/sandbox/orders", status: 200 }),
    expect.objectContaining({ method: "POST", path: "/api/admin/finance/payout-vnd/sandbox/callbacks", status: 200 }),
  ]));
});
