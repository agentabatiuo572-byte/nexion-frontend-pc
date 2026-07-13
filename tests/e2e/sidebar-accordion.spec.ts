import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await installAuthenticatedAdmin(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "nexion-admin-ui-v1",
      JSON.stringify({
        state: {
          sidebarCollapsed: false,
          expandedGroups: ["A", "B"],
          density: "normal",
        },
        version: 1,
      }),
    );
  });
});

test("sidebar starts collapsed and keeps only the selected group open", async ({ page }) => {
  // 即使当前路由属于 B 域，首次进入时也不应自动展开 B 域。
  await page.goto("/overview/dual-ledger");

  const platform = page.getByRole("button", { name: /平台基础/ });
  const overview = page.getByRole("button", { name: /总览驾驶舱/ });
  const users = page.getByRole("button", { name: /用户与账户/ });

  await expect(platform).toHaveAttribute("aria-expanded", "false");
  await expect(overview).toHaveAttribute("aria-expanded", "false");
  await expect(users).toHaveAttribute("aria-expanded", "false");

  await overview.click();
  await expect(overview).toHaveAttribute("aria-expanded", "true");
  await expect(platform).toHaveAttribute("aria-expanded", "false");

  await users.click();
  await expect(users).toHaveAttribute("aria-expanded", "true");
  await expect(overview).toHaveAttribute("aria-expanded", "false");

  const persistedUi = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("nexion-admin-ui-v1") ?? "null"),
  );
  expect(persistedUi.state.expandedGroups).toBeUndefined();

  await page.reload();
  await expect(users).toHaveAttribute("aria-expanded", "false");
});

async function installAuthenticatedAdmin(page: Page) {
  const session = {
    tokenType: "Bearer",
    session: {
      adminId: 9002,
      username: "e2e_sidebar_admin",
      operator: "E2E Sidebar Admin",
      role: "superadmin",
      authorities: ["*"],
    },
  };

  await page.route("**/api/admin/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, data: session }),
    });
  });
}
