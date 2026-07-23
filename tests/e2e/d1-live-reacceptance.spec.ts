import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = process.env.D1_EVIDENCE_DIR || "D:/workspace/bug-pic/d1-fix-reverification-20260720-0213/main";
const password = process.env.NEXION_E2E_PASSWORD;

async function loginAndOpenD1(page: Page) {
  if (!password) throw new Error("NEXION_E2E_PASSWORD is required");
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill(process.env.NEXION_E2E_USERNAME ?? "superadmin");
  await page.getByLabel(/密码/).fill(password);
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  // The login form completes with a client-side replace("/"). Wait for that
  // navigation to settle before issuing the D1 navigation, otherwise the two
  // replaces can race in a fast local browser.
  await page.waitForTimeout(500);
  await page.goto("/finance/recon");
  await expect(page.getByText("充值渠道", { exact: true })).toBeVisible();
}

test.beforeAll(() => fs.mkdirSync(evidenceDir, { recursive: true }));

test("D1 首次用户：权威来源、全部筛选、结构化参数与恢复闭环", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await loginAndOpenD1(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  const body = await page.locator("body").innerText();
  expect(body).toContain("来自 D4 钱包账本");
  expect(body).toMatch(/来自独立费率缓冲账户与分录|仅当前可验证部分 · 历史证据未闭合/);
  expect(body).toMatch(/空数据不代表已经对平|三方 \d+ \/ .* · 账本 \d+ \/ /);
  expect(body).toContain("真实风控锁");
  expect(body).toContain("提交时间");
  expect(body).toContain("确认时间");
  expect(body).toContain("入账时间");
  expect(body).toContain("拒付已追回");
  expect(body).not.toContain("CHARGEBACK_RECOVERED");
  expect(body).not.toContain("未知状态");
  await expect(page.getByRole("link", { name: "K1 反多账户中心", exact: true })).toHaveAttribute("href", "/risk/multi-account");
  expect(body).not.toMatch(/nx_[a-z_]+/i);

  const confirmedRequest = page.waitForRequest((request) =>
    request.method() === "GET" && request.url().includes("/api/admin/finance/topup/flows")
      && new URL(request.url()).searchParams.get("status") === "confirmed");
  await page.getByRole("button", { name: "已入账", exact: true }).click();
  await confirmedRequest;
  await expect(page.getByRole("button", { name: "已入账", exact: true })).toHaveClass(/sel/);

  const allRequest = page.waitForRequest((request) => {
    if (request.method() !== "GET" || !request.url().includes("/api/admin/finance/topup/flows")) return false;
    const status = new URL(request.url()).searchParams.get("status");
    return status === null || status === "";
  });
  await page.getByRole("button", { name: "全部", exact: true }).click();
  const allUrl = new URL((await allRequest).url());
  expect(allUrl.searchParams.get("status")).toBeNull();

  const row = page.locator(".p-row").filter({ hasText: "同卡 24 小时失败次数上限" }).first();
  const originalText = (await row.locator(".v").innerText()).trim();
  const original = Number(originalText.match(/\d+/)?.[0]);
  expect(original).toBeGreaterThanOrEqual(3);
  const next = original >= 10 ? original - 1 : original + 1;

  await row.getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const input = dialog.getByLabel("目标新值");
  await expect(input).toHaveAttribute("type", "number");
  await expect(input).toHaveAttribute("min", "3");
  await expect(input).toHaveAttribute("max", "10");
  await expect(input).toHaveAttribute("step", "1");
  await input.fill(String(next));
  await dialog.locator("textarea").fill("D1真实浏览器结构化参数写入并回读验证");
  const writeResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/topup/card-risk/cardRetryLimit"));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await writeResponse).status()).toBe(200);
  await expect(row.locator(".v")).toContainText(String(next));

  const restore = await page.request.patch("/api/admin/finance/topup/card-risk/cardRetryLimit", {
    headers: { "Idempotency-Key": `d1-e2e-restore-${Date.now()}` },
    data: {
      numericValue: original,
      unit: "COUNT",
      expectedValue: String(next),
      reason: "D1真实浏览器验证完成恢复原始参数",
      operator: "forged-browser-operator",
    },
  });
  expect(restore.status()).toBe(200);
  await page.reload();
  await expect(row.locator(".v")).toContainText(String(original));

  const binInput = page.getByPlaceholder(/输入 6 至 8 位 BIN/);
  await binInput.fill("12x");
  await expect(binInput).toHaveValue("12");
  await page.getByRole("button", { name: "手动锁定", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.screenshot({ path: path.join(evidenceDir, "01-first-user-closed-loop.png"), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, "first-user-result.json"), JSON.stringify({
    original,
    next,
    restored: true,
    allStatusParameter: null,
    pageErrors,
    consoleErrors,
  }, null, 2));
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("D1 异常响应失败关闭，慢请求期间所有写按钮禁用", async ({ page }) => {
  await loginAndOpenD1(page);

  await page.route("**/api/admin/finance/topup/overview", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "forced" }) });
  });
  await page.reload();
  await expect(page.getByText(/D1 已停止展示旧数据/)).toBeVisible();
  await expect(page.getByText("今日入账金额", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试读取", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "02-http500-fail-closed.png"), fullPage: true });

  await page.unroute("**/api/admin/finance/topup/overview");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("今日入账金额", { exact: true })).toBeVisible();

  await page.route("**/api/admin/finance/topup/overview", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, message: "success", data: {} }) });
  });
  await page.reload();
  await expect(page.getByText(/D1 已停止展示旧数据/)).toBeVisible();
  await expect(page.getByText("今日入账金额", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceDir, "03-malformed200-fail-closed.png"), fullPage: true });

  await page.unroute("**/api/admin/finance/topup/overview");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("今日入账金额", { exact: true })).toBeVisible();

  let releaseOverview!: () => void;
  const blocked = new Promise<void>((resolve) => { releaseOverview = resolve; });
  await page.route("**/api/admin/finance/topup/overview", async (route) => {
    await blocked;
    await route.continue();
  });
  const response = page.waitForResponse((candidate) => candidate.url().includes("/api/admin/finance/topup/overview"));
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(page.getByRole("button", { name: "调整", exact: true }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "手动锁定", exact: true })).toBeDisabled();
  releaseOverview();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("button", { name: "调整", exact: true }).first()).toBeEnabled();
  await page.unroute("**/api/admin/finance/topup/overview");
  await page.screenshot({ path: path.join(evidenceDir, "04-recovered-and-writes-enabled.png"), fullPage: true });
});

test("D1 写入已成功但流水刷新失败时明确区分结果且不诱导重复提交", async ({ page }) => {
  await loginAndOpenD1(page);
  const overviewResponse = await page.request.get("/api/admin/finance/topup/overview");
  const overviewEnvelope = await overviewResponse.json() as { code: number; message: string; data: any };
  const original = overviewEnvelope.data.cardParams.find((item: any) => item.key === "cardRetryLimit").numericValue as number;
  const next = original >= 10 ? original - 1 : original + 1;
  const mutationOverview = structuredClone(overviewEnvelope.data);
  const mutated = mutationOverview.cardParams.find((item: any) => item.key === "cardRetryLimit");
  mutated.numericValue = next;
  mutated.value = `${next} 次`;

  let mutationCommitted = false;
  await page.route("**/api/admin/finance/topup/card-risk/cardRetryLimit", async (route) => {
    mutationCommitted = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "success", data: mutationOverview }),
    });
  });
  await page.route("**/api/admin/finance/topup/flows**", async (route) => {
    if (mutationCommitted) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "forced-flow-failure" }) });
      return;
    }
    await route.continue();
  });

  const row = page.locator(".p-row").filter({ hasText: "同卡 24 小时失败次数上限" }).first();
  await row.getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("目标新值").fill(String(next));
  await dialog.locator("textarea").fill("D1故障注入验证已提交与后续刷新失败分离");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/操作已生效并写入审计，但充值流水刷新失败/)).toBeVisible();
  await expect(row.locator(".v")).toContainText(String(next));
  await expect(page.getByText("今日入账金额", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "05-write-committed-flow-refresh-failed.png"), fullPage: true });
});
