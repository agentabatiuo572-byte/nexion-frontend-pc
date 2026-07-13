import { expect, test } from "@playwright/test";

const session = {
  adminId: 1,
  username: "superadmin",
  operator: "总管理员",
  role: "superadmin",
  roleCode: "SUPER_ADMIN",
  authorities: ["platform_rbac_read", "content_i1_read"],
  effectiveMenus: ["A", "A1", "I", "I1"],
  effectiveMenuNodes: [
    { menuCode: "A", menuName: "平台基础", routePath: null, parentCode: null, sortOrder: 1 },
    { menuCode: "A1", menuName: "运营账号 & RBAC", routePath: "/platform/rbac", parentCode: "A", sortOrder: 1 },
    { menuCode: "I", menuName: "内容与合规 CMS", routePath: null, parentCode: null, sortOrder: 2 },
    { menuCode: "I1", menuName: "转化文案 A/B", routePath: "/content/copy-ab", parentCode: "I", sortOrder: 1 },
  ],
  passwordChangeRequired: false,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/admin/**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data: {} }) });
  });
  await page.route("**/api/admin/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ code: 0, data: { tokenType: "Bearer", session } }),
    });
  });
});

test("sidebar starts collapsed and keeps only the selected domain expanded", async ({ page }) => {
  await page.goto("/");

  const platform = page.getByRole("button", { name: "平台基础" });
  const content = page.getByRole("button", { name: "内容与合规 CMS" });

  await expect(platform).toHaveAttribute("aria-expanded", "false");
  await expect(content).toHaveAttribute("aria-expanded", "false");

  await platform.click();
  await expect(platform).toHaveAttribute("aria-expanded", "true");
  await expect(content).toHaveAttribute("aria-expanded", "false");

  await content.click();
  await expect(platform).toHaveAttribute("aria-expanded", "false");
  await expect(content).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("link", { name: /转化文案 A\/B.*I1/ }).click();
  await expect(page).toHaveURL(/\/content\/copy-ab$/);
  await expect(platform).toHaveAttribute("aria-expanded", "false");
  await expect(content).toHaveAttribute("aria-expanded", "true");

  await page.getByRole("link", { name: /运营总览/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(platform).toHaveAttribute("aria-expanded", "false");
  await expect(content).toHaveAttribute("aria-expanded", "false");
});
