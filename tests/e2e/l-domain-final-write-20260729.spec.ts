import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = { accounts: { maker: FixtureAccount } };
type IsolatedL4Fixture = {
  fixtureLabel: string;
  runId: string;
  state: string;
  exportMasks: Array<{ edge: "AB" | "BC"; sponsor: string; member: string }>;
};
type Envelope<T> = { code?: number; message?: string; data?: T };
type ReportView = {
  reportId: string;
  name: string;
  type: string;
  rowCount: number;
  containsPii: boolean;
  maskingPolicy: string;
  status: string;
};
type CreatedReport = { created: ReportView; downloadPath?: string };
type NetworkTreeResult = {
  reportId: string;
  status: string;
  rowCount: number;
  scope: string;
  maskingPolicy: string;
  containsPii: boolean;
  downloadTokenPath: string;
};
type RuntimeReport = {
  module: string;
  reportId: string;
  idempotencyKey: string;
  objectKey: string;
  type: string;
  rowCount: number;
};
type RuntimeManifest = {
  probeId: string;
  actor: string;
  reports: RuntimeReport[];
  idempotency: Array<{ scope: string; key: string; outcome: string }>;
  l2?: Record<string, unknown>;
  l4?: Record<string, unknown>;
  l6?: Record<string, unknown>;
  candidate: {
    pcBuildId: string;
    pcPid: number;
    liveBuildAssetStatus?: number;
    backendJarSha256: string;
    backendPid: number;
  };
  databaseBaseline: { auditId: number; outboxId: number };
  browser: {
    pageErrors: string[];
    consoleErrors: string[];
    requestFailures: string[];
    unexpected5xx: string[];
    expectedFaults: string[];
  };
  outcome: { status: "RUNNING" | "PASSED" | "FAILED"; startedAt: string; finishedAt?: string; error?: string };
};

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const EXPECTED_WRITE_TOKEN = process.env.L_FINAL_EXPECTED_WRITE_TOKEN ?? "";
const FIXTURE_PATH = process.env.L_PERMISSION_FIXTURE_PATH;
const L4_FIXTURE_PATH = process.env.L4_ISOLATED_FIXTURE_MANIFEST_PATH;
const EVIDENCE_DIR = process.env.L_FINAL_EVIDENCE_DIR;
const PROBE_ID = process.env.L_FINAL_PROBE_ID ?? `pcfull-l-${Date.now()}`;
const AUDIT_BASELINE_ID = Number(process.env.L_FINAL_AUDIT_BASELINE_ID ?? "0");
const OUTBOX_BASELINE_ID = Number(process.env.L_FINAL_OUTBOX_BASELINE_ID ?? "0");
const EXPECTED_PC_BUILD_ID = process.env.L_FINAL_EXPECTED_PC_BUILD_ID ?? "";
const EXPECTED_PC_PID = Number(process.env.L_FINAL_EXPECTED_PC_PID ?? "0");
const BACKEND_JAR_PATH = process.env.L_FINAL_BACKEND_JAR_PATH ?? "";
const EXPECTED_BACKEND_JAR_SHA = (process.env.L_FINAL_EXPECTED_BACKEND_JAR_SHA256 ?? "").toUpperCase();
const EXPECTED_BACKEND_PID = Number(process.env.L_FINAL_EXPECTED_BACKEND_PID ?? "0");

if (!FIXTURE_PATH) throw new Error("L_PERMISSION_FIXTURE_PATH is required");
if (!L4_FIXTURE_PATH) throw new Error("L4_ISOLATED_FIXTURE_MANIFEST_PATH is required");
if (!EVIDENCE_DIR) throw new Error("L_FINAL_EVIDENCE_DIR is required");
if (!EXPECTED_WRITE_TOKEN) throw new Error("L_FINAL_EXPECTED_WRITE_TOKEN is required");
if (!EXPECTED_PC_BUILD_ID) throw new Error("L_FINAL_EXPECTED_PC_BUILD_ID is required");
if (!Number.isSafeInteger(EXPECTED_PC_PID) || EXPECTED_PC_PID < 1) {
  throw new Error("L_FINAL_EXPECTED_PC_PID must be a positive integer");
}
if (!BACKEND_JAR_PATH) throw new Error("L_FINAL_BACKEND_JAR_PATH is required");
if (!/^[0-9A-F]{64}$/.test(EXPECTED_BACKEND_JAR_SHA)) {
  throw new Error("L_FINAL_EXPECTED_BACKEND_JAR_SHA256 must be a SHA-256");
}
if (!Number.isSafeInteger(EXPECTED_BACKEND_PID) || EXPECTED_BACKEND_PID < 1) {
  throw new Error("L_FINAL_EXPECTED_BACKEND_PID must be a positive integer");
}
if (!Number.isSafeInteger(AUDIT_BASELINE_ID) || AUDIT_BASELINE_ID < 1) {
  throw new Error("L_FINAL_AUDIT_BASELINE_ID must be a positive integer");
}
if (!Number.isSafeInteger(OUTBOX_BASELINE_ID) || OUTBOX_BASELINE_ID < 1) {
  throw new Error("L_FINAL_OUTBOX_BASELINE_ID must be a positive integer");
}
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as PermissionFixture;
const isolatedL4Fixture = JSON.parse(readFileSync(L4_FIXTURE_PATH, "utf8")) as IsolatedL4Fixture;
if (
  isolatedL4Fixture.fixtureLabel !== "验收夹具、非产品路径"
  || isolatedL4Fixture.runId !== "pc-full-acceptance-20260729-114336"
  || isolatedL4Fixture.state !== "COMMITTED"
  || isolatedL4Fixture.exportMasks.length !== 2
) {
  throw new Error("isolated L4 fixture manifest identity/topology mismatch");
}
const owner = fixture.accounts.maker;
const manifestPath = path.join(EVIDENCE_DIR, "runtime-manifest.json");
const manifest: RuntimeManifest = {
  probeId: PROBE_ID,
  actor: owner.username,
  reports: [],
  idempotency: [],
  candidate: {
    pcBuildId: EXPECTED_PC_BUILD_ID,
    pcPid: EXPECTED_PC_PID,
    backendJarSha256: EXPECTED_BACKEND_JAR_SHA,
    backendPid: EXPECTED_BACKEND_PID,
  },
  databaseBaseline: { auditId: AUDIT_BASELINE_ID, outboxId: OUTBOX_BASELINE_ID },
  browser: {
    pageErrors: [],
    consoleErrors: [],
    requestFailures: [],
    unexpected5xx: [],
    expectedFaults: [],
  },
  outcome: { status: "RUNNING", startedAt: new Date().toISOString() },
};
let expectedL1ResponseLossActive = false;
let initialSessionProbeActive = true;
const initialAuthShellAbortPaths = new Set([
  "/api/admin/platform/audit/overview",
  "/api/admin/bi/overview",
  "/api/admin/emergency/kill-switches/alerts",
]);

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("L Owner 最终写入闭环：L1/L2 同源、L4/L5/L6 真实出口与空切片失败关闭", async ({ page }) => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(new URL(BASE_URL).port || "80").toBe("3002");
  expect(process.env.L_FINAL_WRITE_TOKEN).toBe(EXPECTED_WRITE_TOKEN);
  expect(process.env.L_FINAL_MFA_BYPASS).toBe("false");
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim()).toBe(EXPECTED_PC_BUILD_ID);
  expect(sha256(readFileSync(BACKEND_JAR_PATH))).toBe(EXPECTED_BACKEND_JAR_SHA);
  expect(() => process.kill(EXPECTED_PC_PID, 0), "锁定的 PC 进程必须存活").not.toThrow();
  expect(() => process.kill(EXPECTED_BACKEND_PID, 0), "锁定的后端进程必须存活").not.toThrow();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  persistManifest();

  page.on("pageerror", (error) => manifest.browser.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error"
      && expectedL1ResponseLossActive
      && /503|failed to load resource/i.test(message.text())
    ) {
      manifest.browser.expectedFaults.push(`console:${message.text()}`);
    } else if (
      message.type() === "error"
      && initialSessionProbeActive
      && new URL(message.location().url || BASE_URL, BASE_URL).pathname === "/api/admin/auth/session"
      && /401|unauthorized|failed to load resource/i.test(message.text())
    ) {
      manifest.browser.expectedFaults.push(
        `expected initial unauthenticated session probe:${message.text()}`,
      );
    } else if (message.type() === "error" && !isBenignConsoleMessage(message.text())) {
      manifest.browser.consoleErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (!pathname.startsWith("/api/admin/")) return;
    if (
      initialSessionProbeActive
      && request.failure()?.errorText === "net::ERR_ABORTED"
      && initialAuthShellAbortPaths.has(pathname)
    ) {
      manifest.browser.expectedFaults.push(
        `expected initial auth navigation cancellation:${request.method()} ${pathname}`,
      );
      return;
    }
    manifest.browser.requestFailures.push(
      `${request.method()} ${pathname}: ${request.failure()?.errorText ?? "unknown"}`,
    );
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/admin/") && response.status() >= 500) {
      if (pathname === "/api/admin/bi/reports" && response.status() === 503 && expectedL1ResponseLossActive) {
        manifest.browser.expectedFaults.push("503 POST /api/admin/bi/reports (injected committed-response loss)");
      } else {
        manifest.browser.unexpected5xx.push(`${response.status()} ${pathname}`);
      }
    }
  });

  try {
    await loginWithMfa(page, owner);
    initialSessionProbeActive = false;
    const liveBuild = await page.request.get(`/_next/static/${EXPECTED_PC_BUILD_ID}/_buildManifest.js`);
    manifest.candidate.liveBuildAssetStatus = liveBuild.status();
    persistManifest();
    expect(liveBuild.status(), "3002 必须服务锁定的 final2 Next build asset").toBe(200);

    await openFromSidebar(page, "/analytics/kpi");
    await expect(page.getByRole("heading", { name: "KPI 看板" })).toBeVisible();
    await expect(page.locator("button.kpi-card")).toHaveCount(8);
    await createL1WithUnknownResult(page);

    await openFromSidebar(page, "/analytics/funnel-cohort");
    const overview = await okData<{ stages: Array<{ key: string; count: number; source: string }> }>(
      await page.request.get("/api/admin/bi/funnel/overview"),
    );
    expect(overview.stages).toHaveLength(6);
    const expectedLabels: Record<string, string> = {
      registered: "已注册",
      profileCompleted: "已完善资料",
      ordered: "订单记录",
      walletActivity: "钱包活动",
    };
    expect(overview.stages.map((stage) => stage.key)).toEqual(Object.keys(expectedLabels));
    await expect(page.locator(".fn-row")).toHaveCount(6);
    expect(await page.locator(".fn-row .nm").allTextContents()).toEqual(
      overview.stages.map((stage) => expectedLabels[stage.key]),
    );
    const l2Report = await createL2FromVisibleUi(page, overview.stages, expectedLabels);
    await verifyL2Download(page, l2Report, overview.stages, expectedLabels);
    await verifyL2EmptySliceFailsClosed(page);

    await openFromSidebar(page, "/analytics/operations");
    await expect(page.getByText(/历史运营报表/).first()).toBeVisible();
    await createL4Aggregate(page);
    await verifyL4NetworkTreeDepthFromVisibleUi(page);

    await openFromSidebar(page, "/analytics/export");
    await expect(page.getByText(/数据出境统一管控面/).first()).toBeVisible();
    await createL5Regulatory(page);

    await openFromSidebar(page, "/analytics/behavior-heatmap");
    await expect(page.getByText(/用户行为热力图/).first()).toBeVisible();
    await exportL6Behavior(page);

    expect(manifest.browser.pageErrors).toEqual([]);
    expect(manifest.browser.consoleErrors).toEqual([]);
    expect(manifest.browser.requestFailures).toEqual([]);
    expect(manifest.browser.unexpected5xx).toEqual([]);
    manifest.outcome.status = "PASSED";
  } catch (error) {
    manifest.outcome.status = "FAILED";
    manifest.outcome.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    manifest.outcome.finishedAt = new Date().toISOString();
    persistManifest();
  }
});

async function createL1WithUnknownResult(page: Page) {
  const attempts: Array<{ key: string; body: string }> = [];
  let firstCommitted: CreatedReport | undefined;
  expectedL1ResponseLossActive = true;
  await page.route("**/api/admin/bi/reports", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    attempts.push({
      key: request.headers()["idempotency-key"] ?? "",
      body: request.postData() ?? "",
    });
    if (attempts.length === 1) {
      const committed = await route.fetch();
      firstCommitted = await okData<CreatedReport>(committed);
      recordReport("L1", firstCommitted.created, attempts[0].key);
      recordIdempotency("L_BI_REPORT_CREATE", attempts[0].key, "committed-then-response-replaced");
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "上游响应暂时不可用" }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "导出 KPI 序列 CSV", exact: true }).click();
  await expect(page.getByText(/KPI 序列已导出/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => attempts.length).toBe(2);
  await page.unroute("**/api/admin/bi/reports");
  expectedL1ResponseLossActive = false;
  expect(firstCommitted).toBeTruthy();
  expect(attempts[0].key).not.toBe("");
  expect(new Set(attempts.map((attempt) => attempt.key)).size).toBe(1);
  expect(new Set(attempts.map((attempt) => attempt.body)).size).toBe(1);
  expect(firstCommitted!.created).toMatchObject({
    type: "KPI_SERIES",
    rowCount: 8,
    containsPii: false,
    maskingPolicy: "NONE",
    status: "READY",
  });
  updateIdempotencyOutcome(
    "L_BI_REPORT_CREATE",
    attempts[0].key,
    "committed-then-503-retried-same-key",
  );
}

async function createL2FromVisibleUi(
  page: Page,
  stages: Array<{ key: string; count: number; source: string }>,
  labels: Record<string, string>,
) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/bi/reports"
      && response.status() < 500,
  );
  await page.getByRole("button", { name: "导出生命周期计数 CSV", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "导出", exact: true }).last().click();
  const response = await responsePromise;
  const created = await okData<CreatedReport>(response);
  const key = response.request().headers()["idempotency-key"] ?? "";
  const rawBody = response.request().postData() ?? "";
  expect(key).not.toBe("");
  recordReport("L2", created.created, key);
  recordIdempotency("L_BI_REPORT_CREATE", key, "created-from-visible-ui");
  expect(created.created).toMatchObject({
    type: "FUNNEL_COHORT",
    rowCount: 6,
    containsPii: false,
    maskingPolicy: "NONE",
    status: "READY",
  });
  expect(created.created.rowCount).toBeGreaterThan(0);
  expect(stages.map((stage) => labels[stage.key])).toHaveLength(created.created.rowCount);

  const body = JSON.parse(rawBody) as Record<string, unknown>;
  const replay = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": key },
    data: body,
  });
  const replayData = await okData<CreatedReport>(replay);
  expect(replayData.created.reportId).toBe(created.created.reportId);
  const conflict = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": key },
    data: { ...body, recipient: "同键异载荷必须冲突" },
  });
  expect(conflict.status()).toBe(409);
  manifest.l2 = {
    ...(manifest.l2 ?? {}),
    uiStages: stages,
    uiLabels: stages.map((stage) => labels[stage.key]),
    replayStatus: replay.status(),
    replayReportId: replayData.created.reportId,
    sameKeyDifferentPayloadStatus: conflict.status(),
  };
  persistManifest();
  return created.created;
}

async function verifyL2Download(
  page: Page,
  report: ReportView,
  stages: Array<{ key: string; count: number; source: string }>,
  labels: Record<string, string>,
) {
  const token = await okData<{ downloadToken: string; expiresAt: string }>(
    await page.request.get(`/api/admin/bi/exports/${report.reportId}/download-token`),
  );
  expect(token.downloadToken).not.toBe("");
  expect(Date.parse(token.expiresAt)).toBeGreaterThan(Date.now());
  const download = await page.request.get(
    `/api/admin/bi/exports/${report.reportId}/download?token=${encodeURIComponent(token.downloadToken)}`,
  );
  expect(download.status()).toBe(200);
  const bytes = await download.body();
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const payload = bytes.subarray(3);
  const rows = payload.toString("utf8").trim().split(/\r?\n/).map(parseCsvLine);
  expect(rows[0]).toEqual(["生命周期阶段", "数量", "数据来源"]);
  expect(rows.slice(1)).toHaveLength(6);
  expect(rows.slice(1).map((row) => row[0])).toEqual(stages.map((stage) => labels[stage.key]));
  expect(rows.slice(1).map((row) => Number(row[1]))).toEqual(stages.map((stage) => stage.count));
  expect(rows.slice(1).every((row) => !row[2].startsWith("nx_"))).toBe(true);

  const downloadPath = path.join(EVIDENCE_DIR!, `${report.reportId.toLowerCase()}-download-with-bom.csv`);
  const payloadPath = path.join(EVIDENCE_DIR!, `${report.reportId.toLowerCase()}-artifact-payload.csv`);
  writeFileSync(downloadPath, bytes);
  writeFileSync(payloadPath, payload);
  manifest.l2 = {
    ...(manifest.l2 ?? {}),
    reportId: report.reportId,
    download: {
      path: downloadPath,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      hasUtf8Bom: true,
    },
    artifactPayload: {
      path: payloadPath,
      sizeBytes: payload.length,
      sha256: sha256(payload),
      rowCount: rows.length - 1,
    },
    csvRows: rows,
  };
  persistManifest();
}

async function verifyL2EmptySliceFailsClosed(page: Page) {
  const key = `l2-empty-${PROBE_ID}-${randomUUID()}`;
  const ticket = `L2-EMPTY-${PROBE_ID}`;
  const response = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": key },
    data: {
      exportType: "漏斗生命周期事实",
      timeRange: "2099-W52",
      fields: "注册/资料/订单/钱包活动聚合计数",
      piiLevel: "NONE",
      maskPolicy: "NONE",
      recipient: "L2 空切片失败关闭验收",
      ticket,
      cohort: "2099-W52",
      phase: "P6",
      locale: "zz-ZZ",
      ref: `NO_MATCH_${PROBE_ID.replace(/[^A-Za-z0-9._:-]/g, "_")}`.slice(0, 90),
      reason: "L2 过滤后无数据必须失败关闭且不得生成报表审计或事件",
      operator: owner.username,
    },
  });
  const raw = await response.text();
  expect(response.status(), raw).toBe(422);
  const payload = JSON.parse(raw) as Envelope<unknown>;
  expect(payload.message).toBe("L2_EXPORT_EMPTY");
  recordIdempotency("L_BI_REPORT_CREATE", key, "422-L2_EXPORT_EMPTY");
  manifest.l2 = {
    ...(manifest.l2 ?? {}),
    emptySlice: { key, ticket, status: response.status(), message: payload.message },
  };
  persistManifest();
}

async function createL4Aggregate(page: Page) {
  const key = `l4-aggregate-${PROBE_ID}-${randomUUID()}`;
  const response = await page.request.post("/api/admin/bi/reports", {
    headers: { "Idempotency-Key": key },
    data: {
      exportType: "运营报表",
      timeRange: "period=week;phase=ALL",
      fields: "设备/任务/网络/Phase 历史聚合指标",
      piiLevel: "NONE",
      maskPolicy: "NONE",
      recipient: "L4 Owner 终验",
      ticket: `L4-OPS-${PROBE_ID}`,
      reason: "L4 聚合运营报表真实写入与同源快照终验",
      operator: owner.username,
    },
  });
  const created = await okData<CreatedReport>(response);
  recordReport("L4_AGG", created.created, key);
  recordIdempotency("L_BI_REPORT_CREATE", key, "created");
  expect(created.created).toMatchObject({ type: "OPERATIONS_AGG", status: "READY" });
  expect(created.created.rowCount).toBeGreaterThan(0);
}

async function verifyL4NetworkTreeDepthFromVisibleUi(page: Page) {
  await page.getByRole("tab", { name: "网络与团队报表", exact: true }).click();
  await expect(page.getByRole("button", { name: "导出团队明细", exact: true })).toBeEnabled();
  const depth1 = await createL4NetworkTreeFromVisibleUi(page, 1);
  await page.waitForTimeout(2_100);
  const depth2 = await createL4NetworkTreeFromVisibleUi(page, 2);
  const directFixtureEdges = isolatedL4Fixture.exportMasks
    .map((item) => `${item.member}|${item.sponsor}`)
    .sort();
  const ab = isolatedL4Fixture.exportMasks.find((item) => item.edge === "AB");
  const bc = isolatedL4Fixture.exportMasks.find((item) => item.edge === "BC");
  expect(ab, "fixture manifest must contain AB mask").toBeTruthy();
  expect(bc, "fixture manifest must contain BC mask").toBeTruthy();
  const transitiveFixtureEdge = `${bc!.member}|${ab!.sponsor}`;
  const expandedFixtureEdges = [...directFixtureEdges, transitiveFixtureEdge].sort();
  expect(depth1.fixtureEdges).toEqual(directFixtureEdges);
  expect(depth2.fixtureEdges).toEqual(expandedFixtureEdges);
  expect(depth1.fixtureRows.every((row) => row[2] === "1")).toBe(true);
  const transitiveRow = depth2.fixtureRows
    .find((row) => `${row[0]}|${row[1]}` === transitiveFixtureEdge);
  expect(transitiveRow, "depth=2 must add the derived A→C row").toBeTruthy();
  expect(transitiveRow!.slice(0, 5)).toEqual([
    bc!.member,
    ab!.sponsor,
    "2",
    "V0",
    "0.00",
  ]);
  manifest.l4 = {
    fixtureLabel: isolatedL4Fixture.fixtureLabel,
    topology: "A->B->C; level-1 adjacency only; no fabricated level-2 closure",
    directFixtureEdges,
    transitiveFixtureEdge,
    expandedFixtureEdges,
    depth1,
    depth2,
    repairVerified: true,
    closedDefect: "L-007",
  };
  persistManifest();
}

async function createL4NetworkTreeFromVisibleUi(page: Page, depth: 1 | 2) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/bi/export/network"
      && url.searchParams.get("depth") === String(depth);
  });
  await page.getByRole("button", { name: "导出团队明细", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("select").selectOption(String(depth));
  await dialog.locator("textarea").fill(
    `L4 depth=${depth} 三节点团队树明细范围、脱敏与审计专项复现`,
  );
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  const created = await okData<NetworkTreeResult>(response);
  const key = response.request().headers()["idempotency-key"] ?? "";
  expect(key).not.toBe("");
  recordReport("L4_TREE", {
    reportId: created.reportId,
    name: "网络/团队结构明细",
    type: "NETWORK_TREE",
    rowCount: created.rowCount,
    containsPii: created.containsPii,
    maskingPolicy: created.maskingPolicy,
    status: created.status,
  }, key);
  recordIdempotency("L4_NETWORK_TREE_EXPORT", key, "created");
  expect(created).toMatchObject({
    status: "READY",
    containsPii: true,
    maskingPolicy: "PARTIAL",
  });
  expect(created.reportId).toMatch(/^L4TREE-/);
  expect(created.rowCount).toBeGreaterThan(0);
  await expect(page.getByText(/团队明细已安全下载/)).toBeVisible({ timeout: 30_000 });

  const token = await okData<{ downloadToken: string; expiresAt: string }>(
    await page.request.get(`/api/admin/bi/exports/${created.reportId}/download-token`),
  );
  const download = await page.request.get(
    `/api/admin/bi/exports/${created.reportId}/download?token=${encodeURIComponent(token.downloadToken)}`,
  );
  expect(download.status()).toBe(200);
  const bytes = await download.body();
  const hasBom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const payload = hasBom ? bytes.subarray(3) : bytes;
  const rows = payload.toString("utf8").trim().split(/\r?\n/).map(parseCsvLine);
  expect(rows[0]).toEqual([
    "成员用户编码（部分脱敏）",
    "上级用户编码（部分脱敏）",
    "团队深度",
    "V-Rank",
    "团队GMV USDT",
    "加入时间",
  ]);
  const fixtureMaskedIds = new Set(
    isolatedL4Fixture.exportMasks.flatMap((item) => [item.member, item.sponsor]),
  );
  const fixtureRows = rows.slice(1).filter(
    (row) => fixtureMaskedIds.has(row[0]) && fixtureMaskedIds.has(row[1]),
  );
  const fixtureEdges = fixtureRows.map((row) => `${row[0]}|${row[1]}`).sort();
  expect(fixtureRows).toHaveLength(depth === 1 ? 2 : 3);
  expect(fixtureRows.every((row) => row[3] === "V0" && Number(row[4]) === 0)).toBe(true);
  const file = path.join(EVIDENCE_DIR!, `${created.reportId.toLowerCase()}-depth-${depth}.csv`);
  writeFileSync(file, bytes);
  return {
    depth,
    reportId: created.reportId,
    rowCount: created.rowCount,
    fixtureEdges,
    fixtureRows,
    csvPath: file,
    csvSha256: sha256(bytes),
    hasUtf8Bom: hasBom,
  };
}

async function createL5Regulatory(page: Page) {
  const options = await okData<{
    templates: Array<{ code: string; label: string }>;
    disclosures: Array<{
      jurisdictionCode: string;
      disclosureVersion: string;
      chapterCount: number;
    }>;
  }>(await page.request.get("/api/admin/regulatory/options"));
  expect(options.templates.length).toBeGreaterThan(0);
  expect(options.disclosures.length).toBeGreaterThan(0);
  expect(options.disclosures.every((item) => item.chapterCount === 7)).toBe(true);
  const template = options.templates[0];
  const disclosure = options.disclosures[0];
  const key = `l5-regulatory-${PROBE_ID}-${randomUUID()}`;
  const response = await page.request.post("/api/admin/regulatory/report", {
    headers: { "Idempotency-Key": key },
    data: {
      templateCode: template.code,
      period: "2026-07",
      jurisdictionCode: disclosure.jurisdictionCode,
      disclosureVersion: disclosure.disclosureVersion,
      recipient: "L5 Owner 终验",
      ticket: `L5-REG-${PROBE_ID}`,
      reason: "L5 监管报告按 I5 当前七章披露版本生成真实快照终验",
      operator: owner.username,
    },
  });
  const created = await okData<CreatedReport>(response);
  recordReport("L5", created.created, key);
  recordIdempotency("L5_REGULATORY_REPORT_CREATE", key, "created");
  expect(created.created).toMatchObject({
    type: "REGULATORY",
    status: "READY",
    containsPii: false,
    maskingPolicy: "MASKED",
  });
  expect(created.created.rowCount).toBeGreaterThan(0);
}

async function exportL6Behavior(page: Page) {
  const query = "window=7d&device=ALL&locale=ALL&depth=all&sort=pv";
  const behavior = await okData<Record<string, unknown>>(
    await page.request.get(`/api/admin/bi/behavior?${query}`),
  );
  const activity = Array.isArray(behavior.activity) ? behavior.activity : [];
  expect(activity.length).toBeGreaterThan(0);
  const startedAt = new Date().toISOString();
  const response = await page.request.get(`/api/admin/bi/export/behavior?${query}`);
  const finishedAt = new Date().toISOString();
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("text/csv");
  const bytes = await response.body();
  expect(bytes.length).toBeGreaterThan(0);
  const file = path.join(EVIDENCE_DIR!, "l6-behavior-7d-all.csv");
  writeFileSync(file, bytes);
  manifest.l6 = {
    query,
    startedAt,
    finishedAt,
    activityRows: activity.length,
    path: file,
    sizeBytes: bytes.length,
    sha256: sha256(bytes),
  };
  persistManifest();
}

function recordReport(module: string, created: ReportView, idempotencyKey: string) {
  if (!manifest.reports.some((report) => report.reportId === created.reportId)) {
    manifest.reports.push({
      module,
      reportId: created.reportId,
      idempotencyKey,
      objectKey: `bi-reports/${created.reportId.toLowerCase()}.csv`,
      type: created.type,
      rowCount: created.rowCount,
    });
  }
  persistManifest();
}

function recordIdempotency(scope: string, key: string, outcome: string) {
  if (!manifest.idempotency.some((item) => item.scope === scope && item.key === key)) {
    manifest.idempotency.push({ scope, key, outcome });
  }
  persistManifest();
}

function updateIdempotencyOutcome(scope: string, key: string, outcome: string) {
  const item = manifest.idempotency.find((candidate) => candidate.scope === scope && candidate.key === key);
  if (item) item.outcome = outcome;
  else manifest.idempotency.push({ scope, key, outcome });
  persistManifest();
}

function persistManifest() {
  mkdirSync(EVIDENCE_DIR!, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

async function openFromSidebar(page: Page, routePath: string) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator(`aside a[href="${routePath}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(routePath)}$`));
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
  }).toBe(true);
  if (!await aside.isVisible()) {
    await otp.fill(await freshTotp(account.totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(aside).toBeVisible({ timeout: 30_000 });
}

async function okData<T>(response: APIResponse | Response) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

function parseCsvLine(line: string) {
  const fields: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
    } else {
      field += character;
    }
  }
  fields.push(field);
  return fields;
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function isBenignConsoleMessage(message: string) {
  return /favicon|webpack-hmr|React DevTools/i.test(message);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
