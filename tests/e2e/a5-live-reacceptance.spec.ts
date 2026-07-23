import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const EVIDENCE_DIR = process.env.A5_EVIDENCE_DIR || "D:/workspace/bug-pic/a5-reacceptance-20260718/main";
const API_PATH = "**/api/admin/platform/params-registry";

test("A5 real user flow, owner navigation, filtering and fail-closed recovery states", async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/platform/params-registry");
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(process.env.ADMIN_E2E_USERNAME || "superadmin");
    await page.locator('input[autocomplete="current-password"]').fill(process.env.ADMIN_E2E_PASSWORD || "Admin@123456");
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }

  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();
  await expect(page.getByText("当前服务端值").first()).toBeVisible();
  expect(await page.getByText("当前服务端值").count()).toBeGreaterThanOrEqual(100);
  await expect(page.getByText("参数键 · feature.ops.maintenanceBanner", { exact: true })).toBeVisible();
  await expect(page.getByText("/api/admin/platform/config/overview", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-live-registry.png` });

  const maintenanceCard = page.getByText("参数键 · feature.ops.maintenanceBanner", { exact: true }).locator("xpath=ancestor::article");
  await expect(maintenanceCard.getByText("off", { exact: true })).toBeVisible();
  await maintenanceCard.getByRole("link", { name: /A3 系统配置/ }).click();
  await expect(page).toHaveURL(/\/platform\/config$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();

  await page.getByLabel("筛选业务域").selectOption("J");
  await expect(page.getByText("参数键 · emergency.geo-block", { exact: true })).toBeVisible();
  expect(await page.getByText("当前服务端值").count()).toBe(6);
  await page.getByLabel("搜索参数").fill("兑换闸");
  await expect(page.getByText("参数键 · emergency.gate.exchange", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-filter-owner.png` });
  const j1Card = page.getByText("参数键 · emergency.gate.exchange", { exact: true }).locator("xpath=ancestor::article");
  await j1Card.getByRole("link", { name: /J1 功能闸/ }).click();
  await expect(page).toHaveURL(/\/emergency\/kill-switch$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();
  await page.getByLabel("筛选业务域").selectOption("J");
  await page.getByLabel("搜索参数").fill("地区屏蔽");
  const j2Card = page.getByText("参数键 · emergency.geo-block", { exact: true }).locator("xpath=ancestor::article");
  await j2Card.getByRole("link", { name: /J2 地区屏蔽/ }).click();
  await expect(page).toHaveURL(/\/emergency\/geo-block$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await page.route(API_PATH, (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ code: 403, message: "FORBIDDEN", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("没有查看平台参数寄存器的权限", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-forbidden.png` });

  await page.unrouteAll({ behavior: "wait" });
  const liveResponse = await page.request.get("/api/admin/platform/params-registry");
  expect(liveResponse.ok()).toBeTruthy();
  const inconsistent = await liveResponse.json();
  inconsistent.data.rows[1].canonicalKey = inconsistent.data.rows[0].canonicalKey;
  await page.route(API_PATH, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(inconsistent),
  }));
  await page.reload();
  await expect(page.getByText("数据一致性校验未通过", { exact: true })).toBeVisible();
  await expect(page.getByText("当前服务端值")).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-integrity-fail-closed.png` });

  await page.unrouteAll({ behavior: "wait" });
  await page.route(API_PATH, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "PLATFORM_BACKEND_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("平台参数服务暂时不可用", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-unavailable-retry.png` });

  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByText("当前服务端值").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});
