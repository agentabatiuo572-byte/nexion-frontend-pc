import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope = {
  code?: number;
  message?: string;
  data?: {
    configValues?: Record<string, string>;
    updated?: { key?: string; oldValue?: unknown; newValue?: unknown };
  };
};

const RUN_ID = "pc-full-acceptance-20260728-151023";
const EVIDENCE_DIR =
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/non-owner-E/global-config-proof`;
const FIXTURE = JSON.parse(readFileSync(
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/permission-fixtures.json`,
  "utf8",
)) as { accounts: { f_maker: Account } };
const F1_KEY = "F.prize.name";
const F2_KEY = "F.influence.clampMin";
const F1_IDEMPOTENCY_KEY = `${RUN_ID}-f1-config-proof`;
const F2_IDEMPOTENCY_KEY = `${RUN_ID}-f2-config-proof`;

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("F1/F2 配置同键同载荷精确回放、同键异载荷 409，最终值无漂移", async ({ page }) => {
  await login(page, FIXTURE.accounts.f_maker);

  const ranksBefore = await getEnvelope(page, "/api/admin/teams/ranks");
  const ratesBefore = await getEnvelope(page, "/api/admin/teams/rates");
  const f1Original = ranksBefore.data?.configValues?.[F1_KEY] ?? "";
  const f2Original = ratesBefore.data?.configValues?.[F2_KEY] ?? "";
  expect(f1Original).not.toBe("");
  expect(f2Original).not.toBe("");

  const f1 = await idempotencyProbe(
    page,
    F1_KEY,
    f1Original,
    `${f1Original}-MISMATCH-MUST-NOT-PERSIST`,
    F1_IDEMPOTENCY_KEY,
    `${RUN_ID} F1 配置幂等安全探针`,
  );
  const f2Mismatch = alternativeNumber(f2Original);
  const f2 = await idempotencyProbe(
    page,
    F2_KEY,
    f2Original,
    f2Mismatch,
    F2_IDEMPOTENCY_KEY,
    `${RUN_ID} F2 配置幂等安全探针`,
  );

  const ranksAfter = await getEnvelope(page, "/api/admin/teams/ranks");
  const ratesAfter = await getEnvelope(page, "/api/admin/teams/rates");
  const f1After = ranksAfter.data?.configValues?.[F1_KEY] ?? "";
  const f2After = ratesAfter.data?.configValues?.[F2_KEY] ?? "";

  writeFileSync(
    path.join(EVIDENCE_DIR, "http-result.json"),
    JSON.stringify({
      runId: RUN_ID,
      f1: { key: F1_KEY, original: f1Original, after: f1After, ...f1 },
      f2: { key: F2_KEY, original: f2Original, mismatch: f2Mismatch, after: f2After, ...f2 },
    }, null, 2),
  );

  expect(f1After).toBe(f1Original);
  expect(f2After).toBe(f2Original);
});

async function idempotencyProbe(
  page: Page,
  key: string,
  value: string,
  mismatchValue: string,
  idempotencyKey: string,
  reason: string,
) {
  const data = { value, reason, operator: "server-authenticated" };
  const first = await page.request.patch(
    `/api/admin/teams/commissions/config/${encodeURIComponent(key)}`,
    { headers: { "Idempotency-Key": idempotencyKey }, data },
  );
  const firstBody = await envelope(first);
  const replay = await page.request.patch(
    `/api/admin/teams/commissions/config/${encodeURIComponent(key)}`,
    { headers: { "Idempotency-Key": idempotencyKey }, data },
  );
  const replayBody = await envelope(replay);
  const mismatch = await page.request.patch(
    `/api/admin/teams/commissions/config/${encodeURIComponent(key)}`,
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { ...data, value: mismatchValue },
    },
  );
  const mismatchBody = await envelope(mismatch);

  expect(first.status()).toBe(200);
  expect(firstBody.code).toBe(0);
  expect(firstBody.data?.updated?.key).toBe(key);
  expect(replay.status()).toBe(200);
  expect(replayBody).toEqual(firstBody);
  expect(mismatch.status()).toBe(409);
  expect(mismatchBody.code).toBe(409);
  expect(mismatchBody.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

  return {
    idempotencyKey,
    first: { http: first.status(), body: firstBody },
    replay: { http: replay.status(), body: replayBody },
    mismatchResponse: { http: mismatch.status(), body: mismatchBody },
  };
}

async function getEnvelope(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.status()).toBe(200);
  const body = await envelope(response);
  expect(body.code).toBe(0);
  return body;
}

function alternativeNumber(value: string) {
  const number = Number.parseFloat(value);
  if (Number.isFinite(number)) {
    return (number >= 9.9 ? number - 0.1 : number + 0.1).toFixed(1);
  }
  return "1.1";
}

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
