import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

test.describe.configure({ mode: "serial" });

test("B2 未知结果按原载荷复用 key，载荷变化生成新 key", async ({ page }) => {
  await login(page);
  const keys: string[] = [];
  await page.route("**/api/admin/treasury/forecast-config", async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"] || "");
    await route.fulfill({
      status: 503,
      headers: { "X-Nexion-Upstream-Outcome": "unknown" },
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "TREASURY_BACKEND_UNAVAILABLE", data: null }),
    });
  });

  await page.goto("/overview/liquidity", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "资金池水位" })).toBeVisible();
  await page.getByRole("button", { name: "调整预测配置" }).click();
  await page.locator("textarea").fill("B2 unknown outcome acceptance reason");
  await page.getByRole("button", { name: "保存并进入确认" }).click();
  await page.getByRole("button", { name: "确认提交配置" }).click();
  await expect(page.getByText(/结果未知.*同一请求号/)).toBeVisible();

  await page.getByRole("button", { name: "确认提交配置" }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toMatch(/^b2-forecast-config-/);
  expect(keys[1]).toBe(keys[0]);

  await page.getByRole("button", { name: "返回修改" }).click();
  await page.locator("textarea").fill("B2 changed payload must use a new command key");
  await page.getByRole("button", { name: "保存并进入确认" }).click();
  await page.getByRole("button", { name: "确认提交配置" }).click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[0]);
});

test("B3 未知结果按原载荷复用 key，载荷变化生成新 key", async ({ page }) => {
  await login(page);
  const keys: string[] = [];
  const injectedStages = [
    ["register", "注册", "auth.register_completed"],
    ["kyc", "KYC", "kyc.approved"],
    ["purchase", "首购", "device.order_paid"],
    ["repurchase", "复购", "device.repurchase_paid"],
    ["withdraw", "提现", "withdraw.submitted"],
  ].map(([key, stage, event]) => ({
    key,
    stage,
    event,
    distinctUsers: 0,
    previousUsers: 0,
    cvrFromPrev: null,
    momDelta: null,
    lifecycleLabel: "验收故障注入",
    kpiTarget: null,
    color: "#64748b",
    source: "acceptance-fault-injection",
  }));
  await page.route("**/api/admin/funnel?*", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    const upstream = await route.fetch();
    const result = await upstream.json() as {
      code: number;
      message?: string;
      data?: Record<string, unknown>;
    };
    await route.fulfill({
      response: upstream,
      contentType: "application/json",
      body: JSON.stringify({
        ...result,
        data: {
          ...result.data,
          available: true,
          reason: "",
          message: "",
          stages: injectedStages,
        },
      }),
    });
  });
  await page.route("**/api/admin/funnel/view", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] || "");
    await route.fulfill({
      status: 503,
      headers: { "X-Nexion-Upstream-Outcome": "unknown" },
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "B3_BACKEND_UNAVAILABLE", data: null }),
    });
  });

  await page.goto("/overview/funnel", { waitUntil: "domcontentloaded" });
  const save = page.getByRole("button", { name: "保存为视图" });
  await page.getByLabel("视图名称").fill("B3 unknown outcome acceptance");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText(/结果未知.*同一请求号/)).toBeVisible();

  await save.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toMatch(/^b3-view-/);
  expect(keys[1]).toBe(keys[0]);

  await page.getByLabel("视图名称").fill("B3 changed payload acceptance");
  await save.click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[0]);
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/api/admin/auth/login")
      && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toBeVisible({ timeout: 20_000 });
}
