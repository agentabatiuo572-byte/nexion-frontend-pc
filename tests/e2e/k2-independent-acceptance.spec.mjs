import { expect, test } from "@playwright/test";

const BASE_URL = process.env.K2_BASE_URL ?? "http://127.0.0.1:3002";

function requiredAdminPassword() {
  const password = process.env.NEXION_ADMIN_PASSWORD;
  if (!password) throw new Error("NEXION_ADMIN_PASSWORD is required for authenticated E2E tests");
  return password;
}

async function loginAndOpenK2(page) {
  await page.goto(`${BASE_URL}/risk/abuse`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "账号", exact: true }).fill("superadmin");
  await page.getByRole("textbox", { name: "密码", exact: true }).fill(requiredAdminPassword());
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "套利 & 刷量检测", exact: true })).toBeVisible();
}

function parameterCard(page, label) {
  return page.getByText(label, { exact: true }).locator("..");
}

async function openParameterDialog(page, label) {
  const card = parameterCard(page, label);
  await expect(card).toContainText(label);
  await card.getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(label);
  return dialog;
}

test("K2 current model, views and all parameter entries are coherent", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await loginAndOpenK2(page);

  const main = page.locator("main");
  await expect(main).not.toContainText("最小持仓月份");
  await expect(main).not.toContainText("残值 $0");
  await expect(main).toContainText("高频下架置换与礼金/返佣叠加证据");

  const views = new Map([
    ["试用循环", ["实体 / 簇", "30 天循环次数", "关联账户", "累计套取试用收益", "层数", "判定", "动作"]],
    ["换新套利", ["账户 / 实体", "设备链", "观察窗口", "高频下架置换", "礼金/返佣叠加", "层数", "动作"]],
    ["新人礼刷取", ["簇", "实体", "已发 / 已拦", "涉及金额", "闭环特征", "层数", "动作"]],
    ["排行榜刷榜", ["账户", "本期累计佣金", "增速(对基线)", "直推增长", "关联簇", "判定", "动作"]],
  ]);
  for (const [view, headers] of views) {
    await page.getByRole("button", { name: view, exact: true }).click();
    const table = page.locator("main table");
    for (const header of headers) await expect(table.getByRole("columnheader", { name: header, exact: true })).toHaveCount(1);
  }

  const params = [
    "试用循环异常线", "新人礼异常发放线", "刷榜增速异常倍数", "新人礼发放模式",
    "新人礼 USDT 金额", "新人礼 NEX 金额", "验证码重发冷却", "滑块验证触发次数",
    "验证码有效期", "最多输错次数", "滑块票据有效期",
  ];
  for (const label of params) {
    const dialog = await openParameterDialog(page, label);
    await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }
  expect(pageErrors).toEqual([]);
});

test("K2 validates the 60-second OTP TTL step before submit", async ({ page }) => {
  await loginAndOpenK2(page);
  const dialog = await openParameterDialog(page, "验证码有效期");
  await dialog.getByRole("spinbutton", { name: "目标新值", exact: true }).fill("61");
  await dialog.getByRole("textbox", { name: /操作理由/ }).fill("K2 验收校验验证码步长边界");
  await expect(dialog.getByText("步长 60", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
});

test("K2 overview failure hides stale data and only retries K2", async ({ page }) => {
  await page.route("**/api/admin/risk/arbitrage/overview", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ code: 500, message: "injected K2 failure" }),
  }));
  await loginAndOpenK2(page).catch(() => undefined);
  await expect(page.getByText("K2 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByText("已隐藏旧数据与写操作", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
  await page.unroute("**/api/admin/risk/arbitrage/overview");
  await page.getByRole("button", { name: "仅重试 K2", exact: true }).click();
  await expect(page.getByRole("heading", { name: "套利 & 刷量检测", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "调整", exact: true })).toHaveCount(11);
});
