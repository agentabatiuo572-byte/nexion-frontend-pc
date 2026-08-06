import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

const FIXTURE_PATH = process.env.C_PERMISSION_FIXTURE_PATH;
const EVIDENCE_DIR = process.env.C6_OWNER_EVIDENCE_DIR;
const RUN = `C6-${Date.now()}-${randomUUID().slice(0, 8)}`;

type Account = { username: string; password: string; totpSecret: string };
type Json = Record<string, any>;
type Result = { status: number; body: Json | null };

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("C6 Owner: visible unknown retry, idempotency/CAS, CAPTCHA, permissions and fail-closed", async ({ browser }) => {
  if (!FIXTURE_PATH || !EVIDENCE_DIR) {
    throw new Error("C_PERMISSION_FIXTURE_PATH and C6_OWNER_EVIDENCE_DIR are required");
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    accounts: {
      maker: Account;
      readonly: Account;
      nowrite: Account;
      nomenu: Account;
    };
  };
  const contexts: BrowserContext[] = [];
  const makerContext = await browser.newContext();
  const superContext = await browser.newContext();
  contexts.push(makerContext, superContext);
  const maker = await makerContext.newPage();
  const supervisor = await superContext.newPage();
  const runtime = monitorRuntime(maker);
  let original: Json | null = null;
  let restoredLock = false;
  let restoredCaptcha = false;
  const keys = {
    raceMaker: `${RUN}-RACE-MAKER`,
    raceSupervisor: `${RUN}-RACE-SUPERVISOR`,
    restoreLock: `${RUN}-RESTORE-LOCK`,
    invalidCaptcha: `${RUN}-INVALID-CAPTCHA`,
    emergencyLock: `${RUN}-FINALLY-LOCK`,
    emergencyCaptcha: `${RUN}-FINALLY-CAPTCHA`,
  };

  try {
    await Promise.all([
      loginMfa(maker, fixture.accounts.maker),
      loginMfa(supervisor, fixture.accounts.readonly),
    ]);
    expect(await roleCode(maker)).toBe("ACC_C_MK_114336");
    expect(await roleCode(supervisor)).toBe("ACC_C6_WR_114336");
    await openVisibleC6(maker);
    await openVisibleC6(supervisor);
    original = await overview(maker);
    const originalVersion = Number(original.configVersion);
    const originalLock = String(findParam(original, "lockShort").value);
    const originalCaptcha = captchaValue(original);
    const [attempts, duration] = numericParts(originalLock);
    const lockParam = findParam(original, "lockShort");
    const durationMin = Number(lockParam.secondaryMin);
    const durationMax = Number(lockParam.secondaryMax);
    const nextDuration = duration < durationMax ? duration + 1 : Math.max(durationMin, duration - 1);
    const temporaryLock = `${attempts} 次 / ${nextDuration} 分钟`;

    const permissionEvidence = await permissionMatrix(browser, fixture, originalVersion, originalLock);

    const shortRow = maker.locator(".p-row").filter({ hasText: "短锁" }).first();
    await shortRow.getByRole("button", { name: "调整", exact: true }).click();
    const lockDialog = maker.getByRole("dialog");
    await lockDialog.getByLabel("触发次数", { exact: true }).fill(String(attempts));
    await lockDialog.getByLabel("锁定时长(分钟)", { exact: true }).fill(String(nextDuration));
    await lockDialog.getByLabel(/操作理由/).fill(`${RUN} visible unknown then same-command retry`);

    const lockKeys: string[] = [];
    const lockBodies: Json[] = [];
    let lockAttempts = 0;
    await maker.route("**/api/admin/users/registration-risk/params/lockShort", async (route) => {
      lockAttempts += 1;
      lockKeys.push(await route.request().headerValue("idempotency-key") ?? "");
      lockBodies.push(route.request().postDataJSON() as Json);
      if (lockAttempts === 1) {
        await route.fulfill({
          status: 502,
          headers: { "X-Nexion-Upstream-Outcome": "unknown" },
          contentType: "application/json",
          body: JSON.stringify({ code: 502, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
        });
        return;
      }
      await route.continue();
    });
    await lockDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(maker.getByText("本次操作结果未知", { exact: false }).first()).toBeVisible();
    expect(Number((await overview(supervisor)).configVersion)).toBe(originalVersion);
    await lockDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(lockDialog).toHaveCount(0);
    await maker.unroute("**/api/admin/users/registration-risk/params/lockShort");
    expect(lockKeys).toHaveLength(2);
    expect(lockKeys[0]).toMatch(/^c6-command-/);
    expect(lockKeys[1]).toBe(lockKeys[0]);
    expect(lockBodies[1]).toEqual(lockBodies[0]);

    const afterVisible = await overview(supervisor);
    expect(Number(afterVisible.configVersion)).toBe(originalVersion + 1);
    expect(String(findParam(afterVisible, "lockShort").value)).toBe(temporaryLock);
    const replay = await requestResult(await patchParam(maker, "lockShort", lockKeys[0], lockBodies[0]));
    expect(replay.status).toBe(200);
    const mismatch = await requestResult(await patchParam(maker, "lockShort", lockKeys[0], {
      ...lockBodies[0],
      reason: `${String(lockBodies[0].reason)} mismatch`,
    }));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

    const raceBodyMaker = {
      value: temporaryLock,
      reason: `${RUN} maker CAS`,
      operator: fixture.accounts.maker.username,
      expectedVersion: Number(afterVisible.configVersion),
    };
    const raceBodySupervisor = {
      value: temporaryLock,
      reason: `${RUN} supervisor CAS`,
      operator: fixture.accounts.readonly.username,
      expectedVersion: Number(afterVisible.configVersion),
    };
    const [raceMaker, raceSupervisor] = await Promise.all([
      requestResult(await patchParam(maker, "lockShort", keys.raceMaker, raceBodyMaker)),
      requestResult(await patchParam(supervisor, "lockShort", keys.raceSupervisor, raceBodySupervisor)),
    ]);
    expect([raceMaker.status, raceSupervisor.status].sort()).toEqual([200, 409]);
    const afterRace = await overview(supervisor);
    expect(Number(afterRace.configVersion)).toBe(originalVersion + 2);
    const restoreLock = await requestResult(await patchParam(supervisor, "lockShort", keys.restoreLock, {
      value: originalLock,
      reason: `${RUN} exact business-value restore`,
      operator: fixture.accounts.readonly.username,
      expectedVersion: Number(afterRace.configVersion),
    }));
    expect(restoreLock.status).toBe(200);
    restoredLock = true;
    expect(String(findParam(await overview(supervisor), "lockShort").value)).toBe(originalLock);

    const beforeCaptcha = await overview(maker);
    const invalidCaptcha = await requestResult(await patchParam(
      maker,
      "captchaOff",
      keys.invalidCaptcha,
      {
        value: "https://status.example.com",
        reason: `${RUN} invalid recovery window`,
        operator: fixture.accounts.maker.username,
        expectedVersion: Number(beforeCaptcha.configVersion),
      },
    ));
    expect(invalidCaptcha.status).toBe(422);
    expect(invalidCaptcha.body?.message).toBe("CAPTCHA_RESTORE_WINDOW_REJECTED");

    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByRole("heading", { name: "注册/登录风控", exact: true })).toBeVisible();
    await maker.getByRole("button", { name: "紧急关闭", exact: true }).click();
    const disableDialog = maker.getByRole("dialog");
    await disableDialog.getByRole("button", { name: "30 分钟后自动恢复", exact: true }).click();
    await disableDialog.getByLabel(/操作理由/).fill(`${RUN} CAPTCHA absolute-deadline validation`);
    const disableResponsePromise = maker.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/registration-risk/params/captchaOff")
      && response.request().method() === "PATCH");
    await disableDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const disableResponse = await disableResponsePromise;
    const disable = await pageResult(disableResponse);
    expect(disable.status).toBe(200);
    expect(String(disable.body?.data?.value)).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const disableKey = disableResponse.request().headers()["idempotency-key"] ?? "";
    const disableBody = disableResponse.request().postDataJSON() as Json;
    const disableReplay = await requestResult(await patchParam(maker, "captchaOff", disableKey, disableBody));
    expect(disableReplay.status).toBe(200);
    const disableMismatch = await requestResult(await patchParam(maker, "captchaOff", disableKey, {
      ...disableBody,
      reason: `${String(disableBody.reason)} mismatch`,
    }));
    expect(disableMismatch.status).toBe(409);
    await expect(maker.getByText(/服务端自动恢复：/)).toBeVisible();

    await maker.getByRole("button", { name: "立即恢复", exact: true }).click();
    const restoreDialog = maker.getByRole("dialog");
    await restoreDialog.getByLabel(/操作理由/).fill(`${RUN} restore CAPTCHA safety gate`);
    const restoreCaptchaResponse = maker.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/registration-risk/params/captchaOff")
      && response.request().method() === "PATCH");
    await restoreDialog.getByRole("button", { name: "确认恢复", exact: true }).click();
    expect((await restoreCaptchaResponse).status()).toBe(200);
    restoredCaptcha = true;
    const finalBusiness = await overview(supervisor);
    expect(String(findParam(finalBusiness, "lockShort").value)).toBe(originalLock);
    expect(captchaValue(finalBusiness)).toBe(originalCaptcha);

    const audit = await requestResult(await maker.request.get(
      "/api/admin/platform/audit/logs?keyword=C6&limit=200",
    ));
    expect(audit.status).toBe(200);
    const auditText = JSON.stringify(audit.body);
    expect(auditText).toContain("C6_REGISTRATION_RISK_PARAM_UPDATED");
    expect(auditText).toContain("C6_CAPTCHA_TEMPORARILY_DISABLED");
    expect(auditText).toContain("C6_CAPTCHA_RESTORED");

    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "c6-final-business-restored.png"), fullPage: true });
    await logout(maker);
    await waitForNextTotpWindow();
    await loginMfa(maker, fixture.accounts.maker);
    await openVisibleC6(maker);
    const afterRelogin = await overview(maker);
    expect(String(findParam(afterRelogin, "lockShort").value)).toBe(originalLock);
    expect(captchaValue(afterRelogin)).toBe(originalCaptcha);

    const failureEvidence = await failClosedMatrix(makerContext);
    const notFound = await maker.request.get("/api/admin/users/registration-risk/not-a-real-route");
    expect(notFound.status()).toBe(404);
    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.unexpected5xx).toEqual([]);

    writeFileSync(path.join(EVIDENCE_DIR, "c6-owner-lifecycle.json"), JSON.stringify({
      run: RUN,
      original: {
        version: originalVersion,
        lockShort: originalLock,
        captchaOff: originalCaptcha,
      },
      visibleUnknownRetry: {
        attempts: lockAttempts,
        sameKey: lockKeys[0] === lockKeys[1],
        sameBody: JSON.stringify(lockBodies[0]) === JSON.stringify(lockBodies[1]),
        afterVersion: afterVisible.configVersion,
      },
      idempotency: { replay: replay.status, mismatch: mismatch.status },
      cas: {
        maker: raceMaker.status,
        supervisor: raceSupervisor.status,
        afterVersion: afterRace.configVersion,
      },
      restoreLock: restoreLock.status,
      captcha: {
        invalid: invalidCaptcha.status,
        disable: disable.status,
        replay: disableReplay.status,
        mismatch: disableMismatch.status,
        restored: restoredCaptcha,
      },
      permissionEvidence,
      failureEvidence: { ...failureEvidence, notFound: notFound.status() },
      auditStatus: audit.status,
      final: {
        lockShort: String(findParam(afterRelogin, "lockShort").value),
        captchaOff: captchaValue(afterRelogin),
        version: afterRelogin.configVersion,
      },
      runtime,
    }, null, 2));
  } finally {
    if (original) {
      const recoveryPage = supervisor;
      const current = await overview(recoveryPage).catch(() => null);
      if (current) {
        const originalLock = String(findParam(original, "lockShort").value);
        const originalCaptcha = captchaValue(original);
        if (String(findParam(current, "lockShort").value) !== originalLock) {
          const emergency = await requestResult(await patchParam(recoveryPage, "lockShort", keys.emergencyLock, {
            value: originalLock,
            reason: `${RUN} outer-finally lock restore`,
            operator: fixture.accounts.readonly.username,
            expectedVersion: Number(current.configVersion),
          }));
          expect(emergency.status, "outer-finally must restore lockShort").toBe(200);
          restoredLock = true;
        }
        const afterLock = await overview(recoveryPage);
        if (captchaValue(afterLock) !== originalCaptcha) {
          const emergency = await requestResult(await patchParam(recoveryPage, "captchaOff", keys.emergencyCaptcha, {
            value: originalCaptcha,
            reason: `${RUN} outer-finally CAPTCHA restore`,
            operator: fixture.accounts.readonly.username,
            expectedVersion: Number(afterLock.configVersion),
          }));
          expect(emergency.status, "outer-finally must restore CAPTCHA").toBe(200);
          restoredCaptcha = true;
        }
        const verified = await overview(recoveryPage);
        expect(String(findParam(verified, "lockShort").value)).toBe(originalLock);
        expect(captchaValue(verified)).toBe(originalCaptcha);
      }
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
});

async function permissionMatrix(
  browser: import("@playwright/test").Browser,
  fixture: { accounts: { nowrite: Account; nomenu: Account } },
  version: number,
  lockValue: string,
) {
  const anonymous = await browser.newContext();
  const noWriteContext = await browser.newContext();
  const noMenuContext = await browser.newContext();
  try {
    const noWrite = await noWriteContext.newPage();
    const noMenu = await noMenuContext.newPage();
    await Promise.all([
      loginMfa(noWrite, fixture.accounts.nowrite),
      loginMfa(noMenu, fixture.accounts.nomenu),
    ]);
    const body = {
      value: lockValue,
      reason: `${RUN} permission-denial probe`,
      operator: "forged",
      expectedVersion: version,
    };
    const anonymousRead = await anonymous.request.get("/api/admin/users/registration-risk/overview");
    const noWriteWrite = await patchParam(noWrite, "lockShort", `${RUN}-NOWRITE`, body);
    const noMenuRead = await noMenu.request.get("/api/admin/users/registration-risk/overview");
    expect(anonymousRead.status()).toBe(401);
    expect((await noWrite.request.get("/api/admin/users/registration-risk/overview")).status()).toBe(200);
    expect(noWriteWrite.status()).toBe(403);
    expect(noMenuRead.status()).toBe(403);
    expect(await noMenu.locator('aside a[href="/users/reg-risk"]').count()).toBe(0);
    return {
      anonymousRead: anonymousRead.status(),
      readonlyWrite: noWriteWrite.status(),
      nowriteWrite: noWriteWrite.status(),
      nomenuRead: noMenuRead.status(),
      nomenuVisibleLinks: await noMenu.locator('aside a[href="/users/reg-risk"]').count(),
    };
  } finally {
    await Promise.all([anonymous.close(), noWriteContext.close(), noMenuContext.close()]);
  }
}

async function failClosedMatrix(context: BrowserContext) {
  const malformed = await context.newPage();
  const serverError = await context.newPage();
  const timedOut = await context.newPage();
  try {
    await malformed.route("**/api/admin/users/registration-risk/overview", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "success", data: { unexpectedShape: true } }),
    }));
    await malformed.goto("/users/reg-risk", { waitUntil: "domcontentloaded" });
    await expect(malformed.getByRole("alert").filter({ hasText: "C6 数据加载失败" })).toBeVisible();
    await expect(malformed.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);

    await serverError.route("**/api/admin/users/registration-risk/overview", (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: "INTENTIONAL_C6_FAULT", data: null }),
    }));
    await serverError.goto("/users/reg-risk", { waitUntil: "domcontentloaded" });
    await expect(serverError.getByRole("alert").filter({ hasText: "C6 数据加载失败" })).toBeVisible();
    await expect(serverError.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);

    await timedOut.route("**/api/admin/users/registration-risk/overview", (route) => route.abort("timedout"));
    await timedOut.goto("/users/reg-risk", { waitUntil: "domcontentloaded" });
    await expect(timedOut.getByRole("alert").filter({ hasText: "C6 数据加载失败" })).toBeVisible();
    await expect(timedOut.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
    return { malformed200: "fail-closed", server500: "fail-closed", timeout: "fail-closed" };
  } finally {
    await Promise.all([malformed.close(), serverError.close(), timedOut.close()]);
  }
}

async function loginMfa(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 30_000 }),
    otp.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (!(await shell.isVisible({ timeout: 1_000 }).catch(() => false))) {
    await otp.fill(await freshTotp(account.totpSecret));
    const response = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify"
      && candidate.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await response).status()).toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  expect((await page.request.post("/api/admin/auth/logout")).status()).toBe(200);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function openVisibleC6(page: Page) {
  const link = page.locator('aside a[href="/users/reg-risk"]').first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const group = page.locator("aside button").filter({ hasText: /用户与账户/ }).first();
    if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/users\/reg-risk$/);
  await expect(page.getByRole("heading", { name: "注册/登录风控", exact: true })).toBeVisible();
}

async function overview(page: Page) {
  const result = await requestResult(await page.request.get("/api/admin/users/registration-risk/overview"));
  expect(result.status).toBe(200);
  expect(result.body?.code).toBe(0);
  return result.body?.data as Json;
}

function patchParam(page: Page, paramKey: string, key: string, body: Json) {
  return page.request.patch(`/api/admin/users/registration-risk/params/${paramKey}`, {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    data: body,
  });
}

async function requestResult(response: APIResponse): Promise<Result> {
  const raw = await response.text();
  let body: Json | null;
  try {
    body = JSON.parse(raw) as Json;
  } catch {
    body = { raw };
  }
  return { status: response.status(), body };
}

async function pageResult(response: import("@playwright/test").Response): Promise<Result> {
  const raw = await response.text();
  let body: Json | null;
  try {
    body = JSON.parse(raw) as Json;
  } catch {
    body = { raw };
  }
  return { status: response.status(), body };
}

async function roleCode(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const body = await response.json();
  return String(body.data?.session?.roleCode ?? "");
}

function findParam(value: Json, key: string) {
  const param = (Array.isArray(value.params) ? value.params : [])
    .find((row: Json) => row.key === key);
  if (!param) throw new Error(`C6 parameter missing: ${key}`);
  return param as Json;
}

function numericParts(value: string) {
  const values = value.match(/\d+/g)?.map(Number) ?? [];
  if (values.length !== 2) throw new Error(`Invalid C6 lock value: ${value}`);
  return values;
}

function captchaValue(value: Json) {
  if (!value.stats?.captchaTemporarilyDisabled) return "";
  return String(value.stats?.captchaRestoreAt ?? "");
}

function monitorRuntime(page: Page) {
  const pageErrors: string[] = [];
  const unexpected5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/admin/") && response.status() >= 500
        && response.headers()["x-nexion-upstream-outcome"] !== "unknown") {
      unexpected5xx.push(`${response.status()} ${pathname}`);
    }
  });
  return { pageErrors, unexpected5xx };
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
  if (remaining < 2_000) await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  return currentTotp(secret);
}

async function waitForNextTotpWindow() {
  const remaining = 30_000 - (Date.now() % 30_000);
  await new Promise((resolve) => setTimeout(resolve, remaining + 250));
}
