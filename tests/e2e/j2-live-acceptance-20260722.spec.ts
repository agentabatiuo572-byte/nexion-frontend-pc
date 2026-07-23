import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR = process.env.J2_ACCEPTANCE_EVIDENCE_DIR
  || "D:/workspace/bug-pic/j-domain-acceptance-20260722/j2/initial";
const RUN_ID = process.env.J2_ACCEPTANCE_RUN_ID || `J2-${Date.now()}`;

type GeoSnapshot = {
  blocked: Array<{ cc: string; name: string }>;
  limited: Array<{ cc: string; name: string }>;
  countryOptions: Array<{ value: string; label: string }>;
  endpoints: Array<{
    key: string;
    label: string;
    source: "derived" | "explicit";
    countries: string[];
    configurable: boolean;
  }>;
};

mkdirSync(EVIDENCE_DIR, { recursive: true });

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-");
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${safeName(name)}.png`), fullPage: true });
}

async function loginFromVisibleEntry(page: Page) {
  await loginCredentialsFromVisibleEntry(page, USERNAME, PASSWORD);
}

async function loginCredentialsFromVisibleEntry(
  page: Page,
  username: string,
  password: string,
  changedPassword?: string,
) {
  await page.goto("/");
  await expect(page.getByLabel(/用户名|账号/).first()).toBeVisible();
  await page.getByLabel(/用户名|账号/).first().fill(username);
  await page.getByLabel(/密码/).first().fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).first().click();
  for (let step = 0; step < 30; step += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    if (await page.getByRole("heading", { name: "双因素身份验证" }).isVisible().catch(() => false)) {
      const secret = (await page.locator("code").textContent())?.trim();
      if (!secret) throw new Error(`MFA_SECRET_NOT_AVAILABLE_FOR_${username}`);
      await verifyMfaWithSingleBoundaryRetry(page, secret, username);
      continue;
    }
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      if (!changedPassword) throw new Error(`PASSWORD_CHANGE_REQUIRED_FOR_${username}`);
      await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(changedPassword);
      try {
        await page.getByRole("button", { name: "确认修改并进入", exact: true }).click({ timeout: 5_000 });
      } catch (error) {
        // 成功提交会立即替换整棵登录 DOM；只在真实进入控制台时接受该 detach 竞态。
        if (!await page.locator("aside").isVisible().catch(() => false)) throw error;
        return;
      }
      continue;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function verifyMfaWithSingleBoundaryRetry(page: Page, secret: string, username: string) {
  const waitPastBoundaryWhenNearExpiry = async () => {
    const remainingMs = 30_000 - (Date.now() % 30_000);
    if (remainingMs <= 3_000) await page.waitForTimeout(remainingMs + 500);
  };
  await waitPastBoundaryWhenNearExpiry();
  let previousCode = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let code = totp(secret);
    if (attempt === 1 && code === previousCode) {
      const remainingMs = 30_000 - (Date.now() % 30_000);
      await page.waitForTimeout(remainingMs + 500);
      code = totp(secret);
    }
    previousCode = code;
    await page.getByLabel("一次性验证码").fill(code);
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/admin/auth/mfa/verify"));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await responsePromise;
    const raw = await response.text();
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* keep raw for the final diagnostic */ }
    if (response.ok() && (body?.code === undefined || body.code === 0)) {
      await expect(page.getByRole("heading", { name: "双因素身份验证" })).toBeHidden({ timeout: 10_000 });
      return;
    }
    if (attempt === 1) {
      throw new Error(`MFA_VERIFY_FAILED_FOR_${username}: HTTP ${response.status()} ${raw}`);
    }
  }
}

function totp(secret: string) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function decodeBase32(raw: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = raw.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

async function openJ2FromVisibleMenu(page: Page) {
  const link = page.locator('a[href="/emergency/geo-block"]').first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.getByRole("button", { name: /紧急与合规控制/ }).first();
    await group.scrollIntoViewIfNeeded();
    await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/geo-block$/);
  await expect(page.getByText("黑名单（完全封禁）", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function logoutFromVisibleAccountMenu(page: Page) {
  await page.getByRole("button", { name: /Super Admin.*总管理员|总管理员.*Super Admin/ }).first().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel(/用户名|账号/).first()).toBeVisible({ timeout: 20_000 });
}

async function readGeoSnapshot(page: Page): Promise<GeoSnapshot> {
  const response = await page.request.get("/api/admin/emergency/geo-block");
  expect(response.ok(), `J2 权威快照读取失败: ${response.status()}`).toBeTruthy();
  const raw = await response.json();
  return (raw?.data ?? raw) as GeoSnapshot;
}

async function apiSend(page: Page, method: string, url: string, body?: unknown) {
  const response = await page.request.fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `j2-accept-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    data: body,
  });
  const raw = await response.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* keep raw evidence */ }
  return { status: response.status(), raw, data: json?.data ?? json };
}

function auditTicketId(data: any) {
  const operationId = String(data?.operationId ?? data?.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function decideAuditTicket(
  page: Page,
  operationId: string,
  decision: "approve" | "reject",
  reason: string,
  operator = USERNAME,
) {
  const response = await apiSend(
    page,
    "POST",
    `/api/admin/platform/audit/operations/${operationId}/${decision}`,
    { reason, operator },
  );
  expect(response.status, response.raw).toBeLessThan(400);
  return response;
}

function chooseUnusedCountry(snapshot: GeoSnapshot, excluded: Set<string>) {
  const occupied = new Set([
    ...snapshot.blocked.map((item) => item.cc),
    ...snapshot.limited.map((item) => item.cc),
    ...excluded,
  ]);
  const option = snapshot.countryOptions.find((item) => !occupied.has(item.value));
  if (!option) throw new Error("J2 没有可用于可恢复验收的国家候选");
  return option;
}

async function selectCountryChip(page: Page, code: string) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  const search = dialog.getByRole("searchbox", { name: /国家或地区.*搜索/ }).first();
  await search.fill(code);
  const option = dialog.locator('[data-proof="multi-select-countries"] button').filter({ hasText: new RegExp(`（${code}）`) }).first();
  await expect(option).toBeVisible();
  await option.click();
}

async function selectTrigger(page: Page, value = "监管点名") {
  const dialog = page.locator('[role="dialog"]:visible').last();
  const field = dialog.locator("label").filter({ hasText: "触发依据" }).locator("select").first();
  await expect(field).toBeVisible();
  await field.selectOption({ label: value });
}

async function fillReasonAndSubmit(page: Page, reason: string, responsePattern: RegExp) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  const confirm = dialog.getByRole("button", { name: "确认提交" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await expect(confirm).toBeEnabled();
  const responsePromise = page.waitForResponse((response) => responsePattern.test(response.url()) && response.request().method() !== "GET");
  await confirm.click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

async function editList(page: Page, kind: "blocked" | "limited", code: string, add: boolean, reason: string) {
  await page.getByRole("button", { name: kind === "blocked" ? "编辑黑名单" : "编辑受限名单", exact: true }).click();
  await selectCountryChip(page, code);
  if (kind === "blocked" && add) await selectTrigger(page);
  await fillReasonAndSubmit(
    page,
    reason,
    new RegExp(`/api/admin/emergency/geo-block/country-lists/${kind}`),
  );
}

async function verifyCountryState(page: Page, code: string, expected: "blocked" | "limited" | "allowed") {
  const snapshot = await readGeoSnapshot(page);
  const blocked = snapshot.blocked.some((item) => item.cc === code);
  const limited = snapshot.limited.some((item) => item.cc === code);
  expect(blocked).toBe(expected === "blocked");
  expect(limited).toBe(expected === "limited");
}

async function selectEndpointMode(page: Page, mode: "derived" | "explicit") {
  const dialog = page.locator('[role="dialog"]:visible').last();
  const select = dialog.locator("label").filter({ hasText: "设置方式" }).locator("select").first();
  await select.selectOption(mode);
}

test.describe.serial("J2 Geo-block 独立真实验收", () => {
  const runtime: Record<string, unknown> = { runId: RUN_ID, tests: [] as unknown[] };

  test.afterEach(async ({ page }, testInfo: TestInfo) => {
    (runtime.tests as unknown[]).push({
      title: testInfo.title,
      status: testInfo.status,
      expectedStatus: testInfo.expectedStatus,
      errors: testInfo.errors.map((error) => error.message),
    });
    writeFileSync(path.join(EVIDENCE_DIR, "run-summary.json"), JSON.stringify(runtime, null, 2), "utf8");
    await testInfo.attach("J2 run summary", {
      path: path.join(EVIDENCE_DIR, "run-summary.json"),
      contentType: "application/json",
    });
    if (testInfo.status !== testInfo.expectedStatus) await shot(page, `failure-${safeName(testInfo.title)}`);
  });

  test("首次用户从登录和侧栏进入，理解权威状态、校验与刷新重登", async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const unauthorizedResponses: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`));
    page.on("response", (response) => {
      if (response.status() === 401) unauthorizedResponses.push(`${response.request().method()} ${response.url()}`);
    });

    await loginFromVisibleEntry(page);
    await shot(page, "01-login-success-visible-shell");
    await openJ2FromVisibleMenu(page);
    await expect(page.getByText("封锁在服务端业务入口生效，客户端无法绕过。", { exact: true })).toBeVisible();
    await expect(page.getByText("边缘 IP 判定", { exact: true })).toBeVisible();
    await expect(page.getByText("最近 J2 变更", { exact: true })).toBeVisible();
    await shot(page, "02-j2-overview-from-sidebar");

    await page.getByRole("button", { name: "编辑黑名单", exact: true }).click();
    const dialog = page.locator('[role="dialog"]:visible').last();
    await expect(dialog).toHaveAccessibleName("编辑全局封禁名单");
    await dialog.getByRole("button", { name: /执行摘要.*查看详情/ }).click();
    await expect(dialog.getByText(/提交的是完整封禁名单/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
    await expect(dialog.getByText(/还需补充 8 字/)).toBeVisible();
    await shot(page, "03-blacklist-modal-validation");
    await dialog.getByRole("button", { name: "取消" }).click();

    await page.reload();
    await expect(page.getByText("黑名单（完全封禁）", { exact: true })).toBeVisible({ timeout: 20_000 });
    await logoutFromVisibleAccountMenu(page);
    await loginFromVisibleEntry(page);
    await openJ2FromVisibleMenu(page);
    await shot(page, "04-j2-refresh-relogin-persistence");
    runtime.logoutUnauthorizedResponses = unauthorizedResponses;

    const unexpectedConsoleErrors = consoleErrors.filter((message) => !message.includes("status of 401"));
    expect(unexpectedConsoleErrors, consoleErrors.join("\n")).toEqual([]);
    const unexpectedFailedRequests = failedRequests.filter((message) => !message.includes("net::ERR_ABORTED"));
    expect(unexpectedFailedRequests, failedRequests.join("\n")).toEqual([]);
  });

  test("应急封锁、受限名单、端点派生均经可见控件写入并完整恢复", async ({ page }) => {
    await loginFromVisibleEntry(page);
    await openJ2FromVisibleMenu(page);
    const initial = await readGeoSnapshot(page);
    const emergencyCountry = chooseUnusedCountry(initial, new Set());
    const limitedCountry = chooseUnusedCountry(initial, new Set([emergencyCountry.value]));
    runtime.initialSnapshot = initial;
    runtime.testCountries = { emergencyCountry, limitedCountry };

    try {
      await page.getByRole("button", { name: "应急封锁", exact: true }).click();
      await selectCountryChip(page, emergencyCountry.value);
      await selectTrigger(page, "监管点名");
      await fillReasonAndSubmit(page, `${RUN_ID} 监管演练应急封锁`, /\/api\/admin\/emergency\/geo-block\/emergency-blocks/);
      await verifyCountryState(page, emergencyCountry.value, "blocked");
      await shot(page, "05-emergency-block-success");

      await page.reload();
      await expect(page.getByText("黑名单（完全封禁）", { exact: true })).toBeVisible({ timeout: 20_000 });
      await editList(page, "blocked", emergencyCountry.value, false, `${RUN_ID} 演练完成恢复原状态`);
      await verifyCountryState(page, emergencyCountry.value, "allowed");
      await shot(page, "06-emergency-block-restored");

      await editList(page, "limited", limitedCountry.value, true, `${RUN_ID} 受限资金入口演练`);
      await verifyCountryState(page, limitedCountry.value, "limited");
      await page.reload();
      await expect(page.getByText("受限名单（只读）", { exact: true })).toBeVisible({ timeout: 20_000 });
      await shot(page, "07-limited-state-refresh-persisted");
      await editList(page, "limited", limitedCountry.value, false, `${RUN_ID} 受限演练完成恢复`);
      await verifyCountryState(page, limitedCountry.value, "allowed");

      const endpoint = initial.endpoints.find((item) => item.configurable);
      expect(endpoint, "至少应有一个可配置的真实业务入口").toBeTruthy();
      const row = page.locator(".deriv-tbl .rw").filter({ hasText: endpoint!.label }).first();
      await row.getByRole("button", { name: "编辑封锁范围", exact: true }).click();
      const targetMode = endpoint!.source === "derived" ? "explicit" : "derived";
      await selectEndpointMode(page, targetMode);
      if (targetMode === "explicit") await selectCountryChip(page, emergencyCountry.value);
      await fillReasonAndSubmit(page, `${RUN_ID} 端点派生模式演练`, new RegExp(`/api/admin/emergency/geo-block/endpoints/${endpoint!.key}`));
      let changed = await readGeoSnapshot(page);
      expect(changed.endpoints.find((item) => item.key === endpoint!.key)?.source).toBe(targetMode);
      await shot(page, "08-endpoint-policy-mutated");

      const changedRow = page.locator(".deriv-tbl .rw").filter({ hasText: endpoint!.label }).first();
      await changedRow.getByRole("button", { name: "编辑封锁范围", exact: true }).click();
      await selectEndpointMode(page, endpoint!.source);
      if (endpoint!.source === "explicit") {
        for (const code of endpoint!.countries) await selectCountryChip(page, code);
      }
      await fillReasonAndSubmit(page, `${RUN_ID} 端点派生恢复原状态`, new RegExp(`/api/admin/emergency/geo-block/endpoints/${endpoint!.key}`));
      changed = await readGeoSnapshot(page);
      const restored = changed.endpoints.find((item) => item.key === endpoint!.key);
      expect(restored?.source).toBe(endpoint!.source);
      expect([...(restored?.countries ?? [])].sort()).toEqual([...endpoint!.countries].sort());
      await shot(page, "09-endpoint-policy-restored");

      await page.reload();
      await expect(page.getByText("最近 J2 变更", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(new RegExp(RUN_ID)).first()).toBeVisible();
      await shot(page, "10-audit-visible-after-clean-state");
    } finally {
      const current = await readGeoSnapshot(page).catch(() => null);
      if (current?.blocked.some((item) => item.cc === emergencyCountry.value)) {
        await editList(page, "blocked", emergencyCountry.value, false, `${RUN_ID} finally 恢复黑名单`).catch(() => undefined);
      }
      if (current?.limited.some((item) => item.cc === limitedCountry.value)) {
        await editList(page, "limited", limitedCountry.value, false, `${RUN_ID} finally 恢复受限名单`).catch(() => undefined);
      }
    }
  });

  test("墨菲故障注入时失败关闭，恢复网络后可重新读取", async ({ page }) => {
    await loginFromVisibleEntry(page);
    await page.route("**/api/admin/emergency/geo-block", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "EMERGENCY_API_503" }),
      });
    });
    await openJ2FromVisibleMenu(page).catch(() => undefined);
    await expect(page.getByRole("alert").filter({ hasText: "当前无法确认最新状态" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/为避免误操作，控制项已隐藏/)).toBeVisible();
    await expect(page.getByRole("button", { name: "编辑黑名单" })).toHaveCount(0);
    await shot(page, "11-503-fail-closed");

    await page.unroute("**/api/admin/emergency/geo-block");
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(page.getByText("黑名单（完全封禁）", { exact: true })).toBeVisible({ timeout: 20_000 });
    await shot(page, "12-503-recovered");
  });

  test("只读角色能查看但无写按钮，绕过页面写入与超管告警均被服务器拒绝", async ({ page, browser }) => {
    await loginFromVisibleEntry(page);
    const suffix = `${Date.now()}`.slice(-9);
    const roleCode = `J2_RO_${suffix}`;
    const username = `j2r${suffix}`;
    const password = "J2Reader@12345678";
    const changedReaderPassword = "J2Reader@23456789";
    const checkerUsername = `j2c${suffix}`;
    const checkerInitialPassword = "J2Checker@12345678";
    const checkerPassword = "J2Checker@23456789";
    let accountId = "";
    let checkerAccountId = "";
    let roleId = "";
    let roleCreated = false;
    let pendingGrantTicket = "";
    let checkerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
    let checkerPage: Page | null = null;

    try {
      const checkerAccount = await apiSend(page, "POST", "/api/admin/platform/accounts", {
        username: checkerUsername,
        displayName: `J2 Checker ${suffix}`,
        email: `${checkerUsername}@nexion.invalid`,
        role: "super",
        deliver: "handoff",
        initialPassword: checkerInitialPassword,
        reason: `${RUN_ID} 创建 J2 双人复核临时账号`,
        operator: USERNAME,
      });
      expect(checkerAccount.status, checkerAccount.raw).toBeLessThan(400);
      checkerAccountId = String(checkerAccount.data?.id ?? checkerAccount.data?.accountId ?? "");
      expect(checkerAccountId).not.toBe("");
      checkerContext = await browser.newContext({ viewport: { width: 1680, height: 950 } });
      checkerPage = await checkerContext.newPage();
      await loginCredentialsFromVisibleEntry(
        checkerPage,
        checkerUsername,
        checkerInitialPassword,
        checkerPassword,
      );

      const role = await apiSend(page, "POST", "/api/admin/platform/roles", {
        roleCode,
        roleName: `J2 只读验收 ${suffix}`,
        remark: "J2 验收临时角色，完成后删除",
        status: 1,
        reason: `${RUN_ID} 创建 J2 临时只读角色`,
        operator: USERNAME,
      });
      expect(role.status, role.raw).toBeLessThan(400);
      roleCreated = true;
      roleId = String(role.data?.id ?? "");
      expect(roleId).not.toBe("");

      const menus = await apiSend(page, "GET", "/api/admin/platform/menus/overview");
      expect(menus.status, menus.raw).toBeLessThan(400);
      const flattened: Array<{ id: number; menuCode: string }> = [];
      const visit = (nodes: any[]) => nodes.forEach((item) => {
        flattened.push(item.node);
        visit(item.children ?? []);
      });
      visit(menus.data?.tree ?? []);
      const menuIds = flattened.filter((item) => item.menuCode === "J" || item.menuCode === "J2").map((item) => item.id);
      expect(menuIds).toHaveLength(2);
      const grants = await apiSend(page, "PUT", `/api/admin/platform/roles/${roleId}/grants`, {
        permissionCodes: ["emergency_j2_read"],
        menuIds,
        reason: `${RUN_ID} 绑定 J2 只读权限与菜单`,
        operator: USERNAME,
      });
      expect(grants.status, grants.raw).toBeLessThan(400);
      pendingGrantTicket = auditTicketId(grants.data);

      const beforeApproval = await apiSend(page, "GET", `/api/admin/platform/roles/${roleId}`);
      expect(beforeApproval.status, beforeApproval.raw).toBeLessThan(400);
      expect(beforeApproval.data?.permissionCodes ?? []).toEqual([]);
      await decideAuditTicket(
        checkerPage!,
        pendingGrantTicket,
        "approve",
        `${RUN_ID} 复核并执行 J2 只读权限绑定`,
        checkerUsername,
      );
      pendingGrantTicket = "";
      const afterApproval = await apiSend(page, "GET", `/api/admin/platform/roles/${roleId}`);
      expect(afterApproval.status, afterApproval.raw).toBeLessThan(400);
      expect(afterApproval.data?.permissionCodes).toEqual(["emergency_j2_read"]);
      expect((afterApproval.data?.menuIds ?? []).sort((a: number, b: number) => a - b))
        .toEqual([...menuIds].sort((a, b) => a - b));

      const account = await apiSend(page, "POST", "/api/admin/platform/accounts", {
        username,
        displayName: `J2 Reader ${suffix}`,
        email: `${username}@nexion.invalid`,
        role: roleCode,
        deliver: "handoff",
        initialPassword: password,
        reason: `${RUN_ID} 创建 J2 临时只读账号`,
        operator: USERNAME,
      });
      expect(account.status, account.raw).toBeLessThan(400);
      accountId = String(account.data?.id ?? account.data?.accountId ?? "");
      expect(accountId).not.toBe("");

      const readerContext = await browser.newContext({ viewport: { width: 1680, height: 950 } });
      const readerPage = await readerContext.newPage();
      try {
        await loginCredentialsFromVisibleEntry(readerPage, username, password, changedReaderPassword);
        await openJ2FromVisibleMenu(readerPage);
        await expect(readerPage.getByRole("button", { name: /编辑黑名单|编辑受限名单|应急封锁|编辑封锁范围|切换/ })).toHaveCount(0);

        const snapshot = await readGeoSnapshot(readerPage);
        const blocked = snapshot.blocked.map((item) => item.cc).sort();
        const writeProbe = await apiSend(readerPage, "PUT", "/api/admin/emergency/geo-block/country-lists/blocked", {
          status: "blocked",
          countries: blocked,
          expectedCountries: blocked,
          reason: `${RUN_ID} 只读越权探针不应执行`,
          operator: username,
        });
        expect(writeProbe.status, writeProbe.raw).toBe(403);
        const alertProbe = await apiSend(readerPage, "GET", "/api/admin/emergency/geo-block/alerts");
        expect(alertProbe.status, alertProbe.raw).toBe(403);
        await shot(readerPage, "13-readonly-page-no-actions-and-403");
      } finally {
        await readerContext.close();
      }
    } finally {
      if (pendingGrantTicket) {
        await decideAuditTicket(
          checkerPage ?? page,
          pendingGrantTicket,
          "reject",
          `${RUN_ID} 清理未执行的 J2 临时授权工单`,
          checkerPage ? checkerUsername : USERNAME,
        ).catch(() => undefined);
        pendingGrantTicket = "";
      }
      if (accountId) {
        const disabled = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${accountId}/status`, {
          status: "disabled",
          reason: `${RUN_ID} 清理 J2 临时只读账号`,
          operator: USERNAME,
        });
        expect(disabled.status, disabled.raw).toBeLessThan(400);
        const revoked = await apiSend(page, "POST", `/api/admin/platform/accounts/${accountId}/sessions/revoke`, {
          reason: `${RUN_ID} 撤销 J2 临时只读账号会话`,
          operator: USERNAME,
        });
        expect(revoked.status, revoked.raw).toBeLessThan(400);
        const unassigned = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${accountId}/role`, {
          role: "unassigned",
          reason: `${RUN_ID} 解除 J2 临时账号角色关系`,
          operator: USERNAME,
        });
        expect(unassigned.status, unassigned.raw).toBeLessThan(400);
      }
      if (roleCreated) {
        const removed = await apiSend(page, "DELETE", `/api/admin/platform/roles/${roleId}`, {
          reason: `${RUN_ID} 清理 J2 临时只读角色`,
          operator: USERNAME,
        });
        expect(removed.status, removed.raw).toBeLessThan(400);
        const deleteTicket = auditTicketId(removed.data);
        await decideAuditTicket(
          checkerPage ?? page,
          deleteTicket,
          "approve",
          `${RUN_ID} 复核并执行 J2 临时角色删除`,
          checkerPage ? checkerUsername : USERNAME,
        );
      }
      if (checkerAccountId) {
        await checkerContext?.close();
        checkerContext = null;
        checkerPage = null;
        const disabled = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${checkerAccountId}/status`, {
          status: "disabled",
          reason: `${RUN_ID} 停用 J2 双人复核临时账号`,
          operator: USERNAME,
        });
        expect(disabled.status, disabled.raw).toBeLessThan(400);
        // 停用账号已在 A1 服务内原子撤销全部会话；单独“强制下线超管”按安全策略固定拒绝。
        const unassigned = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${checkerAccountId}/role`, {
          role: "unassigned",
          reason: `${RUN_ID} 解除 J2 双人复核临时账号角色`,
          operator: USERNAME,
        });
        expect(unassigned.status, unassigned.raw).toBeLessThan(400);
      }
      await checkerContext?.close();
    }
  });

  test("清理 J2 验收账号、A2 工单与临时角色，不残留临时超管授权", async ({ page, browser }) => {
    await loginFromVisibleEntry(page);
    const suffix = `${Date.now()}`.slice(-9);
    const checkerUsername = `j2c${suffix}`;
    const checkerInitialPassword = "J2Cleanup@12345678";
    const checkerPassword = "J2Cleanup@23456789";
    let checkerAccountId = "";
    const checkerContext = await browser.newContext({ viewport: { width: 1680, height: 950 } });
    const checkerPage = await checkerContext.newPage();
    try {
      const checker = await apiSend(page, "POST", "/api/admin/platform/accounts", {
        username: checkerUsername,
        displayName: `J2 Cleanup Checker ${suffix}`,
        email: `${checkerUsername}@nexion.invalid`,
        role: "super",
        deliver: "handoff",
        initialPassword: checkerInitialPassword,
        reason: `${RUN_ID} 创建 J2 遗留清理双人复核账号`,
        operator: USERNAME,
      });
      expect(checker.status, checker.raw).toBeLessThan(400);
      checkerAccountId = String(checker.data?.id ?? "");
      expect(checkerAccountId).not.toBe("");
      await loginCredentialsFromVisibleEntry(
        checkerPage,
        checkerUsername,
        checkerInitialPassword,
        checkerPassword,
      );

      const audit = await apiSend(page, "GET", "/api/admin/platform/audit/overview");
      expect(audit.status, audit.raw).toBeLessThan(400);
      const pending = (audit.data?.operationQueue ?? []).filter((ticket: any) =>
        ticket.status === "pending" && String(ticket.obj ?? "").startsWith("J2_RO_"));
      for (const ticket of pending) {
        const decision = String(ticket.action ?? "").includes("ROLE_DELETED") ? "approve" : "reject";
        await decideAuditTicket(
          checkerPage,
          String(ticket.id ?? ticket.operationId),
          decision,
          `${RUN_ID} ${decision === "approve" ? "执行" : "驳回"} J2 遗留工单`,
          checkerUsername,
        );
      }

      const roles = await apiSend(page, "GET", "/api/admin/platform/roles/overview");
      expect(roles.status, roles.raw).toBeLessThan(400);
      for (const role of (roles.data?.roles ?? []).filter((item: any) => String(item.roleCode).startsWith("J2_RO_"))) {
        const removed = await apiSend(page, "DELETE", `/api/admin/platform/roles/${role.id}`, {
          reason: `${RUN_ID} 提交删除 J2 遗留临时角色`,
          operator: USERNAME,
        });
        expect(removed.status, removed.raw).toBeLessThan(400);
        await decideAuditTicket(
          checkerPage,
          auditTicketId(removed.data),
          "approve",
          `${RUN_ID} 复核删除 J2 遗留临时角色`,
          checkerUsername,
        );
      }

      const accounts = await apiSend(page, "GET", "/api/admin/platform/accounts/overview");
      expect(accounts.status, accounts.raw).toBeLessThan(400);
      const fixtures = (accounts.data?.operators ?? []).filter((account: any) =>
        /^j2[cr]\d+$/.test(String(account.username ?? "")) && String(account.id) !== checkerAccountId);
      for (const account of fixtures) {
        if (account.status !== "disabled") {
          const disabled = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${account.id}/status`, {
            status: "disabled",
            reason: `${RUN_ID} 停用 J2 遗留验收账号`,
            operator: USERNAME,
          });
          expect(disabled.status, disabled.raw).toBeLessThan(400);
        }
        if (account.role !== "unassigned") {
          const unassigned = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${account.id}/role`, {
            role: "unassigned",
            reason: `${RUN_ID} 解除 J2 遗留验收账号角色`,
            operator: USERNAME,
          });
          expect(unassigned.status, unassigned.raw).toBeLessThan(400);
        }
      }
    } finally {
      await checkerContext.close();
      if (checkerAccountId) {
        const disabled = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${checkerAccountId}/status`, {
          status: "disabled",
          reason: `${RUN_ID} 停用 J2 清理复核账号并撤销会话`,
          operator: USERNAME,
        });
        expect(disabled.status, disabled.raw).toBeLessThan(400);
        const unassigned = await apiSend(page, "PATCH", `/api/admin/platform/accounts/${checkerAccountId}/role`, {
          role: "unassigned",
          reason: `${RUN_ID} 解除 J2 清理复核账号超管角色`,
          operator: USERNAME,
        });
        expect(unassigned.status, unassigned.raw).toBeLessThan(400);
      }
    }

    const rolesAfter = await apiSend(page, "GET", "/api/admin/platform/roles/overview");
    expect((rolesAfter.data?.roles ?? []).filter((item: any) => String(item.roleCode).startsWith("J2_RO_"))).toEqual([]);
    const accountsAfter = await apiSend(page, "GET", "/api/admin/platform/accounts/overview");
    const fixturesAfter = (accountsAfter.data?.operators ?? []).filter((account: any) => /^j2[cr]\d+$/.test(String(account.username ?? "")));
    expect(fixturesAfter.every((account: any) => account.status === "disabled" && account.role === "unassigned")).toBe(true);
  });
});
