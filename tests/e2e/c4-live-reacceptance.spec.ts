import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = "D:/workspace/bug-pic/c4-fix-reverification-20260719";

async function loginAndOpenC4(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill("superadmin");
  await page.getByLabel(/密码/).fill("Admin@123456");
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await page.getByRole("button", { name: /用户与账户/ }).click();
  await page.getByText("KYC 合规台账", { exact: true }).click();
  await expect(page.getByRole("heading", { name: /KYC.*合规台账/ })).toBeVisible();
  await expect(page.getByText("U00000052", { exact: false }).first()).toBeVisible();
}

test.beforeAll(() => {
  fs.mkdirSync(path.join(evidenceDir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(evidenceDir, "raw"), { recursive: true });
});

test("C4 首次用户闭环：K5 不改状态，L5 导出可刷新下载", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await loginAndOpenC4(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  const bodyBefore = await page.locator("body").innerText();
  expect(bodyBefore).toContain("KYC 权威台账");
  expect(bodyBefore).not.toMatch(/nx_(?:user|kyc|admin)/i);
  await expect(page.getByText("最近导出任务", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "screenshots", "01-c4-authoritative-entry.png"), fullPage: true });

  const selectedRow = page.getByRole("row").filter({ hasText: "U00000052" }).first();
  await selectedRow.click();
  await expect(page.getByText("详情 · U00000052", { exact: true })).toBeVisible();
  await expect(page.getByText("状态变更历史", { exact: true })).toBeVisible();
  await expect(selectedRow).toContainText("已验证");

  await page.getByRole("button", { name: "触发复审", exact: true }).click();
  const reviewDialog = page.getByRole("dialog");
  await expect(reviewDialog).toContainText("不会改变当前实名状态");
  const reviewConfirm = reviewDialog.getByRole("button", { name: "确认提交", exact: true });
  await reviewDialog.locator("textarea").fill("C4 浏览器复验创建或合并 K5 工单且不改变实名状态");
  await expect(reviewConfirm).toBeDisabled();
  await reviewDialog.getByPlaceholder(/CASE-/).fill("CASE-C4-BROWSER-20260719");
  await expect(reviewConfirm).toBeEnabled();
  const reviewResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().includes("/trigger-review"));
  await reviewConfirm.click();
  const reviewResponse = await reviewResponsePromise;
  expect(reviewResponse.status()).toBe(200);
  const reviewPayload = await reviewResponse.json();
  expect(reviewPayload.data.ticketId).toMatch(/^KR-/);
  expect(reviewPayload.data.kycStatus).toBe("APPROVED");
  await expect(page.getByText(/K5 复审工单(?:已创建|已合并)/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "U00000052" }).first()).toContainText("已验证");

  await page.getByRole("button", { name: "监管导出(脱敏)", exact: true }).click();
  const exportDialog = page.getByRole("dialog");
  await exportDialog.locator("textarea").fill("C4 浏览器复验生成持久化脱敏监管导出并完成下载");
  const exportConfirm = exportDialog.getByRole("button", { name: "确认提交", exact: true });
  await expect(exportConfirm).toBeEnabled();
  const exportResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST" && /\/api\/admin\/users\/kyc\/exports$/.test(new URL(response.url()).pathname));
  await exportConfirm.click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.status()).toBe(200);
  const exportPayload = await exportResponse.json();
  const jobNo = String(exportPayload.data.jobNo);
  expect(jobNo).toMatch(/^KYC-EXP-/);
  await expect(page.getByText(jobNo, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(jobNo, { exact: true })).toBeVisible();
  const jobRow = page.getByRole("row").filter({ hasText: jobNo });
  await expect(jobRow).toContainText("可下载");
  const downloadPromise = page.waitForEvent("download");
  await jobRow.getByRole("button", { name: "下载", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`${jobNo}.csv`);

  await page.screenshot({ path: path.join(evidenceDir, "screenshots", "02-c4-k5-and-l5-closure.png"), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, "raw", "browser-result.json"), JSON.stringify({
    ticketId: reviewPayload.data.ticketId,
    reviewStatus: reviewPayload.data.status,
    kycStatusAfterReview: reviewPayload.data.kycStatus,
    jobNo,
    exportStatus: exportPayload.data.status,
    downloadFileName: download.suggestedFilename(),
    pageErrors,
    consoleErrors,
  }, null, 2), "utf8");
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("C4 墨菲边界：旧状态请求被 CAS 拒绝且页面保持真值", async ({ page }) => {
  await loginAndOpenC4(page);
  const response = await page.request.post("/api/admin/users/kyc/users/52/revoke", {
    headers: { "Idempotency-Key": `c4-stale-${Date.now()}` },
    data: {
      expectedState: "NONE",
      reasonCode: "COMPLIANCE_CORRECTION",
      reason: "C4 墨菲复验使用错误旧状态验证并发保护不会覆盖真值",
      evidenceRef: "CASE-C4-STALE-20260719",
      operator: "forged-browser-operator",
    },
  });
  expect(response.status()).toBe(409);
  const payload = await response.json();
  expect(payload.message).toBe("KYC_EXPECTED_STATE_MISMATCH");
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "U00000052" }).first()).toContainText("已验证");
  fs.writeFileSync(path.join(evidenceDir, "raw", "stale-cas-result.json"), JSON.stringify({
    status: response.status(),
    message: payload.message,
    finalStatus: "APPROVED",
  }, null, 2), "utf8");
});

test("C4 墨菲边界：畸形成功响应停止展示推测与陈旧台账", async ({ page }) => {
  await page.route("**/api/admin/users/kyc/overview**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "success", data: { unexpectedShape: true } }),
    });
  });
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill("superadmin");
  await page.getByLabel(/密码/).fill("Admin@123456");
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await page.getByRole("button", { name: /用户与账户/ }).click();
  await page.getByText("KYC 合规台账", { exact: true }).click();
  await expect(page.getByText(/实名台账服务返回的数据不完整或不一致/)).toBeVisible();
  await expect(page.getByText("U00000052", { exact: false })).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceDir, "screenshots", "03-c4-malformed-response-safe-failure.png"), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, "raw", "malformed-response-result.json"), JSON.stringify({
    responseStatus: 200,
    payloadShape: "unexpectedShape",
    staleUserVisible: false,
    translatedErrorVisible: true,
  }, null, 2), "utf8");
});

test("C4 墨菲边界：导出列表单点失败不拖垮权威实名台账", async ({ page }) => {
  await page.route("**/api/admin/users/kyc/exports**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "C4_EXPORT_LIST_UNAVAILABLE" }),
      });
      return;
    }
    await route.continue();
  });
  await loginAndOpenC4(page);
  await expect(page.getByText("U00000052", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/导出任务暂时无法加载/)).toBeVisible();
  await expect(page.getByText(/实名台账仍可继续核对/)).toBeVisible();
  await expect(page.getByText(/C4 数据加载失败/)).toHaveCount(0);
  fs.writeFileSync(path.join(evidenceDir, "raw", "export-partial-failure-result.json"), JSON.stringify({
    exportListStatus: 503,
    authoritativeLedgerVisible: true,
    scopedRecoveryMessageVisible: true,
  }, null, 2), "utf8");
});

test("C4 墨菲边界：并发复审触发合并同一 K5 工单且不改实名状态", async ({ page }) => {
  await loginAndOpenC4(page);
  const nonce = Date.now();
  const requests = [1, 2].map((index) => page.request.post("/api/admin/users/kyc/users/52/trigger-review", {
    headers: { "Idempotency-Key": `c4-concurrent-review-${nonce}-${index}` },
    data: {
      reasonCode: "RISK_ESCALATION",
      reason: `C4 并发复验第 ${index} 路同时合并开放 K5 工单且不得覆盖实名真值`,
      evidenceRef: `CASE-C4-CONCURRENT-${nonce}-${index}`,
      operator: "forged-browser-operator",
    },
  }));
  const responses = await Promise.all(requests);
  expect(responses.map((response) => response.status())).toEqual([200, 200]);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  expect(payloads[0].data.ticketId).toBe(payloads[1].data.ticketId);
  expect(payloads.map((payload) => payload.data.kycStatus)).toEqual(["APPROVED", "APPROVED"]);
  expect(payloads.map((payload) => payload.data.status)).toEqual(["MERGED", "MERGED"]);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "U00000052" }).first()).toContainText("已验证");
  fs.writeFileSync(path.join(evidenceDir, "raw", "concurrent-k5-merge-result.json"), JSON.stringify({
    responseStatuses: responses.map((response) => response.status()),
    ticketIds: payloads.map((payload) => payload.data.ticketId),
    reviewStatuses: payloads.map((payload) => payload.data.status),
    finalKycStatus: payloads[0].data.kycStatus,
  }, null, 2), "utf8");
});

test("C4 跨域闭环：监管任务在 L5 保持 READY 并可下载", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill("superadmin");
  await page.getByLabel(/密码/).fill("Admin@123456");
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await page.goto("/analytics/export");
  await expect(page.getByText("导出任务管理", { exact: true })).toBeVisible();
  const kycRow = page.getByRole("row").filter({ hasText: /KYC-EXP-/ }).first();
  await expect(kycRow).toContainText("C4 KYC 监管脱敏台账");
  await expect(kycRow).toContainText("可下载");
  await expect(kycRow).not.toContainText("历史类型已关闭");
  const downloadPromise = page.waitForEvent("download");
  await kycRow.getByRole("button", { name: "下载", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^kyc-exp-[a-z0-9]+\.csv$/i);
  await page.screenshot({ path: path.join(evidenceDir, "screenshots", "04-c4-job-visible-in-l5.png"), fullPage: true });
  fs.writeFileSync(path.join(evidenceDir, "raw", "l5-regulatory-result.json"), JSON.stringify({
    taskVisible: true,
    status: "READY",
    historicalTypeClosed: false,
    downloadFileName: download.suggestedFilename(),
  }, null, 2), "utf8");
});
