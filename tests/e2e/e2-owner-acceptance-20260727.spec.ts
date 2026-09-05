import { expect, request, test, type Page, type Response } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR =
  process.env.E2_EVIDENCE_DIR ||
  "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/evidence/E2-owner";

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("首次运营用户从可见侧栏完成 E2 阅读、筛选、表单校验、刷新和重登", async ({ page }) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      pageErrors.push(message.text());
    }
  });
  page.on("response", (response) => collectServerError(response, serverErrors));

  await loginFromVisibleEntry(page);
  await openE2FromVisibleSidebar(page);
  await expectCanonicalSurface(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-e2-canonical-surface.png`, fullPage: true });

  await page.getByText(/图像生成\s+\d+/).click();
  await expect(page.getByText(/筛选\s+\d+/)).toBeVisible();
  await expect(page.getByText("当前分类无匹配任务")).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-task-class-filter.png`, fullPage: true });

  await page.getByText(/全部\s+\d+/).click();
  await page.getByRole("button", { name: "+ 新增任务" }).click();
  const drawer = page.locator(".drawer").last();
  await expect(drawer).toBeVisible();
  const submit = drawer.getByRole("button", { name: /提交|确认/ });
  await expect(submit).toBeDisabled();

  await drawer.getByRole("textbox", { name: "任务名称" }).fill(`E2验收任务-${Date.now()}`);
  await drawer.getByRole("spinbutton", { name: /单价/ }).fill("0.01");
  await drawer.getByText("/job", { exact: true }).click();
  await drawer.getByText("手机+", { exact: true }).click();
  await drawer.getByRole("spinbutton", { name: /初始饱和度/ }).fill("35");
  await drawer.getByRole("combobox", { name: /taskClass/ }).selectOption("IG");
  await drawer.getByRole("textbox", { name: "代表模型" }).fill("验收代表模型");
  await drawer.getByRole("spinbutton", { name: /minReward/ }).fill("0.02");
  await drawer.getByRole("spinbutton", { name: /maxReward/ }).fill("0.01");
  await drawer.getByRole("spinbutton", { name: /minVRAM/ }).fill("8");
  await drawer.getByText("派发中", { exact: true }).click();
  await drawer.getByRole("button", { name: /提交|确认/ }).click();
  await expect(page.getByText(/奖励区间非法/)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-structured-validation.png`, fullPage: true });
  await drawer.getByRole("button", { name: "取消", exact: true }).click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectCanonicalSurface(page);
  await logoutFromVisibleControl(page);
  await loginFromVisibleEntry(page);
  await openE2FromVisibleSidebar(page);
  await expectCanonicalSurface(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-refresh-relogin.png`, fullPage: true });

  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
});

test("E2 读取失败安全呈现并可从可见重试按钮恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await page.route("**/api/admin/config/task-pricing", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "E2_TEST_UNAVAILABLE", data: null }),
    }),
  );
  await openE2FromVisibleSidebar(page);
  await expect(page.locator('section[role="alert"]')).toContainText("E2 数据读取失败");
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-read-failure.png`, fullPage: true });

  await page.unroute("**/api/admin/config/task-pricing");
  await page.getByRole("button", { name: "重试" }).click();
  await expectCanonicalSurface(page);
  await page.screenshot({ path: `${EVIDENCE_DIR}/06-retry-recovered.png`, fullPage: true });
});

test("E2 畸形 200 失败关闭写入口，并可从可见重试恢复", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await page.route("**/api/admin/config/task-pricing", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, data: {} }),
    }),
  );
  await openE2FromVisibleSidebar(page);
  await expect(page.locator('section[role="alert"]')).toContainText("E2 数据读取失败");
  await expect(page.locator("body")).toContainText("E2_TASK_PRICING_PROTOCOL_INVALID");
  await expect(page.getByRole("button", { name: "调整全局饱和因子" })).toHaveCount(0);
  await expect(page.locator(".task .acts")).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/07-malformed-200-fail-closed.png`, fullPage: true });

  await page.unroute("**/api/admin/config/task-pricing");
  await page.getByRole("button", { name: "重试" }).click();
  await expectCanonicalSurface(page);
});

test("E2 接口权限、精确六类契约和零副作用错误分支", async ({ page, baseURL }) => {
  await loginFromVisibleEntry(page);
  const pricingResponse = await page.request.get("/api/admin/config/task-pricing");
  expect(pricingResponse.status()).toBe(200);
  const pricing = await pricingResponse.json();
  expect(pricing.code).toBe(0);
  expect(pricing.data.taskClasses.map((row: { taskClass: string }) => row.taskClass).sort()).toEqual([
    "EM",
    "FT",
    "IG",
    "LL",
    "SP",
    "VG",
  ]);
  expect(pricing.data.sources).toEqual(expect.arrayContaining([
    "nx_admin_device_task",
    expect.stringContaining("E.task.queueSaturation"),
  ]));

  const tasksResponse = await page.request.get("/api/admin/devices/tasks?pageNum=1&pageSize=100");
  expect(tasksResponse.status()).toBe(200);
  const tasks = await tasksResponse.json();
  expect(tasks.code).toBe(0);
  expect(tasks.data.records.length).toBeGreaterThanOrEqual(6);

  const noIdempotency = await page.request.put("/api/admin/config/task-pricing", {
    data: { taskClass: "IG", minVram: 8, reason: "E2验收缺少幂等键必须拒绝" },
  });
  expect(noIdempotency.status()).toBe(422);
  expect((await noIdempotency.json()).message).toBe("IDEMPOTENCY_KEY_REQUIRED");

  const invalid = await page.request.put("/api/admin/config/task-pricing", {
    headers: { "Idempotency-Key": `e2-owner-invalid-${Date.now()}` },
    data: { taskClass: "IG", minVram: -1, reason: "E2验收非法显存必须拒绝且不改数据" },
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).message).toBe("TASK_MIN_VRAM_INVALID");

  const anonymous = await request.newContext({ baseURL });
  const anonymousRead = await anonymous.get("/api/admin/config/task-pricing");
  expect(anonymousRead.status()).toBe(401);
  await anonymous.dispose();
});

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await fillUnlessShellRecovered(username, USERNAME, shell);
  if (await shell.isVisible()) return;
  await fillUnlessShellRecovered(
    page.locator('input[autocomplete="current-password"]'),
    PASSWORD,
    shell,
  );
  if (await shell.isVisible()) return;
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openE2FromVisibleSidebar(page: Page) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  if (
    await group.isVisible({ timeout: 5_000 }).catch(() => false)
    && await group.getAttribute("aria-expanded") !== "true"
  ) {
    await group.click();
  }
  const link = page.locator('a[href="/devices/tasks"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/tasks$/);
}

async function expectCanonicalSurface(page: Page) {
  await expect(page.getByText("6 类 AI 任务定价 · 当前运营配置")).toBeVisible();
  await expect(page.getByTestId("e2-task-pricing-canonical").getByText("6/6 类")).toBeVisible();
  await expect(page.getByTestId("e2-task-pricing-canonical").locator("tbody tr")).toHaveCount(6);
  await expect(page.getByText("手机算力档位收益 · 5 档")).toBeVisible();
  await expect(page.getByText("任务列表")).toBeVisible();
  await expect(page.getByText(/共\s+\d+\s+个/, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/E2 数据读取失败/)).toHaveCount(0);
}

async function logoutFromVisibleControl(page: Page) {
  const logout = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await logout.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logout.click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    return;
  }
  const account = page
    .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
    .first();
  if (await account.isVisible({ timeout: 3_000 }).catch(() => false)) await account.click();
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout).toBeVisible();
  await menuLogout.click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function fillUnlessShellRecovered(
  field: ReturnType<Page["locator"]>,
  value: string,
  shell: ReturnType<Page["locator"]>,
) {
  try {
    await field.fill(value);
  } catch (error) {
    if (await shell.isVisible()) return;
    throw error;
  }
}

function collectServerError(response: Response, failures: string[]) {
  if (!response.url().includes("/api/admin/") || response.status() < 500) return;
  failures.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
}
