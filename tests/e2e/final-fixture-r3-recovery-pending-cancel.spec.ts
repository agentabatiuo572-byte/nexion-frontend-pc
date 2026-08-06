import { expect, test, type Page, type Response } from "@playwright/test";

const USERNAME = required("ADMIN_E2E_USERNAME");
const PASSWORD = required("ADMIN_E2E_PASSWORD");
const REASON = "pc-full-acceptance-20260729-114336 cancel stale recovery-account proposal before visible cleanup retry";

test.describe.configure({ mode: "serial", timeout: 90_000 });

test("A2 visibly cancels only stale ffix.recover pending proposals", async ({ page }, testInfo) => {
  await login(page); await navA2(page); await page.reload();
  const cancelled: string[] = [];
  for (const row of await page.locator("tbody tr").all()) {
    if (!/ffix\.recover\./.test(await row.innerText())) continue;
    const cancel = row.getByRole("button", { name: "取消执行", exact: true });
    if (!await cancel.count()) continue;
    const operationId = ((await row.innerText()).match(/(?:WO|OP)-[A-Za-z0-9_-]+/) ?? ["unknown"])[0];
    await cancel.click();
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/reject`));
    const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill(REASON); await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    expect((await response).status()).toBe(200); cancelled.push(operationId);
  }
  await testInfo.attach("cancelled-operations.json", { body: JSON.stringify({ cancelled }, null, 2), contentType: "application/json" });
});

async function login(page: Page) { await page.goto("/"); if (await page.locator('input[autocomplete="username"]').isVisible({ timeout: 5_000 }).catch(() => false)) { await page.locator('input[autocomplete="username"]').fill(USERNAME); await page.locator('input[autocomplete="current-password"]').fill(PASSWORD); await page.getByRole("button", { name: "继续", exact: true }).click(); } await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 }); }
async function navA2(page: Page) { const link = page.locator("aside").getByRole("link", { name: "审计 & 操作确认 A2", exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(/\/platform\/audit$/); }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
