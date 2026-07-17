import { expect, test } from "@playwright/test";

function adminCredentials() {
  const password = process.env.NEXION_ADMIN_PASSWORD;
  if (!password) {
    throw new Error("NEXION_ADMIN_PASSWORD is required for authenticated E2E tests");
  }
  return { username: "superadmin", password };
}

test("J3 empty state and alert configuration stay truthful and structured", async ({ page }) => {
  const login = await page.request.post("/api/admin/auth/login", {
    data: adminCredentials(),
  });
  expect(login.ok()).toBeTruthy();

  await page.goto("/emergency/tamper");

  await expect(page.getByText("当前窗口暂无服务器拦截事件。", { exact: false })).toBeVisible();
  await expect(page.getByText("当前窗口暂无篡改路径分布。", { exact: true })).toBeVisible();
  await expect(page.getByText("当前窗口没有达到阈值的账户告警。", { exact: true })).toBeVisible();

  const exportButton = page.getByRole("button", { name: "导出 24h 报表" });
  await expect(exportButton).toBeDisabled();
  await expect(exportButton).toHaveAttribute("title", "当前筛选结果为空，不能导出");

  await page.getByRole("button", { name: "告警阈值配置" }).click();
  const dialog = page.getByRole("dialog", { name: "篡改告警配置确认" });
  await expect(dialog).toBeVisible();

  const threshold = dialog.getByRole("spinbutton", { name: "告警频次阈值" });
  await expect(threshold).toHaveAttribute("min", "1");
  await expect(threshold).toHaveAttribute("max", "100");
  await expect(threshold).toHaveAttribute("step", "1");
  await expect(dialog.getByRole("switch", { name: /喂 K4 风险评分/ })).toBeChecked();

  const confirm = dialog.getByRole("button", { name: "确认变更" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: /变更理由（8–200 字）/ }).fill("验证结构化告警配置闭环");
  await expect(confirm).toBeDisabled();
  await threshold.fill("10.5");
  await expect(confirm).toBeDisabled();
  await threshold.fill("11");
  await expect(confirm).toBeEnabled();
});

test("J3 to C2 deep link distinguishes a missing user without hiding the current list", async ({ page }) => {
  const login = await page.request.post("/api/admin/auth/login", {
    data: adminCredentials(),
  });
  expect(login.ok()).toBeTruthy();

  const exactLookup = await page.request.get("/api/admin/users/account-actions/accounts/NONEXIST");
  expect(exactLookup.status()).toBe(404);
  expect((await exactLookup.json()).code).toBe(404);

  await page.goto("/users/actions?userCode=NONEXIST&source=J3");
  await expect(page.getByRole("status")).toContainText("服务器未找到该用户");
  await expect(page.getByRole("status")).toContainText("没有预选处置对象");
  await expect(page.getByRole("status")).toContainText("下方仍保留当前账户列表");
  await expect(page.getByRole("table").first()).toBeVisible();
});
