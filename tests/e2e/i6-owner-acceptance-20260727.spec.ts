import { expect, test, type Page, type Response } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const EVIDENCE = process.env.I6_EVIDENCE_ROOT
  ?? "D:/workspace/bug-pic/pc-full-acceptance-20260726/I6";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

test("I6 首次用户从可见入口进入，理解三语词条、版本与恢复路径", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedReads: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => collectServerFailure(response, failedReads));

  await visibleLogin(page);
  await openI6(page);
  await expectI6Ready(page);

  await expect(page.getByText("命名空间矩阵(I6 · a)", { exact: true })).toBeVisible();
  const catalog = section(page, "词条列表");
  await expect(catalog.locator("tbody tr").first()).toBeVisible();
  await catalog.locator("tbody tr").first().click();

  const detail = page.getByText(/词条详情 ·/).locator("xpath=ancestor::section[1]");
  await expect(detail).toBeVisible();
  await expect(detail.getByText(/^ZH ·/)).toBeVisible();
  await expect(detail.getByText(/^EN ·/)).toBeVisible();
  await expect(detail.getByText(/^VI ·/)).toBeVisible();
  await expect(detail.getByText("历史版本", { exact: true })).toBeVisible();
  await expect(detail.locator("tbody tr").first()).toBeVisible();
  await screenshot(page, "01-visible-entry-and-version-history.png");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI6Ready(page);
  await logout(page);
  await visibleLogin(page);
  await openI6(page);
  await expectI6Ready(page);
  await screenshot(page, "02-refresh-and-relogin.png");

  expect(pageErrors).toEqual([]);
  expect(failedReads).toEqual([]);
});

test("I6 原始 HTML 被服务端拒绝，确认窗保留输入并给出恢复出口", async ({ page }) => {
  await visibleLogin(page);
  await openI6(page);
  await expectI6Ready(page);

  await page.getByRole("button", { name: "新增词条", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const localizedForm = page.locator('[role="dialog"]:visible [data-business-form="localized-copy"]');
  const keyInput = localizedForm.locator('input[type="text"]').first();
  const zhInput = localizedForm.locator("textarea").nth(0);
  const enInput = localizedForm.locator("textarea").nth(1);
  const viInput = localizedForm.locator("textarea").nth(2);
  const key = `acceptance.i6.html_${Date.now()}`;
  await keyInput.fill(key);
  const html = "<img src=x onerror=alert(1)>";
  await zhInput.fill(html);
  await enInput.fill(html);
  await viInput.fill(html);
  await dialog.getByLabel(/操作理由\(必填/).fill("验收原始 HTML 必须失败关闭并保留输入");

  const rejected = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && response.url().includes(`/api/admin/content/i18n-learning/messages/${key}/draft`),
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const response = await rejected;
  expect([400, 422]).toContain(response.status());
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/不符合|失败|HTML|文案/);
  await expect(localizedForm).toBeVisible();
  await expect(keyInput).toHaveValue(key);
  await expect(zhInput).toHaveValue(html);
  await expect(enInput).toHaveValue(html);
  await expect(viInput).toHaveValue(html);
  await screenshot(page, "03-html-rejected-and-form-retained.png");

  const recoveryCopy = "验收恢复后的安全文案";
  await zhInput.fill(recoveryCopy);
  await enInput.fill("Safe copy after rejected HTML");
  await viInput.fill("Nội dung an toàn sau khi HTML bị từ chối");
  await expect(zhInput).toHaveValue(recoveryCopy);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI6Ready(page);
  await expect(page.getByText(key, { exact: true })).toHaveCount(0);
});

function section(page: Page, title: string) {
  return page.getByText(title, { exact: true }).locator("xpath=ancestor::section[1]");
}

async function visibleLogin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  if (await shell.isVisible({ timeout: 5_000 }).catch(() => false)) return;
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible();
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openI6(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const entry = page.locator("a[href='/content/i18n']").first();
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/content\/i18n$/);
}

async function expectI6Ready(page: Page) {
  await expect(page.getByText("I6 数据加载中...")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText("I6 暂无真实接口数据")).toHaveCount(0);
  await expect(section(page, "词条列表")).toBeVisible();
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await direct.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await direct.click();
    return;
  }
  const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
  await account.click();
  await page.getByText(/退出登录|登出/, { exact: true }).first().click();
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: path.join(EVIDENCE, name), fullPage: true });
}

function collectServerFailure(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}
