import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const EVIDENCE_DIR = path.resolve("artifacts/acceptance-l5-l6-20260717/main-e2e");

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await page.waitForTimeout(800);
    await username.fill("superadmin");
    const password = page.locator('input[autocomplete="current-password"]');
    await password.fill((process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()));
    await expect(username).toHaveValue("superadmin");
    await expect(password).toHaveValue((process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()));
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("L5 only exposes implemented aggregate snapshots and completes create/download", async ({ page }) => {
  const mutationFailures: string[] = [];
  page.on("response", async (response) => {
    if (response.request().method() === "GET" || !response.url().includes("/api/admin/bi") || response.status() < 400) return;
    mutationFailures.push(`${response.request().method()} ${response.status()} ${response.url()} ${await response.text().catch(() => "")}`);
  });

  await page.goto(`${BASE_URL}/analytics/export`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("累计导出任务")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "发起聚合快照" })).toBeEnabled();
  for (const falseAction of ["调整排程", "+ 新建模板", "发起解密导出"]) {
    await expect(page.getByRole("button", { name: falseAction })).toHaveCount(0);
  }
  await expect(page.getByText("七类账单明细导出")).toBeVisible();
  await expect(page.getByRole("button", { name: "生成监管报告" })).toBeEnabled();
  await expect(page.getByText("等待 D4 账单查询与字段级脱敏链路完成跨模块验收")).toHaveCount(0);
  const ledgerDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出七类账单明细" }).click();
  const ledgerDialog = page.getByRole("dialog", { name: "导出七类账单脱敏明细" });
  await ledgerDialog.getByRole("textbox", { name: /操作理由/ }).fill("L5验收导出七类账单脱敏明细并验证统一审计");
  await ledgerDialog.getByRole("button", { name: "确认提交" }).click();
  expect((await ledgerDownload).suggestedFilename()).toMatch(/^d4-bills-.*\.csv$/i);

  const ticket = `L5-E2E-${Date.now()}`;
  await page.getByRole("button", { name: "发起聚合快照" }).click();
  const dialog = page.getByRole("dialog", { name: "发起聚合快照导出" });
  await dialog.getByRole("textbox", { name: "时间范围" }).fill("近 7 天");
  await dialog.getByRole("textbox", { name: "聚合字段" }).fill("用户数、订单数");
  await dialog.getByRole("textbox", { name: "接收人 / 用途" }).fill("L5 验收");
  await dialog.getByRole("textbox", { name: "业务依据 / 工单" }).fill(ticket);
  await dialog.getByRole("textbox", { name: /操作理由/ }).fill("L5验收创建真实聚合快照并验证下载闭环");
  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/bi/reports",
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  expect((await createdResponse).status()).toBe(200);

  await expect(page.getByText(`工单:${ticket}`)).toBeVisible({ timeout: 20_000 });
  const createdRow = page.locator("tr").filter({ hasText: `工单:${ticket}` }).first();
  await expect(createdRow.getByText("可下载")).toBeVisible();
  const download = page.waitForEvent("download");
  await createdRow.getByRole("button", { name: "下载" }).click();
  expect((await download).suggestedFilename()).toMatch(/^EXP-[A-Z0-9]+\.csv$/i);
  expect(mutationFailures).toEqual([]);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "l5-pass.png"), fullPage: true });
});

test("L6 truthfully blocks heatmap and export until real APP events exist", async ({ page }) => {
  await page.goto(`${BASE_URL}/analytics/behavior-heatmap`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("当前状态：等待跨模块接入")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("app.page_viewed")).toBeVisible();
  await expect(page.getByText("app.element_clicked")).toBeVisible();
  await expect(page.getByRole("button", { name: "行为数据未接入" })).toBeDisabled();
  await expect(page.getByText("页面活跃热力矩阵")).toHaveCount(0);
  await expect(page.getByText(/总页面浏览 PV/)).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "l6-deferred-pass.png"), fullPage: true });
});
