import { expect, test } from "@playwright/test";

/** One-time recovery for the incomplete FINAL fixture bootstrap account. */
test("A1 recovers incomplete FINAL bootstrap account through visible UI", async ({ page }) => {
  const username = process.env.ADMIN_E2E_USERNAME?.trim();
  const password = process.env.ADMIN_E2E_PASSWORD?.trim();
  if (!username || !password) throw new Error("ADMIN_E2E_CREDENTIALS_REQUIRED");
  await page.goto("/");
  if (await page.locator('input[autocomplete="username"]').isVisible().catch(() => false)) {
    await page.locator('input[autocomplete="username"]').fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "继续", exact: true }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  const link = page.locator("aside").getByRole("link", { name: "运营账号 & RBAC A1", exact: true });
  if (!await link.isVisible().catch(() => false)) {
    await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  }
  await link.click();
  const row = page.locator("tbody tr").filter({ hasText: "ffix.check.063700ac" });
  if (await row.count() === 0) return;
  await row.getByRole("button", { name: "禁用", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel(/操作理由/).fill("FINAL_FIXTURE_ADMIN_WINDOW 恢复未完成 bootstrap，立即回收账号与会话");
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/platform/audit/operations"));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await response).status()).toBe(200);
  await page.reload();
  await expect(row).toContainText("禁用", { timeout: 20_000 });
});
