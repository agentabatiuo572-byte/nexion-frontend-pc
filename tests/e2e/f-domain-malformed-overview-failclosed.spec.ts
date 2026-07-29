import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

const MODULES = [
  {
    id: "F1",
    path: "/network/v-rank",
    api: "/api/admin/teams/ranks",
    error: /F1 数据加载失败/,
  },
  {
    id: "F2",
    path: "/network/royalty",
    api: "/api/admin/teams/rates",
    error: /F2 数据加载失败/,
  },
  {
    id: "F3",
    path: "/network/binary",
    api: "/api/admin/teams/binary",
    error: /F3 数据加载失败/,
  },
  {
    id: "F4",
    path: "/network/leadership-pool",
    api: "/api/admin/teams/leadership-pool",
    error: /F4 数据加载失败/,
  },
  {
    id: "F5",
    path: "/network/commissions",
    api: "/api/admin/teams/commissions",
    error: /加载失败.*F5_OVERVIEW_RESPONSE_INVALID/,
  },
] as const;

test.describe("F1-F5 malformed 200 fail closed", () => {
  for (const module of MODULES) {
    test(`${module.id} rejects an incomplete successful envelope`, async ({ page }) => {
      await login(page);
      await page.route(`**${module.api}**`, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ code: 0, message: "OK", data: {} }),
        });
      });

      const group = page.getByRole("button", { name: /分销与团队/ }).first();
      if (await group.isVisible().catch(() => false)
        && (await group.getAttribute("aria-expanded")) !== "true") {
        await group.click();
      }
      const entry = page.locator(`aside a[href="${module.path}"]`).first();
      await expect(entry).toBeVisible();
      await entry.click();
      await expect(page).toHaveURL(new RegExp(`${module.path.replaceAll("/", "\\/")}$`));
      await expect(page.getByText(module.error).first()).toBeVisible();
    });
  }
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 3_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible();
}
