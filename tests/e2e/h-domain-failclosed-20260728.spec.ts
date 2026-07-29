import { expect, test, type Page, type Route } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";

type Fault = "malformed-200" | "500" | "timeout";
type ModuleProbe = {
  id: string;
  path: string;
  apiPath: string;
  healthyText: RegExp;
  errorText: RegExp;
  mutationButtons: RegExp;
};

const MODULES: ModuleProbe[] = [
  { id: "H1", path: "/growth/phase", apiPath: "/api/admin/growth/phases", healthyText: /节奏骨架/, errorText: /H1 数据加载失败/, mutationButtons: /改总时长|设定位置|调整|撤销/ },
  { id: "H2", path: "/growth/trial", apiPath: "/api/admin/growth/trials", healthyText: /四道前置闸/, errorText: /H2 数据加载失败/, mutationButtons: /调整|强制取消|强制扣款|auto-push 急停/ },
  { id: "H3", path: "/growth/quest", apiPath: "/api/admin/growth/quest-events/tasks", healthyText: /任务事件契约与归因/, errorText: /H3 任务引擎 数据加载失败/, mutationButtons: /改奖励|调整|\+ 新建|改基础|改倍率|改天数|改小时|改设备|改日产/ },
  { id: "H4", path: "/growth/events", apiPath: "/api/admin/growth/quest-events/events-overview", healthyText: /抽奖转盘治理/, errorText: /H4 活动中心 数据加载失败/, mutationButtons: /\+ 新建活动|编辑|上线|下线|主推|保存概率|\+ 新建档位|\+ 新建护栏|删除|调整/ },
  { id: "H5", path: "/growth/daily", apiPath: "/api/admin/growth/check-in", healthyText: /收益里程碑/, errorText: /H5 数据加载失败/, mutationButtons: /调整|改奖励|检查间隔|保存/ },
  { id: "H7", path: "/growth/vouchers", apiPath: "/api/admin/growth/vouchers", healthyText: /代金券列表/, errorText: /H7 数据加载失败/, mutationButtons: /\+ 新增代金券|编辑|暂停|投放|撤销未核销|删除代金券/ },
  { id: "H8", path: "/growth/referral-rewards", apiPath: "/api/admin/growth/referral-rewards", healthyText: /最近真实发奖/, errorText: /H8 真实发奖数据读取失败/, mutationButtons: /调整|执行真实结算/ },
];

test.describe.configure({ mode: "serial", timeout: 300_000 });

for (const fault of ["malformed-200", "500", "timeout"] as const) {
  test(`H1/H2/H3/H4/H5/H7/H8 ${fault} 读取故障统一失败关闭并可恢复`, async ({ page }) => {
    expect(PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
    await login(page);
    for (const module of MODULES) {
      await page.route(`**${module.apiPath}`, (route) => injectFault(route, fault));
      await openFromSidebar(page, module.path);
      await expect(page.getByText(module.errorText).first(), `${module.id} ${fault}`).toBeVisible({ timeout: 20_000 });
      await expectEnabledMutationButtonCount(page, module.mutationButtons, 0, `${module.id} ${fault}`);
      await page.unroute(`**${module.apiPath}`);

      const retry = page.getByRole("button", { name: /重试|重新加载/ }).first();
      if (await retry.isVisible().catch(() => false)) {
        await retry.click();
      } else {
        await page.reload({ waitUntil: "domcontentloaded" });
      }
      await expect(page.getByText(module.healthyText).first(), `${module.id} recovery`).toBeVisible({ timeout: 30_000 });
    }
  });
}

async function injectFault(route: Route, fault: Fault) {
  if (fault === "malformed-200") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, data: null }),
    });
    return;
  }
  if (fault === "500") {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: "H_ACCEPTANCE_INJECTED_READ_FAILURE" }),
    });
    return;
  }
  await route.abort("timedout");
}

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /增长与运营节奏/ }).first();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const link = page.locator(`aside a[href="${href}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(href)}$`));
}

async function expectEnabledMutationButtonCount(page: Page, name: RegExp, expected: number, label: string) {
  const count = await page.getByRole("button", { name }).evaluateAll((buttons) =>
    buttons.filter((button) => {
      const element = button as HTMLButtonElement;
      const style = window.getComputedStyle(element);
      return !element.disabled && style.visibility !== "hidden" && style.display !== "none";
    }).length);
  expect(count, `${label} enabled mutation buttons`).toBe(expected);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
