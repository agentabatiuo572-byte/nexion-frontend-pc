import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const USER_ID = process.env.C_NONOWNER_USER_ID || "990000151023";
const USER_NO = process.env.C_NONOWNER_USER_NO || "U990000151023";
const EVIDENCE_DIR = process.env.C_NONOWNER_EVIDENCE_DIR;
const A_PERMISSION_FIXTURE = process.env.A_PERMISSION_FIXTURE_PATH;

test.describe.serial("C 域非 Owner B：用户资产锁轨", () => {
  test.beforeAll(() => {
    if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("C2 从可见侧栏执行 ACTIVE→FROZEN→ACTIVE，刷新后 C5/C2/A2/A4 事实一致", async ({ page }) => {
    const runtime = monitorRuntime(page);
    await login(page);
    await openVisibleModule(page, "/users/actions", "/api/admin/users/account-actions/overview");

    const before = await browserApi(page, "GET", `/api/admin/users/account-actions/accounts/${USER_NO}`);
    expect(before.status).toBe(200);
    expect(readStatus(before.data)).toBe("ACTIVE");

    let frozen = false;
    try {
      await page.goto(`/users/actions?userCode=${encodeURIComponent(USER_NO)}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByText(/已按服务器查询结果打开该用户的 C2 处置上下文/)).toBeVisible();
      const detail = page.getByRole("dialog").filter({ hasText: `账户明细 · ${USER_NO}` });
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "关闭", exact: true }).click();

      const row = page.locator("tbody tr").filter({ hasText: USER_NO }).first();
      await expect(row).toBeVisible();
      await row.getByRole("button", { name: "冻结", exact: true }).click();
      const freezeDialog = page.getByRole("dialog");
      await freezeDialog.getByLabel(/操作理由/).fill("C 域非Owner复审隔离账户冻结验证");
      const freezeResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/admin/users/profiles/${USER_ID}/status`
        && response.request().method() === "PATCH");
      await freezeDialog.getByRole("button", { name: "确认提交", exact: true }).click();
      expect((await freezeResponse).status()).toBe(200);
      frozen = true;

      await expect(row.getByRole("button", { name: "恢复", exact: true })).toBeVisible();
      const frozenRead = await browserApi(page, "GET", `/api/admin/users/account-actions/accounts/${USER_NO}`);
      expect(readStatus(frozenRead.data)).toBe("FROZEN");

      await row.getByRole("button", { name: "恢复", exact: true }).click();
      const restoreDialog = page.getByRole("dialog");
      await restoreDialog.getByLabel(/操作理由/).fill("C 域非Owner复审隔离账户精确恢复");
      const restoreResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/admin/users/profiles/${USER_ID}/status`
        && response.request().method() === "PATCH");
      await restoreDialog.getByRole("button", { name: "确认提交", exact: true }).click();
      expect((await restoreResponse).status()).toBe(200);
      frozen = false;
      await expect(row.getByRole("button", { name: "冻结", exact: true })).toBeVisible();

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(/已按服务器查询结果打开该用户的 C2 处置上下文/)).toBeVisible();
      const after = await browserApi(page, "GET", `/api/admin/users/account-actions/accounts/${USER_NO}`);
      expect(readStatus(after.data)).toBe("ACTIVE");

      const c5 = await browserApi(page, "GET", `/api/admin/users/security/overview?userKey=${USER_NO}&pageNum=1&pageSize=20`);
      expect(c5.status).toBe(200);
      expect(JSON.stringify(c5.data)).toContain(USER_NO);
      const c5Active = Number(findKey(c5.data, "selectedActiveSessionCount") ?? 0);
      expect(c5Active).toBe(0);

      const audit = await browserApi(page, "GET", `/api/admin/platform/audit/logs?keyword=${USER_NO}&limit=200`);
      const events = await browserApi(page, "GET", "/api/admin/platform/events/overview");
      expect(audit.status).toBe(200);
      expect(events.status).toBe(200);
      expect(runtime.pageErrors).toEqual([]);
      expect(runtime.admin5xx).toEqual([]);

      if (EVIDENCE_DIR) {
        await page.screenshot({ path: path.join(EVIDENCE_DIR, "c2-freeze-restore-final.png"), fullPage: true });
        writeFileSync(path.join(EVIDENCE_DIR, "c2-user-lock.json"), JSON.stringify({
          userNo: USER_NO,
          before: "ACTIVE",
          transition: ["FROZEN", "ACTIVE"],
          final: readStatus(after.data),
          c5ActiveSessions: c5Active,
          a2: audit.status,
          a4: events.status,
          pageErrors: runtime.pageErrors,
          admin5xx: runtime.admin5xx,
        }, null, 2));
      }
    } finally {
      if (frozen) {
        const cleanup = await browserApi(
          page,
          "PATCH",
          `/api/admin/users/profiles/${USER_ID}/status`,
          {
            status: "ACTIVE",
            reasonCode: "ACCEPTANCE_RESTORE",
            reason: "C 域非Owner复审 finally 精确恢复",
            operator: "superadmin",
          },
        );
        expect(cleanup.status, "C2 中断后必须恢复隔离账号").toBe(200);
      }
      const finalRead = await browserApi(page, "GET", `/api/admin/users/account-actions/accounts/${USER_NO}`);
      expect(readStatus(finalRead.data)).toBe("ACTIVE");
    }
  });

  test("C2 双运营员服务端 CAS、同键回放、异载荷拒绝并精确恢复", async ({ browser }) => {
    if (!A_PERMISSION_FIXTURE) throw new Error("A_PERMISSION_FIXTURE_PATH is required");
    const fixture = JSON.parse(readFileSync(A_PERMISSION_FIXTURE, "utf8")) as {
      accounts: {
        d_checker: {
          username: string;
          password: string;
          totpSecret: string;
        };
      };
    };
    const checkerAccount = fixture.accounts.d_checker;
    const makerContext = await browser.newContext();
    const checkerContext = await browser.newContext();
    const maker = await makerContext.newPage();
    const checker = await checkerContext.newPage();
    const execution = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const keys = {
      maker: `c2-cas-maker-${execution}`,
      checker: `c2-cas-checker-${execution}`,
      restore: `c2-cas-restore-${execution}`,
      emergencyRestore: `c2-cas-finally-${execution}`,
    };
    let finalStatus = "";
    try {
      await Promise.all([
        login(maker),
        loginAccount(checker, checkerAccount),
      ]);
      await Promise.all([
        openVisibleModule(maker, "/users/actions", "/api/admin/users/account-actions/overview"),
        openVisibleModule(checker, "/users/actions", "/api/admin/users/account-actions/overview"),
      ]);

      const before = await requestEvidence(
        await maker.request.get(`/api/admin/users/account-actions/accounts/${USER_NO}`),
      );
      expect(before.status).toBe(200);
      expect(readStatus(before.body?.data)).toBe("ACTIVE");

      const makerBody = {
        status: "FROZEN",
        reasonCode: "RISK_HIT",
        reason: "C2 双运营员 CAS maker 冻结验证",
        operator: USERNAME,
      };
      const checkerBody = {
        status: "FROZEN",
        reasonCode: "RISK_HIT",
        reason: "C2 双运营员 CAS checker 竞争验证",
        operator: checkerAccount.username,
      };
      const [makerResult, checkerResult] = await Promise.all([
        requestEvidence(await maker.request.patch(
          `/api/admin/users/profiles/${USER_ID}/status`,
          { headers: keyed(keys.maker), data: makerBody },
        )),
        requestEvidence(await checker.request.patch(
          `/api/admin/users/profiles/${USER_ID}/status`,
          { headers: keyed(keys.checker), data: checkerBody },
        )),
      ]);
      expect([makerResult.status, checkerResult.status].sort()).toEqual([200, 409]);
      const winner = makerResult.status === 200
        ? { page: maker, key: keys.maker, body: makerBody, result: makerResult, actor: USERNAME }
        : { page: checker, key: keys.checker, body: checkerBody, result: checkerResult, actor: checkerAccount.username };
      const loser = makerResult.status === 409 ? makerResult : checkerResult;
      expect([
        "C2_STATUS_CONCURRENTLY_CHANGED",
        "C2_STATUS_TRANSITION_NOT_ALLOWED",
      ]).toContain(loser.body?.message);

      const replay = await requestEvidence(await winner.page.request.patch(
        `/api/admin/users/profiles/${USER_ID}/status`,
        { headers: keyed(winner.key), data: winner.body },
      ));
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(winner.result.body);

      const mismatch = await requestEvidence(await winner.page.request.patch(
        `/api/admin/users/profiles/${USER_ID}/status`,
        {
          headers: keyed(winner.key),
          data: { ...winner.body, reason: `${winner.body.reason} 异载荷` },
        },
      ));
      expect(mismatch.status).toBe(409);
      expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

      const frozen = await requestEvidence(
        await maker.request.get(`/api/admin/users/account-actions/accounts/${USER_NO}`),
      );
      expect(readStatus(frozen.body?.data)).toBe("FROZEN");

      const restore = await requestEvidence(await maker.request.patch(
        `/api/admin/users/profiles/${USER_ID}/status`,
        {
          headers: keyed(keys.restore),
          data: {
            status: "ACTIVE",
            reasonCode: "ACCEPTANCE_RESTORE",
            reason: "C2 双运营员 CAS 验收精确恢复",
            operator: USERNAME,
          },
        },
      ));
      expect(restore.status).toBe(200);
      finalStatus = readStatus(restore.body?.data);
      expect(finalStatus).toBe("ACTIVE");

      if (EVIDENCE_DIR) {
        writeFileSync(path.join(EVIDENCE_DIR, "c2-idempotency-cas-two-operators.json"), JSON.stringify({
          target: USER_NO,
          before: "ACTIVE",
          concurrent: { maker: makerResult, checker: checkerResult, winnerActor: winner.actor },
          replay,
          mismatch,
          restore,
          finalStatus,
          keys,
        }, null, 2));
      }
    } finally {
      const current = await requestEvidence(
        await maker.request.get(`/api/admin/users/account-actions/accounts/${USER_NO}`),
      ).catch(() => ({ status: 0, body: null }));
      if (readStatus(current.body?.data) === "FROZEN") {
        const emergencyRestore = await requestEvidence(await maker.request.patch(
          `/api/admin/users/profiles/${USER_ID}/status`,
          {
            headers: keyed(keys.emergencyRestore),
            data: {
              status: "ACTIVE",
              reasonCode: "ACCEPTANCE_RESTORE",
              reason: "C2 双运营员 CAS finally 精确恢复",
              operator: USERNAME,
            },
          },
        ));
        expect(emergencyRestore.status, "C2 CAS 中断后必须恢复隔离账号").toBe(200);
      }
      await Promise.all([makerContext.close(), checkerContext.close()]);
    }
  });

  test("C5 畸形 200、503 与超时均清空权威快照并禁用写入口，真实响应恢复", async ({ page }) => {
    await login(page);
    const runtime = monitorRuntime(page);

    for (const fault of ["malformed", "500", "timeout"] as const) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.locator("aside")).toBeVisible();
      await page.route("**/api/admin/users/security/overview*", async (route) => {
        if (fault === "timeout") {
          await route.abort("timedout");
          return;
        }
        await route.fulfill({
          status: fault === "500" ? 503 : 200,
          contentType: "application/json",
          body: JSON.stringify(fault === "500"
            ? { code: 503, message: "C5_ACCEPTANCE_INJECTED_FAILURE", data: null }
            : { code: 0, message: "OK", data: { malformed: true } }),
        });
      });
      await openVisibleModule(page, "/users/security");
      await expect(page.getByText(/C5 数据加载失败/).first()).toBeVisible();
      for (const name of ["全部踢线", "关闭 2FA（高风险确认）", "密码重置（高风险确认）"]) {
        await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
      }
      await page.unroute("**/api/admin/users/security/overview*");
      const recovery = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/admin/users/security/overview"
        && response.request().method() === "GET");
      await page.getByRole("button", { name: /重新加载|重试/, exact: true }).first().click();
      expect((await recovery).status()).toBe(200);
      await expect(page.getByText(/C5 数据加载失败/)).toHaveCount(0);
    }

    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.unexpectedConsoleErrors).toEqual([]);
    if (EVIDENCE_DIR) {
      writeFileSync(path.join(EVIDENCE_DIR, "c5-fail-closed.json"), JSON.stringify({
        faults: ["malformed-200", "503", "timeout"],
        recovery: "PASS",
        pageErrors: runtime.pageErrors,
        unexpectedConsoleErrors: runtime.unexpectedConsoleErrors,
      }, null, 2));
    }
  });
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  if (await shell.isVisible({ timeout: 3_000 }).catch(() => false)) return;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === "/api/admin/auth/login"
    && candidate.request().method() === "POST");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toBeVisible({ timeout: 20_000 });
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

async function openVisibleModule(page: Page, modulePath: string, responsePath?: string) {
  const link = page.locator(`aside a[href="${modulePath}"]`).first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const group = page.locator("aside button").filter({ hasText: /用户与账户/ }).first();
    if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) await group.click();
  }
  await expect(link).toBeVisible();
  const response = responsePath
    ? page.waitForResponse((candidate) =>
        new URL(candidate.url()).pathname === responsePath
        && candidate.request().method() === "GET")
    : undefined;
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(modulePath)}(?:\\?.*)?$`));
  if (response) expect((await response).status()).toBe(200);
}

async function browserApi(
  page: Page,
  method: "GET" | "PATCH" | "POST",
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET"
        ? undefined
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": `c-nonowner-b-${crypto.randomUUID()}`,
          },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { code?: number; data?: unknown } | null;
    return { status: response.status, code: payload?.code, data: payload?.data };
  }, { requestMethod: method, apiPath: requestPath, requestBody: body });
}

function readStatus(value: unknown) {
  return String(findKey(value, "status") ?? "").toUpperCase();
}

function keyed(idempotencyKey: string) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

async function requestEvidence(response: import("@playwright/test").APIResponse) {
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
  const millisecondsRemaining = 30_000 - (Date.now() % 30_000);
  await new Promise((resolve) => setTimeout(resolve, millisecondsRemaining + 250));
  return currentTotp(secret);
}

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
    return (value as Record<string, unknown>)[key];
  }
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function monitorRuntime(page: Page) {
  const pageErrors: string[] = [];
  const admin5xx: string[] = [];
  const unexpectedConsoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/admin/") && response.status() >= 500) {
      admin5xx.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource.*(?:500|503)|net::ERR_(?:FAILED|TIMED_OUT)/i.test(text)) return;
    unexpectedConsoleErrors.push(text);
  });
  return { pageErrors, admin5xx, unexpectedConsoleErrors };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
