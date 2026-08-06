import { expect, test, type Page, type Response } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loginHMaker } from "./h-owner-mfa";

const evidenceDir = resolve(
  process.env.H4_EVIDENCE_DIR
    || resolve(process.cwd(), "docs", "验收报告", "PC全面测试-20260726", "H4-evidence"),
);

test("H4 活动中心从可见入口进入并完成只读业务走查", async ({ page }) => {
  const runtimeErrors: string[] = [];
  const serverFailures: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => collectServerFailure(response, serverFailures));

  await login(page);
  const growthGroup = page
    .getByRole("button", { name: /(增长与运营节奏\s+H|H\s+增长与运营节奏)/ })
    .first();
  if (await growthGroup.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await growthGroup.click();
  }
  const entry = page.locator('a[href="/growth/events"]').first();
  await expect(entry, "H4 必须有当前角色可见的侧栏入口").toBeVisible();
  await entry.click();

  await expect(page).toHaveURL(/\/growth\/events(?:\?.*)?$/);
  await expect(page.getByText(/\bH4\b/).first()).toBeVisible();
  await expect(page.getByText(/活动列表/).first()).toBeVisible();
  await expect(page.getByText("抽奖转盘治理", { exact: true })).toBeVisible();
  await expect(page.getByText(/Trackable 可追踪活动监控/).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /数据加载失败|BACKEND_UNAVAILABLE|SQLSyntaxErrorException|NoSuchMethodError|ReferenceError|TypeError/i,
  );

  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({
    path: resolve(evidenceDir, "h4-visible-entry.png"),
    fullPage: true,
  });

  expect(runtimeErrors, "H4 页面不应有未处理脚本错误").toEqual([]);
  expect(serverFailures, "H4 页面读取不应返回 5xx").toEqual([]);
});

async function login(page: Page) {
  await loginHMaker(page);
}

function collectServerFailure(response: Response, failures: string[]) {
  if (response.status() < 500) return;
  const path = new URL(response.url()).pathname;
  if (!path.includes("/api/admin/")) return;
  failures.push(`${response.request().method()} ${response.status()} ${path}`);
}
