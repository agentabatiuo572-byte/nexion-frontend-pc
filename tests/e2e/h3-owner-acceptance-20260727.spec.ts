import { expect, test, type Page, type Response } from "@playwright/test";
import path from "node:path";
import { loginHMaker } from "./h-owner-mfa";

const evidenceDir = path.resolve(
  process.env.H3_EVIDENCE_DIR || "docs/验收报告/PC全面测试-20260726/H3-evidence",
);

test("H3 visible-entry task-engine walkthrough and H1 cross-domain link", async ({ page }) => {
  const backendFailures: string[] = [];
  const questResponses: Array<{ status: number; path: string }> = [];
  page.on("response", (response: Response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/api/admin/growth/quest-events/tasks")) {
      questResponses.push({ status: response.status(), path: url.pathname });
    }
    if (url.pathname.includes("/api/admin/") && response.status() >= 500) {
      backendFailures.push(`${response.status()} ${url.pathname}`);
    }
  });

  await login(page);
  const growthGroup = page.getByRole("button", { name: /增长与运营节奏\s+H|H\s+增长与运营节奏/ }).first();
  if (await growthGroup.isVisible().catch(() => false)) await growthGroup.click();
  await page.locator('a[href="/growth/quest"]').first().click();

  await expect(page).toHaveURL(/\/growth\/quest$/);
  await expect(page.getByText("H3", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/首日任务\(Day-One\)/)).toBeVisible();
  await expect(page.getByText(/每周任务\(两档 \+ 周冠军\)/)).toBeVisible();
  await expect(page.getByText(/任务事件契约与归因/)).toBeVisible();
  await expect(page.getByText(/月度挑战\(按账龄派发\)/)).toBeVisible();
  await expect(page.getByText(/本周转化卡/).first()).toBeVisible();
  await expect(page.locator('[data-proof="h3-event-contract"]')).toBeVisible();
  await expect.poll(() => questResponses.length).toBeGreaterThan(0);
  expect(questResponses.every((item) => item.status === 200)).toBe(true);
  expect(backendFailures).toEqual([]);

  const rewardButton = page.getByRole("button", { name: "改奖励" }).first();
  if (await rewardButton.isVisible().catch(() => false)) {
    await rewardButton.click();
    await expect(page.getByRole("dialog")).toContainText(/当前奖励|覆盖率红线/);
    await page.getByRole("button", { name: "关闭" }).click();
  }

  await page.screenshot({
    path: path.join(evidenceDir, "h3-task-engine-visible-entry.png"),
    fullPage: true,
  });

  const h1 = page.locator('a[href="/growth/phase"]').last();
  await expect(h1).toBeVisible();
  await h1.click();
  await expect(page).toHaveURL(/\/growth\/phase$/);
  await expect(page.getByText("H1", { exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/growth\/quest$/);
  await expect(page.getByText(/任务事件契约与归因/)).toBeVisible();
});

async function login(page: Page) {
  await loginHMaker(page);
}
