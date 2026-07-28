import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

test.describe("F2 owner read-only acceptance", () => {
  test("visible entry, canonical copy, controls, refresh and relogin", async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    await login(page);
    await openF2(page);
    await expect(page.getByText("L1–L7 网络版税费率(Unilevel)")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("f2-page.png"), fullPage: true });

    const body = page.locator("body");
    await expect(body).toContainText("Partner Status 权益档");
    await expect(body).toContainText("Standard");
    await expect(body).toContainText("Verified");
    await expect(body).toContainText("Premium");
    await expect(body).toContainText("Diamond");
    await expect(body).not.toContainText(/Rate Tier 升档|bronze\/silver\/gold|Direct Royalty 与 Network L1/);
    await expect(body).toContainText("L1 是唯一 10% 直推来源");

    const rows = page.locator(".casc-row");
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toContainText("固定 10%");
    await expect(rows.first().getByRole("button", { name: "调整" })).toHaveCount(0);
    await rows.nth(1).getByRole("button", { name: "调整" }).click();
    const rateDialog = page.locator('[role="dialog"]:visible').last();
    await expect(rateDialog).toContainText(/网络版税 L2 费率调整/);
    await expect(rateDialog).toContainText(/B1|覆盖率/);
    await page.screenshot({ path: test.info().outputPath("f2-rate-confirm.png"), fullPage: true });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "单层暂停管理" }).click();
    const pauseDialog = page.locator('[role="dialog"]:visible').last();
    await expect(pauseDialog).toContainText("L1 直推");
    await expect(pauseDialog).toContainText("L7 扩展");
    await page.keyboard.press("Escape");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Partner Status 权益档")).toBeVisible();
    await logout(page);
    await login(page);
    await openF2(page);
    await expect(page.getByText("Partner Status 权益档")).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 4_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openF2(page: Page) {
  const group = page.getByRole("button", { name: /(分销与团队\s+F|F\s+分销与团队)/ }).first();
  if (await group.isVisible({ timeout: 4_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/network/royalty"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/network\/royalty$/);
}

async function logout(page: Page) {
  const button = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await button.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await button.click();
    return;
  }
  const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
  await account.click();
  await page.getByText(/退出登录|登出/, { exact: true }).click();
}
