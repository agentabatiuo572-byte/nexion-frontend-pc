import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";

const EVIDENCE_DIR = process.env.A5_EVIDENCE_DIR || "D:/workspace/bug-pic/a5-reacceptance-20260718/main";
const API_PATH = "**/api/admin/platform/params-registry";
type LockedActor = { username: string; password: string; totpSecret: string };
const LOCKED_MANIFEST_PATH = process.env.A5_MANIFEST_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final7-fixture-refresh/final7-a-fixture-manifest.json";
const owner = loadLockedMaker();
let lastTotpStep = -1;
const TOTP_COUNTER_OFFSET = Number(process.env.A5_TOTP_COUNTER_OFFSET ?? "-1");

if (!Number.isInteger(TOTP_COUNTER_OFFSET) || TOTP_COUNTER_OFFSET < -2 || TOTP_COUNTER_OFFSET > 2) {
  throw new Error("A5_TOTP_COUNTER_OFFSET_MUST_BE_AN_INTEGER_BETWEEN_-2_AND_2");
}

test("A5 real user flow, owner navigation, filtering and fail-closed recovery states", async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/platform/params-registry");
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(owner.username);
    await page.locator('input[autocomplete="current-password"]').fill(owner.password);
    const login = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await login).status()).toBe(200);
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await otp.fill(await freshTotp(owner.totpSecret));
      const verified = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      expect((await verified).status()).toBe(200);
    }
  }

  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();
  await expect(page.getByText("当前服务端值").first()).toBeVisible();
  expect(await page.getByText("当前服务端值").count()).toBeGreaterThanOrEqual(100);
  await expect(page.getByText("参数键 · feature.ops.maintenanceBanner", { exact: true })).toBeVisible();
  await expect(page.getByText("/api/admin/platform/config/overview", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-live-registry.png` });

  const maintenanceCard = page.getByText("参数键 · feature.ops.maintenanceBanner", { exact: true }).locator("xpath=ancestor::article");
  await expect(maintenanceCard.getByText("off", { exact: true })).toBeVisible();
  await maintenanceCard.getByRole("link", { name: /A3 系统配置/ }).click();
  await expect(page).toHaveURL(/\/platform\/config$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();

  await page.getByLabel("筛选业务域").selectOption("J");
  await expect(page.getByText("参数键 · emergency.geo-block", { exact: true })).toBeVisible();
  expect(await page.getByText("当前服务端值").count()).toBe(6);
  await page.getByLabel("搜索参数").fill("兑换闸");
  await expect(page.getByText("参数键 · emergency.gate.exchange", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-filter-owner.png` });
  const j1Card = page.getByText("参数键 · emergency.gate.exchange", { exact: true }).locator("xpath=ancestor::article");
  await j1Card.getByRole("link", { name: /J1 功能闸/ }).click();
  await expect(page).toHaveURL(/\/emergency\/kill-switch$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();
  await page.getByLabel("筛选业务域").selectOption("J");
  await page.getByLabel("搜索参数").fill("地区屏蔽");
  const j2Card = page.getByText("参数键 · emergency.geo-block", { exact: true }).locator("xpath=ancestor::article");
  await j2Card.getByRole("link", { name: /J2 地区屏蔽/ }).click();
  await expect(page).toHaveURL(/\/emergency\/geo-block$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "平台参数寄存器" })).toBeVisible();

  await page.unrouteAll({ behavior: "wait" });
  await page.route(API_PATH, (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ code: 403, message: "FORBIDDEN", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("没有查看平台参数寄存器的权限", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-forbidden.png` });

  await page.unrouteAll({ behavior: "wait" });
  const liveResponse = await page.request.get("/api/admin/platform/params-registry");
  expect(liveResponse.ok()).toBeTruthy();
  const inconsistent = await liveResponse.json();
  inconsistent.data.rows[1].canonicalKey = inconsistent.data.rows[0].canonicalKey;
  await page.route(API_PATH, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(inconsistent),
  }));
  await page.reload();
  await expect(page.getByText("数据一致性校验未通过", { exact: true })).toBeVisible();
  await expect(page.getByText("当前服务端值")).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/04-integrity-fail-closed.png` });

  await page.unrouteAll({ behavior: "wait" });
  await page.route(API_PATH, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "PLATFORM_BACKEND_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("平台参数服务暂时不可用", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载" })).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/05-unavailable-retry.png` });

  await page.unrouteAll({ behavior: "wait" });
  await page.reload();
  await expect(page.getByText("当前服务端值").first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

function loadLockedMaker(): LockedActor {
  const expected = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/final7-fixture-refresh/final7-a-fixture-manifest.json";
  if (LOCKED_MANIFEST_PATH.replace(/\\/g, "/").toLowerCase() !== expected.toLowerCase()) throw new Error("A5 requires the locked Final7 A manifest");
  const value = JSON.parse(readFileSync(LOCKED_MANIFEST_PATH, "utf8")) as { actors?: { maker?: LockedActor } };
  const maker = value.actors?.maker;
  if (!maker?.username || !maker.password || !maker.totpSecret) throw new Error("A5 locked maker credentials are incomplete");
  return maker;
}

async function freshTotp(secret: string) {
  const step = Math.floor(Date.now() / 30_000);
  const remaining = 30_000 - (Date.now() % 30_000);
  if (step <= lastTotpStep || remaining <= 3_000) await new Promise<void>((resolve) => setTimeout(resolve, remaining + 500));
  lastTotpStep = Math.floor(Date.now() / 30_000);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("A5 invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(lastTotpStep + TOTP_COUNTER_OFFSET));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
