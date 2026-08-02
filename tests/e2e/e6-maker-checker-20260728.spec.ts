import { createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type ApiEnvelope<T = unknown> = { code?: number; message?: string; data?: T };
type E6Config = {
  download: {
    url: string;
    zhTitle: string;
    zhGuide: string;
    enTitle: string;
    enGuide: string;
  };
};

const RUN_ID = process.env.E6_RUN_ID?.trim() || "pc-full-acceptance-20260729-114336";
const BUILD_ID = process.env.E6_BUILD_ID?.trim() || "xNJR-cEeID2fPRwrRvOrb";
const FRONTEND_BUILD_ID_PATH = process.env.E6_BUILD_ID_PATH
  || path.resolve(".next/BUILD_ID");
const JAR_SHA256 =
  process.env.E6_JAR_SHA256?.trim()
  || "B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B";
const MARKER = process.env.E6_MARKER?.trim() || ` [${RUN_ID.slice(-12)}-E6]`;
const CHECKER_MANIFEST_PATH =
  process.env.FINAL_FIXTURE_MANIFEST_PATH
  || process.env.E6_CHECKER_MANIFEST_PATH
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/final7-domain-permission-refresh/E-final7-permission-manifest.json`;
const BACKEND_JAR_PATH =
  process.env.E6_BACKEND_JAR_PATH
  || "D:/workspace/nexion-backend/target/nexion-backend-0.0.1-SNAPSHOT.jar";
const EVIDENCE_DIR =
  process.env.E6_MAKER_CHECKER_EVIDENCE_DIR
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/final2-${BUILD_ID}/e6-maker-checker`;
const CROSS_DOMAIN_OPERATION_ID = process.env.E6_CROSS_DOMAIN_OPERATION_ID?.trim() || "";
const SKIP_CROSS_DOMAIN_WRITE = process.env.E6_SKIP_CROSS_DOMAIN_WRITE === "1";
const checkerManifest = (existsSync(CHECKER_MANIFEST_PATH)
  ? JSON.parse(readFileSync(CHECKER_MANIFEST_PATH, "utf8"))
  : {}) as {
  runId?: string;
  accounts?: {
    maker?: Account & { roleCode?: string };
    secondWriter?: Account & { roleCode?: string };
  };
  checker?: Account & { roleCode?: string };
  checkerRole?: { roleCode?: string };
  secondWriterRole?: { roleCode?: string };
};
const makerAccount = checkerManifest.accounts?.maker;
const checkerAccount = checkerManifest.checker;
const secondWriterAccount = checkerManifest.accounts?.secondWriter;
const expectedCheckerRole =
  process.env.E_FINAL_CHECKER_ROLE_CODE?.trim()
  || checkerManifest.checkerRole?.roleCode
  || "";
const expectedSecondWriterRole =
  process.env.E_FINAL_SECOND_WRITER_ROLE_CODE?.trim()
  || checkerManifest.secondWriterRole?.roleCode
  || "";
const expectedCheckerAuthorities = [
  "platform_a2_read",
  "platform_a2_operation_approve",
  "device_e3_read",
  "device_e6_read",
];
const expectedCheckerMenus = ["A2", "E", "E3", "E6"];
const expectedSecondWriterAuthorities = [
  "device_e3_read",
  "device_e3_write",
  "device_e6_read",
  "device_e6_write",
];
const expectedSecondWriterMenus = ["E", "E3", "E6"];

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  expect(RUN_ID).toBe("pc-full-acceptance-20260729-114336");
  expect(readFileSync(FRONTEND_BUILD_ID_PATH, "utf8").trim()).toBe(BUILD_ID);
  expect(JAR_SHA256).toMatch(/^[0-9A-F]{64}$/);
  expect(createHash("sha256").update(readFileSync(BACKEND_JAR_PATH)).digest("hex").toUpperCase())
    .toBe(JAR_SHA256);
  expect(makerAccount, "dedicated E maker fixture is required").toBeTruthy();
  expect(checkerAccount, "independent checker fixture is required").toBeTruthy();
  expect(secondWriterAccount, "accounts.secondWriter is required in the E fixture").toBeTruthy();
  expect(checkerManifest.runId ?? RUN_ID).toBe(RUN_ID);
  expect(checkerAccount?.roleCode, "new E-only checker manifest is required").toBe(expectedCheckerRole);
  expect(secondWriterAccount?.roleCode).toBe(expectedSecondWriterRole);
  expect(new Set([makerAccount!.username, checkerAccount!.username, secondWriterAccount!.username]).size).toBe(3);
  if (!SKIP_CROSS_DOMAIN_WRITE) {
    expect(CROSS_DOMAIN_OPERATION_ID, "known cross-domain operation ID is required").toMatch(/^WO-/);
  }
});

test("E6 独立 maker/checker 双语文案临时写入、A2 批准与精确恢复", async ({ browser }) => {
  test.setTimeout(240_000);
  const maker = await browser.newContext();
  const checker = await browser.newContext();
  const secondWriter = await browser.newContext();
  const makerPage = await maker.newPage();
  const checkerPage = await checker.newPage();
  const secondWriterPage = await secondWriter.newPage();
  const makerErrors = monitorErrors(makerPage);
  const checkerErrors = monitorErrors(checkerPage);
  let original: E6Config | undefined;
  let rejectOperationId = "";
  let changeOperationId = "";
  let restoreOperationId = "";
  let changeTerminal = false;
  let restoreTerminal = false;
  let cleanupError = "";

  try {
    await login(makerPage, makerAccount!, "e-maker");
    await login(checkerPage, checkerAccount!, "e-checker");
    await login(secondWriterPage, secondWriterAccount!, "e-second-writer");
    await assertEOnlyCheckerSession(checkerPage);
    await assertEOnlyCheckerSidebar(checkerPage);
    await assertEOnlySecondWriterSession(secondWriterPage);
    original = await readE6(makerPage);
    expect(original.download.zhGuide).not.toContain(MARKER);
    const changed = { ...original.download, zhGuide: `${original.download.zhGuide}${MARKER}` };

    await openE6FromSidebar(makerPage);
    await openA2(checkerPage);
    const crossDomainApprove = SKIP_CROSS_DOMAIN_WRITE
      ? { status: 0, body: {} as ApiEnvelope, skipped: true, reason: "scoped-write-lock" }
      : await rawDecision(
        checkerPage,
        CROSS_DOMAIN_OPERATION_ID,
        "approve",
        `${RUN_ID} E checker 跨域批准必须失败关闭`,
        `${RUN_ID}-e6-cross-${CROSS_DOMAIN_OPERATION_ID}`,
      );
    const unknownApprove = await rawDecision(
      checkerPage,
      "WO-000000000000000-404",
      "approve",
      `${RUN_ID} E checker 未知工单必须策略前置失败关闭`,
      `${RUN_ID}-e6-unknown-WO-000000000000000-404`,
    );
    writeFileSync(path.join(EVIDENCE_DIR, "00-a2-prewrite-gate.json"), JSON.stringify({
      runId: RUN_ID,
      candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256 },
      crossDomainOperationId: CROSS_DOMAIN_OPERATION_ID,
      crossDomainApprove,
      unknownApprove,
      successfulBusinessWrites: 0,
    }, null, 2));
    if (!SKIP_CROSS_DOMAIN_WRITE) {
      expect(crossDomainApprove.status).toBe(403);
      expect(crossDomainApprove.body.code).toBe(403);
    }
    expect(unknownApprove.status).toBe(403);
    expect(unknownApprove.body.code).toBe(403);

    rejectOperationId = await submitDownloadCopy(
      makerPage,
      changed,
      `${RUN_ID} E6 maker 先提交驳回探针验证无副作用和对象解锁`,
    );
    await rejectThroughA2(
      checkerPage,
      rejectOperationId,
      `${RUN_ID} checker 驳回 E6 探针并确认原值不变`,
    );
    expect((await readE6(checkerPage)).download).toEqual(original.download);

    changeOperationId = await submitDownloadCopy(
      makerPage,
      changed,
      `${RUN_ID} E6 maker 临时双语文案并预置精确回滚`,
    );
    await makerPage.screenshot({ path: path.join(EVIDENCE_DIR, "01-maker-pending.png"), fullPage: true });

    const directWritePayload = {
      values: {
        "E.compute.download.zhTitle": changed.zhTitle,
        "E.compute.download.zhGuide": changed.zhGuide,
        "E.compute.download.enTitle": changed.enTitle,
        "E.compute.download.enGuide": changed.enGuide,
      },
      reason: `${RUN_ID} pending E6 工单期间直写必须失败关闭`,
      operator: "server-authenticated",
    };
    const secondWriterDirectWrite = await secondWriterPage.request.patch("/api/admin/devices/compute-config/params", {
      headers: { "Idempotency-Key": `${RUN_ID}-e6-second-writer-pending-${randomUUID()}` },
      data: directWritePayload,
    });
    const secondWriterDirectWriteBody = await secondWriterDirectWrite.json().catch(() => ({})) as ApiEnvelope;
    expect(secondWriterDirectWrite.status() === 409 || secondWriterDirectWriteBody.code === 409).toBe(true);

    const checkerDirectWrite = await checkerPage.request.patch("/api/admin/devices/compute-config/params", {
      headers: { "Idempotency-Key": `${RUN_ID}-e6-checker-direct-pending-${randomUUID()}` },
      data: directWritePayload,
    });
    expect(checkerDirectWrite.status()).toBe(403);

    const makerDirectWrite = await makerPage.request.patch("/api/admin/devices/compute-config/params", {
      headers: { "Idempotency-Key": `${RUN_ID}-e6-maker-direct-pending-${randomUUID()}` },
      data: directWritePayload,
    });
    const makerDirectWriteBody = await makerDirectWrite.json().catch(() => ({})) as ApiEnvelope;
    expect(makerDirectWrite.status() === 409 || makerDirectWriteBody.code === 409).toBe(true);

    const selfApprove = await makerPage.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(changeOperationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-e6-maker-self-approve-${randomUUID()}` },
        data: { reason: `${RUN_ID} maker 不得自批 E6 工单` },
      },
    );
    const selfApproveBody = await selfApprove.json().catch(() => ({})) as ApiEnvelope;
    expect(selfApprove.status() === 403 || selfApproveBody.code === 403).toBe(true);

    await approveThroughA2(
      checkerPage,
      changeOperationId,
      `${RUN_ID} checker 核对 E6 临时文案与回滚预案后批准`,
    );
    changeTerminal = true;
    const applied = await readE6(checkerPage);
    expect(applied.download.zhGuide).toBe(changed.zhGuide);
    const replay = await rawDecision(
      checkerPage,
      changeOperationId,
      "approve",
      `${RUN_ID} checker 对相同已批准 E6 工单执行终态重放`,
      `${RUN_ID}-e6-terminal-replay-${changeOperationId}`,
    );
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe(409);
    expect(replay.body.message).toBe("A2_OPERATION_ALREADY_TERMINAL");
    expect((await readE6(checkerPage)).download).toEqual(changed);
    await openE6FromSidebar(makerPage);
    await makerPage.reload({ waitUntil: "domcontentloaded" });
    await expect(makerPage.getByText(changed.zhGuide, { exact: true })).toBeVisible();
    await makerPage.screenshot({ path: path.join(EVIDENCE_DIR, "02-approved-visible.png"), fullPage: true });

    restoreOperationId = await submitDownloadCopy(
      makerPage,
      original.download,
      `${RUN_ID} E6 maker 按原始快照精确恢复双语文案`,
    );
    await approveThroughA2(
      checkerPage,
      restoreOperationId,
      `${RUN_ID} checker 核对 E6 原始快照后批准恢复`,
    );
    restoreTerminal = true;
    const restored = await readE6(checkerPage);
    expect(restored.download).toEqual(original.download);
    await makerPage.reload({ waitUntil: "domcontentloaded" });
    await expect(makerPage.getByText(original.download.zhGuide, { exact: true })).toBeVisible();
    await expect(makerPage.getByText(changed.zhGuide, { exact: true })).toHaveCount(0);

    const audit = await checkerPage.request.get(
      `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(changeOperationId)}&limit=200`,
    );
    const checkerA4Denied = await checkerPage.request.get("/api/admin/platform/events/overview");
    expect(audit.status()).toBe(200);
    expect(checkerA4Denied.status()).toBe(403);
    expect(makerErrors).toEqual([]);
    expect(checkerErrors).toEqual([]);
    await checkerPage.screenshot({ path: path.join(EVIDENCE_DIR, "03-checker-a2-restored.png"), fullPage: true });
    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
      runId: RUN_ID,
      candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256 },
      rejectOperationId,
      changeOperationId,
      restoreOperationId,
      maker: makerAccount!.username,
      checker: checkerAccount!.username,
      independentContexts: true,
      secondWriter: secondWriterAccount!.username,
      crossDomainApprove,
      unknownApprove,
      rejectedProbeNoSideEffect: true,
      changedVerified: true,
      terminalReplayRejected: {
        status: replay.status,
        code: replay.body.code,
        message: replay.body.message,
        noDuplicateSideEffect: true,
      },
      pendingWriteGates: {
        maker: makerDirectWrite.status(),
        secondWriter: secondWriterDirectWrite.status(),
        checker: checkerDirectWrite.status(),
        makerSelfApprove: selfApprove.status(),
      },
      restoredExact: true,
      a2AuditStatus: audit.status(),
      checkerA4DeniedStatus: checkerA4Denied.status(),
      a4OutboxEvidenceChannel: "main-authorized-db-channel-required",
      pageErrors: 0,
    }, null, 2));
  } finally {
    if (original) {
      try {
        if (restoreOperationId && !restoreTerminal) {
          const pendingRestore = await rawDecision(
            checkerPage,
            restoreOperationId,
            "approve",
            `${RUN_ID} E6 finally 完成已提交的精确恢复`,
            `${RUN_ID}-e6-finally-approve-${restoreOperationId}`,
          );
          if (pendingRestore.status === 200 && pendingRestore.body.code === 0) restoreTerminal = true;
        }
        if (changeOperationId && !changeTerminal) {
          await rejectByApi(
            checkerPage,
            changeOperationId,
            `${RUN_ID} E6 finally 驳回未执行工单并释放对象锁`,
          );
        }
        if (rejectOperationId) {
          await rejectByApi(
            checkerPage,
            rejectOperationId,
            `${RUN_ID} E6 finally 确保驳回探针终态`,
          );
        }
        let current = await readE6(checkerPage);
        if (!sameDownload(current.download, original.download)) {
          restoreOperationId = await submitDownloadCopy(
            makerPage,
            original.download,
            `${RUN_ID} E6 finally 按原始快照精确恢复`,
          );
          await approveThroughA2(
            checkerPage,
            restoreOperationId,
            `${RUN_ID} E6 finally checker 批准精确恢复`,
          );
          restoreTerminal = true;
          current = await readE6(checkerPage);
        }
        expect(current.download, "E6 finally must restore the exact original download snapshot")
          .toEqual(original.download);
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
      }
    }
    if (cleanupError) {
      writeFileSync(path.join(EVIDENCE_DIR, "cleanup-error.json"), JSON.stringify({
        runId: RUN_ID,
        changeOperationId,
        restoreOperationId,
        cleanupError,
      }, null, 2));
    }
    await maker.close();
    await checker.close();
    await secondWriter.close();
    expect(cleanupError, "E6 emergency cleanup must succeed").toBe("");
  }
});

async function submitDownloadCopy(page: Page, values: E6Config["download"], reason: string) {
  await openE6FromSidebar(page);
  await page.getByRole("button", { name: "编辑双语文案", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("中文标题", { exact: true }).fill(values.zhTitle);
  await dialog.getByLabel("中文说明", { exact: true }).fill(values.zhGuide);
  await dialog.getByLabel("英文标题", { exact: true }).fill(values.enTitle);
  await dialog.getByLabel("英文说明", { exact: true }).fill(values.enGuide);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  const data = await apiSuccess<Record<string, unknown>>(response, "create E6 proposal");
  await expect(dialog).toHaveCount(0);
  const operationId = String(data.operationId ?? data.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  await decideThroughA2(page, operationId, reason, "执行", "approve", "已执行");
}

async function rejectThroughA2(page: Page, operationId: string, reason: string) {
  await decideThroughA2(page, operationId, reason, "取消", "reject", "已取消");
}

async function decideThroughA2(
  page: Page,
  operationId: string,
  reason: string,
  buttonName: "执行" | "取消",
  action: "approve" | "reject",
  successCopy: "已执行" | "已取消",
) {
  await openA2(page);
  const row = page.locator("tbody tr")
    .filter({ has: page.getByText(operationId, { exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: buttonName, exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  const endpoint = `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/${action}`;
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === endpoint);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await apiSuccess(response, `${action} ${operationId}`);
  await expect(page.getByText(`${operationId} ${successCopy}`, { exact: false })).toBeVisible();
}

async function openA2(page: Page) {
  const platform = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await platform.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "审计 & 操作确认", exact: true })).toBeVisible();
}

async function rawDecision(
  page: Page,
  operationId: string,
  action: "approve" | "reject",
  reason: string,
  idempotencyKey: string,
) {
  const response = await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/${action}`,
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { reason, operator: checkerAccount!.username },
    },
  );
  const body = await response.json().catch(() => ({})) as ApiEnvelope;
  return { status: response.status(), body };
}

async function rejectByApi(page: Page, operationId: string, reason: string) {
  const response = await rawDecision(
    page,
    operationId,
    "reject",
    reason,
    `${RUN_ID}-e6-finally-${operationId}`,
  );
  if (response.status === 200 && response.body.code === 0) return;
  if (response.status === 409 || response.body.code === 409) return;
  throw new Error(`reject ${operationId} failed: ${JSON.stringify(response)}`);
}

async function readE6(page: Page) {
  const response = await page.request.get("/api/admin/devices/compute-config");
  return apiSuccess<E6Config>(response, "read E6 config");
}

async function assertEOnlyCheckerSession(page: Page) {
  const session = await apiSuccess<{
    session?: {
      roleCode?: string;
      authorities?: string[];
      effectiveMenus?: Array<string | { code?: string }>;
    };
  }>(
    await page.request.get("/api/admin/auth/session"),
    "read E-only checker session",
  );
  const menuCodes = (session.session?.effectiveMenus ?? [])
    .map((item) => typeof item === "string" ? item : item.code ?? "");
  expect(session.session?.roleCode).toBe(expectedCheckerRole);
  expect(new Set(session.session?.authorities ?? [])).toEqual(new Set(expectedCheckerAuthorities));
  expect(new Set(menuCodes)).toEqual(new Set(expectedCheckerMenus));
}

async function assertEOnlySecondWriterSession(page: Page) {
  const session = await apiSuccess<{
    session?: {
      roleCode?: string;
      authorities?: string[];
      effectiveMenus?: Array<string | { code?: string }>;
    };
  }>(
    await page.request.get("/api/admin/auth/session"),
    "read E3/E6 second-writer session",
  );
  const menuCodes = (session.session?.effectiveMenus ?? [])
    .map((item) => typeof item === "string" ? item : item.code ?? "");
  expect(session.session?.roleCode).toBe(expectedSecondWriterRole);
  expect(new Set(session.session?.authorities ?? [])).toEqual(new Set(expectedSecondWriterAuthorities));
  expect(new Set(menuCodes)).toEqual(new Set(expectedSecondWriterMenus));
  expect(session.session?.authorities ?? []).not.toContain("platform_a2_operation_approve");
}

async function assertEOnlyCheckerSidebar(page: Page) {
  const sidebar = page.locator("aside");
  const expandSidebar = sidebar.getByRole("button", { name: "展开侧栏", exact: true });
  if (await expandSidebar.isVisible().catch(() => false)) await expandSidebar.click();

  await expect(sidebar.getByText("2 域 · 3 模块", { exact: true })).toBeVisible();
  const domainButtons = sidebar.locator('button[aria-controls^="nav-group-"]');
  await expect(domainButtons).toHaveCount(2);

  const platformButton = sidebar.locator('button[aria-controls="nav-group-A"]');
  const devicesButton = sidebar.locator('button[aria-controls="nav-group-E"]');
  await expect(platformButton).toBeVisible();
  await expect(devicesButton).toBeVisible();

  if (await platformButton.getAttribute("aria-expanded") !== "true") await platformButton.click();
  const platformMenu = sidebar.locator("#nav-group-A");
  await expect(platformMenu.locator("a")).toHaveCount(1);
  await expect(platformMenu.locator('a[href="/platform/audit"]')).toBeVisible();

  if (await devicesButton.getAttribute("aria-expanded") !== "true") await devicesButton.click();
  const devicesMenu = sidebar.locator("#nav-group-E");
  await expect(devicesMenu.locator("a")).toHaveCount(2);
  await expect(devicesMenu.locator('a[href="/devices/trade-in"]')).toBeVisible();
  await expect(devicesMenu.locator('a[href="/devices/compute-config"]')).toBeVisible();

  for (const forbiddenPath of [
    "/platform/rbac",
    "/platform/config",
    "/platform/events",
    "/platform/params-registry",
    "/platform/roles",
    "/platform/menus",
    "/platform/permissions",
    "/devices/pricing",
    "/devices/tasks",
    "/devices/orders",
    "/devices/ops",
  ]) {
    await expect(sidebar.locator(`a[href="${forbiddenPath}"]`)).toHaveCount(0);
  }
}

async function openE6FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  const link = page.locator('a[href="/devices/compute-config"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/compute-config$/);
  await expect(page.getByText("客户端下载配置", { exact: true }).first()).toBeVisible();
}

async function login(page: Page, account: Account, key: string) {
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sessionState = await classifyAuthSession(page);
    if (sessionState === "authenticated") {
      if (await isConsoleShellVisible(page, 20_000)) return;
      continue;
    }

    const username = page.locator('input[autocomplete="username"]');
    const password = page.locator('input[autocomplete="current-password"]');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await expect(password).toBeVisible({ timeout: 15_000 });
    await expect(username).toBeEditable();
    await expect(password).toBeEditable();
    await page.waitForTimeout(250);
    await expect(username).toBeVisible();
    await expect(password).toBeVisible();

    const stableSessionState = await classifyAuthSession(page);
    if (stableSessionState === "authenticated") {
      if (await isConsoleShellVisible(page, 20_000)) return;
      continue;
    }
    await username.fill(account.username);
    await password.fill(account.password);

    const loginButton = page.getByRole("button", { name: /继续|登录/ });
    const [loginResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/admin/auth/login"),
      loginButton.click(),
    ]);
    const loginPayload = await loginResponse.json().catch(() => null) as ApiEnvelope | null;
    expect(loginPayload?.code).toBe(0);

    const otp = page.getByLabel("一次性验证码");
    await Promise.race([
      consoleShell(page).waitFor({ state: "visible", timeout: 10_000 }),
      otp.waitFor({ state: "visible", timeout: 10_000 }),
    ]).catch(() => undefined);
    if (await isConsoleShellVisible(page, 500)) return;
    await expect(otp).toBeVisible();

    await otp.fill(await freshTotp(key, account.totpSecret));
    const [verifyResponse] = await Promise.all([
      page.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"),
      page.getByRole("button", { name: "验证并进入", exact: true }).click(),
    ]);
    const response = await verifyResponse;
    const payload = await response.json().catch(() => null) as ApiEnvelope | null;
    lastCode = payload?.code;
    if (response.status() === 200 && payload?.code === 0) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      if (await isConsoleShellVisible(page, 20_000)) return;
    }
  }
  throw new Error(`${key} shell unavailable after MFA code=${lastCode ?? "none"}`);
}

function consoleShell(page: Page) {
  return page.locator("aside").filter({ has: page.locator("nav") });
}

async function isConsoleShellVisible(page: Page, timeout: number) {
  const shell = consoleShell(page);
  const visible = await shell.waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
  if (visible) await expect(shell).toHaveCount(1);
  return visible;
}

async function classifyAuthSession(page: Page): Promise<"authenticated" | "anonymous"> {
  const response = await page.request.get("/api/admin/auth/session");
  const body = await response.json().catch(() => null) as ApiEnvelope | null;
  if (response.status() === 200 && body?.code === 0) return "authenticated";
  if (response.status() === 401) return "anonymous";
  throw new Error(`session classification failed: HTTP ${response.status()} ${JSON.stringify(body)}`);
}

async function apiSuccess<T>(
  response: Pick<Response, "ok" | "status" | "json">,
  label: string,
): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  expect(response.ok(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

function monitorErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function sameDownload(left: E6Config["download"], right: E6Config["download"]) {
  return left.url === right.url
    && left.zhTitle === right.zhTitle
    && left.zhGuide === right.zhGuide
    && left.enTitle === right.enTitle
    && left.enGuide === right.enGuide;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(key: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(key) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
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
