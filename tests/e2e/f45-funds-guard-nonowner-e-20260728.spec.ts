import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope = { code?: number; message?: string; data?: unknown };

const RUN_ID = "pc-full-acceptance-20260728-151023";
const EVIDENCE_DIR =
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/non-owner-E/funds-proof`;
const FIXTURE = JSON.parse(readFileSync(
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/permission-fixtures.json`,
  "utf8",
)) as { accounts: { f_maker: Account } };
const F5_KEY = `${RUN_ID}-f5-safe-missing-event`;

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("F4 直接资金端点失败关闭；F5 同键异载荷 409 且缺失事件零副作用", async ({ page }) => {
  await login(page, FIXTURE.accounts.f_maker);

  const f4 = await page.request.post("/api/admin/teams/leadership-pool/settle");
  const f4Body = await envelope(f4);
  expect(f4.status()).toBe(409);
  expect(f4Body.code).toBe(409);
  expect(f4Body.message).toBe("A2_CONFIRMATION_REQUIRED");

  const first = await page.request.post(
    "/api/admin/teams/commissions/CM-990000151023/reverse",
    {
      headers: { "Idempotency-Key": F5_KEY },
      data: {
        refundRef: "REF-SAFE-151023-A",
        reason: `${RUN_ID} F5 缺失事件安全幂等探针`,
        operator: "server-authenticated",
      },
    },
  );
  const firstBody = await envelope(first);
  expect(first.status()).toBe(404);
  expect(firstBody.code).toBe(404);
  expect(firstBody.message).toBe("COMMISSION_EVENT_NOT_FOUND");

  const mismatch = await page.request.post(
    "/api/admin/teams/commissions/CM-990000151023/reverse",
    {
      headers: { "Idempotency-Key": F5_KEY },
      data: {
        refundRef: "REF-SAFE-151023-B",
        reason: `${RUN_ID} F5 同键异载荷必须拒绝`,
        operator: "server-authenticated",
      },
    },
  );
  const mismatchBody = await envelope(mismatch);
  expect(mismatch.status()).toBe(409);
  expect(mismatchBody.code).toBe(409);
  expect(mismatchBody.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

  writeFileSync(
    path.join(EVIDENCE_DIR, "f45-http-result.json"),
    JSON.stringify({
      runId: RUN_ID,
      f4: { http: f4.status(), body: f4Body },
      f5First: { http: first.status(), body: firstBody },
      f5Mismatch: { http: mismatch.status(), body: mismatchBody },
    }, null, 2),
  );
});

async function login(page: Page, account: Account) {
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

async function envelope(response: { json(): Promise<unknown> }) {
  return (await response.json().catch(() => null)) as Envelope;
}
