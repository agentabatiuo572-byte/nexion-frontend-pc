import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";

const RUN_ID = process.env.RESTORE_ACCEPTANCE_RUN_ID ?? `RESTORE-${Date.now()}`;
const EVIDENCE_DIR = process.env.RESTORE_ACCEPTANCE_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/unreasonable-deletion-restoration-20260808/${RUN_ID}`;
const MYSQL = process.env.NEXION_MYSQL_BIN ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_PASSWORD = process.env.RESTORE_MYSQL_PASSWORD ?? "";
const B3_FIXTURE_MARKER = `RESTORE-B3-${RUN_ID.replace(/[^a-zA-Z0-9]/g, "").slice(-20)}`;
let lastTotpStep = -1;
let runEvidence: Record<string, unknown> = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  pages: [] as string[],
  buildIdentity: {
    frontendBuildId: process.env.RESTORE_FRONTEND_BUILD_ID ?? "not-provided",
    backendArtifactSha256: process.env.RESTORE_BACKEND_BUILD_SHA256 ?? "not-provided",
  },
  sourceHashes: Object.fromEntries([
    "app/components/dashboard/restored-b-insights.tsx",
    "app/_console/overview/b-page-header.tsx",
    "app/_console/overview/liquidity/page.tsx",
    "app/_console/overview/funnel/page.tsx",
    "app/_console/overview/rhythm/page.tsx",
    "app/_console/overview/risk-radar/page.tsx",
    "lib/admin/b5-pressure-summary.ts",
    "lib/admin/b5-client.ts",
    "lib/admin/b5-radar-contract.ts",
    "lib/admin/b34-overview-contract.ts",
    "lib/admin/b-restoration-contract.ts",
    "lib/admin/c3-adjustment-contract.ts",
    "lib/admin/cross-domain-authority.ts",
    "lib/admin/strict-number.ts",
    "lib/admin/time-series-contract.ts",
    "lib/admin/user360-client.ts",
    "lib/admin/authoritative-page-contract.ts",
    "lib/admin/f-overview-contract.ts",
    "app/components/domain-views/f-tabs/f5-audit.tsx",
    "app/components/domain-views/c-tabs/c3-adjust.tsx",
    "../nexion-backend/target/classes/ffdd/opsconsole/team/application/F5CommissionService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/team/mapper/F5CommissionMapper.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/treasury/application/OpsTreasuryService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/bi/application/OpsFunnelService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/risk/application/OpsRiskRadarService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/risk/mapper/B5RiskRadarMapper.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/risk/web/OpsRiskRadarController.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/treasury/facade/TreasuryCoverageSnapshot.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/treasury/application/TreasuryCoverageFacadeAdapter.class",
  ].map((path) => [path, sha256(join(process.cwd(), path))])),
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!DB_PASSWORD) throw new Error("RESTORE_MYSQL_PASSWORD is required for the isolated B3 acceptance fixture");
  setupB3Fixtures();
});

test.afterAll(() => {
  cleanupB3Fixtures();
  runEvidence.fixtureCleanupVerified = b3FixtureCount() === 0;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, "acceptance.json"), JSON.stringify(runEvidence, null, 2), "utf8");
});

test.afterEach(async ({}, testInfo) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  runEvidence.completedAt = new Date().toISOString();
  runEvidence.result = testInfo.status === testInfo.expectedStatus ? "PASS" : "FAIL";
  runEvidence.testStatus = testInfo.status;
  runEvidence.error = testInfo.error?.message;
  runEvidence.baseURL = testInfo.project.use.baseURL;
  writeFileSync(join(EVIDENCE_DIR, "acceptance.json"), JSON.stringify(runEvidence, null, 2), "utf8");
});

test("首次用户从可见菜单逐页看到恢复能力，筛选、刷新与重登保持真实", async ({ page, request }) => {
  test.setTimeout(240_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidence = runEvidence;
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const serverErrors: string[] = [];
  const unauthorizedResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("response", (response) => {
    if (response.status() === 401) unauthorizedResponses.push(new URL(response.url()).pathname);
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
  });

  const anonymousReads = await Promise.all([
    request.get("/api/admin/treasury/liquidity-history"),
    request.get("/api/admin/treasury/growth-flow-history"),
    request.get("/api/admin/funnel"),
    request.get("/api/admin/risk/radar"),
    request.get("/api/admin/teams/commissions?page=1&pageSize=5"),
    request.get("/api/admin/users/asset-adjustments?status=PENDING_REVIEW&pageNum=1&pageSize=5"),
  ]);
  expect(anonymousReads.map((response) => response.status())).toEqual([401, 401, 401, 401, 401, 401]);
  evidence.anonymousReadStatuses = anonymousReads.map((response) => response.status());

  await login(page);
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
  await assertAuthoritativeContracts(page, evidence);

  await openMenuPage(page, "总览驾驶舱", "资金池水位", "/overview/liquidity");
  await expect(page.getByTestId("b2-fund-flow-history")).toContainText("近 8 个窗口资金流入 / 流出");
  await expect(page.getByTestId("b2-monthly-inflow-history")).toContainText(/新增入金/);
  await expect(page.getByTestId("b2-maturity-chart")).toBeVisible();
  await expect(page.getByTestId("b2-liability-distribution")).toBeVisible();
  const zeroBars = page.getByTestId("b2-fund-flow-history").locator('[data-zero="true"]');
  for (let index = 0; index < await zeroBars.count(); index += 1) {
    expect(await zeroBars.nth(index).evaluate((element) => getComputedStyle(element).height), "零值不得画出非零柱体").toBe("0px");
  }
  await assertNoRestorationFallback(page);
  await shotLocator(page.getByTestId("b2-fund-flow-history"), "01a-b2-fund-flow.png");
  await shotLocator(page.getByTestId("b2-monthly-inflow-history"), "01b-b2-monthly-inflow.png");
  const b2WindowResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/treasury/maturity-forecast"
      && url.searchParams.get("window") === "30d";
  });
  await page.getByRole("group", { name: "到期预测窗口" }).getByRole("button", { name: "30 天" }).click();
  expect((await b2WindowResponse).status()).toBe(200);
  await expect(page.getByTestId("b2-maturity-chart")).toContainText("未来 30 日到期负债图");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("b2-fund-flow-history")).toBeVisible();
  (evidence.pages as string[]).push("B2");

  await openMenuPage(page, "总览驾驶舱", "转化漏斗", "/overview/funnel");
  await expect(page.getByTestId("b5-daily-first-purchase-conversion")).toContainText(/每日首购转化率[\s\S]*18%/);
  await expect(page.getByTestId("b7-first-purchase-channel-share")).toContainText("首购渠道来源占比");
  await expect(page.getByText("四级同用户漏斗")).toBeVisible();
  await expect(page.getByTestId("b3-stage")).toHaveCount(4);
  const b3StageResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/funnel"
      && url.searchParams.get("stage") === "repurchase";
  });
  await page.getByTestId("b3-stage").nth(2).click();
  const b3StagePayload = await (await b3StageResponse).json();
  expect(b3StagePayload.code).toBe(0);
  const cohortCard = page.getByTestId("b3-cohort-trend-chart");
  if (b3StagePayload.data.trend.length) {
    await expect(cohortCard.locator("svg")).toBeVisible();
  } else {
    await expect(page.getByTestId("b3-cohort-trend-empty")).toContainText("不绘制空曲线");
  }
  await shotLocator(page.getByTestId("b5-daily-first-purchase-conversion"), "02a-b3-daily-first-purchase.png");
  await shotLocator(page.getByTestId("b7-first-purchase-channel-share"), "02b-b3-channel-share.png");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("b5-daily-first-purchase-conversion")).toBeVisible();
  (evidence.pages as string[]).push("B3");

  await openMenuPage(page, "总览驾驶舱", "节奏状态", "/overview/rhythm");
  await expect(page.getByTestId("b3-growth-outflow-ratio")).toContainText(/新增 \/ 流出比趋势[\s\S]*1\.2/);
  await expect(page.getByTestId("b6-monthly-budget-allocation")).toContainText("本月运营预算分配");
  await expect(page.getByTestId("b7-rhythm-engine-decision")).toContainText("节奏引擎判定");
  const budgetCard = page.getByTestId("b6-monthly-budget-allocation");
  const budgetText = await budgetCard.innerText();
  expect(
    budgetText.includes("四类本月运营预算尚未配置完整，已保留渲染位并停止把其他财务科目冒充预算。")
      || budgetText.includes("本月预算\n"),
    "预算缺失时必须失败关闭；存在时必须来自四类权威配置",
  ).toBe(true);
  await shotLocator(page.getByTestId("b3-growth-outflow-ratio"), "03a-b4-ratio-decision.png");
  await shotLocator(page.getByTestId("b6-monthly-budget-allocation"), "03b-b4-budget.png");
  const b4GranularityResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/phase/overview"
      && url.searchParams.get("granularity") === "MONTH";
  });
  await page.getByLabel("分布粒度").selectOption("MONTH");
  expect((await b4GranularityResponse).status()).toBe(200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("b3-growth-outflow-ratio")).toBeVisible();
  (evidence.pages as string[]).push("B4");

  await openMenuPage(page, "总览驾驶舱", "风险雷达", "/overview/risk-radar");
  await expect(page.getByTestId("b1-withdraw-pressure-trend")).toContainText(/出金压力走势图[\s\S]*70% 红线/);
  const currentPressure = await apiData(page, "/api/admin/risk/radar");
  const latestPressureRatio = currentPressure.pressureHistory.at(-1)?.ratio;
  if (latestPressureRatio === null) {
    await expect(page.getByTestId("b1-withdraw-pressure-trend")).toContainText("当前 不可计算");
  } else {
    await expect(page.getByTestId("b1-withdraw-pressure-trend")).toContainText(`当前 ${(latestPressureRatio * 100).toFixed(1)}%`);
  }
  await expect(page.getByTestId("b4-alert-severity-distribution")).toContainText(/告警分布[\s\S]*P0[\s\S]*P1[\s\S]*P2[\s\S]*P3/);
  await expect(page.getByTestId("b4-alert-volume-history")).toContainText("近 7 天告警量");
  await expect(page.getByTestId("b5-recent-alert-feed")).toContainText(/最近告警队列[\s\S]*(前往分诊|近 7 天没有风险信号)/);
  await assertNoRestorationFallback(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("b1-withdraw-pressure-trend")).toBeVisible();
  await shotLocator(page.getByTestId("b1-withdraw-pressure-trend"), "04a-b5-pressure-refresh.png");
  await shotLocator(page.getByTestId("b4-alert-severity-distribution"), "04b-b5-alert-distribution.png");
  await shotLocator(page.getByTestId("b4-alert-volume-history"), "04c-b5-alert-volume.png");
  (evidence.pages as string[]).push("B5");

  await openMenuPage(page, "分销与团队", "佣金事件审计", "/network/commissions");
  await expect(page.getByTestId("f5-commission-kind-card")).toHaveCount(6);
  await expect(page.getByTestId("f5-status-distribution-item")).toHaveCount(5);
  await expect(page.getByTestId("f5-status-distribution-item")).toContainText(["已解锁", "冷却", "已提现", "已撤销", "已冻结"]);
  const firstKind = page.getByTestId("f5-commission-kind-card").filter({ hasText: /[1-9]\d*\s*笔/ }).first();
  await expect(firstKind).toBeVisible();
  const expectedKind = await firstKind.getAttribute("data-kind");
  expect(expectedKind).toBeTruthy();
  const kindCardCount = Number((await firstKind.innerText()).match(/(\d+)\s*笔/)?.[1]);
  expect(Number.isSafeInteger(kindCardCount) && kindCardCount > 0).toBe(true);
  const kindResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET" && url.pathname === "/api/admin/teams/commissions" && url.searchParams.get("kind") === expectedKind;
  });
  await firstKind.click();
  const filteredKindResponse = await kindResponse;
  expect(filteredKindResponse.status()).toBe(200);
  const filteredKindPayload = await filteredKindResponse.json();
  expect(filteredKindPayload.code).toBe(0);
  expect(filteredKindPayload.data.commissionEvents.length).toBeGreaterThan(0);
  expect(filteredKindPayload.data.commissionEvents.every((row: { kind: string }) => row.kind === expectedKind)).toBe(true);
  expect(filteredKindPayload.data.total).toBe(kindCardCount);
  const clearKindResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/teams/commissions"
      && !url.searchParams.has("kind");
  });
  await firstKind.click();
  expect((await clearKindResponse).status()).toBe(200);
  const firstStatus = page.getByTestId("f5-status-distribution-item").filter({ hasText: /[1-9]\d*\s*笔/ }).first();
  await expect(firstStatus).toBeVisible();
  const expectedStatus = await firstStatus.getAttribute("data-status");
  expect(expectedStatus).toBeTruthy();
  const statusCardCount = Number((await firstStatus.innerText()).match(/(\d+)\s*笔/)?.[1]);
  expect(Number.isSafeInteger(statusCardCount) && statusCardCount > 0).toBe(true);
  const statusResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/teams/commissions"
      && url.searchParams.get("status") === expectedStatus
      && !url.searchParams.has("kind");
  });
  await firstStatus.click();
  const filteredStatusResponse = await statusResponse;
  expect(filteredStatusResponse.status()).toBe(200);
  const filteredStatusPayload = await filteredStatusResponse.json();
  expect(filteredStatusPayload.code).toBe(0);
  expect(filteredStatusPayload.data.commissionEvents.length).toBeGreaterThan(0);
  expect(filteredStatusPayload.data.commissionEvents.every((row: { status: string }) => row.status === expectedStatus)).toBe(true);
  expect(filteredStatusPayload.data.total).toBe(statusCardCount);
  await shotLocator(page.getByRole("region", { name: "六类佣金支出与状态分布" }), "05-f5-filters.png");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("f5-commission-kind-card")).toHaveCount(6);
  await expect(page.getByTestId("f5-status-distribution-item")).toHaveCount(5);
  const cursorFirst = await apiData(page, "/api/admin/teams/commissions?limit=1");
  if (cursorFirst.total > 1) {
    expect(cursorFirst.nextCursor).toMatch(/^[1-9]\d*$/);
    const cursorSecond = await apiData(page, `/api/admin/teams/commissions?limit=1&cursor=${cursorFirst.nextCursor}`);
    expect(cursorSecond.pagination.requestCursor).toBe(cursorFirst.nextCursor);
    expect(cursorSecond.commissionEvents.map((row: { eventId: number }) => row.eventId))
      .not.toContain(cursorFirst.commissionEvents[0].eventId);
    evidence.f5CursorRoundTrip = { first: cursorFirst.commissionEvents[0].eventId, cursor: cursorFirst.nextCursor, second: cursorSecond.commissionEvents[0]?.eventId ?? null };
  } else {
    evidence.f5CursorRoundTrip = { skipped: true, reason: "authoritative total <= 1" };
  }
  const nextBatchButton = page.getByRole("button", { name: "下一批" });
  if (await nextBatchButton.count()) {
    const nextBatchResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === "GET"
        && url.pathname === "/api/admin/teams/commissions"
        && /^[1-9]\d*$/.test(url.searchParams.get("cursor") ?? "");
    });
    await nextBatchButton.click();
    const nextPayload = await (await nextBatchResponse).json();
    expect(nextPayload.code).toBe(0);
    expect(nextPayload.data.pagination.requestCursor).toBeTruthy();
  }
  await shotLocator(page.getByRole("region", { name: "六类佣金支出与状态分布" }), "05b-f5-refresh-stable.png");
  (evidence.pages as string[]).push("F5");

  await openMenuPage(page, "用户与账户", "检索 & 画像", "/users/search");
  const exportButton = page.getByRole("button", { name: "导出脱敏 CSV" });
  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  await expect(page.getByText("导出脱敏用户名单", { exact: true }).first()).toBeVisible();
  const confirmExport = page.getByRole("button", { name: "确认并导出" });
  await expect(confirmExport).toBeDisabled();
  await page.getByLabel(/操作理由/).fill("恢复误删除后真实导出闭环验收");
  await expect(confirmExport).toBeEnabled();
  const exportResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/users/profiles/export");
  await confirmExport.click();
  const exported = await exportResponse;
  expect(exported.status()).toBe(200);
  expect(exported.headers()["content-type"]).toContain("text/csv");
  expect(exported.headers()["content-disposition"]).toMatch(/\.csv/i);
  await expect(page.getByText(/已下载脱敏用户名单/)).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "导出脱敏 CSV" })).toBeEnabled();
  evidence.c1Export = "confirmed-reasoned-audited-download";
  (evidence.pages as string[]).push("C1");

  await openMenuPage(page, "用户与账户", "余额 & 资产调整", "/users/assets");
  await expect(page.getByText("待放行调整", { exact: true }).last()).toBeVisible();
  await expect(page.locator('[data-list-label="待放行调整队列"]')).toBeVisible();
  await expect(page.getByLabel("待放行调整队列 每页条数")).toHaveValue("5");
  const pageSizeResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/users/asset-adjustments"
      && url.searchParams.get("status") === "PENDING_REVIEW"
      && url.searchParams.get("pageNum") === "1"
      && url.searchParams.get("pageSize") === "10";
  });
  await page.getByLabel("待放行调整队列 每页条数").selectOption("10");
  expect((await pageSizeResponse).status()).toBe(200);
  await expect(page.locator('[data-list-label="待放行调整队列"]')).toContainText("第 1 /");
  await shotLocator(page.locator('[data-list-label="待放行调整队列"]'), "06-c3-request-pager.png");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-list-label="待放行调整队列"]')).toBeVisible();
  (evidence.pages as string[]).push("C3");

  await openMenuPage(page, "平台基础", "系统配置", "/platform/config");
  await expect(page.locator('[data-restored-capability="a3-global-rate-limit"]')).toContainText("当前不可读取、不可修改");
  await expect(page.locator('[data-restored-capability="a3-withdraw-strong-review-threshold"]')).toContainText("不得使用前端默认值");
  await expect(page.locator('[data-restored-capability^="a3-"] button')).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-restored-capability="a3-global-rate-limit"]')).toBeVisible();
  await openMenuPage(page, "平台基础", "埋点事件体系", "/platform/events");
  await expect(page.locator('[data-restored-capability="a4-event-lifecycle"]')).toContainText("新建");
  await expect(page.locator('[data-restored-capability="a4-event-lifecycle"]')).toContainText("停用");
  await expect(page.locator('[data-restored-capability="a4-event-lifecycle"] button')).toHaveCount(0);
  await shotLocator(page.locator('[data-restored-capability="a4-event-lifecycle"]'), "07-a3-a4-fail-closed.png");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-restored-capability="a4-event-lifecycle"]')).toBeVisible();
  (evidence.pages as string[]).push("A3", "A4");

  await page.getByRole("button", { name: /Super Admin|总管理员/ }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "运营控制台登录" })).toBeVisible();
  await login(page);
  await openMenuPage(page, "总览驾驶舱", "资金池水位", "/overview/liquidity");
  await expect(page.getByTestId("b2-fund-flow-history")).toBeVisible();
  await openMenuPage(page, "总览驾驶舱", "转化漏斗", "/overview/funnel");
  await expect(page.getByTestId("b5-daily-first-purchase-conversion")).toBeVisible();
  await openMenuPage(page, "总览驾驶舱", "节奏状态", "/overview/rhythm");
  await expect(page.getByTestId("b3-growth-outflow-ratio")).toBeVisible();
  await openMenuPage(page, "总览驾驶舱", "风险雷达", "/overview/risk-radar");
  await expect(page.getByTestId("b1-withdraw-pressure-trend")).toContainText("出金压力走势图");
  await assertNoRestorationFallback(page);
  await shotLocator(page.getByTestId("b1-withdraw-pressure-trend"), "08a-b5-relogin-stable.png");
  await openMenuPage(page, "分销与团队", "佣金事件审计", "/network/commissions");
  await expect(page.getByTestId("f5-commission-kind-card")).toHaveCount(6);
  await expect(page.getByTestId("f5-status-distribution-item")).toHaveCount(5);
  await shotLocator(page.getByRole("region", { name: "六类佣金支出与状态分布" }), "08b-f5-relogin-stable.png");
  await openMenuPage(page, "用户与账户", "检索 & 画像", "/users/search");
  await expect(page.getByRole("button", { name: "导出脱敏 CSV" })).toBeEnabled();
  await openMenuPage(page, "用户与账户", "余额 & 资产调整", "/users/assets");
  await expect(page.locator('[data-list-label="待放行调整队列"]')).toBeVisible();
  await openMenuPage(page, "平台基础", "系统配置", "/platform/config");
  await expect(page.locator('[data-restored-capability="a3-global-rate-limit"]')).toBeVisible();
  await openMenuPage(page, "平台基础", "埋点事件体系", "/platform/events");
  await expect(page.locator('[data-restored-capability="a4-event-lifecycle"]')).toBeVisible();

  evidence.consoleErrors = consoleErrors;
  evidence.failedRequests = failedRequests;
  evidence.serverErrors = serverErrors;
  evidence.unauthorizedResponses = unauthorizedResponses;
  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !message.includes("status of 401 (Unauthorized)"));
  const expectedNavigationAborts = failedRequests.filter((message) =>
    message.includes("net::ERR_ABORTED")
      && ((message.includes("/api/admin/risk/radar/stream"))
        || (message.includes("_rsc=") && !message.includes("/api/"))
        || message.includes("/api/admin/treasury/b-domain")
        || message.includes("/api/admin/platform/config/overview")));
  const unexpectedFailedRequests = failedRequests.filter((message) => !expectedNavigationAborts.includes(message));
  const unexpectedUnauthorized = unauthorizedResponses.filter((path) =>
    !["/api/admin/auth/session", "/api/admin/risk/radar/stream"].includes(path));
  evidence.unexpectedConsoleErrors = unexpectedConsoleErrors;
  evidence.expectedNavigationAborts = expectedNavigationAborts;
  evidence.unexpectedFailedRequests = unexpectedFailedRequests;
  evidence.unexpectedUnauthorizedResponses = unexpectedUnauthorized;
  expect(unexpectedConsoleErrors, "除登录/退出过渡 401 外，页面控制台不应出现错误").toEqual([]);
  expect(unexpectedFailedRequests, "导航或 SSE 主动中止以外，不应出现请求失败").toEqual([]);
  expect(unexpectedUnauthorized, "登录后业务接口不得出现越权 401").toEqual([]);
  expect(serverErrors, "页面不应出现 5xx").toEqual([]);
});

test("畸形 200 必须失败关闭，恢复真实契约后不保留伪零", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.route("**/api/admin/teams/commissions**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      code: 0,
      data: { summary: {}, commissionKinds: [], commissionFilters: [], commissionEvents: [], statusDistribution: [], pagination: {} },
    }) });
  });
  await page.goto("/network/commissions", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/权威快照不可用|加载失败/)).toBeVisible();
  await expect(page.getByTestId("f5-commission-kind-card")).toHaveCount(0);
  await shotLocator(page.getByText(/权威快照不可用|加载失败/).first(), "09-f5-malformed-fail-closed.png");

  await page.unroute("**/api/admin/teams/commissions**");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByTestId("f5-commission-kind-card")).toHaveCount(6);
  await expect(page.getByTestId("f5-status-distribution-item")).toHaveCount(5);
  await shotLocator(page.getByRole("region", { name: "六类佣金支出与状态分布" }), "10-f5-contract-recovered.png");
  runEvidence.failureRecovery = "malformed-200-failed-closed-then-authoritative-retry-pass";
});

async function login(page: Page) {
  const username = process.env.ADMIN_E2E_USERNAME;
  const password = process.env.ADMIN_E2E_PASSWORD;
  if (!username || !password) throw new Error("ADMIN_E2E_USERNAME and ADMIN_E2E_PASSWORD are required");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible().catch(() => false)) return;
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);
  if (await page.getByLabel("一次性验证码").isVisible().catch(() => false)) {
    const secret = process.env.ADMIN_E2E_TOTP_SECRET;
    if (!secret) throw new Error("验收账号要求 MFA，但本轮未获得一次性验证码密钥，不能伪造登录成功");
    await page.getByLabel("一次性验证码").fill(await freshTotp(secret));
    const verifyResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入" }).click();
    expect((await verifyResponse).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible();
}

async function openMenuPage(page: Page, groupName: string, linkName: string, expectedPath: string) {
  const group = page.getByRole("button", { name: new RegExp(groupName) });
  await expect(group).toBeVisible();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.getByRole("link", { name: new RegExp(linkName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${expectedPath.replaceAll("/", "\\/")}$`));
}

async function assertNoRestorationFallback(page: Page) {
  await expect(page.getByText(/保留在页面，但当前角色没有|暂不可用：|未收到服务端权威趋势数据|服务端.*序列为空|服务端.*分布为空/)).toHaveCount(0);
}

async function assertAuthoritativeContracts(page: Page, evidence: Record<string, unknown>) {
  const b2 = await apiData(page, "/api/admin/treasury/liquidity-history");
  const b3 = await apiData(page, "/api/admin/funnel");
  const b4 = await apiData(page, "/api/admin/treasury/growth-flow-history");
  const b5 = await apiData(page, "/api/admin/risk/radar");
  const f5 = await apiData(page, "/api/admin/teams/commissions?limit=20");

  expect(b2.flowWindows).toHaveLength(8);
  expect(b2.monthlyNewDeposits).toHaveLength(8);
  expect(b3.dailyFirstPurchaseTargetPct).toBe(18);
  expect(b3.dailyFirstPurchase).toHaveLength(8);
  expect(b3.available).toBe(true);
  expect(b3.stages).toHaveLength(4);
  expect(b3.trend.length).toBeLessThanOrEqual(13);
  expect(b4.healthyRatio).toBe(1.2);
  expect(b4.ratioSeries).toHaveLength(8);
  expect(b5.pressureHistory).toHaveLength(8);
  expect(b5.bankrun.pressureCalculable).toBe(b5.bankrun.pressureRatio !== null);
  if (Number(b5.bankrun.ratioReserveUsdt) === 0) {
    expect(b5.bankrun.ratioCalculable).toBe(false);
    expect(b5.bankrun.ratio24h).toBeNull();
    expect(b5.bankrun.light).toBe(Number(b5.bankrun.ratioWithdraw24hUsdt) > 0 ? "red" : "unavailable");
  }
  for (const row of b5.pressureHistory) expect(row.ratio === null || Number.isFinite(Number(row.ratio))).toBe(true);
  expect(b5.alertSeverity.map((row: { level: string }) => row.level)).toEqual(["P0", "P1", "P2", "P3"]);
  expect(b5.alertVolume).toHaveLength(7);
  expect(Array.isArray(b5.recentAlerts)).toBe(true);
  if (Number(b5.coverage.ratioLiabilitiesUsdt) === 0) {
    expect(b5.coverage.ratio).toBeNull();
    expect(b5.coverage.light).toBe("unavailable");
  }
  expect(f5.commissionKinds).toHaveLength(6);
  expect(f5.statusDistribution).toHaveLength(5);
  expect(Number.isInteger(f5.summary.frozenCount)).toBe(true);
  const f5KindTotal = f5.commissionKinds.reduce((sum: number, row: { count: number }) => sum + row.count, 0);
  const f5StatusTotal = f5.statusDistribution.reduce((sum: number, row: { count: number }) => sum + row.count, 0);
  expect(f5KindTotal).toBe(f5StatusTotal);
  expect(f5.summary.monthlyCommissionSpend.count).toBe(f5KindTotal);
  expect(f5.summary.frozenCount).toBe(f5.statusDistribution.find((row: { name: string }) => row.name === "已冻结")?.count);
  evidence.contracts = {
    b2FlowWindows: b2.flowWindows.length,
    b2MonthlyDeposits: b2.monthlyNewDeposits.length,
    b3DailyTargetPct: b3.dailyFirstPurchaseTargetPct,
    b3DailyPoints: b3.dailyFirstPurchase.length,
    b4HealthyRatio: b4.healthyRatio,
    b4RatioPoints: b4.ratioSeries.length,
    b4BudgetAvailable: b4.budget.available,
    b5PressurePoints: b5.pressureHistory.length,
    b5SeverityLevels: b5.alertSeverity.map((row: { level: string }) => row.level),
    b5AlertDays: b5.alertVolume.length,
    b5PressureCalculable: b5.bankrun.pressureCalculable,
    b5RecentAlertCount: b5.recentAlerts.length,
    f5KindCount: f5.commissionKinds.length,
    f5StatusCount: f5.statusDistribution.length,
    f5FrozenCount: f5.summary.frozenCount,
  };
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function apiData(page: Page, path: string): Promise<any> {
  const response = await page.request.get(path);
  expect(response.status(), `${path} 应返回 200`).toBe(200);
  const payload = await response.json();
  expect(payload.code, `${path} 业务码`).toBe(0);
  return payload.data;
}

function setupB3Fixtures() {
  cleanupB3Fixtures();
  const actor = `${B3_FIXTURE_MARKER}-USER`;
  const cohort = "2026-W32";
  const rows = [
    ["auth.register_completed", "08:00:00"],
    ["store.viewed", "08:10:00"],
    ["checkout.completed", "09:00:00"],
    ["wallet.reinvest", "10:00:00"],
    ["withdraw.submitted", "11:00:00"],
  ].map(([eventName, time], index) => {
    const eventId = `${B3_FIXTURE_MARKER}-${index + 1}`;
    const authoritative = eventName === "store.viewed" ? 0 : 1;
    return `('${sql(eventId)}','RESTORE_ACCEPTANCE','${sql(actor)}','${sql(eventName)}','${sql(eventName)}','RESTORE',TIMESTAMP(CURRENT_DATE,'${time}'),'P1',0,'${cohort}',${authoritative},1,1,1,JSON_OBJECT('user_id','${sql(actor)}','ref','restore-e2e','source','restore-e2e','phase','P1','cohort','${cohort}','latency_sec',30),'PUBLISHED',0,NOW(),NOW(),NOW(),0)`;
  });
  mysql("INSERT INTO nx_event_outbox(event_id,aggregate_type,aggregate_id,event_type,event_name,family_key,event_ts,phase,account_age_months,cohort,is_server_authoritative,schema_revision,schema_registered,analytics_event,payload,status,retry_count,published_at,created_at,updated_at,is_deleted) VALUES " + rows.join(",") + ";");
  if (b3FixtureCount() !== rows.length) throw new Error("B3 acceptance fixture setup failed");
}

function cleanupB3Fixtures() {
  mysql(`DELETE FROM nx_event_outbox WHERE event_id LIKE '${sql(B3_FIXTURE_MARKER)}-%';`);
}

function b3FixtureCount() {
  return Number(mysql(`SELECT COUNT(*) FROM nx_event_outbox WHERE event_id LIKE '${sql(B3_FIXTURE_MARKER)}-%';`));
}

function mysql(statement: string) {
  return execFileSync(MYSQL, ["--default-character-set=utf8mb4", "-N", "-B", "-h", "127.0.0.1", "-uroot", "-D", "nexion", "-e", statement], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

async function shotLocator(locator: Locator, name: string) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({ path: join(EVIDENCE_DIR, name) });
}

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
