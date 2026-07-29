import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type Fixture = { runId: string; accounts: { g_maker: FixtureAccount } };
type Envelope = { code?: number; message?: string; data?: Record<string, any> };

const RUN_ID = "pc-full-acceptance-20260728-151023";
const fixturePath = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/G/permission-fixtures.json`;
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const BACKEND = "http://127.0.0.1:8110";

test.describe.configure({ mode: "serial", timeout: 360_000 });

test("G1/G3/G4/G7 maker 可逆成功写、幂等冲突、CAS、跨域投影与恢复", async ({ page }, testInfo) => {
  const diagnostics = monitorFailures(page);
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    startedAt: new Date().toISOString(),
    modules: {},
  };
  await login(page, fixture.accounts.g_maker);
  const operator = fixture.accounts.g_maker.username;
  const modules = evidence.modules as Record<string, unknown>;

  const genericScenarios = [
    {
      id: "G1",
      href: "/finance-products/staking",
      readPath: "/api/admin/market/staking",
      writePath: "/api/admin/market/staking/pools/usdt30d/params/min",
      method: "PATCH",
      value: (data: Record<string, any>) => data.pools.find((row: any) => row.tierKey === "usdt30d").minStake,
      candidate: (value: string) => decimalDelta(value, 1),
      open: (p: Page) => p.getByRole("button", { name: "调整最小额", exact: true }).first().click(),
      publicPath: "/api/config/staking/pools",
      publicValue: (data: Record<string, any>) => data.pools.find((row: any) => row.tierKey === "usdt30d").minAmountUsdt,
    },
    {
      id: "G4",
      href: "/finance-products/genesis",
      readPath: "/api/admin/market/nex/genesis?page=1&pageSize=10",
      writePath: "/api/admin/market/nex/genesis/params/royalty",
      method: "PATCH",
      value: (data: Record<string, any>) => data.params.find((row: any) => row.key === "royalty").value,
      candidate: (value: string) => decimalDelta(value, 0.01),
      open: async (p: Page) => {
        const row = p.locator(".p-row").filter({ hasText: "二级版税" }).first();
        await row.getByRole("button", { name: "调整", exact: true }).click();
      },
      publicPath: "/api/genesis/state",
      publicValue: (data: Record<string, any>) => data.series.royaltyPct,
    },
    {
      id: "G7",
      href: "/finance-products/repurchase",
      readPath: "/api/admin/market/nex/repurchase",
      writePath: "/api/admin/market/nex/repurchase/config/lockDays",
      method: "PUT",
      value: (data: Record<string, any>) => data.params.find((row: any) => row.key === "lockDays").value,
      candidate: (value: string) => decimalDelta(value, 1),
      open: (p: Page) => p.getByRole("button", { name: "编辑 锁仓期限", exact: true }).click(),
      publicPath: "/api/config/repurchase",
      publicValue: (data: Record<string, any>) => data.lockDays,
    },
  ] as const;

  for (const scenario of genericScenarios) {
    const baseline = await okData(await page.request.get(scenario.readPath));
    const original = String(scenario.value(baseline));
    const candidate = scenario.candidate(original);
    await openFromSidebar(page, scenario.href);
    await scenario.open(page);
    const dialog = page.locator('[role="dialog"]:visible').last();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("目标新值").fill(candidate);
    await dialog.getByLabel(/操作理由/).fill(`${scenario.id} 非Owner真实成功写与幂等闭环 ${RUN_ID}`);

    const requestPromise = page.waitForRequest((request) =>
      new URL(request.url()).pathname === scenario.writePath && request.method() === scenario.method);
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === scenario.writePath && response.request().method() === scenario.method);
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const [writeRequest, writeResponse] = await Promise.all([requestPromise, responsePromise]);
    expect(writeResponse.status(), `${scenario.id} UI write`).toBe(200);
    const writePayload = await jsonEnvelope(writeResponse);
    expect(writePayload.code, `${scenario.id} code`).toBe(0);
    expect(writePayload.data?.serverCanonical, `${scenario.id} canonical write response`).toBe(true);
    expect(writePayload.data?.domain, `${scenario.id} domain`).toBe(scenario.id);
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const commandKey = writeRequest.headers()["idempotency-key"] ?? "";
    const body = writeRequest.postDataJSON() as Record<string, unknown>;
    expect(commandKey, `${scenario.id} command key`).not.toBe("");
    expect(String(body.value), `${scenario.id} submitted value`).toBe(candidate);

    const replay = await raw(page, scenario.method, scenario.writePath, body, commandKey);
    expect(replay.status, `${scenario.id} same-key replay`).toBe(200);
    expect(replay.payload.code).toBe(0);
    expect(replay.payload.data?.serverCanonical).toBe(true);
    const conflict = await raw(page, scenario.method, scenario.writePath, {
      ...body,
      reason: `${String(body.reason)} 异载荷`,
    }, commandKey);
    expect(conflict.status, `${scenario.id} same-key different-payload`).toBe(409);

    expectNumeric(scenario.value(await okData(await page.request.get(scenario.readPath))), candidate, `${scenario.id} admin projection`);
    expectNumeric(
      scenario.publicValue(await publicData(page, scenario.publicPath)),
      candidate,
      `${scenario.id} App/public projection`,
    );

    const restore = await raw(page, scenario.method, scenario.writePath, {
      ...body,
      value: original,
      reason: `${scenario.id} 非Owner终验精确恢复 ${RUN_ID}`,
    }, `${RUN_ID}-${scenario.id.toLowerCase()}-restore-${Date.now()}`);
    expect(restore.status, `${scenario.id} restore`).toBe(200);
    expect(restore.payload.code).toBe(0);
    expect(restore.payload.data?.serverCanonical).toBe(true);
    expectNumeric(scenario.value(await okData(await page.request.get(scenario.readPath))), original, `${scenario.id} restored admin`);
    expectNumeric(
      scenario.publicValue(await publicData(page, scenario.publicPath)),
      original,
      `${scenario.id} restored App/public`,
    );

    modules[scenario.id] = {
      original,
      candidate,
      commandKey,
      uiStatus: writeResponse.status(),
      canonicalWrite: writePayload.data?.serverCanonical,
      receiptId: writePayload.data?.updated?.receiptId ?? null,
      replayStatus: replay.status,
      differentPayloadStatus: conflict.status,
      restoreStatus: restore.status,
      restored: true,
    };
  }

  modules.G3 = await exerciseG3(page, operator);

  await logout(page);
  await loginSuperadmin(page);
  const a2 = await okData(await page.request.get(`/api/admin/platform/audit/overview?domain=G&operator=${encodeURIComponent(operator)}`));
  const recent = Array.isArray(a2.recentLogs) ? a2.recentLogs : [];
  const actorOf = (row: any) => String(row.actorUsername ?? row.actor ?? row.operator ?? "");
  expect(recent.some((row: any) => actorOf(row).includes(operator)), "A2 maker audit").toBe(true);
  const a4 = await okData(await page.request.get("/api/admin/platform/events/overview"));
  expect(Array.isArray(a4.eventFamilies), "A4 event families").toBe(true);
  expect(a4.eventFamilies.length, "A4 event families populated").toBeGreaterThan(0);
  expect(Array.isArray(a4.schemaRegistrations), "A4 schema registrations").toBe(true);
  expect(a4.schemaRegistrations.length, "A4 schema registrations populated").toBeGreaterThan(0);
  expect(a4.schemaRegistrations.every((row: any) => typeof row.serverAuthoritative === "boolean"),
    "A4 schema authority markers").toBe(true);
  evidence.a2 = { recentMakerLogs: recent.filter((row: any) => actorOf(row).includes(operator)).length };
  evidence.a4 = {
    eventFamilies: a4.eventFamilies.length,
    schemaRegistrations: a4.schemaRegistrations.length,
    serverAuthoritativeSchemas: a4.schemaRegistrations.filter((row: any) => row.serverAuthoritative === true).length,
  };

  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.api5xx).toEqual([]);
  evidence.completedAt = new Date().toISOString();
  evidence.diagnostics = diagnostics;
  await testInfo.attach("g-domain-nonowner-write-evidence.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
});

test("G2 swap 熔断态下仅允许手续费收紧，成功写与幂等闭环后由隔离夹具精确恢复", async ({ page }, testInfo) => {
  await login(page, fixture.accounts.g_maker);
  const readPath = "/api/admin/market/exchange";
  const writePath = "/api/admin/market/exchange/params/fee";
  const baseline = await okData(await page.request.get(readPath));
  expect(baseline.swap.enabled).toBe(false);
  const original = String(baseline.caps.find((row: any) => row.key === "fee").value);
  const candidate = decimalDelta(original, 0.01);
  await openFromSidebar(page, "/finance-products/exchange");
  await expect(page.getByRole("button", { name: "调整 累计实名触发线", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "调整 兑换手续费率", exact: true }).click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  await dialog.getByLabel("目标新值").fill(candidate);
  await dialog.getByLabel(/操作理由/).fill(`G2 非Owner熔断态手续费收紧闭环 ${RUN_ID}`);

  const requestPromise = page.waitForRequest((request) =>
    new URL(request.url()).pathname === writePath && request.method() === "PATCH");
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === writePath && response.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const [writeRequest, writeResponse] = await Promise.all([requestPromise, responsePromise]);
  expect(writeResponse.status()).toBe(200);
  const writePayload = await jsonEnvelope(writeResponse);
  expect(writePayload.code).toBe(0);
  expect(writePayload.data?.serverCanonical).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const commandKey = writeRequest.headers()["idempotency-key"] ?? "";
  const body = writeRequest.postDataJSON() as Record<string, unknown>;
  const replay = await raw(page, "PATCH", writePath, body, commandKey);
  expect(replay.status).toBe(200);
  const conflict = await raw(page, "PATCH", writePath, {
    ...body,
    reason: `${String(body.reason)} 异载荷`,
  }, commandKey);
  expect(conflict.status).toBe(409);
  expectNumeric((await publicData(page, "/api/config/exchange/caps")).feePct, candidate, "G2 public fee projection");

  const guardedRestore = await raw(page, "PATCH", writePath, {
    ...body,
    value: original,
    reason: `G2 非Owner API恢复受 B1 红线保护 ${RUN_ID}`,
  }, `${RUN_ID}-g2-guarded-restore-${Date.now()}`);
  expect(guardedRestore.status).toBe(422);
  expect(String(guardedRestore.payload.message)).toContain("COVERAGE_BELOW_REDLINE");
  await testInfo.attach("g2-nonowner-write-evidence.json", {
    body: Buffer.from(JSON.stringify({
      runId: RUN_ID,
      original,
      candidate,
      commandKey,
      canonicalWrite: writePayload.data?.serverCanonical,
      replayStatus: replay.status,
      differentPayloadStatus: conflict.status,
      guardedRestoreStatus: guardedRestore.status,
      requiresExactFixtureRestore: true,
    }, null, 2)),
    contentType: "application/json",
  });
});

async function exerciseG3(page: Page, operator: string) {
  const readPath = "/api/admin/market/nex/curve";
  const writePath = "/api/admin/market/nex/curve";
  const baseline = await okData(await page.request.get(readPath));
  const inactiveDay = baseline.activeDayIndex === 0 ? 1 : 0;
  const original = String(baseline.frames[inactiveDay].volatilityPct);
  const candidate = decimalDelta(original, 0.01);
  await openFromSidebar(page, "/finance-products/market");
  const row = page.locator("table.dial-tbl tbody tr").nth(inactiveDay);
  await row.locator("td").nth(3).click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("目标新值").fill(candidate);
  await dialog.getByLabel(/操作理由/).fill(`G3 非Owner真实成功写与 CAS 闭环 ${RUN_ID}`);

  const requestPromise = page.waitForRequest((request) =>
    new URL(request.url()).pathname === writePath && request.method() === "PUT");
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === writePath && response.request().method() === "PUT");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const [writeRequest, writeResponse] = await Promise.all([requestPromise, responsePromise]);
  expect(writeResponse.status()).toBe(200);
  const writePayload = await jsonEnvelope(writeResponse);
  expect(writePayload.code).toBe(0);
  expect(writePayload.data?.serverCanonical).toBe(true);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const commandKey = writeRequest.headers()["idempotency-key"] ?? "";
  const body = writeRequest.postDataJSON() as Record<string, any>;

  const replay = await raw(page, "PUT", writePath, body, commandKey);
  expect(replay.status).toBe(200);
  const conflict = await raw(page, "PUT", writePath, {
    ...body,
    reason: `${String(body.reason)} 异载荷`,
  }, commandKey);
  expect(conflict.status).toBe(409);
  expectNumeric((await okData(await page.request.get(readPath))).frames[inactiveDay].volatilityPct, candidate, "G3 admin projection");
  expectNumeric((await publicData(page, "/api/config/market/nex")).frames[inactiveDay].volatilityPct, candidate, "G3 App/public projection");

  const restoreBody = {
    ...body,
    frames: body.expectedFrames,
    expectedFrames: body.frames,
    reason: `G3 非Owner终验精确恢复 ${RUN_ID}`,
    operator,
  };
  const restore = await raw(page, "PUT", writePath, restoreBody, `${RUN_ID}-g3-restore-${Date.now()}`);
  expect(restore.status).toBe(200);
  expectNumeric((await okData(await page.request.get(readPath))).frames[inactiveDay].volatilityPct, original, "G3 initial restore");

  const raceBase = await okData(await page.request.get(readPath));
  const raceExpected = serializeFrames(raceBase.frames);
  const framesA = raceExpected.map((frame: any) => ({ ...frame }));
  const framesB = raceExpected.map((frame: any) => ({ ...frame }));
  framesA[inactiveDay].volatilityPct = decimalDelta(original, 0.02);
  framesB[inactiveDay].volatilityPct = decimalDelta(original, 0.03);
  const racePrefix = `${RUN_ID}-g3-cas-${Date.now()}`;
  const [raceA, raceB] = await Promise.all([
    raw(page, "PUT", writePath, {
      frames: framesA,
      expectedFrames: raceExpected,
      reason: `G3 双运营员 CAS A ${RUN_ID}`,
      operator,
    }, `${racePrefix}-a`),
    raw(page, "PUT", writePath, {
      frames: framesB,
      expectedFrames: raceExpected,
      reason: `G3 双运营员 CAS B ${RUN_ID}`,
      operator,
    }, `${racePrefix}-b`),
  ]);
  expect([raceA.status, raceB.status].filter((status) => status === 200)).toHaveLength(1);
  expect([raceA.status, raceB.status].filter((status) => status === 409)).toHaveLength(1);

  const afterRace = await okData(await page.request.get(readPath));
  const finalRestore = await raw(page, "PUT", writePath, {
    frames: raceExpected,
    expectedFrames: serializeFrames(afterRace.frames),
    reason: `G3 双运营员 CAS 后恢复 ${RUN_ID}`,
    operator,
  }, `${racePrefix}-restore`);
  expect(finalRestore.status).toBe(200);
  expectNumeric((await okData(await page.request.get(readPath))).frames[inactiveDay].volatilityPct, original, "G3 final restored admin");
  expectNumeric((await publicData(page, "/api/config/market/nex")).frames[inactiveDay].volatilityPct, original, "G3 final restored App/public");
  return {
    original,
    candidate,
    commandKey,
    canonicalWrite: writePayload.data?.serverCanonical,
    replayStatus: replay.status,
    differentPayloadStatus: conflict.status,
    raceStatuses: [raceA.status, raceB.status],
    restoreStatus: finalRestore.status,
    restored: true,
  };
}

function serializeFrames(frames: Array<Record<string, unknown>>) {
  return frames.map((frame) => ({
    dayIndex: frame.dayIndex,
    targetPrice: String(frame.targetPrice),
    pumpProbability: String(frame.pumpProbability),
    volatilityPct: String(frame.volatilityPct),
  }));
}

async function raw(
  page: Page,
  method: string,
  path: string,
  body: Record<string, unknown>,
  commandKey: string,
) {
  const response = await page.request.fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    data: body,
  });
  return { status: response.status(), payload: await jsonEnvelope(response) };
}

async function okData(response: APIResponse) {
  expect(response.status()).toBe(200);
  const payload = await jsonEnvelope(response);
  expect(payload.code).toBe(0);
  expect(payload.data).toBeTruthy();
  return payload.data!;
}

async function jsonEnvelope(response: APIResponse | Response) {
  return await response.json().catch(() => ({})) as Envelope;
}

async function publicData(page: Page, path: string) {
  return await okData(await page.request.get(`${BACKEND}${path}`));
}

function expectNumeric(actual: unknown, expected: string, label: string) {
  expect(Number(actual), label).toBeCloseTo(Number(expected), 6);
}

function decimalDelta(value: string, delta: number) {
  return String(Number((Number(value) + delta).toFixed(2)));
}

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /金融产品/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
}

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "load" });
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible({ timeout: 15_000 });
  await username.fill(account.username);
  const password = page.locator('input[autocomplete="current-password"]');
  await password.fill(account.password);
  await expect(page.getByRole("button", { name: /登录|继续/ })).toBeEnabled();
  await password.press("Enter");
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "load" });
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible({ timeout: 15_000 });
  await username.fill("superadmin");
  const password = page.locator('input[autocomplete="current-password"]');
  await password.fill("Admin@123456");
  await expect(page.getByRole("button", { name: /登录|继续/ })).toBeEnabled();
  await password.press("Enter");
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

function monitorFailures(page: Page) {
  const pageErrors: string[] = [];
  const api5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/admin/") && response.status() >= 500) {
      api5xx.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  });
  return { pageErrors, api5xx };
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(secret) ?? -1;
  if (step <= previous) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 }).toBeGreaterThan(previous);
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    const boundary = Math.floor(Date.now() / 30_000);
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 5_000 }).toBeGreaterThan(boundary);
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(secret, step);
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
