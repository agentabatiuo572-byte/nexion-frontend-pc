import { expect, test, type Page } from "@playwright/test";

const username = process.env.ADMIN_E2E_USERNAME;
const password = process.env.ADMIN_E2E_PASSWORD;

test.beforeEach(async ({ page }) => {
  if (!username || !password) throw new Error("L4 acceptance credentials must be supplied through environment variables");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await usernameInput.fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
});

test("L4 exposes the complete four-report workspace from the visible sidebar", async ({ page }) => {
  await openFromSidebar(page);
  await expect(page.getByText("历史运营报表", { exact: true })).toBeVisible();
  for (const label of ["设备运营报表", "任务承接报表", "网络与团队报表", "Phase 节奏效果报表"]) {
    const tab = page.getByRole("tab", { name: label, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page.getByText(label, { exact: true }).last()).toBeVisible();
  }
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity|当前仅支持实时快照/);
});

test("L4 period and Phase controls refresh the real operations endpoint", async ({ page }) => {
  await openFromSidebar(page);
  const monthResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/api/admin/bi/operations/overview") && new URL(response.url()).searchParams.get("period") === "month");
  await page.getByRole("button", { name: "月", exact: true }).click();
  expect((await monthResponse).status()).toBeLessThan(400);

  const phaseResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/api/admin/bi/operations/overview") && new URL(response.url()).searchParams.get("phase") === "P2");
  await page.getByLabel("Phase 筛选").selectOption("P2");
  expect((await phaseResponse).status()).toBeLessThan(400);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("历史运营报表", { exact: true })).toBeVisible();
});

async function openFromSidebar(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/operations"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/operations$/);
}
