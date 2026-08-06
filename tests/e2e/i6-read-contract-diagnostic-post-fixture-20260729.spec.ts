import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { test, type Page, type TestInfo } from "@playwright/test";

type Account = { username: string; password: string; totpSecret?: string };
type Fixture = { runId: string; accounts: { maker: Account; readonly: Account } };
const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const generatedAt = process.env.I_PERMISSION_FIXTURE_GENERATED_AT;
if (!generatedAt) throw new Error("I_PERMISSION_FIXTURE_GENERATED_AT is required");

const accounts: Record<"readonly" | "maker" | "super", Account> = {
  readonly: fixture.accounts.readonly,
  maker: fixture.accounts.maker,
  super: { username: process.env.I_SUPER_USERNAME || "", password: process.env.I_SUPER_PASSWORD || "" },
};

for (const role of ["readonly", "maker", "super"] as const) {
  test(`I6 当前夹具只读合同诊断：${role}`, async ({ page }, testInfo) => {
    const authResponses: unknown[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/api/admin/auth/")) return;
      const text = await response.text().catch(() => "");
      let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch { /* response summary remains structural */ }
      authResponses.push({ path: new URL(response.url()).pathname, status: response.status(), body: shape(parsed) });
    });
    const login = await loginAttempt(page, accounts[role]);
    const output: Record<string, unknown> = {
      runId: fixture.runId,
      fixtureGeneratedAt: generatedAt,
      role,
      checkedAt: new Date().toISOString(),
      auth: login,
      authResponses,
    };
    if (login.shellVisible) {
      const result = await page.evaluate(async () => {
        const response = await fetch("/api/admin/content/i18n-learning/overview", { credentials: "same-origin" });
        const payload = await response.json().catch(() => null);
        return { status: response.status, payload };
      });
      output.i6 = { status: result.status, dataShape: shape((result.payload as { data?: unknown } | null)?.data) };
    }
    await writeFile(testInfo.outputPath(`${role}-i6-contract-diagnostic.json`), JSON.stringify(output, null, 2));
  });
}

async function loginAttempt(page: Page, account: Account) {
  if (!account.username || !account.password) return { shellVisible: false, failure: "missing_super_credentials" };
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  await Promise.any([
    otp.waitFor({ state: "visible", timeout: 12_000 }),
    shell.waitFor({ state: "visible", timeout: 12_000 }),
  ]).catch(() => undefined);
  const otpVisible = await otp.isVisible().catch(() => false);
  if (otpVisible && account.totpSecret) {
    await otp.fill(await freshTotp(account.totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    await shell.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  }
  const alert = page.locator("[role=alert]").last();
  return {
    shellVisible: await shell.isVisible().catch(() => false),
    otpVisible,
    alertText: (await alert.textContent().catch(() => ""))?.trim() || undefined,
    urlPath: new URL(page.url()).pathname,
  };
}

function shape(value: unknown, depth = 0): unknown {
  if (value === null) return "null";
  if (Array.isArray(value)) return { type: "array", length: value.length, item: value[0] === undefined ? undefined : shape(value[0], depth + 1) };
  if (typeof value !== "object") return typeof value;
  if (depth >= 3) return "object";
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) result[key] = shape(item, depth + 1);
  return result;
}

let lastTotpStep = -1;
async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
