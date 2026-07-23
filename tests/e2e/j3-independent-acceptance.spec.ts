import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const evidenceRoot = "D:/workspace/bug-pic/j-domain-acceptance-20260722/j3";
const screenshotDir = path.join(evidenceRoot, "screenshots");
const rawDir = path.join(evidenceRoot, "raw");
const e2eUsername = process.env.NEXION_E2E_USERNAME ?? "superadmin";

function e2ePassword() {
  const password = process.env.NEXION_E2E_PASSWORD;
  if (!password) throw new Error("NEXION_E2E_PASSWORD is required for the live J3 acceptance test");
  return password;
}

mkdirSync(screenshotDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });

// The acceptance trace starts only after visible UI login so credentials and
// the authentication request body are never retained in the evidence bundle.
test.use({ trace: "off" });

async function shot(page: Page, name: string) {
  const target = path.join(screenshotDir, `${name}.png`);
  await page.screenshot({ path: target, fullPage: true });
  return target;
}

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("账号")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("账号").fill(e2eUsername);
  await page.getByLabel("密码").fill(e2ePassword());
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 30_000 });
}

async function openJ3FromSidebar(page: Page) {
  const link = page.locator('a[href="/emergency/tamper"]');
  if (!await link.isVisible().catch(() => false)) {
    const group = page.locator('button[aria-controls="nav-group-J"]');
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/tamper/);
  await expect(page.getByRole("heading", { name: "篡改防御监控" })).toBeVisible();
  await expect(page.getByText("账户处置只读，告警配置单独授权", { exact: false })).toBeVisible();
}

test("J3 independent first-user + Murphy acceptance", async ({ page, context, playwright }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const apiLog: Array<{ method: string; url: string; status: number }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/emergency/tamper")) {
      apiLog.push({ method: response.request().method(), url: response.url(), status: response.status() });
    }
  });

  await loginFromVisibleEntry(page);
  await shot(page, "01-visible-login-success");
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  await openJ3FromSidebar(page);
  await shot(page, "02-j3-visible-sidebar-entry");

  await expect(page.getByText("本页不会冻结账户或建立风险簇", { exact: false })).toBeVisible();
  await expect(page.getByText("数据来源 ·", { exact: false })).toBeVisible();
  await expect(page.getByText("服务器拦截事件流", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/服务器拒绝入口(已全部接入|接入未完成)/)).toBeVisible();

  const initialWindow = "24h";
  const thirtyDay = page.getByRole("button", { name: "30d", exact: true });
  await thirtyDay.click();
  await expect(page).toHaveURL(/window=30d/);
  await expect(thirtyDay).toHaveClass(/on/);
  await page.reload();
  await expect(page.getByRole("button", { name: "30d", exact: true })).toHaveClass(/on/);
  await shot(page, "03-window-refresh-persistence");

  const exportButton = page.getByRole("button", { name: /导出 30d 报表|重试下载 30d 报表/ });
  await expect(exportButton).toBeVisible();
  if (await exportButton.isDisabled()) {
    await expect(exportButton).toHaveAttribute("title", "当前筛选结果为空，不能导出");
    await expect(page.getByText("当前窗口暂无服务器拦截事件。", { exact: false })).toBeVisible();
    await shot(page, "04-empty-state-export-disabled");
  } else {
    const downloadPromise = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloadPromise;
    const target = path.join(rawDir, download.suggestedFilename());
    await download.saveAs(target);
    const csv = readFileSync(target, "utf8");
    expect(csv).toContain("记录类型,时间窗,用户编码");
    expect(csv).not.toMatch(/(?:^|,)U\d{6,}(?:,|$)/m);
  }

  await page.getByRole("button", { name: "告警阈值配置" }).click();
  let dialog = page.getByRole("dialog", { name: "篡改告警配置确认" });
  await expect(dialog).toBeVisible();
  const threshold = dialog.getByRole("spinbutton", { name: "告警频次阈值" });
  const feedSwitch = dialog.getByRole("switch", { name: /喂 K4 风险评分/ });
  const reason = dialog.getByRole("textbox", { name: /变更理由/ });
  const confirm = dialog.getByRole("button", { name: "确认变更" });
  const originalThreshold = Number(await threshold.inputValue());
  const originalFeedK4 = await feedSwitch.isChecked();
  const probeThreshold = originalThreshold >= 100 ? originalThreshold - 1 : originalThreshold + 1;

  await reason.fill("J3 验收：仅填写理由不应允许无变化提交");
  await expect(confirm).toBeDisabled();
  await threshold.fill("10.5");
  await expect(confirm).toBeDisabled();
  await threshold.fill("101");
  await expect(confirm).toBeDisabled();
  await threshold.fill(String(probeThreshold));
  await expect(confirm).toBeEnabled();
  await shot(page, "05-config-validation-and-impact-preview");
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(/监控配置已生效|配置已生效并已记审计/)).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "告警阈值配置" }).click();
  dialog = page.getByRole("dialog", { name: "篡改告警配置确认" });
  await expect(dialog.getByRole("spinbutton", { name: "告警频次阈值" })).toHaveValue(String(probeThreshold));
  await shot(page, "06-config-persisted-after-refresh");

  const restoreThreshold = dialog.getByRole("spinbutton", { name: "告警频次阈值" });
  const restoreSwitch = dialog.getByRole("switch", { name: /喂 K4 风险评分/ });
  await restoreThreshold.fill(String(originalThreshold));
  if (await restoreSwitch.isChecked() !== originalFeedK4) await restoreSwitch.click();
  await dialog.getByRole("textbox", { name: /变更理由/ }).fill("J3 验收清理：恢复告警阈值和 K4 原始配置");
  await dialog.getByRole("button", { name: "确认变更" }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Murphy failure injection: the UI must hide stale controls and expose an
  // actionable retry instead of pretending the last-known state is current.
  await page.route("**/api/admin/emergency/tamper/overview**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "INTERNAL_SERVER_ERROR", data: null }),
    });
  });
  await page.reload();
  await expect(page.locator('section[role="alert"]')).toContainText("当前无法确认最新状态");
  await expect(page.getByRole("button", { name: "重新读取" })).toBeVisible();
  await expect(page.getByRole("button", { name: "告警阈值配置" })).toHaveCount(0);
  await shot(page, "07-failure-injection-safe-state");
  await page.unroute("**/api/admin/emergency/tamper/overview**");
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.getByText("账户处置只读，告警配置单独授权", { exact: false })).toBeVisible();
  await context.tracing.stop({ path: path.join(rawDir, "j3-main-flow-trace.zip") });

  // Sign out and sign back in through visible UI; the URL-backed window state
  // survives the auth gate, while server-backed configuration was restored.
  await page.locator('button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByLabel("账号")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("账号").fill(e2eUsername);
  await page.getByLabel("密码").fill(e2ePassword());
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "30d", exact: true })).toHaveClass(/on/);
  await page.getByRole("button", { name: "告警阈值配置" }).click();
  dialog = page.getByRole("dialog", { name: "篡改告警配置确认" });
  await expect(dialog.getByRole("spinbutton", { name: "告警频次阈值" })).toHaveValue(String(originalThreshold));
  if (originalFeedK4) await expect(dialog.getByRole("switch", { name: /喂 K4 风险评分/ })).toBeChecked();
  else await expect(dialog.getByRole("switch", { name: /喂 K4 风险评分/ })).not.toBeChecked();
  await dialog.getByRole("button", { name: "取消" }).click();
  await shot(page, "08-relogin-and-cleanup-restored");

  const unauthContext = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3002" });
  const unauthWrite = await unauthContext.put("/api/admin/emergency/tamper/alert-config", {
    data: {
      threshold: originalThreshold,
      feedK4: originalFeedK4,
      expectedThreshold: originalThreshold,
      expectedFeedK4: originalFeedK4,
      operator: "anonymous",
      reason: "J3 unauthenticated security probe",
    },
    headers: { "Idempotency-Key": `j3-unauth-${Date.now()}` },
  });
  expect(unauthWrite.status()).toBe(401);
  await unauthContext.dispose();

  writeFileSync(path.join(rawDir, "j3-browser-run.json"), JSON.stringify({
    initialWindow,
    persistedWindow: "30d",
    originalThreshold,
    probeThreshold,
    restoredThreshold: originalThreshold,
    originalFeedK4,
    unauthenticatedWriteStatus: unauthWrite.status(),
    apiLog,
    pageErrors,
    consoleErrors,
  }, null, 2));

  expect(pageErrors).toEqual([]);
  expect(apiLog.some((row) => row.method === "PUT" && row.status < 400)).toBeTruthy();
});
