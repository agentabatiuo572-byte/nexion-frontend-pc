import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR = process.env.C_NONOWNER_EVIDENCE_DIR;
const A_PERMISSION_FIXTURE = process.env.A_PERMISSION_FIXTURE_PATH;

test("C6 可见入口真实写、同键异载荷、双运营员 CAS 与精确恢复", async ({ browser }) => {
  if (!A_PERMISSION_FIXTURE) throw new Error("A_PERMISSION_FIXTURE_PATH is required");
  if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fixture = JSON.parse(readFileSync(A_PERMISSION_FIXTURE, "utf8")) as {
    accounts: { d_checker: { username: string; password: string; totpSecret: string } };
  };
  const checkerAccount = fixture.accounts.d_checker;
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const makerRuntime = monitorRuntime(maker);
  const checkerRuntime = monitorRuntime(checker);
  const execution = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const keys = {
    raceMaker: `c6-nonowner-b-race-maker-${execution}`,
    raceChecker: `c6-nonowner-b-race-checker-${execution}`,
    restore: `c6-nonowner-b-restore-${execution}`,
    emergency: `c6-nonowner-b-finally-${execution}`,
  };
  let originalValue = "";
  let originalVersion = -1;
  let restored = false;

  try {
    await Promise.all([login(maker), loginAccount(checker, checkerAccount)]);
    await Promise.all([openVisibleC6(maker), openVisibleC6(checker)]);
    const before = await overview(maker);
    originalVersion = Number(before.configVersion);
    const short = findParam(before, "lockShort");
    originalValue = String(short.value);
    const [attempts, duration] = numericParts(originalValue);
    const durationMin = Number(short.secondaryMin);
    const durationMax = Number(short.secondaryMax);
    const nextDuration = duration < durationMax ? duration + 1 : Math.max(durationMin, duration - 1);
    const temporaryValue = `${attempts} 次 / ${nextDuration} 分钟`;

    const shortRow = maker.locator(".p-row").filter({ hasText: "短锁" }).first();
    await shortRow.getByRole("button", { name: "调整", exact: true }).click();
    const dialog = maker.getByRole("dialog");
    await dialog.getByLabel("触发次数", { exact: true }).fill(String(attempts));
    await dialog.getByLabel("锁定时长(分钟)", { exact: true }).fill(String(nextDuration));
    await dialog.getByLabel(/操作理由/).fill("C6 非Owner真实参数写入与恢复验收");
    const uiWritePromise = maker.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/users/registration-risk/params/lockShort"
      && response.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const uiWriteResponse = await uiWritePromise;
    expect(uiWriteResponse.status()).toBe(200);
    const uiKey = uiWriteResponse.request().headers()["idempotency-key"] || "";
    const uiBody = uiWriteResponse.request().postDataJSON() as Record<string, unknown>;
    const uiResult = await pageResponseEvidence(uiWriteResponse);
    expect(uiKey).toMatch(/^c6-command-/);
    expect(uiResult.body?.code).toBe(0);

    const afterUi = await overview(maker);
    expect(afterUi.configVersion).toBe(originalVersion + 1);
    expect(String(findParam(afterUi, "lockShort").value)).toBe(temporaryValue);

    const replay = await requestEvidence(await patchParam(maker, uiKey, uiBody));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(uiResult.body);
    const mismatch = await requestEvidence(await patchParam(maker, uiKey, {
      ...uiBody,
      reason: `${String(uiBody.reason)} 异载荷`,
    }));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

    const raceBodyMaker = {
      value: temporaryValue,
      reason: "C6 双运营员同版本竞争 maker 验收",
      operator: USERNAME,
      expectedVersion: Number(afterUi.configVersion),
    };
    const raceBodyChecker = {
      value: temporaryValue,
      reason: "C6 双运营员同版本竞争 checker 验收",
      operator: checkerAccount.username,
      expectedVersion: Number(afterUi.configVersion),
    };
    const [raceMaker, raceChecker] = await Promise.all([
      requestEvidence(await patchParam(maker, keys.raceMaker, raceBodyMaker)),
      requestEvidence(await patchParam(checker, keys.raceChecker, raceBodyChecker)),
    ]);
    expect([raceMaker.status, raceChecker.status].sort()).toEqual([200, 409]);
    const raceLoser = raceMaker.status === 409 ? raceMaker : raceChecker;
    expect(raceLoser.body?.message).toBe("C6_CONFIG_VERSION_CONFLICT");

    const afterRace = await overview(maker);
    expect(afterRace.configVersion).toBe(originalVersion + 2);
    expect(String(findParam(afterRace, "lockShort").value)).toBe(temporaryValue);

    const restore = await requestEvidence(await patchParam(checker, keys.restore, {
      value: originalValue,
      reason: "C6 非Owner复审完成后精确恢复原参数",
      operator: checkerAccount.username,
      expectedVersion: Number(afterRace.configVersion),
    }));
    expect(restore.status).toBe(200);
    restored = true;
    const finalOverview = await overview(maker);
    expect(finalOverview.configVersion).toBe(originalVersion + 3);
    expect(String(findParam(finalOverview, "lockShort").value)).toBe(originalValue);
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.locator(".p-row").filter({ hasText: "短锁" }).first().locator(".v"))
      .toContainText(originalValue);

    const audit = await requestEvidence(
      await maker.request.get("/api/admin/platform/audit/logs?keyword=lockShort&limit=200"),
    );
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toContain("C6_REGISTRATION_RISK_PARAM_UPDATED");
    expect(makerRuntime.pageErrors).toEqual([]);
    expect(checkerRuntime.pageErrors).toEqual([]);
    expect(makerRuntime.admin5xx).toEqual([]);
    expect(checkerRuntime.admin5xx).toEqual([]);

    if (EVIDENCE_DIR) {
      writeFileSync(path.join(EVIDENCE_DIR, "c6-global-lock.json"), JSON.stringify({
        execution,
        originalValue,
        temporaryValue,
        versions: {
          before: originalVersion,
          afterUi: afterUi.configVersion,
          afterRace: afterRace.configVersion,
          final: finalOverview.configVersion,
        },
        ui: { key: uiKey, body: uiBody, result: uiResult },
        replay,
        mismatch,
        race: { maker: raceMaker, checker: raceChecker },
        restore,
        a2: audit.status,
        a4Outbox: "NOT_APPLICABLE_C6_CONTRACT_IS_REQUIRED_A2_ONLY",
        runtime: { maker: makerRuntime, checker: checkerRuntime },
        keys,
      }, null, 2));
      await maker.screenshot({ path: path.join(EVIDENCE_DIR, "c6-restored-final.png"), fullPage: true });
    }
  } finally {
    if (originalValue && !restored) {
      const current = await overview(maker).catch(() => null);
      if (current && String(findParam(current, "lockShort").value) !== originalValue) {
        const emergency = await requestEvidence(await patchParam(maker, keys.emergency, {
          value: originalValue,
          reason: "C6 非Owner验收 finally 精确恢复原参数",
          operator: USERNAME,
          expectedVersion: Number(current.configVersion),
        })).catch(() => ({ status: 0, body: null }));
        expect(emergency.status, "C6 中断后必须恢复原参数").toBe(200);
      }
    }
    if (originalValue) {
      const finalOverview = await overview(maker);
      expect(String(findParam(finalOverview, "lockShort").value)).toBe(originalValue);
    }
    await Promise.all([makerContext.close(), checkerContext.close()]);
  }
});

async function overview(page: Page) {
  const response = await requestEvidence(
    await page.request.get("/api/admin/users/registration-risk/overview"),
  );
  expect(response.status).toBe(200);
  expect(response.body?.code).toBe(0);
  return response.body?.data as Record<string, any>;
}

function patchParam(page: Page, key: string, body: Record<string, unknown>) {
  return page.request.patch("/api/admin/users/registration-risk/params/lockShort", {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    data: body,
  });
}

function findParam(overviewValue: Record<string, any>, key: string) {
  const params = Array.isArray(overviewValue.params) ? overviewValue.params : [];
  const param = params.find((row: Record<string, unknown>) => row.key === key);
  if (!param) throw new Error(`C6 param missing: ${key}`);
  return param as Record<string, any>;
}

function numericParts(value: string) {
  const numbers = value.match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length !== 2) throw new Error(`Invalid C6 composite value: ${value}`);
  return numbers;
}

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  if (await shell.isVisible({ timeout: 3_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function loginAccount(
  page: Page,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 20_000 }),
    otp.waitFor({ state: "visible", timeout: 20_000 }),
  ]);
  if (await shell.isVisible()) return;
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function openVisibleC6(page: Page) {
  const link = page.locator('aside a[href="/users/reg-risk"]').first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const group = page.locator("aside button").filter({ hasText: /用户与账户/ }).first();
    if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) await group.click();
  }
  await expect(link).toBeVisible();
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/admin/users/registration-risk/overview"
    && candidate.request().method() === "GET");
  await link.click();
  await expect(page).toHaveURL(/\/users\/reg-risk$/);
  expect((await response).status()).toBe(200);
}

async function requestEvidence(response: APIResponse) {
  const text = await response.text();
  let body: Record<string, any> | null = null;
  try {
    body = JSON.parse(text) as Record<string, any>;
  } catch {
    body = { raw: text };
  }
  return { status: response.status(), body };
}

async function pageResponseEvidence(response: import("@playwright/test").Response) {
  const text = await response.text();
  let body: Record<string, any> | null = null;
  try {
    body = JSON.parse(text) as Record<string, any>;
  } catch {
    body = { raw: text };
  }
  return { status: response.status(), body };
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
  const remaining = 30_000 - (Date.now() % 30_000);
  await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  return currentTotp(secret);
}

function monitorRuntime(page: Page) {
  const pageErrors: string[] = [];
  const admin5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/admin/") && response.status() >= 500) {
      admin5xx.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return { pageErrors, admin5xx };
}
