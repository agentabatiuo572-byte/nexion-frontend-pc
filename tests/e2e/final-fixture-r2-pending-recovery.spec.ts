import { expect, test, type Page, type Response } from "@playwright/test";

const USERNAME = required("ADMIN_E2E_USERNAME");
const PASSWORD = required("ADMIN_E2E_PASSWORD");
const ROLE_CODES = required("FINAL_FIXTURE_PENDING_ROLE_CODES").split(",").map((code) => code.trim()).filter(Boolean);
const REASON = "FINAL_FIXTURE R2 retry: cancel failed-attempt cleanup proposal before visible A6 repair";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("A2 cancels failed-attempt R2 role-deletion proposals through visible UI", async ({ page }) => {
  await page.goto("/");
  if (await page.locator('input[autocomplete="username"]').isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.locator('input[autocomplete="username"]').fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "继续", exact: true }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  await navA2(page);
  for (const roleCode of ROLE_CODES) {
    const rows = page.locator("tbody tr").filter({ hasText: roleCode });
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const cancel = row.getByRole("button", { name: "取消执行", exact: true });
      if (!await cancel.count()) continue;
      await cancel.click();
      const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && /\/api\/admin\/platform\/audit\/operations\/[^/]+\/reject$/.test(new URL(candidate.url()).pathname));
      const dialog = page.getByRole("dialog").last();
      await dialog.getByLabel(/操作理由/).fill(REASON);
      await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
      expect((await response).status()).toBe(200);
    }
  }
});

async function navA2(page: Page) {
  const link = page.locator("aside").getByRole("link", { name: "审计 & 操作确认 A2", exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload();
}

function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
