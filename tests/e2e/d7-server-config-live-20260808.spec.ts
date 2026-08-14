import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";

const username = process.env.D7_ACCEPTANCE_USERNAME?.trim();
const password = process.env.D7_ACCEPTANCE_PASSWORD;
if (!username || !password) throw new Error("D7_ACCEPTANCE_USERNAME and D7_ACCEPTANCE_PASSWORD are required");
const dbPassword = process.env.D7_DB_PASSWORD;
if (!dbPassword) throw new Error("D7_DB_PASSWORD is required for exact fixture cleanup");
const mysql = process.env.D7_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username!);
  await page.locator('input[autocomplete="current-password"]').fill(password!);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && new URL(candidate.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/$/);
  await page.waitForLoadState("networkidle");
}

type D7Snapshot = {
  version: number;
  providerReady: boolean;
  providerStatusAvailable: boolean;
  sandboxAvailable: boolean;
  channelEnabled: boolean;
  quoteTtlMinWithdraw: number;
  sellSpreadPct: number;
  requoteTolerancePct: number;
  feeRatePct: number;
  feeMinUsd: number;
  feeMaxUsd: number;
  minAmountUsd: number;
  maxAmountUsd: number;
  effectiveAt: string;
  lastUpdatedBy: string;
};

async function enterD7(page: Page): Promise<D7Snapshot> {
  await page.getByRole("button", { name: /资金与财务/ }).click();
  const link = page.getByRole("link", { name: /法币提现参数/ });
  await expect(link).toBeVisible();
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET" && new URL(candidate.url()).pathname === "/api/admin/finance/payout-vnd/config");
  await link.click();
  const resolved = await response;
  expect(resolved.status()).toBe(200);
  const body = await resolved.json() as { code?: number; data?: D7Snapshot };
  expect(body).toMatchObject({ code: 0, data: {
    providerReady: false,
    providerStatusAvailable: true,
    sandboxAvailable: false,
    channelEnabled: false,
  } });
  await expect(page).toHaveURL(/\/finance\/payout-vnd$/);
  await page.waitForLoadState("networkidle");
  return body.data!;
}

async function assertD7Surface(page: Page, expectedTtl: number, expectedVersion: number) {
  await expect(page.getByText("真实出款供应商未就绪", { exact: true })).toBeVisible();
  await expect(page.getByText(/参数管理已接入服务端/)).toBeVisible();
  await expect(page.getByText(new RegExp(`服务端 v${expectedVersion}`))).toBeVisible();
  await expect(page.getByText(/D6 基准价与买入点差/)).toBeVisible();
  await expect(page.locator('input[aria-label$="目标值"]')).toHaveCount(8);
  await expect(page.getByLabel("卖出点差目标值")).toHaveValue("1.5");
  await expect(page.getByLabel("出金报价有效期目标值")).toHaveValue(String(expectedTtl));
  await expect(page.getByRole("button", { name: "开启通道" })).toBeDisabled();
  await expect(page.getByText("开启按钮已禁用：真实出款供应商未就绪。")).toBeVisible();
}

async function submitTtlChange(
  page: Page,
  expectedTtl: number,
  reason: string,
) {
  const input = page.getByLabel("出金报价有效期目标值");
  const submit = page.getByRole("button", { name: "预览并提交整组配置", exact: true });
  await input.fill(String(expectedTtl));
  await expect(input).toHaveValue(String(expectedTtl));
  await expect(submit).toBeEnabled();
  await submit.click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea:visible").fill(reason);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "PATCH"
      && new URL(candidate.url()).pathname === "/api/admin/finance/payout-vnd/config");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).filter({ visible: true }).click();
  const resolved = await response;
  expect(resolved.status()).toBe(200);
  const body = await resolved.json() as { code?: number; data?: D7Snapshot };
  const commandKey = resolved.request().headers()["idempotency-key"];
  expect(commandKey).toMatch(/^d7-payout-config-/);
  expect(body.code).toBe(0);
  expect(body.data?.quoteTtlMinWithdraw).toBe(expectedTtl);
  await expect(dialog).toBeHidden();
  return { body, commandKey, dialog, snapshot: body.data };
}

async function submitBlockedTtlChange(page: Page, expectedTtl: number, reason: string) {
  const input = page.getByLabel("出金报价有效期目标值");
  await input.fill(String(expectedTtl));
  await page.getByRole("button", { name: "预览并提交整组配置", exact: true }).click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea:visible").fill(reason);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "PATCH"
      && new URL(candidate.url()).pathname === "/api/admin/finance/payout-vnd/config");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const resolved = await response;
  expect(resolved.status()).toBe(409);
  const commandKey = resolved.request().headers()["idempotency-key"];
  expect(commandKey).toMatch(/^d7-payout-config-/);
  const operatorCopy = "当前备付金覆盖率不可计算、不可靠或低于红线，本次放大资金流出的操作未生效。";
  await expect(dialog.getByRole("alert")).toContainText(operatorCopy);
  await expect(dialog).not.toContainText("D7_TREASURY_COVERAGE_BLOCKED");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(operatorCopy, { exact: true })).toBeVisible();
  await expect(input).toHaveValue(String(expectedTtl - 1));
  return commandKey;
}

async function assertVisibleA2Audit(page: Page, runToken: string) {
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === "/api/admin/platform/audit/overview");
  await page.getByRole("link", { name: "A2 审计", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/platform\/audit$/);

  await page.getByLabel("审计动作").fill("D7_PAYOUT_VND_CONFIG_UPDATED");
  await page.getByLabel("审计对象").fill("D7");
  const filteredResponse = page.waitForResponse((candidate) => {
    if (candidate.request().method() !== "GET") return false;
    const url = new URL(candidate.url());
    return url.pathname === "/api/admin/platform/audit/overview"
      && url.searchParams.get("action") === "D7_PAYOUT_VND_CONFIG_UPDATED"
      && url.searchParams.get("object") === "D7";
  });
  await page.getByRole("button", { name: "查询", exact: true }).click();
  expect((await filteredResponse).status()).toBe(200);

  const auditSection = page.locator("section.l-card").filter({ hasText: "审计日志(a)· 只追加" });
  const matchingRows = auditSection.locator("tbody tr").filter({ hasText: "D7_PAYOUT_VND_CONFIG_UPDATED" });
  await expect(matchingRows.first()).toBeVisible();
  let foundRunAudit = false;
  for (let index = 0; index < await matchingRows.count(); index += 1) {
    await matchingRows.nth(index).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    if ((await drawer.textContent())?.includes(runToken)) {
      await expect(drawer).toContainText("D7_PAYOUT_VND_CONFIG_UPDATED");
      await expect(drawer).toContainText(runToken);
      await expect(drawer).toContainText("D7");
      foundRunAudit = true;
    }
    await drawer.getByRole("button", { name: "关闭", exact: true }).click();
    if (foundRunAudit) break;
  }
  expect(foundRunAudit).toBe(true);
}

function sqlLiteral(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function cleanupD7Fixture(initial: D7Snapshot, changedVersion: number, runToken: string, commandKeys: string[]) {
  const storedValues = JSON.stringify({
    sellSpreadPct: initial.sellSpreadPct,
    quoteTtlMinWithdraw: initial.quoteTtlMinWithdraw,
    requoteTolerancePct: initial.requoteTolerancePct,
    feeRatePct: initial.feeRatePct,
    feeMinUsd: initial.feeMinUsd,
    feeMaxUsd: initial.feeMaxUsd,
    minAmountUsd: initial.minAmountUsd,
    maxAmountUsd: initial.maxAmountUsd,
    channelEnabled: initial.channelEnabled,
    effectiveAt: Date.parse(initial.effectiveAt),
    lastUpdatedBy: initial.lastUpdatedBy,
  });
  const keyPredicates = commandKeys.map((key) => `idempotency_key='${sqlLiteral(key)}'`).join(" OR ") || "FALSE";
  const auditKeyPredicates = commandKeys.map((key) => `detail_json LIKE '%${sqlLiteral(key)}%'`).join(" OR ") || "FALSE";
  const sql = `
START TRANSACTION;
UPDATE nx_config_item target
JOIN nx_config_item version_row ON version_row.config_key='finance.payout_vnd.version'
SET target.config_value='${sqlLiteral(storedValues)}'
WHERE target.config_key='finance.payout_vnd.values' AND version_row.config_value='${changedVersion}';
SELECT ROW_COUNT();
UPDATE nx_config_item SET config_value='${initial.version}'
WHERE config_key='finance.payout_vnd.version' AND config_value='${changedVersion}';
SELECT ROW_COUNT();
DELETE FROM nx_audit_log
WHERE action IN ('D7_PAYOUT_VND_CONFIG_UPDATED','D7_PAYOUT_VND_CONFIG_REJECTED')
  AND (detail_json LIKE '%${sqlLiteral(runToken)}%' OR ${auditKeyPredicates});
DELETE FROM nx_admin_idempotency_record
WHERE scope='FINANCE:D7:CONFIG_UPDATE' AND (${keyPredicates});
COMMIT;`;
  const output = execFileSync(mysql, [
    "--default-character-set=utf8mb4", "-h", "127.0.0.1", "-P", "3306", "-u", "root", "-D", "nexion", "-N", "-B", "-e", sql,
  ], { encoding: "utf8", env: { ...process.env, MYSQL_PWD: dbPassword! } });
  const rowCounts = output.trim().split(/\r?\n/).filter((value) => /^\d+$/.test(value));
  expect(rowCounts.slice(0, 2)).toEqual(["1", "1"]);
}

test("D7 server config completes a visible write, CAS, audit, refresh, relogin, redline block and cleanup flow", async ({ page }, testInfo: TestInfo) => {
  await login(page);
  const initial = await enterD7(page);
  expect(initial.quoteTtlMinWithdraw).toBeGreaterThan(1);
  await assertD7Surface(page, initial.quoteTtlMinWithdraw, initial.version);
  await page.screenshot({ path: testInfo.outputPath("d7-server-config-before.png"), fullPage: true });

  const runToken = `D7-E2E-${Date.now()}`;
  const changedTtl = initial.quoteTtlMinWithdraw - 1;
  const commandKeys: string[] = [];
  let changedVersion: number | null = null;
  try {
    const changedResult = await submitTtlChange(page, changedTtl, `${runToken} 收紧报价窗口并验证审计`);
    commandKeys.push(changedResult.commandKey);
    const changed = changedResult.snapshot!;
    changedVersion = changed.version;
    expect(changed.version).toBe(initial.version + 1);
    await assertD7Surface(page, changedTtl, changed.version);
    await page.screenshot({ path: testInfo.outputPath("d7-server-config-changed.png"), fullPage: true });

    const reloadResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET" && new URL(candidate.url()).pathname === "/api/admin/finance/payout-vnd/config");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await reloadResponse).status()).toBe(200);
    await assertD7Surface(page, changedTtl, changed.version);

    await page.locator('button[aria-haspopup="menu"]').click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await login(page);
    const afterRelogin = await enterD7(page);
    expect(afterRelogin).toMatchObject({ version: changed.version, quoteTtlMinWithdraw: changedTtl });
    await assertD7Surface(page, changedTtl, changed.version);

    commandKeys.push(await submitBlockedTtlChange(
      page,
      initial.quoteTtlMinWithdraw,
      `${runToken} 验证红线下放宽恢复必须阻断`,
    ));
    await assertVisibleA2Audit(page, runToken);

    const returnResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET" && new URL(candidate.url()).pathname === "/api/admin/finance/payout-vnd/config");
    await page.goBack({ waitUntil: "domcontentloaded" });
    expect((await returnResponse).status()).toBe(200);
    await expect(page).toHaveURL(/\/finance\/payout-vnd$/);
    await assertD7Surface(page, changedTtl, changed.version);
  } finally {
    if (changedVersion !== null) cleanupD7Fixture(initial, changedVersion, runToken, commandKeys);
  }

  const cleaned = await page.request.get("/api/admin/finance/payout-vnd/config");
  expect(cleaned.status()).toBe(200);
  const cleanedBody = await cleaned.json() as { code?: number; data?: D7Snapshot };
  expect(cleanedBody).toMatchObject({ code: 0, data: {
    version: initial.version,
    quoteTtlMinWithdraw: initial.quoteTtlMinWithdraw,
    channelEnabled: initial.channelEnabled,
  } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await assertD7Surface(page, initial.quoteTtlMinWithdraw, initial.version);
  await page.screenshot({ path: testInfo.outputPath("d7-server-config-cleaned.png"), fullPage: true });
});
