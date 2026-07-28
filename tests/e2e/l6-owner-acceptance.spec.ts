import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = "D:/workspace/bug-pic/l-domain-parallel-acceptance-20260723-000935/L6-behavior-heatmap";

test.use({ trace: "retain-on-failure", video: "off", screenshot: "only-on-failure" });

test("L6 visible-sidebar first-user flow uses canonical filters, drilldown and aggregate export", async ({ page }) => {
  const username = process.env.NEXION_E2E_ADMIN_USER;
  const password = process.env.NEXION_E2E_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("L6_E2E_CREDENTIAL_ENV_REQUIRED");
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const failedResponses: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/bi/") && response.status() >= 400) {
      failedResponses.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await usernameInput.fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  const sidebar = page.locator("aside");
  await expect(sidebar).toBeVisible({ timeout: 20_000 });
  await sidebar.getByRole("button", { name: /数据与分析 BI/ }).click();
  const entry = sidebar.locator('a[href="/analytics/behavior-heatmap"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/analytics\/behavior-heatmap$/);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "visible-entry-initial.png"), fullPage: true });

  await expect(page.getByText("页面活跃热力矩阵")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("访问趋势")).toBeVisible();
  await expect(page.getByLabel("设备筛选")).toBeVisible();
  await expect(page.getByLabel("Locale 筛选")).toBeVisible();
  await page.getByLabel("设备筛选").selectOption("H5");
  await page.getByLabel("Locale 筛选").selectOption("zh-CN");
  await page.getByRole("button", { name: "近 24 小时" }).click();

  await page.getByRole("button", { name: "一级" }).click();
  const aggregateRows = page.locator("table.heat-tbl tbody tr");
  if (await aggregateRows.count()) {
    await aggregateRows.first().click();
    await expect(page.getByText("聚合行不提供单页坐标热力")).toBeVisible({ timeout: 10_000 });
  } else {
    await expect(page.getByText("当前筛选暂无事件").first()).toBeVisible();
  }
  await expect(page.getByRole("img", { name: "单页点击坐标热力" })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "l1-aggregate-filter.png"), fullPage: true });

  await page.getByRole("button", { name: "全部" }).click();
  const firstDataRow = page.locator("table.heat-tbl tbody tr").first();
  if (await firstDataRow.count()) {
    await firstDataRow.click();
    await expect(page.getByRole("img", { name: "单页点击坐标热力" })).toBeVisible();
  }

  const exportButton = page.getByRole("button", { name: /导出当前筛选|空结果不可导出|数据异常不可导出/ });
  if (await firstDataRow.count()) {
    await expect(exportButton).toBeEnabled();
    const download = page.waitForEvent("download");
    await exportButton.click();
    expect((await download).suggestedFilename()).toBe("l6-behavior.csv");
  } else {
    await expect(exportButton).toBeDisabled();
  }
  expect(failedResponses).toEqual([]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/analytics\/behavior-heatmap$/);
  await expect(page.getByText("用户行为热力图", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "l6-owner-pass.png"), fullPage: true });
});
