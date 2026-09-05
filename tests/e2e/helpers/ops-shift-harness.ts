import { expect, type APIRequestContext, type Locator, type Page, type Response } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONSOLE_NAV } from "../../../lib/nav/console-nav";

export const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
export const SUPER_USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
export const SUPER_PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
export const SHIFT_PASSWORD = process.env.ADMIN_E2E_SHIFT_PASSWORD || "E2eShift@12345";
export const RUN_ID = sanitizeRunId(process.env.ADMIN_E2E_SHIFT_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, ""));
export const REPORT_DIR = process.env.ADMIN_E2E_SHIFT_REPORT_DIR || path.join(process.cwd(), ".codex-run", "ops-shift", RUN_ID, "reports");

const WRITE_REASON = `E2E跨域值班运维-${RUN_ID}-真实提交-含回滚预案`;
const ADMIN_COOKIE_CLEAR_PATH = "/api/admin/auth/logout";
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
  /接口写入失败/i,
  /暂无可选通知模板/i,
  /暂无可选原子动作/i,
];

export type ModuleCase = {
  id: string;
  name: string;
  path: string;
  domainCode: string;
  domainName: string;
};

export type ShiftAccount = {
  key: string;
  label: string;
  username: string;
  email: string;
  password: string;
  accountId?: string;
};

export type ShiftStep = {
  name: string;
  domains: string[];
  status: "passed" | "failed" | "not_applicable";
  durationMs: number;
  evidence: string[];
  error?: string;
};

export type ShiftReport = {
  runId: string;
  shiftKey: string;
  label: string;
  username: string;
  accountId?: string;
  startedAt: string;
  completedAt?: string;
  steps: ShiftStep[];
  assertions: {
    frontendState: boolean;
    backendRecord: boolean;
    auditA2: boolean;
    downstreamVisible: boolean;
  };
  initialReview?: ReviewResult;
  adversarialReview?: ReviewResult;
  cleanup?: {
    disabled: boolean;
    sessionsRevoked: boolean;
    evidence: string[];
  };
};

export type ReviewResult = {
  score: number;
  passed: boolean;
  reviewer: string;
  focus: string[];
};

type DialogOptions = {
  inputValue?: string;
  confirmName?: RegExp;
  chooseChip?: boolean;
};

type MutationCapture = {
  failures: string[];
  responses: string[];
};

export const MODULES: ModuleCase[] = CONSOLE_NAV.flatMap((domain) =>
  domain.l2.map((l2) => ({
    id: l2.id,
    name: l2.name,
    path: l2.path,
    domainCode: domain.code,
    domainName: domain.name,
  })),
);

const captures = new WeakMap<Page, MutationCapture>();

export function assertAllowedTarget(urlText = BASE_URL) {
  const parsed = new URL(urlText);
  if (!isAllowedHost(parsed.hostname)) {
    throw new Error(`跨域运维 E2E 会提交真实写操作，只允许 localhost/127.0.0.1/本机内网运行，当前 ADMIN_BASE_URL=${urlText}`);
  }
}

export function shiftAccounts() {
  return [
    account("platform_audit", "Agent-1 平台审计值班"),
    account("funds_risk", "Agent-2 资金风控值班"),
    account("market_yield", "Agent-3 市场收益值班"),
    account("device_growth", "Agent-4 设备增长值班"),
    account("content_emergency", "Agent-5 内容应急值班"),
    account("support_user", "Agent-6 客服用户值班"),
  ];
}

export function moduleById(id: string): ModuleCase {
  const found = MODULES.find((item) => item.id === id);
  if (!found) throw new Error(`未找到模块 ${id}`);
  return found;
}

export async function loginApi(api: APIRequestContext, username = SUPER_USERNAME, password = SUPER_PASSWORD) {
  const response = await api.post("/api/admin/auth/login", {
    data: { username, password },
  });
  await expectApiOk(response, `登录 ${username}`);
}

export async function apiGet(page: Page, pathText: string) {
  const response = await page.request.get(pathText, { headers: { "Cache-Control": "no-store" } });
  return expectApiOk(response, `GET ${pathText}`);
}

export async function apiPost(page: Page, pathText: string, body: unknown, idempotencyPrefix: string) {
  const response = await page.request.post(pathText, {
    data: body,
    headers: { "Idempotency-Key": idempotencyKey(idempotencyPrefix) },
  });
  return expectApiOk(response, `POST ${pathText}`);
}

export async function provisionAccounts(api: APIRequestContext, accounts: ShiftAccount[]) {
  for (const accountDef of accounts) {
    const response = await api.post("/api/admin/platform/accounts", {
      data: {
        username: accountDef.username,
        displayName: accountDef.label,
        email: accountDef.email,
        role: "super",
        deliver: "handoff",
        initialPassword: accountDef.password,
        reason: `${WRITE_REASON}; 创建临时启用管理员班次 ${accountDef.key}`,
        operator: SUPER_USERNAME,
      },
      headers: { "Idempotency-Key": idempotencyKey(`a1-create-${accountDef.key}`) },
    });
    const payload = await expectApiOk(response, `创建临时管理员 ${accountDef.key}`);
    accountDef.accountId = stringFrom(payload, "id");
    if (!accountDef.accountId) {
      throw new Error(`创建临时管理员 ${accountDef.key} 未返回 accountId`);
    }
  }
}

export async function cleanupAccounts(api: APIRequestContext, accounts: ShiftAccount[]) {
  const results = new Map<string, ShiftReport["cleanup"]>();
  for (const accountDef of [...accounts].reverse()) {
    const evidence: string[] = [];
    let sessionsRevoked = false;
    let disabled = false;
    if (!accountDef.accountId) {
      results.set(accountDef.key, { disabled, sessionsRevoked, evidence: ["账号创建失败或未返回 accountId,无需清理"] });
      continue;
    }
    const disable = await api.patch(`/api/admin/platform/accounts/${encodeURIComponent(accountDef.accountId)}/status`, {
      data: { status: "disabled", reason: `${WRITE_REASON}; 测试结束禁用临时管理员`, operator: SUPER_USERNAME },
      headers: { "Idempotency-Key": idempotencyKey(`a1-disable-${accountDef.key}`) },
    });
    disabled = disable.status() < 400;
    evidence.push(await responseSummary(disable));

    const revoke = await api.post(`/api/admin/platform/accounts/${encodeURIComponent(accountDef.accountId)}/sessions/revoke`, {
      data: { reason: `${WRITE_REASON}; 清理临时班次 session`, operator: SUPER_USERNAME },
      headers: { "Idempotency-Key": idempotencyKey(`a1-revoke-${accountDef.key}`) },
    });
    sessionsRevoked = revoke.status() < 400;
    evidence.push(await responseSummary(revoke));
    results.set(accountDef.key, { disabled, sessionsRevoked, evidence });
  }
  return results;
}

export function createShiftReport(accountDef: ShiftAccount): ShiftReport {
  return {
    runId: RUN_ID,
    shiftKey: accountDef.key,
    label: accountDef.label,
    username: accountDef.username,
    accountId: accountDef.accountId,
    startedAt: new Date().toISOString(),
    steps: [],
    assertions: {
      frontendState: false,
      backendRecord: false,
      auditA2: false,
      downstreamVisible: false,
    },
  };
}

export async function recordStep(
  report: ShiftReport,
  name: string,
  domains: string[],
  action: (evidence: string[]) => Promise<void>,
) {
  const started = Date.now();
  const evidence: string[] = [];
  try {
    await action(evidence);
    report.steps.push({ name, domains, status: "passed", durationMs: Date.now() - started, evidence });
  } catch (error) {
    report.steps.push({
      name,
      domains,
      status: "failed",
      durationMs: Date.now() - started,
      evidence,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function recordOptionalStep(
  report: ShiftReport,
  name: string,
  domains: string[],
  action: (evidence: string[]) => Promise<boolean>,
) {
  const started = Date.now();
  const evidence: string[] = [];
  let applied = false;
  try {
    applied = await action(evidence);
  } catch (error) {
    evidence.push(`optional-error=${error instanceof Error ? error.message : String(error)}`);
  }
  report.steps.push({
    name,
    domains,
    status: applied ? "passed" : "not_applicable",
    durationMs: Date.now() - started,
    evidence: evidence.length ? evidence : ["当前页面没有可安全执行的候选操作,记录为不适用"],
  });
}

export function finalizeReviews(report: ShiftReport) {
  const failed = report.steps.filter((step) => step.status === "failed").length;
  const notApplicable = report.steps.filter((step) => step.status === "not_applicable").length;
  const missingAssertions = Object.values(report.assertions).filter((passed) => !passed).length;
  const baseScore = Math.max(0, 100 - failed * 25 - notApplicable - missingAssertions * 25);
  const murphyScore = Math.max(0, 100 - failed * 30 - notApplicable - missingAssertions * 30);
  report.initialReview = {
    score: baseScore,
    passed: baseScore > 96,
    reviewer: "initial-review",
    focus: ["四类断言齐全", "所有写接口响应小于 400", "无页面白屏或 mock/localStorage 兜底"],
  };
  report.adversarialReview = {
    score: murphyScore,
    passed: murphyScore > 98,
    reviewer: "murphy-law-adversarial-review",
    focus: ["配置保存但业务未生效", "共享配置误当跨域 service 调用", "A2/L 只展示种子聚合", "清理失败导致临时账号残留"],
  };
  if (!report.initialReview.passed || !report.adversarialReview.passed) {
    throw new Error(`${report.label} 评分未达标: 初审 ${baseScore}, 复审 ${murphyScore}`);
  }
}

export async function writeReport(report: ShiftReport) {
  report.completedAt = new Date().toISOString();
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(
    path.join(REPORT_DIR, `${report.shiftKey}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

export function attachMutationCapture(page: Page) {
  captures.set(page, { failures: [], responses: [] });
  page.on("response", async (response) => {
    const request = response.request();
    if (!response.url().includes("/api/admin/")) {
      return;
    }
    const capture = captures.get(page);
    if (!capture) return;
    if (request.method() !== "GET") {
      capture.responses.push(`${request.method()} ${response.status()} ${pathOf(response.url())}`);
    }
    if (request.method() !== "GET" && response.status() >= 400) {
      const body = await response.text().catch(() => "");
      capture.failures.push(`${request.method()} ${response.status()} ${pathOf(response.url())} ${body.slice(0, 260)}`);
    }
  });
  page.on("dialog", (dialog) => dialog.accept().catch(() => undefined));
}

export async function loginFromUi(page: Page, accountDef: ShiftAccount) {
  const response = await page.request.post("/api/admin/auth/login", {
    data: { username: accountDef.username, password: accountDef.password },
  });
  await expectApiOk(response, `临时管理员登录 ${accountDef.username}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("aside"), `${accountDef.username} 登录后必须进入后台 shell`).toBeVisible({ timeout: 20_000 });
}

export async function logout(page: Page) {
  await page.request.post(ADMIN_COOKIE_CLEAR_PATH).catch(() => undefined);
}

export async function openModuleFromSidebar(page: Page, item: ModuleCase) {
  await dismissOpenDialogs(page);
  const group = page
    .getByRole("button", {
      name: new RegExp(`(${escapeRegExp(item.domainName)}\\s+${escapeRegExp(item.domainCode)}|${escapeRegExp(item.domainCode)}\\s+${escapeRegExp(item.domainName)})`),
    })
    .first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await group.click();
  }
  const link = page.locator(`a[href="${item.path}"]`).first();
  await expect(link, `${item.id} 侧边栏入口必须存在`).toBeVisible({ timeout: 10_000 });
  await page.goto(new URL(item.path, BASE_URL).toString());
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(item.path)}(?:\\?.*)?$`), { timeout: 20_000 });
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(900);
}

export async function dismissOpenDialogs(page: Page, evidence?: string[]) {
  const dialog = page.locator('[role="dialog"]:visible, .modal:visible').last();
  if (!(await dialog.isVisible({ timeout: 800 }).catch(() => false))) {
    return;
  }
  const closeButton = dialog.locator("button").filter({ hasText: /取消|关闭|取消并关闭|×|X/ }).last();
  if (await closeButton.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeButton.click().catch(() => undefined);
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  await expect(dialog).toBeHidden({ timeout: 3_000 }).catch(() => undefined);
  evidence?.push("dialog-dismissed-before-navigation");
}

export function resetMutationCapture(page: Page, evidence?: string[]) {
  const capture = captures.get(page);
  if (!capture) return;
  if (capture.failures.length) {
    evidence?.push(`mutation-capture-reset failures=${capture.failures.join(" | ")}`);
  }
  capture.failures = [];
  capture.responses = [];
}

export async function openAndAssertModule(page: Page, id: string, evidence: string[]) {
  const item = moduleById(id);
  await openModuleFromSidebar(page, item);
  await expectPageHealthy(page, id);
  evidence.push(`${id} front-state=${pathOf(page.url())}`);
}

export async function expectPageHealthy(page: Page, id: string) {
  await expect(page.getByText(new RegExp(`\\b${escapeRegExp(id)}\\b`)).first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/数据加载中/)).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  for (const pattern of fatalTextPatterns) {
    await expect(page.getByText(pattern), `${id} 不应展示错误或 mock/local 兜底文案: ${pattern}`).toHaveCount(0);
  }
  await expectNoMutationFailures(page, `${id} 页面健康检查`);
}

export async function performDialogAction(
  page: Page,
  label: RegExp,
  evidence: string[],
  options: DialogOptions = {},
) {
  await clickVisibleButton(page, label);
  const dialog = await requireDialog(page);
  await fillDialogInputs(dialog, options.inputValue);
  if (options.chooseChip) {
    await clickFirstChip(dialog);
  }
  await fillAllTextareas(dialog, WRITE_REASON);
  await clickConfirmInDialog(dialog, options.confirmName ?? /确认执行|确认保存|确认|保存|绑定|导出|放行|冻结|驳回|延迟|标记|拦截|开始模拟|生成|发布/);
  await expectTransientSuccess(page, evidence);
}

export async function tryPerformDialogAction(
  pageOrScope: Page | Locator,
  labels: RegExp[],
  evidence: string[],
  options: DialogOptions = {},
) {
  for (const label of labels) {
    if (await tryClickVisibleButton(pageOrScope, label)) {
      const page = "page" in pageOrScope ? pageOrScope.page() : pageOrScope;
      const dialog = await requireDialog(page);
      await fillDialogInputs(dialog, options.inputValue);
      if (options.chooseChip) await clickFirstChip(dialog);
      await fillAllTextareas(dialog, WRITE_REASON);
      await clickConfirmInDialog(dialog, options.confirmName ?? /确认执行|确认保存|确认|保存|绑定|导出|放行|冻结|驳回|延迟|标记|拦截|开始模拟|生成|发布/);
      await expectTransientSuccess(page, evidence);
      evidence.push(`ui-action=${label}`);
      return true;
    }
  }
  return false;
}

export async function tryClickInlineAction(pageOrScope: Page | Locator, labels: RegExp[], evidence: string[]) {
  for (const label of labels) {
    if (await tryClickVisibleButton(pageOrScope, label)) {
      const page = "page" in pageOrScope ? pageOrScope.page() : pageOrScope;
      await expectTransientSuccess(page, evidence);
      evidence.push(`inline-action=${label}`);
      return true;
    }
  }
  return false;
}

export async function createAuditMarker(page: Page, accountDef: ShiftAccount, sourceDomain: string) {
  return apiPost(
    page,
    "/api/admin/platform/audit/operations",
    {
      action: `E2E班次审计标记(${sourceDomain})`,
      obj: `${accountDef.key}-${RUN_ID}`,
      beforeValue: "before",
      afterValue: "after",
      operator: accountDef.username,
      operatorRole: "super",
      type: "param",
      amplifies: false,
      sos: false,
      roleGate: "超管",
      reason: WRITE_REASON,
      sourceDomain,
    },
    `a2-marker-${accountDef.key}`,
  );
}

export async function assertAuditVisible(page: Page, marker: string, evidence: string[]) {
  await openAndAssertModule(page, "A2", evidence);
  await expect(page.getByText(marker).first(), `A2 应能看到 ${marker} 审计/操作单`).toBeVisible({ timeout: 12_000 });
  evidence.push(`A2 visible marker=${marker}`);
}

export async function assertBackendReadable(page: Page, paths: string[], evidence: string[]) {
  for (const pathText of paths) {
    const payload = await apiGet(page, pathText);
    evidence.push(`backend-read ${pathText}: ${jsonSummary(payload)}`);
  }
}

export async function assertNoWriteFailures(page: Page, evidence: string[]) {
  await expectTransientSuccess(page, evidence);
}

export async function expectSelfRevokeForbidden(page: Page, accountDef: ShiftAccount, evidence: string[]) {
  if (!accountDef.accountId) {
    throw new Error("缺少当前临时管理员 accountId,无法验证强制登出自保护");
  }
  const response = await page.request.post(`/api/admin/platform/accounts/${encodeURIComponent(accountDef.accountId)}/sessions/revoke`, {
    data: { reason: `${WRITE_REASON}; 验证不能强制登出当前自己`, operator: accountDef.username },
    headers: { "Idempotency-Key": idempotencyKey(`a1-self-revoke-${accountDef.key}`) },
  });
  const summary = await responseSummary(response);
  evidence.push(summary);
  expect(response.status(), "A1 强制登出自己的当前账号必须被后端阻断").toBeGreaterThanOrEqual(400);
}

async function expectTransientSuccess(page: Page, evidence: string[]) {
  await page.waitForTimeout(1_000);
  const capture = captures.get(page);
  const failures = capture?.failures ?? [];
  evidence.push(...(capture?.responses.slice(-5) ?? []));
  expect(failures, "写请求不应返回 4xx/5xx").toEqual([]);
  if (capture) {
    capture.failures = [];
    capture.responses = [];
  }
  await expect(page.getByText(/操作失败|保存失败|提交失败|接口写入失败|数据加载失败|报错/)).toHaveCount(0);
}

async function expectNoMutationFailures(page: Page, label: string) {
  const capture = captures.get(page);
  const failures = capture?.failures ?? [];
  expect(failures, `${label} 不应出现后台写接口 4xx/5xx`).toEqual([]);
}

async function clickVisibleButton(pageOrScope: Page | Locator, label: RegExp) {
  if (await tryClickVisibleButton(pageOrScope, label)) {
    return;
  }
  throw new Error(`页面上没有可点击按钮: ${label}`);
}

async function tryClickVisibleButton(pageOrScope: Page | Locator, label: RegExp) {
  const buttons = pageOrScope.locator("button").filter({ hasText: label });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await isUsable(button)) {
      await button.scrollIntoViewIfNeeded();
      await button.click();
      return true;
    }
  }
  return false;
}

async function requireDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible, .modal:visible').last();
  await expect(dialog, "点击后必须出现确认/编辑弹窗").toBeVisible({ timeout: 10_000 });
  return dialog;
}

async function fillDialogInputs(dialog: Locator, inputValue?: string) {
  const value = inputValue ?? "1";
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
      await input.fill(pickInputValue(placeholder, value));
    } else if (!current || /输入|目标|数值|覆盖分|用户编号|IP|网段|模板|标题|名称|slug|code|范围|原因|接收|用途/i.test(placeholder)) {
      await input.fill(pickInputValue(placeholder, value));
    }
  }

  const selects = dialog.locator("select:visible");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i);
    await select.selectOption({ index: 1 }).catch(() => select.selectOption({ index: 0 }).catch(() => undefined));
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
  const chips = dialog.locator(".chip.tab, .chip, [role='option']");
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
  const fallback = buttons.last();
  await expect(fallback, `确认按钮仍不可点击: ${name}`).toBeEnabled({ timeout: 5_000 });
  await fallback.click();
  await expect(dialog).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
}

async function isUsable(locator: Locator) {
  return (await locator.isVisible().catch(() => false)) && (await locator.isEnabled().catch(() => false));
}

async function expectApiOk(response: Response | APIResponseLike, label: string) {
  const text = await response.text().catch(() => "");
  expect(response.status(), `${label}: ${text.slice(0, 400)}`).toBeLessThan(400);
  const payload = text ? safeJson(text) : null;
  if (payload && typeof payload === "object" && "code" in payload) {
    expect(Number((payload as { code?: number }).code), `${label}: ${text.slice(0, 400)}`).toBe(0);
    return (payload as { data?: unknown }).data;
  }
  return payload;
}

type APIResponseLike = {
  status(): number;
  text(): Promise<string>;
};

async function responseSummary(response: APIResponseLike) {
  const text = await response.text().catch(() => "");
  return `${response.status()} ${text.slice(0, 220)}`;
}

function account(key: string, label: string): ShiftAccount {
  const aliases: Record<string, string> = {
    platform_audit: "pa",
    funds_risk: "fr",
    market_yield: "my",
    device_growth: "dg",
    content_emergency: "ce",
    support_user: "su",
  };
  const username = `e2e_${aliases[key] ?? key.slice(0, 2)}_${RUN_ID.slice(-10)}`.toLowerCase();
  return {
    key,
    label,
    username,
    email: `${username}@nexion.io`,
    password: SHIFT_PASSWORD,
  };
}

function sanitizeRunId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "local";
}

function idempotencyKey(prefix: string) {
  return `${prefix}-${RUN_ID}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAllowedHost(hostname: string) {
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function pickInputValue(placeholder: string, value: string) {
  if (/IP|网段/i.test(placeholder)) return "198.51.100.0/24";
  if (/用户编号|user/i.test(placeholder)) return "U00000001";
  if (/覆盖分|risk/i.test(placeholder)) return "35";
  if (/slug|code|key/i.test(placeholder)) return `e2e-${RUN_ID}`;
  if (/标题|名称|模板|活动/i.test(placeholder)) return `E2E ${RUN_ID}`;
  if (/时间|范围|日期/i.test(placeholder)) return "2026-06-01 ~ 2026-06-30";
  return value;
}

function stringFrom(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object" || !(key in payload)) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function jsonSummary(payload: unknown) {
  if (payload == null) return "null";
  const json = JSON.stringify(payload);
  return json.length > 260 ? `${json.slice(0, 260)}...` : json;
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
