import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type GFixture = {
  runId: string;
  accounts: { maker: Account; secondWriter: Account };
};
type AuditFixture = { runId: string; actors: { auditReader: Account } };
type ChildResources = {
  runId: string;
  sourceDatabase: string;
  database: string;
  backendPid: number;
  backendPort: number;
  redisPort: number;
  redisDatabase: number;
  minioBucket: string;
  jarSha256: string;
  pcPid: number;
  pcPort: number;
  pcBuildId: string;
  mfaBypass: boolean;
  cleanupRequired: boolean;
};
type Envelope = { code?: number; message?: string; data?: Record<string, any> };

const RUN_ID = "pc-full-acceptance-20260729-114336";
const EXPECTED_DATABASE = "nexion_acceptance_20260729_114336_g_final9";
const EXPECTED_BUILD_ID = "WF2Bg3fIWMQRSwSJCTh5E";
const EXPECTED_JAR_SHA = "AD3EE7ED47E02C2DCCB842F5E74D44641B26E2032F8329BFEC1CE03223021215";
const G_FIXTURE_PATH = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/final7-domain-permission-refresh/G-final7-permission-manifest.json`;
const AUDIT_FIXTURE_PATH = process.env.G_AUDIT_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/final7-domain-permission-refresh/A-final7-audit-reader-manifest.json`;
const CHILD_RESOURCES_PATH = process.env.G_FINAL9_CHILD_RESOURCES_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/G/final9-owner/disposable/child-resources.json`;
const EVIDENCE_DIR = process.env.G_FINAL9_CHILD_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/G/final9-owner/disposable`;
const BACKEND = process.env.NEXION_BACKEND_URL ?? "http://127.0.0.1:18130";
const ADMIN = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3310";
const TRUSTED_EDGE_HEADERS = { "X-Nexion-Edge-Country": "JP" };

const fixture = JSON.parse(readFileSync(G_FIXTURE_PATH, "utf8")) as GFixture;
const auditFixture = JSON.parse(readFileSync(AUDIT_FIXTURE_PATH, "utf8")) as AuditFixture;
const child = JSON.parse(readFileSync(CHILD_RESOURCES_PATH, "utf8")) as ChildResources;
const maker = fixture.accounts.maker;
const secondWriter = fixture.accounts.secondWriter;
const auditReader = auditFixture.actors.auditReader;

test.describe.configure({ mode: "serial", timeout: 360_000 });

test.beforeAll(() => {
  expect(process.env.G_DISPOSABLE_WRITE_TOKEN, "root-issued G_DISPOSABLE_WRITE_TOKEN=1 is required").toBe("1");
  expect(fixture.runId).toBe(RUN_ID);
  expect(auditFixture.runId).toBe(RUN_ID);
  expect(child.runId).toBe(`${RUN_ID}-G-Final9`);
  expect(child.sourceDatabase).toBe(`nexion_acceptance_20260729_114336`);
  expect(child.database).toBe(EXPECTED_DATABASE);
  expect(child.backendPort).toBe(18130);
  expect(child.pcPort).toBe(3310);
  expect(child.redisPort).toBe(6391);
  expect(child.redisDatabase).toBe(0);
  expect(child.minioBucket).toBe("nexion-acc-20260729-114336-g-final9");
  expect(child.jarSha256).toBe(EXPECTED_JAR_SHA);
  expect(child.pcBuildId).toBe(EXPECTED_BUILD_ID);
  expect(child.mfaBypass).toBe(false);
  expect(child.cleanupRequired).toBe(true);
  expect(new URL(BACKEND).port).toBe(String(child.backendPort));
  expect(new URL(ADMIN).port).toBe(String(child.pcPort));
  expect(maker.username).not.toBe(secondWriter.username);
  expect(maker.username).not.toBe(auditReader.username);
});

test("G1/G2 在 Final9 隔离环境完成真实 UI、双运营员、幂等、红线恢复保护、A2/A4 与 App 投影", async ({ page, browser }, testInfo) => {
  const diagnostics = monitorFailures(page);
  const evidence: Record<string, any> = {
    runId: RUN_ID,
    candidate: {
      pcBuildId: child.pcBuildId,
      backendJarSha256: child.jarSha256,
      database: child.database,
      redis: `127.0.0.1:${child.redisPort}/${child.redisDatabase}`,
      minioBucket: child.minioBucket,
      mfaBypass: child.mfaBypass,
    },
    actors: {
      maker: maker.username,
      secondWriter: secondWriter.username,
      auditReader: auditReader.username,
    },
    startedAt: new Date().toISOString(),
    modules: {},
    disposalRequired: true,
  };

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const auditContext = await browser.newContext();
  const auditPage = await auditContext.newPage();
  try {
    await login(page, maker);
    await login(secondPage, secondWriter);

    evidence.modules.G1 = await exerciseIrreversibleTightening({
      page,
      secondPage,
      id: "G1",
      href: "/finance-products/staking",
      readPath: "/api/admin/market/staking",
      writePath: "/api/admin/market/staking/pools/usdt30d/params/min",
      value: (data) => data.pools.find((row: any) => row.tierKey === "usdt30d").minStake,
      publicPath: "/api/config/staking/pools",
      publicValue: (data) => data.pools.find((row: any) => row.tierKey === "usdt30d").minAmountUsdt,
      firstDelta: 1,
      secondDelta: 2,
      openDialog: (target) => target.getByRole("button", { name: "调整最小额", exact: true }).first().click(),
    });
    await page.screenshot({ path: testInfo.outputPath("g1-disposable-final-state.png"), fullPage: true });

    evidence.modules.G2 = await exerciseIrreversibleTightening({
      page,
      secondPage,
      id: "G2",
      href: "/finance-products/exchange",
      readPath: "/api/admin/market/exchange",
      writePath: "/api/admin/market/exchange/params/fee",
      value: (data) => data.caps.find((row: any) => row.key === "fee").value,
      publicPath: "/api/config/exchange/caps",
      publicValue: (data) => data.feePct,
      firstDelta: 0.01,
      secondDelta: 0.02,
      beforeUi: async (target) => {
        await expect(target.getByRole("button", { name: /累计.*触发线/ })).toHaveCount(0);
      },
      openDialog: (target) => target.getByRole("button", { name: "调整 兑换手续费率", exact: true }).click(),
    });
    await page.screenshot({ path: testInfo.outputPath("g2-disposable-final-state.png"), fullPage: true });

    await login(auditPage, auditReader);
    for (const actor of [maker.username, secondWriter.username]) {
      const a2 = await okData(await auditPage.request.get(
        `/api/admin/platform/audit/overview?domain=G&operator=${encodeURIComponent(actor)}`,
      ));
      const recent = Array.isArray(a2.recentLogs) ? a2.recentLogs : [];
      const actorOf = (row: any) => String(row.actorUsername ?? row.actor ?? row.operator ?? "");
      expect(recent.some((row: any) => actorOf(row).includes(actor)), `A2 contains ${actor}`).toBe(true);
      evidence[`a2_${actor}`] = { matchingLogs: recent.filter((row: any) => actorOf(row).includes(actor)).length };
    }
    const a4 = await okData(await auditPage.request.get("/api/admin/platform/events/overview"));
    expect(Array.isArray(a4.eventFamilies)).toBe(true);
    expect(a4.eventFamilies.length).toBeGreaterThan(0);
    expect(Array.isArray(a4.schemaRegistrations)).toBe(true);
    expect(a4.schemaRegistrations.length).toBeGreaterThan(0);
    evidence.a4 = {
      eventFamilies: a4.eventFamilies.length,
      schemaRegistrations: a4.schemaRegistrations.length,
      serverAuthoritativeSchemas: a4.schemaRegistrations.filter((row: any) => row.serverAuthoritative === true).length,
    };

    expect(diagnostics.pageErrors).toEqual([]);
    expect(diagnostics.unexpectedConsoleErrors).toEqual([]);
    expect(diagnostics.api5xx).toEqual([]);
    expect(diagnostics.requestFailures).toEqual([]);
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await Promise.all([
      page.request.post("/api/admin/auth/logout").catch(() => undefined),
      secondPage.request.post("/api/admin/auth/logout").catch(() => undefined),
      auditPage.request.post("/api/admin/auth/logout").catch(() => undefined),
    ]);
    await secondContext.close().catch(() => undefined);
    await auditContext.close().catch(() => undefined);
    evidence.completedAt = new Date().toISOString();
    evidence.diagnostics = diagnostics;
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(`${EVIDENCE_DIR}/g1-g2-disposable-lifecycle.json`, JSON.stringify(evidence, null, 2));
    await testInfo.attach("g1-g2-disposable-lifecycle.json", {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: "application/json",
    });
  }
});

async function exerciseIrreversibleTightening(options: {
  page: Page;
  secondPage: Page;
  id: "G1" | "G2";
  href: string;
  readPath: string;
  writePath: string;
  value: (data: Record<string, any>) => unknown;
  publicPath: string;
  publicValue: (data: Record<string, any>) => unknown;
  firstDelta: number;
  secondDelta: number;
  beforeUi?: (page: Page) => Promise<void>;
  openDialog: (page: Page) => Promise<void>;
}) {
  const baseline = await okData(await options.page.request.get(options.readPath));
  const original = String(options.value(baseline));
  const firstCandidate = decimalDelta(original, options.firstDelta);
  const secondCandidate = decimalDelta(original, options.secondDelta);
  expect(baseline.coverage?.breached, `${options.id} B1 precondition breached`).toBe(true);

  await openFromSidebar(options.page, options.href);
  await options.beforeUi?.(options.page);
  await options.openDialog(options.page);
  const dialog = options.page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("目标新值").fill(firstCandidate);
  await dialog.getByLabel(/操作理由/).fill(`${options.id} Final9 隔离环境收紧 ${RUN_ID}`);
  const requestPromise = options.page.waitForRequest((request) =>
    new URL(request.url()).pathname === options.writePath && request.method() === "PATCH");
  const responsePromise = options.page.waitForResponse((response) =>
    new URL(response.url()).pathname === options.writePath && response.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const [writeRequest, writeResponse] = await Promise.all([requestPromise, responsePromise]);
  const firstKey = writeRequest.headers()["idempotency-key"] ?? "";
  const firstBody = writeRequest.postDataJSON() as Record<string, unknown>;
  const writePayload = await jsonEnvelope(writeResponse);
  expect(writeResponse.status()).toBe(200);
  expect(writePayload.code).toBe(0);
  expect(writePayload.data?.serverCanonical).toBe(true);
  expect(firstKey).not.toBe("");
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const replay = await raw(options.page, options.writePath, firstBody, firstKey);
  expect(replay.status).toBe(200);
  const differentPayload = await raw(options.page, options.writePath, {
    ...firstBody,
    reason: `${String(firstBody.reason)} 异载荷`,
  }, firstKey);
  expect(differentPayload.status).toBe(409);

  const secondKey = `${RUN_ID}-${options.id.toLowerCase()}-second-writer-${Date.now()}`;
  const secondWrite = await raw(options.secondPage, options.writePath, {
    ...firstBody,
    value: secondCandidate,
    reason: `${options.id} Final9 独立第二运营员继续收紧 ${RUN_ID}`,
    operator: secondWriter.username,
  }, secondKey);
  expect(secondWrite.status).toBe(200);
  expect(secondWrite.payload.code).toBe(0);
  expect(secondWrite.payload.data?.serverCanonical).toBe(true);

  expectNumeric(options.value(await okData(await options.page.request.get(options.readPath))), secondCandidate,
    `${options.id} second-writer admin projection`);
  expectNumeric(options.publicValue(await publicData(options.page, options.publicPath)), secondCandidate,
    `${options.id} second-writer App projection`);

  const guardedRestoreKey = `${RUN_ID}-${options.id.toLowerCase()}-guarded-restore-${Date.now()}`;
  const guardedRestore = await raw(options.page, options.writePath, {
    ...firstBody,
    value: original,
    reason: `${options.id} Final9 红线恢复保护验证 ${RUN_ID}`,
    operator: maker.username,
  }, guardedRestoreKey);
  expect(guardedRestore.status).toBe(422);
  expect(String(guardedRestore.payload.message)).toContain("COVERAGE_BELOW_REDLINE");
  expectNumeric(options.value(await okData(await options.page.request.get(options.readPath))), secondCandidate,
    `${options.id} rejected restore preserves child state`);

  return {
    original,
    firstCandidate,
    secondCandidate,
    firstKey,
    secondKey,
    guardedRestoreKey,
    firstUiStatus: writeResponse.status(),
    firstCanonical: writePayload.data?.serverCanonical,
    replayStatus: replay.status,
    differentPayloadStatus: differentPayload.status,
    secondWriterStatus: secondWrite.status,
    guardedRestoreStatus: guardedRestore.status,
    guardedRestoreMessage: guardedRestore.payload.message,
    retainedOnlyInDisposableChild: true,
  };
}

async function login(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "load" });
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible({ timeout: 15_000 });
  await username.fill(account.username);
  const password = page.locator('input[autocomplete="current-password"]');
  await password.fill(account.password);
  await password.press("Enter");
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /金融产品/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
}

async function raw(page: Page, path: string, body: Record<string, unknown>, commandKey: string) {
  const response = await page.request.fetch(path, {
    method: "PATCH",
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

async function publicData(page: Page, path: string) {
  return await okData(await page.request.get(`${BACKEND}${path}`, { headers: TRUSTED_EDGE_HEADERS }));
}

async function jsonEnvelope(response: APIResponse | Response) {
  return await response.json().catch(() => ({})) as Envelope;
}

function decimalDelta(value: string, delta: number) {
  return String(Number((Number(value) + delta).toFixed(2)));
}

function expectNumeric(actual: unknown, expected: string, label: string) {
  expect(Number(actual), label).toBeCloseTo(Number(expected), 6);
}

function monitorFailures(page: Page) {
  const pageErrors: string[] = [];
  const unexpectedConsoleErrors: string[] = [];
  const api5xx: string[] = [];
  const requestFailures: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const expectedSession401 = message.location().url.endsWith("/api/admin/auth/session")
      && message.text().includes("401 (Unauthorized)");
    if (!expectedSession401) unexpectedConsoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/admin/") && response.status() >= 500) {
      api5xx.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/admin/market/") || pathname.startsWith("/api/config/")) {
      requestFailures.push(`${request.method()} ${pathname} ${request.failure()?.errorText ?? "unknown"}`);
    }
  });
  return { pageErrors, unexpectedConsoleErrors, api5xx, requestFailures };
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
