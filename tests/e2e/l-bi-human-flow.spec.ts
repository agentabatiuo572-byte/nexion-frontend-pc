import { expect, test, type Locator, type Page, type Response } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const WRITE_REASON = "E2E-L域BI流程测试-真实提交-含回滚预案";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const mutationFailures = new WeakMap<Page, string[]>();

type ModuleCase = {
  id: string;
  name: string;
  path: string;
  domainCode: string;
  domainName: string;
};

const MODULES: ModuleCase[] = CONSOLE_NAV.flatMap((domain) =>
  domain.l2.map((l2) => ({
    id: l2.id,
    name: l2.name,
    path: l2.path,
    domainCode: domain.code,
    domainName: domain.name,
  })),
);

const fatalTextPatterns = [
  /数据加载失败/i,
  /加载失败 ·/i,
  /Handler dispatch failed/i,
  /NoSuchMethodError/i,
  /SQLSyntaxErrorException/i,
  /BACKEND_UNAVAILABLE/i,
  /Cannot read properties/i,
  /ReferenceError/i,
  /TypeError/i,
  /mock 用户详情/i,
  /接真后台后替换/i,
];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const parsed = new URL(BASE_URL);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`L域 BI 全流程测试会提交真实写操作，只允许在本地地址运行，当前 ADMIN_BASE_URL=${BASE_URL}`);
  }
});

test.beforeEach(async ({ page }) => {
  mutationFailures.set(page, []);
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() === "GET" || !response.url().includes("/api/admin/") || response.status() < 400) {
      return;
    }
    const failures = mutationFailures.get(page);
    const body = await response.text().catch(() => "");
    failures?.push(`${request.method()} ${response.status()} ${pathOf(response.url())} ${body.slice(0, 260)}`);
  });
  page.on("dialog", (dialog) => dialog.accept().catch(() => undefined));
  await loginFromUi(page);
});

test("L1-L6 BI 人工路径: 报表创建、导出参数、监管模板、下载、行为热力导出", async ({ page }) => {
  await test.step("L1 KPI: 点击聚合导出并写入 BI/export", async () => {
    await openModuleFromSidebar(page, moduleById("L1"));
    await expectPageHealthy(page, "L1");
    await expect(page.getByText(/实时业务事实 · 后端累计快照|单 KPI 下钻/).first()).toBeVisible({ timeout: 12_000 });
    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndConfirmInline(page, /导出 KPI (?:序列|当前汇总) CSV/, /导出/);
    });
    await expectTransientSuccess(page);
  });

  await test.step("L2 漏斗: 点击 cohort 导出并写入 BI/export", async () => {
    await openModuleFromSidebar(page, moduleById("L2"));
    await expectPageHealthy(page, "L2");
    await expect(page.getByText(/生命周期事实计数|完整漏斗下钻/).first()).toBeVisible({ timeout: 12_000 });
    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndConfirmInline(page, /导出 (?:cohort \/ 漏斗序列|生命周期计数 CSV)/, /导出/);
    });
    await expectTransientSuccess(page);
  });

  await test.step("L3 财务: 聚合导出 + 含资金明细操作确认", async () => {
    await openModuleFromSidebar(page, moduleById("L3"));
    await expectPageHealthy(page, "L3");
    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndConfirmInline(page, /导出聚合汇总/, /导出/);
    });
    await expectTransientSuccess(page);

    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndCompleteDialog(page, /导出含资金明细\(操作确认\)/);
    });
    await expectTransientSuccess(page);
  });

  await test.step("L4 运营: 聚合导出 + 团队明细操作确认", async () => {
    await openModuleFromSidebar(page, moduleById("L4"));
    await expectPageHealthy(page, "L4");
    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndConfirmInline(page, /导出运营报表/, /导出/);
    });
    await expectTransientSuccess(page);

    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndCompleteDialog(page, /导出团队明细\(操作确认\)/);
    });
    await expectTransientSuccess(page);
  });

  await test.step("L5 导出中心: 创建任务、放行、重试、调参数、调排程、新模板、生成监管报告、下载", async () => {
    await openModuleFromSidebar(page, moduleById("L5"));
    await expectPageHealthy(page, "L5");

    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndCompleteDialog(page, /发起导出任务/, {
        businessInputValue: `E2E导出范围-${Date.now()}`,
      });
    });
    await expectTransientSuccess(page);

    await clickVisibleButton(page, /^待确认$/);
    await expect(sectionByTitle(page, /导出任务管理/).locator("button").filter({ hasText: /^操作确认$/ }).first()).toBeVisible({ timeout: 12_000 });
    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports\/[^/]+\/approve$/, async () => {
      await clickButtonAndCompleteDialog(sectionByTitle(page, /导出任务管理/), /^操作确认$/);
    });
    await expectTransientSuccess(page);

    await clickVisibleButton(page, /^全部$/);
    if (await page.locator("button").filter({ hasText: /重新发起/ }).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports\/[^/]+\/rerun$/, async () => {
        await clickVisibleButton(page, /重新发起/);
      });
      await expectTransientSuccess(page);
    }

    await waitForBiMutation(page, "PATCH", /\/api\/admin\/bi\/export\/params\//, async () => {
      await clickButtonAndCompleteDialog(sectionByTitle(page, /导出安全参数/), /调整|勾选/, {
        inputValue: "24h",
      });
    });
    await expectTransientSuccess(page);

    await waitForBiMutation(page, "PATCH", /\/api\/admin\/bi\/regulatory\/schedule$/, async () => {
      await clickButtonAndCompleteDialog(page, /调整排程/);
    });
    await expectTransientSuccess(page);

    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/regulatory\/templates$/, async () => {
      await clickButtonAndCompleteDialog(page, /\+ 新建模板/, {
        inputValue: `E2E监管模板${Date.now()}`,
      });
    });
    await expectTransientSuccess(page);

    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndCompleteDialog(sectionByTitle(page, /监管报告生成/), /^生成$/);
    });
    await expectTransientSuccess(page);

    await clickVisibleButton(page, /^可下载$/);
    await expect(sectionByTitle(page, /导出任务管理/).locator("button").filter({ hasText: /^下载$/ }).first()).toBeVisible({ timeout: 12_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports\/[^/]+\/download$/, async () => {
      await clickVisibleButton(sectionByTitle(page, /导出任务管理/), /^下载$/);
    });
    const download = await downloadPromise;
    expect(download.suggestedFilename(), "L5 下载应拿到后端签发的文件名").toMatch(/\.csv$/i);
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "L5");
  });

  await test.step("L6 行为热力图: 读后端聚合、切换视图、下钻、导出走 BI/export", async () => {
    await openModuleFromSidebar(page, moduleById("L6"));
    await expectPageHealthy(page, "L6");
    await expect(sectionByTitle(page, /页面活跃热力矩阵/)).toBeVisible({ timeout: 12_000 });
    await clickVisibleButton(page, /^一级$/);
    await clickVisibleButton(page, /近 24 小时/);
    await clickVisibleButton(page, /按点击/);
    const heatRow = page.locator("tr.heat-row").first();
    await expect(heatRow, "L6 应展示后端行为聚合行").toBeVisible({ timeout: 12_000 });
    await heatRow.click();
    await expect(sectionByTitle(page, /单页点击热力/)).toBeVisible({ timeout: 12_000 });

    await waitForBiMutation(page, "POST", /\/api\/admin\/bi\/reports$/, async () => {
      await clickButtonAndConfirmInline(page, /导出行为热力序列/, /导出/);
    });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "L6");
  });
});

function moduleById(id: string): ModuleCase {
  const found = MODULES.find((item) => item.id === id);
  if (!found) throw new Error(`未找到模块 ${id}`);
  return found;
}

async function loginFromUi(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await usernameInput.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openModuleFromSidebar(page: Page, item: ModuleCase) {
  const group = page
    .getByRole("button", { name: new RegExp(`(${escapeRegExp(item.domainName)}\\s+${escapeRegExp(item.domainCode)}|${escapeRegExp(item.domainCode)}\\s+${escapeRegExp(item.domainName)})`) })
    .first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await group.click();
  }
  const link = page.locator(`a[href="${item.path}"]`).first();
  await expect(link, `${item.id} 侧边栏入口必须存在`).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(item.path)}(?:\\?.*)?$`), { timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(1_200);
}

async function expectPageHealthy(page: Page, id: string) {
  await expect(page.getByText(new RegExp(`\\b${escapeRegExp(id)}\\b`)).first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/L[1-6] 数据加载中/)).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  for (const pattern of fatalTextPatterns) {
    await expect(page.getByText(pattern), `${id} 不应展示错误或 mock/未接后端兜底文案: ${pattern}`).toHaveCount(0);
  }
  await expectNoMutationFailures(page);
}

function sectionByTitle(pageOrScope: Page | Locator, title: RegExp) {
  return pageOrScope.locator("section.l-card").filter({ hasText: title }).first();
}

async function clickButtonAndConfirmInline(page: Page, buttonName: RegExp, confirmName: RegExp) {
  await clickVisibleButton(page, buttonName);
  await clickVisibleButton(page, confirmName);
}

async function clickButtonAndCompleteDialog(
  pageOrScope: Page | Locator,
  buttonName: RegExp,
  options: { inputValue?: string; businessInputValue?: string } = {},
) {
  await clickVisibleButton(pageOrScope, buttonName);
  const dialog = await requireDialog(pageOrScope);
  await fillDialogInputs(dialog, options);
  await selectBusinessFormOptions(dialog);
  await fillAllTextareas(dialog, WRITE_REASON);
  await clickConfirmInDialog(dialog);
}

async function waitForBiMutation(page: Page, method: string, path: RegExp, action: () => Promise<void>) {
  const responsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === method && path.test(pathOf(response.url()));
  }, { timeout: 30_000 });
  await action();
  const response = await responsePromise;
  await expectOkResponse(response);
  await expectNoMutationFailures(page);
}

async function expectOkResponse(response: Response) {
  const text = await response.text().catch(() => "");
  expect(response.status(), `${response.request().method()} ${pathOf(response.url())} ${text.slice(0, 300)}`).toBeLessThan(400);
}

async function requireDialog(pageOrScope: Page | Locator) {
  const page = "page" in pageOrScope ? pageOrScope.page() : pageOrScope;
  const dialog = page.locator(".modal").last();
  await expect(dialog, "应弹出操作确认弹窗").toBeVisible({ timeout: 10_000 });
  return dialog;
}

async function fillDialogInputs(dialog: Locator, options: { inputValue?: string; businessInputValue?: string } = {}) {
  const textInputs = dialog.locator('input:not([type="checkbox"]):not([type="radio"]):not([disabled])');
  const count = await textInputs.count();
  for (let i = 0; i < count; i += 1) {
    const input = textInputs.nth(i);
    if (!(await input.isVisible().catch(() => false)) || !(await input.isEditable().catch(() => false))) continue;
    const type = (await input.getAttribute("type")) ?? "text";
    const placeholder = (await input.getAttribute("placeholder")) ?? "";
    const current = await input.inputValue().catch(() => "");
    if (type === "number") {
      await input.fill(options.inputValue ?? "1");
    } else if (/时间范围|2026|W17|范围/i.test(placeholder)) {
      await input.fill("2026-06-01 ~ 2026-06-30");
    } else if (/字段|user_id|amount|ts/i.test(placeholder)) {
      await input.fill("手机号,地址,资金明细,行为聚合");
    } else if (/工单|ticket/i.test(placeholder)) {
      await input.fill(`E2E-L-${Date.now()}`);
    } else if (/接收|用途|监管|合规/i.test(placeholder)) {
      await input.fill("BI 管理员");
    } else if (options.businessInputValue && !current) {
      await input.fill(options.businessInputValue);
    } else {
      await input.fill(options.inputValue ?? (current || `E2E-${Date.now()}`));
    }
  }
}

async function selectBusinessFormOptions(dialog: Locator) {
  const business = dialog.locator('[data-business-form="export-wizard"]');
  if (!(await business.isVisible().catch(() => false))) return;
  const selects = business.locator("select");
  if (await selects.nth(0).isVisible().catch(() => false)) {
    await selects.nth(0).selectOption({ label: "财务报表" }).catch(() => selects.nth(0).selectOption({ index: 0 }));
  }
  if (await selects.nth(1).isVisible().catch(() => false)) {
    await selects.nth(1).selectOption({ label: "高(含手机 / 地址)" }).catch(() => selects.nth(1).selectOption({ index: 1 }));
  }
  if (await selects.nth(2).isVisible().catch(() => false)) {
    await selects.nth(2).selectOption({ label: "默认脱敏" }).catch(() => selects.nth(2).selectOption({ index: 0 }));
  }
}

async function fillAllTextareas(scope: Locator, value: string) {
  const areas = scope.locator("textarea:not([disabled])");
  const count = await areas.count();
  for (let i = 0; i < count; i += 1) {
    const area = areas.nth(i);
    if (await area.isVisible().catch(() => false)) await area.fill(value);
  }
}

async function clickConfirmInDialog(dialog: Locator) {
  const button = dialog.locator("button").filter({ hasText: /确认执行/ }).last();
  await expect(button, "操作确认按钮应可用").toBeEnabled({ timeout: 10_000 });
  await button.click();
}

async function clickScopedButton(scope: Locator, label: RegExp) {
  const buttons = scope.locator("button").filter({ hasText: label });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) {
      await button.click();
      return;
    }
  }
  throw new Error(`未找到可点击按钮 ${label}`);
}

async function clickVisibleButton(pageOrScope: Page | Locator, label: RegExp) {
  const buttons = pageOrScope.locator("button").filter({ hasText: label });
  const count = await buttons.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const button = buttons.nth(i);
    if ((await button.isVisible().catch(() => false)) && (await button.isEnabled().catch(() => false))) {
      await button.click();
      return;
    }
  }
  throw new Error(`未找到可点击按钮 ${label}`);
}

async function expectTransientSuccess(page: Page) {
  await page.waitForTimeout(900);
  await expectNoMutationFailures(page);
  await expect(page.getByText(/BACKEND_UNAVAILABLE|SQLSyntaxErrorException|NoSuchMethodError|Handler dispatch failed|Cannot read properties|ReferenceError|TypeError/)).toHaveCount(0);
}

async function expectNoMutationFailures(page: Page) {
  const failures = mutationFailures.get(page) ?? [];
  expect(failures, `存在失败的真实写接口:\n${failures.join("\n")}`).toHaveLength(0);
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
