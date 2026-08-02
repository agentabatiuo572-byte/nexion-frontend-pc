import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.J1_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/j-domain-acceptance-20260722/final/J1/evidence";
const USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456";
const TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim() ?? "";
const FAILURE_API = "**/api/admin/emergency/kill-switches/trial";

type Gate = {
  key: string;
  name: string;
  enabled: boolean;
  coveragePrecheckRequired: boolean;
};

type AutoRule = {
  id: string;
  thr: string;
  configKey: string;
};

test.beforeEach(async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await loginAndOpenFromVisibleMenu(page);
});

test("J1 first-time operator can understand the five-gate control plane from the visible menu", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await expect(page.getByText("功能开关总表 · 5 个业务闸", { exact: true })).toBeVisible();
  await expect(page.locator(".matrix-tbl .rw")).toHaveCount(5);
  await expect(page.getByText("恢复业务前 · 备付金检查", { exact: true })).toBeVisible();
  await expect(page.getByText("应急判定与自动关停规则", { exact: true })).toBeVisible();
  await expect(page.getByText(/R1、R2 由服务器读取真实指标自动关停；R3 仅告警；R4 人工发起/)).toBeVisible();
  await expect(page.getByText("自动关停待补录", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "立即应急关停" })).toBeDisabled();
  const r3 = (await currentMatrix(page)).autoRules.find((rule) => rule.id === "tamperCluster");
  expect(r3).toEqual(expect.objectContaining({ configKey: "emergency.tamper.alert.threshold" }));
  await expect(page.getByText(r3!.thr, { exact: true }).last()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-menu-and-j1-overview.png"), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});

test("J1 keeps the confirmation open and reuses the idempotency key when the outcome is unknown", async ({ page }) => {
  const trial = await currentGate(page, "trial");
  expect(trial.enabled).toBeTruthy();
  const commandKeys: string[] = [];
  await page.route(FAILURE_API, async (route) => {
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    await route.fulfill({
      status: 502,
      headers: { "X-Nexion-Upstream-Outcome": "unknown" },
      contentType: "application/json",
      body: JSON.stringify({ code: 502, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
    });
  });

  await gateRow(page, trial.name).getByRole("button", { name: "关停", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await fillKillConfirmation(dialog, "J1验收-未知结果重试保持同一命令键");
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/结果暂未确认|提交未完成/);
  await expect(dialog.getByLabel(/操作理由/)).toHaveValue("J1验收-未知结果重试保持同一命令键");
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect.poll(() => commandKeys.length).toBe(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBe(commandKeys[0]);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-unknown-outcome-dialog-retained.png"), fullPage: true });
  await dialog.getByRole("button", { name: "取消" }).click();
  await page.unroute(FAILURE_API);
  expect((await currentGate(page, "trial")).enabled).toBeTruthy();
});

test("J1 trial gate kill and recovery are real, refresh-safe and relogin-safe", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const trial = await currentGate(page, "trial");
  expect(trial.enabled).toBeTruthy();
  expect(trial.coveragePrecheckRequired).toBeFalsy();

  try {
    const killResponse = page.waitForResponse((response) => response.request().method() === "PUT"
      && response.url().endsWith("/api/admin/emergency/kill-switches/trial"));
    await gateRow(page, trial.name).getByRole("button", { name: "关停", exact: true }).click();
    const killDialog = page.getByRole("dialog");
    await fillKillConfirmation(killDialog, "J1验收-试用闸关停后立即验证与恢复");
    await killDialog.getByRole("button", { name: "确认提交" }).click();
    expect((await killResponse).ok()).toBeTruthy();
    await expect(gateRow(page, trial.name).getByText("已关停", { exact: true })).toBeVisible();
    await page.reload();
    await expect(gateRow(page, trial.name).getByText("已关停", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-trial-killed-and-persisted.png"), fullPage: true });

    await restoreTrialThroughVisibleUi(page, trial.name);
    expect(runtimeErrors).toEqual([]);
    await logout(page);
    await loginAndOpenFromVisibleMenu(page);
    await expect(gateRow(page, trial.name).getByText("在线", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-restored-after-relogin.png"), fullPage: true });
    expect((await currentGate(page, "trial")).enabled).toBeTruthy();
    expect(runtimeErrors.filter((message) => !message.includes("status of 401 (Unauthorized)"))).toEqual([]);
  } finally {
    if (!page.isClosed()) {
      await ensureLoggedInAndAtJ1(page);
      if (!(await currentGate(page, "trial")).enabled) await restoreTrialThroughVisibleUi(page, trial.name);
    }
  }
});

test("J1 fails closed when its canonical matrix cannot be read and recovers through the visible retry", async ({ page }) => {
  await page.route("**/api/admin/emergency/kill-switches", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "EMERGENCY_SERVICE_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "当前无法确认最新状态" })).toBeVisible();
  await expect(page.locator(".matrix-tbl .rw")).toHaveCount(0);
  await expect(page.getByText(/为避免误操作，控制项已隐藏/)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-read-failure-fail-closed.png"), fullPage: true });

  await page.unroute("**/api/admin/emergency/kill-switches");
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.locator(".matrix-tbl .rw")).toHaveCount(5);
});

test.afterAll(async () => {
  await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
    "J1 Playwright live acceptance evidence",
    "All user-flow screenshots were produced by Chromium from the visible login and sidebar entry.",
    "The only route interception is the explicitly marked failure-injection branch; normal lifecycle uses the real backend.",
  ].join("\n"), "utf8");
});

async function loginAndOpenFromVisibleMenu(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside").first();
    if (await shell.isVisible({ timeout: 2_000 }).catch(() => false)) break;
    const username = page.locator('input[autocomplete="username"]');
    await expect(username).toBeVisible({ timeout: 30_000 });
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await shell.or(otp).first().waitFor({ state: "visible", timeout: 30_000 });
    if (await shell.isVisible().catch(() => false)) break;
    if (!TOTP_SECRET) throw new Error("ADMIN_E2E_TOTP_SECRET is required for an enrolled J1 account");
    await fillFreshTotp(page, otp, TOTP_SECRET);
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { code?: number; message?: string } | null;
    const hasAuthCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (payload?.code === 0 || hasAuthCookie)) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
      await expect(shell).toBeVisible({ timeout: 30_000 });
      break;
    }
    if (attempt === 0 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.context().clearCookies();
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`J1 MFA failed: HTTP ${response.status()} ${payload?.message ?? "unknown"}`);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  const group = page.getByRole("button", { name: /紧急与合规控制\s*J|J\s*紧急与合规控制/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/emergency/kill-switch"]').first();
  await expect(link, "J1 must be discoverable in the visible sidebar").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/kill-switch$/);
  await expect(page.getByText("功能开关总表 · 5 个业务闸", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const accountMenu = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(accountMenu, "logout must start from the visible account menu").toBeVisible();
  await accountMenu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

function gateRow(page: Page, name: string) {
  return page.locator(".matrix-tbl .rw").filter({ hasText: name }).first();
}

async function currentGate(page: Page, key: string): Promise<Gate> {
  const matrix = await currentMatrix(page);
  const gate = matrix.activeGates.find((candidate) => candidate.key === key);
  if (!gate) throw new Error(`J1 gate not found: ${key}`);
  return gate;
}

async function currentMatrix(page: Page): Promise<{ activeGates: Gate[]; autoRules: AutoRule[] }> {
  const response = await page.request.get("/api/admin/emergency/kill-switches");
  expect(response.ok()).toBeTruthy();
  const payload = await response.json() as { data: { activeGates: Gate[]; autoRules: AutoRule[] } };
  return payload.data;
}

async function restoreTrialThroughVisibleUi(page: Page, gateName: string) {
  const resumeResponse = page.waitForResponse((response) => response.request().method() === "PUT"
    && response.url().endsWith("/api/admin/emergency/kill-switches/trial"));
  await gateRow(page, gateName).getByRole("button", { name: "恢复", exact: true }).click();
  const resumeDialog = page.getByRole("dialog");
  await resumeDialog.getByLabel(/操作理由/).fill("J1验收-恢复试用闸并清理测试状态");
  await resumeDialog.getByRole("button", { name: "确认提交" }).click();
  expect((await resumeResponse).ok()).toBeTruthy();
  await expect(gateRow(page, gateName).getByText("在线", { exact: true })).toBeVisible();
}

async function ensureLoggedInAndAtJ1(page: Page) {
  if (!page.url().endsWith("/emergency/kill-switch")) await loginAndOpenFromVisibleMenu(page);
}

async function fillKillConfirmation(dialog: Locator, reason: string) {
  const basis = dialog.locator("label").filter({ hasText: "触发依据" }).locator("select");
  await basis.selectOption({ label: "安全事件" });
  await dialog.getByLabel(/操作理由/).fill(reason);
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeEnabled();
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console:${message.text()}`);
  });
  return errors;
}

async function fillFreshTotp(page: Page, input: Locator, secret: string) {
  const remainingMs = 30_000 - (Date.now() % 30_000);
  if (remainingMs <= 3_000) await page.waitForTimeout(remainingMs + 500);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  await input.fill(code);
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
