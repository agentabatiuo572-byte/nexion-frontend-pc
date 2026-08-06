import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type BrowserContext, type Page } from "@playwright/test";

const C_FIXTURE_PATH = process.env.C_PERMISSION_FIXTURE_PATH;
const K_FIXTURE_PATH = process.env.K_PERMISSION_FIXTURE_PATH;
const USER_ID = process.env.C5_REVIEW_USER_ID || "990000151025";
const USER_NO = process.env.C5_REVIEW_USER_NO || "U990000151025";
const EVIDENCE_DIR = process.env.C5_REVIEW_EVIDENCE_DIR;
const RUN = `C5-${Date.now()}`;

type Account = { username: string; password: string; totpSecret: string };
type Ticket = { id: string; user: string; st: string; version: number };
type K5Overview = { tickets: { records: Ticket[] } };
type Json = Record<string, any>;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("C5 visible workflow: K5 two-operator CAS, unknown outcome, idempotency and password-reset closure", async ({ browser }) => {
  if (!C_FIXTURE_PATH || !K_FIXTURE_PATH || !EVIDENCE_DIR) {
    throw new Error("C_PERMISSION_FIXTURE_PATH, K_PERMISSION_FIXTURE_PATH and C5_REVIEW_EVIDENCE_DIR are required");
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const cFixture = JSON.parse(readFileSync(C_FIXTURE_PATH, "utf8")) as {
    accounts: { maker: Account; nowrite: Account };
  };
  const kFixture = JSON.parse(readFileSync(K_FIXTURE_PATH, "utf8")) as {
    checker: Account;
    accounts: { maker: Account };
  };
  const contexts: BrowserContext[] = [];
  const runtimeErrors: string[] = [];
  const cContext = await browser.newContext();
  const kAContext = await browser.newContext();
  const kBContext = await browser.newContext();
  const noWriteContext = await browser.newContext();
  contexts.push(cContext, kAContext, kBContext, noWriteContext);
  const cPage = await cContext.newPage();
  const kAPage = await kAContext.newPage();
  const kBPage = await kBContext.newPage();
  const noWritePage = await noWriteContext.newPage();
  for (const page of [cPage, kAPage, kBPage, noWritePage]) {
    page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
    page.on("response", (response) => {
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith("/api/admin/") && response.status() >= 500
          && response.headers()["x-nexion-upstream-outcome"] !== "unknown") {
        runtimeErrors.push(`unexpected-${response.status()}:${pathname}`);
      }
    });
  }

  try {
    await login(cPage, cFixture.accounts.maker);
    await login(kAPage, kFixture.accounts.maker);
    await login(kBPage, kFixture.checker);
    await login(noWritePage, cFixture.accounts.nowrite);
    expect(await roleCode(cPage)).toBe("ACC_C_MK_114336");
    expect(await roleCode(kAPage)).toBe("ACC_K_MK_114336");
    expect(await roleCode(kBPage)).toBe("ACC_C5K5_RV_114336");

    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    expect((await anonymous.request.get("/api/admin/users/security/overview")).status()).toBe(401);

    const noWrite = await json(await noWritePage.request.post(
      `/api/admin/users/profiles/${USER_ID}/security/kyc-reverification`,
      {
        headers: keyed(`${RUN}-NOWRITE`),
        data: { action: "PASSWORD_RESET", reason: `${RUN} no-write permission probe` },
      },
    ));
    expect(noWrite.status).toBe(403);

    await openC5(cPage);
    await selectUser(cPage);
    const before = await securityOverview(cPage);
    expect(securityProjection(before).passwordResetRequired).toBe(false);
    expect(Number(findKey(before, "selectedActiveSessionCount"))).toBe(1);

    const missingKey = await json(await cPage.request.post(
      `/api/admin/users/profiles/${USER_ID}/security/kyc-reverification`,
      { data: { action: "PASSWORD_RESET", reason: `${RUN} missing key fail closed` } },
    ));
    expect(missingKey.status).toBe(422);

    const requestButton = cPage.getByRole("button", { name: "密码重置（实名二验）", exact: true });
    await requestButton.click();
    const requestDialog = cPage.getByRole("dialog");
    await expect(requestDialog).toContainText("当前操作只创建复审任务，不会改变用户安全状态");
    const requestReason = `${RUN} request K5 identity review`;
    await requestDialog.getByLabel(/操作理由/).fill(requestReason);
    const requestResponsePromise = cPage.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/admin/users/profiles/${USER_ID}/security/kyc-reverification`
      && response.request().method() === "POST");
    await requestDialog.getByRole("button", { name: "提交复审申请", exact: true }).click();
    const requestResponse = await requestResponsePromise;
    expect(requestResponse.status(), await requestResponse.text()).toBe(200);
    const requestResult = await json(requestResponse);
    const ticketId = String(findKey(requestResult.body, "ticketId") ?? "");
    const requestKey = requestResponse.request().headers()["idempotency-key"] || "";
    const requestBody = requestResponse.request().postDataJSON() as Json;
    expect(ticketId).toMatch(/^KR-C5-/);
    expect(requestKey).toBeTruthy();

    const requestReplay = await json(await cPage.request.post(
      `/api/admin/users/profiles/${USER_ID}/security/kyc-reverification`,
      { headers: keyed(requestKey), data: requestBody },
    ));
    expect(requestReplay.status).toBe(200);
    expect(requestReplay.body).toEqual(requestResult.body);
    const requestMismatch = await json(await cPage.request.post(
      `/api/admin/users/profiles/${USER_ID}/security/kyc-reverification`,
      { headers: keyed(requestKey), data: { ...requestBody, reason: `${requestReason} mismatch` } },
    ));
    expect(requestMismatch.status).toBe(409);

    const prematureKey = `${RUN}-PREMATURE`;
    const premature = await json(await cPage.request.post(
      `/api/admin/users/profiles/${USER_ID}/security/password-reset`,
      {
        headers: keyed(prematureKey),
        data: {
          reason: `${RUN} before K5 pass must fail closed`,
          kycVerificationChannel: "K5_INDEPENDENT_REVIEW",
          kycVerificationTicket: ticketId,
          kycVerifiedAt: new Date().toISOString(),
          identityConfirmed: true,
          lockKind: null,
        },
      },
    ));
    expect(premature.status).toBe(422);
    expect(premature.body?.message).toBe("KYC_REVERIFY_REQUIRED");
    expect(securityProjection(await securityOverview(cPage)).passwordResetRequired).toBe(false);

    const ticket = await ticketById(kAPage, ticketId);
    expect(ticket.user).toBe(USER_NO);
    expect(ticket.st).toBe("in-review");
    const stale = await decide(
      kAPage,
      ticket,
      ticket.version + 99,
      `${RUN} stale K5 CAS`,
      `${RUN}-K5-STALE`,
    );
    expect(stale.status()).toBe(409);

    const decisionBody = {
      decision: "passed",
      expectedVersion: ticket.version,
      reason: `${RUN} two-operator K5 pass CAS`,
    };
    const keys = [`${RUN}-K5-A`, `${RUN}-K5-B`];
    const [decisionA, decisionB] = await Promise.all([
      kAPage.request.post(`/api/admin/risk/kyc-review/tickets/${ticketId}/decision`, {
        headers: keyed(keys[0]), data: decisionBody,
      }),
      kBPage.request.post(`/api/admin/risk/kyc-review/tickets/${ticketId}/decision`, {
        headers: keyed(keys[1]), data: decisionBody,
      }),
    ]);
    expect([decisionA.status(), decisionB.status()].sort()).toEqual([200, 409]);
    const winner = decisionA.status() === 200
      ? { page: kAPage, key: keys[0], response: decisionA }
      : { page: kBPage, key: keys[1], response: decisionB };
    const winningBody = await json(winner.response);
    const decisionReplay = await json(await winner.page.request.post(
      `/api/admin/risk/kyc-review/tickets/${ticketId}/decision`,
      { headers: keyed(winner.key), data: decisionBody },
    ));
    expect(decisionReplay.status).toBe(200);
    expect(decisionReplay.body).toEqual(winningBody.body);
    const decisionMismatch = await json(await winner.page.request.post(
      `/api/admin/risk/kyc-review/tickets/${ticketId}/decision`,
      { headers: keyed(winner.key), data: { ...decisionBody, reason: `${decisionBody.reason} mismatch` } },
    ));
    expect(decisionMismatch.status).toBe(409);
    expect((await ticketById(kAPage, ticketId)).st).toBe("passed");

    await cPage.reload({ waitUntil: "domcontentloaded" });
    await selectUser(cPage);
    await cPage.getByRole("button", { name: "密码重置（实名二验）", exact: true }).click();
    const actionDialog = cPage.getByRole("dialog");
    await expect(actionDialog.locator('[data-proof="server-kyc-verification"]')).toContainText(ticketId);
    await actionDialog.locator('[data-proof="identity-ack"]').check();
    const resetReason = `${RUN} execute password reset after K5 pass`;
    await actionDialog.getByLabel(/操作理由/).fill(resetReason);

    const commandKeys: string[] = [];
    const commandBodies: Json[] = [];
    let attempts = 0;
    const resetPath = `/api/admin/users/profiles/${USER_ID}/security/password-reset`;
    await cPage.route(`**${resetPath}`, async (route) => {
      attempts += 1;
      commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
      commandBodies.push(route.request().postDataJSON() as Json);
      if (attempts === 1) {
        const upstream = await route.fetch();
        expect(upstream.status(), await upstream.text()).toBe(200);
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
    await actionDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(actionDialog).toBeVisible();
    await expect(cPage.getByText("本次操作结果未知", { exact: false }).first()).toBeVisible();
    await expect(cPage.getByText(commandKeys[0], { exact: false }).first()).toBeVisible();
    await actionDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(actionDialog).toHaveCount(0);
    await cPage.unroute(`**${resetPath}`);
    expect(commandKeys).toHaveLength(2);
    expect(commandKeys[0]).toBeTruthy();
    expect(commandKeys[1]).toBe(commandKeys[0]);
    expect(commandBodies[1]).toEqual(commandBodies[0]);

    const resetReplay = await json(await cPage.request.post(
      resetPath,
      { headers: keyed(commandKeys[0]), data: commandBodies[0] },
    ));
    expect(resetReplay.status).toBe(200);
    const resetMismatch = await json(await cPage.request.post(
      resetPath,
      { headers: keyed(commandKeys[0]), data: { ...commandBodies[0], reason: `${resetReason} mismatch` } },
    ));
    expect(resetMismatch.status).toBe(409);

    const after = await securityOverview(cPage);
    expect(securityProjection(after).passwordResetRequired).toBe(true);
    expect(Number(findKey(after, "selectedActiveSessionCount"))).toBe(0);
    const audit = await json(await cPage.request.get(
      `/api/admin/platform/audit/logs?action=C5_PASSWORD_RESET_REQUESTED&userId=${USER_ID}&limit=200`,
    ));
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body?.data)).toContain(USER_ID);
    expect((await cPage.request.get("/api/admin/platform/events/overview")).status()).toBe(403);

    await cPage.reload({ waitUntil: "domcontentloaded" });
    await selectUser(cPage);
    await expect(cPage.getByText(/密码重置.*等待用户/)).toBeVisible();
    await logout(cPage);
    await waitForNextTotpWindow();
    await login(cPage, cFixture.accounts.maker);
    await openC5(cPage);
    await selectUser(cPage);
    await expect(cPage.getByText(/密码重置.*等待用户/)).toBeVisible();

    await cPage.screenshot({ path: path.join(EVIDENCE_DIR, "c5-final-relogin.png"), fullPage: true });
    writeFileSync(path.join(EVIDENCE_DIR, "c5-owner-lifecycle.json"), JSON.stringify({
      run: RUN,
      userId: USER_ID,
      userNo: USER_NO,
      request: {
        ticketId,
        key: requestKey,
        replay: requestReplay.status,
        mismatch: requestMismatch.status,
        premature: premature.status,
      },
      k5: {
        stale: stale.status(),
        concurrent: [decisionA.status(), decisionB.status()],
        winner: winner.page === kAPage ? kFixture.accounts.maker.username : kFixture.checker.username,
        replay: decisionReplay.status,
        mismatch: decisionMismatch.status,
        final: "passed",
      },
      passwordReset: {
        attempts,
        sameKey: commandKeys[0] === commandKeys[1],
        replay: resetReplay.status,
        mismatch: resetMismatch.status,
        passwordResetRequired: securityProjection(after).passwordResetRequired,
        activeSessions: Number(findKey(after, "selectedActiveSessionCount")),
      },
      permissions: { nowrite: noWrite.status, anonymous: 401 },
      audit: audit.status,
      runtimeErrors,
    }, null, 2));
    expect(runtimeErrors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
  }
});

async function openC5(page: Page) {
  const link = page.locator('aside a[href="/users/security"]').first();
  if (!(await link.isVisible({ timeout: 1_000 }).catch(() => false))) {
    const group = page.getByRole("button", { name: /用户与账户.*C/ }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/users\/security/);
  await expect(page.getByRole("heading", { name: "安全 & 会话", exact: true })).toBeVisible();
}

async function selectUser(page: Page) {
  const lookup = page.getByPlaceholder("搜索用户编码 / 用户名 / 推荐码 / 手机号");
  await lookup.fill(USER_NO);
  const option = page.locator("button").filter({ hasText: USER_NO }).last();
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByText(/2FA 状态/)).toBeVisible();
}

async function securityOverview(page: Page) {
  const response = await json(await page.request.get(
    `/api/admin/users/security/overview?userKey=${USER_NO}&pageNum=1&pageSize=10`,
  ));
  expect(response.status).toBe(200);
  expect(response.body?.code).toBe(0);
  return response.body?.data as Json;
}

function securityProjection(data: Json) {
  const selected = (data?.selectedUser ?? {}) as Json;
  return {
    userId: String(selected.userId ?? selected.id ?? ""),
    passwordResetRequired: Boolean(selected.passwordResetRequired),
    twoFactorEnabled: Boolean(selected.twoFactorEnabled),
    loginFailCount: Number(selected.loginFailCount ?? 0),
  };
}

async function ticketById(page: Page, ticketId: string) {
  const response = await json(await page.request.get(
    "/api/admin/risk/kyc-review/overview?ticketPageNum=1&ticketPageSize=50",
  ));
  expect(response.status).toBe(200);
  const ticket = (response.body?.data as K5Overview).tickets.records.find((row) => row.id === ticketId);
  expect(ticket, `K5 ticket ${ticketId}`).toBeTruthy();
  return ticket!;
}

function decide(page: Page, ticket: Ticket, expectedVersion: number, reason: string, key: string) {
  return page.request.post(`/api/admin/risk/kyc-review/tickets/${ticket.id}/decision`, {
    headers: keyed(key),
    data: { decision: "passed", expectedVersion, reason },
  });
}

async function roleCode(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const body = await response.json();
  return String(body.data?.session?.roleCode ?? "");
}

async function logout(page: Page) {
  expect((await page.request.post("/api/admin/auth/logout")).status()).toBe(200);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function login(page: Page, account: Account) {
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
    const verify = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verify).status()).toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function json(response: APIResponse | import("@playwright/test").Response) {
  const raw = await response.text();
  let body: Json | null = null;
  try {
    body = JSON.parse(raw) as Json;
  } catch {
    body = { raw };
  }
  return { status: response.status(), body };
}

function keyed(key: string) {
  return { "Content-Type": "application/json", "Idempotency-Key": key };
}

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
    return (value as Record<string, unknown>)[key];
  }
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
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
