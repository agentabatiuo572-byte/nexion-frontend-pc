import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const WRITE_REASON = "E2E-K域全流程测试-本地真实提交-含回滚预案";
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
  /localStorage/i,
];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const parsed = new URL(BASE_URL);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`K域全流程测试会提交真实写操作，只允许在本地地址运行，当前 ADMIN_BASE_URL=${BASE_URL}`);
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

test("K1-K4 风控域人工路径全流程真实提交", async ({ page }) => {
  let pickedUserNo = "U00000001";

  await test.step("K1 多账户: 调阈值、改簇状态、加白再移除、分页", async () => {
    await openModuleFromSidebar(page, moduleById("K1"));
    await expectPageHealthy(page, "K1");
    await assertPagerAndMaybeClick(page, "K1 去重命中列表");
    await assertPagerAndMaybeClick(page, "K1 IP 白名单");

    const thresholdCard = sectionByTitle(page, /拦截阈值/);
    const linkWeightRow = thresholdCard.locator(".p").filter({ hasText: /关联|权重|强度/ }).first();
    if (await linkWeightRow.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await linkWeightRow.locator("button").filter({ hasText: /调整/ }).first().click();
      const dialog = await requireDialog(page);
      await fillK1WeightDialog(dialog);
      await fillAllTextareas(dialog, WRITE_REASON);
      await clickConfirmInDialog(dialog, /确认保存/);
      await expectTransientSuccess(page);
    } else {
      await clickScopedButton(thresholdCard, /调整/);
      await completeDialog(page, { confirmName: /确认执行/ });
      await expectTransientSuccess(page);
    }

    await clickFirstAvailableButton(page, [/标可疑/, /批量冻结/, /解除误判/, /判正常/]);
    await completeDialog(page, { confirmName: /确认执行|确认标记|确认/ });
    await expectTransientSuccess(page);

    const cidr = `198.51.${Date.now() % 200}.0/24`;
    await clickVisibleButton(page, /\+ 添加白名单/);
    await completeDialog(page, { inputValue: cidr, confirmName: /确认加白|确认/ });
    await expectTransientSuccess(page);

    const whitelistCard = sectionByTitle(page, /IP 白名单/);
    const addedRow = whitelistCard.locator("tr").filter({ hasText: cidr }).first();
    await expect(addedRow, "新增白名单应回显在 K1 列表").toBeVisible({ timeout: 12_000 });
    await addedRow.locator("button").filter({ hasText: /移除/ }).first().click();
    await completeDialog(page, { confirmName: /确认移除|确认/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "K1");
  });

  await test.step("K2 套利检测: 调检测阈值、处理命中行", async () => {
    await openModuleFromSidebar(page, moduleById("K2"));
    await expectPageHealthy(page, "K2");

    await clickScopedButton(sectionByTitle(page, /检测阈值/), /调整/);
    await completeDialog(page, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    await clickK2Disposition(page);
    await completeDialog(page, { confirmName: /确认执行|确认标记|确认拦截|确认/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "K2");
  });

  await test.step("K3 提现规则: dry-run、调整规则、新建规则、启停、分页", async () => {
    await openModuleFromSidebar(page, moduleById("K3"));
    await expectPageHealthy(page, "K3");
    await assertPagerAndMaybeClick(page, "规则总表");
    await assertPagerAndMaybeClick(page, "命中日志");

    await clickVisibleButton(page, /沙盒模拟/);
    await completeDialog(page, { confirmName: /开始模拟|确认/ });
    await expectTransientSuccess(page);

    await clickScopedButton(sectionByTitle(page, /四道关/), /调整/);
    await completeDialog(page, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    await clickScopedButton(sectionByTitle(page, /规则总表/), /\+ 新建规则/);
    await completeDialog(page, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    await clickFirstAvailableButton(sectionByTitle(page, /规则总表/), [/提交生效/, /停用/, /启用/]);
    await completeDialog(page, { confirmName: /确认执行|确认/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "K3");
  });

  await test.step("K4 风险分: 权重、来源、分档、升级线、用户覆盖与重算、分页", async () => {
    await openModuleFromSidebar(page, moduleById("K4"));
    await expectPageHealthy(page, "K4");
    await assertPagerAndMaybeClick(page, "人工覆盖记录");

    await nudgeTwoWeightSliders(page);
    await clickVisibleButton(page, /提交权重变更/);
    await completeDialog(page, { confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    await clickVisibleButton(page, /切换维度开关/);
    await completeDialog(page, { chooseChip: true, confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    await clickScopedButton(sectionByTitle(page, /分档与全平台分布/).locator(".ktint").filter({ hasText: /分档线/ }).first(), /调整/);
    await completeDialog(page, { inputValue: "38 / 72", confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    await clickScopedButton(sectionByTitle(page, /分档与全平台分布/).locator(".ktint").filter({ hasText: /自动升级线/ }).first(), /调整/);
    await completeDialog(page, { inputValue: "86", confirmName: /确认执行/ });
    await expectTransientSuccess(page);

    pickedUserNo = await pickSearchOption(page, /搜索用户编号 \/ 用户名 \/ 手机号/, "U");
    await clickVisibleButton(page, /人工覆盖评分/);
    await completeDialog(page, { inputValue: "35", confirmName: /确认覆盖|确认/ });
    await expectTransientSuccess(page);

    await clickVisibleButton(page, /重算回模型分/);
    await completeDialog(page, { confirmName: /确认重算|确认/ });
    await expectTransientSuccess(page);
    await expectPageHealthy(page, "K4");
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
  await expect(page.getByText(/K[1-5] 数据加载中/)).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  for (const pattern of fatalTextPatterns) {
    await expect(page.getByText(pattern), `${id} 不应展示错误或 mock/local 兜底文案: ${pattern}`).toHaveCount(0);
  }
}

function sectionByTitle(pageOrScope: Page | Locator, title: RegExp) {
  return pageOrScope.locator("section.l-card").filter({ hasText: title }).first();
}

async function assertPagerAndMaybeClick(page: Page, label: string) {
  const pager = page.locator(`[data-list-pager="true"][data-list-label="${label}"]`).first();
  await expect(pager, `${label} 应展示分页器`).toBeVisible({ timeout: 12_000 });
  const next = pager.getByRole("button", { name: new RegExp(`${escapeRegExp(label)} 下一页`) });
  if (await next.isEnabled().catch(() => false)) {
    await next.click();
    await page.waitForTimeout(600);
    const prev = pager.getByRole("button", { name: new RegExp(`${escapeRegExp(label)} 上一页`) });
    if (await prev.isEnabled().catch(() => false)) {
      await prev.click();
      await page.waitForTimeout(600);
    }
  }
}

async function clickScopedButton(scope: Locator, label: RegExp) {
  const buttons = scope.locator("button").filter({ hasText: label });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await isUsable(button)) {
      await button.scrollIntoViewIfNeeded();
      await button.click();
      return;
    }
  }
  throw new Error(`区域内没有可点击按钮: ${label}`);
}

async function clickVisibleButton(page: Page, label: RegExp) {
  await clickFirstAvailableButton(page, [label]);
}

async function clickFirstAvailableButton(scope: Page | Locator, labels: RegExp[]) {
  for (const label of labels) {
    const buttons = scope.locator("button").filter({ hasText: label });
    const count = await buttons.count();
    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      if (await isUsable(button)) {
        await button.scrollIntoViewIfNeeded();
        await button.click();
        return;
      }
    }
  }
  throw new Error(`页面上没有可点击按钮: ${labels.map(String).join(" / ")}`);
}

async function clickK2Disposition(page: Page) {
  const labels = [/联动 K1 冻结/, /标记套利/, /拦截新人礼/, /标记刷榜/];
  for (let pass = 0; pass < 4; pass += 1) {
    for (const label of labels) {
      const buttons = page.locator("button").filter({ hasText: label });
      const count = await buttons.count();
      for (let i = 0; i < count; i += 1) {
        const button = buttons.nth(i);
        if (await isUsable(button)) {
          await button.scrollIntoViewIfNeeded();
          await button.click();
          return;
        }
      }
    }
    const chips = sectionByTitle(page, /检测命中/).locator(".chip");
    if (pass < await chips.count()) {
      await chips.nth(pass).click();
      await page.waitForTimeout(500);
    }
  }
  throw new Error("K2 当前没有可处理的命中行按钮，可能所有命中都已处置。");
}

async function requireDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog, "点击后必须出现确认/编辑弹窗").toBeVisible({ timeout: 10_000 });
  return dialog;
}

async function completeDialog(
  page: Page,
  options: { inputValue?: string; confirmName?: RegExp; chooseChip?: boolean } = {},
) {
  const dialog = await requireDialog(page);
  await fillDialogInputs(dialog, options.inputValue);
  if (options.chooseChip) {
    await clickFirstChip(dialog);
  }
  await fillAllTextareas(dialog, WRITE_REASON);
  await clickConfirmInDialog(dialog, options.confirmName ?? /确认执行|确认|保存|绑定|导出|放行|冻结|驳回|延迟|标记|拦截/);
}

async function fillDialogInputs(dialog: Locator, inputValue?: string) {
  const inputs = dialog.locator("input:visible");
  const inputCount = await inputs.count();
  for (let i = 0; i < inputCount; i += 1) {
    const input = inputs.nth(i);
    const type = (await input.getAttribute("type")) ?? "text";
    if (type === "checkbox") {
      if (!(await input.isChecked().catch(() => false))) await input.check({ force: true });
      continue;
    }
    if (["radio", "file", "hidden", "range"].includes(type)) continue;
    if (!(await input.isEditable().catch(() => false))) continue;
    const current = await input.inputValue().catch(() => "");
    if (inputValue) {
      await input.fill(inputValueForInput(inputValue, type, await input.getAttribute("placeholder")));
    } else if (!current && type === "number") {
      await input.fill("1");
    }
  }

  const selects = dialog.locator("select:visible");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i);
    const current = await select.inputValue().catch(() => "");
    if (!current) {
      await select.selectOption({ index: 0 }).catch(() => undefined);
    }
  }
}

async function fillK1WeightDialog(dialog: Locator) {
  const values = ["0.55", "0.35", "0.10"];
  const inputs = dialog.locator('input[type="number"]:visible');
  const count = Math.min(await inputs.count(), values.length);
  for (let i = 0; i < count; i += 1) {
    await inputs.nth(i).fill(values[i]);
  }
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

async function clickFirstChip(dialog: Locator) {
  const chips = dialog.locator(".chip");
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

async function nudgeTwoWeightSliders(page: Page) {
  const sliders = sectionByTitle(page, /评分权重/).locator('input[type="range"]');
  await expect(sliders.first(), "K4 权重应有滑块").toBeVisible({ timeout: 12_000 });
  const count = await sliders.count();
  if (count < 2) throw new Error("K4 权重滑块少于 2 个，无法保持总和 100%");
  const first = sliders.nth(0);
  const second = sliders.nth(1);
  const firstValue = Number(await first.inputValue());
  const secondValue = Number(await second.inputValue());
  if (firstValue < 100 && secondValue > 0) {
    await first.focus();
    await first.press("ArrowRight");
    await second.focus();
    await second.press("ArrowLeft");
  } else {
    await first.focus();
    await first.press("ArrowLeft");
    await second.focus();
    await second.press("ArrowRight");
  }
}

async function pickSearchOption(page: Page, placeholder: RegExp, keyword: string) {
  const input = page.getByPlaceholder(placeholder).first();
  await expect(input).toBeVisible({ timeout: 12_000 });
  await input.fill(keyword);
  await page.waitForTimeout(900);
  const option = page.locator('[role="option"], [role="listbox"] button').first();
  await expect(option, `搜索 ${String(placeholder)} 应返回可选择项`).toBeVisible({ timeout: 12_000 });
  const text = await option.innerText();
  await option.click();
  const match = text.match(/\bU\d{4,}\b|usr[_-]?[A-Za-z0-9]+/i);
  return match?.[0] ?? "U00000001";
}

async function expectTransientSuccess(page: Page) {
  await page.waitForTimeout(1_000);
  const failures = mutationFailures.get(page) ?? [];
  expect(failures, "写请求不应返回 4xx/5xx").toEqual([]);
  mutationFailures.set(page, []);
  await expect(page.getByText(/操作失败|保存失败|提交失败|接口写入失败|数据加载失败|报错/)).toHaveCount(0);
}

async function isUsable(locator: Locator) {
  return (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false));
}

function inputValueForInput(value: string, type: string, placeholder: string | null) {
  if (type === "number") {
    if (/覆盖分/.test(placeholder ?? "")) return "35";
    if (/自动升级|分/.test(placeholder ?? "")) return "86";
    return value.match(/^\d+$/) ? value : "1";
  }
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
