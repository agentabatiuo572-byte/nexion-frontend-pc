import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
const fixturePath = process.env.H_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("H_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { accounts: { nomenu: Account } };

for (const contextIndex of [1, 2, 3]) {
test(`H no-menu direct URL timing matrix context ${contextIndex}`, async ({ page }, testInfo) => {
  await login(page, fixture.accounts.nomenu);
  await expect(page.locator('a[href^="/growth/"]')).toHaveCount(0);
  const direct = await sampleDirectRoute(page);
  const refresh = await sampleDirectRoute(page, true);
  for (const item of [direct.at10, refresh.at10]) {
    expect(item.url, "10 秒后必须离开 H1 路由").not.toMatch(/\/growth\/phase(?:\?.*)?$/);
    expect(item.hdom, "10 秒后不得保留 H 页面").toBe(0);
    expect(item.h1ReadStatus, "无菜单 H1 读取必须拒绝").toBe(403);
  }
  await writeFile(testInfo.outputPath(`h-nomenu-route-timing-context-${contextIndex}.json`), JSON.stringify({
    contextIndex, checkedAt: new Date().toISOString(), direct, refresh,
  }, null, 2));
});
}

async function sampleDirectRoute(page: Page, reload = false) {
  await page.goto("/growth/phase", { waitUntil: "domcontentloaded" });
  if (reload) await page.reload({ waitUntil: "domcontentloaded" });
  const samples: Record<string, { url: string; hdom: number; h1ReadStatus: number }> = {};
  let elapsed = 0;
  for (const target of [0, 1_000, 3_000, 10_000]) {
    await page.waitForTimeout(target - elapsed);
    elapsed = target;
    samples[`at${target / 1_000}`] = {
      url: new URL(page.url()).pathname,
      hdom: await page.locator(".hdom").count(),
      h1ReadStatus: await page.evaluate(async () => (await fetch("/api/admin/growth/phases", { credentials: "same-origin" })).status),
    };
  }
  return samples as typeof samples & { at10: { url: string; hdom: number; h1ReadStatus: number } };
}

async function login(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

let lastStep = -1;
async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastStep) await new Promise((resolve) => setTimeout(resolve, ((lastStep + 1) * 30_000) - Date.now() + 500));
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastStep = step;
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
