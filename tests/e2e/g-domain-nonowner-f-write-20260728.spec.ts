import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  expect,
  test,
  type APIResponse,
  type BrowserContext,
  type Page,
  type Response,
} from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type Fixture = {
  runId: string;
  accounts: {
    g_maker?: FixtureAccount;
    maker?: FixtureAccount;
    g_second_writer?: FixtureAccount;
    secondWriter?: FixtureAccount;
  };
};
type AuditFixture = {
  runId: string;
  checker?: FixtureAccount;
  accounts?: { g_maker?: FixtureAccount; maker?: FixtureAccount };
  actors?: { auditReader?: FixtureAccount };
};
type Envelope = { code?: number; message?: string; data?: Record<string, any> };
type ChildResources = {
  runId: string;
  backendPid: number;
  backendPort: number;
  database: string;
  redisDatabase: number;
  minioBucket: string;
  jarSha256: string;
  pcPid: number;
  pcPort: number;
  pcBuildId: string;
};
type PendingRestorer = {
  id: string;
  restore: (page: Page) => Promise<void>;
};

const RUN_ID = process.env.G_WRITE_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const fixturePath = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/G.json`;
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
const maker = fixture.accounts.g_maker ?? fixture.accounts.maker;
if (!maker) throw new Error("G fixture must provide g_maker or maker");
const secondWriter = fixture.accounts.g_second_writer ?? fixture.accounts.secondWriter;
const auditFixturePath = process.env.G_AUDIT_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/A.json`;
const auditFixture = JSON.parse(readFileSync(auditFixturePath, "utf8")) as AuditFixture;
const auditAccount = auditFixture.actors?.auditReader
  ?? auditFixture.checker
  ?? auditFixture.accounts?.g_maker
  ?? auditFixture.accounts?.maker;
if (!auditAccount) throw new Error("G audit fixture must provide actors.auditReader or accounts.maker");
const BACKEND = process.env.G_BACKEND_URL
  ?? process.env.NEXION_BACKEND_URL
  ?? "http://127.0.0.1:8110";
const G2_CHILD_RESOURCES_PATH = process.env.G2_CHILD_RESOURCES_PATH
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/child-resources.json";
const G2_CHILD_HANDOFF_PATH = process.env.G2_CHILD_HANDOFF_PATH
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/G/G2-DISPOSABLE-CHILD-HANDOFF.md";
// Loopback public projection checks emulate the trusted gateway only; App code
// does not and must not generate country headers.
const TRUSTED_EDGE_HEADERS = { "X-Nexion-Edge-Country": "JP" };
const WRITE_EVIDENCE_DIR = process.env.G_WRITE_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/G/final9-owner/write-main`;

test.describe.configure({ mode: "serial", timeout: 360_000 });
let pendingRestorers: PendingRestorer[] = [];
test.beforeAll(() => {
  expect(
    process.env.G_NONOWNER_WRITE_TOKEN === "1" || process.env.G2_DISPOSABLE_CHILD === "1",
    "G_NONOWNER_WRITE_TOKEN=1 or the isolated G2_DISPOSABLE_CHILD=1 gate is required",
  ).toBe(true);
  expect(fixture.runId, "G fixture Run ID").toBe(RUN_ID);
  expect(auditFixture.runId, "audit fixture Run ID").toBe(RUN_ID);
  expect(maker.username, "maker and audit actor must be distinct").not.toBe(auditAccount.username);
  if (process.env.G_NONOWNER_WRITE_TOKEN === "1") {
    expect(secondWriter, "Final7 G main-candidate writes require an independent secondWriter fixture").toBeTruthy();
    expect(secondWriter?.username, "maker and secondWriter must be distinct accounts").not.toBe(maker.username);
    expect(secondWriter?.username, "secondWriter and audit actor must be distinct accounts").not.toBe(auditAccount.username);
  }
});
test.beforeEach(() => {
  pendingRestorers = [];
});
test.afterEach(async ({ page }) => {
  const cleanupErrors: Error[] = [];
  for (const restorer of [...pendingRestorers].reverse()) {
    await restorer.restore(page).catch((error: unknown) => {
      cleanupErrors.push(error instanceof Error ? error : new Error(`${restorer.id}: ${String(error)}`));
    });
  }
  pendingRestorers = [];
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, "G non-Owner restoration failed");
  }
});

test("G1/G3/G4/G7 maker 可逆成功写、幂等冲突、CAS、跨域投影与恢复", async ({ page, browser }, testInfo) => {
  if (!secondWriter) throw new Error("FINAL7_G_INDEPENDENT_SECOND_WRITER_REQUIRED");
  const diagnostics = monitorFailures(page);
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    candidate: {
      pcBuildId: process.env.G_EXPECTED_PC_BUILD_ID ?? null,
      backendJarSha256: process.env.G_EXPECTED_BACKEND_JAR_SHA256 ?? null,
      backend: BACKEND,
    },
    startedAt: new Date().toISOString(),
    modules: {},
  };
  await login(page, maker);
  const operator = maker.username;
  const modules = evidence.modules as Record<string, unknown>;

  const genericScenarios = ([
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
  ] as const).filter((scenario) =>
    scenario.id !== "G1" || process.env.G_WRITE_WITH_RECOVERABLE_COVERAGE === "1");
  if (process.env.G_WRITE_WITH_RECOVERABLE_COVERAGE !== "1") {
    modules.G1 = {
      status: "skipped",
      reason: "G1 restoration loosens coverage and is unsafe on the shared B1-redline candidate",
    };
  }

  for (const scenario of genericScenarios) {
    const baseline = await okData(await page.request.get(scenario.readPath));
    const original = String(scenario.value(baseline));
    const candidate = scenario.candidate(original);
    let restoreTemplate: Record<string, unknown> = {};
    pendingRestorers.push({
      id: scenario.id,
      restore: async (cleanupPage) => {
        const current = String(scenario.value(await okData(await cleanupPage.request.get(scenario.readPath))));
        if (Number(current) !== Number(original)) {
          const cleanup = await raw(cleanupPage, scenario.method, scenario.writePath, {
            ...restoreTemplate,
            value: original,
            reason: `${scenario.id} 非Owner finally 精确恢复 ${RUN_ID}`,
            operator,
          }, `${RUN_ID}-${scenario.id.toLowerCase()}-finally-${Date.now()}`);
          expect(cleanup.status, `${scenario.id} finally restore`).toBe(200);
        }
        expectNumeric(
          scenario.value(await okData(await cleanupPage.request.get(scenario.readPath))),
          original,
          `${scenario.id} finally restored admin`,
        );
      },
    });
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
    const commandKey = writeRequest.headers()["idempotency-key"] ?? "";
    const body = writeRequest.postDataJSON() as Record<string, unknown>;
    restoreTemplate = body;
    expect(writeResponse.status(), `${scenario.id} UI write`).toBe(200);
    const writePayload = await jsonEnvelope(writeResponse);
    expect(writePayload.code, `${scenario.id} code`).toBe(0);
    expect(writePayload.data?.serverCanonical, `${scenario.id} canonical write response`).toBe(true);
    expect(writePayload.data?.domain, `${scenario.id} domain`).toBe(scenario.id);
    await expect(dialog).toBeHidden({ timeout: 20_000 });

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

    const restoreKey = `${RUN_ID}-${scenario.id.toLowerCase()}-restore-${Date.now()}`;
    const restore = await raw(page, scenario.method, scenario.writePath, {
      ...body,
      value: original,
      reason: `${scenario.id} 非Owner终验精确恢复 ${RUN_ID}`,
    }, restoreKey);
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
      restoreKey,
      uiStatus: writeResponse.status(),
      canonicalWrite: writePayload.data?.serverCanonical,
      receiptId: writePayload.data?.updated?.receiptId ?? null,
      replayStatus: replay.status,
      differentPayloadStatus: conflict.status,
      restoreStatus: restore.status,
      restored: true,
    };
  }

  const secondWriterContext = await browser.newContext();
  const secondWriterPage = await secondWriterContext.newPage();
  await login(secondWriterPage, secondWriter);
  modules.G3 = await exerciseG3(page, secondWriterPage, operator, secondWriter.username);
  await secondWriterContext.close();

  const auditContext = await browser.newContext();
  const auditPage = await auditContext.newPage();
  await login(auditPage, auditAccount);
  const a2 = await okData(await auditPage.request.get(`/api/admin/platform/audit/overview?domain=G&operator=${encodeURIComponent(operator)}`));
  const recent = Array.isArray(a2.recentLogs) ? a2.recentLogs : [];
  const actorOf = (row: any) => String(row.actorUsername ?? row.actor ?? row.operator ?? "");
  expect(recent.some((row: any) => actorOf(row).includes(operator)), "A2 maker audit").toBe(true);
  const detailOf = (row: any): Record<string, unknown> => {
    const detail = row.detailJson ?? row.detail ?? {};
    if (typeof detail === "string") {
      try {
        return JSON.parse(detail) as Record<string, unknown>;
      } catch {
        return {};
      }
    }
    return detail && typeof detail === "object" ? detail as Record<string, unknown> : {};
  };
  const g7AuditRows = recent.filter((row: any) =>
    actorOf(row).includes(operator)
    && row.action === "ADMIN_REPURCHASE_CONFIG_CHANGED"
    && detailOf(row).sourceDomain === "G7",
  );
  expect(g7AuditRows.length, "G7 audit uses sourceDomain for A2 grouping").toBeGreaterThan(0);
  const a4 = await okData(await auditPage.request.get("/api/admin/platform/events/overview"));
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
    repurchaseConfigSchemaVerification: "outbox event-level linkage is verified against the registered database schema in Final15 closure, because the A4 overview returns a bounded schema list",
  };
  await auditContext.close();

  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.unexpectedConsoleErrors).toEqual([]);
  expect(diagnostics.api5xx).toEqual([]);
  expect(diagnostics.requestFailures).toEqual([]);
  evidence.completedAt = new Date().toISOString();
  evidence.diagnostics = diagnostics;
  mkdirSync(WRITE_EVIDENCE_DIR, { recursive: true });
  writeFileSync(`${WRITE_EVIDENCE_DIR}/g3-g4-g7-write-evidence.json`, JSON.stringify(evidence, null, 2));
  await testInfo.attach("g-domain-nonowner-write-evidence.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json",
  });
});

test("G2 swap 熔断态下仅允许手续费收紧，保留子库并交由主控 finally 销毁", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    process.env.G2_DISPOSABLE_CHILD !== "1",
    "G2 fee tightening is intentionally irreversible under the current B1 redline; run only in a disposable child DB",
  );
  const child = bindG2Child();
  const diagnostics = monitorFailures(page);
  const evidence: Record<string, any> = {
    runId: RUN_ID,
    startedAt: new Date().toISOString(),
    child: {
      runId: child.runId,
      database: child.database,
      backendPid: child.backendPid,
      backendPort: child.backendPort,
      pcPid: child.pcPid,
      pcPort: child.pcPort,
      redisDatabase: child.redisDatabase,
      minioBucket: child.minioBucket,
      jarSha256: child.jarSha256,
      pcBuildId: child.pcBuildId,
    },
    disposal: {
      required: true,
      owner: "main-controller-after-final-authorized-D-child-consumer",
      performedByTest: false,
    },
  };
  const readPath = "/api/admin/market/exchange";
  const writePath = "/api/admin/market/exchange/params/fee";
  let loggedIn = false;
  let writeApplied = false;
  let writeAttempted = false;
  let candidate = "";
  let auditContext: BrowserContext | undefined;
  let auditPage: Page | undefined;
  try {
    await login(page, maker);
    loggedIn = true;
    const baseline = await okData(await page.request.get(readPath));
    expect(baseline.swap.enabled).toBe(false);
    const original = String(baseline.caps.find((row: any) => row.key === "fee").value);
    candidate = decimalDelta(original, 0.01);
    evidence.before = {
      fee: original,
      swapEnabled: baseline.swap.enabled,
      coverage: baseline.coverage ?? null,
    };
    evidence.candidate = { fee: candidate };

    await openFromSidebar(page, "/finance-products/exchange");
    await expect(page.getByRole("button", { name: "调整 累计实名触发线", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "调整 兑换手续费率", exact: true }).click();
    const dialog = page.locator('[role="dialog"]:visible').last();
    await dialog.getByLabel("目标新值").fill(candidate);
    await dialog.getByLabel(/操作理由/).fill(`G2 Owner 熔断态手续费收紧闭环 ${RUN_ID}`);

    const requestPromise = page.waitForRequest((request) =>
      new URL(request.url()).pathname === writePath && request.method() === "PATCH");
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === writePath && response.request().method() === "PATCH");
    writeAttempted = true;
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const [writeRequest, writeResponse] = await Promise.all([requestPromise, responsePromise]);
    expect(writeResponse.status()).toBe(200);
    const writePayload = await jsonEnvelope(writeResponse);
    expect(writePayload.code).toBe(0);
    expect(writePayload.data?.serverCanonical).toBe(true);
    writeApplied = true;
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const commandKey = writeRequest.headers()["idempotency-key"] ?? "";
    const body = writeRequest.postDataJSON() as Record<string, unknown>;
    expect(commandKey).not.toBe("");

    const replay = await raw(page, "PATCH", writePath, body, commandKey);
    expect(replay.status).toBe(200);
    const conflict = await raw(page, "PATCH", writePath, {
      ...body,
      reason: `${String(body.reason)} 异载荷`,
    }, commandKey);
    expect(conflict.status).toBe(409);
    expectNumeric(
      (await publicData(page, "/api/config/exchange/caps")).feePct,
      candidate,
      "G2 public fee projection",
    );

    const guardedRestore = await raw(page, "PATCH", writePath, {
      ...body,
      value: original,
      reason: `G2 Owner API恢复受 B1 红线保护 ${RUN_ID}`,
    }, `${RUN_ID}-g2-guarded-restore-${Date.now()}`);
    expect(guardedRestore.status).toBe(422);
    expect(String(guardedRestore.payload.message)).toContain("COVERAGE_BELOW_REDLINE");

    const finalAdmin = await okData(await page.request.get(readPath));
    const finalFee = String(finalAdmin.caps.find((row: any) => row.key === "fee").value);
    expectNumeric(finalFee, candidate, "G2 retained child fee");
    evidence.write = {
      commandKey,
      canonicalWrite: writePayload.data?.serverCanonical,
      replayStatus: replay.status,
      differentPayloadStatus: conflict.status,
      guardedRestoreStatus: guardedRestore.status,
      guardedRestoreMessage: guardedRestore.payload.message,
    };
    evidence.finalChildState = {
      fee: finalFee,
      swapEnabled: finalAdmin.swap.enabled,
      coverage: finalAdmin.coverage ?? null,
      requiresChildDatabaseDisposal: true,
    };

    const operator = maker.username;
    const a2 = await okData(
      await page.request.get(
        `/api/admin/platform/audit/overview?domain=G&operator=${encodeURIComponent(operator)}`,
      ),
    );
    const recent = Array.isArray(a2.recentLogs) ? a2.recentLogs : [];
    const actorOf = (row: any) => String(row.actorUsername ?? row.actor ?? row.operator ?? "");
    expect(recent.some((row: any) => actorOf(row).includes(operator)), "G2 child A2 maker audit").toBe(true);
    auditContext = await browser.newContext();
    auditPage = await auditContext.newPage();
    await login(auditPage, auditAccount);
    const a4 = await okData(await auditPage.request.get("/api/admin/platform/events/overview"));
    expect(Array.isArray(a4.eventFamilies), "G2 child A4 event families").toBe(true);
    expect(a4.eventFamilies.length, "G2 child A4 event families populated").toBeGreaterThan(0);
    evidence.audit = {
      a2MakerAuditVisible: true,
      a4EventFamilies: a4.eventFamilies.length,
      a4SchemaRegistrations: Array.isArray(a4.schemaRegistrations) ? a4.schemaRegistrations.length : null,
      outboxAndIdempotencyDatabaseProof: "deferred-to-main-controller-child-readonly-closure",
    };

    await page.screenshot({ path: testInfo.outputPath("g2-owner-final-child-state.png"), fullPage: true });
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
    evidence.finally = {
      writeApplied,
      writeAttempted,
      unsafeRollbackAttempted: false,
      retainedCandidate: candidate || null,
      logoutAttempted: loggedIn,
    };
    if (writeAttempted) {
      try {
        const finalSnapshot = await okData(await page.request.get(readPath));
        const finalFee = String(finalSnapshot.caps.find((row: any) => row.key === "fee").value);
        evidence.finally.lastReadableChildFee = finalFee;
        evidence.finally.candidateStillPresent = candidate !== "" && Number(finalFee) === Number(candidate);
      } catch (error) {
        evidence.finally.lastSnapshotError = error instanceof Error ? error.message : String(error);
      }
    }
    if (loggedIn) {
      try {
        const responsePromise = page.waitForResponse((response) =>
          new URL(response.url()).pathname === "/api/admin/auth/logout"
          && response.request().method() === "POST");
        await page.locator('header button[aria-haspopup="menu"]').last().click();
        await page.getByRole("button", { name: "退出登录", exact: true }).click();
        const response = await responsePromise;
        evidence.finally.logoutHttp = response.status();
        await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
        evidence.finally.sessionAfterLogoutHttp =
          (await page.request.get("/api/admin/auth/session")).status();
      } catch (error) {
        evidence.finally.logoutError = error instanceof Error ? error.message : String(error);
      }
    }
    if (auditContext) {
      if (auditPage) {
        await auditPage.request.post("/api/admin/auth/logout").catch(() => undefined);
      }
      await auditContext.close().catch(() => undefined);
    }
    evidence.completedAt = new Date().toISOString();
    evidence.diagnostics = diagnostics;
    await testInfo.attach("g2-owner-disposable-child-evidence.json", {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: "application/json",
    });
  }
});

test("G1 实际已提交但响应中断时保留同键重试，并从可见页面精确恢复", async ({ page }, testInfo) => {
  test.skip(
    process.env.G_REAL_UNKNOWN_OUTCOME !== "1" || process.env.G_WRITE_WITH_RECOVERABLE_COVERAGE !== "1",
    "requires an explicitly provisioned B1-recoverable acceptance fixture before any reversible unknown-outcome write",
  );
  await login(page, maker);
  const readPath = "/api/admin/market/staking";
  const writePath = "/api/admin/market/staking/pools/usdt30d/params/min";
  const original = String((await okData(await page.request.get(readPath))).pools.find((row: any) => row.tierKey === "usdt30d").minStake);
  const candidate = decimalDelta(original, 1);
  pendingRestorers.push({
    id: "G1-unknown-outcome",
    restore: async (cleanupPage) => {
      const current = String(
        (await okData(await cleanupPage.request.get(readPath))).pools
          .find((row: any) => row.tierKey === "usdt30d").minStake,
      );
      if (Number(current) !== Number(original)) {
        const cleanup = await raw(cleanupPage, "PATCH", writePath, {
          value: original,
          reason: `G1 非Owner unknown finally 精确恢复 ${RUN_ID}`,
          operator: maker.username,
        }, `${RUN_ID}-g1-unknown-finally-${Date.now()}`);
        expect(cleanup.status, "G1 unknown finally restore").toBe(200);
      }
      expectNumeric(
        (await okData(await cleanupPage.request.get(readPath))).pools
          .find((row: any) => row.tierKey === "usdt30d").minStake,
        original,
        "G1 unknown finally restored admin",
      );
    },
  });
  await openFromSidebar(page, "/finance-products/staking");
  await page.getByRole("button", { name: "调整最小额", exact: true }).first().click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  await dialog.getByLabel("目标新值").fill(candidate);
  await dialog.getByLabel(/操作理由/).fill(`G1 实际响应中断同键恢复 ${RUN_ID}`);

  let upstreamStatus = 0;
  let firstKey = "";
  const routeHandler = async (route: import("@playwright/test").Route) => {
    firstKey = route.request().headers()["idempotency-key"] ?? "";
    const upstream = await route.fetch();
    upstreamStatus = upstream.status();
    await route.abort("connectionreset");
  };
  await page.route(`**${writePath}`, routeHandler);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("目标新值")).toHaveValue(candidate);
  expect(firstKey).not.toBe("");
  expect(upstreamStatus).toBe(200);

  await page.unroute(`**${writePath}`, routeHandler);
  const retryRequest = page.waitForRequest((request) => new URL(request.url()).pathname === writePath && request.method() === "PATCH");
  const retryResponse = page.waitForResponse((response) => new URL(response.url()).pathname === writePath && response.request().method() === "PATCH");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const [request, response] = await Promise.all([retryRequest, retryResponse]);
  expect(request.headers()["idempotency-key"]).toBe(firstKey);
  expect(response.status()).toBe(200);
  expect((await jsonEnvelope(response)).code).toBe(0);
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  await page.getByRole("button", { name: "调整最小额", exact: true }).first().click();
  const restoreDialog = page.locator('[role="dialog"]:visible').last();
  await restoreDialog.getByLabel("目标新值").fill(original);
  await restoreDialog.getByLabel(/操作理由/).fill(`G1 实际响应中断终验精确恢复 ${RUN_ID}`);
  const restoreResponse = page.waitForResponse((response) => new URL(response.url()).pathname === writePath && response.request().method() === "PATCH");
  await restoreDialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await restoreResponse).status()).toBe(200);
  await expect(restoreDialog).toBeHidden({ timeout: 20_000 });
  expectNumeric((await okData(await page.request.get(readPath))).pools.find((row: any) => row.tierKey === "usdt30d").minStake, original, "G1 unknown outcome restored admin");
  expectNumeric((await publicData(page, "/api/config/staking/pools")).pools.find((row: any) => row.tierKey === "usdt30d").minAmountUsdt, original, "G1 unknown outcome restored App/public");
  await testInfo.attach("g1-real-unknown-outcome.json", {
    body: Buffer.from(JSON.stringify({ runId: RUN_ID, upstreamStatus, firstKeyPresent: Boolean(firstKey), retriedSameKey: true, restored: true }, null, 2)),
    contentType: "application/json",
  });
});

test("G1 B1 紧急恢复后，真实侧栏、管理 API 与 App 投影一致为 20", async ({ page }) => {
  await login(page, maker);
  await openFromSidebar(page, "/finance-products/staking");
  await expect(page.getByRole("cell", { name: /20\s*USDT 调整最小额/ }).first()).toBeVisible();
  const admin = await okData(await page.request.get("/api/admin/market/staking"));
  expectNumeric(admin.pools.find((row: any) => row.tierKey === "usdt30d").minStake, "20", "G1 emergency restored admin projection");
  const app = await publicData(page, "/api/config/staking/pools");
  expectNumeric(app.pools.find((row: any) => row.tierKey === "usdt30d").minAmountUsdt, "20", "G1 emergency restored App projection");
});

async function exerciseG3(page: Page, secondWriterPage: Page, operator: string, secondOperator: string) {
  const readPath = "/api/admin/market/nex/curve";
  const writePath = "/api/admin/market/nex/curve";
  const baseline = await okData(await page.request.get(readPath));
  const inactiveDay = baseline.activeDayIndex === 0 ? 1 : 0;
  const original = String(baseline.frames[inactiveDay].volatilityPct);
  const candidate = decimalDelta(original, 0.01);
  pendingRestorers.push({
    id: "G3",
    restore: async (cleanupPage) => {
      const current = await okData(await cleanupPage.request.get(readPath));
      const currentFrames = serializeFrames(current.frames);
      if (Number(currentFrames[inactiveDay].volatilityPct) !== Number(original)) {
        const restoredFrames = currentFrames.map((frame: Record<string, unknown>) => ({ ...frame }));
        restoredFrames[inactiveDay].volatilityPct = original;
        const cleanup = await raw(cleanupPage, "PUT", writePath, {
          frames: restoredFrames,
          expectedFrames: currentFrames,
          reason: `G3 非Owner finally 精确恢复 ${RUN_ID}`,
          operator,
        }, `${RUN_ID}-g3-finally-${Date.now()}`);
        expect(cleanup.status, "G3 finally restore").toBe(200);
      }
      const verified = await okData(await cleanupPage.request.get(readPath));
      expectNumeric(
        verified.frames[inactiveDay].volatilityPct,
        original,
        "G3 finally restored admin",
      );
    },
  });
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
  const initialRestoreKey = `${RUN_ID}-g3-restore-${Date.now()}`;
  const restore = await raw(page, "PUT", writePath, restoreBody, initialRestoreKey);
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
    raw(secondWriterPage, "PUT", writePath, {
      frames: framesB,
      expectedFrames: raceExpected,
      reason: `G3 双运营员 CAS B ${RUN_ID}`,
      operator: secondOperator,
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
    initialRestoreKey,
    racePrefix,
    finalRestoreKey: `${racePrefix}-restore`,
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

function bindG2Child() {
  const leaseToken = process.env.G2_D_CHILD_LEASE_TOKEN?.trim() ?? "";
  expect(
    leaseToken.length >= 8 && leaseToken !== "<main-controller-issued-token>",
    "main-controller G2 D-child lease token is required after B releases the child",
  ).toBe(true);
  const expectedDatabase = process.env.G2_CHILD_DATABASE?.trim() ?? "";
  expect(expectedDatabase, "G2_CHILD_DATABASE must bind the exact leased child DB").toBe(
    "nexion_acceptance_20260729_114336_d",
  );
  const child = JSON.parse(readFileSync(G2_CHILD_RESOURCES_PATH, "utf8")) as ChildResources;
  const handoff = readFileSync(G2_CHILD_HANDOFF_PATH, "utf8");
  expect(handoff).toContain("Existing disposable DB: `nexion_acceptance_20260729_114336_d`");
  expect(handoff).toContain("currently leased by B");
  expect(child.runId).toBe("pc-full-acceptance-20260729-114336-D");
  expect(child.database).toBe(expectedDatabase);
  expect(child.redisDatabase).toBe(14);
  expect(child.minioBucket).toBe("nexion-acc-20260729-114336-d");
  expect(child.jarSha256).toMatch(/^[A-F0-9]{64}$/);
  expect(child.pcBuildId).not.toBe("");

  const backend = new URL(BACKEND);
  const admin = new URL(process.env.ADMIN_BASE_URL ?? "");
  expect(["127.0.0.1", "localhost"]).toContain(backend.hostname);
  expect(["127.0.0.1", "localhost"]).toContain(admin.hostname);
  expect(backend.port, "G2 disposable child must not use the shared 8110 backend").not.toBe("8110");
  expect(Number(backend.port)).toBe(child.backendPort);
  expect(Number(admin.port)).toBe(child.pcPort);
  return child;
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
  return await okData(await page.request.get(`${BACKEND}${path}`, { headers: TRUSTED_EDGE_HEADERS }));
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

function monitorFailures(page: Page) {
  const pageErrors: string[] = [];
  const unexpectedConsoleErrors: string[] = [];
  const api5xx: string[] = [];
  const requestFailures: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location().url;
    const expectedAnonymousSessionProbe =
      location.endsWith("/api/admin/auth/session")
      && message.text().includes("401 (Unauthorized)");
    if (!expectedAnonymousSessionProbe) unexpectedConsoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/admin/") && response.status() >= 500) {
      api5xx.push(`${response.status()} ${response.request().method()} ${pathname}`);
    }
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/admin/market/exchange")
      || pathname === "/api/config/exchange/caps") {
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
