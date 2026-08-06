import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const username = requiredEnv("ADMIN_E2E_USERNAME");
const password = requiredEnv("ADMIN_E2E_PASSWORD");
const totpSecret = requiredEnv("ADMIN_E2E_TOTP_SECRET");
const e1 = CONSOLE_NAV.flatMap((domain) => domain.l2).find((item) => item.id === "E1");
if (!e1) throw new Error("E1_NAV_MISSING");
const e1Path = e1.path;

test("E1 refreshes all four media assets before first mount and after reload without network failures", async ({ page }) => {
  test.setTimeout(120_000);
  // A transparent route keeps every request real while disabling Chromium's
  // HTTP cache, so the reload assertion proves four network renewals instead of
  // accepting a cached presign from the first pass.
  await page.route("**/*", (route) => route.continue());
  const media = new Map<string, { count: number; statuses: number[]; contentTypes: string[] }>();
  const failures: string[] = [];
  const navigationAborts: string[] = [];

  page.on("requestfailed", (request) => {
    if (request.url().includes("/admin/e/sku-")) {
      const pathname = new URL(request.url()).pathname;
      if (request.failure()?.errorText === "net::ERR_ABORTED") navigationAborts.push(pathname);
      else failures.push(`${request.method()} ${pathname} ${request.failure()?.errorText ?? "REQUEST_FAILED"}`);
    }
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/admin/e/sku-")) return;
    const pathname = new URL(response.url()).pathname;
    const current = media.get(pathname) ?? { count: 0, statuses: [], contentTypes: [] };
    current.count += 1;
    current.statuses.push(response.status());
    current.contentTypes.push(response.headers()["content-type"] ?? "");
    media.set(pathname, current);
  });

  await loginFromVisibleEntry(page);
  await openE1(page);
  await expect.poll(() => media.size, { timeout: 30_000 }).toBe(4);
  await expect.poll(() => [...media.values()].every((item) => item.count >= 1), { timeout: 30_000 }).toBe(true);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(e1Path)}(?:\\?.*)?$`));
  await expect.poll(() => [...media.values()].every((item) => item.count >= 2), { timeout: 30_000 }).toBe(true);

  expect(failures, "首入和刷新都不允许 E1 媒体 requestfailed").toEqual([]);
  expect(
    navigationAborts.filter((pathname) => !media.get(pathname)?.statuses.includes(200)),
    "媒体导航取消必须在同路径出现替代 200",
  ).toEqual([]);
  expect(
    [...media.values()].every((item) => item.statuses.every((status) => status === 200 || status === 206)),
    "图片应为 200，浏览器 Range 视频允许标准 206 Partial Content",
  ).toBe(true);
  expect([...media.entries()].find(([path]) => path.endsWith(".png"))?.[1].contentTypes.every((type) => type.startsWith("image/png"))).toBe(true);
  expect([...media.entries()].filter(([path]) => /\.(mp4|mov)$/.test(path)).every(([, item]) => item.contentTypes.every((type) => type.startsWith("video/")))).toBe(true);
});

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /^(登录|继续)$/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  await expect(otp.or(shell)).toBeVisible({ timeout: 20_000 });
  if (await otp.isVisible()) {
    await otp.fill(await freshTotp(page, totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openE1(page: Page) {
  const link = page.locator(`aside a[href="${e1Path}"]`).first();
  if (!(await link.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /E\s+设备与商城|设备与商城\s+E/ }).first().click();
  }
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(e1Path)}(?:\\?.*)?$`));
}

async function freshTotp(page: Page, secret: string) {
  if (30_000 - (Date.now() % 30_000) <= 5_000) await page.waitForTimeout(5_500);
  return totp(secret);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < key.length; index += 1) key[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
