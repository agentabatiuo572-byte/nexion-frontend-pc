import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type Page } from "@playwright/test";
import {
  assertDedicatedLeafMenuContract,
  assertLocalFCandidate,
  currentFCaseNonce,
  currentFRunId,
  fAcceptanceIdempotencyKey,
  loadFDedicatedActors,
  loginFActor,
} from "./helpers/f-acceptance-harness";

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Ticket = { id?: string; operationId?: string; status?: string };
type F1Overview = { configValues?: Record<string, string> };
type Session = {
  roleCode?: string;
  authorities?: string[];
  effectiveMenus?: Array<string | { code?: string }>;
};
type UnknownTransportEvidence = {
  operationId: string;
  idempotencyKey: string;
  retryIdempotencyKey: string;
  alertText: string | null;
  retryHttpStatus: number;
  retryCode?: number;
  retryOperationId: string;
  violations: string[];
  requestBody: ReturnType<typeof proposal>;
  upstream: Envelope<Ticket>;
};

const RUN_ID = currentFRunId();
const CASE_NONCE = currentFCaseNonce();
const EVIDENCE_DIR = process.env.F_WRITE_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/maker-checker`;
const ACTORS = loadFDedicatedActors(RUN_ID);
const F_MAKER = ACTORS.fMaker;
const CHECKER = ACTORS.fChecker;
const A6_REVIEWER = ACTORS.a6Reviewer;
const CHANGED_VALUE = `Nexion V-Rank [${RUN_ID.replace(/[^A-Za-z0-9]/g, "").slice(-20)}]`;

test.beforeAll(() => {
  expect(process.env.F_WRITE_TOKEN, "F_WRITE_TOKEN=1 is required").toBe("1");
  expect(
    process.env.F_WRITE_BYPASS,
    "F_WRITE_BYPASS=false must be explicitly confirmed by the main controller",
  ).toBe("false");
  expect(process.env.F_DB_READ_TOKEN, "F_DB_READ_TOKEN=1 is required for DB/A4/outbox/D-B-L closure").toBe("1");
  assertLocalFCandidate();
  requireDatabaseGate();
  assertNoIdempotencyCollision();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("F1 专属 maker/checker、真实结果未知、对象锁、幂等、CAS、DB/A4/outbox/D-B-L 与精确恢复", async ({ browser }) => {
  test.setTimeout(300_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const a6Reviewer = await reviewerContext.newPage();
  const result: Record<string, unknown> = {
    runId: RUN_ID,
    caseNonce: CASE_NONCE,
    actors: {
      fMaker: F_MAKER.username,
      fChecker: CHECKER.username,
      a6Reviewer: A6_REVIEWER.username,
      credentialMaterialPersisted: false,
    },
  };
  const pendingOperationIds = new Set<string>();
  const operationIds = new Set<string>();
  let original = "";
  let changeOperationId = "";
  let primaryError: Error | undefined;

  try {
    await loginFActor(maker, F_MAKER, "f-maker");
    await loginFActor(checker, CHECKER, "f-only-checker");
    await loginFActor(a6Reviewer, A6_REVIEWER, "a6-reviewer");
    await assertFActorBoundary(maker, "maker");
    await assertFActorBoundary(checker, "checker");
    await assertA6ReviewerBoundary(a6Reviewer);

    original = await readPrizeName(maker);
    expect(original).not.toBe("");
    expect(original).not.toBe(CHANGED_VALUE);
    result.original = original;
    const databaseBefore = databaseEvidence([], original);
    expect(databaseBefore.configValue, "F1 API and DB must agree before mutation").toBe(original);
    result.databaseBefore = databaseBefore;

    changeOperationId = await submitPrizeThroughF1(
      maker,
      CHANGED_VALUE,
      `${RUN_ID} F1 maker 临时修改展示文案并预置精确回滚`,
    );
    pendingOperationIds.add(changeOperationId);
    operationIds.add(changeOperationId);
    result.changeOperationId = changeOperationId;
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "01-maker-pending.png"), fullPage: true });

    const selfApprove = await maker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(changeOperationId)}/approve`,
      {
        headers: { "Idempotency-Key": caseIdempotencyKey("f-self-approve") },
        data: { reason: `${RUN_ID} maker 不得自批` },
      },
    );
    const selfApproveBody = await envelope(selfApprove);
    expect(selfApprove.status() === 403 || selfApproveBody.code === 403).toBe(true);
    result.selfApprove = { http: selfApprove.status(), code: selfApproveBody.code };

    const a6CrossDomain = await a6Reviewer.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(changeOperationId)}/reject`,
      {
        headers: { "Idempotency-Key": caseIdempotencyKey("a6-reviewer-f-denied") },
        data: { reason: `${RUN_ID} A6 专属 reviewer 不得决定 F ticket` },
      },
    );
    const a6CrossDomainBody = await envelope(a6CrossDomain);
    expect(a6CrossDomain.status()).toBe(403);
    expect(a6CrossDomainBody.code).toBe(403);
    result.a6ReviewerCrossDomain = responseEvidence(a6CrossDomain, a6CrossDomainBody);

    const duplicate = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": caseIdempotencyKey("f-concurrent-object-duplicate") },
      data: proposal("F.prize.name", original, CHANGED_VALUE,
        `${RUN_ID} 同一对象并发提案必须由服务端对象锁拒绝`),
    });
    const duplicateBody = await envelope(duplicate);
    expect(duplicateBody.code).toBe(409);
    result.concurrentObjectLock = { http: duplicate.status(), code: duplicateBody.code, message: duplicateBody.message };

    await approveThroughA2(
      checker,
      changeOperationId,
      `${RUN_ID} checker 核对 F1 临时文案、影响范围和回滚预案后批准`,
    );
    pendingOperationIds.delete(changeOperationId);
    expect(await readPrizeName(checker)).toBe(CHANGED_VALUE);
    await openF1FromSidebar(maker);
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByText(CHANGED_VALUE, { exact: true }).first()).toBeVisible();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "02-approved-visible.png"), fullPage: true });

    const restoreOperationId = await submitPrizeThroughF1(
      maker,
      original,
      `${RUN_ID} F1 maker 按验收前快照精确恢复展示文案`,
    );
    pendingOperationIds.add(restoreOperationId);
    operationIds.add(restoreOperationId);
    result.restoreOperationId = restoreOperationId;
    await approveThroughA2(
      checker,
      restoreOperationId,
      `${RUN_ID} checker 核对原始快照后批准精确恢复`,
    );
    pendingOperationIds.delete(restoreOperationId);
    expect(await readPrizeName(checker)).toBe(original);

    const idemKey = caseIdempotencyKey("f-proposal-idempotency");
    const noopBody = proposal(
      "F.prize.name",
      original,
      original,
      `${RUN_ID} F1 幂等与终态竞争无副作用验收`,
    );
    const first = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": idemKey },
      data: noopBody,
    });
    const firstBody = await envelope<Ticket>(first);
    expect(firstBody.code).toBe(0);
    const noopOperationId = ticketId(firstBody);
    pendingOperationIds.add(noopOperationId);
    operationIds.add(noopOperationId);
    const retry = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": idemKey },
      data: noopBody,
    });
    const retryBody = await envelope<Ticket>(retry);
    expect(retryBody.code).toBe(0);
    expect(ticketId(retryBody)).toBe(noopOperationId);

    const mismatch = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": idemKey },
      data: { ...noopBody, reason: `${RUN_ID} 同键异载荷必须拒绝` },
    });
    const mismatchBody = await envelope(mismatch);
    expect(mismatchBody.code).toBe(409);

    const a6NoopDenied = await a6Reviewer.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(noopOperationId)}/approve`,
      {
        headers: { "Idempotency-Key": caseIdempotencyKey("a6-reviewer-f-noop-denied") },
        data: { reason: `${RUN_ID} A6 reviewer 对 F no-op 仍须失败关闭` },
      },
    );
    const a6NoopDeniedBody = await envelope(a6NoopDenied);
    expect(a6NoopDenied.status()).toBe(403);
    expect(a6NoopDeniedBody.code).toBe(403);

    const [approveRace, rejectRace] = await Promise.all([
      checker.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(noopOperationId)}/approve`,
        {
          headers: { "Idempotency-Key": caseIdempotencyKey("f-cas-approve") },
          data: { reason: `${RUN_ID} checker CAS 批准竞争` },
        },
      ),
      checker.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(noopOperationId)}/reject`,
        {
          headers: { "Idempotency-Key": caseIdempotencyKey("f-cas-reject") },
          data: { reason: `${RUN_ID} second checker CAS 驳回竞争` },
        },
      ),
    ]);
    const approveRaceBody = await envelope(approveRace);
    const rejectRaceBody = await envelope(rejectRace);
    const raceCodes = [approveRaceBody.code, rejectRaceBody.code].sort((a, b) => Number(a) - Number(b));
    expect(raceCodes).toEqual([0, 409]);
    pendingOperationIds.delete(noopOperationId);
    expect(await readPrizeName(checker)).toBe(original);
    result.idempotency = {
      key: idemKey,
      operationId: noopOperationId,
      retrySameOperation: true,
      mismatchCode: mismatchBody.code,
    };
    result.casRace = {
      approve: { http: approveRace.status(), code: approveRaceBody.code },
      reject: { http: rejectRace.status(), code: rejectRaceBody.code },
      exactlyOneTerminalWinner: true,
    };

    const unknown = await realUnknownProposal(maker, original, (operationId) => {
      pendingOperationIds.add(operationId);
      operationIds.add(operationId);
    });
    result.realResponseUnknown = {
      operationId: unknown.operationId,
      idempotencyKey: unknown.idempotencyKey,
      retryIdempotencyKey: unknown.retryIdempotencyKey,
      alertText: unknown.alertText,
      retryHttpStatus: unknown.retryHttpStatus,
      retryCode: unknown.retryCode,
      retryOperationId: unknown.retryOperationId,
      upstreamCommittedBeforeTransportLoss: true,
      sameKeyReplayReturnedSameOperation: unknown.retryIdempotencyKey === unknown.idempotencyKey
        && unknown.retryOperationId === unknown.operationId,
      violations: unknown.violations,
      request: {
        method: "POST",
        path: "/api/admin/platform/audit/operations",
        body: unknown.requestBody,
      },
    };
    const unknownCleanup = await decideByApi(
      checker,
      unknown.operationId,
      "reject",
      caseIdempotencyKey(`f-unknown-cleanup-${unknown.operationId}`),
      `${RUN_ID} 真实 response-unknown 同键核对后清理 no-op ticket`,
    );
    expect(unknownCleanup.body.code).toBe(0);
    pendingOperationIds.delete(unknown.operationId);

    const audit = await checker.request.get(
      `/api/admin/platform/audit/logs?object=${encodeURIComponent(changeOperationId)}&limit=200`,
    );
    expect(audit.status()).toBe(200);
    const auditBody = await audit.json();
    result.auditStatus = audit.status();
    result.auditContainsChangeOperation = JSON.stringify(auditBody).includes(changeOperationId);
    expect(result.auditContainsChangeOperation).toBe(true);

    const a4Denied = await checker.request.get("/api/admin/platform/events/overview");
    const a4DeniedBody = await envelope(a4Denied);
    expect(a4Denied.status()).toBe(403);
    expect(a4DeniedBody.code).toBe(403);
    result.a4LeastPrivilegeBoundary = responseEvidence(a4Denied, a4DeniedBody);

    const databaseAfter = databaseEvidence([...operationIds], original);
    expect(databaseAfter.configValue).toBe(original);
    expect(databaseAfter.operationTicketCount).toBe(operationIds.size);
    expect(
      databaseAfter.ticketRows.every((row) => String(row[1] ?? "").toUpperCase() !== "PENDING"),
      JSON.stringify(databaseAfter.ticketRows),
    ).toBe(true);
    expect(
      databaseAfter.ticketRows.every((row) => String(row[2] ?? "").toUpperCase().startsWith("F")),
      JSON.stringify(databaseAfter.ticketRows),
    ).toBe(true);
    expect(
      Object.values(databaseAfter.auditByOperation).every((count) => count > 0),
      JSON.stringify(databaseAfter.auditByOperation),
    ).toBe(true);
    const approvedF1OperationIds = [
      changeOperationId,
      restoreOperationId,
      noopOperationId,
    ];
    expect(databaseAfter.operationLinkedOutboxCount).toBe(approvedF1OperationIds.length);
    expect(
      approvedF1OperationIds.every((operationId) => databaseAfter.operationLinkedOutboxByOperation[operationId] === 1),
      JSON.stringify(databaseAfter.operationLinkedOutboxByOperation),
    ).toBe(true);
    expect(databaseAfter.operationLinkedOutboxByOperation[unknown.operationId]).toBe(0);
    expect(databaseAfter.d4WalletLedgerCount).toBe(0);
    expect(databaseAfter.b1ReserveLedgerCount).toBe(0);
    expect(databaseAfter.l4AnalyticsOutboxCount).toBe(0);
    result.databaseAfter = databaseAfter;
    result.a4OutboxBoundary = {
      expected: "each approved F1 UI-config operation has exactly one A2_OPERATION outbox record; rejected response-unknown cleanup has none and must not fabricate an L4 analytics event",
      operationLinkedOutboxCount: databaseAfter.operationLinkedOutboxCount,
      l4AnalyticsOutboxCount: databaseAfter.l4AnalyticsOutboxCount,
    };
    result.relatedDomains = {
      D4: databaseAfter.d4WalletLedgerCount,
      B1: databaseAfter.b1ReserveLedgerCount,
      L4: databaseAfter.l4AnalyticsOutboxCount,
      expectedAllZeroForF1PrizeName: true,
    };
    result.restoredExact = true;
    await openF1FromSidebar(maker);
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByText(original, { exact: true }).first()).toBeVisible();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "03-restored.png"), fullPage: true });
    expect(
      unknown.violations,
      `F_RESPONSE_UNKNOWN_CONTRACT_RED:${unknown.violations.join("|")}`,
    ).toEqual([]);
  } catch (error: unknown) {
    primaryError = asError(error);
    result.failure = {
      name: primaryError.name,
      message: primaryError.message,
    };
  } finally {
    const terminalErrors: Error[] = primaryError ? [primaryError] : [];
    await makerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await checkerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await reviewerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await independentFinally(browser, original, pendingOperationIds, result)
      .catch((error: unknown) => terminalErrors.push(asError(error)));
    try {
      writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(result, null, 2));
    } catch (error: unknown) {
      terminalErrors.push(asError(error));
    }
    if (terminalErrors.length) {
      throw new AggregateError(terminalErrors, "F owner lifecycle or independent finally failed");
    }
  }
});

async function submitPrizeThroughF1(page: Page, value: string, reason: string) {
  await openF1FromSidebar(page);
  await page.getByRole("button", { name: /修改奖品名|配置奖品名/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const body = await success<Ticket>(await responsePromise, "submit F1 proposal");
  await expect(dialog).toHaveCount(0);
  return String(body.id ?? body.operationId ?? "");
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr")
    .filter({ hasText: operationId })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await success(await responsePromise, `approve ${operationId}`);
  await expect(row).toHaveCount(0);
}

async function readPrizeName(page: Page) {
  const overview = await success<F1Overview>(
    await page.request.get("/api/admin/teams/ranks"),
    "read F1 overview",
  );
  return overview.configValues?.["F.prize.name"] ?? "";
}

async function openF1FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /分销与团队\s+F|F\s+分销与团队/ }).first();
  const link = page.locator('a[href="/network/v-rank"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/network\/v-rank$/);
  await expect(page.getByRole("heading", { name: "V-Rank 晋升", exact: true })).toBeVisible();
}

function proposal(key: string, before: string, after: string, reason: string) {
  return {
    action: `网络 UI 开关/文案配置 · ${key}`,
    obj: key,
    beforeValue: before,
    afterValue: after,
    operator: "server-authenticated",
    operatorRole: "增长",
    type: "param",
    amplifies: false,
    sos: false,
    roleGate: "门槛者",
    reason,
    sourceDomain: key.startsWith("F.binary.") || key.startsWith("F3.")
      ? "F3"
      : key.startsWith("F.pool.") || key.startsWith("F.quota.")
        || key.startsWith("F.ambassador.") || key.startsWith("F.leaderboard.")
        ? "F4"
        : key.startsWith("F.unilevel.") || key.startsWith("F.promo.")
          || key.startsWith("F.peer.") || key.startsWith("F.influence.")
          || key.startsWith("F.royalty.") || key === "F.cooldown"
          ? "F2"
          : "F1",
    command: { domain: "F", op: "f_ui_config", params: { key, value: after } },
    target: { domain: "F", type: "ui_config", id: key },
  };
}

function ticketId(body: Envelope<Ticket>) {
  const id = String(body.data?.id ?? body.data?.operationId ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function assertFActorBoundary(page: Page, label: string) {
  const data = await session(page);
  const authorities = data.authorities ?? [];
  expect(authorityDomains(authorities), `${label} must remain F-only`).toEqual(["F"]);
  expect(authorities, `${label} F1 read`).toContain("network_f1_read");
  if (label === "maker") {
    expect(authorities, "F maker write").toContain("network_f1_write");
  } else {
    expect(data.roleCode, "dedicated F checker role").toBe(ACTORS.fCheckerRoleCode);
    await assertDedicatedLeafMenuContract(page, data.effectiveMenus ?? [], "f1-checker");
    expect(authorities, "F checker A2 read").toContain("platform_a2_read");
    expect(authorities, "F checker A2 approve").toContain("platform_a2_operation_approve");
    expect(authorities, "F checker F1 decision authority").toContain("network_f1_write");
  }
}

async function assertA6ReviewerBoundary(page: Page) {
  const data = await session(page);
  const authorities = data.authorities ?? [];
  expect(data.roleCode, "dedicated A6 reviewer role").toBe(ACTORS.a6ReviewerRoleCode);
  await assertDedicatedLeafMenuContract(page, data.effectiveMenus ?? [], "a6-reviewer");
  expect(authorities).toEqual(expect.arrayContaining([
    "platform_a2_read",
    "platform_a2_operation_approve",
    "platform_a6_write",
    "platform_a6_role_grants_update",
  ]));
  expect(
    authorities.some((code) =>
      /^platform_a6_(?:rbac_grants_update|role_grants_update|write)$/i.test(code)),
    "A6 reviewer must have explicit A6 decision authority",
  ).toBe(true);
  expect(authorityDomains(authorities), "A6 reviewer must not carry business-domain authority")
    .toEqual([]);
}

async function session(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  const body = await response.json() as Envelope<{ session?: Session }>;
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.code, JSON.stringify(body)).toBe(0);
  return body.data?.session ?? {};
}

function authorityDomains(authorities: string[]) {
  const domains = new Set<string>();
  for (const authority of authorities) {
    const match = authority.match(/^(?:network_)?([a-m])(?:\d+)?_/i);
    if (match) domains.add(match[1].toUpperCase());
  }
  return [...domains].sort();
}

async function realUnknownProposal(
  page: Page,
  original: string,
  onCommitted: (operationId: string) => void,
): Promise<UnknownTransportEvidence> {
  await openF1FromSidebar(page);
  await page.getByRole("button", { name: /修改奖品名|配置奖品名/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel("目标新值").fill(original);
  await dialog.getByLabel(/操作理由/).fill(
    `${RUN_ID} F1 真实 response-unknown 同键核对 no-op`,
  );

  let idempotencyKey = "";
  let requestBody: ReturnType<typeof proposal> | undefined;
  let upstream: Envelope<Ticket> | undefined;
  let committedOperationId = "";
  let alertText: string | null = null;
  let routeSettled = false;
  const matcher = "**/api/admin/platform/audit/operations";

  await page.route(matcher, async (route) => {
    try {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      idempotencyKey = route.request().headers()["idempotency-key"] ?? "";
      requestBody = route.request().postDataJSON() as ReturnType<typeof proposal>;
      const response = await route.fetch();
      upstream = await response.json() as Envelope<Ticket>;
      expect(response.status(), JSON.stringify(upstream)).toBe(200);
      expect(upstream.code, JSON.stringify(upstream)).toBe(0);
      committedOperationId = ticketId(upstream);
      onCommitted(committedOperationId);
      await route.abort("failed");
    } finally {
      routeSettled = true;
    }
  }, { times: 1 });

  try {
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect.poll(
      () => routeSettled,
      { message: "upstream must commit and the browser response must be aborted before retry" },
    ).toBe(true);
    await expect(dialog, "response-unknown must retain the current form").toBeVisible();
    const alert = dialog.getByRole("alert");
    alertText = await alert.count() ? (await alert.innerText()).trim() : null;
  } finally {
    await page.unroute(matcher);
  }
  expect(idempotencyKey, "visible F1 proposal must carry Idempotency-Key").not.toBe("");
  expect(requestBody, "visible F1 proposal request body").toBeTruthy();
  expect(committedOperationId, "upstream must have committed before response loss").not.toBe("");
  expect(upstream, "captured upstream envelope").toBeTruthy();

  const retryRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST"
    && new URL(request.url()).pathname === "/api/admin/platform/audit/operations");
  const retryResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const actualRetryRequest = await retryRequestPromise;
  const retryIdempotencyKey = actualRetryRequest.headers()["idempotency-key"] ?? "";
  const replay = await retryResponsePromise;
  const replayBody = await replay.json() as Envelope<Ticket>;
  const retryOperationId = replayBody.code === 0 ? ticketId(replayBody) : "";
  const violations: string[] = [];
  if (!alertText || !/结果.*(?:未知|暂不确定)|暂不确定.*同一命令/i.test(alertText)) {
    violations.push("UNKNOWN_OUTCOME_ALERT_MISSING");
  }
  if (!idempotencyKey) violations.push("INITIAL_IDEMPOTENCY_KEY_MISSING");
  if (retryIdempotencyKey !== idempotencyKey) violations.push("RETRY_COMMAND_KEY_CHANGED");
  if (replay.status() !== 200 || replayBody.code !== 0) {
    violations.push(`RETRY_NOT_IDEMPOTENT_SUCCESS:${replay.status()}/${replayBody.code ?? "missing"}`);
  }
  if (retryOperationId !== committedOperationId) {
    violations.push("RETRY_OPERATION_ID_CHANGED_OR_MISSING");
  }
  if (violations.length) {
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "04-response-unknown-red.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }
  await expect(dialog).toHaveCount(0);

  return {
    operationId: committedOperationId,
    idempotencyKey,
    retryIdempotencyKey,
    alertText,
    retryHttpStatus: replay.status(),
    retryCode: replayBody.code,
    retryOperationId,
    violations,
    requestBody: requestBody!,
    upstream: upstream!,
  };
}

async function decideByApi(
  page: Page,
  operationId: string,
  decision: "approve" | "reject",
  idempotencyKey: string,
  reason: string,
) {
  const response = await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/${decision}`,
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { reason },
    },
  );
  return { response, body: await envelope(response) };
}

async function independentFinally(
  browser: Browser,
  original: string,
  pendingOperationIds: Set<string>,
  result: Record<string, unknown>,
) {
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const errors: Error[] = [];
  const cleanup: Record<string, unknown> = {
    independentContexts: true,
    pendingAtEntry: [...pendingOperationIds],
  };
  try {
    await loginFActor(maker, F_MAKER, "f-finally-maker");
    await loginFActor(checker, CHECKER, "f-finally-checker");
    for (const operationId of [...pendingOperationIds]) {
      const decision = await decideByApi(
        checker,
        operationId,
        "reject",
        caseIdempotencyKey(`f-finally-reject-${operationId}`),
        `${RUN_ID} independent finally 清理未终态 F ticket`,
      );
      if (decision.body.code !== 0 && decision.body.code !== 409) {
        throw new Error(`F pending cleanup failed ${operationId}: ${JSON.stringify(decision.body)}`);
      }
      pendingOperationIds.delete(operationId);
    }

    if (original) {
      const current = await readPrizeName(maker);
      if (current !== original) {
        const restore = await maker.request.post("/api/admin/platform/audit/operations", {
          headers: { "Idempotency-Key": caseIdempotencyKey("f-independent-finally-restore") },
          data: proposal(
            "F.prize.name",
            current,
            original,
            `${RUN_ID} independent finally 按验收前快照精确恢复`,
          ),
        });
        const restoreBody = await envelope<Ticket>(restore);
        expect(restoreBody.code, JSON.stringify(restoreBody)).toBe(0);
        const restoreOperationId = ticketId(restoreBody);
        const approved = await decideByApi(
          checker,
          restoreOperationId,
          "approve",
          caseIdempotencyKey("f-independent-finally-restore-approve"),
          `${RUN_ID} F-only checker 核对 finally 精确恢复`,
        );
        expect(approved.body.code, JSON.stringify(approved.body)).toBe(0);
        cleanup.restoreOperationId = restoreOperationId;
      }
      expect(await readPrizeName(maker), "F1 UI and API exact restore").toBe(original);
      const dbFinal = databaseEvidence([], original);
      expect(dbFinal.configValue, "F1 DB exact restore").toBe(original);
      cleanup.databaseFinal = dbFinal;
    } else {
      cleanup.restoreSkipped = "original snapshot was never acquired";
    }
    cleanup.pendingAtExit = [...pendingOperationIds];
    expect(pendingOperationIds.size, "no pending F operation may escape finally").toBe(0);
    await assertFActorBoundary(maker, "maker");
    await assertFActorBoundary(checker, "checker");
    cleanup.independentActorBoundaryValidated = true;
  } catch (error: unknown) {
    errors.push(asError(error));
  } finally {
    await makerContext.close().catch((error: unknown) => errors.push(asError(error)));
    await checkerContext.close().catch((error: unknown) => errors.push(asError(error)));
    result.independentFinally = cleanup;
  }
  if (errors.length) throw new AggregateError(errors, "independent F finally failed");
}

function requireDatabaseGate() {
  const executable = mysqlExecutable();
  if (!existsSync(executable)) {
    throw new Error(`MySQL client not found: ${executable}`);
  }
  const database = mysqlDatabase();
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`unsafe F_ACCEPTANCE_MYSQL_DATABASE: ${database}`);
  }
  if (!(process.env.F_ACCEPTANCE_MYSQL_PASSWORD ?? "")) {
    throw new Error("F_ACCEPTANCE_MYSQL_PASSWORD is required");
  }
}

function caseIdempotencyKey(suffix: string) {
  return fAcceptanceIdempotencyKey(RUN_ID, CASE_NONCE, suffix);
}

function assertNoIdempotencyCollision() {
  const prefix = `${RUN_ID}-${CASE_NONCE}-`;
  const collisions = mysqlNumber(
    "SELECT COUNT(*) FROM nx_admin_idempotency_record "
      + `WHERE idempotency_key LIKE '${sqlText(prefix)}%';`,
  );
  expect(
    collisions,
    `F1 idempotency collision preflight must be zero for ${prefix}`,
  ).toBe(0);
}

function databaseEvidence(operationIds: string[], expectedConfigValue: string) {
  const needles = operationIds.length
    ? operationIds
    : ["__NO_F_OPERATION_IDS__"];
  const like = (column: string) => needles
    .map((value) => `${column} LIKE '%${sqlText(value)}%'`)
    .join(" OR ");
  const inList = operationIds.length
    ? operationIds.map((value) => `'${sqlText(value)}'`).join(",")
    : "''";
  const configValue = mysqlScalar(
    "SELECT COALESCE((SELECT config_value FROM nx_config_item "
      + "WHERE config_key='team.ui.F.prize.name' AND is_deleted=0 LIMIT 1),'');",
  );
  const ticketRows = operationIds.length
    ? mysqlRows(
      `SELECT operation_id,status,source_domain FROM nx_audit_operation_ticket `
        + `WHERE is_deleted=0 AND operation_id IN (${inList}) ORDER BY operation_id;`,
    )
    : [];
  const operationLinkedOutboxCount = mysqlNumber(
    `SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND (${like("CAST(payload AS CHAR)")});`,
  );
  const operationLinkedOutboxByOperation = Object.fromEntries(operationIds.map((operationId) => [
    operationId,
    mysqlNumber(
      "SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND ("
        + `COALESCE(aggregate_id,'')='${sqlText(operationId)}' `
        + `OR CAST(payload AS CHAR) LIKE '%${sqlText(operationId)}%');`,
    ),
  ]));
  const d4WalletLedgerCount = mysqlNumber(
    `SELECT COUNT(*) FROM nx_wallet_ledger WHERE is_deleted=0 AND (`
      + `${like("COALESCE(biz_no,'')")} OR ${like("COALESCE(remark,'')")});`,
  );
  const b1ReserveLedgerCount = mysqlNumber(
    `SELECT COUNT(*) FROM nx_treasury_reserve_ledger WHERE is_deleted=0 AND (`
      + `${like("COALESCE(reason,'')")} OR ${like("COALESCE(idempotency_key,'')")});`,
  );
  const l4AnalyticsOutboxCount = mysqlNumber(
    `SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 AND analytics_event=1 AND (`
      + `${like("CAST(payload AS CHAR)")} OR ${like("COALESCE(aggregate_id,'')")});`,
  );
  const auditCount = operationIds.length
    ? mysqlNumber(
      `SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND (`
        + `${like("COALESCE(resource_id,'')")} OR ${like("COALESCE(biz_no,'')")} `
        + `OR ${like("CAST(detail_json AS CHAR)")});`,
    )
    : 0;
  const auditByOperation = Object.fromEntries(operationIds.map((operationId) => [
    operationId,
    mysqlNumber(
      "SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND ("
        + `COALESCE(resource_id,'')='${sqlText(operationId)}' `
        + `OR COALESCE(biz_no,'')='${sqlText(operationId)}' `
        + `OR CAST(detail_json AS CHAR) LIKE '%${sqlText(operationId)}%');`,
    ),
  ]));
  return {
    expectedConfigValue,
    configValue,
    operationTicketCount: ticketRows.length,
    ticketRows,
    auditCount,
    auditByOperation,
    operationLinkedOutboxCount,
    operationLinkedOutboxByOperation,
    d4WalletLedgerCount,
    b1ReserveLedgerCount,
    l4AnalyticsOutboxCount,
  };
}

function mysqlRows(query: string) {
  const executable = mysqlExecutable();
  const result = spawnSync(executable, [
    "--host", process.env.F_ACCEPTANCE_MYSQL_HOST ?? "127.0.0.1",
    "--port", process.env.F_ACCEPTANCE_MYSQL_PORT ?? "3306",
    "--user", process.env.F_ACCEPTANCE_MYSQL_USER ?? "root",
    "--default-character-set=utf8mb4",
    "--batch",
    "--raw",
    "--skip-column-names",
    "--execute", query,
    mysqlDatabase(),
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_PWD: process.env.F_ACCEPTANCE_MYSQL_PASSWORD ?? "",
    },
  });
  if (result.status !== 0) {
    throw new Error(`MySQL read failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  const text = result.stdout.trim();
  return text ? text.split(/\r?\n/).map((row) => row.split("\t")) : [];
}

function mysqlScalar(query: string) {
  return mysqlRows(query)[0]?.[0] ?? "";
}

function mysqlNumber(query: string) {
  const value = Number(mysqlScalar(query));
  if (!Number.isFinite(value)) throw new Error(`MySQL numeric result invalid: ${value}`);
  return value;
}

function mysqlExecutable() {
  return process.env.F_ACCEPTANCE_MYSQL_EXE
    ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
}

function mysqlDatabase() {
  return process.env.F_ACCEPTANCE_MYSQL_DATABASE
    ?? "nexion_acceptance_20260729_114336";
}

function sqlText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''").replaceAll("%", "\\%");
}

function responseEvidence(response: APIResponse, body: Envelope) {
  return { http: response.status(), code: body.code, message: body.message };
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

async function success<T>(response: APIResponse | { status(): number; json(): Promise<unknown> }, label: string) {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

async function envelope<T = unknown>(response: APIResponse) {
  return await response.json() as Envelope<T>;
}
