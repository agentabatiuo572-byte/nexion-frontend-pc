import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Fixture = { accounts?: { maker?: Account } };

function maker(): Account {
  const fixturePath = process.env.A_PERMISSION_FIXTURE?.trim();
  if (!fixturePath) throw new Error("A_PERMISSION_FIXTURE is required for H owner MFA acceptance");
  const account = (JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture).accounts?.maker;
  if (!account?.username || !account.password || !account.totpSecret) {
    throw new Error("H maker MFA fixture is incomplete");
  }
  return account;
}

async function totp(secret: string): Promise<string> {
  // The server rejects a TOTP already consumed by a preceding H8/A2 login.
  // Always move to a new step before a new password challenge; retries never replay a code.
  const nextStepAt = (Math.floor(Date.now() / 30_000) + 1) * 30_000 + 250;
  await new Promise((resolve) => setTimeout(resolve, nextStepAt - Date.now()));
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
  const value = (((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** Real password + MFA UI login; each retry starts a new password challenge and never replays an OTP. */
export async function loginHMaker(page: Page): Promise<void> {
  const account = maker();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 1_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await totp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 15_000 });
}

export function hMakerUsername(): string {
  return maker().username;
}
