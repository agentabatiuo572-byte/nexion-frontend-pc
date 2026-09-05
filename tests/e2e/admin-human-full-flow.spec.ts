import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const WRITE_REASON = "E2E全流程测试-本地库真实提交-含回滚预案";
const C3_AMOUNT = process.env.ADMIN_E2E_C3_AMOUNT ?? "0.01";

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
  /暂无可选通知模板/i,
  /暂无可选原子动作/i,
  /mock 用户详情/i,
  /localStorage/i,
];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const parsed = new URL(BASE_URL);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`全流程测试会提交资金/冻结/启停等真实写操作，只允许在本地地址运行，当前 ADMIN_BASE_URL=${BASE_URL}`);
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
    failures?.push(`${request.method()} ${response.status()} ${pathOf(response.url())} ${body.slice(0, 220)}`);
  });
  page.on("dialog", (dialog) => dialog.accept().catch(() => undefined));
  await loginFromUi(page);
});

test("全域菜单全部 L2 页面都能由侧边栏人工路径打开", async ({ page }) => {
  expect(MODULES.length).toBeGreaterThan(60);

  for (const item of MODULES) {
    await test.step(`${item.id} ${item.name}`, async () => {
      await openModuleFromSidebar(page, item);
      await expectPageHealthy(page, item.id);
    });
  }
});

test("关键写操作按人工路径真实提交: 导出、资金、提现、冻结、熔断、启停、风控、客服配置", async ({ page }) => {
  await test.step("C1 导出用户名单脱敏 Excel", async () => {
    await openModuleFromSidebar(page, moduleById("C1"));
    const downloadPromise = page.waitForEvent("download", { timeout: 30_000 }).catch(() => null);
    await clickButtonAndCompleteDialog(page, /导出用户名单\(脱敏\)/, { confirmName: /确认导出/ });
    const download = await downloadPromise;
    expect(download, "C1 导出应触发浏览器下载").not.toBeNull();
    expect(download?.suggestedFilename() ?? "").toMatch(/\.(xlsx|xls|csv)$/i);
    await expectPageHealthy(page, "C1");
  });

  await test.step("C3 搜索账户后提交余额调整", async () => {
    await openModuleFromSidebar(page, moduleById("C3"));
    await pickSearchOption(page, /搜索用户编码 \/ 用户名 \/ 手机号/, "U");
    const amountRow = page.locator(".adj-form .row").filter({ hasText: "金额" }).first();
    await expect(amountRow).toBeVisible();
    await amountRow.locator("input").first().fill(C3_AMOUNT);
    await clickVisibleButton(page, /^扣减$/);
    await clickButtonAndCompleteDialog(page, /提交调整\(后端复核\)/, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "C3");
  });

  await test.step("D2 提现审核队列执行冻结/驳回/延迟类处置", async () => {
    await openModuleFromSidebar(page, moduleById("D2"));
    await runD2ReviewDisposition(page);
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "D2");
  });

  await test.step("D5 提现参数调整提交确认", async () => {
    await openModuleFromSidebar(page, moduleById("D5"));
    await clickButtonAndCompleteDialog(page, /^调整$/, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "D5");
  });

  await test.step("F5 佣金事件执行冻结/解冻/驳回处置", async () => {
    await openModuleFromSidebar(page, moduleById("F5"));
    await clickButtonAndCompleteDialog(page, /冻结|解冻|解锁|驳回/, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "F5");
  });

  await test.step("G1 Staking 单档熔断或停售提交", async () => {
    await openModuleFromSidebar(page, moduleById("G1"));
    await clickButtonAndCompleteDialog(page, /^停售$|^熔断$/, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "G1");
  });

  await test.step("G3 行情引擎暂停/恢复提交", async () => {
    await openModuleFromSidebar(page, moduleById("G3"));
    await clickButtonAndCompleteDialog(page, /暂停引擎\(操作确认\)|恢复引擎\(操作确认\)/, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "G3");
  });

  await test.step("J1 Kill-Switch 熔断/恢复提交", async () => {
    await openModuleFromSidebar(page, moduleById("J1"));
    await clickButtonAndCompleteDialog(page, /^熔断$/, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "J1");
  });

  await test.step("K2 套利/刷量检测执行冻结或标记处置", async () => {
    await openModuleFromSidebar(page, moduleById("K2"));
    await clickButtonAndCompleteDialog(page, /联动 K1 冻结|标记套利|拦截新人礼|标记刷榜/, { confirmName: /确认执行|确认标记|确认拦截|确认/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "K2");
  });

  await test.step("K4 通过搜索下拉选择用户后人工覆盖风险分", async () => {
    await openModuleFromSidebar(page, moduleById("K4"));
    await pickSearchOption(page, /搜索用户编号 \/ 用户名 \/ 手机号/, "U");
    await clickButtonAndCompleteDialog(page, /人工覆盖评分/, { inputValue: "35", confirmName: /确认/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "K4");
  });

  await test.step("M5 客服岗位配置提交", async () => {
    await openModuleFromSidebar(page, moduleById("M5"));
    await clickVisibleButton(page, /配置岗位/);
    const dialog = await requireDialog(page);
    await fillDialogInputs(dialog, { inputValue: "8" });
    await clickFirstChip(dialog, /专属顾问/);
    await fillAllTextareas(dialog, "E2E全流程测试-客服主管分配岗位与专属顾问");
    await clickConfirmInDialog(dialog, /保存/);
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "M5");
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
  await page.waitForTimeout(900);
}

async function expectPageHealthy(page: Page, id: string) {
  await expect(page.getByText(new RegExp(`\\b${escapeRegExp(id)}\\b`)).first()).toBeVisible({ timeout: 12_000 });
  for (const pattern of fatalTextPatterns) {
    await expect(page.getByText(pattern), `${id} 不应展示错误或 mock/local 兜底文案: ${pattern}`).toHaveCount(0);
  }
}

async function clickButtonAndCompleteDialog(
  page: Page,
  buttonName: RegExp,
  options: { inputValue?: string; confirmName?: RegExp } = {},
) {
  await clickVisibleButton(page, buttonName);
  const dialog = await requireDialog(page);
  await fillDialogInputs(dialog, options);
  await clickFirstChip(dialog);
  await clickConfirmInDialog(dialog, options.confirmName ?? /确认执行|确认|保存|绑定|导出|放行|冻结|驳回|延迟|标记|拦截/);
}

async function runD2ReviewDisposition(page: Page) {
  await waitForD2Idle(page);
  for (const statusLabel of ["待审核", "延迟", "冻结", "待链上"]) {
    await selectNativeOptionByLabel(page, "状态", statusLabel);
    await clickOptionalButton(page, /查询/);
    await waitForD2Idle(page);

    for (const action of [/^冻结$/, /^驳回$/, /^延迟$/, /^解冻$/, /^放行$/]) {
      if (await tryClickVisibleButton(page, action)) {
        const dialog = await requireDialog(page);
        await fillDialogInputs(dialog);
        await clickConfirmInDialog(dialog, /冻结|驳回|延迟|解冻|放行|确认执行|确认/);
        return;
      }
    }
  }

  throw new Error("D2 没有可执行的提现处置按钮。请检查后端是否返回 REVIEWING/DELAYED/FROZEN/PENDING_CHAIN 等可处置提现单。");
}

async function waitForD2Idle(page: Page) {
  await expect(page.getByText("D2 数据加载中...")).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

async function clickOptionalButton(page: Page, label: RegExp) {
  await tryClickVisibleButton(page, label);
}

async function selectNativeOptionByLabel(page: Page, fieldText: string, optionLabel: string) {
  const field = page.locator("label").filter({ hasText: fieldText }).locator("select").first();
  await expect(field, `${fieldText} 下拉框必须存在`).toBeVisible({ timeout: 8_000 });
  await field.selectOption({ label: optionLabel });
}

async function clickVisibleButton(page: Page, label: RegExp) {
  if (await tryClickVisibleButton(page, label)) {
    return;
  }
  throw new Error(`页面上没有可点击按钮: ${label}`);
}

async function tryClickVisibleButton(page: Page, label: RegExp) {
  const candidates = page.locator("button").filter({ hasText: label });
  const count = await candidates.count();
  for (let i = 0; i < count; i += 1) {
    const button = candidates.nth(i);
    if (await isUsable(button)) {
      await button.scrollIntoViewIfNeeded();
      await button.click();
      return true;
    }
  }
  return false;
}

async function requireDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog, "点击后必须出现确认/编辑弹窗").toBeVisible({ timeout: 8_000 });
  return dialog;
}

async function fillDialogInputs(dialog: Locator, options: { inputValue?: string } = {}) {
  const value = options.inputValue ?? "1";
  const inputs = dialog.locator("input:visible");
  const inputCount = await inputs.count();
  for (let i = 0; i < inputCount; i += 1) {
    const input = inputs.nth(i);
    const type = (await input.getAttribute("type")) ?? "text";
    if (type === "checkbox") {
      if (!(await input.isChecked().catch(() => false))) await input.check({ force: true });
      continue;
    }
    if (["radio", "file", "hidden"].includes(type)) continue;
    if (!(await input.isEditable().catch(() => false))) continue;
    const placeholder = (await input.getAttribute("placeholder")) ?? "";
    const current = await input.inputValue().catch(() => "");
    if (type === "number") {
      await input.fill(value);
    } else if (!current || /输入新值|输入目标新值|数值|覆盖分|用户编号|IP|网段/.test(placeholder)) {
      await input.fill(pickInputValue(placeholder, value));
    }
  }

  const selects = dialog.locator("select:visible");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i);
    await select.selectOption({ index: 1 }).catch(() => select.selectOption({ index: 0 }).catch(() => undefined));
  }

  await fillAllTextareas(dialog, WRITE_REASON);
}

async function fillAllTextareas(scope: Locator, text: string) {
  const textareas = scope.locator("textarea:visible");
  const count = await textareas.count();
  for (let i = 0; i < count; i += 1) {
    const area = textareas.nth(i);
    if (await area.isEditable().catch(() => false)) {
      await area.fill(text);
    }
  }
}

async function clickFirstChip(dialog: Locator, label?: RegExp) {
  const selector = label ? ".chip" : ".chip.tab, .chip";
  const chips = dialog.locator(selector).filter(label ? { hasText: label } : {});
  const count = await chips.count();
  for (let i = 0; i < count; i += 1) {
    const chip = chips.nth(i);
    const selected = ((await chip.getAttribute("class")) ?? "").includes("sel");
    if (!selected && await chip.isVisible().catch(() => false)) {
      await chip.click();
      return;
    }
  }
}

async function clickConfirmInDialog(dialog: Locator, name: RegExp) {
  const buttons = dialog.locator("button").filter({ hasText: name });
  await expect(buttons.first(), `弹窗中应存在确认按钮 ${name}`).toBeVisible({ timeout: 8_000 });
  const count = await buttons.count();
  for (let i = count - 1; i >= 0; i -= 1) {
    const button = buttons.nth(i);
    if (await isUsable(button)) {
      await button.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
      return;
    }
  }
  throw new Error(`确认按钮仍不可点击: ${name}`);
}

async function pickSearchOption(page: Page, placeholder: RegExp, keyword: string) {
  const input = page.getByPlaceholder(placeholder).first();
  await expect(input).toBeVisible({ timeout: 12_000 });
  await input.fill(keyword);
  await page.waitForTimeout(900);
  const option = page.locator('[role="option"], [role="listbox"] button').first();
  await expect(option, `搜索 ${String(placeholder)} 应返回可选择项`).toBeVisible({ timeout: 12_000 });
  await option.click();
}

async function expectTransientSuccess(page: Page) {
  await page.waitForTimeout(900);
  const failures = mutationFailures.get(page) ?? [];
  expect(failures, "写请求不应返回 4xx/5xx").toEqual([]);
  mutationFailures.set(page, []);
  await expect(page.getByText(/操作失败|保存失败|提交失败|接口写入失败|数据加载失败|报错/)).toHaveCount(0);
}

async function isUsable(locator: Locator) {
  return (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false));
}

function pickInputValue(placeholder: string, value: string) {
  if (/IP|网段/.test(placeholder)) return "198.51.100.0/24";
  if (/用户编号/.test(placeholder)) return "U00000001";
  if (/覆盖分/.test(placeholder)) return "35";
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
