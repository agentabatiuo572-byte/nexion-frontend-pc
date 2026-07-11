import { expect, test } from "@playwright/test";

test("I1 管理全部文案版本并由系统生成版本号", async ({ page }) => {
  let deleteRequest: { method: string; pathname: string; body: Record<string, unknown> } | undefined;
  let draftDeleted = false;
  let overviewRequests = 0;
  await page.route("**/api/admin/auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        data: {
          tokenType: "Bearer",
          session: {
            adminId: 1,
            username: "superadmin",
            operator: "总管理员",
            role: "superadmin",
            roleCode: "superadmin",
            authorities: ["content_i1_read", "content_i1_write", "content_i1_copy_create"],
            effectiveMenus: ["I1"],
            passwordChangeRequired: false,
          },
        },
      }),
    });
  });

  await page.route("**/api/admin/content/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "DELETE") {
      deleteRequest = {
        method: request.method(),
        pathname: url.pathname,
        body: request.postDataJSON() as Record<string, unknown>,
      };
      draftDeleted = true;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 200, data: {} }) });
      return;
    }
    overviewRequests += 1;
    if (!route.request().url().includes("/copy-ab/overview")) {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 200, data: {} }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        code: 200,
        data: {
          stats: { managedCopies: 1, runningExps: 1, weeklyExposures: "12,000", topLift: "+8%" },
          copies: [{ key: "home.hero", desc: "首页主横幅", surface: "home", version: "v1", status: "published", i18nKey: "home.hero", expId: "", lastChange: "刚刚", copyPosition: "home.hero", draftVersion: draftDeleted ? undefined : "v2", revision: 7 }],
          versions: [
            { copyKey: "home.hero", version: "v1", status: "published", chain: "创建 → 发布", ts: "刚刚", zh: "欢迎回来", vi: "Chào mừng trở lại", en: "Welcome back", copyPosition: "home.hero", surface: "home", audience: "P1-P6 · 全语言 · 注册>0天", trafficSplit: "50", versionNote: "首版" },
            ...(!draftDeleted ? [{ copyKey: "home.hero", version: "v2", status: "draft", chain: "草稿保存", ts: "刚刚", zh: "欢迎回来 2", vi: "Chào mừng trở lại 2", en: "Welcome back 2", copyPosition: "home.hero", surface: "home", audience: "P1-P6 · 全语言 · 注册>0天", trafficSplit: "50", versionNote: "待发布" }] : []),
          ],
          experiments: [{ id: "EXP-1", copyKey: "other.copy", variants: [{ name: "A · v1", split: 50, cvr: 5.2 }, { name: "B · v2", split: 50, cvr: 5.6 }], audience: "P1-P6 · 全语言 · 注册>0天", estimatedAudience: 18420, impressions: "12,000", conversions: "648", state: "running", note: "进行中" }],
          frameworkParams: [],
          positions: [{ positionKey: "home.hero", name: "首页主横幅", surface: "home", status: "ACTIVE", sortOrder: 1 }],
          surfaces: ["home", "store", "earn", "me"],
          audiences: [],
          trafficSplits: ["50"],
          tables: [],
        },
      }),
    });
  });

  await page.goto("/content/copy-ab");
  const versionList = page.locator('[data-proof="copy-version-list"]');
  await expect(versionList.getByText("文案版本列表(b)")).toBeVisible();
  await expect(versionList.locator("tbody tr")).toHaveCount(2);
  await expect(versionList.locator("tbody tr").first()).toContainText("首页主横幅");
  await expect(versionList.locator("tbody tr").first()).toContainText("home.hero");
  await expect(versionList.locator("tbody tr").first()).toContainText("v1");
  await expect(versionList.getByRole("columnheader", { name: "文案标识" })).toBeVisible();
  await expect(versionList.getByRole("columnheader", { name: "文案位置" })).toBeVisible();
  await expect(versionList.getByRole("columnheader", { name: "中英越文案" })).toBeVisible();

  await versionList.getByRole("button", { name: "已发布" }).click();
  const publishedRows = versionList.locator("tbody tr");
  await expect(publishedRows).toHaveCount(1);
  await expect(versionList.getByText("published", { exact: true })).toBeVisible();
  await expect(page.getByText("预计覆盖 18,420 人")).toBeVisible();

  await versionList.getByRole("button", { name: "草稿", exact: true }).click();
  const draftRow = versionList.locator("tbody tr").filter({ hasText: "v2" });
  await expect(draftRow.getByRole("button", { name: "删除草稿" })).toBeVisible();
  await draftRow.getByRole("button", { name: "删除草稿" }).click();
  const deleteDialog = page.getByRole("dialog");
  await expect(deleteDialog).toContainText("只有草稿版本可以删除");
  await expect(deleteDialog).toContainText("删除后不可恢复");
  await expect(deleteDialog).toContainText("保留审计");
  await deleteDialog.getByRole("textbox").fill("清理误建草稿版本");
  await deleteDialog.getByRole("button", { name: "确认执行" }).click();
  await expect.poll(() => deleteRequest?.method).toBe("DELETE");
  expect(deleteRequest?.pathname).toBe("/api/admin/content/copy-ab/copies/home.hero/versions/v2");
  expect(deleteRequest?.body).toMatchObject({ reason: "清理误建草稿版本", expectedVersion: "v2", expectedRevision: 7 });
  await expect(draftRow).toHaveCount(0);
  expect(overviewRequests).toBeGreaterThan(1);
  await versionList.getByRole("button", { name: "已发布", exact: true }).click();
  await expect(versionList.getByRole("button", { name: "删除草稿" })).toHaveCount(0);

  await page.getByRole("button", { name: "+ 新增文案" }).click();
  const createForm = page.locator('[data-business-form="copy-create"]');
  await expect(createForm).toBeVisible();
  await expect(createForm.locator('[data-proof="copy-system-version"]')).toContainText("v1 · 系统自动生成");
  await expect(createForm.getByRole("textbox", { name: /首版版本号/ })).toHaveCount(0);
});
