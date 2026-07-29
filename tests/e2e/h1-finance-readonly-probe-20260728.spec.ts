import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = process.env.H_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const FIXTURE_PATH = process.env.H_CHECKER_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;

type Account = { username: string; password: string; totpSecret: string };

test("finance 跨域只读 H1：接口写拒绝且页面不暴露可操作按钮", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    accounts?: { d_maker?: Account };
  };
  const account = fixture.accounts?.d_maker;
  if (!account) throw new Error("A fixture d_maker is required");
  await loginMfa(page, account);

  const group = page.getByRole("button", { name: /增长与运营节奏/ }).first();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await page.locator('aside a[href="/growth/phase"]').first().click();
  await expect(page).toHaveURL(/\/growth\/phase$/);
  await expect(page.getByText("节奏骨架", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/admin/growth/phases")).status()).toBe(200);
  const denied = await page.request.patch("/api/admin/growth/rhythm/phaseProgressPct", {
    headers: { "Idempotency-Key": `${RUN_ID}-H1-READONLY-PROBE` },
    data: {
      key: "phaseProgressPct",
      value: "50",
      reason: `${RUN_ID} 只读权限探针不得执行`,
      operator: account.username,
    },
  });
  expect(denied.status()).toBe(403);

  for (const name of ["改总时长", "设定位置", "调整", "撤销"]) {
    const enabled = await page.getByRole("button", { name: new RegExp(name) }).evaluateAll((buttons) =>
      buttons.filter((button) => {
        const element = button as HTMLButtonElement;
        const style = window.getComputedStyle(element);
        return !element.disabled && style.display !== "none" && style.visibility !== "hidden";
      }).length);
    expect(enabled, `${name} must not be actionable`).toBe(0);
  }
});

async function loginMfa(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(currentTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
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
