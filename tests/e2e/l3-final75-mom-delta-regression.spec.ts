import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Actor = { username: string; password: string; totpSecret: string };

const fixturePath = process.env.L3_FINAL75_FIXTURE_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final7-fixture-refresh/final7-a-fixture-manifest.json";
const evidenceDir = process.env.L3_FINAL75_EVIDENCE_DIR?.trim();
const actor = loadActor();

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("L3 accepts a canonical -100% revenue delta, fails closed below it, then recovers", async ({ page }) => {
  if (evidenceDir) await mkdir(evidenceDir, { recursive: true });
  await login(page, actor);

  let mode: "valid" | "invalid" = "valid";
  await page.route("**/api/admin/bi/finance/revenue?*", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as {
      data?: {
        streams?: Array<Record<string, unknown>>;
        totalUsdt?: number;
      };
    };
    const streams = payload.data?.streams;
    if (!Array.isArray(streams) || streams.length !== 4) throw new Error("L3_REVENUE_FIXTURE_INVALID");
    streams[0] = {
      ...streams[0],
      amountUsdt: 0,
      previousAmountUsdt: 40,
      share: null,
      momDelta: mode === "valid" ? -100 : -100.1,
    };
    payload.data!.totalUsdt = streams.reduce((sum, row) => sum + Number(row.amountUsdt), 0);
    await route.fulfill({ response, body: JSON.stringify(payload) });
  });

  await openL3(page);
  await expect(page.getByText("收入结构报表", { exact: true })).toBeVisible();
  await expect(page.getByText("-100.0%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/L3 数据加载失败/)).toHaveCount(0);
  if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "01-negative-100-valid.png"), fullPage: true });

  mode = "invalid";
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/L3 数据加载失败/)).toBeVisible();
  await expect(page.getByText(/L3_FINANCE_PROTOCOL_INVALID:revenue\.streams\[0\]\.momDelta/)).toBeVisible();
  await expect(page.getByRole("button", { name: "导出财务当前汇总 CSV", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "申请导出脱敏资金明细", exact: true })).toBeDisabled();
  if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "02-below-negative-100-fail-closed.png"), fullPage: true });

  mode = "valid";
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("收入结构报表", { exact: true })).toBeVisible();
  await expect(page.getByText("-100.0%", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/L3 数据加载失败/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "导出财务当前汇总 CSV", exact: true })).toBeEnabled();
  if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "03-valid-recovery.png"), fullPage: true });
});

async function login(page: Page, account: Actor) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible();
  await username.fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/auth/login"
    && response.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  await waitForFreshTotpWindow(page);
  await otp.fill(totp(account.totpSecret));
  const verifyResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await verifyResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible();
}

async function openL3(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/financial"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/financial$/);
  await expect(page.getByRole("heading", { name: "财务报表", exact: true })).toBeVisible();
}

async function waitForFreshTotpWindow(page: Page) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining <= 5_000) await page.waitForTimeout(remaining + 500);
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
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}

function loadActor(): Actor {
  const manifest = JSON.parse(readFileSync(fixturePath, "utf8")) as { actors?: { maker?: Actor } };
  const maker = manifest.actors?.maker;
  if (!maker?.username || !maker.password || !maker.totpSecret) throw new Error("L3_FINAL75_MAKER_REQUIRED");
  return maker;
}
