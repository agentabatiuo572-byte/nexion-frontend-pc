import { expect, test, type Page, type Route } from "@playwright/test";

const MODULES = [
  {
    id: "G1",
    path: "/finance-products/staking",
    endpoint: "/api/admin/market/staking",
    marker: /G1 Staking/,
  },
  {
    id: "G2",
    path: "/finance-products/exchange",
    endpoint: "/api/admin/market/exchange",
    marker: /G2 兑换风控/,
  },
  {
    id: "G3",
    path: "/finance-products/market",
    endpoint: "/api/admin/market/nex/curve",
    marker: /G3 NEX 行情引擎/,
  },
  {
    id: "G4",
    path: "/finance-products/genesis",
    endpoint: "/api/admin/market/nex/genesis",
    marker: /G4 Genesis 经济/,
  },
  {
    id: "G7",
    path: "/finance-products/repurchase",
    endpoint: "/api/admin/market/nex/repurchase",
    marker: /G7 复投激励/,
  },
] as const;

test.describe.configure({ timeout: 180_000 });

for (const module of MODULES) {
  test(`${module.id} 畸形 HTTP 200 必须失败关闭并由真实上游恢复`, async ({ page }) => {
    await loginSuperadmin(page);
    await interceptExactGet(page, module.endpoint, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: {} }),
      });
    });

    await openFromSidebar(page, module.path);
    await expect(page.getByText(new RegExp(`${module.id} 数据加载失败`)).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
    await expect(page.getByRole("button", {
      name: /调整|编辑|暂停|恢复|熔断|重跑|处理今日批次|创建虚拟成交/,
    })).toHaveCount(0);

    await page.unroute("**/api/admin/**");
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === module.endpoint
      && candidate.status() === 200);
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await response;
    await expect(page.getByText(new RegExp(`${module.id} 数据加载失败`))).toHaveCount(0);
    await expect(page.getByText(module.marker).first()).toBeVisible();
  });
}

test("G7 HTTP 500 与 G3 超时/结果未知均失败关闭且真实刷新恢复", async ({ page }) => {
  await loginSuperadmin(page);

  await interceptExactGet(page, "/api/admin/market/nex/repurchase", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: "NONOWNER_INJECTED_500", data: null }),
    });
  });
  await openFromSidebar(page, "/finance-products/repurchase");
  await expect(page.getByText(/G7 数据加载失败/)).toBeVisible();
  await page.unroute("**/api/admin/**");

  await interceptExactGet(page, "/api/admin/market/nex/curve", async (route) => {
    await route.abort("timedout");
  });
  await openFromSidebar(page, "/finance-products/market");
  await expect(page.getByText(/G3 数据加载失败/)).toBeVisible();
  await page.unroute("**/api/admin/**");

  const recovered = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && new URL(candidate.url()).pathname === "/api/admin/market/nex/curve"
    && candidate.status() === 200);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await recovered;
  await expect(page.getByText(/G3 数据加载失败/)).toHaveCount(0);
  await expect(page.getByText(/G3 NEX 行情引擎/).first()).toBeVisible();
});

async function interceptExactGet(
  page: Page,
  pathname: string,
  handler: (route: Route) => Promise<void>,
) {
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === pathname) {
      await handler(route);
      return;
    }
    await route.continue();
  });
}

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /金融产品\s+G|G\s+金融产品/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill("superadmin");
    await page.locator('input[autocomplete="current-password"]').fill("Admin@123456");
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}
