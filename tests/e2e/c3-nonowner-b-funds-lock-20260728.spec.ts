import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const USER_ID = process.env.C_NONOWNER_USER_ID || "990000151023";
const USER_NO = process.env.C_NONOWNER_USER_NO || "U990000151023";
const EVIDENCE_DIR = process.env.C_NONOWNER_EVIDENCE_DIR;
const A_PERMISSION_FIXTURE = process.env.A_PERMISSION_FIXTURE_PATH;

test("C3 真实扣减/冲正、同键异载荷、双运营员并发及 D4/A2/A4 闭环", async ({ browser }) => {
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
  const reverseKeys = {
    maker: `c3-nonowner-b-reverse-maker-${execution}`,
    checker: `c3-nonowner-b-reverse-checker-${execution}`,
    distinct: `c3-nonowner-b-reverse-distinct-${execution}`,
    emergency: `c3-nonowner-b-reverse-finally-${execution}`,
  };
  let createKey = "";
  let createBody: Record<string, unknown> | null = null;
  let adjustmentNo = "";
  let reversalNo = "";
  let restored = false;
  let evidence: Record<string, unknown> = {};

  try {
    await Promise.all([login(maker), loginAccount(checker, checkerAccount)]);
    await Promise.all([
      openVisibleModule(maker, "/users/assets", "/api/admin/users/asset-adjustments/overview"),
      openVisibleModule(checker, "/users/assets", "/api/admin/users/asset-adjustments/overview"),
    ]);

    const before = await requestEvidence(
      await maker.request.get(`/api/admin/users/profiles/${USER_ID}/asset-adjustment-context`),
    );
    expect(before.status).toBe(200);
    const baselineUsdt = Number(findKey(before.body?.data, "walletUsdt"));
    expect(baselineUsdt).toBe(100);

    const search = maker.getByPlaceholder("搜索用户编码 / 用户名 / 手机号");
    await search.fill(USER_NO);
    const option = maker.getByRole("listbox").getByRole("button").filter({ hasText: USER_NO }).first();
    await expect(option).toBeVisible();
    const contextResponse = maker.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/admin/users/profiles/${USER_ID}/asset-adjustment-context`
      && response.request().method() === "GET");
    await option.click();
    expect((await contextResponse).status()).toBe(200);
    await expect(maker.locator('[data-proof="c3-target-card"]')).toContainText(USER_NO);

    await maker.getByRole("button", { name: "扣减", exact: true }).click();
    await maker.getByLabel("调整金额").fill("0.01");
    await maker.getByRole("button", { name: "系统纠错", exact: true }).click();
    await maker.getByLabel("详细原因").fill("C3 非Owner真实扣减并发冲正验收");
    await maker.getByLabel("证据引用").fill(`ACCEPT-C3-${execution}`);

    const createResponsePromise = maker.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/admin/users/profiles/${USER_ID}/asset-adjustments`
      && response.request().method() === "POST");
    await maker.getByRole("button", { name: "确认并立即调整", exact: true }).click();
    const confirm = maker.getByRole("dialog");
    await expect(confirm).toContainText("确认扣减");
    await confirm.getByRole("button", { name: "确认并执行", exact: true }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(200);
    createKey = createResponse.request().headers()["idempotency-key"] || "";
    createBody = createResponse.request().postDataJSON() as Record<string, unknown>;
    const created = await requestEvidence(createResponse);
    adjustmentNo = String(findKey(created.body?.data, "adjustmentNo") ?? "");
    expect(createKey).toMatch(/^c3-adjust-/);
    expect(adjustmentNo).not.toBe("");
    expect(Number(findKey(created.body?.data, "balanceAfter"))).toBe(99.99);

    const replay = await requestEvidence(await maker.request.post(
      `/api/admin/users/profiles/${USER_ID}/asset-adjustments`,
      { headers: keyed(createKey), data: createBody },
    ));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(created.body);

    const mismatch = await requestEvidence(await maker.request.post(
      `/api/admin/users/profiles/${USER_ID}/asset-adjustments`,
      {
        headers: keyed(createKey),
        data: { ...createBody, reason: `${String(createBody.reason)} 异载荷` },
      },
    ));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

    await checker.reload({ waitUntil: "domcontentloaded" });
    await expect(checker.locator("tbody tr").filter({ hasText: adjustmentNo }).first()).toBeVisible();

    const makerReverseBody = {
      reason: "C3 双运营员并发冲正 maker 验收",
      operator: USERNAME,
    };
    const checkerReverseBody = {
      reason: "C3 双运营员并发冲正 checker 验收",
      operator: checkerAccount.username,
    };
    const [makerReverse, checkerReverse] = await Promise.all([
      requestEvidence(await maker.request.post(
        `/api/admin/users/asset-adjustments/${adjustmentNo}/reverse`,
        { headers: keyed(reverseKeys.maker), data: makerReverseBody },
      )),
      requestEvidence(await checker.request.post(
        `/api/admin/users/asset-adjustments/${adjustmentNo}/reverse`,
        { headers: keyed(reverseKeys.checker), data: checkerReverseBody },
      )),
    ]);
    expect([makerReverse.status, checkerReverse.status].sort()).toEqual([200, 409]);
    const winner = makerReverse.status === 200
      ? { page: maker, key: reverseKeys.maker, body: makerReverseBody, result: makerReverse }
      : { page: checker, key: reverseKeys.checker, body: checkerReverseBody, result: checkerReverse };
    const loser = makerReverse.status === 409 ? makerReverse : checkerReverse;
    expect(["C3_ALREADY_REVERSED", "C3_ONLY_ORIGINAL_APPROVED_ADJUSTMENT_REVERSIBLE"])
      .toContain(loser.body?.message);
    reversalNo = String(findKey(winner.result.body?.data, "adjustmentNo") ?? "");
    expect(reversalNo).not.toBe("");
    restored = true;

    const reverseReplay = await requestEvidence(await winner.page.request.post(
      `/api/admin/users/asset-adjustments/${adjustmentNo}/reverse`,
      { headers: keyed(winner.key), data: winner.body },
    ));
    expect(reverseReplay.status).toBe(200);
    expect(reverseReplay.body).toEqual(winner.result.body);

    const reverseMismatch = await requestEvidence(await winner.page.request.post(
      `/api/admin/users/asset-adjustments/${adjustmentNo}/reverse`,
      {
        headers: keyed(winner.key),
        data: { ...winner.body, reason: `${winner.body.reason} 异载荷` },
      },
    ));
    expect(reverseMismatch.status).toBe(409);
    expect(reverseMismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

    const distinctReplay = await requestEvidence(await maker.request.post(
      `/api/admin/users/asset-adjustments/${adjustmentNo}/reverse`,
      {
        headers: keyed(reverseKeys.distinct),
        data: { reason: "C3 已冲正后新命令键必须拒绝", operator: USERNAME },
      },
    ));
    expect(distinctReplay.status).toBe(409);
    expect(distinctReplay.body?.message).toBe("C3_ALREADY_REVERSED");

    const after = await requestEvidence(
      await maker.request.get(`/api/admin/users/profiles/${USER_ID}/asset-adjustment-context`),
    );
    expect(after.status).toBe(200);
    expect(Number(findKey(after.body?.data, "walletUsdt"))).toBe(baselineUsdt);

    await maker.reload({ waitUntil: "domcontentloaded" });
    const originalCell = maker.getByRole("cell", {
      name: new RegExp(`^${escapeRegExp(adjustmentNo)}\\b`),
    }).first();
    const originalRow = originalCell.locator("..");
    await expect(originalRow).toBeVisible();
    const d4Link = originalRow.locator(`a[href^="/finance/ledger?bizNo="]`);
    await expect(d4Link).toBeVisible();
    const d4Response = maker.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/bills"
      && response.request().method() === "GET");
    await d4Link.click();
    await expect(maker).toHaveURL(/\/finance\/ledger\?bizNo=/);
    expect((await d4Response).status()).toBe(200);
    await expect(maker.getByText(adjustmentNo, { exact: false }).first()).toBeVisible();

    const audit = await requestEvidence(
      await maker.request.get(`/api/admin/platform/audit/logs?keyword=${encodeURIComponent(adjustmentNo)}&limit=200`),
    );
    const events = await requestEvidence(await maker.request.get("/api/admin/platform/events/overview"));
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toContain(adjustmentNo);
    expect(events.status).toBe(200);

    expect(makerRuntime.pageErrors).toEqual([]);
    expect(checkerRuntime.pageErrors).toEqual([]);
    expect(makerRuntime.admin5xx).toEqual([]);
    expect(checkerRuntime.admin5xx).toEqual([]);

    evidence = {
      execution,
      target: USER_NO,
      baselineUsdt,
      createKey,
      createBody,
      created,
      replay,
      mismatch,
      concurrentReverse: { maker: makerReverse, checker: checkerReverse },
      reverseReplay,
      reverseMismatch,
      distinctReplay,
      adjustmentNo,
      reversalNo,
      finalUsdt: Number(findKey(after.body?.data, "walletUsdt")),
      d4: 200,
      a2: audit.status,
      a4: events.status,
      runtime: { maker: makerRuntime, checker: checkerRuntime },
      reverseKeys,
    };
    if (EVIDENCE_DIR) {
      writeFileSync(path.join(EVIDENCE_DIR, "c3-funds-lock.json"), JSON.stringify(evidence, null, 2));
      await maker.screenshot({ path: path.join(EVIDENCE_DIR, "c3-d4-final.png"), fullPage: true });
    }
  } finally {
    if (adjustmentNo && !restored) {
      const emergency = await requestEvidence(await maker.request.post(
        `/api/admin/users/asset-adjustments/${adjustmentNo}/reverse`,
        {
          headers: keyed(reverseKeys.emergency),
          data: { reason: "C3 非Owner验收 finally 精确恢复余额", operator: USERNAME },
        },
      )).catch(() => ({ status: 0, body: null }));
      expect([200, 409]).toContain(emergency.status);
    }
    const finalRead = await requestEvidence(
      await maker.request.get(`/api/admin/users/profiles/${USER_ID}/asset-adjustment-context`),
    ).catch(() => ({ status: 0, body: null }));
    expect(Number(findKey(finalRead.body?.data, "walletUsdt")), "C3 验收必须恢复隔离账户 USDT 余额").toBe(100);
    await Promise.all([makerContext.close(), checkerContext.close()]);
  }
});

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

async function openVisibleModule(page: Page, modulePath: string, responsePath: string) {
  const link = page.locator(`aside a[href="${modulePath}"]`).first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const group = page.locator("aside button").filter({ hasText: /用户与账户/ }).first();
    if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) await group.click();
  }
  await expect(link).toBeVisible();
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === responsePath
    && candidate.request().method() === "GET");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(modulePath)}(?:\\?.*)?$`));
  expect((await response).status()).toBe(200);
}

function keyed(idempotencyKey: string) {
  return { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
}

async function requestEvidence(response: APIResponse | Response) {
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
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/admin/") && response.status() >= 500) {
      admin5xx.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  return { pageErrors, admin5xx };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
