import { expect, test, type Browser, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

test("G2 acceptance sandbox is visible only as mock/SANDBOX and survives replay, refresh and re-login", async ({ browser, page }, testInfo) => {
  await loginAndOpenG2(page);
  await expect(page.locator('[data-proof="g2-acceptance-sandbox"]')).toBeVisible();
  await expect(page.getByText("Acceptance Sandbox", { exact: true })).toBeVisible();
  await expect(page.getByText(/mock \/ SANDBOX/)).toBeVisible();
  await expect(page.getByText(/swap 全局熔断/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("01-sandbox-badge-and-production-hold.png"), fullPage: true });

  const priorCleanup = page.getByRole("button", { name: "清理验收数据" });
  if (await priorCleanup.isVisible()) {
    await priorCleanup.click();
    await expect(page.getByRole("button", { name: "生成验收批次" })).toBeVisible();
  }
  await page.getByRole("button", { name: "生成验收批次" }).click();
  await expect(page.getByRole("button", { name: "处理验收批次" })).toBeVisible();
  await expect(page.getByText(/-COMPLETED/)).toBeVisible();
  await expect(page.getByText(/-SKIPPED/)).toBeVisible();

  await page.getByRole("button", { name: "处理验收批次" }).click();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  await expect(page.getByText("SKIPPED", { exact: true })).toBeVisible();
  await expect(page.getByText(/归属关系无效/).first()).toBeVisible();
  await expect(page.getByText(/sandbox 账本 2 条/)).toBeVisible();
  await expect(page.getByText(/sandbox 账本 0 条/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("02-completed-skipped-ledger.png"), fullPage: true });

  await page.getByRole("button", { name: "幂等重放" }).click();
  await expect(page.getByText(/已按同一命令号重放/)).toBeVisible();
  await expect(page.getByText(/幂等回放，未重复记账/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("03-idempotency-replay.png"), fullPage: true });

  await page.reload();
  await expect(page.getByText("COMPLETED", { exact: true })).toBeVisible();
  await expect(page.getByText("SKIPPED", { exact: true })).toBeVisible();

  const secondContext = await browser.newContext();
  const reloginPage = await secondContext.newPage();
  await loginAndOpenG2(reloginPage);
  await expect(reloginPage.getByText("Acceptance Sandbox", { exact: true })).toBeVisible();
  await expect(reloginPage.getByText("COMPLETED", { exact: true })).toBeVisible();
  await expect(reloginPage.getByText("SKIPPED", { exact: true })).toBeVisible();
  await reloginPage.screenshot({ path: testInfo.outputPath("04-relogin-persistence.png"), fullPage: true });
  await secondContext.close();

  await page.getByRole("button", { name: "清理验收数据" }).click();
  await expect(page.getByRole("button", { name: "生成验收批次" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("05-cleanup.png"), fullPage: true });
});

async function loginAndOpenG2(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (!await shell.isVisible()) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    await expect(shell).toBeVisible({ timeout: 20_000 });
  }
  await page.getByRole("button", { name: /金融产品\s+G|G\s+金融产品/ }).first().click();
  await page.locator('a[href="/finance-products/exchange"]').first().click();
  await expect(page).toHaveURL(/\/finance-products\/exchange$/);
}
