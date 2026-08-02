import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260729-114336";
const EXPECTED_TOKEN = `${RUN_ID}-h3-second-writer-fixture-final2`;
const PROBE_SUFFIX = probeSuffix();
const ROLE_CODE = `ACC_FINAL_114336_H3_SECOND_WRITER_R2${PROBE_SUFFIX ? `_P_${PROBE_SUFFIX.toUpperCase()}` : ""}`;
const ROLE_NAME = `FINAL H3 独立第二写者 R2${PROBE_SUFFIX ? ` probe ${PROBE_SUFFIX}` : ""}`;
const USERNAME = `h3r2w5${PROBE_SUFFIX ? `p${PROBE_SUFFIX}` : ""}`;
const DISPLAY_NAME = `FINAL H3 第二写者 R2 114336${PROBE_SUFFIX ? ` ${PROBE_SUFFIX}` : ""}`;
const STALE_BOOTSTRAP_USERNAMES = ["acc_final_114336_h3_bootstrap", "acc_final_114336_h3_bootstrap_2", "acc_final_114336_h3_bootstrap_3", "acc_final_114336_h3_bootstrap_4", "acc_final_114336_h3_bootstrap_5", "acc_final_114336_h3_bootstrap_6", "acc_final_114336_h3_bootstrap_7"];
const BOOTSTRAP_USERNAME = "acc_final_114336_h3_bootstrap_8";
const PERMISSIONS = [
  "growth_h3_read",
  "growth_h3_write",
] as const;
const MENUS = ["H3"] as const;
const EVIDENCE_DIR = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\H\\child-final-GSg\\h3-second-writer-fixture-final2`,
);
const SOURCE_FIXTURE = path.resolve(
  `D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\A\\domain-permission-fixtures\\H.json`,
);
const FINAL_A_FIXTURE = path.resolve(`D:\\workspace\\bug-pic\\.restricted\\${RUN_ID}\\A\\final-fixture-admin-window\\final-domain-checkers.json`);
const PROBE_DIR = PROBE_SUFFIX ? path.join(EVIDENCE_DIR, "cleanup-probes", PROBE_SUFFIX) : EVIDENCE_DIR;
const MANIFEST_PATH = path.join(PROBE_DIR, "H3-second-writer.json");
const REASON = `${RUN_ID} H3 独立 secondWriter fixture-admin window`;

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
type FinalAFixture = { finalAccounts?: { a6_reviewer?: Account } };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("H3 fixture-admin：可见 A1/A6/A2 创建精确 secondWriter 并完成 MFA/权限/刷新重登", async ({
  page,
  browser,
}) => {
  test.skip(
    process.env.H3_SECOND_WRITER_FIXTURE_TOKEN?.trim() !== EXPECTED_TOKEN,
    "Main-controller fixture-admin token not issued.",
  );
  expect(process.env.H3_EXPECT_MFA_BYPASS).toBe("false");
  const superUsername = must("ADMIN_E2E_USERNAME");
  const superPassword = must("ADMIN_E2E_PASSWORD");
  const superTotpSecret = must("ADMIN_E2E_TOTP_SECRET");
  const fixture = JSON.parse(await readFile(SOURCE_FIXTURE, "utf8")) as Fixture;
  const finalA = JSON.parse(await readFile(FINAL_A_FIXTURE, "utf8")) as FinalAFixture;
  expect(fixture.runId).toBe(RUN_ID);
  await mkdir(PROBE_DIR, { recursive: true });

  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    source: "visible A1/A6/A2 isolated-child fixture-admin window",
    target: {
      roleCode: ROLE_CODE,
      username: USERNAME,
      authorities: [...PERMISSIONS],
      menuCodes: [...MENUS],
    },
    boundaries: {
      childOnly: true,
      genericCheckerModified: false,
      crossDomainPermissions: 0,
      businessDomainWrites: 0,
    },
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
  let bootstrapAccountId = "";
  let bootstrapPassword = "";
  let completed = false;

  try {
    await loginMfa(page, { username: superUsername, password: superPassword, totpSecret: superTotpSecret });
    const superSession = await session(page);
    expect(superSession.username).toBe(superUsername);
    expect(superSession.authorities).toEqual(expect.arrayContaining([
      "platform_a1_write",
      "platform_a6_write",
      "platform_a6_role_grants_update",
    ]));

    const bootstrap = requiredAccount(finalA.finalAccounts?.a6_reviewer, "current Final11 A6 reviewer");
    await loginMfa(bootstrapPage, bootstrap);

    const existingRoles = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/roles/overview"),
      "preflight roles",
    );
    const staleRole = (existingRoles.roles as Array<Record<string, unknown>>)
      .find((role) => role.roleCode === ROLE_CODE);
    if (staleRole) {
      roleId = Number(staleRole.id);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    const rolesAfterRecovery = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/roles/overview"),
      "post-recovery roles",
    );
    expect(
      (rolesAfterRecovery.roles as Array<Record<string, unknown>>)
        .some((role) => role.roleCode === ROLE_CODE),
      staleRole ? "existing owned role must remain after its exact A2 grant approval" : "role code must be absent before fixture creation",
    ).toBe(!!staleRole);
    const existingAccounts = await success<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/accounts/overview"),
      "preflight accounts",
    );
    const existingProbeAccount = (existingAccounts.operators as Array<Record<string, unknown>>)
      .find((account) => account.username === USERNAME);
    if (existingProbeAccount && PROBE_SUFFIX && process.env.H3_CLEANUP_PROBE_STAGE === "A1") {
      accountId = String(existingProbeAccount.id);
      failAt("A1");
    }
    expect(existingProbeAccount, "username must be absent before fixture creation").toBeFalsy();

    if (!staleRole) {
      roleId = await createRoleUi(page);
      failAt("A6");
      operationId = await grantRoleUi(page, roleId);
      failAt("A2");
      await assertSelfApprovalDenied(page, operationId);
      await page.keyboard.press("Escape");
      const checkerSession = await session(bootstrapPage);
      expect(checkerSession.authorities).toEqual(expect.arrayContaining([
        "platform_a2_read",
        "platform_a2_operation_approve",
        "platform_a6_role_grants_update",
      ]));
      await approveUi(bootstrapPage, operationId);
    }

    const created = await createAccountUi(page, USERNAME, DISPLAY_NAME, ROLE_NAME);
    accountId = String(created.id);
    failAt("A1");
    const temporaryPassword = await takeTemporaryPassword(page);
    finalPassword = `Nx!B23${randomBytes(18).toString("base64url")}Aa`;
    totpSecret = await activateMfa(
      accountPage,
      USERNAME,
      temporaryPassword,
      finalPassword,
    );

    const initial = await assertSessionExact(accountPage);
    const crossDomain = await assertCrossDomainDenied(accountPage);
    await accountPage.reload({ waitUntil: "domcontentloaded" });
    const afterRefresh = await assertSessionExact(accountPage);
    expect(afterRefresh.authorityHash).toBe(initial.authorityHash);
    expect(afterRefresh.menuHash).toBe(initial.menuHash);

    await visibleLogout(accountPage);
    expect((await accountPage.request.get("/api/admin/auth/session")).status()).toBe(401);
    await loginMfa(accountPage, { username: USERNAME, password: finalPassword, totpSecret });
    const afterRelogin = await assertSessionExact(accountPage);
    expect(afterRelogin.authorityHash).toBe(initial.authorityHash);
    expect(afterRelogin.menuHash).toBe(initial.menuHash);
    const crossDomainAfterRelogin = await assertCrossDomainDenied(accountPage);

    const disableOperationId = await disableAccountUi(page, BOOTSTRAP_USERNAME, `${REASON} 回收 bootstrap 超管账号`);
    await approveUi(bootstrapPage, disableOperationId);

    const restrictedManifest = {
      sensitive: true,
      doNotUpload: true,
      runId: RUN_ID,
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

    evidence.role = { id: roleId, roleCode: ROLE_CODE, grantOperationId: operationId };
    evidence.account = {
      id: accountId,
      username: USERNAME,
      passwordSha256: sha256(finalPassword),
      totpSecretSha256: sha256(totpSecret),
    };
    evidence.session = { initial, afterRefresh, afterRelogin };
    evidence.crossDomain = { initial: crossDomain, afterRelogin: crossDomainAfterRelogin };
    evidence.status = "passed";
    completed = true;
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = serializeError(error);
    evidence.partial = { roleId, operationId, accountId };
    throw error;
  } finally {
    if (!completed && (roleId || accountId || operationId)) {
      evidence.partialCleanup = await cleanupPartial(
        page,
        bootstrapPage,
        superUsername,
        superPassword,
        superTotpSecret,
        roleId,
        operationId,
        accountId,
      ).catch((error) => ({ completed: false, error: serializeError(error) }));
    }
    await writeFile(
      path.join(PROBE_DIR, "fixture-result.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
    await Promise.allSettled([bootstrapContext.close(), accountContext.close()]);
  }
});

async function createRoleUi(page: Page) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  await page.getByRole("button", { name: "+ 新建角色", exact: true }).click();
  await page.getByPlaceholder("如 CONTENT_EDITOR").fill(ROLE_CODE);
  await page.getByPlaceholder("如 内容编辑员").fill(ROLE_NAME);
  await page.getByPlaceholder("职责说明").fill("隔离 child H3 CAS 与幂等验收临时第二写者");
  await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 创建角色`,
    (candidate) => candidate.request().method() === "POST"
      && candidate.url().endsWith("/api/admin/platform/roles"),
  );
  const created = await success<Record<string, unknown>>(response, "create H3 secondWriter role");
  const id = Number(created.id);
  expect(id).toBeGreaterThan(0);
  return id;
}

/** A failed owned setup may leave only its empty role; recover it through A6/A2,
 * never by mutating RBAC tables directly. */
async function recoverOwnedPartialRole(page: Page, checkerPage: Page, checker: Account, roleId: number) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  await page.getByText(ROLE_CODE, { exact: true }).first().click();
  await page.getByRole("button", { name: "删除角色", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 回收失败路径遗留空角色`,
    (candidate) => candidate.request().method() === "DELETE"
      && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}`),
  );
  const ticket = await success<Record<string, unknown>>(response, "recover stale H3 role proposal");
  const operationId = String(ticket.operationId ?? ticket.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  await loginMfa(checkerPage, checker);
  await approveUi(checkerPage, operationId);
}

async function approvePendingOwnedRoleGrantUi(page: Page) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr")
    .filter({ hasText: ROLE_CODE })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = await confirm(
    page,
    `${REASON} 批准失败路径遗留角色授权`,
    (candidate) => candidate.request().method() === "POST"
      && /\/api\/admin\/platform\/audit\/operations\/[^/]+\/approve$/.test(new URL(candidate.url()).pathname),
  );
  const ticket = await success<Record<string, unknown>>(response, "approve stale H3 role grant");
  return String(ticket.operationId ?? ticket.id ?? "");
}

async function disableAccountUi(page: Page, username: string, reason: string) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.locator("select.pager-size").first().selectOption("50");
  let row = page.locator("tbody tr").filter({ hasText: username });
  for (let pageNo = 0; pageNo < 20 && !(await row.count()); pageNo++) {
    const next = page.locator("button.pager-btn").last();
    if (await next.isDisabled()) break;
    await next.click();
    row = page.locator("tbody tr").filter({ hasText: username });
  }
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "禁用", exact: true }).click();
  const response = await confirm(
    page,
    reason,
    (candidate) => candidate.request().method() === "POST"
      && candidate.url().endsWith("/api/admin/platform/audit/operations"),
  );
  const ticket = await success<Record<string, unknown>>(response, "disable bootstrap proposal");
  const operationId = String(ticket.operationId ?? ticket.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function grantRoleUi(page: Page, roleId: number) {
  await page.getByText(ROLE_CODE, { exact: true }).first().click();
  await page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
  for (const permission of PERMISSIONS) {
    await page.getByLabel("权限搜索").fill(permission);
    await page.locator(`label[title="${permission}"] input[type="checkbox"]`).check();
  }
  const menuPanel = page.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div");
  const hParent = menuPanel.getByText("H", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'row')][1]");
  const hParentInput = hParent.locator('input[type="checkbox"]');
  if (await hParentInput.isChecked()) await hParentInput.uncheck();
  for (const code of ["H3"] as const) {
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
  const ticket = await success<Record<string, unknown>>(response, "grant H3 secondWriter role");
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
  await success(response, "approve H3 secondWriter grants");
}

async function createAccountUi(page: Page, username: string, displayName: string, roleName: string) {
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
  return success<Record<string, unknown>>(await response, "create B secondWriter account");
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

async function assertSessionExact(page: Page) {
  const current = await session(page);
  expect(new Set(current.authorities)).toEqual(new Set(PERMISSIONS));
  expect(new Set(current.menuCodes)).toEqual(new Set(MENUS));
  return {
    accountId: current.adminId,
    username: current.username,
    authorityHash: sha256(JSON.stringify([...current.authorities].sort())),
    menuHash: sha256(JSON.stringify([...current.menuCodes].sort())),
  };
}

async function assertCrossDomainDenied(page: Page) {
  const endpoints = [
    "/api/admin/devices/overview",
    "/api/admin/teams/ranks",
    "/api/admin/emergency/kill-switches",
    "/api/admin/platform/audit/overview",
  ];
  const results: Record<string, number> = {};
  for (const endpoint of endpoints) {
    const response = await page.request.get(endpoint);
    expect(response.status(), endpoint).toBe(403);
    results[endpoint] = response.status();
  }
  return results;
}

async function session(page: Page) {
  const data = await success<{
    session?: {
      adminId?: number;
      username?: string;
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
  checkerPage: Page,
  superUsername: string,
  superPassword: string,
  superTotpSecret: string,
  roleId: number,
  grantOperationId: string,
  accountId: string,
) {
  await superPage.keyboard.press("Escape").catch(() => undefined);
  if (!(await superPage.locator("aside").isVisible().catch(() => false))) {
    await loginMfa(superPage, { username: superUsername, password: superPassword, totpSecret: superTotpSecret });
  }
  const actions: string[] = [];
  if (accountId) {
    await nav(superPage, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    await sanitizeAccount(superPage, accountId, superUsername);
    actions.push("account-reset2fa-unassigned-disabled-revoked");
  }
  if (!(await checkerPage.locator("aside").isVisible().catch(() => false))) {
    const fixture = JSON.parse(await readFile(SOURCE_FIXTURE, "utf8")) as Fixture;
    await loginMfa(checkerPage, requiredAccount(fixture.checker, "checker"));
  }
  if (grantOperationId) {
    const audit = await success<Record<string, unknown>>(
      await checkerPage.request.get("/api/admin/platform/audit/overview"),
      "partial cleanup audit",
    );
    const pending = (audit.operationQueue as Array<Record<string, unknown>>)
      .some((ticket) => String(ticket.id) === grantOperationId);
    if (pending) {
      await decideUi(checkerPage, grantOperationId, "取消", "reject");
      actions.push("grant-ticket-rejected");
    }
  }
  if (roleId) {
    await nav(superPage, "角色管理 A6", /\/platform\/roles$/);
    await superPage.getByText(ROLE_CODE, { exact: true }).first().click();
    await superPage.getByRole("button", { name: "删除角色", exact: true }).click();
    const response = await confirm(
      superPage,
      `${REASON} 失败路径删除角色`,
      (candidate) => candidate.request().method() === "DELETE"
        && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}`),
    );
    const ticket = await success<Record<string, unknown>>(response, "partial role delete");
    const deleteId = String(ticket.operationId ?? ticket.id ?? "");
    await decideUi(checkerPage, deleteId, "执行", "approve");
    actions.push("role-delete-approved");
  }
  if (PROBE_SUFFIX && accountId) {
    const idempotency = cleanupProbeIdempotency(accountId);
    actions.push(`idempotency-soft-deleted:${idempotency.deleted}`);
    expect(idempotency.active).toBe(0);
  }
  return { completed: true, actions };
}

/**
 * Product API intentionally forbids deleting operators, but its idempotency
 * store has no cleanup route. For an injected account probe, retire only its
 * deterministic cleanup keys; audit/outbox and all product keys are excluded.
 */
function cleanupProbeIdempotency(accountId: string) {
  if (!PROBE_SUFFIX || !/^\d+$/.test(accountId)) {
    throw new Error("H3_PROBE_IDEMPOTENCY_TARGET_INVALID");
  }
  const mysql = process.env.NEXION_MYSQL_BIN ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
  const database = process.env.H3_CLEANUP_MYSQL_DATABASE ?? "nexion_acceptance_20260729_114336";
  const password = must("H3_CLEANUP_MYSQL_PASSWORD");
  const keys = ["reset-2fa", "role", "status", "sessions-revoke"]
    .map((suffix) => `'${RUN_ID}-b-second-clean-${suffix}-${accountId}'`)
    .join(",");
  const query = (statement: string) => execFileSync(mysql, ["-h", "127.0.0.1", "-N", "-B", "-uroot", database, "-e", statement], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: password },
  }).trim();
  query(`UPDATE nx_admin_idempotency_record
    SET is_deleted=1
    WHERE is_deleted=0
      AND scope IN ('A1:ACCOUNT_2FA_RESET','A1:ACCOUNT_ROLE','A1:ACCOUNT_STATUS','A1:ACCOUNT_SESSIONS_REVOKE')
      AND idempotency_key IN (${keys});`);
  const deleted = Number(query("SELECT ROW_COUNT();"));
  const active = Number(query(`SELECT COUNT(*) FROM nx_admin_idempotency_record
    WHERE is_deleted=0
      AND scope IN ('A1:ACCOUNT_2FA_RESET','A1:ACCOUNT_ROLE','A1:ACCOUNT_STATUS','A1:ACCOUNT_SESSIONS_REVOKE')
      AND idempotency_key IN (${keys});`));
  return {
    deleted,
    active,
  };
}

async function sanitizeAccount(page: Page, accountId: string, operator: string) {
  let account = await getAccount(page, accountId);
  if (account.tfa === true) {
    await mutateAccount(page, accountId, "POST", "reset-2fa", {
      reason: `${REASON} 失败路径清除 MFA`,
      operator,
    });
  }
  account = await getAccount(page, accountId);
  if (account.role !== "unassigned") {
    await mutateAccount(page, accountId, "PATCH", "role", {
      role: "unassigned",
      reason: `${REASON} 失败路径解除角色`,
      operator,
    });
  }
  account = await getAccount(page, accountId);
  if (account.status !== "disabled") {
    await mutateAccount(page, accountId, "PATCH", "status", {
      status: "disabled",
      reason: `${REASON} 失败路径停用`,
      operator,
    });
  }
  account = await getAccount(page, accountId);
  if (Number(account.sessions) > 0) {
    await mutateAccount(page, accountId, "POST", "sessions/revoke", {
      reason: `${REASON} 失败路径撤销会话`,
      operator,
    });
  }
  expect(await getAccount(page, accountId)).toMatchObject({
    role: "unassigned",
    status: "disabled",
    tfa: false,
    sessions: 0,
  });
}

async function getAccount(page: Page, accountId: string) {
  const overview = await success<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"),
    "account overview",
  );
  const account = (overview.operators as Array<Record<string, unknown>>)
    .find((candidate) => String(candidate.id) === accountId);
  expect(account).toBeTruthy();
  return account!;
}

async function mutateAccount(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
) {
  const account = await getAccount(page, accountId);
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

function failAt(stage: "A6" | "A2" | "A1") {
  if (process.env.H3_CLEANUP_PROBE_STAGE === stage) throw new Error(`H3_CLEANUP_PROBE_${stage}`);
}

function probeSuffix() {
  const value = process.env.H3_CLEANUP_PROBE_SUFFIX?.trim().toLowerCase() ?? "";
  if (value && !/^[a-z0-9]{1,12}$/.test(value)) throw new Error("H3_CLEANUP_PROBE_SUFFIX_INVALID");
  return value;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: String(error) };
}
