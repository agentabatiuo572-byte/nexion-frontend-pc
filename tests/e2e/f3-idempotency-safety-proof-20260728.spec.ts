import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope = {
  code?: number;
  message?: string;
  data?: { ownerUserId?: number; status?: string; reason?: string };
};

const RUN_ID = "pc-full-acceptance-20260728-151023";
const EVIDENCE_DIR =
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/non-owner-E/funds-proof`;
const FIXTURE = JSON.parse(readFileSync(
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/permission-fixtures.json`,
  "utf8",
)) as { accounts: { f_maker: Account } };
const OWNER_A = 9_900_001_510_231;
const OWNER_B = 9_900_001_510_232;
const SETTLEMENT_DATE = "2026-07-28";
const IDEMPOTENCY_KEY = `${RUN_ID}-f3-proof-shared-key`;
const NEW_IDEMPOTENCY_KEY = `${RUN_ID}-f3-proof-new-key`;

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("F3 同一 Idempotency-Key 异载荷必须返回 409 且不能执行第二个 owner", async ({ page }) => {
  await login(page, FIXTURE.accounts.f_maker);

  const first = await page.request.post("/api/admin/teams/binary/settlements", {
    headers: { "Idempotency-Key": IDEMPOTENCY_KEY },
    data: {
      ownerUserId: OWNER_A,
      settlementDate: SETTLEMENT_DATE,
      reason: `${RUN_ID} F3 无真实佣金安全幂等探针 A`,
    },
  });
  const firstBody = await envelope(first);

  const replay = await page.request.post("/api/admin/teams/binary/settlements", {
    headers: { "Idempotency-Key": IDEMPOTENCY_KEY },
    data: {
      ownerUserId: OWNER_A,
      settlementDate: SETTLEMENT_DATE,
      reason: `${RUN_ID} F3 无真实佣金安全幂等探针 A`,
    },
  });
  const replayBody = await envelope(replay);

  const mismatch = await page.request.post("/api/admin/teams/binary/settlements", {
    headers: { "Idempotency-Key": IDEMPOTENCY_KEY },
    data: {
      ownerUserId: OWNER_B,
      settlementDate: SETTLEMENT_DATE,
      reason: `${RUN_ID} F3 无真实佣金安全幂等探针 B`,
    },
  });
  const mismatchBody = await envelope(mismatch);

  const newKey = await page.request.post("/api/admin/teams/binary/settlements", {
    headers: { "Idempotency-Key": NEW_IDEMPOTENCY_KEY },
    data: {
      ownerUserId: OWNER_A,
      settlementDate: SETTLEMENT_DATE,
      reason: `${RUN_ID} F3 无真实佣金安全幂等探针 A`,
    },
  });
  const newKeyBody = await envelope(newKey);

  writeFileSync(
    path.join(EVIDENCE_DIR, "http-result.json"),
    JSON.stringify({
      runId: RUN_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      newIdempotencyKey: NEW_IDEMPOTENCY_KEY,
      first: { http: first.status(), body: firstBody },
      replay: { http: replay.status(), body: replayBody },
      mismatch: { http: mismatch.status(), body: mismatchBody },
      newKey: { http: newKey.status(), body: newKeyBody },
    }, null, 2),
  );

  expect(first.status()).toBe(200);
  expect(firstBody.code).toBe(0);
  expect(firstBody.data).toMatchObject({
    ownerUserId: OWNER_A,
    status: "BLOCKED",
    reason: "BINARY_OWNER_NOT_ACTIVE",
  });
  expect(replay.status()).toBe(200);
  expect(replayBody).toEqual(firstBody);
  expect(mismatch.status()).toBe(409);
  expect(mismatchBody.code).toBe(409);
  expect(newKey.status()).toBe(200);
  expect(newKeyBody.code).toBe(0);
  expect(newKeyBody.data).toMatchObject({
    ownerUserId: OWNER_A,
    status: "BLOCKED",
    reason: "BINARY_OWNER_NOT_ACTIVE",
  });
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
