import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K3_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/final/K3/evidence";
const RISK_USERNAME = process.env.K3_RISK_USERNAME ?? "superadmin";
const AUDITOR_USERNAME = process.env.K3_AUDITOR_USERNAME ?? "a4murphy_auditor_0717";
const PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const REASON = "K3验收提现规则闭环及失败恢复验证";
const OVERVIEW_API = "**/api/admin/risk/withdraw-rules/overview*";

type Envelope<T> = { code: number; message?: string; data: T };
type Rule = { ruleId: string; state: string; version: number; conditionText: string; action: string };
type Overview = {
  dimensions: Array<{ ruleId: string }>;
  rules: { records: Rule[]; total: number };
  hits: { total: number };
};

let fixtureRuleId = "";
const runSummary: Record<string, unknown> = { startedAt: new Date().toISOString(), fixtureRuleId: null };

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("K3 审计员可见只读、写入口禁用且后端直调拒绝", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, AUDITOR_USERNAME);
  await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible();
  await expect(page.getByText("规则总表", { exact: true })).toBeVisible();
  await expect(page.getByText("命中日志", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /沙盒模拟/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "+ 新建规则", exact: true })).toBeDisabled();
  const denied = await page.request.post("/api/admin/risk/withdraw-rules/dry-runs", {
    headers: { "Idempotency-Key": `k3-auditor-denied-${Date.now()}` },
    data: { reason: REASON, operator: AUDITOR_USERNAME },
  });
  expect(denied.status()).toBe(403);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-auditor-readonly-permission-gate.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("K3 风控角色从可见侧栏完成 dry-run、创建、启用和编辑", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_USERNAME);
  const initial = await fetchOverview(page);

  await page.getByRole("button", { name: /沙盒模拟/ }).click();
  await submitDialog(page, REASON, /开始模拟/);
  const dryRunCard = page.locator("section").filter({ hasText: "最近一次沙盒模拟" }).first();
  await expect(dryRunCard).toBeVisible();
  await expect(dryRunCard).toContainText("已完成");
  const afterDryRun = await fetchOverview(page);
  expect(afterDryRun.hits.total).toBe(initial.hits.total);

  await page.getByRole("button", { name: "+ 新建规则", exact: true }).click();
  const createDialog = page.getByRole("dialog");
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel("规则维度").selectOption("金额");
  await createDialog.getByLabel("命中动作").selectOption("冻结");
  await createDialog.getByLabel("优先级").fill("97");
  await createDialog.getByLabel("单笔金额 USD").fill("49700");
  await createDialog.getByLabel(/操作理由/).fill(REASON);
  const createResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && /\/api\/admin\/risk\/withdraw-rules$/.test(new URL(response.url()).pathname));
  await createDialog.getByRole("button", { name: "确认提交" }).click();
  const created = await envelope<Rule>(await createResponse);
  expect(created.code).toBe(0);
  fixtureRuleId = created.data.ruleId;
  expect(fixtureRuleId).toMatch(/^WR-/);
  runSummary.fixtureRuleId = fixtureRuleId;
  await expect(page.locator("tr").filter({ hasText: fixtureRuleId })).toContainText("草拟");

  let row = ruleRow(page, fixtureRuleId);
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await submitDialog(page, `${REASON}启用草稿规则`);
  row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("生效");

  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel("单笔金额 USD").fill("49600");
  await editDialog.getByLabel("命中动作").selectOption("转人工");
  await editDialog.getByLabel("优先级").fill("96");
  await editDialog.getByLabel(/操作理由/).fill(`${REASON}修改阈值动作优先级`);
  await editDialog.getByRole("button", { name: "确认提交" }).click();
  await expect(editDialog).toHaveCount(0);
  row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("单笔 >= $49,600");
  await expect(row).toContainText("转人工");
  await expect(row).toContainText("96");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-risk-dryrun-create-active-edit.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("K3 墨菲分支复用同一命令键，停用后归档终态不可逆", async ({ page }) => {
  expect(fixtureRuleId).toBeTruthy();
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_USERNAME);
  let attempts = 0;
  const commandKeys: string[] = [];
  await page.route("**/api/admin/risk/withdraw-rules/**/status", async (route) => {
    if (route.request().method() !== "PATCH" || !route.request().url().includes(`/${fixtureRuleId}/status`)) {
      await route.continue();
      return;
    }
    attempts += 1;
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      const upstream = await route.fetch();
      expect(upstream.ok()).toBeTruthy();
      await route.fulfill({
        status: 502,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 502, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
      return;
    }
    await route.continue();
  });

  let row = ruleRow(page, fixtureRuleId);
  await row.getByRole("button", { name: "停用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill(`${REASON}结果未知同键重试`);
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/结果暂不确定/).last()).toBeVisible();
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog).toHaveCount(0);
  expect(commandKeys).toHaveLength(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBe(commandKeys[0]);
  await page.unroute("**/api/admin/risk/withdraw-rules/**/status");
  row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("停用");

  await row.getByRole("button", { name: "归档", exact: true }).click();
  await submitDialog(page, `${REASON}归档终态验证`, /确认归档/);
  row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("归档");
  await expect(row.getByRole("button", { name: "已归档", exact: true })).toBeDisabled();

  const archivedOverview = await fetchOverview(page);
  const latest = findRule(archivedOverview, fixtureRuleId);
  expect(archivedOverview.dimensions.some((dimension) => dimension.ruleId === fixtureRuleId)).toBeFalsy();
  await expect(activeRuleConfiguration(page)).not.toContainText("单笔 >= $49,600");
  const illegal = await page.request.patch(`/api/admin/risk/withdraw-rules/${fixtureRuleId}/status`, {
    headers: { "Idempotency-Key": `k3-illegal-terminal-${Date.now()}` },
    data: { state: "active", expectedVersion: latest.version, reason: `${REASON}禁止归档后重启`, operator: RISK_USERNAME },
  });
  expect(illegal.status()).toBe(409);
  expect((await envelope<unknown>(illegal, false)).message).toBe("K3_RULE_TRANSITION_INVALID");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-unknown-outcome-archived-terminal.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("K3 503 失败关闭、只重试本模块恢复且匿名 API 拒绝", async ({ page, browser }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_USERNAME);
  await page.route(OVERVIEW_API, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "RISK_SERVICE_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("K3 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "仅重试 K3", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新建规则", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-503-fail-closed.png"), fullPage: true });
  await page.unroute(OVERVIEW_API);
  await page.getByRole("button", { name: "仅重试 K3", exact: true }).click();
  await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible();
  await expect(ruleRow(page, fixtureRuleId)).toContainText("归档");
  await expect(activeRuleConfiguration(page)).not.toContainText("单笔 >= $49,600");

  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
  try {
    const response = await anonymous.request.get("/api/admin/risk/withdraw-rules/overview");
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-retry-restored-authoritative-terminal.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test.afterAll(async () => {
  runSummary.finishedAt = new Date().toISOString();
  await writeFile(path.join(EVIDENCE_DIR, "run-summary.json"), `${JSON.stringify(runSummary, null, 2)}\n`, "utf8");
  await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
    "K3 live Chromium acceptance evidence.",
    "Normal reads and mutations used the real 3002 frontend and 8110 backend.",
    "Only the named 502 outcome-unknown and 503 Murphy branches used route fault injection.",
    "No token, cookie, credential, HAR, trace archive or video is stored here.",
  ].join("\n"), "utf8");
});

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for K3 live acceptance`);
  return value;
}

async function loginAndOpenK3(page: Page, username: string) {
  await login(page, username);
  const group = page.getByRole("button", { name: /风控.*K|K.*风控/ }).first();
  const link = page.locator('a[href="/risk/withdrawal-rules"]').first();
  for (let attempt = 0; attempt < 3 && !await link.isVisible().catch(() => false); attempt += 1) {
    await expect(group).toBeVisible({ timeout: 5_000 });
    await group.click();
    await page.waitForTimeout(350);
  }
  await expect(link, "K3 必须可从当前角色的可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/withdrawal-rules(?:\?.*)?$/);
  await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_200);
  if (await page.locator("aside").isVisible().catch(() => false)) await logout(page);
  const usernameInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  await usernameInput.fill(username);
  await passwordInput.fill(PASSWORD);
  const loginResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await loginResponsePromise;
  const otpInput = page.getByLabel("一次性验证码");
  if (await otpInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const loginPayload = await loginResponse.json() as {
      data?: { mfa?: { manualKey?: string | null } };
    };
    const secret = loginPayload.data?.mfa?.manualKey;
    if (!secret) throw new Error(`K3 role ${username} requires an already-bound external TOTP secret`);
    await otpInput.fill(currentTotp(secret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|Failed to load resource.*(?:401|403|502|503)/i.test(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });
  return errors;
}

function ruleRow(page: Page, ruleId: string) {
  return page.locator("tr").filter({ hasText: ruleId }).first();
}

function activeRuleConfiguration(page: Page) {
  return page.locator("section.l-card").filter({
    has: page.getByText("四道关 · 规则配置", { exact: true }),
  }).first();
}

async function submitDialog(page: Page, reason: string, buttonName: string | RegExp = "确认提交") {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: buttonName }).last().click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

async function fetchOverview(page: Page): Promise<Overview> {
  const response = await page.request.get("/api/admin/risk/withdraw-rules/overview?rulePageNum=1&rulePageSize=100&hitPageNum=1&hitPageSize=100");
  expect(response.ok()).toBeTruthy();
  return (await envelope<Overview>(response)).data;
}

function findRule(overview: Overview, ruleId: string) {
  const found = overview.rules.records.find((rule) => rule.ruleId === ruleId);
  if (!found) throw new Error(`K3 rule ${ruleId} was not returned by the authoritative overview`);
  return found;
}

async function envelope<T>(response: { json(): Promise<unknown> }, requireSuccess = true): Promise<Envelope<T>> {
  const payload = await response.json() as Envelope<T>;
  if (requireSuccess) expect(payload.code).toBe(0);
  return payload;
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
