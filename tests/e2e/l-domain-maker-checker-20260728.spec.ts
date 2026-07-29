import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type LFixture = { accounts: { l_owner: FixtureAccount } };
type CheckerFixture = { accounts: { d_checker: FixtureAccount } };
type ApiEnvelope<T> = { code?: number; message?: string; data?: T };

const RUN_ID = process.env.L_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const L_FIXTURE_PATH = process.env.L_PERMISSION_FIXTURE_PATH;
const CHECKER_FIXTURE_PATH = process.env.L_PERMISSION_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const EVIDENCE_DIR = process.env.L_MAKER_CHECKER_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/L/maker-checker`;

if (!L_FIXTURE_PATH) throw new Error("L_PERMISSION_FIXTURE_PATH is required");
const owner = (JSON.parse(readFileSync(L_FIXTURE_PATH, "utf8")) as LFixture).accounts.l_owner;
const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture).accounts.d_checker;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("L3 敏感明细由 L Owner 发起、同键幂等/异载荷冲突，并由两个独立 Checker 竞争批准", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  await loginWithMfa(page, owner);
  const idempotencyKey = `l-maker-${RUN_ID}-${randomUUID()}`;
  const body = {
    exportType: "财务资金明细",
    timeRange: "2026-07-01/2026-07-31",
    fields: "交易时间,用户编码（脱敏）,业务编号,账单类型,资产,方向,金额,余额,状态",
    piiLevel: "HIGH_PII",
    maskPolicy: "MASKED",
    recipient: "L 域验收 maker-checker",
    ticket: `L-MAKER-CHECKER-${RUN_ID}`,
    reason: "L 域高风险敏感明细独立 maker checker 与 CAS 验收",
    operator: owner.username,
  };
  const created = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": idempotencyKey },
    data: body,
  });
  const createdData = await okEnvelope<{
    created: { reportId: string; status: string; containsPii: boolean; maskingPolicy: string };
  }>(created);
  expect(createdData.created).toMatchObject({
    status: "PENDING_CONFIRM",
    containsPii: true,
    maskingPolicy: "MASKED",
  });
  const reportId = createdData.created.reportId;

  const replay = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": idempotencyKey },
    data: body,
  });
  const replayData = await okEnvelope<{ created: { reportId: string; status: string } }>(replay);
  expect(replayData.created.reportId).toBe(reportId);
  expect(replayData.created.status).toBe("PENDING_CONFIRM");

  const conflict = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": idempotencyKey },
    data: { ...body, recipient: "同键异载荷不得执行" },
  });
  expect(conflict.status()).toBe(409);

  const makerCannotApprove = await page.request.post(`/api/admin/bi/reports/${reportId}/approve`, {
    headers: { "Idempotency-Key": `l-maker-cannot-approve-${randomUUID()}` },
    data: {
      includeSensitive: true,
      includeDecrypted: false,
      reason: "maker 不得自批敏感明细",
      operator: owner.username,
    },
  });
  expect(makerCannotApprove.status()).toBe(403);

  const checkerContext = await browser.newContext({ baseURL: BASE_URL });
  const rootContext = await browser.newContext({ baseURL: BASE_URL });
  const checkerPage = await checkerContext.newPage();
  const rootPage = await rootContext.newPage();
  try {
    await loginPasswordOnly(rootPage, ROOT_USERNAME, ROOT_PASSWORD);
    await loginWithMfa(checkerPage, checker);
    const approveBody = {
      includeSensitive: true,
      includeDecrypted: false,
      reason: "两个独立 checker 竞争批准，CAS 只允许一个成功",
    };
    const [checkerApprove, rootApprove] = await Promise.all([
      checkerPage.request.post(`/api/admin/bi/reports/${reportId}/approve`, {
        headers: { "Idempotency-Key": `l-checker-a-${randomUUID()}` },
        data: { ...approveBody, operator: checker.username },
      }),
      rootPage.request.post(`/api/admin/bi/reports/${reportId}/approve`, {
        headers: { "Idempotency-Key": `l-checker-b-${randomUUID()}` },
        data: { ...approveBody, operator: ROOT_USERNAME },
      }),
    ]);
    const statuses = [checkerApprove.status(), rootApprove.status()].sort((left, right) => left - right);
    expect(statuses).toEqual([200, 409]);
  } finally {
    await checkerContext.close();
    await rootContext.close();
  }

  const token = await page.request.get(`/api/admin/bi/exports/${reportId}/download-token`);
  const tokenData = await okEnvelope<{ downloadToken: string; expiresAt: string }>(token);
  expect(tokenData.downloadToken).not.toBe("");
  expect(Date.parse(tokenData.expiresAt)).toBeGreaterThan(Date.now());
  const downloaded = await page.request.get(
    `/api/admin/bi/exports/${reportId}/download?token=${encodeURIComponent(tokenData.downloadToken)}`,
  );
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()["content-type"]).toContain("text/csv");
  const csv = await downloaded.text();
  expect(csv).toContain("用户编码（脱敏）");
  expect(csv).not.toMatch(/passport|phone|email/i);

  writeFileSync(path.join(EVIDENCE_DIR, "runtime-evidence.json"), JSON.stringify({
    runId: RUN_ID,
    reportId,
    idempotencyKey,
    maker: owner.username,
    checkerA: checker.username,
    checkerB: ROOT_USERNAME,
    statuses: {
      create: created.status(),
      replay: replay.status(),
      sameKeyDifferentPayload: conflict.status(),
      makerSelfApprove: makerCannotApprove.status(),
      download: downloaded.status(),
    },
    cleanup: {
      reportId,
      minioObject: `bi-reports/${reportId.toLowerCase()}.csv`,
      idempotencyKey,
    },
  }, null, 2));
});

async function loginPasswordOnly(page: Page, username: string, password: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginWithMfa(page: Page, account: FixtureAccount) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const aside = page.locator("aside");
  await expect.poll(async () => (await otp.isVisible()) || (await aside.isVisible()), {
    timeout: 10_000,
    message: "登录后必须进入 MFA 挑战或已认证控制台",
  }).toBe(true);
  if (await aside.isVisible()) return;
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(aside).toBeVisible({ timeout: 30_000 });
}

async function okEnvelope<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as ApiEnvelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
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
  return currentTotp(secret);
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
