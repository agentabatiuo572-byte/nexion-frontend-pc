import { expect, test } from "@playwright/test";

const username = process.env.A_MFA_RECOVERY_OPERATOR_USERNAME?.trim();
const password = process.env.A_MFA_RECOVERY_OPERATOR_PASSWORD;
if (!username || !password) throw new Error("A_MFA_RECOVERY_OPERATOR_USERNAME and A_MFA_RECOVERY_OPERATOR_PASSWORD are required");

test("local recovery superadmin enters console without MFA", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const login = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await login).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("一次性验证码")).toHaveCount(0);
});
