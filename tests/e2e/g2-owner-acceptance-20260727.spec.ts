import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const BACKEND = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";

test("G2 首次用户真实入口、权威读模型、域外链接与失败关闭", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.request().method()} ${response.status()} ${response.url()}`);
    }
  });

  await login(page);
  await page.getByRole("button", { name: /金融产品\s+G|G\s+金融产品/ }).first().click();
  await page.locator('a[href="/finance-products/exchange"]').first().click();
  await expect(page).toHaveURL(/\/finance-products\/exchange$/);
  await expect(page.getByText("三道额度线 + 费率", { exact: true })).toBeVisible();
  await expect(page.getByText("拦截命中与队列", { exact: true })).toBeVisible();
  await expect(page.getByText("全局熔断与地域封锁", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /地域封锁\(J2 权威\)/ })).toHaveAttribute("href", "/emergency/geo-block");
  await expect(page.locator("body")).toContainText("成交 exchange.swapped → 账本(D4)+ 资金池(D3");

  const overviewResponse = await page.request.get("/api/admin/market/exchange");
  expect(overviewResponse.status()).toBe(200);
  const overview = await overviewResponse.json();
  expect(overview.code).toBe(0);
  expect(overview.data.serverCanonical).toBe(true);
  expect(overview.data.caps.map((row: { key: string }) => row.key)).toEqual([
    "userDailyCap",
    "platformDailyCap",
    "fee",
    "feeMin",
    "kycThreshold",
    "queueMode",
  ]);
  expect(overview.data.sources).toEqual(expect.arrayContaining([
    "nx_exchange_order",
    "nx_config_item:wallet.exchange.*",
    "nx_emergency_control_setting:killswitch.exchange",
    "nx_emergency_geo_country_policy",
  ]));

  for (const [index, label] of [
    "需实名(kyc-required)",
    "单用户超限(user-cap)",
    "平台超限(platform-cap)",
    "地域封锁(geo-blocked)",
  ].entries()) {
    await page.locator(".gate-tiles .t").nth(index).click();
    await expect(page.getByText(new RegExp(`拦截命中清单.*${label.replace(/[()]/g, "\\$&")}`))).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).last().click();
  }

  const before = JSON.stringify(overview.data.caps);
  const invalid = await page.request.patch("/api/admin/market/exchange/params/__unknown__", {
    headers: { "Idempotency-Key": `g2-invalid-${Date.now()}` },
    data: { value: "1", reason: "G2 owner invalid-key fail-closed probe", operator: USERNAME },
  });
  const invalidBody = await invalid.json();
  expect(invalidBody.code).not.toBe(0);
  expect(invalidBody.message).toMatch(/G2_EXCHANGE_PARAM_KEY_INVALID|参数键/);
  const afterInvalid = await (await page.request.get("/api/admin/market/exchange")).json();
  expect(JSON.stringify(afterInvalid.data.caps)).toBe(before);

  const missingIdempotency = await page.request.patch("/api/admin/market/exchange/params/userDailyCap", {
    data: { value: "48", reason: "G2 owner missing idempotency fail-closed probe", operator: USERNAME },
  });
  const missingIdempotencyBody = await missingIdempotency.json();
  expect(missingIdempotencyBody.code).not.toBe(0);
  expect(missingIdempotencyBody.message).toMatch(/IDEMPOTENCY_KEY_REQUIRED|幂等/);
  const afterMissingKey = await (await page.request.get("/api/admin/market/exchange")).json();
  expect(JSON.stringify(afterMissingKey.data.caps)).toBe(before);

  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  const anonymousBff = await anonymous.get("/api/admin/market/exchange");
  expect(anonymousBff.status()).toBe(401);
  await anonymous.dispose();

  const backend = await playwrightRequest.newContext({ baseURL: BACKEND });
  const publicCaps = await (await backend.get("/api/config/exchange/caps")).json();
  expect(publicCaps.code).toBe(0);
  expect(publicCaps.data).toMatchObject({
    asset: "NEX",
    currency: "USDT",
    serverCanonical: true,
    source: "G2/G3 server configuration",
  });
  const anonymousExchange = await (await backend.get("/api/exchange")).json();
  expect(anonymousExchange).toMatchObject({ code: 401, message: "AUTH_REQUIRED" });
  await backend.dispose();

  await page.screenshot({ path: testInfo.outputPath("g2-owner-canonical.png"), fullPage: true });
  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
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
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}
