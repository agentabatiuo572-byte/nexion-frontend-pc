import { expect, test } from "@playwright/test";

test("A6 grant and A7 metadata expose the independent I7 learning page", async ({ page }) => {
  await page.route("**/api/admin/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        data: {
          tokenType: "Bearer",
          session: {
            adminId: 1,
            username: "content.ops",
            operator: "内容运营",
            role: "content",
            roleCode: "CONTENT",
            authorities: ["content_i7_read"],
            effectiveMenus: ["I", "I6", "I7"],
            effectiveMenuNodes: [
              { menuCode: "I", menuName: "内容与合规 CMS", routePath: null, parentCode: null, sortOrder: 9 },
              { menuCode: "I6", menuName: "国际化文案", routePath: "/content/i18n", parentCode: "I", sortOrder: 1 },
              { menuCode: "I7", menuName: "教程配置", routePath: "/content/learn", parentCode: "I", sortOrder: 2 },
            ],
            passwordChangeRequired: false,
          },
        },
      }),
    });
  });

  await page.route("**/api/admin/content/**", async (route) => {
    const isLearningOverview = route.request().url().includes("/i18n-learning/overview");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        data: isLearningOverview ? {
          stats: { managedKeys: 20, totalKeys: 20, integrityIssues: 0, coursesOnline: 1, weeklyNexPayout: "120 NEX" },
          namespaces: [],
          integrityIssues: [],
          hardcodedFindings: [],
          focusMessage: { messageKey: "learn.title", en: "Learn", zh: "学习", status: "published", version: "v1", placeholders: [] },
          courses: [{ id: "learn-1", title: "Nexion 入门", category: "Basics", format: "Article", level: "Beginner", rewardNex: 10, featured: true, duration: "5 min", version: "v1", status: "published", body: "" }],
          rewardRange: { min: 10, max: 50 },
          featuredCourseId: "learn-1",
          metrics: [{ key: "完课率", value: "82%" }],
          categories: ["Basics"],
          formats: ["Article"],
          levels: ["Beginner"],
          statuses: ["published"],
          sources: ["backend"],
        } : {},
      }),
    });
  });

  await page.goto("/content/learn");
  await expect(page.getByText("教程中心(I7) · /learn · 1 课", { exact: true })).toBeVisible();
  await expect(page.getByText("命名空间矩阵(I6 · a)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "+ 新建课程" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "调奖励" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下架" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "换推荐课" })).toHaveCount(0);

  const domainToggle = page.getByRole("button", { name: /内容与合规 CMS/ });
  if (await domainToggle.getAttribute("aria-expanded") === "false") await domainToggle.click();
  const i7Link = page.getByRole("link", { name: /教程配置.*I7/ });
  await expect(i7Link).toBeVisible();
  await expect(i7Link).toHaveAttribute("href", "/content/learn");
  await expect(page).toHaveURL(/\/content\/learn$/);

  await page.goto("/content/i18n");
  await expect(page.getByText("命名空间矩阵(I6 · a)", { exact: true })).toBeVisible();
  await expect(page.getByText("教程中心(I7) · /learn · 1 课", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重扫" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "编辑(中英同步)" })).toHaveCount(0);
});
