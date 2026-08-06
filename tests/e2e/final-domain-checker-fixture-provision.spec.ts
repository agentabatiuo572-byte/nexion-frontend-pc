import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";
import { normalizeEffectiveMenus } from "../../lib/admin/session-role";

/** UI-only provisioning under FINAL_FIXTURE_ADMIN_WINDOW. No business-domain writes. */
const RUN_ID = process.env.FINAL_FIXTURE_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const EVIDENCE_DIR = process.env.FINAL_FIXTURE_EVIDENCE_DIR ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/final-fixture-admin-window`;
const MANIFEST_PATH = process.env.FINAL_FIXTURE_MANIFEST_PATH ?? `${EVIDENCE_DIR}/final-domain-checkers.json`;
const SUPER_USERNAME = must("ADMIN_E2E_USERNAME");
const SUPER_PASSWORD = must("ADMIN_E2E_PASSWORD");
const TOKEN = randomBytes(4).toString("hex");
const consumedTotpCodes = new Map<string, string>();
const REASON = `${RUN_ID} FINAL_FIXTURE_ADMIN_WINDOW 最小跨域验收账号授权`;
const FIXTURE_ATTEMPT = "R3";
const ROLE_PREFIX = `ACC_FINAL_${RUN_ID.replace(/[^A-Z0-9]/gi, "").slice(-14).toUpperCase()}_${FIXTURE_ATTEMPT}`;
const FINAL75_READONLY_ROLE_CODE = `${ROLE_PREFIX}_75_READONLY`;
const FINAL75_MENU_CODES = CONSOLE_NAV.flatMap((domain) => [domain.code, ...domain.l2.map((module) => module.id)]);
const FINAL75_UNIQUE_MENU_CODES = [...new Set(FINAL75_MENU_CODES)];
const FINAL75_LEAF_MENU_CODES = CONSOLE_NAV.flatMap((domain) => domain.l2.map((module) => module.id));
// A-M domains plus their 75 visible L2 modules.  This guard makes nav drift a
// fixture failure rather than silently granting a partial sidebar.
expect(CONSOLE_NAV).toHaveLength(13);
expect(FINAL75_MENU_CODES).toHaveLength(88);
expect(FINAL75_UNIQUE_MENU_CODES).toHaveLength(88);
const FINAL_CHECKER_SPECS = [
  { key: "a6_reviewer", roleCode: `${ROLE_PREFIX}_A6_REVIEWER`, menuCodes: ["A2", "A6"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "platform_a6_read", "platform_a6_write", "platform_a6_role_grants_update"] },
  { key: "e3e6_checker", roleCode: `${ROLE_PREFIX}_E6_CHECKER`, menuCodes: ["A2", "E3", "E6"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "device_e3_read", "device_e3_write", "device_e6_read", "device_e6_write"] },
  { key: "f1_checker", roleCode: `${ROLE_PREFIX}_F1_CHECKER`, menuCodes: ["A2", "F1"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "network_f1_read", "network_f1_write"] },
  { key: "f25_checker", roleCode: `${ROLE_PREFIX}_F25_CHECKER`, menuCodes: ["A2", "F2", "F3", "F4", "F5"], permissions: ["platform_a2_read", "platform_a2_operation_approve", "network_f2_read", "network_f3_read", "network_f4_read", "network_f5_read", "network_f2_policy_amplify", "network_f2_royalty_rate", "network_f2_write", "network_f3_engine_pause", "network_f3_match_rate", "network_f3_write", "network_f4_leaderboard_control", "network_f4_pool_fund", "network_f4_write", "network_f5_commission_dispose", "network_f5_commission_reject", "network_f5_write"] },
  { key: "m_checker", roleCode: `${ROLE_PREFIX}_M_CHECKER`, menuCodes: ["A2", "M1", "M2", "M3", "M4", "M5"], permissions: ["platform_a2_read", "service_m1_read", "service_m1_write", "service_m2_read", "service_m2_write", "service_m3_read", "service_m3_write", "service_m3_timeout_manage", "service_m4_read", "service_m4_write", "service_m5_read", "service_m5_write"] },
  { key: "l3_checker", roleCode: `${ROLE_PREFIX}_L3_CHECKER`, menuCodes: ["A2", "L3"], permissions: ["platform_a2_read", "bi_l3_read", "bi_l5_task_approve"] },
] as const;
const FINAL_CHECKER_PERMISSION_CATALOG = [...new Set(FINAL_CHECKER_SPECS.flatMap((spec) => spec.permissions))];

type Api<T> = { code?: number; data?: T; message?: string };
type Role = { id: number; roleCode: string };
type Account = { id: string | number; username?: string; version?: number };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("FINAL fixture window: visible A1/A6/A2 creates exact normal-MFA domain checkers", async ({ page, browser }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await loginPasswordOnly(page, SUPER_USERNAME, SUPER_PASSWORD);
  const recovery = { accounts: [] as Array<{ username: string }>, roles: [] as Array<{ roleCode: string; id: number }>, pending: [] as string[], errors: [] as string[] };
  let complete = false;

  const roles: Record<string, { id: number; roleCode: string; roleName: string; operationId: string }> = {};
  const accounts: Record<string, { accountId: string; username: string; password: string; totpSecret: string; roleCode: string }> = {};
  let bootstrapContext: BrowserContext | null = null;
  let bootstrapPage: Page = page;
  let bootstrap: { id: string | number; username: string } | null = null;
  let bootstrapFinalPassword = "";
  let bootstrapMfa = "";
  let mSupervisor: { accountId: string; username: string; password: string; totpSecret: string; actorRole: "SUPPORT"; createdForRun: true; permittedUse: ["M1", "M5"] } | null = null;
  try {
    // Every bootstrap phase is inside this outer try: a password-drawer or MFA
    // failure still leaves a tracked A1 account for the original super to recover.
    bootstrap = await createAccountUi(page, {
      username: `ffix.check.${TOKEN}`,
      displayName: `FINAL 夹具复核员 ${TOKEN}`,
      roleName: "超级管理员",
    });
    recovery.accounts.push({ username: bootstrap.username });
    const bootstrapPassword = await takeTemporaryPassword(page);
    bootstrapFinalPassword = `Nx!Ffix9${randomBytes(18).toString("base64url")}Aa`;
    bootstrapContext = await browser.newContext();
    bootstrapPage = await bootstrapContext.newPage();
    bootstrapMfa = await activateMfa(bootstrapPage, bootstrap.username, bootstrapPassword, bootstrapFinalPassword);
    // A failed window must remain recoverable through a normal independent
    // A2 login after this browser context closes.  Persist this *only* in the
    // restricted RunID evidence area; never print it or write it to reports.
    await writeJsonAtomically(`${EVIDENCE_DIR}/bootstrap-recovery-context.json`, {
      sensitive: true, doNotUpload: true, runId: RUN_ID, fixtureAttempt: FIXTURE_ATTEMPT,
      purpose: "failure-only independent A2 approval and visible cleanup",
      account: { accountId: String(bootstrap.id), username: bootstrap.username, password: bootstrapFinalPassword, totpSecret: bootstrapMfa },
    });
    for (const spec of FINAL_CHECKER_SPECS) {
      // A failed earlier window may have left exactly this RunID role with an
      // incomplete grant.  Locate it through visible A6 and repair its exact
      // grant set under this fresh maker/checker pair; never treat it as done.
      const role = await getOrCreateRoleUi(page, spec.roleCode, `FINAL ${spec.key} ${TOKEN}`);
      recovery.roles.push(role);
      const operationId = await grantRoleUi(page, role.id, spec.permissions, spec.menuCodes);
      recovery.pending.push(operationId);
      // Same actor can never approve. Preserve this negative fact before the
      // independent bootstrap checker executes the real UI A2 approval.
      await assertSelfApprovalDenied(page, operationId);
      await approveUi(bootstrapPage, operationId);
      recovery.pending = recovery.pending.filter((id) => id !== operationId);
      roles[spec.key] = { ...role, operationId };
    }

    for (const spec of FINAL_CHECKER_SPECS) {
      // L3's double-operator/CAS review needs two independent normal-MFA
      // identities on the same narrow role.  The generic checker alias below
      // remains for backward-compatible consumers but is never a shared login.
      const accountKeys = spec.key === "l3_checker"
        ? ["l3_checker_primary", "l3_checker_secondary"]
        : [spec.key];
      for (const accountKey of accountKeys) {
        const created = await createAccountUi(page, {
          username: `ffix.${accountKey}.${TOKEN}`.slice(0, 32),
          displayName: `${RUN_ID} ${accountKey}`,
          roleName: roles[spec.key].roleName,
        });
        recovery.accounts.push({ username: created.username });
        const temporaryPassword = await takeTemporaryPassword(page);
        const finalPassword = `Nx!Ffix9${randomBytes(18).toString("base64url")}Aa`;
        const context = await browser.newContext();
        try {
          const checker = await context.newPage();
          const totpSecret = await activateMfa(checker, created.username, temporaryPassword, finalPassword);
          await assertSessionExact(checker, spec.permissions, spec.menuCodes);
          await assertNegativePreflight(checker, spec.key);
          await logoutUi(checker);
          accounts[accountKey] = { accountId: String(created.id), username: created.username, password: finalPassword, totpSecret, roleCode: roles[spec.key].roleCode };
        } finally {
          await context.close();
        }
      }
      if (spec.key === "l3_checker") accounts.l3_checker = accounts.l3_checker_primary;
    }

    // This fixture deliberately consumes the existing SUPPORT role. It never
    // creates, edits, or widens that global role; it exists only for M1/M5
    // supervisor flows where the custom M checker must remain least-privilege.
    const supervisor = await createAccountUi(page, {
      username: `ffix.msupervisor.${TOKEN}`.slice(0, 32),
      displayName: `${RUN_ID} M supervisor`,
      roleName: "客服",
    });
    recovery.accounts.push({ username: supervisor.username });
    const supervisorTemporaryPassword = await takeTemporaryPassword(page);
    const supervisorPassword = `Nx!Ffix9${randomBytes(18).toString("base64url")}Aa`;
    const supervisorContext = await browser.newContext();
    try {
      const supervisorPage = await supervisorContext.newPage();
      const supervisorTotp = await activateMfa(supervisorPage, supervisor.username, supervisorTemporaryPassword, supervisorPassword);
      const session = await ok<{ session?: { role?: string; authorities?: string[] } }>(await supervisorPage.request.get("/api/admin/auth/session"));
      expect(String(session.session?.role ?? "").toUpperCase()).toBe("SUPPORT");
      for (const permission of ["service_m1_read", "service_m1_write", "service_m5_read", "service_m5_write"]) {
        expect(session.session?.authorities ?? []).toContain(permission);
      }
      await logoutUi(supervisorPage);
      mSupervisor = { accountId: String(supervisor.id), username: supervisor.username, password: supervisorPassword, totpSecret: supervisorTotp, actorRole: "SUPPORT", createdForRun: true, permittedUse: ["M1", "M5"] };
    } finally {
      await supervisorContext.close();
    }

    // FINAL75 is a distinct normal-MFA account.  Its role is deliberately
    // generated from the visible A6 grant drawer rather than a checked-in
    // permission list, so newly registered read permissions cannot be missed.
    const final75Role = await getOrCreateRoleUi(page, FINAL75_READONLY_ROLE_CODE, `FINAL75 全域只读 ${TOKEN}`);
    recovery.roles.push(final75Role);
    const readonlyPermissions = await grantFinal75ReadOnlyRoleUi(page, final75Role.id, final75Role.roleCode);
    const final75OperationId = readonlyPermissions.operationId;
    recovery.pending.push(final75OperationId);
    await assertSelfApprovalDenied(page, final75OperationId);
    await approveUi(bootstrapPage, final75OperationId);
    recovery.pending = recovery.pending.filter((id) => id !== final75OperationId);
    roles.final75_readonly = { ...final75Role, operationId: final75OperationId };

    const final75 = await createAccountUi(page, {
      username: `ffix.final75.${TOKEN}`.slice(0, 32),
      displayName: `${RUN_ID} FINAL75 read-only`,
      roleName: final75Role.roleName,
    });
    recovery.accounts.push({ username: final75.username });
    const final75TemporaryPassword = await takeTemporaryPassword(page);
    const final75Password = `Nx!Ffix9${randomBytes(18).toString("base64url")}Aa`;
    const final75Context = await browser.newContext();
    try {
      const final75Page = await final75Context.newPage();
      const final75Totp = await activateMfa(final75Page, final75.username, final75TemporaryPassword, final75Password);
      const firstHash = await assertSessionExact(final75Page, readonlyPermissions.permissionCodes, FINAL75_LEAF_MENU_CODES);
      await assertFinal75WriteDenied(final75Page);
      await final75Page.reload();
      await expect(final75Page.locator("aside")).toBeVisible();
      expect(await assertSessionExact(final75Page, readonlyPermissions.permissionCodes, FINAL75_LEAF_MENU_CODES)).toBe(firstHash);
      await logoutUi(final75Page);
      await loginPasswordOnly(final75Page, final75.username, final75Password, final75Totp);
      expect(await assertSessionExact(final75Page, readonlyPermissions.permissionCodes, FINAL75_LEAF_MENU_CODES)).toBe(firstHash);
      await logoutUi(final75Page);
      accounts.final75_readonly = {
        accountId: String(final75.id), username: final75.username, password: final75Password, totpSecret: final75Totp, roleCode: final75Role.roleCode,
      };
    } finally {
      await final75Context.close();
    }

    expect(mSupervisor).not.toBeNull();
    const manifest = {
      sensitive: true,
      doNotUpload: true,
      runId: RUN_ID,
      fixtureAttempt: FIXTURE_ATTEMPT,
      generatedAt: new Date().toISOString(),
      source: "visible A1/A6/A2 fixture-admin window",
      // Keep every executable account under one manifest namespace.  This is
      // intentionally not a custom role: it is a fresh A1 account assigned to
      // the pre-existing SUPPORT role for the two M supervisor journeys.
      finalAccounts: { ...accounts, m_supervisor: mSupervisor! },
      final75MenuSourceCodes: FINAL75_UNIQUE_MENU_CODES,
      final75SessionMenuCodes: FINAL75_LEAF_MENU_CODES,
      roles,
      bootstrapCleanup: { accountId: String(bootstrap!.id), username: bootstrap!.username, password: bootstrapFinalPassword, totpSecret: bootstrapMfa, required: true },
      cleanup: ["disable/revoke/unassign final accounts", "delete final roles via A6 with distinct A2 approval", "disable/revoke bootstrap super account"],
    };
    await writeManifestAtomically(manifest);
    await writeConsumerManifests({
      accounts,
      roles,
      mSupervisor: mSupervisor!,
      bootstrap: { accountId: String(bootstrap!.id), username: bootstrap!.username, password: bootstrapFinalPassword, totpSecret: bootstrapMfa, required: true },
    });
    complete = true;
  } finally {
    if (!complete) await cleanupPartialSuccessUi(page, bootstrapPage, recovery);
    await bootstrapContext?.close();
  }
});

/**
 * Failure-only cleanup is intentionally UI driven.  Each item is isolated so
 * one rejected/cas-conflicted recovery does not prevent later objects being
 * reclaimed; the restricted manifest records every resulting error.
 */
async function cleanupPartialSuccessUi(page: Page, checker: Page, recovery: { accounts: Array<{ username: string }>; roles: Array<{ roleCode: string; id: number }>; pending: string[]; errors: string[] }) {
  for (const operationId of recovery.pending) {
    try { await nav(checker, "审计 & 操作确认 A2", /\/platform\/audit$/); await checker.reload(); const row = checker.locator("tbody tr").filter({ hasText: operationId }); if (await row.count()) { await row.getByRole("button", { name: "取消执行", exact: true }).click(); await confirm(checker, `${REASON} 失败清理撤回待处理票`, (r) => r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/reject`)); } } catch (error) { recovery.errors.push(`pending:${operationId}:${String(error)}`); }
  }
  for (const account of [...recovery.accounts].reverse()) {
    try {
      await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); await page.reload();
      const row = await findAccountRowUi(page, account.username);
      if (!row || !await row.getByRole("button", { name: "禁用", exact: true }).count()) continue;
      await row.getByRole("button", { name: "禁用", exact: true }).click();
      const response = await confirm(page, `${REASON} 失败清理禁用账号并吊销会话`, (r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/audit/operations"));
      const submitted = await ok<{ operationId?: string; id?: string }>(response);
      const operationId = submitted.operationId ?? submitted.id; expect(operationId).toMatch(/^(?:WO|OP)-/);
      // The original super is maker; the still-live bootstrap context is a
      // distinct A2 approver, including the final bootstrap-disable ticket.
      await approveUi(checker, operationId!);
      await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); await page.reload();
      const readback = await findAccountRowUi(page, account.username);
      if (readback) { await expect(readback.locator("td").nth(3)).toContainText("已禁用"); await expect(readback.locator("td").nth(5)).toContainText("0"); }
    } catch (error) { recovery.errors.push(`account:${account.username}:${String(error)}`); }
  }
  // Do not soft-delete RunID roles during a retry: A6 has no visible restore
  // path and the backend's unique roleCode prevents the exact same attempt
  // from being rebuilt.  They remain a recorded, zero/partial-grant retry
  // base; the next run reopens A6 and submits the complete grant set again.
  await writeFile(`${EVIDENCE_DIR}/partial-success-cleanup.json`, JSON.stringify({
    attemptedAt: new Date().toISOString(),
    recovery: { ...recovery, rolesRetainedForRetry: recovery.roles },
  }, null, 2));
}

async function findAccountRowUi(page: Page, username: string) {
  await page.locator("select.pager-size").selectOption("50");
  for (let index = 0; index < 20; index += 1) {
    const row = page.locator("tbody tr").filter({ hasText: username }); if (await row.count()) return row;
    const next = page.locator("button.pager-btn").last(); if (await next.isDisabled()) break;
    await next.click(); await page.waitForTimeout(100);
  }
  return null;
}

async function createRoleUi(page: Page, roleCode: string, roleName: string) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  await page.getByRole("button", { name: "+ 新建角色", exact: true }).click();
  await page.getByPlaceholder("如 CONTENT_EDITOR").fill(roleCode);
  await page.getByPlaceholder("如 内容编辑员").fill(roleName);
  await page.getByPlaceholder("职责说明").fill("FINAL 全量验收临时最小权限角色，完成后按清理清单删除");
  await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();
  const response = await confirm(page, REASON, (r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/roles"));
  const body = await ok<Record<string, unknown>>(response);
  return { id: Number(body.id), roleCode, roleName };
}

async function getOrCreateRoleUi(page: Page, roleCode: string, roleName: string) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  // Route completion precedes the A6 overview fetch.  A retained RunID role
  // must not be mistaken for an absent role while this visible list hydrates.
  await expect(page.getByText("加载中…", { exact: true })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "+ 新建角色", exact: true })).toBeVisible({ timeout: 30_000 });
  const existing = page.getByText(roleCode, { exact: true }).first();
  if (!await existing.count()) return createRoleUi(page, roleCode, roleName);
  const detailResponse = page.waitForResponse((response) =>
    response.request().method() === "GET" && new RegExp(`/api/admin/platform/roles/\\d+$`).test(new URL(response.url()).pathname),
  );
  await existing.click();
  const detail = await ok<{ id?: number; roleName?: string }>(await detailResponse);
  expect(Number.isSafeInteger(detail.id)).toBe(true);
  expect(detail.roleName).toBeTruthy();
  return { id: detail.id!, roleCode, roleName: detail.roleName! };
}

async function grantRoleUi(page: Page, roleId: number, permissions: readonly string[], menuCodes: readonly string[]) {
  // The A6 list renders role code, therefore locate by the selected role detail
  // from the current page's only just-created role row via the roleCode text.
  const matching = FINAL_CHECKER_SPECS.find((spec) => spec.permissions === permissions);
  await page.getByText(matching!.roleCode, { exact: true }).first().click();
  await page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
  const drawer = page.getByRole("dialog").last();
  const search = drawer.getByRole("textbox", { name: "权限搜索", exact: true });
  // Retried RunID roles may survive a failed fixture attempt.  Reconcile the
  // complete known fixture permission catalogue first so a stale grant (for
  // example A2 approval on the intentionally non-approving M checker) cannot
  // silently widen a later retry.
  for (const candidate of FINAL_CHECKER_PERMISSION_CATALOG) {
    await search.fill(candidate);
    const checkbox = drawer.locator(`label[title="${candidate}"] input[type="checkbox"]`);
    if (await checkbox.count() && !permissions.includes(candidate) && await checkbox.isChecked()) await checkbox.uncheck();
  }
  for (const permission of permissions) {
    await search.fill(permission);
    await drawer.locator(`label[title="${permission}"] input[type="checkbox"]`).check();
  }
  await search.fill("");
  const menuPanel = drawer.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div");
  // Existing retry roles may still hold broad parent selections from a failed
  // attempt.  Clear the whole visible A6 tree first, then add only leaves.
  const menuCheckboxes = menuPanel.locator('input[type="checkbox"]');
  for (let index = 0; index < await menuCheckboxes.count(); index += 1) {
    const checkbox = menuCheckboxes.nth(index);
    if (await checkbox.isChecked()) await checkbox.uncheck();
  }
  // A6 parent-checkbox semantics recursively select every descendant.  Grant
  // only required L2 leaves; the backend returns their mandatory ancestors in
  // the exact session menu closure.
  for (const code of menuCodes.filter((code) => code.length > 1)) {
    const row = menuPanel.getByText(code, { exact: true }).locator("xpath=ancestor::div[contains(@class,'row')][1]");
    await row.locator('input[type="checkbox"]').check();
  }
  await page.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
  const response = await confirm(page, REASON, (r) => r.request().method() === "PUT" && r.url().endsWith(`/api/admin/platform/roles/${roleId}/grants`));
  const ticket = await ok<Record<string, unknown>>(response);
  const operationId = String(ticket.operationId ?? ticket.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

/**
 * A6 is the permission catalogue authority for the full read-only fixture.
 * The drawer only renders one selected domain at a time, so enumerate every
 * visible A-M domain after filtering for `_read`, then select the discovered
 * checkbox titles and no static permission code list.
 */
async function grantFinal75ReadOnlyRoleUi(page: Page, roleId: number, roleCode: string) {
  await nav(page, "角色管理 A6", /\/platform\/roles$/);
  await page.getByText(roleCode, { exact: true }).first().click();
  await page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
  const drawer = page.getByRole("dialog").last();
  await expect(drawer.getByRole("textbox", { name: "权限搜索", exact: true })).toBeVisible();

  // The account starts on an empty role.  Constrain the catalogue to read
  // entries, dynamically collect title codes from the actual drawer, and
  // assert that every selected value is an exact `_read` permission.
  await drawer.getByRole("textbox", { name: "权限搜索", exact: true }).fill("_read");
  const discovered = new Set<string>();
  for (const domain of CONSOLE_NAV) {
    const domainButton = drawer.locator("button").filter({ hasText: new RegExp(`^${domain.code} ·`) }).first();
    await expect(domainButton, `A6 must expose ${domain.code} in filtered permission catalogue`).toBeVisible();
    await domainButton.click();
    const labels = drawer.locator('label[title]:has(input[type="checkbox"])');
    await expect(labels.first(), `${domain.code} must expose at least one _read permission`).toBeVisible();
    const titles = await labels.evaluateAll((nodes) => nodes
      .map((node) => node.getAttribute("title") ?? "")
      .filter((title) => title.endsWith("_read")));
    expect(titles, `${domain.code} drawer query may only expose _read permissions`).not.toHaveLength(0);
    expect(titles.every((title) => title.endsWith("_read")), `${domain.code} must not select a write/HIGH permission`).toBe(true);
    for (const title of titles) {
      await drawer.locator(`label[title="${title}"] input[type="checkbox"]`).check();
      discovered.add(title);
    }
  }
  const permissionCodes = [...discovered].sort();
  expect(permissionCodes).not.toHaveLength(0);
  expect(permissionCodes.every((code) => code.endsWith("_read"))).toBe(true);

  const menuPanel = drawer.getByText("菜单授权（可见性）", { exact: false }).locator("xpath=parent::div");
  // FINAL75 selects all 75 L2 leaves; A-M parents are produced by the menu
  // tree's ancestor closure and are asserted in the 88-code session set.
  for (const code of FINAL75_UNIQUE_MENU_CODES.filter((code) => code.length > 1)) {
    const a6Code = a6MenuCode(code);
    const row = menuPanel.getByText(a6Code, { exact: true }).locator("xpath=ancestor::div[contains(@class,'row')][1]");
    await expect(row, `A6 menu tree must contain ${code}`).toBeVisible();
    await row.locator('input[type="checkbox"]').check();
  }
  await page.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
  const response = await confirm(page, REASON, (r) => r.request().method() === "PUT" && r.url().endsWith(`/api/admin/platform/roles/${roleId}/grants`));
  const ticket = await ok<Record<string, unknown>>(response);
  const operationId = String(ticket.operationId ?? ticket.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return { permissionCodes, operationId };
}

function a6MenuCode(code: string) { return ({ I4: "MENU_CONTENT_I4", I5: "MENU_CONTENT_I5" } as Record<string, string>)[code] ?? code; }

async function createAccountUi(page: Page, input: { username: string; displayName: string; roleName: string }) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await expect(page.getByText("正在读取 /api/admin/platform/accounts/overview。", { exact: true })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "+ 新建账号", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const scope = page.getByRole("dialog").last();
  await expect(scope.getByText("新建运营账号", { exact: true })).toBeVisible();
  await scope.getByRole("textbox", { name: "登录名 *", exact: true }).fill(input.username);
  await scope.getByPlaceholder("姓名,如:张三").fill(input.displayName);
  const role = scope.getByText(input.roleName, { exact: true });
  await expect(role).toBeVisible({ timeout: 30_000 });
  await role.click();
  await scope.getByLabel(/操作理由/).fill(REASON);
  const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/accounts"));
  await scope.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirmation = page.getByRole("dialog").last();
  await confirmation.getByLabel(/操作理由/).fill(REASON);
  await confirmation.getByRole("button", { name: "确认提交", exact: true }).click();
  const result = await ok<Record<string, unknown>>(await response);
  return { id: result.id as string | number, username: input.username };
}

async function takeTemporaryPassword(page: Page) {
  const scope = page.getByRole("dialog").last();
  await expect(scope.getByText("临时密码", { exact: true })).toBeVisible();
  const password = (await scope.locator(".mono").last().textContent())?.trim() ?? "";
  expect(password).not.toBe("");
  await scope.getByText("关闭", { exact: true }).click();
  return password;
}

async function assertSelfApprovalDenied(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload();
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const response = await confirm(page, `${REASON} 验证同人不能自批`, (r) => r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`));
  expect(response.status()).toBe(403);
  const body = await response.json() as Api<unknown>;
  expect(body.message).toBe("A2_MAKER_CHECKER_REQUIRED");
  // A rejected A2 confirmation intentionally stays open to show its error.
  // Close it through the visible dialog before the next A6 lifecycle step.
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function approveUi(page: Page, operationId: string) {
  await nav(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload();
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  await ok(await confirm(page, `${REASON} 独立复核批准`, (r) => r.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`)));
}

async function assertSessionExact(page: Page, permissions: readonly string[], menuCodes: readonly string[]) {
  const session = await ok<{ session?: { authorities?: string[]; menuCodes?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(await page.request.get("/api/admin/auth/session"));
  const authorities = session.session?.authorities ?? [];
  expect(new Set(authorities)).toEqual(new Set(permissions));
  const rawMenus = session.session?.menuCodes ?? (session.session?.effectiveMenus ?? []).map((menu) => typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean);
  const effectiveMenus = normalizeEffectiveMenus({ menuCodes: rawMenus }) ?? [];
  expect(new Set(effectiveMenus)).toEqual(new Set(menuCodes));
  return createHash("sha256").update(JSON.stringify({
    authorities: [...authorities].sort(),
    menuCodes: [...effectiveMenus].sort(),
  })).digest("hex");
}

/** All writes must be rejected before request-body validation or mutation. */
async function assertFinal75WriteDenied(page: Page) {
  const representativeWrites: Array<{ domain: "A" | "E" | "F" | "M" | "K" | "L"; method: "POST" | "PUT" | "PATCH"; path: string }> = [
    { domain: "A", method: "PUT", path: "/api/admin/platform/config" },
    { domain: "E", method: "PATCH", path: "/api/admin/devices/e3/config" },
    { domain: "F", method: "PATCH", path: "/api/admin/teams/ranks/V1/thresholds/selfBuy" },
    { domain: "M", method: "PATCH", path: "/api/admin/content/tickets/load-config" },
    { domain: "K", method: "POST", path: "/api/admin/risk/signals" },
    { domain: "L", method: "POST", path: "/api/admin/bi/reports" },
  ];
  for (const probe of representativeWrites) {
    const response = await page.request.fetch(probe.path, {
      method: probe.method,
      headers: { "Idempotency-Key": `${RUN_ID}-final75-deny-${probe.domain}` },
      data: {},
    });
    expect(response.status(), `FINAL75 ${probe.domain} write must fail closed before validation`).toBe(403);
  }
}

async function assertNegativePreflight(page: Page, key: string) {
  const path = key === "e3e6_checker" ? "/api/admin/teams/ranks" : key === "f1_checker" ? "/api/admin/devices/overview" : "/api/admin/devices/overview";
  const response = await page.request.get(path);
  expect(response.status(), `${key} cross-domain read must fail closed`).toBe(403);
  await page.reload();
  await expect(page.locator("aside")).toBeVisible();
}

async function activateMfa(page: Page, username: string, temporaryPassword: string, finalPassword: string) {
  await page.goto("/");
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  const secret = ((await page.locator("code").first().textContent()) ?? "").trim();
  expect(secret).not.toBe("");
  for (let attempt = 0; attempt < 3 && await otp.isVisible().catch(() => false); attempt += 1) {
    const code = totp(secret);
    await otp.fill(code);
    const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/auth/mfa/verify"));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    if ((await response).status() === 200) { consumedTotpCodes.set(secret, code); break; }
    await page.waitForTimeout(1_100);
  }
  const change = page.getByRole("heading", { name: "首次登录修改密码" });
  await expect(change).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
  await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
  await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return secret;
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const raw = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase(); let bits = "";
  for (const char of raw) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function loginPasswordOnly(page: Page, username: string, password: string, knownTotpSecret?: string) {
  await page.goto("/");
  const user = page.locator('input[autocomplete="username"]');
  if (await user.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await user.fill(username); await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "继续", exact: true }).click();
  }
  const otp = page.getByLabel("一次性验证码");
  let otpRequired = false;
  try { await otp.waitFor({ state: "visible", timeout: 10_000 }); otpRequired = true; } catch { /* superadmin may enter directly */ }
  if (otpRequired) {
    const secret = knownTotpSecret ?? must("ADMIN_E2E_TOTP_SECRET");
    // The superadmin secret may have been used by another isolated carrier
    // just before this fixture window starts.  Start each challenge in a new
    // 30-second window rather than assuming this process owns that history.
    let previousStep = Math.floor(Date.now() / 30_000);
    await page.waitForTimeout((previousStep + 1) * 30_000 - Date.now() + 300);
    let verified = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await otp.waitFor({ state: "visible", timeout: 10_000 });
      const step = Math.floor(Date.now() / 30_000);
      if (step <= previousStep) await page.waitForTimeout((previousStep + 1) * 30_000 - Date.now() + 300);
      previousStep = Math.floor(Date.now() / 30_000);
      const code = totp(secret);
      await otp.fill(code);
      const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/auth/mfa/verify"));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      if ((await response).status() === 200) { consumedTotpCodes.set(secret, code); verified = true; break; }
    }
    expect(verified, "MFA_VERIFY_FAILED_AFTER_NEXT_TOTP_WINDOW").toBe(true);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function nav(page: Page, name: string, url: RegExp) {
  // Domain callbacks keep a rejected confirmation open so its error remains
  // readable.  Recovery must dismiss that visible modal before navigating.
  const openDialog = page.getByRole("dialog").last();
  if (await openDialog.isVisible().catch(() => false)) {
    const close = openDialog.getByRole("button", { name: "关闭", exact: true });
    if (await close.isVisible().catch(() => false)) await close.click({ timeout: 3_000 }).catch(() => undefined);
    if (await openDialog.isVisible().catch(() => false)) {
      await expect(openDialog).toBeHidden({ timeout: 5_000 }).catch(async () => { await page.keyboard.press("Escape"); });
    }
  }
  const link = page.locator("aside").getByRole("link", { name, exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click(); await expect(page).toHaveURL(url);
}
async function confirm(page: Page, reason: string, predicate: (response: Response) => boolean) {
  const response = page.waitForResponse(predicate);
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible(); await dialog.getByLabel(/操作理由/).fill(reason); await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  return response;
}
async function ok<T>(response: { ok(): boolean; status(): number; json(): Promise<unknown> }) { const body = await response.json() as Api<T>; expect(response.ok(), JSON.stringify(body)).toBeTruthy(); expect(body.code).toBe(0); return body.data as T; }
async function logoutUi(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').first();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await account.click();
      const logout = page.getByRole("button", { name: "退出登录", exact: true }).last();
      await expect(logout).toBeVisible();
      await logout.click({ timeout: 5_000 });
      await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 10_000 });
      return;
    } catch (error) { lastError = error; await page.waitForTimeout(250); }
  }
  throw lastError;
}
async function writeManifestAtomically(value: unknown) { await writeJsonAtomically(MANIFEST_PATH, value); }

/**
 * Give downstream L/M checks only their own restricted credentials rather
 * than requiring them to parse the all-domain manifest.  These are generated
 * only after every provision/session assertion above has passed.
 */
async function writeConsumerManifests(input: {
  accounts: Record<string, { accountId: string; username: string; password: string; totpSecret: string; roleCode: string }>;
  roles: Record<string, { id: number; roleCode: string; roleName: string; operationId: string }>;
  mSupervisor: { accountId: string; username: string; password: string; totpSecret: string; actorRole: "SUPPORT"; createdForRun: true; permittedUse: ["M1", "M5"] };
  bootstrap: { accountId: string; username: string; password: string; totpSecret: string; required: true };
}) {
  const l3Role = input.roles.l3_checker;
  await writeJsonAtomically(`${EVIDENCE_DIR}/L/l3-second-checkers.json`, {
    sensitive: true, doNotUpload: true, runId: RUN_ID, fixtureAttempt: FIXTURE_ATTEMPT,
    accounts: { checkerA: input.accounts.l3_checker_primary, checkerB: input.accounts.l3_checker_secondary },
    authorities: ["platform_a2_read", "bi_l3_read", "bi_l5_task_approve"], menuCodes: ["A2", "L3"],
    role: l3Role,
  });
  await writeJsonAtomically(`${EVIDENCE_DIR}/M/m-checker.json`, {
    sensitive: true, doNotUpload: true, runId: RUN_ID, fixtureAttempt: FIXTURE_ATTEMPT,
    account: input.accounts.m_checker, role: input.roles.m_checker,
    authorities: ["platform_a2_read", "service_m1_read", "service_m1_write", "service_m2_read", "service_m2_write", "service_m3_read", "service_m3_write", "service_m3_timeout_manage", "service_m4_read", "service_m4_write", "service_m5_read", "service_m5_write"],
    menuCodes: ["A2", "M1", "M2", "M3", "M4", "M5"],
  });
  await writeJsonAtomically(`${EVIDENCE_DIR}/M/m-support-supervisor.json`, {
    sensitive: true, doNotUpload: true, runId: RUN_ID, fixtureAttempt: FIXTURE_ATTEMPT,
    account: input.mSupervisor,
  });
  await writeJsonAtomically(`${EVIDENCE_DIR}/M/bootstrap-cleanup-admin.json`, {
    sensitive: true, doNotUpload: true, runId: RUN_ID, fixtureAttempt: FIXTURE_ATTEMPT,
    account: input.bootstrap,
  });
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${TOKEN}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, filePath);
}
function must(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name}_REQUIRED`); return value; }
