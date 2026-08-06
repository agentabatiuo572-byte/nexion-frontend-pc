import { expect, test, type Page } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type Envelope<T> = { code: number; message: string; data: T };
type DualLedger = {
  reserveUsd: number;
  liabilitiesUsd: number;
  coverageRatio: number;
  redlinePct: number;
};
type D5Snapshot = {
  version: number;
  dailyLimitCount: number;
  balanceMaxRatio: number;
  networkFeeRatio: number;
  networkFeeMin: number;
  networkFeeMax: number;
  nexFeeOffsetRate: number;
};
type FxQuote = {
  baseRateVndPerUsdt: number;
  buySpreadPct: number;
  lockWindowMinutes: number;
  quoteRateVndPerUsdt: number;
  version: number;
};

// A finance write carrier must never reuse a historical idempotency identity.
// The caller may supply a run id for traceability; standalone runs still get a
// fresh suffix shared by every write, compensation and evidence record.
const RUN_ID = process.env.D_CHILD_RUN_ID
  ?? `pc-full-acceptance-20260729-114336-D-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
const EVIDENCE_DIR = process.env.D_CHILD_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/owner/write";
const USERNAME = process.env.NEXION_E2E_USERNAME ?? "superadmin";
const PASSWORD = requiredEnv("NEXION_E2E_PASSWORD");
const TOTP_SECRET = process.env.NEXION_E2E_TOTP_SECRET?.trim() ?? "";
const VOUCHER_NO = process.env.D_CHILD_RESERVE_VOUCHER
  ?? `PCRUN-D-RESERVE-${RUN_ID.replace(/[^A-Za-z0-9]/g, "").slice(-20)}`;
const INJECTION_KEY = `${RUN_ID}-d3-coverage`;
const usedTotpWindows = new Map<string, number>();
const MYSQL = process.env.D_CHILD_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.D_CHILD_DB_NAME ?? "nexion_acceptance_20260729_114336_d";
const DB_PASSWORD = requiredEnv("D_CHILD_DB_PASSWORD");
let d3Compensation: { voucherNo: string; amount: number; before: DualLedger } | undefined;

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));
test.afterAll(() => {
  if (!d3Compensation) return;
  const compensationVoucher = `${d3Compensation.voucherNo}-OUT`;
  const reserveNo = `RSV-D3-COMP-${randomUUID()}`;
  const reason = `${RUN_ID} isolated D3 carrier exact restore after accepted IN probe`;
  const sql = `INSERT INTO nx_treasury_reserve_ledger (reserve_no, voucher_no, direction, amount_usd, reason, operator, idempotency_key, status, created_at, updated_at, is_deleted) VALUES ('${reserveNo}', '${compensationVoucher}', 'OUT', ${d3Compensation.amount.toFixed(2)}, '${reason}', 'd-acceptance-cleanup', '${RUN_ID}-d3-compensation', 'CONFIRMED', NOW(), NOW(), 0)`;
  execFileSync(MYSQL, [
    "--default-character-set=utf8mb4", "--host=127.0.0.1", "--user=root", "--database=" + DB_NAME,
    "--execute=" + sql,
  ], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: DB_PASSWORD } });
  writeEvidence("d3-compensation.json", {
    runId: RUN_ID,
    sourceVoucher: d3Compensation.voucherNo,
    compensationVoucher,
    amount: d3Compensation.amount,
    baseline: d3Compensation.before,
    method: "isolated-child-ledger OUT entry; immutable IN/audit/outbox remain for traceability",
  });
});

test("D3 Run 储备经真实接口越过红线，非法输入、重放和键冲突均失败关闭", async ({ page }) => {
  await login(page);
  const before = await readDualLedger(page);
  expect(before.liabilitiesUsd).toBeGreaterThan(0);
  expect(before.coverageRatio).toBeLessThan(before.redlinePct);

  const invalid = await page.request.post("/api/admin/treasury/reserve-injection", {
    headers: { "Idempotency-Key": `${RUN_ID}-d3-invalid` },
    data: {
      amount: "-1",
      voucherNo: `${VOUCHER_NO}-INVALID`,
      reason: `${RUN_ID} 非法负数储备不得写入`,
      operator: USERNAME,
    },
  });
  expect(invalid.status(), await invalid.text()).toBe(400);
  const afterInvalid = await readDualLedger(page);
  expect(afterInvalid.reserveUsd).toBe(before.reserveUsd);

  const requiredReserve = Math.max(
    1,
    before.liabilitiesUsd * (before.redlinePct + 5) / 100 - before.reserveUsd,
  );
  const amount = Math.ceil(requiredReserve * 100) / 100;
  const body = {
    amount: amount.toFixed(2),
    voucherNo: VOUCHER_NO,
    reason: `${RUN_ID} D3 隔离验收储备，结束后追加 OUT 补偿`,
    operator: USERNAME,
  };
  const created = await page.request.post("/api/admin/treasury/reserve-injection", {
    headers: { "Idempotency-Key": INJECTION_KEY },
    data: body,
  });
  expect(created.status(), await created.text()).toBe(200);
  const createdPayload = await created.json() as Envelope<Record<string, unknown>>;
  expect(createdPayload.code).toBe(0);

  const replayed = await page.request.post("/api/admin/treasury/reserve-injection", {
    headers: { "Idempotency-Key": INJECTION_KEY },
    data: body,
  });
  expect(replayed.status(), await replayed.text()).toBe(200);
  expect(await replayed.json()).toEqual(createdPayload);

  const conflicting = await page.request.post("/api/admin/treasury/reserve-injection", {
    headers: { "Idempotency-Key": INJECTION_KEY },
    data: { ...body, amount: (amount + 1).toFixed(2) },
  });
  expect(conflicting.status(), await conflicting.text()).toBe(409);

  const after = await readDualLedger(page);
  expect(after.coverageRatio).toBeGreaterThan(before.redlinePct);
  expect(after.coverageRatio).toBeGreaterThanOrEqual(before.redlinePct + 4.99);
  expect(after.reserveUsd - before.reserveUsd).toBeCloseTo(amount, 2);
  d3Compensation = { voucherNo: VOUCHER_NO, amount, before };

  writeEvidence("d3-coverage-lifecycle.json", {
    runId: RUN_ID,
    voucherNo: VOUCHER_NO,
    idempotencyKey: INJECTION_KEY,
    amount,
    before,
    invalidStatus: invalid.status(),
    createStatus: created.status(),
    replayStatus: replayed.status(),
    conflictStatus: conflicting.status(),
    after,
    cleanup: {
      required: true,
      method: "append OUT compensation preserving immutable IN/audit/outbox",
      amount,
    },
  });
});

test("D5 红线恢复后真实放大、幂等重放、冲突/CAS 与精确恢复闭环", async ({ page }) => {
  await login(page);
  const coverage = await readDualLedger(page);
  expect(coverage.coverageRatio).toBeGreaterThan(coverage.redlinePct);
  const original = await readD5(page);
  expect(original.balanceMaxRatio).toBeLessThan(1);
  const changedRatio = Math.round((original.balanceMaxRatio + 0.01) * 100) / 100;
  const mutationKey = `${RUN_ID}-d5-amplify`;
  const mutationBody = {
    balanceMaxRatio: changedRatio,
    expectedVersion: original.version,
    reason: `${RUN_ID} D5 覆盖率恢复后放大方向验证`,
    operator: USERNAME,
  };

  const changed = await page.request.put("/api/admin/withdraw/limits", {
    headers: { "Idempotency-Key": mutationKey },
    data: mutationBody,
  });
  expect(changed.status(), await changed.text()).toBe(200);
  const changedSnapshot = (await changed.json() as Envelope<D5Snapshot>).data;
  expect(changedSnapshot.balanceMaxRatio).toBe(changedRatio);
  expect(changedSnapshot.version).toBe(original.version + 1);

  const replayed = await page.request.put("/api/admin/withdraw/limits", {
    headers: { "Idempotency-Key": mutationKey },
    data: mutationBody,
  });
  expect(replayed.status(), await replayed.text()).toBe(200);
  const replayedSnapshot = (await replayed.json() as Envelope<D5Snapshot>).data;
  expect(replayedSnapshot.version).toBe(changedSnapshot.version);

  const keyConflict = await page.request.put("/api/admin/withdraw/limits", {
    headers: { "Idempotency-Key": mutationKey },
    data: { ...mutationBody, balanceMaxRatio: original.balanceMaxRatio },
  });
  expect(keyConflict.status(), await keyConflict.text()).toBe(409);

  const stale = await page.request.put("/api/admin/withdraw/limits", {
    headers: { "Idempotency-Key": `${RUN_ID}-d5-stale` },
    data: {
      balanceMaxRatio: original.balanceMaxRatio,
      expectedVersion: original.version,
      reason: `${RUN_ID} D5 陈旧版本不得覆盖`,
      operator: USERNAME,
    },
  });
  expect(stale.status(), await stale.text()).toBe(409);

  const restore = await page.request.put("/api/admin/withdraw/limits", {
    headers: { "Idempotency-Key": `${RUN_ID}-d5-restore` },
    data: {
      balanceMaxRatio: original.balanceMaxRatio,
      expectedVersion: changedSnapshot.version,
      reason: `${RUN_ID} D5 精确恢复原始余额可提比例`,
      operator: USERNAME,
    },
  });
  expect(restore.status(), await restore.text()).toBe(200);
  const restored = await readD5(page);
  expect(restored.balanceMaxRatio).toBe(original.balanceMaxRatio);
  expect(restored.dailyLimitCount).toBe(original.dailyLimitCount);
  expect(restored.networkFeeRatio).toBe(original.networkFeeRatio);
  expect(restored.networkFeeMin).toBe(original.networkFeeMin);
  expect(restored.networkFeeMax).toBe(original.networkFeeMax);
  expect(restored.nexFeeOffsetRate).toBe(original.nexFeeOffsetRate);

  await page.goto("/finance/params", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  await logout(page);
  await login(page);
  await page.goto("/finance/params", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  const relogin = await readD5(page);
  expect(relogin.balanceMaxRatio).toBe(original.balanceMaxRatio);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "d5-restored-relogin.png"), fullPage: true });

  writeEvidence("d5-healthy-lifecycle.json", {
    runId: RUN_ID,
    coverage,
    original,
    changed: changedSnapshot,
    replay: replayedSnapshot,
    keyConflictStatus: keyConflict.status(),
    staleStatus: stale.status(),
    restored,
    relogin,
  });
});

test("D6 写入结果未知时停止展示旧值，稳定键重放只落一次并精确恢复", async ({ page }) => {
  await login(page);
  const link = page.locator('aside a[href="/finance/fx-rate"]').first();
  if (!await link.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /资金与财务/ }).click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();

  const original = await readFx(page);
  const changedBase = original.baseRateVndPerUsdt >= 34_990
    ? original.baseRateVndPerUsdt - 10
    : original.baseRateVndPerUsdt + 10;
  let capturedKey = "";
  let capturedBody: Record<string, unknown> | undefined;
  let backendStatus = 0;
  const fxPath = "/api/admin/finance/fx-quote";
  let signalCaptured!: () => void;
  const captured = new Promise<void>((resolve) => { signalCaptured = resolve; });

  await page.route("**/api/admin/finance/fx-quote", async (route) => {
    const request = route.request();
    if (request.method() !== "PATCH" || new URL(request.url()).pathname !== fxPath) {
      await route.continue();
      return;
    }
    capturedKey = request.headers()["idempotency-key"] ?? "";
    capturedBody = request.postDataJSON() as Record<string, unknown>;
    const response = await route.fetch();
    backendStatus = response.status();
    signalCaptured();
    await route.abort("failed");
  });

  try {
    const row = page.locator(".p-row").filter({ hasText: "基准价" }).first();
    await row.getByRole("button", { name: "调整", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("目标新值").fill(String(changedBase));
    await dialog.locator("textarea").fill(`${RUN_ID} D6 写入响应丢失后的结果未知验证`);
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await captured;
    expect(backendStatus).toBe(200);
    expect(capturedKey).toBeTruthy();
    expect(capturedBody).toBeTruthy();
    await expect(page.getByText(/写入结果未确认，已停止展示旧牌价/)).toBeVisible();
    await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "d6-outcome-unknown-failclosed.png"), fullPage: true });

    await page.unroute("**/api/admin/finance/fx-quote");
    const replay = await page.request.patch("/api/admin/finance/fx-quote", {
      headers: { "Idempotency-Key": capturedKey },
      data: capturedBody,
    });
    expect(replay.status(), await replay.text()).toBe(200);
    const replayed = (await replay.json() as Envelope<FxQuote>).data;
    expect(replayed.baseRateVndPerUsdt).toBe(changedBase);

    const restore = await page.request.patch("/api/admin/finance/fx-quote", {
      headers: { "Idempotency-Key": `${RUN_ID}-d6-unknown-restore` },
      data: fxBody(replayed, original, `${RUN_ID} D6 未知结果验证后精确恢复`),
    });
    expect(restore.status(), await restore.text()).toBe(200);
    const restored = await readFx(page);
    expect(restored.baseRateVndPerUsdt).toBe(original.baseRateVndPerUsdt);
    expect(restored.buySpreadPct).toBe(original.buySpreadPct);
    expect(restored.lockWindowMinutes).toBe(original.lockWindowMinutes);
    writeEvidence("d6-outcome-unknown.json", {
      runId: RUN_ID,
      capturedKey,
      backendStatus,
      original,
      replayed,
      restored,
      browserOutcome: "REQUEST_ABORTED_AFTER_BACKEND_200",
      failClosed: true,
    });
  } finally {
    await page.unroute("**/api/admin/finance/fx-quote").catch(() => undefined);
    const current = await readFx(page).catch(() => undefined);
    if (current && (
      current.baseRateVndPerUsdt !== original.baseRateVndPerUsdt
      || current.buySpreadPct !== original.buySpreadPct
      || current.lockWindowMinutes !== original.lockWindowMinutes
    )) {
      const emergency = await page.request.patch("/api/admin/finance/fx-quote", {
        headers: { "Idempotency-Key": `${RUN_ID}-d6-unknown-emergency-restore-${Date.now()}` },
        data: fxBody(current, original, `${RUN_ID} D6 afterEach 精确恢复`),
      });
      expect(emergency.status(), await emergency.text()).toBe(200);
    }
  }
});

async function login(page: Page) {
  const aside = page.locator("aside");
  let lastMfaStatus = "not-started";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await aside.isVisible({ timeout: 1_500 }).catch(() => false)) return;
    const user = page.locator('input[autocomplete="username"]');
    await expect(user).toBeVisible({ timeout: 15_000 });
    await user.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const credentialResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const credential = await credentialResponse;
    expect(credential.status(), await credential.text()).toBe(200);

    const otp = page.getByLabel("一次性验证码");
    if (!(await otp.isVisible({ timeout: 8_000 }).catch(() => false))) {
      await expect(aside).toBeVisible({ timeout: 15_000 });
      return;
    }
    if (!TOTP_SECRET) throw new Error("NEXION_E2E_TOTP_SECRET is required for this account");
    await otp.fill(await freshTotp(TOTP_SECRET));
    const verificationResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verification = await verificationResponse;
    lastMfaStatus = String(verification.status());
    if (verification.status() === 200) {
      await expect(aside).toBeVisible({ timeout: 20_000 });
      return;
    }
    // A rejected OTP is a fresh challenge.  Never click through an existing
    // MFA screen with the same time-window code.
    await page.waitForTimeout(300);
  }
  throw new Error(`MFA shell unavailable after isolated fresh-window retries; status=${lastMfaStatus}`);
}

async function logout(page: Page) {
  const button = page.getByRole("button", { name: /superadmin|Super Admin|总管理员/i }).last();
  await expect(button).toBeVisible();
  await button.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function readDualLedger(page: Page): Promise<DualLedger> {
  const response = await page.request.get("/api/admin/treasury/dual-ledger");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as Envelope<{ snapshot: Record<string, unknown> }>;
  expect(payload.code).toBe(0);
  const snapshot = payload.data.snapshot;
  return {
    reserveUsd: finite(snapshot.reserveUsd, "reserveUsd"),
    liabilitiesUsd: finite(snapshot.liabilitiesUsd, "liabilitiesUsd"),
    coverageRatio: finite(snapshot.coverageRatio, "coverageRatio"),
    redlinePct: finite(snapshot.redlinePct, "redlinePct"),
  };
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

async function freshTotp(secret: string) {
  // MFA consumes a code per account/challenge.  First use can proceed in the
  // current safe window; every later login waits for a distinct window.
  let window = Math.floor(Date.now() / 30_000);
  const prior = usedTotpWindows.get(secret) ?? -1;
  const remaining = 30_000 - (Date.now() % 30_000);
  if (window <= prior || remaining < 5_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 300));
    window = Math.floor(Date.now() / 30_000);
  }
  usedTotpWindows.set(secret, window);
  return currentTotp(secret);
}

async function readD5(page: Page): Promise<D5Snapshot> {
  const response = await page.request.get("/api/admin/withdraw/limits");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as Envelope<D5Snapshot>;
  expect(payload.code).toBe(0);
  return payload.data;
}

async function readFx(page: Page): Promise<FxQuote> {
  const response = await page.request.get("/api/admin/finance/fx-quote");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as Envelope<FxQuote>;
  expect(payload.code).toBe(0);
  return payload.data;
}

function fxBody(current: FxQuote, target: FxQuote, reason: string) {
  return {
    baseRateVndPerUsdt: target.baseRateVndPerUsdt,
    buySpreadPct: target.buySpreadPct,
    lockWindowMinutes: target.lockWindowMinutes,
    expectedVersion: current.version,
    reason,
    operator: USERNAME,
  };
}

function finite(value: unknown, label: string) {
  const parsed = Number(value);
  expect(Number.isFinite(parsed), `${label} must be finite`).toBe(true);
  return parsed;
}

function writeEvidence(name: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
