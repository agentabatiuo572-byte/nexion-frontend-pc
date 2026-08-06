import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const EXPECTED_TOKEN = `${RUN_ID}-b-second-writer-fixture-r7`;
const RED_CLEANUP_TOKEN = `${RUN_ID}-b-final2-role-cleanup-after-red`;
const RED_ROLE_CODE = "ACC_FINAL_114336_B23_SECOND_WRITER";
const ROLE_CODE = "ACC_FINAL_114336_B23_SECOND_WRITER_R7";
const ROLE_NAME = "FINAL B2B3 独立第二写者 R7";
const USERNAME = "acc_b23_second_r7_114336";
const DISPLAY_NAME = "FINAL B2B3 第二写者 R7 114336";
const BOOTSTRAP_USERNAME = "acc_b23_bootstrap_r7_114336";
const BOOTSTRAP_DISPLAY_NAME = "FINAL B2B3 Bootstrap Checker R7 114336";
const CLEANUP_BOOTSTRAP_USERNAME = "acc_b23_cleanup_bootstrap_114336";
const CLEANUP_BOOTSTRAP_DISPLAY_NAME = "FINAL B2B3 RED Cleanup Bootstrap 114336";
const R7_CLOSEOUT_BOOTSTRAP_USERNAME = "acc_b23_closeout_r7_114336";
const R7_CLOSEOUT_BOOTSTRAP_DISPLAY_NAME = "FINAL B2B3 R7 Closeout Bootstrap 114336";
const PERMISSIONS = [
  "overview_b2_read",
  "overview_b2_write",
  "overview_b3_read",
  "overview_b3_view_write",
] as const;
const GRANTED_MENU_LEAVES = ["B2", "B3"] as const;
const MENUS = ["B2", "B3"] as const;
const EVIDENCE_DIR = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\B\\second-writer-fixture-final2`,
);
const SOURCE_FIXTURE = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\A\\domain-permission-fixtures\\B.json`,
);
const MANIFEST_PATH = path.join(EVIDENCE_DIR, "B-second-writer-R7.json");
const REASON = `${RUN_ID} B2/B3 独立 secondWriter fixture-admin window`;
const EXPECTED_DATABASE = "nexion_acceptance_20260729_114336_d";
const EXPECTED_PC_BUILD_ID = "xNJR-cEeID2fPRwrRvOrb";
const EXPECTED_JAR_SHA = "B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B";
const RED_ROLE_ID = 4307;
const R7_ROLE_ID = 4505;
const R7_ACCOUNT_ID = "99643";
const BACKEND_JAR = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\D\\child-pc-full-acceptance-20260729-114336-D\\runtime\\nexion-backend-B426C1ED9CFC.jar`,
);
const MYSQL_EXE = "D:\\software\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const SENTINEL_KEY = "feature.ops.maintenanceBanner";
const CROSS_DOMAIN_ENDPOINTS = [
  "/api/admin/devices/overview",
  "/api/admin/emergency/kill-switches",
  "/api/admin/platform/audit/overview",
] as const;

type Account = {
  accountId?: string | number;
  id?: string | number;
  username: string;
  password: string;
  totpSecret?: string;
};
type Fixture = {
  runId?: string;
  checker?: Account;
  accounts?: Record<string, Account>;
};
type BootstrapState = {
  accountId: string;
  temporaryPassword: string;
  finalPassword: string;
  totpSecret: string;
};
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type ConfigRow = {
  id: number;
  configKey: string;
  configValue: string | null;
  valueType: string | null;
  configGroup: string | null;
  visibility: string | null;
  remark: string | null;
  status: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: number;
};

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("B fixture-admin：可见 A1/A6/A2 创建精确 secondWriter 并完成 MFA/权限/刷新重登", async ({
  baseURL,
  page,
  browser,
}) => {
  test.skip(
    process.env.B_SECOND_WRITER_FIXTURE_TOKEN?.trim() !== EXPECTED_TOKEN,
    "Main-controller fixture-admin token not issued.",
  );
  expect(process.env.B_EXPECT_MFA_BYPASS).toBe("true");
  const mysqlPassword = must("B_MYSQL_PASSWORD");
  const targetGate = await assertTargetGate(baseURL, mysqlPassword);
  const superUsername = must("ADMIN_E2E_USERNAME");
  const superPassword = must("ADMIN_E2E_PASSWORD");
  const fixture = JSON.parse(await readFile(SOURCE_FIXTURE, "utf8")) as Fixture;
  expect(fixture.runId).toBe(RUN_ID);
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    fixtureAttempt: "R7",
    source: "visible A1/A6/A2 isolated-child fixture-admin window",
    target: {
      roleCode: ROLE_CODE,
      username: USERNAME,
      authorities: [...PERMISSIONS],
      grantedMenuLeaves: [...GRANTED_MENU_LEAVES],
      menuCodes: [...MENUS],
      derivedSidebarGroup: "B",
    },
    boundaries: {
      childOnly: true,
      genericCheckerModified: false,
      checkerStrategy: "short-lived independent SUPER_ADMIN bootstrap",
      crossDomainPermissions: 0,
      businessDomainWrites: 0,
    },
    targetGate,
  };

  const bootstrapContext = await browser.newContext();
  const bootstrapPage = await bootstrapContext.newPage();
  const accountContext = await browser.newContext();
  const accountPage = await accountContext.newPage();
  let roleId = 0;
  let operationId = "";
  let accountId = "";
  let finalPassword = "";
  let totpSecret = "";
  const bootstrap: BootstrapState = {
    accountId: "",
    temporaryPassword: "",
    finalPassword: "",
    totpSecret: "",
  };
  let bootstrapDisableOperationId = "";
  let completed = false;
  let mutationStarted = false;

  try {
    await loginSuperBypass(page, superUsername, superPassword);
    evidence.datasourceProof = await assertChildDatasource(page, mysqlPassword);
    const superSession = await session(page);
    expect(superSession.username).toBe(superUsername);
    expect(superSession.authorities).toEqual(expect.arrayContaining([
      "platform_a1_write",
      "platform_a6_write",
      "platform_a6_role_grants_update",
    ]));
    evidence.crossDomainProbePreflight = await assertCrossDomainProbeExists(page);

    const genericCheckerSnapshot = fixture.checker
      ? sha256(JSON.stringify(fixture.checker))
      : null;
    const existingRoles = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/roles/overview"),
      "preflight roles",
    );
    expect(
      (existingRoles.roles as Array<Record<string, unknown>>)
        .some((role) => role.roleCode === ROLE_CODE),
      "role code must be absent before fixture creation",
    ).toBe(false);
    const existingAccounts = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/accounts/overview"),
      "preflight accounts",
    );
    expect(
      (existingAccounts.operators as Array<Record<string, unknown>>)
        .some((account) => account.username === USERNAME),
      "username must be absent before fixture creation",
    ).toBe(false);
    expect(
      (existingAccounts.operators as Array<Record<string, unknown>>)
        .some((account) => account.username === BOOTSTRAP_USERNAME),
      "bootstrap username must be absent before fixture creation",
    ).toBe(false);

    mutationStarted = true;
    const createdBootstrap = await createAccountUi(
      page,
      BOOTSTRAP_USERNAME,
      BOOTSTRAP_DISPLAY_NAME,
      "超级管理员",
    );
    bootstrap.accountId = String(createdBootstrap.id ?? "");
    expect(bootstrap.accountId).toMatch(/^\d+$/);
    bootstrap.temporaryPassword = await takeTemporaryPassword(page);
    bootstrap.finalPassword = `Nx!B23Boot${randomBytes(16).toString("base64url")}Aa`;
    bootstrap.totpSecret = await activateMfa(
      bootstrapPage,
      BOOTSTRAP_USERNAME,
      bootstrap.temporaryPassword,
      bootstrap.finalPassword,
      bootstrap,
    );
    const bootstrapSession = await session(bootstrapPage);
    expect(bootstrapSession.username).toBe(BOOTSTRAP_USERNAME);
    expect(String(bootstrapSession.adminId)).toBe(bootstrap.accountId);
    expect(String(bootstrapSession.role).toLowerCase()).toBe("superadmin");
    expect(bootstrapSession.roleCode).toBe("SUPER_ADMIN");
    expect(new Set(bootstrapSession.authorities)).toEqual(
      new Set(superSession.authorities),
    );
    expect(new Set(bootstrapSession.menuCodes)).toEqual(
      new Set(superSession.menuCodes),
    );
    expect(bootstrapSession.authorities).toEqual(expect.arrayContaining([
      "platform_a1_write",
      "platform_a2_read",
      "platform_a2_operation_approve",
      "platform_a6_write",
      "platform_a6_role_grants_update",
    ]));

    roleId = await createRoleUi(page);
    operationId = await grantRoleUi(page, roleId);
    await assertSelfApprovalDenied(page, operationId);
    await approveUi(bootstrapPage, operationId);

    const created = await createAccountUi(page, USERNAME, DISPLAY_NAME, ROLE_NAME);
    expect(String(created.id ?? ""), "created secondWriter account id").toMatch(/^\d+$/);
    accountId = String(created.id);
    const temporaryPassword = await takeTemporaryPassword(page);
    finalPassword = `Nx!B23${randomBytes(18).toString("base64url")}Aa`;
    totpSecret = await activateMfa(
      accountPage,
      USERNAME,
      temporaryPassword,
      finalPassword,
    );

    const initial = await assertSessionExact(accountPage, accountId);
    const initialSidebar = await assertSidebarExactB(accountPage);
    const crossDomain = await assertCrossDomainDenied(accountPage);
    await accountPage.reload({ waitUntil: "domcontentloaded" });
    const afterRefresh = await assertSessionExact(accountPage, accountId);
    const refreshedSidebar = await assertSidebarExactB(accountPage);
    expect(afterRefresh.authorityHash).toBe(initial.authorityHash);
    expect(afterRefresh.menuHash).toBe(initial.menuHash);

    await visibleLogout(accountPage);
    expect((await accountPage.request.get("/api/admin/auth/session")).status()).toBe(401);
    await loginMfa(accountPage, { username: USERNAME, password: finalPassword, totpSecret });
    const afterRelogin = await assertSessionExact(accountPage, accountId);
    const reloginSidebar = await assertSidebarExactB(accountPage);
    expect(afterRelogin.authorityHash).toBe(initial.authorityHash);
    expect(afterRelogin.menuHash).toBe(initial.menuHash);
    const crossDomainAfterRelogin = await assertCrossDomainDenied(accountPage);

    const restrictedManifest = {
      sensitive: true,
      doNotUpload: true,
      runId: RUN_ID,
      fixtureAttempt: "R7",
      generatedAt: new Date().toISOString(),
      accountId,
      username: USERNAME,
      password: finalPassword,
      totpSecret,
      roleId,
      roleCode: ROLE_CODE,
      grantOperationId: operationId,
      authorities: [...PERMISSIONS],
      effectiveMenus: [...MENUS],
      cleanupRequired: true,
    };
    await writeJsonAtomically(MANIFEST_PATH, restrictedManifest);
    fixture.accounts = { ...(fixture.accounts ?? {}), secondWriter: {
      accountId,
      username: USERNAME,
      password: finalPassword,
      totpSecret,
    } };
    await writeJsonAtomically(SOURCE_FIXTURE, fixture);

    const fixtureBeforeBootstrapDisable = JSON.parse(
      await readFile(SOURCE_FIXTURE, "utf8"),
    ) as Fixture;
    expect(
      fixtureBeforeBootstrapDisable.checker
        ? sha256(JSON.stringify(fixtureBeforeBootstrapDisable.checker))
        : null,
      "generic checker fixture must remain byte-equivalent",
    ).toBe(genericCheckerSnapshot);
    bootstrapDisableOperationId = await disableBootstrapUi(
      page,
      bootstrap.accountId,
      BOOTSTRAP_USERNAME,
    );
    await approveUi(bootstrapPage, bootstrapDisableOperationId);
    await assertAccountDisabled(page, bootstrap.accountId, BOOTSTRAP_USERNAME);
    await sanitizeBootstrapFailClosed(page, bootstrap.accountId, superUsername);

    evidence.role = { id: roleId, roleCode: ROLE_CODE, grantOperationId: operationId };
    evidence.account = {
      id: accountId,
      username: USERNAME,
      passwordSha256: sha256(finalPassword),
      totpSecretSha256: sha256(totpSecret),
    };
    evidence.bootstrap = {
      accountId: bootstrap.accountId,
      username: BOOTSTRAP_USERNAME,
      finalState: "disabled-unassigned-mfa-cleared",
      sessionCount: 0,
      disableOperationId: bootstrapDisableOperationId,
      passwordSha256: sha256(bootstrap.finalPassword),
      totpSecretSha256: sha256(bootstrap.totpSecret),
    };
    evidence.session = { initial, afterRefresh, afterRelogin };
    evidence.sidebar = { initialSidebar, refreshedSidebar, reloginSidebar };
    evidence.crossDomain = { initial: crossDomain, afterRelogin: crossDomainAfterRelogin };
    evidence.status = "passed";
    completed = true;
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = serializeError(error);
    evidence.partial = {
      roleId,
      operationId,
      accountId,
      bootstrapAccountId: bootstrap.accountId,
      bootstrapDisableOperationId,
    };
    throw error;
  } finally {
    if (!completed && mutationStarted) {
      evidence.partialCleanup = await cleanupPartial(
        page,
        bootstrapPage,
        superUsername,
        superPassword,
        roleId,
        operationId,
        accountId,
        bootstrap,
        bootstrapDisableOperationId,
      ).catch((error) => ({ completed: false, error: serializeError(error) }));
    }
    await writeFile(
      path.join(EVIDENCE_DIR, "R7-fixture-result.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    await Promise.allSettled([bootstrapContext.close(), accountContext.close()]);
  }
});

test("B R7 PASS 收口：回收 secondWriter、角色、会话、工单与受限凭据", async ({
  baseURL,
  page,
  browser,
}) => {
  test.skip(
    true,
    "R7 closeout is sealed after successful cleanup; this carrier must not be retriggered.",
  );
  expect(process.env.B_EXPECT_MFA_BYPASS).toBe("true");
  const mysqlPassword = must("B_MYSQL_PASSWORD");
  const targetGate = await assertTargetGate(baseURL, mysqlPassword);
  const superUsername = must("ADMIN_E2E_USERNAME");
  const superPassword = must("ADMIN_E2E_PASSWORD");
  const sourceBefore = JSON.parse(await readFile(SOURCE_FIXTURE, "utf8")) as Fixture;
  const manifestBefore = JSON.parse(
    await readFile(MANIFEST_PATH, "utf8"),
  ) as Record<string, unknown>;
  expect(sourceBefore.accounts?.secondWriter?.username).toBe(USERNAME);
  expect(String(sourceBefore.accounts?.secondWriter?.accountId)).toBe(R7_ACCOUNT_ID);
  expect(manifestBefore.fixtureAttempt).toBe("R7");
  expect(manifestBefore.roleCode).toBe(ROLE_CODE);
  expect(manifestBefore.username).toBe(USERNAME);
  expect(Number(manifestBefore.roleId)).toBe(R7_ROLE_ID);
  expect(String(manifestBefore.accountId)).toBe(R7_ACCOUNT_ID);

  const closeoutContext = await browser.newContext();
  const closeoutPage = await closeoutContext.newPage();
  const bootstrap: BootstrapState = {
    accountId: "",
    temporaryPassword: "",
    finalPassword: "",
    totpSecret: "",
  };
  const result: Record<string, unknown> = {
    runId: RUN_ID,
    fixtureAttempt: "R7-closeout",
    targetGate,
    roleId: R7_ROLE_ID,
    accountId: R7_ACCOUNT_ID,
    status: "started",
  };
  const errors: Error[] = [];
  let cleanupResult: Record<string, unknown> | null = null;
  try {
    await loginSuperBypass(page, superUsername, superPassword);
    const superSession = await session(page);
    expect(superSession.username).toBe(superUsername);
    result.preMutationTargetBinding = await assertExactTargetBinding(
      page,
      mysqlPassword,
      R7_ROLE_ID,
      ROLE_CODE,
      R7_ACCOUNT_ID,
      USERNAME,
    );
    const created = await createAccountUi(
      page,
      R7_CLOSEOUT_BOOTSTRAP_USERNAME,
      R7_CLOSEOUT_BOOTSTRAP_DISPLAY_NAME,
      "超级管理员",
    );
    bootstrap.accountId = String(created.id ?? "");
    expect(bootstrap.accountId).toMatch(/^\d+$/);
    bootstrap.temporaryPassword = await takeTemporaryPassword(page);
    bootstrap.finalPassword = `Nx!B23Close${randomBytes(16).toString("base64url")}Aa`;
    bootstrap.totpSecret = await activateMfa(
      closeoutPage,
      R7_CLOSEOUT_BOOTSTRAP_USERNAME,
      bootstrap.temporaryPassword,
      bootstrap.finalPassword,
      bootstrap,
    );
    const closeoutSession = await session(closeoutPage);
    expect(closeoutSession.username).toBe(R7_CLOSEOUT_BOOTSTRAP_USERNAME);
    expect(String(closeoutSession.adminId)).toBe(bootstrap.accountId);
    expect(closeoutSession.roleCode).toBe("SUPER_ADMIN");
    expect(new Set(closeoutSession.authorities)).toEqual(
      new Set(superSession.authorities),
    );
    expect(new Set(closeoutSession.menuCodes)).toEqual(
      new Set(superSession.menuCodes),
    );
  } catch (error) {
    errors.push(new Error(`closeout-bootstrap: ${errorMessage(error)}`));
  } finally {
    try {
      cleanupResult = await cleanupPartial(
        page,
        closeoutPage,
        superUsername,
        superPassword,
        R7_ROLE_ID,
        "",
        R7_ACCOUNT_ID,
        bootstrap,
        "",
        R7_CLOSEOUT_BOOTSTRAP_USERNAME,
      ) as Record<string, unknown>;
      result.cleanup = cleanupResult;
    } catch (error) {
      errors.push(new Error(`closeout-cleanup: ${errorMessage(error)}`));
    }

    try {
      const roleState = await mysqlExec(mysqlPassword, `
        SELECT CONCAT(
          r.is_deleted,'|',
          (SELECT COUNT(*) FROM nx_admin_role_relation rr
            WHERE rr.role_id=r.id AND rr.is_deleted=0),'|',
          (SELECT COUNT(*) FROM nx_admin_role_menu rm
            WHERE rm.role_id=r.id AND rm.is_deleted=0),'|',
          (SELECT COUNT(*) FROM nx_admin_role_permission rp
            WHERE rp.role_id=r.id AND rp.is_deleted=0)
        )
        FROM nx_admin_role r
        WHERE r.id=${R7_ROLE_ID} AND r.role_code=${sqlString(ROLE_CODE)}
      `);
      expect(roleState).toBe("1|0|0|0");
      const accountState = await mysqlExec(mysqlPassword, `
        SELECT CONCAT(
          a.status,'|',
          (SELECT COUNT(*) FROM nx_admin_role_relation rr
            WHERE rr.admin_id=a.id AND rr.is_deleted=0),'|',
          COALESCE((SELECT IF(s.tfa_secret_encrypted IS NULL,0,1)
            FROM nx_admin_account_state s
            WHERE s.admin_id=a.id AND s.is_deleted=0),0)
        )
        FROM nx_admin a
        WHERE a.id=${R7_ACCOUNT_ID} AND a.username=${sqlString(USERNAME)}
          AND a.is_deleted=0
      `);
      expect(accountState).toBe("0|0|0");
      const pending = Number(await mysqlExec(mysqlPassword, `
        SELECT COUNT(*) FROM nx_audit_operation_ticket
        WHERE status='pending' AND is_deleted=0
          AND (
            object_text LIKE ${sqlString(`%${ROLE_CODE}%`)}
            OR object_text LIKE ${sqlString(`%${USERNAME}%`)}
            OR command_json LIKE ${sqlString(`%${ROLE_CODE}%`)}
            OR command_json LIKE ${sqlString(`%${USERNAME}%`)}
            OR command_json LIKE ${sqlString(`%${R7_CLOSEOUT_BOOTSTRAP_USERNAME}%`)}
          )
      `));
      expect(pending).toBe(0);
      const runLocks = Number(await mysqlExec(mysqlPassword, `
        SELECT COUNT(*) FROM nx_admin_operation_mutex
        WHERE lock_key LIKE ${sqlString(`%${RUN_ID}%`)}
      `));
      expect(runLocks).toBe(0);
      const sourceAfter = JSON.parse(await readFile(SOURCE_FIXTURE, "utf8")) as Fixture;
      expect(sourceAfter.accounts?.secondWriter).toBeUndefined();
      const invalidatedManifest = JSON.parse(
        await readFile(MANIFEST_PATH, "utf8"),
      ) as Record<string, unknown>;
      expect(invalidatedManifest.status).toBe("invalidated-by-failure-cleanup");
      expect(invalidatedManifest.credentialsRetained).toBe(false);
      expect(invalidatedManifest.password).toBeUndefined();
      expect(invalidatedManifest.totpSecret).toBeUndefined();
      result.verification = {
        roleState,
        accountState,
        pending,
        runLocks,
        fixtureRetracted: true,
        credentialsRetained: false,
      };
    } catch (error) {
      errors.push(new Error(`closeout-verification: ${errorMessage(error)}`));
    }

    result.status = errors.length ? "failed" : "passed";
    result.completedAt = new Date().toISOString();
    await writeFile(
      path.join(EVIDENCE_DIR, "R7-closeout-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    await closeoutContext.close();
  }
  if (errors.length) {
    throw new AggregateError(errors, "R7 closeout left unresolved state");
  }
  expect(cleanupResult).toBeTruthy();
});

test("B RED 收口：独立 bootstrap 批准可见 A6 删除 final2 空角色并回收自身", async ({
  baseURL,
  page,
  browser,
}) => {
  test.skip(
    process.env.B_RED_CLEANUP_TOKEN?.trim() !== RED_CLEANUP_TOKEN,
    "Main-controller RED cleanup authorization not issued.",
  );
  expect(process.env.B_EXPECT_MFA_BYPASS).toBe("true");
  const mysqlPassword = must("B_MYSQL_PASSWORD");
  const targetGate = await assertTargetGate(baseURL, mysqlPassword);
  const superUsername = must("ADMIN_E2E_USERNAME");
  const superPassword = must("ADMIN_E2E_PASSWORD");
  const cleanupContext = await browser.newContext();
  const cleanupPage = await cleanupContext.newPage();
  const bootstrap: BootstrapState = {
    accountId: "",
    temporaryPassword: "",
    finalPassword: "",
    totpSecret: "",
  };
  const result: Record<string, unknown> = {
    runId: RUN_ID,
    source: "authorized RED role cleanup",
    targetGate,
    roleCode: RED_ROLE_CODE,
    status: "running",
  };
  let roleId = 0;
  let roleDeleteOperationId = "";
  let bootstrapDisableOperationId = "";
  let completed = false;

  try {
    await loginSuperBypass(page, superUsername, superPassword);
    const superSession = await session(page);
    const accountsBefore = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/accounts/overview"),
      "cleanup bootstrap preflight",
    );
    expect(
      (accountsBefore.operators as Array<Record<string, unknown>>)
        .some((account) => account.username === CLEANUP_BOOTSTRAP_USERNAME),
    ).toBe(false);
    const rolesBefore = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/roles/overview"),
      "RED role preflight",
    );
    const staleRole = (rolesBefore.roles as Array<Record<string, unknown>>)
      .find((role) => role.roleCode === RED_ROLE_CODE);
    expect(staleRole, "final2 RED role must exist before cleanup").toBeTruthy();
    roleId = Number(staleRole!.id);
    expect(roleId, "cleanup authority is locked to exact RED role id").toBe(RED_ROLE_ID);
    const rolePreDeleteState = await mysqlExec(mysqlPassword, `
      SELECT CONCAT(
        r.is_deleted,'|',
        (SELECT COUNT(*) FROM nx_admin_role_relation rr
          WHERE rr.role_id=r.id AND rr.is_deleted=0),'|',
        (SELECT COUNT(*) FROM nx_admin_role_menu rm
          WHERE rm.role_id=r.id AND rm.is_deleted=0),'|',
        (SELECT COUNT(*) FROM nx_admin_role_permission rp
          WHERE rp.role_id=r.id AND rp.is_deleted=0),'|',
        (SELECT GROUP_CONCAT(m.menu_code ORDER BY m.menu_code SEPARATOR ',')
          FROM nx_admin_role_menu rm
          JOIN nx_admin_menu m ON m.id=rm.menu_id
          WHERE rm.role_id=r.id AND rm.is_deleted=0),'|',
        (SELECT GROUP_CONCAT(p.permission_code ORDER BY p.permission_code SEPARATOR ',')
          FROM nx_admin_role_permission rp
          JOIN nx_admin_permission p ON p.id=rp.permission_id
          WHERE rp.role_id=r.id AND rp.is_deleted=0)
      )
      FROM nx_admin_role r
      WHERE r.id=${RED_ROLE_ID} AND r.role_code=${sqlString(RED_ROLE_CODE)}
    `);
    expect(
      rolePreDeleteState,
      "exact RED role must have zero active accounts and only its expected B2/B3 grants",
    ).toBe(
      "0|0|2|4|B2,B3|overview_b2_read,overview_b2_write,"
      + "overview_b3_read,overview_b3_view_write",
    );

    const createdBootstrap = await createAccountUi(
      page,
      CLEANUP_BOOTSTRAP_USERNAME,
      CLEANUP_BOOTSTRAP_DISPLAY_NAME,
      "超级管理员",
    );
    bootstrap.accountId = String(createdBootstrap.id ?? "");
    expect(bootstrap.accountId).toMatch(/^\d+$/);
    bootstrap.temporaryPassword = await takeTemporaryPassword(page);
    bootstrap.finalPassword = `Nx!B23Red${randomBytes(16).toString("base64url")}Aa`;
    bootstrap.totpSecret = await activateMfa(
      cleanupPage,
      CLEANUP_BOOTSTRAP_USERNAME,
      bootstrap.temporaryPassword,
      bootstrap.finalPassword,
      bootstrap,
    );
    const cleanupSession = await session(cleanupPage);
    expect(cleanupSession.username).toBe(CLEANUP_BOOTSTRAP_USERNAME);
    expect(String(cleanupSession.adminId)).toBe(bootstrap.accountId);
    expect(cleanupSession.roleCode).toBe("SUPER_ADMIN");
    expect(new Set(cleanupSession.authorities)).toEqual(
      new Set(superSession.authorities),
    );
    expect(new Set(cleanupSession.menuCodes)).toEqual(
      new Set(superSession.menuCodes),
    );

    await nav(page, "角色管理 A6", /\/platform\/roles$/);
    await page.reload({ waitUntil: "domcontentloaded" });
    const roleCode = page.getByText(RED_ROLE_CODE, { exact: true }).first();
    await expect(roleCode).toBeVisible({ timeout: 30_000 });
    await roleCode.click();
    await expect(page.getByRole("button", { name: "删除角色", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "删除角色", exact: true }).click();
    const deleteResponse = await confirm(
      page,
      `${REASON} RED 收口删除 final2 空角色`,
      (candidate) => candidate.request().method() === "DELETE"
        && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}`),
    );
    const deleteTicket = await success<Record<string, unknown>>(
      deleteResponse,
      "RED final2 role delete proposal",
    );
    roleDeleteOperationId = String(
      deleteTicket.operationId ?? deleteTicket.id ?? "",
    );
    expect(roleDeleteOperationId).toMatch(/^(?:WO|OP)-/);
    await decideUi(cleanupPage, roleDeleteOperationId, "执行", "approve");

    await expect.poll(async () => {
      const roles = await success<Record<string, unknown>>(
        await page.request.get("/api/admin/platform/roles/overview"),
        "post-delete role overview",
      );
      return (roles.roles as Array<Record<string, unknown>>)
        .some((role) => role.roleCode === RED_ROLE_CODE);
    }, { timeout: 30_000 }).toBe(false);
    const roleDbState = await mysqlExec(mysqlPassword, `
      SELECT CONCAT(
        r.is_deleted,'|',
        (SELECT COUNT(*) FROM nx_admin_role_relation rr
          WHERE rr.role_id=r.id AND rr.is_deleted=0),'|',
        (SELECT COUNT(*) FROM nx_admin_role_menu rm
          WHERE rm.role_id=r.id AND rm.is_deleted=0),'|',
        (SELECT COUNT(*) FROM nx_admin_role_permission rp
          WHERE rp.role_id=r.id AND rp.is_deleted=0)
      )
      FROM nx_admin_role r
      WHERE r.id=${roleId} AND r.role_code=${sqlString(RED_ROLE_CODE)}
    `);
    expect(roleDbState).toBe("1|0|0|0");

    bootstrapDisableOperationId = await disableBootstrapUi(
      page,
      bootstrap.accountId,
      CLEANUP_BOOTSTRAP_USERNAME,
    );
    await decideUi(cleanupPage, bootstrapDisableOperationId, "执行", "approve");
    await assertAccountDisabled(
      page,
      bootstrap.accountId,
      CLEANUP_BOOTSTRAP_USERNAME,
    );
    await sanitizeBootstrapFailClosed(page, bootstrap.accountId, superUsername);
    result.status = "passed";
    result.role = {
      id: roleId,
      roleCode: RED_ROLE_CODE,
      preDeleteDbState: rolePreDeleteState,
      deleteOperationId: roleDeleteOperationId,
      dbState: roleDbState,
      visibleInA6: false,
    };
    result.bootstrap = {
      accountId: bootstrap.accountId,
      username: CLEANUP_BOOTSTRAP_USERNAME,
      finalState: "disabled-unassigned-mfa-cleared",
      disableOperationId: bootstrapDisableOperationId,
      passwordSha256: sha256(bootstrap.finalPassword),
      totpSecretSha256: sha256(bootstrap.totpSecret),
    };
    completed = true;
  } catch (error) {
    result.status = "failed";
    result.failure = serializeError(error);
    throw error;
  } finally {
    const cleanupErrors: Error[] = [];
    if (!bootstrap.accountId) {
      const overview = await page.request.get("/api/admin/platform/accounts/overview")
        .then((response) => success<Record<string, unknown>>(
          response,
          "discover RED cleanup bootstrap",
        ))
        .catch(() => null);
      const discovered = overview
        ? (overview.operators as Array<Record<string, unknown>>)
          .find((account) => account.username === CLEANUP_BOOTSTRAP_USERNAME)
        : null;
      bootstrap.accountId = String(discovered?.id ?? "");
    }
    if (!completed) {
      try {
        if (bootstrap.accountId) {
          await ensureBootstrapChecker(
            cleanupPage,
            bootstrap,
            CLEANUP_BOOTSTRAP_USERNAME,
          );
        }
        const pendingDeleteId = roleDeleteOperationId
          || await findPendingRoleDelete(cleanupPage);
        if (pendingDeleteId && await operationIsPending(cleanupPage, pendingDeleteId)) {
          await decideUi(cleanupPage, pendingDeleteId, "取消", "reject");
          result.pendingDeleteCleanup = {
            operationId: pendingDeleteId,
            rejected: true,
          };
        }
      } catch (error) {
        cleanupErrors.push(new Error(`pending-role-delete-cleanup: ${errorMessage(error)}`));
        result.pendingDeleteCleanup = {
          rejected: false,
          error: serializeError(error),
        };
      }
      if (bootstrap.accountId) {
        try {
          await sanitizeBootstrapFailClosed(
            page,
            bootstrap.accountId,
            superUsername,
          );
          result.bootstrapEmergencyCleanup = { completed: true };
        } catch (error) {
          cleanupErrors.push(new Error(`bootstrap-cleanup: ${errorMessage(error)}`));
          result.bootstrapEmergencyCleanup = {
            completed: false,
            error: serializeError(error),
          };
        }
      }
    }
    await writeFile(
      path.join(EVIDENCE_DIR, "red-role-cleanup-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    await cleanupContext.close();
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, "RED cleanup failure path left unresolved state");
    }
  }
});

async function assertTargetGate(baseURL: string | undefined, mysqlPassword: string) {
  const target = new URL(baseURL ?? "");
  expect(["127.0.0.1", "localhost"]).toContain(target.hostname);
  expect(target.port).toBe("3303");
  expect(must("B_CHILD_DATABASE")).toBe(EXPECTED_DATABASE);
  expect(must("B_PC_BUILD_ID")).toBe(EXPECTED_PC_BUILD_ID);
  const pcPid = Number(must("B_PC_PID"));
  const backendPid = Number(must("B_BACKEND_PID"));
  expect(Number.isSafeInteger(pcPid) && pcPid > 0).toBe(true);
  expect(Number.isSafeInteger(backendPid) && backendPid > 0).toBe(true);
  expect(portOwner(3303)).toBe(pcPid);
  expect(portOwner(18120)).toBe(backendPid);

  const backendCommand = processCommandLine(backendPid);
  expect(backendCommand).toContain("--server.port=18120");
  expect(backendCommand.toLowerCase()).toContain(BACKEND_JAR.toLowerCase());
  expect(path.resolve(must("B_BACKEND_JAR_PATH"))).toBe(BACKEND_JAR);
  expect(await sha256File(BACKEND_JAR)).toBe(EXPECTED_JAR_SHA);

  const buildIdPath = path.resolve(must("B_PC_BUILD_ID_PATH"));
  expect((await readFile(buildIdPath, "utf8")).trim()).toBe(EXPECTED_PC_BUILD_ID);
  const servedBuildManifest = await fetch(
    new URL(`/_next/static/${EXPECTED_PC_BUILD_ID}/_buildManifest.js`, target.origin),
  );
  expect(
    servedBuildManifest.status,
    "locked PC process must serve the frozen Build ID",
  ).toBe(200);
  expect(await mysqlExec(mysqlPassword, "SELECT DATABASE()")).toBe(EXPECTED_DATABASE);
  const directBackend = await fetch("http://127.0.0.1:18120/api/admin/auth/session");
  expect(directBackend.status, "direct child backend anonymous session gate").toBe(401);
  return {
    baseUrl: target.origin,
    pcPid,
    backendPid,
    database: EXPECTED_DATABASE,
    pcBuildId: EXPECTED_PC_BUILD_ID,
    servedBuildManifestStatus: servedBuildManifest.status,
    backendJarSha256: EXPECTED_JAR_SHA,
    directBackendAnonymousStatus: directBackend.status,
  };
}

async function assertChildDatasource(page: Page, mysqlPassword: string) {
  const before = await snapshotSentinel(mysqlPassword);
  const sentinel = `b-fixture:${RUN_ID}:${randomBytes(8).toString("hex")}`;
  let observed: unknown;
  let failure: unknown;
  try {
    await mysqlExec(mysqlPassword, `
      INSERT INTO nx_config_item(
        config_key,config_value,value_type,config_group,visibility,remark,status,
        created_at,updated_at,is_deleted
      ) VALUES (
        ${sqlString(SENTINEL_KEY)},${sqlString(sentinel)},'STRING',
        'admin_feature_flag','ADMIN','B fixture datasource sentinel',1,NOW(),NOW(),0
      )
      ON DUPLICATE KEY UPDATE
        config_value=VALUES(config_value),value_type=VALUES(value_type),
        config_group=VALUES(config_group),visibility=VALUES(visibility),
        remark=VALUES(remark),status=1,updated_at=NOW(),is_deleted=0
    `);
    const response = await page.request.get("/api/admin/platform/flags/runtime");
    const body = await response.json() as Envelope<{ value?: string }>;
    expect(response.status()).toBe(200);
    expect(body.code).toBe(0);
    expect(body.data?.value).toBe(sentinel);
    observed = { http: response.status(), valueHash: sha256(sentinel) };
  } catch (error) {
    failure = error;
  } finally {
    await restoreSentinel(mysqlPassword, before);
  }
  expect(await snapshotSentinel(mysqlPassword)).toEqual(before);
  if (failure) throw failure;
  return { key: SENTINEL_KEY, observed, restoredExact: true };
}

async function snapshotSentinel(password: string): Promise<ConfigRow[]> {
  const raw = await mysqlExec(password, `
    SELECT REPLACE(TO_BASE64(CAST(JSON_OBJECT(
      'id', id, 'configKey', config_key, 'configValue', config_value,
      'valueType', value_type, 'configGroup', config_group,
      'visibility', visibility, 'remark', remark, 'status', status,
      'createdAt', DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),
      'updatedAt', DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s'),
      'isDeleted', is_deleted
    ) AS CHAR CHARACTER SET utf8mb4)), CHAR(10), '')
    FROM nx_config_item
    WHERE config_key=${sqlString(SENTINEL_KEY)}
    ORDER BY id
  `);
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map((line) =>
    JSON.parse(Buffer.from(line, "base64").toString("utf8")) as ConfigRow);
}

async function restoreSentinel(password: string, rows: ConfigRow[]) {
  const inserts = rows.map((row) => `
    INSERT INTO nx_config_item(
      id,config_key,config_value,value_type,config_group,visibility,remark,status,
      created_at,updated_at,is_deleted
    ) VALUES (
      ${row.id},${sqlString(row.configKey)},${sqlNullable(row.configValue)},
      ${sqlNullable(row.valueType)},${sqlNullable(row.configGroup)},
      ${sqlNullable(row.visibility)},${sqlNullable(row.remark)},${row.status},
      ${sqlString(row.createdAt)},${sqlString(row.updatedAt)},${row.isDeleted}
    );
  `).join("\n");
  await mysqlExec(password, `
    START TRANSACTION;
    DELETE FROM nx_config_item WHERE config_key=${sqlString(SENTINEL_KEY)};
    ${inserts}
    COMMIT;
  `);
}

async function mysqlExec(password: string, sql: string) {
  return execFileSync(
    MYSQL_EXE,
    [
      "--default-character-set=utf8mb4",
      "--batch",
      "--raw",
      "--skip-column-names",
      "-uroot",
      "-D",
      EXPECTED_DATABASE,
      "-e",
      sql,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, MYSQL_PWD: password },
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  ).trim();
}

function portOwner(port: number) {
  const raw = execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction Stop).OwningProcess`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  return Number(raw);
}

function processCommandLine(pid: number) {
  return execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
}

async function sha256File(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex").toUpperCase();
}

function sqlString(value: string) {
  return `CONVERT(UNHEX('${Buffer.from(value, "utf8").toString("hex")}') USING utf8mb4)`;
}

function sqlNullable(value: string | null) {
  return value == null ? "NULL" : sqlString(value);
}

async function createRoleUi(page: Page) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  await page.getByRole("button", { name: "+ 新建角色", exact: true }).click();
  await page.getByPlaceholder("如 CONTENT_EDITOR").fill(ROLE_CODE);
  await page.getByPlaceholder("如 内容编辑员").fill(ROLE_NAME);
  await page.getByPlaceholder("职责说明").fill("隔离 child B2/B3 CAS 与幂等验收临时第二写者");
  await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 创建角色`,
    (candidate) => candidate.request().method() === "POST"
      && candidate.url().endsWith("/api/admin/platform/roles"),
  );
  const created = await success<Record<string, unknown>>(response, "create B secondWriter role");
  const id = Number(created.id);
  expect(id).toBeGreaterThan(0);
  return id;
}

async function grantRoleUi(page: Page, roleId: number) {
  await page.getByText(ROLE_CODE, { exact: true }).first().click();
  await page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
  for (const permission of PERMISSIONS) {
    await page.getByLabel("权限搜索").fill(permission);
    await page.locator(`label[title="${permission}"] input[type="checkbox"]`).check();
  }
  const menuPanel = page.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div");
  for (const code of GRANTED_MENU_LEAVES) {
    const row = menuPanel.getByText(code, { exact: true })
      .locator("xpath=ancestor::div[contains(@class,'row')][1]");
    await row.locator('input[type="checkbox"]').check();
  }
  await page.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 提交精确授权`,
    (candidate) => candidate.request().method() === "PUT"
      && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}/grants`),
  );
  const ticket = await success<Record<string, unknown>>(response, "grant B secondWriter role");
  const id = String(ticket.operationId ?? ticket.id ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function assertSelfApprovalDenied(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} maker 自批必须拒绝`,
    (candidate) => candidate.url()
      .endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`),
  );
  expect(response.status()).toBe(403);
  const body = await response.json() as Envelope;
  expect(body.message).toBe("A2_MAKER_CHECKER_REQUIRED");
  const confirmation = page.getByRole("dialog")
    .filter({ has: page.getByLabel(/操作理由/) });
  await expect(confirmation.getByRole("alert")).toContainText(
    "发起人不能执行自己发起的待确认票",
  );
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
}

async function approveUi(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} checker 独立批准`,
    (candidate) => candidate.url()
      .endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`),
  );
  await success(response, "approve B secondWriter grants");
}

async function disableBootstrapUi(
  page: Page,
  accountId: string,
  username: string,
) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("select.pager-size").selectOption("50");
  const row = await findAccountRow(page, username);
  expect(String((await getAccount(page, accountId)).id)).toBe(accountId);
  await row.getByRole("button", { name: "禁用", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 回收 bootstrap 超管账号`,
    (candidate) => candidate.request().method() === "POST"
      && candidate.url().endsWith("/api/admin/platform/audit/operations"),
  );
  const ticket = await success<Record<string, unknown>>(
    response,
    "disable bootstrap proposal",
  );
  const operationId = String(ticket.operationId ?? ticket.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function findAccountRow(page: Page, username: string) {
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const row = page.locator("tbody tr").filter({ hasText: username });
    if (await row.isVisible().catch(() => false)) return row;
    const next = page.locator("button.pager-btn").last();
    if (await next.isDisabled()) break;
    await next.click();
    await expect(page.locator(".pager-info")).toBeVisible();
  }
  throw new Error(`A1 account row not found after paging: ${username}`);
}

async function assertAccountDisabled(
  page: Page,
  accountId: string,
  username: string,
) {
  const account = await getAccount(page, accountId);
  expect(account.username).toBe(username);
  expect(account.status).toBe("disabled");
  expect(Number(account.sessions)).toBe(0);
}

async function createAccountUi(
  page: Page,
  username: string,
  displayName: string,
  roleName: string,
) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const scope = page.getByRole("dialog").last();
  await expect(scope.getByText("新建运营账号", { exact: true })).toBeVisible();
  await scope.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
  await scope.getByPlaceholder("姓名,如:张三").fill(displayName);
  await scope.getByText(roleName, { exact: true }).click();
  await scope.getByLabel(/操作理由/).fill(`${REASON} 创建账号`);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && candidate.url().endsWith("/api/admin/platform/accounts"));
  await scope.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirmation = page.getByRole("dialog").last();
  await confirmation.getByLabel(/操作理由/).fill(`${REASON} 创建账号确认`);
  await confirmation.getByRole("button", { name: "确认提交", exact: true }).click();
  return success<Record<string, unknown>>(await response, `create account ${username}`);
}

async function takeTemporaryPassword(page: Page) {
  const scope = page.getByRole("dialog").last();
  await expect(scope.getByText("临时密码", { exact: true })).toBeVisible();
  const password = (await scope.locator(".mono").last().textContent())?.trim() ?? "";
  expect(password).not.toBe("");
  await scope.getByText("关闭", { exact: true }).click();
  return password;
}

async function activateMfa(
  page: Page,
  username: string,
  temporaryPassword: string,
  finalPassword: string,
  progress?: BootstrapState,
) {
  await awaitHydratedLoginPage(page);
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const loginResponse = waitForAuthResponse(page, "/api/admin/auth/login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  const secret = ((await page.locator("code").first().textContent()) ?? "").trim();
  expect(secret).not.toBe("");
  if (progress) progress.totpSecret = secret;
  await otp.fill(await freshTotp(secret));
  const mfaResponse = waitForAuthResponse(page, "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await mfaResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
  await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
  const changeResponse = waitForAuthResponse(page, "/api/admin/auth/password/change");
  await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  expect((await changeResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return secret;
}

async function loginSuperBypass(page: Page, username: string, password: string) {
  await awaitHydratedLoginPage(page);
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const response = waitForAuthResponse(page, "/api/admin/auth/login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel("一次性验证码")).toHaveCount(0);
}

async function loginMfa(page: Page, account: Account) {
  await awaitHydratedLoginPage(page);
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = waitForAuthResponse(page, "/api/admin/auth/login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  expect(account.totpSecret).toBeTruthy();
  await otp.fill(await freshTotp(account.totpSecret!));
  const mfaResponse = waitForAuthResponse(page, "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await mfaResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function awaitHydratedLoginPage(page: Page) {
  const restored = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && new URL(candidate.url()).pathname === "/api/admin/auth/session");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await restored;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

function waitForAuthResponse(page: Page, endpoint: string) {
  return page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname === endpoint);
}

async function assertSessionExact(page: Page, expectedAccountId: string) {
  const current = await session(page);
  expect(current.username).toBe(USERNAME);
  expect(String(current.adminId)).toBe(expectedAccountId);
  expect(new Set(current.authorities)).toEqual(new Set(PERMISSIONS));
  expect(new Set(current.menuCodes)).toEqual(new Set(MENUS));
  return {
    accountId: current.adminId,
    username: current.username,
    authorityHash: sha256(JSON.stringify([...current.authorities].sort())),
    menuHash: sha256(JSON.stringify([...current.menuCodes].sort())),
  };
}

async function assertSidebarExactB(page: Page) {
  const sidebar = page.locator("aside");
  const group = sidebar.getByRole("button", {
    name: /总览驾驶舱.*B|B.*总览驾驶舱/,
  });
  await expect(group).toBeVisible();
  const b2 = sidebar.getByRole("link", { name: /资金池水位.*B2|B2.*资金池水位/ });
  if (!(await b2.isVisible().catch(() => false))) await group.click();
  await expect(b2).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: /转化漏斗.*B3|B3.*转化漏斗/ }),
  ).toBeVisible();
  for (const forbidden of [
    /双账本总览.*B1|B1.*双账本总览/,
    /节奏状态.*B4|B4.*节奏状态/,
    /风险雷达.*B5|B5.*风险雷达/,
  ]) {
    await expect(sidebar.getByRole("link", { name: forbidden })).toHaveCount(0);
  }
  return {
    derivedGroup: "B",
    visibleLeaves: [...MENUS],
    hiddenLeaves: ["B1", "B4", "B5"],
  };
}

async function assertCrossDomainDenied(page: Page) {
  const results: Record<string, number> = {};
  for (const endpoint of CROSS_DOMAIN_ENDPOINTS) {
    const response = await page.request.get(endpoint);
    expect(response.status(), endpoint).toBe(403);
    results[endpoint] = response.status();
  }
  return results;
}

async function assertCrossDomainProbeExists(page: Page) {
  const results: Record<string, number> = {};
  for (const endpoint of CROSS_DOMAIN_ENDPOINTS) {
    const response = await page.request.get(endpoint);
    expect(response.status(), `${endpoint} must exist for SUPER_ADMIN`).toBe(200);
    results[endpoint] = response.status();
  }
  return results;
}

async function session(page: Page) {
  const data = await success<{
    session?: {
      adminId?: number;
      username?: string;
      role?: string;
      roleCode?: string;
      authorities?: string[];
      menuCodes?: string[];
      effectiveMenus?: Array<string | { menuCode?: string }>;
    };
  }>(await page.request.get("/api/admin/auth/session"), "session");
  const value = data.session ?? {};
  const menuCodes = value.menuCodes
    ?? (value.effectiveMenus ?? []).map((menu) =>
      typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
  return {
    adminId: value.adminId,
    username: value.username,
    role: value.role,
    roleCode: value.roleCode,
    authorities: value.authorities ?? [],
    menuCodes,
  };
}

async function visibleLogout(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  const response = waitForAuthResponse(page, "/api/admin/auth/logout");
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function cleanupPartial(
  superPage: Page,
  bootstrapPage: Page,
  superUsername: string,
  superPassword: string,
  roleId: number,
  grantOperationId: string,
  accountId: string,
  bootstrap: BootstrapState,
  bootstrapDisableOperationId: string,
  bootstrapUsername = BOOTSTRAP_USERNAME,
  targetRoleCode = ROLE_CODE,
  targetUsername = USERNAME,
  targetManifestPath = MANIFEST_PATH,
) {
  const errors: Error[] = [];
  const warnings: string[] = [];
  const actions: string[] = [];
  let discovered = {
    roleId,
    grantOperationId,
    accountId,
    bootstrapAccountId: bootstrap.accountId,
    bootstrapDisableOperationId,
  };
  let bootstrapReady = false;
  let targetBindingReady = false;
  const attempt = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
      actions.push(label);
    } catch (error) {
      errors.push(new Error(`${label}: ${errorMessage(error)}`));
    }
  };

  await attempt("super-session-restored", async () => {
    if (!(await superPage.locator("aside").isVisible().catch(() => false))) {
      await loginSuperBypass(superPage, superUsername, superPassword);
    }
    expect((await session(superPage)).username).toBe(superUsername);
  });
  await attempt("partial-resources-discovered", async () => {
    discovered = await discoverPartialResources(
      superPage,
      roleId,
      grantOperationId,
      accountId,
      bootstrap.accountId,
      bootstrapDisableOperationId,
      bootstrapUsername,
      targetRoleCode,
      targetUsername,
    );
    targetBindingReady = true;
  });

  roleId = discovered.roleId;
  grantOperationId = discovered.grantOperationId;
  accountId = discovered.accountId;
  bootstrap.accountId = discovered.bootstrapAccountId;
  bootstrapDisableOperationId = discovered.bootstrapDisableOperationId;

  await attempt("bootstrap-checker-session-restored", async () => {
    await ensureBootstrapChecker(bootstrapPage, bootstrap, bootstrapUsername);
    bootstrapReady = true;
  });
  if (accountId) {
    await attempt("second-writer-reset2fa-unassigned-disabled-revoked", async () => {
      if (!targetBindingReady) throw new Error("TARGET_BINDING_NOT_VERIFIED");
      await sanitizeAccount(superPage, accountId, superUsername, targetUsername);
    });
  }
  if (grantOperationId) {
    await attempt("grant-ticket-rejected-if-pending", async () => {
      if (!bootstrapReady) throw new Error("BOOTSTRAP_CHECKER_UNAVAILABLE");
      if (await operationIsPending(bootstrapPage, grantOperationId)) {
        await decideUi(bootstrapPage, grantOperationId, "取消", "reject");
      }
    });
  }
  if (roleId) {
    await attempt("role-delete-proposed-and-approved", async () => {
      if (!targetBindingReady) throw new Error("TARGET_BINDING_NOT_VERIFIED");
      if (!bootstrapReady) throw new Error("BOOTSTRAP_CHECKER_UNAVAILABLE");
      await nav(superPage, "角色管理 A6", /\/platform\/roles$/);
      await superPage.reload({ waitUntil: "domcontentloaded" });
      const role = superPage.getByText(targetRoleCode, { exact: true }).first();
      await expect(role).toBeVisible({ timeout: 30_000 });
      await role.click();
      await superPage.getByRole("button", { name: "删除角色", exact: true }).click();
      const response = await confirm(
        superPage,
        `${REASON} 失败路径删除角色`,
        (candidate) => candidate.request().method() === "DELETE"
          && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}`),
      );
      const ticket = await success<Record<string, unknown>>(response, "partial role delete");
      const deleteId = String(ticket.operationId ?? ticket.id ?? "");
      expect(deleteId).toMatch(/^(?:WO|OP)-/);
      await decideUi(bootstrapPage, deleteId, "执行", "approve");
      await expect.poll(async () => {
        const roles = await success<Record<string, unknown>>(
          await superPage.request.get("/api/admin/platform/roles/overview"),
          "partial cleanup post-delete roles",
        );
        return (roles.roles as Array<Record<string, unknown>>)
          .some((candidate) => candidate.roleCode === targetRoleCode);
      }, { timeout: 30_000 }).toBe(false);
      const roleDbState = await mysqlExec(must("B_MYSQL_PASSWORD"), `
        SELECT CONCAT(
          r.is_deleted,'|',
          (SELECT COUNT(*) FROM nx_admin_role_relation rr
            WHERE rr.role_id=r.id AND rr.is_deleted=0),'|',
          (SELECT COUNT(*) FROM nx_admin_role_menu rm
            WHERE rm.role_id=r.id AND rm.is_deleted=0),'|',
          (SELECT COUNT(*) FROM nx_admin_role_permission rp
            WHERE rp.role_id=r.id AND rp.is_deleted=0)
        )
        FROM nx_admin_role r
        WHERE r.id=${roleId} AND r.role_code=${sqlString(targetRoleCode)}
      `);
      expect(roleDbState).toBe("1|0|0|0");
    });
  }

  await attempt("fixture-files-retracted-if-written", async () => {
    const current = JSON.parse(await readFile(SOURCE_FIXTURE, "utf8")) as Fixture;
    if (current.accounts?.secondWriter?.username === targetUsername) {
      const { secondWriter: _removed, ...remaining } = current.accounts;
      current.accounts = remaining;
      await writeJsonAtomically(SOURCE_FIXTURE, current);
    }
    await writeJsonAtomically(targetManifestPath, {
      sensitive: true,
      doNotUpload: true,
      runId: RUN_ID,
      status: "invalidated-by-failure-cleanup",
      invalidatedAt: new Date().toISOString(),
      username: targetUsername,
      accountId,
      credentialsRetained: false,
    });
  });

  if (bootstrap.accountId) {
    try {
      const current = await getAccount(superPage, bootstrap.accountId);
      if (current.status === "disabled") {
        expect(Number(current.sessions)).toBe(0);
      } else if (
        bootstrapReady
        &&
        bootstrapDisableOperationId
        && await operationIsPending(bootstrapPage, bootstrapDisableOperationId)
      ) {
        await decideUi(bootstrapPage, bootstrapDisableOperationId, "执行", "approve");
      } else if (bootstrapReady) {
        bootstrapDisableOperationId = await disableBootstrapUi(
          superPage,
          bootstrap.accountId,
          bootstrapUsername,
        );
        await decideUi(bootstrapPage, bootstrapDisableOperationId, "执行", "approve");
      } else {
        throw new Error("BOOTSTRAP_CHECKER_UNAVAILABLE");
      }
      await assertAccountDisabled(
        superPage,
        bootstrap.accountId,
        bootstrapUsername,
      );
      actions.push("bootstrap-disabled-by-visible-A1-and-independent-A2");
    } catch (error) {
      warnings.push(`bootstrap-visible-disable-fell-back: ${errorMessage(error)}`);
    }
    await attempt("bootstrap-emergency-cas-fail-closed", async () => {
      await sanitizeBootstrapFailClosed(
        superPage,
        bootstrap.accountId,
        superUsername,
      );
    });
  }

  if (errors.length) {
    throw new AggregateError(errors, "B fixture partial cleanup had independent failures");
  }
  return { completed: true, discovered, actions, warnings };
}

async function assertExactTargetBinding(
  page: Page,
  mysqlPassword: string,
  roleId: number,
  roleCode: string,
  accountId: string,
  username: string,
) {
  const roles = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/roles/overview"),
    "pre-mutation target role binding",
  );
  const roleByCode = (roles.roles as Array<Record<string, unknown>>)
    .find((candidate) => candidate.roleCode === roleCode);
  expect(roleByCode, `role ${roleCode} must exist before cleanup`).toBeTruthy();
  expect(Number(roleByCode?.id), `role ${roleCode} id drift`).toBe(roleId);

  const accounts = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"),
    "pre-mutation target account binding",
  );
  const accountByUsername = (accounts.operators as Array<Record<string, unknown>>)
    .find((candidate) => candidate.username === username);
  expect(accountByUsername, `account ${username} must exist before cleanup`).toBeTruthy();
  expect(String(accountByUsername?.id), `account ${username} id drift`).toBe(accountId);

  const databaseBinding = await mysqlExec(mysqlPassword, `
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin_role
        WHERE id=${roleId} AND role_code=${sqlString(roleCode)} AND is_deleted=0),
      '|',
      (SELECT COUNT(*) FROM nx_admin
        WHERE id=${accountId} AND username=${sqlString(username)} AND is_deleted=0)
    )
  `);
  expect(databaseBinding, "database target identity binding drift").toBe("1|1");
  return {
    role: { id: roleId, roleCode },
    account: { id: accountId, username },
    databaseBinding,
  };
}

async function discoverPartialResources(
  page: Page,
  knownRoleId: number,
  knownGrantOperationId: string,
  knownAccountId: string,
  knownBootstrapAccountId: string,
  knownBootstrapDisableOperationId: string,
  bootstrapUsername = BOOTSTRAP_USERNAME,
  targetRoleCode = ROLE_CODE,
  targetUsername = USERNAME,
) {
  const roles = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/roles/overview"),
    "discover partial role",
  );
  const role = (roles.roles as Array<Record<string, unknown>>)
    .find((candidate) => candidate.roleCode === targetRoleCode);
  if (knownRoleId) {
    expect(role, `role ${targetRoleCode} must exist before cleanup`).toBeTruthy();
    expect(Number(role?.id), `role ${targetRoleCode} id drift`).toBe(knownRoleId);
  }
  const roleId = Number(role?.id ?? 0);
  expect(Number.isSafeInteger(roleId) && roleId >= 0).toBe(true);

  const accounts = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"),
    "discover partial account",
  );
  const account = (accounts.operators as Array<Record<string, unknown>>)
    .find((candidate) => candidate.username === targetUsername);
  if (/^\d+$/.test(knownAccountId)) {
    expect(account, `account ${targetUsername} must exist before cleanup`).toBeTruthy();
    expect(String(account?.id), `account ${targetUsername} id drift`).toBe(knownAccountId);
  }
  const accountId = String(account?.id ?? "");
  const bootstrapAccount = (accounts.operators as Array<Record<string, unknown>>)
    .find((candidate) => candidate.username === bootstrapUsername);
  if (/^\d+$/.test(knownBootstrapAccountId)) {
    expect(bootstrapAccount, `bootstrap ${bootstrapUsername} must exist before cleanup`).toBeTruthy();
    expect(String(bootstrapAccount?.id), `bootstrap ${bootstrapUsername} id drift`)
      .toBe(knownBootstrapAccountId);
  }
  const bootstrapAccountId = String(bootstrapAccount?.id ?? "");

  const audit = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/audit/overview"),
    "discover partial grant ticket",
  );
  const pending = (audit.operationQueue as Array<Record<string, unknown>>)
    .find((ticket) =>
      ticket.status === "pending"
      && String(ticket.obj) === targetRoleCode
      && String(ticket.action).includes("角色授权"));
  const grantOperationId = knownGrantOperationId
    || String(pending?.id ?? pending?.operationId ?? "");
  const bootstrapPending = (audit.operationQueue as Array<Record<string, unknown>>)
    .find((ticket) =>
      ticket.status === "pending"
      && String(ticket.obj) === bootstrapAccountId
      && String(ticket.action).includes("禁用账号"));
  const bootstrapDisableOperationId = knownBootstrapDisableOperationId
    || String(bootstrapPending?.id ?? bootstrapPending?.operationId ?? "");
  if (grantOperationId) expect(grantOperationId).toMatch(/^(?:WO|OP)-/);
  if (accountId) expect(accountId).toMatch(/^\d+$/);
  if (bootstrapAccountId) expect(bootstrapAccountId).toMatch(/^\d+$/);
  if (bootstrapDisableOperationId) {
    expect(bootstrapDisableOperationId).toMatch(/^(?:WO|OP)-/);
  }
  return {
    roleId,
    grantOperationId,
    accountId,
    bootstrapAccountId,
    bootstrapDisableOperationId,
  };
}

async function ensureBootstrapChecker(
  page: Page,
  bootstrap: BootstrapState,
  username = BOOTSTRAP_USERNAME,
) {
  const current = await session(page).catch(() => null);
  if (current?.username === username) {
    expect(String(current.adminId)).toBe(bootstrap.accountId);
    return;
  }
  if (!bootstrap.finalPassword || !bootstrap.totpSecret) {
    throw new Error("BOOTSTRAP_CREDENTIALS_INCOMPLETE");
  }
  await loginMfa(page, {
    accountId: bootstrap.accountId,
    username,
    password: bootstrap.finalPassword,
    totpSecret: bootstrap.totpSecret,
  });
  const restored = await session(page);
  expect(restored.username).toBe(username);
  expect(String(restored.adminId)).toBe(bootstrap.accountId);
}

async function operationIsPending(page: Page, operationId: string) {
  const audit = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/audit/overview"),
    "partial cleanup audit",
  );
  return (audit.operationQueue as Array<Record<string, unknown>>)
    .some((ticket) =>
      String(ticket.id ?? ticket.operationId) === operationId
      && ticket.status === "pending");
}

async function findPendingRoleDelete(page: Page) {
  const audit = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/audit/overview"),
    "discover pending RED role delete",
  );
  const pending = (audit.operationQueue as Array<Record<string, unknown>>)
    .find((ticket) =>
      ticket.status === "pending"
      && String(ticket.action) === "A6_ROLE_DELETED"
      && String(ticket.obj) === RED_ROLE_CODE
      && String(ticket.reason).includes("RED 收口删除 final2 空角色"));
  const operationId = String(pending?.id ?? pending?.operationId ?? "");
  if (operationId) expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function sanitizeAccount(
  page: Page,
  accountId: string,
  operator: string,
  expectedUsername: string,
) {
  let account = await getAccount(page, accountId, expectedUsername);
  if (account.tfa === true) {
    await mutateAccount(page, accountId, "POST", "reset-2fa", {
      reason: `${REASON} 失败路径清除 MFA`,
      operator,
    }, expectedUsername);
  }
  account = await getAccount(page, accountId, expectedUsername);
  if (account.role !== "unassigned") {
    await mutateAccount(page, accountId, "PATCH", "role", {
      role: "unassigned",
      reason: `${REASON} 失败路径解除角色`,
      operator,
    }, expectedUsername);
  }
  account = await getAccount(page, accountId, expectedUsername);
  if (account.status !== "disabled") {
    await mutateAccount(page, accountId, "PATCH", "status", {
      status: "disabled",
      reason: `${REASON} 失败路径停用`,
      operator,
    }, expectedUsername);
  }
  account = await getAccount(page, accountId, expectedUsername);
  if (Number(account.sessions) > 0) {
    await mutateAccount(page, accountId, "POST", "sessions/revoke", {
      reason: `${REASON} 失败路径撤销会话`,
      operator,
    }, expectedUsername);
  }
  expect(await getAccount(page, accountId, expectedUsername)).toMatchObject({
    role: "unassigned",
    status: "disabled",
    tfa: false,
    sessions: 0,
  });
}

async function sanitizeBootstrapFailClosed(
  page: Page,
  accountId: string,
  operator: string,
) {
  const errors: Error[] = [];
  const converge = async (
    label: string,
    isDone: (account: Record<string, unknown>) => boolean,
    mutate: () => Promise<void>,
  ) => {
    let preReadFailure: unknown;
    let mutationFailure: unknown;
    try {
      if (isDone(await getAccount(page, accountId))) return;
    } catch (error) {
      preReadFailure = error;
    }
    try {
      await mutate();
    } catch (error) {
      mutationFailure = error;
    }
    try {
      if (isDone(await getAccount(page, accountId))) return;
      errors.push(new Error(
        `${label}: postcondition not reached`
        + `${preReadFailure ? `; pre-read=${errorMessage(preReadFailure)}` : ""}`
        + `${mutationFailure ? `; mutation=${errorMessage(mutationFailure)}` : ""}`,
      ));
    } catch (postReadFailure) {
      errors.push(new Error(
        `${label}: post-read=${errorMessage(postReadFailure)}`
        + `${preReadFailure ? `; pre-read=${errorMessage(preReadFailure)}` : ""}`
        + `${mutationFailure ? `; mutation=${errorMessage(mutationFailure)}` : ""}`,
      ));
    }
  };

  await converge(
    "bootstrap-reset-2fa",
    (account) => account.tfa === false,
    () => mutateAccount(page, accountId, "POST", "reset-2fa", {
      reason: `${REASON} 紧急收口 bootstrap MFA`,
      operator,
    }),
  );
  await converge(
    "bootstrap-unassign-role",
    (account) => account.role === "unassigned",
    () => mutateAccount(page, accountId, "PATCH", "role", {
      role: "unassigned",
      reason: `${REASON} 紧急收口 bootstrap 角色`,
      operator,
    }),
  );
  await converge(
    "bootstrap-disable",
    (account) => account.status === "disabled",
    () => mutateAccount(page, accountId, "PATCH", "status", {
      status: "disabled",
      reason: `${REASON} 紧急收口 bootstrap 状态`,
      operator,
    }),
  );
  await converge(
    "bootstrap-revoke-sessions",
    (account) => Number(account.sessions) === 0,
    () => mutateAccount(page, accountId, "POST", "sessions/revoke", {
      reason: `${REASON} 紧急收口 bootstrap 会话`,
      operator,
    }),
  );

  try {
    const final = await getAccountWithRetries(page, accountId, 3);
    if (
      final.role !== "unassigned"
      || final.status !== "disabled"
      || final.tfa !== false
      || Number(final.sessions) !== 0
    ) {
      errors.push(new Error(
        `bootstrap final state mismatch: ${JSON.stringify({
          role: final.role,
          status: final.status,
          tfa: final.tfa,
          sessions: final.sessions,
        })}`,
      ));
    }
  } catch (error) {
    errors.push(new Error(`bootstrap final read: ${errorMessage(error)}`));
  }
  if (errors.length) {
    throw new AggregateError(errors, "bootstrap CAS fail-closed convergence failed");
  }
}

async function getAccountWithRetries(page: Page, accountId: string, attempts: number) {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await getAccount(page, accountId);
    } catch (error) {
      lastError = error;
      if (index + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 200 * (index + 1)));
      }
    }
  }
  throw lastError;
}

async function getAccount(page: Page, accountId: string, expectedUsername?: string) {
  const overview = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"),
    "account overview",
  );
  const account = (overview.operators as Array<Record<string, unknown>>)
    .find((candidate) => String(candidate.id) === accountId);
  expect(account).toBeTruthy();
  if (expectedUsername) {
    expect(account?.username, `account ${accountId} username drift`).toBe(expectedUsername);
  }
  return account!;
}

async function mutateAccount(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
  expectedUsername?: string,
) {
  const account = await getAccount(page, accountId, expectedUsername);
  await success(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": `${RUN_ID}-b-second-clean-${suffix}-${accountId}` },
    data: { ...data, expectedVersion: String(account.version) },
  }), `cleanup account ${suffix}`);
}

async function decideUi(
  page: Page,
  operationId: string,
  buttonName: "执行" | "取消",
  action: "approve" | "reject",
) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: buttonName, exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 失败路径 ${action}`,
    (candidate) => candidate.url()
      .endsWith(`/api/admin/platform/audit/operations/${operationId}/${action}`),
  );
  await success(response, `partial ${action}`);
}

async function nav(page: Page, name: string, url: RegExp) {
  const sidebar = page.locator("aside");
  const link = sidebar.getByRole("link", { name, exact: true });
  if (!(await link.isVisible().catch(() => false))) {
    await sidebar.getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  }
  await link.click();
  await expect(page).toHaveURL(url);
}

async function confirm(
  page: Page,
  reason: string,
  predicate: (response: Response) => boolean,
) {
  const response = page.waitForResponse(predicate);
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  return response;
}

async function success<T>(
  response: { ok(): boolean; status(): number; json(): Promise<unknown> },
  label: string,
) {
  const body = await response.json() as Envelope<T>;
  expect(response.ok(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  for (;;) {
    const now = Date.now();
    const step = Math.floor(now / 30_000);
    const remaining = 30_000 - (now % 30_000);
    if (remaining >= 3_000 && lastTotpStep.get(secret) !== step) {
      lastTotpStep.set(secret, step);
      return currentTotp(secret);
    }
    await new Promise((resolve) => setTimeout(resolve, remaining + 250));
  }
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

async function writeJsonAtomically(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${randomBytes(5).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

function requiredAccount(account: Account | undefined, label: string) {
  if (!account?.username || !account.password) throw new Error(`missing ${label}`);
  return account;
}

function must(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof AggregateError) {
    return {
      name: error.name,
      message: error.message,
      errors: error.errors.map((item) => serializeError(item)),
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
}
