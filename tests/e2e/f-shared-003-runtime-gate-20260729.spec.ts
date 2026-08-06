import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";
import {
  assertDedicatedLeafMenuContract,
  assertLocalFCandidate,
  currentFRunId,
  loadFDedicatedActors,
  loginFActor,
} from "./helpers/f-acceptance-harness";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type SessionData = {
  session?: {
    roleCode?: string;
    authorities?: string[];
    effectiveMenus?: Array<string | { code?: string }>;
  };
};
type RoleDetail = {
  id: number;
  roleCode: string;
  permissionCodes: string[];
  menuIds: number[];
};
type Ticket = {
  id?: string;
  operationId?: string;
  status?: string;
  sourceDomain?: string;
  action?: string;
  obj?: string;
  beforeValue?: string;
  afterValue?: string;
};
type A2Overview = { operationQueue?: Ticket[]; operationHistory?: Ticket[] };
type F1Overview = { configValues?: Record<string, string> };
type A1Overview = {
  operators?: Array<{
    id?: string;
    username?: string;
    role?: string;
    status?: string;
    tfa?: boolean;
    sessions?: number;
    version?: string;
  }>;
};

const RUN_ID = currentFRunId();
const BUILD_ID = process.env.F_EXPECTED_BUILD_ID ?? "";
const JAR_SHA256 = process.env.F_EXPECTED_JAR_SHA256 ?? "";
const actors = loadFDedicatedActors(RUN_ID);
const DEDICATED_ACTORS_PATH = actors.manifestPath;
const ROLE_CODE = actors.fCheckerRoleCode;
const A6_REVIEWER_ROLE_CODE = actors.a6ReviewerRoleCode;
const A_FIXTURE_PATH = process.env.F_A_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/A.json`;
const EVIDENCE_DIR = process.env.F_SHARED_003_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/final-${BUILD_ID.slice(0, 8)}/shared-003-runtime-gate`;

const aFixture = JSON.parse(readFileSync(A_FIXTURE_PATH, "utf8")) as {
  checker?: Account;
  accounts?: { maker?: Account };
};
const aMaker = aFixture.accounts?.maker;
const fChecker = actors.fChecker;
const fMaker = actors.fMaker;
const a6Reviewer = actors.a6Reviewer;

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(process.env.F_WRITE_TOKEN, "F_WRITE_TOKEN is required").toBe("1");
  expect(
    process.env.F_WRITE_BYPASS,
    "F_WRITE_BYPASS=false must be explicitly confirmed by the main controller",
  ).toBe("false");
  expect(
    DEDICATED_ACTORS_PATH,
    "F_DEDICATED_ACTORS_MANIFEST is required; legacy shared actors are fail-closed",
  ).toBeTruthy();
  assertLocalFCandidate();
  expect(aMaker, "A maker fixture is required").toBeTruthy();
  expect(fMaker, "F maker fixture is required").toBeTruthy();
  expect(fChecker, "F checker fixture is required").toBeTruthy();
  expect(a6Reviewer.username, "independent A6 reviewer username is required").not.toBe("");
  expect(a6Reviewer.password, "independent A6 reviewer password is required").not.toBe("");
  expect(a6Reviewer.totpSecret, "independent A6 reviewer TOTP secret is required").not.toBe("");
  expect(fChecker?.username, "F-only checker username is required").not.toBe("");
  expect(fChecker?.password, "F-only checker password is required").not.toBe("");
  expect(fChecker?.totpSecret, "F-only checker TOTP secret is required").not.toBe("");
  expect(fChecker?.username, "F-only checker and A6 reviewer must be distinct")
    .not.toBe(a6Reviewer.username);
  expect(
    new Set([aMaker!.username, fMaker!.username, fChecker.username, a6Reviewer.username]).size,
    "A maker, F maker, F-only checker, and A6 reviewer must be four distinct accounts",
  ).toBe(4);
  expect(ROLE_CODE, "F-only checker role must be dedicated").not.toBe("SUPER_ADMIN");
  expect(A6_REVIEWER_ROLE_CODE, "A6 reviewer role must be dedicated").not.toBe("SUPER_ADMIN");
  expect(A6_REVIEWER_ROLE_CODE, "A6 reviewer and F-only checker roles must be distinct")
    .not.toBe(ROLE_CODE);
  expect(fChecker.username, "legacy global checker must not be reused")
    .not.toBe(aFixture.checker?.username);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("fixture repair: visible A6/A2 grants the reviewer only platform_a6_read and proves its A6 decision scope", async ({ browser }) => {
  test.setTimeout(180_000);
  const makerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  let operationIdValue = "";
  let terminal = false;
  try {
    await loginMfa(makerPage, aMaker!, "a-maker-a6-fixture-repair");
    await loginMfa(reviewerPage, a6Reviewer, "a6-reviewer-fixture-repair");
    const reviewerBefore = await session(reviewerPage);
    expect(reviewerBefore.roleCode).toBe(A6_REVIEWER_ROLE_CODE);
    expect(reviewerBefore.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      "platform_a6_write",
      "platform_a6_role_grants_update",
    ]));
    expect(reviewerBefore.authorities.some((code) => /^(?:device_|network_|service_m|finance_|user_|content_|risk_|growth_|bi_)/.test(code))).toBe(false);

    const beforeRole = await openRoleDetail(makerPage, A6_REVIEWER_ROLE_CODE);
    const expectedPermissions = sorted([...new Set([
      ...beforeRole.permissionCodes,
      "platform_a6_read",
    ])]);
    expect(expectedPermissions.filter((code) => code === "platform_a6_read")).toHaveLength(1);
    expect(expectedPermissions.some((code) => /^(?:device_|network_|service_m|finance_|user_|content_|risk_|growth_|bi_)/.test(code))).toBe(false);
    await makerPage.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const drawer = makerPage.getByRole("dialog")
      .filter({ has: makerPage.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("权限搜索").fill("platform_a6_read");
    const readBox = drawer.locator('label[title="platform_a6_read"] input[type="checkbox"]');
    await expect(readBox).toHaveCount(1);
    if (!(await readBox.isChecked())) await readBox.check();
    await expect(readBox).toBeChecked();
    await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
    const proposalPromise = makerPage.waitForResponse((response) =>
      response.request().method() === "PUT"
      && response.url().endsWith(`/api/admin/platform/roles/${beforeRole.id}/grants`));
    await confirmDialog(makerPage, `${RUN_ID} SHARED-003 A6 reviewer 最小补齐只读权限`);
    const proposalResponse = await proposalPromise;
    const proposal = await success<Ticket>(proposalResponse, "visible A6 reviewer fixture repair proposal");
    operationIdValue = operationId(proposal);
    const request = proposalResponse.request().postDataJSON() as { permissionCodes?: string[]; menuIds?: number[] };
    expect(sorted(request.permissionCodes ?? [])).toEqual(expectedPermissions);
    expect(sortedNumbers(request.menuIds ?? [])).toEqual(sortedNumbers(beforeRole.menuIds));

    await approveThroughVisibleA2(
      reviewerPage,
      operationIdValue,
      `${RUN_ID} A6 reviewer 核对自身角色仅补只读权限后批准`,
    );
    terminal = true;
    await logoutUi(reviewerPage);
    await loginMfa(reviewerPage, a6Reviewer, "a6-reviewer-fixture-repair-relogin");
    const reviewerAfterRelogin = await session(reviewerPage);
    await assertDedicatedLeafMenuContract(reviewerPage, reviewerAfterRelogin.menuCodes, "a6-reviewer");
    expect(sorted(reviewerAfterRelogin.authorities)).toEqual(expectedPermissions);
    await navigatePlatform(reviewerPage, "角色管理 A6", /\/platform\/roles$/);
    await expect(reviewerPage.getByText(A6_REVIEWER_ROLE_CODE, { exact: true }).first()).toBeVisible();
    await reviewerPage.reload({ waitUntil: "domcontentloaded" });
    const reviewerAfterRefresh = await session(reviewerPage);
    expect(hash(reviewerAfterRefresh.authorities)).toBe(hash(reviewerAfterRelogin.authorities));
    writeFileSync(
      path.join(EVIDENCE_DIR, "shared-003-fixture-repair.json"),
      JSON.stringify({
        runId: RUN_ID,
        roleCode: A6_REVIEWER_ROLE_CODE,
        operationId: operationIdValue,
        beforeHadRead: reviewerBefore.authorities.includes("platform_a6_read"),
        permissionsExact: reviewerAfterRelogin.authorities.sort(),
        menuCodesExact: reviewerAfterRelogin.menuCodes.sort(),
        visibleA6Target: true,
        visibleA6DecisionApproved: true,
        refreshReloginStable: true,
        businessAuthorities: reviewerAfterRelogin.authorities.filter((code) => /^(?:device_|network_|service_m|finance_|user_|content_|risk_|growth_|bi_)/.test(code)),
        status: "passed",
      }, null, 2),
    );
  } finally {
    const cleanupErrors: Error[] = [];
    if (operationIdValue && !terminal) {
      await rejectThroughVisibleA2(reviewerPage, operationIdValue, a6Reviewer)
        .catch((error: unknown) => cleanupErrors.push(asError(error)));
    }
    await makerContext.close();
    await reviewerContext.close();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "A6 reviewer fixture repair cleanup failed");
  }
});

test("phase A: temporarily unrestricted independent reviewer visibly approves an exact A6 no-op", async ({ browser }) => {
  test.setTimeout(180_000);
  const makerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  let operationIdValue = "";
  let terminal = false;
  try {
    await loginMfa(makerPage, aMaker!, "a-maker-phase-a");
    await loginMfa(reviewerPage, a6Reviewer, "a6-reviewer-phase-a");
    const reviewerSession = await session(reviewerPage);
    expect(reviewerSession.roleCode).toBe(A6_REVIEWER_ROLE_CODE);
    await assertDedicatedLeafMenuContract(
      reviewerPage,
      reviewerSession.menuCodes,
      "a6-reviewer",
    );
    expect(reviewerSession.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      "platform_a6_read",
    ]));
    expect(
      reviewerSession.authorities.some((code) =>
        /^platform_a6_(?:rbac_grants_update|role_grants_update|write)$/i.test(code)),
      "A6 reviewer must carry an explicit A6 decision authority",
    ).toBe(true);
    const beforeRole = await openRoleDetail(makerPage, ROLE_CODE);
    expect(beforeRole.permissionCodes.length).toBeGreaterThan(0);
    expect(beforeRole.menuIds.length).toBeGreaterThan(0);
    expect(beforeRole.permissionCodes.filter((code) => code === "network_f1_write")).toHaveLength(1);
    await makerPage.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const drawer = makerPage.getByRole("dialog")
      .filter({ has: makerPage.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("权限搜索").fill("network_f1_write");
    await expect(drawer.locator('label[title="network_f1_write"] input[type="checkbox"]')).toBeChecked();
    await makerPage.screenshot({
      path: path.join(EVIDENCE_DIR, "01-phase-a-a6-exact-noop-before.png"),
      fullPage: true,
    });
    await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
    const proposalPromise = makerPage.waitForResponse((response) =>
      response.request().method() === "PUT"
      && response.url().endsWith(`/api/admin/platform/roles/${beforeRole.id}/grants`));
    await confirmDialog(makerPage, `${RUN_ID} SHARED-003 phase A A6 精确无差量正向审批`);
    const proposalResponse = await proposalPromise;
    const ticket = await success<Ticket>(proposalResponse, "phase A visible A6 no-op proposal");
    operationIdValue = operationId(ticket);
    const request = proposalResponse.request().postDataJSON() as {
      permissionCodes?: string[];
      menuIds?: number[];
    };
    expect(sorted(request.permissionCodes ?? [])).toEqual(sorted(beforeRole.permissionCodes));
    expect(sortedNumbers(request.menuIds ?? [])).toEqual(sortedNumbers(beforeRole.menuIds));
    await approveThroughVisibleA2(
      reviewerPage,
      operationIdValue,
      `${RUN_ID} unrestricted independent reviewer 可见核对 A6 精确无差量后批准`,
    );
    terminal = true;
    await reviewerPage.screenshot({
      path: path.join(EVIDENCE_DIR, "02-phase-a-a6-approved.png"),
      fullPage: true,
    });
    const afterRole = await openRoleDetail(makerPage, ROLE_CODE);
    expect(sorted(afterRole.permissionCodes)).toEqual(sorted(beforeRole.permissionCodes));
    expect(sortedNumbers(afterRole.menuIds)).toEqual(sortedNumbers(beforeRole.menuIds));
    writeFileSync(
      path.join(EVIDENCE_DIR, "shared-003-a6-positive.json"),
      JSON.stringify({
        runId: RUN_ID,
        candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256 },
        productBusinessWrites: 0,
        operationId: operationIdValue,
        reviewerRole: reviewerSession.roleCode,
        visibleDecision: "approved",
        before: grantEvidence(beforeRole),
        request: grantEvidence({
          permissionCodes: request.permissionCodes ?? [],
          menuIds: request.menuIds ?? [],
        }),
        after: grantEvidence(afterRole),
        exactNoOpRestored: true,
        status: "passed",
      }, null, 2),
    );
  } finally {
    const cleanupErrors: Error[] = [];
    if (operationIdValue && !terminal) {
      await rejectThroughVisibleA2(reviewerPage, operationIdValue, a6Reviewer)
        .catch((error: unknown) => cleanupErrors.push(asError(error)));
    }
    await makerContext.close();
    await reviewerContext.close();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "phase A cleanup failed");
  }
});

test("phase B: restored F checker denies terminal A6 and unknown IDs while visibly deciding its F ticket", async ({ browser }) => {
  test.setTimeout(180_000);
  const a6OperationId = process.env.F_EXISTING_A6_OPERATION_ID ?? "";
  expect(a6OperationId, "F_EXISTING_A6_OPERATION_ID from phase A is required").not.toBe("");
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const pageErrors: Record<string, string[]> = { maker: [], checker: [] };
  makerPage.on("pageerror", (error) => pageErrors.maker.push(error.message));
  checkerPage.on("pageerror", (error) => pageErrors.checker.push(error.message));
  let fOperationId = "";
  let fTerminal = false;
  try {
    await loginMfa(makerPage, fMaker!, "f-maker-phase-b");
    await loginMfa(checkerPage, fChecker!, "f-checker-phase-b");
    const checkerSession = await session(checkerPage);
    expect(checkerSession.roleCode).toBe(ROLE_CODE);
    await assertDedicatedLeafMenuContract(
      checkerPage,
      checkerSession.menuCodes,
      "f1-checker",
    );
    expect(checkerSession.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      "network_f1_read",
      "network_f1_write",
    ]));
    expect(checkerSession.authorities.some((code) => /^platform_a(?!2_)/i.test(code))).toBe(false);
    expect(authorityDomains(checkerSession.authorities), "F-only checker business domains")
      .toEqual(["F"]);
    await openA2(checkerPage);
    await expect(checkerPage.getByText(a6OperationId, { exact: false })).toHaveCount(0);
    expect(findTicket(await overview(checkerPage), a6OperationId)).toBeUndefined();
    const approveDenied = await decide(
      checkerPage,
      a6OperationId,
      "approve",
      `${RUN_ID} restored F checker 不得批准 terminal A6`,
      `${RUN_ID}-shared003-phase-b-a6-approve`,
    );
    const rejectDenied = await decide(
      checkerPage,
      a6OperationId,
      "reject",
      `${RUN_ID} restored F checker 不得驳回 terminal A6`,
      `${RUN_ID}-shared003-phase-b-a6-reject`,
    );
    const unknownDenied = await decide(
      checkerPage,
      "WO-000000000000000-404",
      "approve",
      `${RUN_ID} restored F checker 未知 ID 必须失败关闭`,
      `${RUN_ID}-shared003-phase-b-unknown`,
    );
    expect(approveDenied.body.code).toBe(403);
    expect(rejectDenied.body.code).toBe(403);
    expect(unknownDenied.body.code).toBe(403);
    const originalPrize = await readPrizeName(makerPage);
    fOperationId = await submitPrizeThroughVisibleF1(
      makerPage,
      originalPrize,
      `${RUN_ID} restored F checker 显式 F1 list-detail-decision 正向门禁`,
    );
    await openA2(checkerPage);
    const row = checkerPage.locator("tbody tr").filter({ hasText: fOperationId }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "执行", exact: true })).toBeVisible();
    const beforeDecision = findTicket(await overview(checkerPage), fOperationId);
    expect(beforeDecision).toBeTruthy();
    // A2 intentionally publishes the permission-scoped ticket projection rather
    // than its internal sourceDomain.  The visible object/action identify this
    // F1 proposal; server-side A2 policy rechecks the stored F domain on decide.
    expect(beforeDecision?.action).toContain("F 域配置调整");
    expect(beforeDecision?.obj).toBe("F.prize.name");
    expect(beforeDecision?.status).toBe("pending");
    expect(beforeDecision?.afterValue).toBe(originalPrize);
    await checkerPage.screenshot({
      path: path.join(EVIDENCE_DIR, "03-phase-b-f-ticket-visible.png"),
      fullPage: true,
    });
    await approveThroughVisibleA2(
      checkerPage,
      fOperationId,
      `${RUN_ID} restored F checker 核对自身显式 F1 工单后批准`,
    );
    fTerminal = true;
    expect(await readPrizeName(checkerPage)).toBe(originalPrize);
    const afterDecision = findTicket(await overview(checkerPage), fOperationId);
    expect(afterDecision?.status).toBe("approved");
    await checkerPage.reload({ waitUntil: "domcontentloaded" });
    const afterRefresh = await session(checkerPage);
    expect(hash(afterRefresh.authorities)).toBe(hash(checkerSession.authorities));
    expect(Object.values(pageErrors).flat()).toEqual([]);
    writeFileSync(
      path.join(EVIDENCE_DIR, "shared-003-runtime-gate.json"),
      JSON.stringify({
        runId: RUN_ID,
        candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256 },
        productBusinessWrites: 0,
        a6: {
          operationId: a6OperationId,
          listVisible: false,
          approve: responseEvidence(approveDenied),
          reject: responseEvidence(rejectDenied),
        },
        unknown: { approve: responseEvidence(unknownDenied) },
        f1OwnScope: {
          operationId: fOperationId,
          listVisible: true,
          detail: safeTicket(beforeDecision!),
          postDecision: safeTicket(afterDecision!),
          decision: "approved",
          authoritativeValueBefore: originalPrize,
          authoritativeValueAfter: await readPrizeName(checkerPage),
          noProductValueDrift: true,
        },
        checkerSession: {
          roleCode: checkerSession.roleCode,
          authorityCount: checkerSession.authorities.length,
          authoritiesHash: hash(checkerSession.authorities),
          refreshStable: true,
        },
        pageErrors,
        status: "passed",
      }, null, 2),
    );
  } finally {
    const cleanupErrors: Error[] = [];
    if (fOperationId && !fTerminal) {
      await rejectThroughVisibleA2(checkerPage, fOperationId, fChecker!)
        .catch((error: unknown) => cleanupErrors.push(asError(error)));
    }
    await makerContext.close();
    await checkerContext.close();
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "phase B cleanup failed");
  }
});

test("new JAR: compliant A6 reviewer succeeds, F checker is denied cross-domain/unknown and owns explicit F list-detail-decision", async ({ browser }) => {
  test.setTimeout(240_000);
  const aMakerContext = await browser.newContext();
  const fMakerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const aMakerPage = await aMakerContext.newPage();
  const fMakerPage = await fMakerContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const reviewerPage = await reviewerContext.newPage();
  const pageErrors: Record<string, string[]> = { aMaker: [], fMaker: [], checker: [], reviewer: [] };
  aMakerPage.on("pageerror", (error) => pageErrors.aMaker.push(error.message));
  fMakerPage.on("pageerror", (error) => pageErrors.fMaker.push(error.message));
  checkerPage.on("pageerror", (error) => pageErrors.checker.push(error.message));
  reviewerPage.on("pageerror", (error) => pageErrors.reviewer.push(error.message));
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256 },
    roleCode: ROLE_CODE,
    productBusinessWrites: 0,
    a6Mutation: "NO_OP_EXACT_GRANTS",
  };
  let a6OperationId = "";
  let fOperationId = "";
  let a6Terminal = false;
  let fTerminal = false;
  let primaryError: Error | undefined;

  try {
    await loginMfa(aMakerPage, aMaker!, "a-maker");
    await loginMfa(fMakerPage, fMaker!, "f-maker");
    await loginMfa(checkerPage, fChecker!, "f-checker");
    const accountOverview = await success<A1Overview>(
      await aMakerPage.request.get("/api/admin/platform/accounts/overview"),
      "A1 reviewer diagnostic",
    );
    const reviewerState = (accountOverview.operators ?? [])
      .find((operator) => operator.username === a6Reviewer.username);
    evidence.reviewerAccountState = reviewerState
      ? {
          id: reviewerState.id,
          role: reviewerState.role,
          status: reviewerState.status,
          tfa: reviewerState.tfa,
          sessions: reviewerState.sessions,
          version: reviewerState.version,
        }
      : { found: false };
    writeFileSync(path.join(EVIDENCE_DIR, "shared-003-runtime-gate.json"), JSON.stringify(evidence, null, 2));
    await loginMfa(reviewerPage, a6Reviewer, "independent-a6-reviewer");

    const checkerSession = await session(checkerPage);
    expect(checkerSession.roleCode).toBe(ROLE_CODE);
    await assertDedicatedLeafMenuContract(
      checkerPage,
      checkerSession.menuCodes,
      "f1-checker",
    );
    expect(checkerSession.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      "network_f1_read",
      "network_f1_write",
    ]));
    expect(checkerSession.authorities.some((code) => /^platform_a(?!2_)/i.test(code))).toBe(false);
    expect(authorityDomains(checkerSession.authorities), "F-only checker business domains")
      .toEqual(["F"]);

    const reviewerSession = await session(reviewerPage);
    expect(reviewerSession.roleCode).toBe(A6_REVIEWER_ROLE_CODE);
    await assertDedicatedLeafMenuContract(
      reviewerPage,
      reviewerSession.menuCodes,
      "a6-reviewer",
    );
    expect(reviewerSession.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      "platform_a6_read",
    ]));
    expect(
      reviewerSession.authorities.some((code) =>
        /^platform_a6_(?:rbac_grants_update|role_grants_update|write)$/i.test(code)),
      "A6 reviewer must carry an explicit A6 decision authority",
    ).toBe(true);

    const beforeRole = await openRoleDetail(aMakerPage, ROLE_CODE);
    expect(beforeRole.permissionCodes.length).toBeGreaterThan(0);
    expect(beforeRole.menuIds.length).toBeGreaterThan(0);
    expect(beforeRole.permissionCodes.filter((code) => code === "network_f1_write")).toHaveLength(1);

    await aMakerPage.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const drawer = aMakerPage.getByRole("dialog")
      .filter({ has: aMakerPage.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("权限搜索").fill("network_f1_write");
    await expect(drawer.locator('label[title="network_f1_write"] input[type="checkbox"]')).toBeChecked();
    await aMakerPage.screenshot({ path: path.join(EVIDENCE_DIR, "01-a6-exact-noop-before.png"), fullPage: true });
    await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
    const a6ProposalPromise = aMakerPage.waitForResponse((response) =>
      response.request().method() === "PUT"
      && response.url().endsWith(`/api/admin/platform/roles/${beforeRole.id}/grants`));
    await confirmDialog(aMakerPage, `${RUN_ID} 新 JAR SHARED-003 A6 精确无差量运行时门禁`);
    const a6ProposalResponse = await a6ProposalPromise;
    const a6Ticket = await success<Ticket>(a6ProposalResponse, "visible A6 no-op proposal");
    a6OperationId = operationId(a6Ticket);
    const a6Request = a6ProposalResponse.request().postDataJSON() as {
      permissionCodes?: string[];
      menuIds?: number[];
    };
    expect(sorted(a6Request.permissionCodes ?? [])).toEqual(sorted(beforeRole.permissionCodes));
    expect(sortedNumbers(a6Request.menuIds ?? [])).toEqual(sortedNumbers(beforeRole.menuIds));

    await openA2(checkerPage);
    await expect(checkerPage.getByText(a6OperationId, { exact: false })).toHaveCount(0);
    const checkerA2Before = await overview(checkerPage);
    expect(findTicket(checkerA2Before, a6OperationId)).toBeUndefined();

    const a6ApproveDenied = await decide(
      checkerPage,
      a6OperationId,
      "approve",
      `${RUN_ID} F checker 不得批准 A6`,
      `${RUN_ID}-shared003-a6-approve-denied`,
    );
    expect(a6ApproveDenied.body.code).toBe(403);
    const a6RejectDenied = await decide(
      checkerPage,
      a6OperationId,
      "reject",
      `${RUN_ID} F checker 不得驳回 A6`,
      `${RUN_ID}-shared003-a6-reject-denied`,
    );
    expect(a6RejectDenied.body.code).toBe(403);
    const unknownDenied = await decide(
      checkerPage,
      "WO-000000000000000-404",
      "approve",
      `${RUN_ID} F checker 未知 ID 必须策略前置失败关闭`,
      `${RUN_ID}-shared003-unknown-denied`,
    );
    expect(unknownDenied.body.code).toBe(403);

    await approveThroughVisibleA2(
      reviewerPage,
      a6OperationId,
      `${RUN_ID} 独立合规 A6 checker 核对精确无差量后批准`,
    );
    a6Terminal = true;
    await reviewerPage.screenshot({ path: path.join(EVIDENCE_DIR, "02-compliant-a6-reviewer-approved.png"), fullPage: true });

    const afterRole = await openRoleDetail(aMakerPage, ROLE_CODE);
    expect(sorted(afterRole.permissionCodes)).toEqual(sorted(beforeRole.permissionCodes));
    expect(sortedNumbers(afterRole.menuIds)).toEqual(sortedNumbers(beforeRole.menuIds));

    const originalPrize = await readPrizeName(fMakerPage);
    expect(originalPrize).not.toBe("");
    fOperationId = await submitPrizeThroughVisibleF1(
      fMakerPage,
      originalPrize,
      `${RUN_ID} F checker 显式 F1 工单列表详情决策一致性无副作用门禁`,
    );
    await fMakerPage.screenshot({ path: path.join(EVIDENCE_DIR, "03-visible-f1-noop-pending.png"), fullPage: true });

    await openA2(checkerPage);
    const fRow = checkerPage.locator("tbody tr").filter({ hasText: fOperationId }).first();
    await expect(fRow).toBeVisible();
    await expect(fRow.getByRole("button", { name: "执行", exact: true })).toBeVisible();
    await checkerPage.screenshot({ path: path.join(EVIDENCE_DIR, "04-f-checker-visible-f-ticket.png"), fullPage: true });

    const checkerFOverview = await overview(checkerPage);
    const fTicket = findTicket(checkerFOverview, fOperationId);
    expect(fTicket).toBeTruthy();
    // The public A2 projection omits sourceDomain.  Its F object/action remain
    // visible, while the server rechecks the persisted F row scope on decision.
    expect(fTicket?.action).toContain("F 域配置调整");
    expect(fTicket?.obj).toBe("F.prize.name");
    expect(fTicket?.status).toBe("pending");
    expect(fTicket?.afterValue).toBe(originalPrize);

    await approveThroughVisibleA2(
      checkerPage,
      fOperationId,
      `${RUN_ID} F checker 核对自身显式 F1 工单列表详情后批准`,
    );
    fTerminal = true;
    expect(await readPrizeName(checkerPage)).toBe(originalPrize);
    const checkerFAfter = await overview(checkerPage);
    const fTicketAfter = findTicket(checkerFAfter, fOperationId);
    expect(fTicketAfter?.status).toBe("approved");
    await checkerPage.screenshot({ path: path.join(EVIDENCE_DIR, "05-f-checker-f-ticket-approved.png"), fullPage: true });

    await checkerPage.reload({ waitUntil: "domcontentloaded" });
    const checkerAfterRefresh = await session(checkerPage);
    expect(hash(checkerAfterRefresh.authorities)).toBe(hash(checkerSession.authorities));
    await assertDedicatedLeafMenuContract(
      checkerPage,
      checkerAfterRefresh.menuCodes,
      "f1-checker",
    );

    evidence.a6 = {
      operationId: a6OperationId,
      before: grantEvidence(beforeRole),
      request: grantEvidence({
        permissionCodes: a6Request.permissionCodes ?? [],
        menuIds: a6Request.menuIds ?? [],
      }),
      after: grantEvidence(afterRole),
      checkerListVisible: false,
      checkerApprove: responseEvidence(a6ApproveDenied),
      checkerReject: responseEvidence(a6RejectDenied),
      unknownApprove: responseEvidence(unknownDenied),
      compliantReviewerRole: reviewerSession.roleCode,
      compliantVisibleDecision: "approved",
    };
    evidence.f1OwnScope = {
      operationId: fOperationId,
      listVisible: true,
      detail: safeTicket(fTicket!),
      postDecision: safeTicket(fTicketAfter!),
      decision: "approved",
      authoritativeValueBefore: originalPrize,
      authoritativeValueAfter: await readPrizeName(checkerPage),
      noProductValueDrift: true,
    };
    evidence.checkerSession = {
      roleCode: checkerSession.roleCode,
      authoritiesHash: hash(checkerSession.authorities),
      refreshStable: hash(checkerAfterRefresh.authorities) === hash(checkerSession.authorities),
      menuCodes: [...checkerSession.menuCodes].sort(),
      refreshMenuStable: hash(checkerAfterRefresh.menuCodes) === hash(checkerSession.menuCodes),
    };
    evidence.pageErrors = pageErrors;
    expect(Object.values(pageErrors).flat()).toEqual([]);
    evidence.status = "passed";
    writeFileSync(path.join(EVIDENCE_DIR, "shared-003-runtime-gate.json"), JSON.stringify(evidence, null, 2));
  } catch (error: unknown) {
    primaryError = asError(error);
    evidence.status = "failed";
    evidence.failure = { name: primaryError.name, message: primaryError.message };
  } finally {
    const terminalErrors: Error[] = primaryError ? [primaryError] : [];
    let a6Cleanup = a6OperationId ? (a6Terminal ? "terminal" : "pending") : "not-created";
    let f1Cleanup = fOperationId ? (fTerminal ? "terminal" : "pending") : "not-created";
    if (a6OperationId && !a6Terminal) {
      await rejectThroughVisibleA2(reviewerPage, a6OperationId, a6Reviewer)
        .then(() => { a6Cleanup = "rejected"; })
        .catch((error: unknown) => {
          a6Cleanup = "failed";
          terminalErrors.push(asError(error));
        });
    }
    if (fOperationId && !fTerminal) {
      await rejectThroughVisibleA2(checkerPage, fOperationId, fChecker!)
        .then(() => { f1Cleanup = "rejected"; })
        .catch((error: unknown) => {
          f1Cleanup = "failed";
          terminalErrors.push(asError(error));
        });
    }
    evidence.cleanup = {
      a6: a6Cleanup,
      f1: f1Cleanup,
      errors: terminalErrors.filter((error) => error !== primaryError).map((error) => error.message),
    };
    if (evidence.status !== "passed") {
      evidence.pageErrors = pageErrors;
      evidence.status = "failed";
    }
    try {
      writeFileSync(path.join(EVIDENCE_DIR, "shared-003-runtime-gate.json"), JSON.stringify(evidence, null, 2));
    } catch (error: unknown) {
      terminalErrors.push(asError(error));
    }
    await aMakerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await fMakerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await checkerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await reviewerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    if (terminalErrors.length) {
      throw new AggregateError(terminalErrors, "SHARED-003 lifecycle or cleanup failed");
    }
  }
});

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function authorityDomains(authorities: string[]) {
  const domains = new Set<string>();
  for (const authority of authorities) {
    const match = /^([a-z]+)_([a-m])(\d+)_/i.exec(authority);
    if (!match) continue;
    if (match[2].toUpperCase() === "A" && match[3] === "2") continue;
    domains.add(match[2].toUpperCase());
  }
  return [...domains].sort();
}

function sorted(values: string[]) {
  return [...values].sort();
}

function sortedNumbers(values: number[]) {
  return [...values].sort((a, b) => a - b);
}

function hash(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex").toUpperCase();
}

function grantEvidence(value: Pick<RoleDetail, "permissionCodes" | "menuIds">) {
  return {
    permissionCount: value.permissionCodes.length,
    permissionHash: hash(value.permissionCodes),
    menuCount: value.menuIds.length,
    menuHash: hash(value.menuIds),
    targetF1WriteCount: value.permissionCodes.filter((code) => code === "network_f1_write").length,
  };
}

function safeTicket(ticket: Ticket) {
  return {
    id: ticket.id ?? ticket.operationId,
    status: ticket.status,
    sourceDomain: ticket.sourceDomain,
    action: ticket.action,
    object: ticket.obj,
    beforeValue: ticket.beforeValue,
    afterValue: ticket.afterValue,
  };
}

function responseEvidence(result: { response: APIResponse; body: Envelope }) {
  return { http: result.response.status(), code: result.body.code, message: result.body.message };
}

function operationId(ticket: Ticket) {
  const id = String(ticket.id ?? ticket.operationId ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

function findTicket(value: A2Overview, id: string) {
  return [...(value.operationQueue ?? []), ...(value.operationHistory ?? [])].find((ticket) =>
    String(ticket.id ?? ticket.operationId ?? "") === id);
}

async function session(page: Page) {
  const data = await success<SessionData>(await page.request.get("/api/admin/auth/session"), "session");
  return {
    roleCode: data.session?.roleCode ?? "",
    authorities: data.session?.authorities ?? [],
    menuCodes: (data.session?.effectiveMenus ?? []).map((item) =>
      typeof item === "string" ? item : item.code ?? ""),
  };
}

async function overview(page: Page) {
  return await success<A2Overview>(
    await page.request.get("/api/admin/platform/audit/overview"),
    "A2 overview",
  );
}

async function openRoleDetail(page: Page, roleCode: string) {
  await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const cell = page.getByText(roleCode, { exact: true }).first();
  await expect(cell).toBeVisible();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET"
    && /\/api\/admin\/platform\/roles\/\d+$/.test(new URL(response.url()).pathname));
  await cell.click();
  return await success<RoleDetail>(await responsePromise, "visible A6 role detail");
}

async function submitPrizeThroughVisibleF1(page: Page, value: string, reason: string) {
  await openF1(page);
  await page.getByRole("button", { name: /修改奖品名|配置奖品名/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const ticket = await success<Ticket>(await responsePromise, "visible F1 proposal");
  await expect(dialog).toHaveCount(0);
  return operationId(ticket);
}

async function readPrizeName(page: Page) {
  const value = await success<F1Overview>(await page.request.get("/api/admin/teams/ranks"), "F1 overview");
  return value.configValues?.["F.prize.name"] ?? "";
}

async function openF1(page: Page) {
  const sidebar = page.locator("aside");
  const group = sidebar.getByRole("button", { name: /分销与团队.*F|F.*分销与团队/ }).first();
  const link = sidebar.locator('a[href="/network/v-rank"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/network\/v-rank$/);
  await expect(page.getByRole("heading", { name: "V-Rank 晋升", exact: true })).toBeVisible();
}

async function openA2(page: Page) {
  await navigatePlatform(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "审计 & 操作确认" })).toBeVisible();
}

async function approveThroughVisibleA2(page: Page, id: string, reason: string) {
  await openA2(page);
  const row = page.locator("tbody tr")
    .filter({ hasText: id })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${id}/approve`));
  await confirmDialog(page, reason);
  await success(await responsePromise, `visible A2 approve ${id}`);
  await expect(page.getByText(`${id} 已执行`, { exact: false })).toBeVisible();
}

async function rejectThroughVisibleA2(page: Page, id: string, account: Account) {
  if (!(await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false))) {
    await loginMfa(page, account, "independent-a6-reviewer-cleanup");
  }
  await openA2(page);
  const row = page.locator("tbody tr")
    .filter({ hasText: id })
    .filter({ has: page.getByRole("button", { name: "驳回", exact: true }) })
    .first();
  await expect(row, `cleanup row must remain visible for ${id}`).toBeVisible();
  await row.getByRole("button", { name: "驳回", exact: true }).click();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${id}/reject`));
  await confirmDialog(page, `${RUN_ID} SHARED-003 门禁失败清理`);
  await success(await responsePromise, `visible A2 reject ${id}`);
}

async function decide(
  page: Page,
  id: string,
  decision: "approve" | "reject",
  reason: string,
  idempotencyKey: string,
) {
  const response = await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(id)}/${decision}`,
    { headers: { "Idempotency-Key": idempotencyKey }, data: { reason } },
  );
  return { response, body: await response.json() as Envelope };
}

async function navigatePlatform(page: Page, linkName: string, url: RegExp) {
  const sidebar = page.locator("aside");
  const group = sidebar.getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first();
  const link = sidebar.getByRole("link", { name: linkName, exact: true }).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(url);
}

async function confirmDialog(page: Page, reason: string) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
}

async function loginMfa(page: Page, account: Account, key: string) {
  await loginFActor(page, account, key);
}

async function logoutUi(page: Page) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/logout");
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await expect((await responsePromise).status()).toBe(200);
}

async function success<T>(response: APIResponse | Response, label: string) {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}
