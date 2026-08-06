import { expect, test, type Page, type Response } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loginHMaker } from "./h-owner-mfa";

const evidenceDir = process.env.H57_EVIDENCE_DIR
  || "D:/workspace/bug-pic/h-domain-acceptance-20260722/first-user-h5-h8/initial";
const voucherName = `H7首次用户验收券-${Date.now()}`;

async function login(page: Page) {
  await loginHMaker(page);
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
}

async function openGrowthModule(page: Page, href: string) {
  const growth = page.getByRole("button", { name: /增长与运营节奏/ });
  if ((await growth.getAttribute("aria-expanded")) !== "true") await growth.click();
  const link = page.locator(`a[href='${href}']`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(href.replaceAll("/", "\\/")));
}

async function submitKConfirm(page: Page, value: string, reason: string): Promise<Response> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("秒数", { exact: true }).fill(value);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/earn-milestones/tick-interval"),
  );
  await dialog.getByRole("button", { name: "确认修改", exact: true }).click();
  return responsePromise;
}

async function fillVoucherForm(page: Page, name: string, amount: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称 name", { exact: true }).fill(name);
  await dialog.getByLabel("满减面值 amount(USD)", { exact: true }).fill(amount);
  await dialog.getByLabel("满减门槛 min(USD)", { exact: true }).fill("20");
  const storeSurface = dialog.locator("[data-proof='voucher-surfaces']").getByRole("button", { name: "商城", exact: true });
  if (!(await storeSurface.innerText()).startsWith("✓")) await storeSurface.click();
  await dialog.getByLabel(/操作理由/).fill("H7 首次用户验收创建临时代金券并验证刷新重登闭环");
}

async function submitOperation(page: Page, predicate: (response: Response) => boolean): Promise<Response> {
  const dialog = page.getByRole("dialog");
  const responsePromise = page.waitForResponse(predicate);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  return responsePromise;
}

async function reasonOnly(page: Page, reason: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill(reason);
}

test.beforeAll(() => fs.mkdirSync(evidenceDir, { recursive: true }));

test("H5 首次用户主链、刷新、异常恢复和 H6 并入判定", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await login(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await openGrowthModule(page, "/growth/daily");
  await expect(page.getByText("收益里程碑", { exact: true })).toBeVisible();
  await expect(page.locator("a[href='/growth/milestones']")).toHaveCount(0);
  await expect(page.locator("a[href='/growth/daily']")).toBeVisible();
  await expect(page.locator("body")).toContainText("连签里程碑");
  await expect(page.locator("body")).toContainText("收益里程碑");
  await page.screenshot({ path: path.join(evidenceDir, "H5-01-baseline-and-H6-merged.png"), fullPage: true });

  const baselineButton = page.getByRole("button", { name: /检查间隔: \d+ 秒/ }).first();
  const baselineLabel = await baselineButton.innerText();
  const originalTickSeconds = Number(baselineLabel.match(/检查间隔:\s*(\d+)\s*秒/)?.[1]);
  expect(Number.isInteger(originalTickSeconds) && originalTickSeconds > 0).toBe(true);
  const temporaryTickSeconds = originalTickSeconds >= 3600 ? originalTickSeconds - 1 : originalTickSeconds + 1;
  let writeStatus: number | null = null;
  let restoreStatus: number | null = null;

  try {
    await baselineButton.click();
    const writeResponse = await submitKConfirm(page, String(temporaryTickSeconds), "H5 首次用户验收临时调整检查间隔并在刷新后核对服务端真值");
    writeStatus = writeResponse.status();
    expect(writeStatus).toBe(200);
    await expect(page.getByRole("button", { name: new RegExp(`检查间隔: ${temporaryTickSeconds} 秒`) })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`检查间隔: ${temporaryTickSeconds} 秒`) })).toBeVisible();
    await page.screenshot({ path: path.join(evidenceDir, "H5-02-persisted-after-refresh.png"), fullPage: true });
  } finally {
    const changedButton = page.getByRole("button", { name: new RegExp(`检查间隔: ${temporaryTickSeconds} 秒`) });
    if (await changedButton.isVisible().catch(() => false)) {
      await changedButton.click();
      const restoreResponse = await submitKConfirm(page, String(originalTickSeconds), "H5 首次用户验收完成后恢复检查间隔原始服务端配置值");
      restoreStatus = restoreResponse.status();
      expect(restoreStatus).toBe(200);
    }
    await page.reload();
    await expect(page.getByRole("button", { name: new RegExp(`检查间隔: ${originalTickSeconds} 秒`) })).toBeVisible();
  }

  await page.route("**/api/admin/growth/check-in", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "验收注入读取失败" }) });
  });
  await page.reload();
  await expect(page.getByText("H5 数据加载失败", { exact: true })).toBeVisible();
  const retryCount = await page.getByRole("button", { name: /重试|重新加载/ }).count();
  await page.screenshot({ path: path.join(evidenceDir, "H5-03-read-failure-no-retry.png"), fullPage: true });
  await page.unroute("**/api/admin/growth/check-in");
  await page.reload();
  await expect(page.getByRole("button", { name: new RegExp(`检查间隔: ${originalTickSeconds} 秒`) })).toBeVisible();

  fs.writeFileSync(path.join(evidenceDir, "H5-result.json"), JSON.stringify({
    h6VisibleEntry: 0,
    h6FunctionsVisibleInH5: ["连签里程碑", "收益里程碑"],
    originalTickSeconds,
    temporaryTickSeconds,
    writeStatus,
    restoreStatus,
    retryCountOnInjected500: retryCount,
    pageErrors,
    consoleErrors,
  }, null, 2));

  expect(pageErrors).toEqual([]);
});

test("H7 首次用户创建、刷新、编辑、暂停、重登与删除清理", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const responses: Array<{ method: string; url: string; status: number }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/growth/vouchers")) responses.push({ method: response.request().method(), url: response.url(), status: response.status() });
  });

  await login(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await openGrowthModule(page, "/growth/vouchers");
  await expect(page.getByText("H7 数据加载中...", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "+ 新增代金券", exact: true }).click();
  await fillVoucherForm(page, voucherName, "0");
  await expect(page.getByRole("dialog").getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText("满减面值(正数)");
  await page.getByRole("dialog").getByLabel("满减面值 amount(USD)", { exact: true }).fill("5");
  const createResponse = await submitOperation(page, (response) => response.request().method() === "POST" && /\/api\/admin\/growth\/vouchers$/.test(response.url()));
  expect(createResponse.status()).toBe(200);
  const row = page.getByRole("row").filter({ hasText: voucherName });
  await expect(row).toBeVisible();
  await expect(row).toContainText("$5");
  await page.screenshot({ path: path.join(evidenceDir, "H7-01-created.png"), fullPage: true });

  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toBeVisible();

  await page.getByRole("row").filter({ hasText: voucherName }).getByRole("button", { name: "编辑", exact: true }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel("满减面值 amount(USD)", { exact: true }).fill("6");
  await editDialog.getByLabel(/操作理由/).fill("H7 首次用户验收编辑临时券面值并验证服务端刷新回读");
  const editResponse = await submitOperation(page, (response) => response.request().method() === "PATCH" && response.url().includes("/api/admin/growth/vouchers/") && !response.url().endsWith("/status"));
  expect(editResponse.status()).toBe(200);
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toContainText("$6");

  await page.getByRole("button", { name: `暂停 ${voucherName}`, exact: true }).click();
  await reasonOnly(page, "H7 首次用户验收暂停临时券并验证刷新和重新登录后的状态保持");
  const pauseResponse = await submitOperation(page, (response) => response.request().method() === "PATCH" && response.url().endsWith("/status"));
  expect(pauseResponse.status()).toBe(200);
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toContainText("已暂停");
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toContainText("已暂停");
  await page.screenshot({ path: path.join(evidenceDir, "H7-02-paused-after-refresh.png"), fullPage: true });

  await page.locator('button[aria-haspopup="menu"]').click();
  const logoutResponsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/admin/auth/logout"));
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  expect((await logoutResponsePromise).status()).toBe(200);
  await expect(page.getByLabel(/用户名|账号/)).toBeVisible();
  await login(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await openGrowthModule(page, "/growth/vouchers");
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toContainText("已暂停");
  await page.screenshot({ path: path.join(evidenceDir, "H7-03-persisted-after-relogin.png"), fullPage: true });

  await page.getByRole("button", { name: `删除代金券 · ${voucherName}`, exact: true }).click();
  await reasonOnly(page, "H7 首次用户验收清理临时代金券并确认刷新后不留业务数据");
  const deleteResponse = await submitOperation(page, (response) => response.request().method() === "DELETE" && response.url().includes("/api/admin/growth/vouchers/"));
  expect(deleteResponse.status()).toBe(200);
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: voucherName })).toHaveCount(0);

  await page.route("**/api/admin/growth/vouchers", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "验收注入读取失败" }) });
    } else {
      await route.continue();
    }
  });
  await page.reload();
  await expect(page.getByText(/H7 数据加载失败/)).toBeVisible();
  const addButtonCountOnReadFailure = await page.getByRole("button", { name: "+ 新增代金券", exact: true }).count();
  expect(addButtonCountOnReadFailure).toBe(0);
  await page.screenshot({ path: path.join(evidenceDir, "H7-04-read-failure-fail-closed.png"), fullPage: true });
  await page.unroute("**/api/admin/growth/vouchers");
  await page.reload();
  await expect(page.getByText("H7 数据加载中...", { exact: true })).toHaveCount(0);

  fs.writeFileSync(path.join(evidenceDir, "H7-result.json"), JSON.stringify({
    voucherName,
    createStatus: createResponse.status(),
    editStatus: editResponse.status(),
    pauseStatus: pauseResponse.status(),
    deleteStatus: deleteResponse.status(),
    cleanedAfterRefresh: await page.getByRole("row").filter({ hasText: voucherName }).count() === 0,
    addButtonCountOnReadFailure,
    responses,
    pageErrors,
    consoleErrors,
  }, null, 2));

  expect(pageErrors).toEqual([]);
});
