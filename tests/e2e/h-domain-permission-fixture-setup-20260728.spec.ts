import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const FINAL_PASSWORD = process.env.H_PERMISSION_FINAL_PASSWORD ?? "";
const RUN_ID = process.env.H_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const FIXTURE_PATH = process.env.H_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/H/permission-fixtures.json`;
const SUFFIX = process.env.H_PERMISSION_SUFFIX ?? Date.now().toString(36);

type AccountKey = "h_readonly" | "h_no_write" | "h_no_menu";
type FixtureAccount = {
  id: string;
  username: string;
  password: string;
  totpSecret: string;
  role: "auditor" | "support";
};

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("创建并激活 H 域 readonly/no-write/no-menu 独立权限夹具", async ({ page }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(FINAL_PASSWORD, "H_PERMISSION_FINAL_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);

  const definitions: Array<{ key: AccountKey; role: FixtureAccount["role"] }> = [
    { key: "h_readonly", role: "auditor" },
    { key: "h_no_write", role: "auditor" },
    { key: "h_no_menu", role: "support" },
  ];
  const accounts = {} as Record<AccountKey, FixtureAccount>;
  const temporaryPasswords = {} as Record<AccountKey, string>;

  await login(page, ROOT_USERNAME, ROOT_PASSWORD);
  for (const definition of definitions) {
    const username = `${definition.key}-${SUFFIX}`.slice(0, 32);
    const created = await page.request.post("/api/admin/platform/accounts", {
      headers: { "Idempotency-Key": `${RUN_ID}-${definition.key}-${SUFFIX}` },
      data: {
        username,
        displayName: `${RUN_ID} ${definition.key}`,
        email: `${definition.key}.${SUFFIX}@nexion.invalid`,
        role: definition.role,
        reason: `${RUN_ID} 创建 H 域五层权限验收夹具`,
        operator: ROOT_USERNAME,
      },
    });
    const data = await okEnvelope<{ id: string; temporaryPassword?: string }>(created);
    expect(data.temporaryPassword, `${definition.key} create response must return its one-time password`).toBeTruthy();
    temporaryPasswords[definition.key] = data.temporaryPassword!;
    accounts[definition.key] = {
      id: String(data.id),
      username,
      password: FINAL_PASSWORD,
      totpSecret: "",
      role: definition.role,
    };
  }
  await logout(page);

  for (const definition of definitions) {
    const account = accounts[definition.key];
    account.totpSecret = await activateFirstLogin(page, account.username, temporaryPasswords[definition.key]);
    await assertExpectedSession(page, definition.key);
    await logout(page);
  }

  mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, JSON.stringify({
    sensitive: true,
    doNotUpload: true,
    runId: RUN_ID,
    createdAt: new Date().toISOString(),
    cleanup: Object.values(accounts).map((account) => ({
      accountId: account.id,
      username: account.username,
      expectedRole: account.role,
      action: "disable with current A1 expectedVersion after review",
    })),
    accounts,
  }, null, 2));
});

async function activateFirstLogin(page: Page, username: string, temporaryPassword: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const login = await loginResponse;
  const payload = await login.json().catch(() => ({})) as { data?: { mfa?: { manualKey?: string | null } } };
  expect(login.status(), await login.text().catch(() => "")).toBeLessThan(400);
  let secret = payload.data?.mfa?.manualKey?.trim() ?? "";
  let passwordChanged = false;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    if (!passwordChanged && await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(FINAL_PASSWORD);
      await page.getByLabel("确认新密码", { exact: true }).fill(FINAL_PASSWORD);
      const changed = page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/admin/auth/password/change");
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      expect((await changed).status()).toBeLessThan(400);
      passwordChanged = true;
    }
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      secret = secret || (await page.locator("code").first().textContent().catch(() => ""))?.trim() || "";
      expect(secret, `${username} TOTP secret must be available during first-login enrollment`).not.toBe("");
      await otp.fill(await freshTotp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  expect(passwordChanged).toBe(true);
  return secret;
}

async function login(page: Page, username: string, password: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function assertExpectedSession(page: Page, key: AccountKey) {
  const data = await okEnvelope<{ session?: { authorities?: string[] } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  const authorities = data.session?.authorities ?? [];
  const modules = ["h1", "h2", "h3", "h4", "h5", "h7", "h8"];
  if (key === "h_no_menu") {
    expect(authorities.some((authority) => authority.startsWith("growth_h"))).toBe(false);
  } else {
    for (const module of modules) {
      expect(authorities).toContain(`growth_${module}_read`);
      expect(authorities.some((authority) =>
        authority.startsWith(`growth_${module}_`) && authority !== `growth_${module}_read`)).toBe(false);
    }
  }
}

async function okEnvelope<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as { code?: number; data?: T };
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
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
