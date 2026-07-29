import { expect, test, type Page } from "@playwright/test";

const CASES = [
  {
    id: "G1",
    path: "/finance-products/staking",
    endpoint: "/api/admin/market/staking/pools/usdt30d/params/apy",
    openEditor: async (page: Page) => {
      await page.getByRole("button", { name: "调整 APY", exact: true }).first().click();
    },
  },
  {
    id: "G2",
    path: "/finance-products/exchange",
    endpoint: "/api/admin/market/exchange/params/fee",
    openEditor: async (page: Page) => {
      await page.getByRole("button", { name: "调整 兑换手续费率", exact: true }).click();
    },
  },
  {
    id: "G3",
    path: "/finance-products/market",
    endpoint: "/api/admin/market/nex/overrides/deviationPct",
    openEditor: async (page: Page) => {
      const row = page.locator(".p-row").filter({ hasText: "偏离告警阈值" }).first();
      await row.getByRole("button", { name: /调整/ }).click();
    },
  },
  {
    id: "G4",
    path: "/finance-products/genesis",
    endpoint: "/api/admin/market/nex/genesis/params/price",
    openEditor: async (page: Page) => {
      const row = page.locator(".p-row").filter({ hasText: "一级单价" }).first();
      await row.getByRole("button", { name: "调整", exact: true }).click();
    },
  },
  {
    id: "G7",
    path: "/finance-products/repurchase",
    endpoint: "/api/admin/market/nex/repurchase/config/apy",
    openEditor: async (page: Page) => {
      await page.getByRole("button", { name: "编辑 年化 APY", exact: true }).click();
    },
  },
] as const;

test.describe.configure({ timeout: 120_000 });

for (const scenario of CASES) {
  test(`${scenario.id} 结果未知必须保留表单并以同一幂等键重试`, async ({ page }) => {
    await loginSuperadmin(page);
    await openFromSidebar(page, scenario.path);

    const commandKeys: string[] = [];
    await page.route(`**${scenario.endpoint}`, async (route) => {
      commandKeys.push(route.request().headers()["idempotency-key"] ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: {} }),
      });
    });

    await scenario.openEditor(page);
    const dialog = page.locator('[role="dialog"]:visible').last();
    const target = dialog.getByLabel("目标新值");
    const current = Number((await target.getAttribute("placeholder"))?.match(/当前\s*([\d.]+)/)?.[1] ?? "0");
    const next = current >= 1 ? String(current - 0.01) : String(current + 0.01);
    const reason = `${scenario.id} 网络结果未知必须保留同一命令键复验`;
    await target.fill(next);
    await dialog.getByLabel(/操作理由/).fill(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(target).toHaveValue(next);
    await expect(dialog.getByLabel(/操作理由/)).toHaveValue(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect.poll(() => commandKeys.length).toBe(2);
    expect(commandKeys[0]).not.toBe("");
    expect(commandKeys[1]).toBe(commandKeys[0]);
    await expect(dialog).toBeVisible();
  });

  test(`${scenario.id} 确定性拒绝必须释放幂等键`, async ({ page }) => {
    await loginSuperadmin(page);
    await openFromSidebar(page, scenario.path);

    const commandKeys: string[] = [];
    await page.route(`**${scenario.endpoint}`, async (route) => {
      commandKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (commandKeys.length === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ code: 422, message: "NONOWNER_DETERMINISTIC_REJECTION", data: null }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: {} }),
      });
    });

    await scenario.openEditor(page);
    const dialog = page.locator('[role="dialog"]:visible').last();
    const target = dialog.getByLabel("目标新值");
    const current = Number((await target.getAttribute("placeholder"))?.match(/当前\s*([\d.]+)/)?.[1] ?? "0");
    const next = current >= 1 ? String(current - 0.01) : String(current + 0.01);
    const reason = `${scenario.id} 确定性拒绝必须释放命令键复验`;
    await target.fill(next);
    await dialog.getByLabel(/操作理由/).fill(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(target).toHaveValue(next);
    await expect(dialog.getByLabel(/操作理由/)).toHaveValue(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect.poll(() => commandKeys.length).toBe(2);
    expect(commandKeys[0]).not.toBe("");
    expect(commandKeys[1]).not.toBe(commandKeys[0]);
    await expect(dialog).toBeVisible();
  });
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  for (let attempt = 0; attempt < 2 && !(await shell.isVisible().catch(() => false)); attempt += 1) {
    await expect(username).toBeVisible({ timeout: 8_000 });
    await username.fill("superadmin");
    const password = page.locator('input[autocomplete="current-password"]');
    await password.fill("Admin@123456");
    await expect(username).toHaveValue("superadmin");
    await expect(password).toHaveValue("Admin@123456");
    const submit = page.getByRole("button", { name: /继续|登录/ });
    await expect(submit).toBeEnabled();
    await submit.click();
    await Promise.race([
      shell.waitFor({ state: "visible", timeout: 8_000 }),
      page.getByRole("alert").waitFor({ state: "visible", timeout: 8_000 }),
    ]).catch(() => undefined);
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /金融产品/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
}
