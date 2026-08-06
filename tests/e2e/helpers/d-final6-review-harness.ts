import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

export type ReviewAccount = {
  accountId?: string;
  username: string;
  password: string;
  totpSecret: string;
  role?: string;
  roleCode?: string;
};

type DFixture = {
  runId: string;
  checker: ReviewAccount;
  accounts: Record<string, ReviewAccount>;
};

type FinalFixture = {
  finalAccounts: Record<string, ReviewAccount>;
};

export const RUN_ID = process.env.D_FINAL6_RUN_ID
  ?? "pc-full-acceptance-20260729-114336-D-C-FINAL6";
export const D_FIXTURE_PATH = process.env.D_FINAL6_FIXTURE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/D.json";
export const FINAL_FIXTURE_PATH = process.env.D_FINAL6_CHECKERS
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final-fixture-admin-window/final-domain-checkers.json";
export const DB_NAME = process.env.D_FINAL6_DB_NAME
  ?? "nexion_acceptance_20260729_114336";
export const MYSQL = process.env.D_FINAL6_MYSQL
  ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";

const dFixture = JSON.parse(readFileSync(D_FIXTURE_PATH, "utf8")) as DFixture;
const finalFixture = JSON.parse(readFileSync(FINAL_FIXTURE_PATH, "utf8")) as FinalFixture;
const lastTotpStep = new Map<string, number>();

export function dAccount(key: "maker" | "readonly" | "nowrite" | "nomenu" | "checker") {
  if (key === "checker") return dFixture.checker;
  const account = dFixture.accounts[key];
  if (!account) throw new Error(`D fixture missing ${key}`);
  return account;
}

export function finalAccount(key: string) {
  const account = finalFixture.finalAccounts[key];
  if (!account) throw new Error(`Final fixture missing ${key}`);
  return account;
}

export async function login(page: Page, account: ReviewAccount, label: string) {
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 1_500 }).catch(() => false)) break;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.url().includes("/api/admin/auth/login")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const credential = await loginResponse;
    const credentialPayload = await credential.json().catch(() => null) as { code?: number; message?: string } | null;
    if (credential.status() !== 200 || credentialPayload?.code !== 0) {
      throw new Error(`${label} credential failed ${credential.status()} ${credentialPayload?.message ?? "UNKNOWN"}`);
    }

    const otp = page.getByLabel("一次性验证码");
    if (!(await otp.isVisible({ timeout: 5_000 }).catch(() => false))) break;
    await otp.fill(await freshTotp(label, account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.url().includes("/api/admin/auth/mfa/verify")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const result = await response.json().catch(() => null) as { code?: number } | null;
    lastCode = result?.code;
    const cookie = (await page.context().cookies()).some((item) => item.name === "nexion_admin_token");
    if (response.status() === 200 && (result?.code === 0 || cookie)) {
      const ready = await page.locator("aside").waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true).catch(() => false);
      if (!ready) await page.reload({ waitUntil: "domcontentloaded" });
      break;
    }
  }
  if (!(await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false))) {
    throw new Error(`${label} shell unavailable after MFA code=${lastCode ?? "none"}`);
  }
}

export async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 1_500 }).catch(() => false)) {
    await direct.click();
  } else {
    const menu = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    await expect(menu).toBeVisible();
    await menu.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

export async function expandD(page: Page) {
  const group = page.getByRole("button", { name: /资金与财务\s+D|D\s+资金与财务/ }).first();
  if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const expanded = await group.getAttribute("aria-expanded");
    if (expanded !== "true") await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
  }
}

export async function openD(page: Page, route: string, visible: string | RegExp) {
  await expandD(page);
  const link = page.locator(`aside a[href="${route}"]`).first();
  await expect(link, `${route} must be reachable from visible sidebar`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route)}(?:\\?.*)?$`));
  await expect(page.getByText(visible).first()).toBeVisible({ timeout: 20_000 });
}

export async function browserApi(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH",
  apiPath: string,
  body?: Record<string, unknown>,
  key = `${RUN_ID}-${crypto.randomUUID()}`,
) {
  return page.evaluate(async ({ requestMethod, path, requestBody, idempotencyKey }) => {
    const response = await fetch(path, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET"
        ? undefined
        : { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const text = await response.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch { payload = text; }
    return { status: response.status, payload, text };
  }, { requestMethod: method, path: apiPath, requestBody: body, idempotencyKey: key });
}

export function jsonRows(sql: string): Array<Record<string, unknown>> {
  const output = mysql(sql).trim();
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function mysql(sql: string) {
  const password = process.env.D_FINAL6_DB_PASSWORD;
  if (!password) throw new Error("D_FINAL6_DB_PASSWORD is required");
  return execFileSync(
    MYSQL,
    [
      "--default-character-set=utf8mb4",
      "--host=127.0.0.1",
      "--user=root",
      "--batch",
      "--skip-column-names",
      `--database=${DB_NAME}`,
      `--execute=${sql}`,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, MYSQL_PWD: password },
    },
  );
}

export function monitor(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const requestFailureEvents: Array<{ sequence: number; method: string; url: string; failure: string }> = [];
  const responseEvents: Array<{ sequence: number; method: string; url: string; status: number }> = [];
  let sequence = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      consoleErrors.push(location ? `${message.text()} @ ${location}` : message.text());
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "";
    requestFailures.push(`${request.method()} ${request.url()} ${failure}`);
    requestFailureEvents.push({ sequence: ++sequence, method: request.method(), url: request.url(), failure });
  });
  page.on("response", (response) => responseEvents.push({
    sequence: ++sequence,
    method: response.request().method(),
    url: response.url(),
    status: response.status(),
  }));
  return { pageErrors, consoleErrors, requestFailures, requestFailureEvents, responseEvents };
}

async function freshTotp(label: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const prior = lastTotpStep.get(label) ?? -1;
  if (step <= prior) {
    await new Promise((resolve) => setTimeout(resolve, ((prior + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(label, step);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
