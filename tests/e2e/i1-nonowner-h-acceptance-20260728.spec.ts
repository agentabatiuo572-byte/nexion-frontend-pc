import { expect, test, type Page, type Response } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR =
  process.env.I1_REVIEW_EVIDENCE_DIR ||
  "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/I/review-H/I1-visible";

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("I1 非 Owner 首次用户从可见入口核对文案、版本、实验并经刷新重登恢复", async ({ page }) => {
  const pageErrors: string[] = [];
  const unexpected5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => collectUnexpected5xx(response, unexpected5xx));

  await login(page);
  await openI1(page);
  await expectI1Ready(page);

  const positions = page.locator('[data-proof="copy-position-list"]');
  const versionCatalog = page.locator('[data-proof="copy-version-catalog"]');
  const copyPool = page.locator('[data-proof="copy-pool"]');
  const versionHistory = page.locator('[data-proof="copy-version-list"]');
  await expect(positions.getByText("文案位置配置", { exact: true })).toBeVisible();
  await expect(versionCatalog.getByText("文案版本列表", { exact: true })).toBeVisible();
  await expect(copyPool.getByText("文案池(a)", { exact: true })).toBeVisible();
  await expect(versionHistory.getByText("文案内容历史(b)", { exact: true })).toBeVisible();
  await expect(page.getByText("A/B 实验面板(c)", { exact: true })).toBeVisible();
  await expect.poll(() => positions.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect.poll(() => versionCatalog.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect.poll(() => copyPool.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect.poll(() => versionHistory.locator("tbody tr").count()).toBeGreaterThan(0);
  await expect(versionHistory.getByRole("columnheader", { name: "中英越文案" })).toBeVisible();

  for (const label of ["全部", "首页", "商城", "赚取", "我的"]) {
    await copyPool.getByRole("button", { name: label, exact: true }).click();
    await expect(copyPool.locator("tbody")).toBeVisible();
  }
  await copyPool.getByRole("button", { name: "全部", exact: true }).click();

  await page.getByRole("button", { name: "+ 新增版本", exact: true }).click();
  await expect(page.locator('[data-business-form="copy-version-option-create"]')).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();

  await page.getByRole("button", { name: "+ 新增文案", exact: true }).click();
  const createForm = page.locator('[data-business-form="copy-create"]');
  await expect(createForm).toBeVisible();
  await expect(createForm.getByLabel("文案版本")).toBeVisible();
  await expect(createForm.getByLabel("中文 zh 文案")).toBeVisible();
  await expect(createForm.getByLabel("英文 en copy")).toBeVisible();
  await expect(createForm.getByLabel("越南语 vi 文案")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-visible-entry-and-readonly-authoring.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI1Ready(page);
  await logout(page);
  await login(page);
  await openI1(page);
  await expectI1Ready(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-refresh-relogin.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
  expect(unexpected5xx).toEqual([]);
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await expect(username).toBeVisible();
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openI1(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/content/copy-ab"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/content\/copy-ab(?:\?.*)?$/);
}

async function expectI1Ready(page: Page) {
  await expect(page.getByText("I1 数据加载中...")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("I 域数据加载失败", { exact: false })).toHaveCount(0);
  await expect(page.locator('[data-proof="copy-pool"]')).toBeVisible();
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const account = page
      .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
      .first();
    await account.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

function collectUnexpected5xx(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}
