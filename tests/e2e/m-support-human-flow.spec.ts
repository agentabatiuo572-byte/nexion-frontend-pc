import { expect, test, type Locator, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const WRITE_REASON = "E2E全流程测试-客服中心真实提交-含回滚预案";
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
  /M 接口写入失败/i,
  /mock 用户详情/i,
  /localStorage/i,
];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const parsed = new URL(BASE_URL);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`M 域全流程测试会提交真实写操作，只允许本地地址运行，当前 ADMIN_BASE_URL=${BASE_URL}`);
  }
});

test.beforeEach(async ({ page }) => {
  mutationFailures.set(page, []);
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() === "GET" || !response.url().includes("/api/admin/") || response.status() < 400) return;
    const failures = mutationFailures.get(page);
    const body = await response.text().catch(() => "");
    failures?.push(`${request.method()} ${response.status()} ${pathOf(response.url())} ${body.slice(0, 240)}`);
  });
  page.on("dialog", (dialog) => dialog.accept().catch(() => undefined));
  await loginFromUi(page);
});

test("M1-M5 客服中心人工路径真实写入全流程", async ({ page }) => {
  const token = Date.now();
  const ticketTitle = `M2 E2E 客服工单 ${token}`;
  const faqQuestion = `M4 E2E FAQ ${token}`;

  await test.step("M1 改负载配置并触发重新均衡", async () => {
    await openModuleFromSidebar(page, moduleById("M1"));
    await clickVisibleButton(page, /调整负载/);
    let dialog = await requireDialog(page);
    await fillLoadDialog(dialog, { saveMode: "config" });
    await clickConfirmInDialog(dialog, /^保存/);
    await expectNoWriteFailures(page, "M1 保存负载配置");

    await clickVisibleButton(page, /调整负载/);
    dialog = await requireDialog(page);
    await fillLoadDialog(dialog, { saveMode: "rebalance" });
    await clickConfirmInDialog(dialog, /立即手动均衡/);
    await expectNoWriteFailures(page, "M1 手动均衡");
    await expectPageHealthy(page, "M1");
  });

  await test.step("M2 新建、回复、改状态、改优先级、分配工单", async () => {
    await openModuleFromSidebar(page, moduleById("M2"));
    await clickByProof(page, "support-ticket-create");
    const dialog = await requireDialog(page);
    await dialog.locator('[data-proof="support-ticket-create-title"]').fill(ticketTitle);
    await dialog.locator('[data-proof="support-ticket-create-body"]').fill("用户咨询提现进度，需要客服建单跟进并同步处理节点。");
    await dialog.locator('[data-proof="support-ticket-create-reason"]').fill(WRITE_REASON);
    await dialog.locator("select").nth(0).selectOption("withdrawal");
    await dialog.locator("select").nth(1).selectOption("high");
    await dialog.locator("select").nth(2).selectOption({ index: 0 });
    await clickConfirmInDialog(dialog, /保存工单/);
    await expectNoWriteFailures(page, "M2 新建工单");

    await page.keyboard.press("Escape").catch(() => undefined);
    await searchAndOpenTicket(page, ticketTitle);
    await page.locator('[data-proof="support-ticket-reply"]').fill("已收到问题，正在核对提现审核和链上广播状态。");
    await clickByProof(page, "support-ticket-reply-save");
    await expectNoWriteFailures(page, "M2 回复工单");

    await clickVisibleButton(page, /优先级/);
    await clickMenuOption(page, /紧急|普通|低/);
    await expectNoWriteFailures(page, "M2 修改优先级");

    await clickVisibleButton(page, /状态/);
    await clickMenuOption(page, /标记处理中|待用户补充|标记已解决/);
    await expectNoWriteFailures(page, "M2 修改状态");

    await clickVisibleButton(page, /转交/);
    await clickSecondRealMenuOption(page);
    await expectNoWriteFailures(page, "M2 转交负责人");
    await expectPageHealthy(page, "M2");
  });

  await test.step("M3 发起、回复、转接、等待、退回、接收、归档、转工单", async () => {
    await openModuleFromSidebar(page, moduleById("M3"));
    await clickByProof(page, "session-initiate");
    await fillAndSubmitInitiateDialog(page);
    await expectNoWriteFailures(page, "M3 主动发起会话");

    await pickActiveConversation(page);
    await page.locator('[data-proof="session-reply"]').fill("您好，我先帮您核对账户和订单记录。");
    await clickByProof(page, "session-reply-save");
    await expectNoWriteFailures(page, "M3 回复会话");

    await transferCurrentConversation(page);
    await expectNoWriteFailures(page, "M3 转交会话");
    await clickByProof(page, "session-transfer-wait");
    await expectNoWriteFailures(page, "M3 等待处理");

    await clickByProof(page, "session-transfer-return");
    await completeReturnDialog(page);
    await expectNoWriteFailures(page, "M3 手动退回");

    await transferCurrentConversation(page);
    await expectNoWriteFailures(page, "M3 再次转交");
    await clickByProof(page, "session-transfer-accept");
    await expectNoWriteFailures(page, "M3 接收转入");

    await page.locator('[data-proof="session-reply"]').fill("已接收转入会话，继续跟进并沉淀为工单。");
    await clickByProof(page, "session-reply-save");
    await expectNoWriteFailures(page, "M3 接收后回复");

    await clickByProof(page, "session-to-ticket");
    await completeOperationDialog(page, { confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M3 转工单");

    await clickByProof(page, "session-status");
    await expectNoWriteFailures(page, "M3 标记已解决");
    if (!(await tryClickByProof(page, "session-archive"))) {
      await tryClickByProof(page, "session-archive-batch");
    }
    await expectNoWriteFailures(page, "M3 归档会话");
    await expectPageHealthy(page, "M3");
  });

  await test.step("M4 新增/上下架 FAQ，并修改 SLA", async () => {
    await openModuleFromSidebar(page, moduleById("M4"));
    await clickVisibleButton(page, /新增文章/);
    let dialog = await requireDialog(page);
    await dialog.locator('[data-proof="support-faq-question"]').fill(faqQuestion);
    await dialog.locator('[data-proof="support-faq-answer"]').fill("请在提现记录中确认状态，若超过 SLA 可提交工单由客服跟进。");
    await dialog.locator('[data-proof="support-faq-reason"]').fill(WRITE_REASON);
    await dialog.locator("select").nth(2).selectOption("draft");
    await clickConfirmInDialog(dialog, /保存 FAQ/);
    await expectNoWriteFailures(page, "M4 新增 FAQ");

    await clickByProof(page, "support-faq-publish");
    await expectNoWriteFailures(page, "M4 发布 FAQ");
    await clickByProof(page, "support-faq-unpublish");
    await expectNoWriteFailures(page, "M4 下架 FAQ");

    await page.locator('button[title="编辑 SLA"]').first().click();
    dialog = await requireDialog(page);
    const numbers = dialog.locator('input[type="number"]:visible');
    await numbers.nth(0).fill("12");
    await numbers.nth(1).fill("8");
    await dialog.locator("input:visible").nth(2).fill("Payment desk");
    await dialog.locator("input:visible").nth(3).fill("D2 提现审核队列");
    await dialog.locator("input:visible").last().fill(WRITE_REASON);
    await clickConfirmInDialog(dialog, /保存 SLA/);
    await expectNoWriteFailures(page, "M4 保存 SLA");
    await expectPageHealthy(page, "M4");
  });

  await test.step("M5 改客服岗位、绑定/解绑专属顾问、改类别/策略、维护话术和模板", async () => {
    await openModuleFromSidebar(page, moduleById("M5"));
    await clickVisibleButton(page, /配置岗位/);
    let dialog = await requireDialog(page);
    await ensureChipSelected(dialog, /专属顾问/);
    await fillAllTextareas(dialog, "E2E全流程测试-客服主管配置岗位和专属顾问服务");
    await dialog.locator('input[type="number"]:visible').first().fill("9");
    await clickConfirmInDialog(dialog, /保存/);
    await expectNoWriteFailures(page, "M5 配置客服岗位");

    await clickVisibleButton(page, /绑定用户/);
    dialog = await requireDialog(page);
    await dialog.locator("input:visible").first().fill("U");
    await selectAdvisorUsers(dialog, 2);
    await fillAllTextareas(dialog, "E2E全流程测试-批量绑定专属顾问服务用户");
    await expect(dialog.locator('[data-proof="advisor-assignment-save"]')).toBeEnabled({ timeout: 8_000 });
    await dialog.locator('[data-proof="advisor-assignment-save"]').click();
    await expect(dialog).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
    await expectNoWriteFailures(page, "M5 批量绑定专属顾问");

    await page.waitForTimeout(900);
    const assignmentChip = page.locator("button.chip:visible").filter({ hasText: /U\d{4,}|U-/ }).first();
    if (await assignmentChip.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await assignmentChip.click();
      await completeOperationDialog(page, { confirmName: /确认执行/ });
      await expectNoWriteFailures(page, "M5 解绑专属顾问");
    }

    await clickByProof(page, "session-cat-toggle-support");
    await completeOperationDialog(page, { confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 会话类别启停");

    await clickByProof(page, "session-policy-enabled");
    await completeOperationDialog(page, { confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 主动推送总开关");

    await clickByProof(page, "session-policy-delay");
    await completeOperationDialog(page, { editValue: "1800", confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 首推延迟");

    await clickByProof(page, "session-policy-audience");
    await completeOperationDialog(page, { confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 受众圈定");

    await clickByProof(page, "session-script-new");
    await completeOperationDialog(page, { editValue: `E2E 顾问主动话术 ${token}`, confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 新增顾问话术");

    await page.locator('[data-proof^="session-script-publish-"]').first().click();
    await completeOperationDialog(page, { confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 发布/下架顾问话术");

    await clickByProof(page, "session-tpl-new");
    await completeOperationDialog(page, { editValue: `E2E 即时回复模板 ${token}`, confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 新增即时回复模板");

    await page.locator('[data-proof^="session-tpl-publish-"]').first().click();
    await completeOperationDialog(page, { confirmName: /确认执行/ });
    await expectNoWriteFailures(page, "M5 发布/归档即时回复模板");
    await expectPageHealthy(page, "M5");
  });
});

function moduleById(id: string): ModuleCase {
  const found = MODULES.find((item) => item.id === id);
  if (!found) throw new Error(`未找到模块 ${id}`);
  return found;
}

async function loginFromUi(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await usernameInput.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openModuleFromSidebar(page: Page, item: ModuleCase) {
  const group = page
    .getByRole("button", { name: new RegExp(`(${escapeRegExp(item.domainName)}\\s+${escapeRegExp(item.domainCode)}|${escapeRegExp(item.domainCode)}\\s+${escapeRegExp(item.domainName)})`) })
    .first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
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

async function expectNoWriteFailures(page: Page, label: string) {
  await page.waitForTimeout(1300);
  const failures = mutationFailures.get(page) ?? [];
  expect(failures, `${label} 不应出现后台写接口 4xx/5xx`).toEqual([]);
  mutationFailures.set(page, []);
  await expect(page.getByText(/M 接口写入失败|操作失败|保存失败|提交失败|数据加载失败|报错/)).toHaveCount(0);
}

async function clickByProof(page: Page, proof: string) {
  const target = page.locator(`[data-proof="${proof}"]`).first();
  await expect(target, `应存在可点击控件 ${proof}`).toBeVisible({ timeout: 12_000 });
  await target.scrollIntoViewIfNeeded();
  await target.click();
}

async function tryClickByProof(page: Page, proof: string) {
  const target = page.locator(`[data-proof="${proof}"]`).first();
  if (!(await target.isVisible({ timeout: 3_000 }).catch(() => false))) return false;
  if (!(await target.isEnabled().catch(() => false))) return false;
  await target.scrollIntoViewIfNeeded();
  await target.click();
  return true;
}

async function clickVisibleButton(page: Page, label: RegExp) {
  if (await tryClickVisibleButton(page, label)) return;
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

async function fillLoadDialog(dialog: Locator, options: { saveMode: "config" | "rebalance" }) {
  const numbers = dialog.locator('input[type="number"]:visible');
  const count = await numbers.count();
  for (let i = 0; i < count; i += 1) {
    const input = numbers.nth(i);
    if (!(await input.isEditable().catch(() => false))) continue;
    await input.fill(i === 2 ? "75" : String(8 + (i % 4)));
  }
  const textInputs = dialog.locator('input:not([type="number"]):visible');
  const textCount = await textInputs.count();
  for (let i = 0; i < textCount; i += 1) {
    const input = textInputs.nth(i);
    if (await input.isEditable().catch(() => false)) await input.fill("转人工备勤队列");
  }
  await fillAllTextareas(dialog, options.saveMode === "config" ? "E2E全流程测试-调整客服负载配置" : "E2E全流程测试-触发客服重新均衡");
}

async function searchAndOpenTicket(page: Page, title: string) {
  await page.waitForTimeout(1800);
  const search = page.locator('[data-proof="support-ticket-search"]');
  await search.fill(title);
  const row = page.locator("tbody tr").filter({ hasText: title }).first();
  await expect(row, "新建工单应在后端刷新后的列表中出现").toBeVisible({ timeout: 15_000 });
  await row.click();
  await expect(page.locator(".tk-drawer")).toBeVisible({ timeout: 8_000 });
}

async function clickMenuOption(page: Page, label: RegExp) {
  const menu = page.locator('div[style*="position: absolute"][style*="z-index: 30"]').last();
  await expect(menu).toBeVisible({ timeout: 5_000 });
  const option = menu.locator("button").filter({ hasText: label }).first();
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

async function clickSecondRealMenuOption(page: Page) {
  const menu = page.locator('div[style*="position: absolute"][style*="z-index: 30"]').last();
  await expect(menu).toBeVisible({ timeout: 5_000 });
  const options = menu.locator("button");
  const count = await options.count();
  for (let i = 1; i < count; i += 1) {
    const option = options.nth(i);
    const text = await option.innerText().catch(() => "");
    if (!/Unassigned|未分配/.test(text) && await isUsable(option)) {
      await option.click();
      return;
    }
  }
  throw new Error("M2 转交至少需要两个真实客服负责人");
}

async function fillAndSubmitInitiateDialog(page: Page) {
  const dialog = await requireDialog(page);
  await dialog.getByText("圈选人群").click();
  const textareas = dialog.locator("textarea:visible");
  const count = await textareas.count();
  if (count > 0) await textareas.nth(0).fill(WRITE_REASON);
  if (count > 1) await textareas.nth(count - 1).fill("您好，这里是 Nexion 客服，针对近期服务事项主动联系您。");
  await clickConfirmInDialog(dialog, /发起会话/);
}

async function pickActiveConversation(page: Page) {
  await page.waitForTimeout(1800);
  await clickVisibleButton(page, /进行中/).catch(() => undefined);
  const item = page.locator(".cv-item:visible").first();
  await expect(item, "M3 应有可处理会话").toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(page.locator('[data-proof="session-reply"]')).toBeVisible({ timeout: 12_000 });
}

async function transferCurrentConversation(page: Page) {
  await clickByProof(page, "session-transfer");
  const dialog = await requireDialog(page);
  await fillAllTextareas(dialog, "E2E全流程测试-跨坐席转接并验证待处理队列");
  await clickConfirmInDialog(dialog, /转交 · 转入待处理/);
}

async function completeReturnDialog(page: Page) {
  const dialog = await requireDialog(page);
  await fillAllTextareas(dialog, "E2E全流程测试-退回来源坐席重新分配");
  await clickConfirmInDialog(dialog, /确认退回/);
}

async function completeOperationDialog(page: Page, options: { editValue?: string; confirmName?: RegExp } = {}) {
  const dialog = await requireDialog(page);
  const inputs = dialog.locator("input:visible");
  const inputCount = await inputs.count();
  for (let i = 0; i < inputCount; i += 1) {
    const input = inputs.nth(i);
    const type = (await input.getAttribute("type")) ?? "text";
    if (["checkbox", "radio", "file", "hidden"].includes(type)) continue;
    if (!(await input.isEditable().catch(() => false))) continue;
    await input.fill(options.editValue ?? (type === "number" ? "1" : `E2E-${Date.now()}`));
  }
  await clickFirstChip(dialog);
  await fillAllTextareas(dialog, WRITE_REASON);
  await clickConfirmInDialog(dialog, options.confirmName ?? /确认执行|确认|保存|绑定|发布|归档|下架/);
}

async function fillAllTextareas(scope: Locator, text: string) {
  const textareas = scope.locator("textarea:visible");
  const count = await textareas.count();
  for (let i = 0; i < count; i += 1) {
    const area = textareas.nth(i);
    if (await area.isEditable().catch(() => false)) await area.fill(text);
  }
}

async function clickFirstChip(dialog: Locator) {
  const chips = dialog.locator(".chip.tab, .chip");
  const count = await chips.count();
  for (let i = 0; i < count; i += 1) {
    const chip = chips.nth(i);
    const selected = ((await chip.getAttribute("class")) ?? "").includes("sel");
    if (!selected && await chip.isVisible().catch(() => false) && await chip.isEnabled().catch(() => false)) {
      await chip.click();
      return;
    }
  }
}

async function ensureChipSelected(dialog: Locator, label: RegExp) {
  const chip = dialog.locator(".chip").filter({ hasText: label }).first();
  await expect(chip).toBeVisible({ timeout: 8_000 });
  const selected = ((await chip.getAttribute("class")) ?? "").includes("sel");
  if (!selected) await chip.click();
}

async function selectAdvisorUsers(dialog: Locator, targetCount: number) {
  await pageWaitForUserRows(dialog);
  const buttons = dialog.locator('[data-proof="advisor-user-option"]');
  const count = await buttons.count();
  let picked = 0;
  for (let i = 0; i < count && picked < targetCount; i += 1) {
    const button = buttons.nth(i);
    if (await isUsable(button)) {
      await button.click();
      picked += 1;
    }
  }
  expect(picked, "专属顾问绑定应能从真实用户下拉中至少选择 1 个用户").toBeGreaterThan(0);
  await expect(dialog.getByText(new RegExp(`已选 ${picked} 人`))).toBeVisible({ timeout: 8_000 });
}

async function pageWaitForUserRows(dialog: Locator) {
  await expect(dialog.locator('[data-proof="advisor-user-option"]').first()).toBeVisible({ timeout: 15_000 });
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

async function isUsable(locator: Locator) {
  return (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false));
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
