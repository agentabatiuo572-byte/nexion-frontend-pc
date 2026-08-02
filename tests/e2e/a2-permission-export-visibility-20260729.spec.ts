import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE_PATH;

if (!FIXTURE_PATH) throw new Error("A_PERMISSION_FIXTURE_PATH is required");

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  accounts: Record<"readonly" | "nowrite", {
    username: string;
    password: string;
    totpSecret: string;
    authorities?: string[];
  }>;
};

test.describe.configure({ mode: "serial", timeout: 180_000 });

for (const key of ["readonly", "nowrite"] as const) {
  test(`A-PERM-001 ${key}: 缺少 platform_a2_export 时不得显示脱敏导出`, async ({ page }) => {
    const account = fixture.accounts[key];
    expect(account.authorities ?? [], `${key} fixture must exclude A2 export`).not.toContain("platform_a2_export");

    await login(page, account);
    const platform = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
    if ((await platform.getAttribute("aria-expanded")) !== "true") await platform.click();
    const auditEntry = page.locator('aside a[href="/platform/audit"]').first();
    await expect(auditEntry).toBeVisible();
    await auditEntry.click();
    await expect(page).toHaveURL(/\/platform\/audit$/);
    await expect(page.getByRole("heading", { name: /审计|操作确认/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "导出（脱敏）", exact: true })).toHaveCount(0);

    const rejected = await page.request.post("/api/admin/platform/audit/exports", {
      data: { reason: "A-PERM-001 readonly export denial probe" },
    });
    expect(rejected.status()).toBe(403);
  });
}

async function login(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
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
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
