import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";

const username = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const password = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const evidenceDir = process.env.D5_EVIDENCE_DIR
  || "D:/workspace/bug-pic/20260727-d5-live-reacceptance";

async function login(page: Page) {
  await page.goto("/");
  const account = page.getByLabel(/用户名|账号/);
  if (await account.isVisible().catch(() => false)) {
    await account.fill(username);
    await page.getByLabel(/密码/).fill(password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
}

async function openD5(page: Page) {
  await page.goto("/finance/params");
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  await expect(page.getByText("H1 Phase 派发（只读）", { exact: true })).toBeVisible();
}

test.beforeAll(() => fs.mkdirSync(evidenceDir, { recursive: true }));

test("D5 first-user visible path, canonical read, pre-submit wording, refresh and relogin", async ({ page }) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  await login(page);
  await openD5(page);

  const canonical = await page.request.get("/api/admin/withdraw/limits");
  expect(canonical.status()).toBe(200);
  const payload = await canonical.json() as { code: number; data: Record<string, unknown> };
  expect(payload.code).toBe(0);
  // FEAT-WD02(2026-08-02):networkFeeRatio/Min/Max 与 penaltyFeeRate 已随旧费模型删除,
  // 不再要求后端下发;networkConfirmFeeUsd 由前端默认种子兜底,后端跟进下发前不作必备断言。
  for (const key of [
    "version", "dailyLimitCount", "balanceMaxRatio", "nexFeeOffsetRate",
    "cooldownDays", "complianceHoldEnabled",
  ]) expect(payload.data[key], `canonical D5 field ${key}`).not.toBeUndefined();

  const daily = page.getByLabel("每日提现次数目标值");
  const current = Number(await daily.inputValue());
  const next = current === 1 ? 2 : 1;
  await daily.fill(String(next));
  await page.getByRole("button", { name: "预览并提交" }).first().click();
  await expect(page.getByText("提交成功后生效并写入审计", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("已生效 · 已记审计", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${evidenceDir}/01-d5-pre-submit-truth.png`, fullPage: true });
  await page.getByRole("button", { name: "取消", exact: true }).click();

  await page.reload();
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  await expect(page.getByText(/权威版本 v\d+/)).toBeVisible();

  const accountMenu = page.getByRole("button", { name: /superadmin|Super Admin|总管理员/i }).last();
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel(/用户名|账号/)).toBeVisible();
  await login(page);
  await openD5(page);
  await page.screenshot({ path: `${evidenceDir}/02-d5-after-relogin.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});
