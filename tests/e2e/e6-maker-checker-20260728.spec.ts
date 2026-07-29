import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type ApiEnvelope<T = unknown> = { code?: number; message?: string; data?: T };
type E6Config = {
  download: {
    url: string;
    zhTitle: string;
    zhGuide: string;
    enTitle: string;
    enGuide: string;
  };
};

const RUN_ID = "pc-full-acceptance-20260728-151023";
const MARKER = " [R151023]";
const FIXTURE_PATH =
  process.env.A_PERMISSION_FIXTURE
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/A/permission-fixtures.json";
const EVIDENCE_DIR =
  process.env.E6_MAKER_CHECKER_EVIDENCE_DIR
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/E/maker-checker";
const EXISTING_CHANGE_OPERATION_ID = process.env.E6_EXISTING_OPERATION_ID?.trim() || "";
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { accounts: { d_checker: Account } };

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("E6 独立 maker/checker 双语文案临时写入、A2 批准与精确恢复", async ({ browser }) => {
  test.setTimeout(120_000);
  const maker = await browser.newContext();
  const checker = await browser.newContext();
  const makerPage = await maker.newPage();
  const checkerPage = await checker.newPage();
  const makerErrors = monitorErrors(makerPage);
  const checkerErrors = monitorErrors(checkerPage);

  try {
    await loginSuperadmin(makerPage);
    const original = await readE6(makerPage);
    expect(original.download.zhGuide).not.toContain(MARKER);
    const changed = { ...original.download, zhGuide: `${original.download.zhGuide}${MARKER}` };

    await openE6FromSidebar(makerPage);
    const changeOperationId = EXISTING_CHANGE_OPERATION_ID || await submitDownloadCopy(
        makerPage,
        changed,
        `${RUN_ID} E6 maker 临时双语文案并预置精确回滚`,
      );
    await makerPage.screenshot({ path: path.join(EVIDENCE_DIR, "01-maker-pending.png"), fullPage: true });

    await login(checkerPage, fixture.accounts.d_checker, "d_checker");
    await approveThroughA2(
      checkerPage,
      changeOperationId,
      `${RUN_ID} checker 核对 E6 临时文案与回滚预案后批准`,
    );
    const applied = await readE6(checkerPage);
    expect(applied.download.zhGuide).toBe(changed.zhGuide);
    await openE6FromSidebar(makerPage);
    await makerPage.reload({ waitUntil: "domcontentloaded" });
    await expect(makerPage.getByText(changed.zhGuide, { exact: true })).toBeVisible();
    await makerPage.screenshot({ path: path.join(EVIDENCE_DIR, "02-approved-visible.png"), fullPage: true });

    const restoreOperationId = await submitDownloadCopy(
      makerPage,
      original.download,
      `${RUN_ID} E6 maker 按原始快照精确恢复双语文案`,
    );
    await approveThroughA2(
      checkerPage,
      restoreOperationId,
      `${RUN_ID} checker 核对 E6 原始快照后批准恢复`,
    );
    const restored = await readE6(checkerPage);
    expect(restored.download).toEqual(original.download);
    await makerPage.reload({ waitUntil: "domcontentloaded" });
    await expect(makerPage.getByText(original.download.zhGuide, { exact: true })).toBeVisible();
    await expect(makerPage.getByText(changed.zhGuide, { exact: true })).toHaveCount(0);

    const audit = await checkerPage.request.get(
      `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(changeOperationId)}&limit=200`,
    );
    const events = await checkerPage.request.get("/api/admin/platform/events/overview");
    expect(audit.status()).toBe(200);
    expect(events.status()).toBe(200);
    expect(makerErrors).toEqual([]);
    expect(checkerErrors).toEqual([]);
    await checkerPage.screenshot({ path: path.join(EVIDENCE_DIR, "03-checker-a2-restored.png"), fullPage: true });
    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
      runId: RUN_ID,
      changeOperationId,
      restoreOperationId,
      checker: fixture.accounts.d_checker.username,
      independentContexts: true,
      changedVerified: true,
      restoredExact: true,
      a2AuditStatus: audit.status(),
      a4OverviewStatus: events.status(),
      pageErrors: 0,
    }, null, 2));
  } finally {
    await maker.close();
    await checker.close();
  }
});

async function submitDownloadCopy(page: Page, values: E6Config["download"], reason: string) {
  await openE6FromSidebar(page);
  await page.getByRole("button", { name: "编辑双语文案", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("中文标题", { exact: true }).fill(values.zhTitle);
  await dialog.getByLabel("中文说明", { exact: true }).fill(values.zhGuide);
  await dialog.getByLabel("英文标题", { exact: true }).fill(values.enTitle);
  await dialog.getByLabel("英文说明", { exact: true }).fill(values.enGuide);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  const data = await apiSuccess<Record<string, unknown>>(response, "create E6 proposal");
  await expect(dialog).toHaveCount(0);
  const operationId = String(data.operationId ?? data.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  const platform = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await platform.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await apiSuccess(await responsePromise, `approve ${operationId}`);
  await expect(page.getByText(`${operationId} 已执行`, { exact: false })).toBeVisible();
}

async function readE6(page: Page) {
  const response = await page.request.get("/api/admin/devices/compute-config");
  return apiSuccess<E6Config>(response, "read E6 config");
}

async function openE6FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  const link = page.locator('a[href="/devices/compute-config"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/compute-config$/);
  await expect(page.getByText("客户端下载配置", { exact: true }).first()).toBeVisible();
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill("superadmin");
  await page.locator('input[autocomplete="current-password"]').fill("Admin@123456");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, account: Account, key: string) {
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside");
    const username = page.locator('input[autocomplete="username"]');
    await Promise.race([
      shell.waitFor({ state: "visible", timeout: 15_000 }),
      username.waitFor({ state: "visible", timeout: 15_000 }),
    ]).catch(() => undefined);
    if (await shell.isVisible().catch(() => false)) break;
    await expect(username).toBeVisible();
    await username.fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const loginPayload = await (await loginResponse).json().catch(() => null) as ApiEnvelope | null;
    expect(loginPayload?.code).toBe(0);
    const otp = page.getByLabel("一次性验证码");
    await otp.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    if (!(await otp.isVisible().catch(() => false))) break;
    await otp.fill(await freshTotp(key, account.totpSecret));
    const verifyResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verifyResponse;
    const payload = await response.json().catch(() => null) as ApiEnvelope | null;
    lastCode = payload?.code;
    if (response.status() === 200 && payload?.code === 0) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      break;
    }
  }
  if (!(await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false))) {
    throw new Error(`${key} shell unavailable after MFA code=${lastCode ?? "none"}`);
  }
}

async function apiSuccess<T>(
  response: Pick<Response, "ok" | "status" | "json">,
  label: string,
): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  expect(response.ok(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

function monitorErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(key: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(key) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
  return currentTotp(secret);
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
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
